import type { Anim, Bezier, Ease, Keyframe } from "../types";
import { rt, uid } from "./time";

/**
 * Keyframe engine. A keyframe's `ease` shapes the segment that leaves it (to the next keyframe),
 * like After Effects' outgoing interpolation. Before the first keyframe the value holds at the
 * first; after the last, at the last.
 */

export const EASE_CURVES: Record<"easeIn" | "easeOut" | "easeInOut", Bezier> = {
  easeIn: [0.42, 0, 1, 1],
  easeOut: [0, 0, 0.58, 1],
  easeInOut: [0.42, 0, 0.58, 1],
};

function easeOutBounce(x: number): number {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (x < 1 / d1) return n1 * x * x;
  if (x < 2 / d1) {
    const t = x - 1.5 / d1;
    return n1 * t * t + 0.75;
  }
  if (x < 2.5 / d1) {
    const t = x - 2.25 / d1;
    return n1 * t * t + 0.9375;
  }
  const t = x - 2.625 / d1;
  return n1 * t * t + 0.984375;
}

/** Two keyframes closer than this are the same keyframe (well under a frame at 240 fps). */
export const KEY_EPS = 1 / 480;

/**
 * cubic-bezier(x1, y1, x2, y2) as a function of progress, solved the way browsers solve CSS easing:
 * Newton-Raphson on x(t) = p, falling back to bisection where the slope is flat.
 */
export function cubicBezier([x1, y1, x2, y2]: Bezier) {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const slopeX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  const solveX = (x: number) => {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const err = sampleX(t) - x;
      if (Math.abs(err) < 1e-6) return t;
      const d = slopeX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    let lo = 0;
    let hi = 1;
    t = x;
    for (let i = 0; i < 40 && hi - lo > 1e-7; i++) {
      const v = sampleX(t);
      if (Math.abs(v - x) < 1e-6) return t;
      if (x > v) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return t;
  };
  return (p: number) => (p <= 0 ? 0 : p >= 1 ? 1 : sampleY(solveX(p)));
}

const curveCache = new Map<string, (p: number) => number>();
function curve(b: Bezier) {
  const key = b.join(",");
  let f = curveCache.get(key);
  if (!f) {
    f = cubicBezier(b);
    if (curveCache.size > 256) curveCache.clear();
    curveCache.set(key, f);
  }
  return f;
}

export function easeProgress(k: Keyframe, p: number) {
  switch (k.ease) {
    case "linear":
      return p;
    case "hold":
      return 0;
    case "bezier":
      return curve(k.bezier ?? EASE_CURVES.easeInOut)(p);
    case "back": {
      const s = 1.70158;
      const x = p - 1;
      return 1 + (s + 1) * x * x * x + s * x * x;
    }
    case "elastic":
      return p <= 0 ? 0 : p >= 1 ? 1 : Math.pow(2, -10 * p) * Math.sin((p * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
    case "bounce":
      return easeOutBounce(p);
    default:
      return curve(EASE_CURVES[k.ease])(p);
  }
}

export function bezierOf(k: Keyframe): Bezier {
  if (k.ease === "bezier") return k.bezier ?? EASE_CURVES.easeInOut;
  if (k.ease === "linear") return [0, 0, 1, 1];
  if (k.ease === "hold") return [1, 0, 1, 0];
  if (k.ease === "back") return [0.34, 1.56, 0.64, 1];
  if (k.ease === "elastic") return [0.22, 1.4, 0.36, 1];
  if (k.ease === "bounce") return [0.25, 1.2, 0.5, 1];
  return EASE_CURVES[k.ease];
}

/** The value at clip-local time `t`. */
export function evalAnim(a: Anim, t: number): number {
  const k = a.k;
  if (!k || k.length === 0) return a.v;
  if (k.length === 1 || t <= k[0].t) return k[0].v;
  const last = k[k.length - 1];
  if (t >= last.t) return last.v;
  let lo = 0;
  let hi = k.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (k[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const k0 = k[lo];
  const k1 = k[hi];
  const span = k1.t - k0.t;
  if (span <= 0) return k1.v;
  return k0.v + (k1.v - k0.v) * easeProgress(k0, (t - k0.t) / span);
}

export const isAnimated = (a: Anim | undefined) => !!a?.k && a.k.length > 0;
export const anim = (v: number): Anim => ({ v });

export function keyAt(a: Anim, t: number): Keyframe | undefined {
  return a.k?.find((k) => Math.abs(k.t - t) < KEY_EPS);
}

const sortKeys = (k: Keyframe[]) => [...k].sort((a, b) => a.t - b.t);

/** Adds a keyframe at `t`, or changes the one already there. */
export function setKey(a: Anim, t: number, v: number, ease?: Ease): Anim {
  const k = a.k ?? [];
  const existing = k.find((x) => Math.abs(x.t - t) < KEY_EPS);
  if (existing) return { ...a, k: k.map((x) => (x === existing ? { ...x, v, ...(ease ? { ease } : {}) } : x)) };
  // A new keyframe inherits the easing of the segment it lands in, so splitting a curve keeps its feel.
  const before = [...k].reverse().find((x) => x.t < t);
  return { ...a, k: sortKeys([...k, { id: uid("k"), t: rt(t), v, ease: ease ?? before?.ease ?? "easeInOut", ...(before?.bezier ? { bezier: before.bezier } : {}) }]) };
}

/**
 * What a property edit does: with keyframes, it keys the value at the playhead (After Effects with the
 * stopwatch on); without, it changes the static value.
 */
export function editAnim(a: Anim, t: number, v: number): Anim {
  return isAnimated(a) ? setKey(a, t, v) : { v };
}

/** The stopwatch: start animating at `t` with the current value, or stop and keep the value at `t`. */
export function toggleAnimated(a: Anim, t: number): Anim {
  if (isAnimated(a)) return { v: evalAnim(a, t) };
  return { v: a.v, k: [{ id: uid("k"), t: rt(t), v: a.v, ease: "easeInOut" }] };
}

/** The diamond button: add a keyframe at `t` with the current value, or remove the one there. */
export function toggleKeyAt(a: Anim, t: number): Anim {
  const k = keyAt(a, t);
  if (k) {
    const rest = (a.k ?? []).filter((x) => x !== k);
    return rest.length ? { ...a, k: rest } : { v: k.v };
  }
  return setKey(a, t, evalAnim(a, t));
}

export function removeKey(a: Anim, id: string): Anim {
  const k = a.k?.find((x) => x.id === id);
  if (!k) return a;
  const rest = (a.k ?? []).filter((x) => x.id !== id);
  return rest.length ? { ...a, k: rest } : { v: k.v };
}

export function updateKey(a: Anim, id: string, patch: Partial<Omit<Keyframe, "id">>): Anim {
  if (!a.k) return a;
  let k = a.k.map((x) => (x.id === id ? { ...x, ...patch, ...(patch.t !== undefined ? { t: rt(patch.t) } : {}) } : x));
  if (patch.t !== undefined) {
    // Moving a key onto another replaces it.
    const moved = k.find((x) => x.id === id)!;
    k = k.filter((x) => x.id === id || Math.abs(x.t - moved.t) >= KEY_EPS);
  }
  return { ...a, k: sortKeys(k) };
}

/** Shift every keyframe (used when a clip's left edge is trimmed: the animation stays put in time). */
export function shiftAnim(a: Anim, dt: number): Anim {
  if (!a.k || dt === 0) return a;
  return { ...a, k: a.k.map((x) => ({ ...x, t: rt(x.t + dt) })) };
}

export function scaleAnim(a: Anim, factor: number): Anim {
  if (!a.k || factor === 1) return a;
  return { ...a, k: a.k.map((x) => ({ ...x, t: rt(x.t * factor) })) };
}

/**
 * Splitting a clip at local time `t`: each half gets a keyframe on the cut holding the value there,
 * and the right half's keys move back by `t`. Linear motion stays exact; an eased segment that the
 * cut lands in is re-eased over each shorter span.
 */
export function splitAnim(a: Anim, t: number): [Anim, Anim] {
  if (!isAnimated(a)) return [a, a];
  const v = evalAnim(a, t);
  const k = a.k!;
  const seg = [...k].reverse().find((x) => x.t <= t);
  const ease: Ease = seg?.ease ?? "linear";
  const left = k.filter((x) => x.t < t - KEY_EPS);
  const right = k.filter((x) => x.t > t + KEY_EPS).map((x) => ({ ...x, t: rt(x.t - t) }));
  const cutL: Keyframe = { id: uid("k"), t: rt(t), v, ease };
  const cutR: Keyframe = { id: uid("k"), t: 0, v, ease, ...(seg?.bezier ? { bezier: seg.bezier } : {}) };
  return [{ v, k: [...left, cutL] }, { v, k: [cutR, ...right] }];
}

/** The keyframe times of an animatable value, for drawing diamonds. */
export const keyTimes = (a: Anim | undefined) => a?.k?.map((k) => k.t) ?? [];
