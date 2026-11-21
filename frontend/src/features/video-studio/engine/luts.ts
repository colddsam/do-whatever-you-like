import { uid } from "../lib/time";
import type { Project } from "../types";
import { kv } from "./storage";

/**
 * 3D colour lookup tables for the "LUT film look" effect.
 *
 * Built-in looks are computed here (a 25³ table each, generated on first use), so they cost no
 * download. Your own `.cube` files (the format Resolve, Premiere and most LUT packs use) are parsed
 * once and kept in IndexedDB on this device. The compositor uploads a table as a 3D texture and
 * samples it per pixel with hardware trilinear filtering.
 */

export type LutTable = { size: number; data: Float32Array };
export type LutInfo = { id: string; name: string; hint?: string };

type RGB = [number, number, number];
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const luma = (c: RGB) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const s = (x: number, k: number) => mix(x, x * x * (3 - 2 * x), k);
const sat = (c: RGB, k: number): RGB => {
  const l = luma(c);
  return [mix(l, c[0], k), mix(l, c[1], k), mix(l, c[2], k)];
};
/** Tints the shadows towards one colour and the highlights towards another (split toning). */
const tone = (c: RGB, shadow: RGB, high: RGB, ks: number, kh: number): RGB => {
  const l = luma(c);
  const ws = Math.pow(1 - l, 1.6) * ks;
  const wh = Math.pow(l, 1.6) * kh;
  return [0, 1, 2].map((i) => c[i] + (shadow[i] - 0.5) * ws + (high[i] - 0.5) * wh) as RGB;
};

const BUILTIN: Record<string, { name: string; hint: string; f: (c: RGB) => RGB }> = {
  tealOrange: {
    name: "Teal & orange",
    hint: "Blockbuster: teal shadows, warm skin",
    f: (c) => sat(tone([s(c[0], 0.35), s(c[1], 0.35), s(c[2], 0.35)], [0.2, 0.55, 0.62], [0.95, 0.62, 0.32], 0.55, 0.42), 1.12),
  },
  kodak: {
    name: "Warm film",
    hint: "Lifted blacks, golden highlights",
    f: (c) => {
      const x: RGB = [0.04 + 0.95 * s(c[0], 0.3) * 1.05, 0.035 + 0.95 * s(c[1], 0.3), 0.05 + 0.9 * s(c[2], 0.3) * 0.94];
      return sat(tone(x, [0.45, 0.48, 0.55], [0.75, 0.62, 0.4], 0.2, 0.3), 0.95);
    },
  },
  fuji: {
    name: "Cool film",
    hint: "Soft contrast, green-cyan shadows",
    f: (c) => sat(tone([s(c[0], 0.2) * 0.97, s(c[1], 0.2) * 1.02, s(c[2], 0.2) * 1.03], [0.35, 0.58, 0.55], [0.52, 0.55, 0.5], 0.4, 0.15), 0.9),
  },
  bleach: {
    name: "Bleach bypass",
    hint: "Gritty, silvery, high contrast",
    f: (c) => {
      const l = s(luma(c), 0.85);
      return [mix(s(c[0], 0.5), l, 0.55), mix(s(c[1], 0.5), l, 0.55), mix(s(c[2], 0.5), l, 0.55)];
    },
  },
  matte: {
    name: "Matte",
    hint: "Faded blacks, soft and modern",
    f: (c) => sat([0.08 + c[0] * 0.86 * 1.02, 0.075 + c[1] * 0.86, 0.07 + c[2] * 0.85 * 0.98], 0.85),
  },
  noir: {
    name: "Noir",
    hint: "Deep, contrasty black and white",
    f: (c) => {
      const l = Math.pow(s(luma(c), 0.9), 1.1);
      return [l, l, l];
    },
  },
  crossProcess: {
    name: "Cross process",
    hint: "Punchy, slide-film colour shifts",
    f: (c) => sat([s(c[0], 0.6), s(c[1], 0.3) * 1.04, 0.16 + c[2] * 0.68], 1.15),
  },
  golden: {
    name: "Golden hour",
    hint: "Sun-soaked warmth",
    f: (c) => sat(tone([c[0] * 1.12, c[1] * 1.02, c[2] * 0.8], [0.55, 0.45, 0.4], [0.85, 0.7, 0.35], 0.2, 0.35), 1.1),
  },
  moonlight: {
    name: "Moonlight",
    hint: "Day-for-night blue",
    f: (c) => {
      const x = sat(c, 0.45);
      return [s(x[0] * 0.62, 0.3), s(x[1] * 0.74, 0.3), s(x[2] * 0.98 + 0.04, 0.3)];
    },
  },
  cyberpunk: {
    name: "Neon night",
    hint: "Magenta shadows, cyan highlights",
    f: (c) => sat(tone([s(c[0], 0.3), s(c[1], 0.3), s(c[2], 0.3)], [0.62, 0.22, 0.85], [0.3, 0.95, 0.95], 0.6, 0.45), 1.3),
  },
  sepia: {
    name: "Sepia",
    hint: "Old photograph brown",
    f: (c) => {
      const l = luma(c);
      return [l * 1.07 + 0.03, l * 0.87 + 0.01, l * 0.62];
    },
  },
  pastel: {
    name: "Pastel",
    hint: "Airy, soft and light",
    f: (c) => sat(tone([0.12 + c[0] * 0.84, 0.11 + c[1] * 0.84, 0.13 + c[2] * 0.83], [0.55, 0.5, 0.6], [0.62, 0.52, 0.55], 0.1, 0.2), 0.75),
  },
};

export const BUILTIN_LUTS: LutInfo[] = Object.entries(BUILTIN).map(([id, l]) => ({ id: `builtin:${id}`, name: l.name, hint: l.hint }));

const SIZE = 25;
const cache = new Map<string, LutTable>();
const pending = new Map<string, Promise<LutTable | null>>();
const listeners = new Set<() => void>();

function build(f: (c: RGB) => RGB): LutTable {
  const data = new Float32Array(SIZE * SIZE * SIZE * 4);
  let i = 0;
  // .cube order: red changes fastest, then green, then blue (x, y, z of the 3D texture).
  for (let b = 0; b < SIZE; b++)
    for (let g = 0; g < SIZE; g++)
      for (let r = 0; r < SIZE; r++) {
        const o = f([r / (SIZE - 1), g / (SIZE - 1), b / (SIZE - 1)]);
        data[i++] = clamp01(o[0]);
        data[i++] = clamp01(o[1]);
        data[i++] = clamp01(o[2]);
        data[i++] = 1;
      }
  return { size: SIZE, data };
}

/** A table that is ready now, or null (and it starts loading; `onLutsChanged` fires when it lands). */
export function getLut(id: string): LutTable | null {
  const hit = cache.get(id);
  if (hit) return hit;
  if (id.startsWith("builtin:")) {
    const b = BUILTIN[id.slice(8)];
    if (!b) return null;
    const t = build(b.f);
    cache.set(id, t);
    return t;
  }
  void loadLut(id);
  return null;
}

export function loadLut(id: string): Promise<LutTable | null> {
  if (cache.has(id)) return Promise.resolve(cache.get(id)!);
  if (id.startsWith("builtin:")) return Promise.resolve(getLut(id));
  let p = pending.get(id);
  if (!p) {
    p = kv
      .get<{ name: string; size: number; data: Float32Array }>(`lut:${id}`)
      .then((v) => {
        if (!v) return null;
        const t = { size: v.size, data: v.data };
        cache.set(id, t);
        for (const fn of listeners) fn();
        return t;
      })
      .catch(() => null);
    pending.set(id, p);
  }
  return p;
}

export function onLutsChanged(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Loads every imported LUT a project uses (before an export, so no frame renders without one). */
export async function ensureLuts(p: Project) {
  const ids = new Set<string>();
  for (const c of Object.values(p.clips)) for (const e of c.effects) if (e.type === "lut" && e.enabled && e.options?.lut) ids.add(e.options.lut);
  await Promise.all([...ids].map((id) => loadLut(id)));
}

/** Parses a .cube 3D LUT (Adobe/Resolve format). */
export function parseCube(text: string): LutTable & { title?: string } {
  let size = 0;
  let title: string | undefined;
  const vals: number[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(/\s+/);
    const kw = parts[0].toUpperCase();
    if (kw === "TITLE") title = line.slice(5).trim().replace(/^"|"$/g, "");
    else if (kw === "LUT_3D_SIZE") size = parseInt(parts[1], 10);
    else if (kw === "LUT_1D_SIZE") throw new Error("That's a 1D LUT; the editor needs a 3D .cube file.");
    else if (/^[-+.\d]/.test(parts[0]) && parts.length >= 3) vals.push(Number(parts[0]), Number(parts[1]), Number(parts[2]));
    // DOMAIN_MIN/MAX: almost every LUT uses the default 0..1, which is what the shader assumes.
  }
  if (!size || size < 2 || size > 128) throw new Error("That file doesn't look like a 3D .cube LUT (no LUT_3D_SIZE).");
  const n = size * size * size;
  if (vals.length < n * 3) throw new Error(`The LUT is incomplete: ${Math.floor(vals.length / 3)} of ${n} entries.`);
  const data = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    data[i * 4] = clamp01(vals[i * 3]);
    data[i * 4 + 1] = clamp01(vals[i * 3 + 1]);
    data[i * 4 + 2] = clamp01(vals[i * 3 + 2]);
    data[i * 4 + 3] = 1;
  }
  return { size, data, title };
}

/** Imports a .cube file into this device's storage; returns its id and name. */
export async function importCube(file: File): Promise<LutInfo> {
  if (file.size > 40 * 1024 * 1024) throw new Error("That LUT file is too large.");
  const parsed = parseCube(await file.text());
  const id = uid("lut");
  const name = (parsed.title || file.name.replace(/\.cube$/i, "")).slice(0, 60);
  await kv.set(`lut:${id}`, { name, size: parsed.size, data: parsed.data });
  const list = (await kv.get<LutInfo[]>("luts")) ?? [];
  await kv.set("luts", [{ id, name }, ...list.filter((l) => l.id !== id)].slice(0, 100));
  cache.set(id, { size: parsed.size, data: parsed.data });
  for (const fn of listeners) fn();
  return { id, name };
}

/** LUTs imported on this device, newest first. */
export async function userLuts(): Promise<LutInfo[]> {
  return (await kv.get<LutInfo[]>("luts")) ?? [];
}

/** Raw stored entries, for project packages. */
export async function exportLutData(id: string) {
  return kv.get<{ name: string; size: number; data: Float32Array }>(`lut:${id}`);
}

export async function importLutData(id: string, v: { name: string; size: number; data: Float32Array }) {
  await kv.set(`lut:${id}`, v);
  const list = (await kv.get<LutInfo[]>("luts")) ?? [];
  if (!list.some((l) => l.id === id)) await kv.set("luts", [{ id, name: v.name }, ...list]);
  cache.set(id, { size: v.size, data: v.data });
  for (const fn of listeners) fn();
}
