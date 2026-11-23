"use client";

import { create } from "zustand";
import { BASE_SHAPE, BASE_TEXT_STYLE, CAPTION_STYLES, DEFAULT_TRANSITION_DURATION, EFFECTS, LOOKS, SHAPE_PRESETS, SPEED_PRESETS, STILL_DURATION, TEXT_DURATION, TEXT_PRESETS, ZOOM_MAX, ZOOM_MIN } from "../constants";
import { anim, editAnim, evalAnim, toggleAnimated, toggleKeyAt } from "../lib/keyframes";
import { getAnim, withAnim, type PropPath } from "../lib/props";
import { frameRound, rt, uid } from "../lib/time";
import * as TL from "../lib/timeline";
import type { AspectId, AudioFx, CaptionStyleId, Clip, ClipMotionPresetId, Effect, EffectType, GuideMode, LookId, Marker, Project, TextStyle, TrackKind, Transition } from "../types";

export interface AttrClipboard {
  sourceName: string;
  kind: Clip["kind"];
  transform?: Clip["transform"];
  flipH?: boolean;
  flipV?: boolean;
  fit?: Clip["fit"];
  blend?: Clip["blend"];
  effects: Effect[];
  audioFx?: Partial<AudioFx>;
  volume?: Clip["volume"];
}

const GRADE_EFFECT_TYPES = new Set<EffectType>(["colorGrade", "colorWheels", "curves", "hsl", "colorKey", "lut"]);

/** Timeline tools, as in Premiere: V select, C razor, B ripple, N roll, Y slip, U slide, R rate stretch. */
export type Tool = "select" | "blade" | "ripple" | "roll" | "slip" | "slide" | "rate";
export type LeftTab = "media" | "text" | "effects" | "transitions" | "audio" | "ai";
export type RightTab = "clip" | "animate" | "project";
export type MediaStatus = { state: "importing" | "analyzing" | "ready" | "offline" | "error"; progress?: number; message?: string };
export type Job = { label: string; progress: number; detail?: string };
export type Toast = { id: number; text: string; tone: "info" | "success" | "warning" | "danger" };

type State = {
  ready: boolean;
  project: Project;
  past: Project[];
  future: Project[];
  /** The project as it was when a gesture (a drag) began; the whole gesture becomes one undo step. */
  txBase: Project | null;
  lastMerge: { key: string; at: number } | null;

  playhead: number;
  playing: boolean;
  loop: boolean;
  selection: string[];
  tool: Tool;
  snapping: boolean;
  /** Timeline zoom, pixels per second. */
  zoom: number;
  leftTab: LeftTab;
  rightTab: RightTab;
  activeProp: PropPath | null;
  selectedKey: string | null;
  quality: "full" | "half" | "quarter";
  guides: GuideMode;
  compare: boolean;
  compareX: number;
  useProxies: boolean;
  media: Record<string, MediaStatus>;
  jobs: Record<string, Job>;
  silence: { trackIds: string[]; ranges: [number, number][]; saved: number } | null;
  toast: Toast | null;
  clipboard: Clip[] | null;
  attrClipboard: AttrClipboard | null;
  saveState: "saved" | "saving" | "error";
  /** Eyedropper is armed: next click samples a colour for an effect or the dedicated color picker. */
  picking:
    | { kind: "effect"; clipId: string; effectId: string; optionKey?: string }
    | { kind: "picker"; onPick?: (hex: string) => void }
    | null;
  /** Armed for 2D point-tracker anchor click on the preview canvas (stores target source clipId). */
  trackingPick: string | null;
  /** Show transparency checkerboard instead of solid canvas background during preview. */
  checkerboard: boolean;
  /** Floating dedicated color picker drawer visibility. */
  colorPickerOpen: boolean;
  pickedColor: string;
  recentColors: string[];
  sampleSize: 1 | 3 | 5;
  /** Show live Waveform / RGB Parade / Histogram / Vectorscope video scopes overlay. */
  scopes: boolean;
  /** Work-area In and Out points (I / O): playback loops them and export can render just them. */
  inPoint: number | null;
  outPoint: number | null;
  /** Shuttle speed for J/K/L (1 = normal play). */
  rate: number;
};

type Actions = {
  commit: (recipe: (p: Project) => Project, opts?: { merge?: string }) => void;
  begin: () => void;
  end: () => void;
  abort: () => void;
  undo: () => void;
  redo: () => void;
  load: (p: Project) => void;
  set: (partial: Partial<State>) => void;
  setPlayhead: (t: number) => void;
  setPlaying: (on: boolean) => void;
  togglePlay: () => void;
  stepFrames: (n: number) => void;
  selectClip: (id: string | null, opts?: { additive?: boolean; solo?: boolean }) => void;
  setZoom: (z: number) => void;
  setMediaStatus: (id: string, s: MediaStatus | null) => void;
  setJob: (key: string, job: Job | null) => void;
  notify: (text: string, tone?: Toast["tone"]) => void;

  // Editing commands
  splitAtPlayhead: () => void;
  splitClipAt: (id: string, t: number) => void;
  deleteSelection: (ripple: boolean) => void;
  duplicateSelection: () => void;
  copySelection: () => void;
  paste: () => void;
  nudgeSelection: (frames: number) => void;
  addMedia: (mediaId: string, at?: number, prefer?: { visual?: string; audio?: string }) => string[];
  /** Adds media at a time without overwriting anything: on a free track, or a new one (for sound effects, voice-overs, recordings). */
  placeMedia: (mediaId: string, at?: number) => string[];
  appendMedia: (mediaId: string) => void;
  addText: (presetId: string, at?: number, text?: string) => string | null;
  addSolid: (color: string, gradient?: { color: string; angle: number }) => void;
  addAdjustmentLayer: (at?: number, duration?: number) => string | null;
  addVirtualBackdrop: (clipId: string, color: string, gradient?: { color: string; angle: number }) => void;
  updateClip: (id: string, patch: Partial<Clip> | ((c: Clip) => Clip), merge?: string) => void;
  updateText: (id: string, patch: Partial<TextStyle> & { text?: string }, merge?: string) => void;
  setProp: (id: string, path: PropPath, value: number, merge?: string) => void;
  toggleAnimated: (id: string, path: PropPath) => void;
  toggleKey: (id: string, path: PropPath) => void;
  addEffect: (id: string, type: EffectType) => string | null;
  updateEffect: (id: string, effectId: string, patch: Partial<Effect>) => void;
  removeEffect: (id: string, effectId: string) => void;
  setTransition: (id: string, tr: Transition | undefined) => void;
  transitionAllCuts: (type: Transition["type"], duration?: number) => number;
  applyLook: (ids: string[], look: LookId) => void;
  setSpeed: (id: string, speed: number) => void;
  unlink: (id: string) => void;
  addTrack: (kind: TrackKind) => void;
  removeTrack: (id: string) => void;
  toggleTrack: (id: string, field: "muted" | "hidden" | "locked") => void;
  addMarker: () => void;
  setAspect: (a: AspectId) => void;
  rename: (name: string) => void;
  applyCaptionStyle: (style: CaptionStyleId) => void;

  // Pro editing
  selectAll: () => void;
  setInOut: (which: "in" | "out", t: number | null) => void;
  applySpeedRamp: (id: string, preset: string | null) => void;
  /** A hand-drawn speed curve (x 0..1 -> speed), as the curve editor drags. */
  setRampShape: (id: string, shape: [number, number][]) => void;
  flip: (ids: string[], axis: "h" | "v") => void;
  applyLayout: (ids: string[], layout: TL.Layout) => void;
  closeGaps: () => void;
  insertMedia: (mediaId: string, at?: number) => void;
  addShape: (presetId: string) => string | null;
  addSticker: (emoji: string) => string | null;
  moveTrack: (id: string, dir: -1 | 1) => void;
  setAudioFx: (id: string, patch: Partial<AudioFx> | null) => void;
  addEffectToSelection: (type: EffectType) => number;
  updateMarker: (id: string, patch: Partial<Marker>) => void;
  removeMarker: (id: string) => void;
  jumpMarker: (dir: 1 | -1) => void;
  copyAttributes: (clipId?: string) => void;
  pasteAttributes: (opts?: { effects?: boolean; transform?: boolean; audio?: boolean }) => number;
  applyGradeToAllClips: (clipId: string) => number;
  applyMotionPreset: (clipId: string, presetId: ClipMotionPresetId) => void;
  detachAudio: (clipId: string) => void;
  addRecentColor: (hex: string) => void;
  resetTransform: (clipId: string) => void;
};

export type StudioStore = State & Actions;

const HISTORY = 200;
const MERGE_MS = 900;

function initial(): State {
  return {
    ready: false,
    project: TL.defaultProject(),
    past: [],
    future: [],
    txBase: null,
    lastMerge: null,
    playhead: 0,
    playing: false,
    loop: false,
    selection: [],
    tool: "select",
    snapping: true,
    zoom: 60,
    leftTab: "media",
    rightTab: "clip",
    activeProp: null,
    selectedKey: null,
    quality: "half",
    guides: "off",
    compare: false,
    compareX: 0.5,
    useProxies: true,
    media: {},
    jobs: {},
    silence: null,
    toast: null,
    clipboard: null,
    attrClipboard: null,
    saveState: "saved",
    picking: null,
    trackingPick: null,
    checkerboard: false,
    colorPickerOpen: false,
    pickedColor: "#00b140",
    recentColors: [],
    sampleSize: 3,
    scopes: false,
    inPoint: null,
    outPoint: null,
    rate: 1,
  };
}

const live = (p: Project, ids: string[]) => ids.filter((id) => p.clips[id]);

export const useStudio = create<StudioStore>()((set, get) => {
  /** Applies a timeline edit as one undo step (or inside the current gesture). */
  const commit: Actions["commit"] = (recipe, opts) =>
    set((s) => {
      const next = recipe(s.project);
      if (next === s.project) return s;
      const project = { ...next, updatedAt: Date.now() };
      if (s.txBase) return { project, selection: live(project, s.selection) };
      const now = performance.now();
      if (opts?.merge && s.lastMerge?.key === opts.merge && now - s.lastMerge.at < MERGE_MS) {
        return { project, lastMerge: { key: opts.merge, at: now }, selection: live(project, s.selection) };
      }
      return {
        project,
        past: [...s.past.slice(-(HISTORY - 1)), s.project],
        future: [],
        lastMerge: opts?.merge ? { key: opts.merge, at: now } : null,
        selection: live(project, s.selection),
      };
    });

  const sel = () => get().selection;
  const fps = () => get().project.settings.fps;

  return {
    ...initial(),
    commit,
    begin: () => set((s) => (s.txBase ? s : { txBase: s.project })),
    end: () =>
      set((s) => {
        if (!s.txBase) return s;
        if (s.txBase === s.project) return { txBase: null };
        return { txBase: null, past: [...s.past.slice(-(HISTORY - 1)), s.txBase], future: [], lastMerge: null };
      }),
    abort: () => set((s) => (s.txBase ? { project: s.txBase, txBase: null } : s)),
    undo: () =>
      set((s) => {
        if (s.txBase || !s.past.length) return s;
        const project = s.past[s.past.length - 1];
        return { project, past: s.past.slice(0, -1), future: [s.project, ...s.future], lastMerge: null, selection: live(project, s.selection), silence: null };
      }),
    redo: () =>
      set((s) => {
        if (s.txBase || !s.future.length) return s;
        const project = s.future[0];
        return { project, future: s.future.slice(1), past: [...s.past, s.project], lastMerge: null, selection: live(project, s.selection), silence: null };
      }),
    load: (p) => set({ project: p, past: [], future: [], txBase: null, selection: [], playhead: 0, playing: false, silence: null, ready: true, inPoint: null, outPoint: null }),
    set: (partial) => set(partial),

    setPlayhead: (t) => set({ playhead: Math.max(0, t) }),
    setPlaying: (on) => set({ playing: on }),
    togglePlay: () => set((s) => ({ playing: !s.playing })),
    stepFrames: (n) =>
      set((s) => {
        const f = s.project.settings.fps;
        return { playing: false, playhead: Math.max(0, frameRound(s.playhead + n / f, f)) };
      }),
    selectClip: (id, opts) =>
      set((s) => {
        if (!id) return { selection: [], selectedKey: null };
        const c = s.project.clips[id];
        if (!c) return s;
        const group = opts?.solo ? [id] : [id, ...TL.linked(s.project, c).map((x) => x.id)];
        if (opts?.additive) {
          const has = s.selection.includes(id);
          return { selection: has ? s.selection.filter((x) => !group.includes(x)) : [...s.selection, ...group.filter((x) => !s.selection.includes(x))] };
        }
        return { selection: group, selectedKey: null };
      }),
    setZoom: (z) => set({ zoom: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)) }),
    setMediaStatus: (id, st) =>
      set((s) => {
        const media = { ...s.media };
        if (st) media[id] = st;
        else delete media[id];
        return { media };
      }),
    setJob: (key, job) =>
      set((s) => {
        const jobs = { ...s.jobs };
        if (job) jobs[key] = job;
        else delete jobs[key];
        return { jobs };
      }),
    notify: (text, tone = "info") => set({ toast: { id: Date.now() + Math.random(), text, tone } }),

    splitAtPlayhead: () => {
      const t = get().playhead;
      commit((p) => TL.splitAt(p, t, sel()));
    },
    splitClipAt: (id, t) => commit((p) => TL.splitClip(p, id, frameRound(t, fps()))[0]),
    deleteSelection: (ripple) => {
      const ids = sel();
      if (!ids.length) return;
      commit((p) => TL.deleteClips(p, ids, ripple));
      set({ selection: [] });
    },
    duplicateSelection: () => {
      const s = get();
      const clips = s.selection.map((id) => s.project.clips[id]).filter(Boolean);
      if (!clips.length) return;
      const end = Math.max(...clips.map((c) => c.start + c.duration));
      let ids: string[] = [];
      commit((p) => {
        const [next, made] = TL.duplicateClips(p, s.selection, end);
        ids = made;
        return next;
      });
      set({ selection: ids });
    },
    copySelection: () => {
      const s = get();
      const ids = TL.withLinked(s.project, s.selection);
      if (ids.length) set({ clipboard: ids.map((id) => s.project.clips[id]) });
    },
    paste: () => {
      const s = get();
      if (!s.clipboard?.length) return;
      const first = Math.min(...s.clipboard.map((c) => c.start));
      const links = new Map<string, string>();
      const copies = s.clipboard
        .filter((c) => s.project.tracks.some((t) => t.id === c.trackId))
        .map((c) => {
          let linkId: string | undefined;
          if (c.linkId) {
            if (!links.has(c.linkId)) links.set(c.linkId, uid("l"));
            linkId = links.get(c.linkId);
          }
          return { ...c, id: uid("c"), linkId, start: rt(s.playhead + c.start - first) };
        });
      commit((p) => TL.placeClips(p, copies));
      set({ selection: copies.map((c) => c.id) });
    },
    nudgeSelection: (frames) => {
      const s = get();
      const ids = TL.withLinked(s.project, s.selection);
      if (!ids.length) return;
      const dt = frames / s.project.settings.fps;
      commit((p) => TL.moveClips(p, ids.map((id) => ({ id, start: p.clips[id].start + dt, trackId: p.clips[id].trackId }))), { merge: `nudge:${ids.join()}` });
    },
    addMedia: (mediaId, at, prefer) => {
      const s = get();
      const m = s.project.media[mediaId];
      if (!m) return [];
      let made: Clip[] = [];
      commit((p) => {
        // The first video sets the project's shape (like Premiere's "new sequence from clip").
        let base = p;
        if (!Object.keys(p.clips).length && m.hasVideo && m.width && m.height) base = TL.setAspect(p, TL.nearestAspect(m.width, m.height));
        const [next, clips] = TL.clipsForMedia(base, m, frameRound(at ?? s.playhead, base.settings.fps), prefer);
        made = clips;
        return next;
      });
      set({ selection: made.map((c) => c.id) });
      return made.map((c) => c.id);
    },
    placeMedia: (mediaId, at) => {
      const s = get();
      const m = s.project.media[mediaId];
      if (!m) return [];
      const t = frameRound(at ?? s.playhead, s.project.settings.fps);
      const dur = m.kind === "image" ? STILL_DURATION : m.duration;
      let made: Clip[] = [];
      commit((p) => {
        let next = p;
        const freeOn = (kind: TrackKind) =>
          next.tracks
            .filter((tr) => tr.kind === kind && !tr.locked)
            .reverse()
            .find((tr) => !Object.values(next.clips).some((c) => c.trackId === tr.id && c.start < t + dur - 1e-3 && c.start + c.duration > t + 1e-3))?.id;
        const prefer: { visual?: string; audio?: string } = {};
        if (m.hasAudio) {
          let id = freeOn("audio");
          if (!id) [next, id] = TL.addTrack(next, "audio");
          prefer.audio = id;
        }
        if (m.kind !== "audio") {
          let id = freeOn("video");
          if (!id) [next, id] = TL.addTrack(next, "video");
          prefer.visual = id;
        }
        const [placed, clips] = TL.clipsForMedia(next, m, t, prefer);
        made = clips;
        return placed;
      });
      set({ selection: made.map((c) => c.id) });
      return made.map((c) => c.id);
    },
    appendMedia: (mediaId) => {
      const s = get();
      const m = s.project.media[mediaId];
      if (!m) return;
      const [, trackId] = TL.ensureTrack(s.project, m.kind === "audio" ? "audio" : "video");
      get().addMedia(mediaId, TL.trackEnd(s.project, trackId));
    },
    addText: (presetId, at, text) => {
      const preset = TEXT_PRESETS.find((x) => x.id === presetId) ?? TEXT_PRESETS[0];
      let id: string | null = null;
      commit((p) => {
        const start = frameRound(at ?? get().playhead, p.settings.fps);
        const [withTrack, trackId] = TL.freeTrack(p, "overlay", start, start + (preset.duration ?? TEXT_DURATION));
        const c = TL.textClip(withTrack, text ? { ...preset, text } : preset, start, trackId);
        id = c.id;
        return TL.placeClips(withTrack, [c]);
      });
      if (id) set({ selection: [id], rightTab: "clip" });
      return id;
    },
    addSolid: (color, gradient) => {
      let id: string | null = null;
      commit((p) => {
        const start = frameRound(get().playhead, p.settings.fps);
        const [withTrack, trackId] = TL.freeTrack(p, "video", start, start + STILL_DURATION);
        const c = TL.newClip(withTrack, { trackId, kind: "solid", name: gradient ? "Gradient" : "Colour", start, duration: STILL_DURATION, color, ...(gradient ? { gradient } : {}) });
        id = c.id;
        return TL.placeClips(withTrack, [c]);
      });
      if (id) set({ selection: [id] });
    },
    addAdjustmentLayer: (at, duration) => {
      let id: string | null = null;
      commit((p) => {
        const start = frameRound(at ?? get().playhead, p.settings.fps);
        const dur = duration ?? STILL_DURATION;
        const [withTrack, trackId] = TL.freeTrack(p, "overlay", start, start + dur);
        const c = TL.newClip(withTrack, { trackId, kind: "adjustment", name: "Adjustment layer", start, duration: dur });
        id = c.id;
        return TL.placeClips(withTrack, [c]);
      });
      if (id) set({ selection: [id], rightTab: "clip" });
      return id;
    },
    addVirtualBackdrop: (clipId, color, gradient) => {
      let solidId: string | null = null;
      commit((p) => {
        const c = p.clips[clipId];
        if (!c) return p;
        let next = p;
        const trackIdx = next.tracks.findIndex((t) => t.id === c.trackId);
        // Find a visual track strictly below the keyed clip (higher index in p.tracks before audio).
        let targetTrackId = next.tracks.find((t, idx) => idx > trackIdx && t.kind !== "audio" && !t.locked)?.id;
        if (!targetTrackId) {
          // Move the keyed clip to a top overlay track so the main video track below sits cleanly beneath it.
          const [withOverlay, overlayId] = TL.freeTrack(next, "overlay", c.start, c.start + c.duration);
          targetTrackId = next.tracks[trackIdx]?.id;
          next = TL.updateClip(withOverlay, clipId, { trackId: overlayId });
        }
        if (!targetTrackId) return p;
        const bg = TL.newClip(next, {
          trackId: targetTrackId,
          kind: "solid",
          name: gradient ? "Studio Backdrop" : "Solid Backdrop",
          start: c.start,
          duration: c.duration,
          color,
          ...(gradient ? { gradient } : {}),
        });
        solidId = bg.id;
        return TL.placeClips(next, [bg]);
      });
      if (solidId) get().notify("Added studio backdrop beneath keyed clip.", "success");
    },
    updateClip: (id, patch, merge) => commit((p) => TL.updateClip(p, id, patch), merge ? { merge } : undefined),
    updateText: (id, patch, merge) =>
      commit(
        (p) =>
          TL.updateClip(p, id, (c) => {
            if (!c.text) return c;
            const { text, ...style } = patch;
            return { ...c, text: { ...c.text, ...(text !== undefined ? { text, words: undefined } : {}), style: { ...c.text.style, ...style } }, ...(text !== undefined ? { name: text.split("\n")[0].slice(0, 40) || c.name } : {}) };
          }),
        merge ? { merge } : undefined,
      ),
    setProp: (id, path, value, merge) => {
      const s = get();
      commit(
        (p) =>
          TL.updateClip(p, id, (c) => {
            const a = getAnim(c, path);
            if (!a) return c;
            return withAnim(c, path, editAnim(a, rt(s.playhead - c.start), value));
          }),
        { merge: merge ?? `prop:${id}:${path}` },
      );
    },
    toggleAnimated: (id, path) => {
      const t = get().playhead;
      commit((p) =>
        TL.updateClip(p, id, (c) => {
          const a = getAnim(c, path);
          return a ? withAnim(c, path, toggleAnimated(a, rt(Math.min(c.duration, Math.max(0, t - c.start))))) : c;
        }),
      );
      set({ activeProp: path });
    },
    toggleKey: (id, path) => {
      const t = get().playhead;
      commit((p) =>
        TL.updateClip(p, id, (c) => {
          const a = getAnim(c, path);
          return a ? withAnim(c, path, toggleKeyAt(a, rt(Math.min(c.duration, Math.max(0, t - c.start))))) : c;
        }),
      );
      set({ activeProp: path });
    },
    addEffect: (id, type) => {
      const spec = EFFECTS[type];
      const effect: Effect = {
        id: uid("fx"),
        type,
        enabled: true,
        params: Object.fromEntries(spec.params.map((p) => [p.key, anim(p.def)])),
        ...(spec.options ? { options: { ...spec.options } } : {}),
      };
      const st = get();
      const c = st.project.clips[id];
      if (!c || c.kind === "audio") return null;
      commit((p) => TL.updateClip(p, id, (x) => ({ ...x, effects: [...x.effects.filter((e) => e.type !== type), effect] })));
      if (type === "chromaKey" && !st.checkerboard) {
        const myIdx = st.project.tracks.findIndex((tr) => tr.id === c.trackId);
        const underIds = new Set(st.project.tracks.slice(myIdx + 1).filter((tr) => tr.kind !== "audio" && !tr.hidden).map((tr) => tr.id));
        const hasUnder = Object.values(st.project.clips).some((x) => underIds.has(x.trackId) && x.start <= st.playhead && x.start + x.duration > st.playhead);
        if (!hasUnder) set({ checkerboard: true });
      }
      return effect.id;
    },
    addEffectToSelection: (type) => {
      const s = get();
      const ids = s.selection.filter((id) => s.project.clips[id] && s.project.clips[id].kind !== "audio");
      if (!ids.length) return 0;
      s.begin();
      let last: string | null = null;
      for (const id of ids) last = get().addEffect(id, type) ?? last;
      get().end();
      const first = EFFECTS[type].params[0];
      if (last && first) set({ activeProp: `fx:${last}:${first.key}`, rightTab: "clip" });
      return ids.length;
    },
    updateEffect: (id, effectId, patch) =>
      commit((p) => TL.updateClip(p, id, (c) => ({ ...c, effects: c.effects.map((e) => (e.id === effectId ? { ...e, ...patch } : e)) })), { merge: `fx:${effectId}` }),
    removeEffect: (id, effectId) => commit((p) => TL.updateClip(p, id, (c) => ({ ...c, effects: c.effects.filter((e) => e.id !== effectId) }))),
    setTransition: (id, tr) => commit((p) => TL.updateClip(p, id, { transitionIn: tr }), { merge: `tr:${id}` }),
    transitionAllCuts: (type, duration = DEFAULT_TRANSITION_DURATION) => {
      let n = 0;
      commit((p) => {
        let next = p;
        for (const track of p.tracks) {
          if (track.kind === "audio") continue;
          const clips = TL.clipsOnTrack(p, track.id);
          for (let i = 1; i < clips.length; i++) {
            if (Math.abs(clips[i - 1].start + clips[i - 1].duration - clips[i].start) < 1e-3) {
              next = TL.updateClip(next, clips[i].id, { transitionIn: { type, duration, direction: "left" } });
              n++;
            }
          }
        }
        return next;
      });
      return n;
    },
    applyLook: (ids, look) => {
      const recipe = LOOKS[look];
      commit((p) => {
        let next = p;
        for (const id of ids) {
          next = TL.updateClip(next, id, (c) => {
            if (c.kind === "audio" || c.kind === "text") return c;
            const rest = c.effects.filter((e) => e.type !== "colorGrade");
            if (look === "none") return { ...c, effects: rest };
            const params = Object.fromEntries(EFFECTS.colorGrade.params.map((x) => [x.key, anim(recipe.grade[x.key] ?? x.def)]));
            return { ...c, effects: [{ id: uid("fx"), type: "colorGrade", enabled: true, params }, ...rest] };
          });
        }
        return next;
      });
    },
    setSpeed: (id, speed) => commit((p) => TL.setSpeed(p, id, speed), { merge: `speed:${id}` }),
    unlink: (id) =>
      commit((p) => {
        const c = p.clips[id];
        if (!c?.linkId) return p;
        let next = p;
        for (const x of [c, ...TL.linked(p, c)]) next = TL.updateClip(next, x.id, { linkId: undefined });
        return next;
      }),
    addTrack: (kind) => commit((p) => TL.addTrack(p, kind)[0]),
    removeTrack: (id) => {
      const p = get().project;
      const t = p.tracks.find((x) => x.id === id);
      if (!t) return;
      if (p.tracks.filter((x) => (x.kind === "audio") === (t.kind === "audio")).length <= 1) {
        get().notify("Keep at least one picture track and one sound track.", "warning");
        return;
      }
      commit((q) => TL.removeTrack(q, id));
    },
    toggleTrack: (id, field) => commit((p) => TL.updateTrack(p, id, { [field]: !p.tracks.find((t) => t.id === id)?.[field] })),
    addMarker: () => {
      const t = get().playhead;
      commit((p) => ({ ...p, markers: [...p.markers.filter((m) => Math.abs(m.t - t) > 1e-3), { id: uid("mk"), t, label: `Marker ${p.markers.length + 1}` }].sort((a, b) => a.t - b.t) }));
    },
    setAspect: (a) => commit((p) => TL.setAspect(p, a)),
    rename: (name) => commit((p) => ({ ...p, name: name.slice(0, 80) || "Untitled video" }), { merge: "rename" }),
    applyCaptionStyle: (style) => {
      const st = CAPTION_STYLES[style].style;
      commit((p) => {
        let next = p;
        for (const c of Object.values(p.clips)) if (c.text?.words?.length) next = TL.updateClip(next, c.id, { text: { ...c.text, style: { ...c.text.style, ...st } } });
        return next;
      });
    },

    selectAll: () => set((s) => ({ selection: Object.keys(s.project.clips) })),
    setInOut: (which, t) =>
      set((s) => {
        if (t === null) return which === "in" ? { inPoint: null } : { outPoint: null };
        const v = frameRound(Math.max(0, t), s.project.settings.fps);
        if (which === "in") return { inPoint: v, outPoint: s.outPoint !== null && s.outPoint <= v ? null : s.outPoint };
        return { outPoint: v, inPoint: s.inPoint !== null && s.inPoint >= v ? null : s.inPoint };
      }),
    applySpeedRamp: (id, preset) => {
      const shape = preset ? SPEED_PRESETS[preset]?.points : null;
      if (preset && !shape) return;
      commit((p) => TL.applySpeedRamp(p, id, shape ?? null));
    },
    setRampShape: (id, shape) => commit((p) => TL.applySpeedRamp(p, id, shape), { merge: `ramp:${id}` }),
    flip: (ids, axis) =>
      commit((p) => {
        let next = p;
        for (const id of ids) next = TL.updateClip(next, id, (c) => (c.kind === "audio" ? c : axis === "h" ? { ...c, flipH: !c.flipH } : { ...c, flipV: !c.flipV }));
        return next;
      }),
    applyLayout: (ids, layout) => commit((p) => TL.applyLayout(p, ids, layout)),
    closeGaps: () => commit((p) => TL.closeGaps(p)),
    insertMedia: (mediaId, at) => {
      const s = get();
      const m = s.project.media[mediaId];
      if (!m) return;
      const t = frameRound(at ?? s.playhead, s.project.settings.fps);
      const dur = m.kind === "image" ? STILL_DURATION : m.duration;
      let made: Clip[] = [];
      commit((p) => {
        const [next, clips] = TL.clipsForMedia(TL.insertGap(p, t, dur), m, t);
        made = clips;
        return next;
      });
      set({ selection: made.map((c) => c.id) });
    },
    addShape: (presetId) => {
      const preset = SHAPE_PRESETS.find((x) => x.id === presetId) ?? SHAPE_PRESETS[0];
      let id: string | null = null;
      commit((p) => {
        const shape = { ...BASE_SHAPE, ...preset.shape };
        if (presetId === "progress") shape.width = p.settings.width;
        const start = frameRound(get().playhead, p.settings.fps);
        const span = presetId === "progress" ? Math.max(1, TL.projectDuration(p) - start) : STILL_DURATION;
        const [withTrack, trackId] = TL.freeTrack(p, "overlay", start, start + span);
        const c = TL.newClip(withTrack, { trackId, kind: "shape", name: preset.label, start, duration: STILL_DURATION, shape });
        if (presetId === "progress") {
          // A bar that fills left to right over the whole video.
          const total = Math.max(1, TL.projectDuration(p) - start);
          c.duration = total;
          c.transform = {
            ...c.transform,
            y: anim(p.settings.height - shape.height / 2),
            x: { v: 0, k: [{ id: uid("k"), t: 0, v: 0, ease: "linear" }, { id: uid("k"), t: total, v: p.settings.width / 2, ease: "linear" }] },
            scaleX: { v: 0, k: [{ id: uid("k"), t: 0, v: 0, ease: "linear" }, { id: uid("k"), t: total, v: 1, ease: "linear" }] },
          };
        }
        id = c.id;
        return TL.placeClips(withTrack, [c]);
      });
      if (id) set({ selection: [id], rightTab: "clip" });
      return id;
    },
    addSticker: (emoji) => {
      let id: string | null = null;
      commit((p) => {
        const start = frameRound(get().playhead, p.settings.fps);
        const [withTrack, trackId] = TL.freeTrack(p, "overlay", start, start + TEXT_DURATION);
        const c = TL.textClip(withTrack, { id: "sticker", label: "Sticker", text: emoji, style: { ...BASE_TEXT_STYLE, size: 220, shadowBlur: 0, strokeWidth: 0, animation: "pop" } }, start, trackId);
        c.name = `Sticker ${emoji}`;
        id = c.id;
        return TL.placeClips(withTrack, [c]);
      });
      if (id) set({ selection: [id], rightTab: "clip" });
      return id;
    },
    moveTrack: (id, dir) => commit((p) => TL.moveTrack(p, id, dir)),
    setAudioFx: (id, patch) =>
      commit(
        (p) =>
          TL.updateClip(p, id, (c) => {
            if (!patch) {
              const { audioFx: _drop, ...rest } = c;
              void _drop;
              return rest;
            }
            return { ...c, audioFx: { ...c.audioFx, ...patch } };
          }),
        { merge: `afx:${id}` },
      ),
    updateMarker: (id, patch) => commit((p) => ({ ...p, markers: p.markers.map((m) => (m.id === id ? { ...m, ...patch } : m)).sort((a, b) => a.t - b.t) }), { merge: `marker:${id}` }),
    removeMarker: (id) => commit((p) => ({ ...p, markers: p.markers.filter((m) => m.id !== id) })),
    jumpMarker: (dir) => {
      const s = get();
      const t = s.playhead;
      const list = s.project.markers.map((m) => m.t).sort((a, b) => a - b);
      const to = dir > 0 ? list.find((x) => x > t + 1e-3) : [...list].reverse().find((x) => x < t - 1e-3);
      if (to !== undefined) set({ playing: false, playhead: to });
    },
    copyAttributes: (clipId) => {
      const s = get();
      const targetId = clipId ?? s.selection[0];
      const c = targetId ? s.project.clips[targetId] : undefined;
      if (!c) {
        s.notify("Select a clip to copy its attributes.", "info");
        return;
      }
      const linkedAudio = c.linkId ? Object.values(s.project.clips).find((x) => x.linkId === c.linkId && x.kind === "audio" && x.id !== c.id) : undefined;
      const audioSrc = c.kind === "audio" ? c : linkedAudio;
      set({
        attrClipboard: {
          sourceName: c.name,
          kind: c.kind,
          transform: c.kind !== "audio" ? structuredClone(c.transform) : undefined,
          flipH: c.flipH,
          flipV: c.flipV,
          fit: c.fit,
          blend: c.blend,
          effects: structuredClone(c.effects),
          audioFx: audioSrc?.audioFx ? structuredClone(audioSrc.audioFx) : undefined,
          volume: audioSrc?.volume ? structuredClone(audioSrc.volume) : undefined,
        },
      });
      s.notify(`Copied attributes from “${c.name}”.`, "success");
    },
    pasteAttributes: (opts = { effects: true, transform: true, audio: true }) => {
      const s = get();
      const attr = s.attrClipboard;
      if (!attr) {
        s.notify("Copy attributes from a clip first (Ctrl+Alt+C).", "info");
        return 0;
      }
      const targets = s.selection.filter((id) => s.project.clips[id]);
      if (!targets.length) {
        s.notify("Select one or more clips to paste attributes onto.", "info");
        return 0;
      }
      const wantEffects = opts.effects !== false;
      const wantTransform = opts.transform !== false;
      const wantAudio = opts.audio !== false;
      let count = 0;
      const cloneEffects = (list: Effect[]) =>
        list.map((e) => ({
          ...structuredClone(e),
          id: uid("fx"),
        }));
      commit((p) => {
        let next = p;
        for (const id of targets) {
          const cur = next.clips[id];
          if (!cur) continue;
          if (cur.kind !== "audio") {
            next = TL.updateClip(next, id, (x) => ({
              ...x,
              ...(wantEffects ? { effects: cloneEffects(attr.effects) } : {}),
              ...(wantTransform && attr.transform
                ? { transform: structuredClone(attr.transform), flipH: attr.flipH, flipV: attr.flipV, blend: attr.blend ?? x.blend, ...(attr.fit && (x.kind === "video" || x.kind === "image") ? { fit: attr.fit } : {}) }
                : {}),
            }));
            count++;
            if (wantAudio && (attr.audioFx || attr.volume) && cur.linkId) {
              const linkedA = TL.linked(next, cur).find((l) => l.kind === "audio");
              if (linkedA) {
                next = TL.updateClip(next, linkedA.id, (a) => ({
                  ...a,
                  ...(attr.audioFx ? { audioFx: structuredClone(attr.audioFx) } : {}),
                  ...(attr.volume ? { volume: structuredClone(attr.volume) } : {}),
                }));
              }
            }
          } else if (wantAudio && (attr.audioFx || attr.volume)) {
            next = TL.updateClip(next, id, (x) => ({
              ...x,
              ...(attr.audioFx ? { audioFx: structuredClone(attr.audioFx) } : {}),
              ...(attr.volume ? { volume: structuredClone(attr.volume) } : {}),
            }));
            count++;
          }
        }
        return next;
      });
      if (count) s.notify(`Pasted attributes onto ${count} clip${count === 1 ? "" : "s"}.`, "success");
      return count;
    },
    applyGradeToAllClips: (clipId) => {
      const s = get();
      const src = s.project.clips[clipId];
      if (!src) return 0;
      const gradeFx = src.effects.filter((e) => GRADE_EFFECT_TYPES.has(e.type));
      let count = 0;
      commit((p) => {
        let next = p;
        for (const c of Object.values(p.clips)) {
          if (c.id === clipId || (c.kind !== "video" && c.kind !== "image")) continue;
          const preserved = c.effects.filter((e) => !GRADE_EFFECT_TYPES.has(e.type));
          const cloned = gradeFx.map((e) => ({ ...structuredClone(e), id: uid("fx") }));
          next = TL.updateClip(next, c.id, { effects: [...cloned, ...preserved] });
          count++;
        }
        return next;
      });
      s.notify(
        count
          ? `Synced ${gradeFx.length ? "colour grade" : "neutral grade"} to ${count} visual clip${count === 1 ? "" : "s"}.`
          : "No other video or image clips on the timeline to update.",
        count ? "success" : "info",
      );
      return count;
    },
    applyMotionPreset: (clipId, presetId) => {
      commit((p) => TL.applyClipMotion(p, clipId, presetId));
    },
    detachAudio: (clipId) => {
      const s = get();
      const c = s.project.clips[clipId];
      if (!c) return;
      if (c.linkId) {
        const linkedAudio = TL.linked(s.project, c).find((x) => x.kind === "audio");
        get().unlink(clipId);
        if (linkedAudio) set({ selection: [linkedAudio.id] });
        s.notify("Detached audio from video onto an independent track.", "success");
        return;
      }
      const m = c.mediaId ? s.project.media[c.mediaId] : undefined;
      if (c.kind !== "video" || !m?.hasAudio) {
        s.notify("This clip doesn't have an audio stream to extract.", "info");
        return;
      }
      let audioId = "";
      commit((p) => {
        const [withTrack, trackId] = TL.freeTrack(p, "audio", c.start, c.start + c.duration);
        const audioClip = TL.newClip(withTrack, {
          trackId,
          kind: "audio",
          mediaId: c.mediaId,
          name: `${c.name} (Audio)`,
          start: c.start,
          duration: c.duration,
          in: c.in,
          speed: c.speed,
          speedRamp: c.speedRamp ? structuredClone(c.speedRamp) : undefined,
          reversed: c.reversed,
        });
        audioId = audioClip.id;
        return TL.placeClips(withTrack, [audioClip]);
      });
      if (audioId) {
        set({ selection: [audioId] });
        s.notify("Extracted audio track independently.", "success");
      }
    },
    addRecentColor: (hex) => {
      const clean = hex.trim().toLowerCase();
      if (!/^#[0-9a-f]{6}$/.test(clean)) return;
      set((s) => ({
        pickedColor: clean,
        recentColors: [clean, ...s.recentColors.filter((x) => x !== clean)].slice(0, 14),
      }));
    },
    resetTransform: (clipId) =>
      commit((p) =>
        TL.updateClip(p, clipId, (x) => ({
          ...x,
          flipH: undefined,
          flipV: undefined,
          backdrop: undefined,
          transform: TL.baseTransform(p, x.text ? evalAnim(x.transform.y, 0) / p.settings.height : 0.5),
        })),
      ),
  };
});

/** The clip the inspector shows: the first selected one. */
export const usePrimaryClip = () => useStudio((s) => s.selection.map((id) => s.project.clips[id]).find(Boolean) ?? null);

/** Value of an animatable property at the playhead. */
export function valueAt(c: Clip, path: PropPath, playhead: number) {
  const a = getAnim(c, path);
  return a ? evalAnim(a, Math.min(c.duration, Math.max(0, playhead - c.start))) : 0;
}

export const getStudio = () => useStudio.getState();
