"use client";

import { SAMPLE_RATE } from "../constants";
import { beatsToSec, makeClip, newNote, projectLength, putClips, spb } from "../lib/project";
import { getStudio, useStudio } from "../store";
import type { Note, Project, Track } from "../types";
import { addAssetPcm, loadBuffer } from "./assets";
import { drumBuffer, isKit, playDrum } from "./drums";
import { ProjectGraph } from "./graph";
import { instrumentById, prewarm, startVoice, warmInBackground, type Voice } from "./instruments";

/**
 * The live transport: one AudioContext (created on the first tap, as browsers require), the
 * project graph, a look-ahead scheduler, the metronome, live notes from the keyboard or a MIDI
 * controller, and recording (sound from the microphone, notes from the keys).
 */

const LOOKAHEAD = 0.2;
const TICK_MS = 25;
const CHUNK_BEATS = 0.5;
/** The shortest a live note can be, so even the fastest tap is heard. */
const MIN_TAP = 0.08;

const WORKLET = `
class Rec extends AudioWorkletProcessor {
  constructor() { super(); this.on = true; this.port.onmessage = (e) => { if (e.data === 'stop') this.on = false; }; }
  process(inputs) {
    const ch = inputs[0];
    if (ch && ch.length) this.port.postMessage({ frame: currentFrame, data: ch.map((c) => c.slice()) });
    return this.on;
  }
}
registerProcessor('dwyl-rec', Rec);
`;

type Rec = {
  stream: MediaStream;
  source: MediaStreamAudioSourceNode;
  node: AudioWorkletNode | ScriptProcessorNode;
  chunks: { frame: number; data: Float32Array[] }[];
  trackId: string;
  midiTrack: string | null;
  notes: Note[];
  open: Map<number, { start: number; vel: number }>;
  startBeat: number;
};

class Transport {
  ctx: AudioContext | null = null;
  graph: ProjectGraph | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private raf = 0;
  private originTime = 0;
  private originBeat = 0;
  private nextBeat = 0;
  private wraps: { atTime: number; beat: number }[] = [];
  /** Live notes being held, with when they started (a tap always sounds for a minimum time). */
  private held = new Map<string, Voice & { at: number }>();
  private rec: Rec | null = null;
  private inputAnalyser: AnalyserNode | null = null;
  private monitorGain: GainNode | null = null;
  private unsub: (() => void) | null = null;
  private keepAlive: OscillatorNode | null = null;
  private workletReady: Promise<boolean> | null = null;
  private countInUntil = 0;
  private lastUiUpdate = 0;

  /** The context, created and resumed on demand (must follow a user gesture the first time). */
  async ensure(): Promise<AudioContext> {
    if (!this.ctx) {
      // iPhone/iPad: play through the silent switch, like a music app (Safari 16.4+).
      const nav = navigator as Navigator & { audioSession?: { type: string } };
      if (nav.audioSession) {
        try {
          nav.audioSession.type = "playback";
        } catch {
          /* older Safari */
        }
      }
      let ctx: AudioContext;
      try {
        ctx = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: "interactive" });
      } catch {
        // Older Safari refuses a sample rate it doesn't run at; the engine copes with any rate.
        ctx = new AudioContext({ latencyHint: "interactive" });
      }
      this.ctx = ctx;
      this.graph = new ProjectGraph(ctx, ctx.destination);
      this.graph.sync(getStudio().project);
      // A -100 dBFS tone keeps Chromium from throttling the clock during silent stretches.
      const ka = ctx.createOscillator();
      const kg = ctx.createGain();
      kg.gain.value = 1e-5;
      ka.connect(kg).connect(ctx.destination);
      ka.start();
      this.keepAlive = ka;
      let lastProject = getStudio().project;
      this.unsub = useStudio.subscribe((s) => {
        if (s.project !== lastProject) {
          lastProject = s.project;
          this.graph?.sync(s.project);
        }
      });
    }
    if (this.ctx.state !== "running") await this.ctx.resume().catch(() => undefined);
    return this.ctx;
  }

  /** Song position in beats right now. */
  position(): number {
    const st = getStudio();
    if (!st.playing || !this.ctx) return st.playhead;
    const now = this.ctx.currentTime;
    if (now < this.countInUntil) return this.originBeat;
    // Find the last loop jump that has happened.
    let originT = this.originTime;
    let originB = this.originBeat;
    for (const w of this.wraps) {
      if (w.atTime <= now) {
        originT = w.atTime;
        originB = w.beat;
      }
    }
    return originB + (now - originT) / spb(st.project);
  }

  private timeOfFactory(originT: number, originB: number, p: Project) {
    const s = spb(p);
    return (beat: number) => originT + (beat - originB) * s;
  }

  async play(from?: number) {
    const ctx = await this.ensure();
    const st = getStudio();
    if (st.playing) this.halt(false);
    const p = st.project;
    let start = Math.max(0, from ?? st.playhead);
    if (p.loop.on && p.loop.end > p.loop.start && (start >= p.loop.end || start < p.loop.start - 1e-6)) start = p.loop.start;
    if (!p.loop.on && start >= projectLength(p) - 0.01) start = 0;
    await this.prepare(p);
    const countIn = st.recording && st.countIn ? p.sig : 0;
    const t0 = ctx.currentTime + 0.06;
    this.countInUntil = t0 + countIn * spb(p);
    if (countIn) for (let b = 0; b < countIn; b++) this.click(t0 + b * spb(p), b === 0);
    this.originTime = this.countInUntil;
    this.originBeat = start;
    this.nextBeat = start;
    this.wraps = [];
    st.set({ playing: true, playhead: start });
    // The first span includes notes and audio already sounding at the start point.
    this.pump(true);
    this.timer = setInterval(() => this.pump(false), TICK_MS);
    const ui = () => {
      if (!getStudio().playing) return;
      const now = performance.now();
      if (now - this.lastUiUpdate > 60) {
        this.lastUiUpdate = now;
        const pos = this.position();
        getStudio().set({ playhead: pos });
        const s = getStudio();
        if (!s.project.loop.on && !s.recording && pos > projectLength(s.project) + 0.5) {
          this.stop(true);
          return;
        }
        this.meterInput();
      }
      this.raf = requestAnimationFrame(ui);
    };
    this.raf = requestAnimationFrame(ui);
    if (st.recording) await this.beginCapture(start);
  }

  /** Loads every audio file and warms instrument caches the song needs, before starting. */
  private async prepare(p: Project) {
    const ids = new Set<string>();
    for (const c of Object.values(p.clips)) if (c.assetId) ids.add(c.assetId);
    for (const t of p.tracks) if (t.sampleAssetId) ids.add(t.sampleAssetId);
    await Promise.all([...ids].map((id) => loadBuffer(id)));
    for (const t of p.tracks) {
      if (t.kind === "audio") continue;
      const pitches = new Set<number>();
      for (const c of Object.values(p.clips)) if (c.trackId === t.id) for (const n of c.notes ?? []) pitches.add(n.pitch);
      if (isKit(t.instrument)) for (const pt of pitches) drumBuffer(t.instrument, pt);
      else prewarm(t.instrument, pitches, t.tweaks);
    }
  }

  private pump(first: boolean) {
    const ctx = this.ctx;
    const graph = this.graph;
    if (!ctx || !graph) return;
    const st = getStudio();
    const p = st.project;
    const horizon = ctx.currentTime + LOOKAHEAD;
    let ongoing = first;
    // The clock time of nextBeat, from the latest origin (start or loop jump).
    const lastWrap = this.wraps[this.wraps.length - 1];
    let originT = lastWrap?.atTime ?? this.originTime;
    let originB = lastWrap?.beat ?? this.originBeat;
    let guard = 0;
    while (guard++ < 64) {
      const timeOf = this.timeOfFactory(originT, originB, p);
      if (timeOf(this.nextBeat) >= horizon) break;
      let to = this.nextBeat + CHUNK_BEATS;
      const looping = p.loop.on && p.loop.end - p.loop.start >= 0.25 && this.nextBeat < p.loop.end;
      if (looping) to = Math.min(to, p.loop.end);
      graph.schedule(p, this.nextBeat, to, timeOf, ongoing);
      if (st.metronome || st.recording) this.metronome(p, this.nextBeat, to, timeOf);
      ongoing = false;
      this.nextBeat = to;
      if (looping && to >= p.loop.end - 1e-9) {
        // Jump back: the loop start plays exactly when the loop end would have.
        const at = timeOf(p.loop.end);
        originT = at;
        originB = p.loop.start;
        this.nextBeat = p.loop.start;
        this.wraps.push({ atTime: at, beat: p.loop.start });
        if (this.wraps.length > 8) this.wraps.shift();
        // Audio clips spanning the loop start must begin part-way through.
        graph.schedule(p, p.loop.start, p.loop.start + 1e-6, this.timeOfFactory(at, p.loop.start, p), true);
      }
    }
  }

  private metronome(p: Project, from: number, to: number, timeOf: (b: number) => number) {
    for (let b = Math.ceil(from - 1e-9); b < to; b++) this.click(timeOf(b), b % p.sig === 0);
  }

  private click(when: number, accent: boolean) {
    const ctx = this.ctx!;
    if (when < ctx.currentTime) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = accent ? 1760 : 1180;
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(accent ? 0.35 : 0.22, when + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
    o.connect(g).connect(ctx.destination);
    o.start(when);
    o.stop(when + 0.06);
    o.onended = () => g.disconnect();
  }

  private halt(updateHead: boolean) {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    cancelAnimationFrame(this.raf);
    const pos = this.position();
    this.graph?.stopAll();
    if (updateHead) getStudio().set({ playhead: Math.max(0, pos) });
  }

  async stop(keepPosition = false) {
    const st = getStudio();
    const was = st.playing;
    const pos = this.position();
    this.halt(false);
    st.set({ playing: false });
    if (this.rec) await this.finishCapture();
    if (st.recording) st.set({ recording: false });
    // Stop once: stay where you stopped. Stop again: back to the start (or the loop start).
    if (keepPosition || was) st.set({ playhead: Math.max(0, pos) });
    else st.set({ playhead: st.project.loop.on ? st.project.loop.start : 0 });
  }

  async toggle() {
    if (getStudio().playing) await this.stop(true);
    else await this.play();
  }

  async seek(beat: number) {
    const st = getStudio();
    const b = Math.max(0, beat);
    if (st.playing && !st.recording) {
      this.halt(false);
      st.set({ playing: false });
      await this.play(b);
    } else st.set({ playhead: b });
  }

  // ---- live notes ---------------------------------------------------------------------------

  private trackFor(id: string | null): Track | undefined {
    const p = getStudio().project;
    return p.tracks.find((t) => t.id === id) ?? p.tracks.find((t) => t.kind !== "audio");
  }

  private pendingOff = new Set<string>();

  async noteOn(trackId: string | null, pitch: number, velocity = 0.8) {
    const pre = this.trackFor(trackId);
    const preKey = pre ? `${pre.id}:${pitch}` : "";
    this.pendingOff.delete(preKey);
    // The first tap creates the audio context, which takes a moment: a quick tap can be released
    // before the note exists. Remember that, and play a short note instead of a stuck one.
    if (!this.ctx || this.ctx.state !== "running") await this.ensure();
    const t = this.trackFor(trackId);
    if (!t || !this.graph || t.kind === "audio") return;
    const key = `${t.id}:${pitch}`;
    const now = this.ctx!.currentTime;
    this.held.get(key)?.release(now);
    const v = this.graph.noteOn(t, pitch, velocity);
    if (this.pendingOff.delete(key)) {
      v.release(now + MIN_TAP);
      return;
    }
    this.held.set(key, Object.assign(v, { at: now }));
    if (this.rec?.midiTrack === t.id && getStudio().playing) this.rec.open.set(pitch, { start: this.position(), vel: velocity });
  }

  noteOff(trackId: string | null, pitch: number) {
    const t = this.trackFor(trackId);
    if (!t) return;
    const key = `${t.id}:${pitch}`;
    const v = this.held.get(key);
    if (!v || !this.ctx) {
      this.pendingOff.add(key);
      return;
    }
    // A very quick tap releases within the same audio block it started in: keep it sounding briefly.
    v.release(Math.max(this.ctx.currentTime, v.at + MIN_TAP));
    this.held.delete(key);
    const o = this.rec?.open.get(pitch);
    if (o && this.rec) {
      this.rec.open.delete(pitch);
      const end = this.position();
      this.rec.notes.push(newNote({ pitch, start: o.start, length: Math.max(1 / 16, end - o.start), velocity: o.vel }));
    }
  }

  /** One short sound for browsing instruments and kits. */
  async preview(instrument: string, pitch = 60, seconds = 0.6) {
    const ctx = await this.ensure();
    const dest = this.graph!.master.input;
    if (isKit(instrument)) {
      playDrum(ctx, dest, instrument, pitch, ctx.currentTime + 0.01, 0.85);
      return;
    }
    if (instrumentById(instrument).kind === "sampler") {
      getStudio().notify("The sampler plays your own sound: choose a recording for it in the track's settings.", "info");
      return;
    }
    startVoice(ctx, dest, instrument, pitch, ctx.currentTime + 0.01, 0.8).release(ctx.currentTime + seconds);
  }

  private previewSrc: AudioBufferSourceNode | null = null;
  /** Plays a buffer once (loops, sound effects, AI results); calling again stops the last one. */
  async previewBuffer(buf: AudioBuffer | null) {
    const ctx = await this.ensure();
    try {
      this.previewSrc?.stop();
    } catch {
      /* ended */
    }
    this.previewSrc = null;
    if (!buf) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.graph!.master.input);
    src.start();
    this.previewSrc = src;
  }

  // ---- recording -----------------------------------------------------------------------------

  private inputStream: MediaStream | null = null;
  /** Opens the microphone for monitoring (kept open until `closeInput`). */
  async openInput(): Promise<MediaStream> {
    await this.ensure();
    if (this.inputStream?.active) return this.inputStream;
    this.inputStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    return this.inputStream;
  }

  closeInput() {
    this.inputStream?.getTracks().forEach((t) => t.stop());
    this.inputStream = null;
  }

  private meterInput() {
    const a = this.inputAnalyser;
    if (!a || !this.rec) return;
    const buf = new Float32Array(a.fftSize);
    a.getFloatTimeDomainData(buf);
    let p = 0;
    for (const v of buf) p = Math.max(p, Math.abs(v));
    getStudio().set({ inputLevel: p });
  }

  /** Arms recording and starts playback with a count-in. Audio goes to the armed audio track. */
  async record() {
    const st = getStudio();
    if (st.recording) return this.stop(true);
    // Nothing armed: record the microphone onto a new audio track.
    if (!st.project.tracks.some((t) => t.armed)) st.addTrack("audio", { name: "Recording", armed: true });
    st.set({ recording: true });
    try {
      await this.play();
    } catch (e) {
      st.set({ recording: false });
      throw e;
    }
  }

  private async beginCapture(startBeat: number) {
    const st = getStudio();
    const p = st.project;
    const wantsAudio = p.tracks.some((t) => t.armed && t.kind === "audio") || !p.tracks.some((t) => t.armed);
    if (!wantsAudio) {
      const midi = p.tracks.find((t) => t.armed && t.kind !== "audio");
      this.rec = { stream: null as unknown as MediaStream, source: null as unknown as MediaStreamAudioSourceNode, node: null as unknown as AudioWorkletNode, chunks: [], trackId: "", midiTrack: midi?.id ?? null, notes: [], open: new Map(), startBeat };
      return;
    }
    const ctx = this.ctx!;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch {
      await this.stop(true);
      st.notify("Allow the microphone to record (the browser asks once). Recordings stay on this device.", "warning");
      return;
    }
    const source = ctx.createMediaStreamSource(stream);
    this.inputAnalyser = ctx.createAnalyser();
    source.connect(this.inputAnalyser);
    const chunks: Rec["chunks"] = [];
    let node: AudioWorkletNode | ScriptProcessorNode;
    this.workletReady ??= (async () => {
      try {
        const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
        await ctx.audioWorklet.addModule(url);
        URL.revokeObjectURL(url);
        return true;
      } catch {
        return false;
      }
    })();
    if (await this.workletReady) {
      const w = new AudioWorkletNode(ctx, "dwyl-rec", { numberOfInputs: 1, numberOfOutputs: 0 });
      w.port.onmessage = (e: MessageEvent) => chunks.push(e.data as Rec["chunks"][number]);
      node = w;
      source.connect(w);
    } else {
      // Older Safari: the deprecated processor still works.
      const sp = ctx.createScriptProcessor(4096, 2, 2);
      let frame = Math.round(ctx.currentTime * ctx.sampleRate);
      sp.onaudioprocess = (e) => {
        const data = Array.from({ length: e.inputBuffer.numberOfChannels }, (_, c) => e.inputBuffer.getChannelData(c).slice());
        chunks.push({ frame, data });
        frame += e.inputBuffer.length;
      };
      const silent = ctx.createGain();
      silent.gain.value = 0;
      source.connect(sp).connect(silent).connect(ctx.destination);
      node = sp;
    }
    const armedMidi = p.tracks.find((t) => t.armed && t.kind !== "audio");
    this.rec = { stream, source, node, chunks, trackId: p.tracks.find((t) => t.armed && t.kind === "audio")?.id ?? "", midiTrack: armedMidi?.id ?? null, notes: [], open: new Map(), startBeat };
  }

  private async finishCapture() {
    const rec = this.rec;
    this.rec = null;
    getStudio().set({ inputLevel: 0 });
    if (!rec) return;
    const st = getStudio();
    // MIDI take
    if (rec.midiTrack) {
      const end = this.position();
      for (const [pitch, o] of rec.open) rec.notes.push(newNote({ pitch, start: o.start, length: Math.max(1 / 16, end - o.start), velocity: o.vel }));
      if (rec.notes.length) {
        const first = Math.floor(Math.min(...rec.notes.map((n) => n.start)) / st.project.sig) * st.project.sig;
        const last = Math.max(...rec.notes.map((n) => n.start + n.length));
        const len = Math.max(st.project.sig, Math.ceil((last - first) / st.project.sig) * st.project.sig);
        const clip = makeClip(rec.midiTrack, { name: "Take", start: first, length: len, notes: rec.notes.map((n) => ({ ...n, start: n.start - first })) });
        st.commit((p) => putClips(p, [clip]));
        st.notify(`Recorded ${rec.notes.length} notes.`, "success");
      }
    }
    if (!rec.stream) return;
    if (rec.node instanceof AudioWorkletNode) rec.node.port.postMessage("stop");
    rec.source.disconnect();
    rec.node.disconnect();
    rec.stream.getTracks().forEach((t) => t.stop());
    if (!rec.chunks.length || !rec.trackId) return;
    const ctx = this.ctx!;
    const channels = Math.min(2, Math.max(...rec.chunks.map((c) => c.data.length)));
    const total = rec.chunks.reduce((a, c) => a + c.data[0].length, 0);
    const out = Array.from({ length: channels }, () => new Float32Array(total));
    let o = 0;
    for (const c of rec.chunks) {
      for (let ch = 0; ch < channels; ch++) out[ch].set(c.data[Math.min(ch, c.data.length - 1)], o);
      o += c.data[0].length;
    }
    // The first sample reached us late by the round trip through the sound card; move it back.
    const latency = (ctx.baseLatency || 0) + ((ctx as AudioContext & { outputLatency?: number }).outputLatency || 0);
    const firstTime = rec.chunks[0].frame / ctx.sampleRate - latency;
    const p = st.project;
    const startBeat = this.originBeat + (firstTime - this.originTime) / spb(p);
    // Trim anything captured during the count-in.
    const skip = Math.max(0, Math.round((rec.startBeat - startBeat) * spb(p) * ctx.sampleRate));
    const trimmed = out.map((c) => c.subarray(skip));
    if (trimmed[0].length < ctx.sampleRate * 0.1) return;
    const { meta } = await addAssetPcm({ sampleRate: ctx.sampleRate, channels: trimmed }, `Take ${new Date().toLocaleTimeString()}`);
    const at = Math.max(rec.startBeat, startBeat);
    const length = trimmed[0].length / ctx.sampleRate / spb(p);
    const clip = makeClip(rec.trackId, { name: "Take", start: at, length, assetId: meta.id, offset: 0 });
    st.commit((q) => putClips({ ...q, assets: { ...q.assets, [meta.id]: meta } }, [clip]));
    st.notify("Recording added.", "success");
  }

  /** Mic monitoring through the armed track (headphones recommended). */
  async setMonitor(on: boolean) {
    const ctx = await this.ensure();
    this.monitorGain?.disconnect();
    this.monitorGain = null;
    if (!on) return this.closeInput();
    const stream = await this.openInput();
    const armed = getStudio().project.tracks.find((t) => t.armed && t.kind === "audio");
    const g = ctx.createGain();
    ctx.createMediaStreamSource(stream).connect(g).connect(armed ? this.graph!.inputOf(armed.id) : this.graph!.master.input);
    this.monitorGain = g;
  }

  // ---- meters ------------------------------------------------------------------------------

  private meterBuf = new Float32Array(1024);
  level(node: AnalyserNode | undefined) {
    if (!node) return 0;
    const n = node.fftSize;
    if (this.meterBuf.length !== n) this.meterBuf = new Float32Array(n);
    node.getFloatTimeDomainData(this.meterBuf);
    let p = 0;
    for (let i = 0; i < n; i++) p = Math.max(p, Math.abs(this.meterBuf[i]));
    return p;
  }

  masterLevels(): [number, number] {
    const g = this.graph;
    if (!g) return [0, 0];
    return [this.level(g.master.meterL), this.level(g.master.meterR)];
  }

  trackLevel(id: string) {
    return this.level(this.graph?.tracks.get(id)?.meter);
  }

  dispose() {
    this.halt(false);
    this.unsub?.();
    this.keepAlive?.stop();
    void this.ctx?.close();
    this.ctx = null;
    this.graph = null;
  }
}

export const transport = new Transport();

/** Song seconds → beats with the project's tempo (used by the UI clock). */
export function formatTime(p: Project, beat: number) {
  const sec = Math.max(0, beatsToSec(p, beat));
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}

export function formatBars(p: Project, beat: number) {
  const b = Math.max(0, beat);
  const bar = Math.floor(b / p.sig) + 1;
  const beatIn = Math.floor(b % p.sig) + 1;
  const tick = Math.floor(((b % 1) * 4)) + 1;
  return `${bar}.${beatIn}.${tick}`;
}


/** Pre-renders every rendered-instrument note the open project uses, in idle time. */
export function warmProject(p: Project) {
  for (const t of p.tracks) {
    if (t.kind !== "instrument") continue;
    const pitches = new Set<number>();
    for (const c of Object.values(p.clips)) if (c.trackId === t.id) for (const n of c.notes ?? []) pitches.add(n.pitch);
    warmInBackground(t.instrument, pitches, t.tweaks);
  }
}
