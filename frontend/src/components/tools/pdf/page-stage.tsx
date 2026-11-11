"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { thumbUrl } from "@/lib/pdf";
import { cn } from "@/lib/utils";

/*
 * A page as people work on it: the real page drawn by the server, with an overlay in the same
 * coordinates the backend uses (fractions of the page as seen, 0 at the top-left). Tools that
 * place things on pages (edit, sign, crop, redact, watermark, page numbers) draw on this.
 */

export type Box = { x0: number; y0: number; x1: number; y1: number };
export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Width of an element, kept up to date (for drawing in points at the right scale). */
export function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/**
 * One page at a readable size. `children` is the overlay; it gets the page's scale
 * (on-screen pixels per PDF point) so text and strokes can be drawn at their real size.
 */
export function PageView({
  token,
  page,
  size,
  className,
  children,
  overlayClassName,
  overlayProps,
}: {
  token: string;
  /** 1-based. */
  page: number;
  /** [width, height] of this page in points, as seen. */
  size?: [number, number];
  className?: string;
  children?: (scale: number) => React.ReactNode;
  overlayClassName?: string;
  overlayProps?: React.HTMLAttributes<HTMLDivElement>;
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [state, setState] = useState<{ src: string; status: "loading" | "ready" | "failed" }>({ src: "", status: "loading" });
  const src = thumbUrl(token, page, 800);
  const status = state.src === src ? state.status : "loading";
  const ratio = size ? size[1] / size[0] : 1.4142;
  const scale = size && width ? width / size[0] : 0;

  return (
    <div
      ref={ref}
      className={cn("relative w-full select-none overflow-hidden rounded-[4px] border border-line bg-surface", className)}
      style={{ aspectRatio: `1 / ${ratio}` }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        key={src}
        src={src}
        alt=""
        draggable={false}
        onLoad={() => setState({ src, status: "ready" })}
        onError={() => setState({ src, status: "failed" })}
        className={cn("absolute inset-0 size-full object-fill transition-opacity duration-300", status === "ready" ? "opacity-100" : "opacity-0")}
      />
      {status !== "ready" && (
        <span aria-hidden className="absolute inset-0 flex items-center justify-center gap-2 font-mono text-xs text-ink-3">
          {status === "loading" ? <Loader2 className="size-3.5 animate-spin" /> : null}
          {status === "loading" ? `page ${page}` : "Couldn't draw this page"}
        </span>
      )}
      {/* data-stage: what EditableBox measures against. */}
      <div data-stage="" className={cn("absolute inset-0", overlayClassName)} {...overlayProps}>
        {children?.(scale)}
      </div>
    </div>
  );
}

/** "‹ Page 3 of 12 ›", with a small strip of the pages around the current one on wider screens. */
export function PageNav({
  page,
  pages,
  onChange,
  marked,
  disabled,
}: {
  page: number;
  pages: number;
  onChange: (p: number) => void;
  /** Pages that have something on them (shown with a dot). */
  marked?: Set<number>;
  disabled?: boolean;
}) {
  if (pages <= 1) return null;
  const go = (p: number) => onChange(Math.min(pages, Math.max(1, p)));
  return (
    <div className="flex items-center justify-between gap-2">
      <button
        type="button"
        onClick={() => go(page - 1)}
        disabled={disabled || page <= 1}
        aria-label="Previous page"
        className="inline-flex size-11 items-center justify-center rounded-md border border-line bg-surface text-ink-2 transition-colors hover:border-ink-3 hover:text-ink disabled:opacity-30 sm:size-9"
      >
        <ChevronLeft aria-hidden className="size-4" />
      </button>
      <div className="flex min-w-0 items-center gap-2">
        <label className="label-mono flex items-center gap-1.5 text-ink-3">
          Page
          <select
            value={page}
            disabled={disabled}
            onChange={(e) => go(Number(e.target.value))}
            className="h-9 rounded-sm border border-line bg-surface px-1.5 font-mono text-sm text-ink outline-none focus:border-ink"
          >
            {Array.from({ length: pages }, (_, i) => (
              <option key={i} value={i + 1}>
                {i + 1}
                {marked?.has(i + 1) ? " •" : ""}
              </option>
            ))}
          </select>
          of {pages}
        </label>
      </div>
      <button
        type="button"
        onClick={() => go(page + 1)}
        disabled={disabled || page >= pages}
        aria-label="Next page"
        className="inline-flex size-11 items-center justify-center rounded-md border border-line bg-surface text-ink-2 transition-colors hover:border-ink-3 hover:text-ink disabled:opacity-30 sm:size-9"
      >
        <ChevronRight aria-hidden className="size-4" />
      </button>
    </div>
  );
}

/** Pointer position on an element as page fractions. */
export function fractionAt(el: HTMLElement, clientX: number, clientY: number) {
  const r = el.getBoundingClientRect();
  return { x: clamp01((clientX - r.left) / r.width), y: clamp01((clientY - r.top) / r.height) };
}

export const boxStyle = (b: Box): React.CSSProperties => ({
  left: `${b.x0 * 100}%`,
  top: `${b.y0 * 100}%`,
  width: `${(b.x1 - b.x0) * 100}%`,
  height: `${(b.y1 - b.y0) * 100}%`,
});

export const normalize = (a: { x: number; y: number }, b: { x: number; y: number }): Box => ({
  x0: Math.min(a.x, b.x),
  y0: Math.min(a.y, b.y),
  x1: Math.max(a.x, b.x),
  y1: Math.max(a.y, b.y),
});

type Handle = "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
const HANDLES: Exclude<Handle, "move">[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const HANDLE_POS: Record<Exclude<Handle, "move">, string> = {
  nw: "-left-1.5 -top-1.5 cursor-nwse-resize",
  n: "left-1/2 -top-1.5 -translate-x-1/2 cursor-ns-resize",
  ne: "-right-1.5 -top-1.5 cursor-nesw-resize",
  e: "-right-1.5 top-1/2 -translate-y-1/2 cursor-ew-resize",
  se: "-right-1.5 -bottom-1.5 cursor-nwse-resize",
  s: "left-1/2 -bottom-1.5 -translate-x-1/2 cursor-ns-resize",
  sw: "-left-1.5 -bottom-1.5 cursor-nesw-resize",
  w: "-left-1.5 top-1/2 -translate-y-1/2 cursor-ew-resize",
};

/**
 * A box that can be moved (drag inside) and resized (drag a handle), in page fractions.
 * Arrow keys nudge it (Shift for bigger steps); Alt + arrows resize it.
 */
export function EditableBox({
  box,
  onChange,
  selected,
  onSelect,
  minSize = 0.02,
  keepRatio,
  className,
  children,
  label,
}: {
  box: Box;
  onChange: (b: Box) => void;
  selected: boolean;
  onSelect?: () => void;
  minSize?: number;
  /** Keep the width:height ratio while resizing (images, signatures). */
  keepRatio?: boolean;
  className?: string;
  children?: React.ReactNode;
  label: string;
}) {
  const drag = useRef<{ handle: Handle; start: { x: number; y: number }; box: Box; parent: HTMLElement } | null>(null);

  const begin = (e: React.PointerEvent, handle: Handle) => {
    e.stopPropagation();
    e.preventDefault();
    onSelect?.();
    const parent = (e.currentTarget as HTMLElement).closest("[data-stage]") as HTMLElement | null;
    if (!parent) return;
    drag.current = { handle, start: fractionAt(parent, e.clientX, e.clientY), box, parent };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = fractionAt(d.parent, e.clientX, e.clientY);
    const dx = p.x - d.start.x;
    const dy = p.y - d.start.y;
    let { x0, y0, x1, y1 } = d.box;
    if (d.handle === "move") {
      const w = x1 - x0;
      const h = y1 - y0;
      x0 = Math.min(1 - w, Math.max(0, x0 + dx));
      y0 = Math.min(1 - h, Math.max(0, y0 + dy));
      return onChange({ x0, y0, x1: x0 + w, y1: y0 + h });
    }
    if (d.handle.includes("w")) x0 = Math.min(x1 - minSize, clamp01(x0 + dx));
    if (d.handle.includes("e")) x1 = Math.max(x0 + minSize, clamp01(x1 + dx));
    if (d.handle.includes("n")) y0 = Math.min(y1 - minSize, clamp01(y0 + dy));
    if (d.handle.includes("s")) y1 = Math.max(y0 + minSize, clamp01(y1 + dy));
    if (keepRatio && d.handle.length === 2) {
      // Corners keep the original proportions, anchored on the opposite corner.
      const ratio = (d.box.y1 - d.box.y0) / (d.box.x1 - d.box.x0);
      const w = x1 - x0;
      const h = w * ratio * (d.parent.clientWidth / d.parent.clientHeight);
      if (d.handle.includes("n")) y0 = y1 - h;
      else y1 = y0 + h;
      if (y0 < 0 || y1 > 1) return;
    }
    onChange({ x0, y0, x1, y1 });
  };
  const end = () => {
    drag.current = null;
  };
  const onKey = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 0.05 : 0.005;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!d) return;
    e.preventDefault();
    const [dx, dy] = d;
    if (e.altKey) {
      onChange({ ...box, x1: Math.max(box.x0 + minSize, clamp01(box.x1 + dx)), y1: Math.max(box.y0 + minSize, clamp01(box.y1 + dy)) });
    } else {
      const w = box.x1 - box.x0;
      const h = box.y1 - box.y0;
      const x0 = Math.min(1 - w, Math.max(0, box.x0 + dx));
      const y0 = Math.min(1 - h, Math.max(0, box.y0 + dy));
      onChange({ x0, y0, x1: x0 + w, y1: y0 + h });
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-pressed={selected}
      onPointerDown={(e) => begin(e, "move")}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={onKey}
      onFocus={onSelect}
      className={cn(
        "absolute cursor-move touch-none outline-none",
        selected ? "ring-1 ring-ink" : "hover:ring-1 hover:ring-ink-3",
        "focus-visible:ring-2 focus-visible:ring-accent/60",
        className,
      )}
      style={boxStyle(box)}
    >
      {children}
      {selected &&
        HANDLES.map((h) => (
          <span
            key={h}
            aria-hidden
            onPointerDown={(e) => begin(e, h)}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
            className={cn("absolute z-10 size-3 touch-none rounded-[2px] border border-ink bg-surface", HANDLE_POS[h])}
          />
        ))}
    </div>
  );
}
