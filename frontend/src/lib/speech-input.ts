/**
 * Speech input for the translator's dictation and the interpreter.
 *
 * 1. The browser's own recogniser (Chrome, Edge, Safari, Samsung Internet…): live words while you
 *    speak, nothing uploaded by us.
 * 2. Anywhere else (Firefox, some in-app browsers): the microphone is recorded until you pause,
 *    then sent to our Whisper endpoint (/api/tools/transcribe/run).
 */
import { streamTranscription } from "./transcribe";
import { recognitionLocale } from "./translate-extras";

type RecognitionResultList = { length: number; [i: number]: { isFinal: boolean; 0: { transcript: string; confidence: number } } };
type RecognitionEvent = { resultIndex: number; results: RecognitionResultList };
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
};

function recognitionCtor(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function browserRecognitionSupported(): boolean {
  return recognitionCtor() !== null;
}

export function microphoneSupported(): boolean {
  return typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== "undefined";
}

export type ListenHandlers = {
  lang: string;
  /** Keep listening across pauses (lecture / live captions). */
  continuous?: boolean;
  onInterim?: (text: string) => void;
  onFinal: (text: string, confidence: number) => void;
  onEnd?: () => void;
  onError?: (message: string) => void;
};

export type ListenSession = { stop: () => void; abort: () => void };

const ERRORS: Record<string, string> = {
  "not-allowed": "Microphone permission was blocked. Allow it in the address bar and try again.",
  "service-not-allowed": "Speech recognition is turned off in this browser.",
  "no-speech": "",
  aborted: "",
  "audio-capture": "No microphone was found.",
  network: "The browser's speech service couldn't be reached. Check your connection.",
  "language-not-supported": "This browser can't recognise that language. Try typing instead, or another browser.",
};

/** Live recognition with the browser's engine. Restarts itself in continuous mode (Chrome stops after ~60 s). */
export function listenBrowser(h: ListenHandlers): ListenSession {
  const Ctor = recognitionCtor();
  if (!Ctor) throw new Error("This browser has no built-in speech recognition.");
  let stopped = false;
  let rec: Recognition | null = null;
  const begin = () => {
    rec = new Ctor();
    rec.lang = recognitionLocale(h.lang);
    rec.continuous = Boolean(h.continuous);
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const text = r[0].transcript;
        if (r.isFinal) {
          if (text.trim()) h.onFinal(text.trim(), r[0].confidence || 0.8);
        } else interim += text;
      }
      h.onInterim?.(interim.trim());
    };
    rec.onerror = (e) => {
      const msg = ERRORS[e.error] ?? `Speech recognition error: ${e.error}`;
      if (msg) h.onError?.(msg);
      if (e.error === "not-allowed" || e.error === "service-not-allowed" || e.error === "audio-capture" || e.error === "language-not-supported") {
        stopped = true;
      }
    };
    rec.onend = () => {
      if (!stopped && h.continuous) {
        try {
          begin();
          return;
        } catch {
          // fall through to end
        }
      }
      h.onInterim?.("");
      h.onEnd?.();
    };
    rec.start();
  };
  begin();
  return {
    stop: () => {
      stopped = true;
      rec?.stop();
    },
    abort: () => {
      stopped = true;
      rec?.abort();
    },
  };
}

export type RecordHandlers = {
  /** 0–1 microphone level, for a meter. */
  onLevel?: (level: number) => void;
  /** Stop on its own after this much silence once speech was heard (ms). */
  silenceMs?: number;
  maxSeconds?: number;
  signal?: AbortSignal;
};

/** Records one utterance; resolves with the audio when you stop, or after a pause. */
export async function recordUtterance(h: RecordHandlers & { stopRef?: { stop?: () => void } }): Promise<Blob> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((t) => MediaRecorder.isTypeSupported?.(t)) ?? "";
  const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  const chunks: BlobPart[] = [];
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AC();
  const src = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  src.connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  let heard = false;
  let lastLoud = performance.now();
  const started = performance.now();
  let raf = 0;

  return new Promise<Blob>((resolve, reject) => {
    const cleanup = () => {
      cancelAnimationFrame(raf);
      stream.getTracks().forEach((t) => t.stop());
      ctx.close().catch(() => {});
    };
    const stop = () => {
      if (recorder.state !== "inactive") recorder.stop();
    };
    if (h.stopRef) h.stopRef.stop = stop;
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = () => {
      cleanup();
      if (h.signal?.aborted) reject(new DOMException("Cancelled", "AbortError"));
      else resolve(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }));
    };
    recorder.onerror = () => {
      cleanup();
      reject(new Error("Recording failed."));
    };
    h.signal?.addEventListener("abort", stop, { once: true });
    const tick = () => {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      const rms = Math.sqrt(sum / buf.length);
      const level = Math.min(1, rms * 6);
      h.onLevel?.(level);
      const now = performance.now();
      if (level > 0.08) {
        heard = true;
        lastLoud = now;
      }
      const silence = h.silenceMs ?? 1400;
      if ((heard && now - lastLoud > silence) || now - started > (h.maxSeconds ?? 45) * 1000) {
        stop();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    recorder.start(250);
    raf = requestAnimationFrame(tick);
  });
}

/** Sends a short recording to the server's speech-to-text and returns the text and language. */
export async function transcribeClip(blob: Blob, lang: string, signal?: AbortSignal): Promise<{ text: string; language: string }> {
  const ext = blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm";
  const form = new FormData();
  form.append("file", new File([blob], `speech.${ext}`, { type: blob.type || "audio/webm" }));
  form.append("language", lang && lang !== "auto" ? lang.split("-")[0] : "auto");
  const parts: string[] = [];
  let language = lang;
  await streamTranscription(form, {
    signal,
    onEvent: (ev) => {
      if (ev.type === "segment") parts.push(ev.text.trim());
      if (ev.type === "info" && "language" in ev && typeof ev.language === "string") language = ev.language;
    },
  });
  return { text: parts.join(" ").replace(/\s+/g, " ").trim(), language };
}
