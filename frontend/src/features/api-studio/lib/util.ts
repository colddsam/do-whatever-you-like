import type { Auth, Body, Collection, Folder, KV, Protocol, RequestItem, RequestSettings, Scripts, TreeNode, Variable } from "../types";

export const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().replace(/-/g, "").slice(0, 16) : Math.random().toString(36).slice(2, 18);

export const clone = <T,>(v: T): T => (typeof structuredClone === "function" ? structuredClone(v) : JSON.parse(JSON.stringify(v)));

export const kv = (key = "", value = "", extra: Partial<KV> = {}): KV => ({ id: uid(), key, value, enabled: true, ...extra });
export const variable = (key = "", value = "", extra: Partial<Variable> = {}): Variable => ({ id: uid(), key, value, type: "default", enabled: true, ...extra });

export const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "COPY", "LINK", "UNLINK", "PURGE", "LOCK", "UNLOCK", "PROPFIND", "VIEW"] as const;

export const defaultAuth = (type: Auth["type"] = "inherit"): Auth => ({ type, params: {} });
export const emptyScripts = (): Scripts => ({ prerequest: "", test: "" });
export const defaultBody = (): Body => ({ mode: "none", raw: "", rawLang: "json", formdata: [], urlencoded: [], graphql: { query: "", variables: "" } });
export const defaultSettings = (): RequestSettings => ({
  followRedirects: true,
  followOriginalMethod: false,
  followAuthHeader: false,
  maxRedirects: 10,
  strictSSL: true,
  timeoutMs: 0,
  encodeUrl: true,
  disableCookies: false,
  agent: "auto",
});

export function newRequest(partial: Partial<RequestItem> = {}): RequestItem {
  const protocol: Protocol = partial.protocol ?? "http";
  const base: RequestItem = {
    kind: "request",
    id: uid(),
    name: "Untitled request",
    protocol,
    method: "GET",
    url: "",
    params: [],
    pathVars: [],
    headers: [],
    auth: defaultAuth(),
    body: defaultBody(),
    scripts: emptyScripts(),
    settings: defaultSettings(),
    description: "",
    examples: [],
  };
  if (protocol === "graphql") Object.assign(base, { method: "POST", body: { ...defaultBody(), mode: "graphql" }, name: "GraphQL request" });
  if (protocol === "ws") Object.assign(base, { name: "WebSocket request", messages: [] });
  if (protocol === "socketio")
    Object.assign(base, { name: "Socket.IO request", messages: [], socketio: { version: "v4", path: "/socket.io", namespace: "/", auth: "", listeners: [{ id: uid(), event: "message", enabled: true }], ack: false } });
  if (protocol === "mqtt")
    Object.assign(base, {
      name: "MQTT request",
      messages: [],
      mqtt: { version: "3.1.1", clientId: `dwyl-${uid().slice(0, 8)}`, username: "", password: "", keepAlive: 60, clean: true, subscriptions: [] },
    });
  if (protocol === "grpc") Object.assign(base, { name: "gRPC request", grpc: { proto: "", method: "", message: "{}", tls: true, web: false, stream: [] } });
  return { ...base, ...partial, protocol };
}

export function newFolder(name = "New folder"): Folder {
  return { kind: "folder", id: uid(), name, description: "", auth: defaultAuth(), scripts: emptyScripts(), items: [] };
}

export function newCollection(name = "New collection"): Collection {
  const now = Date.now();
  return { id: uid(), name, description: "", auth: defaultAuth("noauth"), scripts: emptyScripts(), variables: [], items: [], createdAt: now, updatedAt: now };
}

/* ------------------------------------------------------------------ tree */

export function walk(items: TreeNode[], fn: (n: TreeNode, parents: Folder[]) => void, parents: Folder[] = []) {
  for (const n of items) {
    fn(n, parents);
    if (n.kind === "folder") walk(n.items, fn, [...parents, n]);
  }
}

export function findNode(items: TreeNode[], id: string): { node: TreeNode; parents: Folder[] } | null {
  let hit: { node: TreeNode; parents: Folder[] } | null = null;
  walk(items, (n, parents) => {
    if (!hit && n.id === id) hit = { node: n, parents };
  });
  return hit;
}

export function requestsIn(items: TreeNode[]): { req: RequestItem; parents: Folder[] }[] {
  const out: { req: RequestItem; parents: Folder[] }[] = [];
  walk(items, (n, parents) => n.kind === "request" && out.push({ req: n, parents }));
  return out;
}

/** Returns a copy of `items` with `fn` applied to the node `id` (replace it by returning a node, or remove it with null). */
export function mapNode(items: TreeNode[], id: string, fn: (n: TreeNode) => TreeNode | null): TreeNode[] {
  const out: TreeNode[] = [];
  for (const n of items) {
    if (n.id === id) {
      const r = fn(n);
      if (r) out.push(r);
    } else if (n.kind === "folder") out.push({ ...n, items: mapNode(n.items, id, fn) });
    else out.push(n);
  }
  return out;
}

/** Inserts `node` into folder `parentId` (or the root when null) at `index` (end when undefined). */
export function insertNode(items: TreeNode[], parentId: string | null, node: TreeNode, index?: number): TreeNode[] {
  if (!parentId) {
    const copy = [...items];
    copy.splice(index ?? copy.length, 0, node);
    return copy;
  }
  return items.map((n) => {
    if (n.kind !== "folder") return n;
    if (n.id === parentId) {
      const copy = [...n.items];
      copy.splice(index ?? copy.length, 0, node);
      return { ...n, items: copy };
    }
    return { ...n, items: insertNode(n.items, parentId, node, index) };
  });
}

/** A deep copy with fresh ids everywhere (duplicate, import). */
export function reId<T extends TreeNode>(n: T): T {
  const c = clone(n) as T;
  const fix = (x: TreeNode) => {
    x.id = uid();
    if (x.kind === "folder") x.items.forEach(fix);
    else x.examples.forEach((e) => (e.id = uid()));
  };
  fix(c);
  return c;
}

export function isAncestor(items: TreeNode[], ancestorId: string, id: string): boolean {
  const a = findNode(items, ancestorId);
  if (!a || a.node.kind !== "folder") return false;
  return !!findNode(a.node.items, id);
}

/* ------------------------------------------------------------------ bytes */

export const te = new TextEncoder();
export const td = new TextDecoder();

export function bytesToB64(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

export function b64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const b64ToText = (s: string) => td.decode(b64ToBytes(s));
export const textToB64 = (s: string) => bytesToB64(te.encode(s));

export const b64url = (b: Uint8Array) => bytesToB64(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function concatBytes(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/* ------------------------------------------------------------------ formatting */

export function fmtBytes(n: number | undefined): string {
  if (n === undefined || Number.isNaN(n)) return "–";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 2 : 1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function fmtMs(n: number | undefined): string {
  if (n === undefined || n === null || Number.isNaN(n)) return "–";
  if (n < 1000) return `${Math.round(n)} ms`;
  return `${(n / 1000).toFixed(n < 10000 ? 2 : 1)} s`;
}

export const header = (headers: [string, string][], name: string) => headers.find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];

export const STATUS_TEXT: Record<number, string> = {
  100: "Continue", 101: "Switching Protocols", 200: "OK", 201: "Created", 202: "Accepted", 203: "Non-Authoritative Information", 204: "No Content",
  205: "Reset Content", 206: "Partial Content", 207: "Multi-Status", 300: "Multiple Choices", 301: "Moved Permanently", 302: "Found", 303: "See Other",
  304: "Not Modified", 307: "Temporary Redirect", 308: "Permanent Redirect", 400: "Bad Request", 401: "Unauthorized", 402: "Payment Required",
  403: "Forbidden", 404: "Not Found", 405: "Method Not Allowed", 406: "Not Acceptable", 408: "Request Timeout", 409: "Conflict", 410: "Gone",
  411: "Length Required", 412: "Precondition Failed", 413: "Payload Too Large", 414: "URI Too Long", 415: "Unsupported Media Type",
  418: "I'm a teapot", 422: "Unprocessable Content", 423: "Locked", 425: "Too Early", 426: "Upgrade Required", 428: "Precondition Required",
  429: "Too Many Requests", 431: "Request Header Fields Too Large", 451: "Unavailable For Legal Reasons", 500: "Internal Server Error",
  501: "Not Implemented", 502: "Bad Gateway", 503: "Service Unavailable", 504: "Gateway Timeout", 505: "HTTP Version Not Supported",
};

/** What a status code means, in a sentence (the hover card on the status). */
export function statusMeaning(code: number): string {
  const known: Record<number, string> = {
    200: "The request succeeded.", 201: "The request succeeded and a new resource was created.", 204: "Succeeded; there's no body to send back.",
    301: "The resource moved for good to the URL in Location.", 302: "The resource is temporarily at the URL in Location.", 304: "Not modified since your cached copy.",
    400: "The server couldn't understand the request: check the body and parameters.", 401: "Authentication is missing or wrong: check the Authorization tab.",
    403: "You're authenticated but not allowed to do this.", 404: "Nothing exists at this URL.", 405: "This URL doesn't accept that method.",
    409: "The request conflicts with the resource's current state.", 415: "The server doesn't accept this body's Content-Type.", 422: "The body was understood but its data isn't valid.",
    429: "Too many requests: slow down and retry after a while.", 500: "The server hit an error it didn't handle.", 502: "A server upstream answered badly.",
    503: "The server is down or overloaded for now.", 504: "A server upstream didn't answer in time.",
  };
  if (known[code]) return known[code];
  if (code < 200) return "Informational response.";
  if (code < 300) return "Success.";
  if (code < 400) return "Redirection.";
  if (code < 500) return "Client error: something in the request needs fixing.";
  return "Server error.";
}

export function statusTone(code: number | undefined): "success" | "warning" | "danger" | "muted" {
  if (!code) return "muted";
  if (code < 300) return "success";
  if (code < 400) return "warning";
  return "danger";
}

export function methodColor(m: string): string {
  switch (m.toUpperCase()) {
    case "GET":
      return "text-success";
    case "POST":
      return "text-warning";
    case "PUT":
      return "text-[#2f5fa8]";
    case "PATCH":
      return "text-[#7a4ea3]";
    case "DELETE":
      return "text-danger";
    default:
      return "text-ink-2";
  }
}

export function protocolLabel(p: Protocol): string {
  return { http: "HTTP", graphql: "GraphQL", ws: "WS", socketio: "IO", mqtt: "MQTT", grpc: "gRPC" }[p];
}

export function downloadFile(name: string, data: BlobPart, type = "application/json") {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, "_").trim() || "export";

export function tryJson(s: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(s) };
  } catch {
    return { ok: false };
  }
}

/** Language of a body from its Content-Type (or a sniff of the text). */
export function langOf(contentType: string | undefined, text: string): "json" | "xml" | "html" | "javascript" | "css" | "text" {
  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("json")) return "json";
  if (ct.includes("html")) return "html";
  if (ct.includes("xml")) return "xml";
  if (ct.includes("javascript") || ct.includes("ecmascript")) return "javascript";
  if (ct.includes("css")) return "css";
  const t = text.trimStart();
  if ((t.startsWith("{") || t.startsWith("[")) && tryJson(text).ok) return "json";
  if (/^<!doctype html|^<html/i.test(t)) return "html";
  if (t.startsWith("<?xml") || /^<[a-zA-Z][\w:-]*[\s>]/.test(t)) return "xml";
  return "text";
}

export function isBinaryType(ct: string | undefined): boolean {
  const c = (ct ?? "").toLowerCase();
  if (!c) return false;
  if (c.startsWith("text/") || /json|xml|javascript|ecmascript|x-www-form-urlencoded|graphql|yaml|csv|event-stream|html/.test(c)) return false;
  return /^(image|audio|video|font)\/|application\/(pdf|zip|octet-stream|gzip|x-tar|x-7z|vnd\.|msword|x-protobuf|grpc|wasm)/.test(c);
}

export function prettyJson(text: string): string {
  const j = tryJson(text);
  return j.ok ? JSON.stringify(j.value, null, 2) : text;
}

/** Light XML/HTML pretty-printer (indent by tags). */
export function prettyXml(xml: string): string {
  const s = xml.replace(/>\s*</g, "><").trim();
  let pad = 0;
  return s
    .replace(/(>)(<)(\/*)/g, "$1\n$2$3")
    .split("\n")
    .map((line) => {
      if (/^<\/\w/.test(line)) pad = Math.max(0, pad - 1);
      const out = "  ".repeat(pad) + line;
      if (/^<\w[^>]*[^/]>.*$/.test(line) && !/<\/\w/.test(line) && !/^<(br|hr|img|input|meta|link|!|\?)/i.test(line)) pad++;
      return out;
    })
    .join("\n");
}

export function relTime(at: number): string {
  const d = (Date.now() - at) / 1000;
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)} min ago`;
  if (d < 86400) return `${Math.floor(d / 3600)} h ago`;
  return new Date(at).toLocaleDateString();
}

export function dayLabel(at: number): string {
  const d = new Date(at);
  const today = new Date();
  const y = new Date(Date.now() - 86400000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

/** Parses "a=1&b=2" style bulk text or "key: value" lines, `//` disables a row (Postman's bulk edit). */
export function parseBulk(text: string, sep: ":" | "=" = ":"): KV[] {
  return text
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((line) => {
      let enabled = true;
      let l = line.trim();
      if (l.startsWith("//")) {
        enabled = false;
        l = l.slice(2).trim();
      }
      const i = l.indexOf(sep);
      return i < 0 ? kv(l, "", { enabled }) : kv(l.slice(0, i).trim(), l.slice(i + 1).trim(), { enabled });
    });
}

export const toBulk = (rows: KV[], sep: ":" | "=" = ":") =>
  rows
    .filter((r) => r.key || r.value)
    .map((r) => `${r.enabled ? "" : "//"}${r.key}${sep}${sep === ":" ? " " : ""}${r.value}`)
    .join("\n");
