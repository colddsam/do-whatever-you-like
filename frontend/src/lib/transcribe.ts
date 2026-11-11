/** Client side of speech to text: the streamed request, and the transcript in every export format. */

import { directTarget, dropDirectTarget, FileToolError } from "./files";

export const TRANSCRIBE_ENDPOINT = "/api/tools/transcribe/run";
export const CAPABILITIES_ENDPOINT = "/api/tools/transcribe/capabilities";

/** Mirrors ALLOWED_EXTENSIONS in backend/app/services/transcribe.py. */
export const AUDIO_EXTENSIONS = [
  ".mp3", ".wav", ".m4a", ".aac", ".ogg", ".oga", ".opus", ".flac", ".wma", ".amr", ".aiff", ".aif", ".weba",
  ".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v", ".3gp", ".mpeg", ".mpg",
];
export const MAX_MB = 150;
/** Mirrors PROMPT_MAX_CHARS. */
export const HINT_MAX = 400;

export type Segment = { id: number; start: number; end: number; text: string };

export type Capabilities = {
  available: boolean;
  engine: "local" | "groq" | "none";
  model: string;
  private: boolean;
  languages: string[];
  extensions: string[];
  max_file_mb: number;
  max_duration_seconds: number;
};

export type TranscriptInfo = {
  language: string;
  language_probability: number | null;
  duration: number;
  engine: "local" | "groq";
  model: string;
};

export type Stage = "queued" | "preparing" | "loading" | "transcribing";

/** What the backend streams, one JSON object per line (see backend/app/schemas/transcribe.py). */
export type StreamEvent =
  | { type: "status"; stage: Stage }
  | ({ type: "info" } & TranscriptInfo)
  | ({ type: "segment" } & Segment)
  | { type: "progress"; done: number }
  | { type: "ping" };

type Done = { type: "done"; segments: number; elapsed: number };

type StreamOptions = {
  signal?: AbortSignal;
  onUpload?: (fraction: number) => void;
  /** The file is fully sent; the server is checking it. */
  onUploaded?: () => void;
  onEvent: (event: StreamEvent) => void;
};

/**
 * Sends the recording and reads the transcript as it is written. Resolves when the server says
 * it's done; rejects with a FileToolError when it reports a problem. In production the file goes
 * straight to the backend with a ticket (see lib/files.ts), like every other file tool.
 */
export async function streamTranscription(form: FormData, options: StreamOptions): Promise<Done> {
  const direct = await directTarget(TRANSCRIBE_ENDPOINT, options.signal);
  try {
    return await send(direct?.url ?? TRANSCRIBE_ENDPOINT, form, options, direct?.ticket);
  } catch (e) {
    if (!direct || !(e instanceof FileToolError) || e.status !== 401) throw e;
    dropDirectTarget(TRANSCRIBE_ENDPOINT);
    const again = await directTarget(TRANSCRIBE_ENDPOINT, options.signal);
    return send(again?.url ?? TRANSCRIBE_ENDPOINT, form, options, again?.ticket);
  }
}

/** XHR, because it reports upload progress and hands over the response as it arrives. */
function send(url: string, form: FormData, { signal, onUpload, onUploaded, onEvent }: StreamOptions, ticket?: string) {
  return new Promise<Done>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    if (ticket) xhr.setRequestHeader("X-Upload-Ticket", ticket);

    let read = 0;
    let done: Done | null = null;
    let failed: string | null = null;
    const drain = () => {
      if (xhr.status !== 200) return;
      const text = xhr.responseText;
      for (let nl = text.indexOf("\n", read); nl !== -1; nl = text.indexOf("\n", read)) {
        const line = text.slice(read, nl).trim();
        read = nl + 1;
        if (!line) continue;
        let event: StreamEvent | Done | { type: "error"; detail: string };
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }
        if (event.type === "done") done = event;
        else if (event.type === "error") failed = event.detail;
        else onEvent(event);
      }
    };

    xhr.upload.onprogress = (e) => e.lengthComputable && onUpload?.(e.loaded / e.total);
    xhr.upload.onload = () => onUploaded?.();
    xhr.onprogress = drain;
    xhr.onerror = () => reject(new FileToolError("The connection was interrupted. Check your connection and try again."));
    xhr.onabort = () => reject(new DOMException("Aborted", "AbortError"));
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        let detail: unknown;
        try {
          detail = (JSON.parse(xhr.responseText) as { detail?: unknown }).detail;
        } catch {}
        return reject(new FileToolError(typeof detail === "string" ? detail : `Request failed (${xhr.status}).`, xhr.status));
      }
      drain();
      if (failed) reject(new FileToolError(failed));
      else if (done) resolve(done);
      else reject(new FileToolError("The connection dropped before the transcript was finished. Try again."));
    };

    if (signal) {
      if (signal.aborted) return reject(new DOMException("Aborted", "AbortError"));
      signal.addEventListener("abort", () => xhr.abort(), { once: true });
    }
    xhr.send(form);
  });
}

/* ---------- Languages ---------- */

const names = (() => {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" });
  } catch {
    return null;
  }
})();
const SPECIAL: Record<string, string> = { jw: "Javanese", haw: "Hawaiian", yue: "Cantonese", ht: "Haitian Creole" };

/** "hi" → "Hindi". The Groq engine reports names ("hindi"), which are tidied up instead. */
export function languageName(code: string) {
  if (!code) return "Unknown";
  if (code.length > 3) return code.charAt(0).toUpperCase() + code.slice(1);
  return SPECIAL[code] ?? names?.of(code) ?? code.toUpperCase();
}

/** The languages most people pick, offered as chips; the rest are in a list. */
export const COMMON_LANGUAGES = ["en", "hi", "bn", "es", "fr", "ar"];

/* ---------- Formats ---------- */

export type Format = "txt" | "srt" | "vtt" | "json";

export const FORMATS: { value: Format; label: string; about: string; type: string }[] = [
  { value: "txt", label: "TXT", about: "Plain text, with a new paragraph wherever the speaker pauses.", type: "text/plain" },
  { value: "srt", label: "SRT", about: "Subtitles for video players, editors and YouTube.", type: "application/x-subrip" },
  { value: "vtt", label: "VTT", about: "Subtitles for web video (the HTML track format).", type: "text/vtt" },
  { value: "json", label: "JSON", about: "Every line with its start and end time, for developers.", type: "application/json" },
];

/** 83.5 → "01:23" (or "1:01:23" past an hour), for the transcript's margin. */
export function stamp(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const r = String(s % 60).padStart(2, "0");
  return h ? `${h}:${m}:${r}` : `${m}:${r}`;
}

/** Subtitle clock: "00:01:23,500" (SRT) or "00:01:23.500" (VTT). */
function clock(seconds: number, sep: "," | ".") {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = String(Math.floor(ms / 3_600_000)).padStart(2, "0");
  const m = String(Math.floor((ms % 3_600_000) / 60_000)).padStart(2, "0");
  const s = String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0");
  return `${h}:${m}:${s}${sep}${String(ms % 1000).padStart(3, "0")}`;
}

/** A pause this long (seconds) starts a new paragraph in plain text. */
const PARAGRAPH_GAP = 1.5;

export function toText(segments: Segment[], timestamps: boolean) {
  if (timestamps) return segments.map((s) => `[${stamp(s.start)}] ${s.text}`).join("\n") + "\n";
  const paragraphs: string[][] = [];
  segments.forEach((s, i) => {
    if (i === 0 || s.start - segments[i - 1].end >= PARAGRAPH_GAP) paragraphs.push([]);
    paragraphs[paragraphs.length - 1].push(s.text);
  });
  return paragraphs.map((p) => p.join(" ")).join("\n\n") + "\n";
}

export function exportTranscript(
  format: Format,
  segments: Segment[],
  info: TranscriptInfo | null,
  { timestamps }: { timestamps: boolean },
) {
  // Subtitles need cues that don't overlap and don't vanish instantly.
  const cues = segments.map((s, i) => {
    const next = segments[i + 1]?.start ?? Infinity;
    return { ...s, end: Math.min(Math.max(s.end, s.start + 0.5), next > s.start ? next : Infinity) };
  });
  switch (format) {
    case "txt":
      return toText(segments, timestamps);
    case "srt":
      return cues.map((c, i) => `${i + 1}\n${clock(c.start, ",")} --> ${clock(c.end, ",")}\n${c.text}\n`).join("\n");
    case "vtt":
      return "WEBVTT\n\n" + cues.map((c) => `${clock(c.start, ".")} --> ${clock(c.end, ".")}\n${c.text}\n`).join("\n");
    case "json":
      return JSON.stringify(
        {
          language: info?.language ?? null,
          duration: info?.duration ?? null,
          text: segments.map((s) => s.text).join(" "),
          segments: segments.map(({ start, end, text }) => ({ start, end, text })),
        },
        null,
        2,
      );
  }
}

export const countWords = (segments: Segment[]) =>
  segments.reduce((n, s) => n + (s.text.match(/\S+/g)?.length ?? 0), 0);

/** The segment being heard at `time` (the last one that has started), or -1. */
export function segmentAt(segments: Segment[], time: number) {
  let lo = 0;
  let hi = segments.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segments[mid].start <= time + 0.05) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}
