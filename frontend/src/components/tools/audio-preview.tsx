"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { formatDuration } from "@/lib/media";
import { cn } from "@/lib/utils";

const BARS = 56;
/** Decoding expands MP3 ~10× in memory, so only draw the waveform for files up to ~15 minutes. */
const WAVEFORM_MAX_BYTES = 20 * 1024 * 1024;

/** Loudness per bar (0–1), read from the actual audio. Null if the browser can't decode it. */
async function readPeaks(blob: Blob): Promise<number[] | null> {
  if (blob.size > WAVEFORM_MAX_BYTES || typeof AudioContext === "undefined") return null;
  const ctx = new AudioContext();
  try {
    const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
    const data = audio.getChannelData(0);
    const size = Math.floor(data.length / BARS);
    const stride = Math.max(1, Math.floor(size / 400)); // sample, don't scan every frame
    const peaks = Array.from({ length: BARS }, (_, b) => {
      let max = 0;
      for (let i = b * size; i < (b + 1) * size; i += stride) max = Math.max(max, Math.abs(data[i]));
      return max;
    });
    const top = Math.max(...peaks) || 1;
    return peaks.map((p) => Math.max(0.08, p / top));
  } catch {
    return null;
  } finally {
    ctx.close();
  }
}

/**
 * A small player for the result, so people can check the audio before saving it.
 * The waveform is the real one, and doubles as the seek bar (click, drag or arrow keys).
 */
export function AudioPreview({ src, blob }: { src: string; blob: Blob }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [peaks, setPeaks] = useState<number[] | null>(null);

  useEffect(() => {
    let live = true;
    readPeaks(blob).then((p) => live && setPeaks(p));
    return () => {
      live = false;
    };
  }, [blob]);

  const progress = duration ? time / duration : 0;

  const seekTo = (fraction: number) => {
    const a = audioRef.current;
    if (!a || !duration) return;
    a.currentTime = Math.min(Math.max(fraction, 0), 1) * duration;
    setTime(a.currentTime);
  };
  const seekFromPointer = (clientX: number) => {
    const r = trackRef.current?.getBoundingClientRect();
    if (r) seekTo((clientX - r.left) / r.width);
  };

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) a.play().catch(() => setPlaying(false));
    else a.pause();
  };

  return (
    <div className="flex items-center gap-3 rounded-md border border-line bg-paper p-2 pr-3">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "Pause" : "Play"}
        className="inline-flex size-10 shrink-0 items-center justify-center rounded-[8px] bg-ink text-paper transition-[background-color,transform] duration-150 hover:bg-ink/85 active:translate-y-px"
      >
        {playing ? <Pause aria-hidden className="size-4" fill="currentColor" /> : <Play aria-hidden className="size-4 translate-x-px" fill="currentColor" />}
      </button>

      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(time)}
        aria-valuetext={`${formatDuration(time)} of ${formatDuration(duration)}`}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          seekFromPointer(e.clientX);
        }}
        onPointerMove={(e) => e.buttons === 1 && seekFromPointer(e.clientX)}
        onKeyDown={(e) => {
          const step = e.key === "ArrowRight" ? 5 : e.key === "ArrowLeft" ? -5 : 0;
          if (step && duration) {
            e.preventDefault();
            seekTo((time + step) / duration);
          } else if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            toggle();
          }
        }}
        className="relative flex h-10 min-w-0 flex-1 cursor-pointer touch-none items-center rounded-sm outline-none focus-visible:ring-4 focus-visible:ring-accent/15"
      >
        {peaks ? (
          <div aria-hidden className="flex h-8 w-full items-center gap-[2px]">
            {peaks.map((p, i) => (
              <span
                key={i}
                style={{ height: `${p * 100}%` }}
                className={cn(
                  "min-w-px flex-1 rounded-[1px] transition-colors duration-150",
                  (i + 0.5) / BARS <= progress ? "bg-ink" : "bg-ink-3/35",
                )}
              />
            ))}
          </div>
        ) : (
          // Long files (or a browser that can't decode MP3) get a plain line.
          <div aria-hidden className="relative h-1 w-full rounded-full bg-line">
            <span className="absolute inset-y-0 left-0 rounded-full bg-ink" style={{ width: `${progress * 100}%` }} />
          </div>
        )}
      </div>

      <span className="w-10 shrink-0 text-right font-mono text-[12px] tabular-nums text-ink-2 sm:w-auto">
        {formatDuration(time)}
        <span className="hidden text-ink-3 sm:inline"> / {duration ? formatDuration(duration) : "–:––"}</span>
      </span>
    </div>
  );
}
