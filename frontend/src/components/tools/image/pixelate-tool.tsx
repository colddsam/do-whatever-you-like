"use client";

import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import { saveBlob } from "@/lib/files";
import { formatBytes } from "@/lib/media";
import { getTool, stepsFor } from "@/lib/tools";
import { cn } from "@/lib/utils";
import { FileDrop } from "../file-drop";
import { Workbench } from "../workbench";
import { Chips, Notice, Panel, Row, Slider, Toggle } from "../pdf/kit";
import { CHECKER } from "./task";

type Style = "square" | "rounded" | "dots" | "mosaic";
type PaletteId = "original" | "limit" | "gameboy" | "pico8" | "cga" | "grey" | "bw";
type Rect = { x: number; y: number; w: number; h: number };

const PALETTES: Record<Exclude<PaletteId, "original" | "limit">, number[][]> = {
  gameboy: [[15, 56, 15], [48, 98, 48], [139, 172, 15], [155, 188, 15]],
  pico8: [[0, 0, 0], [29, 43, 83], [126, 37, 83], [0, 135, 81], [171, 82, 54], [95, 87, 79], [194, 195, 199], [255, 241, 232], [255, 0, 77], [255, 163, 0], [255, 236, 39], [0, 228, 54], [41, 173, 255], [131, 118, 156], [255, 119, 168], [255, 204, 170]],
  cga: [[0, 0, 0], [85, 255, 255], [255, 85, 255], [255, 255, 255]],
  grey: Array.from({ length: 8 }, (_, i) => [i * 36, i * 36, i * 36]),
  bw: [[0, 0, 0], [255, 255, 255]],
};
const MAX_PIXELS = 40_000_000;
const PREVIEW_SIDE = 1100;

type Opts = { block: number; style: Style; palette: PaletteId; colors: number; grid: boolean; region: Rect | null };

const nearest = (pal: number[][], r: number, g: number, b: number) => {
  let best = pal[0];
  let bd = Infinity;
  for (const c of pal) {
    const d = (c[0] - r) ** 2 * 0.3 + (c[1] - g) ** 2 * 0.59 + (c[2] - b) ** 2 * 0.11;
    if (d < bd) {
      bd = d;
      best = c;
    }
  }
  return best;
};

/** Block colours (average of each block's pixels), mapped to the chosen palette. */
async function blockColours(data: ImageData, o: Opts) {
  const { width: W, height: H, data: px } = data;
  const b = o.block;
  const cols = Math.ceil(W / b);
  const rows = Math.ceil(H / b);
  const out = new Uint8ClampedArray(cols * rows * 4);
  for (let by = 0; by < rows; by++) {
    for (let bx = 0; bx < cols; bx++) {
      let r = 0, g = 0, bl = 0, a = 0, n = 0;
      const x1 = Math.min(W, (bx + 1) * b);
      const y1 = Math.min(H, (by + 1) * b);
      // Every pixel on small blocks; a sample grid on big ones (same average, far less work).
      const stepPx = b > 24 ? Math.ceil(b / 24) : 1;
      for (let y = by * b; y < y1; y += stepPx) {
        for (let x = bx * b; x < x1; x += stepPx) {
          const i = (y * W + x) * 4;
          const al = px[i + 3];
          r += px[i] * al;
          g += px[i + 1] * al;
          bl += px[i + 2] * al;
          a += al;
          n++;
        }
      }
      const o4 = (by * cols + bx) * 4;
      out[o4] = a ? r / a : 0;
      out[o4 + 1] = a ? g / a : 0;
      out[o4 + 2] = a ? bl / a : 0;
      out[o4 + 3] = n ? a / n : 0;
    }
  }
  let pal: number[][] | null = null;
  if (o.palette === "limit") {
    const mod = await import("gifenc");
    const { quantize } = ("quantize" in mod ? mod : (mod as unknown as { default: typeof mod }).default) as typeof mod;
    pal = quantize(out, o.colors);
  } else if (o.palette !== "original") pal = PALETTES[o.palette];
  if (pal) {
    for (let i = 0; i < out.length; i += 4) {
      const c = nearest(pal, out[i], out[i + 1], out[i + 2]);
      out[i] = c[0];
      out[i + 1] = c[1];
      out[i + 2] = c[2];
    }
  }
  return { cols, rows, colours: out };
}

/** Draws the result at `scale` of the original size into `canvas`. */
function paint(canvas: HTMLCanvasElement, img: CanvasImageSource, W: number, H: number, scale: number, o: Opts, blocks: { cols: number; rows: number; colours: Uint8ClampedArray }) {
  const cw = Math.max(1, Math.round(W * scale));
  const ch = Math.max(1, Math.round(H * scale));
  canvas.width = cw;
  canvas.height = ch;
  const g = canvas.getContext("2d")!;
  g.clearRect(0, 0, cw, ch);
  const r = o.region;
  // A part only: the original picture underneath, pixelated inside the box.
  if (r) g.drawImage(img, 0, 0, cw, ch);
  const b = o.block;
  const s = b * scale;
  const inRegion = (bx: number, by: number) => !r || ((bx + 1) * b > r.x && bx * b < r.x + r.w && (by + 1) * b > r.y && by * b < r.y + r.h);
  if (r) {
    g.save();
    g.beginPath();
    g.rect(r.x * scale, r.y * scale, r.w * scale, r.h * scale);
    g.clip();
  }
  if (o.style === "dots" || o.style === "mosaic") {
    g.fillStyle = o.style === "dots" ? "#111111" : "#e9e5da";
    g.fillRect(r ? r.x * scale : 0, r ? r.y * scale : 0, r ? r.w * scale : cw, r ? r.h * scale : ch);
  }
  for (let by = 0; by < blocks.rows; by++) {
    for (let bx = 0; bx < blocks.cols; bx++) {
      if (!inRegion(bx, by)) continue;
      const i = (by * blocks.cols + bx) * 4;
      const c = blocks.colours;
      g.fillStyle = `rgba(${c[i]},${c[i + 1]},${c[i + 2]},${c[i + 3] / 255})`;
      const x = bx * s;
      const y = by * s;
      if (o.style === "square") g.fillRect(Math.floor(x), Math.floor(y), Math.ceil(s) + 1, Math.ceil(s) + 1);
      else if (o.style === "dots") {
        g.beginPath();
        g.arc(x + s / 2, y + s / 2, s * 0.46, 0, Math.PI * 2);
        g.fill();
      } else {
        const gap = o.style === "mosaic" ? Math.max(1, s * 0.09) : Math.max(0.5, s * 0.04);
        g.beginPath();
        g.roundRect(x + gap / 2, y + gap / 2, s - gap, s - gap, o.style === "rounded" ? s * 0.28 : s * 0.08);
        g.fill();
      }
    }
  }
  if (o.grid && s >= 4) {
    g.strokeStyle = "rgba(0,0,0,0.28)";
    g.lineWidth = Math.max(1, s * 0.04);
    g.beginPath();
    for (let x = 0; x <= blocks.cols; x++) {
      g.moveTo(x * s, 0);
      g.lineTo(x * s, ch);
    }
    for (let y = 0; y <= blocks.rows; y++) {
      g.moveTo(0, y * s);
      g.lineTo(cw, y * s);
    }
    g.stroke();
  }
  if (r) g.restore();
}

export function PixelateTool({ toolId }: { toolId: string }) {
  const tool = getTool(toolId)!;
  const [file, setFile] = useState<File | null>(null);
  const [img, setImg] = useState<{ bitmap: ImageBitmap; data: ImageData; W: number; H: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [o, setO] = useState<Opts>({ block: 16, style: "square", palette: "original", colors: 16, grid: false, region: null });
  const [area, setArea] = useState<"whole" | "part">("whole");
  const [format, setFormat] = useState<"png" | "jpg" | "webp">("png");
  const [artSize, setArtSize] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lastSize, setLastSize] = useState<number | null>(null);
  const preview = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const set = (p: Partial<Opts>) => setO((v) => ({ ...v, ...p }));

  const take = async (f: File) => {
    setError(null);
    try {
      const bitmap = await createImageBitmap(f);
      if (bitmap.width * bitmap.height > MAX_PIXELS) return setError("That picture is over 40 megapixels. Resize it first.");
      const c = document.createElement("canvas");
      c.width = bitmap.width;
      c.height = bitmap.height;
      const g = c.getContext("2d", { willReadFrequently: true })!;
      g.drawImage(bitmap, 0, 0);
      setImg({ bitmap, data: g.getImageData(0, 0, c.width, c.height), W: c.width, H: c.height });
      setFile(f);
      set({ block: Math.max(4, Math.round(Math.max(c.width, c.height) / 64)), region: null });
      setArea("whole");
    } catch {
      setError("That picture couldn't be opened. Use JPG, PNG, WebP, GIF, BMP or AVIF.");
    }
  };

  // Live preview, a moment after the last change.
  useEffect(() => {
    if (!img || !preview.current) return;
    let live = true;
    const t = setTimeout(async () => {
      const blocks = await blockColours(img.data, o);
      if (!live || !preview.current) return;
      paint(preview.current, img.bitmap, img.W, img.H, Math.min(1, PREVIEW_SIDE / Math.max(img.W, img.H)), o, blocks);
    }, 60);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [img, o]);

  const scale = img ? Math.min(1, PREVIEW_SIDE / Math.max(img.W, img.H)) : 1;
  const toSrc = (e: React.PointerEvent) => {
    const r = preview.current!.getBoundingClientRect();
    const k = img!.W / r.width;
    return { x: Math.max(0, Math.min(img!.W, (e.clientX - r.left) * k)), y: Math.max(0, Math.min(img!.H, (e.clientY - r.top) * k)) };
  };

  const download = async () => {
    if (!img || !file) return;
    setBusy(true);
    try {
      const blocks = await blockColours(img.data, o);
      const c = document.createElement("canvas");
      if (artSize && !o.region) {
        c.width = blocks.cols;
        c.height = blocks.rows;
        c.getContext("2d")!.putImageData(new ImageData(blocks.colours, blocks.cols, blocks.rows), 0, 0);
      } else paint(c, img.bitmap, img.W, img.H, 1, o, blocks);
      if (format === "jpg") {
        const flat = document.createElement("canvas");
        flat.width = c.width;
        flat.height = c.height;
        const g = flat.getContext("2d")!;
        g.fillStyle = "#ffffff";
        g.fillRect(0, 0, c.width, c.height);
        g.drawImage(c, 0, 0);
        c.width = 0;
        return await finish(flat);
      }
      await finish(c);
    } finally {
      setBusy(false);
    }
    async function finish(canvas: HTMLCanvasElement) {
      const type = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" }[format];
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, type, 0.92));
      if (!blob) return;
      setLastSize(blob.size);
      saveBlob(blob, `${file!.name.replace(/\.[^.]+$/, "")}-pixelated.${format}`);
    }
  };

  return (
    <Workbench steps={stepsFor(tool)} current={!img ? 0 : 1} footer="Your picture is pixelated in the browser and never uploaded.">
      <div className="@container grid gap-4 p-3 sm:p-4 md:p-5">
        {!img ? (
          <FileDrop accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif" title="Drop a picture here" formats="JPG · PNG · WebP · GIF · BMP · AVIF" error={error} onFile={take} />
        ) : (
          <div className="grid gap-4 @3xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <div className="grid content-start gap-2">
              <div className="flex justify-center rounded-md border border-line p-2" style={{ backgroundImage: CHECKER }}>
                <div className="relative">
                  <canvas
                    ref={preview}
                    aria-label="Pixelated preview"
                    className={cn("block h-auto max-h-[560px] max-w-full", area === "part" && "cursor-crosshair touch-none")}
                    onPointerDown={(e) => {
                      if (area !== "part") return;
                      (e.target as Element).setPointerCapture(e.pointerId);
                      drag.current = toSrc(e);
                      set({ region: { ...drag.current, w: 1, h: 1 } });
                    }}
                    onPointerMove={(e) => {
                      if (!drag.current) return;
                      const p = toSrc(e);
                      const d = drag.current;
                      set({ region: { x: Math.min(d.x, p.x), y: Math.min(d.y, p.y), w: Math.max(1, Math.abs(p.x - d.x)), h: Math.max(1, Math.abs(p.y - d.y)) } });
                    }}
                    onPointerUp={() => (drag.current = null)}
                  />
                  {area === "part" && o.region && (
                    <span aria-hidden className="pointer-events-none absolute border-2 border-dashed border-accent" style={{ left: `${(o.region.x / img.W) * 100}%`, top: `${(o.region.y / img.H) * 100}%`, width: `${(o.region.w / img.W) * 100}%`, height: `${(o.region.h / img.H) * 100}%` }} />
                  )}
                </div>
              </div>
              <p className="flex flex-wrap justify-between gap-2 font-mono text-[12px] text-ink-3">
                <span>
                  {file?.name} · {img.W}×{img.H}
                </span>
                <span>
                  {Math.ceil(img.W / o.block)}×{Math.ceil(img.H / o.block)} blocks{scale < 1 ? ` · preview ${Math.round(scale * 100)}%` : ""}
                </span>
              </p>
            </div>
            <div className="grid content-start gap-3">
              <Panel>
                <Row label="Block size">
                  <Slider label="Block size" value={o.block} min={2} max={Math.max(8, Math.round(Math.max(img.W, img.H) / 6))} onChange={(v) => set({ block: v })} format={(v) => `${v} px`} />
                </Row>
                <Row label="Style">
                  <Chips value={o.style} options={[{ value: "square", label: "Squares" }, { value: "rounded", label: "Rounded" }, { value: "dots", label: "Dots" }, { value: "mosaic", label: "Mosaic tiles" }]} onChange={(v) => set({ style: v })} label="Style" />
                </Row>
                <Row label="Colours">
                  <Chips
                    value={o.palette}
                    options={[{ value: "original", label: "Original" }, { value: "limit", label: "Fewer colours" }, { value: "gameboy", label: "Game Boy" }, { value: "pico8", label: "PICO-8" }, { value: "cga", label: "CGA" }, { value: "grey", label: "Greyscale" }, { value: "bw", label: "Black & white" }]}
                    onChange={(v) => set({ palette: v })}
                    label="Colours"
                  />
                  {o.palette === "limit" && (
                    <div className="mt-3">
                      <Slider label="Number of colours" value={o.colors} min={2} max={64} onChange={(v) => set({ colors: v })} format={(v) => String(v)} />
                    </div>
                  )}
                </Row>
                <Row label="Area">
                  <Chips value={area} options={[{ value: "whole", label: "Whole picture" }, { value: "part", label: "Only a part" }]} onChange={(v) => (setArea(v), set({ region: v === "part" ? { x: img.W * 0.3, y: img.H * 0.3, w: img.W * 0.4, h: img.H * 0.4 } : null }))} label="Area" />
                  {area === "part" && <p className="mt-2 text-xs text-ink-3">Drag on the picture to choose the part to pixelate (faces, plates, names).</p>}
                </Row>
                <Row label="Extras">
                  <div className="grid gap-3">
                    <Toggle checked={o.grid} onChange={(v) => set({ grid: v })} label="Grid lines" />
                    <Toggle checked={artSize} onChange={setArtSize} disabled={area === "part"} label="Pixel-art size" description="One pixel per block: a tiny image for games and sprites." />
                  </div>
                </Row>
                <Row label="Format">
                  <Chips value={format} options={[{ value: "png", label: "PNG" }, { value: "jpg", label: "JPG" }, { value: "webp", label: "WebP" }]} onChange={setFormat} label="Format" />
                </Row>
              </Panel>
              <button type="button" onClick={download} disabled={busy} className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-ink px-5 text-sm font-medium text-paper transition-[opacity,transform] hover:opacity-90 active:scale-[0.98] disabled:opacity-50">
                <Download aria-hidden className="size-4" />
                {busy ? "Making it…" : `Download ${format.toUpperCase()}`}
                <span className="font-mono text-[12px] font-normal text-paper/60">{artSize && area === "whole" ? `${Math.ceil(img.W / o.block)}×${Math.ceil(img.H / o.block)}` : `${img.W}×${img.H}`}</span>
              </button>
              {lastSize !== null && <p className="font-mono text-[12px] text-ink-3">Last download: {formatBytes(lastSize)}</p>}
              <button type="button" onClick={() => (setImg(null), setFile(null))} className="w-fit text-sm text-ink-3 underline-offset-4 hover:text-ink hover:underline">
                Use another picture
              </button>
              {area === "part" && <Notice>Pixelated areas are baked into the downloaded file: the original pixels can&apos;t be recovered from it.</Notice>}
            </div>
          </div>
        )}
      </div>
    </Workbench>
  );
}
