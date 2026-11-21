import { parse as parseFont } from "opentype.js";
import { FONTS, nearestWeight } from "../constants";
import type { Project, TextStyle } from "../types";
import { kv } from "./storage";

/**
 * Fonts for titles and captions: built-in Google Fonts loaded on demand, any custom Google Font by
 * family name, plus user-uploaded .ttf/.otf/.woff/.woff2 files persisted in IndexedDB so they
 * remain available offline, survive reloads, and bundle cleanly inside .dwylvideo packages.
 */

export interface CustomFontInfo {
  id: string;
  family: string;
  fileName: string;
  weights: number[];
  italic?: boolean;
  format: "ttf" | "otf" | "woff" | "woff2" | "google";
  source: "upload" | "google";
  addedAt: number;
}

const INDEX_KEY = "custom-fonts-index";
const BYTES_PREFIX = "custom-font:";
const FALLBACK = `system-ui, "Segoe UI", Roboto, "Noto Sans", sans-serif`;

const ready = new Set<string>();
const loading = new Map<string, Promise<void>>();
const uiListeners = new Set<() => void>();
const renderListeners = new Set<() => void>();

/** Referentially stable snapshot for React's useSyncExternalStore. */
let customFonts: CustomFontInfo[] = [];
let hydrated: Promise<void> | null = null;
const registeredFaces = new Map<string, FontFace>();

const keyOf = (family: string, weight: number, italic: boolean) => `${family}|${weight}|${italic ? 1 : 0}`;

function notifyUi() {
  for (const fn of uiListeners) fn();
}

function notifyRender() {
  for (const fn of renderListeners) fn();
}

export function subscribeFonts(fn: () => void) {
  uiListeners.add(fn);
  return () => {
    uiListeners.delete(fn);
  };
}

export function onFontsChanged(fn: () => void) {
  renderListeners.add(fn);
  return () => {
    renderListeners.delete(fn);
  };
}

export function getCustomFonts(): CustomFontInfo[] {
  return customFonts;
}

export function weightsForFont(family: string): number[] {
  const builtin = FONTS.find((f) => f.family === family);
  if (builtin) return builtin.weights;
  const custom = customFonts.filter((f) => f.family === family).flatMap((f) => f.weights);
  return custom.length ? Array.from(new Set(custom)).sort((a, b) => a - b) : [400, 700];
}

export function fontString(st: Pick<TextStyle, "font" | "weight" | "italic">, px: number) {
  const weights = weightsForFont(st.font);
  const w = weights.reduce((a, b) => (Math.abs(b - st.weight) < Math.abs(a - st.weight) ? b : a), weights[0]);
  return `${st.italic ? "italic " : ""}${w} ${Math.max(1, px)}px "${st.font}", ${FALLBACK}`;
}

export const fontReady = (family: string, weight: number, italic: boolean) => {
  const weights = weightsForFont(family);
  const w = weights.reduce((a, b) => (Math.abs(b - weight) < Math.abs(a - weight) ? b : a), weights[0]);
  return ready.has(keyOf(family, w, italic)) || customFonts.some((f) => f.family === family && f.source === "upload");
};

function cssUrl(family: string, weight: number, italic: boolean) {
  const name = encodeURIComponent(family).replace(/%20/g, "+");
  const meta = FONTS.find((f) => f.family === family);
  const ital = italic && meta?.italic ? 1 : 0;
  return `https://fonts.googleapis.com/css2?family=${name}:ital,wght@${ital},${weight}&display=swap`;
}

/** `/api/tools/studio/proxy?url=…`: our backend fetching an allowlisted public file for us. */
export function proxied(url: string) {
  return `/api/tools/studio/proxy?url=${encodeURIComponent(url)}`;
}

type FaceRule = { url: string; format: string; range?: string };

/** @font-face blocks from Google's CSS. Browsers get WOFF2 subsets; through the proxy it serves TTF. */
function parseCss(css: string): FaceRule[] {
  const out: FaceRule[] = [];
  for (const block of css.split("@font-face").slice(1)) {
    const src = /src:\s*url\(([^)]+)\)\s*(?:format\(\s*['"]?([\w-]+)['"]?\s*\))?/.exec(block);
    const range = /unicode-range:\s*([^;]+);/.exec(block)?.[1]?.trim();
    if (src) out.push({ url: src[1].replace(/["']/g, ""), format: src[2] ?? "woff2", range });
  }
  return out;
}

async function fetchText(url: string) {
  try {
    const r = await fetch(url, { mode: "cors", credentials: "omit" });
    if (r.ok) return await r.text();
  } catch {
    /* fall through to the proxy */
  }
  const r = await fetch(proxied(url));
  if (!r.ok) throw new Error(`Font stylesheet ${r.status}`);
  return r.text();
}

function isGoogleKnown(family: string) {
  return FONTS.some((f) => f.family === family) || customFonts.some((f) => f.family === family && f.source === "google");
}

async function load(family: string, weight: number, italic: boolean, sample: string) {
  if (customFonts.some((f) => f.family === family && f.source === "upload")) return;
  if (!isGoogleKnown(family)) return; // system font or unavailable custom font: let Canvas resolve fallback
  const css = await fetchText(cssUrl(family, weight, italic));
  const rules = parseCss(css);
  if (!rules.length) throw new Error(`No font files for ${family}`);
  const descriptors = (range?: string): FontFaceDescriptors => ({ weight: String(weight), style: italic ? "italic" : "normal", ...(range ? { unicodeRange: range } : {}) });
  // Every subset is registered (Latin, Devanagari, Bengali…); the browser downloads only what text needs.
  const faces = rules.map((r) => new FontFace(family, `url(${r.url}) format("${r.format}")`, descriptors(r.range)));
  for (const f of faces) document.fonts.add(f);
  const probe = `${italic ? "italic " : ""}${weight} 32px "${family}"`;
  try {
    await document.fonts.load(probe, sample || "Aa");
    if (faces.some((f) => f.status === "error")) throw new Error("font file blocked");
  } catch {
    // Direct download failed: fetch the bytes through the proxy and register them instead.
    for (const f of faces) document.fonts.delete(f);
    await Promise.all(
      rules.map(async (r) => {
        const res = await fetch(proxied(r.url));
        if (!res.ok) return;
        const face = new FontFace(family, await res.arrayBuffer(), descriptors(r.range));
        await face.load();
        document.fonts.add(face);
      }),
    );
  }
}

/** Resolves once `family` at `weight` can be drawn (or failed, in which case the fallback font draws). */
export function ensureFont(family: string, weight: number, italic = false, sample = "Aa"): Promise<void> {
  const weights = weightsForFont(family);
  const w = weights.includes(weight) ? weight : nearestWeight(family, weight);
  const key = keyOf(family, w, italic);
  if (ready.has(key)) return Promise.resolve();
  let p = loading.get(key);
  if (!p) {
    p = load(family, w, italic, sample)
      .then(() => {
        notifyRender();
      })
      .catch((e) => console.warn(`[studio] font ${family} ${w}:`, e))
      .finally(() => {
        ready.add(key);
        loading.delete(key);
      });
    loading.set(key, p);
  }
  return p;
}

/** Parses metadata from an uploaded TTF/OTF/WOFF file when supported by opentype.js, falling back cleanly for WOFF2. */
function inspectFontBytes(buffer: ArrayBuffer, fileName: string): { family: string; weight: number; italic: boolean } {
  const baseName = fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "Custom Font";
  const lower = fileName.toLowerCase();
  let weight = /black|heavy/i.test(lower) ? 900 : /extrabold|ultrabold/i.test(lower) ? 800 : /bold/i.test(lower) ? 700 : /semibold|demibold/i.test(lower) ? 600 : /medium/i.test(lower) ? 500 : /light/i.test(lower) ? 300 : /thin|hairline/i.test(lower) ? 200 : 400;
  let italic = /italic|oblique/i.test(lower);
  let family = baseName;

  try {
    const parsed = parseFont(buffer);
    const names = parsed.names;
    const rawFamily =
      names?.preferredFamily?.en ||
      names?.fontFamily?.en ||
      Object.values(names?.fontFamily ?? {})[0];
    if (typeof rawFamily === "string" && rawFamily.trim()) family = rawFamily.trim();
    const os2 = parsed.tables?.os2 as { usWeightClass?: number; fsSelection?: number } | undefined;
    if (os2?.usWeightClass && os2.usWeightClass >= 100 && os2.usWeightClass <= 950) {
      weight = Math.round(os2.usWeightClass / 100) * 100;
    }
    const sub = names?.preferredSubfamily?.en || names?.fontSubfamily?.en || "";
    if (/italic|oblique/i.test(sub)) italic = true;
    if (os2?.fsSelection && (os2.fsSelection & 1) !== 0) italic = true;
  } catch {
    /* WOFF2 or variable table: browser FontFace still decodes it natively */
  }
  return { family, weight, italic };
}

function detectFontFormat(fileName: string): CustomFontInfo["format"] {
  const ext = fileName.split(".").pop()?.toLowerCase();
  if (ext === "otf") return "otf";
  if (ext === "woff") return "woff";
  if (ext === "woff2") return "woff2";
  return "ttf";
}

async function registerFaceBytes(info: CustomFontInfo, buffer: ArrayBuffer) {
  if (typeof document === "undefined" || typeof FontFace === "undefined") return;
  const weight = info.weights[0] ?? 400;
  const face = new FontFace(info.family, buffer.slice(0), { weight: String(weight), style: info.italic ? "italic" : "normal" });
  await face.load();
  document.fonts.add(face);
  registeredFaces.set(info.id, face);
  ready.add(keyOf(info.family, weight, Boolean(info.italic)));
}

async function saveFontIndex(list: CustomFontInfo[]) {
  customFonts = [...list];
  await kv.set(INDEX_KEY, customFonts);
  notifyUi();
  notifyRender();
}

/** Imports a .ttf / .otf / .woff / .woff2 font file, validates it with FontFace + opentype, and persists to IndexedDB. */
export async function importCustomFont(file: File): Promise<CustomFontInfo> {
  await hydrateCustomFonts();
  const buffer = await file.arrayBuffer();
  const { family, weight, italic } = inspectFontBytes(buffer, file.name);
  const format = detectFontFormat(file.name);
  const id = `cf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const info: CustomFontInfo = {
    id,
    family,
    fileName: file.name,
    weights: [weight],
    italic,
    format,
    source: "upload",
    addedAt: Date.now(),
  };
  await registerFaceBytes(info, buffer);
  await kv.set(`${BYTES_PREFIX}${id}`, buffer);
  await saveFontIndex([info, ...customFonts]);
  return info;
}

/** Registers and persists any custom Google Font family by exact family name (e.g. "Syne", "Instrument Serif"). */
export async function addGoogleFont(familyInput: string): Promise<CustomFontInfo> {
  await hydrateCustomFonts();
  const family = familyInput.trim();
  if (!family) throw new Error("Enter a Google Font family name.");
  const existing = customFonts.find((f) => f.family.toLowerCase() === family.toLowerCase());
  if (existing) {
    await ensureFont(existing.family, existing.weights[0] ?? 400, false, existing.family);
    return existing;
  }
  // Probe Google Fonts before saving so invalid typos report immediately.
  const css = await fetchText(cssUrl(family, 400, false));
  const rules = parseCss(css);
  if (!rules.length) throw new Error(`Could not find "${family}" on Google Fonts.`);

  const id = `gf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const info: CustomFontInfo = {
    id,
    family,
    fileName: `${family} (Google Fonts)`,
    weights: [400, 700],
    italic: true,
    format: "google",
    source: "google",
    addedAt: Date.now(),
  };
  await saveFontIndex([info, ...customFonts]);
  await ensureFont(family, 400, false, family);
  return info;
}

export async function removeCustomFont(id: string) {
  await hydrateCustomFonts();
  const face = registeredFaces.get(id);
  if (face && typeof document !== "undefined") {
    document.fonts.delete(face);
    registeredFaces.delete(id);
  }
  await kv.del(`${BYTES_PREFIX}${id}`);
  await saveFontIndex(customFonts.filter((f) => f.id !== id));
}

export function hydrateCustomFonts(): Promise<void> {
  if (hydrated) return hydrated;
  hydrated = (async () => {
    try {
      const list = (await kv.get<CustomFontInfo[]>(INDEX_KEY)) ?? [];
      customFonts = list;
      await Promise.all(
        list.map(async (item) => {
          if (item.source === "upload") {
            const bytes = await kv.get<ArrayBuffer>(`${BYTES_PREFIX}${item.id}`);
            if (bytes) {
              try {
                await registerFaceBytes(item, bytes);
              } catch (e) {
                console.warn(`[studio] failed to load custom font ${item.family}:`, e);
              }
            }
          }
        }),
      );
      notifyUi();
      notifyRender();
    } catch (e) {
      console.warn("[studio] failed to hydrate custom fonts:", e);
    }
  })();
  return hydrated;
}

/** Collects raw uploaded font payloads used by a project so .dwylvideo packages stay self-contained. */
export async function exportProjectFonts(p: Project): Promise<{ info: CustomFontInfo; bytes?: Uint8Array }[]> {
  await hydrateCustomFonts();
  const used = new Set(Object.values(p.clips).map((c) => c.text?.style.font).filter((x): x is string => Boolean(x)));
  const out: { info: CustomFontInfo; bytes?: Uint8Array }[] = [];
  for (const item of customFonts) {
    if (!used.has(item.family)) continue;
    if (item.source === "upload") {
      const buf = await kv.get<ArrayBuffer>(`${BYTES_PREFIX}${item.id}`);
      if (buf) out.push({ info: item, bytes: new Uint8Array(buf) });
    } else {
      out.push({ info: item });
    }
  }
  return out;
}

export async function importProjectFonts(entries: { info: CustomFontInfo; bytes?: Uint8Array }[]) {
  await hydrateCustomFonts();
  let changed = false;
  const next = [...customFonts];
  for (const { info, bytes } of entries) {
    if (next.some((f) => f.family === info.family && f.weights[0] === info.weights[0] && Boolean(f.italic) === Boolean(info.italic))) continue;
    if (info.source === "upload" && bytes) {
      const copy = new Uint8Array(bytes).buffer;
      await kv.set(`${BYTES_PREFIX}${info.id}`, copy);
      try {
        await registerFaceBytes(info, copy);
      } catch {
        /* ignore malformed bytes */
      }
      next.unshift(info);
      changed = true;
    } else if (info.source === "google") {
      next.unshift(info);
      changed = true;
    }
  }
  if (changed) await saveFontIndex(next);
}

/** Every font a project's text uses, before an export starts drawing frames. */
export async function ensureProjectFonts(p: Project) {
  await hydrateCustomFonts();
  const jobs = new Map<string, Promise<void>>();
  for (const c of Object.values(p.clips)) {
    if (!c.text) continue;
    const st = c.text.style;
    const k = keyOf(st.font, st.weight, st.italic);
    if (!jobs.has(k)) jobs.set(k, ensureFont(st.font, st.weight, st.italic, c.text.text));
  }
  await Promise.all(jobs.values());
}

/** For the font picker: load a family's regular weight so its name can be shown in it. */
export const previewFont = (family: string) => ensureFont(family, weightsForFont(family)[0] ?? 400, false, family);
