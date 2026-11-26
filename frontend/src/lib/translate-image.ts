/**
 * Picture translation in the browser (Google Lens style): Tesseract reads the text and where it
 * sits, each paragraph is translated, and the translation is painted over the original on a canvas,
 * on a patch of the sampled background colour, in the sampled text colour.
 *
 * Tesseract's WebAssembly and language data load from the jsDelivr / tessdata CDNs on first use
 * (a few MB, cached by the browser), so the server does no OCR work at all.
 */
import type { Worker as TesseractWorker } from "tesseract.js";

/** Our language codes → Tesseract traineddata names. */
export const TESSERACT_LANGS: Record<string, string> = {
  en: "eng", hi: "hin", bn: "ben", es: "spa", fr: "fra", de: "deu", ar: "ara", pt: "por", ru: "rus", ja: "jpn",
  ko: "kor", zh: "chi_sim", "zh-tw": "chi_tra", yue: "chi_tra", it: "ita", ta: "tam", te: "tel", mr: "mar", ur: "urd",
  tr: "tur", vi: "vie", id: "ind", gu: "guj", kn: "kan", ml: "mal", pa: "pan", ne: "nep", nl: "nld", pl: "pol",
  uk: "ukr", th: "tha", fa: "fas", he: "heb", sv: "swe", no: "nor", da: "dan", fi: "fin", el: "ell", cs: "ces",
  ro: "ron", hu: "hun", ms: "msa", tl: "tgl", sw: "swa", af: "afr", ca: "cat", hr: "hrv", sr: "srp", sk: "slk",
  sl: "slv", bg: "bul", lt: "lit", lv: "lav", et: "est", is: "isl", ka: "kat", hy: "hye", az: "aze", kk: "kaz",
  uz: "uzb", km: "khm", lo: "lao", my: "mya", si: "sin", am: "amh", mn: "mon", sq: "sqi", mk: "mkd", bs: "bos",
  eu: "eus", gl: "glg", cy: "cym", ga: "gle", mt: "mlt", la: "lat", eo: "epo", yi: "yid", ps: "pus", sd: "snd",
  or: "ori", as: "asm", be: "bel", tg: "tgk", ky: "kir", ug: "uig", jv: "jav", su: "sun", ht: "hat", lb: "ltz",
  mi: "mri", yo: "yor", fy: "fry", gd: "gla", co: "cos", ceb: "ceb", ku: "kmr", ti: "tir", dv: "div", qu: "que",
};

export function tesseractLangFor(code: string): string | null {
  return TESSERACT_LANGS[code.toLowerCase()] ?? null;
}

export type OcrBox = { x: number; y: number; w: number; h: number };

export type OcrParagraph = {
  id: number;
  text: string;
  confidence: number;
  box: OcrBox;
  lines: { text: string; box: OcrBox }[];
  translated?: string;
};

let workerPromise: Promise<TesseractWorker> | null = null;
let workerLangs = "";
/** The logger is bound once per worker, so it forwards to whichever caller is waiting now. */
let progressCb: ((p: number, status: string) => void) | undefined;

async function getWorker(langs: string, onProgress?: (p: number, status: string) => void): Promise<TesseractWorker> {
  progressCb = onProgress;
  if (workerPromise && workerLangs === langs) {
    return workerPromise;
  }
  if (workerPromise) {
    const old = await workerPromise.catch(() => null);
    await old?.terminate().catch(() => {});
  }
  workerLangs = langs;
  workerPromise = import("tesseract.js").then(({ createWorker }) =>
    createWorker(langs.split("+"), 1, {
      logger: (m: { status: string; progress: number }) => progressCb?.(m.progress ?? 0, m.status ?? ""),
    }),
  );
  workerPromise.catch(() => {
    workerPromise = null;
    workerLangs = "";
  });
  return workerPromise;
}

export async function disposeOcr() {
  if (!workerPromise) return;
  const w = await workerPromise.catch(() => null);
  workerPromise = null;
  workerLangs = "";
  await w?.terminate().catch(() => {});
}

const toBox = (b: { x0: number; y0: number; x1: number; y1: number }): OcrBox => ({ x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 });

/**
 * Grey, contrast-boosted copy for the recogniser: coloured text on coloured backgrounds (red on
 * cream, white on blue) is often skipped in colour and found reliably in grey.
 */
function prepareForOcr(image: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = image.width;
  c.height = image.height;
  const ctx = c.getContext("2d")!;
  ctx.filter = "grayscale(1) contrast(1.4)";
  ctx.drawImage(image, 0, 0);
  return c;
}

const union = (boxes: OcrBox[]): OcrBox => {
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w));
  const y1 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

/**
 * Tesseract sometimes puts a headline and the body under it (even on different backgrounds) in
 * one paragraph. Split a paragraph wherever the next line clearly starts a new visual block:
 * a different text size, a big gap, a different left edge, or a different background colour.
 */
function splitIntoBlocks(lines: { text: string; box: OcrBox }[], ctx: CanvasRenderingContext2D | null) {
  const bgs = lines.map((l) => (ctx ? sampleBackground(ctx, l.box) : ([0, 0, 0] as RGB)));
  const groups: number[][] = [];
  lines.forEach((l, i) => {
    const g = groups[groups.length - 1];
    if (!g) return groups.push([i]);
    const last = lines[g[g.length - 1]];
    const h = Math.max(1, Math.min(l.box.h, last.box.h));
    const sizeJump = Math.max(l.box.h, last.box.h) / h > 1.3;
    const gap = l.box.y - (last.box.y + last.box.h) > 0.9 * h;
    const leftShift = Math.abs(l.box.x - last.box.x) > 1.5 * h && Math.abs(l.box.x + l.box.w / 2 - (last.box.x + last.box.w / 2)) > 1.5 * h;
    const a = bgs[i];
    const b = bgs[g[g.length - 1]];
    const colour = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) > 90;
    if (sizeJump || gap || leftShift || colour) groups.push([i]);
    else g.push(i);
  });
  return groups.map((g) => g.map((i) => lines[i]));
}

/** Reads the text in an image: visual blocks (paragraphs) with their boxes and lines. */
export async function recognizeImage(
  image: HTMLCanvasElement,
  langCodes: string[],
  onProgress?: (p: number, status: string) => void,
): Promise<OcrParagraph[]> {
  const langs = Array.from(new Set(langCodes.map((c) => tesseractLangFor(c)).filter(Boolean) as string[]));
  const worker = await getWorker(langs.length ? langs.join("+") : "eng", onProgress);
  const { data } = await worker.recognize(prepareForOcr(image), {}, { blocks: true, text: true });
  const ctx = image.getContext("2d", { willReadFrequently: true });
  const paragraphs: OcrParagraph[] = [];
  for (const block of data.blocks ?? []) {
    for (const para of block.paragraphs ?? []) {
      const lines = (para.lines ?? [])
        .filter((l) => l.text.trim() && l.confidence > 30)
        .map((l) => ({ text: l.text.replace(/\s+/g, " ").trim(), box: toBox(l.bbox) }));
      for (const group of splitIntoBlocks(lines, ctx)) {
        const text = group.map((l) => l.text).join(" ").replace(/-\s(?=\p{Ll})/gu, "");
        if (!/\p{L}/u.test(text)) continue;
        paragraphs.push({ id: paragraphs.length, text, confidence: para.confidence, box: union(group.map((l) => l.box)), lines: group });
      }
    }
  }
  return paragraphs;
}

// ---------------------------------------------------------------- painting

type RGB = [number, number, number];

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** Background = median colour of a thin ring just outside the box. */
function sampleBackground(ctx: CanvasRenderingContext2D, box: OcrBox): RGB {
  const { width, height } = ctx.canvas;
  const pad = 3;
  const x0 = Math.max(0, Math.floor(box.x - pad));
  const y0 = Math.max(0, Math.floor(box.y - pad));
  const x1 = Math.min(width - 1, Math.ceil(box.x + box.w + pad));
  const y1 = Math.min(height - 1, Math.ceil(box.y + box.h + pad));
  const w = Math.max(1, x1 - x0);
  const h = Math.max(1, y1 - y0);
  const img = ctx.getImageData(x0, y0, w, h).data;
  const r: number[] = [];
  const g: number[] = [];
  const b: number[] = [];
  const push = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    r.push(img[i]);
    g.push(img[i + 1]);
    b.push(img[i + 2]);
  };
  for (let x = 0; x < w; x += 2) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 0; y < h; y += 2) {
    push(0, y);
    push(w - 1, y);
  }
  return [median(r), median(g), median(b)];
}

/** Text colour = average of the pixels inside the box that differ most from the background. */
function sampleForeground(ctx: CanvasRenderingContext2D, box: OcrBox, bg: RGB): RGB {
  const x = Math.max(0, Math.floor(box.x));
  const y = Math.max(0, Math.floor(box.y));
  const w = Math.max(1, Math.min(ctx.canvas.width - x, Math.ceil(box.w)));
  const h = Math.max(1, Math.min(ctx.canvas.height - y, Math.ceil(box.h)));
  const img = ctx.getImageData(x, y, w, h).data;
  const scored: { d: number; c: RGB }[] = [];
  for (let i = 0; i < img.length; i += 4 * 3) {
    const c: RGB = [img[i], img[i + 1], img[i + 2]];
    const d = Math.abs(c[0] - bg[0]) + Math.abs(c[1] - bg[1]) + Math.abs(c[2] - bg[2]);
    scored.push({ d, c });
  }
  scored.sort((a, b) => b.d - a.d);
  const top = scored.slice(0, Math.max(5, Math.floor(scored.length * 0.08)));
  if (!top.length || top[0].d < 60) {
    const lum = 0.299 * bg[0] + 0.587 * bg[1] + 0.114 * bg[2];
    return lum > 140 ? [17, 17, 17] : [250, 250, 250];
  }
  const avg = top.reduce<RGB>((acc, t) => [acc[0] + t.c[0], acc[1] + t.c[1], acc[2] + t.c[2]], [0, 0, 0]);
  return [Math.round(avg[0] / top.length), Math.round(avg[1] / top.length), Math.round(avg[2] / top.length)];
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const hasSpaces = /\s/.test(text.trim());
  const tokens = hasSpaces ? text.split(/(\s+)/) : Array.from(text); // CJK/Thai: wrap by character
  const lines: string[] = [];
  let cur = "";
  for (const tok of tokens) {
    const next = cur + tok;
    if (ctx.measureText(next).width <= maxWidth || !cur.trim()) cur = next;
    else {
      lines.push(cur.trim());
      cur = tok.trimStart();
    }
  }
  if (cur.trim()) lines.push(cur.trim());
  return lines;
}

export type PaintOptions = {
  fontFamily?: string;
  rtl?: boolean;
  /** 0–1: how opaque the patch behind the translation is. */
  patchOpacity?: number;
  showBoxes?: boolean;
};

/** Draws the original image with every translated paragraph painted over its source text. */
export function paintTranslation(
  canvas: HTMLCanvasElement,
  source: CanvasImageSource & { width: number; height: number },
  paragraphs: OcrParagraph[],
  opts: PaintOptions = {},
) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  canvas.width = source.width;
  canvas.height = source.height;
  ctx.drawImage(source, 0, 0);
  const family = opts.fontFamily ?? 'system-ui, "Noto Sans", "Segoe UI", sans-serif';
  // Sample everything first, before any painting changes the pixels.
  const samples = paragraphs.map((p) => {
    const bg = sampleBackground(ctx, p.box);
    return { bg, fg: sampleForeground(ctx, p.box, bg) };
  });
  paragraphs.forEach((p, i) => {
    if (!p.translated?.trim()) return;
    const { bg, fg } = samples[i];
    ctx.save();
    ctx.globalAlpha = opts.patchOpacity ?? 0.96;
    ctx.fillStyle = `rgb(${bg[0]},${bg[1]},${bg[2]})`;
    for (const line of p.lines) ctx.fillRect(line.box.x - 3, line.box.y - 2, line.box.w + 6, line.box.h + 4);
    ctx.fillRect(p.box.x - 2, p.box.y - 2, p.box.w + 4, p.box.h + 4);
    ctx.restore();

    const avgLine = p.lines.reduce((s, l) => s + l.box.h, 0) / p.lines.length;
    let size = Math.max(8, Math.round(avgLine * 0.82));
    const maxW = Math.max(20, p.box.w);
    const maxH = Math.max(avgLine, p.box.h) + avgLine * 0.25;
    let lines: string[] = [];
    for (; size >= 7; size -= 1) {
      ctx.font = `${size}px ${family}`;
      lines = wrapLines(ctx, p.translated, maxW);
      if (lines.length * size * 1.18 <= maxH) break;
    }
    ctx.fillStyle = `rgb(${fg[0]},${fg[1]},${fg[2]})`;
    ctx.textBaseline = "top";
    ctx.direction = opts.rtl ? "rtl" : "ltr";
    ctx.textAlign = opts.rtl ? "right" : "left";
    const x = opts.rtl ? p.box.x + p.box.w : p.box.x;
    lines.forEach((line, li) => ctx.fillText(line, x, p.box.y + li * size * 1.18, maxW + 4));
    if (opts.showBoxes) {
      ctx.strokeStyle = "rgba(235,74,16,0.8)";
      ctx.lineWidth = Math.max(1, Math.round(source.width / 800));
      ctx.strokeRect(p.box.x, p.box.y, p.box.w, p.box.h);
    }
  });
}

/** Loads a File/Blob into an ImageBitmap-like canvas, downscaled to keep OCR fast on phones. */
export async function loadImageForOcr(file: Blob, maxSide = 2200): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file).catch(async () => {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  });
  const w = "naturalWidth" in bitmap ? bitmap.naturalWidth : bitmap.width;
  const h = "naturalHeight" in bitmap ? bitmap.naturalHeight : bitmap.height;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  if ("close" in bitmap) bitmap.close();
  return canvas;
}
