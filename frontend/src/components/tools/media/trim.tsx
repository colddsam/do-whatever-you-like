"use client";

import { useEffect, useRef } from "react";
import { stamp } from "@/lib/video";
import { cn } from "@/lib/utils";

/**
 * Picks a part of a video: a preview you can play and scrub, and a two-handle range under it.
 * Dragging a handle shows that moment in the preview. Times are in seconds.
 */
export function Trim({
  url,
  duration,
  start,
  end,
  onChange,
  maxLength,
}: {
  url: string;
  duration: number;
  start: number;
  end: number;
  onChange: (start: number, end: number) => void;
  /** Longest allowed part, in seconds (the end follows the start when it's exceeded). */
  maxLength?: number;
}) {
  const preview = useRef<HTMLVideoElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<"start" | "end" | null>(null);
  const step = duration > 600 ? 1 : duration > 60 ? 0.1 : 0.05;
  const round = (t: number) => Math.round(t / step) * step;

  const show = (t: number) => {
    const v = preview.current;
    if (v && Math.abs(v.currentTime - t) > 0.04) v.currentTime = Math.min(t, duration - 0.01);
  };
  const set = (which: "start" | "end", t: number) => {
    t = Math.max(0, Math.min(duration, round(t)));
    let s = start;
    let e = end;
    if (which === "start") {
      s = Math.min(t, end - step);
      if (maxLength && e - s > maxLength) e = s + maxLength;
    } else {
      e = Math.max(t, start + step);
      if (maxLength && e - s > maxLength) s = e - maxLength;
    }
    onChange(Math.max(0, s), Math.min(duration, e));
    show(which === "start" ? s : e);
  };
  const timeAt = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    return ((clientX - r.left) / r.width) * duration;
  };

  // Keep the preview inside the chosen part while it plays.
  useEffect(() => {
    const v = preview.current;
    if (!v) return;
    const onTime = () => {
      if (v.currentTime > end || v.currentTime < start - 0.05) {
        v.currentTime = start;
        if (v.currentTime > end) v.pause();
      }
    };
    v.addEventListener("timeupdate", onTime);
    return () => v.removeEventListener("timeupdate", onTime);
  }, [start, end]);

  const pct = (t: number) => `${(t / duration) * 100}%`;
  const handle = (which: "start" | "end") => (
    <button
      type="button"
      role="slider"
      aria-label={which === "start" ? "Start" : "End"}
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(which === "start" ? start : end)}
      aria-valuetext={stamp(which === "start" ? start : end)}
      onPointerDown={(e) => {
        e.preventDefault();
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        drag.current = which;
      }}
      onPointerMove={(e) => drag.current === which && set(which, timeAt(e.clientX))}
      onPointerUp={() => (drag.current = null)}
      onKeyDown={(e) => {
        const big = e.shiftKey ? 10 : 1;
        const cur = which === "start" ? start : end;
        const by = step * big * (step < 1 ? 10 : 1);
        if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
          e.preventDefault();
          set(which, cur - by);
        }
        if (e.key === "ArrowRight" || e.key === "ArrowUp") {
          e.preventDefault();
          set(which, cur + by);
        }
      }}
      className="absolute top-1/2 z-10 flex h-9 w-4 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize touch-none items-center justify-center rounded-[5px] bg-ink shadow-card outline-none ring-accent/30 focus-visible:ring-4"
      style={{ left: pct(which === "start" ? start : end) }}
    >
      <span aria-hidden className="h-4 w-px bg-paper/70" />
    </button>
  );

  return (
    <div className="grid gap-3">
      <video ref={preview} src={url} controls muted playsInline preload="metadata" className="max-h-[320px] w-full rounded-md border border-line bg-ink object-contain" />
      <div className="px-2">
        <div
          ref={track}
          className="relative h-10 cursor-pointer"
          onPointerDown={(e) => {
            if ((e.target as HTMLElement).getAttribute("role") === "slider") return;
            const t = timeAt(e.clientX);
            set(Math.abs(t - start) < Math.abs(t - end) ? "start" : "end", t);
          }}
        >
          <div className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-paper-2" />
          <div className="absolute top-1/2 h-2 -translate-y-1/2 rounded-full bg-accent" style={{ left: pct(start), width: `calc(${pct(end)} - ${pct(start)})` }} />
          {handle("start")}
          {handle("end")}
        </div>
        <div className="mt-1 flex items-center justify-between gap-2 font-mono text-[12px] text-ink-3">
          <span>
            <span className="text-ink">{stamp(start)}</span> start
          </span>
          <span className={cn("rounded-sm px-1.5", "bg-paper-2 text-ink")}>{(end - start).toFixed(step < 0.1 ? 2 : 1)} s</span>
          <span>
            end <span className="text-ink">{stamp(end)}</span>
          </span>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button type="button" onClick={() => set("start", preview.current?.currentTime ?? 0)} className="inline-flex h-8 items-center rounded-[8px] border border-line bg-surface px-2.5 text-[13px] text-ink-2 hover:border-ink-3 hover:text-ink">
            Start here
          </button>
          <button type="button" onClick={() => set("end", preview.current?.currentTime ?? duration)} className="inline-flex h-8 items-center rounded-[8px] border border-line bg-surface px-2.5 text-[13px] text-ink-2 hover:border-ink-3 hover:text-ink">
            End here
          </button>
          <button type="button" onClick={() => onChange(0, maxLength ? Math.min(duration, maxLength) : duration)} className="inline-flex h-8 items-center rounded-[8px] px-2.5 text-[13px] text-ink-3 hover:text-ink">
            {maxLength && duration > maxLength ? `First ${maxLength} s` : "Whole video"}
          </button>
        </div>
      </div>
    </div>
  );
}
