/**
 * Recording straight into the project (Clipchamp's screen, camera and voice recorder): the browser's
 * MediaRecorder captures the microphone, the webcam or a screen/tab/window on this device, and the
 * file is imported like any other. Nothing is streamed anywhere.
 */

export type RecordKind = "mic" | "camera" | "screen";

export type Recording = {
  stream: MediaStream;
  /** Stops and returns the recorded file. */
  stop: () => Promise<File>;
  cancel: () => void;
  startedAt: number;
};

function pickMime(kind: RecordKind) {
  const tries =
    kind === "mic"
      ? ["audio/webm;codecs=opus", "audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/webm"]
      : ["video/mp4;codecs=avc1,mp4a.40.2", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/mp4", "video/webm"];
  return tries.find((t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) ?? "";
}

export function recordingSupported(kind: RecordKind) {
  if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices) return false;
  return kind === "screen" ? "getDisplayMedia" in navigator.mediaDevices : "getUserMedia" in navigator.mediaDevices;
}

export async function startRecording(kind: RecordKind): Promise<Recording> {
  if (!recordingSupported(kind)) throw new Error("This browser can't record here. Try Chrome, Edge or Firefox on a computer.");
  let stream: MediaStream;
  try {
    if (kind === "mic") stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    else if (kind === "camera") stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } }, audio: { echoCancellation: true, noiseSuppression: true } });
    else stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30 } }, audio: true });
  } catch (e) {
    const name = e instanceof DOMException ? e.name : "";
    if (name === "NotAllowedError") throw new Error(kind === "screen" ? "Screen sharing was cancelled." : "Permission was denied. Allow the microphone/camera for this site and try again.");
    if (name === "NotFoundError") throw new Error(kind === "mic" ? "No microphone was found." : "No camera was found.");
    throw new Error("Recording couldn't start on this device.");
  }
  const mimeType = pickMime(kind);
  const rec = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: kind === "mic" ? undefined : 8_000_000, audioBitsPerSecond: 160_000 } : undefined);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  const stopTracks = () => stream.getTracks().forEach((t) => t.stop());
  let done: ((f: File) => void) | null = null;
  let fail: ((e: Error) => void) | null = null;
  rec.onstop = () => {
    stopTracks();
    const type = rec.mimeType || mimeType || (kind === "mic" ? "audio/webm" : "video/webm");
    const ext = type.includes("mp4") ? (kind === "mic" ? "m4a" : "mp4") : "webm";
    const label = kind === "mic" ? "Voice-over" : kind === "camera" ? "Camera" : "Screen recording";
    const stamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }).replace(/:/g, ".");
    if (!chunks.length) fail?.(new Error("Nothing was recorded."));
    else done?.(new File(chunks, `${label} ${stamp}.${ext}`, { type: type.split(";")[0] }));
  };
  // A screen share stopped from the browser's own bar ends the recording too.
  stream.getVideoTracks()[0]?.addEventListener("ended", () => {
    if (rec.state === "recording") rec.stop();
  });
  rec.start(1000);
  return {
    stream,
    startedAt: performance.now(),
    stop: () =>
      new Promise<File>((resolve, reject) => {
        done = resolve;
        fail = reject;
        if (rec.state === "inactive") {
          if (chunks.length) rec.onstop?.(new Event("stop"));
          else reject(new Error("Nothing was recorded."));
        } else rec.stop();
      }),
    cancel: () => {
      rec.ondataavailable = null;
      rec.onstop = null;
      if (rec.state !== "inactive") rec.stop();
      stopTracks();
    },
  };
}
