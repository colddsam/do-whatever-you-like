/*
 * Document scanner vision worker (OpenCV.js, Apache-2.0, served from /vendor).
 * Runs off the main thread so the camera preview never stutters.
 *
 * Messages in:
 *   { type: "detect", id, width, height, buffer }          RGBA pixels of a small preview frame
 *   { type: "process", id, width, height, buffer, quad, filter, rotate, maxSide }
 *                                                          a full-size photo, its page corners, the look
 * Messages out:
 *   { type: "ready" } | { type: "error", message }
 *   { type: "detected", id, quad|null, confidence, brightness, sharpness, text }
 *   { type: "processed", id, width, height, buffer }
 *
 * quad: four [x, y] points in 0..1 of the frame, ordered top-left, top-right, bottom-right, bottom-left.
 */

/* global cv, importScripts */
let ready = false;

async function boot() {
  try {
    importScripts("/vendor/opencv-4.10.0.js");
    let lib = self.cv;
    // Some builds hand back a real Promise of the module; others the module itself, which has a
    // `then` that resolves to itself (awaiting that would never end), so never await it directly.
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
    ready = true;
    postMessage({ type: "ready" });
  } catch (e) {
    postMessage({ type: "error", message: String((e && e.message) || e) });
  }
}
boot();

const queue = [];
onmessage = (e) => {
  if (!ready) {
    queue.push(e.data);
    return;
  }
  handle(e.data);
};
const drain = setInterval(() => {
  if (ready) {
    clearInterval(drain);
    while (queue.length) handle(queue.shift());
  }
}, 50);

function handle(msg) {
  try {
    if (msg.type === "trace") postMessage({ type: "traced", id: msg.id, contours: traceMat(fromPixels(msg), msg.epsilon ?? 1, true) });
    else if (msg.type === "sheet") postMessage({ type: "sheet", id: msg.id, ...readSheet(msg) });
    else if (msg.type === "detect") postMessage({ type: "detected", id: msg.id, ...detect(msg) });
    else if (msg.type === "process") {
      const out = processPage(msg);
      postMessage({ type: "processed", id: msg.id, ...out }, [out.buffer]);
    }
  } catch (e) {
    postMessage({ type: "error", id: msg.id, message: String((e && e.message) || e) });
  }
}

function fromPixels(msg) {
  const data = new ImageData(new Uint8ClampedArray(msg.buffer), msg.width, msg.height);
  return cv.matFromImageData(data);
}

/* ---------------------------------------------------------------------------------------------- */
/* Finding the page                                                                               */
/* ---------------------------------------------------------------------------------------------- */

function order(pts) {
  // Top-left has the smallest x+y, bottom-right the largest; top-right the smallest y-x.
  const sum = pts.map((p) => p[0] + p[1]);
  const diff = pts.map((p) => p[1] - p[0]);
  const tl = pts[sum.indexOf(Math.min(...sum))];
  const br = pts[sum.indexOf(Math.max(...sum))];
  const tr = pts[diff.indexOf(Math.min(...diff))];
  const bl = pts[diff.indexOf(Math.max(...diff))];
  return [tl, tr, br, bl];
}

function quadFrom(approx) {
  const pts = [];
  for (let i = 0; i < 4; i++) pts.push([approx.data32S[i * 2], approx.data32S[i * 2 + 1]]);
  return order(pts);
}

/** The biggest convex four-sided shape among the outlines in `bin` (a black/white image). */
function bestQuad(bin, minArea) {
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(bin, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
  let best = null;
  let bestArea = minArea;
  const list = [];
  for (let i = 0; i < contours.size(); i++) {
    const c = contours.get(i);
    const area = cv.contourArea(c);
    if (area > minArea) list.push({ c, area });
    else c.delete();
  }
  list.sort((a, b) => b.area - a.area);
  const W = bin.cols;
  const H = bin.rows;
  // An outline that runs along the frame's own border is the frame (or an even background), not a page.
  const hugs = (q) => q.filter(([x, y]) => x < W * 0.015 || y < H * 0.015 || x > W * 0.985 || y > H * 0.985).length >= 3;
  for (const { c, area } of list.slice(0, 8)) {
    if (area > W * H * 0.97) continue;
    const peri = cv.arcLength(c, true);
    for (const eps of [0.02, 0.03, 0.045]) {
      const approx = new cv.Mat();
      cv.approxPolyDP(c, approx, eps * peri, true);
      if (approx.rows === 4 && cv.isContourConvex(approx) && area > bestArea && !hugs(quadFrom(approx))) {
        best = quadFrom(approx);
        bestArea = area;
        approx.delete();
        break;
      }
      approx.delete();
    }
    if (!best) {
      // No clean corners (a page with a curled edge): fall back to the outline's rotated box.
      const rect = cv.minAreaRect(c);
      const boxArea = rect.size.width * rect.size.height;
      const pts = order(cv.RotatedRect.points(rect).map((p) => [p.x, p.y]));
      if (area > minArea * 2.2 && area / boxArea > 0.85 && area > bestArea && !hugs(pts)) {
        best = pts;
        bestArea = area * 0.9;
      }
    }
  }
  list.forEach(({ c }) => c.delete());
  contours.delete();
  hierarchy.delete();
  return best ? { quad: best, area: bestArea } : null;
}

function median(gray) {
  const hist = new Uint32Array(256);
  const d = gray.data;
  for (let i = 0; i < d.length; i += 3) hist[d[i]]++;
  let n = 0;
  const half = d.length / 6;
  for (let v = 0; v < 256; v++) {
    n += hist[v];
    if (n >= half) return v;
  }
  return 127;
}

function detect(msg) {
  const src = fromPixels(msg);
  const gray = new cv.Mat();
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
  src.delete();
  const W = gray.cols;
  const H = gray.rows;
  const frameArea = W * H;
  const brightness = cv.mean(gray)[0];

  const blur = new cv.Mat();
  cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);

  // 1) Edges: Canny with thresholds from the frame's own median, joined up by a small dilation.
  const v = median(blur);
  const edges = new cv.Mat();
  cv.Canny(blur, edges, Math.max(10, 0.66 * v), Math.min(255, 1.33 * v + 20));
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
  cv.dilate(edges, edges, kernel);
  let found = bestQuad(edges, frameArea * 0.12);

  // 2) Brightness: paper is usually lighter than what it lies on (Otsu splits the two).
  const bin = new cv.Mat();
  cv.threshold(blur, bin, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
  cv.morphologyEx(bin, bin, cv.MORPH_CLOSE, kernel);
  const byTone = bestQuad(bin, frameArea * 0.12);
  if (byTone && (!found || byTone.area > found.area * 1.15)) found = byTone;
  kernel.delete();
  edges.delete();
  bin.delete();

  let sharpness = 0;
  let text = 0;
  let quad = null;
  let confidence = 0;
  if (found) {
    quad = found.quad.map(([x, y]) => [x / W, y / H]);
    confidence = Math.min(1, found.area / frameArea / 0.45);
    // Inside the page: focus (variance of the Laplacian) and how much looks like text.
    const xs = found.quad.map((p) => p[0]);
    const ys = found.quad.map((p) => p[1]);
    const x0 = Math.max(0, Math.floor(Math.min(...xs)) + 4);
    const y0 = Math.max(0, Math.floor(Math.min(...ys)) + 4);
    const x1 = Math.min(W, Math.ceil(Math.max(...xs)) - 4);
    const y1 = Math.min(H, Math.ceil(Math.max(...ys)) - 4);
    if (x1 - x0 > 20 && y1 - y0 > 20) {
      const roi = gray.roi(new cv.Rect(x0, y0, x1 - x0, y1 - y0));
      sharpness = laplacianVariance(roi);
      text = textScore(roi);
      roi.delete();
    }
  } else {
    sharpness = laplacianVariance(gray);
  }
  gray.delete();
  blur.delete();
  return { quad, confidence, brightness, sharpness, text };
}

function laplacianVariance(m) {
  const lap = new cv.Mat();
  cv.Laplacian(m, lap, cv.CV_64F);
  const mean = new cv.Mat();
  const std = new cv.Mat();
  cv.meanStdDev(lap, mean, std);
  const s = std.doubleAt(0, 0);
  lap.delete();
  mean.delete();
  std.delete();
  return s * s;
}

/** How text-like the page looks: small dark marks in rows (counted, 0 to ~1). */
function textScore(roi) {
  const bin = new cv.Mat();
  cv.adaptiveThreshold(roi, bin, 255, cv.ADAPTIVE_THRESH_MEAN_C, cv.THRESH_BINARY_INV, 15, 12);
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(bin, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
  const H = roi.rows;
  let marks = 0;
  for (let i = 0; i < contours.size(); i++) {
    const r = cv.boundingRect(contours.get(i));
    if (r.height >= 3 && r.height <= H / 12 && r.width <= roi.cols / 4 && r.width * r.height >= 6) marks++;
  }
  contours.delete();
  hierarchy.delete();
  bin.delete();
  return Math.min(1, marks / 120);
}

/* ---------------------------------------------------------------------------------------------- */
/* Making the page                                                                                */
/* ---------------------------------------------------------------------------------------------- */

function dist(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/** Flattens uneven light (shadows, a lamp on one side) by dividing by the blurred page. */
function flatten(gray) {
  const k = Math.max(15, Math.round(Math.min(gray.cols, gray.rows) / 40) | 1);
  const bg = new cv.Mat();
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(k, k));
  cv.dilate(gray, bg, kernel); // Text is thin and dark: dilating erases it, leaving the paper.
  cv.medianBlur(bg, bg, k % 2 ? k : k + 1);
  const out = new cv.Mat();
  cv.divide(gray, bg, out, 255);
  kernel.delete();
  bg.delete();
  // Stretch so the paper is white and the ink is dark.
  cv.normalize(out, out, 0, 255, cv.NORM_MINMAX);
  return out;
}

function sharpen(m, amount) {
  const blur = new cv.Mat();
  cv.GaussianBlur(m, blur, new cv.Size(0, 0), 1.2);
  const out = new cv.Mat();
  cv.addWeighted(m, 1 + amount, blur, -amount, 0, out);
  blur.delete();
  return out;
}

/*
 * The page's real width:height, undoing perspective (a page photographed at an angle looks squat).
 * Zhang & He, "Whiteboard scanning and image enhancement" (2007): from the four corners and the
 * principal point (the image centre) recover the focal length, then the rectangle's true ratio.
 * Returns null when the view is too square-on for the maths to be stable (then edges are honest).
 */
function trueAspect(q, W, H) {
  const c = (p) => [p[0] - W / 2, p[1] - H / 2, 1];
  const [m1, m2, m4, m3] = [c(q[0]), c(q[1]), c(q[2]), c(q[3])]; // tl, tr, br, bl
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const k2 = dot(cross(m1, m4), m3) / dot(cross(m2, m4), m3);
  const k3 = dot(cross(m1, m4), m2) / dot(cross(m3, m4), m2);
  const n2 = m2.map((v, i) => k2 * v - m1[i]);
  const n3 = m3.map((v, i) => k3 * v - m1[i]);
  if (Math.abs(n2[2]) < 1e-3 || Math.abs(n3[2]) < 1e-3) return null;
  const f2 = -(n2[0] * n3[0] + n2[1] * n3[1]) / (n2[2] * n3[2]);
  if (!(f2 > 0) || !Number.isFinite(f2)) return null;
  const len = (n) => (n[0] * n[0] + n[1] * n[1]) / f2 + n[2] * n[2];
  const ratio = Math.sqrt(len(n2) / len(n3));
  return Number.isFinite(ratio) && ratio > 0.2 && ratio < 5 ? ratio : null;
}

/** Paper sizes people scan, as width:height. A ratio within 3% of one snaps to it. */
const PAPER = [1 / Math.SQRT2, 8.5 / 11, 8.5 / 14, 3.5 / 2, 85.6 / 53.98];

function processPage(msg) {
  const src = fromPixels(msg);
  const W = src.cols;
  const H = src.rows;
  const q = (msg.quad || [[0, 0], [1, 0], [1, 1], [0, 1]]).map(([x, y]) => [x * W, y * H]);
  let w = Math.round(Math.max(dist(q[0], q[1]), dist(q[3], q[2])));
  let h = Math.round(Math.max(dist(q[0], q[3]), dist(q[1], q[2])));
  if (msg.quad) {
    let ratio = trueAspect(q, W, H);
    const measured = w / h;
    if (!ratio || Math.abs(ratio - measured) / measured > 0.6) ratio = measured;
    for (const p of PAPER) {
      for (const r of [p, 1 / p]) if (Math.abs(ratio - r) / r < 0.03) ratio = r;
    }
    // Keep the longer measured side's resolution; set the other from the true ratio.
    if (ratio >= 1) h = Math.round(Math.max(w, h) / ratio), (w = Math.round(h * ratio));
    else (w = Math.round(Math.max(w, h) * ratio)), (h = Math.round(w / ratio));
  }
  const maxSide = msg.maxSide || 3000;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  w = Math.max(16, Math.round(w * scale));
  h = Math.max(16, Math.round(h * scale));

  const from = cv.matFromArray(4, 1, cv.CV_32FC2, q.flat());
  // Map the corners a hair outside the output, so the table's edge never shows as a dark line.
  const t = msg.quad ? Math.round(Math.min(w, h) * 0.008) : 0;
  const to = cv.matFromArray(4, 1, cv.CV_32FC2, [-t, -t, w + t, -t, w + t, h + t, -t, h + t]);
  const M = cv.getPerspectiveTransform(from, to);
  let page = new cv.Mat();
  cv.warpPerspective(src, page, M, new cv.Size(w, h), cv.INTER_CUBIC, cv.BORDER_REPLICATE);
  from.delete();
  to.delete();
  M.delete();
  src.delete();

  const filter = msg.filter || "auto";
  let out;
  if (filter === "original") {
    out = page;
  } else {
    const rgb = new cv.Mat();
    cv.cvtColor(page, rgb, cv.COLOR_RGBA2RGB);
    if (filter === "auto") {
      // Colour kept: flatten the light in L*a*b* lightness only, then a touch of sharpening.
      const lab = new cv.Mat();
      cv.cvtColor(rgb, lab, cv.COLOR_RGB2Lab);
      const ch = new cv.MatVector();
      cv.split(lab, ch);
      const L = ch.get(0);
      const flat = flatten(L);
      ch.set(0, flat);
      cv.merge(ch, lab);
      cv.cvtColor(lab, rgb, cv.COLOR_Lab2RGB);
      L.delete();
      flat.delete();
      ch.delete();
      lab.delete();
      const sharp = sharpen(rgb, 0.6);
      out = new cv.Mat();
      cv.cvtColor(sharp, out, cv.COLOR_RGB2RGBA);
      sharp.delete();
    } else {
      const gray = new cv.Mat();
      cv.cvtColor(rgb, gray, cv.COLOR_RGB2GRAY);
      const flat = flatten(gray);
      gray.delete();
      let result;
      if (filter === "bw") {
        result = new cv.Mat();
        const block = Math.max(15, Math.round(Math.min(w, h) / 60) | 1);
        cv.adaptiveThreshold(flat, result, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, block % 2 ? block : block + 1, 10);
        flat.delete();
      } else {
        result = sharpen(flat, 0.5);
        flat.delete();
      }
      out = new cv.Mat();
      cv.cvtColor(result, out, cv.COLOR_GRAY2RGBA);
      result.delete();
    }
    rgb.delete();
    page.delete();
    page = null;
  }

  const turns = ((msg.rotate || 0) / 90) % 4;
  if (turns) {
    const rotated = new cv.Mat();
    cv.rotate(out, rotated, [cv.ROTATE_90_CLOCKWISE, cv.ROTATE_180, cv.ROTATE_90_COUNTERCLOCKWISE][turns - 1]);
    out.delete();
    out = rotated;
  }
  const buffer = new Uint8ClampedArray(out.data).buffer;
  const result = { width: out.cols, height: out.rows, buffer };
  out.delete();
  return result;
}

/* ---------------------------------------------------------------------------------------------- */
/* Font creator: tracing glyphs, and reading a filled-in handwriting template                     */
/* ---------------------------------------------------------------------------------------------- */

/**
 * Outlines of the dark marks in an image (RGBA Mat, consumed): outer shapes and the holes in them
 * (the inside of an "o"), each simplified to within `epsilon` pixels. Points are flat [x, y, ...].
 */
function traceMat(src, epsilon, dark) {
  const gray = new cv.Mat();
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
  src.delete();
  const bin = new cv.Mat();
  cv.threshold(gray, bin, 0, 255, (dark ? cv.THRESH_BINARY_INV : cv.THRESH_BINARY) + cv.THRESH_OTSU);
  gray.delete();
  const out = contoursOf(bin, epsilon, bin.rows * bin.cols * 0.00015);
  bin.delete();
  return out;
}

function contoursOf(bin, epsilon, minArea) {
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(bin, contours, hierarchy, cv.RETR_CCOMP, epsilon > 0 ? cv.CHAIN_APPROX_NONE : cv.CHAIN_APPROX_SIMPLE);
  const out = [];
  for (let i = 0; i < contours.size(); i++) {
    const c = contours.get(i);
    if (Math.abs(cv.contourArea(c)) < minArea) {
      c.delete();
      continue;
    }
    let pts = c;
    if (epsilon > 0) {
      pts = new cv.Mat();
      cv.approxPolyDP(c, pts, epsilon, true);
    }
    if (pts.rows >= 3) {
      // RETR_CCOMP: two levels; a contour with a parent is a hole.
      const hole = hierarchy.intAt(0, i * 4 + 3) !== -1;
      out.push({ points: Array.from(pts.data32S), hole });
    }
    if (pts !== c) pts.delete();
    c.delete();
  }
  contours.delete();
  hierarchy.delete();
  return out;
}

/**
 * A photo of a printed template page: find its four corner markers, flatten the page to the
 * template's own geometry (millimetres × scale), read the page number from the bit squares, then
 * trace the writing area of every cell. Light-blue guides drop out (only dark ink counts).
 *
 * msg.layout: { width, height (mm), scale (px per mm), markers: [[x,y] × 4 mm, tl tr br bl],
 *               bits: [[x,y,w,h] mm], cells: [[x,y,w,h] mm] }
 */
function readSheet(msg) {
  const L = msg.layout;
  const src = fromPixels(msg);
  const gray = new cv.Mat();
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
  src.delete();
  const found = findMarkers(gray);
  if (!found) {
    gray.delete();
    return { ok: false, reason: "The four black corner squares weren't found. Photograph the whole page, flat and well lit." };
  }
  const W = Math.round(L.width * L.scale);
  const H = Math.round(L.height * L.scale);
  const from = cv.matFromArray(4, 1, cv.CV_32FC2, found.flat());
  const to = cv.matFromArray(4, 1, cv.CV_32FC2, L.markers.flatMap(([x, y]) => [x * L.scale, y * L.scale]));
  const M = cv.getPerspectiveTransform(from, to);
  const flat = new cv.Mat();
  cv.warpPerspective(gray, flat, M, new cv.Size(W, H), cv.INTER_LINEAR, cv.BORDER_REPLICATE);
  from.delete();
  to.delete();
  M.delete();
  gray.delete();

  // Even out the light, then call "ink" anything clearly darker than the paper (guides are light blue).
  const k = Math.round(L.scale * 6) | 1;
  const bg = new cv.Mat();
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(k, k));
  cv.dilate(flat, bg, kernel);
  const norm = new cv.Mat();
  cv.divide(flat, bg, norm, 255);
  bg.delete();
  kernel.delete();
  flat.delete();
  const ink = new cv.Mat();
  cv.threshold(norm, ink, 150, 255, cv.THRESH_BINARY_INV);
  norm.delete();
  const open = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(3, 3));
  cv.morphologyEx(ink, ink, cv.MORPH_OPEN, open);
  open.delete();

  const frac = (r) => {
    const roi = ink.roi(new cv.Rect(Math.round(r[0] * L.scale), Math.round(r[1] * L.scale), Math.round(r[2] * L.scale), Math.round(r[3] * L.scale)));
    const v = cv.countNonZero(roi) / (roi.rows * roi.cols);
    roi.delete();
    return v;
  };
  let page = 0;
  L.bits.forEach((b, i) => {
    if (frac(b) > 0.5) page |= 1 << i;
  });

  const cells = L.cells.map((r) => {
    const x = Math.round(r[0] * L.scale);
    const y = Math.round(r[1] * L.scale);
    const w = Math.round(r[2] * L.scale);
    const h = Math.round(r[3] * L.scale);
    const roi = ink.roi(new cv.Rect(x, y, w, h));
    const cell = roi.clone();
    roi.delete();
    const filled = cv.countNonZero(cell) / (w * h);
    let contours = [];
    if (filled > 0.002) contours = contoursOf(cell, Math.max(0.6, L.scale * 0.12), w * h * 0.0006).map((c) => ({ hole: c.hole, points: c.points.map((v, j) => (j % 2 ? v / h : v / w)) }));
    cell.delete();
    return { filled, contours };
  });
  ink.delete();
  return { ok: true, page, cells };
}

/** The four big black squares nearest the image's corners, as their centres (tl, tr, br, bl). */
function findMarkers(gray) {
  const bin = new cv.Mat();
  const blur = new cv.Mat();
  cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
  cv.threshold(blur, bin, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);
  blur.delete();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(bin, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
  const W = gray.cols;
  const H = gray.rows;
  const area = W * H;
  const cands = [];
  for (let i = 0; i < contours.size(); i++) {
    const c = contours.get(i);
    const a = cv.contourArea(c);
    if (a > area * 0.00008 && a < area * 0.02) {
      const r = cv.boundingRect(c);
      const ratio = r.width / r.height;
      const solidity = a / (r.width * r.height);
      if (ratio > 0.6 && ratio < 1.6 && solidity > 0.75) cands.push({ x: r.x + r.width / 2, y: r.y + r.height / 2, a });
    }
    c.delete();
  }
  contours.delete();
  hierarchy.delete();
  bin.delete();
  if (cands.length < 4) return null;
  const corners = [[0, 0], [W, 0], [W, H], [0, H]];
  const picked = corners.map(([cx, cy]) => cands.reduce((best, p) => (Math.hypot(p.x - cx, p.y - cy) < Math.hypot(best.x - cx, best.y - cy) ? p : best)));
  if (new Set(picked).size < 4) return null;
  // Markers are the same size: reject a pick that's far off the others (a big ink blot).
  const sizes = picked.map((p) => p.a).sort((a, b) => a - b);
  if (sizes[3] > sizes[0] * 4) return null;
  return picked.map((p) => [p.x, p.y]);
}
