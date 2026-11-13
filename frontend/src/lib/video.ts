/**
 * Frames out of a video, in the browser: the file is played by a hidden <video>, seeked to each
 * moment and drawn on a canvas. Nothing is uploaded. Works for anything the browser can play
 * (MP4/H.264, WebM, MOV in most browsers, Ogg); other formats get a clear message.
 */

export type LoadedVideo = { video: HTMLVideoElement; url: string; duration: number; width: number; height: number };

export class VideoError extends Error {}

export function loadVideo(file: File): Promise<LoadedVideo> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.crossOrigin = "anonymous";
    const fail = () => {
      URL.revokeObjectURL(url);
      reject(new VideoError("This browser can't play that video, so its frames can't be read here. Convert it to MP4 first (Universal converter), then try again."));
    };
    video.onerror = fail;
    video.onloadeddata = () => {
      if (!video.videoWidth || !Number.isFinite(video.duration) || video.duration <= 0) return fail();
      resolve({ video, url, duration: video.duration, width: video.videoWidth, height: video.videoHeight });
    };
    video.src = url;
  });
}

/** Seeks and waits until that frame is actually on screen (not just "seeked"). */
export async function seek(video: HTMLVideoElement, t: number): Promise<void> {
  const target = Math.max(0, Math.min(t, video.duration - 0.001));
  if (Math.abs(video.currentTime - target) < 1e-4 && video.readyState >= 2) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new VideoError("The video stopped responding while seeking.")), 15000);
    video.addEventListener(
      "seeked",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
    video.currentTime = target;
  });
  // Chrome fires "seeked" before the new frame is composited; wait for it when we can.
  const v = video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
  if (v.requestVideoFrameCallback) await Promise.race([new Promise<void>((r) => v.requestVideoFrameCallback!(() => r())), new Promise((r) => setTimeout(r, 120))]);
}

/** The current frame, scaled to `width` (keeping the aspect ratio). */
export function drawFrame(video: HTMLVideoElement, width: number, canvas = document.createElement("canvas")) {
  const w = Math.max(2, Math.round(width));
  const h = Math.max(2, Math.round((w * video.videoHeight) / video.videoWidth));
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext("2d", { willReadFrequently: true })!;
  g.imageSmoothingQuality = "high";
  g.drawImage(video, 0, 0, w, h);
  return canvas;
}

export const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new VideoError("The frame couldn't be saved."))), type, quality));

/** "00:01:05.250" for file names and labels. */
export function stamp(t: number, withMs = true) {
  const ms = Math.round((t % 1) * 1000);
  const s = Math.floor(t) % 60;
  const m = Math.floor(t / 60) % 60;
  const h = Math.floor(t / 3600);
  const base = `${h ? `${String(h).padStart(2, "0")}:` : ""}${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return withMs ? `${base}.${String(ms).padStart(3, "0")}` : base;
}

/** Packs files into a ZIP (stored, not compressed: JPG/PNG/WebP don't shrink further). */
export async function zipFiles(files: { name: string; blob: Blob }[]): Promise<Blob> {
  const { zip } = await import("fflate");
  const entries: Record<string, [Uint8Array, { level: 0 }]> = {};
  for (const f of files) entries[f.name] = [new Uint8Array(await f.blob.arrayBuffer()), { level: 0 }];
  const data = await new Promise<Uint8Array>((resolve, reject) => zip(entries, (err, out) => (err ? reject(err) : resolve(out))));
  return new Blob([data as Uint8Array<ArrayBuffer>], { type: "application/zip" });
}
