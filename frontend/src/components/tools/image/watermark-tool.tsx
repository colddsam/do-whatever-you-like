"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { IMAGE_API, IMAGE_INPUTS } from "@/lib/image";
import { checkFile } from "@/lib/files";
import { cn } from "@/lib/utils";
import { Chips, Panel, PositionGrid, Row, Slider, Swatches, TextField, Toggle } from "../pdf/kit";
import { plural } from "../pdf/parts";
import { familyFor, FONT_CLASSES, FONT_OPTIONS, loadFont, type FontKey } from "./fonts";
import { CHECKER, ImageTask, type ImageItem } from "./task";

type Options = {
  kind: "text" | "image";
  text: string;
  font: FontKey;
  bold: boolean;
  italic: boolean;
  /** Font size as a fraction of the image width (same unit as the backend). */
  size: number;
  color: string;
  shadow: boolean;
  scale: number;
  opacity: number;
  rotation: number;
  position: string;
  mosaic: boolean;
  margin: number;
};

const COLORS = [
  { value: "#ffffff", name: "White" },
  { value: "#15140f", name: "Ink" },
  { value: "#eb4a10", name: "Signal orange" },
  { value: "#2563eb", name: "Blue" },
  { value: "#16a34a", name: "Green" },
];

const weightOf = (o: Pick<Options, "font" | "bold">) => (o.font === "impact" || !o.bold ? 400 : 700);

/**
 * The mark drawn the way backend/app/services/image.py draws it (text_mark + watermark_layer):
 * same size units, padding, shadow, rotation direction, placement and tiling.
 */
function markCanvas(o: Options, imageWidth: number, mark: HTMLImageElement | null): HTMLCanvasElement | null {
  const c = document.createElement("canvas");
  const g = c.getContext("2d");
  if (!g) return null;
  if (o.kind === "image") {
    if (!mark) return null;
    const w = Math.max(4, Math.round(o.scale * imageWidth));
    const h = Math.max(1, Math.round((mark.naturalHeight * w) / mark.naturalWidth));
    c.width = w;
    c.height = h;
    g.drawImage(mark, 0, 0, w, h);
  } else {
    const px = Math.max(8, Math.round(o.size * imageWidth));
    // Anton ("Impact") has one weight; the server draws it as is, so the preview mustn't fake a bold.
    const font = `${o.italic ? "italic " : ""}${weightOf(o)} ${px}px ${familyFor(o.font, o.text)}`;
    g.font = font;
    const lines = o.text.split("\n");
    const lineH = px * 1.2;
    const textW = Math.max(...lines.map((l) => g.measureText(l).width));
    const pad = Math.round(px * 0.25);
    c.width = Math.ceil(textW + pad * 2);
    c.height = Math.ceil(lineH * lines.length + pad * 2);
    g.font = font;
    g.textAlign = "center";
    g.textBaseline = "middle";
    if (o.shadow) {
      g.shadowColor = "rgba(0,0,0,0.59)";
      g.shadowBlur = Math.max(1, px / 24) * 2;
      g.shadowOffsetX = g.shadowOffsetY = Math.max(1, px / 18);
    }
    g.fillStyle = o.color;
    lines.forEach((l, i) => g.fillText(l, c.width / 2, pad + lineH * (i + 0.5)));
  }
  // Fade and turn. Pillow turns counter-clockwise for a positive angle; the canvas turns clockwise.
  const rad = (-o.rotation * Math.PI) / 180;
  const rw = Math.ceil(Math.abs(c.width * Math.cos(rad)) + Math.abs(c.height * Math.sin(rad)));
  const rh = Math.ceil(Math.abs(c.width * Math.sin(rad)) + Math.abs(c.height * Math.cos(rad)));
  const out = document.createElement("canvas");
  out.width = Math.max(1, rw);
  out.height = Math.max(1, rh);
  const r = out.getContext("2d")!;
  r.globalAlpha = o.opacity;
  r.translate(rw / 2, rh / 2);
  r.rotate(rad);
  r.drawImage(c, -c.width / 2, -c.height / 2);
  return out;
}

function drawWatermark(g: CanvasRenderingContext2D, w: number, h: number, o: Options, mark: HTMLImageElement | null) {
  const m = markCanvas(o, w, mark);
  if (!m) return;
  if (o.mosaic) {
    const gapX = Math.round(m.width * 0.6) + 8;
    const gapY = Math.round(m.height * 1.2) + 8;
    let row = 0;
    for (let y = -Math.floor(m.height / 2); y < h; y += m.height + gapY, row++) {
      const shift = row % 2 ? Math.floor((m.width + gapX) / 2) : 0;
      for (let x = -Math.floor(m.width / 2) - shift; x < w; x += m.width + gapX) g.drawImage(m, x, y);
    }
    return;
  }
  const margin = Math.round(o.margin * Math.min(w, h));
  const col = { l: margin, c: (w - m.width) / 2, r: w - m.width - margin }[o.position[1] as "l" | "c" | "r"];
  const row = { t: margin, m: (h - m.height) / 2, b: h - m.height - margin }[o.position[0] as "t" | "m" | "b"];
  g.drawImage(m, Math.floor(col), Math.floor(row));
}

/** The first image with the watermark on it, redrawn as options change. */
function Preview({ item, options, mark }: { item: ImageItem; options: Options; mark: HTMLImageElement | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!item.url) return;
    const el = new Image();
    let live = true;
    el.onload = () => live && setImg(el);
    el.src = item.url;
    return () => {
      live = false;
    };
  }, [item.url]);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !img) return;
    let cancelled = false;
    const family = familyFor(options.font, options.text);
    loadFont(family, weightOf(options)).then(() => {
      if (cancelled) return;
      const max = 900;
      const scale = Math.min(1, max / img.naturalWidth);
      const w = Math.round(img.naturalWidth * scale);
      const h = Math.round(img.naturalHeight * scale);
      c.width = w;
      c.height = h;
      const g = c.getContext("2d")!;
      g.clearRect(0, 0, w, h);
      g.drawImage(img, 0, 0, w, h);
      drawWatermark(g, w, h, options, mark);
    });
    return () => {
      cancelled = true;
    };
  }, [img, options, mark]);

  if (!item.url) {
    return <p className="rounded-md border border-dashed border-line p-4 text-sm text-ink-2">This format can&apos;t be previewed in the browser. The watermark is placed the same way as on the others.</p>;
  }
  return (
    <figure className="md:sticky md:top-24">
      <div className={cn("flex justify-center overflow-hidden rounded-md border border-line p-2", CHECKER)}>
        <canvas ref={canvas} className="block h-auto max-h-[min(60vh,520px)] max-w-full" aria-label="Preview of the first image with the watermark" />
      </div>
      <figcaption className="label-mono mt-2 flex items-center gap-2 text-ink-3">
        <span aria-hidden className="h-px w-6 bg-ink-3" /> Fig. 01 — {item.file.name}
      </figcaption>
    </figure>
  );
}

export function WatermarkImageTool({ toolId, band }: { toolId: string; band?: React.ReactNode }) {
  const [o, setO] = useState<Options>({
    kind: "text",
    text: "© Your name",
    font: "sans",
    bold: true,
    italic: false,
    size: 0.06,
    color: "#ffffff",
    shadow: true,
    scale: 0.25,
    opacity: 0.6,
    rotation: 0,
    position: "br",
    mosaic: false,
    margin: 0.03,
  });
  const [markFile, setMarkFile] = useState<File | null>(null);
  const [markImg, setMarkImg] = useState<HTMLImageElement | null>(null);
  const [markError, setMarkError] = useState<string | null>(null);
  const markInput = useRef<HTMLInputElement>(null);
  const set = <K extends keyof Options>(k: K, v: Options[K]) => setO((prev) => ({ ...prev, [k]: v }));

  const pickMark = (f: File) => {
    const problem = checkFile(f, [...IMAGE_INPUTS.mark], 20);
    setMarkError(problem);
    if (problem) return;
    setMarkFile(f);
    const url = URL.createObjectURL(f);
    const el = new Image();
    el.onload = () => setMarkImg(el);
    el.onerror = () => setMarkError("We couldn't read that image.");
    el.src = url;
  };

  const payload = () => ({
    kind: o.kind,
    text: o.kind === "text" ? { text: o.text, font: o.font, bold: o.bold, italic: o.italic, size: o.size, color: o.color, shadow: o.shadow } : null,
    scale: o.scale,
    opacity: o.opacity,
    rotation: o.rotation,
    position: o.position,
    mosaic: o.mosaic,
    margin: o.margin,
  });

  return (
    <div className={FONT_CLASSES}>
      <ImageTask
        toolId={toolId}
        band={band}
        input="watermark"
        endpoint={IMAGE_API("watermark")}
        label={({ items }) => `Watermark ${plural(items.length, "image")}`}
        working="Stamping…"
        fields={() => [["options", JSON.stringify(payload())], ...(o.kind === "image" && markFile ? ([["mark", markFile, markFile.name]] as [string, Blob, string][]) : [])]}
        invalid={() => (o.kind === "text" && !o.text.trim() ? "Type the watermark text." : o.kind === "image" && !markFile ? "Choose the image to stamp (a logo works best as PNG)." : null)}
        hint="Sizes are relative to each image's width, so a batch of different sizes looks alike."
        options={({ locked, items }) => (
          <div className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:items-start">
            <Panel>
              <Row label="Stamp">
                <Chips
                  label="Stamp"
                  value={o.kind}
                  onChange={(v) => set("kind", v)}
                  disabled={locked}
                  options={[
                    { value: "text", label: "Text" },
                    { value: "image", label: "Image" },
                  ]}
                />
              </Row>
              {o.kind === "text" ? (
                <>
                  <Row label="Text">
                    <TextField value={o.text} onChange={(v) => set("text", v.slice(0, 200))} label="Watermark text" maxLength={200} disabled={locked} />
                  </Row>
                  <Row label="Font">
                    <Chips label="Font" value={o.font} onChange={(v) => set("font", v)} disabled={locked} options={FONT_OPTIONS} />
                    <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-2">
                      <Toggle checked={o.bold && o.font !== "impact"} onChange={(v) => set("bold", v)} disabled={locked || o.font === "impact"} label="Bold" />
                      <Toggle checked={o.italic} onChange={(v) => set("italic", v)} disabled={locked} label="Italic" />
                      <Toggle checked={o.shadow} onChange={(v) => set("shadow", v)} disabled={locked} label="Shadow" />
                    </div>
                  </Row>
                  <Row label="Size">
                    <Slider label="Text size" value={Math.round(o.size * 100)} min={2} max={30} onChange={(v) => set("size", v / 100)} format={(v) => `${v}%`} disabled={locked} />
                  </Row>
                  <Row label="Colour">
                    <Swatches value={o.color} onChange={(v) => set("color", v)} colors={COLORS} disabled={locked} />
                  </Row>
                </>
              ) : (
                <Row label="Image to stamp">
                  <input
                    ref={markInput}
                    type="file"
                    accept={IMAGE_INPUTS.mark.join(",")}
                    className="sr-only"
                    tabIndex={-1}
                    aria-hidden
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) pickMark(f);
                      e.target.value = "";
                    }}
                  />
                  {markFile ? (
                    <div className="flex items-center gap-3 rounded-sm border border-line bg-surface p-1.5">
                      <span className={cn("flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-[4px] border border-line", CHECKER)}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {markImg && <img src={markImg.src} alt="" className="max-h-full max-w-full object-contain" />}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm text-ink">{markFile.name}</span>
                      <button type="button" disabled={locked} onClick={() => { setMarkFile(null); setMarkImg(null); }} aria-label="Remove the stamp image" className="inline-flex size-8 items-center justify-center rounded-[6px] text-ink-3 hover:bg-paper-2 hover:text-ink">
                        <X aria-hidden className="size-4" />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={locked}
                      onClick={() => markInput.current?.click()}
                      className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md border border-dashed border-ink-3/60 text-sm text-ink-2 transition-colors hover:border-ink hover:text-ink"
                    >
                      <ImagePlus aria-hidden className="size-4" /> Choose a logo or image
                    </button>
                  )}
                  {markError && <p className="mt-2 text-xs text-danger">{markError}</p>}
                  <div className="mt-3">
                    <Slider label="Stamp width" value={Math.round(o.scale * 100)} min={2} max={100} onChange={(v) => set("scale", v / 100)} format={(v) => `${v}%`} disabled={locked} />
                  </div>
                </Row>
              )}
              <Row label="Opacity">
                <Slider label="Opacity" value={Math.round(o.opacity * 100)} min={5} max={100} step={5} onChange={(v) => set("opacity", v / 100)} format={(v) => `${v}%`} disabled={locked} />
              </Row>
              <Row label="Turn">
                <Slider label="Rotation" value={o.rotation} min={-90} max={90} step={5} onChange={(v) => set("rotation", v)} format={(v) => `${v}°`} disabled={locked} />
              </Row>
              <Row label="Place">
                <div className="flex flex-wrap items-start gap-4">
                  <div className={cn(o.mosaic && "pointer-events-none opacity-40")}>
                    <PositionGrid value={o.position} onChange={(v) => set("position", v)} disabled={locked || o.mosaic} />
                  </div>
                  <Toggle checked={o.mosaic} onChange={(v) => set("mosaic", v)} disabled={locked} label="Repeat across the image" description="A tiled pattern is much harder to crop out." />
                </div>
              </Row>
            </Panel>
            {items[0] && <Preview item={items.find((i) => i.url) ?? items[0]} options={o} mark={o.kind === "image" ? markImg : null} />}
          </div>
        )}
      />
    </div>
  );
}
