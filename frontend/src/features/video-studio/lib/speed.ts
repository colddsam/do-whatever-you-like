import type { Clip, SpeedPoint } from "../types";
import { rt } from "./time";

/**
 * Speed curves (CapCut's speed ramps, Premiere's time remapping).
 *
 * A curve is a list of points in clip-local timeline seconds, linear between points and flat
 * outside them. Invariant kept by every edit: sorted, the first point at 0, the last at the clip's
 * duration. Where the source is at a moment of the clip is the integral of the speed, which for
 * straight segments is exact (trapezoids), and its inverse is a quadratic per segment, so nothing
 * here is approximate.
 *
 * Clips without a curve go through the same functions with their constant `speed`.
 */

const integrals = new WeakMap<SpeedPoint[], number[]>();

/** Cumulative source seconds at each point (cached per curve: curves are immutable). */
function cumulative(r: SpeedPoint[]) {
  let c = integrals.get(r);
  if (!c) {
    c = [0];
    for (let i = 1; i < r.length; i++) c.push(c[i - 1] + ((r[i].t - r[i - 1].t) * (r[i].v + r[i - 1].v)) / 2);
    integrals.set(r, c);
  }
  return c;
}

function segment(r: SpeedPoint[], t: number) {
  let lo = 0;
  let hi = r.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (r[mid].t <= t) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** The speed at clip-local time `local`. */
export function rateAt(c: Pick<Clip, "speed" | "speedRamp">, local: number): number {
  const r = c.speedRamp;
  if (!r || r.length < 2) return c.speed;
  if (local <= r[0].t) return r[0].v;
  const last = r[r.length - 1];
  if (local >= last.t) return last.v;
  const i = segment(r, local);
  const a = r[i];
  const b = r[i + 1];
  return a.v + ((b.v - a.v) * (local - a.t)) / (b.t - a.t || 1);
}

/** Source seconds covered between the clip's first frame and clip-local time `local` (∫ speed). */
export function srcOffset(c: Pick<Clip, "speed" | "speedRamp">, local: number): number {
  const r = c.speedRamp;
  if (!r || r.length < 2) return local * c.speed;
  if (local <= 0) return local * r[0].v;
  const cum = cumulative(r);
  const last = r.length - 1;
  if (local >= r[last].t) return cum[last] + (local - r[last].t) * r[last].v;
  const i = segment(r, local);
  const a = r[i];
  return cum[i] + ((local - a.t) * (a.v + rateAt(c, local))) / 2;
}

/** The clip-local time at which the source has advanced `src` seconds: the inverse of srcOffset. */
export function localForSrc(c: Pick<Clip, "speed" | "speedRamp">, src: number): number {
  const r = c.speedRamp;
  if (!r || r.length < 2) return src / c.speed;
  if (src <= 0) return src / r[0].v;
  const cum = cumulative(r);
  const last = r.length - 1;
  if (src >= cum[last]) return r[last].t + (src - cum[last]) / r[last].v;
  let i = 0;
  while (i < last - 1 && cum[i + 1] <= src) i++;
  const a = r[i];
  const b = r[i + 1];
  const k = (b.v - a.v) / (b.t - a.t || 1);
  const rem = src - cum[i];
  // a.v·d + k·d²/2 = rem
  const d = Math.abs(k) < 1e-9 ? rem / a.v : (-a.v + Math.sqrt(Math.max(0, a.v * a.v + 2 * k * rem))) / k;
  return a.t + d;
}

/** How much source the whole clip shows. */
export const srcSpan = (c: Pick<Clip, "speed" | "speedRamp" | "duration">) => srcOffset(c, c.duration);

/** The value of a curve at `t` (for cutting it). */
function valueAt(r: SpeedPoint[], t: number) {
  return rateAt({ speed: 1, speedRamp: r }, t);
}

/** The part of a curve between local times a and b, re-based so it starts at 0. */
export function cropRamp(r: SpeedPoint[], a: number, b: number): SpeedPoint[] {
  const out: SpeedPoint[] = [{ t: 0, v: valueAt(r, a) }];
  for (const p of r) if (p.t > a + 1e-6 && p.t < b - 1e-6) out.push({ t: rt(p.t - a), v: p.v });
  out.push({ t: rt(b - a), v: valueAt(r, b) });
  return out;
}

/** Scales a curve's times (when the clip's length changes and the curve should stretch with it). */
export function scaleRamp(r: SpeedPoint[], factor: number): SpeedPoint[] {
  return r.map((p) => ({ t: rt(p.t * factor), v: p.v }));
}

/** A preset shape (x 0..1 → speed) turned into a curve of `duration` seconds. */
export function rampFromShape(points: [number, number][], duration: number): SpeedPoint[] {
  return points.map(([x, v]) => ({ t: rt(x * duration), v: Math.min(10, Math.max(0.1, v)) }));
}

/** The average speed of a shape over its length (so a clip keeps its source range when one is applied). */
export function shapeAverage(points: [number, number][]) {
  let acc = 0;
  for (let i = 1; i < points.length; i++) acc += ((points[i][0] - points[i - 1][0]) * (points[i][1] + points[i - 1][1])) / 2;
  return acc / Math.max(1e-6, points[points.length - 1][0] - points[0][0]);
}
