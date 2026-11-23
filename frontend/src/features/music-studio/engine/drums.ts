import { highpass, lowpass } from "./dsp";

/**
 * Drum kits synthesised in JavaScript (no samples to download or license): each hit is computed
 * once per kit and cached as an AudioBuffer, then played like a sample. General MIDI numbers pick
 * the drum: 36 kick, 37 rim, 38 snare, 39 clap, 42/46 hats, 45/48 toms, 49 crash, 51 ride,
 * 56 cowbell, 70 shaker. Any other note falls back to the nearest of those.
 */

export const KITS: { id: string; label: string; hint: string }[] = [
  { id: "kit-808", label: "808", hint: "Hip-hop & pop classic" },
  { id: "kit-trap", label: "Trap", hint: "Long boomy kick, crisp hats" },
  { id: "kit-house", label: "House", hint: "Four-on-the-floor punch" },
  { id: "kit-electro", label: "Electro / 909", hint: "EDM & synthwave" },
  { id: "kit-acoustic", label: "Acoustic", hint: "A real-sounding studio kit" },
  { id: "kit-rock", label: "Rock", hint: "Big snare and room" },
  { id: "kit-lofi", label: "Lo-fi", hint: "Dusty and soft" },
];

export const isKit = (id: string) => id.startsWith("kit-");

/** Loudness calibration (dB): a standard groove on each kit lands at −18 LUFS. */
const KIT_LEVEL: Record<string, number> = { "kit-808": -11.3, "kit-trap": -19.7, "kit-house": -11, "kit-electro": -12.2, "kit-acoustic": -4.1, "kit-rock": -9.6, "kit-lofi": -8.8 };

const SR = 44_100;
const cache = new Map<string, AudioBuffer>();

type KitParams = {
  kickHz: number;
  kickEnd: number;
  kickDecay: number;
  kickClick: number;
  snareTone: number;
  snareNoise: number;
  snareDecay: number;
  hatDecay: number;
  hatTone: number;
  drive: number;
  lofi: boolean;
  room: number;
};

const PARAMS: Record<string, KitParams> = {
  "kit-808": { kickHz: 150, kickEnd: 48, kickDecay: 0.55, kickClick: 0.25, snareTone: 0.45, snareNoise: 0.7, snareDecay: 0.18, hatDecay: 0.05, hatTone: 8000, drive: 0.1, lofi: false, room: 0 },
  "kit-trap": { kickHz: 120, kickEnd: 42, kickDecay: 1.2, kickClick: 0.35, snareTone: 0.3, snareNoise: 0.9, snareDecay: 0.16, hatDecay: 0.035, hatTone: 9500, drive: 0.35, lofi: false, room: 0 },
  "kit-house": { kickHz: 170, kickEnd: 52, kickDecay: 0.38, kickClick: 0.5, snareTone: 0.4, snareNoise: 0.8, snareDecay: 0.17, hatDecay: 0.045, hatTone: 9000, drive: 0.2, lofi: false, room: 0.05 },
  "kit-electro": { kickHz: 200, kickEnd: 50, kickDecay: 0.42, kickClick: 0.6, snareTone: 0.5, snareNoise: 0.85, snareDecay: 0.2, hatDecay: 0.05, hatTone: 8500, drive: 0.25, lofi: false, room: 0.05 },
  "kit-acoustic": { kickHz: 110, kickEnd: 58, kickDecay: 0.32, kickClick: 0.7, snareTone: 0.35, snareNoise: 1, snareDecay: 0.22, hatDecay: 0.07, hatTone: 7000, drive: 0, lofi: false, room: 0.15 },
  "kit-rock": { kickHz: 120, kickEnd: 55, kickDecay: 0.38, kickClick: 0.8, snareTone: 0.45, snareNoise: 1, snareDecay: 0.3, hatDecay: 0.08, hatTone: 6500, drive: 0.15, lofi: false, room: 0.3 },
  "kit-lofi": { kickHz: 120, kickEnd: 50, kickDecay: 0.35, kickClick: 0.2, snareTone: 0.4, snareNoise: 0.6, snareDecay: 0.16, hatDecay: 0.04, hatTone: 6000, drive: 0.1, lofi: true, room: 0.1 },
};

const KNOWN = [36, 37, 38, 39, 42, 45, 46, 48, 49, 51, 56, 70];
export const drumFor = (pitch: number) => KNOWN.reduce((a, b) => (Math.abs(b - pitch) < Math.abs(a - pitch) ? b : a), 36);

function noise(len: number, seed: number) {
  const out = new Float32Array(len);
  let s = seed >>> 0 || 1;
  for (let i = 0; i < len; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out[i] = (s / 4294967296) * 2 - 1;
  }
  return out;
}

const env = (i: number, decay: number) => Math.exp(-i / (decay * SR));
const bandpass = (x: Float32Array, f: number) => highpass(lowpass(x, f * 1.5, SR), f / 1.5, SR);

/** A falling-pitch sine (kicks and toms), phase-accumulated so the sweep is smooth. */
function sweep(seconds: number, from: number, to: number, pitchDecay: number, ampDecay: number) {
  const len = Math.round(seconds * SR);
  const out = new Float32Array(len);
  let phase = 0;
  for (let i = 0; i < len; i++) {
    const f = to + (from - to) * Math.exp(-i / (pitchDecay * SR));
    phase += (2 * Math.PI * f) / SR;
    out[i] = Math.sin(phase) * env(i, ampDecay);
  }
  return out;
}

/** Six detuned square waves at inharmonic ratios: the classic 808 metal for hats and cymbals. */
function metal(seconds: number, base: number) {
  const len = Math.round(seconds * SR);
  const out = new Float32Array(len);
  const ratios = [2, 3, 4.16, 5.43, 6.79, 8.21];
  for (const r of ratios) {
    const f = base * r;
    for (let i = 0; i < len; i++) out[i] += Math.sign(Math.sin((2 * Math.PI * f * i) / SR)) / ratios.length;
  }
  return out;
}

function synth(kit: string, drum: number): Float32Array {
  const k = PARAMS[kit] ?? PARAMS["kit-808"];
  let out: Float32Array;
  switch (drum) {
    case 36: {
      out = sweep(k.kickDecay * 3, k.kickHz * 2.2, k.kickEnd, 0.03, k.kickDecay);
      const click = highpass(noise(Math.round(0.01 * SR), 3), 2000, SR);
      for (let i = 0; i < click.length; i++) out[i] += click[i] * k.kickClick * env(i, 0.002);
      break;
    }
    case 38: {
      const len = Math.round(k.snareDecay * 4 * SR);
      const tone = sweep(len / SR, 260, 180, 0.02, k.snareDecay * 0.6);
      const tone2 = sweep(len / SR, 380, 330, 0.02, k.snareDecay * 0.4);
      const n = highpass(noise(len, 7), 1500, SR);
      out = new Float32Array(len);
      for (let i = 0; i < len; i++) out[i] = k.snareTone * (tone[i] + 0.5 * tone2[i]) + k.snareNoise * n[i] * env(i, k.snareDecay);
      break;
    }
    case 39: {
      const len = Math.round(0.5 * SR);
      const n = bandpass(noise(len, 11), 1300);
      out = new Float32Array(len);
      // Several hands a few milliseconds apart, then the room.
      for (let i = 0; i < len; i++) {
        const t = i / SR;
        let e = 0;
        for (const off of [0, 0.011, 0.022]) if (t >= off) e = Math.max(e, Math.exp(-(t - off) / 0.006));
        if (t >= 0.031) e = Math.max(e, 0.9 * Math.exp(-(t - 0.031) / 0.12));
        out[i] = n[i] * e * 1.6;
      }
      break;
    }
    case 37: {
      const len = Math.round(0.12 * SR);
      out = new Float32Array(len);
      const n = highpass(noise(len, 5), 3000, SR);
      for (let i = 0; i < len; i++) out[i] = (Math.sin((2 * Math.PI * 1700 * i) / SR) * 0.6 + n[i] * 0.4) * env(i, 0.012);
      break;
    }
    case 42:
    case 46:
    case 70: {
      const decay = drum === 42 ? k.hatDecay : drum === 46 ? k.hatDecay * 6 : 0.06;
      const len = Math.round(decay * 6 * SR);
      const m = drum === 70 ? noise(len, 9) : metal(len / SR, 40);
      const n = noise(len, 13);
      const mixed = new Float32Array(len);
      for (let i = 0; i < len; i++) mixed[i] = m[i] * 0.6 + n[i] * 0.4;
      const hp = highpass(mixed, drum === 70 ? 5000 : k.hatTone, SR);
      out = new Float32Array(len);
      for (let i = 0; i < len; i++) {
        // The shaker swells in slightly; hats strike instantly.
        const attack = drum === 70 ? Math.min(1, i / (0.012 * SR)) : 1;
        out[i] = hp[i] * env(i, decay) * attack * 1.4;
      }
      break;
    }
    case 45:
    case 48: {
      const f = drum === 45 ? 110 : 170;
      out = sweep(1, f * 1.6, f, 0.05, 0.28);
      const n = bandpass(noise(out.length, 17), f * 4);
      for (let i = 0; i < out.length; i++) out[i] += n[i] * 0.2 * env(i, 0.04);
      break;
    }
    case 49:
    case 51: {
      const crash = drum === 49;
      const len = Math.round((crash ? 2.6 : 1.6) * SR);
      const m = metal(len / SR, crash ? 55 : 70);
      const n = noise(len, crash ? 19 : 23);
      out = new Float32Array(len);
      for (let i = 0; i < len; i++) out[i] = (m[i] * (crash ? 0.4 : 0.7) + n[i] * (crash ? 0.6 : 0.3)) * env(i, crash ? 0.7 : 0.45);
      out = highpass(out, crash ? 4000 : 5500, SR);
      if (!crash) for (let i = 0; i < len; i++) out[i] += Math.sin((2 * Math.PI * 3400 * i) / SR) * 0.15 * env(i, 0.3);
      break;
    }
    case 56: {
      const len = Math.round(0.5 * SR);
      out = new Float32Array(len);
      for (let i = 0; i < len; i++) out[i] = (Math.sign(Math.sin((2 * Math.PI * 540 * i) / SR)) + Math.sign(Math.sin((2 * Math.PI * 800 * i) / SR))) * 0.5 * (0.7 * env(i, 0.02) + 0.3 * env(i, 0.12));
      out = bandpass(out, 800);
      break;
    }
    default:
      out = new Float32Array(1);
  }
  if (k.room > 0) {
    // A short diffuse tail standing in for the room the kit was recorded in.
    const tail = Math.round(0.35 * SR);
    const res = new Float32Array(out.length + tail);
    res.set(out);
    const n = lowpass(noise(tail + out.length, 29), 5000, SR);
    let acc = 0;
    for (let i = 0; i < res.length; i++) {
      acc = acc * 0.995 + Math.abs(out[i] ?? 0) * 0.005;
      res[i] += n[i] * acc * k.room * 2;
    }
    out = res;
  }
  if (k.drive > 0) {
    const d = 1 + k.drive * 6;
    for (let i = 0; i < out.length; i++) out[i] = Math.tanh(out[i] * d) / Math.tanh(d);
  }
  if (k.lofi) {
    out = lowpass(out, 5000, SR);
    const steps = 2 ** 9;
    for (let i = 0; i < out.length; i++) out[i] = Math.round(out[i] * steps) / steps;
  }
  let p = 0;
  for (let i = 0; i < out.length; i++) p = Math.max(p, Math.abs(out[i]));
  const level = drum === 36 ? 0.95 : drum === 38 || drum === 39 ? 0.75 : drum === 42 || drum === 70 ? 0.35 : drum === 46 ? 0.32 : drum === 49 || drum === 51 ? 0.3 : 0.6;
  if (p > 0) for (let i = 0; i < out.length; i++) out[i] *= level / p;
  return out;
}

export function drumBuffer(kit: string, pitch: number): AudioBuffer {
  const drum = drumFor(pitch);
  const key = `${kit}:${drum}`;
  let b = cache.get(key);
  if (!b) {
    const data = synth(kit, drum);
    b = new AudioBuffer({ length: Math.max(1, data.length), numberOfChannels: 1, sampleRate: SR });
    b.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
    cache.set(key, b);
  }
  return b;
}

/** Plays one drum hit; the source and gain come back so the caller can choke an open hat. */
export function playDrum(ctx: BaseAudioContext, dest: AudioNode, kit: string, pitch: number, when: number, velocity: number) {
  const src = ctx.createBufferSource();
  src.buffer = drumBuffer(kit, pitch);
  const g = ctx.createGain();
  g.gain.value = (0.15 + 0.85 * Math.max(0, Math.min(1, velocity)) ** 1.3) * 10 ** ((KIT_LEVEL[kit] ?? -10) / 20);
  src.connect(g).connect(dest);
  src.start(when);
  src.onended = () => {
    src.disconnect();
    g.disconnect();
  };
  return { src, gain: g };
}
