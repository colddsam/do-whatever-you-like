"use client";

import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { get, set, del } from "idb-keyval";
import { emptyProject, uid } from "../lib/project";
import { getStudio, useStudio } from "../store";
import type { Project } from "../types";
import { warmProject } from "./transport";
import { assetBlob, db, deleteAssetData, loadBuffer, putAssetBlob } from "./assets";

/**
 * Projects are saved in this browser (IndexedDB) a moment after every change, and can be moved
 * between devices as a .dwylsong package (a zip of the project and its audio).
 */

export type ProjectSummary = { id: string; name: string; updatedAt: number; bpm: number; tracks: number };

const INDEX = "projects";
const LAST = "last";

export async function listProjects(): Promise<ProjectSummary[]> {
  return ((await get(INDEX, db)) as ProjectSummary[] | undefined) ?? [];
}

export async function saveProject(p: Project) {
  await set(`project:${p.id}`, p, db);
  const list = await listProjects();
  const summary: ProjectSummary = { id: p.id, name: p.name, updatedAt: p.updatedAt, bpm: p.bpm, tracks: p.tracks.length };
  await set(INDEX, [summary, ...list.filter((x) => x.id !== p.id)].slice(0, 200), db);
  await set(LAST, p.id, db);
}

export async function loadProjectById(id: string): Promise<Project | null> {
  const p = (await get(`project:${id}`, db)) as Project | undefined;
  return p ?? null;
}

export async function deleteProject(id: string) {
  const p = await loadProjectById(id);
  await del(`project:${id}`, db);
  await set(INDEX, (await listProjects()).filter((x) => x.id !== id), db);
  // Audio used only by this project goes too.
  if (p) {
    const others = await Promise.all((await listProjects()).map((s) => loadProjectById(s.id)));
    const used = new Set(others.flatMap((o) => (o ? Object.keys(o.assets) : [])));
    for (const a of Object.keys(p.assets)) if (!used.has(a)) await deleteAssetData(a);
  }
}

/** Opens a project in the studio, loading its audio in the background. */
export async function openProject(p: Project) {
  getStudio().load(p);
  warmProject(p);
  await set(LAST, p.id, db);
  void Promise.all(Object.keys(p.assets).map((id) => loadBuffer(id)));
}

/** The last project you worked on, or null for a first visit. */
export async function lastProject(): Promise<Project | null> {
  const id = (await get(LAST, db)) as string | undefined;
  return id ? loadProjectById(id) : null;
}

let timer: ReturnType<typeof setTimeout> | null = null;
export function startAutosave() {
  let last = getStudio().project;
  const unsub = useStudio.subscribe((s) => {
    if (s.project === last) return;
    last = s.project;
    if (timer) clearTimeout(timer);
    getStudio().set({ saveState: "saving" });
    timer = setTimeout(() => {
      saveProject(getStudio().project)
        .then(() => getStudio().set({ saveState: "saved" }))
        .catch((e) => {
          console.error("[music] save failed", e);
          getStudio().set({ saveState: "error" });
        });
    }, 700);
  });
  return () => {
    unsub();
    if (timer) {
      clearTimeout(timer);
      void saveProject(getStudio().project);
    }
  };
}

/** A portable package: project.json plus every audio file it uses. */
export async function exportPackage(p: Project): Promise<Blob> {
  const files: Record<string, Uint8Array> = { "project.json": strToU8(JSON.stringify(p)) };
  for (const id of Object.keys(p.assets)) {
    const blob = await assetBlob(id);
    if (blob) files[`assets/${id}`] = new Uint8Array(await blob.arrayBuffer());
  }
  return new Blob([zipSync(files, { level: 0 }) as Uint8Array<ArrayBuffer>], { type: "application/zip" });
}

export async function importPackage(file: Blob): Promise<Project> {
  const files = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const json = files["project.json"];
  if (!json) throw new Error("That isn't a music studio project.");
  const p = JSON.parse(strFromU8(json)) as Project;
  if (p.version !== 1 || !Array.isArray(p.tracks)) throw new Error("That project was made by a newer version of the studio.");
  for (const [path, data] of Object.entries(files)) {
    if (!path.startsWith("assets/")) continue;
    await putAssetBlob(path.slice(7), new Blob([data as Uint8Array<ArrayBuffer>]));
  }
  // A new id, so importing never overwrites the original.
  const copy: Project = { ...p, id: uid(), updatedAt: Date.now() };
  await saveProject(copy);
  return copy;
}

export const blankProject = () => emptyProject();
