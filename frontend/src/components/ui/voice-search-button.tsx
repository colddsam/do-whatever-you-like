"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState, useSyncExternalStore, forwardRef } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Mic, MicOff, Square } from "lucide-react";
import { cn } from "@/lib/utils";

const EASE = [0.22, 1, 0.36, 1] as const;
const SPRING = { type: "spring", stiffness: 480, damping: 32, mass: 0.65 } as const;
const noopSubscribe = () => () => {};

type SpeechRecognitionAlternativeLike = {
  transcript: string;
  confidence: number;
};

type SpeechRecognitionResultLike = {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
};

type SpeechRecognitionErrorEventLike = {
  error: string;
  message?: string;
};

type SpeechRecognitionInstance = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

function getSpeechRecognitionCtor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Strip trailing dictation punctuation ("compress pdf." -> "compress pdf") so tool queries match cleanly. */
function cleanVoiceQuery(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().replace(/[.。!?]+$/g, "").trim();
}

export type VoiceSearchHandle = {
  start: () => void;
  stop: () => void;
  toggle: () => void;
};

export type VoiceSearchButtonProps = {
  onTranscript: (text: string, isFinal: boolean) => void;
  onListeningChange?: (listening: boolean) => void;
  size?: "sm" | "md";
  /** Compact variant shows icon + waveform inside a tight capsule. */
  compact?: boolean;
  autoStart?: boolean;
  noticePlacement?: "bottom" | "top";
  className?: string;
};

const BAR_PHASES = [0.2, 1.3, 2.1, 0.8, 1.7] as const;

export const VoiceSearchButton = forwardRef<VoiceSearchHandle, VoiceSearchButtonProps>(function VoiceSearchButton(
  { onTranscript, onListeningChange, size = "md", compact = false, autoStart = false, noticePlacement = "bottom", className },
  ref,
) {
  const reduceMotion = useReducedMotion();
  const speechSupported = useSyncExternalStore(
    noopSubscribe,
    () => Boolean(getSpeechRecognitionCtor()),
    () => true,
  );

  const [listening, setListening] = useState(false);
  const [levels, setLevels] = useState<number[]>([0.28, 0.52, 0.78, 0.48, 0.3]);
  const [notice, setNotice] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finalBufferRef = useRef("");
  const onTranscriptRef = useRef(onTranscript);
  const onListeningChangeRef = useRef(onListeningChange);
  const autoStartedRef = useRef(false);

  useEffect(() => {
    onTranscriptRef.current = onTranscript;
    onListeningChangeRef.current = onListeningChange;
  }, [onTranscript, onListeningChange]);

  const showNotice = useCallback((msg: string) => {
    setNotice(msg);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setNotice(null), 4200);
  }, []);

  const cleanupAudio = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
      streamRef.current = null;
    }
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    try {
      recognitionRef.current?.stop();
    } catch {
      try {
        recognitionRef.current?.abort();
      } catch {
        // Ignore if already stopped.
      }
    }
    recognitionRef.current = null;
    cleanupAudio();
    setListening(false);
    onListeningChangeRef.current?.(false);
  }, [cleanupAudio]);

  const startWaveform = useCallback(async () => {
    // Drive the 5-bar waveform from real mic FFT energy when allowed, with sinusoidal fallback.
    let analyser: AnalyserNode | null = null;
    let freqBins: Uint8Array<ArrayBuffer> | null = null;
    try {
      if (navigator.mediaDevices?.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (AudioCtx) {
          const ctx = new AudioCtx();
          audioCtxRef.current = ctx;
          const source = ctx.createMediaStreamSource(stream);
          analyser = ctx.createAnalyser();
          analyser.fftSize = 32;
          analyser.smoothingTimeConstant = 0.72;
          source.connect(analyser);
          freqBins = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
        }
      }
    } catch {
      // Some environments share/lock mic during SpeechRecognition; sinusoidal fallback still animates cleanly.
    }

    const startTime = performance.now();
    const tick = (now: number) => {
      if (!recognitionRef.current) return;
      const t = (now - startTime) / 1000;
      if (analyser && freqBins) {
        analyser.getByteFrequencyData(freqBins);
        const next = BAR_PHASES.map((phase, idx) => {
          const raw = (freqBins![idx + 1] ?? 0) / 255;
          const base = 0.22 + 0.16 * Math.abs(Math.sin(t * 5.2 + phase));
          return Math.min(1, Math.max(base, raw * 1.15));
        });
        setLevels(next);
      } else {
        const next = BAR_PHASES.map((phase, idx) => {
          const wave = 0.35 + 0.55 * Math.abs(Math.sin(t * (4.4 + idx * 0.55) + phase));
          return Math.min(1, wave);
        });
        setLevels(next);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const start = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      showNotice("Voice search requires a Web Speech browser (Chrome, Edge, or Safari).");
      return;
    }

    if (recognitionRef.current) {
      stop();
      return;
    }

    setNotice(null);
    finalBufferRef.current = "";

    const rec = new Ctor();
    rec.lang = typeof navigator !== "undefined" ? navigator.language || "en-US" : "en-US";
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onstart = () => {
      setListening(true);
      onListeningChangeRef.current?.(true);
      void startWaveform();
    };

    rec.onresult = (event) => {
      let interim = "";
      let committed = "";
      for (let i = 0; i < event.results.length; i++) {
        const res = event.results[i];
        const part = res[0]?.transcript ?? "";
        if (res.isFinal) committed += `${part} `;
        else interim += `${part} `;
      }
      finalBufferRef.current = committed;
      const combined = cleanVoiceQuery(`${committed} ${interim}`);
      const hasFinal = event.results.length > 0 && event.results[event.results.length - 1]?.isFinal;
      if (combined) {
        onTranscriptRef.current(combined, Boolean(hasFinal));
      }
    };

    rec.onerror = (event) => {
      if (event.error === "aborted") return;
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        showNotice("Microphone blocked. Allow mic permission in your browser bar to use voice search.");
      } else if (event.error === "no-speech") {
        showNotice("No speech detected — tap the mic and try again.");
      } else if (event.error === "audio-capture") {
        showNotice("No microphone found on this device.");
      } else if (event.error === "network") {
        showNotice("Speech service unreachable — check your connection.");
      } else {
        showNotice(`Voice search stopped (${event.error}).`);
      }
    };

    rec.onend = () => {
      recognitionRef.current = null;
      cleanupAudio();
      setListening(false);
      onListeningChangeRef.current?.(false);
    };

    recognitionRef.current = rec;
    try {
      rec.start();
    } catch {
      recognitionRef.current = null;
      cleanupAudio();
      setListening(false);
      showNotice("Could not start microphone. Try tapping again.");
    }
  }, [cleanupAudio, showNotice, startWaveform, stop]);

  const toggle = useCallback(() => {
    if (listening) stop();
    else start();
  }, [listening, start, stop]);

  useImperativeHandle(ref, () => ({ start, stop, toggle }), [start, stop, toggle]);

  useEffect(() => {
    if (autoStart && !autoStartedRef.current) {
      autoStartedRef.current = true;
      const id = requestAnimationFrame(() => start());
      return () => cancelAnimationFrame(id);
    }
    return undefined;
  }, [autoStart, start]);

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
      try {
        recognitionRef.current?.abort();
      } catch {
        // Ignore on unmount.
      }
      recognitionRef.current = null;
      cleanupAudio();
    };
  }, [cleanupAudio]);

  return (
    <div className={cn("relative inline-flex shrink-0 items-center", className)}>
      <motion.button
        type="button"
        layout={!reduceMotion}
        transition={SPRING}
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          toggle();
        }}
        aria-label={
          listening
            ? "Stop voice search"
            : speechSupported
              ? "Search by voice"
              : "Voice search (browser unsupported)"
        }
        aria-pressed={listening}
        title={listening ? "Stop voice search" : "Search with your voice"}
        className={cn(
          "relative inline-flex items-center justify-center overflow-visible rounded-full border transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/25",
          size === "sm" ? "h-7" : "h-8",
          listening
            ? cn("border-accent bg-accent/10 text-accent shadow-sm", compact ? "gap-1.5 px-2.5" : "gap-2 px-3")
            : cn(
                "border-line bg-paper text-ink-2 hover:border-ink-3 hover:bg-paper-2 hover:text-ink",
                size === "sm" ? "w-7" : "w-8",
              ),
        )}
      >
        {/* Concentric spring pulse rings while listening */}
        <AnimatePresence>
          {listening && !reduceMotion && (
            <>
              <motion.span
                key="pulse-ring-1"
                aria-hidden
                initial={{ opacity: 0.6, scale: 0.9 }}
                animate={{ opacity: [0.55, 0], scale: [1, 1.48] }}
                exit={{ opacity: 0 }}
                transition={{ duration: 1.5, repeat: Infinity, ease: "easeOut" }}
                className="pointer-events-none absolute inset-0 rounded-full border border-accent/45"
              />
              <motion.span
                key="pulse-ring-2"
                aria-hidden
                initial={{ opacity: 0.45, scale: 0.9 }}
                animate={{ opacity: [0.45, 0], scale: [1, 1.75] }}
                exit={{ opacity: 0 }}
                transition={{ duration: 1.5, repeat: Infinity, ease: "easeOut", delay: 0.55 }}
                className="pointer-events-none absolute inset-0 rounded-full border border-accent/30"
              />
            </>
          )}
        </AnimatePresence>

        <AnimatePresence mode="popLayout" initial={false}>
          {listening ? (
            <motion.span
              key="listening-ui"
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.85 }}
              transition={{ duration: 0.16, ease: EASE }}
              className="relative z-10 inline-flex items-center gap-1.5"
            >
              {/* Live 5-bar frequency equalizer */}
              <span aria-hidden className="inline-flex h-3.5 items-center gap-[2px]">
                {levels.map((lvl, idx) => (
                  <motion.span
                    key={idx}
                    animate={{ height: `${Math.round(lvl * 12 + 3)}px` }}
                    transition={{ duration: 0.08, ease: "linear" }}
                    className="w-[2px] rounded-full bg-accent"
                  />
                ))}
              </span>
              {!compact && <span className="font-mono text-[11px] font-medium tracking-tight text-accent">Listening</span>}
              <Square aria-hidden className="size-2.5 fill-accent text-accent" />
            </motion.span>
          ) : (
            <motion.span
              key="idle-mic"
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.85 }}
              transition={{ duration: 0.16, ease: EASE }}
              className="relative z-10 inline-flex items-center justify-center"
            >
              {speechSupported ? (
                <Mic aria-hidden className={size === "sm" ? "size-3.5" : "size-4"} />
              ) : (
                <MicOff aria-hidden className={cn("opacity-60", size === "sm" ? "size-3.5" : "size-4")} />
              )}
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>

      {/* Inline status / error popover */}
      <AnimatePresence>
        {notice && (
          <motion.div
            role="status"
            aria-live="polite"
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 4, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 4, scale: 0.96 }}
            transition={{ duration: 0.18, ease: EASE }}
            onClick={(e) => {
              e.stopPropagation();
              setNotice(null);
            }}
            className={cn(
              "absolute right-0 z-50 w-64 rounded-md border border-line bg-surface px-3 py-2 text-xs leading-snug text-ink-2 shadow-float",
              noticePlacement === "top" ? "bottom-[calc(100%+8px)]" : "top-[calc(100%+8px)]",
            )}
          >
            {notice}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});
