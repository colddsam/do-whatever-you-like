import { ADJUSTMENTS } from "./adjustments";
import { activeLayer, cloneCanvas, ctx2d, freshName, insertAbove, layerBounds, makeCanvas, newId, newLayer, replaceLayer } from "./doc";
import { FILTERS } from "./filters";
import { scaled, type Op, type OpContext } from "./ops";
import { flatten } from "./render";
import {
  fitReplacementMatrix,
  mulMatrix,
  resetSmartMatrix,
  transformBounds,
  translateMatrix,
  translationOnlyMatrix,
  type Matrix2D,
} from "./smart-math";
import type { Doc, Layer, Pt, SmartFilter, SmartMeta } from "./types";
import { mapPaths } from "./vector";

export * from "./smart-math";

export function resolveSmartOp(opId: string): Op | undefined {
  return ADJUSTMENTS.find((o) => o.id === opId) ?? FILTERS.find((o) => o.id === opId);
}

const sourceCache = new WeakMap<Doc, { sig: string; canvas: HTMLCanvasElement }>();

function filtersSignature(smart: SmartMeta, ctx: { fg: string; bg: string }) {
  if (!smart.filtersOn || !smart.filters.some((f) => f.enabled)) return "plain";
  return JSON.stringify([
    smart.filtersOn,
    smart.filters.map((f) => (f.enabled ? [f.id, f.opId, f.opacity, f.params] : false)),
    ctx.fg,
    ctx.bg,
  ]);
}

/** Flattens `smart.sourceDoc` at full native resolution and runs enabled Smart Filters non-destructively. */
export function renderSmartSource(smart: SmartMeta, ctx: { fg: string; bg: string } = { fg: "#000000", bg: "#ffffff" }): HTMLCanvasElement {
  const sig = filtersSignature(smart, ctx);
  const cached = sourceCache.get(smart.sourceDoc);
  if (cached && cached.sig === sig) return cached.canvas;

  let cur = flatten(smart.sourceDoc);
  if (smart.filtersOn) {
    for (const f of smart.filters) {
      if (!f.enabled) continue;
      const op = resolveSmartOp(f.opId);
      if (!op) continue;
      const g = ctx2d(cur, true);
      const img = g.getImageData(0, 0, cur.width, cur.height);
      const res = op.apply(img, f.params, { fg: ctx.fg, bg: ctx.bg, scale: 1 }) ?? img;
      const out = makeCanvas(cur.width, cur.height);
      ctx2d(out).putImageData(res, 0, 0);
      if (f.opacity >= 0.999) {
        cur = out;
      } else {
        const blended = cloneCanvas(cur);
        const bg = ctx2d(blended);
        bg.globalAlpha = Math.max(0, Math.min(1, f.opacity));
        bg.drawImage(out, 0, 0);
        cur = blended;
      }
    }
  }
  sourceCache.set(smart.sourceDoc, { sig, canvas: cur });
  return cur;
}

/** Renders the Smart Object through its non-destructive affine matrix into tight layer bounds. */
export function renderSmartLayer(
  smart: SmartMeta,
  ctx: { fg: string; bg: string } = { fg: "#000000", bg: "#ffffff" },
): { canvas: HTMLCanvasElement; x: number; y: number } {
  const src = renderSmartSource(smart, ctx);
  const b = transformBounds(src.width, src.height, smart.matrix);
  const c = makeCanvas(Math.min(16384, b.w), Math.min(16384, b.h));
  const g = ctx2d(c);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = "high";
  const [ma, mb, mc, md, me, mf] = smart.matrix;
  g.setTransform(ma, mb, mc, md, me - b.x, mf - b.y);
  g.drawImage(src, 0, 0);
  return { canvas: c, x: b.x, y: b.y };
}

/** Re-renders `l` from updated `smart`, keeping any existing layer mask aligned in world coordinates. */
export function syncSmartLayer(l: Layer, smart: SmartMeta, ctx?: { fg: string; bg: string }): Layer {
  const rendered = renderSmartLayer(smart, ctx);
  let mask = l.mask;
  if (mask && (l.x !== rendered.x || l.y !== rendered.y || mask.width !== rendered.canvas.width || mask.height !== rendered.canvas.height)) {
    const nextMask = makeCanvas(rendered.canvas.width, rendered.canvas.height);
    const mg = ctx2d(nextMask);
    mg.fillStyle = "#fff";
    mg.fillRect(0, 0, nextMask.width, nextMask.height);
    mg.clearRect(l.x - rendered.x, l.y - rendered.y, mask.width, mask.height);
    mg.drawImage(mask, l.x - rendered.x, l.y - rendered.y);
    mask = nextMask;
  }
  return {
    ...l,
    kind: "smart",
    smart,
    canvas: rendered.canvas,
    x: rendered.x,
    y: rendered.y,
    mask,
    text: undefined,
    shape: undefined,
    vector: undefined,
    adjust: undefined,
  };
}

/** Shifts a single layer by `(dx, dy)` inside a Doc's local coordinates (preserving nested Smart Objects & vectors). */
function shiftLayerCoords(l: Layer, dx: number, dy: number): Layer {
  let next: Layer = { ...l, x: l.x + dx, y: l.y + dy };
  if (next.vector) {
    next = {
      ...next,
      vector: {
        ...next.vector,
        ox: next.vector.ox + dx,
        oy: next.vector.oy + dy,
        paths: mapPaths(next.vector.paths, (pt) => ({ x: pt.x + dx, y: pt.y + dy })),
      },
    };
  }
  if (next.kind === "smart" && next.smart) {
    next = {
      ...next,
      smart: {
        ...next.smart,
        matrix: translateMatrix(next.smart.matrix, dx, dy),
      },
    };
  }
  return next;
}

/** Deep-clones a Doc (cloning canvases, masks, and nested Smart Objects). */
export function cloneDocDeep(d: Doc, regenerateLayerIds = false): Doc {
  const layers = d.layers.map((l) => ({
    ...l,
    id: regenerateLayerIds ? newId() : l.id,
    canvas: cloneCanvas(l.canvas),
    mask: l.mask ? cloneCanvas(l.mask) : null,
    smart: l.smart
      ? {
          ...l.smart,
          matrix: [...l.smart.matrix] as Matrix2D,
          filters: l.smart.filters.map((f) => ({ ...f, params: structuredClone(f.params) })),
          sourceDoc: cloneDocDeep(l.smart.sourceDoc, regenerateLayerIds),
        }
      : undefined,
  }));
  const activeIdx = Math.max(0, d.layers.findIndex((l) => l.id === d.active));
  return {
    ...d,
    layers,
    active: layers[activeIdx]?.id ?? layers[0]?.id ?? "",
    selection: null,
    editMask: false,
  };
}

/** Wraps one or more layers into an embedded Smart Object document while keeping visual appearance identical. */
export function convertToSmartObject(
  doc: Doc,
  layerIds?: string[],
  ctx: { fg: string; bg: string } = { fg: "#000000", bg: "#ffffff" },
): Doc {
  const pickedSet = new Set(layerIds?.length ? layerIds : [doc.active]);
  const selected = doc.layers.filter((l) => pickedSet.has(l.id));
  if (!selected.length) return doc;

  const single = selected.length === 1 ? selected[0] : null;
  if (single?.kind === "adjustment") return doc;

  // Determine sourceDoc bounding box in parent document space.
  const bounded = selected.filter((l) => l.kind !== "adjustment");
  let bx = 0;
  let by = 0;
  let bw = doc.w;
  let bh = doc.h;
  if (bounded.length > 0 && bounded.length === selected.length) {
    const rects = bounded.map((l) => layerBounds(l, false));
    const x0 = Math.floor(Math.min(...rects.map((r) => r.x)));
    const y0 = Math.floor(Math.min(...rects.map((r) => r.y)));
    const x1 = Math.ceil(Math.max(...rects.map((r) => r.x + r.w)));
    const y1 = Math.ceil(Math.max(...rects.map((r) => r.y + r.h)));
    if (x1 > x0 && y1 > y0) {
      bx = x0;
      by = y0;
      bw = Math.min(16384, x1 - x0);
      bh = Math.min(16384, y1 - y0);
    }
  }

  const innerLayers: Layer[] = selected.map((l, idx) => {
    const shifted = shiftLayerCoords(l, -bx, -by);
    if (single && idx === 0) {
      // Single-layer conversion moves opacity, blend, clip, mask and effects onto the outer Smart Object.
      return {
        ...shifted,
        id: newId(),
        visible: true,
        opacity: 1,
        blend: "normal",
        clip: false,
        mask: null,
        maskOn: true,
        effects: null,
      };
    }
    return { ...shifted, id: newId() };
  });

  const sourceDoc: Doc = {
    w: bw,
    h: bh,
    layers: innerLayers,
    active: innerLayers[innerLayers.length - 1].id,
    selection: null,
    editMask: false,
    name: single ? single.name : freshName(doc, "Smart Object"),
  };

  const smart: SmartMeta = {
    sourceId: newId(),
    sourceDoc,
    matrix: translationOnlyMatrix(bx, by),
    filters: [],
    filtersOn: true,
  };

  const baseLayer = newLayer({
    name: single ? single.name : freshName(doc, "Smart Object"),
    kind: "smart",
    canvas: makeCanvas(bw, bh),
    x: bx,
    y: by,
    visible: single ? single.visible : true,
    opacity: single ? single.opacity : 1,
    blend: single ? single.blend : "normal",
    clip: single ? single.clip : false,
    locked: single ? single.locked : false,
    mask: single?.mask ?? null,
    maskOn: single ? single.maskOn : true,
    effects: single ? single.effects : null,
    smart,
  });

  const smartLayer = syncSmartLayer(baseLayer, smart, ctx);

  // Replace all selected layers at the topmost selected index, preserving exact stack order for unselected layers.
  const firstSelected = selected.map((s) => doc.layers.indexOf(s));
  const topIndex = Math.max(...firstSelected);
  const nextLayers: Layer[] = [];
  for (let i = 0; i < doc.layers.length; i++) {
    if (i === topIndex) nextLayers.push(smartLayer);
    if (!pickedSet.has(doc.layers[i].id)) nextLayers.push(doc.layers[i]);
  }
  return { ...doc, layers: nextLayers, active: smartLayer.id, editMask: false };
}

/** Places any document (image, multi-layer PSD, etc.) as a full-resolution non-destructive Smart Object. */
export function placeAsSmartObject(
  doc: Doc,
  sourceDoc: Doc,
  name: string,
  at?: Pt,
  ctx: { fg: string; bg: string } = { fg: "#000000", bg: "#ffffff" },
): Doc {
  const k = Math.min(1, doc.w / Math.max(1, sourceDoc.w), doc.h / Math.max(1, sourceDoc.h));
  const dw = sourceDoc.w * k;
  const dh = sourceDoc.h * k;
  const x = at ? Math.round(at.x) : Math.round((doc.w - dw) / 2);
  const y = at ? Math.round(at.y) : Math.round((doc.h - dh) / 2);
  const smart: SmartMeta = {
    sourceId: newId(),
    sourceDoc: { ...sourceDoc, name },
    matrix: [k, 0, 0, k, x, y],
    filters: [],
    filtersOn: true,
  };
  const layer = syncSmartLayer(
    newLayer({ name: freshName(doc, name), kind: "smart", canvas: makeCanvas(1, 1), smart }),
    smart,
    ctx,
  );
  return insertAbove(doc, layer);
}

/** Translates a Smart Object layer without touching its pixels or re-rendering filters. */
export function moveSmartLayer(l: Layer, dx: number, dy: number): Layer {
  if (l.kind !== "smart" || !l.smart) return { ...l, x: l.x + dx, y: l.y + dy };
  return {
    ...l,
    x: l.x + dx,
    y: l.y + dy,
    smart: { ...l.smart, matrix: translateMatrix(l.smart.matrix, dx, dy) },
  };
}

/** Applies a DOMMatrix transform cleanly to a Smart Object from its original full-resolution contents. */
export function transformSmartLayer(l: Layer, m: DOMMatrix, ctx?: { fg: string; bg: string }): Layer {
  if (l.kind !== "smart" || !l.smart) return l;
  const mat: Matrix2D = [m.a, m.b, m.c, m.d, m.e, m.f];
  const nextMatrix = mulMatrix(mat, l.smart.matrix);
  const nextSmart: SmartMeta = { ...l.smart, matrix: nextMatrix };
  const rendered = renderSmartLayer(nextSmart, ctx);

  let nextMask: HTMLCanvasElement | null = null;
  if (l.mask) {
    nextMask = makeCanvas(rendered.canvas.width, rendered.canvas.height);
    const mg = ctx2d(nextMask);
    mg.imageSmoothingEnabled = true;
    mg.imageSmoothingQuality = "high";
    mg.setTransform(new DOMMatrix().translate(-rendered.x, -rendered.y).multiply(m).translate(l.x, l.y));
    mg.drawImage(l.mask, 0, 0);
  }

  return {
    ...l,
    kind: "smart",
    smart: nextSmart,
    canvas: rendered.canvas,
    x: rendered.x,
    y: rendered.y,
    mask: nextMask,
  };
}

/** Resets scale and rotation back to 100% / 0 deg centered on current Smart Object position. */
export function resetSmartTransform(doc: Doc, layerId = doc.active, ctx?: { fg: string; bg: string }): Doc {
  const l = doc.layers.find((x) => x.id === layerId);
  if (!l || l.kind !== "smart" || !l.smart) return doc;
  const nextSmart: SmartMeta = {
    ...l.smart,
    matrix: resetSmartMatrix(l.smart.sourceDoc.w, l.smart.sourceDoc.h, l.smart.matrix),
  };
  return replaceLayer(doc, l.id, syncSmartLayer(l, nextSmart, ctx));
}

/** "New Smart Object via Copy": duplicates a Smart Object with an independent `sourceId` & cloned contents. */
export function duplicateSmartIndependent(doc: Doc, layerId = doc.active, ctx?: { fg: string; bg: string }): Doc {
  const l = doc.layers.find((x) => x.id === layerId);
  if (!l || l.kind !== "smart" || !l.smart) return doc;
  const smart: SmartMeta = {
    sourceId: newId(),
    sourceDoc: cloneDocDeep(l.smart.sourceDoc, true),
    matrix: [...l.smart.matrix] as Matrix2D,
    filters: l.smart.filters.map((f) => ({ ...f, id: newId(), params: structuredClone(f.params) })),
    filtersOn: l.smart.filtersOn,
  };
  const copy = syncSmartLayer(
    newLayer({
      ...l,
      id: newId(),
      name: `${l.name} copy`,
      canvas: cloneCanvas(l.canvas),
      mask: l.mask ? cloneCanvas(l.mask) : null,
      smart,
    }),
    smart,
    ctx,
  );
  return insertAbove({ ...doc, active: l.id }, copy);
}

/** Updates EVERY Smart Object layer (including nested instances) sharing `sourceId` when contents are edited. */
export function updateLinkedSmartObjects(
  doc: Doc,
  sourceId: string,
  newSourceDoc: Doc,
  ctx?: { fg: string; bg: string },
): Doc {
  let changed = false;
  const layers = doc.layers.map((l) => {
    if (l.kind !== "smart" || !l.smart) return l;
    if (l.smart.sourceId === sourceId) {
      changed = true;
      const nextSmart: SmartMeta = { ...l.smart, sourceDoc: newSourceDoc };
      return syncSmartLayer(l, nextSmart, ctx);
    }
    const inner = updateLinkedSmartObjects(l.smart.sourceDoc, sourceId, newSourceDoc, ctx);
    if (inner !== l.smart.sourceDoc) {
      changed = true;
      return syncSmartLayer(l, { ...l.smart, sourceDoc: inner }, ctx);
    }
    return l;
  });
  return changed ? { ...doc, layers } : doc;
}

/** Replaces the contents of a Smart Object (and any linked instances), preserving existing transform slot & Smart Filters. */
export function replaceSmartContents(
  doc: Doc,
  layerId: string,
  newSourceDoc: Doc,
  newName?: string,
  ctx?: { fg: string; bg: string },
): Doc {
  const target = doc.layers.find((x) => x.id === layerId);
  if (!target || target.kind !== "smart" || !target.smart) return doc;
  const sourceId = target.smart.sourceId;
  const layers = doc.layers.map((l) => {
    if (l.kind !== "smart" || !l.smart || l.smart.sourceId !== sourceId) return l;
    const nextMatrix = fitReplacementMatrix(l.smart.sourceDoc.w, l.smart.sourceDoc.h, newSourceDoc.w, newSourceDoc.h, l.smart.matrix);
    const nextSmart: SmartMeta = { ...l.smart, sourceDoc: { ...newSourceDoc, name: newName || newSourceDoc.name }, matrix: nextMatrix };
    const updated = syncSmartLayer(l, nextSmart, ctx);
    return newName && l.id === layerId ? { ...updated, name: newName } : updated;
  });
  return { ...doc, layers };
}

/* ---------- Smart Filters CRUD ---------- */

export function addSmartFilter(
  doc: Doc,
  op: Op,
  params: Record<string, unknown>,
  ctx: Omit<OpContext, "scale">,
): Doc {
  const l = activeLayer(doc);
  if (l.kind !== "smart" || !l.smart) return doc;
  const f: SmartFilter = { id: newId(), opId: op.id, label: op.label, params: structuredClone(params), enabled: true, opacity: 1 };
  const nextSmart: SmartMeta = { ...l.smart, filters: [...l.smart.filters, f], filtersOn: true };
  return replaceLayer(doc, l.id, syncSmartLayer(l, nextSmart, { fg: ctx.fg, bg: ctx.bg }));
}

export function updateSmartFilter(
  doc: Doc,
  layerId: string,
  filterId: string,
  patch: Partial<SmartFilter>,
  ctx?: { fg: string; bg: string },
): Doc {
  const l = doc.layers.find((x) => x.id === layerId);
  if (!l || l.kind !== "smart" || !l.smart) return doc;
  const nextSmart: SmartMeta = {
    ...l.smart,
    filters: l.smart.filters.map((f) => (f.id === filterId ? { ...f, ...patch } : f)),
  };
  return replaceLayer(doc, l.id, syncSmartLayer(l, nextSmart, ctx));
}

export function removeSmartFilter(doc: Doc, layerId: string, filterId: string, ctx?: { fg: string; bg: string }): Doc {
  const l = doc.layers.find((x) => x.id === layerId);
  if (!l || l.kind !== "smart" || !l.smart) return doc;
  const nextSmart: SmartMeta = {
    ...l.smart,
    filters: l.smart.filters.filter((f) => f.id !== filterId),
  };
  return replaceLayer(doc, l.id, syncSmartLayer(l, nextSmart, ctx));
}

export function reorderSmartFilter(doc: Doc, layerId: string, filterId: string, dir: -1 | 1, ctx?: { fg: string; bg: string }): Doc {
  const l = doc.layers.find((x) => x.id === layerId);
  if (!l || l.kind !== "smart" || !l.smart) return doc;
  const idx = l.smart.filters.findIndex((f) => f.id === filterId);
  const to = idx + dir;
  if (idx < 0 || to < 0 || to >= l.smart.filters.length) return doc;
  const filters = [...l.smart.filters];
  [filters[idx], filters[to]] = [filters[to], filters[idx]];
  return replaceLayer(doc, l.id, syncSmartLayer(l, { ...l.smart, filters }, ctx));
}

export function toggleAllSmartFilters(doc: Doc, layerId: string, ctx?: { fg: string; bg: string }): Doc {
  const l = doc.layers.find((x) => x.id === layerId);
  if (!l || l.kind !== "smart" || !l.smart) return doc;
  const nextSmart: SmartMeta = { ...l.smart, filtersOn: !l.smart.filtersOn };
  return replaceLayer(doc, l.id, syncSmartLayer(l, nextSmart, ctx));
}

export function clearSmartFilters(doc: Doc, layerId: string, ctx?: { fg: string; bg: string }): Doc {
  const l = doc.layers.find((x) => x.id === layerId);
  if (!l || l.kind !== "smart" || !l.smart) return doc;
  const nextSmart: SmartMeta = { ...l.smart, filters: [] };
  return replaceLayer(doc, l.id, syncSmartLayer(l, nextSmart, ctx));
}

/**
 * Downsampled live preview for adding or re-editing a Smart Filter on a Smart Object without
 * double-applying an existing filter onto the already-filtered outer layer canvas.
 */
export function previewSmartLayer(
  l: Layer,
  opts: {
    op: Op;
    params: Record<string, unknown>;
    filterId?: string;
    ctx: { fg: string; bg: string };
    maxPixels?: number;
  },
): { canvas: HTMLCanvasElement; scale: number } {
  if (l.kind !== "smart" || !l.smart) return { canvas: cloneCanvas(l.canvas), scale: 1 };
  const budget = opts.maxPixels ?? 1_500_000;
  const smart = l.smart;
  const srcFull = flatten(smart.sourceDoc);
  const s = Math.min(1, Math.sqrt(budget / Math.max(1, srcFull.width * srcFull.height)));
  const sw = Math.max(1, Math.round(srcFull.width * s));
  const sh = Math.max(1, Math.round(srcFull.height * s));
  let cur = makeCanvas(sw, sh);
  ctx2d(cur).drawImage(srcFull, 0, 0, sw, sh);

  const stack: { op: Op; params: Record<string, unknown>; opacity: number }[] = [];
  let replaced = false;
  for (const f of smart.filters) {
    if (opts.filterId && f.id === opts.filterId) {
      stack.push({ op: opts.op, params: opts.params, opacity: f.opacity });
      replaced = true;
    } else if (smart.filtersOn && f.enabled) {
      const fop = resolveSmartOp(f.opId);
      if (fop) stack.push({ op: fop, params: f.params, opacity: f.opacity });
    }
  }
  if (!opts.filterId && !replaced) {
    stack.push({ op: opts.op, params: opts.params, opacity: 1 });
  }

  for (const item of stack) {
    const g = ctx2d(cur, true);
    const img = g.getImageData(0, 0, cur.width, cur.height);
    const res = item.op.apply(img, scaled(item.op, item.params, s), { fg: opts.ctx.fg, bg: opts.ctx.bg, scale: s }) ?? img;
    const out = makeCanvas(cur.width, cur.height);
    ctx2d(out).putImageData(res, 0, 0);
    if (item.opacity >= 0.999) {
      cur = out;
    } else {
      const blended = cloneCanvas(cur);
      const bg = ctx2d(blended);
      bg.globalAlpha = Math.max(0, Math.min(1, item.opacity));
      bg.drawImage(out, 0, 0);
      cur = blended;
    }
  }

  const outS = Math.min(1, Math.sqrt(budget / Math.max(1, l.canvas.width * l.canvas.height)));
  const ow = Math.max(1, Math.round(l.canvas.width * outS));
  const oh = Math.max(1, Math.round(l.canvas.height * outS));
  const out = makeCanvas(ow, oh);
  const og = ctx2d(out);
  og.imageSmoothingEnabled = true;
  og.imageSmoothingQuality = "high";
  const [ma, mb, mc, md, me, mf] = smart.matrix;
  og.setTransform((ma * outS) / s, (mb * outS) / s, (mc * outS) / s, (md * outS) / s, (me - l.x) * outS, (mf - l.y) * outS);
  og.drawImage(cur, 0, 0);
  return { canvas: out, scale: outS };
}
