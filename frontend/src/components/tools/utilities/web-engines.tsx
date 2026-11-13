"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Camera, CameraOff, Download, ExternalLink, Plus, RotateCw, X } from "lucide-react";
import { motion } from "motion/react";
import { saveBlob } from "@/lib/files";
import { formatBytes } from "@/lib/media";
import { cssToLess, htmlEncode } from "@/lib/utilities/text";
import { cn } from "@/lib/utils";
import { Chips, Notice, Panel, Row, Slider, TextField, Toggle } from "../pdf/kit";
import { CopyButton, Editor, Output, ValueList, ValueRow } from "../dev/parts";
import type { EngineProps } from "./text-engines";
import { postJson } from "./post-json";
import { RunButton } from "./xml-engines";
import { DEVICES, DeviceFrame, frameSize, GROUPS, type Device, type FrameKind } from "./device-frames";

/* ================= Network (server) ================= */

type DnsRes = { host: string; records: Record<string, { value: string; ttl: number | null; priority?: number }[]>; ms: number };
type HttpRes = {
  url: string;
  status: number;
  reason: string;
  http_version: string;
  headers: [string, string][];
  body: string;
  size: number;
  truncated: boolean;
  ms: number;
  hops: { url: string; status: number; reason: string; ms: number; ip: string }[];
};

const STATUS_TONE = (s: number) => (s < 300 ? "text-success" : s < 400 ? "text-accent" : "text-danger");
const SECURITY_HEADERS = [
  "strict-transport-security",
  "content-security-policy",
  "x-content-type-options",
  "x-frame-options",
  "referrer-policy",
  "permissions-policy",
];

export function NetworkEngine({ preset }: EngineProps) {
  const kind = preset.kind ?? "dns";
  if (kind === "api") return <ApiTester />;
  if (kind === "headers" || kind === "status") return <HttpCheck kind={kind} />;
  if (kind === "port") return <PortCheck />;
  if (kind === "reverse") return <ReverseCheck />;
  return <DnsCheck kind={kind} />;
}

function useRun<T>() {
  const [s, setS] = useState<{ busy: boolean; res: T | null; error: string | null }>({ busy: false, res: null, error: null });
  const run = async (fn: () => Promise<T>) => {
    setS({ busy: true, res: null, error: null });
    try {
      setS({ busy: false, res: await fn(), error: null });
    } catch (e) {
      setS({ busy: false, res: null, error: (e as Error).message });
    }
  };
  return [s, run] as const;
}

function HostForm({
  label,
  value,
  onChange,
  onRun,
  busy,
  placeholder,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onRun: () => void;
  busy: boolean;
  placeholder: string;
  children?: React.ReactNode;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onRun();
      }}
    >
      <Panel>
        <Row label={label}>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="min-w-0 flex-1">
              <TextField label={label} value={value} onChange={onChange} placeholder={placeholder} mono />
            </div>
            <RunButton busy={busy} onClick={onRun} disabled={!value.trim()}>
              Check
            </RunButton>
          </div>
        </Row>
        {children}
      </Panel>
    </form>
  );
}

const DNS_TYPES: Record<string, string[]> = { dns: ["A", "AAAA", "CNAME", "MX", "NS", "TXT", "SOA", "CAA"], mx: ["MX"], ns: ["NS"], ip: ["A", "AAAA"] };

function DnsCheck({ kind }: { kind: string }) {
  const [host, setHost] = useState("example.com");
  const [s, run] = useRun<DnsRes>();
  const types = DNS_TYPES[kind] ?? DNS_TYPES.dns;
  const go = () => run(() => postJson<DnsRes>("dns", { host, types }));
  const rows = s.res ? types.flatMap((t) => (s.res!.records[t] ?? []).map((r) => ({ t, ...r }))) : [];
  const empty = s.res ? types.filter((t) => !(s.res!.records[t] ?? []).length) : [];
  return (
    <>
      <HostForm label="Domain" value={host} onChange={setHost} onRun={go} busy={s.busy} placeholder="example.com or https://example.com/page" />
      {s.error && <Notice tone="danger">{s.error}</Notice>}
      {s.res && (
        <div className="overflow-hidden rounded-md border border-line bg-surface">
          <div className="flex items-center justify-between border-b border-line bg-paper px-3 py-1.5">
            <span className="font-mono text-[12px] text-ink">
              {s.res.host} · {rows.length} record{rows.length === 1 ? "" : "s"} · {s.res.ms} ms
            </span>
            <CopyButton text={rows.map((r) => `${r.t}\t${r.priority !== undefined ? r.priority + " " : ""}${r.value}`).join("\n")} label="Copy all" />
          </div>
          {rows.length ? (
            <div className="overflow-x-auto" data-lenis-prevent>
              <table className="w-full text-left text-[13px]">
                <thead className="label-mono text-ink-3">
                  <tr className="border-b border-line">
                    <th className="w-14 px-3 py-2 font-normal">Type</th>
                    {kind !== "ip" && <th className="hidden px-3 py-2 font-normal sm:table-cell">Priority</th>}
                    <th className="px-3 py-2 font-normal">Value</th>
                    <th className="px-3 py-2 text-right font-normal">TTL</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((r, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2 font-mono text-accent">{r.t}</td>
                      {kind !== "ip" && <td className="hidden px-3 py-2 font-mono text-ink-2 sm:table-cell">{r.priority ?? ""}</td>}
                      <td className="px-3 py-2 font-mono text-ink [overflow-wrap:anywhere]">
                        {r.priority !== undefined && <span className="mr-1.5 text-ink-3 sm:hidden">{r.priority}</span>}
                        {r.value}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-ink-3">{r.ttl ?? "—"}s</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="px-3 py-4 text-sm text-ink-3">No records found.</p>
          )}
          {rows.length > 0 && empty.length > 0 && <p className="border-t border-line px-3 py-2 text-xs text-ink-3">No {empty.join(", ")} records.</p>}
        </div>
      )}
    </>
  );
}

function ReverseCheck() {
  const [ip, setIp] = useState("8.8.8.8");
  const [s, run] = useRun<{ ip: string; hostnames: string[]; public: boolean }>();
  return (
    <>
      <HostForm
        label="IP address"
        value={ip}
        onChange={setIp}
        onRun={() => run(() => postJson("reverse", { ip }))}
        busy={s.busy}
        placeholder="8.8.8.8 or 2606:4700:4700::1111"
      />
      {s.error && <Notice tone="danger">{s.error}</Notice>}
      {s.res && (
        <ValueList>
          {s.res.hostnames.length ? (
            s.res.hostnames.map((h) => <ValueRow key={h} label="Hostname" value={h} />)
          ) : (
            <ValueRow label="Hostname" value="" note="This address has no reverse DNS (PTR) record." />
          )}
          <ValueRow label="Address" value={s.res.ip} note={s.res.public ? "Public address" : "Private or reserved address"} />
        </ValueList>
      )}
    </>
  );
}

const COMMON_PORTS = [22, 25, 53, 80, 443, 587, 993, 3306, 5432, 8080];

function PortCheck() {
  const [host, setHost] = useState("example.com");
  const [port, setPort] = useState("443");
  const [s, run] = useRun<{ host: string; ip: string; port: number; state: string; ms: number; service: string | null }>();
  const go = () => run(() => postJson("port", { host, port: Number(port) }));
  return (
    <>
      <HostForm label="Host" value={host} onChange={setHost} onRun={go} busy={s.busy} placeholder="example.com or 93.184.215.14">
        <Row label="Port">
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-28">
              <TextField label="Port" value={port} onChange={(v) => setPort(v.replace(/\D/g, "").slice(0, 5))} mono inputMode="numeric" />
            </div>
            {COMMON_PORTS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPort(String(p))}
                className={cn(
                  "rounded-[6px] px-2 py-1 font-mono text-[12px]",
                  String(p) === port ? "bg-ink text-paper" : "bg-paper-2 text-ink-2 hover:text-ink",
                )}
              >
                {p}
              </button>
            ))}
          </div>
        </Row>
      </HostForm>
      {s.error && <Notice tone="danger">{s.error}</Notice>}
      {s.res && (
        <div className={cn("rounded-md border px-5 py-5", s.res.state === "open" ? "border-success/40 bg-success/5" : "border-line bg-surface")}>
          <p className={cn("text-lg font-semibold", s.res.state === "open" ? "text-success" : "text-ink")}>
            Port {s.res.port} is {s.res.state}
            {s.res.service ? ` (${s.res.service})` : ""}
          </p>
          <p className="mt-1 text-sm text-ink-2">
            {s.res.state === "open"
              ? "Something is listening and accepted our connection."
              : s.res.state === "closed"
                ? "The server answered, but nothing is listening on this port."
                : "No answer: a firewall is probably dropping connections to this port."}
          </p>
          <p className="mt-3 font-mono text-xs text-ink-3">
            {s.res.host} → {s.res.ip} · {s.res.ms} ms
          </p>
        </div>
      )}
      <Notice>The check connects from our server, so it shows what the internet sees. Only public addresses can be checked.</Notice>
    </>
  );
}

function HttpResult({ res, showBody }: { res: HttpRes; showBody: boolean }) {
  const lower = new Set(res.headers.map(([k]) => k.toLowerCase()));
  const pretty = useMemo(() => {
    const ct = res.headers.find(([k]) => k.toLowerCase() === "content-type")?.[1] ?? "";
    if (/json/.test(ct)) {
      try {
        return JSON.stringify(JSON.parse(res.body), null, 2);
      } catch {
        return res.body;
      }
    }
    return res.body;
  }, [res]);
  return (
    <>
      <div className="overflow-hidden rounded-md border border-line bg-surface">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-line bg-paper px-4 py-3">
          <span className={cn("font-mono text-2xl font-semibold", STATUS_TONE(res.status))}>{res.status}</span>
          <span className="text-sm text-ink">{res.reason}</span>
          <span className="ml-auto font-mono text-xs text-ink-3">
            {res.http_version} · {res.ms} ms · {formatBytes(res.size)}
          </span>
        </div>
        {res.hops.length > 1 && (
          <ol className="divide-y divide-line border-b border-line">
            {res.hops.map((h, i) => (
              <li key={i} className="flex items-center gap-3 px-4 py-2 text-[13px]">
                <span className={cn("w-10 shrink-0 font-mono font-semibold", STATUS_TONE(h.status))}>{h.status}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-ink" title={h.url}>
                  {h.url}
                </span>
                <span className="shrink-0 font-mono text-xs text-ink-3">{h.ms} ms</span>
              </li>
            ))}
          </ol>
        )}
        <table className="w-full text-left text-[13px]">
          <tbody className="divide-y divide-line">
            {res.headers.map(([k, v], i) => (
              <tr key={i}>
                <td className="w-1/3 px-4 py-1.5 align-top font-mono text-ink-2 [overflow-wrap:anywhere]">{k}</td>
                <td className="px-4 py-1.5 font-mono text-ink [overflow-wrap:anywhere]">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="rounded-md border border-line bg-surface px-4 py-3">
        <p className="label-mono text-ink-3">Security headers</p>
        <ul className="mt-2 grid gap-1 text-[13px] sm:grid-cols-2">
          {SECURITY_HEADERS.map((h) => (
            <li key={h} className={cn("font-mono", lower.has(h) ? "text-success" : "text-ink-3")}>
              {lower.has(h) ? "✓" : "✗"} {h}
            </li>
          ))}
        </ul>
      </div>
      {showBody && res.body && (
        <Output value={pretty} name="response body" lang={res.truncated ? "First 1 MB" : "Response"} download="response.txt" wrap={false} />
      )}
    </>
  );
}

function HttpCheck({ kind }: { kind: string }) {
  const [url, setUrl] = useState(kind === "status" ? "http://github.com" : "https://example.com");
  const [follow, setFollow] = useState(true);
  const [s, run] = useRun<HttpRes>();
  const go = () => run(() => postJson<HttpRes>("http", { url, method: kind === "headers" ? "GET" : "HEAD", follow }));
  return (
    <>
      <HostForm label="URL" value={url} onChange={setUrl} onRun={go} busy={s.busy} placeholder="https://example.com/page">
        <Row label="Redirects">
          <Toggle checked={follow} onChange={setFollow} label="Follow redirects (show the whole chain)" />
        </Row>
      </HostForm>
      {s.error && <Notice tone="danger">{s.error}</Notice>}
      {s.res && <HttpResult res={s.res} showBody={false} />}
    </>
  );
}

function ApiTester() {
  const [method, setMethod] = useState("GET");
  const [url, setUrl] = useState("https://httpbin.org/anything?hello=world");
  const [headers, setHeaders] = useState<[string, string][]>([["Accept", "application/json"]]);
  const [body, setBody] = useState('{\n  "name": "Ada"\n}');
  const [s, run] = useRun<HttpRes>();
  const hasBody = ["POST", "PUT", "PATCH", "DELETE"].includes(method);
  const go = () => {
    const hs = headers.filter(([k]) => k.trim());
    if (hasBody && body.trim() && !hs.some(([k]) => k.toLowerCase() === "content-type"))
      hs.push(["Content-Type", /^\s*[[{]/.test(body) ? "application/json" : "text/plain"]);
    return run(() => postJson<HttpRes>("http", { url, method, headers: hs, body: hasBody ? body : null, follow: true }));
  };
  const curl = `curl -X ${method} '${url}'${headers
    .filter(([k]) => k.trim())
    .map(([k, v]) => ` \\\n  -H '${k}: ${v}'`)
    .join("")}${hasBody && body.trim() ? ` \\\n  --data '${body.replace(/'/g, "'\\''")}'` : ""}`;
  return (
    <>
      <Panel>
        <Row label="Request">
          <div className="flex flex-col gap-2 sm:flex-row">
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              aria-label="Method"
              className="h-11 rounded-md border border-line bg-surface px-3 font-mono text-sm font-semibold text-ink outline-none focus:border-ink"
            >
              {["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
            <div className="min-w-0 flex-1">
              <TextField label="URL" value={url} onChange={setUrl} mono />
            </div>
            <RunButton busy={s.busy} onClick={go} disabled={!url.trim()}>
              Send
            </RunButton>
          </div>
        </Row>
        <Row label="Headers">
          <ul className="space-y-2">
            {headers.map(([k, v], i) => (
              <li key={i} className="flex items-center gap-2">
                <div className="w-2/5">
                  <TextField
                    label={`Header ${i + 1} name`}
                    value={k}
                    onChange={(nk) => setHeaders((h) => h.map((x, j) => (j === i ? [nk, x[1]] : x)))}
                    placeholder="Authorization"
                    mono
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <TextField
                    label={`Header ${i + 1} value`}
                    value={v}
                    onChange={(nv) => setHeaders((h) => h.map((x, j) => (j === i ? [x[0], nv] : x)))}
                    placeholder="Bearer …"
                    mono
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setHeaders((h) => h.filter((_, j) => j !== i))}
                  aria-label="Remove header"
                  className="inline-flex size-9 shrink-0 items-center justify-center rounded-[8px] text-ink-3 hover:bg-paper-2 hover:text-ink"
                >
                  <X aria-hidden className="size-4" />
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => setHeaders((h) => [...h, ["", ""]])}
            className="mt-2 inline-flex h-9 items-center gap-1.5 rounded-[8px] border border-dashed border-ink-3/60 px-3 text-sm text-ink-2 hover:border-ink hover:text-ink"
          >
            <Plus aria-hidden className="size-4" /> Add a header
          </button>
        </Row>
      </Panel>
      {hasBody && <Editor value={body} onChange={setBody} name="body" rows={6} />}
      {s.error && <Notice tone="danger">{s.error}</Notice>}
      {s.res && <HttpResult res={s.res} showBody />}
      <Output value={curl} name="curl" lang="The same request as a curl command" />
      <Notice>
        Requests are sent from our server to public addresses only, so there&apos;s no CORS problem. Don&apos;t paste production secrets into any online tool,
        including this one.
      </Notice>
    </>
  );
}

/* ================= Device & browser ================= */

const subscribeResize = (cb: () => void) => {
  window.addEventListener("resize", cb);
  return () => window.removeEventListener("resize", cb);
};

export function DeviceEngine({ preset }: EngineProps) {
  switch (preset.kind) {
    case "window":
      return <WindowSize />;
    case "tester":
      return <ResponsiveTester />;
    case "webcam":
      return <WebcamTest />;
    case "ruler":
      return <PixelRuler />;
    case "myip":
      return <MyIp />;
    default:
      return <ScreenInfo />;
  }
}

function useSnapshot<T>(read: () => T, fallback: T): T {
  const cache = useRef<{ key: string; value: T } | null>(null);
  return useSyncExternalStore(
    subscribeResize,
    () => {
      const v = read();
      const key = JSON.stringify(v);
      if (!cache.current || cache.current.key !== key) cache.current = { key, value: v };
      return cache.current.value;
    },
    () => fallback,
  );
}

function ScreenInfo() {
  const s = useSnapshot(
    () => ({
      w: screen.width,
      h: screen.height,
      aw: screen.availWidth,
      ah: screen.availHeight,
      dpr: window.devicePixelRatio,
      depth: screen.colorDepth,
      orient: screen.orientation?.type ?? "",
    }),
    null,
  );
  if (!s) return null;
  const physical = `${Math.round(s.w * s.dpr)} × ${Math.round(s.h * s.dpr)}`;
  const g = (a: number, b: number): number => (b ? g(b, a % b) : a);
  const d = g(s.w, s.h);
  return (
    <>
      <div className="rounded-md border border-line bg-surface px-5 py-8 text-center">
        <p className="label-mono text-ink-3">Your screen</p>
        <p className="mt-2 font-mono text-5xl font-semibold tracking-[-0.03em] text-ink">
          {s.w} × {s.h}
        </p>
        <p className="mt-2 text-sm text-ink-2">CSS pixels · {physical} physical pixels</p>
      </div>
      <ValueList>
        <ValueRow label="Physical" value={physical} note="What the panel really has (CSS pixels × pixel ratio)." />
        <ValueRow
          label="Pixel ratio"
          value={String(+s.dpr.toFixed(3))}
          note={s.dpr > 1 ? "A high-density (Retina-class) display." : "A standard-density display."}
        />
        <ValueRow label="Aspect" value={`${s.w / d}:${s.h / d}`} />
        <ValueRow label="Available" value={`${s.aw} × ${s.ah}`} note="Minus the taskbar or dock." />
        <ValueRow label="Colour" value={`${s.depth}-bit`} />
        {s.orient && <ValueRow label="Orientation" value={s.orient} />}
      </ValueList>
    </>
  );
}

function WindowSize() {
  const s = useSnapshot(
    () => ({
      w: window.innerWidth,
      h: window.innerHeight,
      ow: window.outerWidth,
      oh: window.outerHeight,
      cw: document.documentElement.clientWidth,
      ch: document.documentElement.clientHeight,
    }),
    null,
  );
  if (!s) return null;
  const bp =
    s.cw >= 1536
      ? "2xl (≥1536)"
      : s.cw >= 1280
        ? "xl (≥1280)"
        : s.cw >= 1024
          ? "lg (≥1024)"
          : s.cw >= 768
            ? "md (≥768)"
            : s.cw >= 640
              ? "sm (≥640)"
              : "base (<640)";
  return (
    <>
      <div className="rounded-md border border-line bg-surface px-5 py-8 text-center">
        <p className="label-mono text-ink-3">Viewport · live</p>
        <p className="mt-2 font-mono text-5xl font-semibold tracking-[-0.03em] text-ink tabular-nums">
          {s.w} × {s.h}
        </p>
        <p className="mt-2 text-sm text-ink-2">Resize the window and watch it change.</p>
      </div>
      <ValueList>
        <ValueRow label="Viewport" value={`${s.w} × ${s.h}`} note="window.innerWidth × innerHeight (includes the scrollbar)." />
        <ValueRow label="Layout" value={`${s.cw} × ${s.ch}`} note="Without scrollbars: what media queries use." />
        <ValueRow label="Window" value={`${s.ow} × ${s.oh}`} note="The whole browser window, with toolbars." />
        <ValueRow label="Breakpoint" value={bp} note="Tailwind's default breakpoints." />
      </ValueList>
    </>
  );
}

const ZOOMS = [
  { value: 0, label: "Fit" },
  { value: 0.5, label: "50%" },
  { value: 0.75, label: "75%" },
  { value: 1, label: "100%" },
] as const;
const CUSTOM_FRAMES: { value: FrameKind; label: string }[] = [
  { value: "none", label: "No frame" },
  { value: "phone", label: "Phone" },
  { value: "tablet", label: "Tablet" },
  { value: "laptop", label: "Laptop" },
  { value: "monitor", label: "Monitor" },
];
const clampPx = (v: string, d: number) => Math.max(200, Math.min(3840, Math.round(Number(v) || d)));

function ResponsiveTester() {
  const [url, setUrl] = useState("https://example.com");
  const [shown, setShown] = useState("https://example.com");
  const [group, setGroup] = useState<(typeof GROUPS)[number] | "Custom">("Phones");
  const [deviceId, setDeviceId] = useState("iphone-15");
  const [landscape, setLandscape] = useState(false);
  const [zoom, setZoom] = useState<number>(0);
  const [custom, setCustom] = useState({ w: "1024", h: "768", frame: "none" as FrameKind });
  const [reloads, setReloads] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState(800);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setAvail(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const isCustom = group === "Custom";
  const preset = DEVICES.find((d) => d.id === deviceId) ?? DEVICES[2];
  const cw = clampPx(custom.w, 1024);
  const ch = clampPx(custom.h, 768);
  const device: Device = isCustom
    ? {
        id: "custom",
        name: "Custom",
        group: "Phones",
        w: cw,
        h: ch,
        dpr: 1,
        kind: custom.frame,
        cutout: custom.frame === "phone" ? "island" : "none",
        radius: custom.frame === "phone" ? 44 : custom.frame === "tablet" ? 18 : 0,
      }
    : preset;
  const rotatable = device.kind === "phone" || device.kind === "tablet" || device.kind === "none";
  const turned = rotatable && landscape;
  const w = turned ? device.h : device.w;
  const h = turned ? device.w : device.h;
  const frame = frameSize(device.kind, w, h, turned, device.cutout);
  const fit = Math.min(1, (avail - 32) / frame.w, 760 / frame.h);
  const scale = zoom || fit;
  const valid = /^https?:\/\/[^\s]+$/i.test(shown);
  const inGroup = DEVICES.filter((d) => d.group === group);

  return (
    <>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setShown(/^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`);
          setReloads((r) => r + 1);
        }}
      >
        <Panel>
          <Row label="Website">
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="min-w-0 flex-1">
                <TextField label="Website address" value={url} onChange={setUrl} mono placeholder="https://your-site.com" />
              </div>
              <button
                type="submit"
                className="inline-flex h-11 items-center justify-center rounded-md bg-ink px-5 text-sm font-medium text-paper transition-[opacity,transform] hover:opacity-90 active:scale-[0.98]"
              >
                Load
              </button>
            </div>
          </Row>
          <Row label="Device type">
            <Chips
              value={group}
              options={[...GROUPS.map((g) => ({ value: g, label: g })), { value: "Custom" as const, label: "Custom size" }]}
              onChange={(g) => {
                setGroup(g);
                const first = DEVICES.find((d) => d.group === g);
                if (first) setDeviceId(first.id);
                setLandscape(false);
              }}
              label="Device type"
            />
          </Row>
          {isCustom ? (
            <Row label="Custom size" hint="200 to 3840 CSS pixels">
              <div className="grid gap-3">
                <div className="flex items-center gap-2">
                  <div className="w-28">
                    <TextField
                      label="Width"
                      value={custom.w}
                      onChange={(v) => setCustom((c) => ({ ...c, w: v.replace(/\D/g, "").slice(0, 4) }))}
                      mono
                      inputMode="numeric"
                    />
                  </div>
                  <span className="text-ink-3">×</span>
                  <div className="w-28">
                    <TextField
                      label="Height"
                      value={custom.h}
                      onChange={(v) => setCustom((c) => ({ ...c, h: v.replace(/\D/g, "").slice(0, 4) }))}
                      mono
                      inputMode="numeric"
                    />
                  </div>
                  <span className="text-sm text-ink-3">px</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    [320, 568],
                    [360, 800],
                    [768, 1024],
                    [1024, 768],
                    [1280, 800],
                    [1440, 900],
                    [1920, 1080],
                  ].map(([a, b]) => (
                    <button
                      key={`${a}x${b}`}
                      type="button"
                      onClick={() => setCustom((c) => ({ ...c, w: String(a), h: String(b) }))}
                      className="rounded-[6px] bg-paper-2 px-2 py-1 font-mono text-[12px] text-ink-2 hover:text-ink"
                    >
                      {a}×{b}
                    </button>
                  ))}
                </div>
                <Chips value={custom.frame} options={CUSTOM_FRAMES} onChange={(f) => setCustom((c) => ({ ...c, frame: f }))} label="Frame" />
              </div>
            </Row>
          ) : (
            <Row label={group}>
              <div className="flex flex-wrap gap-1.5">
                {inGroup.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => setDeviceId(d.id)}
                    aria-pressed={d.id === deviceId}
                    className={cn(
                      "inline-flex h-9 items-center gap-2 rounded-[8px] border px-2.5 text-[13px] transition-colors",
                      d.id === deviceId ? "border-ink bg-ink text-paper" : "border-line bg-surface text-ink hover:border-ink-3",
                    )}
                  >
                    {d.name}
                    <span className={cn("font-mono text-[12px]", d.id === deviceId ? "text-paper/60" : "text-ink-3")}>
                      {d.w}×{d.h}
                    </span>
                  </button>
                ))}
              </div>
            </Row>
          )}
          <Row label="View">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
              {rotatable && <Toggle checked={landscape} onChange={setLandscape} label="Landscape" />}
              <Chips value={zoom} options={[...ZOOMS]} onChange={setZoom} label="Zoom" />
            </div>
          </Row>
        </Panel>
      </form>

      <div
        ref={box}
        className="overflow-hidden rounded-md border border-line bg-[radial-gradient(circle_at_50%_30%,var(--color-surface),var(--color-paper-2))]"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-paper/70 px-3 py-2">
          <p className="font-mono text-xs text-ink-3">
            <span className="text-ink">{isCustom ? "Custom" : device.name}</span> · {w} × {h} CSS px
            {device.dpr > 1 ? ` · ${Math.round(w * device.dpr)} × ${Math.round(h * device.dpr)} physical (${device.dpr}×)` : ""} · {Math.round(scale * 100)}%
          </p>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setReloads((r) => r + 1)}
              disabled={!valid}
              className="inline-flex h-8 items-center gap-1.5 rounded-[8px] px-2 text-[13px] text-ink-2 hover:bg-paper-2 hover:text-ink disabled:opacity-40"
            >
              <RotateCw aria-hidden className="size-3.5" /> Reload
            </button>
            {valid && (
              <a
                href={shown}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-8 items-center gap-1.5 rounded-[8px] px-2 text-[13px] text-ink-2 hover:bg-paper-2 hover:text-ink"
              >
                <ExternalLink aria-hidden className="size-3.5" /> Open
              </a>
            )}
          </div>
        </div>
        <div className={cn("overflow-auto px-4 py-8", zoom ? "" : "flex justify-center")} style={{ maxHeight: zoom ? 820 : undefined }} data-lenis-prevent>
          <div className="mx-auto" style={{ width: frame.w * scale, height: frame.h * scale }}>
            <motion.div
              key={`${device.id}-${turned}-${device.kind}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            >
              {/* The scale lives on its own element: motion owns the animated wrapper's transform. */}
              <div style={{ width: frame.w, height: frame.h, transform: `scale(${scale})`, transformOrigin: "top left" }}>
                <DeviceFrame device={device} w={w} h={h} landscape={turned}>
                  {valid && (
                    <iframe
                      key={`${shown}-${reloads}`}
                      title={`${isCustom ? "Custom" : device.name} preview`}
                      src={shown}
                      sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                      referrerPolicy="no-referrer"
                      className="absolute inset-0 h-full w-full border-0 bg-white"
                    />
                  )}
                </DeviceFrame>
              </div>
            </motion.div>
          </div>
        </div>
      </div>
      <Notice>
        The page is shown at the device&apos;s real width in CSS pixels, so its layout and breakpoints match the device. Some sites (Google, banks, social
        networks) refuse to be shown inside another page and appear blank here; that&apos;s their security setting, not your layout.
      </Notice>
    </>
  );
}

function WebcamTest() {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [state, setState] = useState<{ on: boolean; error: string | null; info: Record<string, string> | null; fps: number }>({
    on: false,
    error: null,
    info: null,
    fps: 0,
  });
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [mirror, setMirror] = useState(true);
  const stop = () => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setState((s) => ({ ...s, on: false, fps: 0 }));
  };
  useEffect(() => () => stream.current?.getTracks().forEach((t) => t.stop()), []);
  useEffect(() => {
    if (!state.on) return;
    let frames = 0;
    let raf = 0;
    const v = video.current;
    const count = () => {
      frames++;
      raf = v && "requestVideoFrameCallback" in v ? v.requestVideoFrameCallback(count) : requestAnimationFrame(count);
    };
    count();
    const t = setInterval(() => {
      setState((s) => ({ ...s, fps: frames }));
      frames = 0;
    }, 1000);
    return () => {
      clearInterval(t);
      if (v && "cancelVideoFrameCallback" in v) v.cancelVideoFrameCallback(raf);
      else cancelAnimationFrame(raf);
    };
  }, [state.on]);
  const start = async (id?: string) => {
    stop();
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: id ? { deviceId: { exact: id }, width: { ideal: 1920 } } : { width: { ideal: 1920 } },
        audio: false,
      });
      stream.current = s;
      if (video.current) video.current.srcObject = s;
      const track = s.getVideoTracks()[0];
      const st = track.getSettings();
      setState({
        on: true,
        error: null,
        fps: 0,
        info: {
          Camera: track.label || "Camera",
          Resolution: `${st.width} × ${st.height}`,
          "Frame rate": st.frameRate ? `${Math.round(st.frameRate)} fps (reported)` : "—",
          Facing: st.facingMode ?? "—",
          Aspect: st.aspectRatio ? st.aspectRatio.toFixed(3) : "—",
        },
      });
      setDevices((await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput"));
      if (st.deviceId) setDeviceId(st.deviceId);
    } catch (e) {
      const name = (e as DOMException).name;
      setState({
        on: false,
        error:
          name === "NotAllowedError"
            ? "Camera access was blocked. Allow it in your browser's address bar, then try again."
            : name === "NotFoundError"
              ? "No camera was found on this device."
              : name === "NotReadableError"
                ? "The camera is busy in another app. Close it and try again."
                : `The camera couldn't start (${name}).`,
        info: null,
        fps: 0,
      });
    }
  };
  const snap = () => {
    const v = video.current;
    if (!v) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    c.toBlob((b) => b && saveBlob(b, "webcam.png"));
  };
  return (
    <>
      <div className="relative overflow-hidden rounded-md border border-line bg-ink">
        <video ref={video} autoPlay playsInline muted className={cn("aspect-video w-full object-contain", mirror && "-scale-x-100")} />
        {!state.on && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-paper">
            <CameraOff aria-hidden className="size-8 opacity-60" />
            <p className="text-sm opacity-80">The camera is off.</p>
          </div>
        )}
        {state.on && <span className="absolute left-3 top-3 rounded-sm bg-ink/70 px-2 py-1 font-mono text-xs text-paper">{state.fps} fps</span>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {state.on ? (
          <>
            <button
              type="button"
              onClick={stop}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-ink px-4 text-sm font-medium text-paper hover:opacity-90"
            >
              <CameraOff aria-hidden className="size-4" /> Stop
            </button>
            <button
              type="button"
              onClick={snap}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-surface px-4 text-sm font-medium text-ink hover:border-ink-3"
            >
              <Download aria-hidden className="size-4" /> Save a snapshot
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => start(deviceId || undefined)}
            className="inline-flex h-10 items-center gap-2 rounded-md bg-ink px-4 text-sm font-medium text-paper hover:opacity-90"
          >
            <Camera aria-hidden className="size-4" /> Start camera
          </button>
        )}
        {devices.length > 1 && (
          <select
            value={deviceId}
            onChange={(e) => (setDeviceId(e.target.value), void start(e.target.value))}
            aria-label="Camera"
            className="h-10 rounded-md border border-line bg-surface px-2 text-sm text-ink"
          >
            {devices.map((d, i) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Camera ${i + 1}`}
              </option>
            ))}
          </select>
        )}
        <Toggle checked={mirror} onChange={setMirror} label="Mirror" />
      </div>
      {state.error && <Notice tone="danger">{state.error}</Notice>}
      {state.info && (
        <ValueList>
          {Object.entries(state.info).map(([k, v]) => (
            <ValueRow key={k} label={k} value={v} mono={k !== "Camera"} />
          ))}
        </ValueList>
      )}
      <Notice>The video stays on your device. Nothing is recorded or uploaded.</Notice>
    </>
  );
}

function PixelRuler() {
  const area = useRef<HTMLDivElement>(null);
  const [a, setA] = useState<{ x: number; y: number } | null>(null);
  const [b, setB] = useState<{ x: number; y: number } | null>(null);
  const [drag, setDrag] = useState(false);
  const [ppi, setPpi] = useState(96);
  const pos = (e: React.PointerEvent) => {
    const r = area.current!.getBoundingClientRect();
    return { x: Math.round(e.clientX - r.left), y: Math.round(e.clientY - r.top) };
  };
  const dx = a && b ? Math.abs(b.x - a.x) : 0;
  const dy = a && b ? Math.abs(b.y - a.y) : 0;
  const dist = Math.hypot(dx, dy);
  const inch = (px: number) => (px / ppi).toFixed(2);
  const cm = (px: number) => ((px / ppi) * 2.54).toFixed(2);
  return (
    <>
      <div
        ref={area}
        onPointerDown={(e) => {
          (e.target as Element).setPointerCapture?.(e.pointerId);
          const p = pos(e);
          setA(p);
          setB(p);
          setDrag(true);
        }}
        onPointerMove={(e) => drag && setB(pos(e))}
        onPointerUp={() => setDrag(false)}
        className="relative h-[420px] cursor-crosshair touch-none select-none overflow-hidden rounded-md border border-line bg-surface"
        style={{
          backgroundImage: "linear-gradient(var(--color-line) 1px, transparent 1px), linear-gradient(90deg, var(--color-line) 1px, transparent 1px)",
          backgroundSize: "50px 50px",
        }}
        aria-label="Drag to measure"
      >
        {/* Top ruler with ticks every 10 px. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-5 border-b border-line bg-paper/90">
          {Array.from({ length: 200 }, (_, i) => (
            <span key={i} className="absolute top-0 border-l border-ink-3" style={{ left: i * 10, height: i % 10 === 0 ? 20 : i % 5 === 0 ? 12 : 6 }}>
              {i % 10 === 0 && i > 0 && <span className="absolute left-0.5 top-0 font-mono text-[9px] text-ink-3">{i * 10}</span>}
            </span>
          ))}
        </div>
        {a && b && (
          <svg className="pointer-events-none absolute inset-0 size-full">
            <rect
              x={Math.min(a.x, b.x)}
              y={Math.min(a.y, b.y)}
              width={dx}
              height={dy}
              fill="color-mix(in oklab, var(--color-accent) 10%, transparent)"
              stroke="var(--color-accent)"
              strokeDasharray="4 3"
            />
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--color-ink)" strokeWidth="1.5" />
            <circle cx={a.x} cy={a.y} r="4" fill="var(--color-accent)" />
            <circle cx={b.x} cy={b.y} r="4" fill="var(--color-accent)" />
          </svg>
        )}
        {!a && <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-ink-3">Press and drag anywhere to measure.</p>}
      </div>
      <ValueList>
        <ValueRow label="Width" value={`${dx} px`} note={`${inch(dx)} in · ${cm(dx)} cm at ${ppi} PPI`} />
        <ValueRow label="Height" value={`${dy} px`} note={`${inch(dy)} in · ${cm(dy)} cm`} />
        <ValueRow label="Distance" value={`${dist.toFixed(1)} px`} note={`${inch(dist)} in · ${cm(dist)} cm`} />
        <ValueRow label="Start" value={a ? `${a.x}, ${a.y}` : ""} />
      </ValueList>
      <Panel>
        <Row label="Screen PPI" hint="96 is the CSS standard; set your monitor's real PPI for true inches.">
          <Slider label="Pixels per inch" value={ppi} min={72} max={600} onChange={setPpi} />
        </Row>
      </Panel>
      <Notice>
        This measures inside the box. To measure something in another window, use your system&apos;s screenshot tool: Win + Shift + S on Windows, ⌘ + Shift + 4
        on a Mac (it shows the size as you drag).
      </Notice>
    </>
  );
}

function MyIp() {
  const [s, run] = useRun<{
    ip: string | null;
    local: boolean;
    version: number;
    country: string | null;
    region: string | null;
    city: string | null;
    timezone: string | null;
    userAgent: string | null;
    language: string | null;
  }>();
  useEffect(() => {
    void run(async () => {
      const r = await fetch("/api/tools/my-ip", { cache: "no-store" });
      if (!r.ok) throw new Error("Couldn't look up your address.");
      return r.json();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const region = s.res ? [s.res.city, s.res.region, s.res.country].filter(Boolean).join(", ") : "";
  return (
    <>
      <div className="rounded-md border border-line bg-surface px-5 py-8 text-center" aria-live="polite">
        <p className="label-mono text-ink-3">Your public IP address</p>
        <p className="mt-2 break-all font-mono text-4xl font-semibold tracking-[-0.02em] text-ink sm:text-5xl">
          {s.busy ? "…" : (s.res?.ip ?? (s.res?.local ? "Local network" : "—"))}
        </p>
        {s.res?.ip && (
          <div className="mt-3 flex justify-center">
            <CopyButton text={s.res.ip} />
          </div>
        )}
      </div>
      {s.error && <Notice tone="danger">{s.error}</Notice>}
      {s.res && (
        <ValueList>
          {s.res.ip && <ValueRow label="Version" value={`IPv${s.res.version}`} />}
          {region && <ValueRow label="Location" value={region} mono={false} note="Approximate, from your internet provider's address block." />}
          {s.res.timezone && <ValueRow label="Time zone" value={s.res.timezone} />}
          <ValueRow label="Browser" value={s.res.userAgent ?? ""} />
          {s.res.language && <ValueRow label="Language" value={s.res.language} />}
        </ValueList>
      )}
      {s.res?.local && (
        <Notice>
          You&apos;re running the site on your own computer, so there&apos;s no public address to show. Once it&apos;s deployed, this shows the visitor&apos;s
          real address.
        </Notice>
      )}
      <Notice>We read your address from this request only; it isn&apos;t stored or logged.</Notice>
    </>
  );
}

/* ================= HTML & CSS generators ================= */

export function WebGenEngine({ preset }: EngineProps) {
  switch (preset.kind) {
    case "table":
      return <TableGen />;
    case "redirect":
      return <RedirectGen />;
    case "share":
      return <ShareGen />;
    case "units":
      return <Units />;
    case "less":
      return <LessGen />;
    case "ascii":
      return <AsciiTable />;
    default:
      return <LinkGen />;
  }
}

function LinkGen() {
  const [href, setHref] = useState("https://example.com");
  const [text, setText] = useState("Visit Example");
  const [title, setTitle] = useState("");
  const [blank, setBlank] = useState(true);
  const [nofollow, setNofollow] = useState(false);
  const [sponsored, setSponsored] = useState(false);
  const [download, setDownload] = useState(false);
  const rel = [blank && "noopener noreferrer", nofollow && "nofollow", sponsored && "sponsored"].filter(Boolean).join(" ");
  const code = `<a href="${htmlEncode(href)}"${blank ? ' target="_blank"' : ""}${rel ? ` rel="${rel}"` : ""}${title ? ` title="${htmlEncode(title)}"` : ""}${download ? " download" : ""}>${htmlEncode(text)}</a>`;
  return (
    <>
      <Panel>
        <Row label="Address">
          <TextField label="Link address" value={href} onChange={setHref} mono />
        </Row>
        <Row label="Link text">
          <TextField label="Link text" value={text} onChange={setText} />
        </Row>
        <Row label="Tooltip (optional)">
          <TextField label="Title" value={title} onChange={setTitle} />
        </Row>
        <Row label="Options">
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            <Toggle checked={blank} onChange={setBlank} label="Open in a new tab" />
            <Toggle checked={nofollow} onChange={setNofollow} label="nofollow (SEO)" />
            <Toggle checked={sponsored} onChange={setSponsored} label="sponsored" />
            <Toggle checked={download} onChange={setDownload} label="Download the file" />
          </div>
        </Row>
      </Panel>
      <div className="rounded-md border border-line bg-surface px-4 py-4">
        <p className="label-mono text-ink-3">Preview</p>
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          title={title || undefined}
          className="mt-1 inline-block text-accent underline underline-offset-4"
        >
          {text}
        </a>
      </div>
      <Output value={code} name="link.html" lang="HTML" />
    </>
  );
}

function TableGen() {
  const [rows, setRows] = useState(3);
  const [cols, setCols] = useState(3);
  const [cells, setCells] = useState<string[][]>([
    ["Name", "Role", "City"],
    ["Ada", "Engineer", "London"],
    ["Linus", "Maintainer", "Portland"],
  ]);
  const [header, setHeader] = useState(true);
  const [border, setBorder] = useState(true);
  const [caption, setCaption] = useState("");
  const get = (r: number, c: number) => cells[r]?.[c] ?? "";
  const set = (r: number, c: number, v: string) =>
    setCells((all) => {
      const next = Array.from({ length: Math.max(rows, all.length) }, (_, i) => [...(all[i] ?? [])]);
      next[r][c] = v;
      return next;
    });
  const code = useMemo(() => {
    const e = (s: string) => htmlEncode(s);
    const style = border ? ' style="border-collapse: collapse;"' : "";
    const td = (tag: string, s: string) => `<${tag}${border ? ' style="border: 1px solid #ccc; padding: 6px 10px;"' : ""}>${e(s)}</${tag}>`;
    const body = Array.from({ length: rows }, (_, r) => r).filter((r) => !(header && r === 0));
    return [
      `<table${style}>`,
      caption && `  <caption>${e(caption)}</caption>`,
      header && `  <thead>\n    <tr>${Array.from({ length: cols }, (_, c) => td("th", get(0, c))).join("")}</tr>\n  </thead>`,
      `  <tbody>`,
      ...body.map((r) => `    <tr>${Array.from({ length: cols }, (_, c) => td("td", get(r, c))).join("")}</tr>`),
      `  </tbody>`,
      `</table>`,
    ]
      .filter(Boolean)
      .join("\n");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, cols, cells, header, border, caption]);
  return (
    <>
      <Panel>
        <Row label="Size">
          <div className="grid gap-3 sm:grid-cols-2">
            <Slider label="Rows" value={rows} min={1} max={30} onChange={setRows} format={(v) => `${v} rows`} />
            <Slider label="Columns" value={cols} min={1} max={12} onChange={setCols} format={(v) => `${v} cols`} />
          </div>
        </Row>
        <Row label="Options">
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            <Toggle checked={header} onChange={setHeader} label="First row is a header" />
            <Toggle checked={border} onChange={setBorder} label="Borders" />
          </div>
        </Row>
        <Row label="Caption (optional)">
          <TextField label="Caption" value={caption} onChange={setCaption} />
        </Row>
      </Panel>
      <div className="overflow-x-auto rounded-md border border-line bg-surface p-2" data-lenis-prevent>
        <table className="border-collapse">
          <tbody>
            {Array.from({ length: rows }, (_, r) => (
              <tr key={r}>
                {Array.from({ length: cols }, (_, c) => (
                  <td key={c} className="border border-line p-0">
                    <input
                      value={get(r, c)}
                      onChange={(e) => set(r, c, e.target.value)}
                      aria-label={`Row ${r + 1}, column ${c + 1}`}
                      className={cn("h-9 w-32 bg-transparent px-2 text-sm text-ink outline-none focus:bg-paper", header && r === 0 && "font-semibold")}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Output value={code} name="table.html" lang="HTML" download="table.html" />
    </>
  );
}

function RedirectGen() {
  const [from, setFrom] = useState("/old-page");
  const [to, setTo] = useState("https://example.com/new-page");
  const [code, setCode] = useState<301 | 302 | 307 | 308>(301);
  const [delay, setDelay] = useState(0);
  const out = {
    ".htaccess (Apache)": `Redirect ${code} ${from} ${to}`,
    Nginx: `location = ${from} {\n    return ${code} ${to};\n}`,
    "Vercel (vercel.json)": JSON.stringify({ redirects: [{ source: from, destination: to, permanent: code === 301 || code === 308 }] }, null, 2),
    "Netlify (_redirects)": `${from}  ${to}  ${code}`,
    "HTML (meta refresh)": `<meta http-equiv="refresh" content="${delay}; url=${htmlEncode(to)}">\n<link rel="canonical" href="${htmlEncode(to)}">`,
    JavaScript: delay
      ? `setTimeout(() => window.location.replace(${JSON.stringify(to)}), ${delay * 1000});`
      : `window.location.replace(${JSON.stringify(to)});`,
    PHP: `<?php\nheader("Location: ${to}", true, ${code});\nexit;`,
    "Node (Express)": `app.get(${JSON.stringify(from)}, (req, res) => res.redirect(${code}, ${JSON.stringify(to)}));`,
  };
  return (
    <>
      <Panel>
        <Row label="From (path)">
          <TextField label="Old path" value={from} onChange={setFrom} mono />
        </Row>
        <Row label="To (address)">
          <TextField label="New address" value={to} onChange={setTo} mono />
        </Row>
        <Row label="Type">
          <Chips
            value={code}
            options={[
              { value: 301, label: "301 permanent" },
              { value: 302, label: "302 temporary" },
              { value: 307, label: "307 temporary (keep method)" },
              { value: 308, label: "308 permanent (keep method)" },
            ]}
            onChange={setCode}
            label="Redirect type"
          />
        </Row>
        <Row label="Delay (HTML/JS only)">
          <Slider label="Delay" value={delay} min={0} max={30} onChange={setDelay} format={(v) => (v ? `${v} s` : "Instant")} />
        </Row>
      </Panel>
      {Object.entries(out).map(([name, value]) => (
        <Output key={name} value={value} name={name} lang={name.split(" ")[0]} />
      ))}
      <Notice>Use 301 for pages that moved for good (search engines pass their ranking on). Server redirects beat HTML and JavaScript ones for SEO.</Notice>
    </>
  );
}

function ShareGen() {
  const [url, setUrl] = useState("https://example.com/article");
  const [text, setText] = useState("A great read");
  const u = encodeURIComponent(url);
  const t = encodeURIComponent(text);
  const links: [string, string][] = [
    ["X (Twitter)", `https://twitter.com/intent/tweet?url=${u}&text=${t}`],
    ["Facebook", `https://www.facebook.com/sharer/sharer.php?u=${u}`],
    ["LinkedIn", `https://www.linkedin.com/sharing/share-offsite/?url=${u}`],
    ["WhatsApp", `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`],
    ["Telegram", `https://t.me/share/url?url=${u}&text=${t}`],
    ["Reddit", `https://www.reddit.com/submit?url=${u}&title=${t}`],
    ["Pinterest", `https://pinterest.com/pin/create/button/?url=${u}&description=${t}`],
    ["Email", `mailto:?subject=${t}&body=${encodeURIComponent(`${text}\n\n${url}`)}`],
    ["SMS", `sms:?&body=${encodeURIComponent(`${text} ${url}`)}`],
  ];
  return (
    <>
      <Panel>
        <Row label="Page to share">
          <TextField label="Page address" value={url} onChange={setUrl} mono />
        </Row>
        <Row label="Message">
          <TextField label="Message" value={text} onChange={setText} />
        </Row>
      </Panel>
      <ValueList>
        {links.map(([name, href]) => (
          <ValueRow
            key={name}
            label={name}
            value={href}
            note={
              <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent underline-offset-4 hover:underline">
                Try it ↗
              </a>
            }
          />
        ))}
      </ValueList>
      <Output
        value={links.map(([n, h]) => `<a href="${htmlEncode(h)}" target="_blank" rel="noopener">Share on ${n}</a>`).join("\n")}
        name="share-links.html"
        lang="HTML for all of them"
      />
    </>
  );
}

function Units() {
  const [base, setBase] = useState(16);
  const [value, setValue] = useState("1.5");
  const [unit, setUnit] = useState<"px" | "rem" | "em" | "pt" | "%" | "vw">("rem");
  const [vw, setVw] = useState(1440);
  const v = Number(value);
  const px = !Number.isFinite(v)
    ? NaN
    : unit === "px"
      ? v
      : unit === "rem" || unit === "em"
        ? v * base
        : unit === "pt"
          ? (v * 96) / 72
          : unit === "%"
            ? (v / 100) * base
            : (v / 100) * vw;
  const f = (n: number) => (Number.isFinite(n) ? String(+n.toFixed(4)) : "");
  const rows: [string, string][] = [
    ["px", f(px)],
    ["rem", f(px / base)],
    ["em", f(px / base)],
    ["pt", f((px * 72) / 96)],
    ["%", f((px / base) * 100)],
    ["vw", f((px / vw) * 100)],
  ];
  return (
    <>
      <Panel>
        <Row label="Value">
          <div className="flex items-center gap-2">
            <TextField label="Value" value={value} onChange={setValue} mono inputMode="decimal" />
            <Chips
              value={unit}
              options={["px", "rem", "em", "pt", "%", "vw"].map((u) => ({ value: u as typeof unit, label: u }))}
              onChange={setUnit}
              label="Unit"
            />
          </div>
        </Row>
        <Row label="Base font size" hint="The root (html) font size; browsers default to 16px.">
          <Slider label="Base font size" value={base} min={8} max={32} onChange={setBase} format={(n) => `${n}px`} />
        </Row>
        <Row label="Viewport width (for vw)">
          <Slider label="Viewport width" value={vw} min={320} max={2560} step={10} onChange={setVw} format={(n) => `${n}px`} />
        </Row>
      </Panel>
      <ValueList>
        {rows.map(([u, n]) => (
          <ValueRow key={u} label={u} value={n ? `${n}${u}` : ""} highlight={u === unit} />
        ))}
      </ValueList>
      <div className="overflow-hidden rounded-md border border-line bg-surface">
        <p className="label-mono border-b border-line bg-paper px-3 py-1.5 text-ink-3">At {base}px base</p>
        <table className="w-full text-left font-mono text-[13px]">
          <tbody className="divide-y divide-line">
            {[0.25, 0.5, 0.75, 0.875, 1, 1.125, 1.25, 1.5, 2, 2.5, 3, 4].map((r) => (
              <tr key={r}>
                <td className="px-3 py-1.5 text-ink">{r}rem</td>
                <td className="px-3 py-1.5 text-ink-2">{+(r * base).toFixed(2)}px</td>
                <td className="px-3 py-1.5 text-ink-3">{+((r * base * 72) / 96).toFixed(2)}pt</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function LessGen() {
  const [css, setCss] = useState(
    ".nav { display: flex; }\n.nav a { color: #333; }\n.nav a:hover { color: #000; }\n.nav .logo { height: 32px; }\n.footer p { margin: 0; }\n@media (max-width: 600px) { .nav { flex-direction: column; } }",
  );
  const out = useMemo(() => cssToLess(css), [css]);
  return (
    <>
      <Editor value={css} onChange={setCss} name="styles.css" rows={10} />
      <Output value={out} name="styles.less" lang="Less (also valid SCSS)" download="styles.less" />
      <Notice>Rules that share a selector start are nested inside it. @media and other at-rules are kept as they were.</Notice>
    </>
  );
}

const CONTROL = [
  "NUL",
  "SOH",
  "STX",
  "ETX",
  "EOT",
  "ENQ",
  "ACK",
  "BEL",
  "BS",
  "TAB",
  "LF",
  "VT",
  "FF",
  "CR",
  "SO",
  "SI",
  "DLE",
  "DC1",
  "DC2",
  "DC3",
  "DC4",
  "NAK",
  "SYN",
  "ETB",
  "CAN",
  "EM",
  "SUB",
  "ESC",
  "FS",
  "GS",
  "RS",
  "US",
];

function AsciiTable() {
  const [q, setQ] = useState("");
  const [extended, setExtended] = useState(false);
  const rows = Array.from({ length: extended ? 256 : 128 }, (_, i) => ({
    i,
    ch: i < 32 ? CONTROL[i] : i === 127 ? "DEL" : i === 32 ? "space" : i >= 128 && i < 160 ? "—" : String.fromCharCode(i),
  }));
  const t = q.trim().toLowerCase();
  const shown = t ? rows.filter((r) => r.ch.toLowerCase() === t || String(r.i) === t || r.i.toString(16) === t.replace(/^0x/, "")) : rows;
  return (
    <>
      <Panel>
        <Row label="Find">
          <TextField label="Find a character or code" value={q} onChange={setQ} placeholder="A, 65, 0x41, space…" mono />
        </Row>
        <Row label="Range">
          <Toggle checked={extended} onChange={setExtended} label="Include 128–255 (Latin-1)" />
        </Row>
      </Panel>
      <div className="max-h-[560px] overflow-auto rounded-md border border-line bg-surface" data-lenis-prevent>
        <table className="w-full text-left font-mono text-[13px]">
          <thead className="label-mono sticky top-0 bg-paper text-ink-3">
            <tr className="border-b border-line">
              {["Char", "Dec", "Hex", "Oct", "Binary", "HTML"].map((h) => (
                <th key={h} className="px-3 py-2 font-normal">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {shown.map(({ i, ch }) => (
              <tr key={i} className="hover:bg-paper">
                <td className={cn("px-3 py-1.5", ch.length > 1 ? "text-ink-3" : "text-base text-ink")}>{ch}</td>
                <td className="px-3 py-1.5 text-ink">{i}</td>
                <td className="px-3 py-1.5 text-ink-2">{i.toString(16).toUpperCase().padStart(2, "0")}</td>
                <td className="px-3 py-1.5 text-ink-2">{i.toString(8).padStart(3, "0")}</td>
                <td className="px-3 py-1.5 text-ink-2">{i.toString(2).padStart(8, "0")}</td>
                <td className="px-3 py-1.5 text-ink-3">&amp;#{i};</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ================= Text to image ================= */

const FONTS = [
  { value: "sans", label: "Sans", css: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" },
  { value: "serif", label: "Serif", css: "Georgia, 'Times New Roman', serif" },
  { value: "mono", label: "Mono", css: "ui-monospace, 'Cascadia Code', Consolas, monospace" },
  { value: "hand", label: "Handwritten", css: "'Segoe Print', 'Bradley Hand', 'Comic Sans MS', cursive" },
  { value: "impact", label: "Impact", css: "Impact, 'Arial Black', sans-serif" },
];

export function TextImageEngine() {
  const [text, setText] = useState("Make something\nworth sharing.");
  const [font, setFont] = useState("serif");
  const [size, setSize] = useState(64);
  const [bold, setBold] = useState(false);
  const [color, setColor] = useState("#15140f");
  const [bg, setBg] = useState("#f3f0e8");
  const [transparent, setTransparent] = useState(false);
  const [pad, setPad] = useState(48);
  const [align, setAlign] = useState<"left" | "center" | "right">("center");
  const [width, setWidth] = useState(1080);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [dims, setDims] = useState({ w: 0, h: 0, bytes: 0 });

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    const family = FONTS.find((f) => f.value === font)!.css;
    const fontStr = `${bold ? "700" : "400"} ${size}px ${family}`;
    ctx.font = fontStr;
    const maxW = width - pad * 2;
    // Wrap each paragraph to the width.
    const lines: string[] = [];
    for (const para of text.split("\n")) {
      let line = "";
      for (const word of para.split(/(\s+)/)) {
        const test = line + word;
        if (ctx.measureText(test).width > maxW && line.trim()) {
          lines.push(line.trimEnd());
          line = word.trimStart();
        } else line = test;
      }
      lines.push(line);
    }
    const lh = size * 1.25;
    const h = Math.ceil(lines.length * lh + pad * 2);
    const scale = 2;
    c.width = width * scale;
    c.height = h * scale;
    ctx.scale(scale, scale);
    if (!transparent) {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, h);
    } else ctx.clearRect(0, 0, width, h);
    ctx.font = fontStr;
    ctx.fillStyle = color;
    ctx.textBaseline = "middle";
    ctx.textAlign = align;
    const x = align === "left" ? pad : align === "right" ? width - pad : width / 2;
    lines.forEach((l, i) => ctx.fillText(l, x, pad + lh * i + lh / 2));
    c.toBlob((b) => setDims({ w: width * scale, h: h * scale, bytes: b?.size ?? 0 }));
  }, [text, font, size, bold, color, bg, transparent, pad, align, width]);

  return (
    <>
      <Editor value={text} onChange={setText} name="text" rows={4} spellCheck />
      <Panel>
        <Row label="Font">
          <div className="flex flex-wrap items-center gap-4">
            <Chips value={font} options={FONTS.map(({ value, label }) => ({ value, label }))} onChange={setFont} label="Font" />
            <Toggle checked={bold} onChange={setBold} label="Bold" />
          </div>
        </Row>
        <Row label="Size">
          <Slider label="Text size" value={size} min={12} max={200} onChange={setSize} format={(v) => `${v}px`} />
        </Row>
        <Row label="Colours">
          <div className="flex flex-wrap items-center gap-4">
            <label className="inline-flex items-center gap-2 text-sm text-ink-2">
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="size-9 cursor-pointer rounded-md border border-line bg-transparent"
              />{" "}
              Text
            </label>
            <label className={cn("inline-flex items-center gap-2 text-sm text-ink-2", transparent && "opacity-40")}>
              <input
                type="color"
                value={bg}
                disabled={transparent}
                onChange={(e) => setBg(e.target.value)}
                className="size-9 cursor-pointer rounded-md border border-line bg-transparent"
              />{" "}
              Background
            </label>
            <Toggle checked={transparent} onChange={setTransparent} label="Transparent" />
          </div>
        </Row>
        <Row label="Layout">
          <div className="grid gap-3">
            <Chips
              value={align}
              options={[
                { value: "left", label: "Left" },
                { value: "center", label: "Centre" },
                { value: "right", label: "Right" },
              ]}
              onChange={setAlign}
              label="Alignment"
            />
            <Slider label="Width" value={width} min={200} max={2400} step={20} onChange={setWidth} format={(v) => `${v}px wide`} />
            <Slider label="Padding" value={pad} min={0} max={200} onChange={setPad} format={(v) => `${v}px padding`} />
          </div>
        </Row>
      </Panel>
      <div
        className="overflow-auto rounded-md border border-line p-3"
        style={{ backgroundImage: "repeating-conic-gradient(var(--color-paper-2) 0 25%, var(--color-surface) 0 50%)", backgroundSize: "16px 16px" }}
        data-lenis-prevent
      >
        <canvas ref={canvas} aria-label="Text image preview" className="mx-auto block h-auto max-w-full shadow-float" style={{ width }} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => canvas.current?.toBlob((b) => b && saveBlob(b, "text.png"))}
          className="inline-flex h-10 items-center gap-2 rounded-md bg-ink px-4 text-sm font-medium text-paper hover:opacity-90"
        >
          <Download aria-hidden className="size-4" /> Download PNG
        </button>
        <span className="font-mono text-xs text-ink-3">
          {dims.w} × {dims.h} px · {formatBytes(dims.bytes)} · 2× for sharp screens
        </span>
      </div>
    </>
  );
}
