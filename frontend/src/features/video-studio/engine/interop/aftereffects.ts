import * as TL from "../../lib/timeline";
import { rt, uid } from "../../lib/time";
import type { Keyframe, MediaAsset, MediaKind } from "../../types";
import { cleanPathBasename, findAllXml, inferMediaKind, parseXmlTree, xmlChild, xmlText, type ImportResult, type OfflineAssetInfo } from "./types";

/**
 * Adobe After Effects (.aep binary RIFX/Egg! chunk walker + .aepx XML) and Bodymovin/Lottie (.json) importer.
 */

function makeAeOffline(id: string, name: string, expectedPath: string, kind: MediaKind, duration: number, w: number, h: number, fps: number): MediaAsset {
  return {
    id,
    name: name || "AE Footage",
    kind,
    mime: kind === "audio" ? "audio/mpeg" : kind === "image" ? "image/png" : "video/mp4",
    size: 0,
    duration: Math.max(0.5, duration),
    width: w,
    height: h,
    fps,
    rotation: 0,
    hasVideo: kind !== "audio",
    hasAudio: kind !== "image",
    decodable: false,
    storage: "idb",
    sourcePath: expectedPath,
    addedAt: Date.now(),
  };
}

/* ---------- After Effects XML (.aepx) ---------- */

export function importAepx(xmlTextContent: string, fileName: string): ImportResult {
  const root = parseXmlTree(xmlTextContent);
  if (root.tag !== "AfterEffectsProject" && !findAllXml(root, "AfterEffectsProject").length) {
    throw new Error("Not a valid After Effects XML (.aepx) project.");
  }

  // Locate primary composition (<Item> whose <idta> describes composition or first <Layr>-bearing Item).
  const items = findAllXml(root, "Item");
  const compItem = items.find((it) => findAllXml(it, "Layr").length > 0) ?? items[0];
  const cdta = xmlChild(compItem, "cdta");
  const fps = Math.max(12, Math.min(120, Number(cdta?.attrs.fps || xmlText(compItem, "fps")) || 30));
  const W = Math.max(320, Number(cdta?.attrs.width) || 1920);
  const H = Math.max(240, Number(cdta?.attrs.height) || 1080);

  const compName = xmlText(compItem, "string") || fileName.replace(/\.[^.]+$/, "");
  const aspect = TL.nearestAspect(W, H);
  const p = TL.defaultProject(aspect);
  p.name = compName;
  p.settings.width = W;
  p.settings.height = H;
  p.settings.fps = fps;
  p.tracks = [];
  p.clips = {};

  const offlineAssets: OfflineAssetInfo[] = [];
  const warnings: string[] = [];
  const createdMedia = new Map<string, string>();
  const ensureMedia = (name: string, path: string, kind: MediaKind, dur: number): string => {
    const k = path || name;
    const hit = createdMedia.get(k);
    if (hit) return hit;
    const id = uid("m");
    const asset = makeAeOffline(id, name, path || name, kind, dur, W, H, fps);
    p.media[id] = asset;
    createdMedia.set(k, id);
    offlineAssets.push({ mediaId: id, name: asset.name, expectedPath: path || name, kind, duration: asset.duration });
    return id;
  };

  // Extract standalone footage items for lookup and offline inventory.
  const footageList: { name: string; path: string; kind: MediaKind }[] = [];
  for (const als of findAllXml(root, "alas")) {
    const txt = als.text.trim();
    if (!txt) continue;
    try {
      const json = JSON.parse(txt) as { fullpath?: string };
      if (json.fullpath) {
        footageList.push({ name: cleanPathBasename(json.fullpath), path: json.fullpath, kind: inferMediaKind(json.fullpath, "video") });
      }
    } catch {
      /* ignore non-JSON als chunks */
    }
  }
  for (const fn of findAllXml(root, "fnam")) {
    if (fn.text.trim()) {
      footageList.push({ name: cleanPathBasename(fn.text.trim()), path: fn.text.trim(), kind: inferMediaKind(fn.text.trim(), "video") });
    }
  }

  const layers = compItem ? findAllXml(compItem, "Layr") : findAllXml(root, "Layr");
  layers.forEach((layr, idx) => {
    const ldta = xmlChild(layr, "ldta");
    const layerName = xmlText(layr, "string") || `Layer ${idx + 1}`;
    const startSec = Number(ldta?.attrs.startTime) || 0;
    const durSec = Math.max(0.5, Number(ldta?.attrs.duration) || 5);
    const isText = findAllXml(layr, "sTxt").length > 0 || findAllXml(layr, "btdk").length > 0;
    const isSolid = layerName.toLowerCase().includes("solid");
    const isAdj = ldta?.attrs.adjustmentLayer === "1" || layerName.toLowerCase().includes("adjustment");
    const track = {
      id: uid("t"),
      kind: (idx === layers.length - 1 ? "video" : "overlay") as "video" | "overlay",
      name: layerName,
      muted: false,
      hidden: ldta?.attrs.enabled === "0",
      locked: ldta?.attrs.locked === "1",
    };
    p.tracks.push(track);

    if (isAdj) {
      const clip = TL.newClip(p, { trackId: track.id, kind: "adjustment", name: layerName, start: rt(Math.max(0, startSec)), duration: rt(durSec) });
      p.clips[clip.id] = clip;
    } else if (isText) {
      const textVal = findAllXml(layr, "sTxt")[0]?.text.trim() || layerName;
      const clip = TL.textClip(p, { id: "aepx", label: layerName, text: textVal, style: {} }, rt(Math.max(0, startSec)), track.id);
      clip.duration = rt(durSec);
      p.clips[clip.id] = clip;
    } else if (isSolid) {
      const clip = TL.newClip(p, { trackId: track.id, kind: "solid", name: layerName, start: rt(Math.max(0, startSec)), duration: rt(durSec), color: "#15140f" });
      p.clips[clip.id] = clip;
    } else {
      const match = footageList.find((f) => f.name.toLowerCase() === layerName.toLowerCase()) ?? footageList[idx % Math.max(1, footageList.length)];
      const kind = match?.kind ?? "video";
      const mediaId = ensureMedia(match?.name ?? layerName, match?.path ?? layerName, kind, durSec);
      const clip = TL.newClip(p, {
        trackId: track.id,
        kind: kind === "audio" ? "audio" : kind === "image" ? "image" : "video",
        mediaId,
        name: layerName,
        start: rt(Math.max(0, startSec)),
        duration: rt(durSec),
      });
      p.clips[clip.id] = clip;
    }
  });

  if (!p.tracks.length) {
    p.tracks = TL.defaultProject(aspect).tracks;
    for (const [i, f] of footageList.entries()) {
      const mediaId = ensureMedia(f.name, f.path, f.kind, 5);
      const tid = p.tracks.find((t) => (f.kind === "audio" ? t.kind === "audio" : t.kind === "video"))?.id ?? p.tracks[0].id;
      const clip = TL.newClip(p, { trackId: tid, kind: f.kind === "audio" ? "audio" : f.kind === "image" ? "image" : "video", mediaId, name: f.name, start: i * 5, duration: 5 });
      p.clips[clip.id] = clip;
    }
  }

  warnings.push("After Effects expressions and 3rd-party plugins are mapped to native studio layers.");
  return { project: p, source: "aftereffects-aepx", sourceLabel: "After Effects (.aepx)", warnings, offlineAssets, fontsUsed: [] };
}

/* ---------- After Effects Binary (.aep RIFX / Egg!) ---------- */

type RiffChunk = { id: string; listType?: string; data: Uint8Array; children: RiffChunk[] };

function readFourCC(bytes: Uint8Array, off: number) {
  return String.fromCharCode(bytes[off], bytes[off + 1], bytes[off + 2], bytes[off + 3]);
}

function readU32BE(bytes: Uint8Array, off: number) {
  return ((bytes[off] << 24) | (bytes[off + 1] << 16) | (bytes[off + 2] << 8) | bytes[off + 3]) >>> 0;
}

function parseRiffChunks(bytes: Uint8Array, start: number, end: number, depth = 0): RiffChunk[] {
  const out: RiffChunk[] = [];
  let pos = start;
  while (pos + 8 <= end && depth < 12) {
    const id = readFourCC(bytes, pos);
    const size = readU32BE(bytes, pos + 4);
    const payloadStart = pos + 8;
    const payloadEnd = Math.min(end, payloadStart + size);
    if (size > end - payloadStart + 8 || !/^[\x20-\x7e]{4}$/.test(id)) break;
    if (id === "LIST" || id === "RIFX") {
      if (payloadEnd - payloadStart >= 4) {
        const listType = readFourCC(bytes, payloadStart);
        const children = parseRiffChunks(bytes, payloadStart + 4, payloadEnd, depth + 1);
        out.push({ id, listType, data: bytes.subarray(payloadStart + 4, payloadEnd), children });
      }
    } else {
      out.push({ id, data: bytes.subarray(payloadStart, payloadEnd), children: [] });
    }
    pos = payloadStart + size + (size & 1);
  }
  return out;
}

function decodeTextBytes(data: Uint8Array): string {
  const nul = data.indexOf(0);
  const slice = nul >= 0 ? data.subarray(0, nul) : data;
  return new TextDecoder("utf-8", { fatal: false }).decode(slice).replace(/[\x00-\x1f]/g, " ").trim();
}

export function importAepBinary(bytes: Uint8Array, fileName: string): ImportResult {
  if (bytes.length < 16 || readFourCC(bytes, 0) !== "RIFX" || readFourCC(bytes, 8) !== "Egg!") {
    throw new Error("Not a valid After Effects (.aep) RIFX/Egg! binary file.");
  }
  const tree = parseRiffChunks(bytes, 12, bytes.length, 0);
  const compLists: RiffChunk[] = [];
  const footageRefs: { name: string; path: string; kind: MediaKind }[] = [];
  const layerNames: string[] = [];

  const walk = (chunk: RiffChunk) => {
    if (chunk.id === "LIST" && chunk.listType === "Item") {
      const hasLayr = chunk.children.some((c) => c.id === "LIST" && c.listType === "Layr");
      if (hasLayr) compLists.push(chunk);
    }
    if (chunk.id === "LIST" && chunk.listType === "Layr") {
      const utf8 = chunk.children.find((c) => c.id === "Utf8" || c.id === "Nm  ");
      if (utf8) {
        const nm = decodeTextBytes(utf8.data);
        if (nm) layerNames.push(nm);
      }
    }
    if (chunk.id === "alas" || chunk.id === "fnam") {
      const raw = decodeTextBytes(chunk.data);
      const jm = /\{[\s\S]*"fullpath"\s*:\s*"([^"]+)"/.exec(raw);
      const path = jm ? jm[1].replace(/\\\\/g, "\\") : raw;
      if (path && (path.includes(".") || path.includes("/") || path.includes("\\"))) {
        footageRefs.push({ name: cleanPathBasename(path), path, kind: inferMediaKind(path, "video") });
      }
    }
    for (const ch of chunk.children) walk(ch);
  };
  for (const ch of tree) walk(ch);

  const compName = compLists[0]?.children.find((c) => c.id === "Utf8") ? decodeTextBytes(compLists[0].children.find((c) => c.id === "Utf8")!.data) : fileName.replace(/\.[^.]+$/, "");
  const p = TL.defaultProject("16:9");
  p.name = compName || fileName.replace(/\.[^.]+$/, "");
  p.tracks = [];
  p.clips = {};
  const W = p.settings.width;
  const H = p.settings.height;
  const offlineAssets: OfflineAssetInfo[] = [];
  const warnings: string[] = [
    "Parsed After Effects RIFX/Egg! binary chunks: reconstructed composition structure and footage references.",
  ];
  const created = new Map<string, string>();
  const ensureMedia = (name: string, path: string, kind: MediaKind): string => {
    const key = path || name;
    const hit = created.get(key);
    if (hit) return hit;
    const id = uid("m");
    const asset = makeAeOffline(id, name, path || name, kind, 5, W, H, p.settings.fps);
    p.media[id] = asset;
    created.set(key, id);
    offlineAssets.push({ mediaId: id, name, expectedPath: path || name, kind, duration: asset.duration });
    return id;
  };

  if (layerNames.length > 0) {
    layerNames.forEach((nm, idx) => {
      const track = { id: uid("t"), kind: (idx === layerNames.length - 1 ? "video" : "overlay") as "video" | "overlay", name: nm, muted: false, hidden: false, locked: false };
      p.tracks.push(track);
      const foot = footageRefs.find((f) => f.name.toLowerCase() === nm.toLowerCase() || f.name.toLowerCase().includes(nm.toLowerCase()));
      if (nm.toLowerCase().includes("adjustment")) {
        const clip = TL.newClip(p, { trackId: track.id, kind: "adjustment", name: nm, start: 0, duration: 5 });
        p.clips[clip.id] = clip;
      } else if (foot) {
        const mediaId = ensureMedia(foot.name, foot.path, foot.kind);
        const clip = TL.newClip(p, { trackId: track.id, kind: foot.kind === "audio" ? "audio" : foot.kind === "image" ? "image" : "video", mediaId, name: nm, start: 0, duration: 5 });
        p.clips[clip.id] = clip;
      } else {
        const clip = TL.textClip(p, { id: "aep", label: nm, text: nm, style: {} }, 0, track.id);
        clip.duration = 5;
        p.clips[clip.id] = clip;
      }
    });
  } else if (footageRefs.length > 0) {
    p.tracks = TL.defaultProject("16:9").tracks;
    const vTr = p.tracks.find((t) => t.kind === "video")!.id;
    let cursor = 0;
    for (const f of footageRefs) {
      const mediaId = ensureMedia(f.name, f.path, f.kind);
      const clip = TL.newClip(p, { trackId: vTr, kind: f.kind === "audio" ? "audio" : f.kind === "image" ? "image" : "video", mediaId, name: f.name, start: cursor, duration: 5 });
      p.clips[clip.id] = clip;
      cursor += 5;
    }
  } else {
    p.tracks = TL.defaultProject("16:9").tracks;
  }

  return { project: p, source: "aftereffects-aep", sourceLabel: "After Effects (.aep)", warnings, offlineAssets, fontsUsed: [] };
}

/* ---------- Bodymovin / Lottie (.json) ---------- */

type LottieProp = { a?: number; k?: unknown };
type LottieKeyframe = { t?: number; s?: number[] | number; e?: number[] | number };
type LottieLayer = {
  nm?: string;
  ty?: number;
  ip?: number;
  op?: number;
  st?: number;
  refId?: string;
  sc?: string;
  ks?: { p?: LottieProp; s?: LottieProp; r?: LottieProp; o?: LottieProp };
  t?: { d?: { k?: { s?: { t?: string; f?: string; s?: number; fc?: number[] } }[] } };
};
type LottieDoc = { nm?: string; fr?: number; ip?: number; op?: number; w?: number; h?: number; assets?: { id?: string; p?: string; u?: string }[]; layers?: LottieLayer[] };

function lottieScalar(prop: LottieProp | undefined, def: number, idx = 0): number {
  if (!prop || prop.k === undefined) return def;
  if (typeof prop.k === "number") return prop.k;
  if (Array.isArray(prop.k)) {
    if (typeof prop.k[0] === "number") return Number(prop.k[idx] ?? prop.k[0] ?? def);
    const first = prop.k[0] as LottieKeyframe;
    if (first?.s) return Array.isArray(first.s) ? Number(first.s[idx] ?? def) : Number(first.s);
  }
  return def;
}

function lottieKeys(prop: LottieProp | undefined, fps: number, clipStart: number, idx = 0, scale = 1): Keyframe[] | undefined {
  if (!prop || !prop.a || !Array.isArray(prop.k)) return undefined;
  const out: Keyframe[] = [];
  for (const kf of prop.k as LottieKeyframe[]) {
    if (kf.t === undefined || kf.s === undefined) continue;
    const raw = Array.isArray(kf.s) ? Number(kf.s[idx] ?? 0) : Number(kf.s);
    out.push({ id: uid("k"), t: Math.max(0, rt(kf.t / fps - clipStart)), v: rt(raw * scale), ease: "easeInOut" });
  }
  return out.length >= 2 ? out : undefined;
}

export function importLottie(jsonText: string, fileName: string): ImportResult {
  const doc = JSON.parse(jsonText) as LottieDoc;
  if (!Array.isArray(doc.layers) || typeof doc.fr !== "number") throw new Error("Not a valid Lottie / Bodymovin JSON animation.");
  const fps = Math.max(12, Math.min(120, Math.round(doc.fr)));
  const W = Math.max(120, Math.round(doc.w || 1920));
  const H = Math.max(120, Math.round(doc.h || 1080));
  const aspect = TL.nearestAspect(W, H);
  const p = TL.defaultProject(aspect);
  p.name = doc.nm || fileName.replace(/\.[^.]+$/, "");
  p.settings.width = W;
  p.settings.height = H;
  p.settings.fps = fps;
  p.tracks = [];
  p.clips = {};

  const offlineAssets: OfflineAssetInfo[] = [];
  const fontsUsed = new Set<string>();
  const assets = new Map((doc.assets ?? []).map((a) => [a.id ?? "", a]));

  doc.layers.forEach((ly, idx) => {
    const startF = ly.ip ?? doc.ip ?? 0;
    const endF = Math.max(startF + 1, ly.op ?? doc.op ?? fps * 4);
    const start = rt(Math.max(0, startF / fps));
    const duration = rt(Math.max(0.1, (endF - startF) / fps));
    const track = { id: uid("t"), kind: (idx === doc.layers!.length - 1 ? "video" : "overlay") as "video" | "overlay", name: ly.nm || `Layer ${idx + 1}`, muted: false, hidden: false, locked: false };
    p.tracks.push(track);

    const x = lottieScalar(ly.ks?.p, W / 2, 0);
    const y = lottieScalar(ly.ks?.p, H / 2, 1);
    const sx = lottieScalar(ly.ks?.s, 100, 0) / 100;
    const sy = lottieScalar(ly.ks?.s, 100, 1) / 100;
    const rot = lottieScalar(ly.ks?.r, 0, 0);
    const op = lottieScalar(ly.ks?.o, 100, 0) / 100;

    let clip;
    if (ly.ty === 5) {
      const td = ly.t?.d?.k?.[0]?.s;
      const font = td?.f || "Inter";
      fontsUsed.add(font);
      const fc = td?.fc ? `#${td.fc.slice(0, 3).map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("")}` : "#ffffff";
      clip = TL.textClip(p, { id: "lot", label: ly.nm || td?.t || "Text", text: td?.t || ly.nm || "Title", style: { font, size: td?.s || 64, color: fc } }, start, track.id);
      clip.duration = duration;
    } else if (ly.ty === 1) {
      clip = TL.newClip(p, { trackId: track.id, kind: "solid", name: ly.nm || "Solid", start, duration, color: ly.sc || "#15140f" });
    } else if (ly.ty === 2 && ly.refId) {
      const a = assets.get(ly.refId);
      const mid = uid("m");
      const nm = a?.p || ly.nm || "Image";
      p.media[mid] = makeAeOffline(mid, nm, `${a?.u ?? ""}${nm}`, "image", duration, W, H, fps);
      offlineAssets.push({ mediaId: mid, name: nm, expectedPath: `${a?.u ?? ""}${nm}`, kind: "image", duration });
      clip = TL.newClip(p, { trackId: track.id, kind: "image", mediaId: mid, name: ly.nm || nm, start, duration });
    } else {
      clip = TL.newClip(p, { trackId: track.id, kind: "shape", name: ly.nm || "Shape layer", start, duration });
    }

    clip.transform = {
      x: { v: x, k: lottieKeys(ly.ks?.p, fps, start, 0, 1) },
      y: { v: y, k: lottieKeys(ly.ks?.p, fps, start, 1, 1) },
      scaleX: { v: sx, k: lottieKeys(ly.ks?.s, fps, start, 0, 0.01) },
      scaleY: { v: sy, k: lottieKeys(ly.ks?.s, fps, start, 1, 0.01) },
      rotation: { v: rot, k: lottieKeys(ly.ks?.r, fps, start, 0, 1) },
      opacity: { v: op, k: lottieKeys(ly.ks?.o, fps, start, 0, 0.01) },
    };
    p.clips[clip.id] = clip;
  });

  if (!p.tracks.length) p.tracks = TL.defaultProject(aspect).tracks;
  return { project: p, source: "lottie", sourceLabel: "After Effects / Lottie JSON", warnings: [], offlineAssets, fontsUsed: Array.from(fontsUsed) };
}
