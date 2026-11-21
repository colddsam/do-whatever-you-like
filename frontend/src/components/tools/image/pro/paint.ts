import { cloneCanvas, coverDoc, ctx2d, hexToRgb, luminance, makeCanvas, selectionInLayer } from "./doc";
import { blurImage, clamp255, rgbToHsl, hslToRgb } from "./ops";
import type { Live } from "./render";
import type { BrushSettings, Doc, Layer, Pt, SymmetryMode, ToolId } from "./types";

/*
 * Strokes. Brush, pencil, eraser and spot healing paint into a buffer the size of the layer: the
 * screen shows it over the layer live, and it's merged once at the end at the stroke's opacity
 * (Photoshop's model: flow builds up inside a stroke, opacity caps it). Every other brush edits a
 * working copy of the layer's pixels stamp by stamp.
 */

export const BUFFER_TOOLS: ToolId[] = ["brush", "pencil", "eraser", "spot-heal"];
export const PIXEL_TOOLS: ToolId[] = ["clone", "heal", "smudge", "blur-brush", "sharpen-brush", "dodge", "burn", "sponge", "liquify", "mosaic-brush"];

const tips = new Map<string, HTMLCanvasElement>();
/** A round brush tip: solid to `hardness`, then fading to clear at the edge. */
export function tip(size: number, hardness: number, color = "#fff", hard = false) {
  const d = Math.max(1, Math.round(size));
  const key = `${d}|${hardness}|${color}|${hard}`;
  let c = tips.get(key);
  if (c) return c;
  c = makeCanvas(d, d);
  const g = ctx2d(c);
  const r = d / 2;
  if (hard) {
    g.fillStyle = color;
    if (d <= 2) g.fillRect(0, 0, d, d);
    else {
      g.beginPath();
      g.arc(r, r, r, 0, Math.PI * 2);
      g.fill();
    }
  } else {
    const grad = g.createRadialGradient(r, r, Math.min(r * 0.999, (r * hardness) / 100), r, r, r);
    const [cr, cg, cb] = hexToRgb(color);
    grad.addColorStop(0, `rgba(${cr},${cg},${cb},1)`);
    grad.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, d, d);
  }
  if (tips.size > 64) tips.delete(tips.keys().next().value!);
  tips.set(key, c);
  return c;
}

/** Brush falloff at distance `t` (0 centre … 1 edge) for pixel tools. */
const falloff = (t: number, hardness: number) => {
  const h = hardness / 100;
  if (t <= h) return 1;
  if (t >= 1) return 0;
  const u = (t - h) / (1 - h);
  return 1 - u * u * (3 - 2 * u);
};

export type StrokeState = {
  tool: ToolId;
  set: BrushSettings;
  docW: number;
  docH: number;
  /** The layer as it was (undo keeps it), and the layer grown to cover the document. */
  before: Layer;
  layer: Layer;
  onMask: boolean;
  color: string;
  erase: boolean;
  /** Selection in the layer's pixel space, or null for "everywhere". */
  clip: HTMLCanvasElement | null;
  buffer: HTMLCanvasElement | null;
  work: HTMLCanvasElement | null;
  /** Where clone and heal read from (layer space), and the offset from the brush to it. */
  source: HTMLCanvasElement | null;
  offset: Pt | null;
  /** The last pointer position and the last stamp (smudge and liquify drag from the stamp). */
  last: Pt | null;
  lastStamp: Pt | null;
  carry: number;
};

export function beginStroke(
  doc: Doc,
  layer: Layer,
  tool: ToolId,
  set: BrushSettings,
  fg: string,
  bg: string,
  opts: { cloneSource?: Pt | null; flat?: HTMLCanvasElement | null; at: Pt },
): StrokeState {
  const onMask = doc.editMask && !!layer.mask;
  const grown = coverDoc(layer, doc);
  const base = onMask ? grown.mask! : grown.canvas;
  const clip = doc.selection ? selectionInLayer(doc.selection, grown) : null;
  const dark = luminance(fg) < 128;
  const erase = onMask ? (tool === "eraser" ? !(luminance(bg) < 128) : dark) : tool === "eraser";
  const state: StrokeState = {
    tool,
    set,
    docW: doc.w,
    docH: doc.h,
    before: layer,
    layer: grown,
    onMask,
    color: onMask ? "#fff" : tool === "spot-heal" ? "#ff3b30" : fg,
    erase,
    clip,
    buffer: null,
    work: null,
    source: null,
    offset: null,
    last: null,
    lastStamp: null,
    carry: 0,
  };
  if (BUFFER_TOOLS.includes(tool)) state.buffer = makeCanvas(base.width, base.height);
  else {
    state.work = cloneCanvas(base);
    if (tool === "clone" || tool === "heal") {
      if (opts.flat) {
        // "Sample all layers": the flattened picture, moved into this layer's space.
        const s = makeCanvas(base.width, base.height);
        ctx2d(s).drawImage(opts.flat, grown.x, grown.y);
        state.source = s;
      } else state.source = cloneCanvas(base);
      if (opts.cloneSource) state.offset = { x: opts.cloneSource.x - opts.at.x, y: opts.cloneSource.y - opts.at.y };
    }
  }
  return state;
}

/** What the screen shows while the stroke is in progress (the layer grown to the document, plus the stroke). */
export function liveFor(s: StrokeState): Live {
  if (s.buffer)
    return {
      swap: s.layer,
      stroke: {
        layerId: s.layer.id,
        canvas: s.buffer,
        opacity: s.tool === "spot-heal" ? 0.5 : s.set.opacity / 100,
        erase: s.erase && s.tool !== "spot-heal",
        mask: s.onMask,
        lockAlpha: s.layer.lockAlpha,
        clip: s.clip,
      },
    };
  return { swap: s.onMask ? { ...s.layer, mask: s.work! } : s.layer, replace: s.onMask ? undefined : { layerId: s.layer.id, canvas: s.work!, scale: 1 } };
}

const SYMMETRY_TOOLS: ToolId[] = ["brush", "pencil", "eraser"];

function symmetryPoints(pt: Pt, docW: number, docH: number, layer: Layer, mode: SymmetryMode): Pt[] {
  if (mode === "off") return [pt];
  const cx = docW / 2 - layer.x;
  const cy = docH / 2 - layer.y;
  const mx = 2 * cx - pt.x;
  const my = 2 * cy - pt.y;
  if (mode === "vertical") return [pt, { x: mx, y: pt.y }];
  if (mode === "horizontal") return [pt, { x: pt.x, y: my }];
  if (mode === "quad") return [pt, { x: mx, y: pt.y }, { x: pt.x, y: my }, { x: mx, y: my }];
  const n = mode === "radial6" ? 6 : 8;
  const dx = pt.x - cx;
  const dy = pt.y - cy;
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i * Math.PI * 2) / n;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    pts.push({ x: cx + dx * ca - dy * sa, y: cy + dx * sa + dy * ca });
  }
  return pts;
}

/** Adds stamps from the last point to `p` (document space). `pressure` is 0..1 from a pen. */
export function strokeTo(s: StrokeState, p: Pt, pressure = 1) {
  const pt = { x: p.x - s.layer.x, y: p.y - s.layer.y };
  const size = Math.max(1, s.set.size * (pressure > 0 && pressure < 1 ? 0.25 + pressure * 0.75 : 1));
  const sym = SYMMETRY_TOOLS.includes(s.tool) ? s.set.symmetry : "off";
  const put = (q: Pt) => {
    const prev = s.lastStamp ?? q;
    if (sym === "off") stamp(s, q, size, prev);
    else {
      for (const mq of symmetryPoints(q, s.docW, s.docH, s.layer, sym)) stamp(s, mq, size, prev);
    }
    s.lastStamp = q;
  };
  if (!s.last) {
    put(pt);
    s.last = pt;
    return;
  }
  const spacing = Math.max(1, size * (PIXEL_TOOLS.includes(s.tool) ? Math.max(0.15, s.set.spacing / 100) : s.set.spacing / 100));
  const dx = pt.x - s.last.x;
  const dy = pt.y - s.last.y;
  const dist = Math.hypot(dx, dy);
  // `carry` is how far past the last stamp the previous segment ended.
  let t = spacing - s.carry;
  while (t <= dist) {
    put({ x: s.last.x + (dx * t) / dist, y: s.last.y + (dy * t) / dist });
    t += spacing;
  }
  s.carry = dist - (t - spacing);
  s.last = pt;
}

function stamp(s: StrokeState, p: Pt, size: number, prev: Pt) {
  const r = size / 2;
  if (s.buffer) {
    const g = ctx2d(s.buffer);
    g.globalAlpha = s.tool === "spot-heal" ? 1 : s.set.flow / 100;
    g.imageSmoothingEnabled = s.tool !== "pencil";
    const t = tip(size, s.tool === "pencil" ? 100 : s.set.hardness, s.erase ? "#000" : s.color, s.tool === "pencil");
    const x = s.tool === "pencil" ? Math.round(p.x - r) : p.x - r;
    const y = s.tool === "pencil" ? Math.round(p.y - r) : p.y - r;
    g.drawImage(t, x, y);
    return;
  }
  const work = s.work!;
  const g = ctx2d(work, true);
  const strength = (s.set.strength / 100) * (s.set.flow / 100);
  switch (s.tool) {
    case "clone":
    case "heal": {
      if (!s.offset || !s.source) return;
      const d = Math.ceil(size);
      const patch = makeCanvas(d, d);
      const pg = ctx2d(patch, true);
      pg.drawImage(s.source, p.x + s.offset.x - r, p.y + s.offset.y - r, d, d, 0, 0, d, d);
      if (s.tool === "heal") matchColour(pg, work, p.x - r, p.y - r, d);
      pg.globalCompositeOperation = "destination-in";
      pg.drawImage(tip(size, s.set.hardness), 0, 0);
      clipPatch(s, pg, p.x - r, p.y - r);
      g.globalAlpha = (s.set.opacity / 100) * (s.set.flow / 100);
      g.drawImage(patch, p.x - r, p.y - r);
      g.globalAlpha = 1;
      return;
    }
    case "smudge": {
      const d = Math.ceil(size);
      const patch = makeCanvas(d, d);
      const pg = ctx2d(patch);
      pg.drawImage(work, prev.x - r, prev.y - r, d, d, 0, 0, d, d);
      pg.globalCompositeOperation = "destination-in";
      pg.drawImage(tip(size, s.set.hardness), 0, 0);
      clipPatch(s, pg, p.x - r, p.y - r);
      g.globalAlpha = Math.min(1, strength * 1.1);
      g.drawImage(patch, p.x - r, p.y - r);
      g.globalAlpha = 1;
      return;
    }
    default:
      pixelStamp(s, g, p, r, strength, prev);
  }
}

/** Heal: keep the source's texture but shift its colour to the average of what it covers. */
function matchColour(pg: CanvasRenderingContext2D, work: HTMLCanvasElement, x: number, y: number, d: number) {
  const src = pg.getImageData(0, 0, d, d);
  const dst = ctx2d(work, true).getImageData(Math.round(x), Math.round(y), d, d);
  const mean = (img: ImageData) => {
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < img.data.length; i += 4) {
      if (img.data[i + 3] < 8) continue;
      r += img.data[i];
      g += img.data[i + 1];
      b += img.data[i + 2];
      n++;
    }
    return n ? [r / n, g / n, b / n] : null;
  };
  const a = mean(src);
  const b = mean(dst);
  if (!a || !b) return;
  for (let i = 0; i < src.data.length; i += 4) for (let c = 0; c < 3; c++) src.data[i + c] = clamp255(src.data[i + c] + (b[c] - a[c]));
  pg.putImageData(src, 0, 0);
}

/** Limits a patch to the selection (patch drawn at x, y in layer space). */
function clipPatch(s: StrokeState, pg: CanvasRenderingContext2D, x: number, y: number) {
  if (!s.clip) return;
  pg.globalCompositeOperation = "destination-in";
  pg.drawImage(s.clip, -x, -y);
  pg.globalCompositeOperation = "source-over";
}

function pixelStamp(s: StrokeState, g: CanvasRenderingContext2D, p: Pt, r: number, strength: number, prev: Pt) {
  const x0 = Math.max(0, Math.floor(p.x - r));
  const y0 = Math.max(0, Math.floor(p.y - r));
  const x1 = Math.min(g.canvas.width, Math.ceil(p.x + r));
  const y1 = Math.min(g.canvas.height, Math.ceil(p.y + r));
  const w = x1 - x0;
  const h = y1 - y0;
  if (w <= 0 || h <= 0) return;
  const img = g.getImageData(x0, y0, w, h);
  const d = img.data;
  const clip = s.clip ? ctx2d(s.clip, true).getImageData(x0, y0, w, h).data : null;
  const weight = (x: number, y: number) => {
    const t = Math.hypot(x0 + x + 0.5 - p.x, y0 + y + 0.5 - p.y) / r;
    const f = falloff(t, s.set.hardness);
    return clip ? (f * clip[(y * w + x) * 4 + 3]) / 255 : f;
  };
  let ref: Uint8ClampedArray | null = null;
  if (s.tool === "blur-brush" || s.tool === "sharpen-brush") {
    const b = new ImageData(new Uint8ClampedArray(d), w, h);
    blurImage(b, Math.max(1.5, r * 0.18));
    ref = b.data;
  }
  const src = s.tool === "liquify" || s.tool === "mosaic-brush" ? new Uint8ClampedArray(d) : null;
  const blockSize = Math.max(4, Math.round(s.set.mosaicSize || 16));
  const ldx = p.x - prev.x;
  const ldy = p.y - prev.y;
  const range = s.set.range;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = weight(x, y) * strength;
    if (k <= 0.001) continue;
    const i = (y * w + x) * 4;
    switch (s.tool) {
      case "mosaic-brush": {
        const bx = Math.floor((x0 + x) / blockSize) * blockSize + Math.floor(blockSize / 2) - x0;
        const by = Math.floor((y0 + y) / blockSize) * blockSize + Math.floor(blockSize / 2) - y0;
        const xi = Math.max(0, Math.min(w - 1, bx));
        const yi = Math.max(0, Math.min(h - 1, by));
        const j = (yi * w + xi) * 4;
        const mixK = Math.min(1, weight(x, y) * (s.set.opacity / 100));
        for (let c = 0; c < 3; c++) d[i + c] = clamp255(d[i + c] + (src![j + c] - d[i + c]) * mixK);
        break;
      }
      case "blur-brush":
        for (let c = 0; c < 4; c++) d[i + c] += (ref![i + c] - d[i + c]) * k;
        break;
      case "sharpen-brush":
        for (let c = 0; c < 3; c++) d[i + c] = clamp255(d[i + c] + (d[i + c] - ref![i + c]) * k * 1.5);
        break;
      case "dodge":
      case "burn": {
        for (let c = 0; c < 3; c++) {
          const v = d[i + c] / 255;
          // Each range weights the effect toward its tones, like Photoshop's Range setting.
          const zone = range === "shadows" ? 1 - v : range === "highlights" ? v : 1 - Math.abs(v - 0.5) * 2;
          const amt = k * 0.25 * (0.35 + zone);
          d[i + c] = clamp255((s.tool === "dodge" ? v + (1 - v) * amt : v - v * amt) * 255);
        }
        break;
      }
      case "sponge": {
        const [hh, ss, ll] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
        const ns = s.set.spongeMode === "saturate" ? ss + (1 - ss) * k * 0.3 : ss * (1 - k * 0.3);
        const [rr, gg, bb] = hslToRgb(hh, ns, ll);
        d[i] = rr;
        d[i + 1] = gg;
        d[i + 2] = bb;
        break;
      }
      case "liquify": {
        // Forward warp: pull pixels along the direction the brush moved.
        const sx = x - ldx * k * 1.2;
        const sy = y - ldy * k * 1.2;
        const xi = Math.max(0, Math.min(w - 1, Math.round(sx)));
        const yi = Math.max(0, Math.min(h - 1, Math.round(sy)));
        const j = (yi * w + xi) * 4;
        for (let c = 0; c < 4; c++) d[i + c] = src![j + c];
        break;
      }
    }
  }
  g.putImageData(img, x0, y0);
}

/** Merges the stroke into a new layer object (the old one stays untouched for undo). */
export function endStroke(s: StrokeState): Layer {
  if (s.work) return s.onMask ? { ...s.layer, mask: s.work } : { ...s.layer, canvas: s.work, text: undefined, shape: undefined, vector: undefined, kind: "pixel" };
  const base = s.onMask ? s.layer.mask! : s.layer.canvas;
  const out = cloneCanvas(base);
  const g = ctx2d(out);
  let buf = s.buffer!;
  if (s.clip) {
    buf = cloneCanvas(buf);
    const bg = ctx2d(buf);
    bg.globalCompositeOperation = "destination-in";
    bg.drawImage(s.clip, 0, 0);
  }
  g.globalAlpha = s.set.opacity / 100;
  g.globalCompositeOperation = s.erase ? "destination-out" : !s.onMask && s.layer.lockAlpha ? "source-atop" : "source-over";
  g.drawImage(buf, 0, 0);
  if (s.onMask) return { ...s.layer, mask: out };
  return { ...s.layer, canvas: out, text: undefined, shape: undefined, vector: undefined, kind: "pixel" };
}

/** Red-eye: pulls the red out of reddish pixels around a click. */
export function redEye(layer: Layer, p: Pt, size: number): Layer {
  const c = cloneCanvas(layer.canvas);
  const g = ctx2d(c, true);
  const r = size / 2;
  const x0 = Math.max(0, Math.floor(p.x - layer.x - r));
  const y0 = Math.max(0, Math.floor(p.y - layer.y - r));
  const w = Math.min(c.width - x0, Math.ceil(size));
  const h = Math.min(c.height - y0, Math.ceil(size));
  if (w <= 0 || h <= 0) return layer;
  const img = g.getImageData(x0, y0, w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const t = Math.hypot(x0 + x - (p.x - layer.x), y0 + y - (p.y - layer.y)) / r;
    if (t > 1) continue;
    const i = (y * w + x) * 4;
    const gb = (d[i + 1] + d[i + 2]) / 2;
    if (d[i] > gb * 1.35 && d[i] > 60) d[i] = gb * 0.9;
  }
  g.putImageData(img, x0, y0);
  return { ...layer, canvas: c, text: undefined, shape: undefined, vector: undefined, kind: "pixel" };
}

/**
 * Paint bucket: fills the region connected to (x, y) on the layer (or every matching pixel when not
 * contiguous) with a colour, limited to the selection.
 */
export function bucketFill(layer: Layer, doc: Doc, p: Pt, color: string, tolerance: number, contiguous: boolean, wand: (img: ImageData, x: number, y: number, tol: number, cont: boolean) => HTMLCanvasElement, opacity: number): Layer {
  const grown = coverDoc(layer, doc);
  const g = ctx2d(grown.canvas, true);
  const img = g.getImageData(0, 0, grown.canvas.width, grown.canvas.height);
  const region = wand(img, Math.floor(p.x - grown.x), Math.floor(p.y - grown.y), tolerance, contiguous);
  const rg = ctx2d(region);
  rg.globalCompositeOperation = "source-in";
  rg.fillStyle = color;
  rg.fillRect(0, 0, region.width, region.height);
  if (doc.selection) {
    rg.globalCompositeOperation = "destination-in";
    rg.drawImage(selectionInLayer(doc.selection, grown), 0, 0);
  }
  const out = cloneCanvas(grown.canvas);
  const og = ctx2d(out);
  og.globalAlpha = opacity;
  og.globalCompositeOperation = layer.lockAlpha ? "source-atop" : "source-over";
  og.drawImage(region, 0, 0);
  return { ...grown, canvas: out, text: undefined, shape: undefined, vector: undefined, kind: "pixel" };
}

export type GradientKind = "linear" | "radial" | "angle" | "reflected" | "diamond";

/** Gradient tool: fills the layer (within the selection) from a to b. */
export function gradientFill(
  layer: Layer,
  doc: Doc,
  a: Pt,
  b: Pt,
  kind: GradientKind,
  stops: { at: number; color: string }[],
  opacity: number,
  reverse: boolean,
): Layer {
  const grown = coverDoc(layer, doc);
  const onMask = doc.editMask && !!grown.mask;
  const base = onMask ? grown.mask! : grown.canvas;
  const fill = makeCanvas(base.width, base.height);
  const g = ctx2d(fill);
  const ax = a.x - grown.x;
  const ay = a.y - grown.y;
  const bx = b.x - grown.x;
  const by = b.y - grown.y;
  const len = Math.max(1, Math.hypot(bx - ax, by - ay));
  const list = reverse ? stops.map((s) => ({ at: 1 - s.at, color: s.color })).reverse() : stops;
  const add = (grad: CanvasGradient, mirror = false) => {
    for (const s of list) {
      if (mirror) {
        grad.addColorStop(0.5 - s.at / 2, s.color);
        grad.addColorStop(0.5 + s.at / 2, s.color);
      } else grad.addColorStop(s.at, s.color);
    }
    return grad;
  };
  if (kind === "linear") g.fillStyle = add(g.createLinearGradient(ax, ay, bx, by));
  else if (kind === "radial") g.fillStyle = add(g.createRadialGradient(ax, ay, 0, ax, ay, len));
  else if (kind === "angle") g.fillStyle = add(g.createConicGradient(Math.atan2(by - ay, bx - ax), ax, ay));
  else if (kind === "reflected") g.fillStyle = add(g.createLinearGradient(2 * ax - bx, 2 * ay - by, bx, by), true);
  if (kind === "diamond") {
    const img = g.createImageData(fill.width, fill.height);
    const strip = makeCanvas(256, 1);
    const sg = ctx2d(strip, true);
    sg.fillStyle = add(sg.createLinearGradient(0, 0, 256, 0));
    sg.fillRect(0, 0, 256, 1);
    const lutPx = sg.getImageData(0, 0, 256, 1).data;
    const ux = (bx - ax) / len;
    const uy = (by - ay) / len;
    for (let y = 0; y < fill.height; y++) for (let x = 0; x < fill.width; x++) {
      const dx = x - ax;
      const dy = y - ay;
      const t = Math.min(1, (Math.abs(dx * ux + dy * uy) + Math.abs(-dx * uy + dy * ux)) / len);
      const j = Math.min(255, Math.floor(t * 255)) * 4;
      const i = (y * fill.width + x) * 4;
      img.data[i] = lutPx[j];
      img.data[i + 1] = lutPx[j + 1];
      img.data[i + 2] = lutPx[j + 2];
      img.data[i + 3] = lutPx[j + 3];
    }
    g.putImageData(img, 0, 0);
  } else g.fillRect(0, 0, fill.width, fill.height);
  if (doc.selection) {
    g.globalCompositeOperation = "destination-in";
    g.drawImage(selectionInLayer(doc.selection, grown), 0, 0);
  }
  const out = cloneCanvas(base);
  const og = ctx2d(out);
  if (onMask) {
    // On a mask the gradient's brightness becomes visibility: dark hides, light shows.
    const mimg = ctx2d(fill, true).getImageData(0, 0, fill.width, fill.height);
    for (let i = 0; i < mimg.data.length; i += 4) {
      const v = (mimg.data[i] * 0.299 + mimg.data[i + 1] * 0.587 + mimg.data[i + 2] * 0.114) * (mimg.data[i + 3] / 255);
      mimg.data[i] = mimg.data[i + 1] = mimg.data[i + 2] = 255;
      mimg.data[i + 3] = v;
    }
    const m = makeCanvas(fill.width, fill.height);
    ctx2d(m).putImageData(mimg, 0, 0);
    // Replace the mask inside the selection (or everywhere), keep it as it was outside.
    og.globalCompositeOperation = "destination-out";
    if (doc.selection) og.drawImage(selectionInLayer(doc.selection, grown), 0, 0);
    else og.fillRect(0, 0, out.width, out.height);
    og.globalCompositeOperation = "source-over";
    og.drawImage(m, 0, 0);
    return { ...grown, mask: out };
  }
  og.globalAlpha = opacity;
  og.globalCompositeOperation = layer.lockAlpha ? "source-atop" : "source-over";
  og.drawImage(fill, 0, 0);
  return { ...grown, canvas: out, text: undefined, shape: undefined, vector: undefined, kind: "pixel" };
}
