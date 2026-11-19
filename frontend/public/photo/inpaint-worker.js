/*
 * Spot healing and content-aware fill for the pro photo editor, off the main thread.
 * Uses OpenCV.js's inpainting (Telea) from /vendor when the build has it, and a plain-JS
 * fill (onion peel, then smoothing) when it doesn't. Nothing leaves the device.
 *
 * In:  { id, width, height, rgba: ArrayBuffer, mask: ArrayBuffer (1 byte per pixel, >0 = fill), radius }
 * Out: { id, rgba: ArrayBuffer, engine: "opencv" | "js" } or { id, error }
 */

/* global cv, importScripts */
let cvReady = null;

function loadCv() {
  if (cvReady) return cvReady;
  cvReady = (async () => {
    try {
      importScripts("/vendor/opencv-4.10.0.js");
      let lib = self.cv;
      if (lib instanceof Promise) lib = await lib;
      if (!lib.Mat) {
        await new Promise((resolve) => {
          const prev = lib.onRuntimeInitialized;
          lib.onRuntimeInitialized = () => {
            if (prev) prev();
            resolve();
          };
          const poll = setInterval(() => lib.Mat && (clearInterval(poll), resolve()), 50);
        });
      }
      if (typeof lib.then === "function") delete lib.then;
      self.cv = lib;
      return typeof lib.inpaint === "function" ? lib : null;
    } catch {
      return null;
    }
  })();
  return cvReady;
}

function jsInpaint(rgba, mask, w, h) {
  const known = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) known[i] = mask[i] ? 0 : 1;
  // Onion peel: fill the unknown border from known neighbours, ring by ring, inwards.
  let left = 0;
  for (let i = 0; i < w * h; i++) if (!known[i]) left++;
  const nb = [-1, 1, -w, w, -w - 1, -w + 1, w - 1, w + 1];
  const wt = [1, 1, 1, 1, 0.7, 0.7, 0.7, 0.7];
  let guard = 0;
  while (left > 0 && guard++ < 4000) {
    const ring = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (known[i]) continue;
      let r = 0, g = 0, b = 0, a = 0, s = 0;
      for (let k = 0; k < 8; k++) {
        const dx = k === 0 || k === 4 || k === 6 ? -1 : k === 1 || k === 5 || k === 7 ? 1 : 0;
        const nx = x + dx;
        const j = i + nb[k];
        if (nx < 0 || nx >= w || j < 0 || j >= w * h || !known[j]) continue;
        r += rgba[j * 4] * wt[k];
        g += rgba[j * 4 + 1] * wt[k];
        b += rgba[j * 4 + 2] * wt[k];
        a += rgba[j * 4 + 3] * wt[k];
        s += wt[k];
      }
      if (s) ring.push(i, r / s, g / s, b / s, a / s);
    }
    if (!ring.length) break;
    for (let k = 0; k < ring.length; k += 5) {
      const i = ring[k];
      rgba[i * 4] = ring[k + 1];
      rgba[i * 4 + 1] = ring[k + 2];
      rgba[i * 4 + 2] = ring[k + 3];
      rgba[i * 4 + 3] = ring[k + 4];
      known[i] = 1;
      left--;
    }
  }
  // A few smoothing passes inside the filled area hide the rings.
  for (let pass = 0; pass < 6; pass++) {
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      for (let c = 0; c < 4; c++) {
        rgba[i * 4 + c] = (rgba[(i - 1) * 4 + c] + rgba[(i + 1) * 4 + c] + rgba[(i - w) * 4 + c] + rgba[(i + w) * 4 + c]) / 4;
      }
    }
  }
}

onmessage = async (e) => {
  const { id, width: w, height: h, radius } = e.data;
  const rgba = new Uint8ClampedArray(e.data.rgba);
  const mask = new Uint8Array(e.data.mask);
  try {
    const lib = await loadCv();
    if (lib) {
      const src = lib.matFromImageData(new ImageData(rgba, w, h));
      const rgb = new lib.Mat();
      lib.cvtColor(src, rgb, lib.COLOR_RGBA2RGB);
      const m = new lib.Mat(h, w, lib.CV_8UC1);
      m.data.set(mask);
      const out = new lib.Mat();
      lib.inpaint(rgb, m, out, Math.max(3, radius || 5), lib.INPAINT_TELEA);
      const back = new lib.Mat();
      lib.cvtColor(out, back, lib.COLOR_RGB2RGBA);
      const res = new Uint8ClampedArray(back.data);
      // Keep the original alpha (inpainting works on colour only).
      for (let i = 0; i < w * h; i++) res[i * 4 + 3] = mask[i] ? 255 : rgba[i * 4 + 3];
      [src, rgb, m, out, back].forEach((x) => x.delete());
      postMessage({ id, rgba: res.buffer, engine: "opencv" }, [res.buffer]);
      return;
    }
    jsInpaint(rgba, mask, w, h);
    postMessage({ id, rgba: rgba.buffer, engine: "js" }, [rgba.buffer]);
  } catch (err) {
    try {
      jsInpaint(rgba, mask, w, h);
      postMessage({ id, rgba: rgba.buffer, engine: "js" }, [rgba.buffer]);
    } catch {
      postMessage({ id, error: String((err && err.message) || err) });
    }
  }
};
