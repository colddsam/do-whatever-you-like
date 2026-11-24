"use client";

import { useEffect, useMemo, useState } from "react";
import * as yaml from "js-yaml";
import { Activity, Bell, BookOpen, Download, ExternalLink, FileCode2, Layers, Play, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Monitor } from "../types";
import { downloadFile, fmtMs, relTime, safeName, uid } from "../lib/util";
import { runCollection, stats } from "../lib/runner";
import { collectionDocsHtml } from "../lib/docs";
import { LANGUAGES } from "../lib/codegen";
import { importText } from "../lib/importers";
import { requestsIn } from "../lib/util";
import { useApi } from "../store";
import { CodeEditor } from "./code-editor";
import { Btn, Empty, Input, Label, Note, Select, Toggle } from "./kit";

/* ------------------------------------------------------------------ monitors */

const runningMonitors = new Set<string>();

export async function runMonitor(m: Monitor) {
  if (runningMonitors.has(m.id)) return;
  runningMonitors.add(m.id);
  const s = useApi.getState();
  const c = s.ws.collections.find((x) => x.id === m.collectionId);
  if (!c) {
    runningMonitors.delete(m.id);
    return;
  }
  const t0 = Date.now();
  try {
    const run = await runCollection(
      { collectionId: c.id, folderId: m.folderId, order: requestsIn(c.items).filter(({ req }) => req.protocol === "http" || req.protocol === "graphql").map(({ req }) => req.id), iterations: 1, delayMs: 0, data: [], envId: m.envId ?? null, persistVariables: false, saveResponses: false, bail: false, source: "monitor", name: m.name },
      () => undefined,
      new AbortController().signal,
    );
    const st = stats(run);
    s.addRun(run);
    s.mutate((w) => ({
      ...w,
      monitors: w.monitors.map((x) => (x.id === m.id ? { ...x, lastRunAt: Date.now(), runs: [{ id: uid(), at: t0, ms: Date.now() - t0, passed: st.passed, failed: st.failed, errors: st.errors, requests: st.requests, avgMs: st.avgMs }, ...x.runs].slice(0, 200) } : x)),
    }));
    if ((st.failed || st.errors) && m.notify && typeof Notification !== "undefined" && Notification.permission === "granted")
      new Notification(`Monitor "${m.name}" failed`, { body: `${st.failed} failed tests, ${st.errors} errors in ${st.requests} requests.` });
  } finally {
    runningMonitors.delete(m.id);
  }
}

/** Runs due monitors while the tool is open. */
export function useMonitorScheduler() {
  useEffect(() => {
    const tick = () => {
      const { ws, loaded } = useApi.getState();
      if (!loaded) return;
      for (const m of ws.monitors) {
        if (!m.enabled) continue;
        const due = (m.lastRunAt ?? 0) + m.intervalMin * 60_000;
        if (Date.now() >= due) void runMonitor(m);
      }
    };
    const t = setInterval(tick, 20_000);
    const first = setTimeout(tick, 3000);
    return () => {
      clearInterval(t);
      clearTimeout(first);
    };
  }, []);
}

export function MonitorView({ id }: { id: string }) {
  const ws = useApi((s) => s.ws);
  const s = useApi.getState();
  const m = ws.monitors.find((x) => x.id === id);
  const [busy, setBusy] = useState(false);
  if (!m) return <Empty icon={Activity} title="This monitor was deleted" />;
  const set = (p: Partial<Monitor>) => s.mutate((w) => ({ ...w, monitors: w.monitors.map((x) => (x.id === id ? { ...x, ...p } : x)) }));
  const runs = m.runs.slice(0, 60).reverse();
  const maxMs = Math.max(1, ...runs.map((r) => r.avgMs));
  const health = m.runs.length ? Math.round((m.runs.filter((r) => !r.failed && !r.errors).length / m.runs.length) * 100) : null;
  return (
    <div className="h-full overflow-y-auto p-3 sm:p-4" data-lenis-prevent>
      <div className="max-w-3xl space-y-4">
        <input aria-label="Monitor name" value={m.name} onChange={(e) => set({ name: e.target.value })} className="w-full rounded-md bg-transparent px-1 text-lg font-semibold outline-none hover:bg-paper-2 focus:bg-surface" />
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="text-[13px]">Collection</span>
            <select value={m.collectionId} onChange={(e) => set({ collectionId: e.target.value })} className="h-8 w-full rounded-md border border-line bg-surface px-2 text-[13px]">
              {ws.collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[13px]">Environment</span>
            <select value={m.envId ?? ""} onChange={(e) => set({ envId: e.target.value || undefined })} className="h-8 w-full rounded-md border border-line bg-surface px-2 text-[13px]">
              <option value="">No environment</option>
              {ws.environments.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[13px]">Run every</span>
            <Select label="Interval" value={String(m.intervalMin)} onChange={(v) => set({ intervalMin: Number(v) })} options={[1, 5, 10, 15, 30, 60, 180, 360, 720, 1440].map((n) => ({ value: String(n), label: n < 60 ? `${n} minute${n === 1 ? "" : "s"}` : `${n / 60} hour${n === 60 ? "" : "s"}` }))} className="w-full" />
          </label>
        </div>
        <Toggle checked={m.enabled} onChange={(enabled) => set({ enabled })} label="Monitor is running" description="Runs while this tool is open in a browser tab (it can't run when the tab is closed)." />
        <Toggle
          checked={m.notify}
          onChange={async (notify) => {
            if (notify && typeof Notification !== "undefined" && Notification.permission === "default") await Notification.requestPermission();
            set({ notify });
          }}
          label="Notify me when a run fails"
          description="Uses your browser's notifications."
        />
        <div className="flex flex-wrap gap-2">
          <Btn
            variant="primary"
            icon={busy ? Square : Play}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await runMonitor(m);
              setBusy(false);
            }}
          >
            {busy ? "Running…" : "Run now"}
          </Btn>
          {health !== null && <span className={cn("inline-flex items-center gap-1.5 rounded-md border px-2.5 text-[13px]", health === 100 ? "border-success/40 text-success" : "border-danger/40 text-danger")}><Bell aria-hidden className="size-3.5" />{health}% of runs passed</span>}
        </div>
        {runs.length > 0 && (
          <figure>
            <Label>Average response time per run</Label>
            <div className="mt-1 flex h-28 items-end gap-0.5 rounded-md border border-line bg-surface p-2">
              {runs.map((r) => <span key={r.id} title={`${new Date(r.at).toLocaleString()} · ${Math.round(r.avgMs)} ms · ${r.failed} failed`} className={cn("min-w-[3px] flex-1 rounded-t-sm", r.failed || r.errors ? "bg-danger" : "bg-success")} style={{ height: `${Math.max(4, (r.avgMs / maxMs) * 100)}%` }} />)}
            </div>
          </figure>
        )}
        <div>
          <Label>Run history</Label>
          {!m.runs.length ? (
            <p className="mt-1 rounded-md border border-dashed border-line p-4 text-center text-[13px] text-ink-3">No runs yet.</p>
          ) : (
            <ul className="mt-1 divide-y divide-line rounded-md border border-line text-[13px]">
              {m.runs.slice(0, 50).map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-0.5 px-3 py-1.5">
                  <span className="w-40">{new Date(r.at).toLocaleString()}</span>
                  <span className="text-success">{r.passed} passed</span>
                  <span className={r.failed ? "text-danger" : "text-ink-3"}>{r.failed} failed</span>
                  <span className={r.errors ? "text-danger" : "text-ink-3"}>{r.errors} errors</span>
                  <span className="text-ink-3">{r.requests} requests · {fmtMs(r.ms)}</span>
                </li>
              ))}
            </ul>
          )}
          {m.lastRunAt && <p className="mt-1 text-[12px] text-ink-3">Last run {relTime(m.lastRunAt)}.</p>}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ API specs */

type SpecCheck = { ok: boolean; errors: string[]; warnings: string[]; paths: number; operations: number; title?: string };

function checkSpec(text: string): SpecCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  let doc: Record<string, unknown>;
  try {
    doc = (text.trim().startsWith("{") ? JSON.parse(text) : yaml.load(text)) as Record<string, unknown>;
  } catch (e) {
    return { ok: false, errors: [`Syntax: ${(e as Error).message.split("\n")[0]}`], warnings, paths: 0, operations: 0 };
  }
  if (!doc || typeof doc !== "object") return { ok: false, errors: ["The document is empty."], warnings, paths: 0, operations: 0 };
  const v3 = typeof doc.openapi === "string";
  if (!v3 && doc.swagger !== "2.0") errors.push('Missing "openapi: 3.x" (or "swagger: 2.0") at the top level.');
  const info = doc.info as Record<string, unknown> | undefined;
  if (!info) errors.push('Missing "info".');
  else {
    if (!info.title) errors.push('"info.title" is required.');
    if (!info.version) errors.push('"info.version" is required.');
  }
  const paths = (doc.paths ?? {}) as Record<string, Record<string, Record<string, unknown>>>;
  if (!doc.paths) errors.push('Missing "paths".');
  let operations = 0;
  const opIds = new Set<string>();
  for (const [p, item] of Object.entries(paths)) {
    if (!p.startsWith("/")) errors.push(`Path "${p}" must start with "/".`);
    const declared = [...p.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
    for (const [method, op] of Object.entries(item ?? {})) {
      if (!["get", "put", "post", "delete", "options", "head", "patch", "trace"].includes(method)) continue;
      operations++;
      if (!op?.responses) errors.push(`${method.toUpperCase()} ${p}: "responses" is required.`);
      if (op?.operationId) {
        if (opIds.has(String(op.operationId))) errors.push(`Duplicate operationId "${op.operationId}".`);
        opIds.add(String(op.operationId));
      }
      if (!op?.summary && !op?.description) warnings.push(`${method.toUpperCase()} ${p}: add a summary.`);
      const params = [...((item as Record<string, unknown>).parameters as { in: string; name: string }[] ?? []), ...((op?.parameters as { in: string; name: string }[]) ?? [])];
      for (const d of declared) if (!params.some((x) => x?.in === "path" && x?.name === d) && !params.some((x) => (x as unknown as { $ref?: string })?.$ref)) warnings.push(`${method.toUpperCase()} ${p}: path parameter "${d}" isn't declared.`);
    }
  }
  if (v3 && !Array.isArray(doc.servers)) warnings.push('No "servers": requests will use a relative base URL.');
  // Every local $ref must point somewhere.
  const refs = [...text.matchAll(/\$ref['"]?\s*:\s*['"]?(#\/[^'"\s,}]+)/g)].map((m) => m[1]);
  for (const r of new Set(refs)) {
    let cur: unknown = doc;
    for (const seg of r.slice(2).split("/")) cur = (cur as Record<string, unknown>)?.[seg.replace(/~1/g, "/").replace(/~0/g, "~")];
    if (cur === undefined) errors.push(`$ref ${r} doesn't point to anything.`);
  }
  return { ok: !errors.length, errors, warnings, paths: Object.keys(paths).length, operations, title: info?.title as string | undefined };
}

export function SpecView({ id }: { id: string }) {
  const spec = useApi((s) => s.ws.specs.find((x) => x.id === id));
  const s = useApi.getState();
  const [text, setText] = useState(spec?.content ?? "");
  const check = useMemo(() => checkSpec(text), [text]);
  useEffect(() => {
    if (!spec || text === spec.content) return;
    const t = setTimeout(() => s.mutate((w) => ({ ...w, specs: w.specs.map((x) => (x.id === id ? { ...x, content: text, updatedAt: Date.now(), format: text.trim().startsWith("{") ? "json" : "yaml" } : x)) })), 400);
    return () => clearTimeout(t);
  }, [text, spec, id, s]);
  if (!spec) return <Empty icon={FileCode2} title="This spec was deleted" />;
  const generate = () => {
    try {
      const res = importText(text);
      for (const c of res.collections) s.addCollection(c);
      s.notify(`Generated "${res.collections[0]?.name}" with ${requestsIn(res.collections[0]?.items ?? []).length} requests`, "success");
      if (res.collections[0]) s.openTab("collection", res.collections[0].id, res.collections[0].name);
    } catch (e) {
      s.notify((e as Error).message, "danger");
    }
  };
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <input aria-label="Spec name" value={spec.name} onChange={(e) => s.mutate((w) => ({ ...w, specs: w.specs.map((x) => (x.id === id ? { ...x, name: e.target.value } : x)) }))} className="min-w-0 flex-1 rounded-md bg-transparent px-1 text-[15px] font-semibold outline-none hover:bg-paper-2 focus:bg-surface" />
        <Btn variant="primary" icon={Layers} onClick={generate} disabled={!check.ok}>Generate collection</Btn>
        <Btn icon={Download} onClick={() => downloadFile(`${safeName(spec.name)}.${spec.format === "json" ? "json" : "yaml"}`, text, spec.format === "json" ? "application/json" : "application/yaml")}>Download</Btn>
      </div>
      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_300px]">
        <CodeEditor value={text} onChange={setText} language={spec.format === "json" ? "json" : "yaml"} className="min-h-[320px] lg:min-h-0" ariaLabel="OpenAPI spec" />
        <aside className="min-h-0 space-y-3 overflow-y-auto border-t border-line p-3 lg:border-l lg:border-t-0" data-lenis-prevent>
          <div className={cn("rounded-md border px-3 py-2 text-[13px]", check.ok ? "border-success/40 bg-success/5" : "border-danger/40 bg-danger/5")}>
            <p className="font-medium">{check.ok ? "Valid" : `${check.errors.length} problem${check.errors.length === 1 ? "" : "s"}`}</p>
            <p className="text-[12px] text-ink-3">{check.paths} paths · {check.operations} operations</p>
          </div>
          {check.errors.length > 0 && (
            <ul className="space-y-1 text-[12.5px] text-danger">
              {check.errors.map((e, i) => <li key={i}>• {e}</li>)}
            </ul>
          )}
          {check.warnings.length > 0 && (
            <div>
              <Label>Suggestions</Label>
              <ul className="mt-1 space-y-1 text-[12.5px] text-ink-2">
                {check.warnings.slice(0, 30).map((e, i) => <li key={i}>• {e}</li>)}
              </ul>
            </div>
          )}
          <Note>Generating a collection makes a request for every operation, with example bodies from the schemas and saved example responses, ready for a mock server.</Note>
        </aside>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ documentation */

export function DocsView({ collectionId }: { collectionId: string }) {
  const c = useApi((s) => s.ws.collections.find((x) => x.id === collectionId));
  const [lang, setLang] = useState("curl");
  const html = useMemo(() => (c ? collectionDocsHtml(c, lang) : ""), [c, lang]);
  if (!c) return <Empty icon={BookOpen} title="This collection was deleted" />;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold">{c.name} · Documentation</h2>
        <Select label="Example language" value={lang} onChange={setLang} options={LANGUAGES.map((l) => ({ value: l.id, label: l.label }))} />
        <Btn icon={Download} onClick={() => downloadFile(`${safeName(c.name)}-docs.html`, html, "text/html")}>Download HTML</Btn>
        <Btn
          icon={ExternalLink}
          onClick={() => {
            const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
            window.open(url, "_blank", "noopener");
            setTimeout(() => URL.revokeObjectURL(url), 60_000);
          }}
        >
          Open in new tab
        </Btn>
      </div>
      <iframe title={`${c.name} documentation`} sandbox="allow-same-origin allow-popups" srcDoc={html} className="min-h-0 flex-1 bg-paper" />
    </div>
  );
}

export { Input };
