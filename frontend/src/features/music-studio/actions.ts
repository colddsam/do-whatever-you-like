"use client";

import { strToU8, zipSync } from "fflate";
import { renderSfx, type SfxId } from "@/features/video-studio/engine/sfx";
import { MASTER_PRESETS, SAMPLE_RATE } from "./constants";
import { addAssetFile, addAssetPcm, loadBuffer } from "./engine/assets";
import { makeLoop, type LoopKind } from "./engine/composer";
import { highpass, hpss, lowpass, transcribeMelody } from "./engine/dsp";
import { durationOf, type Sel } from "./engine/edit";
import { encodeAudio, download, safeName, type ExportFormat } from "./engine/encode";
import { exportMidi, parseMidi } from "./engine/midi";
import { importPackage, openProject } from "./engine/persistence";
import { normalizeLoudness, renderProject, trimTail } from "./engine/render";
import { speakText } from "./engine/vocals";
import { MUSICGEN_RATE, musicGen } from "./engine/ai";
import * as P from "./lib/project";
import { snapToScale } from "./lib/theory";
import { getStudio, runJob } from "./store";
import type { AssetMeta, Clip, Pcm } from "./types";

/** Studio operations shared by the panels. Each one is a single undoable change. */

const st = getStudio;

function barAt(beat: number) {
  const sig = st().project.sig;
  return Math.max(0, Math.floor(beat / sig + 1e-6) * sig);
}

/** A track to put new audio on: the given one, the selected audio track, or a new one. */
function audioTrackFor(name: string, prefer?: string | null): string {
  const p = st().project;
  const pick = (id?: string | null) => p.tracks.find((t) => t.id === id && t.kind === "audio");
  const t = pick(prefer) ?? p.tracks.find((x) => x.kind === "audio" && x.name === name);
  return t ? t.id : st().addTrack("audio", { name });
}

/** Places audio on a track at a beat, sliding right past anything already there. */
export function placeAudio(meta: AssetMeta, trackId: string, at: number) {
  st().commit((p) => {
    const len = P.secToBeats(p, meta.duration);
    const start = P.freeSlot(p, trackId, at, len);
    return P.putClips({ ...p, assets: { ...p.assets, [meta.id]: meta } }, [P.makeClip(trackId, { name: meta.name, start, length: len, assetId: meta.id, offset: 0 })]);
  });
}

const AUDIO_EXT = /\.(wav|mp3|m4a|aac|ogg|oga|opus|flac|webm|weba|mp4|mov|mkv|avi|3gp|aif|aiff|caf|wma|amr)$/i;

export async function importFiles(files: File[], at?: number, trackId?: string | null) {
  for (const f of files) {
    const name = f.name.replace(/\.[^.]+$/, "");
    if (/\.(mid|midi)$/i.test(f.name)) {
      await runJob("import", `Reading ${f.name}`, async () => importMidiFile(f, at ?? barAt(st().playhead)));
      continue;
    }
    if (/\.(dwylsong|zip)$/i.test(f.name)) {
      await runJob("import", "Opening the project", async () => {
        const p = await importPackage(f);
        await openProject(p);
        st().notify(`Opened “${p.name}”.`, "success");
      });
      continue;
    }
    if (!f.type.startsWith("audio/") && !f.type.startsWith("video/") && !AUDIO_EXT.test(f.name)) {
      st().notify(`${f.name} isn't audio, video or MIDI.`, "warning");
      continue;
    }
    await runJob("import", `Adding ${f.name}`, async () => {
      if (f.size > 1024 * 1024 * 1024) throw new Error("Files up to 1 GB can be added.");
      const { meta } = await addAssetFile(f, name);
      const target = audioTrackFor(name, trackId ?? st().selectedTrack);
      placeAudio(meta, target, at ?? barAt(st().playhead));
      st().notify(`Added ${name} (${meta.duration.toFixed(1)} s).`, "success");
    });
  }
}

async function importMidiFile(f: File, at: number) {
  const parsed = parseMidi(await f.arrayBuffer());
  if (!parsed.tracks.length) throw new Error("That MIDI file has no notes.");
  const empty = !Object.keys(st().project.clips).length;
  st().commit((p) => {
    let q = empty ? { ...p, bpm: Math.round(parsed.bpm), sig: parsed.sig } : p;
    for (const t of parsed.tracks.slice(0, 24)) {
      const track = P.makeTrack(q, t.drums ? "drums" : "instrument", { name: t.name, instrument: t.drums ? "kit-acoustic" : "piano" });
      q = P.addTrack(q, track);
      const end = Math.max(...t.notes.map((n) => n.start + n.length));
      const len = Math.ceil(end / q.sig) * q.sig;
      q = P.putClips(q, [P.makeClip(track.id, { name: t.name, start: at, length: len, notes: t.notes.map((n) => P.newNote(n)) })]);
    }
    return q;
  });
  st().notify(`Imported ${parsed.tracks.length} MIDI track${parsed.tracks.length === 1 ? "" : "s"}.`, "success");
}

/** A generated loop at the playhead, on a matching track (made if needed). */
export function addLoop(kind: LoopKind, genre: string) {
  const p = st().project;
  const mode = p.scale === "minor" || p.scale === "harmonicMinor" || p.scale === "dorian" ? "minor" : "major";
  const loop = makeLoop(kind, genre, p.keyRoot, mode, Math.floor(Math.random() * 1e6));
  const name = `${genre.charAt(0).toUpperCase()}${genre.slice(1)} ${kind}`;
  let track = p.tracks.find((t) => t.kind === loop.trackKind && t.instrument === loop.instrument && t.name.endsWith(kind));
  const trackId = track?.id ?? st().addTrack(loop.trackKind, { name, instrument: loop.instrument });
  track = st().project.tracks.find((t) => t.id === trackId);
  const at = barAt(st().playhead);
  st().commit((q) => {
    const len = loop.bars * q.sig;
    const start = P.freeSlot(q, trackId, at, len);
    return P.putClips(q, [P.makeClip(trackId, { name, start, length: len, notes: loop.notes, swing: kind === "drums" ? 0.15 : undefined })]);
  });
  st().set({ selectedTrack: track?.id ?? trackId });
}

export async function addSfx(id: SfxId, label: string) {
  await runJob("sfx", `Making ${label}`, async () => {
    const { meta } = await addAssetFile(await renderSfx(id), label);
    placeAudio(meta, audioTrackFor("Sound effects"), st().playhead);
  });
}

export async function addVoice(text: string, voice: string, rate: number) {
  await runJob("tts", "Speaking", async () => {
    const { pcm } = await speakText(text.slice(0, 2400), voice, rate);
    const { meta } = await addAssetPcm({ sampleRate: SAMPLE_RATE, channels: [pcm, pcm.slice()] }, text.slice(0, 32));
    placeAudio(meta, audioTrackFor("Voice-over"), barAt(st().playhead));
    st().notify("Voice-over added at the playhead.", "success");
  });
}

/** 32 kHz MusicGen output → 48 kHz stereo asset on an "AI audio" track. */
export async function addMusicGen(prompt: string, seconds: number, onProgress: (f: number, label: string) => void) {
  const audio = await musicGen.generate(prompt, seconds, (p) => onProgress(p.stage === "download" ? (p.fraction ?? 0) * 0.5 : 0.5 + (p.fraction ?? 0) * 0.5, p.label));
  const src = new AudioBuffer({ length: audio.length, numberOfChannels: 1, sampleRate: MUSICGEN_RATE });
  src.copyToChannel(audio as Float32Array<ArrayBuffer>, 0);
  const off = new OfflineAudioContext(2, Math.ceil((audio.length * SAMPLE_RATE) / MUSICGEN_RATE), SAMPLE_RATE);
  const node = off.createBufferSource();
  node.buffer = src;
  node.connect(off.destination);
  node.start();
  const buf = await off.startRendering();
  const { meta } = await addAssetPcm(buf, prompt.slice(0, 40));
  placeAudio(meta, audioTrackFor("AI audio"), barAt(st().playhead));
  return buf;
}

// ---- destructive edits on a clip's audio --------------------------------------------------

export async function clipPcm(c: Clip): Promise<Pcm | null> {
  const buf = c.assetId ? await loadBuffer(c.assetId) : null;
  if (!buf) return null;
  return { sampleRate: buf.sampleRate, channels: Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i).slice()) };
}

/**
 * Runs an edit on the clip's file and swaps the clip onto the result (a new asset, so undo
 * brings the old audio back). The clip grows or shrinks by the change in length.
 */
export async function applyEdit(clipId: string, label: string, fn: (pcm: Pcm, sel: Sel | null) => Pcm | Promise<Pcm>) {
  await runJob("edit", label, async () => {
    const c = st().project.clips[clipId];
    if (!c?.assetId) throw new Error("Select an audio clip first.");
    const pcm = await clipPcm(c);
    if (!pcm) throw new Error("That clip's audio isn't loaded yet.");
    const sel = st().waveSel;
    // Let the progress label paint before the heavy work starts.
    await new Promise((r) => setTimeout(r, 30));
    const out = await fn(pcm, sel);
    const before = durationOf(pcm);
    const after = durationOf(out);
    if (after < 0.01) throw new Error("That would leave no audio.");
    const name = st().project.assets[c.assetId]?.name ?? c.name;
    const { meta } = await addAssetPcm(out, `${name.replace(/ \(edited\)$/, "")} (edited)`);
    st().commit((p) => {
      const q = { ...p, assets: { ...p.assets, [meta.id]: meta } };
      const cur = q.clips[clipId];
      if (!cur) return q;
      const offset = Math.min(cur.offset ?? 0, Math.max(0, after - 0.01));
      const grow = P.secToBeats(q, after - before);
      const length = Math.max(1 / 16, Math.min(P.secToBeats(q, after - offset), cur.length + grow));
      return P.updateClip(q, clipId, { assetId: meta.id, offset, length });
    });
    if (sel && Math.abs(after - before) > 1e-3) st().set({ waveSel: null });
  });
}

export async function bounceTrack(trackId: string) {
  await runJob("bounce", "Bouncing the track to audio", async (progress) => {
    const p = st().project;
    const t = p.tracks.find((x) => x.id === trackId);
    if (!t) return;
    const buf = trimTail(await renderProject(p, { only: trackId, onProgress: (f) => progress(f) }));
    const { meta } = await addAssetPcm(buf, `${t.name} (bounced)`);
    st().commit((q) => {
      const nt = P.makeTrack(q, "audio", { name: `${t.name} (audio)`, color: t.color });
      let r = P.addTrack(q, nt, q.tracks.findIndex((x) => x.id === trackId) + 1);
      r = { ...r, assets: { ...r.assets, [meta.id]: meta } };
      r = P.putClips(r, [P.makeClip(nt.id, { name: t.name, start: 0, length: P.secToBeats(r, meta.duration), assetId: meta.id, offset: 0 })]);
      return P.updateTrack(r, trackId, { mute: true });
    });
    st().notify(`${t.name} is now audio on a new track (the original is muted).`, "success");
  });
}

/**
 * Splits a clip into vocals, drums, bass and other: harmonic/percussive separation plus
 * centre-channel and frequency splits. Signal processing, not a neural network: good for
 * remixes, practice tracks and karaoke, not a perfect isolation.
 */
export async function splitStems(clipId: string) {
  await runJob("stems", "Splitting into stems", async (progress) => {
    const c = st().project.clips[clipId];
    if (!c?.assetId) throw new Error("Select an audio clip to split.");
    const pcm = await clipPcm(c);
    if (!pcm) throw new Error("That clip's audio isn't loaded yet.");
    const p = st().project;
    const sr = pcm.sampleRate;
    const a = Math.round((c.offset ?? 0) * sr);
    const b = Math.min(pcm.channels[0].length, a + Math.round(P.beatsToSec(p, c.length) * sr));
    if ((b - a) / sr > 600) throw new Error("Clips up to 10 minutes can be split. Split the clip first.");
    const chans = pcm.channels.slice(0, 2).map((x) => x.subarray(a, b));
    if (chans.length === 1) chans.push(chans[0]);
    progress(0.1, "Separating drums from tones");
    await new Promise((r) => setTimeout(r, 30));
    const { harmonic, percussive } = hpss(chans, sr);
    progress(0.6, "Finding the voice and the bass");
    await new Promise((r) => setTimeout(r, 30));
    const bass = harmonic.map((h) => lowpass(h, 170, sr));
    const midH = harmonic[0].map((v, i) => (v + harmonic[1][i]) / 2);
    const vocal = lowpass(highpass(midH, 180, sr), 7000, sr);
    const other = harmonic.map((h, ch) => h.map((v, i) => v - bass[ch][i] - vocal[i] * 0.9));
    const stems: [string, Float32Array[]][] = [
      ["Vocals", [vocal, vocal.slice()]],
      ["Drums", percussive],
      ["Bass", bass],
      ["Other", other],
    ];
    const metas: { name: string; meta: AssetMeta }[] = [];
    for (const [name, data] of stems) metas.push({ name, meta: (await addAssetPcm({ sampleRate: sr, channels: data }, `${c.name} · ${name}`)).meta });
    st().commit((q) => {
      let r = q;
      let idx = r.tracks.findIndex((t) => t.id === c.trackId) + 1;
      for (const { name, meta } of metas) {
        const t = P.makeTrack(r, "audio", { name: `${name} (stem)` });
        r = P.addTrack(r, t, idx++);
        r = { ...r, assets: { ...r.assets, [meta.id]: meta } };
        r = P.putClips(r, [P.makeClip(t.id, { name, start: c.start, length: c.length, assetId: meta.id, offset: 0 })]);
      }
      return P.updateClip(r, clipId, { muted: true });
    });
    st().notify("Stems added under the clip (the original is muted).", "success");
  });
}

/** Sung or hummed audio → a melody on a new instrument track. */
export async function humToMidi(clipId: string, opts: { snap: boolean; instrument: string }) {
  await runJob("hum", "Listening for the melody", async () => {
    const c = st().project.clips[clipId];
    if (!c?.assetId) throw new Error("Select a recording of you singing or humming.");
    const pcm = await clipPcm(c);
    if (!pcm) throw new Error("That clip's audio isn't loaded yet.");
    const p = st().project;
    const sr = pcm.sampleRate;
    const a = Math.round((c.offset ?? 0) * sr);
    const b = Math.min(pcm.channels[0].length, a + Math.round(P.beatsToSec(p, c.length) * sr));
    const mono = pcm.channels[0].subarray(a, b);
    const notes = transcribeMelody(mono, sr);
    if (!notes.length) throw new Error("No clear melody was heard. Sing or hum one note at a time, close to the mic.");
    const beat = P.spb(p);
    const mapped = notes.map((n) => {
      const start = Math.round((n.start / beat) * 4) / 4;
      const length = Math.max(0.25, Math.round((n.length / beat) * 4) / 4);
      return P.newNote({ pitch: opts.snap ? snapToScale(n.pitch, p.keyRoot, p.scale) : n.pitch, start, length, velocity: n.velocity });
    });
    st().commit((q) => {
      const t = P.makeTrack(q, "instrument", { name: "Hummed melody", instrument: opts.instrument });
      const r = P.addTrack(q, t, q.tracks.findIndex((x) => x.id === c.trackId) + 1);
      return P.putClips(r, [P.makeClip(t.id, { name: "Hummed melody", start: c.start, length: c.length, notes: mapped })]);
    });
    st().notify(`Heard ${mapped.length} notes. They're on a new track.`, "success");
  });
}

export function setDuck(trackId: string, source: string | null, amount = 12) {
  st().updateTrack(trackId, { duck: source ? { source, amount } : null });
}

/** Podcast "auto-mix": every music track ducks under the first voice track. */
export function autoDuckAll(amount = 14) {
  const p = st().project;
  const voices = p.tracks.filter((t) => t.kind === "audio" && /host|voice|narrat|guest|vocal|speech|mic|record/i.test(t.name));
  const source = voices[0] ?? p.tracks.find((t) => t.armed && t.kind === "audio");
  if (!source) return st().notify("Name a track Host, Voice or Narration (or arm it) so the music knows what to duck under.", "info");
  let n = 0;
  st().commit((q) => {
    let r = q;
    for (const t of q.tracks) {
      if (t.id === source.id || voices.some((v) => v.id === t.id)) continue;
      r = P.updateTrack(r, t.id, { duck: { source: source.id, amount } });
      n++;
    }
    return r;
  });
  st().notify(n ? `${n} track${n === 1 ? "" : "s"} will dip under “${source.name}”.` : "There's no music track to duck yet.", n ? "success" : "info");
}

export function applyMasterPreset(id: string) {
  const preset = MASTER_PRESETS.find((m) => m.id === id);
  if (!preset) return;
  st().commit((p) => ({ ...p, master: { ...p.master, fx: preset.chain.map((f) => P.makeEffect(f.type, f.params)), lufs: preset.lufs } }));
  st().notify(`Mastered with “${preset.label}” (export aims for ${preset.lufs} LUFS).`, "success");
}

// ---- export -------------------------------------------------------------------------------

export type ExportOptions = { format: ExportFormat; kbps: number; range: "song" | "loop"; normalize: boolean; stems: boolean; midi: boolean };

export async function exportSong(o: ExportOptions) {
  return runJob("export", "Exporting", async (progress) => {
    const p = st().project;
    const range = o.range === "loop" && p.loop.end > p.loop.start ? { from: p.loop.start, to: p.loop.end } : {};
    const fmt = o.format;
    const ext = fmt.startsWith("wav") ? "wav" : fmt;
    const base = safeName(p.name);
    const finish = async (buf: AudioBuffer) => {
      let out = o.range === "loop" ? buf : trimTail(buf);
      if (o.normalize) out = normalizeLoudness(out, p.master.lufs ?? -14).buffer;
      return encodeAudio(out, fmt, o.kbps);
    };
    if (o.stems) {
      const files: Record<string, Uint8Array> = {};
      const audible = p.tracks.filter((t) => !t.mute && Object.values(p.clips).some((c) => c.trackId === t.id && !c.muted));
      for (let i = 0; i < audible.length; i++) {
        const t = audible[i];
        progress(i / (audible.length + 1), `Rendering stem ${i + 1} of ${audible.length}: ${t.name}`);
        const buf = await renderProject(p, { ...range, only: t.id });
        const blob = await encodeAudio(buf, fmt, o.kbps);
        files[`${String(i + 1).padStart(2, "0")} ${safeName(t.name)}.${ext}`] = new Uint8Array(await blob.arrayBuffer());
      }
      progress(audible.length / (audible.length + 1), "Rendering the full mix");
      files[`${base} (mix).${ext}`] = new Uint8Array(await (await finish(await renderProject(p, range))).arrayBuffer());
      if (o.midi) files[`${base}.mid`] = new Uint8Array(await exportMidi(p).arrayBuffer());
      files["README.txt"] = strToU8(`${p.name}\n${p.bpm} BPM\nStems start at the same moment, so they line up when imported into any DAW.\n`);
      download(new Blob([zipSync(files, { level: 0 }) as Uint8Array<ArrayBuffer>], { type: "application/zip" }), `${base} (stems).zip`);
    } else {
      progress(0, "Rendering the mix");
      const buf = await renderProject(p, { ...range, onProgress: (f) => progress(f * 0.85, "Rendering the mix") });
      progress(0.88, fmt.startsWith("wav") ? "Writing the file" : "Encoding");
      download(await finish(buf), `${base}.${ext}`);
      if (o.midi) download(exportMidi(p), `${base}.mid`);
    }
    st().notify("Exported. Check your downloads.", "success");
    return true;
  });
}

/** Renders the song to an AudioBuffer (for previews and the mastering meter). */
export async function renderMix() {
  return renderProject(st().project, {});
}

export const midiFile = () => exportMidi(st().project);

