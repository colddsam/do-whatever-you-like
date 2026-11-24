"use client";

import { useMemo, useRef, useState } from "react";
import { ChevronDown, Code2, Download, Loader2, Save, Send, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Example, RequestItem, RequestSettings, Tab } from "../types";
import { METHODS, b64ToBytes, clone, downloadFile, header, methodColor, uid } from "../lib/util";
import { generate, snipFrom } from "../lib/codegen";
import { paramsFromUrl, pathVarsFromUrl, urlFromParams } from "../lib/url";
import { autoHeaders } from "../lib/engine";
import { requestFromCurl } from "../lib/importers";
import { md } from "../lib/docs";
import { locate, scopesFor, useApi } from "../store";
import { AuthEditor } from "./auth-editor";
import { BodyEditor } from "./body-editor";
import { Btn, copyText, Input, Label, Menu, Resizer, Segmented, SubTabs, Textarea, Toggle, type Tier } from "./kit";
import { KVTable } from "./kv-table";
import { ResponsePane } from "./response-pane";
import { ScriptsEditor } from "./scripts-editor";
import { useVarInfo, VarInput, VarsContext } from "./var-input";

type ReqTab = "params" | "auth" | "headers" | "body" | "scripts" | "settings" | "docs";

export function RequestWorkspace({ tab, tier }: { tab: Tab; tier: Tier }) {
  const req = tab.draft!;
  const update = useApi((s) => s.updateDraft);
  const prefs = useApi((s) => s.prefs);
  const setPrefs = useApi((s) => s.setPrefs);
  const settings = useApi((s) => s.settings);
  const vars = useVarInfo(tab.ref?.collectionId);
  const [phoneView, setPhoneView] = useState<"request" | "response">("request");
  const sending = useApi((s) => !!s.sending[tab.id]);
  const hasResponse = useApi((s) => !!s.responses[tab.id]);
  const box = useRef<HTMLDivElement>(null);
  const [split, setSplit] = useState(prefs.split);
  // Two-pane view (request beside response) is a setting; stacked is the default, and phones always stack.
  const side = tier !== "phone" && settings.layout === "split";
  // On phones, sending flips to the response view (state adjusted during render, not in an effect).
  const [wasSending, setWasSending] = useState(sending);
  if (sending !== wasSending) {
    setWasSending(sending);
    if (sending && tier === "phone") setPhoneView("response");
  }

  const set = (fn: (r: RequestItem) => RequestItem) => update(tab.id, fn);
  const saveExample = (ex: Example) => {
    set((r) => ({ ...r, examples: [...r.examples, ex] }));
    if (tab.ref?.itemId) setTimeout(() => useApi.getState().saveTab(tab.id), 0);
  };

  return (
    <VarsContext.Provider value={vars}>
      <div className="flex h-full min-h-0 flex-col">
        <UrlBar tab={tab} req={req} set={set} />
        {tier === "phone" && (
          <div className="flex shrink-0 justify-center border-b border-line px-2 py-1.5">
            <Segmented label="Show" value={phoneView} onChange={setPhoneView} options={[{ value: "request", label: "Request" }, { value: "response", label: hasResponse || sending ? "Response ●" : "Response" }]} />
          </div>
        )}
        <div ref={box} className={cn("flex min-h-0 flex-1", side ? "flex-row" : "flex-col")}>
          {(tier !== "phone" || phoneView === "request") && (
            <div className="min-h-0 min-w-0 overflow-hidden" style={tier === "phone" ? { flex: 1 } : { flexBasis: `${split * 100}%`, flexGrow: 0, flexShrink: 0 }}>
              <RequestTabs tab={tab} req={req} set={set} />
            </div>
          )}
          {tier !== "phone" && (
            <Resizer
              dir={side ? "x" : "y"}
              label="Resize request and response"
              onDrag={(d, done) => {
                const total = side ? (box.current?.clientWidth ?? 1) : (box.current?.clientHeight ?? 1);
                setSplit((s) => {
                  const next = Math.min(0.85, Math.max(0.15, s + d / total));
                  if (done) setPrefs({ split: next });
                  return next;
                });
              }}
            />
          )}
          {(tier !== "phone" || phoneView === "response") && (
            <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
              <ResponsePane tabId={tab.id} req={req} onSaveExample={saveExample} compact={tier !== "desktop"} />
            </div>
          )}
        </div>
      </div>
    </VarsContext.Provider>
  );
}

function UrlBar({ tab, req, set }: { tab: Tab; req: RequestItem; set: (fn: (r: RequestItem) => RequestItem) => void }) {
  const send = useApi((s) => s.send);
  const cancel = useApi((s) => s.cancel);
  const save = useApi((s) => s.saveTab);
  const setDialog = useApi((s) => s.setDialog);
  const sending = useApi((s) => !!s.sending[tab.id]);
  const notify = useApi((s) => s.notify);
  const setPrefs = useApi((s) => s.setPrefs);
  const right = useApi((s) => s.prefs.right);
  const ws = useApi((s) => s.ws);
  const [customMethod, setCustomMethod] = useState(false);
  const { collection, parents } = locate(ws, tab.ref?.collectionId, tab.ref?.itemId);

  const onUrl = (url: string) =>
    set((r) => ({ ...r, url, params: paramsFromUrl(url, r.params), pathVars: pathVarsFromUrl(url, r.pathVars) }));

  const sendAndDownload = async () => {
    await send(tab.id);
    const res = useApi.getState().responses[tab.id];
    if (res && !res.error) {
      const ct = header(res.headers, "content-type") ?? "application/octet-stream";
      downloadFile(`response.${ct.split("/")[1]?.split(";")[0]?.split("+")[0] ?? "bin"}`, b64ToBytes(res.bodyB64) as BlobPart, ct);
    }
  };

  return (
    <div className="shrink-0 border-b border-line px-2 py-2 sm:px-3">
      <div className="mb-1.5 flex min-w-0 items-center gap-2">
        <Breadcrumb names={[collection?.name, ...parents.map((p) => p.name)].filter(Boolean) as string[]} />
        <input
          aria-label="Request name"
          value={req.name}
          onChange={(e) => set((r) => ({ ...r, name: e.target.value }))}
          className="min-w-0 flex-1 truncate rounded-md bg-transparent px-1 py-0.5 text-[14px] font-medium text-ink outline-none hover:bg-paper-2 focus:bg-surface focus:ring-1 focus:ring-line"
        />
        <span className="ml-auto flex shrink-0 items-center gap-1">
          <Btn variant="ghost" icon={Save} onClick={() => save(tab.id) && notify("Saved", "success")} title="Save (Ctrl+S)">
            <span className="max-sm:hidden">Save</span>
          </Btn>
          <Menu
            label="Save options"
            align="end"
            items={[
              { label: "Save as…", onClick: () => setDialog({ type: "save", tabId: tab.id }) },
              { label: "Revert changes", onClick: () => useApi.getState().revertTab(tab.id), disabled: !tab.ref?.itemId || !tab.dirty },
              { divider: true, label: "" },
              { label: "Duplicate in a new tab", onClick: () => useApi.getState().newRequestTab(req.protocol, { ...clone(req), id: uid(), name: `${req.name} Copy` }) },
              {
                label: "Copy as cURL",
                onClick: async () => {
                  const code = generate("curl", snipFrom(req, scopesFor(ws, tab.ref?.collectionId), false, parents, collection));
                  notify((await copyText(code)) ? "cURL command copied" : "Couldn't copy", "success");
                },
              },
            ]}
            trigger={({ toggle, ref }) => (
              <button ref={ref} type="button" onClick={toggle} aria-label="More save options" className="-ml-1 inline-flex size-8 items-center justify-center rounded-md text-ink-3 hover:bg-paper-2 hover:text-ink">
                <ChevronDown aria-hidden className="size-3.5" />
              </button>
            )}
          />
          <Btn variant="ghost" icon={Code2} onClick={() => setPrefs({ right: right === "code" ? null : "code" })} title="Code snippet" className={right === "code" ? "bg-paper-2 text-ink" : ""}>
            <span className="max-md:hidden">Code</span>
          </Btn>
        </span>
      </div>
      <div className="flex min-w-0 items-stretch gap-2">
        <div className="flex min-w-0 flex-1 items-stretch rounded-md border border-line bg-surface focus-within:border-ink">
          {customMethod ? (
            <input
              autoFocus
              aria-label="Custom method"
              defaultValue={req.method}
              onBlur={(e) => {
                const m = e.target.value.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "");
                if (m) set((r) => ({ ...r, method: m }));
                setCustomMethod(false);
              }}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              className="w-24 shrink-0 rounded-l-md border-r border-line bg-paper px-2 font-mono text-[13px] font-semibold outline-none"
            />
          ) : (
            <Menu
              label="Method"
              items={[
                ...METHODS.map((m) => ({ label: m, checked: req.method === m, onClick: () => set((r) => ({ ...r, method: m })) })),
                { divider: true, label: "" },
                { label: "Type a custom method…", onClick: () => setCustomMethod(true) },
              ]}
              trigger={({ toggle, ref }) => (
                <button ref={ref} type="button" onClick={toggle} aria-label={`Method: ${req.method}`} className={cn("inline-flex w-[92px] shrink-0 items-center justify-between gap-1 rounded-l-md border-r border-line bg-paper px-2.5 font-mono text-[13px] font-semibold sm:w-[104px]", methodColor(req.method))}>
                  <span className="truncate">{req.method}</span>
                  <ChevronDown aria-hidden className="size-3.5 shrink-0 text-ink-3" />
                </button>
              )}
            />
          )}
          <VarInput
            ariaLabel="Request URL"
            value={req.url}
            onChange={onUrl}
            onEnter={() => send(tab.id)}
            placeholder="Enter URL or paste a cURL command"
            className="flex-1 rounded-l-none border-0 focus-within:ring-0"
            onPasteText={(text) => {
              if (!/^\s*curl(\.exe)?\s/i.test(text)) return false;
              try {
                const r = requestFromCurl(text);
                set((cur) => ({ ...r, id: cur.id, name: cur.name === "Untitled request" ? r.name : cur.name, scripts: cur.scripts, examples: cur.examples, description: cur.description }));
                notify("Imported the cURL command into this request", "success");
              } catch (e) {
                notify((e as Error).message, "danger");
              }
              return true;
            }}
          />
        </div>
        {sending ? (
          <Btn variant="secondary" size="md" icon={X} onClick={() => cancel(tab.id)} className="h-[32px] px-3">
            Cancel
          </Btn>
        ) : (
          <div className="flex shrink-0">
            <Btn variant="primary" size="md" icon={Send} onClick={() => send(tab.id)} className="h-[32px] rounded-r-none px-3 sm:px-4" title="Send (Ctrl+Enter)">
              <span className="max-sm:sr-only">Send</span>
            </Btn>
            <Menu
              label="Send options"
              align="end"
              items={[{ label: "Send and Download", icon: Download, onClick: sendAndDownload }]}
              trigger={({ toggle, ref }) => (
                <button ref={ref} type="button" onClick={toggle} aria-label="More send options" className="inline-flex h-[32px] w-7 items-center justify-center rounded-r-md border-l border-paper/20 bg-ink text-paper hover:bg-ink/85">
                  {sending ? <Loader2 aria-hidden className="size-3.5 animate-spin" /> : <ChevronDown aria-hidden className="size-3.5" />}
                </button>
              )}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function Breadcrumb({ names }: { names: string[] }) {
  if (!names.length) return null;
  return (
    <span className="hidden min-w-0 shrink items-center gap-1 truncate text-[13px] text-ink-3 md:flex">
      {names.map((n, i) => (
        <span key={i} className="truncate">
          {n} <span className="text-line">/</span>
        </span>
      ))}
    </span>
  );
}

function RequestTabs({ tab, req, set }: { tab: Tab; req: RequestItem; set: (fn: (r: RequestItem) => RequestItem) => void }) {
  const [t, setT] = useState<ReqTab>(req.body.mode !== "none" ? "body" : "params");
  const ws = useApi((s) => s.ws);
  const settings = useApi((s) => s.settings);
  const send = useApi((s) => s.send);
  const lastResponse = useApi((s) => s.responses[tab.id]);
  const { collection, parents } = locate(ws, tab.ref?.collectionId, tab.ref?.itemId);
  const auto = useMemo(() => autoHeaders(req, settings), [req, settings]);
  const paramCount = req.params.filter((p) => p.enabled && p.key).length + req.pathVars.length;
  const headerCount = req.headers.filter((h) => h.enabled && h.key).length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SubTabs
        value={t}
        onChange={setT}
        tabs={[
          { id: "params", label: "Params", count: paramCount || undefined },
          { id: "auth", label: "Authorization", dot: req.auth.type !== "inherit" && req.auth.type !== "noauth" },
          { id: "headers", label: "Headers", count: headerCount ? `${headerCount}` : undefined },
          { id: "body", label: "Body", dot: req.body.mode !== "none" },
          { id: "scripts", label: "Scripts", dot: !!(req.scripts.prerequest.trim() || req.scripts.test.trim()) },
          { id: "settings", label: "Settings" },
          { id: "docs", label: "Docs", dot: !!req.description.trim() },
        ]}
      />
      <div className="min-h-0 flex-1 overflow-y-auto p-2 sm:p-3" data-lenis-prevent>
        {t === "params" && (
          <div className="space-y-4">
            <div>
              <Label>Query Params</Label>
              <KVTable kind="params" rows={req.params} onChange={(params) => set((r) => ({ ...r, params, url: urlFromParams(r.url, params) }))} className="mt-1.5" />
            </div>
            {req.pathVars.length > 0 && (
              <div>
                <Label>Path Variables</Label>
                <KVTable kind="pathvars" rows={req.pathVars} onChange={(pathVars) => set((r) => ({ ...r, pathVars }))} className="mt-1.5" />
              </div>
            )}
            {!req.pathVars.length && <p className="text-[12px] text-ink-3">Path variables: write <code className="font-mono">/users/:id</code> in the URL and set <code className="font-mono">id</code> here.</p>}
          </div>
        )}
        {t === "auth" && <AuthEditor auth={req.auth} onChange={(auth) => set((r) => ({ ...r, auth }))} parents={parents} collection={collection} />}
        {t === "headers" && <KVTable kind="headers" rows={req.headers} onChange={(headers) => set((r) => ({ ...r, headers }))} auto={auto} />}
        {t === "body" && <BodyEditor req={req} onChange={(body) => set((r) => ({ ...r, body }))} collectionId={tab.ref?.collectionId} onRun={() => send(tab.id)} />}
        {t === "scripts" && <ScriptsEditor scripts={req.scripts} onChange={(scripts) => set((r) => ({ ...r, scripts }))} collectionId={tab.ref?.collectionId} lastResponse={lastResponse} label="this request" />}
        {t === "settings" && <SettingsForm s={req.settings} onChange={(settings) => set((r) => ({ ...r, settings }))} />}
        {t === "docs" && <DocsEditor value={req.description} onChange={(description) => set((r) => ({ ...r, description }))} />}
      </div>
    </div>
  );
}

export function SettingsForm({ s, onChange }: { s: RequestSettings; onChange: (s: RequestSettings) => void }) {
  const set = (p: Partial<RequestSettings>) => onChange({ ...s, ...p });
  return (
    <div className="max-w-2xl space-y-4">
      <div className="grid gap-1.5 sm:grid-cols-[200px_1fr] sm:items-center">
        <span className="text-[13px] text-ink">Agent</span>
        <Segmented
          label="Agent"
          value={s.agent}
          onChange={(agent) => set({ agent })}
          options={[
            { value: "auto", label: "Auto" },
            { value: "cloud", label: "Cloud" },
            { value: "browser", label: "Browser" },
          ]}
        />
        <span />
        <span className="text-[12px] leading-relaxed text-ink-3">
          Cloud: our server sends it (no CORS limits, full timings, public addresses only). Browser: this device sends it (reaches localhost and your network; the API must allow CORS). Auto picks Browser for private addresses.
        </span>
      </div>
      <Toggle checked={s.followRedirects} onChange={(v) => set({ followRedirects: v })} label="Automatically follow redirects" description="Follow 3xx responses as redirects." />
      <Toggle checked={s.followOriginalMethod} onChange={(v) => set({ followOriginalMethod: v })} label="Follow original HTTP method" description="Keep the method on 301/302 redirects instead of switching to GET (Cloud agent)." />
      <Toggle checked={s.followAuthHeader} onChange={(v) => set({ followAuthHeader: v })} label="Follow Authorization header" description="Keep the Authorization and Cookie headers when a redirect goes to another host." />
      <Toggle checked={s.strictSSL} onChange={(v) => set({ strictSSL: v })} label="Enable SSL certificate verification" description="Turn off for self-signed certificates (Cloud agent)." />
      <Toggle checked={s.encodeUrl} onChange={(v) => set({ encodeUrl: v })} label="Encode URL automatically" description="Percent-encode the path and query, keeping existing %XX escapes." />
      <Toggle checked={s.disableCookies} onChange={(v) => set({ disableCookies: v })} label="Disable cookie jar" description="Don't send cookies from the jar or store cookies from this response." />
      <label className="grid gap-1.5 sm:grid-cols-[200px_160px] sm:items-center">
        <span className="text-[13px] text-ink">Maximum number of redirects</span>
        <Input type="number" min={0} max={50} value={s.maxRedirects} onChange={(e) => set({ maxRedirects: Math.max(0, Math.min(50, Number(e.target.value) || 0)) })} />
      </label>
      <label className="grid gap-1.5 sm:grid-cols-[200px_160px] sm:items-center">
        <span className="text-[13px] text-ink">Request timeout (ms)</span>
        <Input type="number" min={0} step={1000} value={s.timeoutMs} onChange={(e) => set({ timeoutMs: Math.max(0, Number(e.target.value) || 0) })} placeholder="0 = default" />
      </label>
    </div>
  );
}

export function DocsEditor({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [edit, setEdit] = useState(!value);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>Description · Markdown</Label>
        <Segmented label="Mode" value={edit ? "edit" : "view"} onChange={(v) => setEdit(v === "edit")} options={[{ value: "edit", label: "Edit" }, { value: "view", label: "Preview" }]} />
      </div>
      {edit ? (
        <Textarea rows={12} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder ?? "Describe what this does, its parameters and what it returns. Markdown works: **bold**, `code`, lists, tables, links."} aria-label="Description" />
      ) : (
        <div className="prose-docs min-h-[120px] rounded-md border border-line bg-surface p-4 text-[14px] leading-relaxed text-ink" dangerouslySetInnerHTML={{ __html: md(value) || '<p style="color:var(--color-ink-3)">No description yet.</p>' }} />
      )}
    </div>
  );
}
