"use client";

import { useMemo, useState } from "react";
import { Activity, BookOpen, Check, Download, Eye, EyeOff, Layers, Play, Server, Share2, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Variable } from "../types";
import { findNode, requestsIn, relTime, uid, variable, walk } from "../lib/util";
import { stats } from "../lib/runner";
import { useApi } from "../store";
import { AuthEditor } from "./auth-editor";
import { Btn, Check2, Empty, IconBtn, Input, Label, Note, SubTabs } from "./kit";
import { DocsEditor } from "./request-pane";
import { ScriptsEditor } from "./scripts-editor";
import { useVarInfo, VarInput, VarsContext } from "./var-input";

/* ------------------------------------------------------------------ variables table */

export function VarTable({ vars, onChange, note, hideCurrent }: { vars: Variable[]; onChange: (v: Variable[]) => void; note?: string; hideCurrent?: boolean }) {
  const [q, setQ] = useState("");
  const [reveal, setReveal] = useState<Record<string, boolean>>({});
  // A variable created by typing into the empty last row takes the focus, so typing carries on in it.
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const set = (id: string, p: Partial<Variable>) => onChange(vars.map((v) => (v.id === id ? { ...v, ...p } : v)));
  const shown = vars.filter((v) => !q || v.key.toLowerCase().includes(q.toLowerCase()));
  const cell = "border-b border-l border-line p-1 align-middle";
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter variables" aria-label="Filter variables" className="w-52" />
        {!hideCurrent && (
          <span className="ml-auto flex items-center gap-1">
            <Btn variant="ghost" onClick={() => onChange(vars.map((v) => ({ ...v, value: v.current ?? v.value, current: undefined })))} title="Copy every current value into the initial (shared) value">
              Persist All
            </Btn>
            <Btn variant="ghost" onClick={() => onChange(vars.map((v) => ({ ...v, current: undefined })))} title="Reset every current value to its initial value">
              Reset All
            </Btn>
          </span>
        )}
      </div>
      <div className="overflow-x-auto rounded-md border border-line" data-lenis-prevent>
        <table className="w-full min-w-[620px] border-collapse text-[13px]">
          <thead>
            <tr className="bg-paper text-left">
              <th className="w-8 border-b border-line px-2 py-1.5" />
              <th className="border-b border-l border-line px-2 py-1.5"><Label>Variable</Label></th>
              <th className="w-28 border-b border-l border-line px-2 py-1.5"><Label>Type</Label></th>
              <th className="border-b border-l border-line px-2 py-1.5" title="Exported and shared"><Label>{hideCurrent ? "Value" : "Initial value"}</Label></th>
              {!hideCurrent && <th className="border-b border-l border-line px-2 py-1.5" title="What requests use; local to this browser"><Label>Current value</Label></th>}
              <th className="w-9 border-b border-line" />
            </tr>
          </thead>
          <tbody>
            {shown.map((v) => {
              const secret = v.type === "secret" && !reveal[v.id];
              return (
                <tr key={v.id} className={cn("group", !v.enabled && "text-ink-3")}>
                  <td className="border-b border-line px-2"><Check2 checked={v.enabled} onChange={(x) => set(v.id, { enabled: x })} label="Enabled" /></td>
                  <td className={cell}><input aria-label="Variable name" autoFocus={justAdded === v.id} onFocus={(e) => e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length)} value={v.key} onChange={(e) => set(v.id, { key: e.target.value })} className="h-[30px] w-full rounded-md bg-transparent px-2 font-mono text-[12.5px] outline-none focus:bg-surface focus:ring-1 focus:ring-line" /></td>
                  <td className={cell}>
                    <select aria-label="Type" value={v.type} onChange={(e) => set(v.id, { type: e.target.value as Variable["type"] })} className="h-[30px] w-full rounded-md bg-transparent px-1.5 text-[12.5px] outline-none">
                      <option value="default">default</option>
                      <option value="secret">secret</option>
                    </select>
                  </td>
                  <td className={cell}>
                    <div className="flex items-center">
                      <VarInput ariaLabel="Initial value" value={v.value} onChange={(x) => set(v.id, { value: x })} type={secret ? "password" : undefined} className="flex-1 border-transparent bg-transparent" />
                      {v.type === "secret" && <IconBtn icon={reveal[v.id] ? EyeOff : Eye} label={reveal[v.id] ? "Hide" : "Show"} size="xs" onClick={() => setReveal((r) => ({ ...r, [v.id]: !r[v.id] }))} />}
                    </div>
                  </td>
                  {!hideCurrent && (
                    <td className={cell}>
                      <VarInput ariaLabel="Current value" value={v.current ?? v.value} onChange={(x) => set(v.id, { current: x })} type={secret ? "password" : undefined} className={cn("border-transparent bg-transparent", v.current !== undefined && v.current !== v.value && "[&_input]:font-semibold")} />
                    </td>
                  )}
                  <td className="border-b border-line px-0.5"><IconBtn icon={Trash2} label="Delete variable" size="xs" onClick={() => onChange(vars.filter((x) => x.id !== v.id))} className="opacity-60 group-hover:opacity-100" /></td>
                </tr>
              );
            })}
            <tr>
              <td />
              <td className="border-l border-line p-1" colSpan={hideCurrent ? 3 : 4}>
                <input aria-label="Add a variable" placeholder="Add a new variable" value="" onChange={(e) => {
                    const v = variable(e.target.value, "");
                    onChange([...vars, v]);
                    setJustAdded(v.id);
                  }} className="h-[30px] w-full bg-transparent px-2 font-mono text-[12.5px] outline-none placeholder:text-ink-3" />
              </td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-[12px] leading-relaxed text-ink-3">{note ?? "Initial values are what you export and share; current values are used by your requests and stay in this browser. Secret values are masked on screen."}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ collection & folder */

export function CollectionView({ id }: { id: string }) {
  const c = useApi((s) => s.ws.collections.find((x) => x.id === id));
  // Select the stored array (stable) and filter outside the selector: a fresh array per read loops forever.
  const allRuns = useApi((s) => s.ws.runs);
  const runs = useMemo(() => allRuns.filter((r) => r.collectionId === id), [allRuns, id]);
  const update = useApi((s) => s.updateCollection);
  const s = useApi.getState();
  const vars = useVarInfo(id);
  const [t, setT] = useState<"overview" | "auth" | "scripts" | "variables" | "runs">("overview");
  if (!c) return <Empty icon={Layers} title="This collection was deleted" />;
  const count = requestsIn(c.items).length;
  let folders = 0;
  walk(c.items, (n) => {
    if (n.kind === "folder") folders++;
  });
  return (
    <VarsContext.Provider value={vars}>
      <div className="flex h-full min-h-0 flex-col">
        <div className="shrink-0 border-b border-line px-3 py-3">
          <input aria-label="Collection name" value={c.name} onChange={(e) => update(id, (x) => ({ ...x, name: e.target.value }))} className="w-full rounded-md bg-transparent px-1 text-lg font-semibold tracking-[-0.01em] text-ink outline-none hover:bg-paper-2 focus:bg-surface" />
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Btn variant="primary" icon={Play} onClick={() => s.openTab("runner", c.id, `Runner · ${c.name}`)}>Run</Btn>
            <Btn icon={BookOpen} onClick={() => s.openTab("docs", c.id, `Docs · ${c.name}`)}>Docs</Btn>
            <Btn icon={Share2} onClick={() => s.setDialog({ type: "share", collectionId: c.id })}>Share</Btn>
            <Btn icon={Download} onClick={() => s.setDialog({ type: "export", collectionId: c.id })}>Export</Btn>
          </div>
        </div>
        <SubTabs value={t} onChange={setT} tabs={[{ id: "overview", label: "Overview" }, { id: "auth", label: "Authorization", dot: c.auth.type !== "noauth" }, { id: "scripts", label: "Scripts", dot: !!(c.scripts.prerequest.trim() || c.scripts.test.trim()) }, { id: "variables", label: "Variables", count: c.variables.length || undefined }, { id: "runs", label: "Runs", count: runs.length || undefined }]} />
        <div className="min-h-0 flex-1 overflow-y-auto p-3" data-lenis-prevent>
          {t === "overview" && (
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_240px]">
              <DocsEditor value={c.description} onChange={(description) => update(id, (x) => ({ ...x, description }))} placeholder="Describe this collection: what the API does, how to authenticate, where to start. Markdown works." />
              <dl className="h-fit divide-y divide-line rounded-md border border-line text-[13px]">
                {[
                  ["Requests", String(count)],
                  ["Folders", String(folders)],
                  ["Saved examples", String(requestsIn(c.items).reduce((n, r) => n + r.req.examples.length, 0))],
                  ["Created", new Date(c.createdAt).toLocaleDateString()],
                  ["Updated", relTime(c.updatedAt)],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between px-3 py-2">
                    <dt className="text-ink-3">{k}</dt>
                    <dd className="font-mono text-ink">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
          {t === "auth" && (
            <div className="space-y-3">
              <Note>Every request in this collection uses this authorization unless a folder or the request sets its own.</Note>
              <AuthEditor auth={c.auth} onChange={(auth) => update(id, (x) => ({ ...x, auth }))} parents={[]} collection={null} isCollection />
            </div>
          )}
          {t === "scripts" && <ScriptsEditor scripts={c.scripts} onChange={(scripts) => update(id, (x) => ({ ...x, scripts }))} collectionId={id} label="every request in this collection" />}
          {t === "variables" && <VarTable vars={c.variables} onChange={(variables) => update(id, (x) => ({ ...x, variables }))} note="Collection variables are shared by every request in this collection and travel with it when exported." />}
          {t === "runs" && (
            <div className="space-y-2">
              {!runs.length && <Empty icon={Activity} title="No runs yet" action={<Btn variant="primary" icon={Play} onClick={() => s.openTab("runner", c.id, `Runner · ${c.name}`)}>Run collection</Btn>}>Runs from the Collection Runner and monitors are kept here.</Empty>}
              {runs.map((r) => {
                const st = stats(r);
                return (
                  <button key={r.id} type="button" onClick={() => s.openTab("runner", `run:${r.id}`, `Run · ${r.name}`, { collectionId: c.id })} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-line px-3 py-2 text-left text-[13px] hover:border-ink-3">
                    <span className="font-medium">{new Date(r.startedAt).toLocaleString()}</span>
                    <span className="text-ink-3">{r.source}</span>
                    <span className="text-success">{st.passed} passed</span>
                    <span className={st.failed ? "text-danger" : "text-ink-3"}>{st.failed} failed</span>
                    <span className="text-ink-3">{st.requests} requests · avg {Math.round(st.avgMs)} ms</span>
                    {r.envName && <span className="text-ink-3">env: {r.envName}</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </VarsContext.Provider>
  );
}

export function FolderView({ collectionId, id }: { collectionId: string; id: string }) {
  const c = useApi((s) => s.ws.collections.find((x) => x.id === collectionId));
  const updateNode = useApi((s) => s.updateNode);
  const vars = useVarInfo(collectionId);
  const [t, setT] = useState<"overview" | "auth" | "scripts">("overview");
  const hit = c ? findNode(c.items, id) : null;
  if (!c || !hit || hit.node.kind !== "folder") return <Empty title="This folder was deleted" />;
  const f = hit.node;
  const set = (patch: Partial<typeof f>) => updateNode(collectionId, id, (n) => ({ ...n, ...patch }) as typeof f);
  return (
    <VarsContext.Provider value={vars}>
      <div className="flex h-full min-h-0 flex-col">
        <div className="shrink-0 border-b border-line px-3 py-3">
          <p className="font-mono text-[12px] text-ink-3">{[c.name, ...hit.parents.map((p) => p.name)].join(" / ")}</p>
          <input aria-label="Folder name" value={f.name} onChange={(e) => set({ name: e.target.value })} className="w-full rounded-md bg-transparent px-1 text-lg font-semibold text-ink outline-none hover:bg-paper-2 focus:bg-surface" />
          <div className="mt-2">
            <Btn variant="primary" icon={Play} onClick={() => useApi.getState().openTab("runner", `${collectionId}:${id}`, `Runner · ${f.name}`, { collectionId, itemId: id })}>Run folder</Btn>
          </div>
        </div>
        <SubTabs value={t} onChange={setT} tabs={[{ id: "overview", label: "Overview" }, { id: "auth", label: "Authorization", dot: f.auth.type !== "inherit" }, { id: "scripts", label: "Scripts", dot: !!(f.scripts.prerequest.trim() || f.scripts.test.trim()) }]} />
        <div className="min-h-0 flex-1 overflow-y-auto p-3" data-lenis-prevent>
          {t === "overview" && <DocsEditor value={f.description} onChange={(description) => set({ description })} />}
          {t === "auth" && <AuthEditor auth={f.auth} onChange={(auth) => set({ auth })} parents={hit.parents} collection={c} />}
          {t === "scripts" && <ScriptsEditor scripts={f.scripts} onChange={(scripts) => set({ scripts })} collectionId={collectionId} label="every request in this folder" />}
        </div>
      </div>
    </VarsContext.Provider>
  );
}

/* ------------------------------------------------------------------ environments, globals, vault */

export function EnvironmentView({ kind, id }: { kind: "environment" | "globals" | "vault"; id?: string }) {
  const ws = useApi((s) => s.ws);
  const s = useApi.getState();
  const settings = useApi((st) => st.settings);
  const vars = useVarInfo();
  const env = kind === "environment" ? ws.environments.find((e) => e.id === id) : undefined;
  if (kind === "environment" && !env) return <Empty title="This environment was deleted" />;
  return (
    <VarsContext.Provider value={vars}>
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-3">
          {env ? (
            <input aria-label="Environment name" value={env.name} onChange={(e) => s.updateEnvironment(env.id, (x) => ({ ...x, name: e.target.value }))} className="min-w-0 flex-1 rounded-md bg-transparent px-1 text-lg font-semibold text-ink outline-none hover:bg-paper-2 focus:bg-surface" />
          ) : (
            <h2 className="flex-1 px-1 text-lg font-semibold">{kind === "globals" ? "Globals" : "Vault"}</h2>
          )}
          {env && (
            <Btn variant={ws.activeEnvId === env.id ? "secondary" : "primary"} icon={Check} onClick={() => s.setActiveEnv(ws.activeEnvId === env.id ? null : env.id)}>
              {ws.activeEnvId === env.id ? "Active" : "Set active"}
            </Btn>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3" data-lenis-prevent>
          {kind === "environment" && env && <VarTable vars={env.values} onChange={(values) => s.updateEnvironment(env.id, (x) => ({ ...x, values }))} />}
          {kind === "globals" && <VarTable vars={ws.globals} onChange={(g) => s.setGlobals(g)} note="Globals are available to every request in this workspace, whatever environment is active." />}
          {kind === "vault" && (
            <div className="space-y-3">
              <Note>
                The vault holds secrets you don&apos;t want in collections or environments: reference them as <code className="font-mono">{"{{vault:name}}"}</code>. Vault values are never exported or shared, and stay in this browser.
              </Note>
              <VarTable vars={ws.vault.map((v) => ({ ...v, type: "secret" }))} onChange={(v) => s.setVault(v)} hideCurrent note="Scripts can read the vault with await pm.vault.get(name) when that's allowed below." />
              <label className="flex items-center gap-2 text-[13px]">
                <Check2 checked={settings.vaultInScripts} onChange={(v) => s.setSettings({ vaultInScripts: v })} label="Allow scripts to read the vault" /> Allow scripts to read and change vault secrets (pm.vault)
              </label>
            </div>
          )}
        </div>
      </div>
    </VarsContext.Provider>
  );
}

/* ------------------------------------------------------------------ mocks */

export function MockView({ id }: { id: string }) {
  const ws = useApi((s) => s.ws);
  const s = useApi.getState();
  const m = ws.mocks.find((x) => x.id === id);
  if (!m) return <Empty icon={Server} title="This mock server was deleted" />;
  const set = (p: Partial<typeof m>) => s.mutate((w) => ({ ...w, mocks: w.mocks.map((x) => (x.id === id ? { ...x, ...p } : x)) }));
  const url = `https://${m.id}.mock.local`;
  const c = ws.collections.find((x) => x.id === m.collectionId);
  const examples = c ? requestsIn(c.items).reduce((n, r) => n + r.req.examples.length, 0) : 0;
  return (
    <div className="h-full overflow-y-auto p-3 sm:p-4" data-lenis-prevent>
      <div className="max-w-3xl space-y-4">
        <input aria-label="Mock server name" value={m.name} onChange={(e) => set({ name: e.target.value })} className="w-full rounded-md bg-transparent px-1 text-lg font-semibold outline-none hover:bg-paper-2 focus:bg-surface" />
        <div className="rounded-lg border border-line bg-paper p-3">
          <Label>Mock server URL</Label>
          <div className="mt-1 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate font-mono text-[13px]">{url}</code>
            <Btn onClick={() => navigator.clipboard?.writeText(url).then(() => s.notify("Copied", "success"))}>Copy</Btn>
            <Btn
              variant="primary"
              onClick={() => {
                const env = { id: uid(), name: `${m.name} env`, values: [variable("url", url), variable("baseUrl", url)] };
                s.addEnvironment(env);
                s.setActiveEnv(env.id);
                s.notify(`Created and activated "${env.name}" with {{url}} and {{baseUrl}}`, "success");
              }}
            >
              Save as environment
            </Btn>
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-ink-3">
            Requests sent from this tool to that address are answered from the collection&apos;s saved examples (method and path must match; <code className="font-mono">:id</code> and <code className="font-mono">{"{{vars}}"}</code> in the example URL match anything). Pick a specific example with an <code className="font-mono">x-mock-response-name</code> or <code className="font-mono">x-mock-response-code</code> header. Dynamic variables like <code className="font-mono">{"{{$randomFullName}}"}</code> in example bodies get fresh values each time. The address works inside this tool only; it isn&apos;t on the public internet.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="text-[13px]">Collection</span>
            <select value={m.collectionId} onChange={(e) => set({ collectionId: e.target.value })} className="h-8 w-full rounded-md border border-line bg-surface px-2 text-[13px]">
              {ws.collections.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
            <span className="block text-[12px] text-ink-3">{examples} saved example{examples === 1 ? "" : "s"} to answer with.</span>
          </label>
          <label className="space-y-1">
            <span className="text-[13px]">Simulated delay (ms)</span>
            <Input type="number" min={0} max={30000} value={m.delayMs} onChange={(e) => set({ delayMs: Math.max(0, Math.min(30000, Number(e.target.value) || 0)) })} />
          </label>
        </div>
        {!examples && <Note tone="warning">This collection has no saved examples yet. Send a request, then use <b>Save as example</b> on its response.</Note>}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <Label>Call log</Label>
            <Btn variant="ghost" onClick={() => set({ log: [] })} disabled={!m.log.length}>Clear</Btn>
          </div>
          {!m.log.length ? (
            <p className="rounded-md border border-dashed border-line p-4 text-center text-[13px] text-ink-3">No calls yet.</p>
          ) : (
            <ul className="divide-y divide-line rounded-md border border-line font-mono text-[12px]">
              {m.log.map((l, i) => (
                <li key={i} className="flex flex-wrap items-center gap-3 px-3 py-1.5">
                  <span className="text-ink-3">{new Date(l.at).toLocaleTimeString()}</span>
                  <span className="font-semibold">{l.method}</span>
                  <span className="min-w-0 flex-1 truncate">{l.path}</span>
                  <span className={l.status < 400 ? "text-success" : "text-danger"}>{l.status}</span>
                  <span className="text-ink-3">{l.example ?? "no match"}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

