import type { FromWorker, SbContext, SbLog, SbRequest, SbResponse, SbResult, ToWorker } from "./protocol";

/**
 * Runs one script in the sandbox worker. Scripts share one warm worker (starting a worker with chai,
 * ajv and CryptoJS takes a moment); a script that runs past the time limit gets its worker
 * terminated, and the next script starts a fresh one.
 */

let worker: Worker | null = null;
let ready: Promise<void> | null = null;
const listeners = new Map<string, (m: FromWorker) => void>();

function boot(): Promise<void> {
  if (worker && ready) return ready;
  worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module", name: "api-script-sandbox" });
  ready = new Promise<void>((resolve, reject) => {
    const w = worker!;
    const onFirst = (e: MessageEvent<FromWorker>) => {
      if (e.data.type === "ready") {
        w.removeEventListener("message", onFirst);
        resolve();
      }
    };
    w.addEventListener("message", onFirst);
    w.addEventListener("error", (e) => reject(new Error(`The script sandbox couldn't start: ${e.message || "unknown error"}`)), { once: true });
  });
  worker.addEventListener("message", (e: MessageEvent<FromWorker>) => {
    const m = e.data;
    if ("runId" in m) listeners.get(m.runId)?.(m);
  });
  return ready;
}

function kill() {
  worker?.terminate();
  worker = null;
  ready = null;
  listeners.clear();
}

export type ScriptHooks = {
  onLog: (log: SbLog) => void;
  /** pm.sendRequest: the page sends it with the normal agents. */
  sendRequest: (req: SbRequest) => Promise<SbResponse & { url: string }>;
};

export async function runScript(script: string, ctx: SbContext, hooks: ScriptHooks, timeoutMs: number): Promise<SbResult> {
  await boot();
  const runId = Math.random().toString(36).slice(2);
  const w = worker!;
  return new Promise<SbResult>((resolve) => {
    const timer = setTimeout(() => {
      listeners.delete(runId);
      kill();
      resolve({
        tests: [],
        scopes: ctx.scopes,
        request: ctx.request,
        skipRequest: false,
        visualizer: null,
        cookies: ctx.cookies,
        error: `The script ran longer than ${Math.round(timeoutMs / 1000)} s and was stopped (an endless loop, or a callback that never finished). Change the limit in Settings.`,
      });
    }, timeoutMs);
    listeners.set(runId, (m) => {
      if (m.type === "log") hooks.onLog(m.log);
      else if (m.type === "sendRequest") {
        hooks
          .sendRequest(m.request)
          .then((response) => w.postMessage({ type: "sendResult", runId, reqId: m.reqId, response } satisfies ToWorker))
          .catch((e: Error) => w.postMessage({ type: "sendResult", runId, reqId: m.reqId, error: e.message } satisfies ToWorker));
      } else if (m.type === "done") {
        clearTimeout(timer);
        listeners.delete(runId);
        resolve(m.result);
      }
    });
    w.postMessage({ type: "run", runId, script, ctx } satisfies ToWorker);
  });
}
