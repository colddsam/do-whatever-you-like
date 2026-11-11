"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, Download, FlipHorizontal2, FlipVertical2, Plus, RotateCcw, RotateCw, Trash2, Type } from "lucide-react";
import { checkFile, saveBlob } from "@/lib/files";
import { acceptFor, formatList, IMAGE_INPUTS } from "@/lib/image";
import { formatBytes } from "@/lib/media";
import { getTool, stepsFor } from "@/lib/tools";
import { cn } from "@/lib/utils";
import { FileDrop } from "../file-drop";
import { Workbench } from "../workbench";
import { Chips, Panel, Row, Slider, Swatches, TextField } from "../pdf/kit";
import { nextId, swap } from "../pdf/parts";
import { familyFor, FONT_CLASSES, FONT_OPTIONS, loadFont, type FontKey } from "./fonts";
import { CHECKER } from "./task";

/* ---------- The edit, as data ---------- */

type Adjust = { brightness: number; contrast: number; saturation: number; warmth: number; fade: number; vignette: number };
const NEUTRAL: Adjust = { brightness: 0, contrast: 0, saturation: 0, warmth: 0, fade: 0, vignette: 0 };

/** Filters are starting points: each one is just a set of adjustments people can keep tuning. */
const FILTERS: { value: string; label: string; adjust: Adjust; mono?: boolean; sepia?: boolean }[] = [
  { value: "none", label: "Original", adjust: NEUTRAL },
  { value: "vivid", label: "Vivid", adjust: { ...NEUTRAL, contrast: 15, saturation: 35 } },
  { value: "warm", label: "Warm", adjust: { ...NEUTRAL, warmth: 35, saturation: 10 } },
  { value: "cool", label: "Cool", adjust: { ...NEUTRAL, warmth: -35, contrast: 5 } },
  { value: "fade", label: "Faded", adjust: { ...NEUTRAL, fade: 35, contrast: -15, saturation: -15 } },
  { value: "mono", label: "Mono", adjust: { ...NEUTRAL, contrast: 10 }, mono: true },
  { value: "noir", label: "Noir", adjust: { ...NEUTRAL, contrast: 45, brightness: -10, vignette: 45 }, mono: true },
  { value: "sepia", label: "Sepia", adjust: { ...NEUTRAL, fade: 10 }, sepia: true },
  { value: "vintage", label: "Vintage", adjust: { ...NEUTRAL, warmth: 20, fade: 30, saturation: -25, vignette: 35 } },
];

type Overlay = { id: string; kind: "text" | "sticker"; text: string; x: number; y: number; size: number; color: string; font: FontKey };
type Frame = { style: "none" | "thin" | "thick" | "polaroid" | "rounded"; color: string };
type Edit = {
  rotate: 0 | 90 | 180 | 270;
  flipH: boolean;
  flipV: boolean;
  ratio: number; // 0 = as is
  filter: string;
  adjust: Adjust;
  overlays: Overlay[];
  frame: Frame;
};
const FRESH: Edit = { rotate: 0, flipH: false, flipV: false, ratio: 0, filter: "none", adjust: NEUTRAL, overlays: [], frame: { style: "none", color: "#ffffff" } };

const STICKERS = ["😀", "😂", "😍", "😎", "🥳", "👍", "🙏", "🔥", "✨", "❤️", "⭐", "🎉", "📍", "✅", "💯", "🌸", "☀️", "🌙", "🍕", "☕"];

/** Space the frame adds around the picture, as fractions of the picture's width. */
function framePads(f: Frame) {
  switch (f.style) {
    case "thin":
      return { l: 0.02, r: 0.02, t: 0.02, b: 0.02 };
    case "thick":
      return { l: 0.07, r: 0.07, t: 0.07, b: 0.07 };
    case "polaroid":
      return { l: 0.05, r: 0.05, t: 0.05, b: 0.2 };
    default:
      return { l: 0, r: 0, t: 0, b: 0 };
  }
}

/* ---------- Rendering (the same code for the preview and the file) ---------- */

function applyPixels(g: CanvasRenderingContext2D, w: number, h: number, edit: Edit) {
  const f = FILTERS.find((x) => x.value === edit.filter);
  const a = edit.adjust;
  if (!f?.mono && !f?.sepia && Object.values(a).every((v) => v === 0)) return;
  const data = g.getImageData(0, 0, w, h);
  const p = data.data;
  const bright = a.brightness * 1.28;
  const c = (259 * (a.contrast * 1.28 + 255)) / (255 * (259 - a.contrast * 1.28));
  const sat = 1 + a.saturation / 100;
  const warm = a.warmth * 0.4;
  const fade = a.fade / 100;
  for (let i = 0; i < p.length; i += 4) {
    let r = p[i];
    let gg = p[i + 1];
    let b = p[i + 2];
    r += bright;
    gg += bright;
    b += bright;
    r = c * (r - 128) + 128;
    gg = c * (gg - 128) + 128;
    b = c * (b - 128) + 128;
    const lum = 0.299 * r + 0.587 * gg + 0.114 * b;
    if (f?.mono || f?.sepia) {
      r = gg = b = lum;
      if (f.sepia) {
        r = lum * 1.07 + 18;
        gg = lum * 0.95 + 6;
        b = lum * 0.78 - 8;
      }
    } else {
      r = lum + (r - lum) * sat;
      gg = lum + (gg - lum) * sat;
      b = lum + (b - lum) * sat;
    }
    r += warm;
    b -= warm;
    if (fade) {
      r = r * (1 - fade * 0.35) + 255 * fade * 0.18;
      gg = gg * (1 - fade * 0.35) + 255 * fade * 0.18;
      b = b * (1 - fade * 0.35) + 255 * fade * 0.18;
    }
    p[i] = r < 0 ? 0 : r > 255 ? 255 : r;
    p[i + 1] = gg < 0 ? 0 : gg > 255 ? 255 : gg;
    p[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
  }
  g.putImageData(data, 0, 0);
  if (a.vignette) {
    const grad = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.hypot(w, h) / 2);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(1, `rgba(0,0,0,${(a.vignette / 100) * 0.75})`);
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  }
}

/** Draws the edited photo. `maxSide` bounds the picture (not counting the frame). */
function renderPhoto(canvas: HTMLCanvasElement, img: HTMLImageElement, edit: Edit, maxSide: number, withOverlays: boolean) {
  const turned = edit.rotate % 180 !== 0;
  const srcW = turned ? img.naturalHeight : img.naturalWidth;
  const srcH = turned ? img.naturalWidth : img.naturalHeight;
  // Crop to the ratio, centred.
  let cw = srcW;
  let ch = srcH;
  if (edit.ratio) {
    if (srcW / srcH > edit.ratio) cw = srcH * edit.ratio;
    else ch = srcW / edit.ratio;
  }
  const k = Math.min(1, maxSide / Math.max(cw, ch));
  const w = Math.max(1, Math.round(cw * k));
  const h = Math.max(1, Math.round(ch * k));

  const work = document.createElement("canvas");
  work.width = w;
  work.height = h;
  const g = work.getContext("2d", { willReadFrequently: true })!;
  g.save();
  g.translate(w / 2, h / 2);
  g.rotate((edit.rotate * Math.PI) / 180);
  g.scale(edit.flipH ? -1 : 1, edit.flipV ? -1 : 1);
  const dw = img.naturalWidth * k;
  const dh = img.naturalHeight * k;
  g.drawImage(img, -dw / 2, -dh / 2, dw, dh);
  g.restore();
  applyPixels(g, w, h, edit);
  if (withOverlays) drawOverlays(g, w, h, edit.overlays);

  const pads = framePads(edit.frame);
  const pl = Math.round(pads.l * w);
  const pt = Math.round(pads.t * w);
  canvas.width = w + pl + Math.round(pads.r * w);
  canvas.height = h + pt + Math.round(pads.b * w);
  const out = canvas.getContext("2d")!;
  out.clearRect(0, 0, canvas.width, canvas.height);
  if (edit.frame.style === "rounded") {
    const r = Math.min(w, h) * 0.06;
    out.beginPath();
    out.roundRect(0, 0, w, h, r);
    out.clip();
  } else if (edit.frame.style !== "none") {
    out.fillStyle = edit.frame.color;
    out.fillRect(0, 0, canvas.width, canvas.height);
  }
  out.drawImage(work, pl, pt);
  return { w, h, pads };
}

function drawOverlays(g: CanvasRenderingContext2D, w: number, h: number, overlays: Overlay[]) {
  for (const o of overlays) {
    const px = Math.max(6, o.size * w);
    g.save();
    g.textAlign = "center";
    g.textBaseline = "middle";
    if (o.kind === "sticker") {
      g.font = `${px}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
      g.fillText(o.text, o.x * w, o.y * h);
    } else {
      g.font = `700 ${px}px ${familyFor(o.font, o.text)}`;
      g.shadowColor = "rgba(0,0,0,0.45)";
      g.shadowBlur = px * 0.12;
      g.shadowOffsetY = px * 0.04;
      g.fillStyle = o.color;
      o.text.split("\n").forEach((line, i, all) => g.fillText(line, o.x * w, o.y * h + (i - (all.length - 1) / 2) * px * 1.15));
    }
    g.restore();
  }
}

/* ---------- The editor ---------- */

type Tab = "adjust" | "filters" | "shape" | "text" | "stickers" | "frame";

export function PhotoEditorTool({ toolId }: { toolId: string }) {
  const tool = getTool(toolId)!;
  const [file, setFile] = useState<File | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [rejected, setRejected] = useState<string | null>(null);
  const [edit, setEdit] = useState<Edit>(FRESH);
  const [tab, setTab] = useState<Tab>("adjust");
  const [selected, setSelected] = useState<string | null>(null);
  const [format, setFormat] = useState<"jpg" | "png">("jpg");
  const [out, setOut] = useState<{ blob: Blob; saved: boolean } | null>(null);
  const [layout, setLayout] = useState<{ w: number; h: number; pads: ReturnType<typeof framePads> } | null>(null);
  // State, not a ref: the canvas mounts after the drop zone animates out, and drawing must wait for it.
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  // The canvas's on-screen width, to size the live text and stickers (observed once the canvas exists).
  const [stageWidth, setStageWidth] = useState(0);
  useEffect(() => {
    if (!canvas) return;
    const ro = new ResizeObserver(([entry]) => setStageWidth(entry.contentRect.width));
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [canvas]);
  const drag = useRef<{ id: string; rect: DOMRect } | null>(null);

  const pick = (f: File) => {
    const problem = checkFile(f, [...IMAGE_INPUTS.canvas], 50);
    setRejected(problem);
    if (problem) return;
    const el = new Image();
    el.onload = () => {
      setFile(f);
      setImg(el);
      setEdit(FRESH);
      setOut(null);
    };
    el.onerror = () => setRejected("This browser can't open that picture. Try a JPG or PNG.");
    el.src = URL.createObjectURL(f);
  };

  // The preview leaves out text and stickers (they're live elements on top), so dragging them is free.
  const lookKey = JSON.stringify({ ...edit, overlays: undefined });
  useEffect(() => {
    if (!img || !canvas) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      setLayout(renderPhoto(canvas, img, { ...(JSON.parse(lookKey) as Omit<Edit, "overlays">), overlays: [] }, 1000, false));
    }, 30);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [img, lookKey, canvas]);

  // The real file, at full size, once edits pause: that's what the Download button's size describes.
  useEffect(() => {
    if (!img) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      await Promise.all(edit.overlays.filter((o) => o.kind === "text").map((o) => loadFont(familyFor(o.font, o.text), 700)));
      if (cancelled) return;
      const full = document.createElement("canvas");
      renderPhoto(full, img, edit, 4096, true);
      const type = format === "png" || edit.frame.style === "rounded" ? "image/png" : "image/jpeg";
      full.toBlob((blob) => !cancelled && blob && setOut({ blob, saved: false }), type, 0.92);
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [img, edit, format]);

  const setAdjust = (k: keyof Adjust, v: number) => setEdit((e) => ({ ...e, adjust: { ...e.adjust, [k]: v } }));
  const addOverlay = (kind: Overlay["kind"], text: string) => {
    const id = nextId();
    setEdit((e) => ({ ...e, overlays: [...e.overlays, { id, kind, text, x: 0.5, y: kind === "text" ? 0.5 : 0.3, size: kind === "text" ? 0.08 : 0.12, color: "#ffffff", font: "sans" }] }));
    setSelected(id);
  };
  const patch = (id: string, p: Partial<Overlay>) => setEdit((e) => ({ ...e, overlays: e.overlays.map((o) => (o.id === id ? { ...o, ...p } : o)) }));
  const removeOverlay = (id: string) => {
    setEdit((e) => ({ ...e, overlays: e.overlays.filter((o) => o.id !== id) }));
    setSelected(null);
  };
  const current = edit.overlays.find((o) => o.id === selected) ?? null;
  const pngOnly = edit.frame.style === "rounded";
  const ext = pngOnly ? "png" : format;

  const save = () => {
    if (!out || !file) return;
    saveBlob(out.blob, `${file.name.replace(/\.[^.]+$/, "") || "photo"}-edited.${ext}`);
    setOut({ ...out, saved: true });
  };

  const step = !img ? 0 : out?.saved ? 3 : 1;
  const shown = layout && stageWidth ? stageWidth / (layout.w * (1 + layout.pads.l + layout.pads.r)) : 0;

  return (
    <div className={FONT_CLASSES}>
      <Workbench steps={stepsFor(tool)} current={step} footer={<>Edited right here in your browser: your photo never leaves your device.</>}>
        <div className="space-y-3 p-3 sm:p-4">
          <AnimatePresence mode="wait" initial={false}>
            {!img ? (
              <motion.div key="drop" {...swap}>
                <FileDrop accept={acceptFor("canvas")} title="Drop a photo here" formats={`${formatList("canvas")} — any photo`} error={rejected} onFile={pick} />
              </motion.div>
            ) : (
              <motion.div key="edit" {...swap} className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:items-start">
                {/* Stage */}
                <div className="space-y-2 lg:sticky lg:top-24">
                  <div className={cn("flex justify-center overflow-hidden rounded-md border border-line p-2", CHECKER)}>
                    <div className="relative w-fit max-w-full">
                      <canvas ref={setCanvas} className="block h-auto max-h-[min(62vh,580px)] max-w-full" aria-label="Your edited photo" />
                      {layout && shown > 0 && (
                        <div
                          className="absolute"
                          style={{
                            left: `${(layout.pads.l / (1 + layout.pads.l + layout.pads.r)) * 100}%`,
                            top: `${((layout.pads.t * layout.w) / (layout.h + (layout.pads.t + layout.pads.b) * layout.w)) * 100}%`,
                            width: `${(1 / (1 + layout.pads.l + layout.pads.r)) * 100}%`,
                            height: `${(layout.h / (layout.h + (layout.pads.t + layout.pads.b) * layout.w)) * 100}%`,
                          }}
                          onPointerMove={(e) => {
                            const d = drag.current;
                            if (!d) return;
                            patch(d.id, { x: Math.min(1, Math.max(0, (e.clientX - d.rect.left) / d.rect.width)), y: Math.min(1, Math.max(0, (e.clientY - d.rect.top) / d.rect.height)) });
                          }}
                          onPointerUp={() => (drag.current = null)}
                        >
                          {edit.overlays.map((o) => {
                            const px = o.size * layout.w * shown;
                            return (
                              <button
                                key={o.id}
                                type="button"
                                aria-label={`${o.kind === "text" ? "Text" : "Sticker"}: ${o.text}. Drag to move.`}
                                onPointerDown={(e) => {
                                  e.preventDefault();
                                  setSelected(o.id);
                                  setTab(o.kind === "text" ? "text" : "stickers");
                                  const host = e.currentTarget.parentElement!;
                                  drag.current = { id: o.id, rect: host.getBoundingClientRect() };
                                  host.setPointerCapture(e.pointerId);
                                }}
                                onKeyDown={(e) => {
                                  const d = { ArrowLeft: [-0.01, 0], ArrowRight: [0.01, 0], ArrowUp: [0, -0.01], ArrowDown: [0, 0.01] }[e.key];
                                  if (d) {
                                    e.preventDefault();
                                    patch(o.id, { x: Math.min(1, Math.max(0, o.x + d[0])), y: Math.min(1, Math.max(0, o.y + d[1])) });
                                  } else if (e.key === "Delete" || e.key === "Backspace") removeOverlay(o.id);
                                }}
                                className={cn(
                                  "absolute -translate-x-1/2 -translate-y-1/2 cursor-move touch-none whitespace-pre rounded-[3px] px-0.5 text-center leading-[1.15] outline-none",
                                  selected === o.id ? "ring-1 ring-ink ring-offset-1 ring-offset-surface" : "hover:ring-1 hover:ring-surface/80",
                                )}
                                style={{
                                  left: `${o.x * 100}%`,
                                  top: `${o.y * 100}%`,
                                  fontSize: px,
                                  color: o.color,
                                  fontFamily: o.kind === "text" ? familyFor(o.font, o.text) : undefined,
                                  fontWeight: 700,
                                  textShadow: o.kind === "text" ? `0 ${px * 0.04}px ${px * 0.12}px rgba(0,0,0,0.45)` : undefined,
                                }}
                              >
                                {o.text}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                  <p className="label-mono flex items-center justify-between gap-2 text-ink-3">
                    <span className="flex min-w-0 items-center gap-2">
                      <span aria-hidden className="h-px w-6 shrink-0 bg-ink-3" />
                      <span className="truncate">Fig. 01 — {file?.name}</span>
                    </span>
                    <button type="button" onClick={() => setImg(null)} className="shrink-0 normal-case tracking-normal text-ink-2 underline-offset-4 hover:text-ink hover:underline">
                      Change photo
                    </button>
                  </p>
                </div>

                {/* Controls */}
                <div className="space-y-3">
                  <div role="tablist" aria-label="Edit" className="grid grid-cols-3 gap-1 rounded-md border border-line bg-paper p-1 sm:grid-cols-6 lg:grid-cols-3">
                    {(
                      [
                        ["adjust", "Adjust"],
                        ["filters", "Filters"],
                        ["shape", "Shape"],
                        ["text", "Text"],
                        ["stickers", "Stickers"],
                        ["frame", "Frame"],
                      ] as const
                    ).map(([k, label]) => (
                      <button
                        key={k}
                        type="button"
                        role="tab"
                        aria-selected={tab === k}
                        onClick={() => setTab(k)}
                        className={cn("relative h-10 rounded-[8px] text-sm transition-colors", tab === k ? "text-paper" : "text-ink-2 hover:bg-paper-2 hover:text-ink")}
                      >
                        {tab === k && <motion.span layoutId="photo-tab" aria-hidden className="absolute inset-0 rounded-[8px] bg-ink" transition={{ type: "spring", bounce: 0.22, duration: 0.5 }} />}
                        <span className="relative">{label}</span>
                      </button>
                    ))}
                  </div>

                  <Panel>
                    {tab === "adjust" &&
                      (
                        [
                          ["brightness", "Brightness", -100, 100],
                          ["contrast", "Contrast", -100, 100],
                          ["saturation", "Saturation", -100, 100],
                          ["warmth", "Warmth", -100, 100],
                          ["fade", "Fade", 0, 100],
                          ["vignette", "Vignette", 0, 100],
                        ] as const
                      ).map(([k, label, min, max]) => (
                        <Row key={k} label={label}>
                          <Slider label={label} value={edit.adjust[k]} min={min} max={max} onChange={(v) => setAdjust(k, v)} format={(v) => (v > 0 && min < 0 ? `+${v}` : String(v))} />
                        </Row>
                      ))}

                    {tab === "filters" && (
                      <Row label="Filter" hint="Then fine-tune it in Adjust">
                        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5 lg:grid-cols-3">
                          {FILTERS.map((f) => (
                            <button
                              key={f.value}
                              type="button"
                              aria-pressed={edit.filter === f.value}
                              onClick={() => setEdit((e) => ({ ...e, filter: f.value, adjust: f.adjust }))}
                              className={cn(
                                "h-10 rounded-sm border text-sm transition-colors",
                                edit.filter === f.value ? "border-ink bg-ink text-paper" : "border-line bg-surface text-ink-2 hover:border-ink-3 hover:text-ink",
                              )}
                            >
                              {f.label}
                            </button>
                          ))}
                        </div>
                      </Row>
                    )}

                    {tab === "shape" && (
                      <>
                        <Row label="Turn and flip">
                          <div className="flex flex-wrap gap-1.5">
                            {(
                              [
                                ["Left", RotateCcw, () => setEdit((e) => ({ ...e, rotate: ((e.rotate + 270) % 360) as Edit["rotate"] }))],
                                ["Right", RotateCw, () => setEdit((e) => ({ ...e, rotate: ((e.rotate + 90) % 360) as Edit["rotate"] }))],
                                ["Flip sideways", FlipHorizontal2, () => setEdit((e) => ({ ...e, flipH: !e.flipH }))],
                                ["Flip upside down", FlipVertical2, () => setEdit((e) => ({ ...e, flipV: !e.flipV }))],
                              ] as const
                            ).map(([label, Icon, run]) => (
                              <button key={label} type="button" onClick={run} className="inline-flex h-10 items-center gap-1.5 rounded-sm border border-line bg-surface px-3 text-sm text-ink-2 transition-colors hover:border-ink-3 hover:text-ink">
                                <Icon aria-hidden className="size-4" /> {label}
                              </button>
                            ))}
                          </div>
                        </Row>
                        <Row label="Crop to">
                          <Chips
                            label="Crop to"
                            value={edit.ratio}
                            onChange={(v) => setEdit((e) => ({ ...e, ratio: v }))}
                            options={[
                              { value: 0, label: "Original" },
                              { value: 1, label: "Square" },
                              { value: 4 / 5, label: "4:5" },
                              { value: 3 / 2, label: "3:2" },
                              { value: 16 / 9, label: "16:9" },
                              { value: 9 / 16, label: "Story 9:16" },
                            ]}
                          />
                          <p className="mt-2 text-xs text-ink-3">Crops from the centre. For a free-hand crop, use Crop image.</p>
                        </Row>
                      </>
                    )}

                    {tab === "text" && (
                      <>
                        <Row label="Text">
                          <button type="button" onClick={() => addOverlay("text", "Your text")} className="inline-flex h-10 items-center gap-1.5 rounded-sm border border-dashed border-ink-3 px-3 text-sm text-ink-2 transition-colors hover:border-ink hover:text-ink">
                            <Type aria-hidden className="size-4" /> Add text
                          </button>
                          <p className="mt-2 text-xs text-ink-3">Drag text on the photo to place it. Arrow keys nudge it, Delete removes it.</p>
                        </Row>
                        {current?.kind === "text" && (
                          <>
                            <Row label="Words">
                              <TextField value={current.text} onChange={(v) => patch(current.id, { text: v.slice(0, 120) })} label="Text" />
                            </Row>
                            <Row label="Font">
                              <Chips label="Font" value={current.font} onChange={(v) => patch(current.id, { font: v })} options={FONT_OPTIONS} />
                            </Row>
                            <Row label="Size">
                              <Slider label="Text size" value={Math.round(current.size * 100)} min={2} max={30} onChange={(v) => patch(current.id, { size: v / 100 })} format={(v) => `${v}%`} />
                            </Row>
                            <Row label="Colour">
                              <Swatches value={current.color} onChange={(v) => patch(current.id, { color: v })} colors={[{ value: "#ffffff", name: "White" }, { value: "#15140f", name: "Ink" }, { value: "#eb4a10", name: "Signal orange" }, { value: "#facc15", name: "Yellow" }]} />
                              <button type="button" onClick={() => removeOverlay(current.id)} className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-sm px-2 text-sm text-ink-2 hover:bg-paper-2 hover:text-ink">
                                <Trash2 aria-hidden className="size-3.5" /> Remove this text
                              </button>
                            </Row>
                          </>
                        )}
                      </>
                    )}

                    {tab === "stickers" && (
                      <>
                        <Row label="Stickers" hint="Tap to add">
                          <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-10 lg:grid-cols-5">
                            {STICKERS.map((s) => (
                              <button key={s} type="button" onClick={() => addOverlay("sticker", s)} aria-label={`Add ${s}`} className="flex h-11 items-center justify-center rounded-sm border border-line bg-surface text-2xl transition-colors hover:border-ink-3">
                                {s}
                              </button>
                            ))}
                          </div>
                        </Row>
                        {current?.kind === "sticker" && (
                          <Row label="Selected sticker">
                            <Slider label="Sticker size" value={Math.round(current.size * 100)} min={4} max={60} onChange={(v) => patch(current.id, { size: v / 100 })} format={(v) => `${v}%`} />
                            <button type="button" onClick={() => removeOverlay(current.id)} className="mt-2 inline-flex h-9 items-center gap-1.5 rounded-sm px-2 text-sm text-ink-2 hover:bg-paper-2 hover:text-ink">
                              <Trash2 aria-hidden className="size-3.5" /> Remove it
                            </button>
                          </Row>
                        )}
                      </>
                    )}

                    {tab === "frame" && (
                      <>
                        <Row label="Frame">
                          <Chips
                            label="Frame"
                            value={edit.frame.style}
                            onChange={(v) => setEdit((e) => ({ ...e, frame: { ...e.frame, style: v } }))}
                            options={[
                              { value: "none", label: "None" },
                              { value: "thin", label: "Thin" },
                              { value: "thick", label: "Thick" },
                              { value: "polaroid", label: "Polaroid" },
                              { value: "rounded", label: "Rounded corners" },
                            ]}
                          />
                        </Row>
                        {edit.frame.style !== "none" && edit.frame.style !== "rounded" && (
                          <Row label="Frame colour">
                            <Swatches value={edit.frame.color} onChange={(v) => setEdit((e) => ({ ...e, frame: { ...e.frame, color: v } }))} colors={[{ value: "#ffffff", name: "White" }, { value: "#15140f", name: "Ink" }, { value: "#f3f0e8", name: "Paper" }, { value: "#eb4a10", name: "Signal orange" }]} />
                          </Row>
                        )}
                      </>
                    )}
                  </Panel>

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Chips
                      label="Format"
                      value={ext}
                      onChange={(v) => setFormat(v)}
                      options={[
                        { value: "jpg", label: "JPG", disabled: pngOnly, title: pngOnly ? "Rounded corners need PNG transparency" : undefined },
                        { value: "png", label: "PNG" },
                      ]}
                    />
                    <button type="button" onClick={() => setEdit(FRESH)} className="inline-flex h-9 items-center gap-1.5 rounded-sm px-2 text-sm text-ink-2 underline-offset-4 hover:text-ink hover:underline">
                      <Plus aria-hidden className="size-3.5 rotate-45" /> Undo all edits
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={save}
                    disabled={!out}
                    className="inline-flex h-12 w-full items-center justify-center gap-2 whitespace-nowrap rounded-md bg-ink px-5 text-[15px] font-medium text-paper transition-[background-color,transform] duration-150 hover:bg-ink/85 active:translate-y-px disabled:opacity-40"
                  >
                    {out?.saved ? <Check aria-hidden className="size-4" /> : <Download aria-hidden className="size-4" />}
                    {out?.saved ? "Saved. Download again" : `Download ${ext.toUpperCase()}`}
                    {out && <span className="font-mono text-[13px] font-normal text-paper/60">{formatBytes(out.blob.size)}</span>}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </Workbench>
    </div>
  );
}
