/**
 * The converter for files the browser can't decode itself (AVI, WMV, FLV, MPEG-2 .mpg/.vob, ProRes
 * or DNxHD .mov, HEVC where unsupported…): ffmpeg.wasm, loaded only when needed. The wrapper is
 * served from /studio/ffmpeg (copied there from node_modules at build time, so it gets the editor's
 * COEP header); the single-threaded 31 MB core comes from jsDelivr once and stays cached.
 *
 * It first tries a lossless remux into MP4 (instant when the codecs are fine and only the container
 * is the problem), and re-encodes to H.264 + AAC only when that isn't enough. Everything runs on
 * this device.
 */

type FFmpeg = {
  load(config: { coreURL: string; wasmURL: string }): Promise<boolean>;
  on(event: "progress", cb: (e: { progress: number; time: number }) => void): void;
  on(event: "log", cb: (e: { type: string; message: string }) => void): void;
  off(event: "progress", cb: (e: { progress: number; time: number }) => void): void;
  writeFile(path: string, data: Uint8Array): Promise<boolean>;
  readFile(path: string): Promise<Uint8Array | string>;
  deleteFile(path: string): Promise<boolean>;
  exec(args: string[], timeout?: number): Promise<number>;
  terminate(): void;
};

const CORE = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm";
/** Formats Mediabunny can't open (or browsers rarely decode), offered for conversion on import. */
export const CONVERTIBLE = /\.(avi|wmv|asf|flv|f4v|mpg|mpeg|m2v|vob|ts|mts|m2ts|3gp|3g2|ogv|rm|rmvb|divx|xvid|dv|mxf|wtv|amr|wma|ac3|aiff?|caf|ape|mka)$/i;
export const MAX_CONVERT_BYTES = 1024 * 1024 * 1024;

let instance: Promise<FFmpeg> | null = null;

async function blobUrl(url: string, type: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("The converter couldn't be downloaded. Check your connection.");
  return URL.createObjectURL(new Blob([await res.arrayBuffer()], { type }));
}

function load(onStatus?: (label: string) => void): Promise<FFmpeg> {
  instance ??= (async () => {
    onStatus?.("Downloading the converter (once, about 31 MB)");
    const url = "/studio/ffmpeg/index.js";
    const mod = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url)) as { FFmpeg: new () => FFmpeg };
    const ff = new mod.FFmpeg();
    const [coreURL, wasmURL] = await Promise.all([blobUrl(`${CORE}/ffmpeg-core.js`, "text/javascript"), blobUrl(`${CORE}/ffmpeg-core.wasm`, "application/wasm")]);
    await ff.load({ coreURL, wasmURL });
    return ff;
  })().catch((e) => {
    instance = null;
    throw e;
  });
  return instance;
}

/**
 * Converts a file into an MP4 (H.264 + AAC) the editor can decode frame by frame, or an M4A for
 * sound-only files. `probeOk` checks a candidate (the remux) before it's accepted.
 */
export async function convertFile(file: File, opts: { onProgress?: (f: number, label: string) => void; probeOk?: (f: File) => Promise<boolean> } = {}): Promise<File> {
  if (file.size > MAX_CONVERT_BYTES) throw new Error("Files over 1 GB are too big to convert in the browser. Convert it with a desktop tool first.");
  const ff = await load((label) => opts.onProgress?.(0, label));
  const ext = (/\.[a-z0-9]+$/i.exec(file.name)?.[0] ?? ".bin").toLowerCase();
  const input = `input${ext}`;
  const base = file.name.replace(/\.[^.]+$/, "");
  const audioOnly = /\.(amr|wma|ac3|aiff?|caf|ape|mka)$/i.test(file.name);
  let label = "Converting";
  const onProg = (e: { progress: number }) => opts.onProgress?.(Math.min(0.99, Math.max(0, e.progress)), label);
  ff.on("progress", onProg);
  try {
    opts.onProgress?.(0, "Reading the file");
    await ff.writeFile(input, new Uint8Array(await file.arrayBuffer()));
    if (!audioOnly) {
      // 1) Remux: same streams, new container. Seconds instead of minutes when it works.
      label = "Repackaging";
      const code = await ff.exec(["-i", input, "-map", "0:v:0", "-map", "0:a:0?", "-c", "copy", "-movflags", "+faststart", "remux.mp4"]);
      if (code === 0) {
        const data = await ff.readFile("remux.mp4");
        await ff.deleteFile("remux.mp4").catch(() => false);
        if (data instanceof Uint8Array && data.length > 1024) {
          const out = new File([data as BlobPart], `${base}.mp4`, { type: "video/mp4" });
          if (!opts.probeOk || (await opts.probeOk(out))) return out;
        }
      }
      // 2) Re-encode: H.264 (up to 1080p) + AAC.
      label = "Converting to MP4 (this takes a while)";
      const enc = await ff.exec([
        "-i", input,
        "-map", "0:v:0", "-map", "0:a:0?",
        "-vf", "scale='if(gt(iw,ih),min(1920,iw),-2)':'if(gt(iw,ih),-2,min(1920,ih))'",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k",
        "-movflags", "+faststart", "out.mp4",
      ]);
      if (enc !== 0) throw new Error("ffmpeg couldn't read this file. It may be damaged or use a very unusual format.");
      const data = await ff.readFile("out.mp4");
      await ff.deleteFile("out.mp4").catch(() => false);
      return new File([data as BlobPart], `${base}.mp4`, { type: "video/mp4" });
    }
    label = "Converting the sound";
    const code = await ff.exec(["-i", input, "-vn", "-c:a", "aac", "-b:a", "192k", "out.m4a"]);
    if (code !== 0) throw new Error("ffmpeg couldn't read this file.");
    const data = await ff.readFile("out.m4a");
    await ff.deleteFile("out.m4a").catch(() => false);
    return new File([data as BlobPart], `${base}.m4a`, { type: "audio/mp4" });
  } finally {
    ff.off("progress", onProg);
    await ff.deleteFile(input).catch(() => false);
  }
}
