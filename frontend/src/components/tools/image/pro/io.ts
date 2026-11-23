import { canvasFromImage, ctx2d, docFromCanvas, makeCanvas, newId, newLayer } from "./doc";
import { flatten, layerAsDoc } from "./render";
import type { BlendMode, Doc, Layer } from "./types";

/*
 * Files in and out. Nothing here talks to a server: PSD is read and written by ag-psd (MIT) in the
 * browser, projects are a ZIP of PNGs plus a JSON description, and the last session is kept in
 * IndexedDB so a closed tab can be picked up again.
 */

export const PROJECT_EXT = ".dwlp";

/* ---------- Pictures ---------- */

export async function decodeImage(file: Blob): Promise<HTMLCanvasElement> {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const c = canvasFromImage(bmp);
    bmp.close();
    return c;
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.decoding = "async";
      img.src = url;
      await img.decode();
      return canvasFromImage(img, img.naturalWidth, img.naturalHeight);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

export const isPsd = (f: File) => /\.(psd|psb)$/i.test(f.name);
export const isProject = (f: File) => f.name.toLowerCase().endsWith(PROJECT_EXT);
const stem = (n: string) => n.replace(/\.[^.]+$/, "") || "Untitled";

/** Opens anything the editor can read as a new document. */
export async function openFile(file: File): Promise<Doc> {
  if (isPsd(file)) return readPsdFile(file);
  if (isProject(file)) return readProject(new Uint8Array(await file.arrayBuffer()));
  const c = await decodeImage(file);
  return docFromCanvas(c, stem(file.name));
}

/* ---------- PSD ---------- */

const FROM_PSD: Record<string, BlendMode> = {
  normal: "normal",
  multiply: "multiply",
  screen: "screen",
  overlay: "overlay",
  darken: "darken",
  lighten: "lighten",
  "color dodge": "color-dodge",
  "color burn": "color-burn",
  "hard light": "hard-light",
  "soft light": "soft-light",
  difference: "difference",
  exclusion: "exclusion",
  hue: "hue",
  saturation: "saturation",
  color: "color",
  luminosity: "luminosity",
  "linear dodge": "lighter",
};
const TO_PSD: Record<BlendMode, string> = {
  normal: "normal",
  multiply: "multiply",
  screen: "screen",
  overlay: "overlay",
  darken: "darken",
  lighten: "lighten",
  "color-dodge": "color dodge",
  "color-burn": "color burn",
  "hard-light": "hard light",
  "soft-light": "soft light",
  difference: "difference",
  exclusion: "exclusion",
  hue: "hue",
  saturation: "saturation",
  color: "color",
  luminosity: "luminosity",
  lighter: "linear dodge",
};

/** Grey mask (white shows) → our alpha mask; and back. */
function greyToAlpha(src: HTMLCanvasElement, w: number, h: number, dx: number, dy: number, fill: number) {
  const c = makeCanvas(w, h);
  const g = ctx2d(c, true);
  g.fillStyle = `rgb(${fill},${fill},${fill})`;
  g.fillRect(0, 0, w, h);
  g.drawImage(src, dx, dy);
  const img = g.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i + 3] = img.data[i];
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

function alphaToGrey(mask: HTMLCanvasElement) {
  const c = makeCanvas(mask.width, mask.height);
  const g = ctx2d(c);
  g.fillStyle = "#000";
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(mask, 0, 0);
  return c;
}

type PsdLayer = {
  name?: string;
  left?: number;
  top?: number;
  canvas?: HTMLCanvasElement;
  opacity?: number;
  blendMode?: string;
  hidden?: boolean;
  clipping?: boolean;
  children?: PsdLayer[];
  mask?: { left?: number; top?: number; canvas?: HTMLCanvasElement; defaultColor?: number; disabled?: boolean };
};

async function readPsdFile(file: File): Promise<Doc> {
  const { readPsd } = await import("ag-psd");
  const psd = readPsd(await file.arrayBuffer(), { skipThumbnail: true }) as unknown as PsdLayer & { width: number; height: number };
  const layers: Layer[] = [];
  // Groups are flattened into their layers; a hidden group hides them, its opacity multiplies theirs.
  const walk = (list: PsdLayer[] | undefined, hidden: boolean, opacity: number) => {
    for (const l of list ?? []) {
      if (l.children) {
        walk(l.children, hidden || !!l.hidden, opacity * (l.opacity ?? 1));
        continue;
      }
      const canvas = l.canvas ?? makeCanvas(1, 1);
      const x = l.left ?? 0;
      const y = l.top ?? 0;
      let mask: HTMLCanvasElement | null = null;
      if (l.mask?.canvas) mask = greyToAlpha(l.mask.canvas, canvas.width, canvas.height, (l.mask.left ?? 0) - x, (l.mask.top ?? 0) - y, l.mask.defaultColor ?? 255);
      layers.push(
        newLayer({
          name: l.name || `Layer ${layers.length + 1}`,
          canvas,
          x,
          y,
          visible: !hidden && !l.hidden,
          opacity: opacity * (l.opacity ?? 1),
          blend: FROM_PSD[l.blendMode ?? "normal"] ?? "normal",
          clip: !!l.clipping,
          mask,
          maskOn: !l.mask?.disabled,
        }),
      );
    }
  };
  walk(psd.children, false, 1);
  if (!layers.length) {
    if (!psd.canvas) throw new Error("That PSD has no pixels we can read.");
    return docFromCanvas(psd.canvas, stem(file.name));
  }
  return { w: psd.width, h: psd.height, layers, active: layers[layers.length - 1].id, selection: null, editMask: false, name: stem(file.name) };
}

export async function writePsdFile(doc: Doc): Promise<{ blob: Blob; notes: string[] }> {
  const { writePsdUint8Array } = await import("ag-psd");
  const notes: string[] = [];
  const children = doc.layers
    .filter((l) => {
      if (l.kind === "adjustment") {
        notes.push("Adjustment layers are applied in the PSD's flat preview but not kept as layers.");
        return false;
      }
      return true;
    })
    .map((l) => {
      // Layer styles are baked in (with the mask) so the PSD looks the same anywhere.
      if (l.effects) return { name: l.name, left: 0, top: 0, canvas: layerAsDoc(doc, { ...l, opacity: 1, blend: "normal" }), opacity: l.opacity, blendMode: TO_PSD[l.blend], hidden: !l.visible, clipping: l.clip };
      return {
        name: l.name,
        left: l.x,
        top: l.y,
        canvas: l.canvas,
        opacity: l.opacity,
        blendMode: TO_PSD[l.blend],
        hidden: !l.visible,
        clipping: l.clip,
        mask: l.mask ? { left: l.x, top: l.y, canvas: alphaToGrey(l.mask), defaultColor: 0, disabled: !l.maskOn } : undefined,
      };
    });
  const bytes = writePsdUint8Array(
    // ag-psd's types expect its own BlendMode union; ours are mapped to exactly those names above.
    { width: doc.w, height: doc.h, canvas: flatten(doc), children } as unknown as Parameters<typeof writePsdUint8Array>[0],
    { generateThumbnail: true, trimImageData: true, noBackground: true },
  );
  return { blob: new Blob([bytes as BlobPart], { type: "image/vnd.adobe.photoshop" }), notes: [...new Set(notes)] };
}

/* ---------- Project files and the saved session ---------- */

type SmartFilterJson = { id: string; opId: string; label: string; params: Record<string, unknown>; enabled: boolean; opacity: number };
type SmartMetaJson = { sourceId: string; sourceDoc: DocJson; matrix: [number, number, number, number, number, number]; filters: SmartFilterJson[]; filtersOn: boolean };
type LayerJson = Omit<Layer, "canvas" | "mask" | "smart"> & { canvas: string; mask: string | null; w: number; h: number; smart?: SmartMetaJson };
type DocJson = { version: 1; w: number; h: number; name: string; active: string; layers: LayerJson[] };

const blobCache = new WeakMap<HTMLCanvasElement, Promise<Blob>>();
const pngOf = (c: HTMLCanvasElement) => {
  let p = blobCache.get(c);
  if (!p) {
    p = new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't encode a layer."))), "image/png"));
    blobCache.set(c, p);
  }
  return p;
};

/** The document as JSON plus one PNG per layer and mask (unchanged canvases reuse their PNG). */
export async function serialize(doc: Doc, prefix = "") {
  const files: Record<string, Blob> = {};
  const layers: LayerJson[] = [];
  for (const l of doc.layers) {
    const cpath = `${prefix}layers/${l.id}.png`;
    files[cpath] = await pngOf(l.canvas);
    let mpath: string | null = null;
    if (l.mask) {
      mpath = `${prefix}masks/${l.id}.png`;
      files[mpath] = await pngOf(l.mask);
    }
    const { smart, canvas: _c, mask: _m, ...rest } = l;
    void _c;
    void _m;
    let smartJson: SmartMetaJson | undefined;
    if (smart) {
      const sub = await serialize(smart.sourceDoc, `${prefix}smart/${l.id}/`);
      Object.assign(files, sub.files);
      smartJson = {
        sourceId: smart.sourceId,
        matrix: smart.matrix,
        filters: smart.filters,
        filtersOn: smart.filtersOn,
        sourceDoc: sub.json,
      };
    }
    layers.push({ ...rest, canvas: cpath, mask: mpath, w: l.canvas.width, h: l.canvas.height, ...(smartJson ? { smart: smartJson } : {}) });
  }
  const json: DocJson = { version: 1, w: doc.w, h: doc.h, name: doc.name, active: doc.active, layers };
  return { json, files };
}

export async function deserialize(json: DocJson, files: Record<string, Blob>): Promise<Doc> {
  const layers: Layer[] = [];
  for (const l of json.layers) {
    const load = async (path: string | null, w: number, h: number) => {
      if (!path || !files[path]) return null;
      const c = await decodeImage(files[path]);
      if (c.width === w && c.height === h) return c;
      const fixed = makeCanvas(w, h);
      ctx2d(fixed).drawImage(c, 0, 0);
      return fixed;
    };
    const canvas = (await load(l.canvas, l.w, l.h)) ?? makeCanvas(l.w, l.h);
    const mask = await load(l.mask, l.w, l.h);
    const { w: _w, h: _h, smart, ...rest } = l;
    void _w;
    void _h;
    const restoredSmart = smart
      ? {
          sourceId: smart.sourceId,
          matrix: smart.matrix,
          filters: smart.filters ?? [],
          filtersOn: smart.filtersOn !== false,
          sourceDoc: await deserialize(smart.sourceDoc, files),
        }
      : undefined;
    layers.push({ ...rest, id: l.id || newId(), canvas, mask, ...(restoredSmart ? { smart: restoredSmart } : {}) });
  }
  return { w: json.w, h: json.h, name: json.name, layers, active: json.active, selection: null, editMask: false };
}

export async function writeProject(doc: Doc): Promise<Blob> {
  const { zipSync, strToU8 } = await import("fflate");
  const { json, files } = await serialize(doc);
  const entries: Record<string, Uint8Array> = { "document.json": strToU8(JSON.stringify(json)) };
  for (const [k, b] of Object.entries(files)) entries[k] = new Uint8Array(await b.arrayBuffer());
  // PNGs are already compressed: store them, only deflate the JSON.
  return new Blob([zipSync(entries, { level: 0 }) as BlobPart], { type: "application/zip" });
}

async function readProject(bytes: Uint8Array): Promise<Doc> {
  const { unzipSync, strFromU8 } = await import("fflate");
  const all = unzipSync(bytes);
  if (!all["document.json"]) throw new Error("That isn't a project saved by this editor.");
  const json = JSON.parse(strFromU8(all["document.json"])) as DocJson;
  const files: Record<string, Blob> = {};
  for (const [k, v] of Object.entries(all)) if (k.endsWith(".png")) files[k] = new Blob([v as BlobPart], { type: "image/png" });
  return deserialize(json, files);
}

/* ---------- Session autosave (IndexedDB) ---------- */

const DB = "dwyl-pro-photo";
const STORE = "session";

function db(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export type SavedSession = { json: DocJson; files: Record<string, Blob>; savedAt: number; thumb: Blob | null };

export async function saveSession(doc: Doc) {
  try {
    const { json, files } = await serialize(doc);
    const flat = flatten(doc);
    const k = Math.min(1, 240 / Math.max(flat.width, flat.height));
    const t = makeCanvas(flat.width * k, flat.height * k);
    ctx2d(t).drawImage(flat, 0, 0, t.width, t.height);
    const thumb = await new Promise<Blob | null>((r) => t.toBlob(r, "image/jpeg", 0.8));
    const d = await db();
    await new Promise<void>((res, rej) => {
      const tx = d.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({ json, files, savedAt: Date.now(), thumb } satisfies SavedSession, "last");
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    d.close();
    return true;
  } catch {
    return false; // Private windows and full disks: autosave is a nicety, never an error.
  }
}

export async function loadSession(): Promise<SavedSession | null> {
  try {
    const d = await db();
    const v = await new Promise<SavedSession | undefined>((res, rej) => {
      const r = d.transaction(STORE).objectStore(STORE).get("last");
      r.onsuccess = () => res(r.result as SavedSession | undefined);
      r.onerror = () => rej(r.error);
    });
    d.close();
    return v ?? null;
  } catch {
    return null;
  }
}

export async function clearSession() {
  try {
    const d = await db();
    d.transaction(STORE, "readwrite").objectStore(STORE).delete("last");
    d.close();
  } catch {}
}

/* ---------- Export ---------- */

export type ExportFormat = "png" | "jpg" | "webp";

export function exportBlob(doc: Doc, format: ExportFormat, quality: number, scale: number, background: string): Promise<Blob> {
  let flat = flatten(doc);
  if (scale !== 1) {
    const s = makeCanvas(flat.width * scale, flat.height * scale);
    const g = ctx2d(s);
    g.imageSmoothingQuality = "high";
    g.drawImage(flat, 0, 0, s.width, s.height);
    flat = s;
  }
  if (format === "jpg") {
    // JPG has no transparency: put the picture on a solid colour.
    const s = makeCanvas(flat.width, flat.height);
    const g = ctx2d(s);
    g.fillStyle = background;
    g.fillRect(0, 0, s.width, s.height);
    g.drawImage(flat, 0, 0);
    flat = s;
  }
  const type = format === "png" ? "image/png" : format === "jpg" ? "image/jpeg" : "image/webp";
  return new Promise((res, rej) => flat.toBlob((b) => (b ? res(b) : rej(new Error("This browser couldn't make that file."))), type, quality));
}

export async function copyToClipboard(doc: Doc) {
  const blob = await exportBlob(doc, "png", 1, 1, "#fff");
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}
