"use client";

import { create } from "zustand";
import * as P from "./lib/project";
import type { AssetMeta, Clip, Project, Track, TrackKind } from "./types";

export type LeftTab = "create" | "sounds" | "tools";
export type BottomTab = "editor" | "mixer" | "keys" | "lyrics";
export type Tone = "info" | "success" | "warning" | "danger";
export type Job = { label: string; progress?: number };

type State = {
  project: Project;
  past: Project[];
  future: Project[];
  ready: boolean;
  saveState: "saved" | "saving" | "error";
  selectedTrack: string | null;
  selectedClips: string[];
  /** The clip open in the bottom editor (piano roll, step sequencer or audio editor). */
  editorClip: string | null;
  leftTab: LeftTab;
  bottomTab: BottomTab;
  playing: boolean;
  recording: boolean;
  /** Beats. Updated by the transport while playing. */
  playhead: number;
  metronome: boolean;
  countIn: boolean;
  /** Grid in beats (0 = off, -1 = bar). */
  snap: number;
  /** Pixels per beat in the arrangement. */
  zoom: number;
  follow: boolean;
  toast: { id: number; text: string; tone: Tone } | null;
  jobs: Record<string, Job>;
  /** Selection in the audio editor, seconds into the clip's file. */
  waveSel: { start: number; end: number } | null;
  /** Live input level (0..1) while the mic is open. */
  inputLevel: number;
  /** Musical typing: the computer keyboard plays notes instead of shortcuts. */
  typing: boolean;
  /** Lyrics handed from the lyric sheet to the song maker. */
  draftLyrics: string | null;
};

type Actions = {
  set: (p: Partial<State> | ((s: State) => Partial<State>)) => void;
  /** Applies an undoable change to the project. */
  commit: (fn: (p: Project) => Project) => void;
  /** A change that shouldn't fill the undo history (dragging a fader: call `checkpoint` first). */
  live: (fn: (p: Project) => Project) => void;
  checkpoint: () => void;
  undo: () => void;
  redo: () => void;
  load: (p: Project) => void;
  notify: (text: string, tone?: Tone) => void;
  startJob: (id: string, label: string) => void;
  progressJob: (id: string, progress: number, label?: string) => void;
  endJob: (id: string) => void;
  addTrack: (kind: TrackKind, opts?: Partial<Track>) => string;
  updateTrack: (id: string, patch: Partial<Track> | ((t: Track) => Track)) => void;
  removeTrack: (id: string) => void;
  moveTrack: (id: string, dir: -1 | 1) => void;
  duplicateTrack: (id: string) => void;
  addClip: (c: Clip) => void;
  updateClip: (id: string, patch: Partial<Clip> | ((c: Clip) => Clip)) => void;
  deleteSelection: () => void;
  splitAtPlayhead: () => void;
  duplicateSelection: () => void;
  addAsset: (meta: AssetMeta) => void;
  selectTrack: (id: string | null) => void;
  openEditor: (clipId: string | null) => void;
};

const HISTORY = 80;

export const useStudio = create<State & Actions>()((set, get) => ({
  project: P.emptyProject(),
  past: [],
  future: [],
  ready: false,
  saveState: "saved",
  selectedTrack: null,
  selectedClips: [],
  editorClip: null,
  leftTab: "create",
  bottomTab: "editor",
  playing: false,
  recording: false,
  playhead: 0,
  metronome: false,
  countIn: true,
  snap: 0.25,
  zoom: 28,
  follow: true,
  toast: null,
  jobs: {},
  waveSel: null,
  inputLevel: 0,
  typing: false,
  draftLyrics: null,

  set: (p) => set(typeof p === "function" ? p(get()) : p),
  commit: (fn) => {
    const { project, past } = get();
    const next = P.touch(fn(project));
    if (next === project) return;
    set({ project: next, past: [...past.slice(-HISTORY + 1), project], future: [] });
  },
  live: (fn) => set({ project: P.touch(fn(get().project)) }),
  checkpoint: () => {
    const { project, past } = get();
    set({ past: [...past.slice(-HISTORY + 1), project], future: [] });
  },
  undo: () => {
    const { past, project, future } = get();
    const prev = past[past.length - 1];
    if (!prev) return;
    set({ project: prev, past: past.slice(0, -1), future: [project, ...future], ...validSel(prev, get()) });
  },
  redo: () => {
    const { past, project, future } = get();
    const next = future[0];
    if (!next) return;
    set({ project: next, past: [...past, project], future: future.slice(1), ...validSel(next, get()) });
  },
  load: (p) =>
    set({
      project: p,
      past: [],
      future: [],
      selectedTrack: p.tracks[0]?.id ?? null,
      selectedClips: [],
      editorClip: null,
      playhead: 0,
      waveSel: null,
    }),
  notify: (text, tone = "info") => set({ toast: { id: Date.now() + Math.random(), text, tone } }),
  startJob: (id, label) => set((s) => ({ jobs: { ...s.jobs, [id]: { label } } })),
  progressJob: (id, progress, label) => set((s) => ({ jobs: { ...s.jobs, [id]: { label: label ?? s.jobs[id]?.label ?? "Working", progress } } })),
  endJob: (id) =>
    set((s) => {
      const jobs = { ...s.jobs };
      delete jobs[id];
      return { jobs };
    }),

  addTrack: (kind, opts) => {
    const t = P.makeTrack(get().project, kind, opts);
    const sel = get().selectedTrack;
    const idx = sel ? get().project.tracks.findIndex((x) => x.id === sel) + 1 : get().project.tracks.length;
    get().commit((p) => P.addTrack(p, t, idx > 0 ? idx : p.tracks.length));
    set({ selectedTrack: t.id });
    return t.id;
  },
  updateTrack: (id, patch) => get().commit((p) => P.updateTrack(p, id, patch)),
  removeTrack: (id) => {
    get().commit((p) => P.removeTrack(p, id));
    const s = get();
    set(validSel(s.project, s));
  },
  moveTrack: (id, dir) =>
    get().commit((p) => {
      const i = p.tracks.findIndex((t) => t.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= p.tracks.length) return p;
      const tracks = [...p.tracks];
      [tracks[i], tracks[j]] = [tracks[j], tracks[i]];
      return { ...p, tracks };
    }),
  duplicateTrack: (id) => {
    const p = get().project;
    const src = p.tracks.find((t) => t.id === id);
    if (!src) return;
    const copy: Track = { ...structuredClone(src), id: P.uid(), name: `${src.name} copy`, solo: false, armed: false };
    copy.fx = copy.fx.map((f) => ({ ...f, id: P.uid() }));
    const clips = P.trackClips(p, id).map((c) => ({ ...structuredClone(c), id: P.uid(), trackId: copy.id }));
    get().commit((q) => P.putClips(P.addTrack(q, copy, q.tracks.findIndex((t) => t.id === id) + 1), clips));
    set({ selectedTrack: copy.id });
  },
  addClip: (c) => get().commit((p) => P.putClips(p, [c])),
  updateClip: (id, patch) => get().commit((p) => P.updateClip(p, id, patch)),
  deleteSelection: () => {
    const ids = get().selectedClips;
    if (!ids.length) return;
    get().commit((p) => P.removeClips(p, ids));
    set((s) => ({ selectedClips: [], editorClip: s.editorClip && ids.includes(s.editorClip) ? null : s.editorClip }));
  },
  splitAtPlayhead: () => {
    const { project, playhead, selectedClips, selectedTrack } = get();
    const targets = Object.values(project.clips).filter(
      (c) => c.start < playhead && P.clipEnd(c) > playhead && (selectedClips.length ? selectedClips.includes(c.id) : !selectedTrack || c.trackId === selectedTrack),
    );
    if (!targets.length) return get().notify("Put the playhead over a clip to split it.", "info");
    get().commit((p) => targets.reduce((acc, c) => P.splitClip(acc, c.id, playhead)[0], p));
  },
  duplicateSelection: () => {
    const { project, selectedClips } = get();
    const clips = selectedClips.map((id) => project.clips[id]).filter(Boolean);
    if (!clips.length) return;
    const start = Math.min(...clips.map((c) => c.start));
    const end = Math.max(...clips.map(P.clipEnd));
    const copies = clips.map((c) => ({ ...structuredClone(c), id: P.uid(), start: c.start + (end - start) }));
    get().commit((p) => P.putClips(p, copies));
    set({ selectedClips: copies.map((c) => c.id) });
  },
  addAsset: (meta) => get().commit((p) => ({ ...p, assets: { ...p.assets, [meta.id]: meta } })),
  selectTrack: (id) => set({ selectedTrack: id }),
  openEditor: (clipId) => {
    const c = clipId ? get().project.clips[clipId] : null;
    set({ editorClip: clipId, bottomTab: "editor", waveSel: null, ...(c ? { selectedTrack: c.trackId, selectedClips: [c.id] } : {}) });
  },
}));

function validSel(p: Project, s: Pick<State, "selectedClips" | "editorClip" | "selectedTrack">) {
  return {
    selectedClips: s.selectedClips.filter((id) => p.clips[id]),
    editorClip: s.editorClip && p.clips[s.editorClip] ? s.editorClip : null,
    selectedTrack: s.selectedTrack && p.tracks.some((t) => t.id === s.selectedTrack) ? s.selectedTrack : (p.tracks[0]?.id ?? null),
  };
}

export const getStudio = () => useStudio.getState();

/** Runs a long task with a progress entry and a toast on failure. */
export async function runJob<T>(id: string, label: string, fn: (progress: (f: number, label?: string) => void) => Promise<T>): Promise<T | undefined> {
  const st = getStudio();
  if (st.jobs[id]) {
    st.notify("That's already running.", "info");
    return undefined;
  }
  st.startJob(id, label);
  try {
    return await fn((f, l) => getStudio().progressJob(id, f, l));
  } catch (e) {
    console.error(`[music] ${id} failed`, e);
    getStudio().notify(e instanceof Error ? e.message : "That didn't work. Try again.", "danger");
    return undefined;
  } finally {
    getStudio().endJob(id);
  }
}
