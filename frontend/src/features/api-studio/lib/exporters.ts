import * as yaml from "js-yaml";
import type { Collection, Workspace } from "../types";
import { requestsIn, tryJson } from "./util";
import { splitUrl } from "./url";

/** OpenAPI 3.0 from a collection (paths, parameters, bodies, examples), and whole-workspace backups. */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

function schemaOf(v: unknown): Any {
  if (v === null) return { nullable: true };
  if (Array.isArray(v)) return { type: "array", items: v.length ? schemaOf(v[0]) : {} };
  if (typeof v === "object") return { type: "object", properties: Object.fromEntries(Object.entries(v as object).map(([k, x]) => [k, schemaOf(x)])) };
  if (typeof v === "number") return { type: Number.isInteger(v) ? "integer" : "number" };
  if (typeof v === "boolean") return { type: "boolean" };
  return { type: "string" };
}

export function collectionToOpenApi(c: Collection, format: "yaml" | "json" = "yaml"): string {
  const baseVar = c.variables.find((v) => /^(baseUrl|base_url|url|host)$/i.test(v.key));
  const spec: Any = {
    openapi: "3.0.3",
    info: { title: c.name, description: c.description || undefined, version: "1.0.0" },
    servers: baseVar ? [{ url: baseVar.value }] : [],
    paths: {},
    components: { securitySchemes: {} },
  };
  if (c.auth.type === "bearer") spec.components.securitySchemes.bearerAuth = { type: "http", scheme: "bearer" };
  if (c.auth.type === "basic") spec.components.securitySchemes.basicAuth = { type: "http", scheme: "basic" };
  if (c.auth.type === "apikey") spec.components.securitySchemes.apiKey = { type: "apiKey", name: c.auth.params.key, in: c.auth.params.in === "query" ? "query" : "header" };
  if (Object.keys(spec.components.securitySchemes).length) spec.security = [{ [Object.keys(spec.components.securitySchemes)[0]]: [] }];
  for (const { req, parents } of requestsIn(c.items)) {
    if (req.protocol !== "http" && req.protocol !== "graphql") continue;
    const { base } = splitUrl(req.url);
    const path = (base.replace(/^\{\{[^}]+\}\}/, "").replace(/^[a-z][\w+.-]*:\/\/[^/]*/i, "") || "/").replace(/:([A-Za-z_][\w-]*)/g, "{$1}").replace(/\{\{([^}]+)\}\}/g, "{$1}");
    const op: Any = { summary: req.name, description: req.description || undefined, tags: parents.length ? [parents[0].name] : undefined, parameters: [], responses: {} };
    for (const p of req.params) op.parameters.push({ name: p.key, in: "query", required: p.enabled, description: p.description || undefined, schema: { type: "string" }, example: p.value || undefined });
    for (const p of req.pathVars) op.parameters.push({ name: p.key, in: "path", required: true, description: p.description || undefined, schema: { type: "string" }, example: p.value || undefined });
    for (const h of req.headers.filter((h) => h.key && !/^(content-type|authorization|accept)$/i.test(h.key))) op.parameters.push({ name: h.key, in: "header", schema: { type: "string" }, example: h.value || undefined });
    if (!op.parameters.length) delete op.parameters;
    const b = req.body;
    if (b.mode === "raw" && b.raw.trim()) {
      const j = tryJson(b.raw);
      const type = { json: "application/json", xml: "application/xml", html: "text/html", javascript: "application/javascript", text: "text/plain" }[b.rawLang];
      op.requestBody = { content: { [type]: j.ok ? { schema: schemaOf(j.value), example: j.value } : { schema: { type: "string" }, example: b.raw } } };
    } else if (b.mode === "urlencoded" || b.mode === "formdata") {
      const rows = b.mode === "urlencoded" ? b.urlencoded : b.formdata;
      op.requestBody = { content: { [b.mode === "urlencoded" ? "application/x-www-form-urlencoded" : "multipart/form-data"]: { schema: { type: "object", properties: Object.fromEntries(rows.filter((r) => r.key).map((r) => [r.key, r.type === "file" ? { type: "string", format: "binary" } : { type: "string", example: r.value }])) } } } };
    } else if (b.mode === "graphql") op.requestBody = { content: { "application/json": { schema: { type: "object", properties: { query: { type: "string" }, variables: { type: "object" } } }, example: { query: b.graphql.query } } } };
    for (const e of req.examples) {
      const j = tryJson(e.body);
      const ct = e.headers.find((h) => h.key.toLowerCase() === "content-type")?.value ?? (j.ok ? "application/json" : "text/plain");
      op.responses[String(e.status)] = { description: e.name || e.statusText || "Response", content: e.body ? { [ct.split(";")[0]]: j.ok ? { schema: schemaOf(j.value), example: j.value } : { schema: { type: "string" }, example: e.body } } : undefined };
    }
    if (!Object.keys(op.responses).length) op.responses["200"] = { description: "Successful response" };
    spec.paths[path] = spec.paths[path] ?? {};
    spec.paths[path][req.method.toLowerCase()] = op;
  }
  if (!Object.keys(spec.components.securitySchemes).length) delete spec.components;
  const clean = JSON.parse(JSON.stringify(spec));
  return format === "json" ? JSON.stringify(clean, null, 2) : yaml.dump(clean, { lineWidth: 120, noRefs: true });
}

export function workspaceBackup(w: Workspace): string {
  return JSON.stringify({ __dwyl_api_workspace: 1, exportedAt: new Date().toISOString(), ...w }, null, 2);
}
