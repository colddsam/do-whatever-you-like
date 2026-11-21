import { strFromU8 } from "fflate";
import { uid } from "../../lib/time";
import { useStudio } from "../../store/studio-store";
import { analyzeMedia } from "../persistence";
import { mediaRuntime, probe } from "../media";
import { importPackage } from "../package";
import { putMedia } from "../storage";
import { importAepBinary, importAepx, importLottie } from "./aftereffects";
import { importCapCutArchive, importCapCutJson } from "./capcut";
import { exportEdl, exportPremiereXml, importEdl, importFcpXml, importPrproj, importXmeml } from "./premiere";
import type { ImportResult } from "./types";

export { exportEdl, exportPremiereXml };
export type { ImportResult, OfflineAssetInfo } from "./types";

/**
 * Inspects a raw project file from Premiere Pro (.prproj, .xml), Final Cut Pro (.fcpxml), CMX (.edl),
 * CapCut (draft_content.json, .capcut, .ccproj, .zip), After Effects (.aep, .aepx, Lottie .json),
 * or a native .dwylvideo backup package and parses it locally into a studio Project.
 */
export async function parseExternalProjectBytes(bytes: Uint8Array, fileName: string): Promise<ImportResult> {
  const lower = fileName.toLowerCase();

  // Premiere .prproj (gzip or raw XML)
  if (lower.endsWith(".prproj")) return importPrproj(bytes, fileName);

  // After Effects binary (.aep RIFX/Egg!)
  if (lower.endsWith(".aep") || (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x58)) {
    return importAepBinary(bytes, fileName);
  }

  // ZIP archives (.capcut / .ccproj / .zip)
  const isZip = bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (isZip) return importCapCutArchive(bytes, fileName);

  const text = strFromU8(bytes);
  const trimmed = text.trimStart();

  // XML formats (.aepx, .fcpxml, .xml)
  if (lower.endsWith(".aepx") || trimmed.includes("<AfterEffectsProject")) return importAepx(text, fileName);
  if (lower.endsWith(".fcpxml") || trimmed.includes("<fcpxml")) return importFcpXml(text, fileName);
  if (lower.endsWith(".xml") || trimmed.includes("<xmeml") || trimmed.includes("<PremiereData")) {
    if (trimmed.includes("<PremiereData")) return importPrproj(bytes, fileName);
    return importXmeml(text, fileName);
  }

  // CMX 3600 EDL
  if (lower.endsWith(".edl") || /^TITLE:|FCM:|^\d{3,4}\s+\S+\s+[VAB]+\s+/m.test(trimmed)) return importEdl(text, fileName);

  // JSON formats (CapCut draft vs Lottie/Bodymovin)
  if (lower.endsWith(".json") || lower.endsWith(".capcut") || lower.endsWith(".ccproj") || trimmed.startsWith("{")) {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if ("tracks" in parsed || "materials" in parsed) return importCapCutJson(text, fileName);
    if ("layers" in parsed && "fr" in parsed) return importLottie(text, fileName);
  }

  throw new Error(`Unsupported project format: "${fileName}". Try .prproj, .xml, .fcpxml, .edl, .capcut, draft_content.json, .aep, .aepx, Lottie .json, or .dwylvideo.`);
}

export async function openExternalProjectFile(
  file: File,
  onProgress?: (f: number) => void,
): Promise<{ result?: ImportResult; nativeImported?: { name: string; media: number; offline: number } }> {
  if (file.name.toLowerCase().endsWith(".dwylvideo")) {
    const nativeImported = await importPackage(file, onProgress);
    return { nativeImported };
  }
  onProgress?.(0.2);
  const bytes = new Uint8Array(await file.arrayBuffer());
  onProgress?.(0.5);
  const res = await parseExternalProjectBytes(bytes, file.name);
  res.project.id = uid("p");
  res.project.updatedAt = Date.now();

  // Persist any embedded media (e.g. bundled inside CapCut zip archives) before loading into the studio.
  const embeddedSet = new Set<string>();
  if (res.embeddedFiles?.length) {
    for (const item of res.embeddedFiles) {
      const storage = await putMedia(item.mediaId, item.file);
      const m = res.project.media[item.mediaId];
      if (m) {
        try {
          const probed = await probe(item.file);
          res.project.media[item.mediaId] = { ...probed, id: item.mediaId, name: m.name, storage, sourcePath: m.sourcePath, addedAt: m.addedAt };
        } catch {
          res.project.media[item.mediaId] = { ...m, storage };
        }
        embeddedSet.add(item.mediaId);
      }
    }
  }

  const st = useStudio.getState();
  st.load(res.project);
  for (const m of Object.values(res.project.media)) {
    if (embeddedSet.has(m.id)) {
      const ok = await mediaRuntime.attach(m);
      if (ok) void analyzeMedia(m);
      else st.setMediaStatus(m.id, { state: "offline", message: "Relink local media file" });
    } else {
      st.setMediaStatus(m.id, { state: "offline", message: m.sourcePath ? `Relink: ${m.sourcePath}` : "Offline media — click Relink" });
    }
  }
  onProgress?.(1);
  return { result: res };
}

/** Matches user-picked local files against offline assets by filename or sourcePath basename. */
export async function relinkOfflineMedia(files: File[], specificMediaId?: string): Promise<{ matched: number; totalOffline: number }> {
  const st = useStudio.getState();
  const entries = Object.values(st.project.media);
  const targets = specificMediaId
    ? entries.filter((m) => m.id === specificMediaId)
    : entries.filter((m) => st.media[m.id]?.state === "offline" || !mediaRuntime.has(m.id));

  let matched = 0;
  for (const asset of targets) {
    const assetBase = asset.name.toLowerCase();
    const assetNoExt = assetBase.replace(/\.[^.]+$/, "");
    const pathBase = (asset.sourcePath?.split(/[\\/]/).pop() ?? "").toLowerCase();
    const match =
      specificMediaId && files.length === 1
        ? files[0]
        : files.find((f) => {
            const fn = f.name.toLowerCase();
            return fn === assetBase || fn === pathBase || fn.replace(/\.[^.]+$/, "") === assetNoExt;
          });
    if (!match) continue;

    matched++;
    const storage = await putMedia(asset.id, match);
    try {
      const probed = await probe(match);
      const updated = { ...probed, id: asset.id, name: asset.name || match.name, storage, sourcePath: asset.sourcePath, addedAt: asset.addedAt };
      st.commit((p) => ({ ...p, media: { ...p.media, [asset.id]: updated } }));
      await mediaRuntime.attach(updated);
      void analyzeMedia(updated);
    } catch {
      st.setMediaStatus(asset.id, { state: "offline", message: `Unsupported codec (${match.name})` });
    }
  }
  return { matched, totalOffline: targets.length };
}
