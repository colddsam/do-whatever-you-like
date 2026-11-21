import { hexToRgb } from "./doc";
import { apply3dLut } from "./luts";
import {
  applyLut,
  blurImage,
  clamp255,
  copyImage,
  curveLut,
  histogram,
  hslToRgb,
  levelsLut,
  lut,
  luma,
  num,
  rgbToHsl,
  type Op,
} from "./ops";

/*
 * Image > Adjustments. Everything here is per-pixel (except Shadows/Highlights and Camera Raw's
 * clarity, which look at neighbours), so most can also live as adjustment layers.
 */

type Curves = Record<"rgb" | "r" | "g" | "b", [number, number][]>;
type Levels = { channel: "rgb" | "r" | "g" | "b"; inLo: number; inHi: number; gamma: number; outLo: number; outHi: number };

const ID = lut((v) => v);

/** Stretch each channel so its darkest 0.1% is black and brightest is white. */
function autoLevels(img: ImageData, perChannel: boolean) {
  const h = histogram(img);
  const total = h.l.reduce((a, b) => a + b, 0) || 1;
  const ends = (hist: Uint32Array) => {
    const cut = total * 0.001;
    let lo = 0;
    let hi = 255;
    for (let s = 0; lo < 255 && (s += hist[lo]) <= cut; ) lo++;
    for (let s = 0; hi > 0 && (s += hist[hi]) <= cut; ) hi--;
    return hi > lo ? lut((v) => ((v - lo) * 255) / (hi - lo)) : ID;
  };
  if (perChannel) applyLut(img, ends(h.r), ends(h.g), ends(h.b));
  else applyLut(img, ends(h.l));
}

export const ADJUSTMENTS: Op[] = [
  {
    id: "camera-raw",
    label: "Camera Raw",
    group: "Basic",
    hint: "Every everyday fix in one place: light, colour, detail and effects.",
    params: [
      { type: "range", key: "exposure", label: "Exposure", min: -100, max: 100, def: 0 },
      { type: "range", key: "contrast", label: "Contrast", min: -100, max: 100, def: 0 },
      { type: "range", key: "highlights", label: "Highlights", min: -100, max: 100, def: 0 },
      { type: "range", key: "shadows", label: "Shadows", min: -100, max: 100, def: 0 },
      { type: "range", key: "whites", label: "Whites", min: -100, max: 100, def: 0 },
      { type: "range", key: "blacks", label: "Blacks", min: -100, max: 100, def: 0 },
      { type: "range", key: "temp", label: "Temperature", min: -100, max: 100, def: 0 },
      { type: "range", key: "tint", label: "Tint", min: -100, max: 100, def: 0 },
      { type: "range", key: "vibrance", label: "Vibrance", min: -100, max: 100, def: 0 },
      { type: "range", key: "saturation", label: "Saturation", min: -100, max: 100, def: 0 },
      { type: "range", key: "texture", label: "Texture", min: -100, max: 100, def: 0 },
      { type: "range", key: "clarity", label: "Clarity", min: -100, max: 100, def: 0 },
      { type: "range", key: "dehaze", label: "Dehaze", min: -100, max: 100, def: 0 },
      { type: "range", key: "vignette", label: "Vignette", min: -100, max: 100, def: 0 },
      { type: "range", key: "grain", label: "Grain", min: 0, max: 100, def: 0 },
    ],
    apply(img, p, ctx) {
      const ex = Math.pow(2, num(p, "exposure") / 50);
      const con = num(p, "contrast") / 100;
      const hi = num(p, "highlights") / 100;
      const sh = num(p, "shadows") / 100;
      const wh = num(p, "whites") / 100;
      const bl = num(p, "blacks") / 100;
      const temp = num(p, "temp") * 0.5;
      const tint = num(p, "tint") * 0.5;
      const vib = num(p, "vibrance") / 100;
      const sat = 1 + num(p, "saturation") / 100;
      const clarity = num(p, "clarity") / 100;
      const { width: w, height: h, data: d } = img;
      // Tone curve: exposure, contrast around the middle, then the four zones.
      const tone = lut((v) => {
        let t = (v / 255) * ex;
        t = (t - 0.5) * (1 + con * (con > 0 ? 1 : 0.7)) + 0.5;
        const hiW = Math.max(0, (t - 0.5) * 2);
        const shW = Math.max(0, (0.5 - t) * 2);
        t += hi * 0.25 * hiW * hiW;
        t += sh * 0.25 * shW * shW;
        t += wh * 0.12 * Math.pow(Math.max(0, t), 3);
        t += bl * 0.12 * Math.pow(Math.max(0, 1 - t), 3);
        return t * 255;
      });
      const texture = num(p, "texture") / 100;
      const dehaze = num(p, "dehaze") / 100;
      let fine: Uint8ClampedArray | null = null;
      if (texture) {
        // Texture works on fine detail (a few pixels), clarity on broader local contrast.
        const b = copyImage(img);
        blurImage(b, Math.max(1, 3 * ctx.scale));
        fine = b.data;
      }
      let blurred: Uint8ClampedArray | null = null;
      if (clarity) {
        const b = copyImage(img);
        // A 25 px neighbourhood in the real picture, scaled for previews.
        blurImage(b, Math.max(1.5, 25 * ctx.scale));
        blurred = b.data;
      }
      for (let i = 0; i < d.length; i += 4) {
        let r = d[i];
        let g = d[i + 1];
        let b = d[i + 2];
        if (dehaze) {
          // Lifts (or adds) a bright, low-contrast haze: pull values away from a light airlight.
          const k = dehaze * 0.35;
          const A = 235;
          r = (r - A * k) / (1 - k);
          g = (g - A * k) / (1 - k);
          b = (b - A * k) / (1 - k);
        }
        if (fine) {
          const k = texture * 1.2;
          r += (d[i] - fine[i]) * k;
          g += (d[i + 1] - fine[i + 1]) * k;
          b += (d[i + 2] - fine[i + 2]) * k;
        }
        if (blurred) {
          // Local contrast in the midtones only, like Lightroom's clarity.
          const l = luma(r, g, b) / 255;
          const k = clarity * 0.9 * (1 - Math.abs(l - 0.5) * 2);
          r += (r - blurred[i]) * k;
          g += (g - blurred[i + 1]) * k;
          b += (b - blurred[i + 2]) * k;
        }
        r = tone[clamp255(Math.round(r))] + temp;
        g = tone[clamp255(Math.round(g))] - tint * 0.6;
        b = tone[clamp255(Math.round(b))] - temp;
        r += tint * 0.3;
        b += tint * 0.3;
        const l = luma(r, g, b);
        const mx = Math.max(r, g, b);
        const mn = Math.min(r, g, b);
        const s0 = mx ? (mx - mn) / mx : 0;
        // Vibrance boosts dull colours more than vivid ones.
        const k = sat * (1 + vib * (1 - s0));
        d[i] = clamp255(l + (r - l) * k);
        d[i + 1] = clamp255(l + (g - l) * k);
        d[i + 2] = clamp255(l + (b - l) * k);
      }
      const vig = num(p, "vignette") / 100;
      const grain = num(p, "grain") / 100;
      if (vig || grain) {
        const cx = w / 2;
        const cy = h / 2;
        const maxD = Math.hypot(cx, cy);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            let f = 1;
            if (vig) {
              const t = Math.hypot(x - cx, y - cy) / maxD;
              const fall = Math.max(0, (t - 0.35) / 0.65);
              f = 1 - vig * fall * fall * 0.85;
            }
            const n = grain ? (Math.random() - 0.5) * grain * 60 : 0;
            d[i] = clamp255(d[i] * f + n);
            d[i + 1] = clamp255(d[i + 1] * f + n);
            d[i + 2] = clamp255(d[i + 2] * f + n);
          }
        }
      }
    },
  },
  {
    id: "color-mixer",
    label: "Color Mixer (HSL)",
    group: "Colour",
    layerable: true,
    hint: "Lightroom's HSL panel: change the hue, saturation and brightness of one colour family at a time.",
    params: [
      { type: "choice", key: "color", label: "Colour", def: "red", options: [{"value": "red", "label": "Red"}, {"value": "orange", "label": "Orange"}, {"value": "yellow", "label": "Yellow"}, {"value": "green", "label": "Green"}, {"value": "aqua", "label": "Aqua"}, {"value": "blue", "label": "Blue"}, {"value": "purple", "label": "Purple"}, {"value": "magenta", "label": "Magenta"}] },
      { type: "range", key: "h_red", label: "Hue", min: -100, max: 100, def: 0, when: ["color", "red"] },
      { type: "range", key: "s_red", label: "Saturation", min: -100, max: 100, def: 0, when: ["color", "red"] },
      { type: "range", key: "l_red", label: "Luminance", min: -100, max: 100, def: 0, when: ["color", "red"] },
      { type: "range", key: "h_orange", label: "Hue", min: -100, max: 100, def: 0, when: ["color", "orange"] },
      { type: "range", key: "s_orange", label: "Saturation", min: -100, max: 100, def: 0, when: ["color", "orange"] },
      { type: "range", key: "l_orange", label: "Luminance", min: -100, max: 100, def: 0, when: ["color", "orange"] },
      { type: "range", key: "h_yellow", label: "Hue", min: -100, max: 100, def: 0, when: ["color", "yellow"] },
      { type: "range", key: "s_yellow", label: "Saturation", min: -100, max: 100, def: 0, when: ["color", "yellow"] },
      { type: "range", key: "l_yellow", label: "Luminance", min: -100, max: 100, def: 0, when: ["color", "yellow"] },
      { type: "range", key: "h_green", label: "Hue", min: -100, max: 100, def: 0, when: ["color", "green"] },
      { type: "range", key: "s_green", label: "Saturation", min: -100, max: 100, def: 0, when: ["color", "green"] },
      { type: "range", key: "l_green", label: "Luminance", min: -100, max: 100, def: 0, when: ["color", "green"] },
      { type: "range", key: "h_aqua", label: "Hue", min: -100, max: 100, def: 0, when: ["color", "aqua"] },
      { type: "range", key: "s_aqua", label: "Saturation", min: -100, max: 100, def: 0, when: ["color", "aqua"] },
      { type: "range", key: "l_aqua", label: "Luminance", min: -100, max: 100, def: 0, when: ["color", "aqua"] },
      { type: "range", key: "h_blue", label: "Hue", min: -100, max: 100, def: 0, when: ["color", "blue"] },
      { type: "range", key: "s_blue", label: "Saturation", min: -100, max: 100, def: 0, when: ["color", "blue"] },
      { type: "range", key: "l_blue", label: "Luminance", min: -100, max: 100, def: 0, when: ["color", "blue"] },
      { type: "range", key: "h_purple", label: "Hue", min: -100, max: 100, def: 0, when: ["color", "purple"] },
      { type: "range", key: "s_purple", label: "Saturation", min: -100, max: 100, def: 0, when: ["color", "purple"] },
      { type: "range", key: "l_purple", label: "Luminance", min: -100, max: 100, def: 0, when: ["color", "purple"] },
      { type: "range", key: "h_magenta", label: "Hue", min: -100, max: 100, def: 0, when: ["color", "magenta"] },
      { type: "range", key: "s_magenta", label: "Saturation", min: -100, max: 100, def: 0, when: ["color", "magenta"] },
      { type: "range", key: "l_magenta", label: "Luminance", min: -100, max: 100, def: 0, when: ["color", "magenta"] },
    ],
    apply(img, p) {
      const centres = [0, 30, 60, 120, 180, 225, 270, 315];
      const names = ["red", "orange", "yellow", "green", "aqua", "blue", "purple", "magenta"];
      const adj = names.map((n) => [num(p, `h_${n}`), num(p, `s_${n}`), num(p, `l_${n}`)]);
      if (adj.every((a) => !a[0] && !a[1] && !a[2])) return;
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const [h, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
        if (s < 0.02) continue;
        const deg = h * 360;
        let dh = 0;
        let ds = 0;
        let dl = 0;
        let wsum = 0;
        for (let c = 0; c < 8; c++) {
          let dist = Math.abs(deg - centres[c]);
          dist = Math.min(dist, 360 - dist);
          const w = Math.max(0, 1 - dist / 40);
          if (!w) continue;
          dh += adj[c][0] * w;
          ds += adj[c][1] * w;
          dl += adj[c][2] * w;
          wsum += w;
        }
        if (!wsum) continue;
        const k = Math.min(1, s * 4);
        // ±100 on the slider is ±30° of hue, faded out for nearly grey pixels.
        const nh = (((h + (dh / wsum / 100) * (30 / 360) * k) % 1) + 1) % 1;
        const sd = (ds / wsum / 100) * k;
        const ns = Math.max(0, Math.min(1, sd > 0 ? s + (1 - s) * sd : s * (1 + sd)));
        const nl = Math.max(0, Math.min(1, l + (dl / wsum / 100) * 0.35 * k));
        const [r, g, b] = hslToRgb(nh, ns, nl);
        d[i] = r;
        d[i + 1] = g;
        d[i + 2] = b;
      }
    },
  },
  {
    id: "color-grading",
    label: "Color Grading",
    group: "Colour",
    layerable: true,
    hint: "Tint the shadows, midtones and highlights separately (split toning), like Lightroom.",
    params: [
      { type: "range", key: "sh", label: "Shadows hue", min: 0, max: 360, def: 210, unit: "°", bump: ["ss", 30] },
      { type: "range", key: "ss", label: "Shadows saturation", min: 0, max: 100, def: 0 },
      { type: "range", key: "mh", label: "Midtones hue", min: 0, max: 360, def: 40, unit: "°", bump: ["ms", 30] },
      { type: "range", key: "ms", label: "Midtones saturation", min: 0, max: 100, def: 0 },
      { type: "range", key: "hh", label: "Highlights hue", min: 0, max: 360, def: 45, unit: "°", bump: ["hs", 30] },
      { type: "range", key: "hs", label: "Highlights saturation", min: 0, max: 100, def: 0 },
      { type: "range", key: "balance", label: "Balance", min: -100, max: 100, def: 0 },
    ],
    apply(img, p) {
      const tint = (hue: number, sat: number) => {
        const [r, g, b] = hslToRgb(hue / 360, 1, 0.5);
        return [(r - 128) * (sat / 100) * 0.6, (g - 128) * (sat / 100) * 0.6, (b - 128) * (sat / 100) * 0.6];
      };
      const S = tint(num(p, "sh"), num(p, "ss"));
      const M = tint(num(p, "mh"), num(p, "ms"));
      const H = tint(num(p, "hh"), num(p, "hs"));
      const bal = num(p, "balance") / 200;
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const l = luma(d[i], d[i + 1], d[i + 2]) / 255;
        const t = Math.min(1, Math.max(0, l - bal));
        const ws = Math.pow(1 - t, 2);
        const wh = Math.pow(t, 2);
        const wm = Math.max(0, 1 - ws - wh);
        for (let c = 0; c < 3; c++) d[i + c] = clamp255(d[i + c] + S[c] * ws + M[c] * wm + H[c] * wh);
      }
    },
  },
  {
    id: "brightness-contrast",
    label: "Brightness/Contrast",
    group: "Basic",
    layerable: true,
    params: [
      { type: "range", key: "brightness", label: "Brightness", min: -150, max: 150, def: 0 },
      { type: "range", key: "contrast", label: "Contrast", min: -100, max: 100, def: 0 },
    ],
    apply(img, p) {
      const br = num(p, "brightness");
      const c = num(p, "contrast") * 1.27;
      const f = (259 * (c + 255)) / (255 * (259 - c));
      applyLut(img, lut((v) => f * (v + br * 0.6 - 128) + 128));
    },
  },
  {
    id: "levels",
    label: "Levels",
    group: "Basic",
    layerable: true,
    hint: "Drag the black, grey and white points under the histogram.",
    params: [{ type: "levels", key: "levels", label: "Levels" }],
    apply(img, p) {
      const l = p.levels as Levels;
      const t = levelsLut(l);
      if (l.channel === "rgb") applyLut(img, t);
      else applyLut(img, l.channel === "r" ? t : ID, l.channel === "g" ? t : ID, l.channel === "b" ? t : ID);
    },
  },
  {
    id: "curves",
    label: "Curves",
    group: "Basic",
    layerable: true,
    hint: "Click the line to add a point, drag to bend, double-click a point to remove it.",
    params: [{ type: "curve", key: "curves", label: "Curves" }],
    apply(img, p) {
      const c = p.curves as Curves;
      const m = curveLut(c.rgb);
      const r = curveLut(c.r);
      const g = curveLut(c.g);
      const b = curveLut(c.b);
      applyLut(img, lut((v) => r[m[v]]), lut((v) => g[m[v]]), lut((v) => b[m[v]]));
    },
  },
  {
    id: "exposure",
    label: "Exposure",
    group: "Basic",
    layerable: true,
    params: [
      { type: "range", key: "exposure", label: "Exposure", min: -5, max: 5, step: 0.05, def: 0, unit: " EV" },
      { type: "range", key: "offset", label: "Offset", min: -0.5, max: 0.5, step: 0.01, def: 0 },
      { type: "range", key: "gamma", label: "Gamma", min: 0.1, max: 3, step: 0.01, def: 1 },
    ],
    apply(img, p) {
      const e = Math.pow(2, num(p, "exposure"));
      const o = num(p, "offset");
      const gm = num(p, "gamma");
      applyLut(img, lut((v) => Math.pow(Math.max(0, (v / 255) * e + o), 1 / gm) * 255));
    },
  },
  {
    id: "vibrance",
    label: "Vibrance",
    group: "Colour",
    layerable: true,
    params: [
      { type: "range", key: "vibrance", label: "Vibrance", min: -100, max: 100, def: 0 },
      { type: "range", key: "saturation", label: "Saturation", min: -100, max: 100, def: 0 },
    ],
    apply(img, p) {
      const vib = num(p, "vibrance") / 100;
      const sat = 1 + num(p, "saturation") / 100;
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i];
        const g = d[i + 1];
        const b = d[i + 2];
        const l = luma(r, g, b);
        const mx = Math.max(r, g, b);
        const s0 = mx ? (mx - Math.min(r, g, b)) / mx : 0;
        const k = sat * (1 + vib * (1 - s0) * 1.2);
        d[i] = clamp255(l + (r - l) * k);
        d[i + 1] = clamp255(l + (g - l) * k);
        d[i + 2] = clamp255(l + (b - l) * k);
      }
    },
  },
  {
    id: "hue-saturation",
    label: "Hue/Saturation",
    group: "Colour",
    layerable: true,
    params: [
      { type: "range", key: "hue", label: "Hue", min: -180, max: 180, def: 0, unit: "°" },
      { type: "range", key: "saturation", label: "Saturation", min: -100, max: 100, def: 0 },
      { type: "range", key: "lightness", label: "Lightness", min: -100, max: 100, def: 0 },
      { type: "toggle", key: "colorize", label: "Colorize", def: false },
    ],
    apply(img, p) {
      const dh = num(p, "hue") / 360;
      const ds = num(p, "saturation") / 100;
      const dl = num(p, "lightness") / 100;
      const colorize = Boolean(p.colorize);
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        let [h, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
        if (colorize) {
          h = (((dh % 1) + 1) % 1);
          s = Math.max(0, Math.min(1, 0.25 + ds * 0.75));
        } else {
          h = (((h + dh) % 1) + 1) % 1;
          s = ds > 0 ? s + (1 - s) * ds * s : s * (1 + ds);
        }
        l = dl > 0 ? l + (1 - l) * dl : l * (1 + dl);
        const [r, g, b] = hslToRgb(h, Math.max(0, Math.min(1, s)), Math.max(0, Math.min(1, l)));
        d[i] = r;
        d[i + 1] = g;
        d[i + 2] = b;
      }
    },
  },
  {
    id: "color-balance",
    label: "Color Balance",
    group: "Colour",
    layerable: true,
    params: [
      { type: "choice", key: "tone", label: "Tones", def: "midtones", options: [{ value: "shadows", label: "Shadows" }, { value: "midtones", label: "Midtones" }, { value: "highlights", label: "Highlights" }] },
      { type: "range", key: "cr", label: "Cyan ↔ Red", min: -100, max: 100, def: 0 },
      { type: "range", key: "mg", label: "Magenta ↔ Green", min: -100, max: 100, def: 0 },
      { type: "range", key: "yb", label: "Yellow ↔ Blue", min: -100, max: 100, def: 0 },
      { type: "toggle", key: "preserve", label: "Preserve luminosity", def: true },
    ],
    apply(img, p) {
      const tone = p.tone as string;
      const cr = num(p, "cr") * 0.5;
      const mg = num(p, "mg") * 0.5;
      const yb = num(p, "yb") * 0.5;
      const keep = Boolean(p.preserve);
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const l0 = luma(d[i], d[i + 1], d[i + 2]);
        const t = l0 / 255;
        const wgt = tone === "shadows" ? Math.max(0, 1 - t * 2.2) : tone === "highlights" ? Math.max(0, t * 2.2 - 1.2) : 1 - Math.abs(t - 0.5) * 2;
        let r = d[i] + cr * wgt;
        let g = d[i + 1] + mg * wgt;
        let b = d[i + 2] + yb * wgt;
        if (keep) {
          const dl = l0 - luma(r, g, b);
          r += dl;
          g += dl;
          b += dl;
        }
        d[i] = clamp255(r);
        d[i + 1] = clamp255(g);
        d[i + 2] = clamp255(b);
      }
    },
  },
  {
    id: "black-white",
    label: "Black & White",
    group: "Colour",
    layerable: true,
    params: [
      { type: "range", key: "reds", label: "Reds", min: -200, max: 300, def: 40 },
      { type: "range", key: "greens", label: "Greens", min: -200, max: 300, def: 40 },
      { type: "range", key: "blues", label: "Blues", min: -200, max: 300, def: 20 },
      { type: "toggle", key: "tint", label: "Tint", def: false },
      { type: "color", key: "tintColor", label: "Tint colour", def: "#c8a46e" },
    ],
    apply(img, p) {
      const wr = num(p, "reds") / 100;
      const wg = num(p, "greens") / 100;
      const wb = num(p, "blues") / 100;
      const sum = wr + wg + wb || 1;
      const [tr, tg, tb] = p.tint ? hexToRgb(p.tintColor as string) : [128, 128, 128];
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const v = clamp255((d[i] * wr + d[i + 1] * wg + d[i + 2] * wb) / sum);
        if (p.tint) {
          // Overlay-style tint: keeps black black and white white.
          const t = v / 255;
          d[i] = clamp255(v + (tr - 128) * 4 * t * (1 - t));
          d[i + 1] = clamp255(v + (tg - 128) * 4 * t * (1 - t));
          d[i + 2] = clamp255(v + (tb - 128) * 4 * t * (1 - t));
        } else d[i] = d[i + 1] = d[i + 2] = v;
      }
    },
  },
  {
    id: "photo-filter",
    label: "Photo Filter",
    group: "Colour",
    layerable: true,
    params: [
      { type: "color", key: "color", label: "Filter colour", def: "#ec8a00" },
      { type: "range", key: "density", label: "Density", min: 0, max: 100, def: 25, unit: "%" },
      { type: "toggle", key: "preserve", label: "Preserve luminosity", def: true },
    ],
    apply(img, p) {
      const [fr, fg, fb] = hexToRgb(p.color as string);
      const k = num(p, "density") / 100;
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const l0 = luma(d[i], d[i + 1], d[i + 2]);
        // Multiply-like colour filter, mixed in by density.
        let r = d[i] * (1 - k) + ((d[i] * fr) / 255) * k;
        let g = d[i + 1] * (1 - k) + ((d[i + 1] * fg) / 255) * k;
        let b = d[i + 2] * (1 - k) + ((d[i + 2] * fb) / 255) * k;
        if (p.preserve) {
          const dl = l0 - luma(r, g, b);
          r += dl;
          g += dl;
          b += dl;
        }
        d[i] = clamp255(r);
        d[i + 1] = clamp255(g);
        d[i + 2] = clamp255(b);
      }
    },
  },
  {
    id: "channel-mixer",
    label: "Channel Mixer",
    group: "Colour",
    layerable: true,
    params: [
      { type: "choice", key: "out", label: "Output channel", def: "r", options: [{ value: "r", label: "Red" }, { value: "g", label: "Green" }, { value: "b", label: "Blue" }] },
      { type: "range", key: "r", label: "Red", min: -200, max: 200, def: 100, unit: "%" },
      { type: "range", key: "g", label: "Green", min: -200, max: 200, def: 0, unit: "%" },
      { type: "range", key: "b", label: "Blue", min: -200, max: 200, def: 0, unit: "%" },
      { type: "toggle", key: "mono", label: "Monochrome", def: false },
    ],
    apply(img, p) {
      const o = p.out === "g" ? 1 : p.out === "b" ? 2 : 0;
      const kr = num(p, "r") / 100;
      const kg = num(p, "g") / 100;
      const kb = num(p, "b") / 100;
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const v = clamp255(d[i] * kr + d[i + 1] * kg + d[i + 2] * kb);
        if (p.mono) d[i] = d[i + 1] = d[i + 2] = v;
        else d[i + o] = v;
      }
    },
  },
  {
    id: "selective-color",
    label: "Selective Color",
    group: "Colour",
    layerable: true,
    hint: "Shift one family of colours without touching the rest.",
    params: [
      {
        type: "choice",
        key: "family",
        label: "Colours",
        def: "reds",
        options: ["reds", "yellows", "greens", "cyans", "blues", "magentas"].map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) })),
      },
      { type: "range", key: "hue", label: "Hue", min: -60, max: 60, def: 0, unit: "°" },
      { type: "range", key: "sat", label: "Saturation", min: -100, max: 100, def: 0 },
      { type: "range", key: "light", label: "Lightness", min: -100, max: 100, def: 0 },
    ],
    apply(img, p) {
      const centre = { reds: 0, yellows: 60, greens: 120, cyans: 180, blues: 240, magentas: 300 }[p.family as string] ?? 0;
      const dh = num(p, "hue") / 360;
      const ds = num(p, "sat") / 100;
      const dl = num(p, "light") / 100;
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const [h, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
        let dist = Math.abs(h * 360 - centre);
        dist = Math.min(dist, 360 - dist);
        const w = Math.max(0, 1 - dist / 45) * Math.min(1, s * 3);
        if (w <= 0) continue;
        const nh = (((h + dh * w) % 1) + 1) % 1;
        const ns = Math.max(0, Math.min(1, s * (1 + ds * w)));
        const nl = Math.max(0, Math.min(1, l + dl * w * 0.5));
        const [r, g, b] = hslToRgb(nh, ns, nl);
        d[i] = r;
        d[i + 1] = g;
        d[i + 2] = b;
      }
    },
  },
  {
    id: "gradient-map",
    label: "Gradient Map",
    group: "Colour",
    layerable: true,
    params: [
      { type: "color", key: "dark", label: "Shadows colour", def: "#1b1464" },
      { type: "color", key: "mid", label: "Midtones colour", def: "#e0457b" },
      { type: "color", key: "light", label: "Highlights colour", def: "#ffe29a" },
    ],
    apply(img, p) {
      const a = hexToRgb(p.dark as string);
      const m = hexToRgb(p.mid as string);
      const b = hexToRgb(p.light as string);
      const table = [0, 1, 2].map((c) =>
        lut((v) => {
          const t = v / 255;
          return t < 0.5 ? a[c] + (m[c] - a[c]) * t * 2 : m[c] + (b[c] - m[c]) * (t - 0.5) * 2;
        }),
      );
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const v = Math.round(luma(d[i], d[i + 1], d[i + 2]));
        d[i] = table[0][v];
        d[i + 1] = table[1][v];
        d[i + 2] = table[2][v];
      }
    },
  },
  {
    id: "shadows-highlights",
    label: "Shadows/Highlights",
    group: "Basic",
    hint: "Lifts dark areas and recovers bright ones, using the picture's local brightness.",
    params: [
      { type: "range", key: "shadows", label: "Shadows", min: 0, max: 100, def: 35, unit: "%" },
      { type: "range", key: "highlights", label: "Highlights", min: 0, max: 100, def: 0, unit: "%" },
      { type: "range", key: "radius", label: "Radius", min: 2, max: 200, def: 30, unit: " px", px: true },
    ],
    apply(img, p) {
      const mask = copyImage(img);
      blurImage(mask, num(p, "radius"));
      const s = num(p, "shadows") / 100;
      const hl = num(p, "highlights") / 100;
      const d = img.data;
      const m = mask.data;
      for (let i = 0; i < d.length; i += 4) {
        const local = luma(m[i], m[i + 1], m[i + 2]) / 255;
        const lift = s * Math.pow(1 - local, 2) * 0.9;
        const drop = hl * Math.pow(local, 2) * 0.7;
        for (let c = 0; c < 3; c++) {
          const v = d[i + c] / 255;
          d[i + c] = clamp255((v + (1 - v) * lift - v * drop) * 255);
        }
      }
    },
  },
  {
    id: "posterize",
    label: "Posterize",
    group: "Special",
    layerable: true,
    params: [{ type: "range", key: "levels", label: "Levels", min: 2, max: 32, def: 4 }],
    apply(img, p) {
      const n = Math.max(2, num(p, "levels"));
      applyLut(img, lut((v) => Math.round(Math.round((v / 255) * (n - 1)) * (255 / (n - 1)))));
    },
  },
  {
    id: "threshold",
    label: "Threshold",
    group: "Special",
    layerable: true,
    params: [{ type: "range", key: "level", label: "Threshold level", min: 1, max: 255, def: 128 }],
    apply(img, p) {
      const t = num(p, "level");
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = luma(d[i], d[i + 1], d[i + 2]) >= t ? 255 : 0;
    },
  },
  {
    id: "invert",
    label: "Invert",
    group: "Special",
    layerable: true,
    instant: true,
    params: [],
    apply(img) {
      applyLut(img, lut((v) => 255 - v));
    },
  },
  {
    id: "desaturate",
    label: "Desaturate",
    group: "Special",
    layerable: true,
    instant: true,
    params: [],
    apply(img) {
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = luma(d[i], d[i + 1], d[i + 2]);
    },
  },
  {
    id: "equalize",
    label: "Equalize",
    group: "Special",
    instant: true,
    params: [],
    apply(img) {
      const h = histogram(img).l;
      const total = h.reduce((a, b) => a + b, 0) || 1;
      const cdf = new Float64Array(256);
      let s = 0;
      for (let i = 0; i < 256; i++) cdf[i] = s += h[i];
      const t = lut((v) => (cdf[v] / total) * 255);
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const l = Math.round(luma(d[i], d[i + 1], d[i + 2]));
        const k = l ? t[l] / l : 1;
        d[i] = clamp255(d[i] * k);
        d[i + 1] = clamp255(d[i + 1] * k);
        d[i + 2] = clamp255(d[i + 2] * k);
      }
    },
  },
  { id: "auto-tone", label: "Auto Tone", group: "Auto", instant: true, params: [], apply: (img) => autoLevels(img, true) },
  { id: "auto-contrast", label: "Auto Contrast", group: "Auto", instant: true, params: [], apply: (img) => autoLevels(img, false) },
  {
    id: "auto-color",
    label: "Auto Color",
    group: "Auto",
    instant: true,
    params: [],
    apply(img) {
      // Grey-world white balance, then a gentle per-channel stretch.
      const d = img.data;
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 8) continue;
        r += d[i];
        g += d[i + 1];
        b += d[i + 2];
        n++;
      }
      if (!n) return;
      const avg = (r + g + b) / (3 * n);
      const kr = avg / (r / n || 1);
      const kg = avg / (g / n || 1);
      const kb = avg / (b / n || 1);
      applyLut(img, lut((v) => v * kr), lut((v) => v * kg), lut((v) => v * kb));
      autoLevels(img, false);
    },
  },
  {
    id: "cube-lut",
    label: "3D LUT (.cube)",
    group: "Colour",
    layerable: true,
    hint: "Apply built-in film LUTs or import your own Adobe .cube look.",
    params: [
      { type: "lut", key: "lutId", label: "Look-Up Table", def: "kodak-2383" },
      { type: "range", key: "intensity", label: "Intensity", min: 0, max: 100, def: 100, unit: "%" },
    ],
    apply(img, p) {
      const res = apply3dLut(img, String(p.lutId || "kodak-2383"), num(p, "intensity") / 100);
      img.data.set(res.data);
    },
  },
];

export const adjustmentById = (id: string) => ADJUSTMENTS.find((a) => a.id === id);
