import { localForSrc, srcSpan } from "../../lib/speed";
import * as TL from "../../lib/timeline";
import { rt } from "../../lib/time";
import { useStudio } from "../../store/studio-store";
import { extractPcm } from "../audio";
import { mediaRuntime } from "../media";
import { soundClips, type Progress } from "./captions";

/**
 * Auto silence cut, done locally and instantly (no model): the sound's loudness is measured in
 * 20 ms windows (RMS, in dBFS); runs quieter than the threshold for at least `minSilence` become
 * cuts, shrunk by `padding` on each side so breaths and word endings survive. Applying it splits the
 * clips (and their linked video) at those points and ripple-deletes the pauses.
 */

export type SilenceOptions = { thresholdDb: number; minSilence: number; padding: number };
export type SilencePlan = { trackIds: string[]; ranges: [number, number][]; saved: number };

const RATE = 8000;

/** Silent ranges, in seconds from the start of `pcm`. */
export function detectSilence(pcm: Float32Array, rate: number, o: SilenceOptions): [number, number][] {
  const win = Math.max(1, Math.round(rate * 0.02));
  const n = Math.floor(pcm.length / win);
  const quiet = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = i * win; j < (i + 1) * win; j++) sum += pcm[j] * pcm[j];
    const db = 10 * Math.log10(sum / win + 1e-12);
    quiet[i] = db < o.thresholdDb ? 1 : 0;
  }
  const total = pcm.length / rate;
  const out: [number, number][] = [];
  let i = 0;
  while (i < n) {
    if (!quiet[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < n && quiet[j]) j++;
    const a = (i * win) / rate;
    const b = j >= n ? total : (j * win) / rate;
    if (b - a >= o.minSilence) {
      // No padding where the silence touches the clip's own start or end.
      const ca = a <= 0.001 ? 0 : a + o.padding;
      const cb = j >= n ? total : b - o.padding;
      if (cb - ca >= 0.08) out.push([ca, cb]);
    }
    i = j;
  }
  return out;
}

export async function planSilenceCut(o: SilenceOptions, onProgress: Progress): Promise<SilencePlan> {
  const s = useStudio.getState();
  const p = s.project;
  const sources = soundClips(p, s.selection);
  if (!sources.length) throw new Error("Add a clip with sound first.");
  const ranges: [number, number][] = [];
  const tracks = new Set<string>();
  for (const [i, c] of sources.entries()) {
    const file = mediaRuntime.file(c.mediaId!);
    if (!file) continue;
    tracks.add(c.trackId);
    for (const l of TL.linked(p, c)) tracks.add(l.trackId);
    const pcm = await extractPcm(file, c.in, c.in + srcSpan(c), RATE, (f) => onProgress(`Listening (clip ${i + 1} of ${sources.length})`, f));
    for (const [a, b] of detectSilence(pcm, RATE, o)) ranges.push([rt(c.start + localForSrc(c, a)), rt(c.start + localForSrc(c, b))]);
  }
  const saved = ranges.reduce((n, [a, b]) => n + (b - a), 0);
  return { trackIds: [...tracks], ranges, saved };
}

export function applySilenceCut(plan: SilencePlan) {
  const st = useStudio.getState();
  st.commit((p) => TL.rippleDeleteRanges(p, plan.trackIds, plan.ranges));
  st.set({ silence: null, selection: [] });
  st.notify(`Cut ${plan.ranges.length} pause${plan.ranges.length === 1 ? "" : "s"} (${plan.saved.toFixed(1)} s shorter).`, "success");
}
