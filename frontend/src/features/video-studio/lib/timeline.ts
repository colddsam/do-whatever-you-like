import { ASPECTS, BASE_TEXT_STYLE, MIN_CLIP, STILL_DURATION, TEXT_DURATION, type TextPreset } from "../constants";
import type { AspectId, Clip, ClipKind, ClipMotionPresetId, Ease, FitMode, Keyframe, LayoutId, MediaAsset, Project, Track, TrackKind, TransformProp } from "../types";
import { TRANSFORM_PROPS } from "../types";
import { anim, scaleAnim, shiftAnim, splitAnim } from "./keyframes";
import { cropRamp, localForSrc, rampFromShape, shapeAverage, srcOffset, srcSpan } from "./speed";
import { rt, uid } from "./time";

/**
 * TimelineEngine: every timeline edit as a pure function `Project -> Project`. The store wraps these
 * in undoable commits; the AI Director, keyboard shortcuts and drag gestures all call the same code.
 *
 * Rules, as in Premiere Pro:
 * - Clips on one track never overlap. Placing a clip *overwrites* what's under it (trimming,
 *   splitting or removing those clips).
 * - Linked clips (a video and its sound) move, trim, split and delete together.
 * - Trims can't reach past the source media or into a neighbour.
 */

const EPS = 1e-4;

export const clipEnd = (c: Clip) => rt(c.start + c.duration);
export const isVisualTrack = (k: TrackKind) => k !== "audio";
export const isVisualClip = (k: ClipKind) => k !== "audio";
export const hasSound = (c: Clip) => c.kind === "audio";
export const canHold = (track: Track, kind: ClipKind) => (kind === "audio" ? track.kind === "audio" : track.kind !== "audio");

export function clipsOnTrack(p: Project, trackId: string) {
  return Object.values(p.clips)
    .filter((c) => c.trackId === trackId)
    .sort((a, b) => a.start - b.start);
}

export function projectDuration(p: Project) {
  let end = 0;
  for (const c of Object.values(p.clips)) end = Math.max(end, c.start + c.duration);
  return rt(end);
}

/** The most source a clip may show: the media's length, or unlimited for stills, text and colour. */
export function sourceLimit(p: Project, c: Clip) {
  if (c.kind !== "video" && c.kind !== "audio") return Infinity;
  const m = c.mediaId ? p.media[c.mediaId] : undefined;
  return m ? m.duration : Infinity;
}

export function linked(p: Project, c: Clip) {
  if (!c.linkId) return [];
  return Object.values(p.clips).filter((x) => x.id !== c.id && x.linkId === c.linkId);
}

/** The ids plus every clip linked to them. */
export function withLinked(p: Project, ids: Iterable<string>) {
  const out = new Set<string>();
  for (const id of ids) {
    const c = p.clips[id];
    if (!c) continue;
    out.add(id);
    for (const l of linked(p, c)) out.add(l.id);
  }
  return [...out];
}

export function clipAt(p: Project, trackId: string, t: number) {
  return Object.values(p.clips).find((c) => c.trackId === trackId && t >= c.start - EPS && t < c.start + c.duration - EPS);
}

/* ---------- Construction ---------- */

export function newTrack(kind: TrackKind, name: string): Track {
  return { id: uid("t"), kind, name, muted: false, hidden: false, locked: false };
}

export function defaultProject(aspect: AspectId = "16:9"): Project {
  const a = ASPECTS[aspect];
  const now = Date.now();
  return {
    id: uid("p"),
    name: "Untitled video",
    version: 1,
    settings: { aspect, width: a.width, height: a.height, fps: 30, background: "#000000" },
    media: {},
    tracks: [newTrack("overlay", "Text 1"), newTrack("video", "Video 1"), newTrack("audio", "Audio 1"), newTrack("audio", "Audio 2")],
    clips: {},
    markers: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function baseTransform(p: Project, y = 0.5): Record<TransformProp, ReturnType<typeof anim>> {
  return {
    x: anim(p.settings.width / 2),
    y: anim(p.settings.height * y),
    scaleX: anim(1),
    scaleY: anim(1),
    rotation: anim(0),
    opacity: anim(1),
  };
}

export function newClip(p: Project, init: Partial<Clip> & Pick<Clip, "trackId" | "kind" | "start" | "duration" | "name">): Clip {
  return {
    id: uid("c"),
    in: 0,
    speed: 1,
    transform: baseTransform(p),
    blend: "normal",
    fit: "contain",
    effects: [],
    volume: anim(1),
    fadeIn: 0,
    fadeOut: 0,
    muted: false,
    ...init,
  };
}

/* ---------- Tracks ---------- */

const KIND_NAME: Record<TrackKind, string> = { video: "Video", overlay: "Text", audio: "Audio" };

export function addTrack(p: Project, kind: TrackKind): [Project, string] {
  const n = p.tracks.filter((t) => t.kind === kind).length + 1;
  const track = newTrack(kind, `${KIND_NAME[kind]} ${n}`);
  const tracks = [...p.tracks];
  // Overlays go on top of the stack, new video tracks above the existing video, audio at the bottom.
  if (kind === "overlay") tracks.unshift(track);
  else if (kind === "video") {
    let i = tracks.findIndex((t) => t.kind === "video");
    if (i < 0) i = tracks.findIndex((t) => t.kind === "audio");
    if (i < 0) tracks.push(track);
    else tracks.splice(i, 0, track);
  } else tracks.push(track);
  return [{ ...p, tracks }, track.id];
}

export function removeTrack(p: Project, trackId: string): Project {
  const clips = Object.fromEntries(Object.entries(p.clips).filter(([, c]) => c.trackId !== trackId));
  return { ...p, tracks: p.tracks.filter((t) => t.id !== trackId), clips: unlinkOrphans(clips) };
}

export function updateTrack(p: Project, id: string, patch: Partial<Track>): Project {
  return { ...p, tracks: p.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)) };
}

/** A track of `kind` to put new things on: the preferred one if it fits, else the first of its kind, else a new one. */
export function ensureTrack(p: Project, kind: TrackKind, preferred?: string): [Project, string] {
  const pref = preferred ? p.tracks.find((t) => t.id === preferred) : undefined;
  if (pref && !pref.locked && (kind === "audio" ? pref.kind === "audio" : pref.kind !== "audio")) return [p, pref.id];
  const t = p.tracks.find((x) => x.kind === kind && !x.locked);
  if (t) return [p, t.id];
  return addTrack(p, kind);
}

/**
 * A track of `kind` with nothing between `start` and `end`, preferring the top-most one, or a new
 * track when they're all busy: how titles, stickers and generated sounds avoid overwriting clips.
 */
export function freeTrack(p: Project, kind: TrackKind, start: number, end: number): [Project, string] {
  const free = p.tracks.find(
    (t) => t.kind === kind && !t.locked && !Object.values(p.clips).some((c) => c.trackId === t.id && c.start < end - EPS && c.start + c.duration > start + EPS),
  );
  return free ? [p, free.id] : addTrack(p, kind);
}

/* ---------- Clips ---------- */

export function updateClip(p: Project, id: string, patch: Partial<Clip> | ((c: Clip) => Clip)): Project {
  const c = p.clips[id];
  if (!c) return p;
  const next = typeof patch === "function" ? patch(c) : { ...c, ...patch };
  return { ...p, clips: { ...p.clips, [id]: next } };
}

function unlinkOrphans(clips: Record<string, Clip>) {
  const count = new Map<string, number>();
  for (const c of Object.values(clips)) if (c.linkId) count.set(c.linkId, (count.get(c.linkId) ?? 0) + 1);
  let changed = false;
  const out: Record<string, Clip> = {};
  for (const [id, c] of Object.entries(clips)) {
    if (c.linkId && count.get(c.linkId) === 1) {
      const { linkId: _drop, ...rest } = c;
      void _drop;
      out[id] = rest;
      changed = true;
    } else out[id] = c;
  }
  return changed ? out : clips;
}

/**
 * Overwrite: makes [s, e) on a track empty by trimming, splitting or removing the clips there
 * (except `keep`). Linked partners are not touched, as in Premiere's overwrite edit.
 */
export function clearRange(p: Project, trackId: string, s: number, e: number, keep: Set<string> = new Set()): Project {
  let clips = { ...p.clips };
  for (const c of Object.values(p.clips)) {
    if (c.trackId !== trackId || keep.has(c.id)) continue;
    const cs = c.start;
    const ce = c.start + c.duration;
    if (ce <= s + EPS || cs >= e - EPS) continue;
    if (cs >= s - EPS && ce <= e + EPS) {
      delete clips[c.id];
    } else if (cs < s && ce > e) {
      const [l, r] = splitPieces(c, s - cs);
      const [, rr] = splitPieces(r, e - s);
      clips[l.id] = { ...l, linkId: undefined };
      clips[rr.id] = { ...rr, linkId: undefined };
    } else if (cs < s) {
      clips[c.id] = { ...splitPieces(c, s - cs)[0], linkId: undefined };
    } else {
      const [, r] = splitPieces(c, e - cs);
      clips[c.id] = { ...r, id: c.id, linkId: undefined };
    }
  }
  clips = unlinkOrphans(clips);
  return { ...p, clips };
}

/** Puts clips on the timeline, overwriting whatever is under them. */
export function placeClips(p: Project, list: Clip[]): Project {
  let next = p;
  const keep = new Set(list.map((c) => c.id));
  for (const c of list) next = clearRange(next, c.trackId, c.start, c.start + c.duration, keep);
  const clips = { ...next.clips };
  for (const c of list) clips[c.id] = c;
  return { ...next, clips };
}

/** The end of the last clip on a track: where "add to timeline" appends. */
export function trackEnd(p: Project, trackId: string) {
  let end = 0;
  for (const c of Object.values(p.clips)) if (c.trackId === trackId) end = Math.max(end, c.start + c.duration);
  return rt(end);
}

/** Video + linked sound, or a single clip, for a media file dropped at `start`. */
export function clipsForMedia(p: Project, m: MediaAsset, start: number, prefer?: { visual?: string; audio?: string }): [Project, Clip[]] {
  let next = p;
  const out: Clip[] = [];
  const linkId = m.hasVideo && m.hasAudio && m.kind === "video" ? uid("l") : undefined;
  if (m.kind === "video" || m.kind === "image") {
    let trackId: string;
    [next, trackId] = ensureTrack(next, "video", prefer?.visual);
    const duration = m.kind === "image" ? STILL_DURATION : m.duration;
    out.push(newClip(next, { trackId, kind: m.kind, mediaId: m.id, name: m.name, start, duration: rt(duration), linkId, fit: "contain" }));
  }
  if (m.hasAudio && (m.kind === "video" || m.kind === "audio")) {
    let trackId: string;
    [next, trackId] = ensureTrack(next, "audio", prefer?.audio);
    out.push(newClip(next, { trackId, kind: "audio", mediaId: m.id, name: m.name, start, duration: rt(m.duration), linkId }));
  }
  return [placeClips(next, out), out];
}

export function textClip(p: Project, preset: TextPreset, start: number, trackId: string): Clip {
  return newClip(p, {
    trackId,
    kind: "text",
    name: preset.label,
    start,
    duration: preset.duration ?? TEXT_DURATION,
    transform: baseTransform(p, preset.y ?? 0.5),
    text: { text: preset.text, style: { ...BASE_TEXT_STYLE, ...preset.style } },
  });
}

/* ---------- Split ---------- */

/** One clip cut at local time `at` into two pieces (the right piece gets a new id; links untouched). */
function splitPieces(c: Clip, at: number): [Clip, Clip] {
  const local = rt(at);
  const transformL = {} as Clip["transform"];
  const transformR = {} as Clip["transform"];
  for (const k of TRANSFORM_PROPS) [transformL[k], transformR[k]] = splitAnim(c.transform[k], local);
  const [volL, volR] = splitAnim(c.volume, local);
  const fxL = c.effects.map((e) => ({ ...e, params: { ...e.params } }));
  const fxR = c.effects.map((e) => ({ ...e, id: uid("fx"), params: { ...e.params } }));
  c.effects.forEach((e, i) => {
    for (const [key, a] of Object.entries(e.params)) [fxL[i].params[key], fxR[i].params[key]] = splitAnim(a, local);
  });
  let textL = c.text;
  let textR = c.text;
  if (c.text?.words?.length) {
    const wl = c.text.words.filter((w) => w.start < local - EPS);
    const wr = c.text.words.filter((w) => w.end > local + EPS && w.start >= local - EPS).map((w) => ({ ...w, start: rt(Math.max(0, w.start - local)), end: rt(w.end - local) }));
    textL = { ...c.text, words: wl, text: wl.map((w) => w.text).join(" ") || c.text.text };
    textR = { ...c.text, words: wr, text: wr.map((w) => w.text).join(" ") || c.text.text };
  }
  const left: Clip = withRamp({ ...c, duration: local, transform: transformL, volume: volL, effects: fxL, text: textL, fadeOut: 0 }, c.speedRamp && cropRamp(c.speedRamp, 0, local));
  const right: Clip = withRamp(
    {
      ...c,
      id: uid("c"),
      start: rt(c.start + local),
      duration: rt(c.duration - local),
      in: rt(c.in + srcOffset(c, local)),
      transform: transformR,
      volume: volR,
      effects: fxR,
      text: textR,
      fadeIn: 0,
      transitionIn: undefined,
    },
    c.speedRamp && cropRamp(c.speedRamp, local, c.duration),
  );
  return [left, right];
}

/** Sets a clip's speed curve (or clears it) and keeps `speed` as the curve's average. */
export function withRamp(c: Clip, ramp: Clip["speedRamp"] | undefined): Clip {
  if (!ramp || ramp.length < 2) {
    if (!c.speedRamp) return c;
    const { speedRamp: _drop, ...rest } = c;
    void _drop;
    return rest;
  }
  const dur = Math.max(1e-6, ramp[ramp.length - 1].t);
  const avg = srcOffset({ speed: 1, speedRamp: ramp }, dur) / dur;
  return { ...c, speedRamp: ramp, speed: Math.round(avg * 1000) / 1000 };
}

/** Splits a clip and everything linked to it at timeline time `t`. Returns the new right-hand piece of `id`. */
export function splitClip(p: Project, id: string, t: number): [Project, string | null] {
  const c = p.clips[id];
  if (!c || t <= c.start + MIN_CLIP || t >= c.start + c.duration - MIN_CLIP) return [p, null];
  const group = [c, ...linked(p, c)].filter((x) => t > x.start + MIN_CLIP && t < x.start + x.duration - MIN_CLIP);
  const newLink = group.length > 1 ? uid("l") : undefined;
  const clips = { ...p.clips };
  let rightOfId: string | null = null;
  for (const x of group) {
    const [l, r] = splitPieces(x, t - x.start);
    clips[l.id] = l;
    clips[r.id] = { ...r, linkId: newLink };
    if (x.id === id) rightOfId = r.id;
  }
  return [{ ...p, clips: unlinkOrphans(clips) }, rightOfId];
}

/** Splits every clip in `ids` (or, when empty, every clip under `t` on an unlocked track). */
export function splitAt(p: Project, t: number, ids?: string[]): Project {
  const locked = new Set(p.tracks.filter((x) => x.locked).map((x) => x.id));
  const targets = (ids?.length ? ids.map((id) => p.clips[id]).filter(Boolean) : Object.values(p.clips)).filter(
    (c) => !locked.has(c.trackId) && t > c.start + MIN_CLIP && t < c.start + c.duration - MIN_CLIP,
  );
  let next = p;
  const done = new Set<string>();
  for (const c of targets) {
    if (done.has(c.id)) continue;
    for (const l of linked(next, next.clips[c.id] ?? c)) done.add(l.id);
    done.add(c.id);
    [next] = splitClip(next, c.id, t);
  }
  return next;
}

/* ---------- Delete & ripple ---------- */

function mergeRanges(ranges: [number, number][]) {
  const s = ranges.filter(([a, b]) => b - a > EPS).sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const r of s) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1] + EPS) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

function shiftAfter(clips: Record<string, Clip>, trackIds: Set<string>, ranges: [number, number][]) {
  if (!ranges.length) return clips;
  const out = { ...clips };
  for (const c of Object.values(clips)) {
    if (!trackIds.has(c.trackId)) continue;
    let shift = 0;
    for (const [a, b] of ranges) if (b <= c.start + EPS) shift += b - a;
    if (shift > 0) out[c.id] = { ...c, start: rt(Math.max(0, c.start - shift)) };
  }
  return out;
}

/** Deletes clips (and their linked partners). `ripple` closes the gaps they leave, per track. */
export function deleteClips(p: Project, ids: string[], ripple: boolean): Project {
  const all = withLinked(p, ids);
  if (!all.length) return p;
  let clips = { ...p.clips };
  const byTrack = new Map<string, [number, number][]>();
  for (const id of all) {
    const c = clips[id];
    if (!c) continue;
    delete clips[id];
    if (!byTrack.has(c.trackId)) byTrack.set(c.trackId, []);
    byTrack.get(c.trackId)!.push([c.start, c.start + c.duration]);
  }
  if (ripple) {
    // Tracks never overlap, so each deleted range is now empty: close it on its own track only.
    for (const [trackId, ranges] of byTrack) clips = shiftAfter(clips, new Set([trackId]), mergeRanges(ranges));
  }
  return { ...p, clips: unlinkOrphans(clips) };
}

/**
 * Cuts time ranges out of some tracks and closes the gaps: what the silence cutter does. Clips that
 * cross a boundary are split (linked groups together), the pieces inside a range are removed and
 * everything after moves left.
 */
export function rippleDeleteRanges(p: Project, trackIds: string[], ranges: [number, number][]): Project {
  const merged = mergeRanges(ranges);
  if (!merged.length) return p;
  const tracks = new Set(trackIds);
  let next = p;
  for (const [a, b] of merged) {
    for (const t of [a, b]) {
      for (const c of Object.values(next.clips)) {
        if (!tracks.has(c.trackId)) continue;
        if (t > c.start + MIN_CLIP && t < c.start + c.duration - MIN_CLIP) [next] = splitClip(next, c.id, t);
      }
    }
  }
  const clips = { ...next.clips };
  for (const c of Object.values(next.clips)) {
    if (!tracks.has(c.trackId)) continue;
    const mid = c.start + c.duration / 2;
    if (merged.some(([a, b]) => mid > a && mid < b)) delete clips[c.id];
  }
  return { ...next, clips: unlinkOrphans(shiftAfter(clips, tracks, merged)) };
}

/* ---------- Move & trim ---------- */

export type Move = { id: string; start: number; trackId: string };

/** Moves clips to new places (overwriting what's there). Linked partners must be listed too. */
export function moveClips(p: Project, moves: Move[]): Project {
  const moving = new Set(moves.map((m) => m.id));
  const base: Record<string, Clip> = {};
  for (const [id, c] of Object.entries(p.clips)) if (!moving.has(id)) base[id] = c;
  const placed = moves.filter((m) => p.clips[m.id]).map((m) => ({ ...p.clips[m.id], start: rt(Math.max(0, m.start)), trackId: m.trackId }));
  return placeClips({ ...p, clips: base }, placed);
}

export type TrimEdge = "start" | "end";

/** How far an edge may go: [min, max] for the new time of that edge, honouring neighbours and source media. */
export function trimBounds(p: Project, c: Clip, edge: TrimEdge, ignore: Set<string> = new Set()): [number, number] {
  const others = Object.values(p.clips).filter((x) => x.trackId === c.trackId && x.id !== c.id && !ignore.has(x.id));
  const limit = sourceLimit(p, c);
  if (edge === "start") {
    const prevEnd = others.filter((x) => x.start + x.duration <= c.start + EPS).reduce((m, x) => Math.max(m, x.start + x.duration), 0);
    return [Math.max(prevEnd, earliestStart(c), 0), c.start + c.duration - MIN_CLIP];
  }
  const nextStart = others.filter((x) => x.start >= c.start + c.duration - EPS).reduce((m, x) => Math.min(m, x.start), Infinity);
  const bySource = Number.isFinite(limit) ? c.start + localForSrc(c, limit - c.in) : Infinity;
  return [c.start + MIN_CLIP, Math.min(nextStart, bySource)];
}

/** The earliest a media clip's start can be pulled back to before it runs out of source. */
function earliestStart(c: Clip) {
  if (c.kind !== "video" && c.kind !== "audio") return -Infinity;
  const v0 = c.speedRamp?.length ? c.speedRamp[0].v : c.speed;
  return c.start - c.in / v0;
}

/** Trims one edge of a clip (and the same edge of its linked partners) to time `t`, clamped. */
export function trimClip(p: Project, id: string, edge: TrimEdge, t: number): Project {
  const c = p.clips[id];
  if (!c) return p;
  const group = [c, ...linked(p, c)];
  const ids = new Set(group.map((x) => x.id));
  // The delta every clip in the group can take.
  const cur = edge === "start" ? c.start : c.start + c.duration;
  let lo = -Infinity;
  let hi = Infinity;
  for (const x of group) {
    const [mn, mx] = trimBounds(p, x, edge, ids);
    const xe = edge === "start" ? x.start : x.start + x.duration;
    lo = Math.max(lo, mn - xe);
    hi = Math.min(hi, mx - xe);
  }
  const delta = Math.min(hi, Math.max(lo, t - cur));
  if (Math.abs(delta) < 1e-7) return p;
  const clips = { ...p.clips };
  for (const x of group) clips[x.id] = trimmed(x, edge, delta);
  return { ...p, clips };
}

/** One clip with an edge moved by `delta` seconds (no checks): keyframes, words and speed curves follow. */
export function trimmed(x: Clip, edge: TrimEdge, delta: number): Clip {
  const r = x.speedRamp;
  if (edge === "start") {
    const transform = {} as Clip["transform"];
    for (const k of TRANSFORM_PROPS) transform[k] = shiftAnim(x.transform[k], -delta);
    let ramp = r;
    if (r) ramp = delta >= 0 ? cropRamp(r, delta, x.duration) : [{ t: 0, v: r[0].v }, ...r.map((pt) => ({ t: rt(pt.t - delta), v: pt.v }))];
    return withRamp(
      {
        ...x,
        start: rt(x.start + delta),
        duration: rt(x.duration - delta),
        in: rt(Math.max(0, x.in + srcOffset(x, delta))),
        transform,
        volume: shiftAnim(x.volume, -delta),
        effects: x.effects.map((e) => ({ ...e, params: Object.fromEntries(Object.entries(e.params).map(([k, a]) => [k, shiftAnim(a, -delta)])) })),
        text: x.text?.words ? { ...x.text, words: x.text.words.map((w) => ({ ...w, start: rt(w.start - delta), end: rt(w.end - delta) })) } : x.text,
      },
      ramp,
    );
  }
  const dur = rt(x.duration + delta);
  let ramp = r;
  if (r) ramp = delta <= 0 ? cropRamp(r, 0, dur) : [...r, { t: dur, v: r[r.length - 1].v }];
  return withRamp({ ...x, duration: dur }, ramp);
}

/**
 * Changes speed keeping the clip's start; its length follows (a 10 s clip at 2× lasts 5 s). Slowing
 * down never runs over the next clip: the clip stops where that one starts, as in Premiere.
 */
export function setSpeed(p: Project, id: string, speed: number): Project {
  const c = p.clips[id];
  if (!c) return p;
  const s = Math.min(16, Math.max(0.1, speed));
  const group = [c, ...linked(p, c)];
  const ids = new Set(group.map((x) => x.id));
  let room = Infinity;
  for (const x of group) room = Math.min(room, trimBounds(p, x, "end", ids)[1] - x.start);
  let next = p;
  for (const x of group) {
    const srcLen = srcSpan(x);
    const limit = sourceLimit(p, x);
    const want = Math.min(srcLen, Number.isFinite(limit) ? limit - x.in : srcLen) / s;
    const newDur = rt(Math.max(MIN_CLIP, Math.min(want, room)));
    next = updateClip(next, x.id, (c) => ({ ...withRamp(rescaled(c, newDur / c.duration), undefined), speed: s, duration: newDur }));
  }
  return next;
}

/** Clip-local animation (keyframes, caption words) stretched by `factor` when a clip's length changes with its speed. */
export function rescaled(c: Clip, factor: number): Clip {
  if (Math.abs(factor - 1) < 1e-9) return c;
  const transform = {} as Clip["transform"];
  for (const k of TRANSFORM_PROPS) transform[k] = scaleAnim(c.transform[k], factor);
  return {
    ...c,
    transform,
    volume: scaleAnim(c.volume, factor),
    effects: c.effects.map((e) => ({ ...e, params: Object.fromEntries(Object.entries(e.params).map(([k, a]) => [k, scaleAnim(a, factor)])) })),
    text: c.text?.words ? { ...c.text, words: c.text.words.map((w) => ({ ...w, start: rt(w.start * factor), end: rt(w.end * factor) })) } : c.text,
  };
}

/**
 * Applies a speed curve shape (x 0..1 -> speed) to a clip and its linked partners, or removes the
 * curve (`null`, back to 1x). The clip keeps showing the same stretch of source, so its length
 * changes; it never runs over the next clip (if it would, it ends where that one starts).
 */
export function applySpeedRamp(p: Project, id: string, shape: [number, number][] | null): Project {
  const c = p.clips[id];
  if (!c) return p;
  if (!shape) return setSpeed(p, id, 1);
  const group = [c, ...linked(p, c)];
  const ids = new Set(group.map((x) => x.id));
  let room = Infinity;
  for (const x of group) room = Math.min(room, trimBounds(p, x, "end", ids)[1] - x.start);
  const avg = Math.max(0.1, shapeAverage(shape));
  let next = p;
  for (const x of group) {
    const span = srcSpan(x);
    const newDur = rt(Math.max(MIN_CLIP * 4, Math.min(span / avg, room)));
    next = updateClip(next, x.id, (cl) => ({ ...withRamp(rescaled(cl, newDur / cl.duration), rampFromShape(shape, newDur)), duration: newDur }));
  }
  return next;
}

/** Copies of clips placed at `at` (keeping their relative times and links). */
export function duplicateClips(p: Project, ids: string[], at: number): [Project, string[]] {
  const all = withLinked(p, ids).map((id) => p.clips[id]).filter(Boolean);
  if (!all.length) return [p, []];
  const first = Math.min(...all.map((c) => c.start));
  const links = new Map<string, string>();
  const copies = all.map((c) => {
    let linkId: string | undefined;
    if (c.linkId) {
      if (!links.has(c.linkId)) links.set(c.linkId, uid("l"));
      linkId = links.get(c.linkId);
    }
    return { ...c, id: uid("c"), start: rt(at + (c.start - first)), linkId, effects: c.effects.map((e) => ({ ...e, id: uid("fx") })) };
  });
  return [placeClips(p, copies), copies.map((c) => c.id)];
}

/* ---------- Snapping & navigation ---------- */

export function snapPoints(p: Project, exclude: Set<string>, playhead: number) {
  const pts = [0, playhead, ...p.markers.map((m) => m.t)];
  for (const c of Object.values(p.clips)) {
    if (exclude.has(c.id)) continue;
    pts.push(c.start, c.start + c.duration);
  }
  return pts;
}

/** The nearest snap point to any of `edges` within `threshold` seconds: the offset to apply, and where. */
export function snapOffset(edges: number[], points: number[], threshold: number): { delta: number; at: number } | null {
  let best: { delta: number; at: number } | null = null;
  for (const e of edges) {
    for (const pt of points) {
      const d = pt - e;
      if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.delta))) best = { delta: d, at: pt };
    }
  }
  return best;
}

/** The next (dir 1) or previous (dir -1) cut, for Up/Down arrow navigation. */
export function nextEdit(p: Project, t: number, dir: 1 | -1) {
  const pts = new Set<number>([0]);
  for (const c of Object.values(p.clips)) {
    pts.add(rt(c.start));
    pts.add(rt(c.start + c.duration));
  }
  const sorted = [...pts].sort((a, b) => a - b);
  if (dir > 0) return sorted.find((x) => x > t + EPS) ?? t;
  return [...sorted].reverse().find((x) => x < t - EPS) ?? 0;
}

/* ---------- Geometry ---------- */

/** A source's size in project pixels before the clip's own scale (fit into the frame). */
export function fitSize(srcW: number, srcH: number, frameW: number, frameH: number, fit: FitMode): [number, number] {
  if (!srcW || !srcH) return [frameW, frameH];
  if (fit === "fill") return [frameW, frameH];
  const s = fit === "cover" ? Math.max(frameW / srcW, frameH / srcH) : Math.min(frameW / srcW, frameH / srcH);
  return [srcW * s, srcH * s];
}

/** Moves every position into the new frame when the aspect ratio changes (sizes refit by themselves). */
export function setAspect(p: Project, aspect: AspectId): Project {
  const a = ASPECTS[aspect];
  const fx = a.width / p.settings.width;
  const fy = a.height / p.settings.height;
  const remap = (an: Clip["transform"]["x"], f: number) => ({ v: an.v * f, k: an.k?.map((k) => ({ ...k, v: k.v * f })) });
  const clips: Record<string, Clip> = {};
  for (const [id, c] of Object.entries(p.clips)) {
    clips[id] = { ...c, transform: { ...c.transform, x: remap(c.transform.x, fx), y: remap(c.transform.y, fy) } };
  }
  return { ...p, settings: { ...p.settings, aspect, width: a.width, height: a.height }, clips };
}

/** The closest preset to a picture's shape, for matching a project to its first video. */
export function nearestAspect(w: number, h: number): AspectId {
  const r = w / h;
  let best: AspectId = "16:9";
  let bestD = Infinity;
  for (const [id, a] of Object.entries(ASPECTS) as [AspectId, (typeof ASPECTS)[AspectId]][]) {
    const d = Math.abs(Math.log(r / (a.width / a.height)));
    if (d < bestD) {
      bestD = d;
      best = id;
    }
  }
  return best;
}

/* ---------- Pro edits: ripple, roll, slip, slide, rate stretch ---------- */

const groupOf = (p: Project, c: Clip) => [c, ...linked(p, c)];

/** The clip on `trackId` that ends exactly at `t` (the left side of a cut). */
export function clipEndingAt(p: Project, trackId: string, t: number, not?: string) {
  return Object.values(p.clips).find((x) => x.trackId === trackId && x.id !== not && Math.abs(x.start + x.duration - t) < 1e-3);
}

/** The clip on `trackId` that starts exactly at `t` (the right side of a cut). */
export function clipStartingAt(p: Project, trackId: string, t: number, not?: string) {
  return Object.values(p.clips).find((x) => x.trackId === trackId && x.id !== not && Math.abs(x.start - t) < 1e-3);
}

/** How far an end can grow before the source runs out (Infinity for stills, text and shapes). */
function roomBySource(p: Project, x: Clip) {
  const limit = sourceLimit(p, x);
  return Number.isFinite(limit) ? localForSrc(x, limit - x.in) - x.duration : Infinity;
}

/**
 * Ripple trim (Premiere's B tool): trims an edge and moves everything after the clip on the same
 * tracks by the same amount, so no gap opens (or the later clips make room).
 */
export function rippleTrim(p: Project, id: string, edge: TrimEdge, t: number): Project {
  const c = p.clips[id];
  if (!c) return p;
  const group = groupOf(p, c);
  const ids = new Set(group.map((x) => x.id));
  const tracks = new Set(group.map((x) => x.trackId));
  let lo = -Infinity;
  let hi = Infinity;
  for (const x of group) {
    if (edge === "end") {
      lo = Math.max(lo, MIN_CLIP - x.duration);
      hi = Math.min(hi, roomBySource(p, x));
    } else {
      hi = Math.min(hi, x.duration - MIN_CLIP);
      lo = Math.max(lo, earliestStart(x) - x.start);
    }
  }
  const delta = Math.min(hi, Math.max(lo, t - (edge === "end" ? c.start + c.duration : c.start)));
  if (Math.abs(delta) < 1e-7 || lo > hi) return p;
  const pivot = c.start + c.duration;
  const shift = edge === "end" ? delta : -delta;
  const clips = { ...p.clips };
  for (const x of Object.values(p.clips)) {
    if (ids.has(x.id) || !tracks.has(x.trackId) || x.start < pivot - EPS) continue;
    clips[x.id] = { ...x, start: rt(Math.max(0, x.start + shift)) };
  }
  for (const x of group) clips[x.id] = edge === "end" ? trimmed(x, "end", delta) : { ...trimmed(x, "start", delta), start: x.start };
  return { ...p, clips };
}

/** Roll edit (N): moves the cut between two touching clips; one gets longer, the other shorter, nothing else moves. */
export function rollEdit(p: Project, leftId: string, rightId: string, t: number): Project {
  const L = p.clips[leftId];
  const R = p.clips[rightId];
  if (!L || !R) return p;
  const lg = groupOf(p, L);
  const rg = groupOf(p, R);
  const ignore = new Set([...lg, ...rg].map((x) => x.id));
  const cut = L.start + L.duration;
  let lo = -Infinity;
  let hi = Infinity;
  for (const x of lg) {
    const [mn, mx] = trimBounds(p, x, "end", ignore);
    lo = Math.max(lo, mn - (x.start + x.duration));
    hi = Math.min(hi, mx - (x.start + x.duration));
  }
  for (const x of rg) {
    const [mn, mx] = trimBounds(p, x, "start", ignore);
    lo = Math.max(lo, mn - x.start);
    hi = Math.min(hi, mx - x.start);
  }
  const d = Math.min(hi, Math.max(lo, t - cut));
  if (Math.abs(d) < 1e-7 || lo > hi) return p;
  const clips = { ...p.clips };
  for (const x of lg) clips[x.id] = trimmed(x, "end", d);
  for (const x of rg) clips[x.id] = trimmed(x, "start", d);
  return { ...p, clips };
}

/** Slip (Y): the clip stays put and keeps its length but shows a different part of its source. */
export function slipClip(p: Project, id: string, dSrc: number): Project {
  const c = p.clips[id];
  if (!c || (c.kind !== "video" && c.kind !== "audio")) return p;
  const group = groupOf(p, c);
  let lo = -Infinity;
  let hi = Infinity;
  for (const x of group) {
    lo = Math.max(lo, -x.in);
    const limit = sourceLimit(p, x);
    if (Number.isFinite(limit)) hi = Math.min(hi, limit - x.in - srcSpan(x));
  }
  const d = Math.min(hi, Math.max(lo, dSrc));
  if (Math.abs(d) < 1e-7 || lo > hi) return p;
  const clips = { ...p.clips };
  for (const x of group) clips[x.id] = { ...x, in: rt(x.in + d) };
  return { ...p, clips };
}

/** Slide (U): the clip moves between its neighbours, which trim to fill in, so the sequence keeps its length. */
export function slideClip(p: Project, id: string, dt: number): Project {
  const c = p.clips[id];
  if (!c) return p;
  const group = groupOf(p, c);
  const ids = new Set(group.map((x) => x.id));
  let lo = -Infinity;
  let hi = Infinity;
  const sides = group.map((x) => {
    const prev = clipEndingAt(p, x.trackId, x.start, x.id);
    const next = clipStartingAt(p, x.trackId, x.start + x.duration, x.id);
    if (prev && !ids.has(prev.id)) {
      lo = Math.max(lo, MIN_CLIP - prev.duration);
      hi = Math.min(hi, roomBySource(p, prev));
    } else {
      const prevEnd = Object.values(p.clips)
        .filter((y) => y.trackId === x.trackId && !ids.has(y.id) && y.start + y.duration <= x.start + EPS)
        .reduce((m, y) => Math.max(m, y.start + y.duration), 0);
      lo = Math.max(lo, prevEnd - x.start);
    }
    if (next && !ids.has(next.id)) {
      hi = Math.min(hi, next.duration - MIN_CLIP);
      lo = Math.max(lo, earliestStart(next) - next.start);
    } else {
      const nextStart = Object.values(p.clips)
        .filter((y) => y.trackId === x.trackId && !ids.has(y.id) && y.start >= x.start + x.duration - EPS)
        .reduce((m, y) => Math.min(m, y.start), Infinity);
      hi = Math.min(hi, nextStart - (x.start + x.duration));
    }
    return { x, prev: prev && !ids.has(prev.id) ? prev : undefined, next: next && !ids.has(next.id) ? next : undefined };
  });
  const d = Math.min(hi, Math.max(lo, dt));
  if (Math.abs(d) < 1e-7 || lo > hi) return p;
  const clips = { ...p.clips };
  for (const { x, prev, next } of sides) {
    if (prev) clips[prev.id] = trimmed(prev, "end", d);
    if (next) clips[next.id] = trimmed(next, "start", d);
    clips[x.id] = { ...x, start: rt(x.start + d) };
  }
  return { ...p, clips };
}

/** Rate stretch (R): changes a clip's length by changing its speed, so exactly the same source fits. */
export function rateStretch(p: Project, id: string, edge: TrimEdge, t: number): Project {
  const c = p.clips[id];
  if (!c) return p;
  if (c.kind !== "video" && c.kind !== "audio") return trimClip(p, id, edge, t);
  const group = groupOf(p, c);
  const ids = new Set(group.map((x) => x.id));
  const span = srcSpan(c);
  const lo = Math.max(MIN_CLIP, span / 16);
  let hi = span / 0.1;
  for (const x of group) {
    const others = Object.values(p.clips).filter((y) => y.trackId === x.trackId && !ids.has(y.id));
    if (edge === "end") hi = Math.min(hi, others.filter((y) => y.start >= x.start + x.duration - EPS).reduce((m, y) => Math.min(m, y.start), Infinity) - x.start);
    else hi = Math.min(hi, x.start + x.duration - others.filter((y) => y.start + y.duration <= x.start + EPS).reduce((m, y) => Math.max(m, y.start + y.duration), 0));
  }
  const want = edge === "end" ? t - c.start : c.start + c.duration - t;
  const dur = rt(Math.min(hi, Math.max(lo, want)));
  if (Math.abs(dur - c.duration) < 1e-6 || lo > hi) return p;
  const clips = { ...p.clips };
  for (const x of group) {
    const factor = dur / x.duration;
    const ramp = x.speedRamp?.map((pt) => ({ t: rt(pt.t * factor), v: pt.v / factor }));
    const y = withRamp(rescaled(x, factor), ramp);
    clips[x.id] = { ...y, duration: dur, speed: ramp ? y.speed : Math.round((srcSpan(x) / dur) * 1000) / 1000, start: edge === "end" ? x.start : rt(x.start + x.duration - dur) };
  }
  return { ...p, clips };
}

/* ---------- Gaps and inserts ---------- */

/** Removes every stretch where no unlocked track has anything (and the space before the first clip), keeping tracks in sync. */
export function closeGaps(p: Project): Project {
  const tracks = p.tracks.filter((t) => !t.locked).map((t) => t.id);
  const spans = mergeRanges(Object.values(p.clips).filter((c) => tracks.includes(c.trackId)).map((c) => [c.start, c.start + c.duration] as [number, number]));
  const gaps: [number, number][] = [];
  let at = 0;
  for (const [a, b] of spans) {
    if (a > at + 1e-3) gaps.push([at, a]);
    at = Math.max(at, b);
  }
  return gaps.length ? rippleDeleteRanges(p, tracks, gaps) : p;
}

/** Insert (ripple) edit: opens `duration` seconds at `at` on every unlocked track (clips there are split and pushed later). */
export function insertGap(p: Project, at: number, duration: number): Project {
  const tracks = new Set(p.tracks.filter((t) => !t.locked).map((t) => t.id));
  let next = p;
  for (const c of Object.values(p.clips)) {
    const cur = next.clips[c.id];
    if (cur && tracks.has(cur.trackId) && at > cur.start + MIN_CLIP && at < cur.start + cur.duration - MIN_CLIP) [next] = splitClip(next, cur.id, at);
  }
  const clips = { ...next.clips };
  for (const c of Object.values(next.clips)) if (tracks.has(c.trackId) && c.start >= at - EPS) clips[c.id] = { ...c, start: rt(c.start + duration) };
  return { ...next, clips, markers: next.markers.map((m) => (m.t >= at - EPS ? { ...m, t: rt(m.t + duration) } : m)) };
}

/* ---------- Tracks ---------- */

/** Moves a track up (-1) or down (1) within its group (pictures among pictures, sound among sound). */
export function moveTrack(p: Project, id: string, dir: -1 | 1): Project {
  const i = p.tracks.findIndex((t) => t.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= p.tracks.length) return p;
  if ((p.tracks[i].kind === "audio") !== (p.tracks[j].kind === "audio")) return p;
  const tracks = [...p.tracks];
  [tracks[i], tracks[j]] = [tracks[j], tracks[i]];
  return { ...p, tracks };
}

/* ---------- Layouts: picture-in-picture and split screens ---------- */

export type Layout = LayoutId;

/**
 * Places visual clips: a corner picture-in-picture, or side by side / stacked / a 2×2 grid. Split
 * layouts fill each cell (cover) and crop to it with a Crop effect, so every face stays centred.
 */
export function applyLayout(p: Project, ids: string[], layout: Layout): Project {
  const W = p.settings.width;
  const H = p.settings.height;
  const clips = ids.map((id) => p.clips[id]).filter((c): c is Clip => !!c && (c.kind === "video" || c.kind === "image"));
  if (!clips.length) return p;
  // Higher tracks first, so the top track gets the first cell.
  const order = new Map(p.tracks.map((t, i) => [t.id, i]));
  clips.sort((a, b) => (order.get(a.trackId) ?? 0) - (order.get(b.trackId) ?? 0));
  const cells: [number, number, number, number][] =
    layout === "split-h"
      ? [[0, 0, 0.5, 1], [0.5, 0, 0.5, 1]]
      : layout === "split-v"
        ? [[0, 0, 1, 0.5], [0, 0.5, 1, 0.5]]
        : layout === "split-3h"
          ? [[0, 0, 1 / 3, 1], [1 / 3, 0, 1 / 3, 1], [2 / 3, 0, 1 / 3, 1]]
          : layout === "split-3v"
            ? [[0, 0, 1, 1 / 3], [0, 1 / 3, 1, 1 / 3], [0, 2 / 3, 1, 1 / 3]]
            : layout === "grid"
              ? [[0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5], [0, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]]
              : [];
  let next = p;
  clips.forEach((c, i) => {
    const m = c.mediaId ? p.media[c.mediaId] : undefined;
    next = updateClip(next, c.id, (x) => {
      const noCrop = x.effects.filter((e) => e.type !== "crop" && (layout !== "pip-framed" || e.type !== "frame"));
      const set = (fit: FitMode, cx: number, cy: number, scale: number, crop?: [number, number], extraFx?: Clip["effects"]) => {
        const effects = crop
          ? [
              ...noCrop,
              {
                id: uid("fx"),
                type: "crop" as const,
                enabled: true,
                params: { left: anim(crop[0]), right: anim(crop[0]), top: anim(crop[1]), bottom: anim(crop[1]), feather: anim(0) },
              },
              ...(extraFx ?? []),
            ]
          : [...noCrop, ...(extraFx ?? [])];
        return { ...x, fit, effects, transform: { ...x.transform, x: anim(rt(cx)), y: anim(rt(cy)), scaleX: anim(scale), scaleY: anim(scale), rotation: anim(0) } };
      };
      if (layout === "full") return set("cover", W / 2, H / 2, 1);
      if (layout === "fit") return set("contain", W / 2, H / 2, 1);
      if (layout === "pip-framed") {
        const s = 0.32;
        const [bw, bh] = fitSize(m?.width || W, m?.height || H, W, H, "contain");
        const mx = W * 0.04;
        const my = H * 0.04 * (W / H > 1 ? W / H : 1);
        return set("contain", W - mx - (bw * s) / 2, H - my - (bh * s) / 2, s, undefined, [
          {
            id: uid("fx"),
            type: "frame",
            enabled: true,
            params: { radius: anim(36), border: anim(8), shadow: anim(0.55), size: anim(44) },
            options: { color: "#ffffff" },
          },
        ]);
      }
      if (layout.startsWith("pip")) {
        const s = 0.34;
        const [bw, bh] = fitSize(m?.width || W, m?.height || H, W, H, "contain");
        const mx = W * 0.04;
        const my = H * 0.04 * (W / H > 1 ? W / H : 1);
        const left = layout.endsWith("l");
        const top = layout === "pip-tl" || layout === "pip-tr";
        return set("contain", left ? mx + (bw * s) / 2 : W - mx - (bw * s) / 2, top ? my + (bh * s) / 2 : H - my - (bh * s) / 2, s);
      }
      const cell = cells[i % cells.length];
      const [bw, bh] = fitSize(m?.width || W, m?.height || H, W, H, "cover");
      const visW = (cell[2] * W) / bw;
      const visH = (cell[3] * H) / bh;
      return set("cover", (cell[0] + cell[2] / 2) * W, (cell[1] + cell[3] / 2) * H, 1, [Math.max(0, (1 - visW) / 2), Math.max(0, (1 - visH) / 2)]);
    });
  });
  return next;
}

const kfs = (...pts: [number, number, Ease?][]) => ({
  v: pts[0]?.[1] ?? 0,
  k: pts.map(([t, v, ease = "easeInOut"]): Keyframe => ({ id: uid("k"), t: rt(t), v, ease })),
});

/** Applies a 1-click keyframe motion preset to any visual clip (`none` clears keyframes). */
export function applyClipMotion(p: Project, clipId: string, presetId: ClipMotionPresetId): Project {
  const c = p.clips[clipId];
  if (!c || c.kind === "audio") return p;
  const W = p.settings.width;
  const H = p.settings.height;
  const cx = W / 2;
  const cy = H / 2;
  const D = Math.max(0.25, c.duration);
  const base = baseTransform(p, 0.5);
  let tr: Clip["transform"];
  switch (presetId) {
    case "kenBurnsIn":
      tr = { ...base, scaleX: kfs([0, 1], [D, 1.18, "easeInOut"]), scaleY: kfs([0, 1], [D, 1.18, "easeInOut"]) };
      break;
    case "kenBurnsOut":
      tr = { ...base, scaleX: kfs([0, 1.18], [D, 1, "easeInOut"]), scaleY: kfs([0, 1.18], [D, 1, "easeInOut"]) };
      break;
    case "panLeft": {
      const dx = W * 0.055;
      tr = { ...base, x: kfs([0, cx + dx], [D, cx - dx, "linear"]), scaleX: anim(1.12), scaleY: anim(1.12) };
      break;
    }
    case "panRight": {
      const dx = W * 0.055;
      tr = { ...base, x: kfs([0, cx - dx], [D, cx + dx, "linear"]), scaleX: anim(1.12), scaleY: anim(1.12) };
      break;
    }
    case "zoomPunch": {
      const d = Math.min(0.45, D * 0.6);
      tr = { ...base, scaleX: kfs([0, 1.38, "easeOut"], [d, 1, "easeOut"]), scaleY: kfs([0, 1.38, "easeOut"], [d, 1, "easeOut"]) };
      break;
    }
    case "slideLeft": {
      const d = Math.min(0.55, D * 0.55);
      tr = { ...base, x: kfs([0, W * 1.45, "easeOut"], [d, cx, "easeOut"]), opacity: kfs([0, 0, "easeOut"], [d * 0.4, 1, "linear"]) };
      break;
    }
    case "slideBottom": {
      const d = Math.min(0.55, D * 0.55);
      tr = { ...base, y: kfs([0, H * 1.45, "easeOut"], [d, cy, "easeOut"]), opacity: kfs([0, 0, "easeOut"], [d * 0.4, 1, "linear"]) };
      break;
    }
    case "spinIn": {
      const d = Math.min(0.65, D * 0.6);
      tr = {
        ...base,
        rotation: kfs([0, -180, "back"], [d, 0, "easeOut"]),
        scaleX: kfs([0, 0.3, "back"], [d, 1, "easeOut"]),
        scaleY: kfs([0, 0.3, "back"], [d, 1, "easeOut"]),
        opacity: kfs([0, 0, "easeOut"], [d * 0.35, 1, "linear"]),
      };
      break;
    }
    case "floatLoop": {
      const dy = H * 0.018;
      tr = {
        ...base,
        y: kfs([0, cy - dy, "easeInOut"], [D * 0.5, cy + dy, "easeInOut"], [D, cy - dy, "easeInOut"]),
        rotation: kfs([0, -1.5, "easeInOut"], [D * 0.5, 1.5, "easeInOut"], [D, -1.5, "easeInOut"]),
      };
      break;
    }
    case "pulseLoop":
      tr = {
        ...base,
        scaleX: kfs([0, 1, "easeInOut"], [D * 0.5, 1.07, "easeInOut"], [D, 1, "easeInOut"]),
        scaleY: kfs([0, 1, "easeInOut"], [D * 0.5, 1.07, "easeInOut"], [D, 1, "easeInOut"]),
      };
      break;
    case "impactShake": {
      const t1 = Math.min(0.06, D * 0.12);
      const t2 = Math.min(0.12, D * 0.24);
      const t3 = Math.min(0.18, D * 0.36);
      const t4 = Math.min(0.26, D * 0.52);
      const t5 = Math.min(0.36, D * 0.72);
      const ax = W * 0.016;
      const ay = H * 0.014;
      tr = {
        ...base,
        x: kfs([0, cx - ax], [t1, cx + ax * 0.9], [t2, cx - ax * 0.65], [t3, cx + ax * 0.4], [t4, cx - ax * 0.2], [t5, cx]),
        y: kfs([0, cy + ay], [t1, cy - ay * 0.85], [t2, cy + ay * 0.55], [t3, cy - ay * 0.35], [t4, cy + ay * 0.15], [t5, cy]),
        scaleX: anim(1.04),
        scaleY: anim(1.04),
      };
      break;
    }
    case "none":
    default:
      tr = base;
      break;
  }
  return updateClip(p, clipId, { transform: tr });
}

export const TimelineEngine = {
  clipEnd,
  clipsOnTrack,
  projectDuration,
  addTrack,
  removeTrack,
  updateTrack,
  ensureTrack,
  updateClip,
  clearRange,
  placeClips,
  clipsForMedia,
  textClip,
  splitClip,
  splitAt,
  deleteClips,
  rippleDeleteRanges,
  moveClips,
  trimClip,
  trimBounds,
  setSpeed,
  duplicateClips,
  snapPoints,
  snapOffset,
  nextEdit,
  fitSize,
  setAspect,
  nearestAspect,
  withLinked,
  rippleTrim,
  rollEdit,
  slipClip,
  slideClip,
  rateStretch,
  closeGaps,
  insertGap,
  moveTrack,
  applyLayout,
  applyClipMotion,
  applySpeedRamp,
};
