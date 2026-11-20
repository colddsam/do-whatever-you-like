import { adjustmentById } from "./adjustments";
import { ctx2d, makeCanvas } from "./doc";
import type { Doc, Effects, Layer, Rect, ShapeMeta, TextMeta } from "./types";

/* ---------- Text and shape layers: their pixels are drawn from their settings ---------- */

const fontString = (t: TextMeta) => `${t.italic ? "italic " : ""}${t.weight} ${t.size}px ${t.font}`;

export function renderText(t: TextMeta): HTMLCanvasElement {
  const probe = ctx2d(makeCanvas(1, 1));
  probe.font = fontString(t);
  if ("letterSpacing" in probe) (probe as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${t.letterSpacing}px`;
  const lines = t.text.split("\n");
  const lh = t.size * t.lineHeight;
  const widths = lines.map((l) => probe.measureText(l || " ").width);
  const pad = Math.ceil((t.stroke?.width ?? 0) + t.size * 0.25 + (t.background ? t.size * 0.3 : 0));
  const w = Math.ceil(Math.max(...widths, 1)) + pad * 2;
  const h = Math.ceil(lh * lines.length + t.size * 0.3) + pad * 2;
  const c = makeCanvas(w, h);
  const g = ctx2d(c);
  if (t.background) {
    g.fillStyle = t.background;
    g.beginPath();
    g.roundRect(0, 0, w, h, t.size * 0.2);
    g.fill();
  }
  g.font = fontString(t);
  if ("letterSpacing" in g) (g as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${t.letterSpacing}px`;
  g.textBaseline = "top";
  g.textAlign = t.align;
  const x = t.align === "left" ? pad : t.align === "right" ? w - pad : w / 2;
  lines.forEach((line, i) => {
    const y = pad + i * lh + (lh - t.size) / 2;
    if (t.stroke && t.stroke.width > 0) {
      g.strokeStyle = t.stroke.color;
      g.lineWidth = t.stroke.width * 2;
      g.lineJoin = "round";
      g.strokeText(line, x, y);
    }
    g.fillStyle = t.color;
    g.fillText(line, x, y);
  });
  return c;
}

/** Shapes are drawn into a box with room for the stroke; `pad` is that room. */
export function shapePad(s: ShapeMeta) {
  return Math.ceil((s.stroke ? s.strokeWidth : 0) / 2 + (s.kind === "arrow" ? s.strokeWidth * 2 : 0) + 2);
}

export function renderShape(s: ShapeMeta): HTMLCanvasElement {
  const pad = shapePad(s);
  const w = Math.max(1, Math.abs(s.w));
  const h = Math.max(1, Math.abs(s.h));
  const c = makeCanvas(w + pad * 2, h + pad * 2);
  const g = ctx2d(c);
  g.translate(pad, pad);
  g.lineJoin = "round";
  g.lineCap = "round";
  g.beginPath();
  switch (s.kind) {
    case "rect":
      g.roundRect(0, 0, w, h, Math.min(s.radius, w / 2, h / 2));
      break;
    case "ellipse":
      g.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      break;
    case "line":
    case "arrow": {
      // Lines run corner to corner; the sign of w/h says which way.
      const x0 = s.w >= 0 ? 0 : w;
      const y0 = s.h >= 0 ? 0 : h;
      const x1 = w - x0;
      const y1 = h - y0;
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
      if (s.kind === "arrow") {
        const a = Math.atan2(y1 - y0, x1 - x0);
        const head = Math.max(10, s.strokeWidth * 4);
        g.moveTo(x1, y1);
        g.lineTo(x1 - head * Math.cos(a - 0.45), y1 - head * Math.sin(a - 0.45));
        g.moveTo(x1, y1);
        g.lineTo(x1 - head * Math.cos(a + 0.45), y1 - head * Math.sin(a + 0.45));
      }
      g.strokeStyle = s.stroke ?? s.fill ?? "#000";
      g.lineWidth = Math.max(1, s.strokeWidth);
      g.stroke();
      return c;
    }
    case "polygon":
    case "star": {
      const n = Math.max(3, Math.round(s.sides));
      const pts = s.kind === "star" ? n * 2 : n;
      for (let i = 0; i < pts; i++) {
        const a = -Math.PI / 2 + (i / pts) * Math.PI * 2;
        const r = s.kind === "star" && i % 2 ? 0.45 : 1;
        const x = w / 2 + (w / 2) * r * Math.cos(a);
        const y = h / 2 + (h / 2) * r * Math.sin(a);
        if (i) g.lineTo(x, y);
        else g.moveTo(x, y);
      }
      g.closePath();
      break;
    }
  }
  if (s.fill) {
    g.fillStyle = s.fill;
    g.fill();
  }
  if (s.stroke && s.strokeWidth > 0) {
    g.strokeStyle = s.stroke;
    g.lineWidth = s.strokeWidth;
    g.stroke();
  }
  return c;
}

/* ---------- Compositing ---------- */

/** A small pool, so compositing a frame doesn't allocate canvases. */
class Pool {
  private free: HTMLCanvasElement[] = [];
  get(w: number, h: number) {
    const c = this.free.pop() ?? makeCanvas(w, h);
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    } else ctx2d(c).clearRect(0, 0, w, h);
    const g = ctx2d(c);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
    g.filter = "none";
    return c;
  }
  put(...cs: HTMLCanvasElement[]) {
    this.free.push(...cs);
    if (this.free.length > 12) this.free.length = 12;
  }
}
const pool = new Pool();

/** A layer drawn in a transform other than its stored one (free transform in progress). */
export type LiveTransform = { layerId: string; matrix: DOMMatrix };

/** Things that change a frame without being in the document yet. */
export type Live = {
  /** A layer replaced wholesale for this frame (a stroke grows its layer to cover the document). */
  swap?: Layer;
  /** A layer that isn't in the document yet (a shape being drawn, an adjustment layer being set up). */
  insert?: { layer: Layer; above: string };
  /** A brush stroke being painted: drawn over (or erasing) the target before it's committed. */
  stroke?: { layerId: string; canvas: HTMLCanvasElement; opacity: number; erase: boolean; mask: boolean; lockAlpha: boolean; clip: HTMLCanvasElement | null };
  /** A layer's pixels replaced for preview (filters, adjustments, pixel tools in progress). */
  replace?: { layerId: string; canvas: HTMLCanvasElement; scale: number };
  transform?: LiveTransform;
};

export type ComposeOpts = { rect: Rect; scale: number; live?: Live; only?: (l: Layer) => boolean };

/** Draws one layer's own pixels (mask, stroke, preview applied) into a canvas the size of the region. */
function drawLayerPixels(l: Layer, o: ComposeOpts): HTMLCanvasElement {
  const { rect, scale, live } = o;
  const W = Math.max(1, Math.ceil(rect.w * scale));
  const H = Math.max(1, Math.ceil(rect.h * scale));
  const out = pool.get(W, H);
  const g = ctx2d(out);
  g.imageSmoothingQuality = scale < 1 ? "medium" : "low";
  g.imageSmoothingEnabled = scale < 2;
  // Document space → region pixels.
  const base = new DOMMatrix().scale(scale, scale).translate(-rect.x, -rect.y);
  const lt = live?.transform?.layerId === l.id ? live.transform.matrix : null;
  const place = (m: DOMMatrix) => g.setTransform(lt ? base.multiply(lt).translate(l.x, l.y) : m.translate(l.x, l.y));

  const rep = live?.replace?.layerId === l.id ? live.replace : null;
  place(base);
  if (rep) g.drawImage(rep.canvas, 0, 0, l.canvas.width, l.canvas.height);
  else g.drawImage(l.canvas, 0, 0);

  const st = live?.stroke?.layerId === l.id ? live.stroke : null;
  if (st && !st.mask) {
    const s = pool.get(W, H);
    const sg = ctx2d(s);
    sg.setTransform(base.translate(l.x, l.y));
    sg.drawImage(st.canvas, 0, 0);
    if (st.clip) {
      sg.globalCompositeOperation = "destination-in";
      sg.drawImage(st.clip, 0, 0);
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = st.opacity;
    g.globalCompositeOperation = st.erase ? "destination-out" : st.lockAlpha ? "source-atop" : "source-over";
    g.drawImage(s, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
    pool.put(s);
  }

  if (l.mask && l.maskOn) {
    const m = pool.get(W, H);
    const mg = ctx2d(m);
    mg.setTransform(lt ? base.multiply(lt).translate(l.x, l.y) : base.translate(l.x, l.y));
    mg.drawImage(l.mask, 0, 0);
    if (st?.mask) {
      mg.globalAlpha = st.opacity;
      mg.globalCompositeOperation = st.erase ? "destination-out" : "source-over";
      let sc = st.canvas;
      if (st.clip) {
        sc = makeCanvas(st.canvas.width, st.canvas.height);
        const cg = ctx2d(sc);
        cg.drawImage(st.canvas, 0, 0);
        cg.globalCompositeOperation = "destination-in";
        cg.drawImage(st.clip, 0, 0);
      }
      mg.drawImage(sc, 0, 0);
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = "destination-in";
    g.drawImage(m, 0, 0);
    g.globalCompositeOperation = "source-over";
    pool.put(m);
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
  if (l.effects) {
    const fx = applyEffects(out, l.effects, scale);
    pool.put(out);
    return fx;
  }
  return out;
}

/** Layer styles: shadow, glow and stroke go under the pixels, colour overlay on top. */
function applyEffects(src: HTMLCanvasElement, e: Effects, scale: number) {
  const out = pool.get(src.width, src.height);
  const g = ctx2d(out);
  const silhouette = (color: string) => {
    const s = pool.get(src.width, src.height);
    const sg = ctx2d(s);
    sg.drawImage(src, 0, 0);
    sg.globalCompositeOperation = "source-in";
    sg.fillStyle = color;
    sg.fillRect(0, 0, s.width, s.height);
    return s;
  };
  if (e.shadow.on) {
    const s = silhouette(e.shadow.color);
    const a = (e.shadow.angle * Math.PI) / 180;
    g.save();
    g.globalAlpha = e.shadow.opacity / 100;
    g.filter = e.shadow.size > 0 ? `blur(${(e.shadow.size * scale) / 2}px)` : "none";
    g.drawImage(s, -Math.cos(a) * e.shadow.distance * scale, Math.sin(a) * e.shadow.distance * scale);
    g.restore();
    pool.put(s);
  }
  if (e.glow.on) {
    const s = silhouette(e.glow.color);
    g.save();
    g.globalAlpha = e.glow.opacity / 100;
    g.filter = `blur(${(e.glow.size * scale) / 2}px)`;
    g.drawImage(s, 0, 0);
    g.drawImage(s, 0, 0);
    g.restore();
    pool.put(s);
  }
  if (e.stroke.on && e.stroke.size > 0) {
    const s = silhouette(e.stroke.color);
    const r = e.stroke.size * scale;
    // Stamping the silhouette around a circle makes an outside stroke of radius r.
    const steps = Math.max(8, Math.min(48, Math.round(r * 2)));
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      g.drawImage(s, Math.cos(a) * r, Math.sin(a) * r);
    }
    pool.put(s);
  }
  g.drawImage(src, 0, 0);
  if (e.overlay.on) {
    g.save();
    g.globalAlpha = e.overlay.opacity / 100;
    g.globalCompositeOperation = "source-atop";
    g.fillStyle = e.overlay.color;
    g.fillRect(0, 0, out.width, out.height);
    g.restore();
  }
  return out;
}

/**
 * Composites the document over a region at a scale: the screen asks for what's visible at the
 * zoom it shows, exports ask for everything at 1.
 */
export function compose(doc: Doc, o: ComposeOpts): HTMLCanvasElement {
  const W = Math.max(1, Math.ceil(o.rect.w * o.scale));
  const H = Math.max(1, Math.ceil(o.rect.h * o.scale));
  const acc = makeCanvas(W, H);
  const g = ctx2d(acc, true);
  const swap = o.live?.swap;
  let all = swap ? doc.layers.map((l) => (l.id === swap.id ? swap : l)) : doc.layers;
  const ins = o.live?.insert;
  if (ins) {
    const i = all.findIndex((l) => l.id === ins.above);
    all = [...all.slice(0, i + 1), ins.layer, ...all.slice(i + 1)];
  }
  const layers = all.filter((l) => l.visible && (!o.only || o.only(l)));
  for (let i = 0; i < layers.length; i++) {
    const l = layers[i];
    if (l.kind === "adjustment") {
      applyAdjustmentLayer(acc, l, o);
      continue;
    }
    const px = drawLayerPixels(l, o);
    // Layers clipped to this one are painted only where it has pixels.
    while (layers[i + 1]?.clip) {
      const c = layers[++i];
      // A clipped adjustment layer changes only the layer it's clipped to.
      if (c.kind === "adjustment") {
        applyAdjustmentLayer(px, c, o);
        continue;
      }
      const cp = drawLayerPixels(c, o);
      const pg = ctx2d(px);
      pg.globalAlpha = c.opacity;
      pg.globalCompositeOperation = "source-atop";
      pg.drawImage(cp, 0, 0);
      pg.globalAlpha = 1;
      pg.globalCompositeOperation = "source-over";
      pool.put(cp);
    }
    g.globalAlpha = l.opacity;
    g.globalCompositeOperation = l.blend === "normal" ? "source-over" : l.blend;
    g.drawImage(px, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
    pool.put(px);
  }
  return acc;
}

function applyAdjustmentLayer(acc: HTMLCanvasElement, l: Layer, o: ComposeOpts) {
  const op = l.adjust && adjustmentById(l.adjust.id);
  if (!op) return;
  const g = ctx2d(acc, true);
  const img = g.getImageData(0, 0, acc.width, acc.height);
  const res = op.apply(img, l.adjust!.params, { scale: o.scale, fg: "#000", bg: "#fff" }) ?? img;
  const adj = pool.get(acc.width, acc.height);
  ctx2d(adj).putImageData(res, 0, 0);
  if (l.mask && l.maskOn) {
    const ag = ctx2d(adj);
    ag.globalCompositeOperation = "destination-in";
    ag.setTransform(new DOMMatrix().scale(o.scale, o.scale).translate(-o.rect.x + l.x, -o.rect.y + l.y));
    ag.drawImage(l.mask, 0, 0);
    ag.setTransform(1, 0, 0, 1, 0, 0);
    ag.globalCompositeOperation = "source-over";
  }
  g.globalAlpha = l.opacity;
  g.globalCompositeOperation = l.blend === "normal" ? "source-atop" : l.blend;
  g.drawImage(adj, 0, 0);
  g.globalAlpha = 1;
  g.globalCompositeOperation = "source-over";
  pool.put(adj);
}

/** The whole picture at full size, for export and for tools that sample "all layers". */
export const flatten = (doc: Doc, live?: Live) => compose(doc, { rect: { x: 0, y: 0, w: doc.w, h: doc.h }, scale: 1, live });

/** One layer's pixels with its mask and styles, at full size in document space (merge down, export layer). */
export function layerAsDoc(doc: Doc, l: Layer) {
  return compose({ ...doc, layers: [{ ...l, visible: true, clip: false }] }, { rect: { x: 0, y: 0, w: doc.w, h: doc.h }, scale: 1 });
}
