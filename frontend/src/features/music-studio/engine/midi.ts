import type { Note, Project } from "../types";

/**
 * Standard MIDI files (type 1) in and out, plus Web MIDI keyboard input.
 * Export writes one track per instrument/drum track (drums on channel 10, as GM expects).
 */

const PPQ = 480;
const MELODIC_CHANNELS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15];

function varLen(n: number): number[] {
  const bytes = [n & 0x7f];
  n >>= 7;
  while (n > 0) {
    bytes.unshift((n & 0x7f) | 0x80);
    n >>= 7;
  }
  return bytes;
}

const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const u16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const text = (s: string) => Array.from(new TextEncoder().encode(s.slice(0, 120)));

export function exportMidi(project: Project): Blob {
  const tracks: number[][] = [];
  const tempo = Math.round(60_000_000 / project.bpm);
  // Conductor track: name, tempo, time signature.
  tracks.push([
    0, 0xff, 0x03, ...varLen(text(project.name).length), ...text(project.name),
    0, 0xff, 0x51, 0x03, (tempo >> 16) & 0xff, (tempo >> 8) & 0xff, tempo & 0xff,
    0, 0xff, 0x58, 0x04, project.sig, 2, 24, 8,
    0, 0xff, 0x2f, 0x00,
  ]);
  let melodic = 0;
  for (const t of project.tracks) {
    if (t.kind === "audio") continue;
    // Channel 10 (index 9) is reserved for drums in General MIDI.
    const ch = t.kind === "drums" ? 9 : MELODIC_CHANNELS[melodic++ % MELODIC_CHANNELS.length];
    const events: { tick: number; bytes: number[] }[] = [];
    for (const c of Object.values(project.clips)) {
      if (c.trackId !== t.id || c.muted) continue;
      for (const n of c.notes ?? []) {
        if (n.start >= c.length) continue;
        const on = Math.round((c.start + n.start) * PPQ);
        const off = Math.round((c.start + Math.min(c.length, n.start + n.length)) * PPQ);
        const vel = Math.max(1, Math.min(127, Math.round(n.velocity * 127)));
        events.push({ tick: on, bytes: [0x90 | ch, n.pitch & 0x7f, vel] });
        events.push({ tick: Math.max(on + 1, off), bytes: [0x80 | ch, n.pitch & 0x7f, 0] });
      }
    }
    // Note-offs before note-ons at the same tick, so repeated notes retrigger.
    events.sort((a, b) => a.tick - b.tick || (a.bytes[0] & 0xf0) - (b.bytes[0] & 0xf0));
    const data: number[] = [0, 0xff, 0x03, ...varLen(text(t.name).length), ...text(t.name)];
    let last = 0;
    for (const e of events) {
      data.push(...varLen(e.tick - last), ...e.bytes);
      last = e.tick;
    }
    data.push(0, 0xff, 0x2f, 0x00);
    tracks.push(data);
  }
  const bytes = [0x4d, 0x54, 0x68, 0x64, ...u32(6), ...u16(1), ...u16(tracks.length), ...u16(PPQ)];
  for (const t of tracks) bytes.push(0x4d, 0x54, 0x72, 0x6b, ...u32(t.length), ...t);
  return new Blob([new Uint8Array(bytes)], { type: "audio/midi" });
}

export type ParsedMidi = { bpm: number; sig: number; tracks: { name: string; drums: boolean; notes: Omit<Note, "id">[] }[] };

/** Reads a .mid file: tempo, time signature and every track's notes (in beats). */
export function parseMidi(buf: ArrayBuffer): ParsedMidi {
  const v = new DataView(buf);
  let p = 0;
  const str = (n: number) => String.fromCharCode(...new Uint8Array(buf, p, n));
  if (str(4) !== "MThd") throw new Error("That isn't a MIDI file.");
  const hlen = v.getUint32(4);
  const ntracks = v.getUint16(10);
  const division = v.getUint16(12);
  if (division & 0x8000) throw new Error("SMPTE-timed MIDI files aren't supported.");
  p = 8 + hlen;
  let bpm = 120;
  let sig = 4;
  const out: ParsedMidi["tracks"] = [];
  for (let t = 0; t < ntracks && p < buf.byteLength - 8; t++) {
    const id = str(4);
    const len = v.getUint32(p + 4);
    p += 8;
    const end = p + len;
    if (id !== "MTrk") {
      p = end;
      continue;
    }
    let tick = 0;
    let status = 0;
    let name = `Track ${t + 1}`;
    let drums = false;
    const open = new Map<string, { tick: number; vel: number }>();
    const notes: Omit<Note, "id">[] = [];
    const readVar = () => {
      let n = 0;
      let b: number;
      do {
        b = v.getUint8(p++);
        n = (n << 7) | (b & 0x7f);
      } while (b & 0x80 && p < end);
      return n;
    };
    while (p < end) {
      tick += readVar();
      let b = v.getUint8(p);
      if (b & 0x80) {
        status = b;
        p++;
      } else b = status;
      const type = status & 0xf0;
      const ch = status & 0x0f;
      if (status === 0xff) {
        const meta = v.getUint8(p++);
        const l = readVar();
        if (meta === 0x51 && l === 3) bpm = Math.round((60_000_000 / ((v.getUint8(p) << 16) | (v.getUint8(p + 1) << 8) | v.getUint8(p + 2))) * 10) / 10;
        else if (meta === 0x58 && l >= 1) sig = v.getUint8(p) || 4;
        else if (meta === 0x03 && l > 0) name = new TextDecoder().decode(new Uint8Array(buf, p, l)).trim() || name;
        p += l;
      } else if (status === 0xf0 || status === 0xf7) p += readVar();
      else if (type === 0x90 || type === 0x80) {
        const pitch = v.getUint8(p++);
        const vel = v.getUint8(p++);
        if (ch === 9) drums = true;
        const key = `${ch}:${pitch}`;
        if (type === 0x90 && vel > 0) open.set(key, { tick, vel });
        else {
          const o = open.get(key);
          if (o) {
            notes.push({ pitch, start: o.tick / division, length: Math.max(1 / 32, (tick - o.tick) / division), velocity: o.vel / 127 });
            open.delete(key);
          }
        }
      } else if (type === 0xc0 || type === 0xd0) p += 1;
      else p += 2;
    }
    p = end;
    if (notes.length) out.push({ name, drums, notes });
  }
  return { bpm, sig, tracks: out };
}

/** Live MIDI keyboards (Chrome, Edge, Opera, Android). Calls back with note on/off. */
export async function connectMidiInput(onNote: (pitch: number, velocity: number, on: boolean) => void): Promise<string[]> {
  const nav = navigator as Navigator & { requestMIDIAccess?: () => Promise<MIDIAccess> };
  if (!nav.requestMIDIAccess) throw new Error("This browser doesn't support MIDI keyboards (try Chrome or Edge).");
  const access = await nav.requestMIDIAccess();
  const names: string[] = [];
  const attach = () => {
    names.length = 0;
    access.inputs.forEach((input) => {
      names.push(input.name ?? "MIDI keyboard");
      input.onmidimessage = (e: MIDIMessageEvent) => {
        const d = e.data;
        if (!d || d.length < 3) return;
        const type = d[0] & 0xf0;
        if (type === 0x90 && d[2] > 0) onNote(d[1], d[2] / 127, true);
        else if (type === 0x80 || (type === 0x90 && d[2] === 0)) onNote(d[1], 0, false);
      };
    });
  };
  attach();
  access.onstatechange = attach;
  return names;
}

