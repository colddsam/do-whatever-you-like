import { strFromU8, unzipSync } from "fflate";
import * as TL from "../../lib/timeline";
import { anim } from "../../lib/keyframes";
import { rt, uid } from "../../lib/time";
import type { MediaAsset, MediaKind, Project, TextStyle } from "../../types";
import { BASE_TEXT_STYLE } from "../../constants";
import { cleanPathBasename, inferMediaKind, type ImportedAssetBlob, type ImportResult, type OfflineAssetInfo } from "./types";

/**
 * CapCut project importer:
 * Supports raw `draft_content.json` / `draft_info.json` and zipped `.capcut` / `.ccproj` / `.zip` archives
 * (extracting bundled media automatically when present). CapCut uses microseconds (1_000_000 = 1s).
 */

type CapCutTimeRange = { start?: number; duration?: number };
type CapCutSegment = {
  id?: string;
  material_id?: string;
  target_timerange?: CapCutTimeRange;
  source_timerange?: CapCutTimeRange;
  speed?: number;
  volume?: number;
  clip?: {
    alpha?: number;
    rotation?: number;
    scale?: { x?: number; y?: number };
    transform?: { x?: number; y?: number };
  };
};
type CapCutTrack = { type?: string; segments?: CapCutSegment[]; name?: string };
type CapCutDraft = {
  name?: string;
  fps?: number;
  canvas_config?: { width?: number; height?: number; ratio?: string };
  tracks?: CapCutTrack[];
  materials?: {
    videos?: { id?: string; path?: string; material_name?: string; duration?: number; width?: number; height?: number; type?: string }[];
    audios?: { id?: string; path?: string; name?: string; title?: string; duration?: number }[];
    texts?: { id?: string; content?: string; text_color?: string; font_size?: number; font_path?: string; font_name?: string; bold_width?: number; is_italic?: boolean; shadow_alpha?: number }[];
    speeds?: { id?: string; speed?: number }[];
  };
};

const us = (v?: number) => Math.max(0, (Number(v) || 0) / 1_000_000);

function parseCapCutTextContent(raw?: string): { text: string; font?: string; color?: string; size?: number } {
  if (!raw) return { text: "CapCut Title" };
  try {
    const obj = JSON.parse(raw) as { text?: string; styles?: { font?: { name?: string; path?: string }; fill?: { content?: { solid?: { color?: number[] } } }; size?: number }[] };
    const text = obj.text || raw;
    const st = obj.styles?.[0];
    const rgbArr = st?.fill?.content?.solid?.color;
    const color =
      Array.isArray(rgbArr) && rgbArr.length >= 3
        ? `#${rgbArr.slice(0, 3).map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join("")}`
        : undefined;
    return {
      text,
      font: st?.font?.name || (st?.font?.path ? cleanPathBasename(st.font.path).replace(/\.[^.]+$/, "") : undefined),
      color,
      size: st?.size ? Math.round(st.size * 5) : undefined,
    };
  } catch {
    const stripped = raw.replace(/<[^>]+>/g, "").trim();
    return { text: stripped || "CapCut Title" };
  }
}

export function importCapCutJson(jsonText: string, fileName: string, embeddedMap?: Map<string, Uint8Array>): ImportResult {
  const draft = JSON.parse(jsonText) as CapCutDraft;
  const W = Math.max(320, Number(draft.canvas_config?.width) || 1920);
  const H = Math.max(240, Number(draft.canvas_config?.height) || 1080);
  const fps = Math.max(12, Math.min(120, Math.round(Number(draft.fps) || 30)));
  const aspect = TL.nearestAspect(W, H);
  const p: Project = TL.defaultProject(aspect);
  p.name = draft.name || fileName.replace(/\.[^.]+$/, "");
  p.settings.width = W;
  p.settings.height = H;
  p.settings.fps = fps;
  p.tracks = [];
  p.clips = {};

  const offlineAssets: OfflineAssetInfo[] = [];
  const warnings: string[] = [];
  const fontsUsed = new Set<string>();
  const embeddedFiles: ImportedAssetBlob[] = [];
  const videoMat = new Map((draft.materials?.videos ?? []).map((v) => [v.id ?? "", v]));
  const audioMat = new Map((draft.materials?.audios ?? []).map((a) => [a.id ?? "", a]));
  const textMat = new Map((draft.materials?.texts ?? []).map((t) => [t.id ?? "", t]));

  const createdMedia = new Map<string, string>();
  const ensureMedia = (matId: string, name: string, path: string, kind: MediaKind, dur: number, mw: number, mh: number): string => {
    const hit = createdMedia.get(matId);
    if (hit) return hit;
    const id = uid("m");
    const cleanName = name || cleanPathBasename(path) || "CapCut Media";
    const asset: MediaAsset = {
      id,
      name: cleanName,
      kind,
      mime: kind === "audio" ? "audio/mpeg" : kind === "image" ? "image/png" : "video/mp4",
      size: 0,
      duration: Math.max(0.1, dur),
      width: mw || W,
      height: mh || H,
      fps,
      rotation: 0,
      hasVideo: kind !== "audio",
      hasAudio: kind !== "image",
      decodable: false,
      storage: "idb",
      sourcePath: path || cleanName,
      addedAt: Date.now(),
    };

    // Check if media file bytes were bundled inside the .capcut zip.
    if (embeddedMap) {
      const base = cleanPathBasename(path || cleanName).toLowerCase();
      for (const [zPath, bytes] of embeddedMap) {
        if (cleanPathBasename(zPath).toLowerCase() === base && typeof File !== "undefined") {
          const file = new File([new Uint8Array(bytes)], cleanName, { type: asset.mime });
          embeddedFiles.push({ mediaId: id, file });
          asset.size = bytes.byteLength;
          break;
        }
      }
    }

    p.media[id] = asset;
    createdMedia.set(matId, id);
    if (!embeddedFiles.some((f) => f.mediaId === id)) {
      offlineAssets.push({ mediaId: id, name: cleanName, expectedPath: path || cleanName, kind, duration: asset.duration });
    }
    return id;
  };

  const tracks = draft.tracks ?? [];
  const visualTracks = tracks.filter((t) => t.type !== "audio").reverse();
  const audioTracks = tracks.filter((t) => t.type === "audio");

  visualTracks.forEach((tr, idx) => {
    const isBase = idx === visualTracks.length - 1 && tr.type === "video";
    const track = {
      id: uid("t"),
      kind: (isBase ? "video" : "overlay") as "video" | "overlay",
      name: tr.name || (isBase ? "Main Track" : tr.type === "text" ? "Text" : `Overlay ${visualTracks.length - idx}`),
      muted: false,
      hidden: false,
      locked: false,
    };
    p.tracks.push(track);

    for (const seg of tr.segments ?? []) {
      const start = rt(us(seg.target_timerange?.start));
      const duration = rt(Math.max(0.1, us(seg.target_timerange?.duration)));
      const inT = rt(us(seg.source_timerange?.start));
      const tx = W / 2 + ((seg.clip?.transform?.x ?? 0) * W) / 2;
      const ty = H / 2 - ((seg.clip?.transform?.y ?? 0) * H) / 2;

      if (tr.type === "text" || textMat.has(seg.material_id ?? "")) {
        const tm = textMat.get(seg.material_id ?? "");
        const parsed = parseCapCutTextContent(tm?.content);
        const font = parsed.font || tm?.font_name || BASE_TEXT_STYLE.font;
        if (font) fontsUsed.add(font);
        const style: TextStyle = {
          ...BASE_TEXT_STYLE,
          font,
          size: parsed.size || tm?.font_size || BASE_TEXT_STYLE.size,
          color: parsed.color || tm?.text_color || BASE_TEXT_STYLE.color,
          italic: Boolean(tm?.is_italic),
        };
        const clip = TL.textClip(
          p,
          { id: "capcut", label: parsed.text.slice(0, 32), text: parsed.text, style },
          start,
          track.id,
        );
        clip.duration = duration;
        clip.transform.x = anim(tx);
        clip.transform.y = anim(ty);
        clip.transform.scaleX.v = seg.clip?.scale?.x ?? 1;
        clip.transform.scaleY.v = seg.clip?.scale?.y ?? 1;
        clip.transform.rotation.v = seg.clip?.rotation ?? 0;
        clip.transform.opacity.v = seg.clip?.alpha ?? 1;
        p.clips[clip.id] = clip;
        continue;
      }

      const vm = videoMat.get(seg.material_id ?? "");
      if (!vm) continue;
      const isImg = vm.type === "photo" || inferMediaKind(vm.path || vm.material_name || "", "video") === "image";
      const mediaId = ensureMedia(vm.id ?? seg.material_id ?? uid("vm"), vm.material_name || "Video", vm.path || vm.material_name || "", isImg ? "image" : "video", Math.max(duration + inT, us(vm.duration)), vm.width || W, vm.height || H);
      const clip = TL.newClip(p, {
        trackId: track.id,
        kind: isImg ? "image" : "video",
        mediaId,
        name: vm.material_name || "Clip",
        start,
        duration,
        in: inT,
        speed: seg.speed ?? 1,
      });
      clip.transform.x = anim(tx);
      clip.transform.y = anim(ty);
      clip.transform.scaleX.v = seg.clip?.scale?.x ?? 1;
      clip.transform.scaleY.v = seg.clip?.scale?.y ?? 1;
      clip.transform.rotation.v = seg.clip?.rotation ?? 0;
      clip.transform.opacity.v = seg.clip?.alpha ?? 1;
      clip.volume.v = seg.volume ?? 1;
      p.clips[clip.id] = clip;
    }
  });

  audioTracks.forEach((tr, idx) => {
    const track = { id: uid("t"), kind: "audio" as const, name: tr.name || `Audio ${idx + 1}`, muted: false, hidden: false, locked: false };
    p.tracks.push(track);
    for (const seg of tr.segments ?? []) {
      const am = audioMat.get(seg.material_id ?? "");
      if (!am) continue;
      const start = rt(us(seg.target_timerange?.start));
      const duration = rt(Math.max(0.1, us(seg.target_timerange?.duration)));
      const inT = rt(us(seg.source_timerange?.start));
      const mediaId = ensureMedia(am.id ?? seg.material_id ?? uid("am"), am.name || am.title || "Audio", am.path || am.name || "", "audio", Math.max(duration + inT, us(am.duration)), 0, 0);
      const clip = TL.newClip(p, { trackId: track.id, kind: "audio", mediaId, name: am.name || am.title || "Audio", start, duration, in: inT });
      clip.volume.v = seg.volume ?? 1;
      p.clips[clip.id] = clip;
    }
  });

  if (!p.tracks.length) p.tracks = TL.defaultProject(aspect).tracks;
  if (offlineAssets.length) warnings.push(`${offlineAssets.length} CapCut media file(s) need local relinking.`);

  return {
    project: p,
    source: "capcut",
    sourceLabel: "CapCut Project",
    warnings,
    offlineAssets,
    fontsUsed: Array.from(fontsUsed),
    embeddedFiles,
  };
}

export function importCapCutArchive(bytes: Uint8Array, fileName: string): ImportResult {
  const unzipped = unzipSync(bytes);
  const embedded = new Map<string, Uint8Array>();
  let draftJson = "";
  let draftName = "draft_content.json";
  for (const [path, data] of Object.entries(unzipped)) {
    const base = cleanPathBasename(path).toLowerCase();
    if (base === "draft_content.json" || base === "draft_info.json" || (!draftJson && base.endsWith(".json"))) {
      try {
        const text = strFromU8(data);
        const parsed = JSON.parse(text) as Record<string, unknown>;
        if (parsed && ("tracks" in parsed || "materials" in parsed)) {
          draftJson = text;
          draftName = path;
        }
      } catch {
        /* ignore non-draft json */
      }
    } else if (data.byteLength > 0) {
      embedded.set(path, data);
    }
  }
  if (!draftJson) throw new Error("Could not find draft_content.json or draft_info.json inside that CapCut archive.");
  return importCapCutJson(draftJson, draftName || fileName, embedded);
}
