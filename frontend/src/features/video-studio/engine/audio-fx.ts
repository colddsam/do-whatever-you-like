import { DEFAULT_AUDIO_FX } from "../constants";
import type { AudioFx, Clip } from "../types";

/**
 * Per-clip sound processing built from Web Audio nodes, so the same graph runs live (AudioContext,
 * fed by a <audio> element) and in the export (OfflineAudioContext): EQ, high/low cuts, compressor,
 * echo, reverb, pan and voice changers (pitch shift, ring modulation, band-limiting, distortion).
 *
 * The pitch shifter is the classic dual-delay-line design (Chris Wilson's "Jungle"): two delay lines
 * whose delay times ramp like a saw, crossfaded so the jumps never click. It needs no worklet.
 */

export const audioFxOf = (c: Pick<Clip, "audioFx">): AudioFx => ({ ...DEFAULT_AUDIO_FX, ...c.audioFx });

export function hasAudioFx(c: Pick<Clip, "audioFx">) {
  const f = audioFxOf(c);
  return !!(f.low || f.mid || f.high || f.highpass || f.lowpass || f.compressor || f.reverb || f.echo || f.pan || f.voice !== "none" || f.denoise);
}

/** A stable key: the live graph is rebuilt only when this changes. */
export const fxKey = (c: Pick<Clip, "audioFx">) => (hasAudioFx(c) ? JSON.stringify(audioFxOf(c)) : "");

/** Seconds of sound an effect keeps producing after its input stops (reverb, echo), for seamless windowed renders. */
export function fxTail(c: Pick<Clip, "audioFx">) {
  if (!hasAudioFx(c)) return 0;
  const f = audioFxOf(c);
  let tail = 0.2;
  if (f.reverb > 0 || f.voice === "hall") tail = Math.max(tail, 3.6);
  if (f.echo > 0 || f.voice === "echo") tail = Math.max(tail, 2.5);
  return tail;
}

export type FxChain = { input: AudioNode; output: AudioNode; dispose: () => void };

/* ---------- Building blocks ---------- */

const impulses = new Map<string, AudioBuffer>();
/** Synthetic room: decaying stereo noise (seeded, so every render of a project is identical). */
function impulse(sampleRate: number, seconds: number, decay: number) {
  const key = `${sampleRate}:${seconds}:${decay}`;
  let b = impulses.get(key);
  if (!b) {
    const len = Math.max(1, Math.round(seconds * sampleRate));
    b = new AudioBuffer({ length: len, numberOfChannels: 2, sampleRate });
    let s = 1234567;
    const rnd = () => {
      s = (Math.imul(s, 1103515245) + 12345) >>> 0;
      return s / 4294967296;
    };
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (rnd() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    impulses.set(key, b);
  }
  return b;
}

function shaperCurve(amount: number) {
  const n = 1024;
  const curve = new Float32Array(n);
  const k = amount;
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((3 + k) * x * 20 * (Math.PI / 180)) / (Math.PI + k * Math.abs(x));
  }
  return curve;
}

function biquad(ctx: BaseAudioContext, type: BiquadFilterType, freq: number, gain = 0, q = 0.707) {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.gain.value = gain;
  f.Q.value = q;
  return f;
}

/** Dual-delay-line pitch shifter. `mult` in -1..1: +1 ≈ ×1.5 (up a fifth), -0.5 ≈ ×0.75. */
function pitchShifter(ctx: BaseAudioContext, mult: number) {
  const bufferTime = 0.1;
  const fadeTime = 0.05;
  const delayTime = 0.1;
  const sr = ctx.sampleRate;
  const len1 = Math.round(bufferTime * sr);
  const len2 = Math.round((bufferTime - 2 * fadeTime) * sr);
  const len = len1 + len2;
  const ramp = (up: boolean) => {
    const b = ctx.createBuffer(1, len, sr);
    const p = b.getChannelData(0);
    for (let i = 0; i < len1; i++) p[i] = up ? (len1 - i) / len : i / len1;
    return b;
  };
  const fade = (() => {
    const b = ctx.createBuffer(1, len, sr);
    const p = b.getChannelData(0);
    const fl = fadeTime * sr;
    for (let i = 0; i < len1; i++) p[i] = i < fl ? Math.sqrt(i / fl) : i >= len1 - fl ? Math.sqrt(1 - (i - (len1 - fl)) / fl) : 1;
    return b;
  })();
  const input = ctx.createGain();
  const output = ctx.createGain();
  const up = mult > 0;
  const rampBuf = ramp(up);
  const sources: AudioBufferSourceNode[] = [];
  const start = (buf: AudioBuffer, at: number) => {
    const s = ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.start(at);
    sources.push(s);
    return s;
  };
  const t0 = ctx.currentTime + 0.01;
  const t1 = t0 + bufferTime - fadeTime;
  const lines = [t0, t1].map((at) => {
    const mod = start(rampBuf, at);
    const modGain = ctx.createGain();
    modGain.gain.value = 0.5 * delayTime * Math.abs(mult);
    mod.connect(modGain);
    const delay = ctx.createDelay(1);
    modGain.connect(delay.delayTime);
    const mix = ctx.createGain();
    mix.gain.value = 0;
    start(fade, at).connect(mix.gain);
    input.connect(delay);
    delay.connect(mix);
    mix.connect(output);
    return { modGain, delay, mix };
  });
  return {
    input,
    output,
    dispose: () => {
      for (const s of sources) {
        try {
          s.stop();
        } catch {
          /* never started */
        }
        s.disconnect();
      }
      for (const l of lines) {
        l.modGain.disconnect();
        l.delay.disconnect();
        l.mix.disconnect();
      }
      input.disconnect();
      output.disconnect();
    },
  };
}

/** Multiplies the signal by a low sine: the metallic "robot" sound. */
function ringMod(ctx: BaseAudioContext, freq: number, depth: number) {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const carrier = ctx.createGain();
  carrier.gain.value = 1 - depth;
  const osc = ctx.createOscillator();
  osc.frequency.value = freq;
  const amt = ctx.createGain();
  amt.gain.value = depth;
  osc.connect(amt).connect(carrier.gain);
  osc.start();
  input.connect(carrier).connect(output);
  return {
    input,
    output,
    dispose: () => {
      try {
        osc.stop();
      } catch {
        /* ignore */
      }
      osc.disconnect();
      amt.disconnect();
      carrier.disconnect();
      input.disconnect();
      output.disconnect();
    },
  };
}

/** A wobbling delay (pitch vibrato): the "underwater" warble. */
function vibrato(ctx: BaseAudioContext, rate: number, depth: number) {
  const delay = ctx.createDelay(0.1);
  delay.delayTime.value = 0.01;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = rate;
  const g = ctx.createGain();
  g.gain.value = depth;
  lfo.connect(g).connect(delay.delayTime);
  lfo.start();
  return {
    input: delay as AudioNode,
    output: delay as AudioNode,
    dispose: () => {
      try {
        lfo.stop();
      } catch {
        /* ignore */
      }
      lfo.disconnect();
      g.disconnect();
      delay.disconnect();
    },
  };
}

/* ---------- The chain ---------- */

export function buildChain(ctx: BaseAudioContext, f: AudioFx): FxChain {
  const nodes: AudioNode[] = [];
  const disposers: (() => void)[] = [];
  const input = ctx.createGain();
  let tail: AudioNode = input;
  const push = (n: AudioNode) => {
    tail.connect(n);
    tail = n;
    nodes.push(n);
  };
  const pushBlock = (b: { input: AudioNode; output: AudioNode; dispose: () => void }) => {
    tail.connect(b.input);
    tail = b.output;
    disposers.push(b.dispose);
  };

  if (f.denoise) {
    // Speech clean-up: cut rumble and hiss, tame boom, lift presence, even out the level.
    push(biquad(ctx, "highpass", 90));
    push(biquad(ctx, "lowshelf", 220, -2.5));
    push(biquad(ctx, "peaking", 3200, 2.5, 0.9));
    push(biquad(ctx, "lowpass", 11500));
  }
  if (f.highpass > 0) push(biquad(ctx, "highpass", f.highpass));
  if (f.lowpass > 0) push(biquad(ctx, "lowpass", f.lowpass));
  if (f.low) push(biquad(ctx, "lowshelf", 140, f.low));
  if (f.mid) push(biquad(ctx, "peaking", 1000, f.mid, 0.9));
  if (f.high) push(biquad(ctx, "highshelf", 5500, f.high));

  switch (f.voice) {
    case "chipmunk":
      pushBlock(pitchShifter(ctx, 1));
      break;
    case "deep":
      pushBlock(pitchShifter(ctx, -0.55));
      break;
    case "alien":
      pushBlock(pitchShifter(ctx, 0.6));
      pushBlock(ringMod(ctx, 38, 0.6));
      break;
    case "robot": {
      pushBlock(ringMod(ctx, 55, 0.85));
      const ws = ctx.createWaveShaper();
      ws.curve = shaperCurve(12);
      push(ws);
      break;
    }
    case "telephone": {
      push(biquad(ctx, "highpass", 420));
      push(biquad(ctx, "lowpass", 3200));
      const ws = ctx.createWaveShaper();
      ws.curve = shaperCurve(8);
      push(ws);
      break;
    }
    case "radio": {
      push(biquad(ctx, "highpass", 500));
      push(biquad(ctx, "lowpass", 4200));
      push(biquad(ctx, "peaking", 1600, 6, 1.2));
      const c = ctx.createDynamicsCompressor();
      c.threshold.value = -35;
      c.ratio.value = 12;
      push(c);
      break;
    }
    case "megaphone": {
      push(biquad(ctx, "highpass", 650));
      push(biquad(ctx, "lowpass", 3600));
      push(biquad(ctx, "peaking", 2000, 8, 1));
      const ws = ctx.createWaveShaper();
      ws.curve = shaperCurve(45);
      push(ws);
      break;
    }
    case "underwater":
      push(biquad(ctx, "lowpass", 480, 0, 1.5));
      pushBlock(vibrato(ctx, 3.5, 0.004));
      break;
  }

  if (f.compressor > 0) {
    const c = ctx.createDynamicsCompressor();
    c.threshold.value = -10 - 30 * f.compressor;
    c.ratio.value = 2 + 10 * f.compressor;
    c.knee.value = 12;
    c.attack.value = 0.005;
    c.release.value = 0.2;
    push(c);
    const makeup = ctx.createGain();
    makeup.gain.value = 1 + f.compressor * 1.2;
    push(makeup);
  }

  // Echo and reverb run in parallel with the dry signal.
  const echo = f.voice === "echo" ? Math.max(f.echo, 0.55) : f.echo;
  const reverb = f.voice === "hall" ? Math.max(f.reverb, 0.6) : f.reverb;
  if (echo > 0 || reverb > 0) {
    const out = ctx.createGain();
    tail.connect(out);
    if (echo > 0) {
      const d = ctx.createDelay(2);
      d.delayTime.value = 0.32;
      const fb = ctx.createGain();
      fb.gain.value = 0.25 + 0.4 * echo;
      const wet = ctx.createGain();
      wet.gain.value = 0.6 * echo;
      tail.connect(d);
      d.connect(fb).connect(d);
      d.connect(wet).connect(out);
      nodes.push(d, fb, wet);
    }
    if (reverb > 0) {
      const conv = ctx.createConvolver();
      conv.buffer = impulse(ctx.sampleRate, f.voice === "hall" ? 3.4 : 2.2, 2.6);
      const wet = ctx.createGain();
      wet.gain.value = 0.7 * reverb;
      tail.connect(conv);
      conv.connect(wet).connect(out);
      nodes.push(conv, wet);
    }
    tail = out;
    nodes.push(out);
  }
  if (f.pan) {
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, f.pan));
    push(p);
  }
  return {
    input,
    output: tail,
    dispose: () => {
      for (const d of disposers) d();
      for (const n of nodes) n.disconnect();
      input.disconnect();
    },
  };
}
