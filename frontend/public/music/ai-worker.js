// Music studio AI worker (module worker): Meta's MusicGen (small) through Transformers.js, off the
// main thread. Text in, 32 kHz mono music out. The model (~450 MB, quantised) downloads once from
// the Hugging Face Hub and stays in the browser cache; prompts and audio never leave the device.
//
// The library is the same self-contained build the video editor uses (/vendor, copied from
// node_modules by scripts/copy-vendor.mjs). This file is served with the music studio's
// Cross-Origin-Embedder-Policy (next.config.ts) so ONNX Runtime can use threads.

import { AutoTokenizer, MusicgenForConditionalGeneration, env } from "/vendor/transformers/transformers.min.js";

env.allowLocalModels = false;
env.useBrowserCache = true;

const MODEL = "Xenova/musicgen-small";
// MusicGen makes 50 audio tokens per second.
const TOKENS_PER_SECOND = 50;

let loading = null;
function load(id) {
  loading ??= (async () => {
    const progress_callback = (info) => self.postMessage({ id, type: "progress", info });
    const tokenizer = await AutoTokenizer.from_pretrained(MODEL, { progress_callback });
    const model = await MusicgenForConditionalGeneration.from_pretrained(MODEL, {
      progress_callback,
      dtype: { text_encoder: "q8", decoder_model_merged: "q8", encodec_decode: "fp32" },
      device: "wasm",
    });
    return { tokenizer, model };
  })().catch((e) => {
    loading = null;
    throw e;
  });
  return loading;
}

async function generate(id, { prompt, seconds, guidance }) {
  const { tokenizer, model } = await load(id);
  const steps = Math.max(50, Math.min(1500, Math.round(seconds * TOKENS_PER_SECOND)));
  const inputs = tokenizer(prompt);
  let step = 0;
  // A minimal streamer: generate() calls put() once per new token, which drives the progress bar.
  const streamer = {
    put() {
      step++;
      if (step % 10 === 0) self.postMessage({ id, type: "step", step, steps });
    },
    end() {},
  };
  const audio = await model.generate({ ...inputs, max_new_tokens: steps, do_sample: true, guidance_scale: guidance ?? 3, streamer });
  const data = audio.data instanceof Float32Array ? audio.data : Float32Array.from(audio.data);
  self.postMessage({ id, type: "result", audio: data }, [data.buffer]);
}

self.onmessage = async (e) => {
  const { id, type, payload } = e.data;
  try {
    if (type === "generate") await generate(id, payload);
  } catch (err) {
    self.postMessage({ id, type: "error", message: err && err.message ? err.message : String(err) });
  }
};
