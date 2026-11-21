"use client";

import { useMemo, useRef, useState } from "react";
import { Download, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { CURVE_PRESETS, evalMonotoneSpline, exportGradeAsCube, HSL_BANDS, IDENTITY_CURVE, parseCurvePoints, parseHsl, serializeCurvePoints, serializeHsl, type CurveChannel, type CurvePoint } from "../engine/color";
import { download } from "../engine/subtitles";
import { anim, evalAnim } from "../lib/keyframes";
import { clamp } from "../lib/time";
import { getStudio, useStudio } from "../store/studio-store";
import type { Clip, Effect } from "../types";
import { IconButton, Row, Segmented, Slider, TextButton } from "./controls";

/* ---------- 3-Way Color Wheels (Lift / Gamma / Gain) ---------- */

const WHEEL_CHANNELS = [
  { id: "lift", label: "Lift (Shadows)", kr: "liftR", kg: "liftG", kb: "liftB", ky: "liftY" },
  { id: "gamma", label: "Gamma (Mids)", kr: "gammaR", kg: "gammaG", kb: "gammaB", ky: "gammaY" },
  { id: "gain", label: "Gain (Highlights)", kr: "gainR", kg: "gainG", kb: "gainB", ky: "gainY" },
] as const;

/** Maps colour wheel polar `(x, y)` in `-1..1` to balanced RGB offsets. */
function xyToRgbDelta(x: number, y: number): [number, number, number] {
  const angle = Math.atan2(-y, x);
  const mag = Math.min(1, Math.hypot(x, y)) * 0.45;
  const r = Math.cos(angle) * mag;
  const g = Math.cos(angle - (2 * Math.PI) / 3) * mag;
  const b = Math.cos(angle + (2 * Math.PI) / 3) * mag;
  const mean = (r + g + b) / 3;
  return [Number((r - mean).toFixed(4)), Number((g - mean).toFixed(4)), Number((b - mean).toFixed(4))];
}

function rgbDeltaToXy(r: number, g: number, b: number): [number, number] {
  const x = (2 * r - g - b) / 3;
  const y = -((g - b) / Math.sqrt(3));
  const len = Math.hypot(x, y);
  const scale = 1 / 0.45;
  if (len * scale > 1) return [(x * scale) / (len * scale), (y * scale) / (len * scale)];
  return [x * scale, y * scale];
}

function WheelPad({
  label,
  r,
  g,
  b,
  yVal,
  onColor,
  onY,
  onReset,
}: {
  label: string;
  r: number;
  g: number;
  b: number;
  yVal: number;
  onColor: (nr: number, ng: number, nb: number) => void;
  onY: (ny: number) => void;
  onReset: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const active = useRef(false);
  const [px, py] = rgbDeltaToXy(r, g, b);

  const pick = (clientX: number, clientY: number) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const rad = rect.width / 2;
    let dx = (clientX - cx) / rad;
    let dy = (clientY - cy) / rad;
    const d = Math.hypot(dx, dy);
    if (d > 1) {
      dx /= d;
      dy /= d;
    }
    const [nr, ng, nb] = xyToRgbDelta(dx, dy);
    onColor(nr, ng, nb);
  };

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="flex w-full items-center justify-between gap-1">
        <span className="truncate text-[12px] text-paper-dim">{label.split(" ")[0]}</span>
        <button type="button" onClick={onReset} title={`Reset ${label}`} className="text-[12px] text-paper-dim hover:text-paper">
          <RotateCcw aria-hidden className="size-3" />
        </button>
      </div>
      <div
        ref={ref}
        role="slider"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(Math.hypot(px, py) * 100)}
        aria-valuetext={`R ${r.toFixed(2)} G ${g.toFixed(2)} B ${b.toFixed(2)}`}
        tabIndex={0}
        onDoubleClick={onReset}
        onPointerDown={(ev) => {
          ev.currentTarget.setPointerCapture(ev.pointerId);
          active.current = true;
          getStudio().begin();
          pick(ev.clientX, ev.clientY);
        }}
        onPointerMove={(ev) => {
          if (active.current) pick(ev.clientX, ev.clientY);
        }}
        onPointerUp={() => {
          if (active.current) {
            active.current = false;
            getStudio().end();
          }
        }}
        className="relative size-[84px] cursor-crosshair touch-none rounded-full border border-line-dark sm:size-[74px]"
        style={{
          background:
            "radial-gradient(circle, rgba(255,255,255,0.85) 0%, rgba(255,255,255,0) 68%), conic-gradient(from 90deg, #ff3b30, #ffd60a, #39ff88, #00e5ff, #3b82f6, #d946ef, #ff3b30)",
        }}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ink bg-paper shadow-float"
          style={{ left: `${50 + px * 42}%`, top: `${50 + py * 42}%` }}
        />
      </div>
      <Slider label={`${label} luminance`} value={yVal} min={-0.5} max={0.5} step={0.005} neutral={0} onChange={onY} />
      <span className="font-mono text-[12px] tabular-nums text-paper-dim">{(yVal >= 0 ? "+" : "") + yVal.toFixed(2)}</span>
    </div>
  );
}

export function ColorWheelsControl({ c, e }: { c: Clip; e: Effect }) {
  const playhead = useStudio((s) => s.playhead);
  const local = clamp(playhead - c.start, 0, c.duration);
  const st = getStudio();
  const val = (k: string) => evalAnim(e.params[k] ?? anim(0), local);
  const setKeys = (entries: Record<string, number>) => {
    st.commit((p) => ({
      ...p,
      clips: {
        ...p.clips,
        [c.id]: {
          ...p.clips[c.id],
          effects: p.clips[c.id].effects.map((fx) => {
            if (fx.id !== e.id) return fx;
            const nextParams = { ...fx.params };
            for (const [k, v] of Object.entries(entries)) nextParams[k] = anim(v);
            return { ...fx, params: nextParams };
          }),
        },
      },
    }), { merge: `wheels:${e.id}` });
  };

  return (
    <div className="my-1 space-y-2">
      <div className="grid grid-cols-3 gap-2">
        {WHEEL_CHANNELS.map((ch) => (
          <WheelPad
            key={ch.id}
            label={ch.label}
            r={val(ch.kr)}
            g={val(ch.kg)}
            b={val(ch.kb)}
            yVal={val(ch.ky)}
            onColor={(nr, ng, nb) => setKeys({ [ch.kr]: nr, [ch.kg]: ng, [ch.kb]: nb })}
            onY={(ny) => setKeys({ [ch.ky]: ny })}
            onReset={() => setKeys({ [ch.kr]: 0, [ch.kg]: 0, [ch.kb]: 0, [ch.ky]: 0 })}
          />
        ))}
      </div>
      <div className="flex items-center gap-1.5 pt-1">
        <TextButton
          className="flex-1"
          onClick={() =>
            setKeys({
              liftR: 0, liftG: 0, liftB: 0, liftY: 0,
              gammaR: 0, gammaG: 0, gammaB: 0, gammaY: 0,
              gainR: 0, gainG: 0, gainB: 0, gainY: 0,
            })
          }
        >
          <RotateCcw aria-hidden className="size-3.5" />
          Reset all wheels
        </TextButton>
        <IconButton
          label="Export active grade as .cube 3D LUT"
          onClick={() => {
            const cube = exportGradeAsCube(c.effects, `${c.name} Grade`);
            download(new Blob([cube], { type: "text/plain" }), `${c.name || "grade"}.cube`);
          }}
        >
          <Download aria-hidden className="size-3.5" />
        </IconButton>
      </div>
    </div>
  );
}

/* ---------- RGB Tone Curves ---------- */

export function CurvesControl({ c, e }: { c: Clip; e: Effect }) {
  const [channel, setChannel] = useState<CurveChannel>("points");
  const svgRef = useRef<SVGSVGElement>(null);
  const dragIdx = useRef<number | null>(null);
  const st = getStudio();

  const raw = e.options?.[channel];
  const pts = useMemo(() => parseCurvePoints(raw), [raw]);

  const setPts = (next: CurvePoint[], ch: CurveChannel = channel) => {
    st.updateEffect(c.id, e.id, { options: { ...e.options, [ch]: serializeCurvePoints(next) } });
  };

  const applyPreset = (id: string) => {
    const preset = CURVE_PRESETS.find((x) => x.id === id);
    if (!preset) return;
    st.updateEffect(c.id, e.id, {
      options: {
        ...e.options,
        points: serializeCurvePoints(preset.points),
        r: preset.r ? serializeCurvePoints(preset.r) : serializeCurvePoints(IDENTITY_CURVE),
        g: serializeCurvePoints(IDENTITY_CURVE),
        b: preset.b ? serializeCurvePoints(preset.b) : serializeCurvePoints(IDENTITY_CURVE),
      },
    });
  };

  const S = 196;
  const pad = 10;
  const toSvg = (v: number, yAxis = false) => pad + (yAxis ? 1 - v : v) * (S - 2 * pad);
  const fromEvent = (ev: React.PointerEvent): CurvePoint => {
    const rect = svgRef.current!.getBoundingClientRect();
    const x = clamp((ev.clientX - rect.left - pad) / (S - 2 * pad), 0, 1);
    const y = clamp(1 - (ev.clientY - rect.top - pad) / (S - 2 * pad), 0, 1);
    return [x, y];
  };

  const strokeColor = channel === "r" ? "#ef4444" : channel === "g" ? "#22c55e" : channel === "b" ? "#3b82f6" : "#f3f0e8";
  const pathD = useMemo(() => {
    const segs: string[] = [];
    for (let i = 0; i <= 48; i++) {
      const x = i / 48;
      const y = evalMonotoneSpline(pts, x);
      segs.push(`${i === 0 ? "M" : "L"}${toSvg(x).toFixed(1)},${toSvg(y, true).toFixed(1)}`);
    }
    return segs.join(" ");
  }, [pts]);

  return (
    <div className="my-1 space-y-2">
      <Segmented<CurveChannel>
        label="Curve channel"
        value={channel}
        onChange={setChannel}
        options={[
          { value: "points", label: "RGB" },
          { value: "r", label: "Red" },
          { value: "g", label: "Green" },
          { value: "b", label: "Blue" },
        ]}
      />
      <div className="flex justify-center">
        <svg
          ref={svgRef}
          width={S}
          height={S}
          aria-label="Tone curve editor"
          className="cursor-crosshair touch-none rounded-sm border border-line-dark bg-ink"
          onPointerDown={(ev) => {
            if (dragIdx.current !== null) return;
            const [x, y] = fromEvent(ev);
            // Click near existing point first
            const tol = ev.pointerType === "touch" ? 0.11 : 0.06;
            let hit = -1;
            pts.forEach(([px, py], i) => {
              if (Math.hypot(px - x, py - y) < tol) hit = i;
            });
            if (hit >= 0) {
              dragIdx.current = hit;
            } else {
              const next = [...pts, [x, y] as CurvePoint].sort((a, b) => a[0] - b[0]);
              hit = next.findIndex(([px, py]) => px === x && py === y);
              dragIdx.current = hit;
              setPts(next);
            }
            ev.currentTarget.setPointerCapture(ev.pointerId);
          }}
          onPointerMove={(ev) => {
            const idx = dragIdx.current;
            if (idx === null) return;
            const [x, y] = fromEvent(ev);
            const next = [...pts];
            if (idx === 0) next[0] = [0, y];
            else if (idx === next.length - 1) next[idx] = [1, y];
            else {
              const lo = next[idx - 1][0] + 0.015;
              const hi = next[idx + 1][0] - 0.015;
              next[idx] = [clamp(x, lo, hi), y];
            }
            setPts(next);
          }}
          onPointerUp={() => {
            dragIdx.current = null;
          }}
        >
          {[0.25, 0.5, 0.75].map((g) => (
            <g key={g}>
              <line x1={toSvg(g)} y1={pad} x2={toSvg(g)} y2={S - pad} className="stroke-line-dark" strokeDasharray="2 3" />
              <line x1={pad} y1={toSvg(g, true)} x2={S - pad} y2={toSvg(g, true)} className="stroke-line-dark" strokeDasharray="2 3" />
            </g>
          ))}
          <line x1={toSvg(0)} y1={toSvg(0, true)} x2={toSvg(1)} y2={toSvg(1, true)} className="stroke-paper/20" strokeDasharray="3 3" />
          <path d={pathD} fill="none" stroke={strokeColor} strokeWidth={2} />
          {pts.map(([x, y], i) => (
            <circle
              key={`${i}:${x.toFixed(3)}`}
              cx={toSvg(x)}
              cy={toSvg(y, true)}
              r={5}
              fill={strokeColor}
              stroke="#15140f"
              strokeWidth={1.5}
              className="cursor-grab"
              onDoubleClick={(ev) => {
                ev.stopPropagation();
                if (i === 0 || i === pts.length - 1 || pts.length <= 2) return;
                setPts(pts.filter((_, k) => k !== i));
              }}
            />
          ))}
        </svg>
      </div>
      <div className="flex flex-wrap gap-1">
        {CURVE_PRESETS.map((pr) => (
          <button key={pr.id} type="button" onClick={() => applyPreset(pr.id)} className="h-6 rounded-sm border border-line-dark px-2 text-[12px] text-paper-dim hover:border-paper/40 hover:text-paper">
            {pr.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------- 8-Band HSL Secondary Mixer ---------- */

export function HslMixerControl({ c, e }: { c: Clip; e: Effect }) {
  const [band, setBand] = useState(0);
  const st = getStudio();
  const adj = useMemo(() => parseHsl(e.options), [e.options]);

  const setVal = (prop: "hue" | "sat" | "lum", v: number) => {
    const next = {
      hue: [...adj.hue],
      sat: [...adj.sat],
      lum: [...adj.lum],
    };
    next[prop][band] = v;
    st.updateEffect(c.id, e.id, { options: { ...e.options, ...serializeHsl(next) } });
  };

  const resetAll = () => {
    st.updateEffect(c.id, e.id, {
      options: { ...e.options, ...serializeHsl({ hue: [0, 0, 0, 0, 0, 0, 0, 0], sat: [0, 0, 0, 0, 0, 0, 0, 0], lum: [0, 0, 0, 0, 0, 0, 0, 0] }) },
    });
  };

  return (
    <div className="my-1 space-y-2">
      <div className="grid grid-cols-8 gap-1">
        {HSL_BANDS.map((b, i) => {
          const dirty = adj.hue[i] !== 0 || adj.sat[i] !== 0 || adj.lum[i] !== 0;
          return (
            <button
              key={b.id}
              type="button"
              title={b.label}
              aria-pressed={band === i}
              onClick={() => setBand(i)}
              className={cn("relative flex h-7 items-center justify-center rounded-sm border", band === i ? "border-paper bg-paper/15" : "border-line-dark hover:border-paper/40")}
            >
              <span className="size-3.5 rounded-full" style={{ background: b.color }} />
              {dirty && <span className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-accent" />}
            </button>
          );
        })}
      </div>
      <div className="flex items-center justify-between text-[12px] text-paper-dim">
        <span>{HSL_BANDS[band].label} range</span>
        <button type="button" onClick={resetAll} className="hover:text-paper">
          Reset all bands
        </button>
      </div>
      <Row label="Hue shift">
        <Slider label="Band hue" value={adj.hue[band]} min={-1} max={1} step={0.02} neutral={0} onChange={(v) => setVal("hue", v)} />
        <span className="w-11 shrink-0 text-right font-mono text-[12px] text-paper-dim">{Math.round(adj.hue[band] * 54)}°</span>
      </Row>
      <Row label="Saturation">
        <Slider label="Band saturation" value={adj.sat[band]} min={-1} max={1} step={0.02} neutral={0} onChange={(v) => setVal("sat", v)} />
        <span className="w-11 shrink-0 text-right font-mono text-[12px] text-paper-dim">{Math.round(adj.sat[band] * 100)}%</span>
      </Row>
      <Row label="Luminance">
        <Slider label="Band luminance" value={adj.lum[band]} min={-1} max={1} step={0.02} neutral={0} onChange={(v) => setVal("lum", v)} />
        <span className="w-11 shrink-0 text-right font-mono text-[12px] text-paper-dim">{Math.round(adj.lum[band] * 100)}%</span>
      </Row>
    </div>
  );
}
