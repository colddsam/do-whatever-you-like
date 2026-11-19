import type { Doc, Layer, Rect, Selection } from "./types";

/* ---------- Canvases ---------- */

export function makeCanvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export const ctx2d = (c: HTMLCanvasElement, read = false) =>
  c.getContext("2d", read ? { willReadFrequently: true } : undefined) as CanvasRenderingContext2D;

export function cloneCanvas(src: HTMLCanvasElement) {
  const c = makeCanvas(src.width, src.height);
  ctx2d(c).drawImage(src, 0, 0);
  return c;
}

export function solidCanvas(w: number, h: number, color: string | null) {
  const c = makeCanvas(w, h);
  if (color) {
    const g = ctx2d(c);
    g.fillStyle = color;
    g.fillRect(0, 0, c.width, c.height);
  }
  return c;
}

export function canvasFromImage(img: CanvasImageSource & { width: number; height: number }, w?: number, h?: number) {
  const c = makeCanvas(w ?? img.width, h ?? img.height);
  ctx2d(c).drawImage(img, 0, 0, c.width, c.height);
  return c;
}

export const canvasBytes = (c: HTMLCanvasElement | null | undefined) => (c ? c.width * c.height * 4 : 0);

/* ---------- Ids and layers ---------- */

let uid = 0;
export const newId = () => `L${Date.now().toString(36)}${(++uid).toString(36)}`;

export function newLayer(p: Partial<Layer> & { canvas: HTMLCanvasElement; name: string }): Layer {
  return {
    id: newId(),
    kind: "pixel",
    x: 0,
    y: 0,
    visible: true,
    opacity: 1,
    blend: "normal",
    locked: false,
    lockAlpha: false,
    clip: false,
    mask: null,
    maskOn: true,
    effects: null,
    ...p,
  };
}

export function newDoc(w: number, h: number, background: string | null, name = "Untitled"): Doc {
  const bg = newLayer({ name: background ? "Background" : "Layer 1", canvas: solidCanvas(w, h, background) });
  return { w, h, layers: [bg], active: bg.id, selection: null, editMask: false, name };
}

export function docFromCanvas(c: HTMLCanvasElement, name: string): Doc {
  const bg = newLayer({ name: "Background", canvas: c });
  return { w: c.width, h: c.height, layers: [bg], active: bg.id, selection: null, editMask: false, name };
}

export const activeLayer = (d: Doc) => d.layers.find((l) => l.id === d.active) ?? d.layers[d.layers.length - 1];

export const replaceLayer = (d: Doc, id: string, patch: Partial<Layer>): Doc => ({
  ...d,
  layers: d.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)),
});

/** A name that isn't taken yet: "Layer 3", "Text 2". */
export function freshName(d: Doc, base: string) {
  const names = new Set(d.layers.map((l) => l.name));
  for (let i = 1; ; i++) if (!names.has(`${base} ${i}`)) return `${base} ${i}`;
}

/** Inserts a layer above the active one and makes it active. */
export function insertAbove(d: Doc, layer: Layer): Doc {
  const i = d.layers.findIndex((l) => l.id === d.active);
  const layers = [...d.layers];
  layers.splice(i + 1, 0, layer);
  return { ...d, layers, active: layer.id, editMask: false };
}

/**
 * Grows a layer so it covers the whole document (painting may reach anywhere). Returns the same
 * layer when it already does. The new canvas is fresh, so callers may draw into it.
 */
export function coverDoc(layer: Layer, d: Doc): Layer {
  const x0 = Math.min(layer.x, 0);
  const y0 = Math.min(layer.y, 0);
  const x1 = Math.max(layer.x + layer.canvas.width, d.w);
  const y1 = Math.max(layer.y + layer.canvas.height, d.h);
  if (x0 === layer.x && y0 === layer.y && x1 - x0 === layer.canvas.width && y1 - y0 === layer.canvas.height) return layer;
  const grow = (src: HTMLCanvasElement, fill: string | null) => {
    const c = makeCanvas(x1 - x0, y1 - y0);
    const g = ctx2d(c);
    if (fill) {
      g.fillStyle = fill;
      g.fillRect(0, 0, c.width, c.height);
      g.clearRect(layer.x - x0, layer.y - y0, src.width, src.height);
    }
    g.drawImage(src, layer.x - x0, layer.y - y0);
    return c;
  };
  return { ...layer, x: x0, y: y0, canvas: grow(layer.canvas, null), mask: layer.mask ? grow(layer.mask, "#fff") : null };
}

/** The box around a canvas's visible pixels, or null when it's empty. */
export function opaqueBounds(c: HTMLCanvasElement): Rect | null {
  const { width: w, height: h } = c;
  const p = ctx2d(c, true).getImageData(0, 0, w, h).data;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let x = 0; x < w; x++) {
      if (p[row + x * 4 + 3] > 2) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** A layer's box in document space (its visible pixels when `tight`). */
export function layerBounds(l: Layer, tight = false): Rect {
  if (tight) {
    const b = opaqueBounds(l.canvas);
    if (b) return { x: b.x + l.x, y: b.y + l.y, w: b.w, h: b.h };
  }
  return { x: l.x, y: l.y, w: l.canvas.width, h: l.canvas.height };
}

export const intersect = (a: Rect, b: Rect): Rect | null => {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const r = Math.min(a.x + a.w, b.x + b.w);
  const bt = Math.min(a.y + a.h, b.y + b.h);
  return r > x && bt > y ? { x, y, w: r - x, h: bt - y } : null;
};

/** A selection's mask drawn in a layer's own pixel space, for clipping edits to it. */
export function selectionInLayer(sel: Selection, l: { x: number; y: number; canvas: HTMLCanvasElement }) {
  const c = makeCanvas(l.canvas.width, l.canvas.height);
  ctx2d(c).drawImage(sel.mask, -l.x, -l.y);
  return c;
}

/** Applies `edited` over `original` only where the selection is (both in layer space). */
export function blendThroughSelection(original: HTMLCanvasElement, edited: HTMLCanvasElement, sel: Selection | null, l: Layer) {
  if (!sel) return edited;
  const inside = cloneCanvas(edited);
  const g = ctx2d(inside);
  g.globalCompositeOperation = "destination-in";
  g.drawImage(selectionInLayer(sel, l), 0, 0);
  const out = cloneCanvas(original);
  const o = ctx2d(out);
  // Cut the selected area out of the original, then put the edited pixels in its place.
  o.globalCompositeOperation = "destination-out";
  o.drawImage(selectionInLayer(sel, l), 0, 0);
  o.globalCompositeOperation = "source-over";
  o.drawImage(inside, 0, 0);
  return out;
}

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h.slice(0, 6), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const rgbToHex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0")).join("")}`;

export const luminance = (hex: string) => {
  const [r, g, b] = hexToRgb(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b;
};

/** Lets the browser paint (a spinner, a "working" tag) before a long synchronous job. */
export const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));
