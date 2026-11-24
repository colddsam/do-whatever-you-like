"use client";

import { useMemo, useRef, useState } from "react";
import { Activity, BookOpen, Box, Cable, Download, FileCode2, FileUp, Folder as FolderIcon, Globe2, Layers, Link2, Loader2, Plus, Radio, Server, Trash2, Upload, Workflow, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Collection, Cookie, Protocol, TreeNode } from "../types";
import { importText, type ImportResult } from "../lib/importers";
import { collectionToPostman, environmentToPostman, globalsToPostman } from "../lib/postman-format";
import { collectionToOpenApi, workspaceBackup } from "../lib/exporters";
import { collectionDocsHtml } from "../lib/docs";
import { shareLink } from "../lib/share";
import { parseSetCookie, toSetCookie } from "../lib/cookies";
import { downloadFile, findNode, newCollection, requestsIn, safeName, uid } from "../lib/util";
import { sendRaw } from "../lib/engine";
import { DEFAULT_SETTINGS, useApi, type Dialog } from "../store";
import { QuickSearch } from "./palette";
import { Btn, copyText, Input, Label, Modal, Note, Segmented, Select, Textarea, Toggle } from "./kit";

export function Dialogs() {
  const dialog = useApi((s) => s.dialog);
  const close = () => useApi.getState().setDialog(null);
  if (!dialog) return null;
  switch (dialog.type) {
    case "import":
      return <ImportDialog initial={dialog.text} onClose={close} />;
    case "export":
      return <ExportDialog collectionId={dialog.collectionId} onClose={close} />;
    case "share":
      return <ShareDialog collectionId={dialog.collectionId} itemId={dialog.itemId} onClose={close} />;
    case "save":
      return <SaveDialog tabId={dialog.tabId} onClose={close} />;
    case "cookies":
      return <CookiesDialog onClose={close} />;
    case "settings":
      return <SettingsDialog onClose={close} />;
    case "shortcuts":
      return <ShortcutsDialog onClose={close} />;
    case "new":
      return <NewDialog onClose={close} />;
    case "workspaces":
      return <WorkspacesDialog onClose={close} />;
    case "confirm":
      return <ConfirmDialog d={dialog} onClose={close} />;
    case "search":
      return <QuickSearch onClose={close} />;
  }
}

/* ------------------------------------------------------------------ import */

function parse(name: string, content: string): { name: string; res?: ImportResult; error?: string } {
  try {
    return { name, res: importText(content, name) };
  } catch (e) {
    return { name, error: (e as Error).message };
  }
}

function ImportDialog({ initial, onClose }: { initial?: string; onClose: () => void }) {
  const [mode, setMode] = useState<"file" | "text" | "link">(initial ? "text" : "file");
  const [text, setText] = useState(initial ?? "");
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  // Text handed in (a share link, a restored backup) is checked straight away, so its contents show before importing.
  const [results, setResults] = useState<{ name: string; res?: ImportResult; error?: string }[]>(() => (initial?.trim() ? [parse("Shared content", initial)] : []));
  const [drag, setDrag] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const s = useApi.getState();
  const fromFiles = async (files: FileList | File[]) => {
    const out = [];
    for (const f of Array.from(files)) {
      if (f.size > 25 * 1024 * 1024) out.push({ name: f.name, error: "Files over 25 MB can't be imported here." });
      else out.push(parse(f.name, await f.text()));
    }
    setResults(out);
  };
  const fromLink = async () => {
    setBusy(true);
    try {
      const res = await sendRaw({ method: "GET", url: link.trim(), headers: [["Accept", "application/json, application/yaml, text/yaml, */*"]], body: null }, s.settings);
      if (res.status >= 400) throw new Error(`The link answered ${res.status}.`);
      setResults([parse(link, new TextDecoder().decode(res.body))]);
    } catch (e) {
      setResults([{ name: link, error: (e as Error).message }]);
    } finally {
      setBusy(false);
    }
  };
  const confirm = () => {
    let first: { kind: "collection" | "environment"; id: string; name: string } | null = null;
    let n = 0;
    for (const r of results) {
      if (!r.res) continue;
      if (r.res.workspace) {
        const w = r.res.workspace;
        s.mutate((ws) => ({
          ...ws,
          collections: [...ws.collections, ...(w.collections ?? [])],
          environments: [...ws.environments, ...(w.environments ?? [])],
          globals: [...ws.globals, ...(w.globals ?? []).filter((g) => !ws.globals.some((x) => x.key === g.key))],
          mocks: [...ws.mocks, ...(w.mocks ?? [])],
          monitors: [...ws.monitors, ...(w.monitors ?? [])],
          flows: [...ws.flows, ...(w.flows ?? [])],
          specs: [...ws.specs, ...(w.specs ?? [])],
        }));
        n += (w.collections?.length ?? 0) + (w.environments?.length ?? 0);
        continue;
      }
      for (const c of r.res.collections) {
        s.addCollection(c);
        first ??= { kind: "collection", id: c.id, name: c.name };
        n++;
      }
      for (const e of r.res.environments) {
        s.addEnvironment(e);
        first ??= { kind: "environment", id: e.id, name: e.name };
        n++;
      }
      for (const req of r.res.requests) {
        s.newRequestTab(req.protocol, req);
        n++;
      }
    }
    if (first) {
      s.openTab(first.kind, first.id, first.name);
      s.setPrefs({ sidebar: first.kind === "collection" ? "collections" : "environments" });
    }
    s.notify(`Imported ${n} item${n === 1 ? "" : "s"}`, "success");
    onClose();
  };
  const ok = results.filter((r) => r.res);

  return (
    <Modal
      title="Import"
      onClose={onClose}
      wide
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" onClick={confirm} disabled={!ok.length}>
            Import {ok.length ? `(${ok.length})` : ""}
          </Btn>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-[13px] text-ink-2">Postman collections (v1, v2.0, v2.1), environments and data dumps · OpenAPI 3 and Swagger 2 (JSON or YAML) · HAR · Insomnia · cURL commands · this tool&apos;s backups.</p>
        <Segmented label="Import from" value={mode} onChange={(m) => { setMode(m); setResults([]); }} options={[{ value: "file", label: "Files" }, { value: "text", label: "Raw text / cURL" }, { value: "link", label: "Link" }]} />
        {mode === "file" && (
          <div
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); void fromFiles(e.dataTransfer.files); }}
            className={cn("flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-10 text-center transition-colors", drag ? "border-ink bg-ink text-paper" : "border-ink-3/50 bg-paper")}
          >
            <Upload aria-hidden className="size-6" />
            <p className="text-[13px]">Drop files here (several at once is fine)</p>
            <input ref={file} type="file" multiple accept=".json,.yaml,.yml,.har,.txt,.sh,.curl,application/json,text/yaml" className="sr-only" onChange={(e) => e.target.files && void fromFiles(e.target.files)} />
            <Btn variant={drag ? "secondary" : "primary"} icon={FileUp} onClick={() => file.current?.click()}>Choose files</Btn>
          </div>
        )}
        {mode === "text" && (
          <div className="space-y-2">
            <Textarea mono rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder={"curl https://api.example.com/items -H 'Authorization: Bearer …'\n\nor paste a Postman collection, an OpenAPI spec, a HAR…"} aria-label="Text to import" />
            <Btn onClick={() => setResults([parse("Pasted text", text)])} disabled={!text.trim()}>Check</Btn>
          </div>
        )}
        {mode === "link" && (
          <div className="flex gap-2">
            <Input mono value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://petstore3.swagger.io/api/v3/openapi.json" aria-label="Link to import" />
            <Btn variant="primary" icon={busy ? Loader2 : Link2} onClick={fromLink} disabled={!link.trim() || busy} className={busy ? "[&_svg]:animate-spin" : ""}>Fetch</Btn>
          </div>
        )}
        {results.length > 0 && (
          <ul className="divide-y divide-line rounded-md border border-line text-[13px]">
            {results.map((r, i) => (
              <li key={i} className="px-3 py-2">
                <p className="truncate font-medium">{r.name}</p>
                {r.error ? (
                  <p className="text-danger">{r.error}</p>
                ) : (
                  <p className="text-ink-2">
                    {r.res!.kind}:{" "}
                    {[
                      r.res!.collections.length && `${r.res!.collections.length} collection${r.res!.collections.length > 1 ? "s" : ""} (${r.res!.collections.reduce((n, c) => n + requestsIn(c.items).length, 0)} requests)`,
                      r.res!.environments.length && `${r.res!.environments.length} environment${r.res!.environments.length > 1 ? "s" : ""}`,
                      r.res!.requests.length && `${r.res!.requests.length} request`,
                    ].filter(Boolean).join(", ") || "ready"}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ export & share */

function ExportDialog({ collectionId, onClose }: { collectionId: string; onClose: () => void }) {
  const c = useApi((s) => s.ws.collections.find((x) => x.id === collectionId));
  const [fmt, setFmt] = useState<"postman" | "openapi-yaml" | "openapi-json" | "docs">("postman");
  if (!c) return null;
  const run = () => {
    const base = safeName(c.name);
    if (fmt === "postman") downloadFile(`${base}.postman_collection.json`, JSON.stringify(collectionToPostman(c), null, 2));
    else if (fmt === "openapi-yaml") downloadFile(`${base}.openapi.yaml`, collectionToOpenApi(c, "yaml"), "application/yaml");
    else if (fmt === "openapi-json") downloadFile(`${base}.openapi.json`, collectionToOpenApi(c, "json"));
    else downloadFile(`${base}-docs.html`, collectionDocsHtml(c), "text/html");
    onClose();
  };
  return (
    <Modal title={`Export "${c.name}"`} onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn variant="primary" icon={Download} onClick={run}>Export</Btn></>}>
      <div className="space-y-2" role="radiogroup" aria-label="Format">
        {([
          ["postman", "Postman Collection v2.1", "Opens in Postman, Insomnia, Bruno, Hoppscotch and here."],
          ["openapi-yaml", "OpenAPI 3.0 (YAML)", "Paths, parameters, bodies and examples as an API spec."],
          ["openapi-json", "OpenAPI 3.0 (JSON)", "The same spec as JSON."],
          ["docs", "Documentation (HTML)", "A standalone page documenting every request."],
        ] as const).map(([id, label, hint]) => (
          <label key={id} className={cn("flex cursor-pointer gap-3 rounded-md border p-3", fmt === id ? "border-ink" : "border-line hover:border-ink-3")}>
            <input type="radio" name="fmt" checked={fmt === id} onChange={() => setFmt(id)} className="mt-1 accent-[var(--color-ink)]" />
            <span>
              <span className="block text-[13px] font-medium">{label}</span>
              <span className="block text-[12px] text-ink-3">{hint}</span>
            </span>
          </label>
        ))}
        <p className="text-[12px] text-ink-3">Initial values of variables are exported; current values and vault secrets stay in this browser.</p>
      </div>
    </Modal>
  );
}

function ShareDialog({ collectionId, itemId, onClose }: { collectionId: string; itemId?: string; onClose: () => void }) {
  const c = useApi((s) => s.ws.collections.find((x) => x.id === collectionId));
  const notify = useApi((s) => s.notify);
  const data = useMemo(() => {
    if (!c) return null;
    if (!itemId) return collectionToPostman(c);
    const hit = findNode(c.items, itemId);
    return hit ? collectionToPostman({ ...newCollection(hit.node.name), variables: c.variables, auth: c.auth, items: [hit.node] }) : null;
  }, [c, itemId]);
  const link = useMemo(() => (data ? shareLink(data) : null), [data]);
  if (!c || !data || !link) return null;
  const json = JSON.stringify(data, null, 2);
  return (
    <Modal title={`Share ${itemId ? "request" : "collection"}`} onClose={onClose} wide>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label>Link</Label>
          {link.tooBig ? (
            <Note tone="warning">This collection is too big for a link. Share the JSON file instead.</Note>
          ) : (
            <div className="flex gap-2">
              <Input mono readOnly value={link.url} onFocus={(e) => e.target.select()} aria-label="Share link" />
              <Btn variant="primary" icon={Link2} onClick={async () => (await copyText(link.url)) && notify("Link copied", "success")}>Copy link</Btn>
            </div>
          )}
          <p className="text-[12px] text-ink-3">Everything is inside the link itself (after the #), which browsers never send to a server: opening it offers to import a copy. Don&apos;t share links holding secrets.</p>
        </div>
        <div className="space-y-1.5">
          <Label>Postman v2.1 JSON</Label>
          <Textarea mono readOnly rows={8} value={json} aria-label="Collection JSON" />
          <div className="flex gap-2">
            <Btn icon={Download} onClick={() => downloadFile(`${safeName(c.name)}.postman_collection.json`, json)}>Download</Btn>
            <Btn onClick={async () => (await copyText(json)) && notify("JSON copied", "success")}>Copy JSON</Btn>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ save as */

function SaveDialog({ tabId, onClose }: { tabId: string; onClose: () => void }) {
  const tab = useApi((s) => s.tabs.find((t) => t.id === tabId));
  const ws = useApi((s) => s.ws);
  const s = useApi.getState();
  const [name, setName] = useState(tab?.draft?.name ?? "New Request");
  const [target, setTarget] = useState<{ collectionId: string; parentId: string | null } | null>(ws.collections[0] ? { collectionId: ws.collections[0].id, parentId: null } : null);
  const [newCol, setNewCol] = useState("");
  if (!tab?.draft) return null;
  const opts: { value: string; label: string }[] = [];
  const add = (c: Collection, items: TreeNode[], depth: number) => {
    for (const n of items) if (n.kind === "folder") {
      opts.push({ value: `${c.id}|${n.id}`, label: `${"   ".repeat(depth)}${c.name} / ${n.name}` });
      add(c, n.items, depth + 1);
    }
  };
  for (const c of ws.collections) {
    opts.push({ value: `${c.id}|`, label: c.name });
    add(c, c.items, 1);
  }
  const save = () => {
    let t = target;
    if (newCol.trim()) {
      const c = s.addCollection(newCollection(newCol.trim()));
      t = { collectionId: c.id, parentId: null };
    }
    if (!t) return;
    s.saveTab(tabId, { ...t, name: name.trim() || "New Request" });
    s.notify("Saved", "success");
    onClose();
  };
  return (
    <Modal title="Save request" onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={save} disabled={!target && !newCol.trim()}>Save</Btn></>}>
      <div className="space-y-3">
        <label className="block space-y-1">
          <span className="text-[13px]">Request name</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} />
        </label>
        {opts.length > 0 && (
          <label className="block space-y-1">
            <span className="text-[13px]">Save to</span>
            <Select label="Save to" value={target ? `${target.collectionId}|${target.parentId ?? ""}` : ""} onChange={(v) => { const [c, p] = v.split("|"); setTarget({ collectionId: c, parentId: p || null }); setNewCol(""); }} options={opts} className="w-full" />
          </label>
        )}
        <label className="block space-y-1">
          <span className="text-[13px]">{opts.length ? "…or a new collection" : "New collection"}</span>
          <Input value={newCol} onChange={(e) => setNewCol(e.target.value)} placeholder="Collection name" />
        </label>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ cookies */

function CookiesDialog({ onClose }: { onClose: () => void }) {
  const cookies = useApi((s) => s.ws.cookies);
  const setCookies = useApi((s) => s.setCookies);
  const [domain, setDomain] = useState<string | null>(null);
  const [newDomain, setNewDomain] = useState("");
  const [edit, setEdit] = useState<{ i: number | null; text: string } | null>(null);
  const domains = [...new Set(cookies.map((c) => c.domain))].sort();
  const current = domain ?? domains[0] ?? null;
  const list = cookies.map((c, i) => ({ c, i })).filter(({ c }) => c.domain === current);
  const saveEdit = () => {
    if (!edit || !current) return;
    const c = parseSetCookie(edit.text, `https://${current}/`);
    if (!c) return useApi.getState().notify("That isn't a valid cookie (name=value; Path=/ …)", "danger");
    const next: Cookie[] = edit.i === null ? [...cookies, c] : cookies.map((x, j) => (j === edit.i ? c : x));
    setCookies(next);
    setEdit(null);
  };
  return (
    <Modal title="Cookies" onClose={onClose} wide>
      <div className="grid gap-3 sm:grid-cols-[200px_1fr]">
        <div className="space-y-2">
          <form className="flex gap-1.5" onSubmit={(e) => { e.preventDefault(); if (newDomain.trim()) { setDomain(newDomain.trim().replace(/^https?:\/\//, "").split("/")[0]); setNewDomain(""); } }}>
            <Input value={newDomain} onChange={(e) => setNewDomain(e.target.value)} placeholder="Add domain" aria-label="Add domain" />
            <Btn type="submit" icon={Plus} aria-label="Add domain" />
          </form>
          <ul className="max-h-72 overflow-y-auto rounded-md border border-line" data-lenis-prevent>
            {[...new Set([...domains, ...(current && !domains.includes(current) ? [current] : [])])].map((d) => (
              <li key={d}>
                <button type="button" onClick={() => setDomain(d)} className={cn("flex w-full items-center justify-between px-2.5 py-1.5 text-left text-[13px]", d === current ? "bg-ink text-paper" : "hover:bg-paper-2")}>
                  <span className="truncate">{d}</span>
                  <span className={cn("font-mono text-[12px]", d === current ? "text-paper/70" : "text-ink-3")}>{cookies.filter((c) => c.domain === d).length}</span>
                </button>
              </li>
            ))}
            {!domains.length && !current && <li className="p-3 text-[12px] text-ink-3">No cookies yet. Cookies servers set (Cloud agent) are kept here per domain.</li>}
          </ul>
          {domains.length > 0 && <Btn variant="danger" icon={Trash2} onClick={() => setCookies([])} className="w-full">Clear all cookies</Btn>}
        </div>
        <div className="min-w-0 space-y-2">
          {current ? (
            <>
              <div className="flex items-center justify-between">
                <span className="truncate text-[13px] font-medium">{current}</span>
                <span className="flex gap-1">
                  <Btn icon={Plus} onClick={() => setEdit({ i: null, text: "name=value; Path=/" })}>Add cookie</Btn>
                  <Btn variant="ghost" onClick={() => setCookies(cookies.filter((c) => c.domain !== current))}>Clear domain</Btn>
                </span>
              </div>
              {edit && (
                <div className="space-y-1.5 rounded-md border border-ink p-2">
                  <Textarea mono rows={3} value={edit.text} onChange={(e) => setEdit({ ...edit, text: e.target.value })} aria-label="Cookie" />
                  <div className="flex gap-1.5">
                    <Btn variant="primary" onClick={saveEdit}>Save</Btn>
                    <Btn onClick={() => setEdit(null)}>Cancel</Btn>
                  </div>
                </div>
              )}
              <ul className="divide-y divide-line rounded-md border border-line">
                {list.map(({ c, i }) => (
                  <li key={i} className="flex items-start gap-2 px-2.5 py-1.5">
                    <button type="button" onClick={() => setEdit({ i, text: toSetCookie(c) })} className="min-w-0 flex-1 break-all text-left font-mono text-[12px] hover:text-ink">{toSetCookie(c)}</button>
                    <button type="button" aria-label="Delete cookie" onClick={() => setCookies(cookies.filter((_, j) => j !== i))} className="text-ink-3 hover:text-danger"><Trash2 aria-hidden className="size-3.5" /></button>
                  </li>
                ))}
                {!list.length && <li className="p-3 text-[12px] text-ink-3">No cookies for this domain.</li>}
              </ul>
            </>
          ) : (
            <Note>Requests sent with the Cloud agent keep the cookies servers set and send them back to matching addresses. Scripts reach them with pm.cookies.</Note>
          )}
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ settings */

function SettingsDialog({ onClose }: { onClose: () => void }) {
  const settings = useApi((s) => s.settings);
  const set = useApi((s) => s.setSettings);
  const ws = useApi((s) => s.ws);
  const s = useApi.getState();
  const [tab, setTab] = useState<"general" | "data" | "agents">("general");
  const restore = useRef<HTMLInputElement>(null);
  const num = (label: string, value: number, onChange: (v: number) => void, hint?: string, min = 0) => (
    <label className="grid gap-1 sm:grid-cols-[1fr_140px] sm:items-center">
      <span>
        <span className="block text-[13px]">{label}</span>
        {hint && <span className="block text-[12px] text-ink-3">{hint}</span>}
      </span>
      <Input type="number" min={min} value={value} onChange={(e) => onChange(Math.max(min, Number(e.target.value) || min))} />
    </label>
  );
  return (
    <Modal title="Settings" onClose={onClose} wide>
      <div className="space-y-4">
        <Segmented label="Section" value={tab} onChange={setTab} options={[{ value: "general", label: "General" }, { value: "agents", label: "Agents & network" }, { value: "data", label: "Data" }]} />
        {tab === "general" && (
          <div className="space-y-4">
            <label className="grid gap-1 sm:grid-cols-[1fr_200px] sm:items-center">
              <span className="text-[13px]">Request and response layout</span>
              <Select label="Layout" value={settings.layout} onChange={(layout) => set({ layout })} options={[{ value: "auto", label: "Stacked (default)" }, { value: "stack", label: "Stacked" }, { value: "split", label: "Two-pane: side by side" }]} />
            </label>
            {num("Request timeout (ms)", settings.timeoutMs, (timeoutMs) => set({ timeoutMs }), "How long to wait for a response. The Cloud agent caps it at 55 s.", 100)}
            {num("Script timeout (ms)", settings.scriptTimeoutMs, (scriptTimeoutMs) => set({ scriptTimeoutMs }), "Scripts running longer are stopped.", 500)}
            {num("History items kept", settings.historyLimit, (historyLimit) => set({ historyLimit }), undefined, 10)}
            <Toggle checked={settings.trimKeys} onChange={(trimKeys) => set({ trimKeys })} label="Trim keys and values in request body" description="Remove spaces around header names and values." />
            <Toggle checked={settings.sendNoCache} onChange={(sendNoCache) => set({ sendNoCache })} label="Send no-cache header" description="Adds Cache-Control: no-cache so you see fresh responses." />
            <Toggle checked={settings.sendRequestId} onChange={(sendRequestId) => set({ sendRequestId })} label="Send a request id header" description="Adds a random X-Request-Id to every request (Postman's Postman-Token)." />
            <Toggle checked={settings.saveResponses} onChange={(saveResponses) => set({ saveResponses })} label="Keep responses when you come back" description="Responses under 2 MB are kept with your open tabs." />
            <Toggle checked={settings.wrapResponse} onChange={(wrapResponse) => set({ wrapResponse })} label="Wrap long lines in responses" />
          </div>
        )}
        {tab === "agents" && (
          <div className="space-y-4">
            <label className="grid gap-1 sm:grid-cols-[1fr_200px] sm:items-center">
              <span>
                <span className="block text-[13px]">Default agent</span>
                <span className="block text-[12px] text-ink-3">Requests set to &quot;Auto&quot; use this.</span>
              </span>
              <Select label="Default agent" value={settings.defaultAgent} onChange={(defaultAgent) => set({ defaultAgent })} options={[{ value: "auto", label: "Auto (by address)" }, { value: "cloud", label: "Cloud" }, { value: "browser", label: "Browser" }]} />
            </label>
            <Note>
              <b>Cloud agent</b>: our server sends the request, so APIs that don&apos;t allow cross-origin calls work, and you get DNS/TCP/TLS timings, the certificate, cookies and every header. It reaches public addresses only, bodies up to 3 MB, responses up to 3 MB, 55 s. Nothing is stored.
              <br />
              <b>Browser agent</b>: this browser sends it, so localhost and your own network work, and there&apos;s no size limit, but the API must allow CORS and browsers hide some headers. <b>Auto</b> uses Browser for private addresses (localhost, 192.168.x.x, *.local) and Cloud for the rest.
            </Note>
            <Toggle checked={settings.browserCredentials} onChange={(browserCredentials) => set({ browserCredentials })} label="Browser agent: send cookies" description="Include this browser's cookies for the API's site (credentials: include). The API must allow credentials." />
            <Toggle checked={settings.sslVerify} onChange={(sslVerify) => set({ sslVerify })} label="SSL certificate verification" description="Off lets the Cloud agent reach servers with self-signed or expired certificates." />
            <Toggle checked={settings.followRedirects} onChange={(followRedirects) => set({ followRedirects })} label="Follow redirects" />
            <Note>Proxies and client certificates (mTLS) aren&apos;t available in a web page.</Note>
          </div>
        )}
        {tab === "data" && (
          <div className="space-y-4">
            <p className="text-[13px] text-ink-2">Everything (collections, environments, history, cookies, mocks, monitors, flows) is stored in this browser only. Back it up to move it to another device.</p>
            <div className="flex flex-wrap gap-2">
              <Btn variant="primary" icon={Download} onClick={() => downloadFile(`${safeName(ws.name)}-backup.json`, workspaceBackup({ ...ws, vault: [] }))}>Export workspace backup</Btn>
              <input ref={restore} type="file" accept=".json" className="sr-only" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { s.setDialog({ type: "import", text: await f.text() }); } }} />
              <Btn icon={Upload} onClick={() => restore.current?.click()}>Import a backup</Btn>
              <Btn icon={Download} onClick={() => { for (const e of ws.environments) downloadFile(`${safeName(e.name)}.postman_environment.json`, JSON.stringify(environmentToPostman(e), null, 2)); downloadFile("globals.postman_globals.json", JSON.stringify(globalsToPostman(ws.globals), null, 2)); }}>Export environments & globals</Btn>
            </div>
            <div className="border-t border-line pt-4">
              <Btn
                variant="danger"
                icon={Trash2}
                onClick={() =>
                  s.setDialog({
                    type: "confirm",
                    title: "Delete everything in this workspace?",
                    body: "Collections, environments, globals, history, cookies, mocks, monitors, flows and specs in this workspace will be removed. Export a backup first if you might need them.",
                    danger: true,
                    action: () => {
                      s.mutate((w) => ({ ...w, collections: [], environments: [], globals: [], vault: [], history: [], cookies: [], mocks: [], monitors: [], flows: [], specs: [], runs: [], activeEnvId: null }));
                      useApi.setState({ tabs: [], activeTabId: null, responses: {} });
                      s.newRequestTab();
                    },
                  })
                }
              >
                Delete all data in this workspace
              </Btn>
              <Btn variant="ghost" className="ml-2" onClick={() => s.setSettings(DEFAULT_SETTINGS)}>Reset settings</Btn>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ shortcuts, new, workspaces, confirm */

export const SHORTCUTS: [string, string][] = [
  ["Ctrl/⌘ + K", "Quick search: requests, collections, commands"],
  ["Ctrl/⌘ + Enter", "Send request"],
  ["Ctrl/⌘ + S", "Save request"],
  ["Ctrl/⌘ + Shift + S", "Save as…"],
  ["Ctrl/⌘ + T  or  Alt + N", "New tab"],
  ["Ctrl/⌘ + W  or  Alt + W", "Close tab"],
  ["Ctrl/⌘ + Tab  /  Alt + →", "Next tab"],
  ["Ctrl/⌘ + Shift + Tab  /  Alt + ←", "Previous tab"],
  ["Ctrl/⌘ + O", "Import"],
  ["Ctrl/⌘ + \\", "Toggle sidebar"],
  ["Ctrl/⌘ + Alt + C", "Toggle console"],
  ["Ctrl/⌘ + ,", "Settings"],
  ["Ctrl/⌘ + F (in an editor)", "Find"],
  ["Ctrl/⌘ + Space (in an editor)", "Autocomplete"],
  ["?", "This list"],
];

function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose}>
      <dl className="divide-y divide-line text-[13px]">
        {SHORTCUTS.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 py-1.5">
            <dt>{v}</dt>
            <dd className="font-mono text-[12px] text-ink-2">{k}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}

function NewDialog({ onClose }: { onClose: () => void }) {
  const s = useApi.getState();
  const item = (icon: typeof Box, label: string, hint: string, act: () => void) => {
    const I = icon;
    return (
      <button key={label} type="button" onClick={() => { act(); onClose(); }} className="flex items-start gap-3 rounded-md border border-line p-3 text-left hover:border-ink-3 hover:bg-paper">
        <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-line bg-paper"><I aria-hidden className="size-4" /></span>
        <span className="min-w-0">
          <span className="block text-[13px] font-medium">{label}</span>
          <span className="block text-[12px] text-ink-3">{hint}</span>
        </span>
      </button>
    );
  };
  const proto = (p: Protocol) => () => s.newRequestTab(p);
  const list = (section: Parameters<typeof s.setPrefs>[0]["sidebar"]) => () => s.setPrefs({ sidebar: section, sidebarOpen: true });
  return (
    <Modal title="Create new" onClose={onClose} wide>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {item(Zap, "HTTP", "REST and any HTTP API", proto("http"))}
        {item(Globe2, "GraphQL", "Queries with schema explorer", proto("graphql"))}
        {item(Cable, "WebSocket", "Raw WebSocket messages", proto("ws"))}
        {item(Radio, "Socket.IO", "Events over Socket.IO v2–v4", proto("socketio"))}
        {item(Radio, "MQTT", "Publish and subscribe over WebSocket", proto("mqtt"))}
        {item(Server, "gRPC", "Unary and streaming calls", proto("grpc"))}
        {item(Layers, "Collection", "Group and run requests", () => { const c = s.addCollection(); s.openTab("collection", c.id, c.name); s.setPrefs({ sidebar: "collections", sidebarOpen: true }); })}
        {item(Globe2, "Environment", "Variables for dev, staging, prod", () => { const e = s.addEnvironment(); s.openTab("environment", e.id, e.name); s.setPrefs({ sidebar: "environments", sidebarOpen: true }); })}
        {item(Server, "Mock server", "Answer from saved examples", list("mocks"))}
        {item(Activity, "Monitor", "Run a collection on a schedule", list("monitors"))}
        {item(Workflow, "Flow", "Chain requests visually", list("flows"))}
        {item(FileCode2, "API spec", "Write and validate OpenAPI", list("specs"))}
        {item(BookOpen, "Import", "Postman, OpenAPI, cURL, HAR…", () => setTimeout(() => s.setDialog({ type: "import" }), 0))}
      </div>
    </Modal>
  );
}

function WorkspacesDialog({ onClose }: { onClose: () => void }) {
  const workspaces = useApi((st) => st.workspaces);
  const active = useApi((st) => st.ws.id);
  const s = useApi.getState();
  const [name, setName] = useState("");
  return (
    <Modal title="Workspaces" onClose={onClose}>
      <div className="space-y-3">
        <p className="text-[13px] text-ink-2">Each workspace has its own collections, environments, history and settings for tabs.</p>
        <ul className="divide-y divide-line rounded-md border border-line">
          {workspaces.map((w) => (
            <li key={w.id} className="flex items-center gap-2 px-2.5 py-1.5">
              <FolderIcon aria-hidden className="size-4 text-ink-3" />
              <input aria-label="Workspace name" defaultValue={w.name} onBlur={(e) => e.target.value.trim() && s.renameWorkspace(w.id, e.target.value.trim())} className="min-w-0 flex-1 rounded bg-transparent px-1 text-[13px] outline-none focus:bg-surface focus:ring-1 focus:ring-line" />
              {w.id === active ? <span className="text-[12px] text-success">Current</span> : <Btn variant="ghost" onClick={async () => { await s.switchWorkspace(w.id); onClose(); }}>Open</Btn>}
              {workspaces.length > 1 && (
                <button type="button" aria-label="Delete workspace" onClick={() => s.setDialog({ type: "confirm", title: `Delete workspace "${w.name}"?`, body: "Everything in it will be removed.", danger: true, action: () => void s.deleteWorkspace(w.id) })} className="text-ink-3 hover:text-danger">
                  <Trash2 aria-hidden className="size-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
        <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); await s.createWorkspace(name.trim() || "New workspace"); onClose(); }}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New workspace name" aria-label="New workspace name" />
          <Btn type="submit" variant="primary" icon={Plus}>Create</Btn>
        </form>
      </div>
    </Modal>
  );
}

function ConfirmDialog({ d, onClose }: { d: Extract<Dialog, { type: "confirm" }>; onClose: () => void }) {
  return (
    <Modal
      title={d.title}
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant={d.danger ? "danger" : "primary"} onClick={() => { d.action(); onClose(); }}>{d.confirmLabel ?? (d.danger ? "Delete" : "OK")}</Btn>
        </>
      }
    >
      <p className="text-[13px] leading-relaxed text-ink-2">{d.body}</p>
    </Modal>
  );
}

export { uid };
