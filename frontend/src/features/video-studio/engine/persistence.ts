import { defaultProject } from "../lib/timeline";
import { useStudio } from "../store/studio-store";
import type { AspectId, MediaAsset, Project } from "../types";
import { hydrateCustomFonts } from "./fonts";
import { mediaRuntime } from "./media";
import { kv, pruneMedia } from "./storage";

/** Projects are autosaved to IndexedDB on this device; reopening the editor picks up where you left off. */

type IndexEntry = { id: string; name: string; updatedAt: number; duration?: number };

export async function listProjects(): Promise<IndexEntry[]> {
  return ((await kv.get<IndexEntry[]>("projects")) ?? []).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveProject(p: Project) {
  await kv.set(`project:${p.id}`, p);
  await kv.set("last", p.id);
  const index = (await kv.get<IndexEntry[]>("projects")) ?? [];
  const entry = { id: p.id, name: p.name, updatedAt: p.updatedAt };
  await kv.set("projects", [entry, ...index.filter((x) => x.id !== p.id)].slice(0, 30));
}

export async function loadProject(id?: string): Promise<Project | null> {
  const key = id ?? (await kv.get<string>("last"));
  if (!key) return null;
  const p = await kv.get<Project>(`project:${key}`);
  return p && p.version === 1 && p.settings && p.tracks ? p : null;
}

export async function deleteProject(id: string) {
  await kv.del(`project:${id}`);
  const index = (await kv.get<IndexEntry[]>("projects")) ?? [];
  await kv.set("projects", index.filter((x) => x.id !== id));
}

/** Frees the space of media that no saved project (including this one) still lists. */
export async function cleanUpStorage() {
  const current = useStudio.getState().project;
  await saveProject(current);
  const keep = new Set<string>();
  for (const entry of await listProjects()) {
    const p = entry.id === current.id ? current : await loadProject(entry.id);
    for (const m of Object.values(p?.media ?? {})) {
      keep.add(m.id);
      if (m.proxy) keep.add(m.proxy.id);
    }
  }
  return pruneMedia(keep);
}

/** Waveform and thumbnails for an asset, with progress shown in the media bin. */
export async function analyzeMedia(a: MediaAsset) {
  const st = useStudio.getState();
  st.setMediaStatus(a.id, { state: "analyzing", progress: 0 });
  try {
    await mediaRuntime.analyze(a, (f) => useStudio.getState().setMediaStatus(a.id, { state: "analyzing", progress: f }));
    useStudio.getState().setMediaStatus(a.id, { state: "ready" });
  } catch (e) {
    useStudio.getState().setMediaStatus(a.id, { state: "ready", message: e instanceof Error ? e.message : undefined });
  }
}

/** Reconnects a loaded project's media to the files kept on this device. */
export async function hydrateMedia(p: Project) {
  await Promise.all(
    Object.values(p.media).map(async (a) => {
      const ok = await mediaRuntime.attach(a);
      const st = useStudio.getState();
      if (!ok) st.setMediaStatus(a.id, { state: "offline", message: "This file is no longer on this device. Import it again." });
      else if (!mediaRuntime.thumbs.has(a.id) || (a.hasAudio && !mediaRuntime.peaks.has(a.id))) void analyzeMedia(a);
      else st.setMediaStatus(a.id, { state: "ready" });
    }),
  );
}

export async function openProject(id?: string) {
  await hydrateCustomFonts();
  const p = (await loadProject(id)) ?? defaultProject();
  useStudio.getState().load(p);
  await hydrateMedia(p);
}

export async function newProject(aspect: AspectId = "16:9") {
  const p = defaultProject(aspect);
  useStudio.getState().load(p);
  await saveProject(p);
}

/** Saves 0.7 s after the last edit, and immediately when the tab is hidden or closed. */
export function startAutosave() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let saved: Project | null = null;
  const flush = async () => {
    clearTimeout(timer);
    const s = useStudio.getState();
    if (!s.ready || s.project === saved) return;
    const p = s.project;
    try {
      await saveProject(p);
      saved = p;
      if (useStudio.getState().project === p) useStudio.setState({ saveState: "saved" });
    } catch (e) {
      console.warn("[studio] autosave failed", e);
      useStudio.setState({ saveState: "error" });
    }
  };
  const unsub = useStudio.subscribe((s, prev) => {
    if (!s.ready || s.project === prev.project) return;
    if (s.saveState !== "saving") useStudio.setState({ saveState: "saving" });
    clearTimeout(timer);
    timer = setTimeout(() => void flush(), 700);
  });
  const onHide = () => {
    if (document.visibilityState === "hidden") void flush();
  };
  const onPageHide = () => void flush();
  document.addEventListener("visibilitychange", onHide);
  window.addEventListener("pagehide", onPageHide);
  return () => {
    unsub();
    void flush();
    document.removeEventListener("visibilitychange", onHide);
    window.removeEventListener("pagehide", onPageHide);
  };
}
