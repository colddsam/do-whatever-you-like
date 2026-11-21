import { hexToRgb } from "./doc";
import { blurImage, clamp255, copyImage, luma, num, sample, type Op } from "./ops";

/*
 * The Filter menu. Every filter works on the whole layer (previews run on a reduced copy), and
 * settings marked `px` are distances in the real picture, scaled down for previews.
 */

/** Runs a displacement: for each output pixel, where in the source to read from. */
function displace(img: ImageData, map: (x: number, y: number) => [number, number]) {
  const { width: w, height: h } = img;
  const src = new Uint8ClampedArray(img.data);
  const d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [sx, sy] = map(x, y);
    sample(src, w, h, sx, sy, d, (y * w + x) * 4);
  }
}

function convolve(img: ImageData, k: number[], divisor = 1, bias = 0, keepAlpha = true) {
  const { width: w, height: h } = img;
  const src = new Uint8ClampedArray(img.data);
  const d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4;
    for (let c = 0; c < 3; c++) {
      let s = 0;
      for (let ky = -1; ky <= 1; ky++) for (let kx = -1; kx <= 1; kx++) {
        const xx = Math.min(w - 1, Math.max(0, x + kx));
        const yy = Math.min(h - 1, Math.max(0, y + ky));
        s += src[(yy * w + xx) * 4 + c] * k[(ky + 1) * 3 + kx + 1];
      }
      d[o + c] = clamp255(s / divisor + bias);
    }
    if (!keepAlpha) d[o + 3] = 255;
  }
}

/** Smooth value noise for Render > Clouds. */
function makeNoise(seed: number) {
  const perm = new Uint8Array(512);
  const p = Array.from({ length: 256 }, (_, i) => i);
  let s = seed;
  for (let i = 255; i > 0; i--) {
    s = (s * 16807) % 2147483647;
    const j = s % (i + 1);
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const fade = (t: number) => t * t * (3 - 2 * t);
  const val = (x: number, y: number) => perm[(perm[x & 255] + y) & 511] / 255;
  return (x: number, y: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = fade(x - xi);
    const yf = fade(y - yi);
    const a = val(xi, yi) + (val(xi + 1, yi) - val(xi, yi)) * xf;
    const b = val(xi, yi + 1) + (val(xi + 1, yi + 1) - val(xi, yi + 1)) * xf;
    return a + (b - a) * yf;
  };
}

export const FILTERS: Op[] = [
  /* Effects (the one-tap looks of mobile editors) */
  {
    id: "glitch",
    label: "Glitch",
    group: "Effects",
    params: [
      { type: "range", key: "amount", label: "Shift", min: 0, max: 100, def: 40 },
      { type: "range", key: "slices", label: "Slices", min: 0, max: 60, def: 18 },
      { type: "range", key: "seed", label: "Variation", min: 1, max: 999, def: 11 },
    ],
    apply(img, p) {
      const { width: w, height: h } = img;
      const src = new Uint8ClampedArray(img.data);
      const d = img.data;
      const shift = Math.round((num(p, "amount") / 100) * w * 0.03);
      let seed = num(p, "seed");
      const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      // RGB split: red one way, blue the other.
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const o = (y * w + x) * 4;
          d[o] = src[(y * w + Math.min(w - 1, Math.max(0, x - shift))) * 4];
          d[o + 2] = src[(y * w + Math.min(w - 1, Math.max(0, x + shift))) * 4 + 2];
        }
      // Torn horizontal slices.
      const n = Math.round(num(p, "slices"));
      const copy = new Uint8ClampedArray(d);
      for (let k = 0; k < n; k++) {
        const y0 = Math.floor(rnd() * h);
        const sh = Math.max(1, Math.floor(rnd() * h * 0.04));
        const off = Math.round((rnd() - 0.5) * w * 0.12 * (num(p, "amount") / 100));
        for (let y = y0; y < Math.min(h, y0 + sh); y++)
          for (let x = 0; x < w; x++) {
            const sx = (((x - off) % w) + w) % w;
            for (let c = 0; c < 4; c++) d[(y * w + x) * 4 + c] = copy[(y * w + sx) * 4 + c];
          }
      }
    },
  },
  {
    id: "rgb-split",
    label: "RGB Split",
    group: "Effects",
    hint: "Chromatic aberration: colour fringes that grow towards the edges, like a cheap lens.",
    params: [{ type: "range", key: "amount", label: "Amount", min: 0, max: 40, def: 8, unit: " px", px: true }],
    apply(img, p) {
      const { width: w, height: h } = img;
      const src = new Uint8ClampedArray(img.data);
      const d = img.data;
      const a = num(p, "amount");
      const tmp = new Uint8ClampedArray(4);
      const cx = w / 2;
      const cy = h / 2;
      const R = Math.hypot(cx, cy);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const dx = (x - cx) / R;
          const dy = (y - cy) / R;
          const o = (y * w + x) * 4;
          sample(src, w, h, x + dx * a, y + dy * a, tmp, 0);
          d[o] = tmp[0];
          sample(src, w, h, x - dx * a, y - dy * a, tmp, 0);
          d[o + 2] = tmp[2];
        }
    },
  },
  {
    id: "sketch",
    label: "Pencil Sketch",
    group: "Effects",
    params: [
      { type: "range", key: "radius", label: "Stroke", min: 1, max: 30, def: 6, unit: " px", px: true },
      { type: "range", key: "dark", label: "Darkness", min: 0, max: 100, def: 50 },
    ],
    apply(img, p) {
      // Colour dodge of the grey picture with its blurred negative: the classic pencil sketch.
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = luma(d[i], d[i + 1], d[i + 2]);
      const inv = copyImage(img);
      for (let i = 0; i < inv.data.length; i += 4) inv.data[i] = inv.data[i + 1] = inv.data[i + 2] = 255 - inv.data[i];
      blurImage(inv, num(p, "radius"));
      const g = 1 + num(p, "dark") / 50;
      for (let i = 0; i < d.length; i += 4) {
        const b = d[i];
        const v = Math.min(255, (b * 255) / Math.max(1, 255 - inv.data[i]));
        d[i] = d[i + 1] = d[i + 2] = 255 * Math.pow(v / 255, g);
      }
    },
  },
  {
    id: "cartoon",
    label: "Cartoon",
    group: "Effects",
    params: [
      { type: "range", key: "smooth", label: "Smoothing", min: 1, max: 20, def: 4, unit: " px", px: true },
      { type: "range", key: "levels", label: "Colours", min: 3, max: 12, def: 6 },
      { type: "range", key: "edges", label: "Outlines", min: 0, max: 100, def: 60 },
    ],
    apply(img, p) {
      const { width: w, height: h } = img;
      const edgesSrc = new Uint8ClampedArray(img.data);
      blurImage(img, num(p, "smooth"));
      const n = Math.round(num(p, "levels"));
      const d = img.data;
      const q = (v: number) => Math.round(Math.round((v / 255) * (n - 1)) * (255 / (n - 1)));
      for (let i = 0; i < d.length; i += 4) {
        d[i] = q(d[i]);
        d[i + 1] = q(d[i + 1]);
        d[i + 2] = q(d[i + 2]);
      }
      const k = num(p, "edges") / 100;
      if (!k) return;
      const L = (x: number, y: number) => {
        const o = (Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))) * 4;
        return luma(edgesSrc[o], edgesSrc[o + 1], edgesSrc[o + 2]);
      };
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const e = Math.min(1, (Math.hypot(L(x + 1, y) - L(x - 1, y), L(x, y + 1) - L(x, y - 1)) / 90) * k * 1.5);
          if (e < 0.25) continue;
          const o = (y * w + x) * 4;
          for (let c = 0; c < 3; c++) d[o + c] *= 1 - e;
        }
    },
  },
  {
    id: "duotone",
    label: "Duotone",
    group: "Effects",
    params: [
      { type: "color", key: "dark", label: "Dark colour", def: "#1e1b4b" },
      { type: "color", key: "light", label: "Light colour", def: "#f472b6" },
      { type: "range", key: "contrast", label: "Contrast", min: -50, max: 100, def: 20 },
    ],
    apply(img, p) {
      const a = hexToRgb(p.dark as string);
      const b = hexToRgb(p.light as string);
      const c = 1 + num(p, "contrast") / 100;
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const t = Math.min(1, Math.max(0, (luma(d[i], d[i + 1], d[i + 2]) / 255 - 0.5) * c + 0.5));
        for (let k = 0; k < 3; k++) d[i + k] = a[k] + (b[k] - a[k]) * t;
      }
    },
  },
  {
    id: "neon",
    label: "Neon Edges",
    group: "Effects",
    params: [
      { type: "color", key: "color", label: "Glow colour", def: "#22d3ee" },
      { type: "range", key: "glow", label: "Glow", min: 0, max: 30, def: 6, unit: " px", px: true },
    ],
    apply(img, p) {
      const { width: w, height: h } = img;
      const src = new Uint8ClampedArray(img.data);
      const d = img.data;
      const [cr, cg, cb] = hexToRgb(p.color as string);
      const L = (x: number, y: number) => {
        const o = (Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))) * 4;
        return luma(src[o], src[o + 1], src[o + 2]);
      };
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const e = Math.min(1, Math.hypot(L(x + 1, y) - L(x - 1, y), L(x, y + 1) - L(x, y - 1)) / 60);
          const o = (y * w + x) * 4;
          d[o] = cr * e;
          d[o + 1] = cg * e;
          d[o + 2] = cb * e;
        }
      const glow = num(p, "glow");
      if (!glow) return;
      const g = copyImage(img);
      blurImage(g, glow);
      for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) d[i + k] = clamp255(d[i + k] + g.data[i + k] * 1.6);
    },
  },
  {
    id: "orton",
    label: "Dreamy Glow (Orton)",
    group: "Effects",
    params: [
      { type: "range", key: "amount", label: "Amount", min: 0, max: 100, def: 45 },
      { type: "range", key: "radius", label: "Softness", min: 2, max: 80, def: 18, unit: " px", px: true },
    ],
    apply(img, p) {
      const b = copyImage(img);
      blurImage(b, num(p, "radius"));
      const k = num(p, "amount") / 100;
      const d = img.data;
      for (let i = 0; i < d.length; i += 4)
        for (let c = 0; c < 3; c++) {
          // Screen the soft copy over the sharp one.
          const s = 255 - ((255 - d[i + c]) * (255 - b.data[i + c])) / 255;
          d[i + c] = d[i + c] + (s - d[i + c]) * k;
        }
    },
  },
  {
    id: "light-leak",
    label: "Light Leak",
    group: "Effects",
    params: [
      { type: "color", key: "color", label: "Colour", def: "#ff7a18" },
      { type: "range", key: "amount", label: "Amount", min: 0, max: 100, def: 55 },
      {
        type: "choice",
        key: "from",
        label: "From",
        def: "left",
        options: [
          { value: "left", label: "Left" },
          { value: "right", label: "Right" },
          { value: "top", label: "Top" },
        ],
      },
    ],
    apply(img, p) {
      const { width: w, height: h, data: d } = img;
      const [lr, lg, lb] = hexToRgb(p.color as string);
      const k = num(p, "amount") / 100;
      const from = p.from as string;
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const t = from === "left" ? 1 - x / w : from === "right" ? x / w : 1 - y / h;
          const a = Math.pow(Math.max(0, t), 2.2) * k;
          const o = (y * w + x) * 4;
          d[o] = 255 - ((255 - d[o]) * (255 - lr * a)) / 255;
          d[o + 1] = 255 - ((255 - d[o + 1]) * (255 - lg * a)) / 255;
          d[o + 2] = 255 - ((255 - d[o + 2]) * (255 - lb * a)) / 255;
        }
    },
  },
  {
    id: "pop-art",
    label: "Pop Art",
    group: "Effects",
    params: [{ type: "range", key: "levels", label: "Colours", min: 2, max: 6, def: 3 }],
    apply(img, p) {
      const n = Math.round(num(p, "levels"));
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const l = luma(d[i], d[i + 1], d[i + 2]);
        for (let c = 0; c < 3; c++) {
          // Push saturation hard, then flatten into a few bold levels.
          const v = clamp255(l + (d[i + c] - l) * 2.2);
          d[i + c] = Math.round(Math.round((v / 255) * (n - 1)) * (255 / (n - 1)));
        }
      }
    },
  },
  /* Blur */
  {
    id: "gaussian-blur",
    label: "Gaussian Blur",
    group: "Blur",
    params: [{ type: "range", key: "radius", label: "Radius", min: 0, max: 250, step: 0.5, def: 6, unit: " px", px: true }],
    apply: (img, p) => blurImage(img, num(p, "radius")),
  },
  {
    id: "motion-blur",
    label: "Motion Blur",
    group: "Blur",
    params: [
      { type: "range", key: "angle", label: "Angle", min: -180, max: 180, def: 0, unit: "°" },
      { type: "range", key: "distance", label: "Distance", min: 1, max: 400, def: 30, unit: " px", px: true },
    ],
    apply(img, p) {
      const { width: w, height: h } = img;
      const a = (num(p, "angle") * Math.PI) / 180;
      const dist = num(p, "distance");
      const steps = Math.max(2, Math.min(64, Math.round(dist)));
      const dx = Math.cos(a);
      const dy = -Math.sin(a);
      const src = new Uint8ClampedArray(img.data);
      const d = img.data;
      const tmp = new Uint8ClampedArray(4);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let r = 0, g = 0, b = 0, al = 0;
        for (let s = 0; s < steps; s++) {
          const t = (s / (steps - 1) - 0.5) * dist;
          sample(src, w, h, x + dx * t, y + dy * t, tmp, 0);
          const k = tmp[3] / 255;
          r += tmp[0] * k;
          g += tmp[1] * k;
          b += tmp[2] * k;
          al += tmp[3];
        }
        const o = (y * w + x) * 4;
        const k = al ? 255 / al : 0;
        d[o] = r * k;
        d[o + 1] = g * k;
        d[o + 2] = b * k;
        d[o + 3] = al / steps;
      }
    },
  },
  {
    id: "radial-blur",
    label: "Radial Blur",
    group: "Blur",
    params: [
      { type: "choice", key: "mode", label: "Method", def: "zoom", options: [{ value: "zoom", label: "Zoom" }, { value: "spin", label: "Spin" }] },
      { type: "range", key: "amount", label: "Amount", min: 1, max: 100, def: 20 },
      { type: "range", key: "cx", label: "Centre across", min: 0, max: 100, def: 50, unit: "%" },
      { type: "range", key: "cy", label: "Centre down", min: 0, max: 100, def: 50, unit: "%" },
    ],
    apply(img, p) {
      const { width: w, height: h } = img;
      const cx = (num(p, "cx") / 100) * w;
      const cy = (num(p, "cy") / 100) * h;
      const amt = num(p, "amount") / 100;
      const spin = p.mode === "spin";
      const steps = 24;
      const src = new Uint8ClampedArray(img.data);
      const d = img.data;
      const tmp = new Uint8ClampedArray(4);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let r = 0, g = 0, b = 0, al = 0;
        const vx = x - cx;
        const vy = y - cy;
        for (let s = 0; s < steps; s++) {
          const t = (s / (steps - 1)) * amt * 0.35;
          let sx: number, sy: number;
          if (spin) {
            const ang = t - amt * 0.175;
            sx = cx + vx * Math.cos(ang) - vy * Math.sin(ang);
            sy = cy + vx * Math.sin(ang) + vy * Math.cos(ang);
          } else {
            sx = cx + vx * (1 - t);
            sy = cy + vy * (1 - t);
          }
          sample(src, w, h, sx, sy, tmp, 0);
          r += tmp[0];
          g += tmp[1];
          b += tmp[2];
          al += tmp[3];
        }
        const o = (y * w + x) * 4;
        d[o] = r / steps;
        d[o + 1] = g / steps;
        d[o + 2] = b / steps;
        d[o + 3] = al / steps;
      }
    },
  },
  {
    id: "tilt-shift",
    label: "Tilt-Shift",
    group: "Blur",
    hint: "A sharp band with soft blur above and below: the miniature look.",
    params: [
      { type: "range", key: "centre", label: "Band position", min: 0, max: 100, def: 55, unit: "%" },
      { type: "range", key: "band", label: "Sharp band", min: 2, max: 80, def: 20, unit: "%" },
      { type: "range", key: "radius", label: "Blur", min: 1, max: 80, def: 14, unit: " px", px: true },
    ],
    apply(img, p) {
      const { width: w, height: h } = img;
      const blurred = copyImage(img);
      blurImage(blurred, num(p, "radius"));
      const c = (num(p, "centre") / 100) * h;
      const half = ((num(p, "band") / 100) * h) / 2;
      const fall = h * 0.15;
      const d = img.data;
      const b = blurred.data;
      for (let y = 0; y < h; y++) {
        const dist = Math.max(0, Math.abs(y - c) - half);
        const t = Math.min(1, dist / fall);
        if (!t) continue;
        for (let x = 0; x < w; x++) {
          const o = (y * w + x) * 4;
          for (let k = 0; k < 4; k++) d[o + k] = d[o + k] + (b[o + k] - d[o + k]) * t;
        }
      }
    },
  },
  /* Sharpen */
  {
    id: "unsharp-mask",
    label: "Unsharp Mask",
    group: "Sharpen",
    params: [
      { type: "range", key: "amount", label: "Amount", min: 1, max: 500, def: 100, unit: "%" },
      { type: "range", key: "radius", label: "Radius", min: 0.5, max: 50, step: 0.5, def: 2, unit: " px", px: true },
      { type: "range", key: "threshold", label: "Threshold", min: 0, max: 255, def: 2 },
    ],
    apply(img, p) {
      const b = copyImage(img);
      blurImage(b, Math.max(0.6, num(p, "radius")));
      const amt = num(p, "amount") / 100;
      const th = num(p, "threshold");
      const d = img.data;
      const s = b.data;
      for (let i = 0; i < d.length; i += 4) {
        for (let c = 0; c < 3; c++) {
          const diff = d[i + c] - s[i + c];
          if (Math.abs(diff) >= th) d[i + c] = clamp255(d[i + c] + diff * amt);
        }
      }
    },
  },
  { id: "sharpen", label: "Sharpen", group: "Sharpen", params: [], instant: true, apply: (img) => convolve(img, [0, -1, 0, -1, 5, -1, 0, -1, 0]) },
  {
    id: "high-pass",
    label: "High Pass",
    group: "Sharpen",
    hint: "Set the layer to Overlay afterwards for a crisp, clean sharpen.",
    params: [{ type: "range", key: "radius", label: "Radius", min: 0.5, max: 100, step: 0.5, def: 4, unit: " px", px: true }],
    apply(img, p) {
      const b = copyImage(img);
      blurImage(b, num(p, "radius"));
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) d[i + c] = clamp255(d[i + c] - b.data[i + c] + 128);
    },
  },
  /* Noise */
  {
    id: "add-noise",
    label: "Add Noise",
    group: "Noise",
    params: [
      { type: "range", key: "amount", label: "Amount", min: 0, max: 100, def: 12, unit: "%" },
      { type: "toggle", key: "mono", label: "Monochromatic", def: true },
    ],
    apply(img, p) {
      const a = num(p, "amount") * 2.55;
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        if (p.mono) {
          const n = (Math.random() - 0.5) * a;
          d[i] = clamp255(d[i] + n);
          d[i + 1] = clamp255(d[i + 1] + n);
          d[i + 2] = clamp255(d[i + 2] + n);
        } else for (let c = 0; c < 3; c++) d[i + c] = clamp255(d[i + c] + (Math.random() - 0.5) * a);
      }
    },
  },
  {
    id: "median",
    label: "Reduce Noise (Median)",
    group: "Noise",
    hint: "Also clears dust and scratches. Bigger radius = smoother.",
    params: [{ type: "range", key: "radius", label: "Radius", min: 1, max: 10, def: 2, unit: " px", px: true }],
    apply(img, p) {
      const r = Math.max(1, Math.round(num(p, "radius")));
      const { width: w, height: h } = img;
      const src = new Uint8ClampedArray(img.data);
      const d = img.data;
      const hist = new Uint32Array(256 * 3);
      const half = ((2 * r + 1) * (2 * r + 1)) / 2;
      for (let y = 0; y < h; y++) {
        hist.fill(0);
        // Huang's sliding histogram: add the new column, drop the old one.
        for (let yy = -r; yy <= r; yy++) for (let xx = -r; xx <= r; xx++) {
          const o = (Math.min(h - 1, Math.max(0, y + yy)) * w + Math.min(w - 1, Math.max(0, xx))) * 4;
          for (let c = 0; c < 3; c++) hist[c * 256 + src[o + c]]++;
        }
        for (let x = 0; x < w; x++) {
          if (x > 0) {
            for (let yy = -r; yy <= r; yy++) {
              const row = Math.min(h - 1, Math.max(0, y + yy)) * w;
              const out = (row + Math.max(0, x - r - 1)) * 4;
              const inn = (row + Math.min(w - 1, x + r)) * 4;
              for (let c = 0; c < 3; c++) {
                hist[c * 256 + src[out + c]]--;
                hist[c * 256 + src[inn + c]]++;
              }
            }
          }
          const o = (y * w + x) * 4;
          for (let c = 0; c < 3; c++) {
            let s = 0;
            let v = 0;
            while (v < 255 && (s += hist[c * 256 + v]) < half) v++;
            d[o + c] = v;
          }
        }
      }
    },
  },
  /* Pixelate */
  {
    id: "mosaic",
    label: "Mosaic",
    group: "Pixelate",
    params: [{ type: "range", key: "cell", label: "Cell size", min: 2, max: 200, def: 16, unit: " px", px: true }],
    apply(img, p) {
      const s = Math.max(1, Math.round(num(p, "cell")));
      const { width: w, height: h, data: d } = img;
      for (let by = 0; by < h; by += s) for (let bx = 0; bx < w; bx += s) {
        let r = 0, g = 0, b = 0, a = 0, n = 0;
        const ex = Math.min(w, bx + s);
        const ey = Math.min(h, by + s);
        for (let y = by; y < ey; y++) for (let x = bx; x < ex; x++) {
          const o = (y * w + x) * 4;
          r += d[o];
          g += d[o + 1];
          b += d[o + 2];
          a += d[o + 3];
          n++;
        }
        for (let y = by; y < ey; y++) for (let x = bx; x < ex; x++) {
          const o = (y * w + x) * 4;
          d[o] = r / n;
          d[o + 1] = g / n;
          d[o + 2] = b / n;
          d[o + 3] = a / n;
        }
      }
    },
  },
  {
    id: "halftone",
    label: "Color Halftone",
    group: "Pixelate",
    params: [{ type: "range", key: "cell", label: "Dot size", min: 3, max: 60, def: 8, unit: " px", px: true }],
    apply(img, p) {
      const s = Math.max(2, num(p, "cell"));
      const { width: w, height: h } = img;
      const src = new Uint8ClampedArray(img.data);
      const d = img.data;
      d.fill(255);
      for (let i = 3; i < d.length; i += 4) d[i] = src[i];
      for (let c = 0; c < 3; c++) {
        const ang = [0.26, 1.31, 0.79][c];
        const ca = Math.cos(ang);
        const sa = Math.sin(ang);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          // Rotate into the screen's grid, find this cell's centre and its ink amount.
          const u = x * ca + y * sa;
          const v = -x * sa + y * ca;
          const cu = (Math.floor(u / s) + 0.5) * s;
          const cv = (Math.floor(v / s) + 0.5) * s;
          const sx = Math.min(w - 1, Math.max(0, Math.round(cu * ca - cv * sa)));
          const sy = Math.min(h - 1, Math.max(0, Math.round(cu * sa + cv * ca)));
          const ink = 1 - src[(sy * w + sx) * 4 + c] / 255;
          const rad = Math.sqrt(ink) * s * 0.7;
          if (Math.hypot(u - cu, v - cv) < rad) d[(y * w + x) * 4 + c] = 0;
        }
      }
    },
  },
  /* Stylize */
  { id: "emboss", label: "Emboss", group: "Stylize", params: [], instant: true, apply: (img) => convolve(img, [-2, -1, 0, -1, 1, 1, 0, 1, 2], 1, 0) },
  {
    id: "find-edges",
    label: "Find Edges",
    group: "Stylize",
    params: [],
    instant: true,
    apply(img) {
      const { width: w, height: h } = img;
      const src = new Uint8ClampedArray(img.data);
      const d = img.data;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        for (let c = 0; c < 3; c++) {
          const at = (xx: number, yy: number) => src[(Math.min(h - 1, Math.max(0, yy)) * w + Math.min(w - 1, Math.max(0, xx))) * 4 + c];
          const gx = -at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1) + at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1);
          const gy = -at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1) + at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1);
          d[o + c] = 255 - clamp255(Math.hypot(gx, gy));
        }
      }
    },
  },
  {
    id: "oil-paint",
    label: "Oil Paint",
    group: "Stylize",
    params: [
      { type: "range", key: "radius", label: "Brush", min: 1, max: 10, def: 4, unit: " px", px: true },
      { type: "range", key: "levels", label: "Detail", min: 5, max: 40, def: 20 },
    ],
    apply(img, p) {
      const r = Math.max(1, Math.round(num(p, "radius")));
      const L = Math.round(num(p, "levels"));
      const { width: w, height: h } = img;
      const src = new Uint8ClampedArray(img.data);
      const d = img.data;
      const count = new Uint32Array(L);
      const sr = new Float64Array(L);
      const sg = new Float64Array(L);
      const sb = new Float64Array(L);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        count.fill(0);
        sr.fill(0);
        sg.fill(0);
        sb.fill(0);
        for (let yy = Math.max(0, y - r); yy <= Math.min(h - 1, y + r); yy++) for (let xx = Math.max(0, x - r); xx <= Math.min(w - 1, x + r); xx++) {
          const o = (yy * w + xx) * 4;
          const k = Math.min(L - 1, Math.floor((luma(src[o], src[o + 1], src[o + 2]) / 256) * L));
          count[k]++;
          sr[k] += src[o];
          sg[k] += src[o + 1];
          sb[k] += src[o + 2];
        }
        let best = 0;
        for (let k = 1; k < L; k++) if (count[k] > count[best]) best = k;
        const o = (y * w + x) * 4;
        d[o] = sr[best] / count[best];
        d[o + 1] = sg[best] / count[best];
        d[o + 2] = sb[best] / count[best];
      }
    },
  },
  {
    id: "solarize",
    label: "Solarize",
    group: "Stylize",
    params: [],
    instant: true,
    apply(img) {
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) if (d[i + c] > 127) d[i + c] = 255 - d[i + c];
    },
  },
  {
    id: "maximum",
    label: "Maximum / Minimum",
    group: "Other",
    hint: "Maximum spreads light areas; Minimum spreads dark ones.",
    params: [
      { type: "choice", key: "mode", label: "Mode", def: "max", options: [{ value: "max", label: "Maximum" }, { value: "min", label: "Minimum" }] },
      { type: "range", key: "radius", label: "Radius", min: 1, max: 20, def: 2, unit: " px", px: true },
    ],
    apply(img, p) {
      const r = Math.max(1, Math.round(num(p, "radius")));
      const max = p.mode === "max";
      const { width: w, height: h } = img;
      const pass = (src: Uint8ClampedArray, dst: Uint8ClampedArray, horiz: boolean) => {
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const o = (y * w + x) * 4;
          for (let c = 0; c < 3; c++) {
            let v = src[o + c];
            for (let k = -r; k <= r; k++) {
              const xx = horiz ? Math.min(w - 1, Math.max(0, x + k)) : x;
              const yy = horiz ? y : Math.min(h - 1, Math.max(0, y + k));
              const s = src[(yy * w + xx) * 4 + c];
              v = max ? (s > v ? s : v) : s < v ? s : v;
            }
            dst[o + c] = v;
          }
        }
      };
      const a = new Uint8ClampedArray(img.data);
      pass(img.data.slice(), a, true);
      pass(a, img.data, false);
    },
  },
  {
    id: "offset",
    label: "Offset",
    group: "Other",
    hint: "Wraps the picture around: handy for checking seamless textures.",
    params: [
      { type: "range", key: "dx", label: "Across", min: -100, max: 100, def: 50, unit: "%" },
      { type: "range", key: "dy", label: "Down", min: -100, max: 100, def: 50, unit: "%" },
    ],
    apply(img, p) {
      const { width: w, height: h } = img;
      const ox = Math.round((num(p, "dx") / 100) * w);
      const oy = Math.round((num(p, "dy") / 100) * h);
      const src = new Uint32Array(img.data.slice().buffer);
      const dst = new Uint32Array(img.data.buffer);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) dst[y * w + x] = src[(((y - oy) % h) + h) % h * w + ((((x - ox) % w) + w) % w)];
    },
  },
  /* Distort */
  {
    id: "twirl",
    label: "Twirl",
    group: "Distort",
    params: [
      { type: "range", key: "angle", label: "Angle", min: -999, max: 999, def: 120, unit: "°" },
      { type: "range", key: "radius", label: "Radius", min: 5, max: 100, def: 60, unit: "%" },
    ],
    apply(img, p) {
      const { width: w, height: h } = img;
      const cx = w / 2;
      const cy = h / 2;
      const R = (Math.min(w, h) / 2) * (num(p, "radius") / 100);
      const ang = (num(p, "angle") * Math.PI) / 180;
      displace(img, (x, y) => {
        const dx = x - cx;
        const dy = y - cy;
        const dist = Math.hypot(dx, dy);
        if (dist >= R) return [x, y];
        const a = ang * Math.pow(1 - dist / R, 2);
        return [cx + dx * Math.cos(a) - dy * Math.sin(a), cy + dx * Math.sin(a) + dy * Math.cos(a)];
      });
    },
  },
  {
    id: "pinch",
    label: "Pinch / Bulge",
    group: "Distort",
    params: [
      { type: "range", key: "amount", label: "Amount (− bulge, + pinch)", min: -100, max: 100, def: -50, unit: "%" },
      { type: "range", key: "radius", label: "Radius", min: 5, max: 100, def: 70, unit: "%" },
    ],
    apply(img, p) {
      const { width: w, height: h } = img;
      const cx = w / 2;
      const cy = h / 2;
      const R = (Math.min(w, h) / 2) * (num(p, "radius") / 100);
      const amt = num(p, "amount") / 100;
      displace(img, (x, y) => {
        const dx = x - cx;
        const dy = y - cy;
        const dist = Math.hypot(dx, dy);
        if (dist >= R || !dist) return [x, y];
        // Read from farther out (pinch, f > 1) or closer in (bulge, f < 1), fading to nothing at the rim.
        const f = Math.pow(Math.sin((Math.PI / 2) * (dist / R)), -amt);
        return [cx + dx * f, cy + dy * f];
      });
    },
  },
  {
    id: "wave",
    label: "Wave",
    group: "Distort",
    params: [
      { type: "range", key: "amplitude", label: "Height", min: 1, max: 200, def: 12, unit: " px", px: true },
      { type: "range", key: "wavelength", label: "Length", min: 4, max: 800, def: 120, unit: " px", px: true },
      { type: "choice", key: "dir", label: "Direction", def: "h", options: [{ value: "h", label: "Across" }, { value: "v", label: "Down" }, { value: "both", label: "Both" }] },
    ],
    apply(img, p) {
      const A = num(p, "amplitude");
      const L = Math.max(1, num(p, "wavelength"));
      const dir = p.dir as string;
      displace(img, (x, y) => [
        x + (dir !== "h" ? A * Math.sin((2 * Math.PI * y) / L) : 0),
        y + (dir !== "v" ? A * Math.sin((2 * Math.PI * x) / L) : 0),
      ]);
    },
  },
  {
    id: "ripple",
    label: "Ripple",
    group: "Distort",
    params: [
      { type: "range", key: "amplitude", label: "Size", min: 1, max: 60, def: 6, unit: " px", px: true },
      { type: "range", key: "wavelength", label: "Spacing", min: 4, max: 200, def: 30, unit: " px", px: true },
    ],
    apply(img, p) {
      const { width: w, height: h } = img;
      const A = num(p, "amplitude");
      const L = Math.max(1, num(p, "wavelength"));
      const cx = w / 2;
      const cy = h / 2;
      displace(img, (x, y) => {
        const dx = x - cx;
        const dy = y - cy;
        const dist = Math.hypot(dx, dy) || 1;
        const off = A * Math.sin((2 * Math.PI * dist) / L);
        return [x + (dx / dist) * off, y + (dy / dist) * off];
      });
    },
  },
  {
    id: "polar",
    label: "Polar Coordinates",
    group: "Distort",
    params: [{ type: "choice", key: "mode", label: "Mode", def: "toPolar", options: [{ value: "toPolar", label: "Rectangular to polar" }, { value: "toRect", label: "Polar to rectangular" }] }],
    apply(img, p) {
      const { width: w, height: h } = img;
      const cx = w / 2;
      const cy = h / 2;
      const R = Math.min(cx, cy);
      if (p.mode === "toPolar")
        displace(img, (x, y) => {
          const dx = x - cx;
          const dy = y - cy;
          const a = (Math.atan2(dx, -dy) + Math.PI) / (2 * Math.PI);
          return [a * (w - 1), (Math.hypot(dx, dy) / R) * (h - 1)];
        });
      else
        displace(img, (x, y) => {
          const a = (x / w) * 2 * Math.PI - Math.PI;
          const r = (y / h) * R;
          return [cx + r * Math.sin(a), cy - r * Math.cos(a)];
        });
    },
  },
  /* Render */
  {
    id: "vignette",
    label: "Vignette",
    group: "Render",
    params: [
      { type: "range", key: "amount", label: "Amount", min: -100, max: 100, def: 50 },
      { type: "range", key: "size", label: "Size", min: 0, max: 100, def: 45, unit: "%" },
    ],
    apply(img, p) {
      const { width: w, height: h, data: d } = img;
      const amt = num(p, "amount") / 100;
      const start = num(p, "size") / 100;
      const cx = w / 2;
      const cy = h / 2;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const t = Math.hypot((x - cx) / cx, (y - cy) / cy) / Math.SQRT2;
        const f = Math.max(0, (t - start) / Math.max(0.01, 1 - start));
        const k = f * f * amt;
        const o = (y * w + x) * 4;
        for (let c = 0; c < 3; c++) d[o + c] = k > 0 ? d[o + c] * (1 - k) : d[o + c] + (255 - d[o + c]) * -k;
      }
    },
  },
  {
    id: "clouds",
    label: "Clouds",
    group: "Render",
    hint: "Soft noise in your foreground and background colours.",
    params: [
      { type: "range", key: "scale", label: "Scale", min: 10, max: 800, def: 200, unit: " px", px: true },
      { type: "range", key: "seed", label: "Variation", min: 1, max: 999, def: 7 },
    ],
    apply(img, p, ctx) {
      const { width: w, height: h, data: d } = img;
      const noise = makeNoise(num(p, "seed"));
      const sc = Math.max(1, num(p, "scale"));
      const a = hexToRgb(ctx.fg);
      const b = hexToRgb(ctx.bg);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let v = 0;
        let amp = 0.5;
        let f = 1 / sc;
        for (let o = 0; o < 5; o++) {
          v += noise(x * f, y * f) * amp;
          amp /= 2;
          f *= 2;
        }
        const o = (y * w + x) * 4;
        for (let c = 0; c < 3; c++) d[o + c] = a[c] + (b[c] - a[c]) * v * 1.03;
        d[o + 3] = 255;
      }
    },
  },
  {
    id: "halation",
    label: "35mm Halation",
    group: "Effects",
    hint: "Authentic red-orange analog film scatter around specular highlights.",
    params: [
      { type: "range", key: "amount", label: "Amount", min: 0, max: 100, def: 55, unit: "%" },
      { type: "range", key: "threshold", label: "Threshold", min: 120, max: 250, def: 200 },
      { type: "range", key: "spread", label: "Scatter radius", min: 4, max: 48, def: 16, unit: " px", px: true },
    ],
    apply(img, p) {
      const glow = copyImage(img);
      const gd = glow.data;
      const d = img.data;
      const thr = num(p, "threshold");
      const span = Math.max(1, 255 - thr);
      const amt = num(p, "amount") / 100;
      for (let i = 0; i < gd.length; i += 4) {
        const l = luma(d[i], d[i + 1], d[i + 2]);
        const hi = Math.max(0, (l - thr) / span);
        gd[i] = clamp255(d[i] * hi * 1.05);
        gd[i + 1] = clamp255(d[i + 1] * hi * 0.28);
        gd[i + 2] = clamp255(d[i + 2] * hi * 0.06);
      }
      blurImage(glow, num(p, "spread"));
      for (let i = 0; i < d.length; i += 4) {
        for (let c = 0; c < 3; c++) {
          const base = d[i + c] / 255;
          const halo = (gd[i + c] / 255) * amt;
          d[i + c] = clamp255((1 - (1 - base) * (1 - halo)) * 255);
        }
      }
    },
  },
  {
    id: "bloom",
    label: "Pro-Mist Bloom",
    group: "Effects",
    hint: "Silky optical diffusion around bright highlights without crushing shadows.",
    params: [
      { type: "range", key: "amount", label: "Strength", min: 0, max: 100, def: 48, unit: "%" },
      { type: "range", key: "threshold", label: "Threshold", min: 100, max: 245, def: 170 },
      { type: "range", key: "radius", label: "Bloom radius", min: 4, max: 64, def: 22, unit: " px", px: true },
      { type: "range", key: "warmth", label: "Warmth", min: -50, max: 50, def: 10 },
    ],
    apply(img, p) {
      const glow = copyImage(img);
      const gd = glow.data;
      const d = img.data;
      const thr = num(p, "threshold");
      const span = Math.max(1, 255 - thr);
      const amt = num(p, "amount") / 100;
      const warm = num(p, "warmth") / 100;
      for (let i = 0; i < gd.length; i += 4) {
        const l = luma(d[i], d[i + 1], d[i + 2]);
        const hi = Math.max(0, (l - thr) / span);
        gd[i] = clamp255(d[i] * hi * (1 + Math.max(0, warm) * 0.35));
        gd[i + 1] = clamp255(d[i + 1] * hi * (1 + Math.abs(warm) * 0.08));
        gd[i + 2] = clamp255(d[i + 2] * hi * (1 + Math.max(0, -warm) * 0.35 - Math.max(0, warm) * 0.12));
      }
      blurImage(glow, num(p, "radius"));
      for (let i = 0; i < d.length; i += 4) {
        for (let c = 0; c < 3; c++) {
          const base = d[i + c] / 255;
          const b = (gd[i + c] / 255) * amt;
          d[i + c] = clamp255((1 - (1 - base) * (1 - b)) * 255);
        }
      }
    },
  },
  {
    id: "perspective",
    label: "Perspective / Keystone",
    group: "Distort",
    hint: "Straighten leaning buildings or add dramatic tilt.",
    params: [
      { type: "range", key: "vertical", label: "Vertical tilt", min: -60, max: 60, def: 0, unit: "%" },
      { type: "range", key: "horizontal", label: "Horizontal tilt", min: -60, max: 60, def: 0, unit: "%" },
      { type: "range", key: "zoom", label: "Zoom fill", min: 70, max: 140, def: 100, unit: "%" },
    ],
    apply(img, p) {
      const { width: w, height: h } = img;
      const kv = (num(p, "vertical") / 100) * 0.55;
      const kh = (num(p, "horizontal") / 100) * 0.55;
      const z = Math.max(0.25, num(p, "zoom") / 100);
      const hw = w / 2 || 1;
      const hh = h / 2 || 1;
      displace(img, (x, y) => {
        const u = (x - hw) / hw;
        const v = (y - hh) / hh;
        const denom = Math.max(0.25, (1 - kv * v - kh * u) * z);
        return [hw + (u / denom) * hw, hh + (v / denom) * hh];
      });
    },
  },
  {
    id: "lens-correct",
    label: "Lens Distortion",
    group: "Distort",
    hint: "Correct wide-angle barrel bowing or pincushion warping.",
    params: [
      { type: "range", key: "distortion", label: "Distortion", min: -100, max: 100, def: -25, unit: "%" },
      { type: "range", key: "scale", label: "Scale", min: 80, max: 130, def: 100, unit: "%" },
      { type: "range", key: "vignette", label: "Edge brightness", min: -50, max: 50, def: 0 },
    ],
    apply(img, p) {
      const { width: w, height: h } = img;
      const k = (num(p, "distortion") / 100) * 0.45;
      const z = Math.max(0.3, num(p, "scale") / 100);
      const vig = num(p, "vignette") / 100;
      const hw = w / 2 || 1;
      const hh = h / 2 || 1;
      const norm = Math.max(hw, hh);
      displace(img, (x, y) => {
        const dx = (x - hw) / norm;
        const dy = (y - hh) / norm;
        const r2 = dx * dx + dy * dy;
        const f = (1 + k * r2) / z;
        return [hw + dx * f * norm, hh + dy * f * norm];
      });
      if (vig !== 0) {
        const d = img.data;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const r2 = ((x - hw) / hw) ** 2 + ((y - hh) / hh) ** 2;
          const m = Math.max(0, 1 + vig * r2 * 0.65);
          const o = (y * w + x) * 4;
          for (let c = 0; c < 3; c++) d[o + c] = clamp255(d[o + c] * m);
        }
      }
    },
  },
];

export const filterById = (id: string) => FILTERS.find((f) => f.id === id);
