import { CanvasSink } from "mediabunny";
import { localForSrc, srcOffset, srcSpan } from "../../lib/speed";
import { rt, uid } from "../../lib/time";
import * as TL from "../../lib/timeline";
import { useStudio } from "../../store/studio-store";
import type { Keyframe, TrackPointData } from "../../types";
import { mediaRuntime, openInput } from "../media";
import type { Progress } from "./captions";

/**
 * 2D Point Motion Tracker using zero-mean normalized cross-correlation (ZNCC) with sub-pixel
 * parabolic peak refinement. Runs 100% locally in the browser on downscaled 320px frames.
 */

type LumaFrame = { t: number; luma: Float32Array; w: number; h: number };

const TRACK_WIDTH = 320;
const HALF_PATCH = 7;
const SEARCH_R = 24;
const MAX_SAMPLES = 180;

function toLuma(rgba: Uint8ClampedArray, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    out[i] = 0.2126 * rgba[i * 4] + 0.7152 * rgba[i * 4 + 1] + 0.0722 * rgba[i * 4 + 2];
  }
  return out;
}

function samplePatch(luma: Float32Array, w: number, h: number, cx: number, cy: number, half: number): Float32Array {
  const size = half * 2 + 1;
  const patch = new Float32Array(size * size);
  let idx = 0;
  for (let dy = -half; dy <= half; dy++) {
    const y = Math.max(0, Math.min(h - 1, Math.round(cy + dy)));
    for (let dx = -half; dx <= half; dx++) {
      const x = Math.max(0, Math.min(w - 1, Math.round(cx + dx)));
      patch[idx++] = luma[y * w + x];
    }
  }
  return patch;
}

function zncc(patch: Float32Array, luma: Float32Array, w: number, h: number, cx: number, cy: number, half: number): number {
  const size = half * 2 + 1;
  const n = size * size;
  let meanP = 0;
  let meanI = 0;
  for (let i = 0; i < n; i++) meanP += patch[i];
  meanP /= n;

  for (let dy = -half; dy <= half; dy++) {
    const y = Math.max(0, Math.min(h - 1, cy + dy));
    for (let dx = -half; dx <= half; dx++) {
      const x = Math.max(0, Math.min(w - 1, cx + dx));
      meanI += luma[y * w + x];
    }
  }
  meanI /= n;

  let num = 0;
  let denP = 0;
  let denI = 0;
  let idx = 0;
  for (let dy = -half; dy <= half; dy++) {
    const y = Math.max(0, Math.min(h - 1, cy + dy));
    for (let dx = -half; dx <= half; dx++) {
      const x = Math.max(0, Math.min(w - 1, cx + dx));
      const dp = patch[idx++] - meanP;
      const di = luma[y * w + x] - meanI;
      num += dp * di;
      denP += dp * dp;
      denI += di * di;
    }
  }
  const denom = Math.sqrt(denP * denI);
  return denom > 1e-3 ? num / denom : 0;
}

function searchBest(patch: Float32Array, luma: Float32Array, w: number, h: number, hintX: number, hintY: number): { x: number; y: number; score: number } {
  const minX = Math.max(HALF_PATCH, Math.floor(hintX - SEARCH_R));
  const maxX = Math.min(w - 1 - HALF_PATCH, Math.ceil(hintX + SEARCH_R));
  const minY = Math.max(HALF_PATCH, Math.floor(hintY - SEARCH_R));
  const maxY = Math.min(h - 1 - HALF_PATCH, Math.ceil(hintY + SEARCH_R));
  let bestX = Math.max(minX, Math.min(maxX, Math.round(hintX)));
  let bestY = Math.max(minY, Math.min(maxY, Math.round(hintY)));
  let bestScore = -2;

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const s = zncc(patch, luma, w, h, x, y, HALF_PATCH);
      if (s > bestScore) {
        bestScore = s;
        bestX = x;
        bestY = y;
      }
    }
  }

  // Parabolic sub-pixel refinement
  const sxL = bestX > minX ? zncc(patch, luma, w, h, bestX - 1, bestY, HALF_PATCH) : bestScore;
  const sxR = bestX < maxX ? zncc(patch, luma, w, h, bestX + 1, bestY, HALF_PATCH) : bestScore;
  const denomX = sxL - 2 * bestScore + sxR;
  const subX = Math.abs(denomX) > 1e-4 ? Math.max(-0.5, Math.min(0.5, (0.5 * (sxL - sxR)) / denomX)) : 0;

  const syU = bestY > minY ? zncc(patch, luma, w, h, bestX, bestY - 1, HALF_PATCH) : bestScore;
  const syD = bestY < maxY ? zncc(patch, luma, w, h, bestX, bestY + 1, HALF_PATCH) : bestScore;
  const denomY = syU - 2 * bestScore + syD;
  const subY = Math.abs(denomY) > 1e-4 ? Math.max(-0.5, Math.min(0.5, (0.5 * (syU - syD)) / denomY)) : 0;

  return { x: bestX + subX, y: bestY + subY, score: bestScore };
}

/** Tracks an anchor point `(anchorX, anchorY)` (0..1 in clip picture space) across a video clip. */
export async function trackPoint(clipId: string, anchorX: number, anchorY: number, startLocalTime: number, onProgress: Progress): Promise<TrackPointData> {
  const p = useStudio.getState().project;
  const c = p.clips[clipId];
  if (!c || c.kind !== "video" || !c.mediaId) throw new Error("Select a video clip to track.");
  const file = mediaRuntime.file(c.mediaId);
  if (!file) throw new Error("This clip's media isn't on this device.");

  const a = c.in;
  const span = Math.max(0.05, srcSpan(c));
  const b = a + span;
  const frames: LumaFrame[] = [];

  const input = openInput(file);
  try {
    const vt = await input.getPrimaryVideoTrack();
    if (!vt) throw new Error("This clip has no picture.");
    const w = TRACK_WIDTH;
    const h = Math.max(24, Math.round((TRACK_WIDTH * vt.displayHeight) / Math.max(1, vt.displayWidth)));
    const sink = new CanvasSink(vt, { width: w, height: h, fit: "fill", poolSize: 2 });
    const cv = new OffscreenCanvas(w, h);
    const ctx = cv.getContext("2d", { willReadFrequently: true })!;
    const minDt = span / MAX_SAMPLES;
    let nextEmit = a;

    for await (const wc of sink.canvases(a, b)) {
      if (wc.timestamp + 1e-4 < nextEmit && frames.length > 0) continue;
      ctx.drawImage(wc.canvas, 0, 0, w, h);
      frames.push({ t: wc.timestamp, luma: toLuma(ctx.getImageData(0, 0, w, h).data, w, h), w, h });
      nextEmit = wc.timestamp + minDt;
      if (frames.length % 15 === 0) onProgress("Reading frames for motion tracking", Math.min(0.5, ((wc.timestamp - a) / span) * 0.5));
    }
  } finally {
    input.dispose();
  }

  if (frames.length < 2) throw new Error("Not enough video frames to track motion.");

  const refSourceT = a + srcOffset(c, Math.max(0, Math.min(c.duration, startLocalTime)));
  let refIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < frames.length; i++) {
    const d = Math.abs(frames[i].t - refSourceT);
    if (d < bestDist) {
      bestDist = d;
      refIdx = i;
    }
  }

  const ref = frames[refIdx];
  const initX = Math.max(HALF_PATCH, Math.min(ref.w - 1 - HALF_PATCH, anchorX * ref.w));
  const initY = Math.max(HALF_PATCH, Math.min(ref.h - 1 - HALF_PATCH, anchorY * ref.h));
  const xs = new Float32Array(frames.length);
  const ys = new Float32Array(frames.length);
  xs[refIdx] = initX;
  ys[refIdx] = initY;

  // Forward pass from anchor frame
  let patch = samplePatch(ref.luma, ref.w, ref.h, initX, initY, HALF_PATCH);
  let curX = initX;
  let curY = initY;
  for (let i = refIdx + 1; i < frames.length; i++) {
    const res = searchBest(patch, frames[i].luma, frames[i].w, frames[i].h, curX, curY);
    curX = res.x;
    curY = res.y;
    xs[i] = curX;
    ys[i] = curY;
    if (res.score > 0.78) {
      const fresh = samplePatch(frames[i].luma, frames[i].w, frames[i].h, curX, curY, HALF_PATCH);
      for (let k = 0; k < patch.length; k++) patch[k] = patch[k] * 0.92 + fresh[k] * 0.08;
    }
    if (i % 15 === 0) onProgress("Tracking point forward", 0.5 + (i / frames.length) * 0.25);
  }

  // Backward pass from anchor frame
  patch = samplePatch(ref.luma, ref.w, ref.h, initX, initY, HALF_PATCH);
  curX = initX;
  curY = initY;
  for (let i = refIdx - 1; i >= 0; i--) {
    const res = searchBest(patch, frames[i].luma, frames[i].w, frames[i].h, curX, curY);
    curX = res.x;
    curY = res.y;
    xs[i] = curX;
    ys[i] = curY;
    if (res.score > 0.78) {
      const fresh = samplePatch(frames[i].luma, frames[i].w, frames[i].h, curX, curY, HALF_PATCH);
      for (let k = 0; k < patch.length; k++) patch[k] = patch[k] * 0.92 + fresh[k] * 0.08;
    }
    if (i % 15 === 0) onProgress("Tracking point backward", 0.75 + ((refIdx - i) / frames.length) * 0.25);
  }

  const dx: number[] = [];
  const dy: number[] = [];
  for (let i = 0; i < frames.length; i++) {
    dx.push(Number(((xs[i] - initX) / frames[i].w).toFixed(5)));
    dy.push(Number(((ys[i] - initY) / frames[i].h).toFixed(5)));
  }

  const rate = (frames.length - 1) / Math.max(0.05, frames[frames.length - 1].t - frames[0].t);
  const trackData: TrackPointData = {
    x: Number(anchorX.toFixed(4)),
    y: Number(anchorY.toFixed(4)),
    rate,
    t0: frames[0].t,
    dx,
    dy,
  };

  useStudio.getState().commit((proj) => TL.updateClip(proj, clipId, (clip) => ({ ...clip, trackData })));
  onProgress("Track complete", 1);
  return trackData;
}

/** Converts a source clip's measured `TrackPointData` into keyframed X/Y position animation on any target clip. */
export function applyTrackToClip(sourceClipId: string, targetClipId: string) {
  const s = useStudio.getState();
  const src = s.project.clips[sourceClipId];
  const tgt = s.project.clips[targetClipId];
  if (!src?.trackData || !tgt) throw new Error("Missing tracked motion data or target clip.");

  const td = src.trackData;
  const n = td.dx.length;
  if (n < 2) return;

  const asset = src.mediaId ? s.project.media[src.mediaId] : undefined;
  const W = s.project.settings.width;
  const H = s.project.settings.height;
  const [fitW, fitH] = TL.fitSize(asset?.width || W, asset?.height || H, W, H, src.fit);
  const pxScaleX = fitW * src.transform.scaleX.v * (src.flipH ? -1 : 1);
  const pxScaleY = fitH * src.transform.scaleY.v * (src.flipV ? -1 : 1);

  const baseX = tgt.transform.x.v;
  const baseY = tgt.transform.y.v;
  const kx: Keyframe[] = [];
  const ky: Keyframe[] = [];
  const stride = Math.max(1, Math.floor(n / 60));

  for (let i = 0; i < n; i += stride) {
    const srcTime = td.t0 + i / td.rate;
    const tlTime = src.start + localForSrc(src, srcTime - src.in);
    const tgtLocal = rt(tlTime - tgt.start);
    if (tgtLocal < -0.05 || tgtLocal > tgt.duration + 0.05) continue;
    const tClamped = Math.max(0, Math.min(tgt.duration, tgtLocal));
    kx.push({ id: uid("k"), t: tClamped, v: Math.round((baseX + td.dx[i] * pxScaleX) * 10) / 10, ease: "linear" });
    ky.push({ id: uid("k"), t: tClamped, v: Math.round((baseY + td.dy[i] * pxScaleY) * 10) / 10, ease: "linear" });
  }

  if (kx.length < 2) throw new Error("Target clip doesn't overlap the tracked footage time range.");

  s.commit((proj) =>
    TL.updateClip(proj, targetClipId, (clip) => ({
      ...clip,
      transform: {
        ...clip.transform,
        x: { v: kx[0].v, k: kx },
        y: { v: ky[0].v, k: ky },
      },
    })),
  );
}
