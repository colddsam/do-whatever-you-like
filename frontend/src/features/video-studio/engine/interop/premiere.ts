import { gunzipSync, strFromU8 } from "fflate";
import * as TL from "../../lib/timeline";
import { rt, uid } from "../../lib/time";
import type { ClipKind, MediaAsset, Project } from "../../types";
import { cleanPathBasename, findAllXml, inferMediaKind, parseXmlTree, xmlChild, xmlChildren, xmlText, type ImportResult, type OfflineAssetInfo, type XmlNode } from "./types";

/**
 * Premiere Pro & Final Cut Pro X / CMX 3600 EDL importer + exporter:
 * - `.prproj` (gzipped or plain Premiere Pro XML project with `<PremiereData>` and 254,016,000,000 ticks/sec timing)
 * - `.xml` (Final Cut Pro 7 / Premiere XMEML v4/v5)
 * - `.fcpxml` (Apple Final Cut Pro XML with rational timing)
 * - `.edl` (CMX 3600 Edit Decision List)
 */

const PREMIERE_TICKS_PER_SEC = 254_016_000_000;

function makeOfflineAsset(id: string, name: string, sourcePath: string, kind: MediaKind, duration: number, width: number, height: number, fps: number): MediaAsset {
  return {
    id,
    name: name || "Offline clip",
    kind,
    mime: kind === "audio" ? "audio/mpeg" : kind === "image" ? "image/png" : "video/mp4",
    size: 0,
    duration: Math.max(0.1, duration),
    width,
    height,
    fps,
    rotation: 0,
    hasVideo: kind !== "audio",
    hasAudio: kind !== "image",
    decodable: false,
    storage: "idb",
    sourcePath,
    addedAt: Date.now(),
  };
}

type MediaKind = "video" | "audio" | "image";

function projectFromSpec(name: string, w: number, h: number, fps: number): Project {
  const aspect = TL.nearestAspect(w, h);
  const p = TL.defaultProject(aspect);
  p.name = name || "Imported sequence";
  p.settings.width = Math.max(320, Math.round(w));
  p.settings.height = Math.max(240, Math.round(h));
  p.settings.fps = Math.max(12, Math.min(120, Math.round(fps) || 30));
  p.tracks = [];
  p.clips = {};
  return p;
}

/* ---------- Premiere XMEML (.xml) ---------- */

export function importXmeml(xmlContent: string, fileName: string): ImportResult {
  const root = parseXmlTree(xmlContent);
  const seqs = findAllXml(root, "sequence");
  const seq = seqs[0];
  if (!seq) throw new Error("No <sequence> found in that Premiere XML file.");

  const seqName = xmlText(seq, "name") || fileName.replace(/\.[^.]+$/, "");
  const seqRate = xmlChild(seq, "rate");
  const baseRate = Number(xmlText(seqRate, "timebase")) || 30;
  const ntsc = xmlText(seqRate, "ntsc").toUpperCase() === "TRUE";
  const fps = ntsc && baseRate === 30 ? 29.97 : ntsc && baseRate === 24 ? 23.976 : baseRate;

  const mediaNode = xmlChild(seq, "media");
  const videoNode = xmlChild(mediaNode, "video");
  const audioNode = xmlChild(mediaNode, "audio");
  const sampleChar = xmlChild(xmlChild(videoNode, "format"), "samplecharacteristics");
  const width = Number(xmlText(sampleChar, "width")) || 1920;
  const height = Number(xmlText(sampleChar, "height")) || 1080;

  const p = projectFromSpec(seqName, width, height, fps);
  const fileIndex = new Map<string, { name: string; path: string; duration: number; width: number; height: number; fps: number }>();
  for (const fn of findAllXml(root, "file")) {
    const id = fn.attrs.id;
    const pathurl = xmlText(fn, "pathurl");
    const name = xmlText(fn, "name") || (pathurl ? cleanPathBasename(pathurl) : "");
    const durFrames = Number(xmlText(fn, "duration")) || 0;
    const sc = xmlChild(xmlChild(xmlChild(fn, "media"), "video"), "samplecharacteristics");
    const fw = Number(xmlText(sc, "width")) || width;
    const fh = Number(xmlText(sc, "height")) || height;
    const ff = Number(xmlText(xmlChild(fn, "rate"), "timebase")) || fps;
    if (id && (name || pathurl)) {
      fileIndex.set(id, { name: name || cleanPathBasename(pathurl), path: pathurl || name, duration: Math.max(5, durFrames / Math.max(1, ff)), width: fw, height: fh, fps: ff });
    }
  }

  const assetByKey = new Map<string, MediaAsset>();
  const offlineAssets: OfflineAssetInfo[] = [];
  const warnings: string[] = [];

  const getOrCreateAsset = (key: string, label: string, path: string, kind: MediaKind, dur: number, aw: number, ah: number, afps: number): string => {
    const existing = assetByKey.get(key);
    if (existing) return existing.id;
    const id = uid("m");
    const asset = makeOfflineAsset(id, label, path, kind, dur, aw, ah, afps);
    p.media[id] = asset;
    assetByKey.set(key, asset);
    offlineAssets.push({ mediaId: id, name: asset.name, expectedPath: path, kind, duration: asset.duration });
    return id;
  };

  const visualTracks: XmlNode[] = xmlChildren(videoNode, "track").reverse();
  const audioTracks: XmlNode[] = xmlChildren(audioNode, "track");

  visualTracks.forEach((trNode, idx) => {
    const isBase = idx === visualTracks.length - 1;
    const tr = { id: uid("t"), kind: (isBase ? "video" : "overlay") as "video" | "overlay", name: isBase ? "Video 1" : `Overlay ${visualTracks.length - idx - 1}`, muted: false, hidden: false, locked: false };
    p.tracks.push(tr);
    for (const item of xmlChildren(trNode, "clipitem")) {
      const tb = Number(xmlText(xmlChild(item, "rate"), "timebase")) || fps;
      const startF = Number(xmlText(item, "start"));
      const endF = Number(xmlText(item, "end"));
      const inF = Math.max(0, Number(xmlText(item, "in")) || 0);
      const outF = Math.max(inF + 1, Number(xmlText(item, "out")) || inF + Math.max(1, endF - startF));
      if (!Number.isFinite(startF) || !Number.isFinite(endF) || endF <= startF || startF < 0) continue;

      const cName = xmlText(item, "name") || "Clip";
      const fileEl = xmlChild(item, "file");
      const fid = fileEl?.attrs.id ?? cName;
      const fMeta = fileIndex.get(fid);
      const pathurl = xmlText(fileEl, "pathurl") || fMeta?.path || cName;
      const kind = inferMediaKind(pathurl, "video");
      const dur = Math.max(0.1, (endF - startF) / tb);
      const mediaId = getOrCreateAsset(fid, fMeta?.name ?? cleanPathBasename(pathurl), pathurl, kind, fMeta?.duration ?? Math.max(dur + inF / tb, 10), fMeta?.width ?? width, fMeta?.height ?? height, tb);

      const clip = TL.newClip(p, {
        trackId: tr.id,
        kind: kind === "image" ? "image" : "video",
        mediaId,
        name: cName,
        start: rt(startF / tb),
        duration: rt(dur),
        in: rt(inF / tb),
        speed: rt(((outF - inF) / tb) / dur) || 1,
      });
      p.clips[clip.id] = clip;
    }
    // Check generator items (titles/text).
    for (const gen of xmlChildren(trNode, "generatoritem")) {
      const tb = Number(xmlText(xmlChild(gen, "rate"), "timebase")) || fps;
      const startF = Number(xmlText(gen, "start"));
      const endF = Number(xmlText(gen, "end"));
      if (!Number.isFinite(startF) || !Number.isFinite(endF) || endF <= startF || startF < 0) continue;
      const txtParam = findAllXml(gen, "parameter").find((pa) => xmlText(pa, "name").toLowerCase().includes("text") || xmlText(pa, "parameterid") === "str");
      const content = xmlText(txtParam, "value") || xmlText(gen, "name") || "Title";
      const clip = TL.textClip(p, { id: "imp", label: content.slice(0, 32), text: content, style: {} }, rt(startF / tb), tr.id);
      clip.duration = rt((endF - startF) / tb);
      p.clips[clip.id] = clip;
    }
  });

  audioTracks.forEach((trNode, idx) => {
    const tr = { id: uid("t"), kind: "audio" as const, name: `Audio ${idx + 1}`, muted: false, hidden: false, locked: false };
    p.tracks.push(tr);
    for (const item of xmlChildren(trNode, "clipitem")) {
      const tb = Number(xmlText(xmlChild(item, "rate"), "timebase")) || fps;
      const startF = Number(xmlText(item, "start"));
      const endF = Number(xmlText(item, "end"));
      const inF = Math.max(0, Number(xmlText(item, "in")) || 0);
      if (!Number.isFinite(startF) || !Number.isFinite(endF) || endF <= startF || startF < 0) continue;
      const cName = xmlText(item, "name") || "Audio clip";
      const fileEl = xmlChild(item, "file");
      const fid = fileEl?.attrs.id ?? `${cName}-a`;
      const fMeta = fileIndex.get(fid);
      const pathurl = xmlText(fileEl, "pathurl") || fMeta?.path || cName;
      const dur = Math.max(0.1, (endF - startF) / tb);
      const mediaId = getOrCreateAsset(fid, fMeta?.name ?? cleanPathBasename(pathurl), pathurl, fMeta ? inferMediaKind(fMeta.path, "audio") : "audio", fMeta?.duration ?? dur + inF / tb, 0, 0, tb);
      const clip = TL.newClip(p, {
        trackId: tr.id,
        kind: "audio",
        mediaId,
        name: cName,
        start: rt(startF / tb),
        duration: rt(dur),
        in: rt(inF / tb),
      });
      p.clips[clip.id] = clip;
    }
  });

  if (!p.tracks.length) {
    const def = TL.defaultProject(p.settings.aspect);
    p.tracks = def.tracks;
    warnings.push("Sequence had empty tracks; created default Video, Overlay and Audio tracks.");
  }

  return { project: p, source: "premiere-xml", sourceLabel: "Premiere Pro XMEML", warnings, offlineAssets, fontsUsed: [] };
}

/* ---------- Premiere Native Project (.prproj) ---------- */

export function importPrproj(bytes: Uint8Array, fileName: string): ImportResult {
  const isGzip = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  const xmlContent = strFromU8(isGzip ? gunzipSync(bytes) : bytes);
  const root = parseXmlTree(xmlContent);
  if (root.tag === "xmeml" || findAllXml(root, "xmeml").length) {
    const res = importXmeml(xmlContent, fileName);
    return { ...res, source: "premiere-prproj", sourceLabel: "Premiere Pro (.prproj)" };
  }

  // Parse native <PremiereData> object-reference graph.
  const seqNode = findAllXml(root, "Sequence")[0];
  const seqName = xmlText(seqNode, "Name") || fileName.replace(/\.[^.]+$/, "");
  const frameRectRaw = xmlText(seqNode, "FrameRect") || "0,0,1920,1080";
  const parts = frameRectRaw.split(",").map((s) => Number(s.trim()));
  const width = parts.length === 4 && parts[2] > 0 ? parts[2] : 1920;
  const height = parts.length === 4 && parts[3] > 0 ? parts[3] : 1080;

  const p = projectFromSpec(seqName, width, height, 30);
  const warnings: string[] = [];
  const offlineAssets: OfflineAssetInfo[] = [];

  // Map ObjectID / ObjectUID to nodes for resolving ObjectRef / ObjectURef pointers.
  const byId = new Map<string, XmlNode>();
  const byUid = new Map<string, XmlNode>();
  const indexTree = (n: XmlNode) => {
    if (n.attrs.ObjectID) byId.set(n.attrs.ObjectID, n);
    if (n.attrs.ObjectUID) byUid.set(n.attrs.ObjectUID, n);
    for (const ch of n.children) indexTree(ch);
  };
  indexTree(root);

  const deref = (n: XmlNode | undefined): XmlNode | undefined => {
    if (!n) return undefined;
    if (n.attrs.ObjectRef) return byId.get(n.attrs.ObjectRef);
    if (n.attrs.ObjectURef) return byUid.get(n.attrs.ObjectURef);
    return n;
  };

  // Index <Media> nodes by UID/ID for path extraction.
  const mediaNodes = findAllXml(root, "Media");
  const subClipNodes = [...findAllXml(root, "VideoClipTrackItem"), ...findAllXml(root, "AudioClipTrackItem")];
  const vTrackNodes = findAllXml(root, "VideoClipTrack");
  const aTrackNodes = findAllXml(root, "AudioClipTrack");
  const assetByKey = new Map<string, MediaAsset>();

  const registerMediaPath = (rawPath: string, title: string, kind: MediaKind, dur: number): string => {
    const key = rawPath || title || uid("m");
    const existing = assetByKey.get(key);
    if (existing) return existing.id;
    const id = uid("m");
    const name = title || cleanPathBasename(rawPath) || "Premiere Clip";
    const asset = makeOfflineAsset(id, name, rawPath, kind, dur, kind === "audio" ? 0 : width, kind === "audio" ? 0 : height, 30);
    p.media[id] = asset;
    assetByKey.set(key, asset);
    offlineAssets.push({ mediaId: id, name, expectedPath: rawPath, kind, duration: asset.duration });
    return id;
  };

  const parseTicks = (s: string) => {
    const n = Number(s);
    if (!Number.isFinite(n)) return 0;
    return n > 1_000_000 ? n / PREMIERE_TICKS_PER_SEC : n;
  };

  const trackIdByNode = new Map<XmlNode, string>();
  const revV = [...vTrackNodes].reverse();
  revV.forEach((tn, idx) => {
    const isBase = idx === revV.length - 1;
    const tr = { id: uid("t"), kind: (isBase ? "video" : "overlay") as "video" | "overlay", name: xmlText(tn, "Name") || (isBase ? "Video 1" : `Overlay ${revV.length - idx - 1}`), muted: false, hidden: false, locked: false };
    p.tracks.push(tr);
    trackIdByNode.set(tn, tr.id);
  });
  aTrackNodes.forEach((tn, idx) => {
    const tr = { id: uid("t"), kind: "audio" as const, name: xmlText(tn, "Name") || `Audio ${idx + 1}`, muted: false, hidden: false, locked: false };
    p.tracks.push(tr);
    trackIdByNode.set(tn, tr.id);
  });

  if (!p.tracks.length) {
    const baseTracks = TL.defaultProject(p.settings.aspect).tracks;
    p.tracks.push(...baseTracks);
  }
  const fallbackVideoTrack = p.tracks.find((t) => t.kind === "video")?.id ?? p.tracks[0].id;
  const fallbackAudioTrack = p.tracks.find((t) => t.kind === "audio")?.id ?? p.tracks[p.tracks.length - 1].id;

  // Map track items to their containing track when nested under ClipTrack -> ClipItems -> TrackItems -> ...
  const itemTrackMap = new Map<XmlNode, string>();
  for (const tn of [...vTrackNodes, ...aTrackNodes]) {
    const tid = trackIdByNode.get(tn);
    if (!tid) continue;
    for (const ref of findAllXml(tn, "TrackItem")) {
      const target = deref(ref);
      if (target) itemTrackMap.set(target, tid);
    }
  }

  for (const item of subClipNodes) {
    const clipItem = deref(xmlChild(item, "ClipTrackItem")) ?? item;
    const subClip = deref(xmlChild(clipItem, "SubClip")) ?? deref(xmlChild(item, "SubClip"));
    const clipNode = deref(xmlChild(subClip, "Clip")) ?? subClip;
    const sourceNode = deref(xmlChild(clipNode, "Source"));
    const mediaRef = deref(xmlChild(sourceNode, "Media")) ?? deref(xmlChild(item, "Media"));
    const filePath = xmlText(mediaRef, "ActualMediaFilePath") || xmlText(mediaRef, "FilePath") || xmlText(mediaRef, "RelativePath");
    const name = xmlText(clipNode, "Name") || xmlText(mediaRef, "FileKey") || (filePath ? cleanPathBasename(filePath) : "Clip");

    const startS = parseTicks(xmlText(clipItem, "Start") || xmlText(item, "Start"));
    const endS = parseTicks(xmlText(clipItem, "End") || xmlText(item, "End"));
    const inS = parseTicks(xmlText(clipNode, "InPoint") || xmlText(clipItem, "InPoint"));
    const dur = Math.max(0.1, endS > startS ? endS - startS : 4);
    const isAudio = item.tag.startsWith("Audio");
    const kind: ClipKind = isAudio ? "audio" : inferMediaKind(filePath || name, "video") === "image" ? "image" : "video";
    const tid = itemTrackMap.get(item) ?? (isAudio ? fallbackAudioTrack : fallbackVideoTrack);

    const mediaId = registerMediaPath(filePath || name, name, kind === "audio" ? "audio" : kind === "image" ? "image" : "video", Math.max(dur + inS, 8));
    const clip = TL.newClip(p, {
      trackId: tid,
      kind,
      mediaId,
      name,
      start: rt(Math.max(0, startS)),
      duration: rt(dur),
      in: rt(Math.max(0, inS)),
    });
    p.clips[clip.id] = clip;
  }

  // Fallback: if no TrackItems matched (nested differently in an older .prproj), scan <Media> entries directly.
  if (Object.keys(p.clips).length === 0 && mediaNodes.length > 0) {
    let cursor = 0;
    for (const mn of mediaNodes) {
      const path = xmlText(mn, "ActualMediaFilePath") || xmlText(mn, "FilePath") || xmlText(mn, "RelativePath");
      if (!path) continue;
      const name = cleanPathBasename(path);
      const kind = inferMediaKind(path, "video");
      const dur = 5;
      const mediaId = registerMediaPath(path, name, kind, dur);
      const clip = TL.newClip(p, {
        trackId: kind === "audio" ? fallbackAudioTrack : fallbackVideoTrack,
        kind: kind === "audio" ? "audio" : kind === "image" ? "image" : "video",
        mediaId,
        name,
        start: rt(cursor),
        duration: dur,
      });
      p.clips[clip.id] = clip;
      cursor += dur;
    }
    warnings.push("Imported project media bin sequentially because sequence track references used a non-standard schema.");
  }

  if (offlineAssets.length) warnings.push(`${offlineAssets.length} media file(s) from Premiere Pro need relinking to local files on your device.`);
  return { project: p, source: "premiere-prproj", sourceLabel: "Premiere Pro (.prproj)", warnings, offlineAssets, fontsUsed: [] };
}

/* ---------- Final Cut Pro XML (.fcpxml) ---------- */

function parseRationalTime(raw?: string): number {
  if (!raw) return 0;
  const s = raw.replace(/s$/i, "").trim();
  if (s.includes("/")) {
    const [a, b] = s.split("/").map(Number);
    return b ? a / b : 0;
  }
  return Number(s) || 0;
}

export function importFcpXml(xmlTextContent: string, fileName: string): ImportResult {
  const root = parseXmlTree(xmlTextContent);
  const resources = xmlChild(root, "resources");
  const formats = new Map<string, { width: number; height: number; fps: number }>();
  for (const f of xmlChildren(resources, "format")) {
    const dur = parseRationalTime(f.attrs.frameDuration);
    formats.set(f.attrs.id ?? "", {
      width: Number(f.attrs.width) || 1920,
      height: Number(f.attrs.height) || 1080,
      fps: dur > 0 ? Math.round(1 / dur) : 30,
    });
  }
  const assets = new Map<string, { name: string; src: string; duration: number; kind: MediaKind }>();
  for (const a of xmlChildren(resources, "asset")) {
    const mr = xmlChild(a, "media-rep");
    const src = a.attrs.src || mr?.attrs.src || "";
    const name = a.attrs.name || cleanPathBasename(src);
    const hasV = a.attrs.hasVideo !== "0";
    assets.set(a.attrs.id ?? "", {
      name,
      src: src || name,
      duration: Math.max(0.5, parseRationalTime(a.attrs.duration)),
      kind: inferMediaKind(src || name, hasV ? "video" : "audio"),
    });
  }

  const seq = findAllXml(root, "sequence")[0];
  const fmt = formats.get(seq?.attrs.format ?? "") ?? Array.from(formats.values())[0] ?? { width: 1920, height: 1080, fps: 30 };
  const projName = findAllXml(root, "project")[0]?.attrs.name || fileName.replace(/\.[^.]+$/, "");
  const p = projectFromSpec(projName, fmt.width, fmt.height, fmt.fps);
  const vTr = { id: uid("t"), kind: "video" as const, name: "Primary Storyline", muted: false, hidden: false, locked: false };
  const oTr = { id: uid("t"), kind: "overlay" as const, name: "Connected Clips", muted: false, hidden: false, locked: false };
  const aTr = { id: uid("t"), kind: "audio" as const, name: "Audio", muted: false, hidden: false, locked: false };
  p.tracks = [oTr, vTr, aTr];

  const offlineAssets: OfflineAssetInfo[] = [];
  const warnings: string[] = [];
  const createdMedia = new Map<string, string>();
  const ensureMedia = (refId: string, fallbackName: string, kind: MediaKind, dur: number): string => {
    const hit = createdMedia.get(refId);
    if (hit) return hit;
    const meta = assets.get(refId);
    const id = uid("m");
    const asset = makeOfflineAsset(id, meta?.name ?? fallbackName, meta?.src ?? fallbackName, meta?.kind ?? kind, meta?.duration ?? dur, fmt.width, fmt.height, fmt.fps);
    p.media[id] = asset;
    createdMedia.set(refId, id);
    offlineAssets.push({ mediaId: id, name: asset.name, expectedPath: asset.sourcePath ?? asset.name, kind: asset.kind, duration: asset.duration });
    return id;
  };

  const spine = xmlChild(seq, "spine");
  let cursor = 0;
  for (const node of spine?.children ?? []) {
    const dur = Math.max(0.1, parseRationalTime(node.attrs.duration));
    const start = node.attrs.offset !== undefined ? parseRationalTime(node.attrs.offset) : cursor;
    const srcIn = parseRationalTime(node.attrs.start);
    if (node.tag === "gap") {
      cursor = start + dur;
      continue;
    }
    if (node.tag === "title") {
      const txt = findAllXml(node, "text-style")[0]?.text || node.attrs.name || "Title";
      const clip = TL.textClip(p, { id: "fcp", label: txt.slice(0, 32), text: txt, style: {} }, rt(start), oTr.id);
      clip.duration = rt(dur);
      p.clips[clip.id] = clip;
      cursor = start + dur;
      continue;
    }
    if (node.tag === "asset-clip" || node.tag === "clip") {
      const ref = node.attrs.ref || node.attrs.name || uid("ref");
      const meta = assets.get(ref);
      const kind = meta?.kind ?? "video";
      const mediaId = ensureMedia(ref, node.attrs.name || "Clip", kind, dur);
      const clip = TL.newClip(p, {
        trackId: kind === "audio" ? aTr.id : vTr.id,
        kind: kind === "audio" ? "audio" : kind === "image" ? "image" : "video",
        mediaId,
        name: node.attrs.name || meta?.name || "Clip",
        start: rt(start),
        duration: rt(dur),
        in: rt(Math.max(0, srcIn)),
      });
      p.clips[clip.id] = clip;
    }
    cursor = start + dur;
  }

  return { project: p, source: "fcpxml", sourceLabel: "Final Cut Pro XML (.fcpxml)", warnings, offlineAssets, fontsUsed: [] };
}

/* ---------- CMX 3600 EDL (.edl) ---------- */

function parseSmpte(tc: string, fps: number): number {
  const [hh, mm, ss, ff] = tc.split(/[:;]/).map(Number);
  if (![hh, mm, ss, ff].every(Number.isFinite)) return 0;
  return hh * 3600 + mm * 60 + ss + ff / Math.max(1, fps);
}

function fmtSmpte(sec: number, fps: number): string {
  const totalFrames = Math.max(0, Math.round(sec * fps));
  const ff = totalFrames % fps;
  const totalSec = Math.floor(totalFrames / fps);
  const ss = totalSec % 60;
  const mm = Math.floor(totalSec / 60) % 60;
  const hh = Math.floor(totalSec / 3600);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(hh)}:${p(mm)}:${p(ss)}:${p(ff)}`;
}

export function importEdl(edlText: string, fileName: string, fps = 30): ImportResult {
  const lines = edlText.split(/\r?\n/);
  const titleLine = lines.find((l) => l.trim().startsWith("TITLE:"));
  const p = projectFromSpec(titleLine ? titleLine.replace(/^TITLE:\s*/i, "").trim() : fileName.replace(/\.[^.]+$/, ""), 1920, 1080, fps);
  const vTr = { id: uid("t"), kind: "video" as const, name: "Video 1", muted: false, hidden: false, locked: false };
  const aTr = { id: uid("t"), kind: "audio" as const, name: "Audio 1", muted: false, hidden: false, locked: false };
  p.tracks = [vTr, aTr];

  const offlineAssets: OfflineAssetInfo[] = [];
  const mediaByReel = new Map<string, string>();
  const editRe = /^(\d{3,4})\s+(\S+)\s+(V|A|AA|B)\s+(\S+)\s+(?:\S+\s+)?(\d{2}[:;]\d{2}[:;]\d{2}[:;]\d{2})\s+(\d{2}[:;]\d{2}[:;]\d{2}[:;]\d{2})\s+(\d{2}[:;]\d{2}[:;]\d{2}[:;]\d{2})\s+(\d{2}[:;]\d{2}[:;]\d{2}[:;]\d{2})/;

  let lastClipId: string | null = null;
  let lastMediaId: string | null = null;
  // Detect starting timeline offset (e.g. 01:00:00:00 Broadcast Hour 1 in Premiere/Resolve EDLs) and normalise to 0.
  let minRecStart = Infinity;
  const parsedEdits: { reel: string; chan: string; srcIn: number; recIn: number; recOut: number }[] = [];

  for (const line of lines) {
    const m = editRe.exec(line.trim());
    if (m) {
      const recIn = parseSmpte(m[7], fps);
      const recOut = parseSmpte(m[8], fps);
      const srcIn = parseSmpte(m[5], fps);
      minRecStart = Math.min(minRecStart, recIn);
      parsedEdits.push({ reel: m[2], chan: m[3], srcIn, recIn, recOut });
      lastClipId = null;
      lastMediaId = null;
      continue;
    }
    const nameMatch = /^\*\s*FROM CLIP NAME:\s*(.+)$/i.exec(line.trim());
    if (nameMatch && lastClipId && p.clips[lastClipId]) {
      const nm = nameMatch[1].trim();
      p.clips[lastClipId].name = nm;
      if (lastMediaId && p.media[lastMediaId]) {
        p.media[lastMediaId].name = nm;
        p.media[lastMediaId].sourcePath = nm;
        const off = offlineAssets.find((o) => o.mediaId === lastMediaId);
        if (off) {
          off.name = nm;
          off.expectedPath = nm;
        }
      }
    }
  }

  const baseOffset = minRecStart >= 3600 ? Math.floor(minRecStart / 3600) * 3600 : 0;
  for (let i = 0; i < parsedEdits.length; i++) {
    const ed = parsedEdits[i];
    const start = Math.max(0, ed.recIn - baseOffset);
    const dur = Math.max(0.1, ed.recOut - ed.recIn);
    const kind: MediaKind = ed.chan.startsWith("A") ? "audio" : "video";
    let mediaId = mediaByReel.get(ed.reel);
    if (!mediaId) {
      mediaId = uid("m");
      const asset = makeOfflineAsset(mediaId, ed.reel, ed.reel, kind, Math.max(10, ed.srcIn + dur), kind === "audio" ? 0 : 1920, kind === "audio" ? 0 : 1080, fps);
      p.media[mediaId] = asset;
      mediaByReel.set(ed.reel, mediaId);
      offlineAssets.push({ mediaId, name: ed.reel, expectedPath: ed.reel, kind, duration: asset.duration });
    }
    const clip = TL.newClip(p, {
      trackId: kind === "audio" ? aTr.id : vTr.id,
      kind,
      mediaId,
      name: ed.reel,
      start: rt(start),
      duration: rt(dur),
      in: rt(ed.srcIn),
    });
    p.clips[clip.id] = clip;
    lastClipId = clip.id;
    lastMediaId = mediaId;
  }

  // Re-run pass for "* FROM CLIP NAME:" comments mapped cleanly by index.
  let editIdx = -1;
  const clipIds = Object.keys(p.clips);
  for (const line of lines) {
    if (editRe.test(line.trim())) editIdx++;
    const nameMatch = /^\*\s*FROM CLIP NAME:\s*(.+)$/i.exec(line.trim());
    if (nameMatch && editIdx >= 0 && clipIds[editIdx]) {
      const c = p.clips[clipIds[editIdx]];
      const nm = nameMatch[1].trim();
      c.name = nm;
      if (c.mediaId && p.media[c.mediaId]) p.media[c.mediaId].name = nm;
    }
  }

  return { project: p, source: "edl", sourceLabel: "CMX 3600 EDL", warnings: [], offlineAssets, fontsUsed: [] };
}

/* ---------- Project Exporters (Premiere XML & EDL) ---------- */

const escapeXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function exportPremiereXml(p: Project): string {
  const fps = Math.max(1, Math.round(p.settings.fps));
  const durF = Math.round(TL.projectDuration(p) * fps);
  const vTracks = p.tracks.filter((t) => t.kind !== "audio").reverse();
  const aTracks = p.tracks.filter((t) => t.kind === "audio");
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<xmeml version="5">',
    "  <sequence>",
    `    <name>${escapeXml(p.name)}</name>`,
    `    <duration>${durF}</duration>`,
    `    <rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate>`,
    "    <media>",
    "      <video>",
    `        <format><samplecharacteristics><width>${p.settings.width}</width><height>${p.settings.height}</height></samplecharacteristics></format>`,
  ];
  for (const tr of vTracks) {
    lines.push("        <track>");
    for (const c of TL.clipsOnTrack(p, tr.id)) {
      if (c.kind === "text") {
        lines.push(
          "          <generatoritem>",
          `            <name>${escapeXml(c.name)}</name>`,
          `            <start>${Math.round(c.start * fps)}</start>`,
          `            <end>${Math.round((c.start + c.duration) * fps)}</end>`,
          `            <parameter><parameterid>str</parameterid><name>Text</name><value>${escapeXml(c.text?.text ?? c.name)}</value></parameter>`,
          "          </generatoritem>",
        );
      } else {
        const fname = (c.mediaId && p.media[c.mediaId]?.name) || c.name;
        lines.push(
          "          <clipitem>",
          `            <name>${escapeXml(c.name)}</name>`,
          `            <start>${Math.round(c.start * fps)}</start>`,
          `            <end>${Math.round((c.start + c.duration) * fps)}</end>`,
          `            <in>${Math.round(c.in * fps)}</in>`,
          `            <out>${Math.round((c.in + c.duration * c.speed) * fps)}</out>`,
          `            <file id="${escapeXml(c.mediaId ?? c.id)}"><name>${escapeXml(fname)}</name><pathurl>${escapeXml(fname)}</pathurl></file>`,
          "          </clipitem>",
        );
      }
    }
    lines.push("        </track>");
  }
  lines.push("      </video>", "      <audio>");
  for (const tr of aTracks) {
    lines.push("        <track>");
    for (const c of TL.clipsOnTrack(p, tr.id)) {
      const fname = (c.mediaId && p.media[c.mediaId]?.name) || c.name;
      lines.push(
        "          <clipitem>",
        `            <name>${escapeXml(c.name)}</name>`,
        `            <start>${Math.round(c.start * fps)}</start>`,
        `            <end>${Math.round((c.start + c.duration) * fps)}</end>`,
        `            <in>${Math.round(c.in * fps)}</in>`,
        `            <out>${Math.round((c.in + c.duration * c.speed) * fps)}</out>`,
        `            <file id="${escapeXml(c.mediaId ?? c.id)}"><name>${escapeXml(fname)}</name><pathurl>${escapeXml(fname)}</pathurl></file>`,
        "          </clipitem>",
      );
    }
    lines.push("        </track>");
  }
  lines.push("      </audio>", "    </media>", "  </sequence>", "</xmeml>");
  return lines.join("\n");
}

export function exportEdl(p: Project): string {
  const fps = Math.max(1, Math.round(p.settings.fps));
  const out: string[] = [`TITLE: ${p.name}`, "FCM: NON-DROP FRAME", ""];
  const clips = Object.values(p.clips)
    .filter((c) => c.kind === "video" || c.kind === "audio" || c.kind === "image")
    .sort((a, b) => a.start - b.start);
  clips.forEach((c, i) => {
    const idx = String(i + 1).padStart(3, "0");
    const reel = (c.name.replace(/[^A-Za-z0-9_]/g, "").slice(0, 8) || "AX").padEnd(8, " ");
    const ch = c.kind === "audio" ? "A    " : "V    ";
    const sIn = fmtSmpte(c.in, fps);
    const sOut = fmtSmpte(c.in + c.duration * c.speed, fps);
    const rIn = fmtSmpte(c.start, fps);
    const rOut = fmtSmpte(c.start + c.duration, fps);
    out.push(`${idx}  ${reel} ${ch} C        ${sIn} ${sOut} ${rIn} ${rOut}`);
    out.push(`* FROM CLIP NAME: ${(c.mediaId && p.media[c.mediaId]?.name) || c.name}`);
  });
  return out.join("\n") + "\n";
}
