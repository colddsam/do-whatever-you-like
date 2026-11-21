/** Built-in 3D film/creative LUTs and Adobe `.cube` parser for Pro Photo Editor. */

export type PhotoLut = {
  id: string;
  label: string;
  size: number;
  data: Float32Array;
  custom?: boolean;
};

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (edge0: number, edge1: number, x: number) => {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

function buildCube(
  id: string,
  label: string,
  size: number,
  fn: (r: number, g: number, b: number) => [number, number, number],
): PhotoLut {
  const data = new Float32Array(size * size * size * 3);
  const denom = size - 1;
  let ptr = 0;
  // Standard .cube order: B outer, G middle, R inner (varies fastest).
  for (let bi = 0; bi < size; bi++) {
    const b = bi / denom;
    for (let gi = 0; gi < size; gi++) {
      const g = gi / denom;
      for (let ri = 0; ri < size; ri++) {
        const r = ri / denom;
        const [nr, ng, nb] = fn(r, g, b);
        data[ptr++] = clamp01(nr);
        data[ptr++] = clamp01(ng);
        data[ptr++] = clamp01(nb);
      }
    }
  }
  return { id, label, size, data };
}

const sCurve = (x: number, strength: number) => {
  const s = x * x * (3 - 2 * x);
  return mix(x, s, strength);
};

const BUILTIN_LUTS: PhotoLut[] = [
  buildCube("kodak-2383", "Kodak 2383 Print", 17, (r, g, b) => {
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const sh = 1 - smooth(0.0, 0.45, l);
    const hi = smooth(0.5, 1.0, l);
    let rr = sCurve(r, 0.34);
    let gg = sCurve(g, 0.3);
    let bb = sCurve(b, 0.32);
    // Warm golden highlights, cool cyan-teal shadows, rich Kodak print density
    rr = rr * 0.98 + hi * 0.045 - sh * 0.015;
    gg = gg * 0.99 + hi * 0.02 + sh * 0.012;
    bb = bb * 0.97 - hi * 0.035 + sh * 0.038;
    const nl = 0.2126 * rr + 0.7152 * gg + 0.0722 * bb;
    return [mix(nl, rr, 1.12), mix(nl, gg, 1.1), mix(nl, bb, 1.08)];
  }),
  buildCube("fuji-3513", "Fuji 3513 Eterna", 17, (r, g, b) => {
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const sh = 1 - smooth(0.0, 0.42, l);
    const hi = smooth(0.58, 1.0, l);
    // Lifted matte blacks, soft highlight roll-off, subtle emerald shadows
    const rr = 0.025 + mix(l, r, 0.86) * 0.93 - sh * 0.018 + hi * 0.012;
    const gg = 0.028 + mix(l, g, 0.9) * 0.94 + sh * 0.018;
    const bb = 0.024 + mix(l, b, 0.88) * 0.92 + sh * 0.01 - hi * 0.015;
    return [sCurve(rr, 0.14), sCurve(gg, 0.15), sCurve(bb, 0.14)];
  }),
  buildCube("teal-orange", "Cinema Teal & Orange", 17, (r, g, b) => {
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const sh = 1 - smooth(0.0, 0.48, l);
    const midHi = smooth(0.28, 0.88, l);
    const rr = sCurve(r, 0.28) - sh * 0.07 + midHi * 0.08;
    const gg = sCurve(g, 0.24) + sh * 0.025 + midHi * 0.02;
    const bb = sCurve(b, 0.26) + sh * 0.08 - midHi * 0.085;
    return [rr, gg, bb];
  }),
  buildCube("bleach-bypass", "Bleach Bypass", 17, (r, g, b) => {
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const cl = sCurve(l, 0.65);
    const dr = mix(cl, sCurve(r, 0.52), 0.42);
    const dg = mix(cl, sCurve(g, 0.52), 0.44);
    const db = mix(cl, sCurve(b, 0.52), 0.48);
    return [dr * 0.97, dg * 0.99, db * 1.02];
  }),
  buildCube("golden-film", "Golden Hour 400", 17, (r, g, b) => {
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const mid = smooth(0.15, 0.85, l);
    const rr = 0.015 + sCurve(r, 0.2) * 0.98 + mid * 0.065;
    const gg = 0.01 + sCurve(g, 0.18) * 0.97 + mid * 0.028;
    const bb = 0.005 + sCurve(b, 0.2) * 0.9 - mid * 0.055;
    return [rr, gg, bb];
  }),
  buildCube("nordic-cool", "Nordic Crisp", 17, (r, g, b) => {
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const rr = mix(l, r, 0.78) - 0.02;
    const gg = mix(l, g, 0.82) + 0.006;
    const bb = mix(l, b, 0.92) + 0.036;
    return [sCurve(rr, 0.2), sCurve(gg, 0.2), sCurve(bb, 0.22)];
  }),
  buildCube("cyber-neon", "Cyber Night", 17, (r, g, b) => {
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const sh = 1 - smooth(0.0, 0.5, l);
    const hi = smooth(0.45, 1.0, l);
    const rr = sCurve(r, 0.35) + sh * 0.05 + hi * 0.085;
    const gg = sCurve(g, 0.32) - sh * 0.02 - hi * 0.025;
    const bb = sCurve(b, 0.35) + sh * 0.11 + hi * 0.035;
    return [rr, gg, bb];
  }),
  buildCube("noir-silver", "Silver Noir B&W", 17, (r, g, b) => {
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    const c = sCurve(l, 0.55);
    // Faint selenium warmth in highlights, cool deep blacks
    const sh = 1 - smooth(0.0, 0.4, c);
    return [c + 0.006 * (1 - sh), c, c + 0.012 * sh];
  }),
];

let luts: PhotoLut[] = [...BUILTIN_LUTS];
let snapshot: readonly PhotoLut[] = luts;
const listeners = new Set<() => void>();

export function getPhotoLuts(): readonly PhotoLut[] {
  return snapshot;
}

export function subscribePhotoLuts(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getPhotoLut(id: string): PhotoLut | undefined {
  return snapshot.find((l) => l.id === id) ?? snapshot[0];
}

export function parseCubeText(text: string, fallbackLabel = "Custom LUT"): { title: string; size: number; data: Float32Array } {
  const lines = text.split(/\r?\n/);
  let title = fallbackLabel;
  let size3d = 0;
  let size1d = 0;
  let domMin: [number, number, number] = [0, 0, 0];
  let domMax: [number, number, number] = [1, 1, 1];
  const triplets: number[] = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const upper = line.toUpperCase();
    if (upper.startsWith("TITLE")) {
      const m = line.match(/TITLE\s+"?([^"]+)"?/i);
      if (m?.[1]) title = m[1].trim();
      continue;
    }
    if (upper.startsWith("LUT_3D_SIZE")) {
      size3d = Number.parseInt(line.split(/\s+/)[1] ?? "0", 10);
      continue;
    }
    if (upper.startsWith("LUT_1D_SIZE")) {
      size1d = Number.parseInt(line.split(/\s+/)[1] ?? "0", 10);
      continue;
    }
    if (upper.startsWith("DOMAIN_MIN")) {
      const parts = line.split(/\s+/).slice(1).map(Number);
      if (parts.length >= 3 && parts.every(Number.isFinite)) domMin = [parts[0], parts[1], parts[2]];
      continue;
    }
    if (upper.startsWith("DOMAIN_MAX")) {
      const parts = line.split(/\s+/).slice(1).map(Number);
      if (parts.length >= 3 && parts.every(Number.isFinite)) domMax = [parts[0], parts[1], parts[2]];
      continue;
    }
    if (/^[A-Za-z_]/.test(line)) continue;
    const parts = line.split(/\s+/);
    if (parts.length >= 3) {
      const r = Number(parts[0]);
      const g = Number(parts[1]);
      const b = Number(parts[2]);
      if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
        triplets.push(r, g, b);
      }
    }
  }

  const spanR = domMax[0] - domMin[0] || 1;
  const spanG = domMax[1] - domMin[1] || 1;
  const spanB = domMax[2] - domMin[2] || 1;

  if (size3d >= 2) {
    const expected = size3d * size3d * size3d * 3;
    if (triplets.length < expected) {
      throw new Error(`Expected ${expected / 3} entries for ${size3d}x${size3d}x${size3d} 3D LUT, got ${triplets.length / 3}.`);
    }
    const data = new Float32Array(expected);
    for (let i = 0; i < expected; i += 3) {
      data[i] = clamp01((triplets[i] - domMin[0]) / spanR);
      data[i + 1] = clamp01((triplets[i + 1] - domMin[1]) / spanG);
      data[i + 2] = clamp01((triplets[i + 2] - domMin[2]) / spanB);
    }
    return { title, size: size3d, data };
  }

  if (size1d >= 2 && triplets.length >= size1d * 3) {
    // Promote 1D LUT cleanly to a 17^3 3D LUT so one fast trilinear path serves both.
    const sample1d = (v: number, ch: 0 | 1 | 2) => {
      const f = clamp01(v) * (size1d - 1);
      const i0 = Math.floor(f);
      const i1 = Math.min(size1d - 1, i0 + 1);
      const raw0 = (triplets[i0 * 3 + ch] - domMin[ch]) / (ch === 0 ? spanR : ch === 1 ? spanG : spanB);
      const raw1 = (triplets[i1 * 3 + ch] - domMin[ch]) / (ch === 0 ? spanR : ch === 1 ? spanG : spanB);
      return clamp01(mix(raw0, raw1, f - i0));
    };
    const size = 17;
    const data = buildCube("tmp", title, size, (r, g, b) => [sample1d(r, 0), sample1d(g, 1), sample1d(b, 2)]).data;
    return { title, size, data };
  }

  throw new Error("Unsupported or incomplete .cube LUT file.");
}

export function importPhotoCubeFile(fileName: string, text: string): PhotoLut {
  const base = fileName.replace(/\.[^.]+$/, "").trim() || "Custom LUT";
  const parsed = parseCubeText(text, base);
  const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "lut";
  const id = `custom-${slug}-${Date.now().toString(36)}`;
  const entry: PhotoLut = {
    id,
    label: parsed.title || base,
    size: parsed.size,
    data: parsed.data,
    custom: true,
  };
  luts = [...luts, entry];
  snapshot = luts;
  listeners.forEach((fn) => fn());
  return entry;
}

/** Apply a 3D LUT with trilinear interpolation and return a new ImageData buffer. */
export function apply3dLut(img: ImageData, lutId: string, intensity: number): ImageData {
  const out = new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
  const k = clamp01(intensity);
  if (k <= 0) return out;
  const entry = getPhotoLut(lutId);
  if (!entry) return out;

  const { size, data: table } = entry;
  const maxIdx = size - 1;
  const rowStride = size * 3;
  const sliceStride = size * size * 3;
  const d = out.data;

  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const rIn = d[i] / 255;
    const gIn = d[i + 1] / 255;
    const bIn = d[i + 2] / 255;

    const rf = rIn * maxIdx;
    const gf = gIn * maxIdx;
    const bf = bIn * maxIdx;

    const r0 = rf >= maxIdx ? maxIdx : rf | 0;
    const g0 = gf >= maxIdx ? maxIdx : gf | 0;
    const b0 = bf >= maxIdx ? maxIdx : bf | 0;
    const r1 = r0 < maxIdx ? r0 + 1 : r0;
    const g1 = g0 < maxIdx ? g0 + 1 : g0;
    const b1 = b0 < maxIdx ? b0 + 1 : b0;

    const dr = rf - r0;
    const dg = gf - g0;
    const db = bf - b0;

    const i000 = b0 * sliceStride + g0 * rowStride + r0 * 3;
    const i100 = b0 * sliceStride + g0 * rowStride + r1 * 3;
    const i010 = b0 * sliceStride + g1 * rowStride + r0 * 3;
    const i110 = b0 * sliceStride + g1 * rowStride + r1 * 3;
    const i001 = b1 * sliceStride + g0 * rowStride + r0 * 3;
    const i101 = b1 * sliceStride + g0 * rowStride + r1 * 3;
    const i011 = b1 * sliceStride + g1 * rowStride + r0 * 3;
    const i111 = b1 * sliceStride + g1 * rowStride + r1 * 3;

    const r000 = table[i000], r100 = table[i100], r010 = table[i010], r110 = table[i110];
    const r001 = table[i001], r101 = table[i101], r011 = table[i011], r111 = table[i111];
    const rLut = mix(mix(mix(r000, r100, dr), mix(r010, r110, dr), dg), mix(mix(r001, r101, dr), mix(r011, r111, dr), dg), db);

    const g000 = table[i000 + 1], g100 = table[i100 + 1], g010 = table[i010 + 1], g110 = table[i110 + 1];
    const g001 = table[i001 + 1], g101 = table[i101 + 1], g011 = table[i011 + 1], g111 = table[i111 + 1];
    const gLut = mix(mix(mix(g000, g100, dr), mix(g010, g110, dr), dg), mix(mix(g001, g101, dr), mix(g011, g111, dr), dg), db);

    const b000 = table[i000 + 2], b100 = table[i100 + 2], b010 = table[i010 + 2], b110 = table[i110 + 2];
    const b001 = table[i001 + 2], b101 = table[i101 + 2], b011 = table[i011 + 2], b111 = table[i111 + 2];
    const bLut = mix(mix(mix(b000, b100, dr), mix(b010, b110, dr), dg), mix(mix(b001, b101, dr), mix(b011, b111, dr), dg), db);

    d[i] = Math.round(clamp01(mix(rIn, rLut, k)) * 255);
    d[i + 1] = Math.round(clamp01(mix(gIn, gLut, k)) * 255);
    d[i + 2] = Math.round(clamp01(mix(bIn, bLut, k)) * 255);
  }
  return out;
}
