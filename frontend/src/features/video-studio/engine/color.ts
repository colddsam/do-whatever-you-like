import type { Effect } from "../types";
import { evalAnim } from "../lib/keyframes";
import { EFFECTS } from "../constants";

/**
 * Colour-grading utilities shared by the GPU pipeline, colour panels, and .cube LUT exporter:
 * - Fritsch-Carlson monotone cubic Hermite splines for RGB Tone Curves (baked into a 256x1 RGBA LUT).
 * - 8-band HSL secondary colour mixer definitions and parsers.
 * - Full CPU evaluator for generating standard Adobe .cube 3D LUTs from any effect stack.
 */

export type CurvePoint = [number, number];
export type CurveChannel = "points" | "r" | "g" | "b";

export const IDENTITY_CURVE: CurvePoint[] = [
  [0, 0],
  [1, 1],
];

export const CURVE_PRESETS: { id: string; label: string; points: CurvePoint[]; r?: CurvePoint[]; b?: CurvePoint[] }[] = [
  { id: "linear", label: "Reset", points: [[0, 0], [1, 1]] },
  { id: "softS", label: "Soft S", points: [[0, 0], [0.25, 0.21], [0.75, 0.79], [1, 1]] },
  { id: "punch", label: "Punchy S", points: [[0, 0], [0.2, 0.13], [0.5, 0.5], [0.8, 0.87], [1, 1]] },
  { id: "matte", label: "Filmic matte", points: [[0, 0.08], [0.25, 0.24], [0.75, 0.78], [1, 0.94]] },
  { id: "fadedFilm", label: "Kodak print", points: [[0, 0.05], [0.3, 0.27], [0.75, 0.82], [1, 0.96]], r: [[0, 0.02], [0.75, 0.82], [1, 1]], b: [[0, 0.04], [0.5, 0.47], [1, 0.91]] },
  { id: "cross", label: "Cross process", points: [[0, 0], [0.25, 0.19], [0.75, 0.82], [1, 1]], r: [[0, 0], [0.4, 0.46], [1, 1]], b: [[0, 0.08], [0.5, 0.45], [1, 0.88]] },
];

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function parseCurvePoints(raw?: string): CurvePoint[] {
  if (!raw) return IDENTITY_CURVE;
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr) || arr.length < 2) return IDENTITY_CURVE;
    const pts = arr
      .filter((p): p is [number, number] => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]))
      .map(([x, y]): CurvePoint => [clamp01(x), clamp01(y)])
      .sort((a, b) => a[0] - b[0]);
    if (pts.length < 2) return IDENTITY_CURVE;
    // Deduplicate x values within 1e-4 to avoid division by zero in spline slopes.
    const clean: CurvePoint[] = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      if (pts[i][0] - clean[clean.length - 1][0] >= 1e-4) clean.push(pts[i]);
      else clean[clean.length - 1] = pts[i];
    }
    return clean.length >= 2 ? clean : IDENTITY_CURVE;
  } catch {
    return IDENTITY_CURVE;
  }
}

export function serializeCurvePoints(pts: CurvePoint[]): string {
  return JSON.stringify(pts.map(([x, y]) => [Number(clamp01(x).toFixed(4)), Number(clamp01(y).toFixed(4))]));
}

/** Fritsch-Carlson monotone piecewise cubic Hermite interpolation on [0, 1]. */
export function evalMonotoneSpline(pts: CurvePoint[], x: number): number {
  const n = pts.length;
  if (n === 0) return clamp01(x);
  if (n === 1) return clamp01(pts[0][1]);
  if (x <= pts[0][0]) return clamp01(pts[0][1]);
  if (x >= pts[n - 1][0]) return clamp01(pts[n - 1][1]);

  const dxs: number[] = [];
  const dys: number[] = [];
  const ms: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = Math.max(1e-5, pts[i + 1][0] - pts[i][0]);
    const dy = pts[i + 1][1] - pts[i][1];
    dxs.push(dx);
    dys.push(dy);
    ms.push(dy / dx);
  }
  const c1s: number[] = [ms[0]];
  for (let i = 0; i < dxs.length - 1; i++) {
    const m0 = ms[i];
    const m1 = ms[i + 1];
    if (m0 * m1 <= 0) c1s.push(0);
    else {
      const common = dxs[i] + dxs[i + 1];
      c1s.push((3 * common) / ((common + dxs[i + 1]) / m0 + (common + dxs[i]) / m1));
    }
  }
  c1s.push(ms[ms.length - 1]);

  let i = 0;
  while (i < n - 2 && x > pts[i + 1][0]) i++;
  const dx = dxs[i];
  const t = (x - pts[i][0]) / dx;
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  return clamp01(h00 * pts[i][1] + h10 * dx * c1s[i] + h01 * pts[i + 1][1] + h11 * dx * c1s[i + 1]);
}

/** Bakes Master + R + G + B spline curves into a 256-texel RGBA8 array ready for WebGL upload. */
export function bakeCurvesLut(masterRaw?: string, rRaw?: string, gRaw?: string, bRaw?: string): Uint8Array {
  const mPts = parseCurvePoints(masterRaw);
  const rPts = parseCurvePoints(rRaw);
  const gPts = parseCurvePoints(gRaw);
  const bPts = parseCurvePoints(bRaw);
  const out = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    const x = i / 255;
    const m = evalMonotoneSpline(mPts, x);
    out[i * 4 + 0] = Math.round(evalMonotoneSpline(rPts, m) * 255);
    out[i * 4 + 1] = Math.round(evalMonotoneSpline(gPts, m) * 255);
    out[i * 4 + 2] = Math.round(evalMonotoneSpline(bPts, m) * 255);
    out[i * 4 + 3] = 255;
  }
  return out;
}

/* ---------- 8-Band HSL Secondary Mixer ---------- */

export const HSL_BANDS = [
  { id: "red", label: "Red", hue: 0, color: "#ef4444" },
  { id: "orange", label: "Orange", hue: 30, color: "#f97316" },
  { id: "yellow", label: "Yellow", hue: 60, color: "#eab308" },
  { id: "green", label: "Green", hue: 120, color: "#22c55e" },
  { id: "aqua", label: "Aqua", hue: 180, color: "#06b6d4" },
  { id: "blue", label: "Blue", hue: 240, color: "#3b82f6" },
  { id: "purple", label: "Purple", hue: 275, color: "#a855f7" },
  { id: "magenta", label: "Magenta", hue: 320, color: "#ec4899" },
] as const;

export interface HslAdjustments {
  hue: number[];
  sat: number[];
  lum: number[];
}

function parseBandArray(raw?: string): number[] {
  const zeros = [0, 0, 0, 0, 0, 0, 0, 0];
  if (!raw) return zeros;
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return zeros;
    return zeros.map((_, i) => {
      const n = Number(arr[i] ?? 0);
      return Number.isFinite(n) ? Math.max(-1, Math.min(1, n)) : 0;
    });
  } catch {
    return zeros;
  }
}

export function parseHsl(options?: Record<string, string>): HslAdjustments {
  return {
    hue: parseBandArray(options?.hue),
    sat: parseBandArray(options?.sat),
    lum: parseBandArray(options?.lum),
  };
}

export function serializeHsl(adj: HslAdjustments): Record<string, string> {
  return {
    hue: JSON.stringify(adj.hue.map((v) => Number(v.toFixed(3)))),
    sat: JSON.stringify(adj.sat.map((v) => Number(v.toFixed(3)))),
    lum: JSON.stringify(adj.lum.map((v) => Number(v.toFixed(3)))),
  };
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const l = (max + min) * 0.5;
  let h = 0;
  let s = 0;
  if (d > 1e-5) {
    s = d / (1 - Math.abs(2 * l - 1) + 1e-5);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return [h, clamp01(s), clamp01(l)];
}

function hue2rgb(p: number, q: number, t: number): number {
  let u = t;
  if (u < 0) u += 1;
  if (u > 1) u -= 1;
  if (u < 1 / 6) return p + (q - p) * 6 * u;
  if (u < 1 / 2) return q;
  if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
  return p;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s <= 1e-5) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue2rgb(p, q, h + 1 / 3), hue2rgb(p, q, h), hue2rgb(p, q, h - 1 / 3)];
}

/**
 * Generates an Adobe .cube 3D LUT file from the active colour effects on a clip or adjustment layer.
 * Uses the same mathematical transforms as the GLSL shader so grades move seamlessly to Resolve or Premiere.
 */
export function exportGradeAsCube(effects: Effect[], title = "Studio Grade", size = 33, at = 0): string {
  const grade = effects.find((e) => e.enabled && e.type === "colorGrade");
  const wheels = effects.find((e) => e.enabled && e.type === "colorWheels");
  const curvesFx = effects.find((e) => e.enabled && e.type === "curves");
  const hslFx = effects.find((e) => e.enabled && e.type === "hsl");
  const duotone = effects.find((e) => e.enabled && e.type === "duotone");
  const posterize = effects.find((e) => e.enabled && e.type === "posterize");
  const invert = effects.find((e) => e.enabled && e.type === "invert");

  const gv = (fx: Effect | undefined, key: string) => {
    if (!fx) return 0;
    const def = EFFECTS[fx.type]?.params.find((p) => p.key === key)?.def ?? 0;
    const a = fx.params[key];
    return a ? evalAnim(a, at) : def;
  };

  const curvesTable = curvesFx ? bakeCurvesLut(curvesFx.options?.points, curvesFx.options?.r, curvesFx.options?.g, curvesFx.options?.b) : null;
  const curvesMix = curvesFx ? gv(curvesFx, "intensity") : 0;
  const hslAdj = hslFx ? parseHsl(hslFx.options) : null;
  const hslMix = hslFx ? gv(hslFx, "amount") : 0;

  const parseHex = (hex: string | undefined, def: [number, number, number]): [number, number, number] => {
    if (!hex) return def;
    const clean = hex.replace("#", "");
    const n = parseInt(clean.length === 3 ? clean.replace(/(.)/g, "$1$1") : clean, 16);
    if (!Number.isFinite(n)) return def;
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  };

  const duoDark = parseHex(duotone?.options?.dark, [0.11, 0.1, 0.31]);
  const duoLight = parseHex(duotone?.options?.light, [1, 0.6, 0.38]);
  const duoAmt = duotone ? gv(duotone, "amount") : 0;
  const postLevels = posterize ? Math.max(2, Math.round(gv(posterize, "levels"))) : 0;
  const invAmt = invert ? gv(invert, "amount") : 0;

  const lines: string[] = [
    `TITLE "${title.replace(/"/g, "'")}"`,
    `LUT_3D_SIZE ${size}`,
    "DOMAIN_MIN 0.0 0.0 0.0",
    "DOMAIN_MAX 1.0 1.0 1.0",
  ];

  const bandCenters = HSL_BANDS.map((b) => b.hue / 360);

  for (let bIdx = 0; bIdx < size; bIdx++) {
    for (let gIdx = 0; gIdx < size; gIdx++) {
      for (let rIdx = 0; rIdx < size; rIdx++) {
        let r = rIdx / (size - 1);
        let g = gIdx / (size - 1);
        let b = bIdx / (size - 1);

        if (grade) {
          const exp = Math.pow(2, gv(grade, "exposure"));
          const bri = gv(grade, "brightness");
          const con = gv(grade, "contrast");
          const hi = gv(grade, "highlights");
          const sh = gv(grade, "shadows");
          const wh = gv(grade, "whites");
          const bl = gv(grade, "blacks");
          const sat = gv(grade, "saturation");
          const vib = gv(grade, "vibrance");
          const fade = gv(grade, "fade");
          const temp = gv(grade, "temperature");
          const tint = gv(grade, "tint");
          const hue = gv(grade, "hue") / 360;

          r = r * exp + bri;
          g = g * exp + bri;
          b = b * exp + bri;
          r += temp * 0.12 - tint * 0.04;
          g += tint * 0.09;
          b += -temp * 0.12 - tint * 0.04;

          const cFac = 1 + con;
          r = (r - 0.5) * cFac + 0.5;
          g = (g - 0.5) * cFac + 0.5;
          b = (b - 0.5) * cFac + 0.5;

          const luma = clamp01(0.2126 * r + 0.7152 * g + 0.0722 * b);
          const sw = (1 - luma) * (1 - luma) * sh * 0.45;
          const hw = -(luma * luma) * -hi * 0.45;
          const blAdj = (1 - Math.min(1, luma * 3)) * bl * 0.28;
          const whAdj = Math.max(0, (luma - 0.65) / 0.35) * wh * 0.28;
          const tShift = sw + hw + blAdj + whAdj;
          r += tShift;
          g += tShift;
          b += tShift;

          if (fade > 0) {
            const lift = fade * 0.14;
            r = lift + r * (1 - lift * 0.5);
            g = lift + g * (1 - lift * 0.5);
            b = lift + b * (1 - lift * 0.5);
          }

          if (sat !== 0 || vib !== 0) {
            const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
            const cSat = Math.max(r, g, b) - Math.min(r, g, b);
            const sMul = Math.max(0, 1 + sat + vib * (1 - cSat) * 0.8);
            r = l + (r - l) * sMul;
            g = l + (g - l) * sMul;
            b = l + (b - l) * sMul;
          }
          if (Math.abs(hue) > 1e-4) {
            const [hh, ss, ll] = rgbToHsl(clamp01(r), clamp01(g), clamp01(b));
            [r, g, b] = hslToRgb((hh + hue + 1) % 1, ss, ll);
          }
        }

        if (wheels) {
          const lift = [gv(wheels, "liftR") + gv(wheels, "liftY"), gv(wheels, "liftG") + gv(wheels, "liftY"), gv(wheels, "liftB") + gv(wheels, "liftY")];
          const gamma = [gv(wheels, "gammaR") + gv(wheels, "gammaY"), gv(wheels, "gammaG") + gv(wheels, "gammaY"), gv(wheels, "gammaB") + gv(wheels, "gammaY")];
          const gain = [gv(wheels, "gainR") + gv(wheels, "gainY"), gv(wheels, "gainG") + gv(wheels, "gainY"), gv(wheels, "gainB") + gv(wheels, "gainY")];
          const c = [r, g, b].map((v, idx) => {
            const gained = v * (1 + gain[idx]);
            const lifted = gained + lift[idx] * (1 - clamp01(v));
            const pow = Math.pow(2, -gamma[idx] * 1.4);
            return Math.pow(Math.max(0, lifted), pow);
          });
          [r, g, b] = [c[0], c[1], c[2]];
        }

        if (curvesTable && curvesMix > 0) {
          const ri = Math.round(clamp01(r) * 255);
          const gi = Math.round(clamp01(g) * 255);
          const bi = Math.round(clamp01(b) * 255);
          const cr = curvesTable[ri * 4 + 0] / 255;
          const cg = curvesTable[gi * 4 + 1] / 255;
          const cb = curvesTable[bi * 4 + 2] / 255;
          r = r + (cr - r) * curvesMix;
          g = g + (cg - g) * curvesMix;
          b = b + (cb - b) * curvesMix;
        }

        if (hslAdj && hslMix > 0) {
          const [hh, ss, ll] = rgbToHsl(clamp01(r), clamp01(g), clamp01(b));
          let dh = 0;
          let ds = 0;
          let dl = 0;
          for (let i = 0; i < 8; i++) {
            let dist = Math.abs(hh - bandCenters[i]);
            if (dist > 0.5) dist = 1 - dist;
            const w = Math.max(0, 1 - dist / 0.14);
            if (w > 0) {
              const s = w * w * (3 - 2 * w);
              dh += hslAdj.hue[i] * s;
              ds += hslAdj.sat[i] * s;
              dl += hslAdj.lum[i] * s;
            }
          }
          const satWeight = clamp01(ss * 4);
          const [hr, hg, hb] = hslToRgb(
            (hh + (dh * 0.15 * hslMix) + 1) % 1,
            clamp01(ss * Math.max(0, 1 + ds * hslMix)),
            clamp01(ll + dl * 0.35 * hslMix * satWeight),
          );
          r = hr;
          g = hg;
          b = hb;
        }

        if (duoAmt > 0) {
          const l = clamp01(0.2126 * r + 0.7152 * g + 0.0722 * b);
          r = r + (duoDark[0] + (duoLight[0] - duoDark[0]) * l - r) * duoAmt;
          g = g + (duoDark[1] + (duoLight[1] - duoDark[1]) * l - g) * duoAmt;
          b = b + (duoDark[2] + (duoLight[2] - duoDark[2]) * l - b) * duoAmt;
        }

        if (postLevels >= 2) {
          const st = postLevels - 1;
          r = Math.round(clamp01(r) * st) / st;
          g = Math.round(clamp01(g) * st) / st;
          b = Math.round(clamp01(b) * st) / st;
        }

        if (invAmt > 0) {
          r = r + (1 - r - r) * invAmt;
          g = g + (1 - g - g) * invAmt;
          b = b + (1 - b - b) * invAmt;
        }

        lines.push(`${clamp01(r).toFixed(6)} ${clamp01(g).toFixed(6)} ${clamp01(b).toFixed(6)}`);
      }
    }
  }

  return lines.join("\n") + "\n";
}
