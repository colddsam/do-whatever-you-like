// Video studio AI worker (module worker): Transformers.js off the main thread.
//
// - transcribe: Whisper with word-level timestamps (the "_timestamped" exports carry the
//   cross-attentions word timing needs): tiny.en for English, base (99 languages, or translated
//   into English) otherwise. Falls back to phrase timestamps, then to WASM.
// - cutout: RMBG-1.4 background removal for stills; the subject's alpha matte goes back.
//
// The library is served from /vendor (copied from node_modules by scripts/copy-vendor.mjs, like
// OpenCV for the scanner). ONNX Runtime's WASM loads from jsDelivr and models from the Hugging Face
// Hub, then live in the browser cache. Nothing the user records or imports is sent anywhere.
//
// This file must be served with Cross-Origin-Embedder-Policy (see next.config.ts): a worker started
// by a cross-origin-isolated page is refused without it.

import { env, pipeline, RawImage } from "/vendor/transformers/transformers.min.js";

env.allowLocalModels = false;
env.useBrowserCache = true;

let devicePromise = null;
function pickDevice() {
  devicePromise ??= (async () => {
    try {
      if (self.navigator && "gpu" in self.navigator) {
        const adapter = await self.navigator.gpu.requestAdapter();
        if (adapter) return "webgpu";
      }
    } catch {
      /* no WebGPU */
    }
    return "wasm";
  })();
  return devicePromise;
}

const pipes = new Map();
function getPipe(task, model, options, id) {
  const key = `${task}|${model}|${options.device}`;
  if (!pipes.has(key)) {
    const p = pipeline(task, model, {
      ...options,
      progress_callback: (info) => self.postMessage({ id, type: "progress", info }),
    }).catch((e) => {
      pipes.delete(key);
      throw e;
    });
    pipes.set(key, p);
  }
  return pipes.get(key);
}

const whisperDtype = (device) => (device === "webgpu" ? { encoder_model: "fp32", decoder_model_merged: "q4" } : "q8");

async function transcribe(id, { audio, model, fallbackModel, language, task }) {
  // English-only models (".en") reject language/task options; multilingual ones take both.
  const extra = (m) => (/\.en(_|$)/.test(m) ? {} : { ...(language && language !== "auto" ? { language } : {}), task: task || "transcribe" });
  const device = await pickDevice();
  const attempts = [
    [model, device, true],
    [model, "wasm", true],
    [fallbackModel, device, false],
    [fallbackModel, "wasm", false],
  ].filter((a, i, all) => all.findIndex((b) => b[0] === a[0] && b[1] === a[1] && b[2] === a[2]) === i);
  let lastError = null;
  for (const [m, d, words] of attempts) {
    try {
      const asr = await getPipe("automatic-speech-recognition", m, { device: d, dtype: whisperDtype(d) }, id);
      const out = await asr(audio, { return_timestamps: words ? "word" : true, chunk_length_s: 30, stride_length_s: 5, ...extra(m) });
      return { text: out.text ?? "", chunks: out.chunks ?? [], wordLevel: words, device: d };
    } catch (e) {
      lastError = e;
      console.warn(`[studio-ai] ${m} on ${d} failed`, e);
    }
  }
  throw lastError ?? new Error("Speech recognition failed.");
}

async function cutout(id, { image, model }) {
  const device = await pickDevice();
  let seg = null;
  for (const [m, d] of [
    [model, device],
    [model, "wasm"],
    ["Xenova/modnet", "wasm"],
  ]) {
    try {
      seg = await getPipe("background-removal", m, { device: d, dtype: "q8" }, id);
      break;
    } catch (e) {
      console.warn(`[studio-ai] ${m} on ${d} failed`, e);
    }
  }
  if (!seg) throw new Error("The cut-out model couldn't load.");
  const img = await RawImage.fromBlob(image);
  const out = await seg(img);
  const res = Array.isArray(out) ? out[0] : out;
  const { width, height, channels, data } = res;
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) mask[i] = data[i * channels + channels - 1];
  return { mask, width, height };
}

self.onmessage = async (e) => {
  const { id, type, payload } = e.data;
  try {
    if (type === "transcribe") {
      self.postMessage({ id, type: "result", result: await transcribe(id, payload) });
    } else if (type === "cutout") {
      const result = await cutout(id, payload);
      self.postMessage({ id, type: "result", result }, [result.mask.buffer]);
    } else {
      throw new Error(`Unknown job: ${type}`);
    }
  } catch (err) {
    self.postMessage({ id, type: "error", message: err && err.message ? err.message : String(err) });
  }
};
