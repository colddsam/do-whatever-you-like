import { EFFECTS } from "../constants";
import type { Anim, Clip, TransformProp } from "../types";
import { TRANSFORM_PROPS } from "../types";

/**
 * Every animatable value on a clip has a path: a transform property ("x", "opacity"…), "volume",
 * or an effect parameter ("fx:<effect id>:<param>"). The inspector, the transform handles, the
 * keyframe graph and the AI Director all edit values through these paths.
 */

export type PropPath = TransformProp | "volume" | `fx:${string}:${string}`;

export type PropSpec = { label: string; min: number; max: number; step: number; unit?: string; display?: (v: number) => string };

export const TRANSFORM_SPECS: Record<TransformProp, Omit<PropSpec, "min" | "max"> & { min?: number; max?: number }> = {
  x: { label: "Position X", step: 1, unit: "px" },
  y: { label: "Position Y", step: 1, unit: "px" },
  scaleX: { label: "Scale X", min: -10, max: 10, step: 0.01, display: (v) => `${Math.round(v * 100)}%` },
  scaleY: { label: "Scale Y", min: -10, max: 10, step: 0.01, display: (v) => `${Math.round(v * 100)}%` },
  rotation: { label: "Rotation", min: -3600, max: 3600, step: 0.5, unit: "°" },
  opacity: { label: "Opacity", min: 0, max: 1, step: 0.01, display: (v) => `${Math.round(v * 100)}%` },
};

export function getAnim(c: Clip, path: PropPath): Anim | undefined {
  if (path === "volume") return c.volume;
  if ((TRANSFORM_PROPS as string[]).includes(path)) return c.transform[path as TransformProp];
  const [, id, key] = path.split(":");
  return c.effects.find((e) => e.id === id)?.params[key];
}

export function withAnim(c: Clip, path: PropPath, a: Anim): Clip {
  if (path === "volume") return { ...c, volume: a };
  if ((TRANSFORM_PROPS as string[]).includes(path)) return { ...c, transform: { ...c.transform, [path]: a } };
  const [, id, key] = path.split(":");
  return { ...c, effects: c.effects.map((e) => (e.id === id ? { ...e, params: { ...e.params, [key]: a } } : e)) };
}

export function propSpec(c: Clip, path: PropPath, frame: { width: number; height: number }): PropSpec {
  if (path === "volume") return { label: "Volume", min: 0, max: 4, step: 0.01, display: (v) => `${Math.round(v * 100)}%` };
  if ((TRANSFORM_PROPS as string[]).includes(path)) {
    const s = TRANSFORM_SPECS[path as TransformProp];
    const span = path === "x" ? frame.width : frame.height;
    return { min: s.min ?? -span, max: s.max ?? span * 2, ...s };
  }
  const [, id, key] = path.split(":");
  const e = c.effects.find((x) => x.id === id);
  const p = e ? EFFECTS[e.type].params.find((x) => x.key === key) : undefined;
  if (!p) return { label: key, min: 0, max: 1, step: 0.01 };
  return { label: `${EFFECTS[e!.type].label} · ${p.label}`, min: p.min, max: p.max, step: p.step, unit: p.unit, ...(p.pct ? { display: (v: number) => `${Math.round(v * 100)}%` } : {}) };
}

/** Every path on a clip that currently has keyframes, for the animation panel. */
export function animatedPaths(c: Clip): PropPath[] {
  const out: PropPath[] = [];
  for (const k of TRANSFORM_PROPS) if (c.transform[k].k?.length) out.push(k);
  if (c.volume.k?.length) out.push("volume");
  for (const e of c.effects) for (const [key, a] of Object.entries(e.params)) if (a.k?.length) out.push(`fx:${e.id}:${key}`);
  return out;
}

export function formatValue(spec: PropSpec, v: number) {
  if (spec.display) return spec.display(v);
  const digits = spec.step >= 1 ? 0 : spec.step >= 0.1 ? 1 : 2;
  return `${v.toFixed(digits)}${spec.unit ?? ""}`;
}
