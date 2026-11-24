import * as yaml from "js-yaml";
import type { Auth, Body, Collection, Environment, Example, Folder, KV, RequestItem, Workspace } from "../types";
import { collectionFromPostman, collectionFromV1, environmentFromPostman, isPostmanCollection } from "./postman-format";
import { defaultAuth, defaultBody, kv, newCollection, newFolder, newRequest, uid, variable } from "./util";
import { paramsFromUrl, pathVarsFromUrl } from "./url";

/**
 * Everything the Import dialog understands, detected from the content itself:
 * Postman collections (v1, v2.0, v2.1), environments and data dumps; OpenAPI 3.x and Swagger 2.0
 * (JSON or YAML); HAR files; Insomnia exports; cURL commands (bash or Windows cmd); and this
 * tool's own workspace backups.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

export type ImportResult = { collections: Collection[]; environments: Environment[]; requests: RequestItem[]; workspace?: Partial<Workspace>; kind: string };

export function importText(text: string, filename = ""): ImportResult {
  const t = text.trim().replace(/^\uFEFF/, "");
  if (!t) throw new Error("There's nothing to import.");
  if (/^curl(\.exe)?\s/i.test(t)) return { collections: [], environments: [], requests: [requestFromCurl(t)], kind: "cURL command" };
  let data: Any;
  try {
    data = JSON.parse(t);
  } catch {
    try {
      data = yaml.load(t);
    } catch {
      throw new Error(`${filename || "This"} isn't JSON, YAML or a cURL command that I can read.`);
    }
  }
  if (!data || typeof data !== "object") throw new Error("This doesn't look like an API collection, spec or environment.");

  if (data.__dwyl_api_workspace) return { collections: data.collections ?? [], environments: data.environments ?? [], requests: [], workspace: data, kind: "Workspace backup" };
  if (data.openapi || data.swagger) return { collections: [fromOpenApi(data)], environments: [], requests: [], kind: data.openapi ? `OpenAPI ${data.openapi}` : `Swagger ${data.swagger}` };
  if (isPostmanCollection(data)) return { collections: [collectionFromPostman(data)], environments: [], requests: [], kind: "Postman collection" };
  if (data.collection && isPostmanCollection(data.collection)) return { collections: [collectionFromPostman(data.collection)], environments: [], requests: [], kind: "Postman collection" };
  if (Array.isArray(data.requests) && (data.order || data.folders)) return { collections: [collectionFromV1(data)], environments: [], requests: [], kind: "Postman collection v1" };
  if (Array.isArray(data.values) && (data._postman_variable_scope || data.name)) return { collections: [], environments: [environmentFromPostman(data)], requests: [], kind: "Postman environment" };
  if (Array.isArray(data.collections) || Array.isArray(data.environments))
    return {
      collections: (data.collections ?? []).map((c: Any) => (isPostmanCollection(c) ? collectionFromPostman(c) : collectionFromV1(c))),
      environments: (data.environments ?? []).map(environmentFromPostman),
      requests: [],
      kind: "Postman data dump",
    };
  if (data.log?.entries) return { collections: [fromHar(data)], environments: [], requests: [], kind: "HAR file" };
  if (data._type === "export" && Array.isArray(data.resources)) return fromInsomnia(data);
  throw new Error("This JSON isn't a format I know: Postman, OpenAPI, Swagger, HAR, Insomnia or a backup.");
}

/* ------------------------------------------------------------------ cURL */

/** Splits a shell command into words (quotes, escapes, bash \ and cmd ^ line continuations, $'…'). */
export function shellWords(cmd: string): string[] {
  let s = cmd.replace(/\\\r?\n/g, " ").replace(/\^\r?\n/g, " ");
  // Windows "Copy as cURL (cmd)": ^X is an escaped X; once unescaped, the text quotes like bash.
  if (/\^"/.test(s)) s = s.replace(/\^(.)/g, "$1");
  const out: string[] = [];
  let cur = "";
  let has = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (/\s/.test(c)) {
      if (has) out.push(cur);
      cur = "";
      has = false;
    } else if (c === "$" && s[i + 1] === "'") {
      i += 2;
      for (; i < s.length && s[i] !== "'"; i++) {
        if (s[i] === "\\" && i + 1 < s.length) {
          const n = s[++i];
          cur += n === "n" ? "\n" : n === "t" ? "\t" : n === "r" ? "\r" : n === "x" ? String.fromCharCode(parseInt(s.slice(i + 1, i + 3), 16)) + ((i += 2), "") : n;
        } else cur += s[i];
      }
      has = true;
    } else if (c === "'") {
      for (i++; i < s.length && s[i] !== "'"; i++) cur += s[i];
      has = true;
    } else if (c === '"') {
      for (i++; i < s.length && s[i] !== '"'; i++) {
        if (s[i] === "\\" && /["\\$`]/.test(s[i + 1] ?? "")) cur += s[++i];
        else cur += s[i];
      }
      has = true;
    } else if (c === "\\" && i + 1 < s.length) {
      cur += s[++i];
      has = true;
    } else {
      cur += c;
      has = true;
    }
  }
  if (has) out.push(cur);
  return out;
}

export function requestFromCurl(cmd: string): RequestItem {
  const words = shellWords(cmd.trim());
  if (!/^curl(\.exe)?$/i.test(words[0] ?? "")) throw new Error("A cURL command starts with curl.");
  let method = "";
  let url = "";
  const headers: KV[] = [];
  const data: string[] = [];
  const urlencoded: KV[] = [];
  const form: KV[] = [];
  let user = "";
  let getMode = false;
  let head = false;
  let json = false;
  let bearer = "";
  let binary = false;
  const takesValue = new Set(["-o", "--output", "-w", "--write-out", "--connect-timeout", "-m", "--max-time", "--retry", "-x", "--proxy", "--cacert", "--cert", "--key", "-E", "-r", "--range", "--max-redirs", "-T", "--upload-file", "--resolve", "-c", "--cookie-jar"]);
  for (let i = 1; i < words.length; i++) {
    let w = words[i];
    let val: string | undefined;
    const eq = w.startsWith("--") ? w.indexOf("=") : -1;
    if (eq > 0) {
      val = w.slice(eq + 1);
      w = w.slice(0, eq);
    }
    const next = () => val ?? words[++i] ?? "";
    // Short options may be glued to their value: -XPOST, -HAccept:x.
    if (/^-[XHdFAubeo]./.test(w) && !w.startsWith("--")) {
      val = w.slice(2);
      w = w.slice(0, 2);
    }
    switch (w) {
      case "-X":
      case "--request":
        method = next().toUpperCase();
        break;
      case "-H":
      case "--header": {
        const h = next();
        const c = h.indexOf(":");
        if (c > 0) headers.push(kv(h.slice(0, c).trim(), h.slice(c + 1).trim()));
        else if (h.endsWith(";")) headers.push(kv(h.slice(0, -1).trim(), ""));
        break;
      }
      case "-d":
      case "--data":
      case "--data-raw":
      case "--data-ascii":
        data.push(next());
        break;
      case "--data-binary":
        binary = true;
        data.push(next());
        break;
      case "--json":
        json = true;
        data.push(next());
        break;
      case "--data-urlencode": {
        const v = next();
        const e = v.indexOf("=");
        if (e > 0) urlencoded.push(kv(v.slice(0, e), v.slice(e + 1)));
        else urlencoded.push(kv(v, ""));
        break;
      }
      case "-F":
      case "--form":
      case "--form-string": {
        const v = next();
        const e = v.indexOf("=");
        const k = v.slice(0, e);
        const value = v.slice(e + 1);
        if (w !== "--form-string" && value.startsWith("@")) form.push(kv(k, "", { type: "file", description: `File: ${value.slice(1).replace(/;.*$/, "").replace(/^"|"$/g, "")}` }));
        else form.push(kv(k, value.replace(/^"|"$/g, "")));
        break;
      }
      case "-u":
      case "--user":
        user = next();
        break;
      case "-A":
      case "--user-agent":
        headers.push(kv("User-Agent", next()));
        break;
      case "-e":
      case "--referer":
        headers.push(kv("Referer", next()));
        break;
      case "-b":
      case "--cookie":
        headers.push(kv("Cookie", next()));
        break;
      case "--oauth2-bearer":
        bearer = next();
        break;
      case "-G":
      case "--get":
        getMode = true;
        break;
      case "-I":
      case "--head":
        head = true;
        break;
      case "--url":
        url = next();
        break;
      default:
        if (takesValue.has(w)) next();
        else if (!w.startsWith("-") && !url) url = w;
    }
  }
  if (!url) throw new Error("This cURL command has no URL.");
  const req = newRequest({ name: url.replace(/^https?:\/\//, "").split("?")[0].slice(0, 80), url });
  const hasHeader = (k: string) => headers.some((h) => h.key.toLowerCase() === k.toLowerCase());
  if (json) {
    if (!hasHeader("content-type")) headers.push(kv("Content-Type", "application/json"));
    if (!hasHeader("accept")) headers.push(kv("Accept", "application/json"));
  }
  let body: Body = defaultBody();
  if (getMode && data.length) {
    req.url += (req.url.includes("?") ? "&" : "?") + data.join("&");
  } else if (form.length) body = { ...body, mode: "formdata", formdata: form };
  else if (urlencoded.length && !data.length) body = { ...body, mode: "urlencoded", urlencoded };
  else if (data.length) {
    const text = [...data, ...urlencoded.map((u) => `${u.key}=${encodeURIComponent(u.value)}`)].join("&");
    const ct = headers.find((h) => h.key.toLowerCase() === "content-type")?.value ?? "";
    if (/x-www-form-urlencoded/.test(ct) || (!ct && !binary && /^[^{[<\s][^=]*=/.test(text) && !/^\s*[[{]/.test(text))) {
      body = { ...body, mode: "urlencoded", urlencoded: text.split("&").map((p) => kv(decodeURIComponent(p.split("=")[0].replace(/\+/g, " ")), decodeURIComponent((p.split("=").slice(1).join("=") ?? "").replace(/\+/g, " ")))) };
      if (!ct) headers.push(kv("Content-Type", "application/x-www-form-urlencoded"));
    } else body = { ...body, mode: "raw", raw: data.join(""), rawLang: /json/.test(ct) || /^\s*[[{]/.test(data.join("")) ? "json" : /xml/.test(ct) ? "xml" : /html/.test(ct) ? "html" : "text" };
  }
  req.method = method || (head ? "HEAD" : body.mode !== "none" ? "POST" : "GET");
  req.headers = headers;
  req.body = body;
  if (user) {
    const c = user.indexOf(":");
    req.auth = { type: "basic", params: { username: c < 0 ? user : user.slice(0, c), password: c < 0 ? "" : user.slice(c + 1) } };
  } else if (bearer) req.auth = { type: "bearer", params: { token: bearer } };
  else req.auth = defaultAuth("noauth");
  const authH = headers.find((h) => h.key.toLowerCase() === "authorization");
  if (authH && /^bearer\s+/i.test(authH.value)) {
    req.auth = { type: "bearer", params: { token: authH.value.replace(/^bearer\s+/i, "") } };
    req.headers = headers.filter((h) => h !== authH);
  }
  req.params = paramsFromUrl(req.url, []);
  req.pathVars = pathVarsFromUrl(req.url, []);
  return req;
}

/* ------------------------------------------------------------------ OpenAPI 3 / Swagger 2 */

function deref(root: Any, node: Any, seen = new Set<string>()): Any {
  if (!node || typeof node !== "object") return node;
  if (typeof node.$ref === "string" && node.$ref.startsWith("#/")) {
    if (seen.has(node.$ref)) return {};
    const path = node.$ref.slice(2).split("/").map((p: string) => p.replace(/~1/g, "/").replace(/~0/g, "~"));
    let cur = root;
    for (const p of path) cur = cur?.[p];
    return deref(root, cur, new Set([...seen, node.$ref]));
  }
  return node;
}

/** An example value from a JSON schema (examples, defaults and enums first). */
export function exampleFromSchema(root: Any, schema: Any, depth = 0, seen = new Set<string>()): unknown {
  if (!schema || depth > 8) return null;
  if (schema.$ref) {
    if (seen.has(schema.$ref)) return {};
    return exampleFromSchema(root, deref(root, schema), depth + 1, new Set([...seen, schema.$ref]));
  }
  if (schema.example !== undefined) return schema.example;
  if (Array.isArray(schema.examples) && schema.examples.length) return schema.examples[0];
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  if (schema.const !== undefined) return schema.const;
  if (schema.allOf) return Object.assign({}, ...schema.allOf.map((s: Any) => exampleFromSchema(root, s, depth + 1, seen) ?? {}));
  if (schema.oneOf || schema.anyOf) return exampleFromSchema(root, (schema.oneOf ?? schema.anyOf)[0], depth + 1, seen);
  const type = Array.isArray(schema.type) ? schema.type.find((t: string) => t !== "null") : schema.type;
  if (type === "object" || schema.properties) {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(schema.properties ?? {})) o[k] = exampleFromSchema(root, v, depth + 1, seen);
    if (!schema.properties && schema.additionalProperties && typeof schema.additionalProperties === "object") o.key = exampleFromSchema(root, schema.additionalProperties, depth + 1, seen);
    return o;
  }
  if (type === "array") return [exampleFromSchema(root, schema.items ?? {}, depth + 1, seen)];
  if (type === "integer") return schema.minimum ?? 0;
  if (type === "number") return schema.minimum ?? 0.0;
  if (type === "boolean") return true;
  if (type === "string") {
    const f = schema.format;
    if (f === "date-time") return new Date(0).toISOString();
    if (f === "date") return "2024-01-01";
    if (f === "email") return "user@example.com";
    if (f === "uuid") return "3fa85f64-5717-4562-b3fc-2c963f66afa6";
    if (f === "uri" || f === "url") return "https://example.com";
    if (f === "binary") return "<binary>";
    return "string";
  }
  return null;
}

const toPostmanPath = (p: string) => p.replace(/\{([^}]+)\}/g, ":$1");

function fromOpenApi(spec: Any): Collection {
  const isV2 = !!spec.swagger;
  const c = newCollection(String(spec.info?.title ?? "API"));
  c.description = [spec.info?.description, spec.info?.version ? `Version ${spec.info.version}` : ""].filter(Boolean).join("\n\n");
  let base = "";
  if (isV2) base = `${(spec.schemes ?? ["https"])[0]}://${spec.host ?? "localhost"}${spec.basePath ?? ""}`;
  else {
    const srv = spec.servers?.[0];
    base = srv?.url ?? "/";
    for (const [k, v] of Object.entries((srv?.variables ?? {}) as Record<string, Any>)) base = base.replace(`{${k}}`, String(v.default ?? ""));
  }
  c.variables = [variable("baseUrl", base.replace(/\/$/, ""))];
  // Security schemes → collection auth (the first global requirement that maps).
  const schemes = (isV2 ? spec.securityDefinitions : spec.components?.securitySchemes) ?? {};
  const authFor = (reqs: Any[] | undefined): Auth | null => {
    for (const r of reqs ?? []) {
      for (const name of Object.keys(r ?? {})) {
        const s = deref(spec, schemes[name]);
        if (!s) continue;
        if (s.type === "apiKey") {
          c.variables.push(variable("apiKey", "", { type: "secret" }));
          return { type: "apikey", params: { key: s.name, value: "{{apiKey}}", in: s.in === "query" ? "query" : "header" } };
        }
        if ((s.type === "http" && s.scheme?.toLowerCase() === "basic") || s.type === "basic") return { type: "basic", params: { username: "{{username}}", password: "{{password}}" } };
        if (s.type === "http" && s.scheme?.toLowerCase() === "bearer") {
          c.variables.push(variable("bearerToken", "", { type: "secret" }));
          return { type: "bearer", params: { token: "{{bearerToken}}" } };
        }
        if (s.type === "oauth2") {
          const flows = s.flows ?? {};
          const flow = flows.authorizationCode ?? flows.clientCredentials ?? flows.password ?? flows.implicit ?? s;
          const grant = flows.authorizationCode || s.flow === "accessCode" ? "authorization_code" : flows.clientCredentials || s.flow === "application" ? "client_credentials" : flows.password || s.flow === "password" ? "password_credentials" : "implicit";
          return { type: "oauth2", params: { grantType: grant, authUrl: flow.authorizationUrl ?? "", accessTokenUrl: flow.tokenUrl ?? "", scope: Object.keys(flow.scopes ?? {}).join(" "), headerPrefix: "Bearer", addTokenTo: "header" } };
        }
      }
    }
    return null;
  };
  c.auth = authFor(spec.security) ?? defaultAuth("noauth");
  const folders = new Map<string, Folder>();
  const tagDesc = new Map<string, string>((spec.tags ?? []).map((t: Any) => [t.name, t.description ?? ""]));
  for (const [path, pathItem] of Object.entries((spec.paths ?? {}) as Record<string, Any>)) {
    const pi = deref(spec, pathItem);
    for (const method of ["get", "put", "post", "delete", "options", "head", "patch", "trace"]) {
      const op = pi?.[method];
      if (!op) continue;
      const params: Any[] = [...(pi.parameters ?? []), ...(op.parameters ?? [])].map((p: Any) => deref(spec, p));
      const url = `{{baseUrl}}${toPostmanPath(path)}`;
      const req = newRequest({ name: op.summary || op.operationId || `${method.toUpperCase()} ${path}`, method: method.toUpperCase(), url, description: [op.description, op.deprecated ? "**Deprecated.**" : ""].filter(Boolean).join("\n\n") });
      const ex = (p: Any) => String(p.example ?? p.schema?.example ?? p.default ?? p.schema?.default ?? (p.schema?.enum ?? p.enum)?.[0] ?? "");
      const query = params.filter((p) => p.in === "query").map((p) => kv(p.name, ex(p) || `<${p.schema?.type ?? p.type ?? "string"}>`, { description: p.description, enabled: !!p.required }));
      req.params = query;
      const enabledQ = query.filter((q) => q.enabled);
      if (enabledQ.length) req.url += `?${enabledQ.map((q) => `${q.key}=${q.value}`).join("&")}`;
      req.pathVars = pathVarsFromUrl(req.url, params.filter((p) => p.in === "path").map((p) => kv(p.name, ex(p), { description: p.description })));
      req.headers = params.filter((p) => p.in === "header").map((p) => kv(p.name, ex(p), { description: p.description }));
      // Body.
      if (isV2) {
        const bodyParam = params.find((p) => p.in === "body");
        const formParams = params.filter((p) => p.in === "formData");
        if (bodyParam) {
          req.body = { ...defaultBody(), mode: "raw", rawLang: "json", raw: JSON.stringify(exampleFromSchema(spec, bodyParam.schema), null, 2) };
          req.headers.push(kv("Content-Type", "application/json"));
        } else if (formParams.length) {
          const multipart = (op.consumes ?? spec.consumes ?? []).includes("multipart/form-data") || formParams.some((p) => p.type === "file");
          const rows = formParams.map((p) => kv(p.name, p.type === "file" ? "" : ex(p), { type: p.type === "file" ? "file" : "text", description: p.description }));
          req.body = multipart ? { ...defaultBody(), mode: "formdata", formdata: rows } : { ...defaultBody(), mode: "urlencoded", urlencoded: rows };
        }
      } else if (op.requestBody) {
        const rb = deref(spec, op.requestBody);
        const content = rb.content ?? {};
        const type = Object.keys(content).find((t) => /json/.test(t)) ?? Object.keys(content)[0];
        const media = content[type] ?? {};
        const exampleVal = media.example ?? (media.examples ? deref(spec, Object.values(media.examples)[0])?.value : undefined) ?? exampleFromSchema(spec, media.schema);
        if (/json/.test(type ?? "")) req.body = { ...defaultBody(), mode: "raw", rawLang: "json", raw: JSON.stringify(exampleVal, null, 2) };
        else if (/x-www-form-urlencoded|multipart/.test(type ?? "")) {
          const props = deref(spec, media.schema)?.properties ?? {};
          const rows = Object.entries(props).map(([k, v]: [string, Any]) => kv(k, v.format === "binary" ? "" : String(exampleFromSchema(spec, v) ?? ""), { type: v.format === "binary" ? "file" : "text", description: v.description }));
          req.body = /multipart/.test(type) ? { ...defaultBody(), mode: "formdata", formdata: rows } : { ...defaultBody(), mode: "urlencoded", urlencoded: rows };
        } else if (/xml/.test(type ?? "")) req.body = { ...defaultBody(), mode: "raw", rawLang: "xml", raw: typeof exampleVal === "string" ? exampleVal : "" };
        else if (type) req.body = { ...defaultBody(), mode: "raw", rawLang: "text", raw: typeof exampleVal === "string" ? exampleVal : JSON.stringify(exampleVal ?? "") };
        if (type && req.body.mode === "raw" && !req.headers.some((h) => h.key.toLowerCase() === "content-type")) req.headers.push(kv("Content-Type", type));
      }
      const opAuth = op.security ? authFor(op.security) : null;
      if (op.security && op.security.length === 0) req.auth = defaultAuth("noauth");
      else if (opAuth && JSON.stringify(opAuth) !== JSON.stringify(c.auth)) req.auth = opAuth;
      // Responses → examples.
      for (const [code, resp] of Object.entries((op.responses ?? {}) as Record<string, Any>)) {
        const r = deref(spec, resp);
        const status = code === "default" ? 500 : Number(code) || 200;
        let body = "";
        let ctype = "application/json";
        if (isV2) {
          const exv = r.examples?.["application/json"] ?? (r.schema ? exampleFromSchema(spec, r.schema) : undefined);
          if (exv !== undefined) body = JSON.stringify(exv, null, 2);
        } else {
          const content = r.content ?? {};
          ctype = Object.keys(content).find((t) => /json/.test(t)) ?? Object.keys(content)[0] ?? "application/json";
          const media = content[ctype] ?? {};
          const exv = media.example ?? (media.examples ? deref(spec, Object.values(media.examples)[0])?.value : undefined) ?? (media.schema ? exampleFromSchema(spec, media.schema) : undefined);
          if (exv !== undefined) body = typeof exv === "string" && !/json/.test(ctype) ? exv : JSON.stringify(exv, null, 2);
        }
        const example: Example = {
          id: uid(),
          name: r.description ? String(r.description).slice(0, 80) : `${code} response`,
          request: { method: req.method, url: req.url, headers: req.headers, body: req.body.mode === "raw" ? req.body.raw : undefined },
          status,
          statusText: code === "default" ? "Default" : "",
          headers: [kv("Content-Type", ctype)],
          body,
          lang: /json/.test(ctype) ? "json" : /xml/.test(ctype) ? "xml" : /html/.test(ctype) ? "html" : "text",
        };
        req.examples.push(example);
      }
      const tag = op.tags?.[0];
      if (tag) {
        if (!folders.has(tag)) {
          const f = newFolder(tag);
          f.description = tagDesc.get(tag) ?? "";
          folders.set(tag, f);
          c.items.push(f);
        }
        folders.get(tag)!.items.push(req);
      } else c.items.push(req);
    }
  }
  return c;
}

/* ------------------------------------------------------------------ HAR */

function fromHar(har: Any): Collection {
  const c = newCollection("HAR import");
  for (const e of har.log.entries ?? []) {
    const r = e.request ?? {};
    const req = newRequest({
      name: `${r.method ?? "GET"} ${String(r.url ?? "").replace(/^https?:\/\//, "").split("?")[0].slice(0, 70)}`,
      method: String(r.method ?? "GET"),
      url: String(r.url ?? ""),
      headers: (r.headers ?? []).filter((h: Any) => !String(h.name).startsWith(":") && !/^(content-length|host)$/i.test(h.name)).map((h: Any) => kv(h.name, String(h.value ?? ""))),
    });
    req.params = paramsFromUrl(req.url, []);
    const pd = r.postData;
    if (pd) {
      if (Array.isArray(pd.params) && pd.params.length) {
        const rows = pd.params.map((p: Any) => kv(p.name, String(p.value ?? ""), { type: p.fileName ? "file" : "text" }));
        req.body = /multipart/.test(pd.mimeType ?? "") ? { ...defaultBody(), mode: "formdata", formdata: rows } : { ...defaultBody(), mode: "urlencoded", urlencoded: rows };
      } else if (pd.text) req.body = { ...defaultBody(), mode: "raw", raw: String(pd.text), rawLang: /json/.test(pd.mimeType ?? "") ? "json" : /xml/.test(pd.mimeType ?? "") ? "xml" : "text" };
    }
    const res = e.response;
    if (res && res.status) {
      const ctype = res.content?.mimeType ?? "";
      req.examples.push({
        id: uid(),
        name: `${res.status} ${res.statusText ?? ""}`.trim(),
        request: { method: req.method, url: req.url, headers: req.headers },
        status: res.status,
        statusText: res.statusText ?? "",
        headers: (res.headers ?? []).map((h: Any) => kv(h.name, String(h.value ?? ""))),
        body: res.content?.encoding === "base64" ? "" : String(res.content?.text ?? ""),
        lang: /json/.test(ctype) ? "json" : /html/.test(ctype) ? "html" : /xml/.test(ctype) ? "xml" : "text",
      });
    }
    c.items.push(req);
  }
  return c;
}

/* ------------------------------------------------------------------ Insomnia v4 */

function fromInsomnia(data: Any): ImportResult {
  const res: Any[] = data.resources;
  const conv = (s: unknown) => String(s ?? "").replace(/\{\{\s*_\.([\w.-]+)\s*\}\}/g, "{{$1}}");
  const workspaces = res.filter((r) => r._type === "workspace");
  const collections: Collection[] = [];
  const environments: Environment[] = [];
  const build = (parentId: string): (Folder | RequestItem)[] =>
    res
      .filter((r) => r.parentId === parentId && (r._type === "request" || r._type === "request_group"))
      .sort((a, b) => (a.metaSortKey ?? 0) - (b.metaSortKey ?? 0))
      .map((r) => {
        if (r._type === "request_group") {
          const f = newFolder(r.name);
          f.description = r.description ?? "";
          f.items = build(r._id);
          return f;
        }
        const req = newRequest({ name: r.name, method: r.method ?? "GET", url: conv(r.url), description: r.description ?? "" });
        req.headers = (r.headers ?? []).map((h: Any) => kv(conv(h.name), conv(h.value), { enabled: !h.disabled }));
        req.params = (r.parameters ?? []).map((p: Any) => kv(conv(p.name), conv(p.value), { enabled: !p.disabled }));
        if (req.params.some((p) => p.enabled)) req.url += `${req.url.includes("?") ? "&" : "?"}${req.params.filter((p) => p.enabled).map((p) => `${p.key}=${p.value}`).join("&")}`;
        const b = r.body ?? {};
        if (b.mimeType === "application/x-www-form-urlencoded") req.body = { ...defaultBody(), mode: "urlencoded", urlencoded: (b.params ?? []).map((p: Any) => kv(conv(p.name), conv(p.value), { enabled: !p.disabled })) };
        else if (b.mimeType === "multipart/form-data") req.body = { ...defaultBody(), mode: "formdata", formdata: (b.params ?? []).map((p: Any) => kv(conv(p.name), conv(p.value), { enabled: !p.disabled, type: p.type === "file" ? "file" : "text" })) };
        else if (b.mimeType === "application/graphql") {
          let g: Any = {};
          try {
            g = JSON.parse(b.text ?? "{}");
          } catch {
            g = {};
          }
          req.body = { ...defaultBody(), mode: "graphql", graphql: { query: g.query ?? "", variables: g.variables ? JSON.stringify(g.variables, null, 2) : "" } };
          req.protocol = "graphql";
        } else if (b.text) req.body = { ...defaultBody(), mode: "raw", raw: conv(b.text), rawLang: /json/.test(b.mimeType ?? "") ? "json" : /xml/.test(b.mimeType ?? "") ? "xml" : "text" };
        const a = r.authentication ?? {};
        if (a.type === "basic") req.auth = { type: "basic", params: { username: conv(a.username), password: conv(a.password) } };
        else if (a.type === "bearer") req.auth = { type: "bearer", params: { token: conv(a.token) } };
        else if (a.type === "apikey") req.auth = { type: "apikey", params: { key: conv(a.key), value: conv(a.value), in: a.addTo === "queryParams" ? "query" : "header" } };
        else if (a.type === "digest") req.auth = { type: "digest", params: { username: conv(a.username), password: conv(a.password) } };
        else if (a.type === "ntlm") req.auth = { type: "ntlm", params: { username: conv(a.username), password: conv(a.password) } };
        else if (a.type === "oauth2") req.auth = { type: "oauth2", params: { grantType: a.grantType === "authorization_code" ? "authorization_code" : a.grantType ?? "client_credentials", authUrl: conv(a.authorizationUrl), accessTokenUrl: conv(a.accessTokenUrl), clientId: conv(a.clientId), clientSecret: conv(a.clientSecret), scope: conv(a.scope) } };
        return req;
      });
  for (const w of workspaces.length ? workspaces : [{ _id: "__root", name: "Insomnia import" }]) {
    const c = newCollection(w.name);
    c.items = build(w._id);
    collections.push(c);
    for (const env of res.filter((r) => r._type === "environment" && (r.parentId === w._id || res.find((x) => x._id === r.parentId)?.parentId === w._id))) {
      const values = Object.entries(env.data ?? {}).map(([k, v]) => variable(k, typeof v === "string" ? v : JSON.stringify(v)));
      if (values.length) environments.push({ id: uid(), name: env.name || "Insomnia environment", values });
    }
  }
  return { collections, environments, requests: [], kind: "Insomnia export" };
}
