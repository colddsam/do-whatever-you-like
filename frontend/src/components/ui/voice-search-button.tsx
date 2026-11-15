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
  onaudiostart: (() => void) | null;
  onsoundstart: (() => void) | null;
  onspeechstart: (() => void) | null;
  onspeechend: (() => void) | null;
  onsoundend: (() => void) | null;
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

/** Merge Web Speech results while deduplicating cumulative transcripts emitted by Android Chrome. */
function mergeSpeechSegments(segments: string[]): string {
  let merged = "";
  for (const raw of segments) {
    const piece = raw.replace(/\s+/g, " ").trim();
    if (!piece) continue;
    if (!merged) {
      merged = piece;
      continue;
    }
    const lowMerged = merged.toLowerCase();
    const lowPiece = piece.toLowerCase();
    if (lowPiece.startsWith(lowMerged)) {
      merged = piece;
    } else if (!lowMerged.endsWith(lowPiece)) {
      merged = `${merged} ${piece}`;
    }
  }
  return cleanVoiceQuery(merged);
}

export type VoiceSearchHandle = {
  start: () => void;
  stop: () => void;
  toggle: () => void;
};

export type VoiceRecognitionController = {
  speechSupported: boolean;
  listening: boolean;
  levels: number[];
  notice: string | null;
  clearNotice: () => void;
  start: () => void;
  stop: () => void;
  toggle: () => void;
};

export type UseVoiceRecognitionOptions = {
  onTranscript: (text: string, isFinal: boolean) => void;
  onListeningChange?: (listening: boolean) => void;
};

const BAR_PHASES = [0.2, 1.3, 2.1, 0.8, 1.7] as const;
const IDLE_LEVELS = [0.28, 0.52, 0.78, 0.48, 0.3];

export function useVoiceRecognition({
  onTranscript,
  onListeningChange,
}: UseVoiceRecognitionOptions): VoiceRecognitionController {
  const speechSupported = useSyncExternalStore(
    noopSubscribe,
    () => Boolean(getSpeechRecognitionCtor()),
    () => true,
  );

  const [listening, setListening] = useState(false);
  const [levels, setLevels] = useState<number[]>(IDLE_LEVELS);
  const [notice, setNotice] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const rafRef = useRef<number | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopSafetyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speechEnergyRef = useRef(0.35);
  const lastTranscriptRef = useRef("");
  const hadErrorRef = useRef(false);
  const explicitStopRef = useRef(false);
  const onTranscriptRef = useRef(onTranscript);
  const onListeningChangeRef = useRef(onListeningChange);

  useEffect(() => {
    onTranscriptRef.current = onTranscript;
    onListeningChangeRef.current = onListeningChange;
  }, [onTranscript, onListeningChange]);

  const clearNotice = useCallback(() => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    setNotice(null);
  }, []);

  const showNotice = useCallback((msg: string) => {
    setNotice(msg);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setNotice(null), 4500);
  }, []);

  const stopWaveform = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    speechEnergyRef.current = 0.35;
    setLevels(IDLE_LEVELS);
  }, []);

  /**
   * Animate the 5-bar waveform from Web Speech sound/speech/result events instead of opening a
   * concurrent getUserMedia() stream. Calling getUserMedia() during SpeechRecognition steals the
   * single hardware audio capture session on Android Chrome & iOS Safari, silencing dictation.
   */
  const startWaveform = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    const startTime = performance.now();
    const tick = (now: number) => {
      const t = (now - startTime) / 1000;
      speechEnergyRef.current = Math.max(0.32, speechEnergyRef.current * 0.94);
      const energy = speechEnergyRef.current;
      const next = BAR_PHASES.map((phase, idx) => {
        const wave = 0.22 + (0.35 + energy * 0.45) * Math.abs(Math.sin(t * (4.6 + idx * 0.6) + phase));
        return Math.min(1, wave);
      });
      setLevels(next);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const stop = useCallback(() => {
    explicitStopRef.current = true;
    const active = recognitionRef.current;
    stopWaveform();
    setListening(false);
    onListeningChangeRef.current?.(false);
    if (!active) return;
    try {
      active.stop();
    } catch {
      try {
        active.abort();
      } catch {
        // Ignore if already ended.
      }
    }
    if (stopSafetyTimerRef.current) clearTimeout(stopSafetyTimerRef.current);
    stopSafetyTimerRef.current = setTimeout(() => {
      if (recognitionRef.current === active) recognitionRef.current = null;
    }, 500);
  }, [stopWaveform]);

  const start = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      showNotice("Voice search works in Chrome on Android, Safari on iOS, or desktop Chrome/Edge.");
      return;
    }

    if (recognitionRef.current) {
      stop();
      return;
    }

    clearNotice();
    lastTranscriptRef.current = "";
    hadErrorRef.current = false;
    explicitStopRef.current = false;
    speechEnergyRef.current = 0.55;

    const rec = new Ctor();
    rec.lang = (typeof navigator !== "undefined" && (navigator.languages?.[0] || navigator.language)) || "en-US";
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onstart = () => {
      if (recognitionRef.current !== rec) return;
      setListening(true);
      onListeningChangeRef.current?.(true);
      startWaveform();
    };

    rec.onaudiostart = () => {
      speechEnergyRef.current = Math.max(speechEnergyRef.current, 0.5);
    };

    rec.onsoundstart = () => {
      speechEnergyRef.current = Math.max(speechEnergyRef.current, 0.72);
    };

    rec.onspeechstart = () => {
      speechEnergyRef.current = 0.95;
    };

    rec.onspeechend = () => {
      speechEnergyRef.current = Math.min(speechEnergyRef.current, 0.5);
    };

    rec.onresult = (event) => {
      const segments: string[] = [];
      for (let i = 0; i < event.results.length; i++) {
        const res = event.results[i];
        const part = res[0]?.transcript ?? "";
        if (part) segments.push(part);
      }
      const combined = mergeSpeechSegments(segments);
      const hasFinal = event.results.length > 0 && Boolean(event.results[event.results.length - 1]?.isFinal);
      speechEnergyRef.current = 1.0;
      if (combined) {
        lastTranscriptRef.current = combined;
        onTranscriptRef.current(combined, hasFinal);
      }
    };

    rec.onerror = (event) => {
      hadErrorRef.current = true;
      if (event.error === "aborted") return;
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        showNotice("Microphone blocked. Allow mic permission in your browser bar to use voice search.");
      } else if (event.error === "no-speech") {
        showNotice("No speech detected — tap the mic and speak clearly.");
      } else if (event.error === "audio-capture") {
        showNotice("No microphone found on this device.");
      } else if (event.error === "network") {
        showNotice("Speech service unreachable — check your connection.");
      } else {
        showNotice(`Voice search stopped (${event.error}).`);
      }
    };

    rec.onend = () => {
      if (stopSafetyTimerRef.current) clearTimeout(stopSafetyTimerRef.current);
      if (recognitionRef.current === rec) {
        recognitionRef.current = null;
      }
      stopWaveform();
      setListening(false);
      onListeningChangeRef.current?.(false);
      if (!explicitStopRef.current && !hadErrorRef.current && !lastTranscriptRef.current) {
        showNotice("Didn’t catch any words — tap the mic and speak clearly.");
      }
    };

    recognitionRef.current = rec;
    try {
      rec.start();
    } catch {
      recognitionRef.current = null;
      stopWaveform();
      setListening(false);
      onListeningChangeRef.current?.(false);
      showNotice("Could not start microphone. Try tapping again.");
    }
  }, [clearNotice, showNotice, startWaveform, stop, stopWaveform]);

  const toggle = useCallback(() => {
    if (listening || recognitionRef.current) stop();
    else start();
  }, [listening, start, stop]);

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
      if (stopSafetyTimerRef.current) clearTimeout(stopSafetyTimerRef.current);
      try {
        recognitionRef.current?.abort();
      } catch {
        // Ignore on unmount.
      }
      recognitionRef.current = null;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return { speechSupported, listening, levels, notice, clearNotice, start, stop, toggle };
}

export type VoiceSearchButtonProps = {
  onTranscript?: (text: string, isFinal: boolean) => void;
  onListeningChange?: (listening: boolean) => void;
  /** Optional external controller so other triggers can start recognition synchronously on tap. */
  controller?: VoiceRecognitionController;
  size?: "sm" | "md";
  /** Compact variant shows icon + waveform inside a tight capsule. */
  compact?: boolean;
  autoStart?: boolean;
  noticePlacement?: "bottom" | "top";
  className?: string;
};

const noopTranscript = () => {};

export const VoiceSearchButton = forwardRef<VoiceSearchHandle, VoiceSearchButtonProps>(function VoiceSearchButton(
  {
    onTranscript,
    onListeningChange,
    controller: externalController,
    size = "md",
    compact = false,
    autoStart = false,
    noticePlacement = "bottom",
    className,
  },
  ref,
) {
  const reduceMotion = useReducedMotion();
  const internalController = useVoiceRecognition({
    onTranscript: onTranscript ?? noopTranscript,
    onListeningChange,
  });
  const active = externalController ?? internalController;
  const { speechSupported, listening, levels, notice, clearNotice, start, stop, toggle } = active;
  const autoStartedRef = useRef(false);

  useImperativeHandle(ref, () => ({ start, stop, toggle }), [start, stop, toggle]);

  useEffect(() => {
    if (autoStart && !externalController && !autoStartedRef.current) {
      autoStartedRef.current = true;
      const id = requestAnimationFrame(() => start());
      return () => cancelAnimationFrame(id);
    }
    return undefined;
  }, [autoStart, externalController, start]);

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
            ? cn("border-accent bg-accent/10 text-accent shadow-sm", compact ? "gap-1.5 px-2.5" : "gap-1.5 px-2.5 sm:gap-2 sm:px-3")
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
              {!compact && <span className="hidden font-mono text-[11px] font-medium tracking-tight text-accent sm:inline">Listening</span>}
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

      {/* Inline status / error popover constrained cleanly to viewport width */}
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
              clearNotice();
            }}
            className={cn(
              "absolute right-0 z-50 w-64 max-w-[calc(100vw-2.5rem)] rounded-md border border-line bg-surface px-3 py-2 text-xs leading-snug text-ink-2 shadow-float",
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
