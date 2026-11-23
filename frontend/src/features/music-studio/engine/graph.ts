import { beatsToSec, clipEnd, spb } from "../lib/project";
import type { AutoPoint, Clip, Project, Track } from "../types";
import { bufferNow } from "./assets";
import { dbToGain } from "./dsp";
import { isKit, playDrum } from "./drums";
import { FxChain } from "./effects";
import { startVoice, type Voice } from "./instruments";

/**
 * The mixer as a Web Audio graph, used for live playback and for the offline export:
 *
 *   instrument/clip → track input → FX chain → automation → duck → pan → volume → meter → master
 *   master → master FX → master volume → (analysers) → destination
 *
 * `schedule` places every note and audio clip in a span of the song; the live transport calls it
 * a few times a second just ahead of the clock, the exporter once for the whole song.
 */

type TrackNodes = {
  input: GainNode;
  fx: FxChain;
  auto: GainNode;
  duck: GainNode;
  pan: StereoPannerNode;
  vol: GainNode;
  meter: AnalyserNode;
  openHat: GainNode | null;
};

type Live = { stop: (at: number) => void; end: number };

export class ProjectGraph {
  readonly master: { input: GainNode; fx: FxChain; gain: GainNode; meterL: AnalyserNode; meterR: AnalyserNode };
  readonly tracks = new Map<string, TrackNodes>();
  private live = new Set<Live>();
  private duckCache = new Map<string, { key: string; ranges: [number, number][] }>();

  constructor(
    readonly ctx: BaseAudioContext,
    destination: AudioNode,
  ) {
    const input = ctx.createGain();
    // Headroom: a full arrangement sums above 0 dBFS; the master chain and loudness export
    // restore the level, without the bus clipping first.
    input.gain.value = 0.75;
    const fx = new FxChain(ctx);
    const gain = ctx.createGain();
    input.connect(fx.input);
    fx.output.connect(gain);
    gain.connect(destination);
    const split = ctx.createChannelSplitter(2);
    const meterL = ctx.createAnalyser();
    const meterR = ctx.createAnalyser();
    meterL.fftSize = meterR.fftSize = 1024;
    gain.connect(split);
    split.connect(meterL, 0);
    split.connect(meterR, 1);
    this.master = { input, fx, gain, meterL, meterR };
  }

  private smooth(param: AudioParam, value: number) {
    if (this.ctx instanceof OfflineAudioContext) param.value = value;
    else param.setTargetAtTime(value, this.ctx.currentTime, 0.015);
  }

  sync(p: Project) {
    const soloed = p.tracks.some((t) => t.solo);
    const ids = new Set(p.tracks.map((t) => t.id));
    for (const [id, n] of this.tracks) {
      if (ids.has(id)) continue;
      n.fx.dispose();
      for (const node of [n.input, n.auto, n.duck, n.pan, n.vol, n.meter]) node.disconnect();
      this.tracks.delete(id);
    }
    for (const t of p.tracks) {
      let n = this.tracks.get(t.id);
      if (!n) {
        const c = this.ctx;
        n = { input: c.createGain(), fx: new FxChain(c), auto: c.createGain(), duck: c.createGain(), pan: c.createStereoPanner(), vol: c.createGain(), meter: c.createAnalyser(), openHat: null };
        n.meter.fftSize = 512;
        n.input.connect(n.fx.input);
        n.fx.output.connect(n.auto).connect(n.duck).connect(n.pan).connect(n.vol);
        n.vol.connect(n.meter);
        n.vol.connect(this.master.input);
        this.tracks.set(t.id, n);
      }
      n.fx.sync(t.fx, p.bpm);
      const audible = !t.mute && (!soloed || t.solo);
      this.smooth(n.vol.gain, audible ? t.volume : 0);
      this.smooth(n.pan.pan, t.pan);
      if (!t.automation?.length) this.smooth(n.auto.gain, 1);
      if (!t.duck) this.smooth(n.duck.gain, 1);
    }
    this.master.fx.sync(p.master.fx, p.bpm);
    this.smooth(this.master.gain.gain, p.master.volume);
  }

  inputOf(trackId: string) {
    return this.tracks.get(trackId)?.input ?? this.master.input;
  }

  /** Starts a live note on a track (keyboard, MIDI input or preview). */
  noteOn(track: Track, pitch: number, velocity: number, when = this.ctx.currentTime): Voice {
    const dest = this.inputOf(track.id);
    if (track.kind === "drums" || isKit(track.instrument)) {
      playDrum(this.ctx, dest, track.instrument || "kit-808", pitch, when, velocity);
      return { release: () => undefined, end: when + 2 };
    }
    return startVoice(this.ctx, dest, track.instrument || "piano", pitch, when, velocity, track.tweaks, bufferNow(track.sampleAssetId));
  }

  /**
   * Schedules everything that starts in [from, to) beats. `timeOf(beat)` maps song beats to the
   * context clock. With `ongoing`, notes and audio already sounding at `from` start part-way
   * through (pressing play mid-song, or the loop jumping back).
   */
  schedule(p: Project, from: number, to: number, timeOf: (beat: number) => number, ongoing = false) {
    const ctx = this.ctx;
    const beatSec = spb(p);
    for (const t of p.tracks) {
      const n = this.tracks.get(t.id);
      if (!n) continue;
      this.automate(t, n, from, to, timeOf, ongoing);
      if (t.duck) this.duck(p, t, n, from, to, timeOf, ongoing);
      for (const c of Object.values(p.clips)) {
        if (c.trackId !== t.id || c.muted) continue;
        const end = clipEnd(c);
        if (end <= from || c.start >= to) continue;
        if (c.assetId) {
          const startsHere = c.start >= from && c.start < to;
          const sounding = ongoing && c.start < from && end > from;
          if (startsHere || sounding) this.playAudio(p, c, n, sounding ? from : c.start, timeOf);
          continue;
        }
        if (!c.notes?.length) continue;
        const drums = t.kind === "drums" || isKit(t.instrument);
        const swing = drums ? (c.swing ?? 0) : 0;
        for (const note of c.notes) {
          if (note.start >= c.length || note.start < 0) continue;
          let at = c.start + note.start;
          // Swing delays every second 16th note.
          if (swing && Math.abs((note.start * 4) % 2 - 1) < 0.01) at += swing * 0.25;
          const noteEnd = c.start + Math.min(c.length, note.start + note.length);
          const startsHere = at >= from && at < to;
          const sounding = ongoing && !drums && at < from && noteEnd > from + 0.05;
          if (!startsHere && !sounding) continue;
          const when = timeOf(sounding ? from : at);
          if (when < ctx.currentTime - 0.01) continue;
          if (drums) {
            if (sounding) continue;
            const hit = playDrum(ctx, n.input, t.instrument || "kit-808", note.pitch, when, note.velocity);
            // A closed hat chokes a ringing open hat, like a real hi-hat pedal.
            if (note.pitch === 42 || note.pitch === 44) n.openHat?.gain.setTargetAtTime(0, when, 0.01);
            if (note.pitch === 46) n.openHat = hit.gain;
            this.track({ stop: (s) => hit.src.stop(s), end: when + (hit.src.buffer?.duration ?? 1) });
          } else {
            const v = startVoice(ctx, n.input, t.instrument || "piano", note.pitch, when, note.velocity, t.tweaks, bufferNow(t.sampleAssetId));
            const dur = (noteEnd - (sounding ? from : at)) * beatSec;
            v.release(when + Math.max(0.03, dur));
            this.track({ stop: (s) => v.release(s), end: v.end });
          }
        }
      }
    }
  }

  private playAudio(p: Project, c: Clip, n: TrackNodes, fromBeat: number, timeOf: (b: number) => number) {
    const buf = bufferNow(c.assetId);
    if (!buf) return;
    const ctx = this.ctx;
    const into = beatsToSec(p, fromBeat - c.start);
    const offset = (c.offset ?? 0) + into;
    const total = beatsToSec(p, c.length);
    const remain = Math.min(total - into, buf.duration - offset);
    if (remain <= 0.005 || offset >= buf.duration) return;
    const when = Math.max(ctx.currentTime, timeOf(fromBeat));
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    const gain = c.gain ?? 1;
    // Fades are set on the clip's own timeline, so they line up even when starting mid-clip.
    const fi = Math.min(c.fadeIn ?? 0, total / 2);
    const fo = Math.min(c.fadeOut ?? 0, total / 2);
    const startT = when - into;
    const at = (clipSec: number) => startT + clipSec;
    const valueAt = (clipSec: number) => gain * Math.min(fi > 0 ? Math.min(1, clipSec / fi) : 1, fo > 0 ? Math.min(1, (total - clipSec) / fo) : 1);
    g.gain.setValueAtTime(valueAt(into), when);
    if (fi > 0 && into < fi) g.gain.linearRampToValueAtTime(gain, at(fi));
    if (fo > 0) {
      const foStart = Math.max(into, total - fo);
      g.gain.setValueAtTime(valueAt(foStart), Math.max(when, at(foStart)));
      g.gain.linearRampToValueAtTime(0, at(total));
    }
    src.connect(g).connect(n.input);
    src.start(when, offset, remain);
    src.onended = () => {
      src.disconnect();
      g.disconnect();
    };
    this.track({ stop: (s) => src.stop(s), end: when + remain });
  }

  private automate(t: Track, n: TrackNodes, from: number, to: number, timeOf: (b: number) => number, ongoing: boolean) {
    const pts = t.automation;
    if (!pts?.length) return;
    const g = n.auto.gain;
    const t0 = Math.max(this.ctx.currentTime, timeOf(from));
    if (ongoing) g.setValueAtTime(autoValue(pts, from), t0);
    // Breakpoints inside the span, then the value at its end: a piecewise-linear envelope.
    for (const pt of pts) if (pt.beat > from && pt.beat < to) g.linearRampToValueAtTime(pt.value, timeOf(pt.beat));
    g.linearRampToValueAtTime(autoValue(pts, to), timeOf(to));
  }

  /** Where the duck source has sound (in beats), from its audio's loudness and its notes. */
  private duckRanges(p: Project, sourceId: string): [number, number][] {
    const clips = Object.values(p.clips).filter((c) => c.trackId === sourceId && !c.muted);
    const key = `${p.bpm}|${clips.map((c) => `${c.id}:${c.start}:${c.length}:${c.offset ?? 0}:${c.assetId ?? ""}:${c.notes?.length ?? 0}`).join(",")}`;
    const hit = this.duckCache.get(sourceId);
    if (hit?.key === key) return hit.ranges;
    const raw: [number, number][] = [];
    const beatSec = spb(p);
    for (const c of clips) {
      if (c.notes) {
        for (const note of c.notes) raw.push([c.start + note.start, c.start + note.start + note.length]);
        continue;
      }
      const buf = bufferNow(c.assetId);
      if (!buf) continue;
      const data = buf.getChannelData(0);
      const frame = Math.round(buf.sampleRate * 0.05);
      const startS = Math.round((c.offset ?? 0) * buf.sampleRate);
      const endS = Math.min(data.length, startS + Math.round(c.length * beatSec * buf.sampleRate));
      let open: number | null = null;
      for (let s = startS; s < endS; s += frame) {
        let sum = 0;
        const e = Math.min(endS, s + frame);
        for (let i = s; i < e; i++) sum += data[i] * data[i];
        const loud = 10 * Math.log10(sum / Math.max(1, e - s) + 1e-12) > -42;
        const beat = c.start + (s - startS) / buf.sampleRate / beatSec;
        if (loud && open === null) open = beat;
        if (!loud && open !== null) {
          raw.push([open, beat]);
          open = null;
        }
      }
      if (open !== null) raw.push([open, clipEnd(c)]);
    }
    // Hold through short pauses between words so the music doesn't pump.
    raw.sort((a, b) => a[0] - b[0]);
    const hold = 0.35 / beatSec;
    const ranges: [number, number][] = [];
    for (const r of raw) {
      const last = ranges[ranges.length - 1];
      if (last && r[0] <= last[1] + hold) last[1] = Math.max(last[1], r[1]);
      else ranges.push([r[0], r[1]]);
    }
    this.duckCache.set(sourceId, { key, ranges });
    return ranges;
  }

  private duck(p: Project, t: Track, n: TrackNodes, from: number, to: number, timeOf: (b: number) => number, ongoing: boolean) {
    const ranges = this.duckRanges(p, t.duck!.source);
    const low = dbToGain(-Math.abs(t.duck!.amount));
    const g = n.duck.gain;
    if (ongoing) {
      const inside = ranges.some(([a, b]) => from >= a && from < b + 0.35 / spb(p));
      g.setValueAtTime(inside ? low : 1, Math.max(this.ctx.currentTime, timeOf(from)));
    }
    for (const [a, b] of ranges) {
      if (a >= from && a < to) g.setTargetAtTime(low, timeOf(a) - 0.05, 0.04);
      const release = b + 0.35 / spb(p);
      if (release >= from && release < to) g.setTargetAtTime(1, timeOf(release), 0.25);
    }
  }

  private track(l: Live) {
    this.live.add(l);
    if (this.live.size > 400) {
      const now = this.ctx.currentTime;
      for (const x of this.live) if (x.end < now) this.live.delete(x);
    }
  }

  /** Silences everything scheduled (stop or seek). */
  stopAll() {
    const now = this.ctx.currentTime;
    for (const l of this.live) {
      try {
        l.stop(now + 0.01);
      } catch {
        /* already finished */
      }
    }
    this.live.clear();
    for (const n of this.tracks.values()) {
      n.auto.gain.cancelScheduledValues(now);
      n.duck.gain.cancelScheduledValues(now);
      n.duck.gain.setValueAtTime(1, now);
      n.openHat = null;
    }
  }

  dispose() {
    this.stopAll();
    for (const n of this.tracks.values()) n.fx.dispose();
    this.master.fx.dispose();
    this.master.gain.disconnect();
  }
}

export function autoValue(pts: AutoPoint[], beat: number) {
  if (!pts.length) return 1;
  if (beat <= pts[0].beat) return pts[0].value;
  for (let i = 1; i < pts.length; i++) {
    if (beat <= pts[i].beat) {
      const a = pts[i - 1];
      const b = pts[i];
      return a.value + ((b.value - a.value) * (beat - a.beat)) / Math.max(1e-6, b.beat - a.beat);
    }
  }
  return pts[pts.length - 1].value;
}
