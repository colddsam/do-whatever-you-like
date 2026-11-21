import { createStore, del, get, keys, set, type UseStore } from "idb-keyval";

/**
 * Everything the editor keeps lives on this device:
 * - media files (and their proxies, and finished exports) in the Origin Private File System,
 *   which reads back as real disk-backed Files without loading them into memory;
 * - the project, waveform peaks, thumbnails and AI masks in IndexedDB.
 *
 * Browsers that can't write to OPFS from a page (older Safari) keep media as Blobs in IndexedDB.
 * Nothing is ever uploaded.
 */

let store: UseStore | null = null;
const db = () => (store ??= createStore("dwyl-video-studio", "kv"));

export const kv = {
  get: <T>(key: string) => get<T>(key, db()),
  set: (key: string, value: unknown) => set(key, value, db()),
  del: (key: string) => del(key, db()),
  keys: () => keys<string>(db()),
};

/**
 * Deletes stored media no saved project uses any more (removed from a bin, or a deleted project's
 * files). Returns how many files went.
 */
export async function pruneMedia(keep: Set<string>) {
  let removed = 0;
  const d = await dir(MEDIA_DIR);
  if (d) {
    const names: string[] = [];
    for await (const key of (d as FileSystemDirectoryHandle & { keys(): AsyncIterable<string> }).keys()) names.push(key);
    for (const name of names) {
      if (keep.has(name)) continue;
      await d.removeEntry(name).catch(() => undefined);
      removed++;
    }
  }
  for (const key of await kv.keys()) {
    const m = /^(blob|thumbs|peaks|mask):(.+)$/.exec(String(key));
    if (m && !keep.has(m[2])) {
      await kv.del(key);
      if (m[1] === "blob") removed++;
    }
  }
  return removed;
}

const MEDIA_DIR = "studio-media";
const EXPORT_DIR = "studio-exports";

async function dir(name: string): Promise<FileSystemDirectoryHandle | null> {
  try {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle(name, { create: true });
  } catch {
    return null;
  }
}

export const opfsWritable = () => typeof FileSystemFileHandle !== "undefined" && "createWritable" in FileSystemFileHandle.prototype;

/** Copies a file into local storage, streaming it (a 4 GB video never sits in memory). */
export async function putMedia(id: string, file: Blob, onProgress?: (fraction: number) => void): Promise<"opfs" | "idb"> {
  const d = opfsWritable() ? await dir(MEDIA_DIR) : null;
  if (d) {
    try {
      const handle = await d.getFileHandle(id, { create: true });
      const w = await handle.createWritable();
      const reader = file.stream().getReader();
      let done = 0;
      for (;;) {
        const { value, done: end } = await reader.read();
        if (end) break;
        await w.write(value);
        done += value.byteLength;
        onProgress?.(file.size ? done / file.size : 1);
      }
      await w.close();
      return "opfs";
    } catch (e) {
      console.warn("[studio] OPFS write failed, using IndexedDB", e);
      await d.removeEntry(id).catch(() => undefined);
    }
  }
  await kv.set(`blob:${id}`, file);
  onProgress?.(1);
  return "idb";
}

export async function getMedia(id: string, storage: "opfs" | "idb", name: string, type: string): Promise<File | null> {
  try {
    if (storage === "opfs") {
      const d = await dir(MEDIA_DIR);
      if (!d) return null;
      const f = await (await d.getFileHandle(id)).getFile();
      // Same bytes, the original name and type (new File([blob]) doesn't copy the data).
      return new File([f], name, { type: type || f.type });
    }
    const b = await kv.get<Blob>(`blob:${id}`);
    return b ? new File([b], name, { type: type || b.type }) : null;
  } catch {
    return null;
  }
}

export async function deleteMedia(id: string, storage: "opfs" | "idb") {
  if (storage === "opfs") {
    const d = await dir(MEDIA_DIR);
    await d?.removeEntry(id).catch(() => undefined);
  } else await kv.del(`blob:${id}`);
  await Promise.all([kv.del(`thumbs:${id}`), kv.del(`peaks:${id}`), kv.del(`mask:${id}`)]);
}

/** A file to stream a long export into, so a 4K hour never has to fit in memory. */
export async function exportFile(name: string): Promise<{ handle: FileSystemFileHandle; writable: FileSystemWritableFileStream } | null> {
  if (!opfsWritable()) return null;
  const d = await dir(EXPORT_DIR);
  if (!d) return null;
  // Keep only the newest export: older ones are already downloaded or abandoned.
  for await (const key of (d as FileSystemDirectoryHandle & { keys(): AsyncIterable<string> }).keys()) await d.removeEntry(key).catch(() => undefined);
  const handle = await d.getFileHandle(name, { create: true });
  return { handle, writable: await handle.createWritable() };
}

export async function storageEstimate() {
  try {
    const e = await navigator.storage.estimate();
    return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
  } catch {
    return null;
  }
}

/** Asks the browser not to evict our files when the disk gets full (Chrome grants it to engaged sites). */
export async function persistStorage() {
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
