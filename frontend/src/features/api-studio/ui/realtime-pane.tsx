"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Bookmark, ChevronDown, Info, Plug, PlugZap, Plus, Save, Search, Send, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MqttConfig, RequestItem, SavedMessage, SocketIoConfig, Tab } from "../types";
import { MqttClient, SocketIoClient, WsClient, type RtClient, type RtMessage } from "../lib/realtime";
import { resolve } from "../lib/vars";
import { fmtBytes, tryJson, uid } from "../lib/util";
import { useApi } from "../store";
import { CodeEditor } from "./code-editor";
import { Btn, Check2, IconBtn, Input, Label, Menu, Resizer, Segmented, Select, SubTabs, Toggle, type Tier } from "./kit";
import { KVTable } from "./kv-table";
import { useVarInfo, VarInput, VarsContext } from "./var-input";
import { DocsEditor } from "./request-pane";

type State = "idle" | "connecting" | "open" | "closed";

// Live connections outlive tab switches (like Postman), keyed by tab id.
const live = new Map<string, { client: RtClient; messages: RtMessage[]; state: State; listeners: Set<() => void> }>();

function useConnection(tabId: string) {
  const [, force] = useState(0);
  useEffect(() => {
    let entry = live.get(tabId);
    if (!entry) {
      entry = { client: null as unknown as RtClient, messages: [], state: "idle", listeners: new Set() };
      live.set(tabId, entry);
    }
    const l = () => force((n) => n + 1);
    entry.listeners.add(l);
    return () => void entry!.listeners.delete(l);
  }, [tabId]);
  const entry = live.get(tabId) ?? { client: null as unknown as RtClient, messages: [] as RtMessage[], state: "idle" as State, listeners: new Set<() => void>() };
  if (!live.has(tabId)) live.set(tabId, entry);
  const notify = () => entry.listeners.forEach((f) => f());
  const hooks = {
    onMessage: (m: Omit<RtMessage, "id">) => {
      entry.messages = [...entry.messages, { ...m, id: uid() }].slice(-5000);
      notify();
    },
    onState: (s: "connecting" | "open" | "closed") => {
      entry.state = s;
      notify();
    },
  };
  return {
    state: entry.state,
    messages: entry.messages,
    client: entry.client,
    connect: (make: (h: typeof hooks) => RtClient) => {
      try {
        entry.client = make(hooks);
      } catch (e) {
        hooks.onMessage({ at: Date.now(), dir: "sys", text: (e as Error).message, size: 0, level: "error" });
        hooks.onState("closed");
      }
    },
    disconnect: () => entry.client?.close(),
    clear: () => {
      entry.messages = [];
      notify();
    },
    log: hooks.onMessage,
  };
}

export function closeRealtime(tabId: string) {
  live.get(tabId)?.client?.close();
  live.delete(tabId);
}

export function RealtimeWorkspace({ tab, tier }: { tab: Tab; tier: Tier }) {
  const req = tab.draft!;
  const update = useApi((s) => s.updateDraft);
  const vars = useVarInfo(tab.ref?.collectionId);
  const conn = useConnection(tab.id);
  const set = (fn: (r: RequestItem) => RequestItem) => update(tab.id, fn);
  const [section, setSection] = useState<"message" | "params" | "headers" | "settings" | "events" | "topics" | "docs">(req.protocol === "socketio" ? "message" : req.protocol === "mqtt" ? "topics" : "message");
  const box = useRef<HTMLDivElement>(null);
  const [split, setSplit] = useState(0.45);
  const [phoneView, setPhoneView] = useState<"compose" | "messages">("compose");

  const connected = conn.state === "open";
  const busy = conn.state === "connecting";
  const r = (s: string) => resolve(s, vars.scopes);

  const connect = () => {
    const url = r(req.url).trim();
    if (!url) {
      conn.log({ at: Date.now(), dir: "sys", text: "Enter the server URL first.", size: 0, level: "error" });
      return;
    }
    const q = req.params.filter((p) => p.enabled && p.key).map((p) => `${encodeURIComponent(r(p.key))}=${encodeURIComponent(r(p.value))}`).join("&");
    const full = q && !url.includes("?") ? `${url}?${q}` : url;
    if (req.headers.some((h) => h.enabled && h.key)) conn.log({ at: Date.now(), dir: "sys", text: "Browsers can't set custom headers on a WebSocket handshake; pass tokens in the URL query (Params) or the Socket.IO auth payload instead.", size: 0, level: "info" });
    if (req.protocol === "ws") conn.connect((h) => new WsClient(full, (req.wsProtocols ?? "").split(",").map((s) => s.trim()).filter(Boolean), h));
    else if (req.protocol === "socketio") conn.connect((h) => new SocketIoClient(full, { ...req.socketio!, auth: r(req.socketio!.auth) }, h));
    else if (req.protocol === "mqtt") conn.connect((h) => new MqttClient(full, { ...req.mqtt!, clientId: r(req.mqtt!.clientId), username: r(req.mqtt!.username), password: r(req.mqtt!.password) }, h));
    if (tier === "phone") setPhoneView("messages");
  };

  const sections =
    req.protocol === "ws"
      ? [{ id: "message", label: "Message" }, { id: "params", label: "Params" }, { id: "settings", label: "Settings" }, { id: "docs", label: "Docs" }]
      : req.protocol === "socketio"
        ? [{ id: "message", label: "Message" }, { id: "events", label: "Events" }, { id: "params", label: "Params" }, { id: "settings", label: "Settings" }, { id: "docs", label: "Docs" }]
        : [{ id: "topics", label: "Topics" }, { id: "message", label: "Publish" }, { id: "settings", label: "Settings" }, { id: "docs", label: "Docs" }];

  return (
    <VarsContext.Provider value={vars}>
      <div className="flex h-full min-h-0 flex-col">
        <div className="shrink-0 border-b border-line px-2 py-2 sm:px-3">
          <input aria-label="Request name" value={req.name} onChange={(e) => set((x) => ({ ...x, name: e.target.value }))} className="mb-1.5 w-full truncate rounded-md bg-transparent px-1 py-0.5 text-[14px] font-medium text-ink outline-none hover:bg-paper-2 focus:bg-surface" />
          <div className="flex items-center gap-2">
            <span className="inline-flex h-[32px] shrink-0 items-center rounded-md border border-line bg-paper px-2.5 font-mono text-[12px] font-semibold text-ink-2">{req.protocol === "ws" ? "WebSocket" : req.protocol === "socketio" ? "Socket.IO" : "MQTT"}</span>
            <VarInput ariaLabel="Server URL" value={req.url} onChange={(url) => set((x) => ({ ...x, url }))} onEnter={connected ? undefined : connect} placeholder={req.protocol === "mqtt" ? "wss://broker.hivemq.com:8884/mqtt" : req.protocol === "socketio" ? "https://your-server.io" : "wss://echo.websocket.org"} className="flex-1" />
            {connected || busy ? (
              <Btn variant="secondary" size="md" icon={X} onClick={conn.disconnect} className="h-[32px]">
                <span className="max-sm:sr-only">Disconnect</span>
              </Btn>
            ) : (
              <Btn variant="primary" size="md" icon={Plug} onClick={connect} className="h-[32px]">
                <span className="max-sm:sr-only">Connect</span>
              </Btn>
            )}
            <Btn variant="ghost" icon={Save} onClick={() => useApi.getState().saveTab(tab.id) && useApi.getState().notify("Saved", "success")}>
              <span className="max-sm:hidden">Save</span>
            </Btn>
          </div>
        </div>
        {tier === "phone" && (
          <div className="flex shrink-0 justify-center border-b border-line py-1.5">
            <Segmented label="Show" value={phoneView} onChange={setPhoneView} options={[{ value: "compose", label: "Compose" }, { value: "messages", label: `Messages (${conn.messages.length})` }]} />
          </div>
        )}
        <div ref={box} className="flex min-h-0 flex-1 flex-col">
          {(tier !== "phone" || phoneView === "compose") && (
            <div className="flex min-h-0 flex-col overflow-hidden" style={tier === "phone" ? { flex: 1 } : { flexBasis: `${split * 100}%`, flexShrink: 0 }}>
              <SubTabs value={section} onChange={setSection} tabs={sections as { id: typeof section; label: string }[]} />
              <div className="min-h-0 flex-1 overflow-y-auto p-2 sm:p-3" data-lenis-prevent>
                {section === "message" && <Composer req={req} set={set} connected={connected} client={conn.client} vars={vars.scopes} />}
                {section === "params" && <KVTable kind="params" rows={req.params} onChange={(params) => set((x) => ({ ...x, params }))} />}
                {section === "events" && req.socketio && <SocketEvents cfg={req.socketio} onChange={(socketio) => set((x) => ({ ...x, socketio }))} />}
                {section === "topics" && req.mqtt && <MqttTopics cfg={req.mqtt} onChange={(mqtt) => set((x) => ({ ...x, mqtt }))} client={connected ? (conn.client as MqttClient) : null} />}
                {section === "settings" && <RtSettings req={req} set={set} />}
                {section === "docs" && <DocsEditor value={req.description} onChange={(description) => set((x) => ({ ...x, description }))} />}
              </div>
            </div>
          )}
          {tier !== "phone" && (
            <Resizer
              dir="y"
              label="Resize composer and messages"
              onDrag={(d) => setSplit((s) => Math.min(0.8, Math.max(0.2, s + d / (box.current?.clientHeight ?? 1))))}
            />
          )}
          {(tier !== "phone" || phoneView === "messages") && <MessageLog messages={conn.messages} state={conn.state} onClear={conn.clear} />}
        </div>
      </div>
    </VarsContext.Provider>
  );
}

function Composer({ req, set, connected, client, vars }: { req: RequestItem; set: (fn: (r: RequestItem) => RequestItem) => void; connected: boolean; client: RtClient; vars: import("../lib/vars").Scopes }) {
  const [text, setText] = useState(req.messages?.[0]?.body ?? "");
  const [format, setFormat] = useState<"text" | "json" | "binary">(req.messages?.[0]?.format ?? "text");
  const [event, setEvent] = useState(req.messages?.[0]?.event ?? "message");
  const [args, setArgs] = useState<string[]>([]);
  const [ack, setAck] = useState(false);
  const [topic, setTopic] = useState(req.messages?.[0]?.topic ?? "");
  const [qos, setQos] = useState<0 | 1 | 2>(req.messages?.[0]?.qos ?? 0);
  const [retain, setRetain] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const r = (s: string) => resolve(s, vars);

  const sendNow = () => {
    setErr(null);
    try {
      if (req.protocol === "ws") (client as WsClient).send(r(text), format);
      else if (req.protocol === "socketio") (client as SocketIoClient).emit(r(event), [r(text), ...args.map(r)].filter((a, i) => i === 0 || a !== ""), ack);
      else (client as MqttClient).publish(r(topic), r(text), qos, retain);
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const saveMessage = () => {
    const m: SavedMessage = { id: uid(), name: (req.protocol === "socketio" ? event : req.protocol === "mqtt" ? topic : text.slice(0, 30)) || "Message", body: text, format, event, topic, qos, retain };
    set((x) => ({ ...x, messages: [m, ...(x.messages ?? [])].slice(0, 50) }));
  };
  const jsonErr = format === "json" && text.trim() && !tryJson(text.replace(/\{\{[^{}]+\}\}/g, "0")).ok;

  return (
    <div className="flex h-full min-h-[200px] flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {req.protocol === "socketio" && <VarInput ariaLabel="Event name" value={event} onChange={setEvent} placeholder="Event name" className="w-40" />}
        {req.protocol === "mqtt" && (
          <>
            <VarInput ariaLabel="Topic" value={topic} onChange={setTopic} placeholder="Topic, e.g. sensors/kitchen" className="min-w-[160px] flex-1" />
            <Select label="QoS" value={String(qos) as "0"} onChange={(v) => setQos(Number(v) as 0)} options={[{ value: "0", label: "QoS 0" }, { value: "1", label: "QoS 1" }, { value: "2", label: "QoS 2" }]} />
            <label className="inline-flex items-center gap-1.5 text-[12px] text-ink-2">
              <Check2 checked={retain} onChange={setRetain} label="Retain" /> Retain
            </label>
          </>
        )}
        <Segmented label="Format" value={format} onChange={setFormat} options={[{ value: "text", label: "Text" }, { value: "json", label: "JSON" }, ...(req.protocol === "ws" ? [{ value: "binary" as const, label: "Binary" }] : [])]} />
        <span className="ml-auto flex items-center gap-1">
          {(req.messages?.length ?? 0) > 0 && (
            <Menu
              label="Saved messages"
              align="end"
              items={[
                ...(req.messages ?? []).map((m) => ({
                  label: m.name,
                  icon: Bookmark,
                  onClick: () => {
                    setText(m.body);
                    setFormat(m.format);
                    if (m.event) setEvent(m.event);
                    if (m.topic) setTopic(m.topic);
                    if (m.qos !== undefined) setQos(m.qos);
                  },
                })),
                { divider: true, label: "" },
                { label: "Delete all saved", icon: Trash2, danger: true, onClick: () => set((x) => ({ ...x, messages: [] })) },
              ]}
              trigger={({ toggle, ref }) => (
                <Btn ref={ref} variant="ghost" icon={Bookmark} onClick={toggle}>
                  Saved <ChevronDown aria-hidden className="size-3" />
                </Btn>
              )}
            />
          )}
          <IconBtn icon={Bookmark} label="Save this message" onClick={saveMessage} />
          <Btn variant="primary" icon={Send} onClick={sendNow} disabled={!connected}>
            {req.protocol === "mqtt" ? "Publish" : req.protocol === "socketio" ? "Emit" : "Send"}
          </Btn>
        </span>
      </div>
      <CodeEditor value={text} onChange={setText} language={format === "json" ? "json" : "text"} onRun={sendNow} className="min-h-[110px] flex-1 rounded-md border border-line" ariaLabel="Message" placeholder={format === "binary" ? "Base64 or hex bytes" : "Compose a message"} />
      {jsonErr && <p className="text-[12px] text-warning">This isn&apos;t valid JSON yet.</p>}
      {req.protocol === "socketio" && (
        <div className="space-y-1.5">
          {args.map((a, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <Label className="w-12 shrink-0">Arg {i + 2}</Label>
              <Input mono value={a} onChange={(e) => setArgs(args.map((x, j) => (j === i ? e.target.value : x)))} aria-label={`Argument ${i + 2}`} />
              <IconBtn icon={X} label="Remove argument" size="xs" onClick={() => setArgs(args.filter((_, j) => j !== i))} />
            </div>
          ))}
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => setArgs([...args, ""])} className="inline-flex items-center gap-1 text-[12px] text-ink-2 hover:text-ink">
              <Plus aria-hidden className="size-3.5" /> Add argument
            </button>
            <label className="inline-flex items-center gap-1.5 text-[12px] text-ink-2">
              <Check2 checked={ack} onChange={setAck} label="Ask for an acknowledgement" /> Ack
            </label>
          </div>
        </div>
      )}
      {!connected && <p className="text-[12px] text-ink-3">Connect first to send messages.</p>}
      {err && <p className="text-[12px] text-danger">{err}</p>}
    </div>
  );
}

function SocketEvents({ cfg, onChange }: { cfg: SocketIoConfig; onChange: (c: SocketIoConfig) => void }) {
  const [name, setName] = useState("");
  return (
    <div className="max-w-xl space-y-3">
      <p className="text-[13px] text-ink-2">Messages for these events show in the log. Use <code className="font-mono">*</code> to listen to every event. Changes apply on the next connect.</p>
      <ul className="divide-y divide-line rounded-md border border-line">
        {cfg.listeners.map((l) => (
          <li key={l.id} className="flex items-center gap-2 px-2.5 py-1.5">
            <Check2 checked={l.enabled} onChange={(v) => onChange({ ...cfg, listeners: cfg.listeners.map((x) => (x.id === l.id ? { ...x, enabled: v } : x)) })} label="Listen" />
            <span className="flex-1 font-mono text-[13px]">{l.event}</span>
            <IconBtn icon={Trash2} label="Remove" size="xs" onClick={() => onChange({ ...cfg, listeners: cfg.listeners.filter((x) => x.id !== l.id) })} />
          </li>
        ))}
      </ul>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) onChange({ ...cfg, listeners: [...cfg.listeners, { id: uid(), event: name.trim(), enabled: true }] });
          setName("");
        }}
      >
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Event name" aria-label="New event" mono />
        <Btn type="submit" icon={Plus}>
          Listen
        </Btn>
      </form>
    </div>
  );
}

function MqttTopics({ cfg, onChange, client }: { cfg: MqttConfig; onChange: (c: MqttConfig) => void; client: MqttClient | null }) {
  const [topic, setTopic] = useState("");
  const [qos, setQos] = useState<0 | 1 | 2>(0);
  return (
    <div className="max-w-xl space-y-3">
      <p className="text-[13px] text-ink-2">Topics to subscribe to on connect. Wildcards: <code className="font-mono">+</code> one level, <code className="font-mono">#</code> everything below.</p>
      <ul className="divide-y divide-line rounded-md border border-line">
        {cfg.subscriptions.length === 0 && <li className="px-3 py-2 text-[13px] text-ink-3">No topics yet.</li>}
        {cfg.subscriptions.map((s) => (
          <li key={s.id} className="flex items-center gap-2 px-2.5 py-1.5">
            <Check2 checked={s.enabled} onChange={(v) => onChange({ ...cfg, subscriptions: cfg.subscriptions.map((x) => (x.id === s.id ? { ...x, enabled: v } : x)) })} label="Subscribe" />
            <span className="flex-1 truncate font-mono text-[13px]">{s.topic}</span>
            <span className="font-mono text-[12px] text-ink-3">QoS {s.qos}</span>
            {client && (
              <button type="button" onClick={() => client.unsubscribe(s.topic)} className="text-[12px] text-ink-2 hover:text-ink">
                Unsubscribe
              </button>
            )}
            <IconBtn icon={Trash2} label="Remove" size="xs" onClick={() => onChange({ ...cfg, subscriptions: cfg.subscriptions.filter((x) => x.id !== s.id) })} />
          </li>
        ))}
      </ul>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const t = topic.trim();
          if (!t) return;
          onChange({ ...cfg, subscriptions: [...cfg.subscriptions, { id: uid(), topic: t, qos, enabled: true }] });
          if (client) client.subscribe([{ topic: t, qos }]);
          setTopic("");
        }}
      >
        <Input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="home/+/temperature" aria-label="Topic" mono className="min-w-[180px] flex-1" />
        <Select label="QoS" value={String(qos) as "0"} onChange={(v) => setQos(Number(v) as 0)} options={[{ value: "0", label: "QoS 0" }, { value: "1", label: "QoS 1" }, { value: "2", label: "QoS 2" }]} />
        <Btn type="submit" icon={Plus}>
          {client ? "Subscribe" : "Add"}
        </Btn>
      </form>
    </div>
  );
}

function RtSettings({ req, set }: { req: RequestItem; set: (fn: (r: RequestItem) => RequestItem) => void }) {
  if (req.protocol === "ws")
    return (
      <div className="max-w-xl space-y-3">
        <label className="block space-y-1">
          <span className="text-[13px] text-ink">Sub-protocols (Sec-WebSocket-Protocol)</span>
          <Input mono value={req.wsProtocols ?? ""} onChange={(e) => set((x) => ({ ...x, wsProtocols: e.target.value }))} placeholder="graphql-ws, chat" />
        </label>
        <p className="flex gap-2 text-[12px] leading-relaxed text-ink-3">
          <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          WebSockets connect straight from your browser (they aren&apos;t limited by CORS), so local servers work too. Browsers don&apos;t allow custom handshake headers.
        </p>
      </div>
    );
  if (req.protocol === "socketio" && req.socketio) {
    const c = req.socketio;
    const up = (p: Partial<SocketIoConfig>) => set((x) => ({ ...x, socketio: { ...c, ...p } }));
    return (
      <div className="max-w-xl space-y-3">
        <label className="grid gap-1 sm:grid-cols-[160px_1fr] sm:items-center">
          <span className="text-[13px]">Client version</span>
          <Select label="Client version" value={c.version} onChange={(version) => up({ version })} options={[{ value: "v4", label: "v4 (Socket.IO 4)" }, { value: "v3", label: "v3 (Socket.IO 3)" }, { value: "v2", label: "v2 (Socket.IO 2, EIO 3)" }]} />
        </label>
        <label className="grid gap-1 sm:grid-cols-[160px_1fr] sm:items-center">
          <span className="text-[13px]">Handshake path</span>
          <Input mono value={c.path} onChange={(e) => up({ path: e.target.value })} placeholder="/socket.io" />
        </label>
        <label className="grid gap-1 sm:grid-cols-[160px_1fr] sm:items-center">
          <span className="text-[13px]">Namespace</span>
          <Input mono value={c.namespace} onChange={(e) => up({ namespace: e.target.value })} placeholder="/" />
        </label>
        <label className="grid gap-1 sm:grid-cols-[160px_1fr] sm:items-start">
          <span className="pt-1 text-[13px]">Auth payload (JSON)</span>
          <textarea value={c.auth} onChange={(e) => up({ auth: e.target.value })} rows={4} placeholder='{ "token": "{{token}}" }' className="w-full rounded-md border border-line bg-surface p-2 font-mono text-[13px] outline-none focus:border-ink" />
        </label>
        <Toggle checked={c.ack} onChange={(ack) => up({ ack })} label="Acknowledge incoming events" description="Reply to events that ask for an acknowledgement." />
      </div>
    );
  }
  if (req.protocol === "mqtt" && req.mqtt) {
    const c = req.mqtt;
    const up = (p: Partial<MqttConfig>) => set((x) => ({ ...x, mqtt: { ...c, ...p } }));
    return (
      <div className="max-w-xl space-y-3">
        <label className="grid gap-1 sm:grid-cols-[160px_1fr] sm:items-center">
          <span className="text-[13px]">MQTT version</span>
          <Select label="MQTT version" value={c.version} onChange={(version) => up({ version })} options={[{ value: "3.1.1", label: "3.1.1" }, { value: "5.0", label: "5.0" }]} />
        </label>
        <label className="grid gap-1 sm:grid-cols-[160px_1fr] sm:items-center">
          <span className="text-[13px]">Client ID</span>
          <VarInput ariaLabel="Client ID" value={c.clientId} onChange={(clientId) => up({ clientId })} />
        </label>
        <label className="grid gap-1 sm:grid-cols-[160px_1fr] sm:items-center">
          <span className="text-[13px]">Username</span>
          <VarInput ariaLabel="Username" value={c.username} onChange={(username) => up({ username })} />
        </label>
        <label className="grid gap-1 sm:grid-cols-[160px_1fr] sm:items-center">
          <span className="text-[13px]">Password</span>
          <VarInput ariaLabel="Password" type="password" value={c.password} onChange={(password) => up({ password })} />
        </label>
        <label className="grid gap-1 sm:grid-cols-[160px_1fr] sm:items-center">
          <span className="text-[13px]">Keep alive (s)</span>
          <Input type="number" min={0} value={c.keepAlive} onChange={(e) => up({ keepAlive: Math.max(0, Number(e.target.value) || 0) })} />
        </label>
        <Toggle checked={c.clean} onChange={(clean) => up({ clean })} label="Clean session" description="Start without the broker's saved subscriptions and queued messages." />
        <div className="space-y-2 rounded-md border border-line p-3">
          <Label>Last will</Label>
          <Input mono value={c.lastWill?.topic ?? ""} onChange={(e) => up({ lastWill: { payload: "", qos: 0, retain: false, ...c.lastWill, topic: e.target.value } })} placeholder="Topic (empty = none)" aria-label="Last will topic" />
          <Input mono value={c.lastWill?.payload ?? ""} onChange={(e) => up({ lastWill: { topic: "", qos: 0, retain: false, ...c.lastWill, payload: e.target.value } })} placeholder="Message" aria-label="Last will message" />
        </div>
        <p className="text-[12px] text-ink-3">Brokers are reached over WebSocket from your browser (for example wss://broker.hivemq.com:8884/mqtt or wss://test.mosquitto.org:8081).</p>
      </div>
    );
  }
  return null;
}

function MessageLog({ messages, state, onClear }: { messages: RtMessage[]; state: State; onClear: () => void }) {
  const [q, setQ] = useState("");
  const [dir, setDir] = useState<"all" | "in" | "out">("all");
  const [open, setOpen] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const list = useMemo(() => messages.filter((m) => (dir === "all" || m.dir === dir || m.dir === "sys") && (!q || m.text.toLowerCase().includes(q.toLowerCase()) || (m.event ?? m.topic ?? "").toLowerCase().includes(q.toLowerCase()))), [messages, q, dir]);
  useEffect(() => {
    if (stick.current) end.current?.scrollIntoView({ block: "end" });
  }, [list.length]);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-2 py-1.5">
        <span className="inline-flex items-center gap-1.5 text-[13px] font-medium">
          {state === "open" ? <PlugZap aria-hidden className="size-4 text-success" /> : <Plug aria-hidden className="size-4 text-ink-3" />}
          {state === "open" ? "Connected" : state === "connecting" ? "Connecting…" : "Messages"}
        </span>
        <Segmented label="Direction" value={dir} onChange={setDir} options={[{ value: "all", label: "All" }, { value: "in", label: "Received" }, { value: "out", label: "Sent" }]} />
        <span className="relative ml-auto">
          <Search aria-hidden className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-ink-3" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search messages" className="w-40 pl-7" />
        </span>
        <IconBtn icon={Trash2} label="Clear messages" onClick={onClear} />
      </div>
      <div
        className="min-h-0 flex-1 overflow-y-auto font-mono text-[12px]"
        data-lenis-prevent
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {!list.length && <p className="p-4 text-center font-sans text-[13px] text-ink-3">{messages.length ? "No messages match." : "Connect to see messages here."}</p>}
        {list.map((m) => {
          const j = m.dir !== "sys" ? tryJson(m.text) : { ok: false as const };
          const isOpen = open === m.id;
          return (
            <div key={m.id} className={cn("border-b border-line", m.dir === "sys" && "bg-paper")}>
              <button type="button" onClick={() => setOpen(isOpen ? null : m.id)} className="flex w-full items-start gap-2 px-2.5 py-1.5 text-left hover:bg-paper-2">
                {m.dir === "in" ? <ArrowDownLeft aria-label="Received" className="mt-0.5 size-3.5 shrink-0 text-success" /> : m.dir === "out" ? <ArrowUpRight aria-label="Sent" className="mt-0.5 size-3.5 shrink-0 text-warning" /> : <Info aria-hidden className={cn("mt-0.5 size-3.5 shrink-0", m.level === "error" ? "text-danger" : m.level === "success" ? "text-success" : "text-ink-3")} />}
                {(m.event || m.topic) && <span className="shrink-0 rounded-sm bg-paper-2 px-1.5 text-ink">{m.event ?? m.topic}</span>}
                <span className={cn("min-w-0 flex-1", isOpen ? "whitespace-pre-wrap break-all" : "truncate", m.dir === "sys" ? "font-sans text-[12.5px]" : "", m.level === "error" && "text-danger")}>{isOpen && j.ok ? JSON.stringify(j.value, null, 2) : m.binary ? `[binary ${fmtBytes(m.size)}] ${m.text}` : m.text}</span>
                <span className="shrink-0 text-ink-3">{new Date(m.at).toLocaleTimeString()}</span>
              </button>
            </div>
          );
        })}
        <div ref={end} />
      </div>
    </div>
  );
}
