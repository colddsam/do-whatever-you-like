import { strFromU8, strToU8, Unzip, UnzipInflate, Zip, ZipDeflate, ZipPassThrough } from "fflate";
import { uid } from "../lib/time";
import { useStudio } from "../store/studio-store";
import type { Project } from "../types";
import { exportProjectFonts, importProjectFonts, type CustomFontInfo } from "./fonts";
import { exportLutData, importLutData } from "./luts";
import { mediaRuntime } from "./media";
import { listProjects, openProject, saveProject } from "./persistence";
import { putMedia } from "./storage";

/**
 * Project packages (.dwylvideo): a zip with the project, optionally every media file it uses and any
 * LUTs imported on this device, so a project moves to another browser or computer intact, or is
 * backed up. Media is stored, not recompressed. Nothing leaves the device unless you move the file.
 */

const FORMAT = "dwyl-video-project";
type Manifest = {
  format: typeof FORMAT;
  version: 1;
  exportedAt: number;
  project: Project;
  withMedia: boolean;
  luts: { id: string; name: string; size: number }[];
  fonts?: CustomFontInfo[];
};

export async function exportPackage(withMedia: boolean, onProgress?: (f: number) => void): Promise<Blob> {
  const p = useStudio.getState().project;
  const parts: Uint8Array[] = [];
  let failure: Error | null = null;
  const zip = new Zip((err, chunk) => {
    if (err) failure = err;
    else parts.push(chunk);
  });
  const addBytes = (name: string, data: Uint8Array, compress: boolean) => {
    const f = compress ? new ZipDeflate(name, { level: 6 }) : new ZipPassThrough(name);
    zip.add(f);
    f.push(data, true);
  };
  const addBlob = async (name: string, blob: Blob) => {
    const f = new ZipPassThrough(name);
    zip.add(f);
    const reader = blob.stream().getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      f.push(value);
    }
    f.push(new Uint8Array(0), true);
  };
  const lutIds = new Set<string>();
  for (const c of Object.values(p.clips)) for (const e of c.effects) if (e.type === "lut" && e.options?.lut && !e.options.lut.startsWith("builtin:")) lutIds.add(e.options.lut);
  const luts: Manifest["luts"] = [];
  for (const id of lutIds) {
    const d = await exportLutData(id);
    if (!d) continue;
    luts.push({ id, name: d.name, size: d.size });
    addBytes(`luts/${id}.bin`, new Uint8Array(d.data.buffer, d.data.byteOffset, d.data.byteLength), true);
  }
  const bundledFonts = await exportProjectFonts(p);
  const fonts: CustomFontInfo[] = [];
  for (const f of bundledFonts) {
    fonts.push(f.info);
    if (f.bytes) addBytes(`fonts/${f.info.id}.bin`, f.bytes, false);
  }
  const manifest: Manifest = { format: FORMAT, version: 1, exportedAt: Date.now(), project: p, withMedia, luts, fonts };
  addBytes("project.json", strToU8(JSON.stringify(manifest)), true);
  if (withMedia) {
    const media = Object.values(p.media);
    for (const [i, m] of media.entries()) {
      const f = mediaRuntime.file(m.id);
      if (f) await addBlob(`media/${m.id}`, f);
      onProgress?.((i + 1) / media.length);
    }
  }
  zip.end();
  if (failure) throw failure;
  return new Blob(parts as BlobPart[], { type: "application/zip" });
}

/** Opens a .dwylvideo package: media goes into this device's storage and the project opens. */
export async function importPackage(file: File, onProgress?: (f: number) => void) {
  const files = new Map<string, Uint8Array[]>();
  await new Promise<void>((resolve, reject) => {
    const uz = new Unzip((stream) => {
      const chunks: Uint8Array[] = [];
      files.set(stream.name, chunks);
      stream.ondata = (err, chunk) => {
        if (err) reject(err);
        else chunks.push(chunk);
      };
      stream.start();
    });
    uz.register(UnzipInflate);
    const reader = file.stream().getReader();
    let read = 0;
    (async () => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          uz.push(new Uint8Array(0), true);
          break;
        }
        read += value.length;
        uz.push(value);
        onProgress?.(Math.min(0.9, (read / Math.max(1, file.size)) * 0.9));
      }
    })().then(resolve, reject);
  });
  const join = (chunks: Uint8Array[]) => {
    const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
    let o = 0;
    for (const c of chunks) {
      out.set(c, o);
      o += c.length;
    }
    return out;
  };
  const raw = files.get("project.json");
  if (!raw) throw new Error("That file isn't a video project package.");
  const manifest = JSON.parse(strFromU8(join(raw))) as Manifest;
  if (manifest.format !== FORMAT || manifest.project?.version !== 1) throw new Error("That project package is from an unknown version.");
  const p = manifest.project;
  for (const m of Object.values(p.media)) {
    const chunks = files.get(`media/${m.id}`);
    if (!chunks) continue;
    const storage = await putMedia(m.id, new Blob(chunks as BlobPart[], { type: m.mime }));
    p.media[m.id] = { ...m, storage, proxy: undefined };
    files.delete(`media/${m.id}`);
  }
  for (const l of manifest.luts ?? []) {
    const chunks = files.get(`luts/${l.id}.bin`);
    if (!chunks) continue;
    const bytes = join(chunks);
    await importLutData(l.id, { name: l.name, size: l.size, data: new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4) });
  }
  if (manifest.fonts?.length) {
    const fontEntries = manifest.fonts.map((info) => {
      const chunks = files.get(`fonts/${info.id}.bin`);
      return { info, bytes: chunks ? join(chunks) : undefined };
    });
    await importProjectFonts(fontEntries);
  }
  const existing = await listProjects();
  if (existing.some((x) => x.id === p.id)) {
    p.id = uid("p");
    p.name = `${p.name} (imported)`;
  }
  p.updatedAt = Date.now();
  await saveProject(p);
  await openProject(p.id);
  onProgress?.(1);
  return { name: p.name, media: Object.keys(p.media).length, offline: Object.values(p.media).filter((m) => !mediaRuntime.has(m.id)).length };
}
