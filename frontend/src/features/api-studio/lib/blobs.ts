import { del, get, set } from "idb-keyval";
import type { FileRef } from "../types";
import { uid } from "./util";

/** Files picked for form-data and binary bodies, kept in IndexedDB so saved requests still have them after a reload. */

const memory = new Map<string, Blob>();

export async function putFile(file: File | Blob, name?: string): Promise<FileRef> {
  const id = uid();
  memory.set(id, file);
  try {
    await set(`api-studio:blob:${id}`, file);
  } catch {
    /* private mode: the file lives for this session only */
  }
  return { id, name: name ?? (file instanceof File ? file.name : "file"), size: file.size, type: file.type || "application/octet-stream" };
}

export async function getFile(ref: FileRef | undefined): Promise<Blob | null> {
  if (!ref) return null;
  const hit = memory.get(ref.id);
  if (hit) return hit;
  try {
    const b = (await get(`api-studio:blob:${ref.id}`)) as Blob | undefined;
    if (b) memory.set(ref.id, b);
    return b ?? null;
  } catch {
    return null;
  }
}

export async function dropFile(ref: FileRef | undefined) {
  if (!ref) return;
  memory.delete(ref.id);
  try {
    await del(`api-studio:blob:${ref.id}`);
  } catch {
    /* already gone */
  }
}
