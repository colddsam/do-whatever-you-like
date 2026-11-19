"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  CornerLeftDown,
  Eye,
  EyeOff,
  FolderDown,
  Layers as LayersIcon,
  Lock,
  Plus,
  SlidersHorizontal,
  Sparkles,
  SquareDashed,
  Trash2,
  Unlock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { CHECKER } from "../task";
import { ADJUSTMENTS } from "./adjustments";
import { ctx2d } from "./doc";
import { curveLut, type Op, type Param } from "./ops";
import type { BlendMode, Doc, Effects } from "./types";
import { Check2, ColorWell, IconBtn, MenuButton, NumField, RangeRow, Select, type MenuItem } from "./ui";

export const BLEND_MODES: { value: BlendMode; label: string }[] = [
  { value: "normal", label: "Normal" },
  { value: "darken", label: "Darken" },
  { value: "multiply", label: "Multiply" },
  { value: "color-burn", label: "Color Burn" },
  { value: "lighten", label: "Lighten" },
  { value: "screen", label: "Screen" },
  { value: "color-dodge", label: "Color Dodge" },
  { value: "lighter", label: "Linear Dodge (Add)" },
  { value: "overlay", label: "Overlay" },
  { value: "soft-light", label: "Soft Light" },
  { value: "hard-light", label: "Hard Light" },
  { value: "difference", label: "Difference" },
  { value: "exclusion", label: "Exclusion" },
  { value: "hue", label: "Hue" },
  { value: "saturation", label: "Saturation" },
  { value: "color", label: "Color" },
  { value: "luminosity", label: "Luminosity" },
];

/* ---------- Thumbnails ---------- */

export const Thumb = memo(function Thumb({ canvas, size = 36, mask, active, onClick, label }: { canvas: HTMLCanvasElement | null; size?: number; mask?: boolean; active?: boolean; onClick?: (e: React.MouseEvent) => void; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || !canvas) return;
    const k = Math.min(size / canvas.width, size / canvas.height);
    c.width = Math.max(1, Math.round(canvas.width * k * 2));
    c.height = Math.max(1, Math.round(canvas.height * k * 2));
    const g = ctx2d(c);
    g.clearRect(0, 0, c.width, c.height);
    if (mask) {
      // Show the mask as Photoshop does: white shows, black hides.
      g.fillStyle = "#000";
      g.fillRect(0, 0, c.width, c.height);
    }
    g.drawImage(canvas, 0, 0, c.width, c.height);
  }, [canvas, size, mask]);
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn("flex shrink-0 items-center justify-center overflow-hidden rounded-[3px] border", CHECKER, active ? "border-ink ring-1 ring-ink" : "border-line")}
      style={{ width: size, height: size }}
    >
      <canvas ref={ref} className="max-h-full max-w-full" />
    </button>
  );
});

/* ---------- Layers panel ---------- */

export type LayerApi = {
  select: (id: string, mask?: boolean) => void;
  toggleVisible: (id: string) => void;
  rename: (id: string, name: string) => void;
  move: (id: string, toIndex: number) => void;
  setOpacity: (v: number) => void;
  setBlend: (v: BlendMode) => void;
  toggleLock: () => void;
  toggleLockAlpha: () => void;
  add: () => void;
  addAdjustment: (opId: string) => void;
  addMask: () => void;
  duplicate: () => void;
  remove: () => void;
  mergeDown: () => void;
  toggleClip: () => void;
  openStyle: () => void;
  selectPixels: (id: string) => void;
};

export function LayersPanel({ doc, api }: { doc: Doc; api: LayerApi }) {
  const active = doc.layers.find((l) => l.id === doc.active);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const shown = [...doc.layers].reverse();
  const adjItems: MenuItem[] = ADJUSTMENTS.filter((a) => a.layerable).map((a) => ({ label: a.label, onSelect: () => api.addAdjustment(a.id) }));
  return (
    <div className="flex min-h-0 flex-col">
      {/* One row, so short screens still show plenty of layers: blend, opacity (drag the label to scrub), locks. */}
      {active && (
        <div className="border-b border-line px-2 py-1.5">
          <div className="flex items-center gap-1">
            <Select label="Blend mode" value={active.blend} onChange={api.setBlend} options={BLEND_MODES} className="min-w-0 flex-1" />
            <NumField label="Opacity" value={Math.round(active.opacity * 100)} min={0} max={100} onChange={(v) => api.setOpacity(v / 100)} width="w-11" />
            <IconBtn label={active.locked ? "Unlock layer" : "Lock layer"} active={active.locked} onClick={api.toggleLock} className="size-7">
              {active.locked ? <Lock aria-hidden className="size-3.5" /> : <Unlock aria-hidden className="size-3.5" />}
            </IconBtn>
            <IconBtn label="Lock transparent pixels" active={active.lockAlpha} onClick={api.toggleLockAlpha} className="size-7">
              <SquareDashed aria-hidden className="size-3.5" />
            </IconBtn>
            <IconBtn label="Clip to layer below" active={active.clip} onClick={api.toggleClip} className="size-7" shortcut="Alt+Ctrl+G">
              <CornerLeftDown aria-hidden className="size-3.5" />
            </IconBtn>
          </div>
        </div>
      )}
      <ul role="listbox" aria-label="Layers" className="min-h-0 flex-1 overflow-y-auto py-1" data-lenis-prevent>
        {shown.map((l, vi) => {
          const index = doc.layers.length - 1 - vi;
          const isActive = l.id === doc.active;
          return (
            <li
              key={l.id}
              role="option"
              aria-selected={isActive}
              draggable={renaming !== l.id}
              onDragStart={(e) => {
                setDragId(l.id);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => {
                if (!dragId) return;
                e.preventDefault();
                setOver(index);
              }}
              onDragEnd={() => {
                setDragId(null);
                setOver(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragId) api.move(dragId, index);
                setDragId(null);
                setOver(null);
              }}
              onClick={() => api.select(l.id)}
              className={cn(
                "group relative flex cursor-pointer items-center gap-2 border-l-2 py-1.5 pl-1.5 pr-2",
                isActive ? "border-accent bg-paper-2" : "border-transparent hover:bg-paper",
                over === index && dragId !== l.id && "shadow-[inset_0_2px_0_var(--color-ink)]",
                dragId === l.id && "opacity-50",
              )}
            >
              <button
                type="button"
                aria-label={l.visible ? `Hide ${l.name}` : `Show ${l.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  api.toggleVisible(l.id);
                }}
                className="inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-ink-2 hover:bg-surface hover:text-ink"
              >
                {l.visible ? <Eye aria-hidden className="size-3.5" /> : <EyeOff aria-hidden className="size-3.5 text-ink-3" />}
              </button>
              {l.clip && <CornerLeftDown aria-label="Clipped to the layer below" className="size-3.5 shrink-0 text-ink-3" />}
              {l.kind === "adjustment" ? (
                <span title="Adjustment layer" className="flex size-9 shrink-0 items-center justify-center rounded-[3px] border border-line bg-surface">
                  <SlidersHorizontal aria-hidden className="size-4 text-ink-2" />
                </span>
              ) : (
                <Thumb
                  canvas={l.canvas}
                  label={`${l.name} pixels${isActive && !doc.editMask ? " (editing)" : ""}`}
                  active={isActive && !doc.editMask && !!l.mask}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (e.ctrlKey || e.metaKey) api.selectPixels(l.id);
                    else api.select(l.id, false);
                  }}
                />
              )}
              {l.mask && (
                <Thumb
                  canvas={l.mask}
                  mask
                  label={`${l.name} mask${isActive && doc.editMask ? " (editing)" : ""}`}
                  active={isActive && doc.editMask}
                  onClick={(e) => {
                    e.stopPropagation();
                    api.select(l.id, true);
                  }}
                />
              )}
              <div className="min-w-0 flex-1">
                {renaming === l.id ? (
                  <input
                    autoFocus
                    defaultValue={l.name}
                    aria-label="Layer name"
                    onClick={(e) => e.stopPropagation()}
                    onBlur={(e) => {
                      api.rename(l.id, e.target.value.trim() || l.name);
                      setRenaming(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      if (e.key === "Escape") setRenaming(null);
                      e.stopPropagation();
                    }}
                    className="h-6 w-full rounded-sm border border-ink bg-surface px-1 text-[13px] text-ink outline-none"
                  />
                ) : (
                  <p onDoubleClick={() => setRenaming(l.id)} title="Double-click to rename" className={cn("truncate text-[13px]", l.visible ? "text-ink" : "text-ink-3", isActive && "font-medium")}>
                    {l.name}
                  </p>
                )}
                <p className="flex items-center gap-1.5 font-mono text-[12px] uppercase text-ink-3">
                  {l.kind !== "pixel" && <span>{l.kind === "adjustment" ? "adj" : l.kind}</span>}
                  {l.blend !== "normal" && <span>{BLEND_MODES.find((b) => b.value === l.blend)?.label}</span>}
                  {l.opacity < 1 && <span>{Math.round(l.opacity * 100)}%</span>}
                  {l.effects && <span className="text-accent">fx</span>}
                </p>
              </div>
              {l.locked && <Lock aria-label="Locked" className="size-3.5 shrink-0 text-ink-3" />}
              <span className="hidden shrink-0 flex-col group-hover:flex group-focus-within:flex max-lg:flex">
                <button type="button" aria-label={`Move ${l.name} up`} disabled={index === doc.layers.length - 1} onClick={(e) => (e.stopPropagation(), api.move(l.id, index + 1))} className="text-ink-3 hover:text-ink disabled:opacity-30">
                  <ArrowUp aria-hidden className="size-3" />
                </button>
                <button type="button" aria-label={`Move ${l.name} down`} disabled={index === 0} onClick={(e) => (e.stopPropagation(), api.move(l.id, index - 1))} className="text-ink-3 hover:text-ink disabled:opacity-30">
                  <ArrowDown aria-hidden className="size-3" />
                </button>
              </span>
            </li>
          );
        })}
      </ul>
      <div className="flex items-center justify-between gap-0.5 border-t border-line px-1.5 py-1">
        <IconBtn label="Layer style (fx)" onClick={api.openStyle} disabled={!active || active.kind === "adjustment"}>
          <Sparkles aria-hidden className="size-4" />
        </IconBtn>
        <IconBtn label="Add layer mask" onClick={api.addMask} disabled={!active || !!active.mask}>
          <span aria-hidden className="relative inline-flex size-4 items-center justify-center rounded-[3px] border-[1.5px] border-current">
            <span className="size-1.5 rounded-full bg-current" />
          </span>
        </IconBtn>
        <MenuButton label="New adjustment layer" items={adjItems} className="inline-flex size-8 items-center justify-center rounded-sm text-ink-2 hover:bg-paper-2 hover:text-ink">
          <SlidersHorizontal aria-hidden className="size-4" />
        </MenuButton>
        <IconBtn label="Merge down" onClick={api.mergeDown} disabled={!active || doc.layers.indexOf(active) === 0} shortcut="Ctrl+E">
          <FolderDown aria-hidden className="size-4" />
        </IconBtn>
        <IconBtn label="Duplicate layer" onClick={api.duplicate} shortcut="Ctrl+J">
          <Copy aria-hidden className="size-4" />
        </IconBtn>
        <IconBtn label="New layer" onClick={api.add} shortcut="Shift+Ctrl+N">
          <Plus aria-hidden className="size-4" />
        </IconBtn>
        <IconBtn label="Delete layer" onClick={api.remove} disabled={doc.layers.length < 2}>
          <Trash2 aria-hidden className="size-4" />
        </IconBtn>
      </div>
    </div>
  );
}

/* ---------- History ---------- */

export function HistoryPanel({ entries, index, onJump }: { entries: { label: string }[]; index: number; onJump: (i: number) => void }) {
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => {
    ref.current?.querySelector(`[data-i="${index}"]`)?.scrollIntoView({ block: "nearest" });
  }, [index]);
  return (
    <ol ref={ref} className="space-y-px py-1" data-lenis-prevent>
      {entries.map((e, i) => (
        <li key={i} data-i={i}>
          <button
            type="button"
            onClick={() => onJump(i)}
            aria-current={i === index ? "step" : undefined}
            className={cn(
              "flex h-8 w-full items-center gap-2 px-3 text-left text-[13px]",
              i === index ? "bg-ink text-paper" : i > index ? "text-ink-3 hover:bg-paper" : "text-ink-2 hover:bg-paper",
            )}
          >
            <span className="w-5 font-mono text-[12px] opacity-60">{String(i + 1).padStart(2, "0")}</span>
            <span className="truncate">{e.label}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}

/* ---------- Histogram ---------- */

type Hist = { r: Uint32Array; g: Uint32Array; b: Uint32Array; l: Uint32Array };

export function HistogramChart({ hist, channel = "l", height = 80, className }: { hist: Hist | null; channel?: "l" | "r" | "g" | "b" | "rgb"; height?: number; className?: string }) {
  const paths = useMemo(() => {
    if (!hist) return [];
    const list: { key: string; color: string; data: Uint32Array }[] =
      channel === "rgb"
        ? [
            { key: "r", color: "rgba(220,38,38,0.45)", data: hist.r },
            { key: "g", color: "rgba(22,163,74,0.45)", data: hist.g },
            { key: "b", color: "rgba(37,99,235,0.45)", data: hist.b },
          ]
        : [{ key: channel, color: channel === "l" ? "var(--color-ink-3)" : channel === "r" ? "rgba(220,38,38,0.6)" : channel === "g" ? "rgba(22,163,74,0.6)" : "rgba(37,99,235,0.6)", data: hist[channel] }];
    // Scale to the 99th-percentile bar so one spike (pure white) doesn't flatten everything.
    const all = list.flatMap((x) => Array.from(x.data)).sort((a, b) => a - b);
    const top = Math.max(1, all[Math.floor(all.length * 0.99)] ?? 1);
    return list.map((x) => {
      let d = `M0 ${height}`;
      for (let i = 0; i < 256; i++) d += ` L${i} ${height - Math.min(1, x.data[i] / top) * height}`;
      return { ...x, d: `${d} L255 ${height} Z` };
    });
  }, [hist, channel, height]);
  return (
    <svg viewBox={`0 0 256 ${height}`} preserveAspectRatio="none" className={cn("block w-full", className)} style={{ height }} aria-hidden>
      {paths.map((p) => (
        <path key={p.key} d={p.d} fill={p.color} style={{ mixBlendMode: "multiply" }} />
      ))}
    </svg>
  );
}

/* ---------- Curves ---------- */

type Curves = Record<"rgb" | "r" | "g" | "b", [number, number][]>;

function CurvesEditor({ value, onChange, hist }: { value: Curves; onChange: (v: Curves) => void; hist: Hist | null }) {
  const [ch, setCh] = useState<keyof Curves>("rgb");
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<number | null>(null);
  const pts = value[ch];
  const table = useMemo(() => curveLut(pts), [pts]);
  const path = useMemo(() => Array.from(table, (v, i) => `${i ? "L" : "M"}${i} ${255 - v}`).join(" "), [table]);
  const toPt = (e: React.PointerEvent): [number, number] => {
    const r = svg.current!.getBoundingClientRect();
    return [Math.round(Math.min(255, Math.max(0, ((e.clientX - r.left) / r.width) * 255))), Math.round(Math.min(255, Math.max(0, 255 - ((e.clientY - r.top) / r.height) * 255)))];
  };
  const set = (next: [number, number][]) => onChange({ ...value, [ch]: next });
  const stroke = ch === "rgb" ? "var(--color-ink)" : ch === "r" ? "#dc2626" : ch === "g" ? "#16a34a" : "#2563eb";
  return (
    <div className="space-y-2">
      <div className="flex gap-1">
        {(["rgb", "r", "g", "b"] as const).map((c) => (
          <button key={c} type="button" onClick={() => setCh(c)} className={cn("h-7 rounded-sm px-2.5 font-mono text-[12px] uppercase", ch === c ? "bg-ink text-paper" : "border border-line text-ink-2 hover:text-ink")}>
            {c}
          </button>
        ))}
        <button type="button" onClick={() => set([[0, 0], [255, 255]])} className="ml-auto h-7 px-2 text-[12px] text-ink-2 underline-offset-2 hover:text-ink hover:underline">
          Reset
        </button>
      </div>
      <div className="relative aspect-square w-full rounded-sm border border-line bg-paper">
        <HistogramChart hist={hist} channel={ch === "rgb" ? "l" : ch} height={256} className="absolute inset-0 !h-full opacity-60" />
        <svg
          ref={svg}
          viewBox="0 0 255 255"
          className="absolute inset-0 size-full touch-none"
          onPointerDown={(e) => {
            const [x, y] = toPt(e);
            const near = pts.findIndex((p) => Math.hypot(p[0] - x, p[1] - y) < 12);
            (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
            if (near >= 0) drag.current = near;
            else {
              const next = [...pts, [x, table[x] ?? y] as [number, number]].sort((a, b) => a[0] - b[0]);
              drag.current = next.findIndex((p) => p[0] === x);
              set(next);
            }
          }}
          onPointerMove={(e) => {
            if (drag.current === null) return;
            const [x, y] = toPt(e);
            const i = drag.current;
            const next = pts.map((p) => [...p] as [number, number]);
            const lo = i === 0 ? 0 : next[i - 1][0] + 1;
            const hi = i === next.length - 1 ? 255 : next[i + 1][0] - 1;
            next[i] = [i === 0 || i === next.length - 1 ? next[i][0] : Math.min(hi, Math.max(lo, x)), y];
            set(next);
          }}
          onPointerUp={() => (drag.current = null)}
          onDoubleClick={(e) => {
            const [x, y] = toPt(e as unknown as React.PointerEvent);
            const near = pts.findIndex((p) => Math.hypot(p[0] - x, p[1] - y) < 12);
            if (near > 0 && near < pts.length - 1) set(pts.filter((_, i) => i !== near));
          }}
        >
          {[64, 128, 192].map((v) => (
            <g key={v} stroke="var(--color-line)" strokeWidth={0.6}>
              <line x1={v} y1={0} x2={v} y2={255} />
              <line x1={0} y1={v} x2={255} y2={v} />
            </g>
          ))}
          <line x1={0} y1={255} x2={255} y2={0} stroke="var(--color-ink-3)" strokeWidth={0.6} strokeDasharray="3 3" />
          <path d={path} fill="none" stroke={stroke} strokeWidth={1.6} />
          {pts.map((p, i) => (
            <rect key={i} x={p[0] - 3.5} y={255 - p[1] - 3.5} width={7} height={7} fill="var(--color-surface)" stroke={stroke} strokeWidth={1.4} />
          ))}
        </svg>
      </div>
      <p className="text-[12px] leading-relaxed text-ink-3">Click the line to add a point, drag it to bend, double-click a point to remove it.</p>
    </div>
  );
}

/* ---------- Levels ---------- */

type Levels = { channel: "rgb" | "r" | "g" | "b"; inLo: number; inHi: number; gamma: number; outLo: number; outHi: number };

function LevelsEditor({ value, onChange, hist }: { value: Levels; onChange: (v: Levels) => void; hist: Hist | null }) {
  const set = (p: Partial<Levels>) => onChange({ ...value, ...p });
  return (
    <div className="space-y-1">
      <div className="flex gap-1 pb-1">
        {(["rgb", "r", "g", "b"] as const).map((c) => (
          <button key={c} type="button" onClick={() => set({ channel: c })} className={cn("h-7 rounded-sm px-2.5 font-mono text-[12px] uppercase", value.channel === c ? "bg-ink text-paper" : "border border-line text-ink-2 hover:text-ink")}>
            {c}
          </button>
        ))}
      </div>
      <div className="relative rounded-sm border border-line bg-paper">
        <HistogramChart hist={hist} channel={value.channel === "rgb" ? "l" : value.channel} height={90} />
        {/* Where the black, grey and white points sit. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-full">
          {[value.inLo, value.inLo + (value.inHi - value.inLo) * Math.pow(0.5, value.gamma), value.inHi].map((v, i) => (
            <span key={i} className={cn("absolute bottom-0 h-full w-px", i === 1 ? "bg-ink-3" : "bg-ink")} style={{ left: `${(v / 255) * 100}%` }} />
          ))}
        </div>
      </div>
      <RangeRow label="Black point" value={value.inLo} min={0} max={Math.min(253, value.inHi - 2)} onChange={(v) => set({ inLo: v })} />
      <RangeRow label="Midtones (gamma)" value={value.gamma} min={0.1} max={4} step={0.01} onChange={(v) => set({ gamma: v })} />
      <RangeRow label="White point" value={value.inHi} min={Math.max(2, value.inLo + 2)} max={255} onChange={(v) => set({ inHi: v })} />
      <RangeRow label="Output black" value={value.outLo} min={0} max={255} onChange={(v) => set({ outLo: v })} />
      <RangeRow label="Output white" value={value.outHi} min={0} max={255} onChange={(v) => set({ outHi: v })} />
    </div>
  );
}

/* ---------- Any operation's settings ---------- */

export function ParamsEditor({ op, value, onChange, hist }: { op: Op; value: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void; hist: Hist | null }) {
  const set = (k: string, v: unknown) => onChange({ ...value, [k]: v });
  if (!op.params.length) return <p className="text-[13px] text-ink-3">No settings: it applies as it is.</p>;
  return (
    <div className="space-y-1.5">
      {op.params.map((p: Param) => {
        if (p.when && value[p.when[0]] !== p.when[1]) return null;
        switch (p.type) {
          case "range":
            return <RangeRow key={p.key} label={p.label} value={Number(value[p.key])} min={p.min} max={p.max} step={p.step} unit={p.unit} signed={p.min < 0} onChange={(v) => set(p.key, v)} />;
          case "color":
            return (
              <div key={p.key} className="flex items-center justify-between py-1">
                <span className="text-[12px] text-ink-2">{p.label}</span>
                <ColorWell value={String(value[p.key])} onChange={(v) => set(p.key, v)} label={p.label} hex />
              </div>
            );
          case "toggle":
            return (
              <div key={p.key} className="py-1">
                <Check2 checked={Boolean(value[p.key])} onChange={(v) => set(p.key, v)} label={p.label} />
              </div>
            );
          case "choice":
            return (
              <div key={p.key} className="py-1">
                <p className="mb-1 text-[12px] text-ink-2">{p.label}</p>
                <div className="flex flex-wrap gap-1">
                  {p.options.map((o) => (
                    <button key={o.value} type="button" onClick={() => set(p.key, o.value)} className={cn("h-7 rounded-sm px-2.5 text-[12px]", value[p.key] === o.value ? "bg-ink text-paper" : "border border-line text-ink-2 hover:text-ink")}>
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
            );
          case "curve":
            return <CurvesEditor key={p.key} value={value[p.key] as Curves} onChange={(v) => set(p.key, v)} hist={hist} />;
          case "levels":
            return <LevelsEditor key={p.key} value={value[p.key] as Levels} onChange={(v) => set(p.key, v)} hist={hist} />;
        }
      })}
    </div>
  );
}

/* ---------- Layer style ---------- */

export function EffectsEditor({ value, onChange }: { value: Effects; onChange: (v: Effects) => void }) {
  const set = <K extends keyof Effects>(k: K, p: Partial<Effects[K]>) => onChange({ ...value, [k]: { ...value[k], ...p } });
  const Section = ({ k, title, children }: { k: keyof Effects; title: string; children: React.ReactNode }) => (
    <div className="border-b border-line py-2.5 last:border-0">
      <div className="flex items-center justify-between">
        <Check2 checked={value[k].on} onChange={(on) => set(k, { on })} label={title} />
        <ColorWell value={value[k].color} onChange={(color) => set(k, { color })} label={`${title} colour`} size="size-6" />
      </div>
      {value[k].on && <div className="mt-1.5 pl-5">{children}</div>}
    </div>
  );
  return (
    <div>
      {Section({
        k: "shadow",
        title: "Drop shadow",
        children: (
          <>
            <RangeRow label="Opacity" value={value.shadow.opacity} min={0} max={100} unit="%" onChange={(opacity) => set("shadow", { opacity })} />
            <RangeRow label="Angle" value={value.shadow.angle} min={-180} max={180} unit="°" onChange={(angle) => set("shadow", { angle })} />
            <RangeRow label="Distance" value={value.shadow.distance} min={0} max={200} unit=" px" onChange={(distance) => set("shadow", { distance })} />
            <RangeRow label="Size" value={value.shadow.size} min={0} max={150} unit=" px" onChange={(size) => set("shadow", { size })} />
          </>
        ),
      })}
      {Section({
        k: "glow",
        title: "Outer glow",
        children: (
          <>
            <RangeRow label="Opacity" value={value.glow.opacity} min={0} max={100} unit="%" onChange={(opacity) => set("glow", { opacity })} />
            <RangeRow label="Size" value={value.glow.size} min={1} max={150} unit=" px" onChange={(size) => set("glow", { size })} />
          </>
        ),
      })}
      {Section({
        k: "stroke",
        title: "Stroke",
        children: <RangeRow label="Size" value={value.stroke.size} min={1} max={60} unit=" px" onChange={(size) => set("stroke", { size })} />,
      })}
      {Section({
        k: "overlay",
        title: "Color overlay",
        children: <RangeRow label="Opacity" value={value.overlay.opacity} min={0} max={100} unit="%" onChange={(opacity) => set("overlay", { opacity })} />,
      })}
    </div>
  );
}

export const PanelTitle = ({ children, icon: Icon = LayersIcon }: { children: React.ReactNode; icon?: typeof LayersIcon }) => (
  <p className="label-mono flex items-center gap-1.5 text-ink-3">
    <Icon aria-hidden className="size-3.5" />
    {children}
  </p>
);
