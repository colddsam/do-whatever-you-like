import type { Auth, AuthType, Body, Collection, Environment, Example, Folder, KV, RawLang, RequestItem, Scripts, TreeNode, Variable } from "../types";
import { defaultAuth, defaultBody, defaultSettings, kv, newCollection, newFolder, newRequest, uid, variable } from "./util";
import { pathVarNames } from "./url";

/**
 * Postman's Collection v2.0/v2.1 and environment formats, both ways. The model is close to v2.1, so
 * a collection exported here opens in Postman, and one exported from Postman opens here with its
 * folders, auth, scripts, variables, saved examples and settings.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

const str = (v: unknown) => (v === undefined || v === null ? "" : typeof v === "string" ? v : typeof v === "object" ? JSON.stringify(v) : String(v));
const desc = (d: unknown) => (typeof d === "string" ? d : d && typeof d === "object" && "content" in (d as Any) ? str((d as Any).content) : "");
const exec = (e: unknown) => (Array.isArray(e) ? e.join("\n") : str(e));

function scriptsFrom(events: Any[] | undefined): Scripts {
  const out: Scripts = { prerequest: "", test: "" };
  for (const ev of events ?? []) {
    if (ev?.disabled) continue;
    if (ev?.listen === "prerequest") out.prerequest = exec(ev.script?.exec);
    if (ev?.listen === "test") out.test = exec(ev.script?.exec);
  }
  return out;
}

const scriptsTo = (s: Scripts) =>
  [
    ...(s.prerequest ? [{ listen: "prerequest", script: { type: "text/javascript", packages: {}, exec: s.prerequest.split("\n") } }] : []),
    ...(s.test ? [{ listen: "test", script: { type: "text/javascript", packages: {}, exec: s.test.split("\n") } }] : []),
  ];

const AUTH_RENAME_IN: Partial<Record<AuthType, Record<string, string>>> = {
  digest: { disableRetryRequest: "disableRetry" },
  hawk: { extraData: "ext", delegation: "dlg" },
  oauth2: { grant_type: "grantType", redirect_uri: "callbackUrl", client_authentication: "clientAuth", code_verifier: "codeVerifier" },
};

export function authFrom(a: Any): Auth {
  if (!a || !a.type) return defaultAuth("inherit");
  const type = a.type as AuthType;
  const raw = a[type];
  const params: Record<string, string> = {};
  if (Array.isArray(raw)) for (const p of raw) params[p.key] = str(p.value);
  else if (raw && typeof raw === "object") for (const [k, v] of Object.entries(raw)) params[k] = str(v);
  const rename = AUTH_RENAME_IN[type] ?? {};
  for (const [from, to] of Object.entries(rename)) if (from in params) {
    params[to] = params[from];
    delete params[from];
  }
  if (type === "oauth1" && "addParamsToHeader" in params) params.addParamsTo = params.addParamsToHeader === "true" ? "header" : "query";
  if (type === "awsv4" && params.addAuthDataToQuery === "true") params.addAuthDataTo = "query";
  if (type === "oauth2" && params.addTokenTo === "queryParams") params.addTokenTo = "query";
  if (type === "jwt" && params.addTokenTo === "queryParam") params.addTokenTo = "query";
  if (type === "oauth2" && params.grantType === "authorization_code_with_pkce") params.grantType = "authorization_code_with_pkce";
  return { type, params };
}

export function authTo(a: Auth): Any {
  if (a.type === "inherit") return undefined;
  if (a.type === "noauth") return { type: "noauth" };
  const params = { ...a.params };
  delete params.tokens;
  const rename = AUTH_RENAME_IN[a.type] ?? {};
  for (const [to, from] of Object.entries(rename)) if (from in params) {
    params[to] = params[from];
    delete params[from];
  }
  if (a.type === "oauth1" && params.addParamsTo) params.addParamsToHeader = String(params.addParamsTo === "header");
  if (a.type === "awsv4") params.addAuthDataToQuery = String(params.addAuthDataTo === "query");
  if (a.type === "oauth2" && params.addTokenTo === "query") params.addTokenTo = "queryParams";
  if (a.type === "jwt" && params.addTokenTo === "query") params.addTokenTo = "queryParam";
  return { type: a.type, [a.type]: Object.entries(params).map(([key, value]) => ({ key, value: value === "true" ? true : value === "false" ? false : value, type: "string" })) };
}

const kvFrom = (rows: Any[] | undefined): KV[] =>
  (rows ?? []).filter((r) => r && (r.key !== undefined || r.value !== undefined)).map((r) => kv(str(r.key), str(r.value), { enabled: !r.disabled, description: desc(r.description) }));
const kvTo = (rows: KV[]) => rows.filter((r) => r.key || r.value).map((r) => ({ key: r.key, value: r.value, ...(r.description ? { description: r.description } : {}), ...(r.enabled ? {} : { disabled: true }) }));

function urlFrom(u: Any): { url: string; params: KV[]; pathVars: KV[] } {
  if (!u) return { url: "", params: [], pathVars: [] };
  if (typeof u === "string") return { url: u, params: [], pathVars: [] };
  let raw = str(u.raw);
  if (!raw) {
    const host = Array.isArray(u.host) ? u.host.join(".") : str(u.host);
    const path = Array.isArray(u.path) ? u.path.map((p: Any) => (typeof p === "string" ? p : str(p.value))).join("/") : str(u.path);
    raw = `${u.protocol ? `${u.protocol}://` : ""}${host}${u.port ? `:${u.port}` : ""}${path ? `/${path}` : ""}`;
    const q = (u.query ?? []).filter((x: Any) => !x.disabled);
    if (q.length) raw += `?${q.map((x: Any) => (x.value === null || x.value === undefined ? str(x.key) : `${str(x.key)}=${str(x.value)}`)).join("&")}`;
  }
  return { url: raw, params: kvFrom(u.query), pathVars: kvFrom(u.variable) };
}

function urlTo(item: RequestItem): Any {
  const raw = item.url;
  const m = /^(?:([a-z][\w+.-]*):\/\/)?([^/?#]*)([^?#]*)/i.exec(raw);
  const hostPort = m?.[2] ?? "";
  const [host, port] = hostPort.startsWith("{{") ? [hostPort, undefined] : hostPort.split(":");
  return {
    raw,
    ...(m?.[1] ? { protocol: m[1] } : {}),
    host: host ? (host.startsWith("{{") ? [host] : host.split(".")) : [],
    ...(port ? { port } : {}),
    path: (m?.[3] ?? "").split("/").filter(Boolean),
    ...(item.params.length ? { query: kvTo(item.params) } : {}),
    ...(item.pathVars.length ? { variable: item.pathVars.map((v) => ({ key: v.key, value: v.value, ...(v.description ? { description: v.description } : {}) })) } : {}),
  };
}

function bodyFrom(b: Any): Body {
  const body = defaultBody();
  if (!b || !b.mode || b.disabled) return body;
  body.mode = b.mode === "file" ? "binary" : (b.mode as Body["mode"]);
  if (b.mode === "raw") {
    body.raw = str(b.raw);
    const lang = b.options?.raw?.language as RawLang | undefined;
    body.rawLang = lang && ["text", "json", "javascript", "html", "xml"].includes(lang) ? lang : /^\s*[[{]/.test(body.raw) ? "json" : "text";
  } else if (b.mode === "urlencoded") body.urlencoded = kvFrom(b.urlencoded);
  else if (b.mode === "formdata")
    body.formdata = (b.formdata ?? []).map((f: Any) => kv(str(f.key), f.type === "file" ? "" : str(f.value), { enabled: !f.disabled, type: f.type === "file" ? "file" : "text", contentType: f.contentType, description: desc(f.description) }));
  else if (b.mode === "graphql") body.graphql = { query: str(b.graphql?.query), variables: str(b.graphql?.variables) };
  else if (!["none", "binary", "file"].includes(b.mode)) body.mode = "none";
  return body;
}

function bodyTo(b: Body): Any {
  switch (b.mode) {
    case "none":
      return undefined;
    case "raw":
      return { mode: "raw", raw: b.raw, options: { raw: { language: b.rawLang } } };
    case "urlencoded":
      return { mode: "urlencoded", urlencoded: kvTo(b.urlencoded) };
    case "formdata":
      return { mode: "formdata", formdata: b.formdata.filter((f) => f.key).map((f) => ({ key: f.key, ...(f.type === "file" ? { type: "file", src: f.file?.name ?? "" } : { value: f.value, type: "text" }), ...(f.enabled ? {} : { disabled: true }), ...(f.contentType ? { contentType: f.contentType } : {}) })) };
    case "binary":
      return { mode: "file", file: { src: b.binary?.name ?? "" } };
    case "graphql":
      return { mode: "graphql", graphql: { query: b.graphql.query, variables: b.graphql.variables } };
  }
}

function requestFrom(it: Any): RequestItem {
  const r = typeof it.request === "string" ? { url: it.request, method: "GET" } : (it.request ?? {});
  const { url, params, pathVars } = urlFrom(r.url);
  const behavior = it.protocolProfileBehavior ?? {};
  const names = pathVarNames(url);
  const req = newRequest({
    name: str(it.name) || url || "Request",
    method: str(r.method || "GET").toUpperCase(),
    url,
    params,
    pathVars: names.map((n) => pathVars.find((p) => p.key === n) ?? kv(n, "")),
    headers: kvFrom(Array.isArray(r.header) ? r.header : typeof r.header === "string" ? r.header.split("\n").filter(Boolean).map((l: string) => ({ key: l.split(":")[0], value: l.split(":").slice(1).join(":").trim() })) : []),
    auth: r.auth ? authFrom(r.auth) : defaultAuth("inherit"),
    body: bodyFrom(r.body),
    scripts: scriptsFrom(it.event),
    description: desc(r.description) || desc(it.description),
    settings: {
      ...defaultSettings(),
      ...(behavior.followRedirects === false ? { followRedirects: false } : {}),
      ...(behavior.followOriginalHttpMethod ? { followOriginalMethod: true } : {}),
      ...(behavior.followAuthorizationHeader ? { followAuthHeader: true } : {}),
      ...(behavior.strictSSL === false ? { strictSSL: false } : {}),
      ...(behavior.disableUrlEncoding ? { encodeUrl: false } : {}),
      ...(behavior.disableCookies ? { disableCookies: true } : {}),
      ...(typeof behavior.maxRedirects === "number" ? { maxRedirects: behavior.maxRedirects } : {}),
    },
  });
  if (r.body?.mode === "graphql") req.protocol = "graphql";
  req.examples = (it.response ?? []).map((res: Any): Example => {
    const orig = res.originalRequest ?? {};
    const ou = urlFrom(orig.url);
    const lang = (res._postman_previewlanguage as RawLang) ?? "json";
    return {
      id: uid(),
      name: str(res.name) || `${res.code ?? ""} example`,
      request: { method: str(orig.method || req.method), url: ou.url || req.url, headers: kvFrom(orig.header), body: orig.body?.raw },
      status: Number(res.code) || 200,
      statusText: str(res.status) || "OK",
      headers: kvFrom(res.header),
      body: str(res.body),
      lang: ["json", "xml", "html", "javascript", "text"].includes(lang) ? lang : "text",
    };
  });
  return req;
}

function nodeFrom(it: Any): TreeNode {
  if (Array.isArray(it.item)) {
    const f: Folder = { ...newFolder(str(it.name) || "Folder"), description: desc(it.description), auth: it.auth ? authFrom(it.auth) : defaultAuth("inherit"), scripts: scriptsFrom(it.event) };
    f.items = it.item.map(nodeFrom);
    return f;
  }
  return requestFrom(it);
}

const varsFrom = (rows: Any[] | undefined): Variable[] =>
  (rows ?? []).filter((v) => v && v.key).map((v) => variable(str(v.key), str(v.value), { type: v.type === "secret" ? "secret" : "default", enabled: v.disabled !== true && v.enabled !== false, description: desc(v.description) }));

export function isPostmanCollection(j: Any): boolean {
  return !!j && typeof j === "object" && !!j.info && Array.isArray(j.item) && /schema\.getpostman\.com|collection/.test(str(j.info.schema) + "collection");
}

export function collectionFromPostman(j: Any): Collection {
  const c = newCollection(str(j.info?.name) || "Imported collection");
  c.description = desc(j.info?.description);
  c.auth = j.auth ? authFrom(j.auth) : defaultAuth("noauth");
  if (c.auth.type === "inherit") c.auth = defaultAuth("noauth");
  c.scripts = scriptsFrom(j.event);
  c.variables = varsFrom(j.variable);
  c.items = (j.item ?? []).map(nodeFrom);
  return c;
}

/** Postman Collection v1 (the old flat format with folders listing request ids). */
export function collectionFromV1(j: Any): Collection {
  const c = newCollection(str(j.name) || "Imported collection");
  c.description = str(j.description);
  const reqs = new Map<string, RequestItem>();
  for (const r of j.requests ?? []) {
    const req = newRequest({
      name: str(r.name) || str(r.url),
      method: str(r.method || "GET"),
      url: str(r.url),
      headers: str(r.headers)
        .split("\n")
        .filter(Boolean)
        .map((l: string) => kv(l.split(":")[0].trim(), l.split(":").slice(1).join(":").trim())),
      description: str(r.description),
      scripts: { prerequest: str(r.preRequestScript), test: str(r.tests) },
    });
    if (r.dataMode === "raw" && r.rawModeData) req.body = { ...defaultBody(), mode: "raw", raw: str(r.rawModeData), rawLang: /^\s*[[{]/.test(str(r.rawModeData)) ? "json" : "text" };
    if (r.dataMode === "urlencoded") req.body = { ...defaultBody(), mode: "urlencoded", urlencoded: kvFrom(r.data) };
    if (r.dataMode === "params") req.body = { ...defaultBody(), mode: "formdata", formdata: kvFrom(r.data) };
    reqs.set(r.id, req);
  }
  const used = new Set<string>();
  for (const f of j.folders ?? []) {
    const folder = newFolder(str(f.name));
    folder.items = (f.order ?? []).map((id: string) => (used.add(id), reqs.get(id))).filter(Boolean) as RequestItem[];
    c.items.push(folder);
  }
  for (const id of j.order ?? []) if (reqs.has(id) && !used.has(id)) c.items.push(reqs.get(id)!);
  for (const [id, r] of reqs) if (!used.has(id) && !(j.order ?? []).includes(id)) c.items.push(r);
  return c;
}

export function environmentFromPostman(j: Any): Environment {
  return { id: uid(), name: str(j.name) || "Imported environment", values: varsFrom(j.values) };
}

/* ------------------------------------------------------------------ export */

function nodeTo(n: TreeNode): Any {
  if (n.kind === "folder") return { name: n.name, ...(n.description ? { description: n.description } : {}), item: n.items.map(nodeTo), ...(authTo(n.auth) ? { auth: authTo(n.auth) } : {}), ...(scriptsTo(n.scripts).length ? { event: scriptsTo(n.scripts) } : {}) };
  const s = n.settings;
  const behavior: Any = {};
  if (!s.followRedirects) behavior.followRedirects = false;
  if (s.followOriginalMethod) behavior.followOriginalHttpMethod = true;
  if (s.followAuthHeader) behavior.followAuthorizationHeader = true;
  if (!s.strictSSL) behavior.strictSSL = false;
  if (!s.encodeUrl) behavior.disableUrlEncoding = true;
  if (s.disableCookies) behavior.disableCookies = true;
  if (s.maxRedirects !== 10) behavior.maxRedirects = s.maxRedirects;
  return {
    name: n.name,
    ...(scriptsTo(n.scripts).length ? { event: scriptsTo(n.scripts) } : {}),
    ...(Object.keys(behavior).length ? { protocolProfileBehavior: behavior } : {}),
    request: {
      ...(authTo(n.auth) ? { auth: authTo(n.auth) } : {}),
      method: n.method,
      header: kvTo(n.headers),
      ...(bodyTo(n.body) ? { body: bodyTo(n.body) } : {}),
      url: urlTo(n),
      ...(n.description ? { description: n.description } : {}),
    },
    response: n.examples.map((e) => ({
      name: e.name,
      originalRequest: { method: e.request.method, header: kvTo(e.request.headers), ...(e.request.body ? { body: { mode: "raw", raw: e.request.body } } : {}), url: { raw: e.request.url } },
      status: e.statusText,
      code: e.status,
      _postman_previewlanguage: e.lang,
      header: kvTo(e.headers),
      cookie: [],
      body: e.body,
    })),
  };
}

const varsTo = (vars: Variable[], current = false) =>
  vars.map((v) => ({ key: v.key, value: current ? (v.current ?? v.value) : v.value, type: v.type, ...(v.enabled ? {} : { disabled: true }), ...(v.description ? { description: v.description } : {}) }));

export function collectionToPostman(c: Collection): Any {
  return {
    info: { _postman_id: c.id, name: c.name, description: c.description, schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
    item: c.items.map(nodeTo),
    ...(authTo(c.auth) && c.auth.type !== "noauth" ? { auth: authTo(c.auth) } : {}),
    ...(scriptsTo(c.scripts).length ? { event: scriptsTo(c.scripts) } : {}),
    ...(c.variables.length ? { variable: varsTo(c.variables) } : {}),
  };
}

export function environmentToPostman(e: Environment, withCurrent = false): Any {
  return { id: e.id, name: e.name, values: varsTo(e.values, withCurrent).map((v) => ({ ...v, enabled: !("disabled" in v) })), _postman_variable_scope: "environment", _postman_exported_using: "DoWhatever API client" };
}

export function globalsToPostman(vars: Variable[]): Any {
  return { id: uid(), name: "Globals", values: varsTo(vars).map((v) => ({ ...v, enabled: !("disabled" in v) })), _postman_variable_scope: "globals" };
}
