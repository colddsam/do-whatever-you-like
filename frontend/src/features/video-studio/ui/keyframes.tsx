"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { EFFECTS } from "../constants";
import { bezierOf, evalAnim, removeKey, updateKey } from "../lib/keyframes";
import { formatValue, getAnim, propSpec, withAnim, type PropPath } from "../lib/props";
import { clamp, rt } from "../lib/time";
import * as TL from "../lib/timeline";
import { getStudio, usePrimaryClip, useStudio } from "../store/studio-store";
import type { Bezier, Clip, Ease, Keyframe } from "../types";
import { TRANSFORM_PROPS } from "../types";
import { Empty, IconButton, Section } from "./controls";

/**
 * The animation panel, After Effects' timeline in miniature: one lane per property with its keyframe
 * diamonds (drag to retime, click to jump there), a value graph for the property in focus (drag a key
 * in time and value), and the easing of the selected key, with a cubic-bezier editor.
 */

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(240);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

function editKey(c: Clip, path: PropPath, keyId: string, patch: Partial<Omit<Keyframe, "id">>, merge?: string) {
  getStudio().commit((p) => TL.updateClip(p, c.id, (x) => withAnim(x, path, updateKey(getAnim(x, path)!, keyId, patch))), merge ? { merge } : undefined);
}

function Lane({ c, path, active }: { c: Clip; path: PropPath; active: boolean }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const playhead = useStudio((s) => s.playhead);
  const selectedKey = useStudio((s) => s.selectedKey);
  const a = getAnim(c, path);
  const drag = useRef<{ id: string; x0: number; t0: number; moved: boolean } | null>(null);
  const st = getStudio();
  if (!a) return null;
  const toX = (t: number) => (clamp(t, 0, c.duration) / Math.max(1e-6, c.duration)) * w;
  return (
    <div ref={ref} className={cn("relative h-7 rounded-sm sm:h-6", active ? "bg-paper/10" : "bg-paper/[0.03]")}>
      <span className="absolute inset-y-0 w-px bg-accent/70" style={{ left: toX(playhead - c.start) }} />
      {a.k?.map((k) => (
        <button
          key={k.id}
          type="button"
          aria-label={`Keyframe at ${k.t.toFixed(2)} s`}
          className={cn("absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rotate-45 touch-none border sm:size-3", k.id === selectedKey ? "border-paper bg-accent" : "border-accent bg-ink hover:bg-accent/50")}
          style={{ left: toX(k.t) }}
          onPointerDown={(e) => {
            e.stopPropagation();
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            drag.current = { id: k.id, x0: e.clientX, t0: k.t, moved: false };
            st.set({ selectedKey: k.id, activeProp: path });
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d) return;
            if (!d.moved && Math.abs(e.clientX - d.x0) < 3) return;
            if (!d.moved) {
              d.moved = true;
              st.begin();
            }
            const fps = st.project.settings.fps;
            const t = clamp(d.t0 + ((e.clientX - d.x0) / w) * c.duration, 0, c.duration);
            editKey(c, path, d.id, { t: Math.round(t * fps) / fps });
          }}
          onPointerUp={() => {
            const d = drag.current;
            drag.current = null;
            if (d?.moved) st.end();
            else st.set({ playing: false, playhead: rt(c.start + k.t) });
          }}
        />
      ))}
    </div>
  );
}

function Graph({ c, path }: { c: Clip; path: PropPath }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const frame = useStudio(useShallow((s) => ({ width: s.project.settings.width, height: s.project.settings.height })));
  const playhead = useStudio((s) => s.playhead);
  const selectedKey = useStudio((s) => s.selectedKey);
  const drag = useRef<{ id: string; x0: number; y0: number; t0: number; v0: number; moved: boolean } | null>(null);
  const a = getAnim(c, path);
  const spec = propSpec(c, path, frame);
  const H = 150;
  const pad = 10;
  if (!a) return null;
  const N = 120;
  const samples = Array.from({ length: N + 1 }, (_, i) => evalAnim(a, (c.duration * i) / N));
  const values = [...samples, ...(a.k?.map((k) => k.v) ?? [])];
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (hi - lo < 1e-6) {
    lo -= Math.max(1, Math.abs(lo) * 0.1);
    hi += Math.max(1, Math.abs(hi) * 0.1);
  }
  const span = hi - lo;
  lo -= span * 0.12;
  hi += span * 0.12;
  const X = (t: number) => pad + (t / Math.max(1e-6, c.duration)) * (w - 2 * pad);
  const Y = (v: number) => H - pad - ((v - lo) / (hi - lo)) * (H - 2 * pad);
  const st = getStudio();
  return (
    <div ref={ref} className="relative mt-2 select-none rounded-sm border border-line-dark bg-ink">
      <svg width={w} height={H} className="block" aria-label={`${spec.label} over time`}>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={pad} x2={w - pad} y1={pad + f * (H - 2 * pad)} y2={pad + f * (H - 2 * pad)} className="stroke-line-dark" />
        ))}
        <polyline points={samples.map((v, i) => `${X((c.duration * i) / N)},${Y(v)}`).join(" ")} className="fill-none stroke-paper" strokeWidth={1.5} />
        <line x1={X(clamp(playhead - c.start, 0, c.duration))} x2={X(clamp(playhead - c.start, 0, c.duration))} y1={0} y2={H} className="stroke-accent" />
        {a.k?.map((k) => (
          <circle
            key={k.id}
            cx={X(k.t)}
            cy={Y(k.v)}
            r={k.id === selectedKey ? 6 : 5}
            className={cn("cursor-move touch-none", k.id === selectedKey ? "fill-accent stroke-paper" : "fill-ink stroke-accent")}
            strokeWidth={1.5}
            onPointerDown={(e) => {
              (e.target as Element).setPointerCapture(e.pointerId);
              drag.current = { id: k.id, x0: e.clientX, y0: e.clientY, t0: k.t, v0: k.v, moved: false };
              st.set({ selectedKey: k.id });
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (!d) return;
              if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 3) return;
              if (!d.moved) {
                d.moved = true;
                st.begin();
              }
              const fps = st.project.settings.fps;
              const t = clamp(d.t0 + ((e.clientX - d.x0) / (w - 2 * pad)) * c.duration, 0, c.duration);
              const v = clamp(d.v0 - ((e.clientY - d.y0) / (H - 2 * pad)) * (hi - lo), spec.min, spec.max);
              editKey(c, path, d.id, { t: e.shiftKey ? d.t0 : Math.round(t * fps) / fps, v: Math.round(v / spec.step) * spec.step });
            }}
            onPointerUp={() => {
              const d = drag.current;
              drag.current = null;
              if (d?.moved) st.end();
              else st.set({ playing: false, playhead: rt(c.start + k.t) });
            }}
          />
        ))}
      </svg>
      <span className="pointer-events-none absolute right-1.5 top-1 font-mono text-[12px] text-paper-dim">{formatValue(spec, hi)}</span>
      <span className="pointer-events-none absolute bottom-1 right-1.5 font-mono text-[12px] text-paper-dim">{formatValue(spec, lo)}</span>
    </div>
  );
}

const EASES: { value: Ease; label: string }[] = [
  { value: "linear", label: "Linear" },
  { value: "easeIn", label: "In" },
  { value: "easeOut", label: "Out" },
  { value: "easeInOut", label: "In-out" },
  { value: "back", label: "Back" },
  { value: "elastic", label: "Elastic" },
  { value: "bounce", label: "Bounce" },
  { value: "hold", label: "Hold" },
  { value: "bezier", label: "Custom" },
];

function BezierEditor({ value, onChange, onStart, onEnd }: { value: Bezier; onChange: (b: Bezier) => void; onStart: () => void; onEnd: () => void }) {
  const S = 132;
  const pad = 22;
  const ref = useRef<SVGSVGElement>(null);
  const which = useRef<0 | 1 | null>(null);
  const [x1, y1, x2, y2] = value;
  const P = (x: number, y: number) => [pad + x * (S - 2 * pad), S - pad - y * (S - 2 * pad)];
  const [ax, ay] = P(0, 0);
  const [bx, by] = P(1, 1);
  const [c1x, c1y] = P(x1, y1);
  const [c2x, c2y] = P(x2, y2);
  const move = (e: React.PointerEvent) => {
    if (which.current === null) return;
    const r = ref.current!.getBoundingClientRect();
    const x = clamp((e.clientX - r.left - pad) / (S - 2 * pad), 0, 1);
    const y = clamp((S - pad - (e.clientY - r.top)) / (S - 2 * pad), -0.6, 1.6);
    const r3 = (n: number) => Math.round(n * 100) / 100;
    onChange(which.current === 0 ? [r3(x), r3(y), x2, y2] : [x1, y1, r3(x), r3(y)]);
  };
  return (
    <div className="flex items-start gap-3">
      <svg ref={ref} width={S} height={S} className="shrink-0 touch-none rounded-sm border border-line-dark bg-ink" onPointerMove={move} onPointerUp={() => (which.current !== null ? ((which.current = null), onEnd()) : undefined)} aria-label="Easing curve">
        <rect x={ax} y={by} width={bx - ax} height={ay - by} className="fill-none stroke-line-dark" />
        <line x1={ax} y1={ay} x2={c1x} y2={c1y} className="stroke-paper-dim" />
        <line x1={bx} y1={by} x2={c2x} y2={c2y} className="stroke-paper-dim" />
        <path d={`M${ax},${ay} C${c1x},${c1y} ${c2x},${c2y} ${bx},${by}`} className="fill-none stroke-paper" strokeWidth={2} />
        {[
          [c1x, c1y],
          [c2x, c2y],
        ].map(([x, y], i) => (
          <circle
            key={i}
            cx={x}
            cy={y}
            r={6}
            className="cursor-grab fill-accent stroke-paper"
            strokeWidth={1.5}
            onPointerDown={(e) => {
              (e.target as Element).setPointerCapture(e.pointerId);
              which.current = i as 0 | 1;
              onStart();
            }}
          />
        ))}
      </svg>
      <p className="min-w-0 break-all font-mono text-[12px] leading-relaxed text-paper-dim">
        cubic-bezier(
        <br />
        {value.join(", ")})
      </p>
    </div>
  );
}

export function KeyframeEditor() {
  const c = usePrimaryClip();
  const activeProp = useStudio((s) => s.activeProp);
  const selectedKey = useStudio((s) => s.selectedKey);
  const frame = useStudio(useShallow((s) => ({ width: s.project.settings.width, height: s.project.settings.height })));
  const st = getStudio();
  if (!c) return <Empty>Select a clip to animate it. Turn on a property&apos;s diamond, move the playhead, and change the value: that&apos;s a keyframe.</Empty>;
  const paths: PropPath[] = [];
  if (c.kind !== "audio") paths.push(...TRANSFORM_PROPS);
  for (const e of c.effects) for (const p of EFFECTS[e.type].params) paths.push(`fx:${e.id}:${p.key}`);
  if (c.kind === "audio") paths.push("volume");
  const focus = activeProp && paths.includes(activeProp) ? activeProp : (paths.find((p) => getAnim(c, p)?.k?.length) ?? paths[0]);
  const a = getAnim(c, focus);
  const key = a?.k?.find((k) => k.id === selectedKey);
  const isLast = !!key && a?.k?.[a.k.length - 1]?.id === key.id;
  return (
    <div>
      <Section title="Keyframes">
        <ul className="space-y-1">
          {paths.map((p) => {
            const spec = propSpec(c, p, frame);
            return (
              <li key={p} className="grid grid-cols-[92px_minmax(0,1fr)] items-center gap-2">
                <button
                  type="button"
                  onClick={() => st.set({ activeProp: p })}
                  className={cn("truncate text-left text-[12px]", p === focus ? "text-paper" : "text-paper-dim hover:text-paper")}
                  title={spec.label}
                >
                  {spec.label.replace(/^.* · /, "")}
                </button>
                <Lane c={c} path={p} active={p === focus} />
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-[12px] leading-relaxed text-paper-dim">Use the diamonds in the Clip tab to add keys. Drag a key to retime it; click it to jump there.</p>
      </Section>
      <Section title={`Graph · ${propSpec(c, focus, frame).label}`}>
        {a?.k?.length ? <Graph c={c} path={focus} /> : <p className="text-[12px] text-paper-dim">No keyframes on this property yet.</p>}
      </Section>
      <Section title="Easing">
        {!key ? (
          <p className="text-[12px] leading-relaxed text-paper-dim">Select a keyframe to set how the value travels to the next one.</p>
        ) : isLast ? (
          <p className="text-[12px] leading-relaxed text-paper-dim">This is the last keyframe: easing shapes the move to the next key, and there isn&apos;t one.</p>
        ) : (
          <>
            <div role="radiogroup" aria-label="Easing" className="mb-2 grid grid-cols-3 gap-1">
              {EASES.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  role="radio"
                  aria-checked={key.ease === o.value}
                  onClick={() => editKey(c, focus, key.id, { ease: o.value, ...(o.value === "bezier" ? { bezier: bezierOf(key) } : {}) })}
                  className={cn(
                    "h-8 rounded-sm border text-[12px] transition-colors sm:h-7",
                    key.ease === o.value ? "border-paper bg-paper text-ink" : "border-line-dark text-paper-dim hover:border-paper/40 hover:text-paper",
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
            {key.ease !== "hold" && (
              <BezierEditor
                value={bezierOf(key)}
                onStart={st.begin}
                onEnd={st.end}
                onChange={(b) => editKey(c, focus, key.id, { ease: "bezier", bezier: b })}
              />
            )}
          </>
        )}
        {key && (
          <div className="mt-2 flex items-center gap-2">
            <span className="font-mono text-[12px] text-paper-dim">
              {key.t.toFixed(2)} s · {formatValue(propSpec(c, focus, frame), key.v)}
            </span>
            <IconButton
              label="Delete keyframe"
              className="ml-auto size-7"
              onClick={() => {
                st.commit((p) => TL.updateClip(p, c.id, (x) => withAnim(x, focus, removeKey(getAnim(x, focus)!, key.id))));
                st.set({ selectedKey: null });
              }}
            >
              <Trash2 aria-hidden className="size-3.5" />
            </IconButton>
          </div>
        )}
      </Section>
    </div>
  );
}
