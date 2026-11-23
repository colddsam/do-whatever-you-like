"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  ArrowLeftRight,
  Bandage,
  Blend,
  Bold,
  Brush,
  Check,
  CircleDashed,
  Crop,
  Droplet,
  Droplets,
  Eraser,
  Eye,
  Fingerprint,
  Flame,
  FlipHorizontal,
  Grid3x3,
  Hand,
  Italic,
  Lasso,
  LassoSelect,
  MousePointer2,
  Move,
  PaintBucket,
  PenTool,
  Pencil,
  Pipette,
  RotateCcw,
  Shapes,
  Sparkle,
  SquareDashed,
  Stamp,
  Sun,
  Triangle,
  Type,
  Waves,
  Wand2,
  X,
  ZoomIn,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { familyFor } from "../fonts";
import type { GradientKind } from "./paint";
import type { BrushSettings, CropGuide, SelectMode, ShapeKind, SymmetryMode, TextMeta, ToolId } from "./types";
import { Check2, ColorWell, Floating, insideFloat, NumField, Select } from "./ui";

export type ToolDef = { id: ToolId; label: string; icon: LucideIcon; key?: string; hint: string };

export const TOOLS: Record<ToolId, ToolDef> = {
  move: { id: "move", label: "Move", icon: Move, key: "V", hint: "Drag to move the layer. Arrow keys nudge it (Shift for 10 px)." },
  "marquee-rect": { id: "marquee-rect", label: "Rectangular marquee", icon: SquareDashed, key: "M", hint: "Drag to select. Shift adds, Alt subtracts, Shift while dragging makes a square." },
  "marquee-ellipse": { id: "marquee-ellipse", label: "Elliptical marquee", icon: CircleDashed, key: "M", hint: "Drag to select an ellipse. Alt drags from the centre." },
  lasso: { id: "lasso", label: "Lasso", icon: Lasso, key: "L", hint: "Draw around what you want to select." },
  "lasso-poly": { id: "lasso-poly", label: "Polygonal lasso", icon: LassoSelect, key: "L", hint: "Click corner by corner. Click the first point, double-click or press Enter to close." },
  wand: { id: "wand", label: "Magic wand", icon: Wand2, key: "W", hint: "Click a colour to select it. Raise the tolerance to take in more." },
  crop: { id: "crop", label: "Crop", icon: Crop, key: "C", hint: "Drag the edges, or draw a new box. Enter crops, Esc cancels." },
  eyedropper: { id: "eyedropper", label: "Eyedropper", icon: Pipette, key: "I", hint: "Click to pick the foreground colour. Alt-click picks the background colour." },
  "spot-heal": { id: "spot-heal", label: "Spot healing brush", icon: Bandage, key: "J", hint: "Paint over a blemish, wire or spot: it's filled from around it when you let go." },
  heal: { id: "heal", label: "Healing brush", icon: Sparkle, key: "J", hint: "Alt-click a clean area to sample, then paint: texture from there, colour from here." },
  "red-eye": { id: "red-eye", label: "Red eye", icon: Eye, key: "J", hint: "Click each red pupil. Set the size to about the pupil." },
  brush: { id: "brush", label: "Brush", icon: Brush, key: "B", hint: "Paint with the foreground colour. Shift-click draws a straight line from the last point." },
  pencil: { id: "pencil", label: "Pencil", icon: Pencil, key: "B", hint: "Hard-edged pixels: good for pixel art." },
  clone: { id: "clone", label: "Clone stamp", icon: Stamp, key: "S", hint: "Alt-click to pick the source, then paint to copy it." },
  eraser: { id: "eraser", label: "Eraser", icon: Eraser, key: "E", hint: "Erases to transparency (on a mask, it reveals)." },
  gradient: { id: "gradient", label: "Gradient", icon: Blend, key: "G", hint: "Drag to draw a gradient across the layer or selection." },
  bucket: { id: "bucket", label: "Paint bucket", icon: PaintBucket, key: "G", hint: "Click to fill similar colours with the foreground colour." },
  "blur-brush": { id: "blur-brush", label: "Blur", icon: Droplet, key: "R", hint: "Paint to soften." },
  "sharpen-brush": { id: "sharpen-brush", label: "Sharpen", icon: Triangle, key: "R", hint: "Paint to bring out detail. Go gently." },
  smudge: { id: "smudge", label: "Smudge", icon: Fingerprint, key: "R", hint: "Drag to push paint around, like a finger in wet paint." },
  dodge: { id: "dodge", label: "Dodge", icon: Sun, key: "O", hint: "Paint to lighten." },
  burn: { id: "burn", label: "Burn", icon: Flame, key: "O", hint: "Paint to darken." },
  sponge: { id: "sponge", label: "Sponge", icon: Droplets, key: "O", hint: "Paint to add or remove colour." },
  liquify: { id: "liquify", label: "Liquify (forward warp)", icon: Waves, hint: "Drag to push pixels: slim, reshape, bend." },
  "mosaic-brush": { id: "mosaic-brush", label: "Mosaic / Censor brush", icon: Grid3x3, key: "R", hint: "Paint pixelated mosaic blocks over faces, plates or sensitive info." },
  text: { id: "text", label: "Text", icon: Type, key: "T", hint: "Click to add text. Click a text layer to edit it." },
  shape: { id: "shape", label: "Shape", icon: Shapes, key: "U", hint: "Drag to draw a shape. Shift keeps it even." },
  pen: { id: "pen", label: "Pen", icon: PenTool, key: "P", hint: "Click for corners, drag for curves. Click the first point to close; Enter or double-click finishes an open path." },
  node: { id: "node", label: "Direct selection", icon: MousePointer2, key: "A", hint: "Click a path, then drag its points and handles. Alt-click a point: smooth/corner. Double-click a line: add a point. Delete removes one." },
  hand: { id: "hand", label: "Hand", icon: Hand, key: "H", hint: "Drag to move around. Hold Space for this from any tool." },
  zoom: { id: "zoom", label: "Zoom", icon: ZoomIn, key: "Z", hint: "Click to zoom in, Alt-click to zoom out. Ctrl + scroll zooms anywhere." },
};

/** The toolbar's slots; each shows the group's last-used tool, the others are in its flyout. */
export const GROUPS: ToolId[][] = [
  ["move"],
  ["marquee-rect", "marquee-ellipse"],
  ["lasso", "lasso-poly"],
  ["wand"],
  ["crop"],
  ["eyedropper"],
  ["spot-heal", "heal", "red-eye"],
  ["brush", "pencil"],
  ["clone"],
  ["eraser"],
  ["gradient", "bucket"],
  ["blur-brush", "sharpen-brush", "smudge", "mosaic-brush"],
  ["dodge", "burn", "sponge"],
  ["liquify"],
  ["text"],
  ["shape"],
  ["pen", "node"],
  ["hand"],
  ["zoom"],
];

export function Toolbar({
  tool,
  onTool,
  fg,
  bg,
  onFg,
  onBg,
  onSwap,
  onReset,
  horizontal,
}: {
  tool: ToolId;
  onTool: (t: ToolId) => void;
  fg: string;
  bg: string;
  onFg: (c: string) => void;
  onBg: (c: string) => void;
  onSwap: () => void;
  onReset: () => void;
  horizontal?: boolean;
}) {
  const [last, setLast] = useState<Record<number, ToolId>>({});
  const [fly, setFly] = useState<{ gi: number; el: HTMLElement } | null>(null);
  const press = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);
  const ref = useRef<HTMLDivElement>(null);
  // Each slot remembers the last tool used from it (however it was picked).
  const [seen, setSeen] = useState(tool);
  if (seen !== tool) {
    setSeen(tool);
    const gi = GROUPS.findIndex((g) => g.includes(tool));
    if (gi >= 0 && last[gi] !== tool) setLast({ ...last, [gi]: tool });
  }
  useEffect(() => {
    if (fly === null) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && !insideFloat(e.target) && setFly(null);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [fly]);
  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label="Tools"
      aria-orientation={horizontal ? "horizontal" : "vertical"}
      className={cn("no-scrollbar flex gap-0.5", horizontal ? "items-center overflow-x-auto px-1.5 py-1" : "flex-col items-center px-1 py-1.5")}
      data-lenis-prevent
    >
      {GROUPS.map((g, gi) => {
        const shown = g.includes(tool) ? tool : (last[gi] ?? g[0]);
        const def = TOOLS[shown];
        const Icon = def.icon;
        const on = g.includes(tool);
        return (
          <div key={gi} className="relative shrink-0">
            <button
              type="button"
              aria-label={def.label}
              aria-pressed={on}
              title={`${def.label}${def.key ? ` (${def.key})` : ""}${g.length > 1 ? " — tap again, hold or right-click for more" : ""}`}
              onClick={(e) => {
                if (longPressed.current) {
                  longPressed.current = false;
                  return;
                }
                if (on && g.length > 1) {
                  const el = e.currentTarget;
                  setFly((cur) => (cur?.gi === gi ? null : { gi, el }));
                } else {
                  setFly(null);
                  onTool(shown);
                }
              }}
              onContextMenu={(e) => {
                if (g.length < 2) return;
                e.preventDefault();
                setFly({ gi, el: e.currentTarget });
              }}
              onPointerDown={(e) => {
                longPressed.current = false;
                if (g.length < 2) return;
                const el = e.currentTarget;
                press.current = setTimeout(() => {
                  longPressed.current = true;
                  setFly({ gi, el });
                }, 400);
              }}
              onPointerUp={() => press.current && clearTimeout(press.current)}
              onPointerCancel={() => press.current && clearTimeout(press.current)}
              onPointerLeave={() => press.current && clearTimeout(press.current)}
              className={cn("relative inline-flex size-10 items-center justify-center rounded-sm transition-colors md:size-9", on ? "bg-ink text-paper" : "text-ink-2 hover:bg-paper-2 hover:text-ink")}
            >
              <Icon aria-hidden className="size-[18px]" strokeWidth={1.75} />
              {g.length > 1 && <span aria-hidden className={cn("absolute bottom-0.5 right-0.5 size-0 border-l-[4px] border-t-[4px] border-l-transparent", on ? "border-t-paper/70" : "border-t-ink-3")} style={{ transform: "rotate(-90deg)" }} />}
            </button>
            {fly?.gi === gi && (
              <Floating anchor={fly.el} side={horizontal ? "above" : "right"} role="menu" className="min-w-48 rounded-md border border-line bg-surface p-1 shadow-float">
                {g.map((t) => {
                  const d = TOOLS[t];
                  const I = d.icon;
                  return (
                    <button
                      key={t}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        onTool(t);
                        setFly(null);
                      }}
                      className={cn("flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-[13px]", tool === t ? "bg-paper-2 text-ink" : "text-ink-2 hover:bg-paper-2 hover:text-ink")}
                    >
                      <I aria-hidden className="size-4" />
                      <span className="flex-1">{d.label}</span>
                      {d.key && <span className="font-mono text-[12px] text-ink-3">{d.key}</span>}
                    </button>
                  );
                })}
              </Floating>
            )}
          </div>
        );
      })}
      {/* Foreground / background colours, as in Photoshop: X swaps, D resets. */}
      <div className={cn("relative shrink-0", horizontal ? "ml-1 h-9 w-12" : "mt-2 h-12 w-10")}>
        <span className="absolute bottom-0 right-0 z-0">
          <ColorWell value={bg} onChange={onBg} label="Background colour" size="size-6" onEyedropper={() => onTool("eyedropper")} />
        </span>
        <span className="absolute left-0 top-0 z-10">
          <ColorWell value={fg} onChange={onFg} label="Foreground colour" size="size-6" onEyedropper={() => onTool("eyedropper")} />
        </span>
        {!horizontal && (
          <>
            <button type="button" aria-label="Swap colours (X)" title="Swap colours (X)" onClick={onSwap} className="absolute right-0 top-0 text-ink-3 hover:text-ink">
              <ArrowLeftRight aria-hidden className="size-3" />
            </button>
            <button type="button" aria-label="Default colours (D)" title="Black and white (D)" onClick={onReset} className="absolute bottom-0 left-0 text-ink-3 hover:text-ink">
              <RotateCcw aria-hidden className="size-3" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/* ---------- Options bar ---------- */

export type GradPreset = "fg-bg" | "fg-clear" | "bw" | "rainbow" | "sunset" | "chrome";

export type ToolOpts = {
  selectMode: SelectMode;
  feather: number;
  wandTol: number;
  contiguous: boolean;
  sampleAll: boolean;
  bucketTol: number;
  gradKind: GradientKind;
  gradPreset: GradPreset;
  gradReverse: boolean;
  cropRatio: number; // 0 free, -1 the picture's own
  cropGuide: CropGuide;
  autoSelect: boolean;
  shape: ShapeKind;
  shapeFill: string | null;
  shapeStroke: string | null;
  shapeStrokeW: number;
  shapeRadius: number;
  shapeSides: number;
  /** The pen's style for new paths. */
  vecFill: string | null;
  vecStroke: string | null;
  vecWidth: number;
  text: Omit<TextMeta, "text">;
  eyedropperSize: 1 | 3 | 5;
  eyedropperAll: boolean;
};

export const FONTS: { label: string; family: string }[] = [
  { label: "Noto Sans", family: familyFor("sans", "") },
  { label: "Noto Serif", family: familyFor("serif", "") },
  { label: "Noto Mono", family: familyFor("mono", "") },
  { label: "Anton (poster)", family: familyFor("impact", "") },
  { label: "Caveat (handwritten)", family: familyFor("hand", "") },
  { label: "Arial", family: "Arial, Helvetica, sans-serif" },
  { label: "Georgia", family: "Georgia, serif" },
  { label: "Times New Roman", family: "'Times New Roman', Times, serif" },
  { label: "Courier New", family: "'Courier New', monospace" },
  { label: "Verdana", family: "Verdana, sans-serif" },
  { label: "Trebuchet MS", family: "'Trebuchet MS', sans-serif" },
  { label: "Impact", family: "Impact, 'Arial Black', sans-serif" },
];

export const DEFAULT_OPTS: ToolOpts = {
  selectMode: "new",
  feather: 0,
  wandTol: 32,
  contiguous: true,
  sampleAll: true,
  bucketTol: 32,
  gradKind: "linear",
  gradPreset: "fg-bg",
  gradReverse: false,
  cropRatio: 0,
  cropGuide: "thirds",
  autoSelect: false,
  shape: "rect",
  shapeFill: "#eb4a10",
  shapeStroke: null,
  shapeStrokeW: 6,
  shapeRadius: 0,
  shapeSides: 5,
  vecFill: null,
  vecStroke: "#15140f",
  vecWidth: 4,
  text: { font: FONTS[0].family, size: 96, weight: 700, italic: false, color: "#15140f", align: "left", lineHeight: 1.2, letterSpacing: 0, stroke: null, background: null },
  eyedropperSize: 1,
  eyedropperAll: true,
};

export const DEFAULT_BRUSH: BrushSettings = { size: 40, hardness: 70, opacity: 100, flow: 100, spacing: 12, strength: 50, sampleAll: false, spongeMode: "desaturate", range: "midtones", symmetry: "off", mosaicSize: 16 };

const Sep = () => <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-line" />;

function ModeButtons({ value, onChange }: { value: SelectMode; onChange: (v: SelectMode) => void }) {
  const modes: { v: SelectMode; label: string; glyph: string }[] = [
    { v: "new", label: "New selection", glyph: "□" },
    { v: "add", label: "Add to selection (Shift)", glyph: "⊞" },
    { v: "subtract", label: "Subtract from selection (Alt)", glyph: "⊟" },
    { v: "intersect", label: "Intersect with selection", glyph: "⊡" },
  ];
  return (
    <span className="inline-flex shrink-0 overflow-hidden rounded-sm border border-line">
      {modes.map((m) => (
        <button key={m.v} type="button" title={m.label} aria-label={m.label} aria-pressed={value === m.v} onClick={() => onChange(m.v)} className={cn("h-7 w-7 text-[15px] leading-none", value === m.v ? "bg-ink text-paper" : "text-ink-2 hover:bg-paper-2")}>
          {m.glyph}
        </button>
      ))}
    </span>
  );
}

export function OptionsBar({
  tool,
  brush,
  setBrush,
  opts,
  setOpts,
  actions,
  textTarget,
  fonts = FONTS,
}: {
  tool: ToolId;
  brush: BrushSettings;
  setBrush: (p: Partial<BrushSettings>) => void;
  opts: ToolOpts;
  setOpts: (p: Partial<ToolOpts>) => void;
  actions: {
    selectSubject: () => void;
    applyCrop: () => void;
    cancelCrop: () => void;
    cropping: boolean;
    cropAngle: number;
    setCropAngle: (deg: number) => void;
    applyStraighten: () => void;
    transform: () => void;
    align: (how: "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom") => void;
    fit: () => void;
    actual: () => void;
    setText: (p: Partial<TextMeta>) => void;
    cloneSet: boolean;
    penOpen: boolean;
    finishPen: () => void;
    cancelPen: () => void;
    nodeHint: string;
    nodeActions: React.ReactNode;
    openColorPicker: () => void;
    pickScreenColor?: () => void;
    hasScreenEyeDropper?: boolean;
  };
  textTarget: TextMeta | null;
  fonts?: { label: string; family: string }[];
}) {
  const def = TOOLS[tool];
  const Icon = def.icon;
  const brushish = ["brush", "pencil", "eraser", "clone", "heal", "spot-heal", "red-eye", "smudge", "blur-brush", "sharpen-brush", "dodge", "burn", "sponge", "liquify", "mosaic-brush"].includes(tool);
  const t = textTarget ?? { ...opts.text, text: "" };
  return (
    <div className="no-scrollbar flex h-11 items-center gap-2 overflow-x-auto px-2.5" data-lenis-prevent>
      <span className="inline-flex shrink-0 items-center gap-1.5 text-[12px] font-medium text-ink">
        <Icon aria-hidden className="size-4" />
        <span className="hidden xl:inline">{def.label}</span>
      </span>
      <Sep />
      {brushish && (
        <>
          <NumField label="Size" value={brush.size} min={1} max={2000} onChange={(size) => setBrush({ size })} unit="px" width="w-16" />
          <input type="range" aria-label="Brush size" min={1} max={500} value={Math.min(500, brush.size)} onChange={(e) => setBrush({ size: Number(e.target.value) })} className="h-4 w-24 shrink-0 accent-ink" />
          {tool !== "pencil" && tool !== "red-eye" && tool !== "spot-heal" && <NumField label="Hardness" value={brush.hardness} min={0} max={100} onChange={(hardness) => setBrush({ hardness })} unit="%" width="w-14" />}
        </>
      )}
      {["brush", "pencil", "eraser", "clone", "heal", "mosaic-brush"].includes(tool) && (
        <>
          <NumField label="Opacity" value={brush.opacity} min={1} max={100} onChange={(opacity) => setBrush({ opacity })} unit="%" width="w-14" />
          {tool !== "mosaic-brush" && <NumField label="Flow" value={brush.flow} min={1} max={100} onChange={(flow) => setBrush({ flow })} unit="%" width="w-14" />}
        </>
      )}
      {tool === "mosaic-brush" && (
        <NumField label="Block" value={brush.mosaicSize} min={4} max={80} onChange={(mosaicSize) => setBrush({ mosaicSize })} unit="px" width="w-14" />
      )}
      {(tool === "brush" || tool === "pencil" || tool === "eraser") && (
        <Select
          label="Symmetry"
          value={brush.symmetry}
          onChange={(symmetry) => setBrush({ symmetry: symmetry as SymmetryMode })}
          options={[
            { value: "off", label: "Off" },
            { value: "vertical", label: "Vertical mirror" },
            { value: "horizontal", label: "Horizontal mirror" },
            { value: "quad", label: "4-way quad" },
            { value: "radial6", label: "Radial ×6" },
            { value: "radial8", label: "Radial ×8" },
          ]}
        />
      )}
      {["smudge", "blur-brush", "sharpen-brush", "dodge", "burn", "sponge", "liquify"].includes(tool) && (
        <NumField label={tool === "dodge" || tool === "burn" ? "Exposure" : "Strength"} value={brush.strength} min={1} max={100} onChange={(strength) => setBrush({ strength })} unit="%" width="w-14" />
      )}
      {(tool === "dodge" || tool === "burn") && (
        <Select
          label="Range"
          value={brush.range}
          onChange={(range) => setBrush({ range })}
          options={[
            { value: "shadows", label: "Shadows" },
            { value: "midtones", label: "Midtones" },
            { value: "highlights", label: "Highlights" },
          ]}
        />
      )}
      {tool === "sponge" && (
        <Select
          label="Mode"
          value={brush.spongeMode}
          onChange={(spongeMode) => setBrush({ spongeMode })}
          options={[
            { value: "desaturate", label: "Desaturate" },
            { value: "saturate", label: "Saturate" },
          ]}
        />
      )}
      {(tool === "clone" || tool === "heal") && (
        <>
          <Check2 checked={brush.sampleAll} onChange={(sampleAll) => setBrush({ sampleAll })} label="Sample all layers" />
          <span className={cn("shrink-0 text-[12px]", actions.cloneSet ? "text-ink-3" : "text-accent")}>{actions.cloneSet ? "Source set. Alt-click to change it." : "Alt-click to set the source first"}</span>
        </>
      )}
      {(tool === "marquee-rect" || tool === "marquee-ellipse" || tool === "lasso" || tool === "lasso-poly" || tool === "wand") && (
        <>
          <ModeButtons value={opts.selectMode} onChange={(selectMode) => setOpts({ selectMode })} />
          {tool !== "wand" && <NumField label="Feather" value={opts.feather} min={0} max={250} onChange={(feather) => setOpts({ feather })} unit="px" width="w-14" />}
        </>
      )}
      {tool === "wand" && (
        <>
          <NumField label="Tolerance" value={opts.wandTol} min={0} max={100} onChange={(wandTol) => setOpts({ wandTol })} width="w-12" />
          <Check2 checked={opts.contiguous} onChange={(contiguous) => setOpts({ contiguous })} label="Contiguous" />
          <Check2 checked={opts.sampleAll} onChange={(sampleAll) => setOpts({ sampleAll })} label="Sample all layers" />
        </>
      )}
      {(tool === "wand" || tool === "marquee-rect" || tool === "lasso") && (
        <button type="button" onClick={actions.selectSubject} className="h-7 shrink-0 rounded-sm border border-line px-2.5 text-[12px] text-ink-2 hover:border-ink-3 hover:text-ink">
          Select subject
        </button>
      )}
      {tool === "bucket" && (
        <>
          <NumField label="Tolerance" value={opts.bucketTol} min={0} max={100} onChange={(bucketTol) => setOpts({ bucketTol })} width="w-12" />
          <Check2 checked={opts.contiguous} onChange={(contiguous) => setOpts({ contiguous })} label="Contiguous" />
          <NumField label="Opacity" value={brush.opacity} min={1} max={100} onChange={(opacity) => setBrush({ opacity })} unit="%" width="w-14" />
        </>
      )}
      {tool === "gradient" && (
        <>
          <Select
            label="Gradient colours"
            value={opts.gradPreset}
            onChange={(gradPreset) => setOpts({ gradPreset })}
            options={[
              { value: "fg-bg", label: "Foreground → background" },
              { value: "fg-clear", label: "Foreground → transparent" },
              { value: "bw", label: "Black → white" },
              { value: "rainbow", label: "Spectrum" },
              { value: "sunset", label: "Sunset" },
              { value: "chrome", label: "Chrome" },
            ]}
          />
          <span className="inline-flex shrink-0 overflow-hidden rounded-sm border border-line">
            {(["linear", "radial", "angle", "reflected", "diamond"] as GradientKind[]).map((k) => (
              <button key={k} type="button" aria-pressed={opts.gradKind === k} onClick={() => setOpts({ gradKind: k })} className={cn("h-7 px-2 text-[12px] capitalize", opts.gradKind === k ? "bg-ink text-paper" : "text-ink-2 hover:bg-paper-2")}>
                {k}
              </button>
            ))}
          </span>
          <Check2 checked={opts.gradReverse} onChange={(gradReverse) => setOpts({ gradReverse })} label="Reverse" />
          <NumField label="Opacity" value={brush.opacity} min={1} max={100} onChange={(opacity) => setBrush({ opacity })} unit="%" width="w-14" />
        </>
      )}
      {tool === "crop" && (
        <>
          <Select
            label="Ratio"
            value={String(opts.cropRatio)}
            onChange={(v) => setOpts({ cropRatio: Number(v) })}
            options={[
              { value: "0", label: "Free" },
              { value: "-1", label: "Original ratio" },
              { value: "1", label: "1:1 square" },
              { value: String(4 / 5), label: "4:5 portrait" },
              { value: String(3 / 2), label: "3:2" },
              { value: String(4 / 3), label: "4:3" },
              { value: String(16 / 9), label: "16:9" },
              { value: String(9 / 16), label: "9:16 story" },
            ]}
          />
          <Select
            label="Guides"
            value={opts.cropGuide}
            onChange={(v) => setOpts({ cropGuide: v as CropGuide })}
            options={[
              { value: "thirds", label: "Rule of thirds" },
              { value: "grid", label: "3×3 / Grid" },
              { value: "golden", label: "Golden ratio" },
              { value: "diagonal", label: "Diagonals" },
            ]}
          />
          <NumField label="Straighten" value={actions.cropAngle} min={-45} max={45} step={0.5} onChange={actions.setCropAngle} unit="°" width="w-16" />
          {actions.cropAngle !== 0 && (
            <button type="button" onClick={actions.applyStraighten} className="inline-flex h-7 shrink-0 items-center gap-1 rounded-sm border border-line px-2.5 text-[12px] text-ink hover:border-ink">
              <FlipHorizontal aria-hidden className="size-3.5" /> Apply angle
            </button>
          )}
          {actions.cropping && (
            <>
              <button type="button" onClick={actions.applyCrop} className="inline-flex h-7 shrink-0 items-center gap-1 rounded-sm bg-ink px-2.5 text-[12px] text-paper">
                <Check aria-hidden className="size-3.5" /> Crop
              </button>
              <button type="button" onClick={actions.cancelCrop} className="inline-flex h-7 shrink-0 items-center gap-1 rounded-sm border border-line px-2.5 text-[12px] text-ink-2">
                <X aria-hidden className="size-3.5" /> Cancel
              </button>
            </>
          )}
        </>
      )}
      {tool === "eyedropper" && (
        <>
          <Select
            label="Sample size"
            value={String(opts.eyedropperSize)}
            onChange={(v) => setOpts({ eyedropperSize: Number(v) as 1 | 3 | 5 })}
            options={[
              { value: "1", label: "Point sample (1×1)" },
              { value: "3", label: "3×3 average" },
              { value: "5", label: "5×5 average" },
            ]}
          />
          <Select
            label="Sample source"
            value={opts.eyedropperAll ? "all" : "current"}
            onChange={(v) => setOpts({ eyedropperAll: v === "all" })}
            options={[
              { value: "all", label: "All layers" },
              { value: "current", label: "Current layer" },
            ]}
          />
          <button type="button" onClick={actions.openColorPicker} className="inline-flex h-7 shrink-0 items-center gap-1 rounded-sm border border-line px-2.5 text-[12px] text-ink-2 hover:border-ink-3 hover:text-ink">
            Color panel
          </button>
          {actions.hasScreenEyeDropper && actions.pickScreenColor && (
            <button type="button" onClick={actions.pickScreenColor} className="inline-flex h-7 shrink-0 items-center gap-1 rounded-sm border border-line px-2.5 text-[12px] text-ink-2 hover:border-ink-3 hover:text-ink">
              <Pipette aria-hidden className="size-3.5" /> Screen picker
            </button>
          )}
        </>
      )}
      {tool === "move" && (
        <>
          <Check2 checked={opts.autoSelect} onChange={(autoSelect) => setOpts({ autoSelect })} label="Auto-select layer" />
          <button type="button" onClick={actions.transform} className="h-7 shrink-0 rounded-sm border border-line px-2.5 text-[12px] text-ink-2 hover:border-ink-3 hover:text-ink">
            Free transform
          </button>
          <Sep />
          <span className="shrink-0 text-[12px] text-ink-3">Align</span>
          {(
            [
              ["left", AlignStartVertical, "Align left edges"],
              ["hcenter", AlignCenterVertical, "Align horizontal centres"],
              ["right", AlignEndVertical, "Align right edges"],
              ["top", AlignStartHorizontal, "Align top edges"],
              ["vcenter", AlignCenterHorizontal, "Align vertical centres"],
              ["bottom", AlignEndHorizontal, "Align bottom edges"],
            ] as const
          ).map(([how, I, label]) => (
            <button key={how} type="button" title={`${label} (to the canvas, or the selection)`} aria-label={label} onClick={() => actions.align(how)} className="inline-flex size-7 shrink-0 items-center justify-center rounded-sm text-ink-2 hover:bg-paper-2 hover:text-ink">
              <I aria-hidden className="size-4" />
            </button>
          ))}
        </>
      )}
      {tool === "text" && (
        <>
          <Select label="Font" value={t.font} onChange={(font) => actions.setText({ font })} options={fonts.map((f) => ({ value: f.family, label: f.label }))} className="max-w-40" />
          <NumField label="Size" value={Math.round(t.size)} min={4} max={2000} onChange={(size) => actions.setText({ size })} unit="px" width="w-16" />
          <button type="button" aria-label="Bold" aria-pressed={t.weight === 700} onClick={() => actions.setText({ weight: t.weight === 700 ? 400 : 700 })} className={cn("inline-flex size-7 shrink-0 items-center justify-center rounded-sm", t.weight === 700 ? "bg-ink text-paper" : "text-ink-2 hover:bg-paper-2")}>
            <Bold aria-hidden className="size-3.5" />
          </button>
          <button type="button" aria-label="Italic" aria-pressed={t.italic} onClick={() => actions.setText({ italic: !t.italic })} className={cn("inline-flex size-7 shrink-0 items-center justify-center rounded-sm", t.italic ? "bg-ink text-paper" : "text-ink-2 hover:bg-paper-2")}>
            <Italic aria-hidden className="size-3.5" />
          </button>
          <Select
            label="Align"
            value={t.align}
            onChange={(align) => actions.setText({ align })}
            options={[
              { value: "left", label: "Left" },
              { value: "center", label: "Centre" },
              { value: "right", label: "Right" },
            ]}
          />
          <ColorWell value={t.color} onChange={(color) => actions.setText({ color })} label="Text colour" />
        </>
      )}
      {tool === "shape" && (
        <>
          <Select
            label="Shape"
            value={opts.shape}
            onChange={(shape) => setOpts({ shape })}
            options={[
              { value: "rect", label: "Rectangle" },
              { value: "ellipse", label: "Ellipse" },
              { value: "polygon", label: "Polygon" },
              { value: "star", label: "Star" },
              { value: "line", label: "Line" },
              { value: "arrow", label: "Arrow" },
            ]}
          />
          <Check2 checked={opts.shapeFill !== null} onChange={(v) => setOpts({ shapeFill: v ? "#eb4a10" : null })} label="Fill" />
          {opts.shapeFill && <ColorWell value={opts.shapeFill} onChange={(shapeFill) => setOpts({ shapeFill })} label="Fill colour" />}
          <Check2 checked={opts.shapeStroke !== null} onChange={(v) => setOpts({ shapeStroke: v ? "#15140f" : null })} label="Stroke" />
          {opts.shapeStroke && <ColorWell value={opts.shapeStroke} onChange={(shapeStroke) => setOpts({ shapeStroke })} label="Stroke colour" />}
          <NumField label="Width" value={opts.shapeStrokeW} min={1} max={200} onChange={(shapeStrokeW) => setOpts({ shapeStrokeW })} unit="px" width="w-14" />
          {opts.shape === "rect" && <NumField label="Corners" value={opts.shapeRadius} min={0} max={1000} onChange={(shapeRadius) => setOpts({ shapeRadius })} unit="px" width="w-14" />}
          {(opts.shape === "polygon" || opts.shape === "star") && <NumField label="Sides" value={opts.shapeSides} min={3} max={40} onChange={(shapeSides) => setOpts({ shapeSides })} width="w-12" />}
        </>
      )}
      {tool === "pen" && (
        <>
          <Check2 checked={opts.vecFill !== null} onChange={(v) => setOpts({ vecFill: v ? "#eb4a10" : null })} label="Fill" />
          {opts.vecFill && <ColorWell value={opts.vecFill} onChange={(vecFill) => setOpts({ vecFill })} label="Path fill colour" />}
          <Check2 checked={opts.vecStroke !== null} onChange={(v) => setOpts({ vecStroke: v ? "#15140f" : null })} label="Stroke" />
          {opts.vecStroke && <ColorWell value={opts.vecStroke} onChange={(vecStroke) => setOpts({ vecStroke })} label="Path stroke colour" />}
          <NumField label="Width" value={opts.vecWidth} min={0.5} max={200} step={0.5} onChange={(vecWidth) => setOpts({ vecWidth })} unit="px" width="w-14" />
          {actions.penOpen && (
            <>
              <button type="button" onClick={actions.finishPen} className="inline-flex h-7 shrink-0 items-center gap-1 rounded-sm bg-ink px-2.5 text-[12px] text-paper">
                <Check aria-hidden className="size-3.5" /> Finish path
              </button>
              <button type="button" onClick={actions.cancelPen} className="inline-flex h-7 shrink-0 items-center gap-1 rounded-sm border border-line px-2.5 text-[12px] text-ink-2">
                <X aria-hidden className="size-3.5" /> Discard
              </button>
            </>
          )}
        </>
      )}
      {tool === "node" && (
        <>
          <span className="shrink-0 text-[12px] text-ink-3">{actions.nodeHint}</span>
          {actions.nodeActions}
        </>
      )}
      {(tool === "hand" || tool === "zoom") && (
        <>
          <button type="button" onClick={actions.fit} className="h-7 shrink-0 rounded-sm border border-line px-2.5 text-[12px] text-ink-2 hover:text-ink">
            Fit on screen
          </button>
          <button type="button" onClick={actions.actual} className="h-7 shrink-0 rounded-sm border border-line px-2.5 text-[12px] text-ink-2 hover:text-ink">
            100%
          </button>
        </>
      )}
      <span className="ml-auto hidden shrink-0 pl-3 text-[12px] text-ink-3 2xl:inline">{def.hint}</span>
    </div>
  );
}
