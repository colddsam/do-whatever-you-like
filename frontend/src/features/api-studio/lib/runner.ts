import type { RequestItem, RunRequestResult, RunSummary } from "../types";
import { useApi } from "../store";
import { execute } from "./engine";
import { b64ToText, findNode, requestsIn, uid } from "./util";

/**
 * The collection runner: requests in order, for N iterations (one per data-file row), with an
 * optional delay; pm.execution.setNextRequest() jumps or stops. Variables carry from one request to
 * the next within the run and, when "Persist variables" is on, are saved afterwards.
 */

export type RunOptions = {
  collectionId: string;
  folderId?: string;
  /** Ids of the requests to run, in order. */
  order: string[];
  iterations: number;
  delayMs: number;
  data: Record<string, string>[];
  envId: string | null;
  persistVariables: boolean;
  saveResponses: boolean;
  bail: boolean;
  source?: RunSummary["source"];
  name?: string;
};

export async function runCollection(opts: RunOptions, onProgress: (s: RunSummary) => void, signal: AbortSignal): Promise<RunSummary> {
  const store = useApi.getState();
  const collection = store.ws.collections.find((c) => c.id === opts.collectionId);
  if (!collection) throw new Error("That collection no longer exists.");
  const all = requestsIn(collection.items).filter(({ req }) => req.protocol === "http" || req.protocol === "graphql");
  const queue = opts.order.map((id) => all.find((r) => r.req.id === id)).filter((x): x is NonNullable<typeof x> => !!x);
  const iterations = Math.max(1, opts.data.length && opts.iterations <= 1 ? opts.data.length : opts.iterations);
  const env = store.ws.environments.find((e) => e.id === opts.envId);
  const summary: RunSummary = {
    id: uid(),
    collectionId: collection.id,
    folderId: opts.folderId,
    name: opts.name ?? (opts.folderId ? `${collection.name} › ${findNode(collection.items, opts.folderId)?.node.name ?? ""}` : collection.name),
    source: opts.source ?? "runner",
    envName: env?.name,
    startedAt: Date.now(),
    iterations,
    results: [],
  };
  const { env: base, commit } = store.engineEnv({ collectionId: collection.id, envId: opts.envId, iterationCount: iterations, signal });
  store.log("info", `Run started: ${summary.name} (${queue.length} requests × ${iterations} iterations)`);
  outer: for (let it = 0; it < iterations; it++) {
    base.scopes.data = opts.data.length ? opts.data[it % opts.data.length] : {};
    let i = 0;
    while (i < queue.length) {
      if (signal.aborted) {
        summary.stopped = true;
        break outer;
      }
      const { req, parents } = queue[i];
      base.scopes.local = {};
      const env = { ...base, parents, iteration: it, signal };
      let result: RunRequestResult;
      let next: string | null | undefined;
      try {
        const res = await execute(req as RequestItem, env);
        base.cookies = env.cookies;
        next = res.nextRequest;
        const r = res.response;
        result = {
          id: uid(),
          itemId: req.id,
          name: req.name,
          path: parents.map((p) => p.name),
          method: req.method,
          url: r.sent.url,
          status: r.status || undefined,
          statusText: r.statusText,
          ms: r.timings.total,
          size: r.size.body,
          tests: r.tests,
          error: r.error,
          iteration: it,
          responseBody: opts.saveResponses && r.bodyB64.length < 400_000 ? b64ToText(r.bodyB64) : undefined,
          responseHeaders: opts.saveResponses ? r.headers : undefined,
        };
        if (res.skipped) result.error = "Skipped by pm.execution.skipRequest()";
      } catch (e) {
        result = { id: uid(), itemId: req.id, name: req.name, path: parents.map((p) => p.name), method: req.method, url: req.url, tests: [], error: (e as Error).message, iteration: it };
      }
      summary.results = [...summary.results, result];
      onProgress({ ...summary });
      if (opts.bail && (result.error || result.tests.some((t) => !t.passed && !t.skipped))) {
        summary.stopped = true;
        store.log("warn", `Run stopped: "${req.name}" failed and "Stop on failure" is on.`);
        break outer;
      }
      if (next === null) {
        store.log("info", `Run stopped by setNextRequest(null) in "${req.name}".`);
        break outer;
      }
      if (typeof next === "string") {
        const j = queue.findIndex((q) => q.req.name === next || q.req.id === next);
        if (j < 0) {
          store.log("warn", `setNextRequest("${next}"): no request with that name or id in this run; continuing in order.`);
          i++;
        } else i = j;
      } else i++;
      if (opts.delayMs > 0 && i < queue.length) await sleep(opts.delayMs, signal);
    }
    if (opts.delayMs > 0 && it < iterations - 1) await sleep(opts.delayMs, signal);
  }
  if (opts.persistVariables) commit();
  base.setCookies(base.cookies);
  summary.finishedAt = Date.now();
  onProgress({ ...summary });
  const s = stats(summary);
  store.log(s.failed || s.errors ? "warn" : "info", `Run finished: ${summary.name}: ${s.passed} passed, ${s.failed} failed, ${s.errors} errors in ${Math.round((summary.finishedAt - summary.startedAt) / 100) / 10} s`);
  return summary;
}

export function stats(s: RunSummary) {
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let errors = 0;
  let ms = 0;
  for (const r of s.results) {
    if (r.error) errors++;
    ms += r.ms ?? 0;
    for (const t of r.tests) {
      if (t.skipped) skipped++;
      else if (t.passed) passed++;
      else failed++;
    }
  }
  return { passed, failed, skipped, errors, requests: s.results.length, avgMs: s.results.length ? ms / s.results.length : 0, totalMs: (s.finishedAt ?? Date.now()) - s.startedAt };
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
  });
}

/* ------------------------------------------------------------------ data files */

/** CSV (RFC 4180: quotes, escaped quotes, newlines in quotes) or a JSON array of objects. */
export function parseDataFile(text: string, name: string): Record<string, string>[] {
  const t = text.replace(/^﻿/, "");
  if (/\.json$/i.test(name) || /^\s*\[/.test(t)) {
    const j = JSON.parse(t);
    if (!Array.isArray(j)) throw new Error("A JSON data file is an array of objects: [{ \"key\": \"value\" }, …].");
    return j.map((row) => Object.fromEntries(Object.entries(row ?? {}).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)])));
  }
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"' && t[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const [head, ...body] = rows.filter((r) => r.some((x) => x.trim()));
  if (!head) throw new Error("The CSV file is empty.");
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), r[i] ?? ""])));
}

/* ------------------------------------------------------------------ performance */

export type PerfOptions = { collectionId: string; order: string[]; vus: number; durationS: number; profile: "fixed" | "ramp" | "spike" | "peak"; envId: string | null; thinkMs: number };
export type PerfSecond = { t: number; vus: number; requests: number; errors: number; latencies: number[] };
export type PerfReport = { seconds: PerfSecond[]; perRequest: Record<string, { name: string; count: number; errors: number; latencies: number[] }>; startedAt: number; finishedAt?: number };

/** Virtual users at the chosen load profile; requests go out from this browser (never through our server). */
export async function runPerformance(opts: PerfOptions, onTick: (r: PerfReport) => void, signal: AbortSignal): Promise<PerfReport> {
  const store = useApi.getState();
  const collection = store.ws.collections.find((c) => c.id === opts.collectionId);
  if (!collection) throw new Error("That collection no longer exists.");
  const all = requestsIn(collection.items).filter(({ req }) => req.protocol === "http" || req.protocol === "graphql");
  const queue = opts.order.map((id) => all.find((r) => r.req.id === id)).filter((x): x is NonNullable<typeof x> => !!x);
  if (!queue.length) throw new Error("Pick at least one request.");
  const report: PerfReport = { seconds: [], perRequest: {}, startedAt: Date.now() };
  const start = performance.now();
  const end = start + opts.durationS * 1000;
  const target = (elapsedS: number): number => {
    const f = elapsedS / opts.durationS;
    if (opts.profile === "ramp") return Math.max(1, Math.ceil(opts.vus * Math.min(1, f / 0.3)));
    if (opts.profile === "spike") return f > 0.4 && f < 0.6 ? opts.vus : Math.max(1, Math.ceil(opts.vus / 5));
    if (opts.profile === "peak") return f < 0.25 ? Math.max(1, Math.ceil(opts.vus * (f / 0.25))) : f < 0.75 ? opts.vus : Math.max(1, Math.ceil(opts.vus * ((1 - f) / 0.25)));
    return opts.vus;
  };
  const bucket = (ms: number) => {
    const t = Math.floor((ms - start) / 1000);
    while (report.seconds.length <= t) report.seconds.push({ t: report.seconds.length, vus: 0, requests: 0, errors: 0, latencies: [] });
    return report.seconds[t];
  };
  let active = 0;
  const vu = async (n: number) => {
    let i = 0;
    while (!signal.aborted && performance.now() < end) {
      if (n >= target((performance.now() - start) / 1000)) {
        await sleep(250, signal);
        continue;
      }
      const { req, parents } = queue[i % queue.length];
      i++;
      const { env } = store.engineEnv({ collectionId: collection.id, itemId: req.id, envId: opts.envId, signal });
      env.forceAgent = "browser";
      env.log = () => undefined;
      env.net = () => undefined;
      env.parents = parents;
      const t0 = performance.now();
      let failed = false;
      try {
        const { response } = await execute(req, env);
        failed = !!response.error || response.status >= 400 || response.tests.some((t) => !t.passed && !t.skipped);
      } catch {
        failed = true;
      }
      const lat = performance.now() - t0;
      const b = bucket(performance.now());
      b.requests++;
      if (failed) b.errors++;
      b.latencies.push(lat);
      const pr = (report.perRequest[req.id] ??= { name: req.name, count: 0, errors: 0, latencies: [] });
      pr.count++;
      if (failed) pr.errors++;
      if (pr.latencies.length < 20000) pr.latencies.push(lat);
      if (opts.thinkMs) await sleep(opts.thinkMs, signal);
    }
  };
  const ticker = setInterval(() => {
    const b = bucket(performance.now());
    b.vus = Math.min(active, target((performance.now() - start) / 1000));
    onTick({ ...report, seconds: [...report.seconds] });
  }, 500);
  const vus = Array.from({ length: opts.vus }, (_, n) => {
    active++;
    return vu(n).finally(() => active--);
  });
  await Promise.all(vus);
  clearInterval(ticker);
  report.finishedAt = Date.now();
  onTick({ ...report });
  return report;
}

export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}
