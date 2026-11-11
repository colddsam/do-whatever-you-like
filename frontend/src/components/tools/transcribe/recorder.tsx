"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Mic, Square, X } from "lucide-react";
import { stamp } from "@/lib/transcribe";
import { cn } from "@/lib/utils";

const BARS = 40;
/** Long enough for a lecture or a meeting; past this the recording stops by itself. */
const MAX_SECONDS = 2 * 60 * 60;
const EASE = [0.22, 1, 0.36, 1] as const;
/** Wall-clock time, read only from event handlers and timers. */
const now = () => Date.now();

/** What this browser can record, best first. Safari only does MP4/AAC. */
function pickFormat(): { mime: string; ext: string } {
  const options = [
    { mime: "audio/webm;codecs=opus", ext: ".webm" },
    { mime: "audio/webm", ext: ".webm" },
    { mime: "audio/ogg;codecs=opus", ext: ".ogg" },
    { mime: "audio/mp4", ext: ".m4a" },
  ];
  if (typeof MediaRecorder === "undefined") return { mime: "", ext: ".webm" };
  return options.find((o) => MediaRecorder.isTypeSupported(o.mime)) ?? { mime: "", ext: ".webm" };
}

type Phase = "idle" | "asking" | "recording";

/**
 * Record straight from the microphone. The button turns into a live strip: a signal dot (live),
 * the time, the voice's level as ink bars, then Stop to use it or X to throw it away.
 */
export function Recorder({ onRecorded, disabled }: { onRecorded: (file: File) => void; disabled?: boolean }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [levels, setLevels] = useState<number[]>(() => Array(BARS).fill(0));
  const [problem, setProblem] = useState<string | null>(null);
  const session = useRef<{
    recorder: MediaRecorder;
    stream: MediaStream;
    ctx: AudioContext | null;
    frame: number;
    timer: ReturnType<typeof setInterval>;
    keep: boolean;
  } | null>(null);

  const teardown = () => {
    const s = session.current;
    if (!s) return;
    session.current = null;
    cancelAnimationFrame(s.frame);
    clearInterval(s.timer);
    s.stream.getTracks().forEach((t) => t.stop());
    s.ctx?.close().catch(() => {});
  };

  // Leaving the page mid-recording releases the microphone and throws the recording away.
  useEffect(
    () => () => {
      if (session.current) session.current.keep = false;
      if (session.current?.recorder.state === "recording") session.current.recorder.stop();
      teardown();
    },
    [],
  );

  const start = async () => {
    setProblem(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setProblem("This browser can't record audio. Record on your device and add the file instead.");
      return;
    }
    setPhase("asking");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (e) {
      setPhase("idle");
      const denied = e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError");
      setProblem(
        denied
          ? "Microphone access was blocked. Allow it in your browser's site settings, then try again."
          : "No microphone was found. Plug one in, or add a recording instead.",
      );
      return;
    }

    const { mime, ext } = pickFormat();
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 64_000 } : undefined);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = () => {
      const keep = session.current?.keep ?? false;
      teardown();
      setPhase("idle");
      setLevels(Array(BARS).fill(0));
      if (!keep || !chunks.length) return;
      const type = recorder.mimeType || mime || "audio/webm";
      const when = new Date().toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-");
      onRecorded(new File(chunks, `recording-${when}${ext}`, { type }));
    };

    // Level meter: loudness of the last ~50 ms, pushed onto a scrolling strip of bars.
    let ctx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    try {
      ctx = new AudioContext();
      analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(analyser);
    } catch {
      ctx = null;
    }
    const buffer = new Float32Array(1024);
    let lastPush = 0;
    const tick = (now: number) => {
      if (!session.current) return;
      if (analyser && now - lastPush > 70) {
        lastPush = now;
        analyser.getFloatTimeDomainData(buffer);
        let sum = 0;
        for (const v of buffer) sum += v * v;
        const level = Math.min(1, Math.sqrt(sum / buffer.length) * 4.5);
        setLevels((prev) => [...prev.slice(1), level]);
      }
      session.current.frame = requestAnimationFrame(tick);
    };

    const began = now();
    const timer = setInterval(() => {
      const elapsed = (now() - began) / 1000;
      setSeconds(elapsed);
      if (elapsed >= MAX_SECONDS) stop();
    }, 250);

    session.current = { recorder, stream, ctx, frame: 0, timer, keep: true };
    session.current.frame = requestAnimationFrame(tick);
    recorder.start(1000);
    setSeconds(0);
    setPhase("recording");
  };

  const stop = () => {
    const s = session.current;
    if (!s || s.recorder.state !== "recording") return;
    s.recorder.stop();
  };

  const discard = () => {
    if (session.current) session.current.keep = false;
    stop();
  };

  return (
    <div>
      <div
        className={cn(
          "flex min-h-16 items-center gap-3 rounded-md border px-3 py-2.5 transition-colors duration-150 sm:px-4",
          phase === "recording" ? "border-ink bg-surface" : "border-line bg-paper",
        )}
      >
        <AnimatePresence mode="wait" initial={false}>
          {phase !== "recording" ? (
            <motion.div
              key="idle"
              className="flex min-w-0 flex-1 items-center gap-3"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: { duration: 0.3, ease: EASE } }}
              exit={{ opacity: 0, transition: { duration: 0.12 } }}
            >
              <button
                type="button"
                onClick={start}
                disabled={disabled || phase === "asking"}
                aria-label="Start recording"
                className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-ink text-paper transition-[background-color,transform] duration-150 hover:bg-ink/85 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Mic aria-hidden className="size-[18px]" />
              </button>
              <span className="min-w-0">
                <span className="block text-[15px] font-medium text-ink">
                  {phase === "asking" ? "Allow the microphone…" : "Record with your microphone"}
                </span>
                <span className="label-mono mt-0.5 block text-ink-3">Talk, then stop · up to 2 hours</span>
              </span>
            </motion.div>
          ) : (
            <motion.div
              key="live"
              className="flex min-w-0 flex-1 items-center gap-3"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: { duration: 0.3, ease: EASE } }}
              exit={{ opacity: 0, transition: { duration: 0.12 } }}
            >
              <span className="flex shrink-0 items-center gap-2">
                <span aria-hidden className="relative flex size-2.5">
                  <span className="absolute inset-0 animate-ping rounded-full bg-accent/60 motion-reduce:hidden" />
                  <span className="relative size-2.5 rounded-full bg-accent" />
                </span>
                <span className="font-mono text-sm tabular-nums text-ink" role="timer" aria-label="Recording time">
                  {stamp(seconds)}
                </span>
              </span>
              <span aria-hidden className="flex h-9 min-w-0 flex-1 items-center gap-[2px]">
                {levels.map((l, i) => (
                  <span
                    key={i}
                    className="min-w-px flex-1 rounded-[1px] bg-ink transition-[height] duration-75"
                    style={{ height: `${Math.max(8, l * 100)}%`, opacity: 0.25 + (i / BARS) * 0.75 }}
                  />
                ))}
              </span>
              <button
                type="button"
                onClick={discard}
                aria-label="Discard recording"
                title="Discard"
                className="inline-flex size-10 shrink-0 items-center justify-center rounded-[8px] text-ink-3 transition-colors hover:bg-paper-2 hover:text-ink"
              >
                <X aria-hidden className="size-4" />
              </button>
              <button
                type="button"
                onClick={stop}
                className="inline-flex h-10 shrink-0 items-center gap-2 rounded-md bg-ink px-3.5 text-sm font-medium text-paper transition-[background-color,transform] duration-150 hover:bg-ink/85 active:translate-y-px"
              >
                <Square aria-hidden className="size-3" fill="currentColor" />
                Stop
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {problem && (
        <p role="alert" className="px-1 pt-2 text-sm text-danger">
          {problem}
        </p>
      )}
    </div>
  );
}
