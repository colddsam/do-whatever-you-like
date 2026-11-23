"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, Pipette, Plus, ScreenShare } from "lucide-react";
import { cmyk, fromHex, hex, hsl, inkOn, oklch, type RGB } from "@/lib/color";
import { hslToRgbBytes, hsvToRgb, normalizeHex, rgbToHsv } from "@/lib/color-sample";
import { cn } from "@/lib/utils";

const SWATCH_STORAGE_KEY = "dwyw:color-swatches:v1";

const DEFAULT_SWATCHES = [
  "#15140f",
  "#ffffff",
  "#eb4a10",
  "#facc15",
  "#00b140",
  "#22c55e",
  "#0ea5e9",
  "#2563eb",
  "#7c3aed",
  "#ec4899",
  "#ef4444",
  "#f97316",
  "#14b8a6",
  "#94a3b8",
  "#475569",
  "#000000",
];

function loadSavedSwatches(): string[] {
  try {
    const raw = localStorage.getItem(SWATCH_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((x) => (typeof x === "string" ? normalizeHex(x) : null)).filter((x): x is string => !!x).slice(0, 16);
  } catch {
    return [];
  }
}

export interface RichColorPickerProps {
  value: string;
  previous?: string;
  onChange: (hex: string) => void;
  onCommit?: (hex: string) => void;
  theme?: "light" | "dark";
  compact?: boolean;
  onEyedropper?: () => void;
  eyedropperActive?: boolean;
  eyedropperLabel?: string;
  actions?: React.ReactNode;
  className?: string;
}

export function RichColorPicker({
  value,
  previous,
  onChange,
  onCommit,
  theme = "light",
  compact = false,
  onEyedropper,
  eyedropperActive,
  eyedropperLabel = "Pick from canvas",
  actions,
  className,
}: RichColorPickerProps) {
  const safeHex = normalizeHex(value) ?? "#000000";
  const rgb = fromHex(safeHex);
  const [hsv, setHsv] = useState<[number, number, number]>(() => rgbToHsv(rgb[0], rgb[1], rgb[2]));
  const [lastPropHex, setLastPropHex] = useState(safeHex);
  const [hexDraft, setHexDraft] = useState(safeHex.toUpperCase());
  const [mode, setMode] = useState<"rgb" | "hsl" | "more">("rgb");
  const [copied, setCopied] = useState<string | null>(null);
  const [savedSwatches, setSavedSwatches] = useState<string[]>([]);
  const [screenPick, setScreenPick] = useState(false);

  // Preserve hue while dragging near grayscale or black: only resync from prop when prop changes independently.
  if (safeHex !== lastPropHex) {
    setLastPropHex(safeHex);
    setHexDraft(safeHex.toUpperCase());
    const [nh, ns, nv] = rgbToHsv(rgb[0], rgb[1], rgb[2]);
    setHsv(([oldH]) => [ns < 0.5 || nv < 0.5 ? oldH : nh, ns, nv]);
  }

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setScreenPick("EyeDropper" in window);
    setSavedSwatches(loadSavedSwatches());
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const svRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);
  const dark = theme === "dark";

  const emitHsv = (nextHsv: [number, number, number], commit = false) => {
    setHsv(nextHsv);
    const nextHex = hex(hsvToRgb(nextHsv[0], nextHsv[1], nextHsv[2]));
    setLastPropHex(nextHex);
    setHexDraft(nextHex.toUpperCase());
    onChange(nextHex);
    if (commit) onCommit?.(nextHex);
  };

  const emitRgb = (r: number, g: number, b: number, commit = false) => {
    const clampByte = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
    const next: RGB = [clampByte(r), clampByte(g), clampByte(b)];
    const nextHex = hex(next);
    const [nh, ns, nv] = rgbToHsv(next[0], next[1], next[2]);
    setHsv(([oldH]) => [ns < 0.5 || nv < 0.5 ? oldH : nh, ns, nv]);
    setLastPropHex(nextHex);
    setHexDraft(nextHex.toUpperCase());
    onChange(nextHex);
    if (commit) onCommit?.(nextHex);
  };

  const updateSvFromPointer = (clientX: number, clientY: number, commit = false) => {
    const el = svRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const s = Math.max(0, Math.min(100, ((clientX - rect.left) / Math.max(1, rect.width)) * 100));
    const v = Math.max(0, Math.min(100, (1 - (clientY - rect.top) / Math.max(1, rect.height)) * 100));
    emitHsv([hsv[0], s, v], commit);
  };

  const updateHueFromPointer = (clientX: number, commit = false) => {
    const el = hueRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const h = Math.max(0, Math.min(359.99, ((clientX - rect.left) / Math.max(1, rect.width)) * 360));
    emitHsv([h, hsv[1], hsv[2]], commit);
  };

  const pickFromScreen = async () => {
    try {
      const api = (window as unknown as { EyeDropper?: new () => { open(): Promise<{ sRGBHex: string }> } }).EyeDropper;
      if (!api) return;
      const res = await new api().open();
      const norm = normalizeHex(res.sRGBHex);
      if (norm) {
        const [r, g, b] = fromHex(norm);
        emitRgb(r, g, b, true);
      }
    } catch {
      /* user cancelled */
    }
  };

  const saveCurrentSwatch = () => {
    const next = [safeHex, ...savedSwatches.filter((c) => c !== safeHex)].slice(0, 16);
    setSavedSwatches(next);
    try {
      localStorage.setItem(SWATCH_STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* storage quota */
    }
  };

  const copyFmt = (label: string, text: string) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(label);
      setTimeout(() => setCopied((cur) => (cur === label ? null : cur)), 1100);
    });
  };

  const [H, S, L] = hsl(rgb);
  const [oL, oC, oH] = oklch(rgb);
  const [cC, cM, cY, cK] = cmyk(rgb);
  const pureHueHex = hex(hsvToRgb(hsv[0], 100, 100));
  const prevHex = previous ? normalizeHex(previous) : null;

  const surfaceCls = dark ? "text-paper" : "text-ink";
  const borderCls = dark ? "border-line-dark" : "border-line";
  const inputCls = dark
    ? "border-line-dark bg-ink text-paper focus:border-accent"
    : "border-line bg-surface text-ink focus:border-ink";
  const mutedCls = dark ? "text-paper-dim" : "text-ink-3";
  const tabIdleCls = dark ? "text-paper-dim hover:bg-paper/10 hover:text-paper" : "text-ink-2 hover:bg-paper-2 hover:text-ink";
  const tabActiveCls = dark ? "bg-paper text-ink" : "bg-ink text-paper";

  return (
    <div className={cn("select-none space-y-2.5", surfaceCls, className)}>
      {/* 2D Saturation / Brightness pad */}
      <div
        ref={svRef}
        role="slider"
        tabIndex={0}
        aria-label="Saturation and brightness"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(hsv[1])}
        aria-valuetext={`${Math.round(hsv[1])}% saturation, ${Math.round(hsv[2])}% brightness`}
        className={cn("relative w-full cursor-crosshair touch-none overflow-hidden rounded-sm border", borderCls, compact ? "h-36" : "h-44")}
        style={{ background: pureHueHex }}
        onPointerDown={(e) => {
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          updateSvFromPointer(e.clientX, e.clientY, false);
        }}
        onPointerMove={(e) => {
          if (e.buttons & 1) updateSvFromPointer(e.clientX, e.clientY, false);
        }}
        onPointerUp={(e) => updateSvFromPointer(e.clientX, e.clientY, true)}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 5 : 1;
          if (e.key === "ArrowRight") emitHsv([hsv[0], Math.min(100, hsv[1] + step), hsv[2]], true);
          else if (e.key === "ArrowLeft") emitHsv([hsv[0], Math.max(0, hsv[1] - step), hsv[2]], true);
          else if (e.key === "ArrowUp") emitHsv([hsv[0], hsv[1], Math.min(100, hsv[2] + step)], true);
          else if (e.key === "ArrowDown") emitHsv([hsv[0], hsv[1], Math.max(0, hsv[2] - step)], true);
          else return;
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <div className="pointer-events-none absolute inset-0" style={{ background: "linear-gradient(90deg, #fff 0%, rgba(255,255,255,0) 100%)" }} />
        <div className="pointer-events-none absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(0,0,0,0) 0%, #000 100%)" }} />
        <span
          aria-hidden
          className="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.85),0_2px_4px_rgba(0,0,0,0.4)]"
          style={{ left: `${hsv[1]}%`, top: `${100 - hsv[2]}%`, background: safeHex }}
        />
      </div>

      {/* Hue slider */}
      <div
        ref={hueRef}
        role="slider"
        tabIndex={0}
        aria-label="Hue"
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(hsv[0])}
        className={cn("relative h-4 w-full cursor-ew-resize touch-none rounded-full border", borderCls)}
        style={{ background: "linear-gradient(90deg, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)" }}
        onPointerDown={(e) => {
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          updateHueFromPointer(e.clientX, false);
        }}
        onPointerMove={(e) => {
          if (e.buttons & 1) updateHueFromPointer(e.clientX, false);
        }}
        onPointerUp={(e) => updateHueFromPointer(e.clientX, true)}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 15 : 2;
          if (e.key === "ArrowRight") emitHsv([(hsv[0] + step) % 360, hsv[1], hsv[2]], true);
          else if (e.key === "ArrowLeft") emitHsv([(hsv[0] - step + 360) % 360, hsv[1], hsv[2]], true);
          else return;
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.8)]"
          style={{ left: `${(hsv[0] / 360) * 100}%`, background: pureHueHex }}
        />
      </div>

      {/* Preview compare + Eyedropper buttons + HEX input */}
      <div className="flex items-center gap-1.5">
        <div className={cn("flex h-8 shrink-0 overflow-hidden rounded-sm border", borderCls)}>
          <span
            title={`Current: ${safeHex.toUpperCase()}`}
            className="flex h-full w-9 items-center justify-center font-mono text-[10px]"
            style={{ background: safeHex, color: inkOn(rgb) }}
          >
            NEW
          </span>
          {prevHex && prevHex !== safeHex && (
            <button
              type="button"
              title={`Revert to previous (${prevHex.toUpperCase()})`}
              onClick={() => {
                const [r, g, b] = fromHex(prevHex);
                emitRgb(r, g, b, true);
              }}
              className="flex h-full w-7 items-center justify-center border-l border-black/15 font-mono text-[10px]"
              style={{ background: prevHex, color: inkOn(fromHex(prevHex)) }}
            >
              OLD
            </button>
          )}
        </div>
        <input
          aria-label="Hex colour"
          value={hexDraft}
          onChange={(e) => {
            const v = e.target.value;
            setHexDraft(v);
            const norm = normalizeHex(v);
            if (norm && v.replace(/^#/, "").length === 6) {
              const [r, g, b] = fromHex(norm);
              emitRgb(r, g, b, false);
            }
          }}
          onBlur={() => {
            const norm = normalizeHex(hexDraft);
            if (norm) {
              const [r, g, b] = fromHex(norm);
              emitRgb(r, g, b, true);
            } else {
              setHexDraft(safeHex.toUpperCase());
            }
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          className={cn("h-8 min-w-0 flex-1 rounded-sm border px-2 font-mono text-[12px] uppercase outline-none", inputCls)}
        />
        {onEyedropper && (
          <button
            type="button"
            title={eyedropperLabel}
            aria-label={eyedropperLabel}
            aria-pressed={eyedropperActive}
            onClick={onEyedropper}
            className={cn(
              "inline-flex size-8 shrink-0 items-center justify-center rounded-sm border transition-colors",
              borderCls,
              eyedropperActive ? "border-accent bg-accent text-paper" : tabIdleCls,
            )}
          >
            <Pipette aria-hidden className="size-3.5" />
          </button>
        )}
        {screenPick && (
          <button
            type="button"
            title="Pick colour from anywhere on screen"
            aria-label="Pick colour from screen"
            onClick={() => void pickFromScreen()}
            className={cn("inline-flex size-8 shrink-0 items-center justify-center rounded-sm border transition-colors", borderCls, tabIdleCls)}
          >
            <ScreenShare aria-hidden className="size-3.5" />
          </button>
        )}
      </div>

      {/* Mode tabs + Numeric inputs */}
      <div className="space-y-1.5">
        <div className={cn("grid grid-cols-3 gap-0.5 rounded-sm border p-0.5", borderCls)}>
          {(
            [
              ["rgb", "RGB"],
              ["hsl", "HSL"],
              ["more", "OKLCH / CMYK"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setMode(id)}
              className={cn("h-6 rounded-[3px] font-mono text-[11px] transition-colors", mode === id ? tabActiveCls : tabIdleCls)}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === "rgb" && (
          <div className="grid grid-cols-3 gap-1.5">
            {(
              [
                ["R", rgb[0], (v: number) => emitRgb(v, rgb[1], rgb[2], true)],
                ["G", rgb[1], (v: number) => emitRgb(rgb[0], v, rgb[2], true)],
                ["B", rgb[2], (v: number) => emitRgb(rgb[0], rgb[1], v, true)],
              ] as const
            ).map(([ch, val, setVal]) => (
              <label key={ch} className={cn("flex h-7 items-center gap-1 rounded-sm border px-1.5", inputCls)}>
                <span className={cn("font-mono text-[11px]", mutedCls)}>{ch}</span>
                <input
                  type="number"
                  min={0}
                  max={255}
                  value={val}
                  onChange={(e) => setVal(Number(e.target.value) || 0)}
                  onKeyDown={(e) => e.stopPropagation()}
                  className="w-full min-w-0 bg-transparent text-right font-mono text-[12px] outline-none"
                />
              </label>
            ))}
          </div>
        )}

        {mode === "hsl" && (
          <div className="grid grid-cols-3 gap-1.5">
            {(
              [
                ["H", H, 360, (v: number) => { const [r, g, b] = hslToRgbBytes(v, S, L); emitRgb(r, g, b, true); }],
                ["S", S, 100, (v: number) => { const [r, g, b] = hslToRgbBytes(H, v, L); emitRgb(r, g, b, true); }],
                ["L", L, 100, (v: number) => { const [r, g, b] = hslToRgbBytes(H, S, v); emitRgb(r, g, b, true); }],
              ] as const
            ).map(([ch, val, max, setVal]) => (
              <label key={ch} className={cn("flex h-7 items-center gap-1 rounded-sm border px-1.5", inputCls)}>
                <span className={cn("font-mono text-[11px]", mutedCls)}>{ch}</span>
                <input
                  type="number"
                  min={0}
                  max={max}
                  value={val}
                  onChange={(e) => setVal(Number(e.target.value) || 0)}
                  onKeyDown={(e) => e.stopPropagation()}
                  className="w-full min-w-0 bg-transparent text-right font-mono text-[12px] outline-none"
                />
              </label>
            ))}
          </div>
        )}

        {mode === "more" && (
          <div className="space-y-1 font-mono text-[11px]">
            {[
              ["OKLCH", `oklch(${(oL * 100).toFixed(1)}% ${oC.toFixed(3)} ${oH.toFixed(1)})`],
              ["CMYK", `${cC}% ${cM}% ${cY}% ${cK}%`],
              ["CSS RGB", `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})`],
            ].map(([label, fmt]) => (
              <div key={label} className={cn("flex items-center gap-1.5 rounded-sm border px-2 py-1", borderCls)}>
                <span className={cn("w-11 shrink-0", mutedCls)}>{label}</span>
                <span className="min-w-0 flex-1 truncate">{fmt}</span>
                <button type="button" onClick={() => copyFmt(label, fmt)} aria-label={`Copy ${label}`} className={cn("shrink-0 rounded-sm p-0.5", tabIdleCls)}>
                  {copied === label ? <Check aria-hidden className="size-3 text-success" /> : <Copy aria-hidden className="size-3" />}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Swatches */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className={cn("font-mono text-[11px] uppercase tracking-wider", mutedCls)}>Swatches</span>
          <button
            type="button"
            onClick={saveCurrentSwatch}
            className={cn("inline-flex h-5 items-center gap-1 rounded-sm border px-1.5 text-[11px]", borderCls, tabIdleCls)}
          >
            <Plus aria-hidden className="size-3" /> Save
          </button>
        </div>
        <div className="grid grid-cols-8 gap-1">
          {[...savedSwatches, ...DEFAULT_SWATCHES.filter((c) => !savedSwatches.includes(c))].slice(0, 16).map((c) => (
            <button
              key={c}
              type="button"
              title={c.toUpperCase()}
              aria-label={`Select ${c}`}
              onClick={() => {
                const [r, g, b] = fromHex(c);
                emitRgb(r, g, b, true);
              }}
              className={cn(
                "h-5 w-full rounded-[3px] border transition-transform hover:scale-105",
                c === safeHex ? (dark ? "border-paper ring-1 ring-paper" : "border-ink ring-1 ring-ink") : borderCls,
              )}
              style={{ background: c }}
            />
          ))}
        </div>
      </div>

      {actions && <div className={cn("border-t pt-2", borderCls)}>{actions}</div>}
    </div>
  );
}
