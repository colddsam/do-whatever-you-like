/**
 * Signal processing on plain Float32Arrays (no Web Audio needed, so it also runs in tests):
 * FFT/STFT, pitch tracking (YIN), resampling, WSOLA time-stretch, pitch shift, auto-tune
 * (grain-based retuning), spectral noise reduction, harmonic/percussive separation, BS.1770
 * loudness, tempo and key detection, and hum-to-notes transcription.
 */

// ---------------------------------------------------------------------------------------------
// FFT

const bitRevCache = new Map<number, Uint32Array>();
const twiddleCache = new Map<number, { cos: Float64Array; sin: Float64Array }>();

/** In-place radix-2 complex FFT. `re`/`im` length must be a power of two. */
export function fft(re: Float64Array, im: Float64Array, inverse = false) {
  const n = re.length;
  let rev = bitRevCache.get(n);
  if (!rev) {
    rev = new Uint32Array(n);
    const bits = Math.log2(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      rev[i] = r;
    }
    bitRevCache.set(n, rev);
  }
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }
  let tw = twiddleCache.get(n);
  if (!tw) {
    tw = { cos: new Float64Array(n / 2), sin: new Float64Array(n / 2) };
    for (let i = 0; i < n / 2; i++) {
      tw.cos[i] = Math.cos((2 * Math.PI * i) / n);
      tw.sin[i] = Math.sin((2 * Math.PI * i) / n);
    }
    twiddleCache.set(n, tw);
  }
  const sign = inverse ? 1 : -1;
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const wr = tw.cos[k * step];
        const wi = sign * tw.sin[k * step];
        const a = start + k;
        const b = a + half;
        const xr = re[b] * wr - im[b] * wi;
        const xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
  }
}

export function hann(n: number, sqrt = false) {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const v = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
    w[i] = sqrt ? Math.sqrt(v) : v;
  }
  return w;
}

/**
 * Short-time Fourier processing with overlap-add resynthesis. `fn` may change each frame's
 * spectrum (bins 0..n/2 are mirrored afterwards). Output has the input's length.
 */
export function processStft(x: Float32Array, n: number, hop: number, fn: (re: Float64Array, im: Float64Array, frame: number) => void): Float32Array {
  const win = hann(n, true);
  const out = new Float32Array(x.length);
  const norm = new Float32Array(x.length);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  let frame = 0;
  for (let pos = -n + hop; pos < x.length; pos += hop, frame++) {
    for (let i = 0; i < n; i++) {
      const j = pos + i;
      re[i] = j >= 0 && j < x.length ? x[j] * win[i] : 0;
      im[i] = 0;
    }
    fft(re, im);
    fn(re, im, frame);
    for (let k = 1; k < n / 2; k++) {
      re[n - k] = re[k];
      im[n - k] = -im[k];
    }
    im[0] = 0;
    im[n / 2] = 0;
    fft(re, im, true);
    for (let i = 0; i < n; i++) {
      const j = pos + i;
      if (j < 0 || j >= x.length) continue;
      out[j] += re[i] * win[i];
      norm[j] += win[i] * win[i];
    }
  }
  for (let i = 0; i < out.length; i++) out[i] = norm[i] > 1e-6 ? out[i] / norm[i] : 0;
  return out;
}

// ---------------------------------------------------------------------------------------------
// Basic helpers

export function mixDown(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0].slice();
  const out = new Float32Array(channels[0].length);
  for (const ch of channels) for (let i = 0; i < out.length; i++) out[i] += ch[i] / channels.length;
  return out;
}

export function peak(x: Float32Array) {
  let p = 0;
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i]);
    if (a > p) p = a;
  }
  return p;
}

export const dbToGain = (db: number) => 10 ** (db / 20);
export const gainToDb = (g: number) => (g > 0 ? 20 * Math.log10(g) : -Infinity);

/** RMS level per frame, in dBFS. */
export function rmsDb(x: Float32Array, sr: number, frameSec = 0.02): Float32Array {
  const n = Math.max(1, Math.round(frameSec * sr));
  const frames = Math.ceil(x.length / n);
  const out = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let s = 0;
    const end = Math.min(x.length, (f + 1) * n);
    for (let i = f * n; i < end; i++) s += x[i] * x[i];
    out[f] = 10 * Math.log10(s / Math.max(1, end - f * n) + 1e-12);
  }
  return out;
}

/** Catmull-Rom interpolated read at a fractional index. */
function readAt(x: Float32Array, pos: number) {
  const i = Math.floor(pos);
  const t = pos - i;
  const p0 = x[i - 1] ?? 0;
  const p1 = x[i] ?? 0;
  const p2 = x[i + 1] ?? 0;
  const p3 = x[i + 2] ?? 0;
  return p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
}

/** Reads `x` at `ratio` samples per output sample (ratio 2 = twice as fast, half as long). */
export function resample(x: Float32Array, ratio: number): Float32Array {
  const len = Math.max(1, Math.floor(x.length / ratio));
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) out[i] = readAt(x, i * ratio);
  return out;
}

export function downsample(x: Float32Array, sr: number, target: number): { x: Float32Array; sr: number } {
  const factor = Math.max(1, Math.floor(sr / target));
  if (factor === 1) return { x, sr };
  // A moving average is enough of a low-pass for analysis purposes.
  const len = Math.floor(x.length / factor);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    let s = 0;
    for (let k = 0; k < factor; k++) s += x[i * factor + k];
    out[i] = s / factor;
  }
  return { x: out, sr: sr / factor };
}

// ---------------------------------------------------------------------------------------------
// Time-stretch and pitch shift

/**
 * WSOLA with a rate that may change along the way: `rateAt(inputSample)` 2 = twice as fast there.
 * Each new grain is lined up with the natural continuation of the last one, so pitch is kept.
 * Returns the stretched signal (its length follows the rates).
 */
function wsola(x: Float32Array, sr: number, rateAt: (pos: number) => number): Float32Array {
  const n = Math.max(256, 2 ** Math.round(Math.log2(sr * 0.04)));
  const hs = n / 2;
  const tol = Math.round(n / 4);
  const win = hann(n);
  const chunks: { pos: number; best: number }[] = [];
  let a = 0; // nominal analysis position; follows the rates exactly so timing never drifts
  let prevEnd = 0; // where the previous grain would naturally continue in the input
  for (let k = 0; a < x.length; k++) {
    const nominal = Math.round(a);
    let best = nominal;
    if (k > 0) {
      let bestScore = -Infinity;
      const lo = Math.max(0, nominal - tol);
      const hi = Math.max(lo, Math.min(x.length - n, nominal + tol));
      for (let d = lo; d <= hi; d += 2) {
        let s = 0;
        for (let i = 0; i < hs; i += 4) s += (x[d + i] ?? 0) * (x[prevEnd + i] ?? 0);
        if (s > bestScore) {
          bestScore = s;
          best = d;
        }
      }
    }
    chunks.push({ pos: k * hs, best });
    prevEnd = best + hs;
    a += hs * Math.max(0.05, rateAt(a));
  }
  const len = Math.max(1, chunks.length * hs);
  const out = new Float32Array(len + n);
  const norm = new Float32Array(len + n);
  for (const { pos, best } of chunks) {
    for (let i = 0; i < n; i++) {
      out[pos + i] += (x[best + i] ?? 0) * win[i];
      norm[pos + i] += win[i];
    }
  }
  const res = new Float32Array(len);
  for (let i = 0; i < len; i++) res[i] = norm[i] > 1e-3 ? out[i] / norm[i] : 0;
  return res;
}

/** Time-stretch: `rate` 2 plays twice as fast (half the length), 0.5 twice as slow; pitch unchanged. */
export function timeStretch(x: Float32Array, sr: number, rate: number): Float32Array {
  if (Math.abs(rate - 1) < 1e-3) return x.slice();
  const y = wsola(x, sr, () => rate);
  const outLen = Math.max(1, Math.round(x.length / rate));
  if (y.length === outLen) return y;
  const res = new Float32Array(outLen);
  res.set(y.subarray(0, Math.min(outLen, y.length)));
  return res;
}

/**
 * Variable pitch shift with the timing kept: a WSOLA stretch by the ratio wanted at each point,
 * then a resample by the same ratio. The two warps cancel in time and leave only the pitch.
 * `ratioAt(sample)` gives the ratio wanted at that input sample (1 = unchanged, 2 = an octave up).
 */
export function retune(x: Float32Array, sr: number, ratioAt: (sample: number) => number): Float32Array {
  const y = wsola(x, sr, (pos) => 1 / ratioAt(Math.min(x.length - 1, pos)));
  const out = new Float32Array(x.length);
  let q = 0;
  for (let t = 0; t < x.length; t++) {
    out[t] = q < y.length - 2 ? readAt(y, q) : 0;
    q += ratioAt(t);
  }
  return out;
}

/** Shifts pitch by `semitones` keeping the length. */
export function pitchShift(x: Float32Array, sr: number, semitones: number): Float32Array {
  if (Math.abs(semitones) < 1e-3) return x.slice();
  const r = 2 ** (semitones / 12);
  return retune(x, sr, () => r);
}

// ---------------------------------------------------------------------------------------------
// Pitch tracking

/** YIN fundamental frequency of one frame, or 0 when unvoiced. */
export function yin(frame: Float32Array, sr: number, minHz = 60, maxHz = 1000, threshold = 0.15): number {
  const tauMin = Math.max(2, Math.floor(sr / maxHz));
  const tauMax = Math.min(Math.floor(frame.length / 2), Math.ceil(sr / minHz));
  const w = frame.length - tauMax;
  if (w <= 8) return 0;
  const d = new Float32Array(tauMax + 1);
  for (let tau = 1; tau <= tauMax; tau++) {
    let s = 0;
    for (let i = 0; i < w; i++) {
      const diff = frame[i] - frame[i + tau];
      s += diff * diff;
    }
    d[tau] = s;
  }
  let running = 0;
  let found = -1;
  const cmnd = new Float32Array(tauMax + 1);
  cmnd[0] = 1;
  for (let tau = 1; tau <= tauMax; tau++) {
    running += d[tau];
    cmnd[tau] = running > 0 ? (d[tau] * tau) / running : 1;
  }
  for (let tau = tauMin; tau <= tauMax; tau++) {
    if (cmnd[tau] < threshold) {
      while (tau + 1 <= tauMax && cmnd[tau + 1] < cmnd[tau]) tau++;
      found = tau;
      break;
    }
  }
  if (found < 0) return 0;
  // Parabolic interpolation around the dip for sub-sample accuracy.
  const a = cmnd[found - 1] ?? cmnd[found];
  const b = cmnd[found];
  const c = cmnd[found + 1] ?? cmnd[found];
  const denom = a - 2 * b + c;
  const shift = denom !== 0 ? (0.5 * (a - c)) / denom : 0;
  return sr / (found + shift);
}

/** Pitch (Hz, 0 = unvoiced) every `hopSec`, analysed at 16 kHz for speed. */
export function pitchTrack(x: Float32Array, sr: number, hopSec = 0.01, minHz = 65, maxHz = 900): { hz: Float32Array; hopSec: number; rms: Float32Array } {
  const ds = downsample(x, sr, 16000);
  const frameLen = Math.round(ds.sr * 0.04);
  const hop = Math.max(1, Math.round(ds.sr * hopSec));
  const frames = Math.max(1, Math.ceil(ds.x.length / hop));
  const hz = new Float32Array(frames);
  const rms = new Float32Array(frames);
  const buf = new Float32Array(frameLen);
  for (let f = 0; f < frames; f++) {
    const start = f * hop - Math.round(frameLen / 2);
    let s = 0;
    for (let i = 0; i < frameLen; i++) {
      const v = ds.x[start + i] ?? 0;
      buf[i] = v;
      s += v * v;
    }
    rms[f] = Math.sqrt(s / frameLen);
    hz[f] = rms[f] > 0.008 ? yin(buf, ds.sr, minHz, maxHz) : 0;
  }
  // Median of 3 removes single-frame octave glitches.
  const clean = hz.slice();
  for (let f = 1; f < frames - 1; f++) {
    const a = hz[f - 1];
    const b = hz[f];
    const c = hz[f + 1];
    if (a && b && c) clean[f] = Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
  }
  return { hz: clean, hopSec, rms };
}

/**
 * Auto-tune: pulls the pitch towards the nearest note of the scale (or the note `targetAt` asks
 * for). `strength` 1 = hard (robotic), 0.5 = natural; `speedMs` is how fast it snaps.
 */
export function autotune(
  x: Float32Array,
  sr: number,
  opts: { scaleNotes?: number[]; strength?: number; speedMs?: number; targetAt?: (sec: number) => number | null },
): Float32Array {
  const strength = opts.strength ?? 1;
  const { hz, hopSec } = pitchTrack(x, sr, 0.01);
  const pcs = opts.scaleNotes?.length ? opts.scaleNotes.map((p) => ((p % 12) + 12) % 12) : [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  const ratios = new Float32Array(hz.length).fill(1);
  const alpha = Math.min(1, (hopSec * 1000) / Math.max(1, opts.speedMs ?? 20));
  let cur = 1;
  for (let f = 0; f < hz.length; f++) {
    let target = 1;
    if (hz[f] > 0) {
      const midi = 69 + 12 * Math.log2(hz[f] / 440);
      let goal = opts.targetAt?.(f * hopSec) ?? null;
      if (goal === null) {
        let best = Math.round(midi);
        let bestD = Infinity;
        for (let n = Math.floor(midi) - 2; n <= Math.ceil(midi) + 2; n++) {
          if (!pcs.includes(((n % 12) + 12) % 12)) continue;
          const d = Math.abs(n - midi);
          if (d < bestD) {
            bestD = d;
            best = n;
          }
        }
        goal = best;
      } else {
        // A wanted note far from the sung one: aim at its nearest octave to avoid chipmunks.
        while (goal - midi > 6) goal -= 12;
        while (midi - goal > 6) goal += 12;
      }
      target = 2 ** (((goal - midi) * strength) / 12);
    }
    cur += (target - cur) * (hz[f] > 0 ? alpha : 0.2);
    ratios[f] = cur;
  }
  const hop = hopSec * sr;
  return retune(x, sr, (s) => ratios[Math.min(ratios.length - 1, Math.floor(s / hop))]);
}

/** Monophonic transcription (hum or sing → notes). Times in seconds. */
export function transcribeMelody(x: Float32Array, sr: number, opts: { minNoteSec?: number } = {}): { start: number; length: number; pitch: number; velocity: number }[] {
  const { hz, hopSec, rms } = pitchTrack(x, sr, 0.01);
  const minFrames = Math.round((opts.minNoteSec ?? 0.08) / hopSec);
  const midi = Array.from(hz, (h) => (h > 0 ? Math.round(69 + 12 * Math.log2(h / 440)) : -1));
  // Median of 5 on note numbers steadies vibrato and scoops.
  const steady = midi.map((_, i) => {
    const w = midi.slice(Math.max(0, i - 2), i + 3).filter((v) => v >= 0);
    if (midi[i] < 0 || w.length < 3) return midi[i];
    return w.sort((a, b) => a - b)[Math.floor(w.length / 2)];
  });
  const maxRms = Math.max(1e-6, ...Array.from(rms));
  const notes: { start: number; length: number; pitch: number; velocity: number }[] = [];
  let i = 0;
  while (i < steady.length) {
    if (steady[i] < 0) {
      i++;
      continue;
    }
    let j = i;
    let level = 0;
    while (j < steady.length && steady[j] === steady[i]) level = Math.max(level, rms[j++]);
    if (j - i >= minFrames) {
      const prev = notes[notes.length - 1];
      // Re-attacks of the same pitch with a tiny gap are one note.
      if (prev && prev.pitch === steady[i] && i * hopSec - (prev.start + prev.length) < 0.03) prev.length = j * hopSec - prev.start;
      else notes.push({ start: i * hopSec, length: (j - i) * hopSec, pitch: steady[i], velocity: Math.min(1, 0.35 + (0.65 * level) / maxRms) });
    }
    i = j;
  }
  return notes;
}

// ---------------------------------------------------------------------------------------------
// Noise reduction and separation

/**
 * Spectral-gating noise reduction (Audacity's method in spirit): learns the noise's spectrum from
 * `profile` (or from the quietest frames), then lowers every bin that doesn't rise above it.
 */
export function reduceNoise(x: Float32Array, opts: { profile?: Float32Array; reductionDb?: number; sensitivity?: number } = {}): Float32Array {
  const n = 2048;
  const hop = 512;
  const bins = n / 2 + 1;
  const floor = dbToGain(-(opts.reductionDb ?? 18));
  const sens = opts.sensitivity ?? 1.6;
  const noise = new Float64Array(bins);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const win = hann(n, true);
  const frameMags = (src: Float32Array, maxFrames: number) => {
    const out: Float64Array[] = [];
    const total = Math.max(1, Math.floor((src.length - n) / hop) + 1);
    const step = Math.max(1, Math.floor(total / maxFrames));
    for (let f = 0; f < total; f += step) {
      for (let i = 0; i < n; i++) {
        re[i] = (src[f * hop + i] ?? 0) * win[i];
        im[i] = 0;
      }
      fft(re, im);
      const m = new Float64Array(bins);
      for (let k = 0; k < bins; k++) m[k] = Math.hypot(re[k], im[k]);
      out.push(m);
    }
    return out;
  };
  if (opts.profile && opts.profile.length >= n) {
    const mags = frameMags(opts.profile, 400);
    for (const m of mags) for (let k = 0; k < bins; k++) noise[k] += m[k] / mags.length;
  } else {
    // No profile: the 10th percentile of each bin over time is a fair noise estimate.
    const mags = frameMags(x, 600);
    const col = new Float64Array(mags.length);
    for (let k = 0; k < bins; k++) {
      for (let f = 0; f < mags.length; f++) col[f] = mags[f][k];
      col.sort();
      noise[k] = col[Math.floor(col.length * 0.1)] * 1.2;
    }
  }
  let prev = new Float64Array(bins).fill(1);
  return processStft(x, n, hop, (r, i) => {
    const g = new Float64Array(bins);
    for (let k = 0; k < bins; k++) {
      const mag = Math.hypot(r[k], i[k]);
      const target = mag > noise[k] * sens ? 1 : floor;
      // Fast attack, slower release: no "musical noise" chirps.
      g[k] = target > prev[k] ? prev[k] + (target - prev[k]) * 0.7 : prev[k] + (target - prev[k]) * 0.25;
    }
    for (let k = 0; k < bins; k++) {
      const s = (g[k - 1] ?? g[k]) * 0.25 + g[k] * 0.5 + (g[k + 1] ?? g[k]) * 0.25;
      r[k] *= s;
      i[k] *= s;
    }
    prev = g;
  });
}

/** Sliding median over a small odd window, by insertion into a sorted buffer. */
function medianFilter(src: Float32Array, len: number, stride: number, offset: number, win: number, out: Float32Array) {
  const half = (win - 1) >> 1;
  const sorted: number[] = [];
  const at = (i: number) => src[offset + Math.min(len - 1, Math.max(0, i)) * stride];
  for (let i = -half; i <= half; i++) sorted.push(at(i));
  sorted.sort((a, b) => a - b);
  for (let i = 0; i < len; i++) {
    out[offset + i * stride] = sorted[half];
    const leaving = at(i - half);
    const entering = at(i + half + 1);
    let idx = sorted.indexOf(leaving);
    sorted.splice(idx, 1);
    idx = 0;
    while (idx < sorted.length && sorted[idx] < entering) idx++;
    sorted.splice(idx, 0, entering);
  }
}

/**
 * Harmonic/percussive separation (Fitzgerald median filtering): sustained tones are smooth over
 * time, drum hits are smooth over frequency. Returns soft masks applied to every channel.
 */
export function hpss(channels: Float32Array[], sr: number): { harmonic: Float32Array[]; percussive: Float32Array[] } {
  const n = sr > 32000 ? 4096 : 2048;
  const hop = n / 2;
  const bins = n / 2 + 1;
  const mono = mixDown(channels);
  const frames = Math.floor((mono.length + n) / hop) + 1;
  const mag = new Float32Array(frames * bins);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const win = hann(n, true);
  for (let f = 0; f < frames; f++) {
    const pos = -n + hop + f * hop;
    for (let i = 0; i < n; i++) {
      re[i] = (mono[pos + i] ?? 0) * win[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 0; k < bins; k++) mag[f * bins + k] = Math.hypot(re[k], im[k]);
  }
  const harm = new Float32Array(frames * bins);
  const perc = new Float32Array(frames * bins);
  const timeWin = 17;
  const freqWin = 17;
  for (let k = 0; k < bins; k++) medianFilter(mag, frames, bins, k, timeWin, harm);
  for (let f = 0; f < frames; f++) medianFilter(mag, bins, 1, f * bins, freqWin, perc);
  const maskH = (f: number, k: number) => {
    const h = harm[f * bins + k] ** 2;
    const p = perc[f * bins + k] ** 2;
    return h + p > 1e-12 ? h / (h + p) : 0.5;
  };
  const harmonic: Float32Array[] = [];
  const percussive: Float32Array[] = [];
  for (const ch of channels) {
    const h = processStft(ch, n, hop, (r, i, frame) => {
      const f = Math.min(frames - 1, frame);
      for (let k = 0; k < bins; k++) {
        const m = maskH(f, k);
        r[k] *= m;
        i[k] *= m;
      }
    });
    const p = new Float32Array(ch.length);
    for (let i = 0; i < ch.length; i++) p[i] = ch[i] - h[i];
    harmonic.push(h);
    percussive.push(p);
  }
  return { harmonic, percussive };
}

/** A one-pole-pair biquad applied in place (direct form I). */
export function biquad(x: Float32Array, b0: number, b1: number, b2: number, a1: number, a2: number): Float32Array {
  const y = new Float32Array(x.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = v;
    y[i] = v;
  }
  return y;
}

/** RBJ low-pass / high-pass coefficients. */
export function rbj(type: "lowpass" | "highpass", freq: number, sr: number, q = Math.SQRT1_2) {
  const w = (2 * Math.PI * freq) / sr;
  const alpha = Math.sin(w) / (2 * q);
  const cos = Math.cos(w);
  const a0 = 1 + alpha;
  const b1 = type === "lowpass" ? 1 - cos : -(1 + cos);
  const b0 = type === "lowpass" ? (1 - cos) / 2 : (1 + cos) / 2;
  return [b0 / a0, b1 / a0, b0 / a0, (-2 * cos) / a0, (1 - alpha) / a0] as const;
}

export function lowpass(x: Float32Array, freq: number, sr: number) {
  const c = rbj("lowpass", freq, sr);
  return biquad(biquad(x, ...c), ...c);
}
export function highpass(x: Float32Array, freq: number, sr: number) {
  const c = rbj("highpass", freq, sr);
  return biquad(biquad(x, ...c), ...c);
}

// ---------------------------------------------------------------------------------------------
// Loudness (ITU-R BS.1770-4 / EBU R128)

function kWeight(x: Float32Array, sr: number) {
  // Coefficients for any sample rate (the same derivation pyloudnorm uses).
  let f0 = 1681.9744509555319;
  const G = 3.99984385397;
  let Q = 0.7071752369554193;
  let K = Math.tan((Math.PI * f0) / sr);
  const Vh = 10 ** (G / 20);
  const Vb = Vh ** 0.499666774155;
  let a0 = 1 + K / Q + K * K;
  const shelf = biquad(x, (Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0);
  f0 = 38.13547087613982;
  Q = 0.5003270373253953;
  K = Math.tan((Math.PI * f0) / sr);
  a0 = 1 + K / Q + K * K;
  return biquad(shelf, 1, -2, 1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0);
}

/** Integrated loudness in LUFS (gated), or -Infinity for silence. */
export function loudness(channels: Float32Array[], sr: number): number {
  const weighted = channels.slice(0, 2).map((c) => kWeight(c, sr));
  const block = Math.round(0.4 * sr);
  const step = Math.round(0.1 * sr);
  const len = weighted[0].length;
  const z: number[] = [];
  for (let s = 0; s + block <= len; s += step) {
    let sum = 0;
    for (const w of weighted) {
      let acc = 0;
      for (let i = s; i < s + block; i++) acc += w[i] * w[i];
      sum += acc / block;
    }
    z.push(sum);
  }
  if (!z.length) {
    let sum = 0;
    for (const w of weighted) {
      let acc = 0;
      for (let i = 0; i < len; i++) acc += w[i] * w[i];
      sum += acc / Math.max(1, len);
    }
    return sum > 0 ? -0.691 + 10 * Math.log10(sum) : -Infinity;
  }
  const lk = (v: number) => -0.691 + 10 * Math.log10(v);
  const abs = z.filter((v) => v > 0 && lk(v) > -70);
  if (!abs.length) return -Infinity;
  const rel = lk(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
  const gated = abs.filter((v) => lk(v) > rel);
  return lk(gated.reduce((a, b) => a + b, 0) / Math.max(1, gated.length));
}

// ---------------------------------------------------------------------------------------------
// Tempo and key

/** Estimated tempo (BPM) from an onset-strength envelope's autocorrelation. */
export function detectBpm(mono: Float32Array, sr: number): { bpm: number; confidence: number } {
  const ds = downsample(mono, sr, 11025);
  const n = 1024;
  const hop = 256;
  const frames = Math.floor((ds.x.length - n) / hop);
  if (frames < 32) return { bpm: 120, confidence: 0 };
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const win = hann(n);
  let prev = new Float64Array(n / 2);
  const flux = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < n; i++) {
      re[i] = ds.x[f * hop + i] * win[i];
      im[i] = 0;
    }
    fft(re, im);
    const cur = new Float64Array(n / 2);
    let s = 0;
    for (let k = 1; k < n / 2; k++) {
      cur[k] = Math.log1p(100 * Math.hypot(re[k], im[k]));
      const d = cur[k] - prev[k];
      if (d > 0) s += d;
    }
    flux[f] = s;
    prev = cur;
  }
  // Remove the slow trend so only onsets remain.
  const mean = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let s = 0;
    let c = 0;
    for (let k = Math.max(0, f - 8); k < Math.min(frames, f + 9); k++) {
      s += flux[k];
      c++;
    }
    mean[f] = Math.max(0, flux[f] - s / c);
  }
  const fps = ds.sr / hop;
  let best = 120;
  let bestScore = -Infinity;
  let total = 0;
  const scores: number[] = [];
  for (let bpm = 60; bpm <= 200; bpm += 0.5) {
    const lag = (60 / bpm) * fps;
    let s = 0;
    for (let f = 0; f + lag * 2 < frames; f++) s += mean[f] * (readAt(mean, f + lag) + 0.5 * readAt(mean, f + lag * 2));
    // Prefer the common 80–160 range (a log-Gaussian around 120 BPM).
    const w = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.9) ** 2);
    const score = s * w;
    scores.push(score);
    total += score;
    if (score > bestScore) {
      bestScore = score;
      best = bpm;
    }
  }
  const confidence = total > 0 ? Math.min(1, (bestScore / (total / scores.length) - 1) / 3) : 0;
  return { bpm: Math.round(best), confidence };
}

const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

/** Musical key from a chromagram matched against Krumhansl–Kessler profiles. */
export function detectKey(mono: Float32Array, sr: number): { root: number; mode: "major" | "minor"; confidence: number } {
  const ds = downsample(mono, sr, 11025);
  const n = 4096;
  const hop = 2048;
  const chroma = new Float64Array(12);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const win = hann(n);
  const binPc: number[] = [];
  for (let k = 0; k < n / 2; k++) {
    const hz = (k * ds.sr) / n;
    binPc.push(hz < 55 || hz > 4000 ? -1 : (((Math.round(69 + 12 * Math.log2(hz / 440)) % 12) + 12) % 12));
  }
  for (let pos = 0; pos + n <= ds.x.length; pos += hop) {
    for (let i = 0; i < n; i++) {
      re[i] = ds.x[pos + i] * win[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 1; k < n / 2; k++) if (binPc[k] >= 0) chroma[binPc[k]] += Math.log1p(Math.hypot(re[k], im[k]));
  }
  const corr = (profile: number[], root: number) => {
    const xs = Array.from({ length: 12 }, (_, i) => chroma[(i + root) % 12]);
    const mx = xs.reduce((a, b) => a + b) / 12;
    const my = profile.reduce((a, b) => a + b) / 12;
    let num = 0;
    let dx = 0;
    let dy = 0;
    for (let i = 0; i < 12; i++) {
      num += (xs[i] - mx) * (profile[i] - my);
      dx += (xs[i] - mx) ** 2;
      dy += (profile[i] - my) ** 2;
    }
    return dx && dy ? num / Math.sqrt(dx * dy) : 0;
  };
  let best = { root: 0, mode: "major" as "major" | "minor", confidence: -1 };
  for (let root = 0; root < 12; root++) {
    for (const [mode, prof] of [["major", MAJOR_PROFILE], ["minor", MINOR_PROFILE]] as const) {
      const c = corr(prof, root);
      if (c > best.confidence) best = { root, mode, confidence: c };
    }
  }
  return best;
}

/** Min/max pairs for drawing a waveform with `buckets` columns. */
export function peaks(x: Float32Array, buckets: number, from = 0, to = x.length): Float32Array {
  const out = new Float32Array(buckets * 2);
  const span = Math.max(1, to - from);
  for (let b = 0; b < buckets; b++) {
    const s = from + Math.floor((b * span) / buckets);
    const e = Math.max(s + 1, from + Math.floor(((b + 1) * span) / buckets));
    let lo = 0;
    let hi = 0;
    const stride = Math.max(1, Math.floor((e - s) / 256));
    for (let i = s; i < e && i < x.length; i += stride) {
      const v = x[i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    out[b * 2] = lo;
    out[b * 2 + 1] = hi;
  }
  return out;
}
