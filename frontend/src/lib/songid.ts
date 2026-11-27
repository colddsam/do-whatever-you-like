/**
 * The song finder's browser side (components/tools/media/song-finder.tsx).
 *
 * - `startRecording` records the microphone raw: no noise suppression or echo cancellation, which
 *   would scrub out music playing nearby and flatten a hummed tune.
 * - `detectNotes` finds the tune in a clip on this device (YIN pitch tracking), so a hum costs the
 *   server nothing: only the notes travel, beside the clip.
 * - The rest are thin calls to /api/tools/songid (backend/app/api/v1/endpoints/songid.py).
 */

export type SongMatch = {
  title: string;
  artist: string;
  album?: string | null;
  year?: number | null;
  genre?: string | null;
  duration_seconds?: number | null;
  artwork?: string | null;
  preview_url?: string | null;
  apple_url?: string | null;
  lyrics?: string | null;
  synced_lyrics?: string | null;
  matched_line?: string | null;
  confidence: number;
  verified: boolean;
  source: "lyrics" | "melody" | "audio";
};

export type SongSearch = {
  input: "text" | "audio";
  kind: "words" | "melody" | "none";
  heard?: string | null;
  matches: SongMatch[];
  message?: string | null;
};

export type SongVideo = { id?: string | null; title?: string | null; channel?: string | null; duration_seconds?: number | null };
export type SongIdCapabilities = { lyrics: boolean; audio: boolean; melody: boolean; max_clip_seconds: number; max_file_mb: number };
export type Note = { m: number; d: number };

/** Longest recording sent: enough for a chorus line, small enough for any connection. */
export const MAX_RECORD_SECONDS = 15;
/** Uploads go through Vercel, which refuses bodies over 4.5 MB. */
export const MAX_UPLOAD_MB = 4;

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { detail?: unknown };
    if (typeof body.detail === "string") return body.detail;
  } catch {
    /* not JSON */
  }
  if (res.status === 413) return `That clip is too big. Keep it under ${MAX_UPLOAD_MB} MB.`;
  if (res.status === 504) return "That took too long. Try again.";
  return fallback;
}

export async function loadCapabilities(signal?: AbortSignal): Promise<SongIdCapabilities | null> {
  try {
    const res = await fetch("/api/tools/songid/capabilities", { signal, cache: "no-store" });
    return res.ok ? ((await res.json()) as SongIdCapabilities) : null;
  } catch {
    return null;
  }
}

export async function searchLyrics(text: string, signal?: AbortSignal): Promise<SongSearch> {
  const res = await fetch("/api/tools/songid/lyrics", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
    signal,
  });
  if (!res.ok) throw new Error(await readError(res, "We couldn't search for that song. Try again."));
  return (await res.json()) as SongSearch;
}

export async function searchAudio(clip: Blob, name: string, notes: Note[], signal?: AbortSignal): Promise<SongSearch> {
  const form = new FormData();
  form.append("file", new File([clip], name, { type: clip.type || "audio/webm" }));
  if (notes.length) form.append("notes", JSON.stringify(notes));
  const res = await fetch("/api/tools/songid/audio", { method: "POST", body: form, signal });
  if (!res.ok) throw new Error(await readError(res, "We couldn't search with that recording. Try again."));
  return (await res.json()) as SongSearch;
}

export async function findVideo(title: string, artist: string, signal?: AbortSignal): Promise<SongVideo | null> {
  try {
    const res = await fetch(`/api/tools/songid/video?${new URLSearchParams({ title, artist })}`, { signal });
    if (!res.ok) return null;
    const v = (await res.json()) as SongVideo;
    return v.id && /^[\w-]{11}$/.test(v.id) ? v : null;
  } catch {
    return null;
  }
}

/** File name for a recorded clip, by what the browser recorded in (Safari: MP4, others: WebM). */
export function clipName(type: string): string {
  return type.includes("mp4") ? "clip.m4a" : type.includes("ogg") ? "clip.ogg" : type.includes("wav") ? "clip.wav" : "clip.webm";
}

/* ---------- Links out ---------- */

export const youtubeSearchUrl = (s: SongMatch) => `https://www.youtube.com/results?${new URLSearchParams({ search_query: `${s.artist} ${s.title}` })}`;
export const spotifySearchUrl = (s: SongMatch) => `https://open.spotify.com/search/${encodeURIComponent(`${s.title} ${s.artist}`)}`;
export const lyricsSearchUrl = (s: SongMatch) => `https://www.google.com/search?${new URLSearchParams({ q: `${s.title} ${s.artist} lyrics` })}`;

/* ---------- Recording ---------- */

export function recordingSupported(): boolean {
  return typeof window !== "undefined" && typeof MediaRecorder !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
}

export type Recording = {
  /** Resolves with the clip once stopped (by `stop`, the time limit, or a long silence). */
  done: Promise<Blob>;
  stop: () => void;
  cancel: () => void;
};

/**
 * Records the microphone. `onTick` gets the level (0–1) and elapsed seconds every frame.
 * Stops on its own at `maxSeconds`, or after `silenceMs` of quiet once something was heard.
 */
export async function startRecording(opts: {
  maxSeconds?: number;
  silenceMs?: number;
  onTick?: (level: number, seconds: number) => void;
}): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
  });
  const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((t) => MediaRecorder.isTypeSupported?.(t)) ?? "";
  const recorder = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 64_000 } : undefined);
  const chunks: BlobPart[] = [];
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AC();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  const started = performance.now();
  let heard = false;
  let lastLoud = started;
  let raf = 0;
  let cancelled = false;

  const finish = () => {
    cancelAnimationFrame(raf);
    stream.getTracks().forEach((t) => t.stop());
    ctx.close().catch(() => {});
  };
  const stop = () => {
    if (recorder.state !== "inactive") recorder.stop();
  };

  const done = new Promise<Blob>((resolve, reject) => {
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    recorder.onstop = () => {
      finish();
      if (cancelled) reject(new DOMException("Cancelled", "AbortError"));
      else resolve(new Blob(chunks, { type: recorder.mimeType || type || "audio/webm" }));
    };
    recorder.onerror = () => {
      finish();
      reject(new Error("Recording failed. Try again."));
    };
  });

  const tick = () => {
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += v * v;
    const level = Math.min(1, Math.sqrt(sum / buf.length) * 5);
    const now = performance.now();
    const seconds = (now - started) / 1000;
    opts.onTick?.(level, seconds);
    if (level > 0.06) {
      heard = true;
      lastLoud = now;
    }
    if (seconds >= (opts.maxSeconds ?? MAX_RECORD_SECONDS) || (heard && seconds > 4 && now - lastLoud > (opts.silenceMs ?? 3500))) {
      stop();
      return;
    }
    raf = requestAnimationFrame(tick);
  };
  recorder.start(250);
  raf = requestAnimationFrame(tick);

  return {
    done,
    stop,
    cancel: () => {
      cancelled = true;
      stop();
    },
  };
}

/* ---------- The tune: pitch tracking on this device ---------- */

/** Decodes a clip to mono samples (the first 20 s; a tune needs no more). */
export async function decodeClip(blob: Blob): Promise<{ samples: Float32Array; rate: number } | null> {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
    ctx.close().catch(() => {});
    const length = Math.min(audio.length, Math.floor(audio.sampleRate * 20));
    const mono = new Float32Array(length);
    for (let c = 0; c < audio.numberOfChannels; c++) {
      const ch = audio.getChannelData(c);
      for (let i = 0; i < length; i++) mono[i] += ch[i] / audio.numberOfChannels;
    }
    return { samples: mono, rate: audio.sampleRate };
  } catch {
    return null;
  }
}

/** Every `factor`-th sample, low-passed first so it doesn't alias. */
function downsample(samples: Float32Array, rate: number, target: number): { data: Float32Array; rate: number } {
  const factor = Math.max(1, Math.floor(rate / target));
  if (factor === 1) return { data: samples, rate };
  const out = new Float32Array(Math.floor(samples.length / factor));
  for (let i = 0; i < out.length; i++) {
    let s = 0;
    for (let k = 0; k < factor; k++) s += samples[i * factor + k];
    out[i] = s / factor;
  }
  return { data: out, rate: rate / factor };
}

/** YIN pitch of one frame in Hz, or 0 when the frame isn't clearly pitched. */
function yin(frame: Float32Array, rate: number, minHz: number, maxHz: number, diff: Float32Array): number {
  const maxLag = Math.min(Math.floor(rate / minHz), diff.length - 1);
  const minLag = Math.max(2, Math.floor(rate / maxHz));
  const w = frame.length - maxLag;
  diff[0] = 1;
  let running = 0;
  for (let lag = 1; lag <= maxLag; lag++) {
    let d = 0;
    for (let i = 0; i < w; i++) {
      const x = frame[i] - frame[i + lag];
      d += x * x;
    }
    running += d;
    diff[lag] = running ? (d * lag) / running : 1; // cumulative mean normalised difference
  }
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (diff[lag] < 0.15) {
      while (lag + 1 <= maxLag && diff[lag + 1] < diff[lag]) lag++;
      // Parabolic interpolation for a pitch between whole lags.
      const a = diff[lag - 1], b = diff[lag], c = lag + 1 <= maxLag ? diff[lag + 1] : b;
      const shift = (a - c) / (2 * (a - 2 * b + c) || 1);
      return rate / (lag + (Math.abs(shift) < 1 ? shift : 0));
    }
  }
  return 0;
}

/**
 * The notes of a sung, hummed or whistled tune: [{m: MIDI pitch, d: seconds}].
 * Frames are pitch-tracked every 20 ms, smoothed, and grouped into notes where the pitch holds
 * within about a semitone; blips under 80 ms are dropped.
 */
export function detectNotes(input: Float32Array, inputRate: number): Note[] {
  const { data, rate } = downsample(input, inputRate, 11_025);
  const frameLen = 1024;
  const hop = Math.round(rate * 0.02);
  const diff = new Float32Array(frameLen);
  const pitches: number[] = [];
  const energy: number[] = [];
  let peak = 0;
  for (const v of data) peak = Math.max(peak, Math.abs(v));
  const gate = Math.max(0.01, peak * 0.08);
  for (let start = 0; start + frameLen <= data.length; start += hop) {
    const frame = data.subarray(start, start + frameLen);
    let sum = 0;
    for (const v of frame) sum += v * v;
    // Loudness over a short (~23 ms) window in the middle of the frame: short enough to see the
    // dip between two hummed notes, which the long pitch window would smear away.
    const mid = data.subarray(start + 384, start + 640);
    let midSum = 0;
    for (const v of mid) midSum += v * v;
    energy.push(Math.sqrt(midSum / mid.length));
    if (Math.sqrt(sum / frameLen) < gate * 0.35) {
      pitches.push(0);
      continue;
    }
    const hz = yin(frame, rate, 70, 1100, diff);
    pitches.push(hz > 0 ? 69 + 12 * Math.log2(hz / 440) : 0);
  }
  // Median of 5 removes octave jumps and single bad frames.
  const smooth = pitches.map((_, i) => {
    const win = pitches.slice(Math.max(0, i - 2), i + 3).filter((p) => p > 0);
    if (!pitches[i] || win.length < 3) return 0;
    win.sort((a, b) => a - b);
    return win[Math.floor(win.length / 2)];
  });

  const step = hop / rate;
  const notes: Array<Note & { start: number; onset: boolean }> = [];
  let run: number[] = [];
  let runStart = 0;
  let runPeak = 0;
  let dipped = false;
  let onset = false;
  const flush = () => {
    if (run.length * step >= 0.08) {
      const sorted = [...run].sort((a, b) => a - b);
      notes.push({ m: Math.round(sorted[Math.floor(sorted.length / 2)] * 10) / 10, d: run.length * step, start: runStart * step, onset });
    }
    run = [];
    runPeak = 0;
    dipped = false;
    onset = false;
  };
  smooth.forEach((p, i) => {
    if (!p) {
      flush();
      return;
    }
    if (run.length) {
      const sorted = [...run].sort((a, b) => a - b);
      if (Math.abs(p - sorted[Math.floor(sorted.length / 2)]) > 0.7) flush();
      else if (energy[i] < runPeak * 0.5) dipped = true;
      else if (dipped && energy[i] > runPeak * 0.75) {
        // Loudness dipped and came back on the same pitch: a repeated note ("hm-hm"), not one long one.
        flush();
        onset = true;
      }
    }
    if (!run.length) runStart = i;
    run.push(p);
    runPeak = Math.max(runPeak, energy[i]);
  });
  flush();

  // A note split by a wobble (same pitch, no gap) is one note; the same pitch after a gap is a
  // repeated note ("twin-kle twin-kle") and stays two.
  // Blips under 110 ms are the slide between two notes or a note dying away, not notes sung.
  const held = notes.filter((n) => n.d >= 0.11);
  const merged: Array<Note & { start: number; onset: boolean }> = [];
  for (const n of held) {
    const last = merged[merged.length - 1];
    if (last && !n.onset && Math.abs(last.m - n.m) < 0.45 && n.start - (last.start + last.d) < step * 1.5) last.d = n.start + n.d - last.start;
    else merged.push({ ...n });
  }
  return merged.slice(0, 200).map(({ m, d }) => ({ m, d: Math.round(d * 100) / 100 }));
}
