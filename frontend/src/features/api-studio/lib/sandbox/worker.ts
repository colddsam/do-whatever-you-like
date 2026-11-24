/// <reference lib="webworker" />
/**
 * The script sandbox: runs pre-request and post-response scripts with Postman's `pm` API.
 *
 * It's a dedicated worker, so a script can't touch the page, and a runaway loop is ended by
 * terminating the worker (the page enforces the time limit). Network, storage and worker APIs are
 * removed from the global scope before any script runs: a script reaches the network only through
 * pm.sendRequest, which the page sends through the same agents as normal requests.
 *
 * Libraries scripts can use, as in Postman: chai (pm.expect), ajv/tv4 (JSON schema), CryptoJS,
 * lodash (_), uuid, atob/btoa, xml2Json and xml2js, plus the legacy `tests[]` / `postman.*` API.
 */

import Ajv from "ajv";
import chai from "chai";
import CryptoJS from "crypto-js";
import _ from "lodash";
import type { Cookie, LogLevel, TestResult } from "../../types";
import type { FromWorker, SbContext, SbKV, SbRequest, SbResponse, SbResult, SbScopes, ToWorker } from "./protocol";

const post = self.postMessage.bind(self) as (m: FromWorker) => void;
const nativeSetTimeout = self.setTimeout.bind(self);
const nativeClearTimeout = self.clearTimeout.bind(self);

// Take away what scripts shouldn't reach: the site's storage, the network, more workers.
for (const name of ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "indexedDB", "caches", "importScripts", "Worker", "SharedWorker", "BroadcastChannel", "WebTransport", "cookieStore"]) {
  try {
    Object.defineProperty(self, name, { value: undefined, configurable: false, writable: false });
  } catch {
    /* not present here */
  }
}

/* ------------------------------------------------------------------ helpers */

const decoder = new TextDecoder();
function b64ToText(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return decoder.decode(bytes);
}

function fmt(v: unknown, depth = 0): string {
  if (typeof v === "string") return depth ? JSON.stringify(v) : v;
  if (v === undefined) return "undefined";
  if (v === null || typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") return String(v);
  if (typeof v === "function") return `[Function ${v.name || "anonymous"}]`;
  if (v instanceof Error) return `${v.name}: ${v.message}`;
  try {
    const seen = new WeakSet();
    return JSON.stringify(
      v,
      (_k, x) => {
        if (typeof x === "object" && x !== null) {
          if (seen.has(x)) return "[Circular]";
          seen.add(x);
        }
        if (typeof x === "bigint") return x.toString();
        if (typeof x === "function") return `[Function]`;
        return x;
      },
      2,
    );
  } catch {
    return String(v);
  }
}

/** Postman's PropertyList (headers, query params, form fields). */
class PropertyList {
  members: SbKV[];
  constructor(items: SbKV[] = []) {
    this.members = items.map((x) => ({ ...x }));
  }
  private match(k: string) {
    return (m: SbKV) => m.key.toLowerCase() === String(k).toLowerCase();
  }
  get(key: string) {
    return [...this.members].reverse().find((m) => !m.disabled && this.match(key)(m))?.value;
  }
  one(key: string) {
    return this.members.find(this.match(key));
  }
  has(key: string | { key: string }, value?: string) {
    const k = typeof key === "string" ? key : key.key;
    return this.members.some((m) => !m.disabled && this.match(k)(m) && (value === undefined || m.value === value));
  }
  add(item: SbKV | string) {
    this.members.push(typeof item === "string" ? parseKV(item) : { key: item.key, value: String(item.value ?? ""), disabled: item.disabled });
  }
  append(item: SbKV) {
    this.add(item);
  }
  upsert(item: SbKV | string) {
    const kv = typeof item === "string" ? parseKV(item) : item;
    const hit = this.members.find(this.match(kv.key));
    if (hit) hit.value = String(kv.value ?? "");
    else this.add(kv);
  }
  insert(item: SbKV) {
    this.members.unshift({ ...item, value: String(item.value ?? "") });
  }
  remove(predicate: string | ((m: SbKV) => boolean)) {
    this.members = this.members.filter((m) => (typeof predicate === "function" ? !predicate(m) : !this.match(predicate)(m)));
  }
  clear() {
    this.members = [];
  }
  populate(items: SbKV[]) {
    items.forEach((i) => this.add(i));
  }
  repopulate(items: SbKV[]) {
    this.clear();
    this.populate(items);
  }
  all() {
    return this.members.filter((m) => !m.disabled);
  }
  count() {
    return this.members.length;
  }
  idx(i: number) {
    return this.members[i];
  }
  indexOf(item: string | SbKV) {
    const k = typeof item === "string" ? item : item.key;
    return this.members.findIndex(this.match(k));
  }
  each(fn: (m: SbKV, i: number) => void) {
    this.members.forEach(fn);
  }
  map<T>(fn: (m: SbKV, i: number) => T) {
    return this.members.map(fn);
  }
  filter(fn: (m: SbKV) => boolean) {
    return this.members.filter(fn);
  }
  find(fn: (m: SbKV) => boolean) {
    return this.members.find(fn);
  }
  reduce<T>(fn: (acc: T, m: SbKV) => T, init: T) {
    return this.members.reduce(fn, init);
  }
  toObject() {
    const o: Record<string, string> = {};
    for (const m of this.members) if (!m.disabled) o[m.key] = m.value;
    return o;
  }
  toJSON() {
    return this.members;
  }
  toString() {
    return this.members.filter((m) => !m.disabled).map((m) => `${m.key}: ${m.value}`).join("\n");
  }
  get [Symbol.toStringTag]() {
    return "PropertyList";
  }
}

const parseKV = (s: string): SbKV => {
  const i = s.indexOf(":");
  return i < 0 ? { key: s.trim(), value: "" } : { key: s.slice(0, i).trim(), value: s.slice(i + 1).trim() };
};

/* ------------------------------------------------------------------ URL object */

function makeUrl(raw: string) {
  const state = { raw };
  const split = () => {
    const h = state.raw.indexOf("#");
    const noHash = h < 0 ? state.raw : state.raw.slice(0, h);
    const q = noHash.indexOf("?");
    return { base: q < 0 ? noHash : noHash.slice(0, q), query: q < 0 ? "" : noHash.slice(q + 1), hash: h < 0 ? "" : state.raw.slice(h) };
  };
  const query = new PropertyList(
    split()
      .query.split("&")
      .filter(Boolean)
      .map((p) => {
        const i = p.indexOf("=");
        return i < 0 ? { key: p, value: "" } : { key: p.slice(0, i), value: p.slice(i + 1) };
      }),
  );
  const parts = () => {
    const { base } = split();
    const m = /^(?:([a-z][\w+.-]*):\/\/)?([^/]*)(.*)$/i.exec(base);
    const [hostPort, path] = [m?.[2] ?? "", m?.[3] ?? ""];
    const pm = /^(.*?)(?::(\d+))?$/.exec(hostPort);
    return { protocol: m?.[1] ?? "", host: (pm?.[1] ?? "").split("."), port: pm?.[2] ?? "", path: path.split("/").filter(Boolean) };
  };
  return {
    query,
    get protocol() {
      return parts().protocol;
    },
    get host() {
      return parts().host;
    },
    get port() {
      return parts().port;
    },
    get path() {
      return parts().path;
    },
    getHost: () => parts().host.join("."),
    getPath: () => "/" + parts().path.join("/"),
    getPathWithQuery: () => "/" + parts().path.join("/") + (query.count() ? `?${queryString(query)}` : ""),
    getQueryString: () => queryString(query),
    getRemote: () => parts().host.join(".") + (parts().port ? `:${parts().port}` : ""),
    getOAuth1BaseUrl: () => `${parts().protocol || "http"}://${parts().host.join(".")}/${parts().path.join("/")}`,
    update(v: string) {
      state.raw = String(v);
      query.repopulate(
        split()
          .query.split("&")
          .filter(Boolean)
          .map((p) => {
            const i = p.indexOf("=");
            return i < 0 ? { key: p, value: "" } : { key: p.slice(0, i), value: p.slice(i + 1) };
          }),
      );
    },
    addQueryParams(params: SbKV[] | string) {
      if (typeof params === "string") params.split("&").forEach((p) => query.add({ key: p.split("=")[0], value: p.split("=").slice(1).join("=") }));
      else params.forEach((p) => query.add(p));
    },
    removeQueryParams(keys: string | string[]) {
      (Array.isArray(keys) ? keys : [keys]).forEach((k) => query.remove(k));
    },
    toString() {
      const { base, hash } = split();
      const qs = queryString(query);
      return base + (qs ? `?${qs}` : "") + hash;
    },
    toJSON() {
      return this.toString();
    },
  };
}

const queryString = (q: PropertyList) =>
  q
    .all()
    .map((m) => (m.value === "" ? m.key : `${m.key}=${m.value}`))
    .join("&");

/* ------------------------------------------------------------------ XML → JSON (xml2Json, xml2js) */

type XmlNode = { name: string; attrs: Record<string, string>; children: (XmlNode | string)[] };

function parseXml(xml: string): XmlNode {
  const root: XmlNode = { name: "#root", attrs: {}, children: [] };
  const stack = [root];
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([^\s>]+)\s*>|<([^\s/>]+)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*)\s*(\/?)>|([^<]+)/g;
  const ent = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_m, d) => String.fromCharCode(+d)).replace(/&amp;/g, "&");
  for (const m of xml.matchAll(re)) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.children.push(m[1]);
    else if (m[2]) {
      if (stack.length > 1) stack.pop();
    } else if (m[3]) {
      const attrs: Record<string, string> = {};
      for (const a of (m[4] ?? "").matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g)) attrs[a[1]] = ent(a[2] ?? a[3] ?? "");
      const node: XmlNode = { name: m[3], attrs, children: [] };
      top.children.push(node);
      if (!m[5]) stack.push(node);
    } else if (m[6] && m[6].trim()) top.children.push(ent(m[6].trim()));
  }
  return root;
}

/** Postman's xml2Json: attributes under "$", text under "_" when mixed, repeated elements as arrays. */
function xmlToObj(node: XmlNode, explicitArray = false): unknown {
  const kids = node.children.filter((c): c is XmlNode => typeof c !== "string");
  const text = node.children.filter((c): c is string => typeof c === "string").join("");
  const hasAttrs = Object.keys(node.attrs).length > 0;
  if (!kids.length && !hasAttrs) return text;
  const out: Record<string, unknown> = {};
  if (hasAttrs) out.$ = node.attrs;
  if (text) out._ = text;
  for (const k of kids) {
    const v = xmlToObj(k, explicitArray);
    if (k.name in out) {
      const cur = out[k.name];
      out[k.name] = Array.isArray(cur) ? [...cur, v] : [cur, v];
    } else out[k.name] = explicitArray ? [v] : v;
  }
  return out;
}

function xml2Json(xml: string): unknown {
  const root = parseXml(String(xml));
  const top = root.children.find((c): c is XmlNode => typeof c !== "string");
  return top ? { [top.name]: xmlToObj(top) } : {};
}

/* ------------------------------------------------------------------ chai: Postman's response assertions */

const RESPONSE = Symbol.for("pm.response");
type PmResponse = { [RESPONSE]: true; code: number; status: string; headers: PropertyList; text(): string; json(): unknown; responseTime: number };
const isResponse = (o: unknown): o is PmResponse => !!o && typeof o === "object" && (o as Record<symbol, unknown>)[RESPONSE] === true;

const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });

chai.use((c, utils) => {
  const A = c.Assertion;
  const statusRange = (name: string, test: (n: number) => boolean, label: string) =>
    A.overwriteProperty(name, (base) =>
      function (this: Chai.AssertionStatic) {
        const obj = utils.flag(this, "object");
        if (!isResponse(obj)) return base.call(this);
        this.assert(test(obj.code), `expected response code to be ${label} but found ${obj.code}`, `expected response code not to be ${label} but found ${obj.code}`, undefined);
      },
    );
  statusRange("ok", (n) => n === 200, "200");
  statusRange("success", (n) => n >= 200 && n < 300, "2XX");
  statusRange("info", (n) => n >= 100 && n < 200, "1XX");
  statusRange("redirection", (n) => n >= 300 && n < 400, "3XX");
  statusRange("clientError", (n) => n >= 400 && n < 500, "4XX");
  statusRange("serverError", (n) => n >= 500 && n < 600, "5XX");
  statusRange("error", (n) => n >= 400 && n < 600, "4XX or 5XX");
  statusRange("accepted", (n) => n === 202, "202");
  statusRange("badRequest", (n) => n === 400, "400");
  statusRange("unauthorized", (n) => n === 401, "401");
  statusRange("unauthorised", (n) => n === 401, "401");
  statusRange("forbidden", (n) => n === 403, "403");
  statusRange("notFound", (n) => n === 404, "404");
  statusRange("rateLimited", (n) => n === 429, "429");

  const ctypeProp = (name: string, re: RegExp, parse?: (r: PmResponse) => void) =>
    A.addProperty(name, function (this: Chai.AssertionStatic) {
      const obj = utils.flag(this, "object");
      if (!isResponse(obj)) throw new Error(`.${name} works on pm.response`);
      const ct = obj.headers.get("content-type") ?? "";
      let ok = re.test(ct);
      if (ok && parse) {
        try {
          parse(obj);
        } catch {
          ok = false;
        }
      }
      this.assert(ok, `expected response to have a ${name.toUpperCase()} body (content-type ${ct || "missing"})`, `expected response not to have a ${name.toUpperCase()} body`, undefined);
    });
  ctypeProp("json", /json/i, (r) => r.json());
  ctypeProp("html", /html/i);
  ctypeProp("xml", /xml/i);
  A.addProperty("withBody", function (this: Chai.AssertionStatic) {
    const obj = utils.flag(this, "object") as PmResponse;
    this.assert(isResponse(obj) && obj.text().length > 0, "expected response to have content in body", "expected response to not have content in body", undefined);
  });

  A.addMethod("status", function (this: Chai.AssertionStatic, expected: number | string) {
    const obj = utils.flag(this, "object");
    if (!isResponse(obj)) throw new Error(".status() works on pm.response");
    if (typeof expected === "number") this.assert(obj.code === expected, `expected response to have status code #{exp} but got #{act}`, `expected response to not have status code #{act}`, expected, obj.code);
    else this.assert(obj.status === expected, `expected response to have status reason #{exp} but got #{act}`, `expected response to not have status reason #{act}`, expected, obj.status);
  });
  A.addMethod("header", function (this: Chai.AssertionStatic, key: string, value?: string) {
    const obj = utils.flag(this, "object");
    if (!isResponse(obj)) throw new Error(".header() works on pm.response");
    const actual = obj.headers.get(key);
    if (value === undefined) this.assert(actual !== undefined, `expected response to have header with key '${key}'`, `expected response to not have header with key '${key}'`, undefined);
    else this.assert(actual === value, `expected '${key}' response header to be '${value}' but got '${actual}'`, `expected '${key}' response header to not be '${value}'`, value, actual);
  });
  A.addMethod("body", function (this: Chai.AssertionStatic, expected?: string | RegExp | object) {
    const obj = utils.flag(this, "object");
    if (!isResponse(obj)) throw new Error(".body() works on pm.response");
    const text = obj.text();
    if (expected === undefined) this.assert(text.length > 0, "expected response to have content in body", "expected response to not have content in body", undefined);
    else if (expected instanceof RegExp) this.assert(expected.test(text), `expected response body to match ${expected}`, `expected response body not to match ${expected}`, undefined);
    else if (typeof expected === "object") this.assert(_.isEqual(obj.json(), expected), "expected response body json to equal #{exp} but got #{act}", "expected response body json to not equal #{exp}", expected, obj.json());
    else this.assert(text === expected, "expected response body to equal #{exp} but got #{act}", "expected response body to not equal #{exp}", expected, text);
  });
  A.addMethod("jsonBody", function (this: Chai.AssertionStatic, path?: string | object, value?: unknown) {
    const obj = utils.flag(this, "object");
    if (!isResponse(obj)) throw new Error(".jsonBody() works on pm.response");
    let body: unknown;
    try {
      body = obj.json();
    } catch {
      this.assert(false, "expected response body to be a valid json but got error", "", undefined);
      return;
    }
    if (path === undefined) return;
    if (typeof path === "object") {
      this.assert(_.isEqual(body, path), "expected response body json to equal #{exp} but got #{act}", "expected response body json to not equal #{exp}", path, body);
      return;
    }
    const has = _.has(body, path);
    if (arguments.length < 2) this.assert(has, `expected #{act} to have property '${path}'`, `expected #{act} to not have property '${path}'`, undefined, body);
    else this.assert(has && _.isEqual(_.get(body, path), value), `expected response body json at "${path}" to contain #{exp} but got #{act}`, `expected response body json at "${path}" to not contain #{exp}`, value, _.get(body, path));
  });
  A.addMethod("jsonSchema", function (this: Chai.AssertionStatic, schema: Record<string, unknown>) {
    const obj = utils.flag(this, "object");
    const data = isResponse(obj) ? obj.json() : obj;
    const s = { ...schema };
    delete s.$schema;
    const validate = ajv.compile(s);
    const ok = validate(data) as boolean;
    const why = (validate.errors ?? []).map((e) => `${e.instancePath || "data"} ${e.message}`).join("; ");
    this.assert(ok, `expected data to satisfy schema but found error: ${why}`, "expected data to not satisfy schema", schema, data);
  });
  A.addMethod("responseTime", function (this: Chai.AssertionStatic) {
    /* pm.response.responseTime is a number: use pm.expect(pm.response.responseTime).to.be.below(n). */
  });
});

/* ------------------------------------------------------------------ the run */

type Pending = { n: number; idle: (() => void) | null };

let current: { runId: string; pending: Pending; sends: Map<string, (r: { error?: string; response?: SbResponse & { url: string } }) => void> } | null = null;

const MODULES = (): Record<string, unknown> => ({
  lodash: _,
  "crypto-js": CryptoJS,
  chai,
  ajv: Ajv,
  tv4: TV4,
  uuid: { v4: () => crypto.randomUUID(), validate: (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s) },
  atob: (s: string) => atob(s),
  btoa: (s: string) => btoa(s),
  xml2js: {
    parseString: (xml: string, opts: unknown, cb?: (err: Error | null, res?: unknown) => void) => {
      const done = (typeof opts === "function" ? opts : cb) as (err: Error | null, res?: unknown) => void;
      try {
        const root = parseXml(String(xml));
        const top = root.children.find((c): c is XmlNode => typeof c !== "string");
        done(null, top ? { [top.name]: xmlToObj(top, true) } : {});
      } catch (e) {
        done(e as Error);
      }
    },
  },
});

const TV4 = {
  error: null as null | { message: string; dataPath: string },
  validate(data: unknown, schema: Record<string, unknown>) {
    const s = { ...schema };
    delete s.$schema;
    const v = ajv.compile(s);
    const ok = v(data) as boolean;
    TV4.error = ok ? null : { message: v.errors?.[0]?.message ?? "invalid", dataPath: v.errors?.[0]?.instancePath ?? "" };
    return ok;
  },
  validateResult(data: unknown, schema: Record<string, unknown>) {
    const valid = TV4.validate(data, schema);
    return { valid, error: TV4.error, missing: [] };
  },
};

function scopeApi(map: Record<string, string>, resolveIn: (s: string) => string, name?: string) {
  return {
    name,
    get: (k: string) => (Object.prototype.hasOwnProperty.call(map, k) ? map[k] : undefined),
    set: (k: string, v: unknown) => {
      map[k] = typeof v === "string" ? v : v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    },
    unset: (k: string) => {
      delete map[k];
    },
    has: (k: string) => Object.prototype.hasOwnProperty.call(map, k),
    clear: () => Object.keys(map).forEach((k) => delete map[k]),
    toObject: () => ({ ...map }),
    toJSON: () => ({ ...map }),
    replaceIn: (s: string) => resolveIn(s),
    values: { toObject: () => ({ ...map }) },
  };
}

function resolver(s: SbScopes) {
  const order = [s.local, s.data, s.environment, s.collection, s.globals];
  const find = (name: string) => {
    if (name.startsWith("vault:")) return s.vault[name.slice(6)];
    for (const m of order) if (Object.prototype.hasOwnProperty.call(m, name)) return m[name];
    return undefined;
  };
  const resolveIn = (text: string, depth = 0): string => {
    if (typeof text !== "string" || depth > 10) return text;
    let changed = false;
    const out = text.replace(/\{\{([^{}]+?)\}\}/g, (m, n: string) => {
      const v = find(n.trim());
      if (v === undefined) return m;
      changed = true;
      return v;
    });
    return changed ? resolveIn(out, depth + 1) : out;
  };
  return { find, resolveIn };
}

async function run(runId: string, script: string, ctx: SbContext) {
  const pending: Pending = { n: 0, idle: null };
  current = { runId, pending, sends: new Map() };
  const hold = () => pending.n++;
  const release = () => {
    pending.n = Math.max(0, pending.n - 1);
    if (pending.n === 0) pending.idle?.();
  };
  const log = (level: LogLevel) => (...args: unknown[]) => post({ type: "log", runId, log: { level, text: args.map((a) => fmt(a)).join(" ") } });
  const sbConsole = { log: log("log"), info: log("info"), warn: log("warn"), error: log("error"), debug: log("debug"), trace: log("debug"), table: log("log"), dir: log("log") };

  const scopes = ctx.scopes;
  const { find, resolveIn } = resolver(scopes);
  const tests: TestResult[] = [];
  let nextRequest: string | null | undefined;
  let skipRequest = false;
  let visualizer: SbResult["visualizer"] = null;
  let cookies: Cookie[] = ctx.cookies.map((c) => ({ ...c }));

  /* request */
  const reqHeaders = new PropertyList(ctx.request.headers);
  const reqUrl = makeUrl(ctx.request.url);
  const body = ctx.request.body ? { ...ctx.request.body, urlencoded: new PropertyList(ctx.request.body.urlencoded ?? []), formdata: new PropertyList(ctx.request.body.formdata ?? []) } : null;
  const request = {
    id: ctx.request.id,
    name: ctx.request.name,
    method: ctx.request.method,
    url: reqUrl,
    headers: reqHeaders,
    body: body && {
      ...body,
      update(v: string | { mode: string; raw?: string; urlencoded?: SbKV[]; formdata?: SbKV[] }) {
        if (typeof v === "string") Object.assign(body, { mode: "raw", raw: v });
        else {
          body.mode = v.mode;
          if (v.raw !== undefined) body.raw = v.raw;
          if (v.urlencoded) body.urlencoded.repopulate(v.urlencoded);
          if (v.formdata) body.formdata.repopulate(v.formdata);
        }
      },
      toString: () => (body.mode === "raw" ? (body.raw ?? "") : body.mode === "urlencoded" ? body.urlencoded.all().map((m) => `${m.key}=${m.value}`).join("&") : ""),
      isEmpty: () => !body.raw && !body.urlencoded.count() && !body.formdata.count(),
    },
    auth: ctx.request.auth,
    addHeader: (h: SbKV) => reqHeaders.add(h),
    removeHeader: (k: string) => reqHeaders.remove(k),
    upsertHeader: (h: SbKV) => reqHeaders.upsert(h),
    addQueryParams: (p: SbKV[] | string) => reqUrl.addQueryParams(p),
    removeQueryParams: (p: string | string[]) => reqUrl.removeQueryParams(p),
    toJSON: () => ({ method: request.method, url: reqUrl.toString(), header: reqHeaders.members }),
  };

  /* response */
  let response: (PmResponse & Record<string, unknown>) | undefined;
  if (ctx.response) {
    const r = ctx.response;
    const text = b64ToText(r.bodyB64);
    let parsed: unknown;
    let parsedOk = false;
    const headers = new PropertyList(r.headers);
    response = {
      [RESPONSE]: true,
      code: r.code,
      status: r.status,
      headers,
      responseTime: r.responseTime,
      responseSize: r.responseSize,
      text: () => text,
      json: () => {
        if (!parsedOk) {
          parsed = JSON.parse(text);
          parsedOk = true;
        }
        return parsed;
      },
      reason: () => r.status,
      dataURI: () => `data:${headers.get("content-type") ?? "application/octet-stream"};base64,${r.bodyB64}`,
      size: () => ({ body: r.responseSize, header: headers.toString().length, total: r.responseSize + headers.toString().length }),
      cookies: cookieList(() => cookies.filter((c) => matchesUrl(c, ctx.resolvedUrl))),
    } as PmResponse & Record<string, unknown>;
    Object.defineProperty(response, "to", { get: () => chai.expect(response).to });
    Object.defineProperty(response, "not", { get: () => chai.expect(response).not });
  }

  /* pm */
  const variables = {
    ...scopeApi(scopes.local, resolveIn),
    get: (k: string) => find(k),
    has: (k: string) => find(k) !== undefined,
    toObject: () => ({ ...scopes.globals, ...scopes.collection, ...scopes.environment, ...scopes.data, ...scopes.local }),
  };
  const test = (name: string, fn?: (done?: (err?: unknown) => void) => unknown) => {
    const result: TestResult = { name: String(name), passed: true };
    tests.push(result);
    if (typeof fn !== "function") {
      result.skipped = true;
      return test;
    }
    const fail = (e: unknown) => {
      result.passed = false;
      result.error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    };
    try {
      if (fn.length > 0) {
        hold();
        let finished = false;
        const done = (err?: unknown) => {
          if (finished) return;
          finished = true;
          if (err) fail(err);
          release();
        };
        const out = fn(done);
        if (out && typeof (out as Promise<unknown>).then === "function") (out as Promise<unknown>).catch(done);
      } else {
        const out = fn();
        if (out && typeof (out as Promise<unknown>).then === "function") {
          hold();
          (out as Promise<unknown>).catch(fail).finally(release);
        }
      }
    } catch (e) {
      fail(e);
    }
    return test;
  };
  test.skip = (name: string) => {
    tests.push({ name: String(name), passed: true, skipped: true });
  };

  const sendRequest = (req: string | Record<string, unknown>, cb?: (err: unknown, res?: unknown) => void) => {
    const reqId = Math.random().toString(36).slice(2);
    const spec = normalizeSendRequest(req, resolveIn);
    hold();
    const promise = new Promise((resolve, reject) => {
      current!.sends.set(reqId, ({ error, response: res }) => {
        try {
          if (error || !res) {
            const err = new Error(error ?? "The request failed.");
            cb?.(err);
            reject(err);
          } else {
            const text = b64ToText(res.bodyB64);
            const headers = new PropertyList(res.headers);
            const out = {
              [RESPONSE]: true,
              code: res.code,
              status: res.status,
              headers,
              responseTime: res.responseTime,
              responseSize: res.responseSize,
              text: () => text,
              json: () => JSON.parse(text),
              reason: () => res.status,
            } as PmResponse & Record<string, unknown>;
            Object.defineProperty(out, "to", { get: () => chai.expect(out).to });
            try {
              cb?.(null, out);
            } catch (e) {
              log("error")(`Error in pm.sendRequest callback: ${fmt(e)}`);
            }
            resolve(out);
          }
        } finally {
          release();
        }
      });
    });
    if (cb) promise.catch(() => undefined);
    post({ type: "sendRequest", runId, reqId, request: spec });
    return promise;
  };

  const jar = () => {
    const later = (fn: () => void) => {
      hold();
      nativeSetTimeout(() => {
        try {
          fn();
        } finally {
          release();
        }
      }, 0);
    };
    return {
      get: (url: string, name: string, cb: (err: unknown, value?: string) => void) => later(() => cb(null, cookies.find((c) => c.name === name && matchesUrl(c, url))?.value)),
      getAll: (url: string, cb: (err: unknown, list?: unknown[]) => void) => later(() => cb(null, cookies.filter((c) => matchesUrl(c, url)))),
      set: (url: string, name: string | Record<string, unknown>, value?: string | ((e: unknown) => void), cb?: (err: unknown, c?: unknown) => void) => {
        const host = hostOfUrl(url);
        const obj = typeof name === "object" ? name : { name, value };
        const done = (typeof value === "function" ? value : cb) as ((e: unknown, c?: unknown) => void) | undefined;
        later(() => {
          const c: Cookie = { name: String(obj.name ?? obj.key), value: String(obj.value ?? ""), domain: String(obj.domain ?? host), path: String(obj.path ?? "/"), httpOnly: !!obj.httpOnly, secure: !!obj.secure, hostOnly: !obj.domain };
          cookies = cookies.filter((x) => !(x.name === c.name && x.domain === c.domain && x.path === c.path));
          cookies.push(c);
          done?.(null, c);
        });
      },
      unset: (url: string, name: string, cb?: (err: unknown) => void) =>
        later(() => {
          cookies = cookies.filter((c) => !(c.name === name && matchesUrl(c, url)));
          cb?.(null);
        }),
      clear: (url: string, cb?: (err: unknown) => void) =>
        later(() => {
          cookies = cookies.filter((c) => !matchesUrl(c, url));
          cb?.(null);
        }),
    };
  };

  const vault = {
    get: async (k: string) => {
      if (!ctx.vaultEnabled) throw new Error("Vault access from scripts is turned off. Turn it on in Settings → Vault.");
      return scopes.vault[k];
    },
    set: async (k: string, v: string) => {
      if (!ctx.vaultEnabled) throw new Error("Vault access from scripts is turned off. Turn it on in Settings → Vault.");
      scopes.vault[k] = String(v);
    },
    unset: async (k: string) => {
      if (!ctx.vaultEnabled) throw new Error("Vault access from scripts is turned off. Turn it on in Settings → Vault.");
      delete scopes.vault[k];
    },
  };

  const location: string[] & { current?: string } = [...ctx.location];
  location.current = ctx.location[ctx.location.length - 1];

  const pm = {
    info: ctx.info,
    environment: scopeApi(scopes.environment, resolveIn, ctx.envName),
    collectionVariables: scopeApi(scopes.collection, resolveIn),
    globals: scopeApi(scopes.globals, resolveIn),
    iterationData: { ...scopeApi(scopes.data, resolveIn), set: undefined, unset: undefined },
    variables,
    vault,
    request,
    response,
    cookies: Object.assign(
      cookieList(() => cookies.filter((c) => matchesUrl(c, ctx.resolvedUrl))),
      { jar },
    ),
    test,
    expect: chai.expect,
    sendRequest,
    visualizer: {
      set: (template: string, data?: unknown, options?: unknown) => {
        visualizer = { template: String(template), data: data ?? {}, options };
      },
      clear: () => {
        visualizer = null;
      },
    },
    execution: {
      setNextRequest: (n: string | null) => {
        nextRequest = n;
      },
      skipRequest: () => {
        skipRequest = true;
      },
      location,
    },
    setNextRequest: (n: string | null) => {
      nextRequest = n;
    },
    require: (name: string) => {
      const mods = MODULES();
      if (name in mods) return mods[name];
      throw new Error(`Cannot find module '${name}'. Available: ${Object.keys(mods).join(", ")}.`);
    },
  };

  /* the legacy API (Postman's old sandbox) */
  const legacyTests: Record<string, unknown> = {};
  const postman = {
    setEnvironmentVariable: (k: string, v: string) => pm.environment.set(k, v),
    getEnvironmentVariable: (k: string) => pm.environment.get(k),
    clearEnvironmentVariable: (k: string) => pm.environment.unset(k),
    clearEnvironmentVariables: () => pm.environment.clear(),
    setGlobalVariable: (k: string, v: string) => pm.globals.set(k, v),
    getGlobalVariable: (k: string) => pm.globals.get(k),
    clearGlobalVariable: (k: string) => pm.globals.unset(k),
    clearGlobalVariables: () => pm.globals.clear(),
    setNextRequest: (n: string | null) => {
      nextRequest = n;
    },
    getResponseHeader: (k: string) => response?.headers.get(k),
    getResponseCookie: (k: string) => cookies.find((c) => c.name === k && matchesUrl(c, ctx.resolvedUrl)),
  };

  const timers = new Map<number, boolean>();
  const sbSetTimeout = (fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) => {
    hold();
    const id = nativeSetTimeout(() => {
      timers.delete(id);
      try {
        fn(...args);
      } catch (e) {
        log("error")(fmt(e));
      } finally {
        release();
      }
    }, ms);
    timers.set(id, true);
    return id;
  };
  const sbClearTimeout = (id: number) => {
    if (timers.delete(id)) {
      nativeClearTimeout(id);
      release();
    }
  };
  // An interval is a chain of timeouts, so a script that never clears one ends at the time limit.
  const intervals = new Map<number, number>();
  let nextInterval = 1;
  const sbSetInterval = (fn: () => void, ms = 0) => {
    const handle = nextInterval++;
    const tick = () => {
      fn();
      if (intervals.has(handle)) intervals.set(handle, sbSetTimeout(tick, ms));
    };
    intervals.set(handle, sbSetTimeout(tick, ms));
    return handle;
  };
  const sbClearInterval = (h: number) => {
    const id = intervals.get(h);
    intervals.delete(h);
    if (id !== undefined) sbClearTimeout(id);
  };

  const respText = ctx.response ? b64ToText(ctx.response.bodyB64) : undefined;
  const sandboxGlobals: Record<string, unknown> = {
    pm,
    postman,
    console: sbConsole,
    require: pm.require,
    tests: legacyTests,
    _,
    CryptoJS,
    tv4: TV4,
    Ajv,
    chai,
    xml2Json,
    atob: (s: string) => atob(s),
    btoa: (s: string) => btoa(s),
    setTimeout: sbSetTimeout,
    clearTimeout: sbClearTimeout,
    setInterval: sbSetInterval,
    clearInterval: sbClearInterval,
    setImmediate: (fn: () => void) => sbSetTimeout(fn, 0),
    responseBody: respText,
    responseCode: ctx.response ? { code: ctx.response.code, name: ctx.response.status, detail: ctx.response.status } : undefined,
    responseHeaders: ctx.response ? Object.fromEntries(ctx.response.headers.map((h) => [h.key, h.value])) : undefined,
    responseTime: ctx.response?.responseTime,
    responseCookies: cookies,
    environment: scopes.environment,
    globals: scopes.globals,
    data: scopes.data,
    iteration: ctx.info.iteration,
    request: { url: ctx.resolvedUrl, method: ctx.request.method, headers: Object.fromEntries(ctx.request.headers.map((h) => [h.key, h.value])), data: ctx.request.body?.raw ?? {}, name: ctx.request.name, id: ctx.request.id },
    // Shadow what was removed above, so a script gets a clear "undefined" rather than a ReferenceError.
    fetch: undefined,
    XMLHttpRequest: undefined,
    WebSocket: undefined,
    importScripts: undefined,
    indexedDB: undefined,
    postMessage: undefined,
    close: undefined,
    self: undefined,
  };

  let error: string | undefined;
  try {
    const names = Object.keys(sandboxGlobals);
    const fn = new Function(...names, `"use strict";\nreturn (async () => {\n${script}\n})();`);
    await fn(...names.map((n) => sandboxGlobals[n]));
    // Let promise chains started by the script settle, then wait for timers, tests and requests.
    for (let i = 0; i < 3; i++) await Promise.resolve();
    if (pending.n > 0) await new Promise<void>((r) => (pending.idle = r));
  } catch (e) {
    error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  }
  for (const [name, passed] of Object.entries(legacyTests)) tests.push({ name, passed: !!passed, error: passed ? undefined : "AssertionError: legacy test returned false" });

  const outRequest: SbRequest = {
    ...ctx.request,
    method: request.method,
    url: reqUrl.toString(),
    headers: reqHeaders.members,
    body: body ? { mode: body.mode, raw: body.raw, urlencoded: body.urlencoded.members, formdata: body.formdata.members, graphql: body.graphql, options: body.options } : null,
  };
  post({ type: "done", runId, result: { tests, scopes, request: outRequest, nextRequest, skipRequest, visualizer, cookies, error } });
  current = null;
}

function cookieList(list: () => Cookie[]) {
  return {
    get: (name: string) => list().find((c) => c.name === name)?.value,
    has: (name: string) => list().some((c) => c.name === name),
    one: (name: string) => list().find((c) => c.name === name),
    all: () => list(),
    toObject: () => Object.fromEntries(list().map((c) => [c.name, c.value])),
    count: () => list().length,
    each: (fn: (c: Cookie) => void) => list().forEach(fn),
  };
}

function hostOfUrl(url: string) {
  try {
    return new URL(/^[a-z]+:\/\//i.test(url) ? url : `http://${url}`).hostname;
  } catch {
    return "";
  }
}

function matchesUrl(c: Cookie, url: string) {
  const host = hostOfUrl(url);
  return host === c.domain || (!c.hostOnly && host.endsWith(`.${c.domain}`));
}

/** pm.sendRequest takes a URL or a request object in Postman's shapes; normalise both. */
function normalizeSendRequest(req: string | Record<string, unknown>, resolveIn: (s: string) => string): SbRequest {
  if (typeof req === "string") return { id: "", name: "pm.sendRequest", method: "GET", url: resolveIn(req), headers: [], body: null, auth: null };
  const url = typeof req.url === "string" ? req.url : String((req.url as { toString(): string })?.toString?.() ?? "");
  const rawHeaders = req.header ?? req.headers;
  let headers: SbKV[] = [];
  if (Array.isArray(rawHeaders)) headers = rawHeaders.map((h) => (typeof h === "string" ? parseKV(h) : { key: String(h.key), value: String(h.value ?? "") }));
  else if (typeof rawHeaders === "string") headers = rawHeaders.split("\n").filter(Boolean).map(parseKV);
  else if (rawHeaders && typeof rawHeaders === "object") headers = Object.entries(rawHeaders as Record<string, unknown>).map(([k, v]) => ({ key: k, value: String(v) }));
  const b = req.body as Record<string, unknown> | undefined;
  let body: SbRequest["body"] = null;
  if (b && typeof b === "object") {
    const listOf = (v: unknown): SbKV[] => (Array.isArray(v) ? v.map((x) => ({ key: String(x.key), value: String(x.value ?? ""), disabled: !!x.disabled, type: x.type, src: x.src })) : v && typeof v === "object" ? Object.entries(v).map(([k, x]) => ({ key: k, value: String(x) })) : []);
    body = {
      mode: String(b.mode ?? "raw"),
      raw: typeof b.raw === "string" ? b.raw : b.raw !== undefined ? JSON.stringify(b.raw) : undefined,
      urlencoded: listOf(b.urlencoded),
      formdata: listOf(b.formdata),
      graphql: b.graphql as { query: string; variables: string } | undefined,
      options: b.options as { raw?: { language: string } } | undefined,
    };
  }
  return {
    id: "",
    name: "pm.sendRequest",
    method: String(req.method ?? "GET").toUpperCase(),
    url: resolveIn(url),
    headers: headers.map((h) => ({ ...h, key: resolveIn(h.key), value: resolveIn(h.value) })),
    body,
    auth: (req.auth as SbRequest["auth"]) ?? null,
  };
}

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  if (m.type === "run") void run(m.runId, m.script, m.ctx);
  else if (m.type === "sendResult" && current?.runId === m.runId) {
    const cb = current.sends.get(m.reqId);
    current.sends.delete(m.reqId);
    cb?.({ error: m.error, response: m.response });
  }
};

post({ type: "ready" });
