import { TRACK_COLORS } from "../constants";
import { defaultParams } from "../engine/effects";
import type { Clip, Effect, EffectType, Note, Project, Track, TrackKind } from "../types";

/** Pure helpers over the project model. Every function returns a new object; nothing mutates. */

export const uid = () => (crypto.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`).replace(/-/g, "").slice(0, 12);

export const spb = (p: Pick<Project, "bpm">) => 60 / p.bpm;
export const beatsToSec = (p: Pick<Project, "bpm">, beats: number) => beats * spb(p);
export const secToBeats = (p: Pick<Project, "bpm">, sec: number) => sec / spb(p);
export const clipEnd = (c: Clip) => c.start + c.length;

export function emptyProject(name = "Untitled song"): Project {
  const now = Date.now();
  return {
    version: 1,
    id: uid(),
    name,
    bpm: 110,
    sig: 4,
    keyRoot: 0,
    scale: "major",
    tracks: [],
    clips: {},
    assets: {},
    master: { volume: 0.9, fx: [] },
    loop: { on: false, start: 0, end: 16 },
    markers: [],
    lyrics: "",
    createdAt: now,
    updatedAt: now,
  };
}

/** Song length in beats: the end of the last clip, at least 4 bars. */
export function projectLength(p: Project) {
  let end = 0;
  for (const c of Object.values(p.clips)) end = Math.max(end, clipEnd(c));
  return Math.max(p.sig * 4, end);
}

export function makeEffect(type: EffectType, params: Record<string, number> = {}): Effect {
  return { id: uid(), type, on: true, params: { ...defaultParams(type), ...params } };
}

const KIND_NAMES: Record<TrackKind, string> = { audio: "Audio", instrument: "Instrument", drums: "Drums" };

export function makeTrack(p: Project, kind: TrackKind, opts: Partial<Track> = {}): Track {
  return {
    id: uid(),
    name: opts.name ?? `${KIND_NAMES[kind]} ${p.tracks.filter((t) => t.kind === kind).length + 1}`,
    kind,
    color: opts.color ?? TRACK_COLORS[p.tracks.length % TRACK_COLORS.length],
    volume: 0.8,
    pan: 0,
    mute: false,
    solo: false,
    armed: false,
    instrument: kind === "drums" ? "kit-808" : kind === "instrument" ? "piano" : "",
    fx: [],
    duck: null,
    automation: [],
    ...opts,
  };
}

export function addTrack(p: Project, track: Track, index = p.tracks.length): Project {
  const tracks = [...p.tracks];
  tracks.splice(index, 0, track);
  return { ...p, tracks };
}

export function updateTrack(p: Project, id: string, patch: Partial<Track> | ((t: Track) => Track)): Project {
  return { ...p, tracks: p.tracks.map((t) => (t.id === id ? (typeof patch === "function" ? patch(t) : { ...t, ...patch }) : t)) };
}

export function removeTrack(p: Project, id: string): Project {
  const clips = Object.fromEntries(Object.entries(p.clips).filter(([, c]) => c.trackId !== id));
  return {
    ...p,
    tracks: p.tracks.filter((t) => t.id !== id).map((t) => (t.duck?.source === id ? { ...t, duck: null } : t)),
    clips,
  };
}

export function makeClip(trackId: string, fields: Partial<Clip> & Pick<Clip, "start" | "length">): Clip {
  return { id: uid(), trackId, name: fields.name ?? "Clip", ...fields };
}

export function putClips(p: Project, clips: Clip[]): Project {
  const next = { ...p.clips };
  for (const c of clips) next[c.id] = c;
  return { ...p, clips: next };
}

export function updateClip(p: Project, id: string, patch: Partial<Clip> | ((c: Clip) => Clip)): Project {
  const c = p.clips[id];
  if (!c) return p;
  return { ...p, clips: { ...p.clips, [id]: typeof patch === "function" ? patch(c) : { ...c, ...patch } } };
}

export function removeClips(p: Project, ids: string[]): Project {
  const set = new Set(ids);
  return { ...p, clips: Object.fromEntries(Object.entries(p.clips).filter(([id]) => !set.has(id))) };
}

/** Splits a clip at a song position (beats). Notes crossing the cut are shortened, not lost. */
export function splitClip(p: Project, id: string, at: number): [Project, string | null] {
  const c = p.clips[id];
  if (!c || at <= c.start + 1e-6 || at >= clipEnd(c) - 1e-6) return [p, null];
  const cut = at - c.start;
  const left: Clip = { ...c, length: cut, fadeOut: 0 };
  const right: Clip = { ...c, id: uid(), start: at, length: c.length - cut, fadeIn: 0 };
  if (c.assetId) right.offset = (c.offset ?? 0) + beatsToSec(p, cut);
  if (c.notes) {
    left.notes = c.notes.filter((n) => n.start < cut).map((n) => ({ ...n, length: Math.min(n.length, cut - n.start) }));
    right.notes = c.notes.filter((n) => n.start >= cut).map((n) => ({ ...n, id: uid(), start: n.start - cut }));
  }
  return [putClips(p, [left, right]), right.id];
}

/** Moves a clip's left edge (trim), keeping its content anchored to the song. */
export function trimStart(p: Project, c: Clip, newStart: number): Clip {
  const minStart = c.assetId ? c.start - secToBeats(p, c.offset ?? 0) : -Infinity;
  const start = Math.max(0, minStart, Math.min(clipEnd(c) - 1 / 16, newStart));
  const delta = start - c.start;
  const out: Clip = { ...c, start, length: c.length - delta };
  if (c.assetId) out.offset = Math.max(0, (c.offset ?? 0) + beatsToSec(p, delta));
  if (c.notes) out.notes = c.notes.map((n) => ({ ...n, start: n.start - delta })).filter((n) => n.start + n.length > 0);
  return out;
}

/** The longest an audio clip can be from where it starts in its file. */
export function maxAudioLength(p: Project, c: Clip) {
  const meta = c.assetId ? p.assets[c.assetId] : undefined;
  if (!meta) return Infinity;
  return secToBeats(p, meta.duration - (c.offset ?? 0));
}

export const newNote = (n: Omit<Note, "id">): Note => ({ id: uid(), ...n });

export function quantize(notes: Note[], grid: number, strength = 1, lengths = false): Note[] {
  return notes.map((n) => {
    const target = Math.round(n.start / grid) * grid;
    const start = n.start + (target - n.start) * strength;
    const length = lengths ? Math.max(grid, Math.round(n.length / grid) * grid) : n.length;
    return { ...n, start: Math.max(0, start), length };
  });
}

export function snapBeat(beat: number, snap: number, sig: number) {
  const g = snap < 0 ? sig : snap;
  return g > 0 ? Math.round(beat / g) * g : beat;
}

/** Notes sorted by start, for scheduling. */
export const sortedNotes = (c: Clip) => (c.notes ?? []).slice().sort((a, b) => a.start - b.start);

export function touch(p: Project): Project {
  return { ...p, updatedAt: Date.now() };
}

export function trackClips(p: Project, trackId: string) {
  return Object.values(p.clips)
    .filter((c) => c.trackId === trackId)
    .sort((a, b) => a.start - b.start);
}

/** The free space on a track at or after `beat` long enough for `length` beats (for pasting). */
export function freeSlot(p: Project, trackId: string, beat: number, length: number) {
  let at = beat;
  for (const c of trackClips(p, trackId)) {
    if (clipEnd(c) <= at) continue;
    if (c.start >= at + length) break;
    at = clipEnd(c);
  }
  return at;
}
