/**
 * Local "My files" for the office editors: every document autosaves to IndexedDB in this browser
 * (nothing is uploaded). An index lists them per app; each document's data is stored separately.
 */
import { createStore, del, get, set, type UseStore } from "idb-keyval";

export type OfficeApp = "word" | "sheet" | "slides";
export type DocMeta = { id: string; app: OfficeApp; name: string; updatedAt: number; createdAt: number; size: number };

let store: UseStore | null = null;
const db = () => (store ??= createStore("dwyl-office", "docs"));
const INDEX = "index.v1";

export const newDocId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export async function listDocs(app?: OfficeApp): Promise<DocMeta[]> {
  try {
    const all = ((await get<DocMeta[]>(INDEX, db())) ?? []).filter((d) => !app || d.app === app);
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export async function loadDoc<T>(id: string): Promise<T | null> {
  try {
    return ((await get<T>(`doc:${id}`, db())) ?? null) as T | null;
  } catch {
    return null;
  }
}

/** Saves a document and its index entry. Returns false when storage is full or blocked. */
export async function saveDoc<T>(meta: Omit<DocMeta, "updatedAt" | "size" | "createdAt"> & { createdAt?: number }, data: T): Promise<boolean> {
  try {
    const json = JSON.stringify(data);
    await set(`doc:${meta.id}`, data, db());
    const index = (await get<DocMeta[]>(INDEX, db())) ?? [];
    const prev = index.find((d) => d.id === meta.id);
    const entry: DocMeta = { ...meta, createdAt: prev?.createdAt ?? meta.createdAt ?? Date.now(), updatedAt: Date.now(), size: json.length };
    await set(INDEX, [entry, ...index.filter((d) => d.id !== meta.id)].slice(0, 500), db());
    return true;
  } catch {
    return false;
  }
}

export async function deleteDoc(id: string) {
  try {
    await del(`doc:${id}`, db());
    const index = (await get<DocMeta[]>(INDEX, db())) ?? [];
    await set(INDEX, index.filter((d) => d.id !== id), db());
  } catch {
    // ignore
  }
}

export async function renameDoc(id: string, name: string) {
  try {
    const index = (await get<DocMeta[]>(INDEX, db())) ?? [];
    await set(INDEX, index.map((d) => (d.id === id ? { ...d, name } : d)), db());
  } catch {
    // ignore
  }
}

/** Which document each app had open last, so a reload comes back to it. */
export function lastOpen(app: OfficeApp): string | null {
  try {
    return localStorage.getItem(`dwyl.office.last.${app}`);
  } catch {
    return null;
  }
}

export function rememberOpen(app: OfficeApp, id: string) {
  try {
    localStorage.setItem(`dwyl.office.last.${app}`, id);
  } catch {
    // ignore
  }
}

export function timeAgo(ts: number): string {
  const d = Date.now() - ts;
  if (d < 45_000) return "just now";
  if (d < 3_600_000) return `${Math.round(d / 60_000)} min ago`;
  if (d < 86_400_000) return `${Math.round(d / 3_600_000)} h ago`;
  return new Date(ts).toLocaleDateString();
}
