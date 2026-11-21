/**
 * A built-in sound-effects library, synthesised on this device with the Web Audio API (no downloads,
 * no licences to worry about): whooshes, risers, impacts, pops, dings, a camera shutter, typing,
 * the censor bleep and more. Each one renders in a few milliseconds to a WAV file that is added to
 * the project like any import.
 */

export type SfxId =
  | "whoosh"
  | "swoosh"
  | "riser"
  | "impact"
  | "boom"
  | "pop"
  | "click"
  | "ding"
  | "notify"
  | "shutter"
  | "typing"
  | "bleep"
  | "laser"
  | "heartbeat"
  | "kick"
  | "glitch"
  | "drop"
  | "chime";

export const SFX: { id: SfxId; label: string; hint: string; seconds: number }[] = [
  { id: "whoosh", label: "Whoosh", hint: "Fast air past the camera", seconds: 0.8 },
  { id: "swoosh", label: "Swoosh", hint: "A short swipe for text and transitions", seconds: 0.45 },
  { id: "riser", label: "Riser", hint: "Builds tension up to a cut", seconds: 2.5 },
  { id: "impact", label: "Impact", hint: "A cinematic hit", seconds: 1.6 },
  { id: "boom", label: "Sub boom", hint: "A deep low-end drop", seconds: 2.2 },
  { id: "pop", label: "Pop", hint: "For text and stickers appearing", seconds: 0.15 },
  { id: "click", label: "Click", hint: "A UI tap", seconds: 0.06 },
  { id: "ding", label: "Ding", hint: "A bright bell", seconds: 1.6 },
  { id: "notify", label: "Notification", hint: "Two-tone alert", seconds: 0.5 },
  { id: "shutter", label: "Camera shutter", hint: "For freeze frames and photos", seconds: 0.25 },
  { id: "typing", label: "Typing", hint: "Keyboard clatter for typewriter text", seconds: 2 },
  { id: "bleep", label: "Censor bleep", hint: "1 kHz tone to cover a word", seconds: 0.6 },
  { id: "laser", label: "Laser", hint: "A sci-fi zap", seconds: 0.35 },
  { id: "heartbeat", label: "Heartbeat", hint: "Lub-dub, twice", seconds: 1.8 },
  { id: "kick", label: "Kick drum", hint: "One punchy beat", seconds: 0.45 },
  { id: "glitch", label: "Glitch", hint: "Digital stutter", seconds: 0.6 },
  { id: "drop", label: "Bass drop", hint: "A falling sub sweep", seconds: 2.4 },
  { id: "chime", label: "Magic chime", hint: "Sparkly rising notes", seconds: 1.8 },
];

const RATE = 48_000;

function noiseBuffer(ctx: BaseAudioContext, seconds: number, seed = 7) {
  const len = Math.max(1, Math.round(seconds * ctx.sampleRate));
  const b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0);
  let s = seed;
  for (let i = 0; i < len; i++) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    d[i] = (s / 4294967296) * 2 - 1;
  }
  return b;
}

function env(g: AudioParam, at: number, attack: number, hold: number, release: number, peak = 1) {
  g.setValueAtTime(0, at);
  g.linearRampToValueAtTime(peak, at + attack);
  g.setValueAtTime(peak, at + attack + hold);
  g.exponentialRampToValueAtTime(0.0001, at + attack + hold + release);
}

function tone(ctx: BaseAudioContext, out: AudioNode, type: OscillatorType, f0: number, f1: number, at: number, dur: number, peak = 0.6, attack = 0.005) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, at);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), at + dur);
  const g = ctx.createGain();
  env(g.gain, at, attack, 0, Math.max(0.01, dur - attack), peak);
  o.connect(g).connect(out);
  o.start(at);
  o.stop(at + dur + 0.05);
}

function noise(ctx: BaseAudioContext, out: AudioNode, at: number, dur: number, filter: BiquadFilterType, f0: number, f1: number, peak: number, attack: number, q = 1, seed = 7) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, dur + 0.1, seed);
  const f = ctx.createBiquadFilter();
  f.type = filter;
  f.Q.value = q;
  f.frequency.setValueAtTime(f0, at);
  f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), at + dur);
  const g = ctx.createGain();
  env(g.gain, at, attack, 0, Math.max(0.01, dur - attack), peak);
  src.connect(f).connect(g).connect(out);
  src.start(at);
  src.stop(at + dur + 0.05);
}

function build(id: SfxId, ctx: OfflineAudioContext) {
  const out = ctx.createGain();
  out.gain.value = 0.9;
  out.connect(ctx.destination);
  switch (id) {
    case "whoosh":
      noise(ctx, out, 0, 0.8, "bandpass", 350, 3800, 0.9, 0.35, 1.2);
      break;
    case "swoosh":
      noise(ctx, out, 0, 0.45, "bandpass", 2500, 600, 0.8, 0.12, 1.5);
      break;
    case "riser":
      noise(ctx, out, 0, 2.5, "bandpass", 300, 6000, 0.6, 2.3, 2);
      tone(ctx, out, "sawtooth", 110, 880, 0, 2.5, 0.12, 2.3);
      break;
    case "impact":
      tone(ctx, out, "sine", 90, 38, 0, 1.6, 1, 0.003);
      noise(ctx, out, 0, 0.5, "lowpass", 4000, 200, 0.8, 0.002);
      break;
    case "boom":
      tone(ctx, out, "sine", 60, 28, 0, 2.2, 1, 0.01);
      tone(ctx, out, "triangle", 120, 40, 0, 0.6, 0.3, 0.005);
      break;
    case "pop":
      tone(ctx, out, "sine", 380, 1200, 0, 0.12, 0.8, 0.002);
      break;
    case "click":
      noise(ctx, out, 0, 0.05, "highpass", 2500, 2500, 0.8, 0.001);
      break;
    case "ding":
      for (const [f, a] of [[1320, 0.5], [2640, 0.18], [3960, 0.08], [1980, 0.12]] as const) tone(ctx, out, "sine", f, f, 0, 1.6, a, 0.002);
      break;
    case "notify":
      tone(ctx, out, "sine", 880, 880, 0, 0.18, 0.5);
      tone(ctx, out, "sine", 1320, 1320, 0.18, 0.3, 0.5);
      break;
    case "shutter":
      noise(ctx, out, 0, 0.06, "bandpass", 3200, 2400, 0.9, 0.001, 0.8, 3);
      noise(ctx, out, 0.09, 0.12, "bandpass", 2600, 1800, 0.7, 0.001, 0.8, 11);
      break;
    case "typing": {
      let t = 0;
      let k = 1;
      while (t < 1.9) {
        noise(ctx, out, t, 0.04, "bandpass", 1800 + ((k * 397) % 1400), 1500, 0.55, 0.001, 2, k);
        t += 0.06 + ((k * 7919) % 100) / 900;
        k++;
      }
      break;
    }
    case "bleep":
      tone(ctx, out, "sine", 1000, 1000, 0, 0.6, 0.5, 0.005);
      break;
    case "laser":
      tone(ctx, out, "square", 2200, 180, 0, 0.35, 0.25, 0.002);
      break;
    case "heartbeat":
      for (const at of [0, 0.85]) {
        tone(ctx, out, "sine", 70, 45, at, 0.18, 1, 0.005);
        tone(ctx, out, "sine", 60, 40, at + 0.22, 0.22, 0.75, 0.005);
      }
      break;
    case "kick":
      tone(ctx, out, "sine", 150, 45, 0, 0.45, 1, 0.002);
      noise(ctx, out, 0, 0.02, "highpass", 3000, 3000, 0.4, 0.001);
      break;
    case "glitch":
      for (let i = 0; i < 9; i++) tone(ctx, out, "square", 200 + ((i * 523) % 1700), 120 + ((i * 311) % 900), i * 0.06, 0.045, 0.22, 0.001);
      break;
    case "drop":
      tone(ctx, out, "sine", 110, 30, 0, 2.4, 1, 0.02);
      tone(ctx, out, "sawtooth", 55, 27, 0, 1.2, 0.12, 0.02);
      break;
    case "chime":
      [1047, 1319, 1568, 2093, 2637].forEach((f, i) => tone(ctx, out, "sine", f, f, i * 0.12, 1.2, 0.3, 0.003));
      break;
  }
}

/** 16-bit PCM WAV from an AudioBuffer. */
export function encodeWav(buf: AudioBuffer): Blob {
  const ch = buf.numberOfChannels;
  const len = buf.length;
  const data = new DataView(new ArrayBuffer(44 + len * ch * 2));
  const str = (o: number, s: string) => [...s].forEach((c, i) => data.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  data.setUint32(4, 36 + len * ch * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  data.setUint32(16, 16, true);
  data.setUint16(20, 1, true);
  data.setUint16(22, ch, true);
  data.setUint32(24, buf.sampleRate, true);
  data.setUint32(28, buf.sampleRate * ch * 2, true);
  data.setUint16(32, ch * 2, true);
  data.setUint16(34, 16, true);
  str(36, "data");
  data.setUint32(40, len * ch * 2, true);
  const chans = Array.from({ length: ch }, (_, i) => buf.getChannelData(i));
  let o = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < ch; c++) {
      const v = Math.max(-1, Math.min(1, chans[c][i]));
      data.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      o += 2;
    }
  }
  return new Blob([data.buffer], { type: "audio/wav" });
}

export async function renderSfx(id: SfxId): Promise<File> {
  const spec = SFX.find((s) => s.id === id)!;
  const ctx = new OfflineAudioContext(2, Math.round((spec.seconds + 0.15) * RATE), RATE);
  build(id, ctx);
  const buf = await ctx.startRendering();
  return new File([encodeWav(buf)], `${spec.label}.wav`, { type: "audio/wav" });
}
