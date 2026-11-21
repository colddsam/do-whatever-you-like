import { CanvasSink } from "mediabunny";
import { anim } from "../../lib/keyframes";
import { localForSrc, srcSpan } from "../../lib/speed";
import { rt, uid } from "../../lib/time";
import * as TL from "../../lib/timeline";
import { useStudio } from "../../store/studio-store";
import type { Clip, Keyframe, Project, StabilizeData } from "../../types";
import { extractPcm, SourceAudio } from "../audio";
import { mediaRuntime, openInput } from "../media";
import type { Progress } from "./captions";
import { loadSegmenter, segmentFrame } from "./segmenter";

/**
 * Analysis tools that run on this device with no model download (except auto-reframe, which reuses
 * the background-removal segmenter): scene-cut detection, stabilisation, auto-reframe, beat
 * detection, loudness normalisation and auto-ducking.
 */

/** Small greyscale/colour copies of a clip's frames, decoded in order between source times a and b. */
async function* smallFrames(mediaId: string, a: number, b: number, width: number) {
  const file = mediaRuntime.file(mediaId);
  if (!file) throw new Error("This clip's media isn't on this device.");
  const input = openInput(file);
  try {
    const vt = await input.getPrimaryVideoTrack();
    if (!vt) throw new Error("This clip has no picture.");
    const w = width;
    const h = Math.max(8, Math.round((width * vt.displayHeight) / Math.max(1, vt.displayWidth)));
    const sink = new CanvasSink(vt, { width: w, height: h, fit: "fill", poolSize: 2 });
    const cv = new OffscreenCanvas(w, h);
    const ctx = cv.getContext("2d", { willReadFrequently: true })!;
    for await (const wc of sink.canvases(a, b)) {
      ctx.drawImage(wc.canvas, 0, 0, w, h);
      yield { t: wc.timestamp, data: ctx.getImageData(0, 0, w, h).data, w, h };
    }
  } finally {
    input.dispose();
  }
}

/* ---------- Scene detection ---------- */

/**
 * Finds the cuts inside a clip (Premiere's Scene Edit Detection): every frame is shrunk to 64 px and
 * compared with the last by colour histogram and pixel difference; a cut is a spike well above the
 * local average. Returns timeline times.
 */
export async function detectScenes(clipId: string, onProgress: Progress, sensitivity = 0.5): Promise<number[]> {
  const p = useStudio.getState().project;
  const c = p.clips[clipId];
  if (!c || c.kind !== "video" || !c.mediaId) throw new Error("Select a video clip to find its scene cuts.");
  const a = c.in;
  const b = c.in + srcSpan(c);
  const times: number[] = [];
  const scores: number[] = [];
  let prevHist: Float32Array | null = null;
  let prevPix: Uint8ClampedArray | null = null;
  for await (const f of smallFrames(c.mediaId, a, b, 64)) {
    const hist = new Float32Array(512);
    const n = f.w * f.h;
    for (let i = 0; i < n; i++) hist[((f.data[i * 4] >> 5) << 6) | ((f.data[i * 4 + 1] >> 5) << 3) | (f.data[i * 4 + 2] >> 5)] += 1 / n;
    if (prevHist && prevPix) {
      let hd = 0;
      for (let i = 0; i < 512; i++) hd += Math.abs(hist[i] - prevHist[i]);
      let pd = 0;
      for (let i = 0; i < n * 4; i += 4) pd += Math.abs(f.data[i] - prevPix[i]) + Math.abs(f.data[i + 1] - prevPix[i + 1]) + Math.abs(f.data[i + 2] - prevPix[i + 2]);
      scores.push(0.55 * (hd / 2) + 0.45 * (pd / (n * 3 * 255)));
      times.push(f.t);
    }
    prevHist = hist;
    prevPix = new Uint8ClampedArray(f.data);
    if (times.length % 30 === 0) onProgress("Looking for scene changes", Math.min(1, (f.t - a) / Math.max(0.001, b - a)));
  }
  const cuts: number[] = [];
  const minGap = 0.6;
  const floor = 0.18 + (1 - sensitivity) * 0.3;
  for (let i = 0; i < scores.length; i++) {
    let sum = 0;
    let sq = 0;
    let k = 0;
    for (let j = Math.max(0, i - 15); j <= Math.min(scores.length - 1, i + 15); j++) {
      if (j === i) continue;
      sum += scores[j];
      sq += scores[j] * scores[j];
      k++;
    }
    const mean = k ? sum / k : 0;
    const std = k ? Math.sqrt(Math.max(0, sq / k - mean * mean)) : 0;
    const isPeak = scores[i] >= (scores[i - 1] ?? 0) && scores[i] >= (scores[i + 1] ?? 0);
    if (isPeak && scores[i] > floor && scores[i] > mean + (2.5 + (1 - sensitivity) * 2) * std) {
      const t = c.start + localForSrc(c, times[i] - c.in);
      if (t > c.start + 0.1 && t < c.start + c.duration - 0.1 && (!cuts.length || t - cuts[cuts.length - 1] >= minGap)) cuts.push(rt(t));
    }
  }
  return cuts;
}

/* ---------- Stabilisation ---------- */

/** 1-D shift between two profiles (sum of absolute differences), with a sub-pixel parabola fit. */
function profileShift(prev: Float32Array, cur: Float32Array, maxS: number) {
  let best = 0;
  let bestE = Infinity;
  const errs: number[] = [];
  for (let s = -maxS; s <= maxS; s++) {
    let e = 0;
    let n = 0;
    for (let i = Math.max(0, -s); i < prev.length && i + s < cur.length; i++) {
      e += Math.abs(prev[i] - cur[i + s]);
      n++;
    }
    e /= Math.max(1, n);
    errs.push(e);
    if (e < bestE) {
      bestE = e;
      best = s;
    }
  }
  const i = best + maxS;
  if (i > 0 && i < errs.length - 1) {
    const d = errs[i - 1] - 2 * errs[i] + errs[i + 1];
    if (d > 1e-9) return best + (0.5 * (errs[i - 1] - errs[i + 1])) / d;
  }
  return best;
}

/**
 * Measures camera shake (global motion) from frame to frame with projection profiles: each frame's
 * row and column brightness sums are matched against the last frame's. The measured path is stored
 * on the clip and smoothed when drawing, so the strength can change later without measuring again.
 */
export async function analyzeShake(clipId: string, onProgress: Progress, strength = 0.6): Promise<StabilizeData> {
  const p = useStudio.getState().project;
  const c = p.clips[clipId];
  if (!c || c.kind !== "video" || !c.mediaId) throw new Error("Select a video clip to stabilise.");
  const m = p.media[c.mediaId];
  const a = c.in;
  const b = Math.min(m?.duration || Infinity, c.in + srcSpan(c));
  if (b - a > 600) throw new Error("Stabilise works on up to 10 minutes at a time. Split the clip first.");
  const W = 160;
  const times: number[] = [];
  const xs: number[] = [];
  const ys: number[] = [];
  let px: Float32Array | null = null;
  let py: Float32Array | null = null;
  let cx = 0;
  let cy = 0;
  let k = 0;
  for await (const f of smallFrames(c.mediaId, a, b, W)) {
    const cols = new Float32Array(f.w);
    const rows = new Float32Array(f.h);
    for (let y = 0; y < f.h; y++) {
      for (let x = 0; x < f.w; x++) {
        const i = (y * f.w + x) * 4;
        const g = 0.299 * f.data[i] + 0.587 * f.data[i + 1] + 0.114 * f.data[i + 2];
        cols[x] += g / f.h;
        rows[y] += g / f.w;
      }
    }
    // Profiles of the gradient, not the brightness: lighting changes don't read as motion.
    const dc = new Float32Array(f.w);
    const dr = new Float32Array(f.h);
    for (let i = 1; i < f.w; i++) dc[i] = cols[i] - cols[i - 1];
    for (let i = 1; i < f.h; i++) dr[i] = rows[i] - rows[i - 1];
    if (px && py) {
      cx += profileShift(px, dc, Math.round(f.w * 0.1)) / f.w;
      cy += profileShift(py, dr, Math.round(f.h * 0.1)) / f.h;
    }
    px = dc;
    py = dr;
    times.push(f.t);
    xs.push(cx);
    ys.push(cy);
    if (++k % 20 === 0) onProgress("Measuring camera shake", Math.min(1, (f.t - a) / Math.max(0.001, b - a)));
  }
  if (times.length < 4) throw new Error("The clip is too short to stabilise.");
  // Resample the path onto an even grid (frames may not be evenly spaced).
  const rate = Math.min(30, Math.max(10, Math.round((times.length - 1) / Math.max(0.001, times[times.length - 1] - times[0]))));
  const n = Math.max(2, Math.ceil((times[times.length - 1] - times[0]) * rate) + 1);
  const dx: number[] = [];
  const dy: number[] = [];
  let j = 0;
  for (let i = 0; i < n; i++) {
    const t = times[0] + i / rate;
    while (j < times.length - 2 && times[j + 1] < t) j++;
    const f = Math.min(1, Math.max(0, (t - times[j]) / Math.max(1e-6, times[j + 1] - times[j])));
    dx.push(Math.round((xs[j] + (xs[j + 1] - xs[j]) * f) * 1e5) / 1e5);
    dy.push(Math.round((ys[j] + (ys[j + 1] - ys[j]) * f) * 1e5) / 1e5);
  }
  return { strength, rate, t0: times[0], dx, dy };
}

/* ---------- Auto-reframe ---------- */

/**
 * Auto-reframe (Premiere's Auto Reframe, CapCut's auto-resize): for a clip whose shape doesn't match
 * the frame (16:9 footage in a 9:16 video), it fills the frame and pans to keep the person in shot.
 * The person is found by the same on-device segmenter as background removal, 4 times a second; the
 * path is smoothed and written as Position keyframes you can still edit.
 */
export async function autoReframe(clipId: string, onProgress: Progress): Promise<number> {
  const st = useStudio.getState();
  const p = st.project;
  const c = p.clips[clipId];
  if (!c || c.kind !== "video" || !c.mediaId) throw new Error("Select a video clip to reframe.");
  const m = p.media[c.mediaId];
  if (!m?.width || !m.height) throw new Error("This clip's size isn't known yet.");
  onProgress("Loading the person finder");
  await loadSegmenter();
  const a = c.in;
  const b = c.in + srcSpan(c);
  const step = 0.25;
  const samples: { t: number; u: number | null; v: number | null }[] = [];
  let next = a;
  for await (const f of smallFrames(c.mediaId, a, b, 256)) {
    if (f.t + 1e-6 < next) continue;
    next = f.t + step;
    const img = new ImageData(new Uint8ClampedArray(f.data), f.w, f.h);
    const bmp = await createImageBitmap(img);
    const matte = segmentFrame(bmp);
    bmp.close();
    let mass = 0;
    let sx = 0;
    let sy = 0;
    if (matte) {
      for (let y = 0; y < matte.height; y++) {
        for (let x = 0; x < matte.width; x++) {
          const w = matte.data[y * matte.width + x] / 255;
          if (w < 0.5) continue;
          mass += w;
          sx += w * (x + 0.5);
          sy += w * (y + 0.5);
        }
      }
    }
    const enough = matte && mass > matte.width * matte.height * 0.004;
    // The head matters most when framing: aim a little above the body's centre.
    samples.push({ t: f.t, u: enough ? sx / mass / matte!.width : null, v: enough ? Math.max(0, sy / mass / matte!.height - 0.12) : null });
    onProgress("Following the subject", Math.min(1, (f.t - a) / Math.max(0.001, b - a)));
  }
  if (!samples.length) throw new Error("Couldn't read the clip's frames.");
  // Fill gaps with the nearest known position, then smooth (a slow, steady pan, like a camera operator).
  let last = samples.find((s) => s.u !== null)?.u ?? 0.5;
  const us = samples.map((s) => {
    if (s.u !== null) last = s.u;
    return last;
  });
  const vs = samples.map((s) => (s.v === null ? 0.45 : s.v));
  const smooth = (arr: number[], r: number) => arr.map((_, i) => {
    let acc = 0;
    let n = 0;
    for (let j = Math.max(0, i - r); j <= Math.min(arr.length - 1, i + r); j++) {
      acc += arr[j];
      n++;
    }
    return acc / n;
  });
  const su = smooth(smooth(us, 4), 4);
  const sv = smooth(smooth(vs, 4), 4);
  const W = p.settings.width;
  const H = p.settings.height;
  const [bw, bh] = TL.fitSize(m.width, m.height, W, H, "cover");
  const keysX: Keyframe[] = [];
  const keysY: Keyframe[] = [];
  for (let i = 0; i < samples.length; i += 2) {
    const local = rt(Math.min(c.duration, Math.max(0, localForSrc(c, samples[i].t - c.in))));
    const x = bw > W ? Math.min(bw / 2, Math.max(W - bw / 2, W / 2 - (su[i] - 0.5) * bw)) : W / 2;
    const y = bh > H ? Math.min(bh / 2, Math.max(H - bh / 2, H / 2 - (sv[i] - 0.5) * bh)) : H / 2;
    if (!keysX.length || Math.abs(keysX[keysX.length - 1].v - x) > 0.5 || i >= samples.length - 2) keysX.push({ id: uid("k"), t: local, v: rt(x), ease: "easeInOut" });
    if (bh > H) keysY.push({ id: uid("k"), t: local, v: rt(y), ease: "easeInOut" });
  }
  useStudio.getState().commit((proj) =>
    TL.updateClip(proj, clipId, (x) => ({
      ...x,
      fit: "cover",
      transform: {
        ...x.transform,
        x: keysX.length > 1 ? { v: keysX[0].v, k: keysX } : anim(keysX[0]?.v ?? W / 2),
        y: keysY.length > 1 ? { v: keysY[0].v, k: keysY } : anim(H / 2),
        scaleX: anim(1),
        scaleY: anim(1),
        rotation: anim(0),
      },
    })),
  );
  return keysX.length;
}

/* ---------- Beats ---------- */

function fft(re: Float32Array, im: Float32Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k];
        const ai = im[i + k];
        const br = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const bi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ar + br;
        im[i + k] = ai + bi;
        re[i + k + len / 2] = ar - br;
        im[i + k + len / 2] = ai - bi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

/** Spectral-flux onset strength, about 86 values a second. */
function onsetEnvelope(pcm: Float32Array, rate: number) {
  const N = 1024;
  const hop = 256;
  const frames = Math.max(0, Math.floor((pcm.length - N) / hop));
  const env = new Float32Array(frames);
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
  let prev = new Float32Array(N / 2);
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < N; i++) {
      re[i] = pcm[f * hop + i] * win[i];
      im[i] = 0;
    }
    fft(re, im);
    const mag = new Float32Array(N / 2);
    let flux = 0;
    for (let k = 1; k < N / 2; k++) {
      mag[k] = Math.log1p(10 * Math.hypot(re[k], im[k]));
      const d = mag[k] - prev[k];
      if (d > 0) flux += d;
    }
    env[f] = flux;
    prev = mag;
  }
  return { env, fps: rate / hop };
}

/**
 * Beat detection (Final Cut's and CapCut's beat markers): an onset envelope from spectral flux, the
 * tempo from its autocorrelation (60-180 BPM, favouring ~120), then the beat grid placed where the
 * onsets are strongest and nudged onto each actual hit. Returns timeline times.
 */
export async function detectBeats(clip: Clip, onProgress: Progress): Promise<{ bpm: number; beats: number[] }> {
  const file = clip.mediaId ? mediaRuntime.file(clip.mediaId) : null;
  if (!file) throw new Error("This clip's media isn't on this device.");
  const RATE = 22_050;
  const span = srcSpan(clip);
  const pcm = await extractPcm(file, clip.in, clip.in + span, RATE, (f) => onProgress("Listening for the beat", f * 0.7));
  onProgress("Finding the tempo", 0.75);
  const { env, fps } = onsetEnvelope(pcm, RATE);
  if (env.length < fps * 3) throw new Error("The clip is too short to find a beat.");
  // Remove the local average so only the hits stand out.
  const r = Math.round(fps * 0.5);
  const onset = new Float32Array(env.length);
  for (let i = 0; i < env.length; i++) {
    let acc = 0;
    let n = 0;
    for (let j = Math.max(0, i - r); j <= Math.min(env.length - 1, i + r); j++) {
      acc += env[j];
      n++;
    }
    onset[i] = Math.max(0, env[i] - acc / n);
  }
  let bestLag = 0;
  let bestScore = -Infinity;
  for (let bpm = 60; bpm <= 180; bpm += 0.5) {
    const lag = (60 / bpm) * fps;
    let s = 0;
    for (let i = 0; i + lag < onset.length; i++) {
      const j = i + lag;
      const j0 = Math.floor(j);
      s += onset[i] * (onset[j0] * (1 - (j - j0)) + (onset[j0 + 1] ?? 0) * (j - j0));
    }
    s *= Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2));
    if (s > bestScore) {
      bestScore = s;
      bestLag = lag;
    }
  }
  let bestPhase = 0;
  let phaseScore = -Infinity;
  for (let ph = 0; ph < bestLag; ph += 0.5) {
    let s = 0;
    for (let t = ph; t < onset.length; t += bestLag) s += onset[Math.round(t)] ?? 0;
    if (s > phaseScore) {
      phaseScore = s;
      bestPhase = ph;
    }
  }
  const beats: number[] = [];
  const tol = Math.max(1, Math.round(bestLag * 0.12));
  for (let t = bestPhase; t < onset.length; t += bestLag) {
    let at = Math.round(t);
    let peak = -1;
    for (let j = Math.max(0, at - tol); j <= Math.min(onset.length - 1, at + tol); j++) {
      if (onset[j] > peak) {
        peak = onset[j];
        at = j;
      }
    }
    const src = (at * 256 + 512) / RATE;
    const tl = clip.start + localForSrc(clip, src);
    if (tl >= clip.start && tl <= clip.start + clip.duration) beats.push(rt(tl));
  }
  onProgress("Done", 1);
  return { bpm: Math.round((60 * fps) / bestLag), beats };
}

/* ---------- Loudness ---------- */

/**
 * Integrated loudness (LUFS) of a clip's sound per ITU-R BS.1770: K-weighting filters, 400 ms blocks
 * with 75% overlap, the absolute (-70 LUFS) and relative (-10 LU) gates.
 */
export async function measureLoudness(clip: Clip, onProgress?: (f: number) => void): Promise<number> {
  const file = clip.mediaId ? mediaRuntime.file(clip.mediaId) : null;
  if (!file) throw new Error("This clip's media isn't on this device.");
  const RATE = 48_000;
  const span = srcSpan(clip);
  const src = new SourceAudio(file);
  const blockPowers: number[] = [];
  const WIN = 30;
  const block = Math.round(0.4 * RATE);
  const hop = Math.round(0.1 * RATE);
  try {
    for (let w = 0; w < span - 1e-6; w += WIN) {
      const we = Math.min(span, w + WIN);
      const len = Math.max(1, Math.round((we - w) * RATE));
      const ctx = new OfflineAudioContext(2, len, RATE);
      const shelf = ctx.createBiquadFilter();
      shelf.type = "highshelf";
      shelf.frequency.value = 1681;
      shelf.gain.value = 4;
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 38;
      hp.Q.value = 0.5;
      shelf.connect(hp).connect(ctx.destination);
      await src.schedule(ctx, shelf, clip.in + w, clip.in + we, 0, 1);
      const buf = await ctx.startRendering();
      const chs = [buf.getChannelData(0), buf.numberOfChannels > 1 ? buf.getChannelData(1) : buf.getChannelData(0)];
      for (let s = 0; s + block <= len; s += hop) {
        let pw = 0;
        for (const ch of chs) {
          let acc = 0;
          for (let i = s; i < s + block; i++) acc += ch[i] * ch[i];
          pw += acc / block;
        }
        blockPowers.push(pw);
      }
      onProgress?.(we / span);
    }
  } finally {
    src.dispose();
  }
  const lufs = (pw: number) => -0.691 + 10 * Math.log10(pw + 1e-12);
  const abs = blockPowers.filter((pw) => lufs(pw) > -70);
  if (!abs.length) return -70;
  const mean = abs.reduce((a, b) => a + b, 0) / abs.length;
  const rel = abs.filter((pw) => lufs(pw) > lufs(mean) - 10);
  return lufs(rel.reduce((a, b) => a + b, 0) / Math.max(1, rel.length));
}

/** Sets each clip's volume so it plays at `target` LUFS (YouTube and most apps use -14). Returns the changes made. */
export async function normalizeLoudness(clipIds: string[], target: number, onProgress: Progress) {
  const p = useStudio.getState().project;
  const clips = clipIds.map((id) => p.clips[id]).filter((c): c is Clip => !!c && c.kind === "audio" && !!c.mediaId);
  if (!clips.length) throw new Error("Select sound clips (or a video with sound) to even out.");
  const changes: { id: string; gain: number; from: number }[] = [];
  for (const [i, c] of clips.entries()) {
    const l = await measureLoudness(c, (f) => onProgress(`Measuring loudness (${i + 1} of ${clips.length})`, f));
    if (l <= -69) continue;
    changes.push({ id: c.id, gain: Math.pow(10, (target - l) / 20), from: l });
  }
  useStudio.getState().commit((proj) => {
    let next = proj;
    for (const ch of changes) {
      next = TL.updateClip(next, ch.id, (c) => {
        const k = Math.min(4, Math.max(0.05, ch.gain));
        const v = c.volume.k?.length ? { ...c.volume, k: c.volume.k.map((x) => ({ ...x, v: Math.min(4, x.v * k) })) } : anim(Math.min(4, Math.max(0, k)));
        return { ...c, volume: v };
      });
    }
    return next;
  });
  return changes;
}

/* ---------- Ducking ---------- */

/** Where someone is talking, as timeline ranges (20 ms loudness frames, gaps under 0.4 s bridged). */
async function speechRanges(p: Project, clips: Clip[], onProgress: Progress): Promise<[number, number][]> {
  const RATE = 8000;
  const out: [number, number][] = [];
  for (const [i, c] of clips.entries()) {
    const file = c.mediaId ? mediaRuntime.file(c.mediaId) : null;
    if (!file) continue;
    const pcm = await extractPcm(file, c.in, c.in + srcSpan(c), RATE, (f) => onProgress(`Listening for speech (${i + 1} of ${clips.length})`, f));
    const win = RATE * 0.02;
    let start = -1;
    let quietSince = -1;
    for (let k = 0; k * win < pcm.length; k++) {
      let sum = 0;
      for (let j = k * win; j < Math.min(pcm.length, (k + 1) * win); j++) sum += pcm[j] * pcm[j];
      const db = 10 * Math.log10(sum / win + 1e-12);
      const t = (k * win) / RATE;
      if (db > -40) {
        if (start < 0) start = t;
        quietSince = -1;
      } else if (start >= 0) {
        if (quietSince < 0) quietSince = t;
        if (t - quietSince > 0.4) {
          out.push([rt(c.start + localForSrc(c, start)), rt(c.start + localForSrc(c, quietSince))]);
          start = -1;
          quietSince = -1;
        }
      }
    }
    if (start >= 0) out.push([rt(c.start + localForSrc(c, start)), rt(c.start + c.duration)]);
  }
  void p;
  return out.sort((a, b) => a[0] - b[0]);
}

/**
 * Auto-ducking (Premiere's Essential Sound "Ducking"): lowers the music under speech. Speech is
 * found by loudness on the voice track; each music clip gets volume keyframes that dip by `duckDb`
 * with a short fade down and a slower recovery.
 */
export async function autoDuck(voiceTrackId: string, musicTrackId: string, duckDb: number, onProgress: Progress) {
  const p = useStudio.getState().project;
  const voices = TL.clipsOnTrack(p, voiceTrackId).filter((c) => c.kind === "audio" && !c.muted);
  const music = TL.clipsOnTrack(p, musicTrackId).filter((c) => c.kind === "audio");
  if (!voices.length) throw new Error("The voice track has no sound clips.");
  if (!music.length) throw new Error("The music track has no sound clips.");
  const speech = await speechRanges(p, voices, onProgress);
  const attack = 0.25;
  const release = 0.6;
  const factor = Math.pow(10, duckDb / 20);
  useStudio.getState().commit((proj) => {
    let next = proj;
    for (const m of music) {
      next = TL.updateClip(next, m.id, (c) => {
        const base = c.volume.k?.length ? c.volume.k[0].v : c.volume.v;
        const low = base * factor;
        const keys: Keyframe[] = [];
        const push = (t: number, v: number) => {
          const local = rt(t - c.start);
          if (local < 0 || local > c.duration) return;
          const last = keys[keys.length - 1];
          if (last && local <= last.t + 1e-3) {
            last.v = Math.min(last.v, v);
            return;
          }
          keys.push({ id: uid("k"), t: local, v, ease: "easeInOut" });
        };
        push(c.start, base);
        for (const [a, b] of speech) {
          if (b < c.start || a > c.start + c.duration) continue;
          push(Math.max(c.start, a - attack), base);
          push(Math.max(c.start, a), low);
          push(Math.min(c.start + c.duration, b), low);
          push(Math.min(c.start + c.duration, b + release), base);
        }
        return keys.length > 1 ? { ...c, volume: { v: base, k: keys } } : c;
      });
    }
    return next;
  });
  return speech.length;
}
