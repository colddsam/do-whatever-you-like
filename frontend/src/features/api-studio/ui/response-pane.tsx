"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { EditorView } from "@codemirror/view";
import { JSONPath } from "jsonpath-plus";
import { AlertTriangle, Braces, Check, CircleSlash, Copy, Download, Funnel, Globe, Loader2, Lock, MoreHorizontal, Save, Search, Send, Sparkles, Trash2, WrapText, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Example, RequestItem, ResponseData, SseEvent, Variable } from "../types";
import { b64ToBytes, b64ToText, downloadFile, fmtBytes, fmtMs, header, isBinaryType, kv, langOf, prettyJson, prettyXml, statusMeaning, statusTone, uid, variable } from "../lib/util";
import { parseSetCookie } from "../lib/cookies";
import { explainResponse, renderTemplate } from "../lib/assist";
import { CodeEditor } from "./code-editor";
import { Btn, copyText, Empty, IconBtn, Input, Label, Menu, Modal, Note, Popover, Segmented, Select, SubTabs, Textarea } from "./kit";
import { useApi } from "../store";

type BodyView = "pretty" | "raw" | "preview" | "visualize" | "events";

export function ResponsePane({ tabId, req, onSaveExample, compact }: { tabId: string; req: RequestItem; onSaveExample?: (ex: Example) => void; compact?: boolean }) {
  const res = useApi((s) => s.responses[tabId]);
  const sending = useApi((s) => !!s.sending[tabId]);
  const live = useApi((s) => s.live[tabId]);
  const cancel = useApi((s) => s.cancel);
  const clear = useApi((s) => s.clearResponse);
  const settings = useApi((s) => s.settings);
  const setSettings = useApi((s) => s.setSettings);
  const notify = useApi((s) => s.notify);
  const [tab, setTab] = useState<"body" | "cookies" | "headers" | "tests" | "timeline">("body");
  const [view, setView] = useState<BodyView>("pretty");
  const [filter, setFilter] = useState("");
  const [showFilter, setShowFilter] = useState(false);
  const [explain, setExplain] = useState(false);
  const [setVar, setSetVar] = useState<string | null>(null);
  const editor = useRef<EditorView | null>(null);

  const ctype = res ? header(res.headers, "content-type") : undefined;
  const binary = !!res && isBinaryType(ctype);
  const text = useMemo(() => (res && !binary ? b64ToText(res.bodyB64) : ""), [res, binary]);
  const lang = useMemo(() => (res ? langOf(ctype, text) : "text"), [res, ctype, text]);
  const [langOverride, setLangOverride] = useState<string | null>(null);
  const shownLang = langOverride ?? lang;
  const isSse = !!res?.events || (ctype ?? "").includes("event-stream");

  // A new response resets the view (adjusted during render rather than in an effect).
  const [seenAt, setSeenAt] = useState(res?.at);
  if (res?.at !== seenAt) {
    setSeenAt(res?.at);
    setLangOverride(null);
    setFilter("");
    setView(res?.visualizer ? "visualize" : isSse ? "events" : view === "visualize" || view === "events" ? "pretty" : view);
  }

  const pretty = useMemo(() => {
    if (!text) return "";
    if (shownLang === "json") return prettyJson(text);
    if (shownLang === "xml" || shownLang === "html") return text.length < 2_000_000 ? prettyXml(text) : text;
    return text;
  }, [text, shownLang]);

  const filtered = useMemo<{ text: string; error?: string } | null>(() => {
    if (!filter.trim() || shownLang !== "json") return null;
    try {
      return { text: JSON.stringify(JSONPath({ path: filter.trim(), json: JSON.parse(text), wrap: true }), null, 2) };
    } catch (e) {
      return { text: "", error: (e as Error).message };
    }
  }, [filter, text, shownLang]);

  // The value to save: the editor's selection, else the JSONPath filter's single result.
  const pickValue = () => {
    const v = editor.current;
    const sel = v?.state.selection.main;
    if (v && sel && !sel.empty) return v.state.sliceDoc(sel.from, sel.to).replace(/^"([sS]*)"$/, "$1");
    if (filtered && !filtered.error) {
      try {
        const arr = JSON.parse(filtered.text) as unknown[];
        if (arr.length === 1) return typeof arr[0] === "string" ? arr[0] : JSON.stringify(arr[0]);
      } catch {
        /* not one value */
      }
    }
    return "";
  };
  const cookies = useMemo(() => (res ? res.headers.filter(([k]) => k.toLowerCase() === "set-cookie").map(([, v]) => parseSetCookie(v, res.sent.url)).filter(Boolean) : []), [res]);
  const passed = res?.tests.filter((t) => t.passed && !t.skipped).length ?? 0;
  const failedTests = res?.tests.filter((t) => !t.passed && !t.skipped).length ?? 0;

  const saveExample = () => {
    if (!res || !onSaveExample) return;
    onSaveExample({
      id: uid(),
      name: `${res.status} ${res.statusText}`.trim() || "Example",
      request: { method: req.method, url: req.url, headers: req.headers.filter((h) => h.enabled), body: req.body.mode === "raw" ? req.body.raw : undefined },
      status: res.status,
      statusText: res.statusText,
      headers: res.headers.map(([k, v]) => kv(k, v)),
      body: binary ? "" : text,
      lang: (["json", "xml", "html", "javascript"].includes(lang) ? lang : "text") as Example["lang"],
    });
    notify("Saved as an example", "success");
  };
  const saveFile = () => {
    if (!res) return;
    const ext = { json: "json", xml: "xml", html: "html", javascript: "js", css: "css", text: "txt" }[lang] ?? "bin";
    const cd = header(res.headers, "content-disposition");
    const fromCd = cd ? /filename\*?=(?:UTF-8'')?"?([^";]+)/i.exec(cd)?.[1] : undefined;
    downloadFile(fromCd ?? `response.${binary ? (ctype?.split("/")[1]?.split(";")[0] ?? "bin") : ext}`, b64ToBytes(res.bodyB64) as BlobPart, ctype || "application/octet-stream");
  };

  // A server-sent event stream is still open: show its events as they arrive.
  if (sending && live?.events.length) return <LiveStream events={live.events} onCancel={() => cancel(tabId)} />;

  if (sending)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <Loader2 aria-hidden className="size-6 animate-spin text-ink-3" />
        <p className="text-[13px] text-ink-2">Sending request…</p>
        <Btn icon={X} onClick={() => cancel(tabId)}>
          Cancel
        </Btn>
      </div>
    );

  if (!res && !sending)
    return (
      <Empty icon={Send} title="Response">
        Enter the URL and press <b>Send</b> (Ctrl/⌘ + Enter) to get a response.
      </Empty>
    );

  if (res?.error && !sending)
    return (
      <div className="flex h-full flex-col gap-3 overflow-y-auto p-4" data-lenis-prevent>
        <div className="flex items-start gap-3 rounded-lg border border-danger/40 bg-danger/5 p-4">
          <CircleSlash aria-hidden className="mt-0.5 size-5 shrink-0 text-danger" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink">Could not send request</p>
            <p className="mt-1 break-words text-[13px] leading-relaxed text-ink-2">{res.error}</p>
            <p className="mt-2 break-all font-mono text-[12px] text-ink-3">
              {res.sent.method} {res.sent.url}
            </p>
          </div>
        </div>
        {res.tests.length > 0 && <TestList res={res} />}
        <div>
          <Btn variant="ghost" icon={Trash2} onClick={() => clear(tabId)}>
            Clear
          </Btn>
        </div>
      </div>
    );

  const r = res;
  const events: SseEvent[] = sending ? (live?.events ?? []) : (r?.events ?? []);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SubTabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "body", label: "Body" },
          { id: "cookies", label: "Cookies", count: cookies.length || undefined },
          { id: "headers", label: "Headers", count: r?.headers.length },
          { id: "tests", label: "Test Results", count: r?.tests.length ? `${passed}/${r.tests.filter((t) => !t.skipped).length}` : undefined },
          { id: "timeline", label: "Timeline" },
        ]}
        right={r && <StatusStrip res={r} compact={compact} />}
      />
      {r && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-2 py-1.5">
          {tab === "body" && (
            <>
              <Segmented
                label="Body view"
                value={view}
                onChange={setView}
                options={[
                  { value: "pretty", label: "Pretty" },
                  { value: "raw", label: "Raw" },
                  { value: "preview", label: "Preview" },
                  ...(r.visualizer ? [{ value: "visualize" as const, label: "Visualize" }] : []),
                  ...(isSse ? [{ value: "events" as const, label: `Events (${events.length})` }] : []),
                ]}
              />
              {view === "pretty" && !binary && (
                <Select label="Format" value={shownLang} onChange={(v) => setLangOverride(v)} options={["json", "xml", "html", "javascript", "text"].map((v) => ({ value: v, label: v.toUpperCase() === "JAVASCRIPT" ? "JavaScript" : v.toUpperCase() }))} />
              )}
              <span className="ml-auto flex items-center gap-0.5">
                {shownLang === "json" && view === "pretty" && <IconBtn icon={Funnel} label="Filter with JSONPath" active={showFilter} onClick={() => setShowFilter((x) => !x)} />}
                {(view === "pretty" || view === "raw") && (
                  <IconBtn
                    icon={Search}
                    label="Find in body (Ctrl+F)"
                    onClick={() => editor.current && void import("@codemirror/search").then((m) => m.openSearchPanel(editor.current!))}
                  />
                )}
                <IconBtn icon={WrapText} label="Wrap lines" active={settings.wrapResponse} onClick={() => setSettings({ wrapResponse: !settings.wrapResponse })} />
                <IconBtn icon={Copy} label="Copy body" onClick={async () => notify((await copyText(filtered?.text || pretty || text)) ? "Copied to clipboard" : "Couldn't copy", "success")} />
                <IconBtn icon={Braces} label="Set as variable (select a value first)" onClick={() => setSetVar(pickValue())} />
                <IconBtn icon={Sparkles} label="Explain this response" active={explain} onClick={() => setExplain((x) => !x)} />
                <Menu
                  label="Response actions"
                  align="end"
                  items={[
                    { label: "Save as example", icon: Save, onClick: saveExample, disabled: !onSaveExample },
                    { label: "Save response to file", icon: Download, onClick: saveFile },
                    { label: "Copy headers", icon: Copy, onClick: () => copyText(r.headers.map(([k, v]) => `${k}: ${v}`).join("\n")) },
                    { divider: true, label: "" },
                    { label: "Clear response", icon: Trash2, onClick: () => clear(tabId) },
                  ]}
                  trigger={({ toggle, ref }) => <IconBtn ref={ref} icon={MoreHorizontal} label="More response actions" onClick={toggle} />}
                />
              </span>
            </>
          )}
          {tab !== "body" && (
            <span className="ml-auto flex items-center gap-1">
              <Btn variant="ghost" icon={Save} onClick={saveExample} disabled={!onSaveExample}>
                Save as example
              </Btn>
            </span>
          )}
        </div>
      )}
      {r && explain && (
        <div className="border-b border-line bg-paper px-3 py-2">
          <ul className="list-disc space-y-0.5 pl-4 text-[12.5px] text-ink-2">
            {explainResponse(r).map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </div>
      )}
      {r?.warnings?.length ? (
        <div role="status" className="flex items-start gap-2 border-b border-warning/30 bg-warning/10 px-3 py-1.5 text-[12.5px] leading-relaxed text-ink">
          <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0 text-warning" />
          <span className="min-w-0">{r.warnings.map((w, i) => <span key={i} className="block">{w}</span>)}</span>
        </div>
      ) : null}
      {r && (r.truncated || r.streamCut) && (
        <Note tone="warning" className="m-2">
          {r.truncated ? "The body was cut at the size limit. Use the Browser agent or Save to file for large downloads." : `This is a stream; the Cloud agent captured the first ${12} seconds. Use the Browser agent to watch it live.`}
        </Note>
      )}
      <div className="min-h-0 flex-1 overflow-hidden">
        {r && tab === "body" && (
          <BodyView
            r={r}
            view={view}
            binary={binary}
            ctype={ctype}
            pretty={filtered && !filtered.error ? filtered.text : pretty}
            text={text}
            lang={shownLang}
            wrap={settings.wrapResponse}
            events={events}
            streaming={sending}
            onEditor={(v) => (editor.current = v)}
            filterBar={
              showFilter && shownLang === "json" && view === "pretty" ? (
                <div className="flex items-center gap-2 border-b border-line bg-paper px-2 py-1.5">
                  <Input mono value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="$.store.book[*].author" aria-label="JSONPath filter" className="flex-1" />
                  {filtered?.error && <span className="text-[12px] text-danger">{filtered.error}</span>}
                </div>
              ) : null
            }
          />
        )}
        {r && tab === "headers" && <HeaderTable rows={r.headers} />}
        {r && tab === "cookies" && <CookieTable cookies={cookies as NonNullable<(typeof cookies)[number]>[]} agent={r.agent} />}
        {r && tab === "tests" && <TestList res={r} />}
        {r && tab === "timeline" && <Timeline r={r} />}
      </div>
      {setVar !== null && <SetVariableDialog tabId={tabId} initial={setVar} onClose={() => setSetVar(null)} />}
      {failedTests > 0 && tab !== "tests" && (
        <button type="button" onClick={() => setTab("tests")} className="flex shrink-0 items-center gap-2 border-t border-danger/30 bg-danger/5 px-3 py-1.5 text-left text-[12.5px] text-danger">
          <AlertTriangle aria-hidden className="size-3.5" /> {failedTests} test{failedTests === 1 ? "" : "s"} failed. See Test Results.
        </button>
      )}
    </div>
  );
}

/** Saves a value from the response into a variable (Postman's "Set as variable"). */
function SetVariableDialog({ tabId, initial, onClose }: { tabId: string; initial: string; onClose: () => void }) {
  const ws = useApi((st) => st.ws);
  const collectionId = useApi((st) => st.tabs.find((t) => t.id === tabId)?.ref?.collectionId);
  const env = ws.environments.find((e) => e.id === ws.activeEnvId);
  const collection = ws.collections.find((c) => c.id === collectionId);
  const scopes = [...(env ? [{ value: "environment", label: `Environment · ${env.name}` }] : []), ...(collection ? [{ value: "collection", label: `Collection · ${collection.name}` }] : []), { value: "globals", label: "Globals" }];
  const [scope, setScope] = useState(scopes[0].value);
  const [name, setName] = useState("");
  const [value, setValue] = useState(initial);
  const save = () => {
    const key = name.trim();
    if (!key) return;
    const s = useApi.getState();
    const put = (vars: Variable[]): Variable[] => (vars.some((v) => v.key === key) ? vars.map((v) => (v.key === key ? { ...v, current: value, enabled: true } : v)) : [...vars, variable(key, value, { current: value })]);
    if (scope === "environment" && env) s.updateEnvironment(env.id, (e) => ({ ...e, values: put(e.values) }));
    else if (scope === "collection" && collection) s.updateCollection(collection.id, (c) => ({ ...c, variables: put(c.variables) }));
    else s.setGlobals(put(ws.globals));
    s.notify(`Saved {{${key}}}`, "success");
    onClose();
  };
  return (
    <Modal
      title="Set as variable"
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" onClick={save} disabled={!name.trim()}>
            Save variable
          </Btn>
        </>
      }
    >
      <div className="space-y-3">
        {!initial && <Note>Tip: select a value in the response body first (or filter to one value with JSONPath), and it fills in here.</Note>}
        <label className="block space-y-1">
          <span className="text-[13px]">Name</span>
          <Input mono value={name} onChange={(e) => setName(e.target.value.replace(/[{}\s]/g, ""))} onKeyDown={(e) => e.key === "Enter" && save()} placeholder="token" aria-label="Variable name" />
        </label>
        <label className="block space-y-1">
          <span className="text-[13px]">Value</span>
          <Textarea mono rows={4} value={value} onChange={(e) => setValue(e.target.value)} aria-label="Variable value" />
        </label>
        <label className="block space-y-1">
          <span className="text-[13px]">Save to</span>
          <Select label="Save to" value={scope} onChange={setScope} options={scopes} className="w-full" />
        </label>
        <p className="text-[12px] text-ink-3">Use it anywhere as <code className="font-mono">{`{{${name.trim() || "name"}}}`}</code>.</p>
      </div>
    </Modal>
  );
}

function StatusStrip({ res, compact }: { res: ResponseData; compact?: boolean }) {
  const [open, setOpen] = useState<null | "status" | "time" | "size" | "net">(null);
  const statusRef = useRef<HTMLButtonElement>(null);
  const timeRef = useRef<HTMLButtonElement>(null);
  const sizeRef = useRef<HTMLButtonElement>(null);
  const netRef = useRef<HTMLButtonElement>(null);
  const tone = statusTone(res.status);
  const t = res.timings;
  const phases: [string, number | undefined][] = [
    ["Prepare (scripts, auth)", t.prerequest],
    ["DNS lookup", t.dns],
    ["TCP handshake", t.tcp],
    ["SSL handshake", t.tls],
    ["Waiting (TTFB)", t.ttfb],
    ["Download", t.download],
    ["Process (tests)", t.test],
  ];
  const max = Math.max(1, ...phases.map(([, v]) => v ?? 0));
  const item = "inline-flex h-7 items-center gap-1 rounded-md px-1.5 font-mono text-[12px] hover:bg-paper-2";
  return (
    <div className="flex items-center gap-0.5">
      <button ref={statusRef} data-status={res.status} type="button" onClick={() => setOpen(open === "status" ? null : "status")} className={cn(item, "font-semibold", tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : "text-danger")}>
        {res.status} {!compact && res.statusText}
      </button>
      <button ref={timeRef} type="button" onClick={() => setOpen(open === "time" ? null : "time")} className={cn(item, "text-success")}>
        {fmtMs(t.total)}
      </button>
      <button ref={sizeRef} type="button" onClick={() => setOpen(open === "size" ? null : "size")} className={cn(item, "text-success")}>
        {fmtBytes(res.size.body + res.size.headers)}
      </button>
      <button ref={netRef} type="button" onClick={() => setOpen(open === "net" ? null : "net")} className={cn(item, "text-ink-3")} aria-label="Network details">
        {res.tls ? <Lock aria-hidden className="size-3.5" /> : <Globe aria-hidden className="size-3.5" />}
      </button>
      <Popover anchor={statusRef} open={open === "status"} onClose={() => setOpen(null)} align="end">
        <div className="p-3">
          <p className={cn("font-mono text-sm font-semibold", tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : "text-danger")}>
            {res.status} {res.statusText}
          </p>
          <p className="mt-1 text-[13px] text-ink-2">{statusMeaning(res.status)}</p>
        </div>
      </Popover>
      <Popover anchor={timeRef} open={open === "time"} onClose={() => setOpen(null)} align="end">
        <div className="space-y-1.5 p-3">
          <Label>Response time</Label>
          {phases
            .filter(([, v]) => v !== undefined)
            .map(([name, v]) => (
              <div key={name} className="grid grid-cols-[130px_1fr_64px] items-center gap-2 text-[12px]">
                <span className="text-ink-2">{name}</span>
                <span className="h-2 rounded-full bg-paper-2">
                  <span className="block h-2 rounded-full bg-ink" style={{ width: `${Math.max(2, ((v ?? 0) / max) * 100)}%` }} />
                </span>
                <span className="text-right font-mono">{fmtMs(v)}</span>
              </div>
            ))}
          <div className="flex justify-between border-t border-line pt-1.5 text-[12px] font-medium">
            <span>Total</span>
            <span className="font-mono">{fmtMs(t.total)}</span>
          </div>
          {res.agent === "browser" && t.dns === undefined && <p className="text-[12px] text-ink-3">Phase timings need the Cloud agent (or a Timing-Allow-Origin header from the API).</p>}
        </div>
      </Popover>
      <Popover anchor={sizeRef} open={open === "size"} onClose={() => setOpen(null)} align="end">
        <div className="space-y-1 p-3 text-[12px]">
          <Label>Response size</Label>
          <div className="flex justify-between">
            <span className="text-ink-2">Headers</span>
            <span className="font-mono">{fmtBytes(res.size.headers)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-ink-2">Body</span>
            <span className="font-mono">{fmtBytes(res.size.body)}</span>
          </div>
          {res.size.wire !== undefined && res.size.wire !== res.size.body && (
            <div className="flex justify-between">
              <span className="text-ink-2">Body on the wire (compressed)</span>
              <span className="font-mono">{fmtBytes(res.size.wire)}</span>
            </div>
          )}
          <Label className="mt-2 block">Request size</Label>
          <div className="flex justify-between">
            <span className="text-ink-2">Body</span>
            <span className="font-mono">{fmtBytes(res.sent.bodySize)}</span>
          </div>
        </div>
      </Popover>
      <Popover anchor={netRef} open={open === "net"} onClose={() => setOpen(null)} align="end">
        <div className="space-y-1 p-3 text-[12px]">
          <Label>Network</Label>
          <Row k="Agent" v={res.agent === "cloud" ? "Cloud (our server)" : res.agent === "browser" ? "Browser (this device)" : "Mock server"} />
          {res.httpVersion && <Row k="HTTP version" v={res.httpVersion} />}
          {res.remote && <Row k="Remote address" v={`${res.remote.ip}:${res.remote.port}`} />}
          {res.tls && (
            <>
              <Label className="mt-2 block">TLS</Label>
              <Row k="Protocol" v={res.tls.protocol ?? ""} />
              {res.tls.cipher && <Row k="Cipher" v={`${res.tls.cipher}${res.tls.bits ? ` (${res.tls.bits}-bit)` : ""}`} />}
              <Row k="Certificate" v={res.tls.verified ? "Verified" : "Not checked (SSL verification off)"} />
              {res.tls.subject && <Row k="Issued to" v={res.tls.subject} />}
              {res.tls.issuer && <Row k="Issued by" v={res.tls.issuer} />}
              {res.tls.not_after && <Row k="Valid until" v={res.tls.not_after} />}
              {res.tls.san?.length ? <Row k="Names" v={res.tls.san.join(", ")} /> : null}
            </>
          )}
        </div>
      </Popover>
    </div>
  );
}

const Row = ({ k, v }: { k: string; v: string }) => (
  <div className="grid grid-cols-[110px_1fr] gap-2">
    <span className="text-ink-3">{k}</span>
    <span className="break-all font-mono text-ink">{v}</span>
  </div>
);

function BodyView({ r, view, binary, ctype, pretty, text, lang, wrap, events, streaming, onEditor, filterBar }: { r: ResponseData; view: BodyView; binary: boolean; ctype?: string; pretty: string; text: string; lang: string; wrap: boolean; events: SseEvent[]; streaming: boolean; onEditor: (v: EditorView) => void; filterBar: React.ReactNode }) {
  const blobUrl = useMemo(() => {
    if (!binary && view !== "preview") return null;
    if (!binary) return null;
    return URL.createObjectURL(new Blob([b64ToBytes(r.bodyB64) as BlobPart], { type: ctype?.split(";")[0] }));
  }, [r.bodyB64, binary, ctype, view]);
  useEffect(() => () => void (blobUrl && URL.revokeObjectURL(blobUrl)), [blobUrl]);

  if (view === "events")
    return (
      <div className="h-full overflow-y-auto" data-lenis-prevent>
        <EventList events={events} streaming={streaming} />
      </div>
    );

  if (view === "visualize" && r.visualizer) return <Visualizer viz={r.visualizer} />;

  if (view === "preview") {
    if (binary && blobUrl) {
      const t = (ctype ?? "").toLowerCase();
      if (t.startsWith("image/")) return <div className="flex h-full items-center justify-center overflow-auto bg-[repeating-conic-gradient(var(--color-paper-2)_0_25%,var(--color-surface)_0_50%)] bg-[length:16px_16px] p-4">{/* eslint-disable-next-line @next/next/no-img-element -- a blob: URL from the response itself; next/image can't optimise it */}
          <img src={blobUrl} alt="Response preview" className="max-h-full max-w-full object-contain" /></div>;
      if (t.includes("pdf")) return <iframe title="PDF preview" src={blobUrl} className="h-full w-full" />;
      if (t.startsWith("audio/")) return <div className="p-6"><audio controls src={blobUrl} className="w-full" /></div>;
      if (t.startsWith("video/")) return <video controls src={blobUrl} className="h-full w-full bg-ink" />;
      return <Empty title="No preview for this file type">{ctype}: use Save response to file.</Empty>;
    }
    if (lang === "json" || lang === "text" || lang === "javascript")
      return <iframe title="Response preview" sandbox="" srcDoc={`<pre style="white-space:pre-wrap;font:12px ui-monospace,monospace;margin:12px">${pretty.replace(/[&<]/g, (c) => (c === "&" ? "&amp;" : "&lt;"))}</pre>`} className="h-full w-full bg-white" />;
    const base = `<base href="${r.sent.url.replace(/"/g, "&quot;")}">`;
    return <iframe title="Response preview" sandbox="" srcDoc={text.includes("<head>") ? text.replace("<head>", `<head>${base}`) : base + text} className="h-full w-full bg-white" />;
  }

  if (binary)
    return (
      <Empty title="Binary response" action={<span className="font-mono text-[12px] text-ink-3">{ctype}</span>}>
        {fmtBytes(r.size.body)} of binary data. Open <b>Preview</b> to see it, or save it to a file.
      </Empty>
    );

  if (!text) return <p className="p-4 text-center text-[13px] text-ink-3">The response has no body.</p>;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {filterBar}
      <CodeEditor key={view} value={view === "raw" ? text : pretty} readOnly wrap={wrap || view === "raw"} language={view === "raw" ? "text" : lang} onReady={onEditor} className="min-h-0 flex-1" ariaLabel="Response body" />
    </div>
  );
}

function EventList({ events, streaming }: { events: SseEvent[]; streaming: boolean }) {
  return (
    <>
      {!events.length && <p className="p-4 text-center text-[13px] text-ink-3">{streaming ? "Connected. Waiting for the first event…" : "No events."}</p>}
      <ul className="divide-y divide-line">
        {events.map((e, i) => (
          <li key={i} className="px-3 py-1.5">
            <div className="flex items-center gap-2 text-[12px]">
              <span className="rounded-sm bg-paper-2 px-1.5 font-mono text-ink">{e.event}</span>
              {e.id && <span className="truncate font-mono text-ink-3">id {e.id}</span>}
              <span className="ml-auto shrink-0 font-mono text-ink-3">{new Date(e.at).toLocaleTimeString()}</span>
            </div>
            <pre className="mt-0.5 whitespace-pre-wrap break-all font-mono text-[12px] text-ink-2">{e.data.length > 4000 ? `${e.data.slice(0, 4000)}…` : e.data}</pre>
          </li>
        ))}
      </ul>
    </>
  );
}

/** A stream that is still open: events as they arrive, newest at the bottom, and a way to stop. */
function LiveStream({ events, onCancel }: { events: SseEvent[]; onCancel: () => void }) {
  const end = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    if (stick.current) end.current?.scrollIntoView({ block: "end" });
  }, [events.length]);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-line bg-paper px-3 py-1.5">
        <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-accent" />
        <span className="text-[13px] font-medium text-ink">Receiving events</span>
        <span role="status" className="font-mono text-[12px] text-ink-3">
          {events.length} so far
        </span>
        <Btn icon={X} onClick={onCancel} className="ml-auto">
          Stop
        </Btn>
      </div>
      <div
        className="min-h-0 flex-1 overflow-y-auto"
        data-lenis-prevent
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        <EventList events={events} streaming />
        <div ref={end} />
      </div>
    </div>
  );
}

function Visualizer({ viz }: { viz: NonNullable<ResponseData["visualizer"]> }) {
  const html = useMemo(() => {
    let body: string;
    try {
      body = renderTemplate(viz.template, viz.data);
    } catch (e) {
      body = `<p style="color:#c2410c">Template error: ${(e as Error).message}</p>`;
    }
    const data = JSON.stringify(viz.data ?? {}).replace(/</g, "\\u003c");
    return `<!doctype html><html><head><meta charset="utf-8"><script>window.pm={getData:function(cb){cb(null, ${data});}};</script><style>body{font:13px system-ui,sans-serif;color:#15140f;margin:12px}</style></head><body>${body}</body></html>`;
  }, [viz]);
  // Scripts may run (charts), but in an opaque origin: no access to this site.
  return <iframe title="Visualization" sandbox="allow-scripts" srcDoc={html} className="h-full w-full bg-white" />;
}

function HeaderTable({ rows }: { rows: [string, string][] }) {
  if (!rows.length) return <p className="p-4 text-center text-[13px] text-ink-3">No headers.</p>;
  return (
    <div className="h-full overflow-auto" data-lenis-prevent>
      <table className="w-full border-collapse text-[12.5px]">
        <thead>
          <tr className="sticky top-0 bg-paper text-left">
            <th className="border-b border-line px-3 py-1.5">
              <Label>Key</Label>
            </th>
            <th className="border-b border-l border-line px-3 py-1.5">
              <Label>Value</Label>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([k, v], i) => (
            <tr key={i} className="align-top">
              <td className="border-b border-line px-3 py-1.5 font-mono font-medium text-ink">{k}</td>
              <td className="break-all border-b border-l border-line px-3 py-1.5 font-mono text-ink-2">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CookieTable({ cookies, agent }: { cookies: NonNullable<ReturnType<typeof parseSetCookie>>[]; agent: string }) {
  if (!cookies.length)
    return (
      <Empty title="No cookies received from the server">
        {agent === "browser" ? "Browsers hide Set-Cookie from pages; send with the Cloud agent to see and keep cookies." : "Cookies a server sets are kept in the cookie jar and sent back to it automatically."}
      </Empty>
    );
  return (
    <div className="h-full overflow-auto" data-lenis-prevent>
      <table className="w-full min-w-[640px] border-collapse text-[12.5px]">
        <thead>
          <tr className="bg-paper text-left">
            {["Name", "Value", "Domain", "Path", "Expires", "HttpOnly", "Secure"].map((h) => (
              <th key={h} className="border-b border-line px-3 py-1.5">
                <Label>{h}</Label>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cookies.map((c, i) => (
            <tr key={i}>
              <td className="border-b border-line px-3 py-1.5 font-mono">{c.name}</td>
              <td className="max-w-[240px] break-all border-b border-line px-3 py-1.5 font-mono text-ink-2">{c.value}</td>
              <td className="border-b border-line px-3 py-1.5">{c.domain}</td>
              <td className="border-b border-line px-3 py-1.5">{c.path}</td>
              <td className="border-b border-line px-3 py-1.5">{c.expires ? new Date(c.expires).toLocaleString() : "Session"}</td>
              <td className="border-b border-line px-3 py-1.5">{c.httpOnly ? "true" : "false"}</td>
              <td className="border-b border-line px-3 py-1.5">{c.secure ? "true" : "false"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TestList({ res }: { res: ResponseData }) {
  const [f, setF] = useState<"all" | "passed" | "skipped" | "failed">("all");
  if (!res.tests.length)
    return (
      <Empty title="No tests for this request">
        Write tests in the <b>Scripts</b> tab with <code className="font-mono">pm.test()</code>, or use <b>Generate tests</b> there.
      </Empty>
    );
  const list = res.tests.filter((t) => (f === "all" ? true : f === "passed" ? t.passed && !t.skipped : f === "skipped" ? t.skipped : !t.passed));
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex gap-1 border-b border-line px-2 py-1.5">
        <Segmented label="Filter tests" value={f} onChange={setF} options={[{ value: "all", label: "All" }, { value: "passed", label: "Passed" }, { value: "skipped", label: "Skipped" }, { value: "failed", label: "Failed" }]} />
      </div>
      <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto" data-lenis-prevent>
        {list.map((t, i) => (
          <li key={i} className="flex items-start gap-2.5 px-3 py-2 text-[13px]">
            <span className={cn("mt-0.5 inline-flex h-5 shrink-0 items-center rounded-sm px-1.5 font-mono text-[12px] font-semibold", t.skipped ? "bg-paper-2 text-ink-3" : t.passed ? "bg-success/12 text-success" : "bg-danger/12 text-danger")}>
              {t.skipped ? "SKIP" : t.passed ? "PASS" : "FAIL"}
            </span>
            <div className="min-w-0">
              <p className="text-ink">{t.name}</p>
              {t.error && <p className="mt-0.5 break-words font-mono text-[12px] text-danger">{t.error}</p>}
            </div>
            {t.passed && !t.skipped && <Check aria-hidden className="ml-auto mt-0.5 size-4 shrink-0 text-success" />}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Timeline({ r }: { r: ResponseData }) {
  return (
    <div className="h-full space-y-3 overflow-y-auto p-3 font-mono text-[12px]" data-lenis-prevent>
      <section>
        <Label>Request</Label>
        <pre className="mt-1 whitespace-pre-wrap break-all rounded-md border border-line bg-paper p-2 text-ink">
          {`${r.sent.method} ${r.sent.url}\n`}
          {r.sent.headers.map(([k, v]) => `${k}: ${/authorization|cookie|token|secret|key/i.test(k) ? v.slice(0, 12) + (v.length > 12 ? "…" : "") : v}`).join("\n")}
          {r.sent.bodyPreview ? `\n\n${r.sent.bodyPreview.slice(0, 4000)}` : ""}
        </pre>
      </section>
      {r.hops && r.hops.length > 1 && (
        <section>
          <Label>Redirects</Label>
          <ol className="mt-1 space-y-1">
            {r.hops.map((h, i) => (
              <li key={i} className="break-all">
                <span className={cn("font-semibold", h.status < 300 ? "text-success" : h.status < 400 ? "text-warning" : "text-danger")}>{h.status}</span> {h.url} <span className="text-ink-3">{fmtMs(h.ms)}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
      <section>
        <Label>Response</Label>
        <pre className="mt-1 whitespace-pre-wrap break-all rounded-md border border-line bg-paper p-2 text-ink">
          {`${r.httpVersion} ${r.status} ${r.statusText}\n`}
          {r.headers.map(([k, v]) => `${k}: ${v}`).join("\n")}
        </pre>
      </section>
    </div>
  );
}
