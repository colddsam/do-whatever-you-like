"use client";

import { useRef, useState } from "react";
import { motion } from "motion/react";
import type { Point, Quad } from "@/lib/scan";

const NAMES = ["Top-left", "Top-right", "Bottom-right", "Bottom-left"];
const ZOOM = 3;
const clamp = (v: number) => Math.min(1, Math.max(0, v));

/**
 * The photo with the page outline and four corner handles. Drag a handle (mouse, pen or touch), or
 * focus it and use the arrow keys (Shift for bigger steps). While dragging, a loupe shows the
 * corner magnified, so it can be placed exactly even under a finger.
 */
export function CornerEditor({
  src,
  width,
  height,
  quad,
  onChange,
  disabled,
}: {
  src: string;
  width: number;
  height: number;
  quad: Quad;
  onChange: (q: Quad) => void;
  disabled?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [view, setView] = useState<{ w: number; h: number }>({ w: 1, h: 1 });

  const set = (i: number, p: Point) => {
    const next = quad.map((q, j) => (j === i ? [clamp(p[0]), clamp(p[1])] : q)) as Quad;
    onChange(next);
  };
  const at = (e: React.PointerEvent): Point => {
    const r = box.current!.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  };

  const pts = quad.map(([x, y]) => [x * width, y * height]);
  const path = `M${pts.map((p) => p.join(",")).join("L")}Z`;
  const r = Math.max(width, height) / 70;
  const loupe = drag !== null ? quad[drag] : null;

  return (
    <div
      ref={box}
      className="relative mx-auto w-full touch-none select-none overflow-hidden rounded-sm bg-ink"
      style={{ aspectRatio: `${width} / ${height}`, maxHeight: "min(62vh, 560px)", maxWidth: `calc(min(62vh, 560px) * ${width / height})` }}
      onPointerMove={(e) => drag !== null && set(drag, at(e))}
      onPointerUp={() => setDrag(null)}
      onPointerCancel={() => setDrag(null)}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="The photo of the page" draggable={false} className="absolute inset-0 size-full object-fill" />
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="absolute inset-0 size-full">
        <path d={`M0,0H${width}V${height}H0Z ${path}`} fill="rgba(13,12,9,0.55)" fillRule="evenodd" />
        <path d={path} fill="none" stroke="var(--color-accent)" strokeWidth={r / 3} strokeLinejoin="round" />
      </svg>
      {quad.map(([x, y], i) => (
        <motion.button
          key={i}
          type="button"
          disabled={disabled}
          aria-label={`${NAMES[i]} corner. Use the arrow keys to move it.`}
          onPointerDown={(e) => {
            if (disabled) return;
            e.preventDefault();
            (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
            box.current?.setPointerCapture?.(e.pointerId);
            const rect = box.current!.getBoundingClientRect();
            setView({ w: rect.width, h: rect.height });
            setDrag(i);
          }}
          onKeyDown={(e) => {
            const step = e.shiftKey ? 0.02 : 0.004;
            const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
            if (!d) return;
            e.preventDefault();
            set(i, [x + d[0], y + d[1]]);
          }}
          animate={{ scale: drag === i ? 1.25 : 1 }}
          transition={{ type: "spring", stiffness: 500, damping: 30 }}
          className="absolute size-7 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border-2 border-paper bg-accent shadow-card outline-none focus-visible:ring-4 focus-visible:ring-paper/60 active:cursor-grabbing disabled:opacity-50"
          style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
        />
      ))}
      {loupe && (
        <span
          aria-hidden
          className="pointer-events-none absolute size-28 overflow-hidden rounded-full border-2 border-paper shadow-float"
          style={{
            left: `clamp(8px, calc(${loupe[0] * 100}% - 56px), calc(100% - 120px))`,
            top: loupe[1] > 0.3 ? `calc(${loupe[1] * 100}% - 150px)` : `calc(${loupe[1] * 100}% + 40px)`,
            backgroundImage: `url(${src})`,
            // 3x zoom, centred on the corner (the loupe is 112 px across).
            backgroundSize: `${view.w * ZOOM}px ${view.h * ZOOM}px`,
            backgroundPosition: `${56 - loupe[0] * view.w * ZOOM}px ${56 - loupe[1] * view.h * ZOOM}px`,
            backgroundRepeat: "no-repeat",
            backgroundColor: "#0d0c09",
          }}
        >
          <span className="absolute left-1/2 top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent" />
        </span>
      )}
    </div>
  );
}
