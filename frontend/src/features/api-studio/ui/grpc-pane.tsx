"use client";

import { useMemo, useRef, useState } from "react";
import { FileUp, Loader2, Plus, Radar, Save, Send, Wand2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RequestItem, Tab } from "../types";
import { callGrpc, decodeMessage, encodeMessage, exampleMessage, GRPC_STATUS, listMethods, loadRoot, reflect, rootToJson, type GrpcMethod, type GrpcResult } from "../lib/grpc";
import { resolve } from "../lib/vars";
import { fmtMs } from "../lib/util";
import { useApi } from "../store";
import { CodeEditor } from "./code-editor";
import { Btn, Empty, IconBtn, Label, Note, Resizer, Segmented, Select, SubTabs, Toggle, type Tier } from "./kit";
import { KVTable } from "./kv-table";
import { useVarInfo, VarInput, VarsContext } from "./var-input";
import { DocsEditor } from "./request-pane";

type Out = { result?: GrpcResult; decoded: unknown[]; error?: string; at: number };

export function GrpcWorkspace({ tab, tier }: { tab: Tab; tier: Tier }) {
  const req = tab.draft!;
  const g = req.grpc!;
  const update = useApi((s) => s.updateDraft);
  const vars = useVarInfo(tab.ref?.collectionId);
  const set = (fn: (r: RequestItem) => RequestItem) => update(tab.id, fn);
  const setG = (patch: Partial<NonNullable<RequestItem["grpc"]>>) => set((r) => ({ ...r, grpc: { ...r.grpc!, ...patch } }));
  const [section, setSection] = useState<"message" | "metadata" | "proto" | "settings" | "docs">(g.proto ? "message" : "proto");
  const [busy, setBusy] = useState<"" | "invoke" | "reflect">("");
  const [out, setOut] = useState<Out | null>(null);
  const [phoneView, setPhoneView] = useState<"request" | "response">("request");
  const [split, setSplit] = useState(0.5);
  const box = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const parsed = useMemo(() => {
    if (!g.proto.trim()) return { methods: [] as GrpcMethod[], error: null as string | null, root: null };
    try {
      const root = loadRoot(g.proto);
      return { methods: listMethods(root), error: null, root };
    } catch (e) {
      return { methods: [], error: (e as Error).message, root: null };
    }
  }, [g.proto]);
  const method = parsed.methods.find((m) => m.path === g.method);
  const r = (s: string) => resolve(s, vars.scopes);

  const doReflect = async () => {
    setBusy("reflect");
    try {
      const root = await reflect({ url: r(req.url), tls: g.tls, web: g.web, metadata: req.headers.filter((h) => h.enabled && h.key).map((h) => [r(h.key), r(h.value)]), timeoutMs: 20000 });
      setG({ proto: rootToJson(root) });
      useApi.getState().notify(`Found ${listMethods(root).length} methods by reflection`, "success");
      setSection("message");
    } catch (e) {
      useApi.getState().notify((e as Error).message, "danger");
    } finally {
      setBusy("");
    }
  };

  const invoke = async () => {
    if (!method || !parsed.root) {
      setOut({ decoded: [], error: parsed.root ? "Pick a method to call." : "Add the service definition first (Proto tab, or server reflection).", at: Date.now() });
      return;
    }
    setBusy("invoke");
    if (tier === "phone") setPhoneView("response");
    const t0 = Date.now();
    try {
      const msgs = [g.message, ...(method.requestStream ? g.stream : [])].map((m) => encodeMessage(parsed.root!, method.requestType, r(m)));
      const result = await callGrpc({ url: r(req.url), tls: g.tls, web: g.web, path: method.path, metadata: req.headers.filter((h) => h.enabled && h.key).map((h) => [r(h.key).toLowerCase(), r(h.value)]), messages: msgs, timeoutMs: req.settings.timeoutMs || 20000 });
      const decoded = result.messages.map((m) => {
        try {
          return decodeMessage(parsed.root!, method.responseType, m);
        } catch (e) {
          return { _decodeError: (e as Error).message };
        }
      });
      setOut({ result, decoded, at: t0 });
      useApi.getState().log(result.status === 0 ? "info" : "warn", `gRPC ${method.path}: ${GRPC_STATUS[result.status] ?? result.status}${result.message ? ` (${result.message})` : ""} in ${Math.round(result.ms)} ms`);
    } catch (e) {
      setOut({ decoded: [], error: (e as Error).message, at: t0 });
    } finally {
      setBusy("");
    }
  };

  return (
    <VarsContext.Provider value={vars}>
      <div className="flex h-full min-h-0 flex-col">
        <div className="shrink-0 border-b border-line px-2 py-2 sm:px-3">
          <input aria-label="Request name" value={req.name} onChange={(e) => set((x) => ({ ...x, name: e.target.value }))} className="mb-1.5 w-full truncate rounded-md bg-transparent px-1 py-0.5 text-[14px] font-medium text-ink outline-none hover:bg-paper-2 focus:bg-surface" />
          <div className="flex flex-wrap items-center gap-2">
            <VarInput ariaLabel="Server URL" value={req.url} onChange={(url) => set((x) => ({ ...x, url }))} placeholder="grpc.example.com:443" className="min-w-[160px] flex-1" />
            <Select
              label="Method"
              value={g.method}
              onChange={(m) => {
                const mm = parsed.methods.find((x) => x.path === m);
                setG({ method: m, ...(mm && parsed.root && (!g.message.trim() || g.message.trim() === "{}") ? { message: JSON.stringify(exampleMessage(parsed.root, mm.requestType), null, 2) } : {}) });
              }}
              options={[{ value: "", label: parsed.methods.length ? "Select a method" : "No methods (add a .proto)" }, ...parsed.methods.map((m) => ({ value: m.path, label: `${m.service.split(".").pop()} / ${m.name}${m.requestStream || m.responseStream ? ` (${m.requestStream ? "client" : ""}${m.requestStream && m.responseStream ? "/" : ""}${m.responseStream ? "server" : ""} stream)` : ""}` }))]}
              className="min-w-[180px] max-w-full flex-1 sm:max-w-[320px]"
            />
            <Btn variant="primary" size="md" icon={busy === "invoke" ? Loader2 : Send} onClick={invoke} disabled={!!busy} className={cn("h-[32px]", busy === "invoke" && "[&_svg]:animate-spin")}>
              Invoke
            </Btn>
            <Btn variant="ghost" icon={Save} onClick={() => useApi.getState().saveTab(tab.id) && useApi.getState().notify("Saved", "success")}>
              <span className="max-sm:hidden">Save</span>
            </Btn>
          </div>
        </div>
        {tier === "phone" && (
          <div className="flex shrink-0 justify-center border-b border-line py-1.5">
            <Segmented label="Show" value={phoneView} onChange={setPhoneView} options={[{ value: "request", label: "Request" }, { value: "response", label: "Response" }]} />
          </div>
        )}
        <div ref={box} className="flex min-h-0 flex-1 flex-col">
          {(tier !== "phone" || phoneView === "request") && (
            <div className="flex min-h-0 flex-col overflow-hidden" style={tier === "phone" ? { flex: 1 } : { flexBasis: `${split * 100}%`, flexShrink: 0 }}>
              <SubTabs value={section} onChange={setSection} tabs={[{ id: "message", label: "Message" }, { id: "metadata", label: "Metadata", count: req.headers.filter((h) => h.enabled && h.key).length || undefined }, { id: "proto", label: "Service definition", dot: !!g.proto }, { id: "settings", label: "Settings" }, { id: "docs", label: "Docs" }]} />
              <div className="min-h-0 flex-1 overflow-y-auto p-2 sm:p-3" data-lenis-prevent>
                {section === "message" && (
                  <div className="flex h-full min-h-[200px] flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <Label>{method ? `${method.requestType}${method.requestStream ? " · first message" : ""}` : "Message (JSON)"}</Label>
                      {method && parsed.root && (
                        <Btn variant="ghost" icon={Wand2} onClick={() => setG({ message: JSON.stringify(exampleMessage(parsed.root!, method.requestType), null, 2) })} className="ml-auto">
                          Generate example
                        </Btn>
                      )}
                    </div>
                    <CodeEditor value={g.message} onChange={(message) => setG({ message })} language="json" vars={vars} onRun={invoke} className="min-h-[140px] flex-1 rounded-md border border-line" ariaLabel="Message" />
                    {method?.requestStream && (
                      <div className="space-y-2">
                        <Label>More stream messages, sent in order</Label>
                        {g.stream.map((m, i) => (
                          <div key={i} className="flex items-start gap-1.5">
                            <CodeEditor value={m} onChange={(v) => setG({ stream: g.stream.map((x, j) => (j === i ? v : x)) })} language="json" className="h-24 flex-1 rounded-md border border-line" ariaLabel={`Stream message ${i + 2}`} />
                            <IconBtn icon={X} label="Remove message" onClick={() => setG({ stream: g.stream.filter((_, j) => j !== i) })} />
                          </div>
                        ))}
                        <Btn variant="ghost" icon={Plus} onClick={() => setG({ stream: [...g.stream, g.message] })}>
                          Add message
                        </Btn>
                      </div>
                    )}
                  </div>
                )}
                {section === "metadata" && <KVTable kind="headers" rows={req.headers} onChange={(headers) => set((x) => ({ ...x, headers }))} />}
                {section === "proto" && (
                  <div className="flex h-full min-h-[240px] flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        ref={fileInput}
                        type="file"
                        accept=".proto,text/plain"
                        className="sr-only"
                        onChange={async (e) => {
                          const f = e.target.files?.[0];
                          if (f) setG({ proto: await f.text() });
                          e.target.value = "";
                        }}
                      />
                      <Btn icon={FileUp} onClick={() => fileInput.current?.click()}>
                        Import .proto
                      </Btn>
                      <Btn icon={busy === "reflect" ? Loader2 : Radar} onClick={doReflect} disabled={!!busy || !req.url.trim()} className={busy === "reflect" ? "[&_svg]:animate-spin" : ""}>
                        Use server reflection
                      </Btn>
                      {parsed.methods.length > 0 && <span className="text-[12px] text-success">{parsed.methods.length} methods found</span>}
                    </div>
                    {parsed.error && <Note tone="danger">{parsed.error}</Note>}
                    {g.proto.trim().startsWith("{") ? (
                      <Note>
                        Loaded from server reflection ({parsed.methods.length} methods).{" "}
                        <button type="button" className="underline" onClick={() => setG({ proto: "" })}>
                          Clear
                        </button>
                      </Note>
                    ) : (
                      <CodeEditor value={g.proto} onChange={(proto) => setG({ proto })} language="text" className="min-h-[200px] flex-1 rounded-md border border-line" ariaLabel="Proto definition" placeholder={'syntax = "proto3";\n\npackage hello;\n\nservice Greeter {\n  rpc SayHello (HelloRequest) returns (HelloReply);\n}\n\nmessage HelloRequest { string name = 1; }\nmessage HelloReply { string message = 1; }'} />
                    )}
                    <p className="text-[12px] text-ink-3">Google&apos;s well-known types (Timestamp, Duration, Struct, Any, Empty, wrappers) can be imported. Other imports: paste their messages into the same file.</p>
                  </div>
                )}
                {section === "settings" && (
                  <div className="max-w-xl space-y-4">
                    <Toggle checked={g.tls} onChange={(tls) => setG({ tls })} label="Use TLS (secure connection)" description="Most public gRPC servers use TLS on port 443." />
                    <Toggle checked={g.web} onChange={(web) => setG({ web })} label="gRPC-Web from the browser" description="For servers behind a gRPC-Web proxy (Envoy, grpc-web): calls go straight from your browser. Off: our server calls the gRPC server over HTTP/2." />
                    <label className="grid gap-1 sm:grid-cols-[200px_160px] sm:items-center">
                      <span className="text-[13px]">Deadline (ms)</span>
                      <input type="number" min={100} step={1000} value={req.settings.timeoutMs || 20000} onChange={(e) => set((x) => ({ ...x, settings: { ...x.settings, timeoutMs: Number(e.target.value) || 20000 } }))} className="h-8 rounded-md border border-line bg-surface px-2.5 text-[13px] outline-none focus:border-ink" />
                    </label>
                  </div>
                )}
                {section === "docs" && <DocsEditor value={req.description} onChange={(description) => set((x) => ({ ...x, description }))} />}
              </div>
            </div>
          )}
          {tier !== "phone" && <Resizer dir="y" label="Resize request and response" onDrag={(d) => setSplit((s) => Math.min(0.8, Math.max(0.2, s + d / (box.current?.clientHeight ?? 1))))} />}
          {(tier !== "phone" || phoneView === "response") && <GrpcResponse out={out} busy={busy === "invoke"} />}
        </div>
      </div>
    </VarsContext.Provider>
  );
}

function GrpcResponse({ out, busy }: { out: Out | null; busy: boolean }) {
  const [t, setT] = useState<"response" | "metadata" | "trailers">("response");
  if (busy)
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-[13px] text-ink-2">
        <Loader2 aria-hidden className="size-4 animate-spin" /> Calling…
      </div>
    );
  if (!out) return <Empty title="Response">Pick a method and press Invoke.</Empty>;
  if (out.error)
    return (
      <div className="p-3">
        <Note tone="danger">{out.error}</Note>
      </div>
    );
  const res = out.result!;
  const ok = res.status === 0;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SubTabs
        value={t}
        onChange={setT}
        tabs={[
          { id: "response", label: "Response", count: res.messages.length > 1 ? res.messages.length : undefined },
          { id: "metadata", label: "Metadata", count: res.headers.length || undefined },
          { id: "trailers", label: "Trailers", count: res.trailers.length || undefined },
        ]}
        right={
          <span className="flex items-center gap-2 font-mono text-[12px]">
            <span className={ok ? "font-semibold text-success" : "font-semibold text-danger"}>
              {res.status} {GRPC_STATUS[res.status] ?? ""}
            </span>
            <span className="text-success">{fmtMs(res.ms)}</span>
            <span className="text-ink-3">{res.via === "cloud" ? "HTTP/2" : "gRPC-Web"}</span>
          </span>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto" data-lenis-prevent>
        {t === "response" &&
          (out.decoded.length ? (
            out.decoded.map((d, i) => (
              <div key={`${out.at}-${i}`} className="border-b border-line">
                {out.decoded.length > 1 && <p className="bg-paper px-3 py-1 font-mono text-[12px] text-ink-3">Message {i + 1}</p>}
                <CodeEditor value={JSON.stringify(d, null, 2)} readOnly language="json" className="max-h-[420px]" ariaLabel={`Response message ${i + 1}`} />
              </div>
            ))
          ) : (
            <p className="p-4 text-[13px] text-ink-3">{ok ? "The call succeeded with no message." : res.message || "The call failed."}</p>
          ))}
        {t !== "response" && (
          <table className="w-full text-[12.5px]">
            <tbody>
              {(t === "metadata" ? res.headers : res.trailers).map(([k, v], i) => (
                <tr key={i}>
                  <td className="border-b border-line px-3 py-1.5 font-mono font-medium">{k}</td>
                  <td className="break-all border-b border-l border-line px-3 py-1.5 font-mono text-ink-2">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!ok && res.message && t === "response" && (
          <div className="p-3">
            <Note tone="danger">
              {GRPC_STATUS[res.status] ?? res.status}: {res.message}
            </Note>
          </div>
        )}
      </div>
    </div>
  );
}
