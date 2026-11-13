/**
 * Colour picker maths, all in the browser: conversions, a perceptual palette (k-means in OKLab),
 * the nearest CSS colour name, contrast, and palette exports (CSS, SCSS, Tailwind, JSON, GIMP .gpl,
 * Adobe .ase).
 */

export type RGB = [number, number, number];

export const hex = ([r, g, b]: RGB) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
export const fromHex = (h: string): RGB => {
  const s = h.replace("#", "");
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
};

const lin = (c: number) => {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
};

export function oklab([r, g, b]: RGB): [number, number, number] {
  const R = lin(r), G = lin(g), B = lin(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

export function oklch(c: RGB): [number, number, number] {
  const [L, a, b] = oklab(c);
  const C = Math.hypot(a, b);
  const h = (Math.atan2(b, a) * 180) / Math.PI;
  return [L, C, (h + 360) % 360];
}

export function hsl([r, g, b]: RGB): [number, number, number] {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, Math.round(l * 100)];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [Math.round(h * 60), Math.round(s * 100), Math.round(l * 100)];
}

export function cmyk([r, g, b]: RGB): [number, number, number, number] {
  const k = 1 - Math.max(r, g, b) / 255;
  if (k >= 1) return [0, 0, 0, 100];
  const f = (v: number) => Math.round(((1 - v / 255 - k) / (1 - k)) * 100);
  return [f(r), f(g), f(b), Math.round(k * 100)];
}

export function luminance([r, g, b]: RGB) {
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
export function contrast(a: RGB, b: RGB) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
export const inkOn = (c: RGB) => (contrast(c, [255, 255, 255]) >= contrast(c, [21, 20, 15]) ? "#ffffff" : "#15140f");

export function formats(c: RGB): { label: string; value: string }[] {
  const [h, s, l] = hsl(c);
  const [L, C, H] = oklch(c);
  const [cc, m, y, k] = cmyk(c);
  return [
    { label: "HEX", value: hex(c) },
    { label: "RGB", value: `rgb(${c.join(" ")})` },
    { label: "HSL", value: `hsl(${h} ${s}% ${l}%)` },
    { label: "OKLCH", value: `oklch(${(L * 100).toFixed(1)}% ${C.toFixed(3)} ${H.toFixed(1)})` },
    { label: "CMYK", value: `${cc}% ${m}% ${y}% ${k}%` },
  ];
}

/* ---------- names ---------- */

const NAMES: [string, string][] = Object.entries({
  black: "000000", white: "ffffff", red: "ff0000", lime: "00ff00", blue: "0000ff", yellow: "ffff00", cyan: "00ffff", magenta: "ff00ff",
  silver: "c0c0c0", gray: "808080", maroon: "800000", olive: "808000", green: "008000", purple: "800080", teal: "008080", navy: "000080",
  orange: "ffa500", gold: "ffd700", tomato: "ff6347", coral: "ff7f50", salmon: "fa8072", crimson: "dc143c", firebrick: "b22222",
  chocolate: "d2691e", sienna: "a0522d", tan: "d2b48c", beige: "f5f5dc", ivory: "fffff0", khaki: "f0e68c", wheat: "f5deb3",
  pink: "ffc0cb", hotpink: "ff69b4", deeppink: "ff1493", orchid: "da70d6", violet: "ee82ee", plum: "dda0dd", lavender: "e6e6fa",
  indigo: "4b0082", slateblue: "6a5acd", royalblue: "4169e1", dodgerblue: "1e90ff", steelblue: "4682b4", skyblue: "87ceeb",
  lightblue: "add8e6", turquoise: "40e0d0", aquamarine: "7fffd4", seagreen: "2e8b57", forestgreen: "228b22", olivedrab: "6b8e23",
  limegreen: "32cd32", yellowgreen: "9acd32", darkgreen: "006400", darkslategray: "2f4f4f", dimgray: "696969", gainsboro: "dcdcdc",
  whitesmoke: "f5f5f5", linen: "faf0e6", bisque: "ffe4c4", peachpuff: "ffdab9", moccasin: "ffe4b5", goldenrod: "daa520",
  darkorange: "ff8c00", orangered: "ff4500", brown: "a52a2a", rosybrown: "bc8f8f", midnightblue: "191970", darkblue: "00008b",
  cadetblue: "5f9ea0", darkcyan: "008b8b", mintcream: "f5fffa", honeydew: "f0fff0", snow: "fffafa", mistyrose: "ffe4e1",
});
const NAME_LAB = NAMES.map(([n, h]) => [n, oklab(fromHex(h))] as const);

export function nearestName(c: RGB): { name: string; exact: boolean } {
  const p = oklab(c);
  let best = NAME_LAB[0];
  let bd = Infinity;
  for (const e of NAME_LAB) {
    const d = (e[1][0] - p[0]) ** 2 + (e[1][1] - p[1]) ** 2 + (e[1][2] - p[2]) ** 2;
    if (d < bd) [best, bd] = [e, d];
  }
  return { name: best[0], exact: bd < 1e-6 };
}

/* ---------- palette ---------- */

export type Swatch = { rgb: RGB; share: number };

/**
 * The picture's main colours: k-means++ in OKLab (so "different" means different to the eye) on up to
 * 30,000 sampled pixels, near-duplicates merged, biggest first.
 */
export function palette(img: ImageData, k: number): Swatch[] {
  const { data, width, height } = img;
  const total = width * height;
  const step = Math.max(1, Math.floor(total / 30000));
  const px: [number, number, number][] = [];
  const raw: RGB[] = [];
  for (let i = 0; i < total; i += step) {
    const o = i * 4;
    if (data[o + 3] < 128) continue;
    const c: RGB = [data[o], data[o + 1], data[o + 2]];
    raw.push(c);
    px.push(oklab(c));
  }
  if (!px.length) return [];
  // k-means++ seeding (deterministic: a fixed-seed generator, so the same picture gives the same palette).
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const centers = [px[Math.floor(rand() * px.length)]];
  const d2 = new Float64Array(px.length).fill(Infinity);
  while (centers.length < Math.min(k, px.length)) {
    const c = centers[centers.length - 1];
    let sum = 0;
    for (let i = 0; i < px.length; i++) {
      const d = (px[i][0] - c[0]) ** 2 + (px[i][1] - c[1]) ** 2 + (px[i][2] - c[2]) ** 2;
      if (d < d2[i]) d2[i] = d;
      sum += d2[i];
    }
    if (sum === 0) break;
    let r = rand() * sum;
    let idx = 0;
    while ((r -= d2[idx]) > 0 && idx < px.length - 1) idx++;
    centers.push(px[idx]);
  }
  const assign = new Int32Array(px.length);
  for (let it = 0; it < 14; it++) {
    for (let i = 0; i < px.length; i++) {
      let best = 0, bd = Infinity;
      for (let j = 0; j < centers.length; j++) {
        const d = (px[i][0] - centers[j][0]) ** 2 + (px[i][1] - centers[j][1]) ** 2 + (px[i][2] - centers[j][2]) ** 2;
        if (d < bd) [best, bd] = [j, d];
      }
      assign[i] = best;
    }
    const acc = centers.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < px.length; i++) {
      const a = acc[assign[i]];
      a[0] += px[i][0]; a[1] += px[i][1]; a[2] += px[i][2]; a[3]++;
    }
    acc.forEach((a, j) => a[3] && (centers[j] = [a[0] / a[3], a[1] / a[3], a[2] / a[3]]));
  }
  // Report each cluster as the average of its real pixels (exact colours, no OKLab round trip).
  const sums = centers.map(() => [0, 0, 0, 0]);
  for (let i = 0; i < px.length; i++) {
    const s = sums[assign[i]];
    s[0] += raw[i][0]; s[1] += raw[i][1]; s[2] += raw[i][2]; s[3]++;
  }
  let out: Swatch[] = sums.filter((s) => s[3]).map((s) => ({ rgb: [s[0] / s[3], s[1] / s[3], s[2] / s[3]].map(Math.round) as RGB, share: s[3] / px.length }));
  out.sort((a, b) => b.share - a.share);
  const merged: Swatch[] = [];
  for (const s of out) {
    const near = merged.find((m) => {
      const a = oklab(m.rgb), b = oklab(s.rgb);
      return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 0.035;
    });
    if (near) near.share += s.share;
    else merged.push({ ...s });
  }
  out = merged;
  return out;
}

/* ---------- exports ---------- */

export type ExportKind = "css" | "scss" | "tailwind" | "json" | "gpl" | "ase";
const slug = (s: string, i: number) => (s ? s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") : `color-${i + 1}`) || `color-${i + 1}`;

export function exportText(kind: Exclude<ExportKind, "ase">, list: { rgb: RGB; name?: string }[], title = "Palette"): string {
  const named = list.map((c, i) => ({ ...c, key: slug(c.name ?? "", i), hex: hex(c.rgb) }));
  if (kind === "css") return `:root {\n${named.map((c) => `  --${c.key}: ${c.hex};`).join("\n")}\n}\n`;
  if (kind === "scss") return named.map((c) => `$${c.key}: ${c.hex};`).join("\n") + "\n";
  if (kind === "tailwind") return `@theme {\n${named.map((c) => `  --color-${c.key}: ${c.hex};`).join("\n")}\n}\n`;
  if (kind === "json") return JSON.stringify(Object.fromEntries(named.map((c) => [c.key, c.hex])), null, 2) + "\n";
  return `GIMP Palette\nName: ${title}\nColumns: ${Math.min(8, named.length)}\n#\n${named.map((c) => `${c.rgb.map((v) => String(v).padStart(3)).join(" ")}\t${c.key}`).join("\n")}\n`;
}

/** Adobe Swatch Exchange (ASE 1.0): Photoshop, Illustrator and InDesign read it. */
export function exportAse(list: { rgb: RGB; name?: string }[]): Blob {
  const parts: number[] = [];
  const u16 = (v: number) => parts.push((v >> 8) & 255, v & 255);
  const u32 = (v: number) => parts.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
  const f32 = (v: number) => {
    const b = new Uint8Array(new Float32Array([v]).buffer).reverse();
    parts.push(...b);
  };
  parts.push(0x41, 0x53, 0x45, 0x46); // "ASEF"
  u16(1); u16(0); u32(list.length);
  list.forEach((c, i) => {
    const name = c.name || hex(c.rgb);
    const nameLen = name.length + 1;
    const blockLen = 2 + nameLen * 2 + 4 + 12 + 2;
    u16(0x0001); u32(blockLen); u16(nameLen);
    for (const ch of name) u16(ch.charCodeAt(0));
    u16(0);
    parts.push(0x52, 0x47, 0x42, 0x20); // "RGB "
    c.rgb.forEach((v) => f32(v / 255));
    u16(2); // normal
    void i;
  });
  return new Blob([new Uint8Array(parts)], { type: "application/octet-stream" });
}

export function swatchPng(list: { rgb: RGB }[]): Promise<Blob> {
  const w = 120;
  const c = document.createElement("canvas");
  c.width = w * list.length;
  c.height = 160;
  const g = c.getContext("2d")!;
  list.forEach((s, i) => {
    g.fillStyle = hex(s.rgb);
    g.fillRect(i * w, 0, w, 120);
    g.fillStyle = "#ffffff";
    g.fillRect(i * w, 120, w, 40);
    g.fillStyle = "#15140f";
    g.font = "15px ui-monospace, monospace";
    g.fillText(hex(s.rgb).toUpperCase(), i * w + 12, 146);
  });
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't draw the swatches."))), "image/png"));
}
