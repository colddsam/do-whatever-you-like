import {
  activeLayer,
  blendThroughSelection,
  cloneCanvas,
  coverDoc,
  ctx2d,
  freshName,
  insertAbove,
  layerBounds,
  makeCanvas,
  newId,
  newLayer,
  opaqueBounds,
  replaceLayer,
  selectionInLayer,
  solidCanvas,
} from "./doc";
import { defaults, scaled, type Op, type OpContext } from "./ops";
import { compose, flatten, layerAsDoc, renderShape, renderText, shapePad } from "./render";
import { fromMask, growMask, invert } from "./selection";
import { addSmartFilter, moveSmartLayer, transformSmartLayer } from "./smart";
import { layerPaths, transformPaths, withPaths } from "./vector";
import type { Doc, Layer, Pt, Rect } from "./types";

/*
 * Whole-document and whole-layer operations, as pure functions: each takes a document and returns
 * the next one. The editor puts the result in history.
 */

/* ---------- Transforms ---------- */

/** Draws a layer (and its mask) through a matrix, into a new canvas just big enough. */
export function transformLayer(l: Layer, m: DOMMatrix, quality: ImageSmoothingQuality = "high"): Layer {
  const corners = [
    new DOMPoint(l.x, l.y),
    new DOMPoint(l.x + l.canvas.width, l.y),
    new DOMPoint(l.x, l.y + l.canvas.height),
    new DOMPoint(l.x + l.canvas.width, l.y + l.canvas.height),
  ].map((p) => p.matrixTransform(m));
  const x0 = Math.floor(Math.min(...corners.map((p) => p.x)));
  const y0 = Math.floor(Math.min(...corners.map((p) => p.y)));
  const x1 = Math.ceil(Math.max(...corners.map((p) => p.x)));
  const y1 = Math.ceil(Math.max(...corners.map((p) => p.y)));
  const draw = (src: HTMLCanvasElement) => {
    const c = makeCanvas(Math.min(16384, x1 - x0), Math.min(16384, y1 - y0));
    const g = ctx2d(c);
    g.imageSmoothingQuality = quality;
    g.setTransform(new DOMMatrix().translate(-x0, -y0).multiply(m).translate(l.x, l.y));
    g.drawImage(src, 0, 0);
    return c;
  };
  return { ...l, x: x0, y: y0, canvas: draw(l.canvas), mask: l.mask ? draw(l.mask) : null };
}

export type TransformState = { layerId: string; box: Rect; tx: number; ty: number; sx: number; sy: number; rot: number };

export function transformMatrix(t: TransformState) {
  const cx = t.box.x + t.box.w / 2;
  const cy = t.box.y + t.box.h / 2;
  return new DOMMatrix().translate(cx + t.tx, cy + t.ty).rotate(t.rot).scale(t.sx, t.sy).translate(-cx, -cy);
}

/** Applies a free transform. Text, vectors, shapes and smart objects stay editable when possible. */
export function commitTransform(doc: Doc, t: TransformState): Doc {
  const l = doc.layers.find((x) => x.id === t.layerId);
  if (!l) return doc;
  const moveOnly = t.sx === 1 && t.sy === 1 && t.rot === 0;
  if (moveOnly) {
    if (l.kind === "smart" && l.smart) return replaceLayer(doc, l.id, moveSmartLayer(l, Math.round(t.tx), Math.round(t.ty)));
    return replaceLayer(doc, l.id, { x: Math.round(l.x + t.tx), y: Math.round(l.y + t.ty) });
  }
  const m = transformMatrix(t);
  if (l.kind === "smart" && l.smart) return replaceLayer(doc, l.id, transformSmartLayer(l, m));
  // Vector paths go through the matrix themselves: they stay sharp and editable at any angle.
  if (l.vector) return replaceLayer(doc, l.id, withPaths(l, transformPaths(layerPaths(l), m)));
  if (l.text && t.rot === 0 && Math.abs(t.sx) === Math.abs(t.sy) && t.sx > 0) {
    const text = { ...l.text, size: Math.max(1, l.text.size * t.sx), stroke: l.text.stroke ? { ...l.text.stroke, width: l.text.stroke.width * t.sx } : null };
    const p = new DOMPoint(l.x, l.y).matrixTransform(m);
    return replaceLayer(doc, l.id, { text, canvas: renderText(text), x: Math.round(p.x), y: Math.round(p.y) });
  }
  if (l.shape && t.rot === 0 && t.sx > 0 && t.sy > 0) {
    const pad = shapePad(l.shape);
    const shape = { ...l.shape, w: l.shape.w * t.sx, h: l.shape.h * t.sy };
    const p = new DOMPoint(l.x + pad, l.y + pad).matrixTransform(m);
    return replaceLayer(doc, l.id, { shape, canvas: renderShape(shape), x: Math.round(p.x - shapePad(shape)), y: Math.round(p.y - shapePad(shape)) });
  }
  return replaceLayer(doc, l.id, { ...transformLayer(l, m), text: undefined, shape: undefined, vector: undefined, smart: undefined, kind: l.kind === "adjustment" ? "adjustment" : "pixel" });
}

/** Rotates or flips the whole canvas (every layer, and the document's size). */
export function transformCanvas(doc: Doc, kind: "cw" | "ccw" | "180" | "flipH" | "flipV" | { angle: number }): Doc {
  const { w, h } = doc;
  let m: DOMMatrix;
  let nw = w;
  let nh = h;
  if (kind === "cw") {
    m = new DOMMatrix().translate(h, 0).rotate(90);
    nw = h;
    nh = w;
  } else if (kind === "ccw") {
    m = new DOMMatrix().translate(0, w).rotate(-90);
    nw = h;
    nh = w;
  } else if (kind === "180") m = new DOMMatrix().translate(w, h).rotate(180);
  else if (kind === "flipH") m = new DOMMatrix().translate(w, 0).scale(-1, 1);
  else if (kind === "flipV") m = new DOMMatrix().translate(0, h).scale(1, -1);
  else {
    const a = (kind.angle * Math.PI) / 180;
    nw = Math.ceil(Math.abs(w * Math.cos(a)) + Math.abs(h * Math.sin(a)));
    nh = Math.ceil(Math.abs(w * Math.sin(a)) + Math.abs(h * Math.cos(a)));
    m = new DOMMatrix().translate(nw / 2, nh / 2).rotate(kind.angle).translate(-w / 2, -h / 2);
  }
  const quality = typeof kind === "object" ? "high" : "low";
  return {
    ...doc,
    w: nw,
    h: nh,
    selection: null,
    layers: doc.layers.map((l) => {
      if (l.kind === "adjustment" && !l.mask) return l;
      if (l.kind === "smart" && l.smart) return transformSmartLayer(l, m);
      if (l.vector && !l.mask) return withPaths(l, transformPaths(layerPaths(l), m));
      return { ...transformLayer(l, m, quality), text: undefined, shape: undefined, vector: undefined, smart: undefined, kind: l.kind === "adjustment" ? "adjustment" : "pixel" };
    }),
  };
}

/** Image > Image Size: resamples every layer. */
export function resizeImage(doc: Doc, nw: number, nh: number): Doc {
  const kx = nw / doc.w;
  const ky = nh / doc.h;
  const m = new DOMMatrix().scale(kx, ky);
  return {
    ...doc,
    w: nw,
    h: nh,
    selection: null,
    layers: doc.layers.map((l) => {
      if (l.kind === "smart" && l.smart) return transformSmartLayer(l, m);
      if (l.text && Math.abs(kx - ky) < 1e-3) {
        const text = { ...l.text, size: l.text.size * kx, stroke: l.text.stroke ? { ...l.text.stroke, width: l.text.stroke.width * kx } : null };
        return { ...l, text, canvas: renderText(text), x: Math.round(l.x * kx), y: Math.round(l.y * ky), mask: null };
      }
      if (l.kind === "adjustment" && !l.mask) return l;
      if (l.vector && !l.mask) return withPaths(l, transformPaths(layerPaths(l), m));
      return { ...transformLayer(l, m), text: undefined, shape: undefined, vector: undefined, smart: undefined, kind: l.kind === "adjustment" ? "adjustment" : "pixel" };
    }),
  };
}

/** Image > Canvas Size: grows or trims the document around an anchor; layers keep their pixels. */
export function resizeCanvas(doc: Doc, nw: number, nh: number, anchor: [number, number], fill: string | null): Doc {
  const dx = Math.round((nw - doc.w) * anchor[0]);
  const dy = Math.round((nh - doc.h) * anchor[1]);
  let layers = doc.layers.map((l) => (l.kind === "smart" && l.smart ? moveSmartLayer(l, dx, dy) : { ...l, x: l.x + dx, y: l.y + dy }));
  if (fill) {
    // New area filled on a layer at the bottom, like Photoshop's canvas extension colour.
    const bg = newLayer({ name: "Canvas fill", canvas: solidCanvas(nw, nh, fill) });
    layers = [bg, ...layers];
  }
  return { ...doc, w: nw, h: nh, layers, selection: null };
}

export function cropDoc(doc: Doc, r: Rect): Doc {
  const x = Math.round(r.x);
  const y = Math.round(r.y);
  const w = Math.max(1, Math.round(r.w));
  const h = Math.max(1, Math.round(r.h));
  // Pixels outside the crop are deleted, except vectors and Smart Objects which stay non-destructive.
  const layers = doc.layers.map((l) => {
    if (l.kind === "adjustment" && !l.mask) return l;
    if (l.kind === "smart" && l.smart) return moveSmartLayer(l, -x, -y);
    // Vectors aren't cut: they just shift (paths beyond the edge are still there to move back in).
    if (l.vector && !l.mask) return { ...l, x: l.x - x, y: l.y - y };
    const lx = l.x - x;
    const ly = l.y - y;
    const cut = (src: HTMLCanvasElement) => {
      const ix = Math.max(0, -lx);
      const iy = Math.max(0, -ly);
      const iw = Math.min(src.width, w - lx) - ix;
      const ih = Math.min(src.height, h - ly) - iy;
      if (iw <= 0 || ih <= 0) return { c: makeCanvas(1, 1), ox: 0, oy: 0 };
      const c = makeCanvas(iw, ih);
      ctx2d(c).drawImage(src, -ix, -iy);
      return { c, ox: lx + ix, oy: ly + iy };
    };
    const cp = cut(l.canvas);
    const keepMeta = l.text && cp.c.width === l.canvas.width && cp.c.height === l.canvas.height;
    return {
      ...l,
      canvas: cp.c,
      x: cp.ox,
      y: cp.oy,
      mask: l.mask ? cut(l.mask).c : null,
      ...(keepMeta ? {} : { text: undefined, shape: undefined, vector: undefined, smart: undefined, kind: l.kind === "adjustment" ? ("adjustment" as const) : ("pixel" as const) }),
    };
  });
  return { ...doc, w, h, layers, selection: null };
}

export function trimDoc(doc: Doc): Doc | null {
  const b = opaqueBounds(flatten(doc));
  return b ? cropDoc(doc, b) : null;
}

/* ---------- Layers ---------- */

export function duplicateLayer(doc: Doc): Doc {
  const l = activeLayer(doc);
  // Linked Smart Objects share the same `sourceId` & `sourceDoc` so editing one updates every instance.
  const smart = l.smart
    ? {
        ...l.smart,
        matrix: [...l.smart.matrix] as [number, number, number, number, number, number],
        filters: l.smart.filters.map((f) => ({ ...f, id: newId(), params: structuredClone(f.params) })),
      }
    : undefined;
  const copy: Layer = { ...l, id: newId(), name: `${l.name} copy`, canvas: cloneCanvas(l.canvas), mask: l.mask ? cloneCanvas(l.mask) : null, ...(smart ? { smart } : {}) };
  return insertAbove(doc, copy);
}

/** Layer via Copy / Cut: the selected pixels of the active layer on a new layer. */
export function layerVia(doc: Doc, cut: boolean): Doc {
  const l = activeLayer(doc);
  if (!doc.selection) return duplicateLayer(doc);
  const clip = selectionInLayer(doc.selection, l);
  const c = cloneCanvas(l.canvas);
  const g = ctx2d(c);
  g.globalCompositeOperation = "destination-in";
  g.drawImage(clip, 0, 0);
  const nl = newLayer({ name: freshName(doc, cut ? "Cut" : "Copy"), canvas: c, x: l.x, y: l.y });
  let next = doc;
  if (cut) {
    const rest = cloneCanvas(l.canvas);
    const rg = ctx2d(rest);
    rg.globalCompositeOperation = "destination-out";
    rg.drawImage(clip, 0, 0);
    next = replaceLayer(doc, l.id, { canvas: rest, text: undefined, shape: undefined, vector: undefined, smart: undefined, kind: "pixel" });
  }
  return { ...insertAbove(next, nl), selection: null };
}

export function mergeDown(doc: Doc): Doc | null {
  const i = doc.layers.findIndex((l) => l.id === doc.active);
  if (i <= 0) return null;
  const top = doc.layers[i];
  const below = doc.layers[i - 1];
  // Draw both as they look, then keep the lower layer's place, name and blend mode.
  const flat = flatten({ ...doc, layers: [{ ...below, blend: "normal", opacity: 1 }, top] });
  const merged: Layer = { ...below, canvas: flat, x: 0, y: 0, mask: null, effects: null, text: undefined, shape: undefined, vector: undefined, smart: undefined, kind: "pixel", clip: false };
  const layers = [...doc.layers];
  layers.splice(i - 1, 2, merged);
  return { ...doc, layers, active: merged.id, editMask: false };
}

export function mergeVisible(doc: Doc): Doc {
  const flat = flatten(doc);
  const merged = newLayer({ name: "Merged", canvas: flat });
  return { ...doc, layers: [...doc.layers.filter((l) => !l.visible), merged], active: merged.id, editMask: false };
}

/** Stamp Visible (Ctrl+Alt+Shift+E): puts a flattened copy of visible layers on top without touching originals. */
export function stampVisible(doc: Doc): Doc {
  const flat = flatten(doc);
  const stamped = newLayer({ name: freshName(doc, "Stamped"), canvas: flat });
  return { ...doc, layers: [...doc.layers, stamped], active: stamped.id, editMask: false };
}

/** Merges multiple selected layers (preserving relative z-order) into a single pixel layer at the topmost index. */
export function mergeSelected(doc: Doc, ids: string[]): Doc {
  const pick = new Set(ids);
  const selected = doc.layers.filter((l) => pick.has(l.id));
  if (selected.length < 2) return mergeDown(doc) ?? doc;
  const flat = flatten({ ...doc, layers: selected.map((l) => ({ ...l, visible: true })) });
  const topLayer = selected[selected.length - 1];
  const topIdx = doc.layers.indexOf(topLayer);
  const merged = newLayer({ name: topLayer.name || "Merged", canvas: flat });
  const nextLayers: Layer[] = [];
  for (let i = 0; i < doc.layers.length; i++) {
    if (i === topIdx) nextLayers.push(merged);
    if (!pick.has(doc.layers[i].id)) nextLayers.push(doc.layers[i]);
  }
  return { ...doc, layers: nextLayers, active: merged.id, editMask: false };
}

export function deleteLayers(doc: Doc, ids: string[]): Doc {
  const pick = new Set(ids);
  const remaining = doc.layers.filter((l) => !pick.has(l.id));
  if (!remaining.length) {
    const keep = activeLayer(doc);
    return { ...doc, layers: [keep], active: keep.id, editMask: false };
  }
  const activeValid = remaining.some((l) => l.id === doc.active);
  return { ...doc, layers: remaining, active: activeValid ? doc.active : remaining[remaining.length - 1].id, editMask: false };
}

export function flattenDoc(doc: Doc): Doc {
  const flat = flatten(doc);
  const c = solidCanvas(doc.w, doc.h, "#ffffff");
  ctx2d(c).drawImage(flat, 0, 0);
  const bg = newLayer({ name: "Background", canvas: c });
  return { ...doc, layers: [bg], active: bg.id, editMask: false, selection: null };
}

/** Rasterize Layer: converts smart/text/shape/vector into a pixel layer, preserving its mask & effects. */
export function rasterize(doc: Doc, layerId = doc.active): Doc {
  const l = doc.layers.find((x) => x.id === layerId);
  if (!l || l.kind === "adjustment" || l.kind === "pixel") return doc;
  return replaceLayer(doc, l.id, {
    canvas: cloneCanvas(l.canvas),
    mask: l.mask ? cloneCanvas(l.mask) : null,
    text: undefined,
    shape: undefined,
    vector: undefined,
    smart: undefined,
    kind: "pixel",
  });
}

/** Rasterize Layer Style: bakes effects (drop shadow, glow, stroke, overlay) permanently into pixels. */
export function rasterizeLayerStyle(doc: Doc, layerId = doc.active): Doc {
  const l = doc.layers.find((x) => x.id === layerId);
  if (!l || l.kind === "adjustment" || !l.effects) return doc;
  const rendered = layerAsDoc(doc, { ...l, opacity: 1, blend: "normal" });
  return replaceLayer(doc, l.id, {
    canvas: rendered,
    x: 0,
    y: 0,
    mask: null,
    effects: null,
    text: undefined,
    shape: undefined,
    vector: undefined,
    smart: undefined,
    kind: "pixel",
  });
}

/** Rasterize All Layers: converts every non-pixel, non-adjustment layer into pixels (keeps layer styles editable). */
export function rasterizeAll(doc: Doc): Doc {
  let next = doc;
  for (const l of doc.layers) {
    if (l.kind !== "pixel" && l.kind !== "adjustment") next = rasterize(next, l.id);
  }
  return next;
}

export function addMask(doc: Doc, mode: "reveal" | "hide" | "selection"): Doc {
  const l = activeLayer(doc);
  // Smart Objects stay at their outer bounds so l.x/l.y stay synchronized with smart.matrix.
  const base = l.kind === "adjustment" ? { ...l, canvas: makeCanvas(doc.w, doc.h), x: 0, y: 0 } : l.kind === "smart" ? l : coverDoc(l, doc);
  const mask = makeCanvas(base.canvas.width, base.canvas.height);
  const g = ctx2d(mask);
  if (mode === "reveal") {
    g.fillStyle = "#fff";
    g.fillRect(0, 0, mask.width, mask.height);
  } else if (mode === "selection" && doc.selection) g.drawImage(selectionInLayer(doc.selection, base), 0, 0);
  return { ...replaceLayer(doc, l.id, { ...base, mask, maskOn: true }), editMask: true, selection: mode === "selection" ? null : doc.selection };
}

export function applyMask(doc: Doc, layerId = doc.active): Doc {
  const l = doc.layers.find((x) => x.id === layerId);
  if (!l || !l.mask) return doc;
  const c = cloneCanvas(l.canvas);
  const g = ctx2d(c);
  g.globalCompositeOperation = "destination-in";
  g.drawImage(l.mask, 0, 0);
  return { ...replaceLayer(doc, l.id, { canvas: c, mask: null, text: undefined, shape: undefined, vector: undefined, smart: undefined, kind: "pixel" }), editMask: false };
}

/** Moves the active layer's content to an edge or centre of the document (or the selection). */
export function alignLayer(doc: Doc, how: "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom"): Doc {
  const l = activeLayer(doc);
  const b = layerBounds(l, true);
  const area = doc.selection?.bounds ?? { x: 0, y: 0, w: doc.w, h: doc.h };
  let dx = 0;
  let dy = 0;
  if (how === "left") dx = area.x - b.x;
  if (how === "hcenter") dx = area.x + area.w / 2 - (b.x + b.w / 2);
  if (how === "right") dx = area.x + area.w - (b.x + b.w);
  if (how === "top") dy = area.y - b.y;
  if (how === "vcenter") dy = area.y + area.h / 2 - (b.y + b.h / 2);
  if (how === "bottom") dy = area.y + area.h - (b.y + b.h);
  if (l.kind === "smart" && l.smart) return replaceLayer(doc, l.id, moveSmartLayer(l, Math.round(dx), Math.round(dy)));
  return replaceLayer(doc, l.id, { x: Math.round(l.x + dx), y: Math.round(l.y + dy) });
}

/* ---------- Pixels in the selection ---------- */

/** Delete key: clears the selected pixels (or paints the background colour on a mask). */
export function clearSelection(doc: Doc): Doc {
  const l = activeLayer(doc);
  if (!doc.selection || l.kind === "adjustment") return doc;
  if (doc.editMask && l.mask) {
    const base = l.kind === "smart" ? l : coverDoc(l, doc);
    if (!base.mask) return doc;
    const clip = selectionInLayer(doc.selection, base);
    const m = cloneCanvas(base.mask);
    const g = ctx2d(m);
    g.globalCompositeOperation = "destination-out";
    g.drawImage(clip, 0, 0);
    return replaceLayer(doc, l.id, { ...base, mask: m });
  }
  const grown = coverDoc(l, doc);
  const clip = selectionInLayer(doc.selection, grown);
  const c = cloneCanvas(grown.canvas);
  const g = ctx2d(c);
  g.globalCompositeOperation = "destination-out";
  g.drawImage(clip, 0, 0);
  return replaceLayer(doc, l.id, { ...grown, canvas: c, text: undefined, shape: undefined, vector: undefined, smart: undefined, kind: "pixel" });
}

/** Edit > Fill: a colour in the selection (or the whole layer). */
export function fillSelection(doc: Doc, color: string, opacity: number, blend: GlobalCompositeOperation = "source-over"): Doc {
  const l = activeLayer(doc);
  if (l.kind === "adjustment") return doc;
  const grown = coverDoc(l, doc);
  const fill = solidCanvas(grown.canvas.width, grown.canvas.height, color);
  if (doc.selection) {
    const g = ctx2d(fill);
    g.globalCompositeOperation = "destination-in";
    g.drawImage(selectionInLayer(doc.selection, grown), 0, 0);
  }
  const c = cloneCanvas(grown.canvas);
  const g = ctx2d(c);
  g.globalAlpha = opacity;
  g.globalCompositeOperation = l.lockAlpha ? "source-atop" : blend;
  g.drawImage(fill, 0, 0);
  return replaceLayer(doc, l.id, { ...grown, canvas: c, text: undefined, shape: undefined, vector: undefined, smart: undefined, kind: "pixel" });
}

/** Edit > Stroke: a band along the selection's edge. */
export function strokeSelection(doc: Doc, color: string, width: number, where: "inside" | "center" | "outside"): Doc {
  if (!doc.selection) return doc;
  const sel = doc.selection;
  const outer = where === "inside" ? sel : growMask(sel, doc, where === "center" ? width / 2 : width);
  const inner = where === "outside" ? sel : growMask(sel, doc, -(where === "center" ? width / 2 : width));
  if (!outer) return doc;
  const ring = cloneCanvas(outer.mask);
  const rg = ctx2d(ring);
  if (inner) {
    rg.globalCompositeOperation = "destination-out";
    rg.drawImage(inner.mask, 0, 0);
  }
  const band = fromMask(ring);
  return band ? { ...fillSelection({ ...doc, selection: band }, color, 1), selection: doc.selection } : doc;
}

/* ---------- Adjustments and filters on pixels ---------- */

/** Runs an operation on the active layer at full size, limited to the selection (non-destructive Smart Filter on Smart Objects). */
export function applyOp(doc: Doc, op: Op, params: Record<string, unknown>, ctx: Omit<OpContext, "scale">): Doc {
  const l = activeLayer(doc);
  if (l.kind === "adjustment") return doc;
  if (l.kind === "smart" && l.smart && !doc.selection) {
    return addSmartFilter(doc, op, params, ctx);
  }
  const src = l.canvas;
  const g = ctx2d(src, true);
  const img = g.getImageData(0, 0, src.width, src.height);
  const res = op.apply(img, params, { ...ctx, scale: 1 }) ?? img;
  const out = makeCanvas(src.width, src.height);
  ctx2d(out).putImageData(res, 0, 0);
  const final = blendThroughSelection(src, out, doc.selection, l);
  return replaceLayer(doc, l.id, { canvas: final, text: undefined, shape: undefined, vector: undefined, smart: undefined, kind: "pixel" });
}

/** The same, on a reduced copy, for live previews. Returns the preview canvas and its scale. */
export function previewOp(doc: Doc, op: Op, params: Record<string, unknown>, ctx: Omit<OpContext, "scale">, maxPixels = 2_000_000) {
  const l = activeLayer(doc);
  const src = l.canvas;
  const s = Math.min(1, Math.sqrt(maxPixels / (src.width * src.height)));
  const w = Math.max(1, Math.round(src.width * s));
  const h = Math.max(1, Math.round(src.height * s));
  const small = makeCanvas(w, h);
  const sg = ctx2d(small, true);
  sg.drawImage(src, 0, 0, w, h);
  const img = sg.getImageData(0, 0, w, h);
  const res = op.apply(img, scaled(op, params, s), { ...ctx, scale: s }) ?? img;
  const out = makeCanvas(w, h);
  ctx2d(out).putImageData(res, 0, 0);
  if (!doc.selection) return { canvas: out, scale: s };
  // Selection in the reduced layer's space.
  const clip = makeCanvas(w, h);
  const cg = ctx2d(clip);
  cg.scale(s, s);
  cg.drawImage(doc.selection.mask, -l.x, -l.y);
  const merged = cloneCanvas(small);
  const mg = ctx2d(merged);
  mg.globalCompositeOperation = "destination-out";
  mg.drawImage(clip, 0, 0);
  const inside = cloneCanvas(out);
  const ig = ctx2d(inside);
  ig.globalCompositeOperation = "destination-in";
  ig.drawImage(clip, 0, 0);
  mg.globalCompositeOperation = "source-over";
  mg.drawImage(inside, 0, 0);
  return { canvas: merged, scale: s };
}

/* ---------- Operations on the whole picture ---------- */

/** Where an adjustment, filter or look lands: the active layer's own pixels, or the picture as a whole. */
export type OpTarget = "layer" | "image";

/**
 * Does this layer look like "the photo": a pixel layer whose opaque pixels cover at least half the
 * canvas? When the active layer is text, a sticker, a shape, an empty layer or an adjustment, an
 * effect applied to it alone would barely show, so the whole picture is the better default.
 */
export function isPhotoLayer(doc: Doc, l: Layer) {
  if ((l.kind !== "pixel" && l.kind !== "smart") || !l.visible) return false;
  const k = Math.min(1, 64 / Math.max(l.canvas.width, l.canvas.height));
  const c = makeCanvas(l.canvas.width * k, l.canvas.height * k);
  const g = ctx2d(c, true);
  g.drawImage(l.canvas, 0, 0, c.width, c.height);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 160) n++;
  const covered = (n / (c.width * c.height)) * l.canvas.width * l.canvas.height;
  return covered >= 0.5 * doc.w * doc.h;
}

export const defaultTarget = (doc: Doc): OpTarget => (isPhotoLayer(doc, activeLayer(doc)) ? "layer" : "image");

/**
 * Applies an operation to everything you see. Per-pixel operations become an adjustment layer on
 * top (editable later, nothing below is touched); the rest are run on a merged copy placed as a new
 * layer on top, so the original layers stay as they were.
 */
export function applyOpToImage(doc: Doc, op: Op, params: Record<string, unknown>, ctx: Omit<OpContext, "scale">): Doc {
  const top = doc.layers[doc.layers.length - 1];
  const onTop = { ...doc, active: top.id, editMask: false };
  if (op.layerable) return addAdjustmentLayer(onTop, op, params);
  const flat = flatten(doc);
  const g = ctx2d(flat, true);
  const img = g.getImageData(0, 0, flat.width, flat.height);
  const res = op.apply(img, params, { ...ctx, scale: 1 }) ?? img;
  const out = makeCanvas(flat.width, flat.height);
  const og = ctx2d(out);
  og.putImageData(res, 0, 0);
  if (doc.selection) {
    og.globalCompositeOperation = "destination-in";
    og.drawImage(doc.selection.mask, 0, 0);
  }
  return insertAbove(onTop, newLayer({ name: freshName(doc, op.label.replace(/ look$/, "")), canvas: out }));
}

/** The same on a reduced copy of the whole picture, for the live preview of a stamped layer. */
export function previewOpImage(doc: Doc, op: Op, params: Record<string, unknown>, ctx: Omit<OpContext, "scale">, maxPixels = 2_000_000) {
  const s = Math.min(1, Math.sqrt(maxPixels / (doc.w * doc.h)));
  const small = compose(doc, { rect: { x: 0, y: 0, w: doc.w, h: doc.h }, scale: s });
  const g = ctx2d(small, true);
  const img = g.getImageData(0, 0, small.width, small.height);
  const res = op.apply(img, scaled(op, params, s), { ...ctx, scale: s }) ?? img;
  const out = makeCanvas(small.width, small.height);
  const og = ctx2d(out);
  og.putImageData(res, 0, 0);
  if (doc.selection) {
    og.globalCompositeOperation = "destination-in";
    og.drawImage(doc.selection.mask, 0, 0, out.width, out.height);
  }
  return { canvas: out, scale: s };
}

export function addAdjustmentLayer(doc: Doc, op: Op, params?: Record<string, unknown>): Doc {
  const l = newLayer({ name: op.label, kind: "adjustment", canvas: makeCanvas(1, 1), adjust: { id: op.id, params: params ?? defaults(op) } });
  let next = insertAbove(doc, l);
  // A selection becomes the adjustment's mask, as in Photoshop.
  if (doc.selection) next = addMask(next, "selection");
  return { ...next, editMask: false };
}

/** Places a picture as a new layer, centred (or at a point), scaled down to fit when it's bigger. */
export function placeImage(doc: Doc, img: HTMLCanvasElement, name: string, at?: Pt): Doc {
  let c = img;
  const k = Math.min(1, doc.w / img.width, doc.h / img.height);
  if (k < 1) {
    c = makeCanvas(img.width * k, img.height * k);
    const g = ctx2d(c);
    g.imageSmoothingQuality = "high";
    g.drawImage(img, 0, 0, c.width, c.height);
  }
  const x = at ? Math.round(at.x) : Math.round((doc.w - c.width) / 2);
  const y = at ? Math.round(at.y) : Math.round((doc.h - c.height) / 2);
  return insertAbove(doc, newLayer({ name, canvas: c, x, y }));
}

export const selectLayerPixels = (doc: Doc, id: string) => {
  const l = doc.layers.find((x) => x.id === id);
  if (!l) return doc;
  const c = makeCanvas(doc.w, doc.h);
  const g = ctx2d(c);
  g.drawImage(l.canvas, l.x, l.y);
  if (l.mask) {
    g.globalCompositeOperation = "destination-in";
    g.drawImage(l.mask, l.x, l.y);
  }
  g.globalCompositeOperation = "source-in";
  g.fillStyle = "#fff";
  g.fillRect(0, 0, c.width, c.height);
  return { ...doc, selection: fromMask(c) };
};

export const inverseSelection = (doc: Doc) => ({ ...doc, selection: invert(doc, doc.selection) });
