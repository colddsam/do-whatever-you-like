import type { AppSettings, Body, Collection, Cookie, Folder, KV, LogLevel, Mock, RequestItem, ResponseData, SentRequest, SseEvent, TestResult } from "../types";
import { send, pickAgent, type AgentResult } from "./agent";
import { applyAuth, digestHeader, effectiveAuth, parseDigestChallenge, type Prepared } from "./auth";
import { buildBody } from "./body";
import { cookieHeader, cookiesFor, parseSetCookie, storeCookies } from "./cookies";
import { answerMock, mockFor } from "./mock";
import { runScript } from "./sandbox/client";
import type { SbContext, SbKV, SbRequest, SbResponse, SbScopes } from "./sandbox/protocol";
import { applyPathVars, encodeUrl, splitUrl, withScheme } from "./url";
import { bytesToB64, header, kv, STATUS_TEXT, td, uid } from "./util";
import { resolve, type Scopes } from "./vars";

/**
 * Sends one request the way Postman does: collection → folder → request pre-request scripts, then
 * variables, body, auth, cookies; the request goes to a mock or out through an agent (a Digest
 * challenge is answered once automatically); then the post-response scripts run with `pm.response`
 * and the tests are collected.
 */

export type NetLog = { method: string; url: string; status?: number; ms?: number; size?: number; error?: string; request: SentRequest; response?: { headers: [string, string][]; body: string; status: number } };

export type EngineEnv = {
  settings: AppSettings;
  collection?: Collection | null;
  parents: Folder[];
  /** Mutated in place by scripts (pm.environment.set…); the caller persists what changed. */
  scopes: Scopes;
  envName: string;
  cookies: Cookie[];
  setCookies: (c: Cookie[]) => void;
  mocks: Mock[];
  collections: Collection[];
  iteration: number;
  iterationCount: number;
  signal?: AbortSignal;
  log: (level: LogLevel, text: string, source?: string) => void;
  net: (entry: NetLog) => void;
  onEvent?: (e: SseEvent) => void;
  /** Overrides the request's own agent choice (the performance runner always uses the browser). */
  forceAgent?: "cloud" | "browser";
  /** Skip scripts (pm.sendRequest's own requests, flows' raw calls). */
  noScripts?: boolean;
  /** A mock server answered: add it to that mock's call log. */
  onMock?: (mockId: string, entry: Mock["log"][number]) => void;
};

export type ExecResult = { response: ResponseData; nextRequest?: string | null; skipped?: boolean };

const nonEmpty = (s: string | undefined) => !!s && s.trim().length > 0;

function sbFromItem(item: RequestItem): SbRequest {
  return {
    id: item.id,
    name: item.name,
    method: item.method,
    url: item.url,
    headers: item.headers.map((h) => ({ key: h.key, value: h.value, disabled: !h.enabled })),
    body:
      item.body.mode === "none"
        ? null
        : {
            mode: item.body.mode,
            raw: item.body.raw,
            urlencoded: item.body.urlencoded.map((f) => ({ key: f.key, value: f.value, disabled: !f.enabled })),
            formdata: item.body.formdata.map((f) => ({ key: f.key, value: f.value, disabled: !f.enabled, type: f.type ?? "text", src: f.file?.name })),
            graphql: item.body.graphql,
            options: { raw: { language: item.body.rawLang } },
          },
    auth: item.auth,
  };
}

/** Scripts may change the request (headers, URL, body): fold that back into the item. */
function itemFromSb(item: RequestItem, sb: SbRequest): RequestItem {
  const toKV = (rows: SbKV[] | undefined, old: KV[]): KV[] =>
    (rows ?? []).map((r) => {
      const prev = old.find((o) => o.key === r.key);
      return { ...(prev ?? kv()), key: r.key, value: r.value, enabled: !r.disabled };
    });
  let body: Body = item.body;
  if (sb.body) {
    body = {
      ...item.body,
      mode: (sb.body.mode as Body["mode"]) ?? item.body.mode,
      raw: sb.body.raw ?? item.body.raw,
      urlencoded: toKV(sb.body.urlencoded, item.body.urlencoded),
      formdata: (sb.body.formdata ?? []).map((r) => {
        const prev = item.body.formdata.find((o) => o.key === r.key);
        return { ...(prev ?? kv()), key: r.key, value: r.value, enabled: !r.disabled, type: (r.type as "text" | "file") ?? prev?.type ?? "text" };
      }),
    };
  }
  const { query } = splitUrl(sb.url);
  return { ...item, method: sb.method, url: sb.url, headers: toKV(sb.headers, item.headers), body, params: query === null ? [] : item.params };
}

const scopesOut = (s: Scopes): SbScopes => ({ globals: { ...s.globals }, collection: { ...s.collection }, environment: { ...s.environment }, data: { ...s.data }, local: { ...s.local }, vault: { ...s.vault } });
function scopesIn(target: Scopes, from: SbScopes) {
  target.globals = from.globals;
  target.collection = from.collection;
  target.environment = from.environment;
  target.local = from.local;
  target.vault = from.vault;
}

/** Hidden headers the tool adds on its own, shown greyed out in the Headers tab. */
export function autoHeaders(item: RequestItem, settings: AppSettings): { key: string; value: string; why: string }[] {
  const out: { key: string; value: string; why: string }[] = [];
  const has = (k: string) => item.headers.some((h) => h.enabled && h.key.toLowerCase() === k);
  if (settings.sendNoCache && !has("cache-control")) out.push({ key: "Cache-Control", value: "no-cache", why: "Settings → Send no-cache header" });
  if (settings.sendRequestId && !has("x-request-id")) out.push({ key: "X-Request-Id", value: "<calculated when sent>", why: "Settings → Send a request id" });
  const ct: Record<string, string> = { raw: `${{ json: "application/json", javascript: "application/javascript", html: "text/html", xml: "application/xml", text: "text/plain" }[item.body.rawLang]}`, urlencoded: "application/x-www-form-urlencoded", formdata: "multipart/form-data; boundary=<calculated when sent>", graphql: "application/json", binary: "<the file's type>" };
  if (item.body.mode !== "none" && ct[item.body.mode] && !has("content-type")) out.push({ key: "Content-Type", value: ct[item.body.mode], why: "From the body type" });
  if (item.body.mode !== "none") out.push({ key: "Content-Length", value: "<calculated when sent>", why: "Size of the body" });
  out.push({ key: "Host", value: "<calculated when sent>", why: "From the URL" });
  out.push({ key: "User-Agent", value: "DoWhatever-API-Client/1.0", why: "Cloud agent default" });
  out.push({ key: "Accept", value: "*/*", why: "Default when not set" });
  out.push({ key: "Accept-Encoding", value: "gzip, deflate, br", why: "Cloud agent default" });
  return out;
}

export async function execute(input: RequestItem, env: EngineEnv): Promise<ExecResult> {
  let item = input;
  const tests: TestResult[] = [];
  let nextRequest: string | null | undefined;
  let visualizer: ResponseData["visualizer"] = null;
  const location = [env.collection?.name ?? "", ...env.parents.map((f) => f.name), item.name].filter(Boolean);
  const info = (eventName: string) => ({ eventName, iteration: env.iteration, iterationCount: env.iterationCount, requestName: item.name, requestId: item.id });

  const runChain = async (event: "prerequest" | "test", sources: { code: string; label: string }[], response?: SbResponse, resolvedUrl = "") => {
    let sb = sbFromItem(item);
    for (const src of sources) {
      const ctx: SbContext = {
        event,
        info: info(event),
        request: sb,
        response,
        scopes: scopesOut(env.scopes),
        envName: env.envName,
        collectionName: env.collection?.name ?? "",
        cookies: env.cookies,
        location,
        vaultEnabled: env.settings.vaultInScripts,
        resolvedUrl: resolvedUrl || resolve(sb.url, env.scopes),
      };
      const res = await runScript(
        src.code,
        ctx,
        { onLog: (l) => env.log(l.level, l.text, `${src.label} · ${event === "prerequest" ? "pre-request" : "post-response"}`), sendRequest: (r) => sendFromScript(r, env) },
        env.settings.scriptTimeoutMs,
      );
      scopesIn(env.scopes, res.scopes);
      if (res.cookies !== env.cookies) env.setCookies(res.cookies);
      env.cookies = res.cookies;
      tests.push(...res.tests);
      if (res.nextRequest !== undefined) nextRequest = res.nextRequest;
      if (res.visualizer) visualizer = res.visualizer;
      if (res.error) {
        env.log("error", `${src.label} (${event === "prerequest" ? "pre-request" : "post-response"} script): ${res.error}`, src.label);
        tests.push({ name: `${src.label}: script error`, passed: false, error: res.error });
      }
      sb = res.request;
      if (event === "prerequest" && res.skipRequest) return { sb, skipped: true };
    }
    return { sb, skipped: false };
  };

  const scriptSources = (key: "prerequest" | "test") =>
    env.noScripts
      ? []
      : [
          ...(nonEmpty(env.collection?.scripts[key]) ? [{ code: env.collection!.scripts[key], label: env.collection!.name }] : []),
          ...env.parents.filter((f) => nonEmpty(f.scripts[key])).map((f) => ({ code: f.scripts[key], label: f.name })),
          ...(nonEmpty(item.scripts[key]) ? [{ code: item.scripts[key], label: item.name }] : []),
        ];

  // 1. Pre-request scripts.
  const pre = scriptSources("prerequest");
  const tPre0 = performance.now();
  if (pre.length) {
    const { sb, skipped } = await runChain("prerequest", pre);
    item = itemFromSb(item, sb);
    if (skipped) {
      env.log("info", `${item.name}: skipped by pm.execution.skipRequest()`);
      return { response: emptyResponse(item, "Skipped by pm.execution.skipRequest()", tests), nextRequest, skipped: true };
    }
  }
  const prerequestMs = performance.now() - tPre0;

  // 2. Variables, URL, headers, body, auth.
  let prepared: Prepared;
  try {
    prepared = await prepare(item, env);
  } catch (e) {
    const msg = (e as Error).message;
    env.log("error", `${item.name}: ${msg}`);
    return { response: emptyResponse(item, msg, tests), nextRequest };
  }

  const s = item.settings;
  const agentName = env.forceAgent ?? pickAgent(s.agent === "auto" ? env.settings.defaultAgent : s.agent, prepared.url);
  const useJar = !s.disableCookies && agentName === "cloud";
  if (useJar) {
    const jarCookies = cookiesFor(env.cookies, prepared.url);
    if (jarCookies.length) {
      const existing = header(prepared.headers, "cookie");
      prepared.headers = prepared.headers.filter(([k]) => k.toLowerCase() !== "cookie");
      prepared.headers.push(["Cookie", [existing, cookieHeader(jarCookies)].filter(Boolean).join("; ")]);
    }
  }

  // 3. Send (or answer from a mock).
  let result: AgentResult;
  const sent: SentRequest = { method: prepared.method, url: prepared.url, headers: prepared.headers, bodyPreview: preview(prepared.body), bodySize: prepared.body?.length ?? 0 };
  try {
    const mock = mockFor(prepared.url, env.mocks);
    if (mock) {
      if (mock.delayMs) await new Promise((r) => setTimeout(r, mock.delayMs));
      const ans = answerMock(mock, env.collections.find((c) => c.id === mock.collectionId), prepared, env.scopes.environment);
      result = {
        status: ans.status,
        statusText: ans.statusText,
        httpVersion: "HTTP/1.1",
        headers: ans.headers,
        body: ans.body,
        size: { body: ans.body.length, headers: ans.headers.reduce((n, [k, v]) => n + k.length + v.length + 4, 0) },
        truncated: false,
        timings: { total: mock.delayMs || 1 },
        sentHeaders: prepared.headers,
        agent: "cloud",
        warnings: [],
      };
      env.onMock?.(mock.id, { at: Date.now(), method: prepared.method, path: splitUrl(prepared.url).base.replace(/^https?:\/\/[^/]+/, "") || "/", status: ans.status, example: ans.example });
    } else {
      const opts = {
        agent: agentName,
        followRedirects: s.followRedirects && env.settings.followRedirects,
        followOriginalMethod: s.followOriginalMethod,
        followAuthHeader: s.followAuthHeader,
        maxRedirects: s.maxRedirects,
        strictSSL: s.strictSSL && env.settings.sslVerify,
        timeoutMs: s.timeoutMs || env.settings.timeoutMs,
        credentials: env.settings.browserCredentials,
        signal: env.signal,
        onEvent: env.onEvent,
      };
      result = await send(prepared, opts);
      // Digest: answer the server's challenge once.
      const { auth } = effectiveAuth(item, env.parents, env.collection);
      if (auth.type === "digest" && result.status === 401 && auth.params.disableRetry !== "true") {
        const ch = parseDigestChallenge(result.headers.filter(([k]) => k.toLowerCase() === "www-authenticate").map(([, v]) => v).find((v) => /^digest/i.test(v)) ?? "");
        if (ch) {
          const params = Object.fromEntries(Object.entries(auth.params).map(([k, v]) => [k, resolve(v, env.scopes)]));
          prepared.headers = prepared.headers.filter(([k]) => k.toLowerCase() !== "authorization");
          prepared.headers.push(["Authorization", digestHeader(prepared, params, ch)]);
          env.log("info", `${item.name}: answered the Digest challenge (realm "${ch.realm}")`);
          result = await send(prepared, opts);
        }
      }
    }
  } catch (e) {
    if ((e as Error).name === "AbortError") {
      env.log("warn", `${item.name}: cancelled`);
      return { response: emptyResponse(item, "Request cancelled.", tests, sent), nextRequest };
    }
    const msg = (e as Error).message;
    env.net({ method: sent.method, url: sent.url, error: msg, request: sent });
    return { response: emptyResponse(item, msg, tests, sent), nextRequest };
  }
  const warnings = [...unresolvedWarning(prepared), ...result.warnings];
  for (const w of warnings) env.log("warn", `${item.name}: ${w}`);

  if (useJar) {
    const incoming = result.headers
      .filter(([k]) => k.toLowerCase() === "set-cookie")
      .map(([, v]) => parseSetCookie(v, result.hops?.at(-1)?.url ?? prepared.url))
      .filter((c): c is Cookie => !!c);
    if (incoming.length) {
      env.cookies = storeCookies(env.cookies, incoming);
      env.setCookies(env.cookies);
    }
  }

  const bodyB64 = bytesToB64(result.body);
  const response: ResponseData = {
    status: result.status,
    statusText: result.statusText,
    httpVersion: result.httpVersion,
    headers: result.headers,
    bodyB64,
    size: result.size,
    truncated: result.truncated,
    timings: { ...result.timings, prerequest: prerequestMs },
    remote: result.remote,
    tls: result.tls,
    hops: result.hops,
    sent: { ...sent, headers: result.sentHeaders.length ? result.sentHeaders : sent.headers },
    agent: mockFor(prepared.url, env.mocks) ? "mock" : result.agent,
    tests,
    events: result.events,
    warnings: warnings.length ? warnings : undefined,
    streamCut: result.streamCut,
    at: Date.now(),
  };
  const bodyText = result.body.length < 200_000 ? td.decode(result.body) : `${td.decode(result.body.subarray(0, 200_000))}…`;
  env.net({ method: sent.method, url: sent.url, status: result.status, ms: result.timings.total, size: result.size.body, request: response.sent, response: { headers: result.headers, body: bodyText, status: result.status } });

  // 4. Post-response scripts.
  const post = scriptSources("test");
  if (post.length) {
    const tTest = performance.now();
    const sbRes: SbResponse = {
      code: result.status,
      status: result.statusText,
      headers: result.headers.map(([key, value]) => ({ key, value })),
      bodyB64,
      responseTime: Math.round(result.timings.total),
      responseSize: result.size.body,
    };
    await runChain("test", post, sbRes, prepared.url);
    response.timings.test = performance.now() - tTest;
  }
  response.tests = tests;
  response.visualizer = visualizer;
  return { response, nextRequest };
}

/** Variables, path variables, encoding, headers, body and auth: everything before the agent. */
export async function prepare(item: RequestItem, env: Pick<EngineEnv, "scopes" | "settings" | "parents" | "collection">): Promise<Prepared> {
  const r = (x: string) => resolve(x, env.scopes);
  const rawUrl = r(item.url).trim();
  if (!rawUrl) throw new Error("Enter a URL to send the request to.");
  let url = applyPathVars(rawUrl, item.pathVars.map((p) => ({ ...p, value: r(p.value) })));
  const unresolved = /\{\{([^{}]+)\}\}/.exec(url);
  if (unresolved && /^\{\{/.test(url)) throw new Error(`The variable {{${unresolved[1]}}} isn't defined, so the URL can't be built. Define it in an environment or the collection's variables.`);
  if (item.settings.encodeUrl) url = encodeUrl(url);
  url = withScheme(url);
  const trim = (s: string) => (env.settings.trimKeys ? s.trim() : s);
  const headers: [string, string][] = item.headers.filter((h) => h.enabled && h.key.trim()).map((h) => [trim(r(h.key)), trim(r(h.value))]);
  const built = await buildBody(item.body, item.method, r);
  if (item.body.mode === "graphql" && item.method.toUpperCase() === "GET") {
    const q = encodeURIComponent(r(item.body.graphql.query));
    const v = item.body.graphql.variables.trim() ? `&variables=${encodeURIComponent(r(item.body.graphql.variables))}` : "";
    url += `${url.includes("?") ? "&" : "?"}query=${q}${v}`;
  }
  if (built.contentType && !headers.some(([k]) => k.toLowerCase() === "content-type")) headers.push(["Content-Type", built.contentType]);
  const auto: string[] = [];
  if (env.settings.sendNoCache && !headers.some(([k]) => k.toLowerCase() === "cache-control")) {
    headers.push(["Cache-Control", "no-cache"]);
    auto.push("cache-control");
  }
  if (env.settings.sendRequestId && !headers.some(([k]) => k.toLowerCase() === "x-request-id")) {
    headers.push(["X-Request-Id", crypto.randomUUID()]);
    auto.push("x-request-id");
  }
  const p: Prepared = { method: item.method.toUpperCase(), url, headers, body: built.bytes, form: built.form, auto };
  const { auth } = effectiveAuth(item, env.parents, env.collection);
  const params = Object.fromEntries(Object.entries(auth.params).map(([k, v]) => [k, r(v)]));
  await applyAuth(p, { type: auth.type, params });
  return p;
}

/** {{names}} still in what was sent: they went out as literal text, which is almost never what was meant. */
function unresolvedWarning(p: Prepared): string[] {
  // The URL is percent-encoded by now ({{ → %7B%7B), so read it decoded.
  let url = p.url;
  try {
    url = decodeURI(p.url);
  } catch {
    /* a stray % sign: scan as it is */
  }
  const text = [url, ...p.headers.flat(), p.body && p.body.length < 2_000_000 ? td.decode(p.body) : ""].join("\n");
  const names = [...new Set([...text.matchAll(/\{\{([^{}$][^{}]*)\}\}/g)].map((m) => m[1].trim()))];
  if (!names.length) return [];
  const list = names.slice(0, 6).map((n) => `{{${n}}}`).join(", ");
  return [`${names.length === 1 ? "This variable isn't" : "These variables aren't"} defined, so ${names.length === 1 ? "it was" : "they were"} sent as plain text: ${list}. Set ${names.length === 1 ? "it" : "them"} in the active environment, the collection's variables or globals (the eye button shows what's available).`];
}

function preview(b: Uint8Array | null): string | undefined {
  if (!b || !b.length) return undefined;
  const slice = b.subarray(0, 20_000);
  const text = td.decode(slice);
  return /[\u0000-\u0008\u000e-\u001f]/.test(text.slice(0, 2000)) ? `<${b.length} bytes of binary data>` : text + (b.length > slice.length ? "…" : "");
}

function emptyResponse(item: RequestItem, error: string, tests: TestResult[], sent?: SentRequest): ResponseData {
  return {
    status: 0,
    statusText: "",
    httpVersion: "",
    headers: [],
    bodyB64: "",
    size: { body: 0, headers: 0 },
    truncated: false,
    timings: { total: 0 },
    sent: sent ?? { method: item.method, url: item.url, headers: [], bodySize: 0 },
    agent: "cloud",
    tests,
    at: Date.now(),
    error,
  };
}

/** pm.sendRequest: no scripts, the request's own auth only if given, the usual agents and mocks. */
async function sendFromScript(req: SbRequest, env: EngineEnv): Promise<SbResponse & { url: string }> {
  const body: Body = { mode: "none", raw: "", rawLang: "text", formdata: [], urlencoded: [], graphql: { query: "", variables: "" } };
  if (req.body) {
    body.mode = (req.body.mode as Body["mode"]) || "raw";
    body.raw = req.body.raw ?? "";
    body.rawLang = (req.body.options?.raw?.language as Body["rawLang"]) ?? (/^\s*[[{]/.test(body.raw) ? "json" : "text");
    body.urlencoded = (req.body.urlencoded ?? []).map((f) => kv(f.key, f.value, { enabled: !f.disabled }));
    body.formdata = (req.body.formdata ?? []).map((f) => kv(f.key, f.value, { enabled: !f.disabled }));
    if (req.body.graphql) body.graphql = req.body.graphql;
  }
  const item: RequestItem = {
    kind: "request",
    id: uid(),
    name: "pm.sendRequest",
    protocol: "http",
    method: req.method,
    url: req.url,
    params: [],
    pathVars: [],
    headers: req.headers.map((h) => kv(h.key, h.value, { enabled: !h.disabled })),
    auth: req.auth ? { type: req.auth.type as RequestItem["auth"]["type"], params: req.auth.params ?? {} } : { type: "noauth", params: {} },
    body,
    scripts: { prerequest: "", test: "" },
    settings: { followRedirects: true, followOriginalMethod: false, followAuthHeader: false, maxRedirects: 10, strictSSL: true, timeoutMs: 0, encodeUrl: true, disableCookies: false, agent: "auto" },
    description: "",
    examples: [],
  };
  const { response } = await execute(item, { ...env, parents: [], collection: null, noScripts: true });
  if (response.error) throw new Error(response.error);
  return {
    url: response.sent.url,
    code: response.status,
    status: response.statusText || STATUS_TEXT[response.status] || "",
    headers: response.headers.map(([key, value]) => ({ key, value })),
    bodyB64: response.bodyB64,
    responseTime: Math.round(response.timings.total),
    responseSize: response.size.body,
  };
}

/** A raw request (OAuth 2.0 token calls, introspection) sent with the agent the URL calls for. */
export async function sendRaw(p: Prepared, settings: AppSettings, signal?: AbortSignal): Promise<AgentResult> {
  return send(p, {
    agent: pickAgent(settings.defaultAgent, p.url),
    followRedirects: true,
    followOriginalMethod: false,
    followAuthHeader: false,
    maxRedirects: 10,
    strictSSL: settings.sslVerify,
    timeoutMs: settings.timeoutMs,
    credentials: false,
    signal,
  });
}

