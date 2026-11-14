import { directTarget, dropDirectTarget, FileToolError, precheck } from "./files";
import { exportTranscript, type Format as TranscriptFormat, type Segment } from "./transcribe";

export const TRANSLATE_CAPABILITIES_ENDPOINT = "/api/tools/translate/capabilities";
export const TRANSLATE_TEXT_ENDPOINT = "/api/tools/translate/text";
export const TRANSLATE_BATCH_ENDPOINT = "/api/tools/translate/batch";
export const TRANSLATE_MEDIA_ENDPOINT = "/api/tools/translate/media";
export const TRANSLATE_RESULT_ENDPOINT = "/api/tools/translate/result";

export const AUDIO_MEDIA_EXTENSIONS = [
  ".mp3", ".wav", ".m4a", ".aac", ".ogg", ".oga", ".opus", ".flac", ".wma", ".amr", ".aiff", ".aif", ".weba",
] as const;

export const VIDEO_MEDIA_EXTENSIONS = [
  ".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi", ".wmv", ".flv", ".3gp", ".mts", ".m2ts",
] as const;

export const ALL_MEDIA_EXTENSIONS = [...AUDIO_MEDIA_EXTENSIONS, ...VIDEO_MEDIA_EXTENSIONS];
export const TEXT_FILE_EXTENSIONS = [".txt", ".md", ".srt", ".vtt"] as const;
export const MAX_MEDIA_MB = 150;
export const MAX_TEXT_CHARS = 25_000;

export type TranslateLanguage = {
  code: string;
  name: string;
  native_name: string;
  rtl: boolean;
  tts_supported: boolean;
  speech_input: boolean;
};

export type TranslateCapabilities = {
  available: boolean;
  speech_available: boolean;
  speech_engine: "local" | "groq" | "none";
  tts_available: boolean;
  languages: TranslateLanguage[];
  extensions: string[];
  max_file_mb: number;
  max_audio_seconds: number;
  max_video_seconds: number;
  max_text_chars: number;
};

export type TextTranslateResult = {
  source_text: string;
  translated_text: string;
  detected_language: string;
  detected_language_name: string;
  target_language: string;
  target_language_name: string;
  provider: string;
  chars: number;
  mode: "text" | "subtitles";
};

export type BatchTranslateResult = {
  source_texts: string[];
  translated_texts: string[];
  detected_language: string;
  detected_language_name: string;
  target_language: string;
  target_language_name: string;
  provider: string;
};

export type MediaSegmentPair = {
  id: number;
  start: number;
  end: number;
  source: string;
  translated: string;
};

export type TranslateStage =
  | "queued"
  | "preparing"
  | "loading"
  | "transcribing"
  | "translating"
  | "synthesizing"
  | "muxing";

export type MediaTranslateDone = {
  type: "done";
  source_text: string;
  translated_text: string;
  detected_language: string;
  detected_language_name: string;
  target_language: string;
  target_language_name: string;
  media_kind: "audio" | "video";
  segments: MediaSegmentPair[];
  result_token: string;
  result_name: string;
  result_type: string;
  result_size: number;
  duration: number;
  provider: string;
  tts_engine: string;
  elapsed: number;
};

export type MediaStreamEvent =
  | { type: "status"; stage: TranslateStage }
  | { type: "info"; language: string; target: string; duration: number; media_kind: "audio" | "video"; speech_engine: string }
  | ({ type: "segment" } & MediaSegmentPair)
  | { type: "progress"; done: number; total: number }
  | { type: "ping" }
  | MediaTranslateDone
  | { type: "error"; detail?: string };

export const COMMON_TARGET_CODES = [
  "en", "hi", "es", "fr", "de", "ar", "bn", "pt", "ru", "ja", "ko", "zh-CN", "it", "ta", "te", "ur",
];

/** Static seed shown before /capabilities resolves or when offline; overwritten by full 105-language backend list. */
export const FALLBACK_LANGUAGES: TranslateLanguage[] = [
  { code: "en", name: "English", native_name: "English", rtl: false, tts_supported: true, speech_input: true },
  { code: "hi", name: "Hindi", native_name: "हिन्दी", rtl: false, tts_supported: true, speech_input: true },
  { code: "es", name: "Spanish", native_name: "Español", rtl: false, tts_supported: true, speech_input: true },
  { code: "fr", name: "French", native_name: "Français", rtl: false, tts_supported: true, speech_input: true },
  { code: "de", name: "German", native_name: "Deutsch", rtl: false, tts_supported: true, speech_input: true },
  { code: "ar", name: "Arabic", native_name: "العربية", rtl: true, tts_supported: true, speech_input: true },
  { code: "bn", name: "Bengali", native_name: "বাংলা", rtl: false, tts_supported: true, speech_input: true },
  { code: "pt", name: "Portuguese", native_name: "Português", rtl: false, tts_supported: true, speech_input: true },
  { code: "ru", name: "Russian", native_name: "Русский", rtl: false, tts_supported: true, speech_input: true },
  { code: "ja", name: "Japanese", native_name: "日本語", rtl: false, tts_supported: true, speech_input: true },
  { code: "ko", name: "Korean", native_name: "한국어", rtl: false, tts_supported: true, speech_input: true },
  { code: "zh-CN", name: "Chinese (Simplified)", native_name: "简体中文", rtl: false, tts_supported: true, speech_input: true },
  { code: "it", name: "Italian", native_name: "Italiano", rtl: false, tts_supported: true, speech_input: true },
  { code: "ta", name: "Tamil", native_name: "தமிழ்", rtl: false, tts_supported: true, speech_input: true },
  { code: "te", name: "Telugu", native_name: "తెలుగు", rtl: false, tts_supported: true, speech_input: true },
  { code: "mr", name: "Marathi", native_name: "मराठी", rtl: false, tts_supported: true, speech_input: true },
  { code: "ur", name: "Urdu", native_name: "اردو", rtl: true, tts_supported: true, speech_input: true },
  { code: "tr", name: "Turkish", native_name: "Türkçe", rtl: false, tts_supported: true, speech_input: true },
  { code: "vi", name: "Vietnamese", native_name: "Tiếng Việt", rtl: false, tts_supported: true, speech_input: true },
  { code: "id", name: "Indonesian", native_name: "Bahasa Indonesia", rtl: false, tts_supported: true, speech_input: true },
];

export const STAGE_LABELS: Record<TranslateStage, string> = {
  queued: "Waiting for an open dubbing slot…",
  preparing: "Extracting audio track…",
  loading: "Warming up speech recognition…",
  transcribing: "Listening and transcribing spoken words…",
  translating: "Translating dialogue into target language…",
  synthesizing: "Generating natural spoken voiceover…",
  muxing: "Combining translated voiceover with media…",
};

async function parseError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { detail?: string };
    if (typeof body?.detail === "string" && body.detail.trim()) return body.detail;
  } catch {
    // non-JSON response
  }
  return fallback;
}

export async function loadCapabilities(signal?: AbortSignal): Promise<TranslateCapabilities> {
  const res = await fetch(TRANSLATE_CAPABILITIES_ENDPOINT, { cache: "no-store", signal });
  if (!res.ok) {
    throw new FileToolError(await parseError(res, "Couldn't reach the translator service."), res.status);
  }
  return (await res.json()) as TranslateCapabilities;
}

export async function translateText(params: {
  text: string;
  source: string;
  target: string;
  mode?: "text" | "subtitles";
  signal?: AbortSignal;
}): Promise<TextTranslateResult> {
  const res = await fetch(TRANSLATE_TEXT_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: params.text,
      source: params.source || "auto",
      target: params.target,
      mode: params.mode ?? "text",
    }),
    signal: params.signal,
  });
  if (!res.ok) {
    throw new FileToolError(await parseError(res, "Translation failed. Try again in a moment."), res.status);
  }
  return (await res.json()) as TextTranslateResult;
}

export async function translateBatch(params: {
  texts: string[];
  source: string;
  target: string;
  signal?: AbortSignal;
}): Promise<BatchTranslateResult> {
  const MAX_CHUNK = 400;
  if (params.texts.length <= MAX_CHUNK) {
    const res = await fetch(TRANSLATE_BATCH_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        texts: params.texts,
        source: params.source || "auto",
        target: params.target,
      }),
      signal: params.signal,
    });
    if (!res.ok) {
      throw new FileToolError(await parseError(res, "Could not translate lines. Please try again."), res.status);
    }
    return (await res.json()) as BatchTranslateResult;
  }

  const out: string[] = [];
  let lastMeta: BatchTranslateResult | null = null;
  const effectiveSource = params.source || "auto";
  for (let i = 0; i < params.texts.length; i += MAX_CHUNK) {
    const slice = params.texts.slice(i, i + MAX_CHUNK);
    const res = await fetch(TRANSLATE_BATCH_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        texts: slice,
        source: lastMeta ? lastMeta.detected_language : effectiveSource,
        target: params.target,
      }),
      signal: params.signal,
    });
    if (!res.ok) {
      throw new FileToolError(await parseError(res, "Could not translate lines. Please try again."), res.status);
    }
    lastMeta = (await res.json()) as BatchTranslateResult;
    out.push(...lastMeta.translated_texts);
  }
  return {
    source_texts: params.texts,
    translated_texts: out,
    detected_language: lastMeta?.detected_language ?? effectiveSource,
    detected_language_name: lastMeta?.detected_language_name ?? effectiveSource,
    target_language: lastMeta?.target_language ?? params.target,
    target_language_name: lastMeta?.target_language_name ?? params.target,
    provider: lastMeta?.provider ?? "unknown",
  };
}

export type StreamMediaOptions = {
  signal?: AbortSignal;
  onUpload?: (progress: number) => void;
  onEvent: (event: MediaStreamEvent) => void;
};

function parseXhrError(raw: string, status: number): string {
  try {
    const parsed = JSON.parse(raw) as { detail?: string };
    if (typeof parsed?.detail === "string" && parsed.detail.trim()) return parsed.detail;
  } catch {
    // ignore
  }
  if (status === 413) return `That file is larger than the ${MAX_MEDIA_MB} MB limit.`;
  if (status === 415) return "That file format does not look like a supported audio or video file.";
  return "We couldn't translate that media file.";
}

function sendMediaXhr(
  url: string,
  form: FormData,
  options: StreamMediaOptions,
  ticket?: string,
): Promise<MediaTranslateDone> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let seen = 0;
    let tail = "";
    let done: MediaTranslateDone | null = null;
    let settled = false;

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener("abort", cancel);
      reject(err);
    };

    const cancel = () => {
      xhr.abort();
      fail(new DOMException("Cancelled", "AbortError"));
    };

    if (options.signal?.aborted) {
      fail(new DOMException("Cancelled", "AbortError"));
      return;
    }
    options.signal?.addEventListener("abort", cancel, { once: true });

    const consumeLines = (flush: boolean) => {
      const text = xhr.responseText ?? "";
      if (text.length > seen) {
        tail += text.slice(seen);
        seen = text.length;
      }
      const lines = tail.split("\n");
      tail = flush ? "" : (lines.pop() ?? "");
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;
        try {
          const ev = JSON.parse(line) as MediaStreamEvent;
          if (ev.type === "done") done = ev;
          options.onEvent(ev);
        } catch {
          // ignore malformed line fragments
        }
      }
    };

    xhr.open("POST", url);
    if (ticket) xhr.setRequestHeader("X-Upload-Ticket", ticket);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) {
        options.onUpload?.(Math.min(1, e.loaded / e.total));
      }
    };

    xhr.onreadystatechange = () => {
      if (xhr.readyState >= 3 && xhr.status === 200) {
        consumeLines(false);
      }
    };

    xhr.onload = () => {
      if (xhr.status !== 200) {
        fail(new FileToolError(parseXhrError(xhr.responseText || "", xhr.status), xhr.status));
        return;
      }
      consumeLines(true);
      if (settled) return;
      options.signal?.removeEventListener("abort", cancel);
      if (!done) {
        reject(new FileToolError("The translation ended before a result was returned. Try a shorter clip."));
        return;
      }
      settled = true;
      resolve(done);
    };

    xhr.onerror = () => fail(new FileToolError("Lost connection while uploading or streaming translation."));
    xhr.onabort = () => fail(new DOMException("Cancelled", "AbortError"));
    xhr.send(form);
  });
}

export async function translateMedia(form: FormData, options: StreamMediaOptions): Promise<MediaTranslateDone> {
  await precheck(form);
  const direct = await directTarget(TRANSLATE_MEDIA_ENDPOINT, options.signal);
  try {
    return await sendMediaXhr(direct?.url ?? TRANSLATE_MEDIA_ENDPOINT, form, options, direct?.ticket);
  } catch (e) {
    if (!direct || !(e instanceof FileToolError) || e.status !== 401) throw e;
    dropDirectTarget(TRANSLATE_MEDIA_ENDPOINT);
    const refreshed = await directTarget(TRANSLATE_MEDIA_ENDPOINT, options.signal);
    return await sendMediaXhr(refreshed?.url ?? TRANSLATE_MEDIA_ENDPOINT, form, options, refreshed?.ticket);
  }
}

export type DownloadedMediaResult = {
  blob: Blob;
  url: string;
  name: string;
  type: string;
  size: number;
};

export async function fetchTranslatedResult(
  token: string,
  fallbackName: string,
  fallbackType: string,
  signal?: AbortSignal,
): Promise<DownloadedMediaResult> {
  let upstream: Response | null = null;
  try {
    const ticketRes = await fetch(
      `${TRANSLATE_RESULT_ENDPOINT}?token=${encodeURIComponent(token)}&direct=1`,
      { cache: "no-store", signal },
    );
    if (ticketRes.ok) {
      const info = (await ticketRes.json()) as { direct?: boolean; url?: string; ticket?: string };
      if (info.direct && info.url && info.ticket) {
        upstream = await fetch(info.url, {
          headers: { "X-Upload-Ticket": info.ticket },
          cache: "no-store",
          signal,
        });
      }
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    // fallback to Next.js proxy route below
  }

  if (!upstream) {
    upstream = await fetch(`${TRANSLATE_RESULT_ENDPOINT}?token=${encodeURIComponent(token)}`, {
      cache: "no-store",
      signal,
    });
  }

  if (!upstream.ok) {
    throw new FileToolError(
      await parseError(upstream, "Translated file expired. Run translation again to create a new file."),
      upstream.status,
    );
  }

  const blob = await upstream.blob();
  const type = upstream.headers.get("content-type") || blob.type || fallbackType || "application/octet-stream";
  return {
    blob,
    url: URL.createObjectURL(blob),
    name: fallbackName,
    type,
    size: blob.size,
  };
}

export function detectMediaKind(file: File): "audio" | "video" {
  const lower = file.name.toLowerCase();
  const dot = lower.lastIndexOf(".");
  const ext = dot >= 0 ? lower.slice(dot) : "";
  if ((VIDEO_MEDIA_EXTENSIONS as readonly string[]).includes(ext)) return "video";
  if ((AUDIO_MEDIA_EXTENSIONS as readonly string[]).includes(ext)) return "audio";
  if (file.type.startsWith("video/")) return "video";
  return "audio";
}

export function looksLikeSubtitleText(text: string): boolean {
  const sample = text.slice(0, 1500);
  return /^\s*WEBVTT\b/m.test(sample) || /\d{2}:\d{2}(?::\d{2})?[.,]\d{3}\s+-->\s+\d{2}:\d{2}/.test(sample);
}

export function toSideSegments(segments: MediaSegmentPair[], side: "source" | "translated"): Segment[] {
  return segments.map((s) => ({
    id: s.id,
    start: s.start,
    end: s.end,
    text: side === "source" ? s.source : s.translated,
  }));
}

export function buildVttUrl(segments: MediaSegmentPair[], side: "source" | "translated"): string | null {
  if (!segments.length) return null;
  const sideSegments = toSideSegments(segments, side);
  const vtt = exportTranscript("vtt", sideSegments, null, { timestamps: true });
  return URL.createObjectURL(new Blob([vtt], { type: "text/vtt;charset=utf-8" }));
}

export function exportSideTranscript(
  format: TranscriptFormat,
  segments: MediaSegmentPair[],
  side: "source" | "translated",
  timestamps = true,
): string {
  return exportTranscript(format, toSideSegments(segments, side), null, { timestamps });
}

export function languageLabel(code: string, list: TranslateLanguage[]): string {
  if (code === "auto") return "Auto-detect";
  const match = list.find((l) => l.code.toLowerCase() === code.toLowerCase());
  return match ? match.name : code.toUpperCase();
}

export function isRtlLanguage(code: string, list: TranslateLanguage[]): boolean {
  return Boolean(list.find((l) => l.code.toLowerCase() === code.toLowerCase())?.rtl);
}

export function canSpeakInBrowser(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function stopBrowserSpeech(): void {
  if (canSpeakInBrowser()) {
    window.speechSynthesis.cancel();
  }
}

export function speakBrowserText(text: string, langCode: string, onDone?: () => void): boolean {
  if (!canSpeakInBrowser() || !text.trim()) return false;
  window.speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text.slice(0, 4000));
  utt.lang = langCode;
  if (onDone) {
    utt.onend = onDone;
    utt.onerror = onDone;
  }
  window.speechSynthesis.speak(utt);
  return true;
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}
