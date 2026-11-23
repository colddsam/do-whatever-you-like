"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { handOffToProEditor, PRO_EDITOR_HREF } from "@/lib/handoff";
import { AnimatePresence, motion } from "motion/react";
import { Check, Download, Eye, FlipHorizontal2, FlipVertical2, Pipette, Plus, RotateCcw, RotateCw, Trash2, Type } from "lucide-react";
import { hex as hexOf, inkOn } from "@/lib/color";
import { clientToImagePixel, sampleRgbaPatch } from "@/lib/color-sample";
import { checkFile, saveBlob } from "@/lib/files";
import { acceptFor, formatList, IMAGE_INPUTS } from "@/lib/image";
import { formatBytes } from "@/lib/media";
import { getTool, stepsFor } from "@/lib/tools";
import { cn } from "@/lib/utils";
import { RichColorPicker } from "../design/rich-color-picker";
import { FileDrop } from "../file-drop";
import { Workbench } from "../workbench";
import { Chips, Panel, Row, Slider, Swatches, TextField } from "../pdf/kit";
import { nextId, swap } from "../pdf/parts";
import { familyFor, FONT_CLASSES, FONT_OPTIONS, loadFont, type FontKey } from "./fonts";
import { CHECKER } from "./task";

/* ---------- The edit, as data ---------- */

type Adjust = {
  brightness: number;
  contrast: number;
  saturation: number;
  warmth: number;
  fade: number;
  vignette: number;
  highlights: number;
  shadows: number;
  sharpness: number;
};
const NEUTRAL: Adjust = { brightness: 0, contrast: 0, saturation: 0, warmth: 0, fade: 0, vignette: 0, highlights: 0, shadows: 0, sharpness: 0 };

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

type Overlay = { id: string; kind: "text" | "sticker"; text: string; x: number; y: number; size: number; color: string; font: string };
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
  const hiAdj = a.highlights / 100;
  const shAdj = a.shadows / 100;
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
    if (shAdj || hiAdj) {
      const nl = Math.max(0, Math.min(1, lum / 255));
      const dSh = shAdj * (1 - nl) * (1 - nl) * 72;
      const dHi = hiAdj * nl * nl * 72;
      const delta = dSh + dHi;
      r += delta;
      gg += delta;
      b += delta;
    }
    const lum2 = 0.299 * r + 0.587 * gg + 0.114 * b;
    if (f?.mono || f?.sepia) {
      r = gg = b = lum2;
      if (f.sepia) {
        r = lum2 * 1.07 + 18;
        gg = lum2 * 0.95 + 6;
        b = lum2 * 0.78 - 8;
      }
    } else {
      r = lum2 + (r - lum2) * sat;
      gg = lum2 + (gg - lum2) * sat;
      b = lum2 + (b - lum2) * sat;
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
  if (a.sharpness > 0) {
    const k = (a.sharpness / 100) * 1.1;
    const src = new Uint8ClampedArray(p);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const o = (y * w + x) * 4;
        const up = o - w * 4;
        const dn = o + w * 4;
        for (let ch = 0; ch < 3; ch++) {
          const blur = (src[up + ch] + src[dn + ch] + src[o - 4 + ch] + src[o + 4 + ch]) * 0.25;
          const v = src[o + ch] + (src[o + ch] - blur) * k;
          p[o + ch] = v < 0 ? 0 : v > 255 ? 255 : v;
        }
      }
    }
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
function renderPhoto(canvas: HTMLCanvasElement, img: HTMLImageElement, edit: Edit, maxSide: number, withOverlays: boolean, customFonts: { value: string; label: string; family: string }[] = []) {
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
  if (withOverlays) drawOverlays(g, w, h, edit.overlays, customFonts);

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

function resolveOverlayFont(font: string, text: string, customFonts: { value: string; label: string; family: string }[]) {
  const custom = customFonts.find((f) => f.value === font);
  if (custom) return custom.family;
  return familyFor(font as FontKey, text);
}

function drawOverlays(g: CanvasRenderingContext2D, w: number, h: number, overlays: Overlay[], customFonts: { value: string; label: string; family: string }[] = []) {
  for (const o of overlays) {
    const px = Math.max(6, o.size * w);
    g.save();
    g.textAlign = "center";
    g.textBaseline = "middle";
    if (o.kind === "sticker") {
      g.font = `${px}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
      g.fillText(o.text, o.x * w, o.y * h);
    } else {
      g.font = `700 ${px}px ${resolveOverlayFont(o.font, o.text, customFonts)}`;
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
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [rejected, setRejected] = useState<string | null>(null);
  const [edit, setEdit] = useState<Edit>(FRESH);
  const [tab, setTab] = useState<Tab>("adjust");
  const [selected, setSelected] = useState<string | null>(null);
  const [format, setFormat] = useState<"jpg" | "png" | "webp">("jpg");
  const [comparing, setComparing] = useState(false);
  const [customFonts, setCustomFonts] = useState<{ value: string; label: string; family: string }[]>([]);
  const [fontError, setFontError] = useState<string | null>(null);
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
  const [pickerTarget, setPickerTarget] = useState<"text" | "frame" | null>(null);
  const [eyedropperTarget, setEyedropperTarget] = useState<"text" | "frame" | null>(null);
  const stageWrapRef = useRef<HTMLDivElement>(null);
  const loupeBoxRef = useRef<HTMLDivElement>(null);
  const loupeCanvasRef = useRef<HTMLCanvasElement>(null);
  const loupeHexRef = useRef<HTMLSpanElement>(null);

  const sampleStage = (e: React.PointerEvent): string | null => {
    const box = loupeBoxRef.current;
    const lc = loupeCanvasRef.current;
    const wrap = stageWrapRef.current;
    if (!canvas || !wrap) return null;
    const hit = clientToImagePixel(e.clientX, e.clientY, canvas.getBoundingClientRect(), canvas.width, canvas.height);
    if (!hit) {
      if (box) box.style.display = "none";
      return null;
    }
    const LOUPE = 11;
    const half = 5;
    const x0 = Math.max(0, hit.x - half);
    const y0 = Math.max(0, hit.y - half);
    const x1 = Math.min(canvas.width, hit.x + half + 1);
    const y1 = Math.min(canvas.height, hit.y + half + 1);
    const g2d = canvas.getContext("2d", { willReadFrequently: true });
    if (!g2d) return null;
    const patch = g2d.getImageData(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0));
    const px = sampleRgbaPatch(patch.data, patch.width, patch.height, hit.x - x0, hit.y - y0, 1);
    const rgb: [number, number, number] = [px.r, px.g, px.b];
    const code = hexOf(rgb);

    if (box && lc) {
      const wr = wrap.getBoundingClientRect();
      const wx = e.clientX - wr.left;
      const wy = e.clientY - wr.top;
      const lx = Math.min(Math.max(wx - 50, 4), Math.max(4, wr.width - 104));
      const ly = wy > 140 ? wy - 134 : Math.min(wy + 20, Math.max(4, wr.height - 134));
      box.style.display = "flex";
      box.style.transform = `translate3d(${Math.round(lx)}px, ${Math.round(ly)}px, 0)`;
      const lg = lc.getContext("2d");
      if (lg) {
        const size = lc.width;
        const cell = size / LOUPE;
        lg.fillStyle = "#15140f";
        lg.fillRect(0, 0, size, size);
        lg.imageSmoothingEnabled = false;
        lg.drawImage(
          canvas,
          x0,
          y0,
          x1 - x0,
          y1 - y0,
          (x0 - (hit.x - half)) * cell,
          (y0 - (hit.y - half)) * cell,
          (x1 - x0) * cell,
          (y1 - y0) * cell,
        );
        lg.strokeStyle = "rgba(255,255,255,0.18)";
        lg.lineWidth = 1;
        lg.beginPath();
        for (let i = 1; i < LOUPE; i++) {
          const p = Math.round(i * cell) + 0.5;
          lg.moveTo(p, 0);
          lg.lineTo(p, size);
          lg.moveTo(0, p);
          lg.lineTo(size, p);
        }
        lg.stroke();
        lg.strokeStyle = "#000000";
        lg.lineWidth = 2;
        lg.strokeRect(half * cell, half * cell, cell, cell);
        lg.strokeStyle = "#ffffff";
        lg.lineWidth = 1;
        lg.strokeRect(half * cell + 1, half * cell + 1, Math.max(1, cell - 2), Math.max(1, cell - 2));
      }
      if (loupeHexRef.current) {
        loupeHexRef.current.textContent = code.toUpperCase();
        loupeHexRef.current.style.background = code;
        loupeHexRef.current.style.color = inkOn(rgb);
      }
    }
    return code;
  };

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
      const shownEdit = comparing
        ? ({ ...FRESH, rotate: edit.rotate, flipH: edit.flipH, flipV: edit.flipV, ratio: edit.ratio, frame: edit.frame, overlays: [] } as Edit)
        : ({ ...(JSON.parse(lookKey) as Omit<Edit, "overlays">), overlays: [] } as Edit);
      setLayout(renderPhoto(canvas, img, shownEdit, 1000, false, customFonts));
    }, 30);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [img, lookKey, canvas, comparing, edit.rotate, edit.flipH, edit.flipV, edit.ratio, edit.frame, customFonts]);

  // The real file, at full size, once edits pause: that's what the Download button's size describes.
  useEffect(() => {
    if (!img) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      await Promise.all(edit.overlays.filter((o) => o.kind === "text").map((o) => loadFont(resolveOverlayFont(o.font, o.text, customFonts), 700)));
      if (cancelled) return;
      const full = document.createElement("canvas");
      renderPhoto(full, img, edit, 4096, true, customFonts);
      const type = format === "png" || edit.frame.style === "rounded" ? "image/png" : format === "webp" ? "image/webp" : "image/jpeg";
      full.toBlob((blob) => !cancelled && blob && setOut({ blob, saved: false }), type, 0.92);
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [img, edit, format, customFonts]);

  const uploadCustomFont = async (f: File) => {
    try {
      const label = f.name.replace(/\.[^.]+$/, "").trim() || "Custom font";
      const fam = `PhotoUpload ${label} ${nextId()}`;
      const face = new FontFace(fam, await f.arrayBuffer());
      await face.load();
      document.fonts.add(face);
      const entry = { value: fam, label, family: `"${fam}", sans-serif` };
      setCustomFonts((prev) => [...prev, entry]);
      setFontError(null);
      if (current?.kind === "text") patch(current.id, { font: fam });
    } catch {
      setFontError("Could not load font. Try a TTF, OTF, WOFF or WOFF2 file.");
    }
  };

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
      <Workbench
        steps={stepsFor(tool)}
        current={step}
        footer={
          <>
            Edited right here in your browser: your photo never leaves your device. Need layers, looks, retouching or masks?{" "}
            <button
              type="button"
              onClick={() => (out ? void handOffToProEditor(out.blob, file?.name ?? "photo.png").then((href) => router.push(href)) : router.push(PRO_EDITOR_HREF))}
              className="text-ink-2 underline underline-offset-2 hover:text-ink"
            >
              {img ? "Continue in the Pro photo editor" : "Open the Pro photo editor"}
            </button>
            .
          </>
        }
      >
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
                  {eyedropperTarget && (
                    <div className="flex items-center justify-between gap-2 rounded-sm border border-accent/40 bg-accent/10 px-2.5 py-1.5 text-xs text-ink">
                      <span className="flex items-center gap-1.5">
                        <Pipette aria-hidden className="size-3.5 text-accent" />
                        Click anywhere on the photo to sample {eyedropperTarget === "text" ? "text" : "frame"} colour
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setEyedropperTarget(null);
                          if (loupeBoxRef.current) loupeBoxRef.current.style.display = "none";
                        }}
                        className="rounded-sm border border-line bg-surface px-2 py-0.5 text-ink-2 hover:text-ink"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                  <div className={cn("flex justify-center overflow-hidden rounded-md border border-line p-2", CHECKER)}>
                    <div ref={stageWrapRef} className="relative w-fit max-w-full">
                      <canvas
                        ref={setCanvas}
                        className={cn("block h-auto max-h-[min(62vh,580px)] max-w-full", eyedropperTarget && "cursor-crosshair touch-none")}
                        aria-label="Your edited photo"
                        onPointerMove={(e) => {
                          if (eyedropperTarget) sampleStage(e);
                        }}
                        onPointerLeave={() => {
                          if (loupeBoxRef.current) loupeBoxRef.current.style.display = "none";
                        }}
                        onPointerUp={(e) => {
                          if (!eyedropperTarget) return;
                          const picked = sampleStage(e);
                          if (loupeBoxRef.current) loupeBoxRef.current.style.display = "none";
                          if (picked) {
                            if (eyedropperTarget === "text" && current?.kind === "text") patch(current.id, { color: picked });
                            else if (eyedropperTarget === "frame") setEdit((ed) => ({ ...ed, frame: { ...ed.frame, color: picked } }));
                          }
                          setEyedropperTarget(null);
                        }}
                      />
                      <div
                        ref={loupeBoxRef}
                        aria-hidden
                        className="pointer-events-none absolute left-0 top-0 z-20 flex flex-col items-center"
                        style={{ display: "none", willChange: "transform" }}
                      >
                        <canvas ref={loupeCanvasRef} width={99} height={99} className="size-[99px] rounded-full border-2 border-paper shadow-float" style={{ imageRendering: "pixelated" }} />
                        <span ref={loupeHexRef} className="mt-1 rounded-sm px-1.5 py-0.5 font-mono text-[11px] shadow-card" />
                      </div>
                      {layout && shown > 0 && (
                        <div
                          className={cn("absolute", eyedropperTarget && "pointer-events-none")}
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
                                    fontFamily: o.kind === "text" ? resolveOverlayFont(o.font, o.text, customFonts) : undefined,
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
                  <p className="label-mono flex flex-wrap items-center justify-between gap-2 text-ink-3">
                    <span className="flex min-w-0 items-center gap-2">
                      <span aria-hidden className="h-px w-6 shrink-0 bg-ink-3" />
                      <span className="truncate">Fig. 01 — {file?.name}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-3">
                      <button
                        type="button"
                        aria-pressed={comparing}
                        onClick={() => setComparing((c) => !c)}
                        className={cn("inline-flex h-7 items-center gap-1 rounded-sm border px-2 font-sans text-xs normal-case tracking-normal transition-colors", comparing ? "border-ink bg-ink text-paper" : "border-line bg-surface text-ink-2 hover:text-ink")}
                      >
                        <Eye aria-hidden className="size-3.5" /> {comparing ? "Original" : "Compare"}
                      </button>
                      <button type="button" onClick={() => setImg(null)} className="shrink-0 normal-case tracking-normal text-ink-2 underline-offset-4 hover:text-ink hover:underline">
                        Change photo
                      </button>
                    </span>
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
                          ["highlights", "Highlights", -100, 100],
                          ["shadows", "Shadows", -100, 100],
                          ["saturation", "Saturation", -100, 100],
                          ["warmth", "Warmth", -100, 100],
                          ["fade", "Fade", 0, 100],
                          ["vignette", "Vignette", 0, 100],
                          ["sharpness", "Sharpness", 0, 100],
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
                              <Chips
                                label="Font"
                                value={current.font}
                                onChange={(v) => patch(current.id, { font: v })}
                                options={[...FONT_OPTIONS, ...customFonts.map((f) => ({ value: f.value, label: f.label }))]}
                              />
                              <div className="mt-2 flex items-center gap-2">
                                <label className="inline-flex h-8 cursor-pointer items-center rounded-sm border border-line bg-surface px-2.5 text-xs text-ink-2 hover:border-ink-3 hover:text-ink">
                                  Upload custom font (.ttf/.otf/.woff2)
                                  <input
                                    type="file"
                                    accept=".ttf,.otf,.woff,.woff2"
                                    className="sr-only"
                                    onChange={(e) => {
                                      const f = e.target.files?.[0];
                                      e.target.value = "";
                                      if (f) void uploadCustomFont(f);
                                    }}
                                  />
                                </label>
                                {fontError && <span className="text-xs text-accent">{fontError}</span>}
                              </div>
                            </Row>
                            <Row label="Size">
                              <Slider label="Text size" value={Math.round(current.size * 100)} min={2} max={30} onChange={(v) => patch(current.id, { size: v / 100 })} format={(v) => `${v}%`} />
                            </Row>
                            <Row label="Colour">
                              <div className="space-y-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <Swatches value={current.color} onChange={(v) => patch(current.id, { color: v })} colors={[{ value: "#ffffff", name: "White" }, { value: "#15140f", name: "Ink" }, { value: "#eb4a10", name: "Signal orange" }, { value: "#facc15", name: "Yellow" }]} />
                                  <button
                                    type="button"
                                    aria-expanded={pickerTarget === "text"}
                                    onClick={() => setPickerTarget((p) => (p === "text" ? null : "text"))}
                                    className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-line bg-surface px-2 text-xs text-ink-2 hover:border-ink-3 hover:text-ink"
                                  >
                                    <span aria-hidden className="size-3.5 rounded-[2px] border border-line" style={{ background: current.color }} />
                                    <span className="font-mono uppercase">{current.color}</span>
                                  </button>
                                  <button
                                    type="button"
                                    aria-pressed={eyedropperTarget === "text"}
                                    onClick={() => setEyedropperTarget((t) => (t === "text" ? null : "text"))}
                                    title="Pick colour from photo"
                                    className={cn(
                                      "inline-flex h-8 items-center gap-1 rounded-sm border px-2 text-xs transition-colors",
                                      eyedropperTarget === "text" ? "border-accent bg-accent text-paper" : "border-line bg-surface text-ink-2 hover:border-ink-3 hover:text-ink",
                                    )}
                                  >
                                    <Pipette aria-hidden className="size-3.5" /> Pick
                                  </button>
                                </div>
                                {pickerTarget === "text" && (
                                  <RichColorPicker
                                    compact
                                    value={current.color}
                                    onChange={(v) => patch(current.id, { color: v })}
                                    onEyedropper={() => setEyedropperTarget((t) => (t === "text" ? null : "text"))}
                                    eyedropperActive={eyedropperTarget === "text"}
                                    eyedropperLabel="Pick from photo"
                                    className="rounded-md border border-line bg-paper/50 p-2.5"
                                  />
                                )}
                              </div>
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
                            <div className="space-y-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <Swatches value={edit.frame.color} onChange={(v) => setEdit((e) => ({ ...e, frame: { ...e.frame, color: v } }))} colors={[{ value: "#ffffff", name: "White" }, { value: "#15140f", name: "Ink" }, { value: "#f3f0e8", name: "Paper" }, { value: "#eb4a10", name: "Signal orange" }]} />
                                <button
                                  type="button"
                                  aria-expanded={pickerTarget === "frame"}
                                  onClick={() => setPickerTarget((p) => (p === "frame" ? null : "frame"))}
                                  className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-line bg-surface px-2 text-xs text-ink-2 hover:border-ink-3 hover:text-ink"
                                >
                                  <span aria-hidden className="size-3.5 rounded-[2px] border border-line" style={{ background: edit.frame.color }} />
                                  <span className="font-mono uppercase">{edit.frame.color}</span>
                                </button>
                                <button
                                  type="button"
                                  aria-pressed={eyedropperTarget === "frame"}
                                  onClick={() => setEyedropperTarget((t) => (t === "frame" ? null : "frame"))}
                                  title="Pick colour from photo"
                                  className={cn(
                                    "inline-flex h-8 items-center gap-1 rounded-sm border px-2 text-xs transition-colors",
                                    eyedropperTarget === "frame" ? "border-accent bg-accent text-paper" : "border-line bg-surface text-ink-2 hover:border-ink-3 hover:text-ink",
                                  )}
                                >
                                  <Pipette aria-hidden className="size-3.5" /> Pick
                                </button>
                              </div>
                              {pickerTarget === "frame" && (
                                <RichColorPicker
                                  compact
                                  value={edit.frame.color}
                                  onChange={(v) => setEdit((e) => ({ ...e, frame: { ...e.frame, color: v } }))}
                                  onEyedropper={() => setEyedropperTarget((t) => (t === "frame" ? null : "frame"))}
                                  eyedropperActive={eyedropperTarget === "frame"}
                                  eyedropperLabel="Pick from photo"
                                  className="rounded-md border border-line bg-paper/50 p-2.5"
                                />
                              )}
                            </div>
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
                        { value: "webp", label: "WebP", disabled: pngOnly, title: pngOnly ? "Rounded corners use PNG transparency" : undefined },
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
