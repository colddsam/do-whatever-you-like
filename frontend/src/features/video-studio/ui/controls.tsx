"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type ComponentProps, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronLeft, ChevronRight, Diamond, Pipette } from "lucide-react";
import { RichColorPicker } from "@/components/tools/design/rich-color-picker";
import { normalizeHex } from "@/lib/color-sample";
import { cn } from "@/lib/utils";

/*
 * Controls for the editor's dark band. Per DESIGN.md the dark band is the same palette inverted:
 * ink surfaces, ink-raised panels, line-dark hairlines, paper text (paper-dim secondary), a paper
 * fill for the selected chip, and the accent only for the playhead, selection and keyframes.
 */

export function IconButton({ label, active, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={cn(
        "inline-flex size-9 shrink-0 items-center justify-center rounded-sm text-paper-dim transition-colors hover:bg-paper/10 hover:text-paper disabled:pointer-events-none disabled:opacity-35 sm:size-8",
        active && "bg-paper text-ink hover:bg-paper hover:text-ink",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function TextButton({ className, children, tone = "plain", ...rest }: ComponentProps<"button"> & { tone?: "plain" | "primary" | "danger" }) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-md px-3 text-[13px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-40 sm:h-8",
        tone === "primary" && "bg-paper text-ink hover:bg-paper/85",
        tone === "plain" && "border border-line-dark text-paper hover:bg-paper/10",
        tone === "danger" && "border border-danger/60 text-paper hover:bg-danger/20",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Section({ title, children, actions, defaultOpen = true, className }: { title: string; children: ReactNode; actions?: ReactNode; defaultOpen?: boolean; className?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={cn("border-b border-line-dark", className)}>
      <div className="flex items-center gap-1 px-3 py-1.5">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex min-h-8 flex-1 items-center gap-1.5 text-left">
          <ChevronDown aria-hidden className={cn("size-3.5 text-paper-dim transition-transform duration-150", !open && "-rotate-90")} />
          <span className="label-mono text-paper-dim">{title}</span>
        </button>
        {actions}
      </div>
      {open && <div className="px-3 pb-3">{children}</div>}
    </section>
  );
}

export function Row({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("grid min-h-8 grid-cols-[84px_minmax(0,1fr)] items-center gap-2 py-0.5", className)}>
      <span className="truncate text-[12px] text-paper-dim">{label}</span>
      <div className="flex min-w-0 items-center gap-1.5">{children}</div>
    </div>
  );
}

/** A range input that fills from its neutral point (0 for ± sliders, the minimum otherwise). */
export function Slider({
  value,
  min,
  max,
  step,
  neutral,
  onChange,
  onStart,
  onEnd,
  label,
  className,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  neutral?: number;
  onChange: (v: number) => void;
  onStart?: () => void;
  onEnd?: () => void;
  label: string;
  className?: string;
}) {
  const pct = (v: number) => `${((Math.min(max, Math.max(min, v)) - min) / (max - min || 1)) * 100}%`;
  const n = neutral ?? (min < 0 && max > 0 ? 0 : min);
  const a = Math.min(value, n);
  const b = Math.max(value, n);
  return (
    <input
      type="range"
      aria-label={label}
      min={min}
      max={max}
      step={step}
      value={value}
      onPointerDown={onStart}
      onPointerUp={onEnd}
      onKeyDown={(e) => e.stopPropagation()}
      onChange={(e) => onChange(Number(e.target.value))}
      className={cn("studio-range h-5 min-w-0 flex-1 cursor-pointer", className)}
      style={{ ["--a" as string]: pct(a), ["--b" as string]: pct(b), ["--h" as string]: pct(n) }}
    />
  );
}

/**
 * A number you can drag sideways (like After Effects' blue numbers) or click to type. Shift drags
 * ten times faster, Alt ten times finer.
 */
export function Scrub({
  value,
  onChange,
  step = 1,
  min = -Infinity,
  max = Infinity,
  format,
  parse,
  onStart,
  onEnd,
  label,
  className,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  format?: (v: number) => string;
  parse?: (s: string) => number;
  onStart?: () => void;
  onEnd?: () => void;
  label: string;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const drag = useRef<{ x: number; v: number; moved: boolean } | null>(null);
  const shown = format ? format(value) : String(Math.round(value * 1000) / 1000);
  if (editing) {
    return (
      <input
        autoFocus
        aria-label={label}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") setEditing(false);
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        onBlur={() => {
          const v = parse ? parse(text) : Number(text.replace(/[^\d.+-eE]/g, ""));
          if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)));
          setEditing(false);
        }}
        className={cn("h-9 w-full min-w-0 rounded-sm border border-accent bg-ink px-1.5 font-mono text-[12px] text-paper outline-none sm:h-7", className)}
      />
    );
  }
  return (
    <button
      type="button"
      aria-label={`${label}: ${shown}. Drag to change, click to type.`}
      title="Drag to change · click to type · Shift = faster · Alt = finer"
      className={cn("h-9 min-w-0 cursor-ew-resize touch-none truncate rounded-sm px-1.5 text-left font-mono text-[12px] text-accent hover:bg-paper/10 sm:h-7", className)}
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, v: value, moved: false };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const dx = e.clientX - d.x;
        if (!d.moved && Math.abs(dx) < 3) return;
        if (!d.moved) {
          d.moved = true;
          onStart?.();
        }
        const k = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
        const v = d.v + Math.round((dx * k) / 2) * step;
        onChange(Math.min(max, Math.max(min, Math.round(v / step) * step)));
      }}
      onPointerUp={() => {
        const d = drag.current;
        drag.current = null;
        if (d?.moved) onEnd?.();
        else {
          setText(shown.replace(/[^\d.+-]/g, ""));
          setEditing(true);
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          e.stopPropagation();
          onChange(Math.min(max, Math.max(min, value + (e.key === "ArrowUp" ? 1 : -1) * step * (e.shiftKey ? 10 : 1))));
        }
      }}
    >
      {shown}
    </button>
  );
}

/** The keyframe diamond: hollow = static, half = animated (no key here), filled = a key at the playhead. */
export function KeyButton({ state, onClick, onPrev, onNext, label }: { state: "off" | "animated" | "key"; onClick: () => void; onPrev?: () => void; onNext?: () => void; label: string }) {
  return (
    <span className="flex shrink-0 items-center">
      {state !== "off" && onPrev && (
        <button type="button" aria-label={`Previous ${label} keyframe`} title="Previous keyframe" onClick={onPrev} className="inline-flex size-8 items-center justify-center rounded-sm text-paper-dim hover:text-paper sm:size-6">
          <ChevronLeft aria-hidden className="size-3.5" />
        </button>
      )}
      <button
        type="button"
        aria-label={state === "key" ? `Remove ${label} keyframe` : `Add ${label} keyframe`}
        title={state === "off" ? "Animate: add a keyframe here" : state === "key" ? "Remove this keyframe" : "Add a keyframe here"}
        onClick={onClick}
        className="inline-flex size-8 items-center justify-center rounded-sm hover:bg-paper/10 sm:size-6"
      >
        <Diamond aria-hidden className={cn("size-3.5", state === "key" ? "fill-accent text-accent" : state === "animated" ? "fill-accent/30 text-accent" : "text-paper-dim")} />
      </button>
      {state !== "off" && onNext && (
        <button type="button" aria-label={`Next ${label} keyframe`} title="Next keyframe" onClick={onNext} className="inline-flex size-8 items-center justify-center rounded-sm text-paper-dim hover:text-paper sm:size-6">
          <ChevronRight aria-hidden className="size-3.5" />
        </button>
      )}
    </span>
  );
}

export function Select<T extends string>({ value, options, onChange, label, className }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string; className?: string }) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      onKeyDown={(e) => e.stopPropagation()}
      className={cn("h-9 min-w-0 flex-1 rounded-sm border border-line-dark bg-ink px-1.5 text-[12px] text-paper outline-none focus-visible:border-accent sm:h-7", className)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label, className }: { value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; label: string; className?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("flex min-w-0 flex-1 rounded-sm border border-line-dark p-0.5", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn("inline-flex h-8 min-w-0 flex-1 items-center justify-center rounded-[4px] px-1.5 text-[12px] transition-colors sm:h-6", value === o.value ? "bg-paper text-ink" : "text-paper-dim hover:text-paper")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn("relative inline-flex h-6 w-10 shrink-0 items-center rounded-full border transition-colors sm:h-5 sm:w-9", checked ? "border-paper bg-paper" : "border-line-dark bg-ink")}
    >
      <span className={cn("absolute size-4 rounded-full transition-transform duration-150 sm:size-3.5", checked ? "translate-x-[19px] bg-ink sm:translate-x-[18px]" : "translate-x-[3px] bg-paper-dim sm:translate-x-[2px]")} />
    </button>
  );
}

export function ColorField({
  value,
  onChange,
  label,
  onEyedropper,
  eyedropperActive,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  onEyedropper?: () => void;
  eyedropperActive?: boolean;
}) {
  const [text, setText] = useState(value);
  const [shown, setShown] = useState(value);
  const [open, setOpen] = useState(false);
  const swatchRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  if (shown !== value) {
    setShown(value);
    setText(value);
  }

  useLayoutEffect(() => {
    if (!open || !swatchRef.current || !popRef.current) return;
    const place = () => {
      const a = swatchRef.current?.getBoundingClientRect();
      const el = popRef.current;
      if (!a || !el) return;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const W = window.innerWidth;
      const H = window.innerHeight;
      const x = Math.min(Math.max(8, a.right - w), Math.max(8, W - w - 8));
      const y = a.bottom + 6 + h <= H - 8 ? a.bottom + 6 : Math.max(8, a.top - h - 6);
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      el.style.visibility = "visible";
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (swatchRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const safeHex = normalizeHex(value) ?? "#000000";

  return (
    <span className="flex min-w-0 flex-1 items-center gap-1.5">
      <button
        ref={swatchRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        title="Open colour picker"
        onClick={() => setOpen((o) => !o)}
        className="h-7 w-8 shrink-0 cursor-pointer rounded-sm border border-line-dark bg-ink p-0.5 transition-colors hover:border-paper/60"
      >
        <span className="block size-full rounded-[2px]" style={{ background: safeHex }} />
      </button>
      <input
        aria-label={`${label} hex`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        onBlur={() => {
          const norm = normalizeHex(text);
          if (norm) onChange(norm);
          else setText(value);
        }}
        className="h-7 min-w-0 flex-1 rounded-sm border border-line-dark bg-ink px-1.5 font-mono text-[12px] uppercase text-paper outline-none focus-visible:border-accent"
      />
      {onEyedropper && (
        <IconButton label={`Pick ${label.toLowerCase()} from preview`} active={eyedropperActive} onClick={onEyedropper} className="size-7">
          <Pipette aria-hidden className="size-3.5" />
        </IconButton>
      )}
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={popRef}
            role="dialog"
            aria-label={label}
            style={{ position: "fixed", left: 0, top: 0, visibility: "hidden" }}
            className="z-[130] w-64 rounded-md border border-line-dark bg-ink-raised p-2.5 shadow-float"
            data-lenis-prevent
          >
            <RichColorPicker
              theme="dark"
              compact
              value={safeHex}
              onChange={onChange}
              onEyedropper={
                onEyedropper
                  ? () => {
                      setOpen(false);
                      onEyedropper();
                    }
                  : undefined
              }
              eyedropperActive={eyedropperActive}
              eyedropperLabel="Pick from preview frame"
            />
          </div>,
          document.body,
        )}
    </span>
  );
}

export function Progress({ value, label }: { value?: number; label?: string }) {
  return (
    <div className="mt-2">
      {label && <p className="mb-1 truncate text-[12px] text-paper-dim">{label}</p>}
      <div className="h-1 overflow-hidden rounded-full bg-line-dark">
        {value === undefined ? (
          <div className="h-full w-1/3 animate-[studio-indeterminate_1.1s_ease-in-out_infinite] rounded-full bg-paper" />
        ) : (
          <div className="h-full rounded-full bg-paper transition-[width] duration-200" style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%` }} />
        )}
      </div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="px-3 py-6 text-center text-[13px] leading-relaxed text-paper-dim">{children}</p>;
}
