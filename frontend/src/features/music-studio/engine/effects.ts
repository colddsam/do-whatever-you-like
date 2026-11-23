import { effectDef } from "../constants";
import type { Effect } from "../types";
import { driveCurve } from "./instruments";

/**
 * The effects rack, built from native Web Audio nodes so it runs the same live and in the offline
 * export. Each unit updates its parameters in place (no rebuild, no click) while you drag a knob.
 */

type Unit = { input: AudioNode; output: AudioNode; set: (p: Record<string, number>, bpm: number) => void; dispose: () => void };

const db = (v: number) => 10 ** (v / 20);

/**
 * DynamicsCompressorNode (Chromium, Firefox and WebKit share the code) quietly adds make-up gain:
 * 0.6 × the reduction it would apply to a full-scale signal. Undo it, so a compressor's "Makeup"
 * and a limiter's "Input gain" mean exactly what they say.
 */
const autoMakeupDb = (threshold: number, ratio: number) => 0.6 * -threshold * (1 - 1 / Math.max(1, ratio));

const irCache = new Map<string, AudioBuffer>();
function impulse(ctx: BaseAudioContext, size: number, damp: number) {
  const key = `${ctx.sampleRate}:${size.toFixed(1)}:${Math.round(damp / 500)}`;
  let ir = irCache.get(key);
  if (ir) return ir;
  const sr = ctx.sampleRate;
  const len = Math.max(1, Math.round(size * sr));
  ir = new AudioBuffer({ length: len, numberOfChannels: 2, sampleRate: sr });
  for (let c = 0; c < 2; c++) {
    const d = new Float32Array(len);
    let s = (c + 1) * 7919;
    let lp = 0;
    for (let i = 0; i < len; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      const n = (s / 4294967296) * 2 - 1;
      const t = i / sr;
      // High frequencies die away faster than lows, like air and soft walls.
      const cutoff = Math.max(200, damp * Math.exp(-t / (size * 0.6)));
      const a = Math.exp((-2 * Math.PI * cutoff) / sr);
      lp = lp * a + n * (1 - a);
      d[i] = lp * Math.exp((-6.9 * t) / size) * (i < sr * 0.002 ? i / (sr * 0.002) : 1);
    }
    ir.copyToChannel(d, c);
  }
  irCache.set(key, ir);
  return ir;
}

function dryWet(ctx: BaseAudioContext) {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  input.connect(dry).connect(output);
  wet.connect(output);
  const mix = (m: number) => {
    // Equal-power crossfade keeps the level steady across the knob.
    dry.gain.value = Math.cos((m * Math.PI) / 2);
    wet.gain.value = Math.sin((m * Math.PI) / 2);
  };
  return { input, output, wet, mix, nodes: [input, output, dry, wet] as AudioNode[] };
}

const crushCache = new Map<number, Float32Array<ArrayBuffer>>();
function crushCurve(bits: number) {
  let c = crushCache.get(bits);
  if (!c) {
    const steps = 2 ** (bits - 1);
    c = new Float32Array(8192);
    for (let i = 0; i < c.length; i++) {
      const x = (i / (c.length - 1)) * 2 - 1;
      c[i] = Math.round(x * steps) / steps;
    }
    crushCache.set(bits, c);
  }
  return c;
}

/** A WaveShaper curve spans inputs −1…1 (louder input holds the end values), so it's built over that range. */
function softClip(ceiling: number) {
  const c = new Float32Array(4096);
  const lim = db(ceiling);
  for (let i = 0; i < c.length; i++) {
    const x = (i / (c.length - 1)) * 2 - 1;
    c[i] = Math.abs(x) < lim * 0.9 ? x : Math.sign(x) * (lim * 0.9 + lim * 0.1 * Math.tanh((Math.abs(x) - lim * 0.9) / (lim * 0.1)));
  }
  return c;
}

function makeUnit(ctx: BaseAudioContext, fx: Effect): Unit {
  const all: AudioNode[] = [];
  const keep = <T extends AudioNode>(n: T) => {
    all.push(n);
    return n;
  };
  const stopList: (OscillatorNode | AudioScheduledSourceNode)[] = [];
  const lfo = (rate: number) => {
    const o = keep(ctx.createOscillator());
    o.frequency.value = rate;
    o.start();
    stopList.push(o);
    return o;
  };
  const dispose = () => {
    for (const s of stopList) {
      try {
        s.stop();
      } catch {
        /* never started */
      }
    }
    for (const n of all) n.disconnect();
  };

  switch (fx.type) {
    case "eq": {
      const cut = keep(ctx.createBiquadFilter());
      cut.type = "highpass";
      const low = keep(ctx.createBiquadFilter());
      low.type = "lowshelf";
      low.frequency.value = 200;
      const mid = keep(ctx.createBiquadFilter());
      mid.type = "peaking";
      mid.Q.value = 0.8;
      const high = keep(ctx.createBiquadFilter());
      high.type = "highshelf";
      high.frequency.value = 6000;
      cut.connect(low).connect(mid).connect(high);
      return {
        input: cut,
        output: high,
        set: (p) => {
          cut.frequency.value = p.lowCut ?? 20;
          low.gain.value = p.low ?? 0;
          mid.gain.value = p.mid ?? 0;
          mid.frequency.value = p.midFreq ?? 1000;
          high.gain.value = p.high ?? 0;
        },
        dispose,
      };
    }
    case "compressor": {
      const c = keep(ctx.createDynamicsCompressor());
      const g = keep(ctx.createGain());
      c.connect(g);
      return {
        input: c,
        output: g,
        set: (p) => {
          c.threshold.value = p.threshold ?? -18;
          c.ratio.value = p.ratio ?? 4;
          c.attack.value = p.attack ?? 0.01;
          c.release.value = p.release ?? 0.2;
          c.knee.value = 6;
          g.gain.value = db((p.makeup ?? 0) - autoMakeupDb(p.threshold ?? -18, p.ratio ?? 4));
        },
        dispose,
      };
    }
    case "limiter": {
      const pre = keep(ctx.createGain());
      const c = keep(ctx.createDynamicsCompressor());
      const trim = keep(ctx.createGain());
      const clip = keep(ctx.createWaveShaper());
      pre.connect(c).connect(trim).connect(clip);
      let ceiling = NaN;
      return {
        input: pre,
        output: clip,
        set: (p) => {
          pre.gain.value = db(p.gain ?? 0);
          const ce = p.ceiling ?? -1;
          c.threshold.value = ce - 2;
          c.knee.value = 0;
          c.ratio.value = 20;
          c.attack.value = 0.002;
          c.release.value = 0.1;
          trim.gain.value = db(-autoMakeupDb(ce - 2, 20));
          if (ce !== ceiling) {
            ceiling = ce;
            clip.curve = softClip(ce);
          }
        },
        dispose,
      };
    }
    case "reverb": {
      const dw = dryWet(ctx);
      dw.nodes.forEach(keep);
      const pre = keep(ctx.createDelay(0.5));
      const conv = keep(ctx.createConvolver());
      dw.input.connect(pre).connect(conv).connect(dw.wet);
      let last = "";
      return {
        input: dw.input,
        output: dw.output,
        set: (p) => {
          dw.mix(p.mix ?? 0.25);
          pre.delayTime.value = p.predelay ?? 0.02;
          const key = `${(p.size ?? 2.2).toFixed(1)}:${Math.round((p.damp ?? 7000) / 500)}`;
          if (key !== last) {
            last = key;
            conv.buffer = impulse(ctx, p.size ?? 2.2, p.damp ?? 7000);
          }
        },
        dispose,
      };
    }
    case "delay": {
      const dw = dryWet(ctx);
      dw.nodes.forEach(keep);
      const merge = keep(ctx.createChannelMerger(2));
      const dl = keep(ctx.createDelay(4));
      const dr = keep(ctx.createDelay(4));
      const fl = keep(ctx.createGain());
      const fr = keep(ctx.createGain());
      const tone = keep(ctx.createBiquadFilter());
      tone.type = "lowpass";
      dw.input.connect(tone);
      merge.connect(dw.wet);
      let pingpong = -1;
      return {
        input: dw.input,
        output: dw.output,
        set: (p, bpm) => {
          dw.mix(p.mix ?? 0.25);
          const t = Math.min(3.9, ((p.beats ?? 0.75) * 60) / bpm);
          dl.delayTime.value = t;
          dr.delayTime.value = t;
          tone.frequency.value = p.tone ?? 5000;
          fl.gain.value = p.feedback ?? 0.35;
          fr.gain.value = p.feedback ?? 0.35;
          const pp = p.pingpong ? 1 : 0;
          if (pp === pingpong) return;
          pingpong = pp;
          for (const n of [tone, dl, dr, fl, fr]) n.disconnect();
          tone.connect(dl);
          dl.connect(merge, 0, 0);
          dr.connect(merge, 0, 1);
          if (pp) {
            // Ping-pong: the echo crosses left → right → left.
            dl.connect(fl).connect(dr);
            dr.connect(fr).connect(dl);
          } else {
            tone.connect(dr);
            dl.connect(fl).connect(dl);
            dr.connect(fr).connect(dr);
          }
        },
        dispose,
      };
    }
    case "chorus": {
      const dw = dryWet(ctx);
      dw.nodes.forEach(keep);
      const merge = keep(ctx.createChannelMerger(2));
      const dl = keep(ctx.createDelay(0.1));
      const dr = keep(ctx.createDelay(0.1));
      const osc = lfo(0.8);
      const gl = keep(ctx.createGain());
      const gr = keep(ctx.createGain());
      osc.connect(gl).connect(dl.delayTime);
      osc.connect(gr).connect(dr.delayTime);
      dw.input.connect(dl);
      dw.input.connect(dr);
      dl.connect(merge, 0, 0);
      dr.connect(merge, 0, 1);
      merge.connect(dw.wet);
      return {
        input: dw.input,
        output: dw.output,
        set: (p) => {
          dw.mix(p.mix ?? 0.4);
          osc.frequency.value = p.rate ?? 0.8;
          const depth = (p.depth ?? 0.4) * 0.006;
          dl.delayTime.value = 0.018;
          dr.delayTime.value = 0.022;
          gl.gain.value = depth;
          gr.gain.value = -depth;
        },
        dispose,
      };
    }
    case "phaser": {
      const dw = dryWet(ctx);
      dw.nodes.forEach(keep);
      const stages = Array.from({ length: 6 }, () => {
        const f = keep(ctx.createBiquadFilter());
        f.type = "allpass";
        f.Q.value = 0.6;
        return f;
      });
      const fb = keep(ctx.createGain());
      const osc = lfo(0.5);
      const mods = stages.map((s) => {
        const g = keep(ctx.createGain());
        osc.connect(g).connect(s.frequency);
        return g;
      });
      dw.input.connect(stages[0]);
      for (let i = 0; i < stages.length - 1; i++) stages[i].connect(stages[i + 1]);
      stages[stages.length - 1].connect(dw.wet);
      stages[stages.length - 1].connect(fb).connect(stages[0]);
      return {
        input: dw.input,
        output: dw.output,
        set: (p) => {
          dw.mix(p.mix ?? 0.5);
          osc.frequency.value = p.rate ?? 0.5;
          fb.gain.value = Math.min(0.9, p.feedback ?? 0.4);
          stages.forEach((s, i) => {
            const base = 300 * 1.8 ** i;
            s.frequency.value = base;
            mods[i].gain.value = base * 0.8 * (p.depth ?? 0.7);
          });
        },
        dispose,
      };
    }
    case "distortion": {
      const dw = dryWet(ctx);
      dw.nodes.forEach(keep);
      const ws = keep(ctx.createWaveShaper());
      ws.oversample = "4x";
      const tone = keep(ctx.createBiquadFilter());
      tone.type = "lowpass";
      const comp = keep(ctx.createGain());
      dw.input.connect(ws).connect(tone).connect(comp).connect(dw.wet);
      let drive = -1;
      return {
        input: dw.input,
        output: dw.output,
        set: (p) => {
          dw.mix(p.mix ?? 1);
          tone.frequency.value = p.tone ?? 6000;
          const d = p.drive ?? 0.4;
          if (d !== drive) {
            drive = d;
            ws.curve = driveCurve(d);
          }
          // Hotter drive is louder; pull it back so the knob changes colour, not volume.
          comp.gain.value = 1 / (1 + d * 1.5);
        },
        dispose,
      };
    }
    case "filter": {
      const f = keep(ctx.createBiquadFilter());
      const osc = lfo(1);
      const depth = keep(ctx.createGain());
      osc.connect(depth).connect(f.frequency);
      return {
        input: f,
        output: f,
        set: (p) => {
          f.type = (["lowpass", "highpass", "bandpass"] as const)[Math.round(p.mode ?? 0)] ?? "lowpass";
          f.frequency.value = p.freq ?? 2000;
          f.Q.value = p.q ?? 1;
          osc.frequency.value = Math.max(0.01, p.lfoRate ?? 0);
          depth.gain.value = (p.lfoRate ?? 0) > 0 ? (p.freq ?? 2000) * 0.9 * (p.lfoDepth ?? 0.5) : 0;
        },
        dispose,
      };
    }
    case "tremolo": {
      const g = keep(ctx.createGain());
      const osc = lfo(5);
      const depth = keep(ctx.createGain());
      osc.connect(depth).connect(g.gain);
      return {
        input: g,
        output: g,
        set: (p) => {
          const d = p.depth ?? 0.5;
          g.gain.value = 1 - d / 2;
          depth.gain.value = d / 2;
          osc.frequency.value = p.rate ?? 5;
        },
        dispose,
      };
    }
    case "autopan": {
      const pan = keep(ctx.createStereoPanner());
      const osc = lfo(0.5);
      const depth = keep(ctx.createGain());
      osc.connect(depth).connect(pan.pan);
      return {
        input: pan,
        output: pan,
        set: (p) => {
          osc.frequency.value = p.rate ?? 0.5;
          depth.gain.value = p.depth ?? 0.7;
        },
        dispose,
      };
    }
    case "bitcrush": {
      const dw = dryWet(ctx);
      dw.nodes.forEach(keep);
      const ws = keep(ctx.createWaveShaper());
      dw.input.connect(ws).connect(dw.wet);
      let bits = -1;
      return {
        input: dw.input,
        output: dw.output,
        set: (p) => {
          dw.mix(p.mix ?? 0.6);
          const b = Math.round(p.bits ?? 6);
          if (b !== bits) {
            bits = b;
            ws.curve = crushCurve(b);
          }
        },
        dispose,
      };
    }
    case "width": {
      const input = keep(ctx.createGain());
      input.channelCount = 2;
      input.channelCountMode = "explicit";
      const split = keep(ctx.createChannelSplitter(2));
      const merge = keep(ctx.createChannelMerger(2));
      const ll = keep(ctx.createGain());
      const lr = keep(ctx.createGain());
      const rl = keep(ctx.createGain());
      const rr = keep(ctx.createGain());
      input.connect(split);
      split.connect(ll, 0).connect(merge, 0, 0);
      split.connect(rl, 1).connect(merge, 0, 0);
      split.connect(rr, 1).connect(merge, 0, 1);
      split.connect(lr, 0).connect(merge, 0, 1);
      return {
        input,
        output: merge,
        set: (p) => {
          // L' = L(1+w)/2 + R(1-w)/2: mid stays, side scales by w.
          const w = p.width ?? 1.4;
          ll.gain.value = (1 + w) / 2;
          rr.gain.value = (1 + w) / 2;
          rl.gain.value = (1 - w) / 2;
          lr.gain.value = (1 - w) / 2;
        },
        dispose,
      };
    }
    case "ringmod": {
      const dw = dryWet(ctx);
      dw.nodes.forEach(keep);
      const ring = keep(ctx.createGain());
      ring.gain.value = 0;
      const osc = lfo(60);
      osc.connect(ring.gain);
      dw.input.connect(ring).connect(dw.wet);
      return {
        input: dw.input,
        output: dw.output,
        set: (p) => {
          dw.mix(p.mix ?? 0.8);
          osc.frequency.value = p.freq ?? 60;
        },
        dispose,
      };
    }
  }
}

export function defaultParams(type: Effect["type"]): Record<string, number> {
  return Object.fromEntries(effectDef(type).params.map((p) => [p.key, p.def]));
}

/**
 * A chain of effect units between `input` and `output`. `sync` updates parameters in place when
 * the chain's shape (which effects, in which order, on or off) is unchanged, and rebuilds it
 * otherwise.
 */
export class FxChain {
  readonly input: GainNode;
  readonly output: GainNode;
  private units: Unit[] = [];
  private shape = "";

  constructor(private ctx: BaseAudioContext) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.input.connect(this.output);
  }

  sync(effects: Effect[], bpm: number) {
    const live = effects.filter((e) => e.on);
    const shape = live.map((e) => `${e.id}:${e.type}`).join("|");
    if (shape !== this.shape) {
      this.shape = shape;
      this.input.disconnect();
      for (const u of this.units) u.dispose();
      this.units = live.map((e) => makeUnit(this.ctx, e));
      let prev: AudioNode = this.input;
      for (const u of this.units) {
        prev.connect(u.input);
        prev = u.output;
      }
      prev.connect(this.output);
    }
    live.forEach((e, i) => this.units[i].set({ ...defaultParams(e.type), ...e.params }, bpm));
  }

  dispose() {
    this.input.disconnect();
    for (const u of this.units) u.dispose();
    this.output.disconnect();
    this.units = [];
  }
}
