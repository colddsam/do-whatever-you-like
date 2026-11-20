"use client";

import { useEffect, useState } from "react";
import { Download, FileImage, Link2, PenTool, Unlink2 } from "lucide-react";
import { formatBytes } from "@/lib/media";
import { cn } from "@/lib/utils";
import { exportBlob, type ExportFormat } from "./io";
import type { Doc } from "./types";
import { Btn, Check2, ColorWell, Dialog, NumField, RangeRow } from "./ui";

/* ---------- New document ---------- */

const PRESETS: { label: string; w: number; h: number; group: string }[] = [
  { group: "Social", label: "Instagram post", w: 1080, h: 1080 },
  { group: "Social", label: "Instagram portrait", w: 1080, h: 1350 },
  { group: "Social", label: "Story / Reel", w: 1080, h: 1920 },
  { group: "Social", label: "YouTube thumbnail", w: 1280, h: 720 },
  { group: "Social", label: "Facebook cover", w: 1640, h: 624 },
  { group: "Social", label: "X / Twitter post", w: 1600, h: 900 },
  { group: "Screen", label: "HD", w: 1920, h: 1080 },
  { group: "Screen", label: "4K UHD", w: 3840, h: 2160 },
  { group: "Screen", label: "Wallpaper (phone)", w: 1170, h: 2532 },
  { group: "Print", label: "A4 at 300 dpi", w: 2480, h: 3508 },
  { group: "Print", label: "Letter at 300 dpi", w: 2550, h: 3300 },
  { group: "Print", label: "4 × 6 in photo", w: 1800, h: 1200 },
  { group: "Icons", label: "App icon", w: 1024, h: 1024 },
  { group: "Icons", label: "Favicon", w: 512, h: 512 },
];

export function NewDocDialog({ open, onClose, onCreate }: { open: boolean; onClose: () => void; onCreate: (w: number, h: number, bg: string | null, name: string) => void }) {
  const [w, setW] = useState(1920);
  const [h, setH] = useState(1080);
  const [bg, setBg] = useState<"white" | "black" | "transparent" | "custom">("white");
  const [custom, setCustom] = useState("#f3f0e8");
  const [name, setName] = useState("Untitled");
  const color = bg === "white" ? "#ffffff" : bg === "black" ? "#000000" : bg === "custom" ? custom : null;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New canvas"
      wide
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn primary onClick={() => onCreate(w, h, color, name || "Untitled")}>
            Create {w} × {h}
          </Btn>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-[1fr_220px]">
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => {
                setW(p.w);
                setH(p.h);
                setName(p.label);
              }}
              className={cn("rounded-sm border p-2 text-left transition-colors", w === p.w && h === p.h ? "border-ink bg-ink text-paper" : "border-line hover:border-ink-3")}
            >
              <span className="block truncate text-[13px]">{p.label}</span>
              <span className={cn("font-mono text-[12px]", w === p.w && h === p.h ? "text-paper/70" : "text-ink-3")}>
                {p.w} × {p.h}
              </span>
            </button>
          ))}
        </div>
        <div className="space-y-3">
          <label className="block">
            <span className="text-[12px] text-ink-3">Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 h-9 w-full rounded-sm border border-line bg-surface px-2 text-[13px] text-ink outline-none focus:border-ink" />
          </label>
          <div className="flex flex-wrap gap-3">
            <NumField label="Width" value={w} min={1} max={12000} onChange={setW} unit="px" width="w-20" />
            <NumField label="Height" value={h} min={1} max={12000} onChange={setH} unit="px" width="w-20" />
          </div>
          <div>
            <p className="mb-1 text-[12px] text-ink-3">Background</p>
            <div className="flex flex-wrap gap-1">
              {(["white", "black", "transparent", "custom"] as const).map((b) => (
                <button key={b} type="button" onClick={() => setBg(b)} className={cn("h-7 rounded-sm px-2.5 text-[12px] capitalize", bg === b ? "bg-ink text-paper" : "border border-line text-ink-2 hover:text-ink")}>
                  {b}
                </button>
              ))}
            </div>
            {bg === "custom" && (
              <div className="mt-2">
                <ColorWell value={custom} onChange={setCustom} label="Background colour" hex />
              </div>
            )}
          </div>
          {w * h > 60e6 && <p className="text-[12px] text-warning">That’s a very large canvas; editing may be slow on this device.</p>}
        </div>
      </div>
    </Dialog>
  );
}

/* ---------- Image size / canvas size ---------- */

export function SizeDialog({
  open,
  mode,
  doc,
  onClose,
  onApply,
}: {
  open: boolean;
  mode: "image" | "canvas";
  doc: Doc | null;
  onClose: () => void;
  onApply: (w: number, h: number, anchor: [number, number], fill: string | null) => void;
}) {
  const [w, setW] = useState(doc?.w ?? 100);
  const [h, setH] = useState(doc?.h ?? 100);
  const [lock, setLock] = useState(mode === "image");
  const [anchor, setAnchor] = useState<[number, number]>([0.5, 0.5]);
  const [fill, setFill] = useState<string | null>(null);
  // Each time it opens, start from the document's current size.
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open && doc) {
      setW(doc.w);
      setH(doc.h);
      setLock(mode === "image");
    }
  }
  if (!doc) return null;
  const ratio = doc.w / doc.h;
  const setWidth = (v: number) => {
    setW(v);
    if (lock) setH(Math.max(1, Math.round(v / ratio)));
  };
  const setHeight = (v: number) => {
    setH(v);
    if (lock) setW(Math.max(1, Math.round(v * ratio)));
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={mode === "image" ? "Image size" : "Canvas size"}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn primary onClick={() => onApply(w, h, anchor, fill)}>
            Apply
          </Btn>
        </>
      }
    >
      <p className="mb-3 font-mono text-[12px] text-ink-3">
        Now {doc.w} × {doc.h} px
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <NumField label="Width" value={w} min={1} max={16000} onChange={setWidth} unit="px" width="w-20" />
        <button type="button" aria-label={lock ? "Unlink width and height" : "Link width and height"} aria-pressed={lock} onClick={() => setLock(!lock)} className={cn("inline-flex size-7 items-center justify-center rounded-sm", lock ? "bg-ink text-paper" : "border border-line text-ink-2")}>
          {lock ? <Link2 aria-hidden className="size-3.5" /> : <Unlink2 aria-hidden className="size-3.5" />}
        </button>
        <NumField label="Height" value={h} min={1} max={16000} onChange={setHeight} unit="px" width="w-20" />
      </div>
      {mode === "image" && (
        <div className="mt-3 flex flex-wrap gap-1">
          {[25, 50, 75, 150, 200].map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => {
                setW(Math.round((doc.w * p) / 100));
                setH(Math.round((doc.h * p) / 100));
              }} className="h-7 rounded-sm border border-line px-2 font-mono text-[12px] text-ink-2 hover:text-ink">
              {p}%
            </button>
          ))}
        </div>
      )}
      {mode === "canvas" && (
        <div className="mt-4 flex flex-wrap items-start gap-6">
          <div>
            <p className="mb-1.5 text-[12px] text-ink-3">Anchor</p>
            <div className="grid w-fit grid-cols-3 gap-1">
              {[0, 0.5, 1].flatMap((ay) =>
                [0, 0.5, 1].map((ax) => (
                  <button
                    key={`${ax}${ay}`}
                    type="button"
                    aria-label={`Anchor ${ay === 0 ? "top" : ay === 1 ? "bottom" : "middle"} ${ax === 0 ? "left" : ax === 1 ? "right" : "centre"}`}
                    aria-pressed={anchor[0] === ax && anchor[1] === ay}
                    onClick={() => setAnchor([ax, ay])}
                    className={cn("size-7 rounded-sm border", anchor[0] === ax && anchor[1] === ay ? "border-ink bg-ink" : "border-line bg-paper hover:border-ink-3")}
                  />
                )),
              )}
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-[12px] text-ink-3">New area</p>
            <div className="flex items-center gap-2">
              <Check2 checked={fill !== null} onChange={(v) => setFill(v ? "#ffffff" : null)} label="Fill with colour" />
              {fill && <ColorWell value={fill} onChange={setFill} label="Fill colour" />}
            </div>
          </div>
        </div>
      )}
    </Dialog>
  );
}

/* ---------- One number (feather, expand, rotate…) ---------- */

export function NumberDialog({
  open,
  title,
  label,
  unit,
  initial,
  min,
  max,
  onClose,
  onApply,
}: {
  open: boolean;
  title: string;
  label: string;
  unit: string;
  initial: number;
  min: number;
  max: number;
  onClose: () => void;
  onApply: (v: number) => void;
}) {
  const [v, setV] = useState(initial);
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setV(initial);
  }
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn primary onClick={() => onApply(v)}>
            Apply
          </Btn>
        </>
      }
    >
      <RangeRow label={label} value={v} min={min} max={max} unit={unit} onChange={setV} signed={min < 0} />
      <div className="mt-2">
        <NumField label="Exact" value={v} min={min} max={max} onChange={setV} unit={unit.trim()} width="w-20" />
      </div>
    </Dialog>
  );
}

/* ---------- Fill / stroke ---------- */

export type FillChoice = "fg" | "bg" | "black" | "white" | "gray" | "color" | "content";

export function FillDialog({ open, onClose, onApply, hasSelection }: { open: boolean; onClose: () => void; onApply: (what: FillChoice, color: string, opacity: number) => void; hasSelection: boolean }) {
  const [what, setWhat] = useState<FillChoice>("fg");
  const [color, setColor] = useState("#eb4a10");
  const [opacity, setOpacity] = useState(100);
  const choices: { value: FillChoice; label: string; needsSel?: boolean }[] = [
    { value: "fg", label: "Foreground colour" },
    { value: "bg", label: "Background colour" },
    { value: "color", label: "A colour…" },
    { value: "black", label: "Black" },
    { value: "white", label: "White" },
    { value: "gray", label: "50% grey" },
    { value: "content", label: "Content-aware", needsSel: true },
  ];
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Fill"
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn primary disabled={what === "content" && !hasSelection} onClick={() => onApply(what, color, opacity / 100)}>
            Fill
          </Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-1.5">
        {choices.map((c) => (
          <button
            key={c.value}
            type="button"
            disabled={c.needsSel && !hasSelection}
            title={c.needsSel && !hasSelection ? "Select the area to fill first" : undefined}
            onClick={() => setWhat(c.value)}
            className={cn("h-9 rounded-sm px-2.5 text-left text-[13px] disabled:opacity-40", what === c.value ? "bg-ink text-paper" : "border border-line text-ink-2 hover:text-ink")}
          >
            {c.label}
          </button>
        ))}
      </div>
      {what === "color" && (
        <div className="mt-3">
          <ColorWell value={color} onChange={setColor} label="Fill colour" hex />
        </div>
      )}
      {what === "content" ? (
        <p className="mt-3 text-[12px] leading-relaxed text-ink-3">Fills the selection from what’s around it: good for removing small objects, wires, blemishes and text from a background.</p>
      ) : (
        <div className="mt-3">
          <RangeRow label="Opacity" value={opacity} min={1} max={100} unit="%" onChange={setOpacity} />
        </div>
      )}
    </Dialog>
  );
}

export function StrokeDialog({ open, onClose, onApply, fg }: { open: boolean; onClose: () => void; onApply: (color: string, width: number, where: "inside" | "center" | "outside") => void; fg: string }) {
  const [color, setColor] = useState(fg);
  const [width, setWidth] = useState(4);
  const [where, setWhere] = useState<"inside" | "center" | "outside">("center");
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setColor(fg);
  }
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Stroke selection"
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn primary onClick={() => onApply(color, width, where)}>
            Stroke
          </Btn>
        </>
      }
    >
      <RangeRow label="Width" value={width} min={1} max={100} unit=" px" onChange={setWidth} />
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[12px] text-ink-2">Colour</span>
        <ColorWell value={color} onChange={setColor} label="Stroke colour" hex />
      </div>
      <div className="mt-3 flex gap-1">
        {(["inside", "center", "outside"] as const).map((w) => (
          <button key={w} type="button" onClick={() => setWhere(w)} className={cn("h-7 flex-1 rounded-sm text-[12px] capitalize", where === w ? "bg-ink text-paper" : "border border-line text-ink-2 hover:text-ink")}>
            {w}
          </button>
        ))}
      </div>
    </Dialog>
  );
}

/* ---------- Export ---------- */

export function ExportDialog({
  open,
  doc,
  onClose,
  onSaved,
  onPsd,
  onProject,
  onCopy,
  onSvg,
}: {
  open: boolean;
  doc: Doc | null;
  onClose: () => void;
  onSaved: (blob: Blob, name: string) => void;
  onPsd: () => void;
  onProject: () => void;
  onCopy: () => void;
  onSvg?: () => void;
}) {
  const [format, setFormat] = useState<ExportFormat>("png");
  const [quality, setQuality] = useState(90);
  const [scale, setScale] = useState(100);
  const [bg, setBg] = useState("#ffffff");
  // The file is tagged with the settings it was made for, so a stale one is never offered.
  const [made, setMade] = useState<{ key: string; blob: Blob } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = `${format}|${quality}|${scale}|${bg}`;
  useEffect(() => {
    if (!open || !doc) return;
    let cancelled = false;
    // The exact file, made once settings pause: its size is what the Download button promises.
    const t = setTimeout(() => {
      exportBlob(doc, format, quality / 100, scale / 100, bg)
        .then((b) => {
          if (cancelled) return;
          setMade({ key, blob: b });
          setError(null);
        })
        .catch((e: Error) => {
          if (!cancelled) setError(e.message);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [open, doc, format, quality, scale, bg, key]);
  const blob = made && made.key === key ? made.blob : null;
  if (!doc) return null;
  const ow = Math.round((doc.w * scale) / 100);
  const oh = Math.round((doc.h * scale) / 100);
  return (
    <Dialog open={open} onClose={onClose} title="Export" wide>
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-3">
          <div>
            <p className="mb-1 text-[12px] text-ink-3">Format</p>
            <div className="flex gap-1">
              {(["png", "jpg", "webp"] as const).map((f) => (
                <button key={f} type="button" onClick={() => setFormat(f)} className={cn("h-8 flex-1 rounded-sm font-mono text-[12px] uppercase", format === f ? "bg-ink text-paper" : "border border-line text-ink-2 hover:text-ink")}>
                  {f}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[12px] leading-relaxed text-ink-3">
              {format === "png" ? "Lossless, keeps transparency. Best for graphics and text." : format === "jpg" ? "Small files for photos. No transparency." : "Smaller than JPG at the same quality, keeps transparency."}
            </p>
          </div>
          {format !== "png" && <RangeRow label="Quality" value={quality} min={10} max={100} unit="%" onChange={setQuality} />}
          {format === "jpg" && (
            <div className="flex items-center justify-between">
              <span className="text-[12px] text-ink-2">Behind see-through areas</span>
              <ColorWell value={bg} onChange={setBg} label="JPG background" hex />
            </div>
          )}
          <RangeRow label="Size" value={scale} min={10} max={400} step={5} unit="%" onChange={setScale} />
          <p className="font-mono text-[12px] text-ink-3">
            {ow} × {oh} px
          </p>
        </div>
        <div className="space-y-2">
          <Btn
            primary
            disabled={!blob}
            className="h-11 w-full"
            onClick={() => blob && onSaved(blob, `${doc.name || "image"}.${format}`)}
          >
            <Download aria-hidden className="size-4" />
            Download {format.toUpperCase()}
            {blob && <span className="font-mono text-[12px] font-normal text-paper/60">{formatBytes(blob.size)}</span>}
          </Btn>
          {error && <p className="text-[12px] text-danger">{error}</p>}
          <Btn className="w-full" onClick={onCopy}>
            Copy to clipboard
          </Btn>
          <div className="my-2 h-px bg-line" />
          <p className="text-[12px] text-ink-3">Keep the layers</p>
          <Btn className="w-full" onClick={onPsd}>
            <FileImage aria-hidden className="size-4" />
            Save as PSD (Photoshop, Photopea, GIMP)
          </Btn>
          <Btn className="w-full" onClick={onProject}>
            Save project (.dwlp, everything editable)
          </Btn>
          {onSvg && (
            <>
              <Btn className="w-full" onClick={onSvg}>
                <PenTool aria-hidden className="size-4" />
                Save as SVG (vectors stay editable)
              </Btn>
              <p className="text-[12px] leading-relaxed text-ink-3">Paths, shapes and text stay vector; photos are embedded as pictures. Opens in Illustrator, Figma, Inkscape and browsers.</p>
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}

/* ---------- Keyboard shortcuts ---------- */

export const SHORTCUTS: [string, string][] = [
  ["Move", "V"],
  ["Marquee (rectangle / ellipse)", "M · Shift+M"],
  ["Lasso (free / polygon)", "L · Shift+L"],
  ["Magic wand", "W"],
  ["Crop", "C"],
  ["Eyedropper", "I"],
  ["Spot heal / heal / red eye", "J · Shift+J"],
  ["Brush / pencil", "B · Shift+B"],
  ["Clone stamp (Alt-click to set the source)", "S"],
  ["Eraser", "E"],
  ["Gradient / paint bucket", "G · Shift+G"],
  ["Blur / sharpen / smudge", "R · Shift+R"],
  ["Dodge / burn / sponge", "O · Shift+O"],
  ["Liquify (forward warp)", "Shift+Ctrl+X"],
  ["Text", "T"],
  ["Shape", "U"],
  ["Pen (click for corners, drag for curves)", "P"],
  ["Direct selection (edit points)", "A"],
  ["Finish path / delete point", "Enter · Delete"],
  ["Hand (or hold Space, or drag the background)", "H"],
  ["Zoom", "Z"],
  ["Brush size", "[  ]"],
  ["Brush hardness", "Shift+[  ]"],
  ["Brush opacity 10–100%", "1 … 0"],
  ["Swap / reset colours", "X · D"],
  ["Undo / redo", "Ctrl+Z · Shift+Ctrl+Z"],
  ["Free transform", "Shift+T"],
  ["Select all / deselect / inverse", "Ctrl+A · Ctrl+D · Shift+Ctrl+I"],
  ["Copy / cut / paste", "Ctrl+C · Ctrl+X · Ctrl+V"],
  ["Copy merged", "Shift+Ctrl+C"],
  ["Layer via copy / cut", "Ctrl+J · Shift+Ctrl+J"],
  ["New layer", "Shift+Ctrl+N"],
  ["Merge down / merge visible", "Ctrl+E · Shift+Ctrl+E"],
  ["Clipping mask", "Alt+Ctrl+G"],
  ["Bring forward / send backward", "Ctrl+]  ·  Ctrl+["],
  ["Levels / curves / hue-saturation", "Ctrl+L · Ctrl+M · Ctrl+U"],
  ["Color balance / invert / desaturate", "Ctrl+B · Ctrl+I · Shift+Ctrl+U"],
  ["Auto tone", "Shift+Ctrl+L"],
  ["Fill / feather", "Shift+F5 · Shift+F6"],
  ["Delete selected pixels", "Delete"],
  ["Open / save project / export", "Ctrl+O · Ctrl+S · Alt+Shift+Ctrl+W"],
  ["Fit / 100% / zoom in / out", "Ctrl+0 · Ctrl+1 · Ctrl+= · Ctrl+−"],
  ["Grid", "Ctrl+'"],
  ["Full screen", "F"],
  ["Apply / cancel (crop, transform, polygon lasso)", "Enter · Esc"],
];

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Keyboard shortcuts" wide>
      <p className="mb-3 text-[12px] text-ink-3">On a Mac, use ⌘ for Ctrl and ⌥ for Alt.</p>
      <dl className="grid gap-x-6 sm:grid-cols-2">
        {SHORTCUTS.map(([what, keys]) => (
          <div key={what} className="flex items-baseline justify-between gap-3 border-b border-line py-1.5">
            <dt className="text-[13px] text-ink-2">{what}</dt>
            <dd className="shrink-0 font-mono text-[12px] text-ink">{keys}</dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}
