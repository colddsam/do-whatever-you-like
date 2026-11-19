import { ctx2d, makeCanvas, opaqueBounds } from "./doc";
import { blurImage } from "./ops";
import type { Doc, Pt, Rect, SelectMode, Selection } from "./types";

/*
 * Selections are document-sized alpha masks. Shapes are drawn into a new mask and combined with the
 * current one using canvas compositing: add = over, subtract = cut out, intersect = keep overlap.
 */

export function fromMask(mask: HTMLCanvasElement): Selection | null {
  const b = opaqueBounds(mask);
  return b ? { mask, bounds: b } : null;
}

export function shapeMask(doc: Doc, draw: (g: CanvasRenderingContext2D) => void, feather = 0) {
  const c = makeCanvas(doc.w, doc.h);
  const g = ctx2d(c);
  g.fillStyle = "#fff";
  g.beginPath();
  draw(g);
  g.fill();
  if (feather > 0) featherMask(c, feather);
  return c;
}

export const rectPath = (r: Rect) => (g: CanvasRenderingContext2D) => g.rect(r.x, r.y, r.w, r.h);
export const ellipsePath = (r: Rect) => (g: CanvasRenderingContext2D) =>
  g.ellipse(r.x + r.w / 2, r.y + r.h / 2, Math.abs(r.w / 2), Math.abs(r.h / 2), 0, 0, Math.PI * 2);
export const polyPath = (pts: Pt[]) => (g: CanvasRenderingContext2D) => {
  pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
  g.closePath();
};

/** Combines a new mask with the current selection. */
export function combine(current: Selection | null, mask: HTMLCanvasElement, mode: SelectMode): Selection | null {
  if (mode === "new") return fromMask(mask);
  // With nothing selected yet, adding is a new selection and subtracting or intersecting leaves nothing.
  if (!current) return mode === "add" ? fromMask(mask) : null;
  const c = makeCanvas(mask.width, mask.height);
  const g = ctx2d(c);
  g.drawImage(current.mask, 0, 0);
  g.globalCompositeOperation = mode === "add" ? "source-over" : mode === "subtract" ? "destination-out" : "destination-in";
  g.drawImage(mask, 0, 0);
  return fromMask(c);
}

export function selectAll(doc: Doc): Selection {
  return { mask: shapeMask(doc, rectPath({ x: 0, y: 0, w: doc.w, h: doc.h })), bounds: { x: 0, y: 0, w: doc.w, h: doc.h } };
}

export function invert(doc: Doc, sel: Selection | null): Selection | null {
  const c = makeCanvas(doc.w, doc.h);
  const g = ctx2d(c);
  g.fillStyle = "#fff";
  g.fillRect(0, 0, doc.w, doc.h);
  if (sel) {
    g.globalCompositeOperation = "destination-out";
    g.drawImage(sel.mask, 0, 0);
  }
  return fromMask(c);
}

/** Softens the edge by `r` px (Select > Modify > Feather). */
export function featherMask(c: HTMLCanvasElement, r: number) {
  const g = ctx2d(c, true);
  const img = g.getImageData(0, 0, c.width, c.height);
  blurImage(img, r);
  g.putImageData(img, 0, 0);
}

/** Grows (r > 0) or shrinks (r < 0) a selection: blur the mask, then cut it at a low or high level. */
export function growMask(sel: Selection, doc: Doc, r: number): Selection | null {
  const c = makeCanvas(doc.w, doc.h);
  const g = ctx2d(c, true);
  g.drawImage(sel.mask, 0, 0);
  const img = g.getImageData(0, 0, c.width, c.height);
  blurImage(img, Math.abs(r) * 2);
  const d = img.data;
  const cut = r > 0 ? 8 : 247;
  for (let i = 3; i < d.length; i += 4) {
    d[i] = d[i] > cut ? 255 : 0;
    d[i - 1] = d[i - 2] = d[i - 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return fromMask(c);
}

export function featherSelection(sel: Selection, doc: Doc, r: number): Selection | null {
  const c = makeCanvas(doc.w, doc.h);
  ctx2d(c).drawImage(sel.mask, 0, 0);
  featherMask(c, r);
  return fromMask(c);
}

/** Selection from a picture's pixels (`source` is document-sized): see-through pixels stay out. */
export function fromAlpha(source: HTMLCanvasElement, x = 0, y = 0, doc?: Doc): Selection | null {
  const c = makeCanvas(doc?.w ?? source.width, doc?.h ?? source.height);
  const g = ctx2d(c);
  g.drawImage(source, x, y);
  g.globalCompositeOperation = "source-in";
  g.fillStyle = "#fff";
  g.fillRect(0, 0, c.width, c.height);
  return fromMask(c);
}

/**
 * Magic wand / colour range: pixels within `tolerance` of the colour at (x, y). Contiguous follows
 * the region from the click (scanline flood fill); otherwise it picks every match in the picture.
 */
export function wandMask(src: ImageData, x: number, y: number, tolerance: number, contiguous: boolean): HTMLCanvasElement {
  const { width: w, height: h, data: d } = src;
  const out = makeCanvas(w, h);
  const og = ctx2d(out);
  const res = og.createImageData(w, h);
  const r = res.data;
  if (x < 0 || y < 0 || x >= w || y >= h) return out;
  const o = (y * w + x) * 4;
  const tr = d[o];
  const tg = d[o + 1];
  const tb = d[o + 2];
  const ta = d[o + 3];
  const tol = tolerance * 2.55;
  const match = (i: number) => {
    const j = i * 4;
    return Math.max(Math.abs(d[j] - tr), Math.abs(d[j + 1] - tg), Math.abs(d[j + 2] - tb), Math.abs(d[j + 3] - ta)) <= tol;
  };
  const set = (i: number) => {
    const j = i * 4;
    r[j] = r[j + 1] = r[j + 2] = r[j + 3] = 255;
  };
  if (!contiguous) {
    for (let i = 0; i < w * h; i++) if (match(i)) set(i);
  } else {
    const seen = new Uint8Array(w * h);
    const stack = [x, y];
    while (stack.length) {
      const sy = stack.pop()!;
      let sx = stack.pop()!;
      let i = sy * w + sx;
      while (sx > 0 && !seen[i - 1] && match(i - 1)) {
        sx--;
        i--;
      }
      let up = false;
      let down = false;
      for (; sx < w && !seen[i] && match(i); sx++, i++) {
        seen[i] = 1;
        set(i);
        if (sy > 0) {
          const m = !seen[i - w] && match(i - w);
          if (m && !up) stack.push(sx, sy - 1);
          up = m;
        }
        if (sy < h - 1) {
          const m = !seen[i + w] && match(i + w);
          if (m && !down) stack.push(sx, sy + 1);
          down = m;
        }
      }
    }
  }
  og.putImageData(res, 0, 0);
  return out;
}

/** Select > Color Range: every pixel near a colour, with a soft falloff past the tolerance. */
export function colorMask(src: ImageData, [tr, tg, tb]: [number, number, number], tolerance: number): HTMLCanvasElement {
  const { width: w, height: h, data: d } = src;
  const out = makeCanvas(w, h);
  const og = ctx2d(out);
  const res = og.createImageData(w, h);
  const tol = Math.max(1, tolerance * 2.55);
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 8) continue;
    const dist = Math.hypot(d[i] - tr, d[i + 1] - tg, d[i + 2] - tb) / 1.732;
    const a = dist <= tol ? 255 : dist <= tol * 1.5 ? 255 * (1 - (dist - tol) / (tol * 0.5)) : 0;
    res.data[i] = res.data[i + 1] = res.data[i + 2] = 255;
    res.data[i + 3] = a;
  }
  og.putImageData(res, 0, 0);
  return out;
}

/**
 * The selection's edge at screen resolution, as a canvas of edge pixels. Drawn with an animated
 * stripe pattern, it becomes marching ants. `view` maps document → screen.
 */
export function edgeCanvas(sel: Selection, w: number, h: number, scale: number, ox: number, oy: number) {
  const m = makeCanvas(w, h);
  const g = ctx2d(m, true);
  g.imageSmoothingEnabled = scale < 1;
  g.setTransform(scale, 0, 0, scale, ox, oy);
  g.drawImage(sel.mask, 0, 0);
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  const out = g.createImageData(w, h);
  const e = out.data;
  const inside = (i: number) => d[i * 4 + 3] > 127;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (!inside(i)) continue;
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || !inside(i - 1) || !inside(i + 1) || !inside(i - w) || !inside(i + w)) {
      e[i * 4 + 3] = 255;
    }
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.putImageData(out, 0, 0);
  return m;
}

let antsPattern: { light: CanvasPattern; dark: CanvasPattern } | null = null;
/** Diagonal stripes, eight pixels per repeat, that `drawAnts` slides along to make the ants march. */
export function ants(g: CanvasRenderingContext2D) {
  if (antsPattern) return antsPattern;
  const tile = makeCanvas(8, 8);
  const t = ctx2d(tile);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    t.fillStyle = (x + y) % 8 < 4 ? "#000" : "#fff";
    t.fillRect(x, y, 1, 1);
  }
  const p = g.createPattern(tile, "repeat")!;
  antsPattern = { light: p, dark: p };
  return antsPattern;
}

let antsTmp: HTMLCanvasElement | null = null;
export function drawAnts(g: CanvasRenderingContext2D, edge: HTMLCanvasElement, phase: number) {
  if (!antsTmp || antsTmp.width !== edge.width || antsTmp.height !== edge.height) antsTmp = makeCanvas(edge.width, edge.height);
  const tmp = antsTmp;
  const t = ctx2d(tmp);
  t.setTransform(1, 0, 0, 1, 0, 0);
  t.globalCompositeOperation = "source-over";
  t.clearRect(0, 0, tmp.width, tmp.height);
  t.drawImage(edge, 0, 0);
  t.globalCompositeOperation = "source-in";
  t.fillStyle = ants(t).light;
  t.translate(phase % 8, 0);
  t.fillRect(-8, 0, tmp.width + 16, tmp.height);
  g.drawImage(tmp, 0, 0);
}
