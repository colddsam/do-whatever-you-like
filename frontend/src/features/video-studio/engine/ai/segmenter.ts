import type { ImageSegmenter } from "@mediapipe/tasks-vision";
import { MODELS } from "../../constants";

/**
 * Background removal for video, in real time: MediaPipe's selfie segmenter (Apache-2.0, ~250 KB)
 * runs on the GPU in a few milliseconds a frame, so the preview and the export both cut people out
 * without a green screen. Its WASM comes from jsDelivr and the model from Google's model bucket,
 * both served with CORS, so they load under this page's Cross-Origin-Embedder-Policy.
 */

export type Matte = { data: Uint8Array; width: number; height: number };

let seg: ImageSegmenter | null = null;
let loading: Promise<ImageSegmenter> | null = null;
let personIndex = -1;
let clock = 0;

export const segmenterReady = () => !!seg;

export function loadSegmenter(): Promise<ImageSegmenter> {
  if (seg) return Promise.resolve(seg);
  loading ??= (async () => {
    const { FilesetResolver, ImageSegmenter } = await import("@mediapipe/tasks-vision");
    const fileset = await FilesetResolver.forVisionTasks(MODELS.mediapipeWasm);
    const make = (delegate: "GPU" | "CPU") =>
      ImageSegmenter.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODELS.selfie, delegate },
        runningMode: "VIDEO",
        outputConfidenceMasks: true,
        outputCategoryMask: false,
      });
    let s: ImageSegmenter;
    try {
      s = await make("GPU");
    } catch {
      s = await make("CPU");
    }
    personIndex = s.getLabels().findIndex((l) => /person|human|fore/i.test(l));
    seg = s;
    return s;
  })().catch((e) => {
    loading = null;
    throw e;
  });
  return loading;
}

/** The person matte for one frame (255 = person). Null if the segmenter isn't loaded or failed. */
export function segmentFrame(source: TexImageSource): Matte | null {
  if (!seg) return null;
  let out = null as Matte | null;
  // VIDEO mode wants strictly increasing timestamps, even when the playhead jumps backwards.
  clock = Math.max(clock + 1, Math.floor(performance.now()));
  try {
    seg.segmentForVideo(source, clock, (r) => {
      const masks = r.confidenceMasks;
      if (!masks?.length) return;
      const m = masks[personIndex >= 0 && personIndex < masks.length ? personIndex : masks.length - 1];
      const f = m.getAsFloat32Array();
      const u = new Uint8Array(f.length);
      for (let i = 0; i < f.length; i++) u[i] = Math.round(Math.min(1, Math.max(0, f[i])) * 255);
      out = { data: u, width: m.width, height: m.height };
    });
  } catch (e) {
    console.warn("[studio] segmentation failed", e);
    return null;
  }
  return out;
}
