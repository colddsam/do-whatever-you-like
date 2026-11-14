"use client";

import { useMemo, useState } from "react";
import { ArrowLeftRight, Plus, Shuffle, X } from "lucide-react";
import { contrast, parseColor, rgbToHsl, toHex, type Rgb } from "@/lib/dev";
import { cn } from "@/lib/utils";
import { Chips, Notice, Panel, Row, Slider, Toggle } from "../pdf/kit";
import { CopyButton } from "../dev/parts";
import type { EngineProps } from "./text-engines";

/* ================= Shared colour field ================= */

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const parsed = parseColor(value);
  return (
    <label className="flex min-w-0 items-center gap-2 rounded-md border border-line bg-surface p-1.5 focus-within:border-ink">
      <span className="relative size-9 shrink-0 overflow-hidden rounded-[8px] border border-line" style={{ background: parsed ? toHex(parsed) : "transparent" }}>
        <input type="color" value={parsed ? toHex({ ...parsed, a: 1 }) : "#000000"} onChange={(e) => onChange(e.target.value)} aria-label={`${label} picker`} className="absolute inset-0 size-full cursor-pointer opacity-0" />
      </span>
      <span className="grid min-w-0 flex-1">
        <span className="label-mono text-ink-3">{label}</span>
        <input value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} spellCheck={false} className={cn("min-w-0 bg-transparent font-mono text-sm text-ink outline-none", !parsed && "text-danger")} />
      </span>
    </label>
  );
}

/* ================= WCAG contrast checker ================= */

const hslToRgb = (h: number, s: number, l: number): Rgb => parseColor(`hsl(${h}, ${s}%, ${l}%)`)!;

/** The nearest colour (same hue and saturation, lightness moved) that reaches `target` against `bg`. */
function nearestPassing(fg: Rgb, bg: Rgb, target: number): Rgb | null {
  const [h, s, l] = rgbToHsl(fg);
  let best: Rgb | null = null;
  let bestDelta = Infinity;
  for (let L = 0; L <= 100; L++) {
    const c = hslToRgb(h, s, L);
    if (contrast(c, bg) >= target && Math.abs(L - l) < bestDelta) {
      best = c;
      bestDelta = Math.abs(L - l);
    }
  }
  return best;
}

export function ContrastEngine() {
  const [fg, setFg] = useState("#5b6472");
  const [bg, setBg] = useState("#ffffff");
  const f = parseColor(fg);
  const b = parseColor(bg);
  const ok = f && b;
  // Alpha in the text colour is blended over the background first, as browsers draw it.
  const blended = ok ? { r: Math.round(f.r * f.a + b.r * (1 - f.a)), g: Math.round(f.g * f.a + b.g * (1 - f.a)), b: Math.round(f.b * f.a + b.b * (1 - f.a)), a: 1 } : null;
  const ratio = ok && blended ? contrast(blended, { ...b, a: 1 }) : 0;
  const checks = [
    { name: "AA · body text", need: 4.5, note: "Under 18 pt (24 px), or 14 pt bold" },
    { name: "AA · large text", need: 3, note: "18 pt (24 px) and up, or 14 pt (≈19 px) bold" },
    { name: "AAA · body text", need: 7, note: "The enhanced level" },
    { name: "AAA · large text", need: 4.5, note: "The enhanced level, large" },
    { name: "AA · icons & UI", need: 3, note: "Borders, icons, focus rings (WCAG 1.4.11)" },
  ];
  const fixes = ok && blended ? [4.5, 7].filter((t) => ratio < t).map((t) => ({ t, c: nearestPassing(blended, b, t) })) : [];
  return (
    <>
      <div className="grid gap-2 @xl:grid-cols-[1fr_auto_1fr] @xl:items-center">
        <ColorField label="Text colour" value={fg} onChange={setFg} />
        <button type="button" onClick={() => (setFg(bg), setBg(fg))} aria-label="Swap colours" className="mx-auto inline-flex size-10 items-center justify-center rounded-md border border-line bg-surface text-ink-2 hover:border-ink-3 hover:text-ink">
          <ArrowLeftRight aria-hidden className="size-4" />
        </button>
        <ColorField label="Background" value={bg} onChange={setBg} />
      </div>
      {!ok ? (
        <Notice tone="warning">Type colours as #hex, rgb() or hsl().</Notice>
      ) : (
        <>
          <div className="overflow-hidden rounded-md border border-line" style={{ background: toHex({ ...b, a: 1 }), color: toHex(f) }}>
            <div className="grid gap-2 px-5 py-6">
              <p className="text-[28px] font-semibold leading-tight tracking-tight">The quick brown fox, large</p>
              <p className="text-base leading-relaxed">Body text at 16 px. Can you read this comfortably from a little further away than usual?</p>
              <p className="text-[13px]">Small print at 13 px, where low contrast hurts first.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <p className="font-mono text-5xl font-semibold tracking-tight text-ink">{(Math.floor(ratio * 100) / 100).toFixed(2)}:1</p>
            <p className={cn("text-sm font-medium", ratio >= 7 ? "text-success" : ratio >= 4.5 ? "text-success" : ratio >= 3 ? "text-warning" : "text-danger")}>{ratio >= 7 ? "Excellent" : ratio >= 4.5 ? "Good for all text" : ratio >= 3 ? "Large text only" : "Too low for text"}</p>
          </div>
          <ul className="divide-y divide-line overflow-hidden rounded-md border border-line bg-surface">
            {checks.map((c) => {
              const pass = ratio >= c.need;
              return (
                <li key={c.name} className="flex items-center gap-3 px-3 py-2.5">
                  <span className={cn("inline-flex h-6 w-14 shrink-0 items-center justify-center rounded-sm font-mono text-[12px] font-medium", pass ? "bg-success/10 text-success" : "bg-danger/10 text-danger")}>{pass ? "PASS" : "FAIL"}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-ink">{c.name}</span>
                    <span className="block text-xs text-ink-3">{c.note}</span>
                  </span>
                  <span className="font-mono text-[12px] text-ink-3">{c.need}:1</span>
                </li>
              );
            })}
          </ul>
          {fixes.length > 0 && (
            <div className="grid gap-2">
              <p className="label-mono text-ink-3">Closest text colours that pass</p>
              <div className="flex flex-wrap gap-2">
                {fixes.map(({ t, c }) =>
                  c ? (
                    <button key={t} type="button" onClick={() => setFg(toHex(c))} className="inline-flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink hover:border-ink-3">
                      <span className="size-5 rounded-sm border border-line" style={{ background: toHex(c) }} />
                      <span className="font-mono">{toHex(c)}</span>
                      <span className="text-ink-3">· {t}:1 {t === 7 ? "AAA" : "AA"}</span>
                    </button>
                  ) : (
                    <span key={t} className="text-sm text-ink-3">No shade of this hue reaches {t}:1 on that background; change the background.</span>
                  ),
                )}
              </div>
            </div>
          )}
        </>
      )}
      <Notice>WCAG 2.2 contrast, the measure accessibility audits and laws (ADA, EN 301 549) use. A transparent text colour is blended over the background first.</Notice>
    </>
  );
}

/* ================= CSS generators: gradient, box shadow, border radius ================= */

function CssOut({ css, preview }: { css: string; preview: React.CSSProperties }) {
  return (
    <>
      <div className="grid min-h-56 place-items-center rounded-md border border-line bg-[repeating-conic-gradient(var(--color-paper-2)_0%_25%,var(--color-surface)_0%_50%)] bg-[length:20px_20px] p-8">
        <div className="h-40 w-full max-w-72" style={preview} />
      </div>
      <div className="overflow-hidden rounded-md border border-line bg-surface">
        <div className="flex items-center justify-between border-b border-line bg-paper px-3 py-1.5">
          <span className="font-mono text-[12px] text-ink">CSS</span>
          <CopyButton text={css} />
        </div>
        <pre className="overflow-auto whitespace-pre-wrap break-all px-3 py-2.5 font-mono text-[13px] text-ink">{css}</pre>
      </div>
    </>
  );
}

type Stop = { id: number; color: string; at: number };
let stopId = 10;

function Gradient() {
  const [type, setType] = useState<"linear" | "radial" | "conic">("linear");
  const [angle, setAngle] = useState(135);
  const [shape, setShape] = useState<"circle" | "ellipse">("circle");
  const [stops, setStops] = useState<Stop[]>([
    { id: 1, color: "#ff6b35", at: 0 },
    { id: 2, color: "#7b2cbf", at: 100 },
  ]);
  const sorted = [...stops].sort((a, b) => a.at - b.at);
  const list = sorted.map((s) => `${s.color} ${s.at}%`).join(", ");
  const value = type === "linear" ? `linear-gradient(${angle}deg, ${list})` : type === "radial" ? `radial-gradient(${shape} at center, ${list})` : `conic-gradient(from ${angle}deg at center, ${list})`;
  const random = () => {
    const h = Math.floor(Math.random() * 360);
    setStops([
      { id: ++stopId, color: toHex(hslToRgb(h, 85, 60)), at: 0 },
      { id: ++stopId, color: toHex(hslToRgb((h + 40 + Math.floor(Math.random() * 100)) % 360, 75, 50)), at: 100 },
    ]);
    setAngle(Math.floor(Math.random() * 8) * 45);
  };
  return (
    <>
      <Panel>
        <Row label="Type">
          <div className="flex flex-wrap items-center gap-2">
            <Chips value={type} options={[{ value: "linear", label: "Linear" }, { value: "radial", label: "Radial" }, { value: "conic", label: "Conic" }]} onChange={setType} label="Type" />
            <button type="button" onClick={random} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line bg-surface px-3 text-sm text-ink hover:border-ink-3">
              <Shuffle aria-hidden className="size-3.5" /> Surprise me
            </button>
          </div>
        </Row>
        {type !== "radial" ? (
          <Row label="Angle">
            <Slider label="Angle" value={angle} min={0} max={360} onChange={setAngle} format={(v) => `${v}°`} />
          </Row>
        ) : (
          <Row label="Shape">
            <Chips value={shape} options={[{ value: "circle", label: "Circle" }, { value: "ellipse", label: "Ellipse" }]} onChange={setShape} label="Shape" />
          </Row>
        )}
        <Row label="Colour stops">
          <div className="grid gap-2">
            <div className="h-6 rounded-sm border border-line" style={{ background: `linear-gradient(90deg, ${list})` }} />
            {stops.map((s) => (
              <div key={s.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_auto] items-center gap-2">
                <ColorField label="Colour" value={s.color} onChange={(c) => setStops((all) => all.map((x) => (x.id === s.id ? { ...x, color: c } : x)))} />
                <Slider label="Position" value={s.at} min={0} max={100} onChange={(v) => setStops((all) => all.map((x) => (x.id === s.id ? { ...x, at: v } : x)))} format={(v) => `${v}%`} />
                <button type="button" disabled={stops.length <= 2} onClick={() => setStops((all) => all.filter((x) => x.id !== s.id))} aria-label="Remove stop" className="inline-flex size-9 items-center justify-center rounded-[8px] text-ink-3 hover:bg-paper-2 hover:text-ink disabled:opacity-30">
                  <X aria-hidden className="size-4" />
                </button>
              </div>
            ))}
            {stops.length < 8 && (
              <button type="button" onClick={() => setStops((all) => [...all, { id: ++stopId, color: "#ffd166", at: 50 }])} className="inline-flex h-9 w-fit items-center gap-1.5 rounded-md border border-dashed border-line px-3 text-sm text-ink-2 hover:border-ink-3 hover:text-ink">
                <Plus aria-hidden className="size-3.5" /> Add a colour
              </button>
            )}
          </div>
        </Row>
      </Panel>
      <CssOut css={`background: ${sorted[0].color};\nbackground: ${value};`} preview={{ background: value, borderRadius: 12 }} />
    </>
  );
}

type Shadow = { id: number; x: number; y: number; blur: number; spread: number; color: string; opacity: number; inset: boolean };
const PRESET_SHADOWS: Record<string, Omit<Shadow, "id">[]> = {
  Soft: [{ x: 0, y: 10, blur: 30, spread: -5, color: "#0f172a", opacity: 18, inset: false }],
  Layered: [
    { x: 0, y: 1, blur: 2, spread: 0, color: "#0f172a", opacity: 8, inset: false },
    { x: 0, y: 4, blur: 8, spread: 0, color: "#0f172a", opacity: 8, inset: false },
    { x: 0, y: 16, blur: 32, spread: -4, color: "#0f172a", opacity: 12, inset: false },
  ],
  Crisp: [{ x: 4, y: 4, blur: 0, spread: 0, color: "#111111", opacity: 100, inset: false }],
  Inset: [{ x: 0, y: 2, blur: 6, spread: 0, color: "#000000", opacity: 25, inset: true }],
  Glow: [{ x: 0, y: 0, blur: 24, spread: 2, color: "#ff6b35", opacity: 60, inset: false }],
};
const rgba = (hex: string, op: number) => {
  const c = parseColor(hex) ?? { r: 0, g: 0, b: 0, a: 1 };
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${+(op / 100).toFixed(2)})`;
};

function BoxShadow() {
  const [layers, setLayers] = useState<Shadow[]>(() => PRESET_SHADOWS.Layered.map((s, i) => ({ ...s, id: i })));
  const [box, setBox] = useState("#ffffff");
  const [active, setActive] = useState(0);
  const cur = layers[Math.min(active, layers.length - 1)];
  const set = (patch: Partial<Shadow>) => setLayers((all) => all.map((l) => (l.id === cur.id ? { ...l, ...patch } : l)));
  const value = layers.map((l) => `${l.inset ? "inset " : ""}${l.x}px ${l.y}px ${l.blur}px ${l.spread}px ${rgba(l.color, l.opacity)}`).join(",\n    ");
  return (
    <>
      <Panel>
        <Row label="Start from">
          <Chips value="" options={Object.keys(PRESET_SHADOWS).map((k) => ({ value: k, label: k }))} onChange={(k) => (setLayers(PRESET_SHADOWS[k].map((s, i) => ({ ...s, id: ++stopId + i }))), setActive(0))} label="Preset" />
        </Row>
        <Row label="Layers">
          <div className="flex flex-wrap items-center gap-1.5">
            {layers.map((l, i) => (
              <button key={l.id} type="button" onClick={() => setActive(i)} className={cn("h-8 rounded-[8px] px-3 font-mono text-[12px]", i === active ? "bg-ink text-paper" : "bg-paper-2 text-ink-2 hover:text-ink")}>
                {i + 1}
              </button>
            ))}
            {layers.length < 6 && (
              <button type="button" onClick={() => (setLayers((all) => [...all, { id: ++stopId, x: 0, y: 8, blur: 16, spread: 0, color: "#0f172a", opacity: 15, inset: false }]), setActive(layers.length))} aria-label="Add a layer" className="inline-flex size-8 items-center justify-center rounded-[8px] border border-dashed border-line text-ink-2 hover:text-ink">
                <Plus aria-hidden className="size-3.5" />
              </button>
            )}
            {layers.length > 1 && (
              <button type="button" onClick={() => (setLayers((all) => all.filter((l) => l.id !== cur.id)), setActive(0))} className="ml-auto text-xs text-ink-3 hover:text-danger">
                Remove layer {active + 1}
              </button>
            )}
          </div>
        </Row>
        <Row label={`Layer ${active + 1}`}>
          <div className="grid gap-3 @xl:grid-cols-2">
            <Slider label="Offset X" value={cur.x} min={-50} max={50} onChange={(x) => set({ x })} format={(v) => `${v}px`} />
            <Slider label="Offset Y" value={cur.y} min={-50} max={50} onChange={(y) => set({ y })} format={(v) => `${v}px`} />
            <Slider label="Blur" value={cur.blur} min={0} max={100} onChange={(blur) => set({ blur })} format={(v) => `${v}px`} />
            <Slider label="Spread" value={cur.spread} min={-50} max={50} onChange={(spread) => set({ spread })} format={(v) => `${v}px`} />
            <Slider label="Opacity" value={cur.opacity} min={0} max={100} onChange={(opacity) => set({ opacity })} format={(v) => `${v}%`} />
            <ColorField label="Shadow colour" value={cur.color} onChange={(color) => set({ color })} />
          </div>
          <div className="mt-3">
            <Toggle checked={cur.inset} onChange={(inset) => set({ inset })} label="Inset (inner shadow)" />
          </div>
        </Row>
        <Row label="Box colour">
          <div className="max-w-64">
            <ColorField label="Box" value={box} onChange={setBox} />
          </div>
        </Row>
      </Panel>
      <CssOut css={`box-shadow: ${value};`} preview={{ boxShadow: value.replace(/\n\s*/g, " "), background: box, borderRadius: 12 }} />
    </>
  );
}

function BorderRadius() {
  const [linked, setLinked] = useState(true);
  const [r, setR] = useState({ tl: 24, tr: 24, br: 24, bl: 24 });
  const [unit, setUnit] = useState<"px" | "%">("px");
  const [blob, setBlob] = useState(false);
  const [b, setB] = useState([30, 70, 70, 30, 30, 30, 70, 70]);
  const max = unit === "px" ? 160 : 50;
  const value = useMemo(() => {
    if (blob) return `${b[0]}% ${b[1]}% ${b[2]}% ${b[3]}% / ${b[4]}% ${b[5]}% ${b[6]}% ${b[7]}%`;
    const v = [r.tl, r.tr, r.br, r.bl];
    return v.every((x) => x === v[0]) ? `${v[0]}${unit}` : v.map((x) => `${x}${unit}`).join(" ");
  }, [r, unit, blob, b]);
  const corner = (k: keyof typeof r, label: string) => <Slider key={k} label={label} value={Math.min(r[k], max)} min={0} max={max} onChange={(v) => setR((x) => (linked ? { tl: v, tr: v, br: v, bl: v } : { ...x, [k]: v }))} format={(v) => `${v}${unit}`} />;
  return (
    <>
      <Panel>
        <Row label="Mode">
          <Chips value={blob ? "blob" : "corners"} options={[{ value: "corners", label: "Corners" }, { value: "blob", label: "Organic blob" }]} onChange={(m) => setBlob(m === "blob")} label="Mode" />
        </Row>
        {!blob ? (
          <>
            <Row label="Unit">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                <Chips value={unit} options={[{ value: "px", label: "px" }, { value: "%", label: "%" }]} onChange={setUnit} label="Unit" />
                <Toggle checked={linked} onChange={setLinked} label="All corners the same" />
              </div>
            </Row>
            <Row label="Corners">
              <div className="grid gap-3 @xl:grid-cols-2">{linked ? corner("tl", "All corners") : [corner("tl", "Top left"), corner("tr", "Top right"), corner("bl", "Bottom left"), corner("br", "Bottom right")]}</div>
            </Row>
          </>
        ) : (
          <Row label="Shape">
            <div className="grid gap-3 @xl:grid-cols-2">
              {b.map((v, i) => (
                <Slider key={i} label={`${i < 4 ? "Horizontal" : "Vertical"} ${["top left", "top right", "bottom right", "bottom left"][i % 4]}`} value={v} min={0} max={100} onChange={(x) => setB((all) => all.map((y, j) => (j === i ? x : y)))} format={(x) => `${x}%`} />
              ))}
            </div>
            <button type="button" onClick={() => setB(Array.from({ length: 8 }, () => 20 + Math.floor(Math.random() * 60)))} className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-md border border-line bg-surface px-3 text-sm text-ink hover:border-ink-3">
              <Shuffle aria-hidden className="size-3.5" /> Random blob
            </button>
          </Row>
        )}
      </Panel>
      <CssOut css={`border-radius: ${value};`} preview={{ borderRadius: value, background: "var(--color-ink)" }} />
    </>
  );
}

export function CssGenEngine({ preset }: EngineProps) {
  const [kind, setKind] = useState(preset.kind ?? "gradient");
  return (
    <>
      <Chips value={kind} options={[{ value: "gradient", label: "Gradient" }, { value: "shadow", label: "Box shadow" }, { value: "radius", label: "Border radius" }]} onChange={setKind} label="Generator" />
      {kind === "gradient" ? <Gradient /> : kind === "shadow" ? <BoxShadow /> : <BorderRadius />}
    </>
  );
}
