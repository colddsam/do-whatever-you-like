"use client";

import { useRef, useState } from "react";
import { ArrowDown, ArrowUp, ChevronRight, Download, FileUp, Gauge, Play, RotateCcw, Square, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RunSummary } from "../types";
import { findNode, fmtBytes, fmtMs, downloadFile, requestsIn, safeName } from "../lib/util";
import { parseDataFile, percentile, runCollection, runPerformance, stats, type PerfReport } from "../lib/runner";
import { useApi } from "../store";
import { Btn, Check2, Empty, IconBtn, Input, Label, MethodTag, Note, Segmented, Select, Toggle } from "./kit";

export function RunnerView({ target, refCollection }: { target: string; refCollection?: string }) {
  const ws = useApi((s) => s.ws);
  const pastId = target.startsWith("run:") ? target.slice(4) : null;
  const past = pastId ? ws.runs.find((r) => r.id === pastId) : null;
  const [collectionId, folderId] = pastId ? [refCollection ?? past?.collectionId ?? "", undefined] : target.split(":");
  const collection = ws.collections.find((c) => c.id === collectionId);
  const scope = folderId && collection ? findNode(collection.items, folderId)?.node : null;
  const items = collection ? requestsIn(scope && scope.kind === "folder" ? scope.items : collection.items).filter(({ req }) => req.protocol === "http" || req.protocol === "graphql") : [];
  const [mode, setMode] = useState<"functional" | "performance">("functional");
  const [order, setOrder] = useState<string[]>(() => items.map((i) => i.req.id));
  const [checked, setChecked] = useState<Record<string, boolean>>(() => Object.fromEntries(items.map((i) => [i.req.id, true])));
  const [iterations, setIterations] = useState(1);
  const [delay, setDelay] = useState(0);
  const [data, setData] = useState<{ name: string; rows: Record<string, string>[] } | null>(null);
  const [dataErr, setDataErr] = useState<string | null>(null);
  // "active" follows the environment picked in the top bar; anything else is this run's own choice.
  const [envChoice, setEnvChoice] = useState<string>("active");
  const envId = envChoice === "active" ? ws.activeEnvId : envChoice || null;
  const activeName = ws.environments.find((e) => e.id === ws.activeEnvId)?.name;
  const [persist, setPersist] = useState(true);
  const [saveResponses, setSaveResponses] = useState(true);
  const [bail, setBail] = useState(false);
  const [run, setRun] = useState<RunSummary | null>(past ?? null);
  const [running, setRunning] = useState(false);
  const ctrl = useRef<AbortController | null>(null);
  const file = useRef<HTMLInputElement>(null);

  if (!collection) return <Empty title="This collection no longer exists" />;

  // Keep the order list in step with the collection (new or deleted requests).
  const known = new Set(items.map((i) => i.req.id));
  const ordered = [...order.filter((id) => known.has(id)), ...items.map((i) => i.req.id).filter((id) => !order.includes(id))];
  const byId = new Map(items.map((i) => [i.req.id, i]));
  const move = (id: string, d: -1 | 1) => {
    const i = ordered.indexOf(id);
    const j = i + d;
    if (j < 0 || j >= ordered.length) return;
    const next = [...ordered];
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next);
  };

  const start = async () => {
    ctrl.current = new AbortController();
    setRunning(true);
    try {
      const result = await runCollection(
        {
          collectionId: collection.id,
          folderId,
          order: ordered.filter((id) => checked[id] !== false),
          iterations,
          delayMs: delay,
          data: data?.rows ?? [],
          envId,
          persistVariables: persist,
          saveResponses,
          bail,
        },
        setRun,
        ctrl.current.signal,
      );
      useApi.getState().addRun(result);
    } catch (e) {
      useApi.getState().notify((e as Error).message, "danger");
    } finally {
      setRunning(false);
    }
  };

  if (run && (running || pastId || run.finishedAt)) return <RunResults run={run} running={running} onStop={() => ctrl.current?.abort()} onAgain={pastId ? undefined : start} onNew={pastId ? undefined : () => setRun(null)} />;

  return (
    <div className="h-full overflow-y-auto" data-lenis-prevent>
      <div className="grid gap-4 p-3 sm:p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
        <section className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h2 className="text-[15px] font-semibold">Run order</h2>
            <span className="text-[13px] text-ink-3">{scope ? `${collection.name} / ${scope.name}` : collection.name}</span>
            <span className="ml-auto flex gap-1">
              <Btn variant="ghost" onClick={() => setChecked(Object.fromEntries(items.map((i) => [i.req.id, true])))}>Select all</Btn>
              <Btn variant="ghost" onClick={() => setChecked(Object.fromEntries(items.map((i) => [i.req.id, false])))}>Deselect all</Btn>
              <Btn variant="ghost" icon={RotateCcw} onClick={() => setOrder(items.map((i) => i.req.id))}>Reset</Btn>
            </span>
          </div>
          {!items.length && <Note>There are no HTTP requests here to run.</Note>}
          <ol className="divide-y divide-line rounded-md border border-line">
            {ordered.map((id, i) => {
              const it = byId.get(id)!;
              return (
                <li key={id} className={cn("flex items-center gap-2 px-2 py-1.5", checked[id] === false && "opacity-50")}>
                  <Check2 checked={checked[id] !== false} onChange={(v) => setChecked((c) => ({ ...c, [id]: v }))} label={`Run ${it.req.name}`} />
                  <span className="w-6 text-right font-mono text-[12px] text-ink-3">{i + 1}</span>
                  <MethodTag method={it.req.method} protocol={it.req.protocol} />
                  <span className="min-w-0 flex-1 truncate text-[13px]">
                    {it.parents.length > 0 && <span className="text-ink-3">{it.parents.map((p) => p.name).join(" / ")} / </span>}
                    {it.req.name}
                  </span>
                  <IconBtn icon={ArrowUp} label="Move up" size="xs" onClick={() => move(id, -1)} disabled={i === 0} />
                  <IconBtn icon={ArrowDown} label="Move down" size="xs" onClick={() => move(id, 1)} disabled={i === ordered.length - 1} />
                </li>
              );
            })}
          </ol>
        </section>
        <section className="h-fit space-y-4 rounded-lg border border-line bg-paper p-3">
          <Segmented label="Run type" value={mode} onChange={setMode} options={[{ value: "functional", label: "Functional" }, { value: "performance", label: "Performance" }]} className="w-full [&>button]:flex-1" />
          <label className="block space-y-1">
            <span className="text-[13px]">Environment</span>
            <Select label="Environment" value={envChoice} onChange={setEnvChoice} options={[{ value: "active", label: activeName ? `Active: ${activeName}` : "Active: no environment" }, { value: "", label: "No environment" }, ...ws.environments.map((e) => ({ value: e.id, label: e.name }))]} className="w-full" />
          </label>
          {mode === "functional" ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1">
                  <span className="text-[13px]">Iterations</span>
                  <Input type="number" min={1} max={10000} value={iterations} onChange={(e) => setIterations(Math.max(1, Math.min(10000, Number(e.target.value) || 1)))} />
                </label>
                <label className="space-y-1">
                  <span className="text-[13px]">Delay (ms)</span>
                  <Input type="number" min={0} max={60000} value={delay} onChange={(e) => setDelay(Math.max(0, Math.min(60000, Number(e.target.value) || 0)))} />
                </label>
              </div>
              <div className="space-y-1">
                <span className="text-[13px]">Data file</span>
                <input
                  ref={file}
                  type="file"
                  accept=".csv,.json,text/csv,application/json"
                  className="sr-only"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (!f) return;
                    try {
                      const rows = parseDataFile(await f.text(), f.name);
                      setData({ name: f.name, rows });
                      setIterations(Math.max(1, rows.length));
                      setDataErr(null);
                    } catch (err) {
                      setDataErr((err as Error).message);
                    }
                  }}
                />
                {data ? (
                  <div className="space-y-1.5 rounded-md border border-line bg-surface p-2">
                    <div className="flex items-center gap-2 text-[13px]">
                      <span className="min-w-0 flex-1 truncate">{data.name}</span>
                      <span className="text-ink-3">{data.rows.length} rows</span>
                      <IconBtn icon={X} label="Remove data file" size="xs" onClick={() => setData(null)} />
                    </div>
                    <div className="max-h-40 overflow-auto" data-lenis-prevent>
                      <table className="w-full text-[12px]">
                        <thead>
                          <tr>{Object.keys(data.rows[0] ?? {}).map((k) => <th key={k} className="border-b border-line px-1.5 py-1 text-left font-mono">{k}</th>)}</tr>
                        </thead>
                        <tbody>
                          {data.rows.slice(0, 20).map((r, i) => (
                            <tr key={i}>{Object.values(r).map((v, j) => <td key={j} className="max-w-[120px] truncate border-b border-line px-1.5 py-0.5 font-mono text-ink-2">{v}</td>)}</tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="text-[12px] text-ink-3">Use columns as {"{{column}}"} or pm.iterationData.get(&quot;column&quot;).</p>
                  </div>
                ) : (
                  <Btn icon={FileUp} onClick={() => file.current?.click()} className="w-full">Select CSV or JSON</Btn>
                )}
                {dataErr && <p className="text-[12px] text-danger">{dataErr}</p>}
              </div>
              <Toggle checked={persist} onChange={setPersist} label="Persist variables" description="Keep the values scripts set after the run ends." />
              <Toggle checked={saveResponses} onChange={setSaveResponses} label="Save responses" description="Keep bodies and headers to inspect afterwards." />
              <Toggle checked={bail} onChange={setBail} label="Stop on first failure" description="End the run when a request errors or a test fails." />
              <Btn variant="primary" size="md" icon={Play} onClick={start} disabled={!ordered.some((id) => checked[id] !== false)} className="w-full">
                Run {collection.name}
              </Btn>
            </>
          ) : (
            <PerformanceSetup collectionId={collection.id} order={ordered.filter((id) => checked[id] !== false)} envId={envId} />
          )}
        </section>
      </div>
    </div>
  );
}

function RunResults({ run, running, onStop, onAgain, onNew }: { run: RunSummary; running: boolean; onStop: () => void; onAgain?: () => void; onNew?: () => void }) {
  const [f, setF] = useState<"all" | "passed" | "failed" | "errors">("all");
  const [open, setOpen] = useState<string | null>(null);
  const st = stats(run);
  const list = run.results.filter((r) => (f === "all" ? true : f === "errors" ? !!r.error : f === "failed" ? r.tests.some((t) => !t.passed && !t.skipped) : r.tests.length > 0 && r.tests.every((t) => t.passed || t.skipped) && !r.error));
  const byIteration = new Map<number, typeof list>();
  for (const r of list) byIteration.set(r.iteration, [...(byIteration.get(r.iteration) ?? []), r]);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-3 border-b border-line p-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[15px] font-semibold">{run.name}</h2>
          {running ? <span className="inline-flex items-center gap-1.5 text-[13px] text-accent"><span className="size-1.5 animate-pulse rounded-full bg-accent" /> Running…</span> : <span className="text-[13px] text-ink-3">{run.stopped ? "Stopped" : "Finished"} · {new Date(run.startedAt).toLocaleString()}</span>}
          <span className="ml-auto flex gap-1.5">
            {running ? (
              <Btn icon={Square} onClick={onStop}>Stop</Btn>
            ) : (
              <>
                {onAgain && <Btn variant="primary" icon={Play} onClick={onAgain}>Run again</Btn>}
                {onNew && <Btn onClick={onNew}>New run</Btn>}
                <Btn icon={Download} onClick={() => downloadFile(`${safeName(run.name)}.run.json`, JSON.stringify({ ...run, stats: st }, null, 2))}>Export results</Btn>
              </>
            )}
          </span>
        </div>
        <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-md border border-line bg-line text-center sm:grid-cols-6">
          {[
            ["Iterations", String(run.iterations)],
            ["Duration", fmtMs(st.totalMs)],
            ["Requests", String(st.requests)],
            ["Passed", String(st.passed)],
            ["Failed", String(st.failed)],
            ["Avg. time", fmtMs(st.avgMs)],
          ].map(([k, v]) => (
            <div key={k} className="bg-surface px-2 py-2">
              <dt className="text-[12px] text-ink-3">{k}</dt>
              <dd className={cn("font-mono text-[15px] font-semibold", k === "Failed" && st.failed ? "text-danger" : k === "Passed" ? "text-success" : "text-ink")}>{v}</dd>
            </div>
          ))}
        </dl>
        <Segmented label="Filter results" value={f} onChange={setF} options={[{ value: "all", label: "All" }, { value: "passed", label: "Passed" }, { value: "failed", label: "Failed" }, { value: "errors", label: `Errors (${st.errors})` }]} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto" data-lenis-prevent>
        {[...byIteration].map(([it, rows]) => (
          <section key={it}>
            {run.iterations > 1 && <h3 className="sticky top-0 z-[1] bg-paper px-3 py-1 font-mono text-[12px] uppercase tracking-[0.08em] text-ink-3">Iteration {it + 1}</h3>}
            {rows.map((r) => {
              const failed = r.tests.filter((t) => !t.passed && !t.skipped).length;
              const isOpen = open === r.id;
              return (
                <div key={r.id} className="border-b border-line">
                  <button type="button" onClick={() => setOpen(isOpen ? null : r.id)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left hover:bg-paper">
                    <ChevronRight aria-hidden className={cn("size-3.5 shrink-0 text-ink-3 transition-transform", isOpen && "rotate-90")} />
                    <MethodTag method={r.method} />
                    <span className="min-w-0 flex-1 truncate text-[13px]">{r.name}</span>
                    {r.error ? <span className="text-[12px] text-danger">{r.error.slice(0, 60)}</span> : (
                      <span className="flex items-center gap-3 font-mono text-[12px]">
                        <span className={(r.status ?? 0) < 400 ? "text-success" : "text-danger"}>{r.status} {r.statusText}</span>
                        <span className="text-ink-3">{fmtMs(r.ms)}</span>
                        <span className="text-ink-3">{fmtBytes(r.size)}</span>
                      </span>
                    )}
                    {r.tests.length > 0 && <span className={cn("rounded-sm px-1.5 font-mono text-[12px]", failed ? "bg-danger/12 text-danger" : "bg-success/12 text-success")}>{r.tests.length - failed}/{r.tests.length}</span>}
                  </button>
                  {isOpen && (
                    <div className="space-y-2 bg-paper/50 px-9 pb-3">
                      <p className="break-all font-mono text-[12px] text-ink-3">{r.url}</p>
                      {r.tests.map((t, i) => (
                        <p key={i} className="text-[12.5px]">
                          <span className={cn("mr-2 font-mono font-semibold", t.skipped ? "text-ink-3" : t.passed ? "text-success" : "text-danger")}>{t.skipped ? "SKIP" : t.passed ? "PASS" : "FAIL"}</span>
                          {t.name}
                          {t.error && <span className="block pl-11 font-mono text-[12px] text-danger">{t.error}</span>}
                        </p>
                      ))}
                      {r.responseBody !== undefined && (
                        <pre className="max-h-64 overflow-auto rounded-md border border-line bg-surface p-2 font-mono text-[12px]" data-lenis-prevent>{r.responseBody.slice(0, 20000) || "(empty body)"}</pre>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        ))}
        {!list.length && <p className="p-6 text-center text-[13px] text-ink-3">{running ? "Waiting for the first response…" : "Nothing matches this filter."}</p>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ performance */

function PerformanceSetup({ collectionId, order, envId }: { collectionId: string; order: string[]; envId: string | null }) {
  const [vus, setVus] = useState(10);
  const [duration, setDuration] = useState(60);
  const [profile, setProfile] = useState<"fixed" | "ramp" | "spike" | "peak">("fixed");
  const [think, setThink] = useState(0);
  const [report, setReport] = useState<PerfReport | null>(null);
  const [running, setRunning] = useState(false);
  const ctrl = useRef<AbortController | null>(null);
  const go = async () => {
    ctrl.current = new AbortController();
    setRunning(true);
    try {
      await runPerformance({ collectionId, order, vus, durationS: duration, profile, envId, thinkMs: think }, setReport, ctrl.current.signal);
    } catch (e) {
      useApi.getState().notify((e as Error).message, "danger");
    } finally {
      setRunning(false);
    }
  };
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1">
          <span className="text-[13px]">Virtual users</span>
          <Input type="number" min={1} max={50} value={vus} onChange={(e) => setVus(Math.max(1, Math.min(50, Number(e.target.value) || 1)))} />
        </label>
        <label className="space-y-1">
          <span className="text-[13px]">Duration (s)</span>
          <Input type="number" min={5} max={600} value={duration} onChange={(e) => setDuration(Math.max(5, Math.min(600, Number(e.target.value) || 5)))} />
        </label>
      </div>
      <label className="block space-y-1">
        <span className="text-[13px]">Load profile</span>
        <Select label="Load profile" value={profile} onChange={setProfile} options={[{ value: "fixed", label: "Fixed: all users from the start" }, { value: "ramp", label: "Ramp up over the first 30%" }, { value: "spike", label: "Spike in the middle" }, { value: "peak", label: "Peak: ramp up, hold, ramp down" }]} className="w-full" />
      </label>
      <label className="block space-y-1">
        <span className="text-[13px]">Think time between requests (ms)</span>
        <Input type="number" min={0} max={10000} value={think} onChange={(e) => setThink(Math.max(0, Math.min(10000, Number(e.target.value) || 0)))} />
      </label>
      <Note>Load tests run from this browser (Browser agent), never through our server, so the target must allow CORS. Only test APIs you own or are allowed to load-test.</Note>
      {running ? (
        <Btn icon={Square} size="md" onClick={() => ctrl.current?.abort()} className="w-full">Stop</Btn>
      ) : (
        <Btn variant="primary" size="md" icon={Gauge} onClick={go} disabled={!order.length} className="w-full">Run performance test</Btn>
      )}
      {report && <PerfReportView report={report} running={running} duration={duration} />}
    </div>
  );
}

function LineChart({ series, height = 110, label }: { series: { name: string; values: number[]; className: string }[]; height?: number; label: string }) {
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const n = Math.max(2, ...series.map((s) => s.values.length));
  const w = 300;
  return (
    <figure>
      <svg viewBox={`0 0 ${w} ${height}`} className="h-[110px] w-full rounded-md border border-line bg-surface" role="img" aria-label={label} preserveAspectRatio="none">
        {[0.25, 0.5, 0.75].map((g) => <line key={g} x1={0} x2={w} y1={height * g} y2={height * g} className="stroke-line" strokeWidth={0.5} />)}
        {series.map((s) => (
          <polyline key={s.name} fill="none" strokeWidth={1.5} vectorEffect="non-scaling-stroke" className={s.className} points={s.values.map((v, i) => `${(i / (n - 1)) * w},${height - (v / max) * (height - 6) - 3}`).join(" ")} />
        ))}
      </svg>
      <figcaption className="mt-1 flex flex-wrap gap-x-3 text-[12px] text-ink-3">
        <span>{label} · max {Math.round(max)}</span>
        {series.map((s) => <span key={s.name} className="inline-flex items-center gap-1"><span className={cn("h-0.5 w-3", s.className.replace("stroke-", "bg-"))} />{s.name}</span>)}
      </figcaption>
    </figure>
  );
}

function PerfReportView({ report, running, duration }: { report: PerfReport; running: boolean; duration: number }) {
  const secs = report.seconds;
  const all = secs.flatMap((s) => s.latencies);
  const total = secs.reduce((n, s) => n + s.requests, 0);
  const errors = secs.reduce((n, s) => n + s.errors, 0);
  // While running, the per-second buckets are the clock.
  const elapsed = report.finishedAt ? (report.finishedAt - report.startedAt) / 1000 : secs.length;
  return (
    <div className="space-y-3 border-t border-line pt-3">
      <div className="flex items-center gap-2 text-[13px]">
        <Label>{running ? `Running · ${Math.min(duration, Math.round(elapsed))}/${duration} s` : "Finished"}</Label>
      </div>
      <dl className="grid grid-cols-2 gap-2 text-[12px]">
        {[
          ["Total requests", String(total)],
          ["Throughput", `${(total / Math.max(1, elapsed)).toFixed(1)} req/s`],
          ["Avg. response", fmtMs(all.length ? all.reduce((a, b) => a + b, 0) / all.length : 0)],
          ["P90", fmtMs(percentile(all, 90))],
          ["P95", fmtMs(percentile(all, 95))],
          ["Error rate", `${total ? ((errors / total) * 100).toFixed(1) : "0.0"}%`],
        ].map(([k, v]) => (
          <div key={k} className="rounded-md border border-line bg-surface px-2 py-1.5">
            <dt className="text-ink-3">{k}</dt>
            <dd className="font-mono text-[14px] font-semibold">{v}</dd>
          </div>
        ))}
      </dl>
      <LineChart label="Response time (ms)" series={[{ name: "avg", values: secs.map((s) => (s.latencies.length ? s.latencies.reduce((a, b) => a + b, 0) / s.latencies.length : 0)), className: "stroke-ink" }, { name: "p90", values: secs.map((s) => percentile(s.latencies, 90)), className: "stroke-accent" }]} />
      <LineChart label="Requests per second" series={[{ name: "requests", values: secs.map((s) => s.requests), className: "stroke-success" }, { name: "errors", values: secs.map((s) => s.errors), className: "stroke-danger" }]} />
      <LineChart label="Virtual users" series={[{ name: "users", values: secs.map((s) => s.vus), className: "stroke-ink-2" }]} />
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-left text-ink-3">{["Request", "Count", "Avg", "P90", "P99", "Errors"].map((h) => <th key={h} className="border-b border-line px-1.5 py-1 font-normal">{h}</th>)}</tr>
          </thead>
          <tbody>
            {Object.values(report.perRequest).map((r) => (
              <tr key={r.name}>
                <td className="max-w-[120px] truncate border-b border-line px-1.5 py-1">{r.name}</td>
                <td className="border-b border-line px-1.5 py-1 font-mono">{r.count}</td>
                <td className="border-b border-line px-1.5 py-1 font-mono">{Math.round(r.latencies.reduce((a, b) => a + b, 0) / Math.max(1, r.latencies.length))}</td>
                <td className="border-b border-line px-1.5 py-1 font-mono">{Math.round(percentile(r.latencies, 90))}</td>
                <td className="border-b border-line px-1.5 py-1 font-mono">{Math.round(percentile(r.latencies, 99))}</td>
                <td className={cn("border-b border-line px-1.5 py-1 font-mono", r.errors > 0 && "text-danger")}>{r.errors}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
