"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useStudio } from "../store";

/*
 * The music studio shares the video editor's controls (DESIGN.md's dark band: ink surfaces,
 * ink-raised panels, line-dark hairlines, paper text, a paper fill for the selected chip and the
 * accent only for the playhead, selection, recording and live state). A few DAW-only pieces
 * live here.
 */
export { Empty, IconButton, Progress, Row, Section, Segmented, Select, Slider, TextButton, Toggle } from "@/features/video-studio/ui/controls";

/** A peak meter that reads its level every frame without re-rendering React. */
export function Meter({ read, vertical, className }: { read: () => number; vertical?: boolean; className?: string }) {
  const bar = useRef<HTMLDivElement>(null);
  const hold = useRef(0);
  useEffect(() => {
    let raf = 0;
    let shown = 0;
    const tick = () => {
      const v = Math.min(1.2, read());
      // Fast rise, slow fall: easier to read than the raw peak.
      shown = v > shown ? v : shown * 0.9;
      hold.current = Math.max(shown, hold.current * 0.995);
      const db = shown > 0 ? 20 * Math.log10(shown) : -60;
      const f = Math.max(0, Math.min(1, (db + 48) / 48));
      const el = bar.current;
      if (el) {
        if (vertical) el.style.height = `${f * 100}%`;
        else el.style.width = `${f * 100}%`;
        el.style.background = shown >= 0.99 ? "var(--color-danger)" : f > 0.85 ? "var(--color-warning)" : "var(--color-success)";
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [read, vertical]);
  return (
    <div aria-hidden className={cn("relative overflow-hidden rounded-[2px] bg-line-dark", vertical ? "w-1.5" : "h-1.5", className)}>
      <div ref={bar} className={cn("absolute bottom-0 left-0", vertical ? "w-full" : "h-full")} />
    </div>
  );
}

export function Chips<T extends string>({ value, options, onChange, label, allowNone }: { value: T | null; options: { value: T; label: string }[]; onChange: (v: T | null) => void; label: string; allowNone?: boolean }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(value === o.value && allowNone ? null : o.value)}
          className={cn(
            "inline-flex h-8 items-center rounded-sm border px-2.5 text-[12px] transition-colors sm:h-7",
            value === o.value ? "border-paper bg-paper text-ink" : "border-line-dark text-paper-dim hover:border-paper-dim hover:text-paper",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="label-mono block text-paper-dim">{label}</span>
      {children}
      {hint && <span className="block text-[12px] leading-snug text-paper-dim">{hint}</span>}
    </label>
  );
}

export const inputCls =
  "w-full rounded-sm border border-line-dark bg-ink px-2 py-1.5 text-[13px] text-paper outline-none placeholder:text-paper-dim/70 focus-visible:border-accent";

/** Progress for a running job, from the store. */
export function JobLine({ id }: { id: string }) {
  const job = useStudio((s) => s.jobs[id]);
  if (!job) return null;
  return (
    <div className="mt-2" role="status" aria-live="polite">
      <p className="mb-1 truncate text-[12px] text-paper-dim">{job.label}…</p>
      <div className="h-1 overflow-hidden rounded-full bg-line-dark">
        {job.progress === undefined ? (
          <div className="h-full w-1/3 animate-[studio-indeterminate_1.1s_ease-in-out_infinite] rounded-full bg-paper" />
        ) : (
          <div className="h-full rounded-full bg-paper transition-[width] duration-200" style={{ width: `${Math.round(Math.min(1, job.progress) * 100)}%` }} />
        )}
      </div>
    </div>
  );
}

export function Note({ children, tone = "plain" }: { children: ReactNode; tone?: "plain" | "warn" }) {
  return <p className={cn("rounded-sm border px-2.5 py-2 text-[12px] leading-relaxed", tone === "warn" ? "border-warning/50 text-paper" : "border-line-dark text-paper-dim")}>{children}</p>;
}

/**
 * Pointer capture that never throws. Browsers refuse capture calls for a pointer that's no longer
 * active (a very quick tap, some Android browsers, assistive tech); an exception there used to
 * abort the handler before the note played.
 */
export function capture(e: { target: EventTarget | null; currentTarget?: EventTarget | null; pointerId: number }, el?: Element | null) {
  try {
    (el ?? (e.target as Element)).setPointerCapture(e.pointerId);
  } catch {
    /* not an active pointer */
  }
}
export function uncapture(e: { target: EventTarget | null; pointerId: number }, el?: Element | null) {
  try {
    const t = el ?? (e.target as Element);
    if (t.hasPointerCapture?.(e.pointerId)) t.releasePointerCapture(e.pointerId);
  } catch {
    /* not captured */
  }
}
