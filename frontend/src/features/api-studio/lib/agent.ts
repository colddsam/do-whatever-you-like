import type { SseEvent, Timings, TlsInfo } from "../types";
import type { Prepared } from "./auth";
import { b64ToBytes, bytesToB64, concatBytes, STATUS_TEXT, td } from "./util";
import { hostOf, isPrivateHost, withScheme } from "./url";

/**
 * Two ways out, like Postman's agents:
 * - cloud: our server sends the request (no CORS limits, full timings and TLS details; public addresses only);
 * - browser: this tab calls the API itself (reaches localhost and your network, but the API must allow CORS).
 * "auto" picks the browser for private addresses and the cloud for everything else.
 */

export type AgentName = "cloud" | "browser";

export type AgentOptions = {
  agent: AgentName;
  followRedirects: boolean;
  followOriginalMethod: boolean;
  followAuthHeader: boolean;
  maxRedirects: number;
  strictSSL: boolean;
  timeoutMs: number;
  credentials: boolean;
  signal?: AbortSignal;
  onEvent?: (e: SseEvent) => void;
};

export type AgentResult = {
  status: number;
  statusText: string;
  httpVersion: string;
  headers: [string, string][];
  body: Uint8Array;
  size: { body: number; headers: number; wire?: number };
  truncated: boolean;
  timings: Timings;
  remote?: { ip: string; port: number };
  tls?: TlsInfo | null;
  hops?: { url: string; status: number; reason: string; ms: number }[];
  sentHeaders: [string, string][];
  agent: AgentName;
  streamCut?: boolean;
  events?: SseEvent[];
  warnings: string[];
};

export function pickAgent(pref: "auto" | "cloud" | "browser", url: string): AgentName {
  if (pref !== "auto") return pref;
  return isPrivateHost(hostOf(url)) ? "browser" : "cloud";
}

export async function send(p: Prepared, o: AgentOptions): Promise<AgentResult> {
  return o.agent === "browser" ? viaBrowser(p, o) : viaCloud(p, o);
}

/* ------------------------------------------------------------------ cloud */

type CloudRes = {
  status: number;
  reason: string;
  http_version: string;
  headers: [string, string][];
  body_b64: string;
  size: { body: number; wire_body: number; headers: number };
  truncated: boolean;
  stream_cut: boolean;
  timings: Timings;
  remote: { ip: string; port: number };
  tls: TlsInfo | null;
  hops: { url: string; status: number; reason: string; ms: number }[];
  request: { method: string; url: string; headers: [string, string][] };
};

async function viaCloud(p: Prepared, o: AgentOptions): Promise<AgentResult> {
  if (p.body && p.body.length > 3 * 1024 * 1024) throw new Error("This body is over 3 MB, the most our server relays. Switch the agent to Browser to send it from your device.");
  const payload = {
    method: p.method,
    url: withScheme(p.url),
    headers: p.headers,
    body_b64: p.body ? bytesToB64(p.body) : null,
    follow_redirects: o.followRedirects,
    follow_original_method: o.followOriginalMethod,
    follow_auth_header: o.followAuthHeader,
    max_redirects: o.maxRedirects,
    timeout_ms: Math.min(Math.max(o.timeoutMs, 100), 55_000),
    verify_ssl: o.strictSSL,
    ntlm: p.ntlm ?? null,
  };
  let res: Response;
  try {
    res = await fetch("/api/tools/apiclient/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: o.signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new Error("Couldn't reach our server to send this. Check your connection, or switch the agent to Browser.");
  }
  const data = (await res.json().catch(() => null)) as CloudRes | { detail?: string } | null;
  if (!res.ok) throw new Error((data && "detail" in data && data.detail) || `Our server couldn't send this (${res.status}).`);
  const d = data as CloudRes;
  const body = b64ToBytes(d.body_b64);
  return {
    status: d.status,
    statusText: d.reason || STATUS_TEXT[d.status] || "",
    httpVersion: d.http_version,
    headers: d.headers,
    body,
    size: { body: d.size.body, headers: d.size.headers, wire: d.size.wire_body },
    truncated: d.truncated,
    timings: d.timings,
    remote: d.remote,
    tls: d.tls,
    hops: d.hops,
    sentHeaders: d.request.headers,
    agent: "cloud",
    streamCut: d.stream_cut,
    events: (d.headers.find(([k]) => k.toLowerCase() === "content-type")?.[1] ?? "").includes("event-stream") ? parseSse(td.decode(body)) : undefined,
    warnings: [],
  };
}

/* ------------------------------------------------------------------ browser */

const FORBIDDEN = /^(accept-charset|accept-encoding|access-control-request-.*|connection|content-length|cookie2?|date|dnt|expect|host|keep-alive|origin|referer|te|trailer|transfer-encoding|upgrade|via|proxy-.*|sec-.*|user-agent)$/i;

async function viaBrowser(p: Prepared, o: AgentOptions): Promise<AgentResult> {
  if (p.ntlm) throw new Error("NTLM needs the Cloud agent: a browser page can't hold the connection-level handshake.");
  const warnings: string[] = [];
  const headers = new Headers();
  const sent: [string, string][] = [];
  for (const [k, v] of p.headers) {
    if (p.auto?.includes(k.toLowerCase())) continue;
    if (FORBIDDEN.test(k)) {
      warnings.push(`The browser doesn't let pages set "${k}"; it was left out. Use the Cloud agent to send it.`);
      continue;
    }
    try {
      headers.append(k, v);
      sent.push([k, v]);
    } catch {
      warnings.push(`"${k}" isn't a valid header for the browser; it was left out.`);
    }
  }
  if (!o.strictSSL) warnings.push("The browser always checks certificates: SSL verification can only be turned off with the Cloud agent.");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new DOMException("timeout", "TimeoutError")), Math.max(100, o.timeoutMs));
  const signal = o.signal ? AbortSignal.any([o.signal, ctrl.signal]) : ctrl.signal;
  const url = withScheme(p.url);
  const t0 = performance.now();
  let res: Response;
  try {
    res = await fetch(url, {
      method: p.method,
      headers,
      body: p.body && !["GET", "HEAD"].includes(p.method.toUpperCase()) ? (p.body as BodyInit) : undefined,
      redirect: o.followRedirects ? "follow" : "manual",
      credentials: o.credentials ? "include" : "omit",
      cache: "no-store",
      mode: "cors",
      signal,
    });
  } catch (e) {
    clearTimeout(timer);
    if (o.signal?.aborted) throw e;
    if (ctrl.signal.aborted) throw new Error(`No answer within ${Math.round(o.timeoutMs / 1000)} seconds.`);
    const host = hostOf(url);
    throw new Error(
      isPrivateHost(host)
        ? `Couldn't reach ${host} from this browser. Is the server running, and does it allow cross-origin requests (CORS) from this site? Mixed content (an http:// API from this https:// page) is also blocked by browsers; serve it over https or use localhost.`
        : `The browser couldn't complete this request. The API probably doesn't allow cross-origin calls (CORS). Switch the agent to Cloud to send it through our server.`,
    );
  }
  const t1 = performance.now();
  const ctype = res.headers.get("content-type") ?? "";
  const max = 50 * 1024 * 1024;
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  const events: SseEvent[] = [];
  const isSse = ctype.includes("text/event-stream");
  if (res.body && p.method.toUpperCase() !== "HEAD") {
    const reader = res.body.getReader();
    let pending = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > max) {
          truncated = true;
          await reader.cancel();
          break;
        }
        chunks.push(value);
        if (isSse) {
          clearTimeout(timer);
          pending += td.decode(value, { stream: true });
          const cut = pending.lastIndexOf("\n\n");
          if (cut >= 0) {
            for (const ev of parseSse(pending.slice(0, cut + 2))) {
              events.push(ev);
              o.onEvent?.(ev);
            }
            pending = pending.slice(cut + 2);
          }
        }
      }
    } catch (e) {
      if (!(o.signal?.aborted && isSse)) {
        clearTimeout(timer);
        if (o.signal?.aborted) throw e;
        if (!isSse) throw new Error("The connection dropped while the response was downloading.");
      }
    }
  }
  clearTimeout(timer);
  const t2 = performance.now();
  const hdrs: [string, string][] = [];
  res.headers.forEach((v, k) => hdrs.push([k, v]));
  const body = concatBytes(chunks);
  // Resource Timing has the phases when the API sends Timing-Allow-Origin (or it's this site).
  const timings: Timings = { ttfb: t1 - t0, download: t2 - t1, total: t2 - t0 };
  const entry = performance.getEntriesByName(res.url || url).at(-1) as PerformanceResourceTiming | undefined;
  if (entry && entry.domainLookupEnd > 0) {
    timings.dns = entry.domainLookupEnd - entry.domainLookupStart;
    timings.tcp = (entry.secureConnectionStart || entry.connectEnd) - entry.connectStart;
    timings.tls = entry.secureConnectionStart ? entry.connectEnd - entry.secureConnectionStart : 0;
  }
  if (res.type === "opaqueredirect")
    return {
      status: 0,
      statusText: "Redirect (hidden by the browser)",
      httpVersion: "HTTP",
      headers: [],
      body: new Uint8Array(),
      size: { body: 0, headers: 0 },
      truncated: false,
      timings,
      sentHeaders: sent,
      agent: "browser",
      warnings: [...warnings, "Browsers hide redirect responses from pages. Turn on 'Automatically follow redirects', or use the Cloud agent to see the redirect itself."],
    };
  if (res.headers.has("set-cookie") || hdrs.length === 0) warnings.push("Browsers hide some response headers (like Set-Cookie) from pages unless the API exposes them.");
  return {
    status: res.status,
    statusText: res.statusText || STATUS_TEXT[res.status] || "",
    httpVersion: "HTTP",
    headers: hdrs,
    body,
    size: { body: body.length, headers: hdrs.reduce((n, [k, v]) => n + k.length + v.length + 4, 0) },
    truncated,
    timings,
    sentHeaders: sent,
    agent: "browser",
    hops: res.redirected ? [{ url: res.url, status: res.status, reason: "", ms: t2 - t0 }] : undefined,
    events: isSse ? events : undefined,
    warnings,
  };
}

/* ------------------------------------------------------------------ server-sent events */

export function parseSse(text: string): SseEvent[] {
  const out: SseEvent[] = [];
  for (const block of text.replace(/\r\n?/g, "\n").split("\n\n")) {
    if (!block.trim()) continue;
    let event = "message";
    let id: string | undefined;
    const data: string[] = [];
    let any = false;
    for (const line of block.split("\n")) {
      if (!line || line.startsWith(":")) continue;
      const i = line.indexOf(":");
      const field = i < 0 ? line : line.slice(0, i);
      const value = i < 0 ? "" : line.slice(i + 1).replace(/^ /, "");
      if (field === "event") event = value;
      else if (field === "data") {
        data.push(value);
        any = true;
      } else if (field === "id") id = value;
    }
    if (any) out.push({ id, event, data: data.join("\n"), at: Date.now() });
  }
  return out;
}
