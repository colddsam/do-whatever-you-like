import { MODELS } from "../../constants";

/**
 * AIWorker: the main-thread side of public/studio/ai-worker.js, where Transformers.js runs Whisper
 * (captions) and RMBG-1.4 (cut-outs) on WebGPU, or WASM when there's no GPU. Models download from
 * the Hugging Face Hub once and stay in the browser's cache; audio and pictures never leave the device.
 */

export type ModelProgress = { status: string; file?: string; progress?: number; loaded?: number; total?: number; name?: string };
export type AsrChunk = { text: string; timestamp: [number, number | null] };
export type AsrResult = { text: string; chunks?: AsrChunk[]; wordLevel: boolean; device: string };
export type Cutout = { mask: Uint8Array; width: number; height: number };

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; onProgress?: (p: ModelProgress) => void };

class AIWorker {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, Pending>();

  private get w() {
    if (this.worker) return this.worker;
    const w = new Worker("/studio/ai-worker.js", { type: "module", name: "studio-ai" });
    w.onmessage = (e: MessageEvent) => {
      const msg = e.data as { id: number; type: string; info?: ModelProgress; result?: unknown; message?: string };
      const p = this.pending.get(msg.id);
      if (!p) return;
      if (msg.type === "progress") p.onProgress?.(msg.info!);
      else if (msg.type === "result") {
        this.pending.delete(msg.id);
        p.resolve(msg.result);
      } else if (msg.type === "error") {
        this.pending.delete(msg.id);
        p.reject(new Error(msg.message || "The AI model failed."));
      }
    };
    w.onerror = (e) => {
      const err = new Error(e.message || "The AI worker couldn't start. Reload the page and try again.");
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
      w.terminate();
      this.worker = null;
    };
    this.worker = w;
    return w;
  }

  private call<T>(type: string, payload: Record<string, unknown>, transfer: Transferable[] = [], onProgress?: (p: ModelProgress) => void): Promise<T> {
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onProgress });
      this.w.postMessage({ id, type, payload }, transfer);
    });
  }

  /**
   * 16 kHz mono PCM in; words (or phrases) with times out. The buffer is transferred, not copied.
   * English uses the small English-only model; any other language (or "translate to English") the
   * multilingual one.
   */
  transcribe(audio: Float32Array, onProgress?: (p: ModelProgress) => void, opts: { language?: string; translate?: boolean } = {}) {
    const english = (!opts.language || opts.language === "en") && !opts.translate;
    return this.call<AsrResult>(
      "transcribe",
      {
        audio,
        model: english ? MODELS.whisperWords : MODELS.whisperMultiWords,
        fallbackModel: english ? MODELS.whisper : MODELS.whisperMulti,
        language: english ? undefined : opts.language || "auto",
        task: opts.translate ? "translate" : "transcribe",
      },
      [audio.buffer],
      onProgress,
    );
  }

  /** A still image in; its subject's alpha matte out. */
  cutout(image: Blob, onProgress?: (p: ModelProgress) => void) {
    return this.call<Cutout>("cutout", { image, model: MODELS.rmbg }, [], onProgress);
  }

  terminate() {
    this.worker?.terminate();
    this.worker = null;
    for (const p of this.pending.values()) p.reject(new Error("Stopped."));
    this.pending.clear();
  }
}

export const aiWorker = new AIWorker();

/** "Downloading model · 42%" from Transformers.js progress events. */
export function progressLabel(p: ModelProgress): { label: string; fraction?: number } {
  if (p.status === "progress" && p.total) return { label: "Downloading the AI model (once)", fraction: (p.loaded ?? 0) / p.total };
  if (p.status === "progress" && p.progress !== undefined) return { label: "Downloading the AI model (once)", fraction: p.progress / 100 };
  if (p.status === "initiate" || p.status === "download") return { label: "Fetching the AI model" };
  if (p.status === "ready" || p.status === "done") return { label: "Model ready" };
  return { label: "Preparing" };
}
