import { ctx2d, freshName, insertAbove, makeCanvas, newDoc, newLayer } from "./doc";
import { renderText } from "./render";
import { NO_EFFECTS, type Doc, type Effects, type Layer, type TextMeta } from "./types";

/*
 * The "Create" panel: stickers, styled text, frames and collages — the quick creative pieces of
 * Picsart and Canva, built from ordinary layers so everything stays editable.
 */

export const STICKER_SETS: { label: string; items: string[] }[] = [
  { label: "Faces", items: ["😀", "😂", "🥹", "😍", "😎", "🤩", "🥳", "😇", "😜", "🤔", "😴", "😭", "😡", "🤯", "🥶", "🤗"] },
  { label: "Love", items: ["❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "💖", "💘", "💕", "💋", "🌹", "💐", "💍", "🫶"] },
  { label: "Party", items: ["🎉", "🎊", "🎈", "🎂", "🎁", "🥂", "🍾", "✨", "🌟", "⭐", "🔥", "💯", "👑", "🏆", "🎵", "📸"] },
  { label: "Nature", items: ["☀️", "🌙", "🌈", "☁️", "⚡", "❄️", "🌸", "🌻", "🍀", "🌴", "🌊", "🦋", "🐶", "🐱", "🐼", "🦄"] },
  { label: "Things", items: ["👍", "👏", "🙏", "✌️", "👉", "📍", "✅", "❌", "⚠️", "💡", "🔔", "🛒", "✈️", "🚗", "🏠", "☕"] },
];

const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';

/** A sticker is a text layer in the colour-emoji font, so it scales crisply and stays editable. */
export function addSticker(doc: Doc, emoji: string): Doc {
  const size = Math.round(Math.min(doc.w, doc.h) * 0.22);
  const meta: TextMeta = { text: emoji, font: EMOJI_FONT, size, weight: 400, italic: false, color: "#000000", align: "center", lineHeight: 1.1, letterSpacing: 0, stroke: null, background: null };
  const canvas = renderText(meta);
  const layer = newLayer({ name: `Sticker ${emoji}`, kind: "text", text: meta, canvas, x: Math.round((doc.w - canvas.width) / 2), y: Math.round((doc.h - canvas.height) / 2) });
  return insertAbove(doc, layer);
}

export type TextStyle = { id: string; label: string; sample: string; text: Partial<TextMeta> & { fontKey?: string }; effects?: Partial<{ [K in keyof Effects]: Partial<Effects[K]> }> };

export const TEXT_STYLES: TextStyle[] = [
  { id: "headline", label: "Headline", sample: "Aa", text: { weight: 700, size: 0.12, color: "#ffffff" }, effects: { shadow: { on: true, opacity: 45, distance: 6, size: 14 } } },
  { id: "outline", label: "Outline", sample: "Aa", text: { weight: 700, size: 0.11, color: "#ffffff", stroke: { color: "#15140f", width: 6 } } },
  { id: "neon", label: "Neon", sample: "Aa", text: { weight: 700, size: 0.1, color: "#f0abfc" }, effects: { glow: { on: true, color: "#e879f9", opacity: 90, size: 28 } } },
  { id: "label", label: "Label", sample: "Aa", text: { weight: 700, size: 0.06, color: "#ffffff", background: "#eb4a10" } },
  { id: "poster", label: "Poster", sample: "Aa", text: { fontKey: "impact", size: 0.16, color: "#facc15" }, effects: { stroke: { on: true, color: "#15140f", size: 5 } } },
  { id: "script", label: "Handwritten", sample: "Aa", text: { fontKey: "hand", weight: 700, size: 0.1, color: "#ffffff" }, effects: { shadow: { on: true, opacity: 35, distance: 4, size: 10 } } },
  { id: "serif", label: "Elegant", sample: "Aa", text: { fontKey: "serif", weight: 400, italic: true, size: 0.09, color: "#ffffff", letterSpacing: 2 } },
  { id: "caption", label: "Caption", sample: "Aa", text: { weight: 400, size: 0.045, color: "#15140f", background: "#ffffffdd" } },
];

/**
 * Adds a styled text layer. `size` in a style is a share of the picture's short side, so a style
 * looks the same on a small or a huge canvas. `fonts` maps the style's font key to a CSS family.
 */
export function addStyledText(doc: Doc, style: TextStyle, base: Omit<TextMeta, "text">, fonts: Record<string, string>): { doc: Doc; layer: Layer } {
  const short = Math.min(doc.w, doc.h);
  const { fontKey, size, ...rest } = style.text;
  const meta: TextMeta = {
    ...base,
    ...rest,
    font: fontKey ? (fonts[fontKey] ?? base.font) : base.font,
    size: Math.max(12, Math.round((size ?? 0.1) * short)),
    text: style.label === "Caption" ? "Write a caption" : "Your text",
    align: "center",
  };
  if (meta.stroke) meta.stroke = { ...meta.stroke, width: Math.max(2, Math.round((meta.stroke.width / 100) * meta.size)) };
  let effects: Effects | null = null;
  if (style.effects) {
    effects = structuredClone(NO_EFFECTS);
    for (const [k, v] of Object.entries(style.effects)) Object.assign(effects[k as keyof Effects], v);
  }
  const canvas = renderText(meta);
  const layer = newLayer({ name: style.label, kind: "text", text: meta, effects, canvas, x: Math.round((doc.w - canvas.width) / 2), y: Math.round((doc.h - canvas.height) / 2) });
  return { doc: insertAbove(doc, layer), layer };
}

export const FRAMES = [
  { id: "border", label: "Border" },
  { id: "thick", label: "Thick" },
  { id: "rounded", label: "Rounded" },
  { id: "polaroid", label: "Polaroid" },
  { id: "film", label: "Film strip" },
  { id: "double", label: "Double line" },
  { id: "corners", label: "Corners" },
  { id: "fade", label: "Soft edge" },
] as const;
export type FrameId = (typeof FRAMES)[number]["id"];

/** A frame is a layer on top: a border drawn around (or over) the picture's edge. */
export function addFrame(doc: Doc, id: FrameId, color: string): Doc {
  const { w, h } = doc;
  const s = Math.min(w, h);
  const c = makeCanvas(w, h);
  const g = ctx2d(c);
  g.fillStyle = color;
  g.strokeStyle = color;
  const ring = (inset: number, width: number, radius = 0) => {
    g.save();
    g.beginPath();
    g.rect(0, 0, w, h);
    g.roundRect(inset + width, inset + width, w - 2 * (inset + width), h - 2 * (inset + width), radius);
    g.fill("evenodd");
    g.restore();
  };
  switch (id) {
    case "border":
      ring(0, s * 0.025);
      break;
    case "thick":
      ring(0, s * 0.07);
      break;
    case "rounded":
      ring(0, s * 0.03, s * 0.06);
      break;
    case "polaroid": {
      g.beginPath();
      g.rect(0, 0, w, h);
      g.rect(s * 0.05, s * 0.05, w - s * 0.1, h - s * 0.05 - s * 0.2);
      g.fill("evenodd");
      break;
    }
    case "film": {
      const band = s * 0.09;
      g.fillRect(0, 0, w, band);
      g.fillRect(0, h - band, w, band);
      g.globalCompositeOperation = "destination-out";
      const hole = band * 0.38;
      for (let x = hole * 0.6; x < w; x += hole * 1.9) {
        g.beginPath();
        g.roundRect(x, band * 0.3, hole, band * 0.4, hole * 0.2);
        g.roundRect(x, h - band * 0.7, hole, band * 0.4, hole * 0.2);
        g.fill();
      }
      break;
    }
    case "double":
      g.lineWidth = s * 0.008;
      g.strokeRect(s * 0.03, s * 0.03, w - s * 0.06, h - s * 0.06);
      g.strokeRect(s * 0.05, s * 0.05, w - s * 0.1, h - s * 0.1);
      break;
    case "corners": {
      g.lineWidth = s * 0.012;
      const m = s * 0.04;
      const L = s * 0.14;
      g.beginPath();
      for (const [x, y, dx, dy] of [[m, m, 1, 1], [w - m, m, -1, 1], [m, h - m, 1, -1], [w - m, h - m, -1, -1]]) {
        g.moveTo(x, y + dy * L);
        g.lineTo(x, y);
        g.lineTo(x + dx * L, y);
      }
      g.stroke();
      break;
    }
    case "fade": {
      const grad = g.createRadialGradient(w / 2, h / 2, s * 0.35, w / 2, h / 2, Math.hypot(w, h) / 2);
      grad.addColorStop(0, "rgba(0,0,0,0)");
      grad.addColorStop(1, color);
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
      break;
    }
  }
  return insertAbove(doc, newLayer({ name: freshName(doc, "Frame"), canvas: c }));
}

/** The collage layouts for n photos: cells as fractions of the canvas [x, y, w, h]. */
function layoutFor(n: number): [number, number, number, number][] {
  if (n <= 1) return [[0, 0, 1, 1]];
  if (n === 2) return [[0, 0, 0.5, 1], [0.5, 0, 0.5, 1]];
  if (n === 3) return [[0, 0, 0.6, 1], [0.6, 0, 0.4, 0.5], [0.6, 0.5, 0.4, 0.5]];
  if (n === 4) return [[0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5], [0, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]];
  if (n === 5) return [[0, 0, 0.5, 0.6], [0.5, 0, 0.5, 0.6], [0, 0.6, 1 / 3, 0.4], [1 / 3, 0.6, 1 / 3, 0.4], [2 / 3, 0.6, 1 / 3, 0.4]];
  if (n === 6) return Array.from({ length: 6 }, (_, i) => [(i % 3) / 3, Math.floor(i / 3) / 2, 1 / 3, 1 / 2] as [number, number, number, number]);
  const cols = 3;
  const rows = Math.ceil(n / cols);
  return Array.from({ length: n }, (_, i) => [(i % cols) / cols, Math.floor(i / cols) / rows, 1 / cols, 1 / rows] as [number, number, number, number]);
}

/** A collage: each photo cropped to fill its cell (on its own layer), with gaps on a background. */
export function makeCollage(photos: HTMLCanvasElement[], size: number, gap: number, background: string, radius: number): Doc {
  const doc = newDoc(size, size, background, "Collage");
  const cells = layoutFor(photos.length);
  let next = doc;
  photos.slice(0, 9).forEach((p, i) => {
    const [fx, fy, fw, fh] = cells[i];
    // Gaps are even everywhere: a full gap at the canvas edge, half a gap on each side between cells.
    const x0 = fx * size + (fx < 0.001 ? gap : gap / 2);
    const y0 = fy * size + (fy < 0.001 ? gap : gap / 2);
    const x1 = (fx + fw) * size - (fx + fw > 0.999 ? gap : gap / 2);
    const y1 = (fy + fh) * size - (fy + fh > 0.999 ? gap : gap / 2);
    const x = Math.round(x0);
    const y = Math.round(y0);
    const w = Math.max(1, Math.round(x1 - x0));
    const h = Math.max(1, Math.round(y1 - y0));
    const c = makeCanvas(w, h);
    const g = ctx2d(c);
    g.imageSmoothingQuality = "high";
    if (radius) {
      g.beginPath();
      g.roundRect(0, 0, w, h, radius);
      g.clip();
    }
    // Cover the cell, cropping the overflow from the middle.
    const k = Math.max(w / p.width, h / p.height);
    g.drawImage(p, (w - p.width * k) / 2, (h - p.height * k) / 2, p.width * k, p.height * k);
    next = insertAbove(next, newLayer({ name: `Photo ${i + 1}`, canvas: c, x, y }));
  });
  return next;
}

/** Add a repeating tiled or clean bottom-right corner watermark layer. */
export function addWatermark(
  doc: Doc,
  opts: { text: string; color: string; opacity: number; mode: "tile" | "corner"; angle: number; size: number },
): Doc {
  const label = opts.text.trim() || "© Watermark";
  const c = makeCanvas(doc.w, doc.h);
  const g = ctx2d(c);
  const fontPx = Math.max(12, Math.round((Math.min(doc.w, doc.h) * Math.max(2, Math.min(24, opts.size))) / 100));
  g.font = `600 ${fontPx}px system-ui, -apple-system, sans-serif`;
  g.fillStyle = opts.color;
  g.textBaseline = "middle";
  if (opts.mode === "corner") {
    g.textAlign = "right";
    const pad = Math.max(12, Math.round(Math.min(doc.w, doc.h) * 0.03));
    g.shadowColor = "rgba(0,0,0,0.35)";
    g.shadowBlur = Math.max(2, fontPx * 0.12);
    g.fillText(label, doc.w - pad, doc.h - pad - fontPx * 0.45);
  } else {
    g.textAlign = "center";
    const metrics = g.measureText(label);
    const stepX = Math.max(metrics.width + fontPx * 1.4, fontPx * 3.5);
    const stepY = fontPx * 3.2;
    const diag = Math.hypot(doc.w, doc.h);
    g.translate(doc.w / 2, doc.h / 2);
    g.rotate((opts.angle * Math.PI) / 180);
    let row = 0;
    for (let y = -diag * 0.7; y <= diag * 0.7; y += stepY) {
      const offset = row % 2 === 0 ? 0 : stepX / 2;
      for (let x = -diag * 0.7 - stepX; x <= diag * 0.7 + stepX; x += stepX) {
        g.fillText(label, x + offset, y);
      }
      row++;
    }
  }
  const layer = newLayer({
    name: freshName(doc, "Watermark"),
    canvas: c,
    opacity: Math.max(5, Math.min(100, opts.opacity)),
  });
  return insertAbove(doc, layer);
}
