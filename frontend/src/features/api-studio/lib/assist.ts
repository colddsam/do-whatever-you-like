import type { ResponseData } from "../types";
import { b64ToText, header, tryJson } from "./util";

/**
 * The assistant (what Postbot does, without sending your data to an AI service): tests written from
 * the actual response, a visualization template for tabular JSON, and a plain-language summary.
 */

const jsPath = (path: (string | number)[]) =>
  path.map((p) => (typeof p === "number" ? `[${p}]` : /^[A-Za-z_$][\w$]*$/.test(p) ? `.${p}` : `[${JSON.stringify(p)}]`)).join("");

function typeName(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

export function schemaFrom(v: unknown, depth = 0): Record<string, unknown> {
  if (v === null) return { type: "null" };
  if (Array.isArray(v)) return depth > 6 ? { type: "array" } : { type: "array", items: v.length ? schemaFrom(v[0], depth + 1) : {} };
  if (typeof v === "object") {
    const props = Object.fromEntries(Object.entries(v as object).map(([k, x]) => [k, depth > 6 ? {} : schemaFrom(x, depth + 1)]));
    return { type: "object", required: Object.keys(props), properties: props };
  }
  return { type: typeof v === "number" ? (Number.isInteger(v) ? "integer" : "number") : typeof v };
}

export function generateTests(r: ResponseData): string {
  const lines: string[] = [];
  const ct = header(r.headers, "content-type") ?? "";
  lines.push(`pm.test("Status code is ${r.status}", function () {\n    pm.response.to.have.status(${r.status});\n});`);
  lines.push(`pm.test("Response time is acceptable", function () {\n    pm.expect(pm.response.responseTime).to.be.below(${Math.max(200, Math.ceil((r.timings.total * 2) / 100) * 100)});\n});`);
  if (ct) lines.push(`pm.test("Content-Type is ${ct.split(";")[0]}", function () {\n    pm.response.to.have.header("Content-Type");\n    pm.expect(pm.response.headers.get("Content-Type")).to.include(${JSON.stringify(ct.split(";")[0])});\n});`);
  const j = tryJson(b64ToText(r.bodyB64));
  if (j.ok) {
    const v = j.value;
    lines.push(`pm.test("Body matches the expected shape", function () {\n    const schema = ${JSON.stringify(schemaFrom(v), null, 4).replace(/\n/g, "\n    ")};\n    pm.response.to.have.jsonSchema(schema);\n});`);
    const checks: string[] = [];
    const visit = (x: unknown, path: (string | number)[]) => {
      if (checks.length >= 8) return;
      if (Array.isArray(x)) {
        checks.push(`    pm.expect(json${jsPath(path)}).to.be.an("array")${x.length ? ".that.is.not.empty" : ""};`);
        if (x.length && typeof x[0] === "object" && x[0]) visit(x[0], [...path, 0]);
      } else if (x && typeof x === "object") {
        for (const [k, val] of Object.entries(x).slice(0, 6)) {
          if (checks.length >= 8) break;
          const p = [...path, k];
          const t = typeName(val);
          if (t === "object" || t === "array") visit(val, p);
          else if (t === "null") checks.push(`    pm.expect(json${jsPath(p)}).to.be.null;`);
          else checks.push(`    pm.expect(json${jsPath(p)}).to.be.a(${JSON.stringify(t)});`);
        }
      }
    };
    visit(v, []);
    if (checks.length) lines.push(`pm.test("Fields have the right types", function () {\n    const json = pm.response.json();\n${checks.join("\n")}\n});`);
  } else if (b64ToText(r.bodyB64).length) lines.push(`pm.test("Body is not empty", function () {\n    pm.response.to.have.body();\n});`);
  return lines.join("\n\n");
}

/** A table template for the Visualize tab (JSON arrays of objects, or an object holding one). */
export function generateVisualizer(r: ResponseData): string | null {
  const j = tryJson(b64ToText(r.bodyB64));
  if (!j.ok) return null;
  let rows: unknown = j.value;
  let path = "";
  if (!Array.isArray(rows) && rows && typeof rows === "object") {
    const hit = Object.entries(rows).find(([, v]) => Array.isArray(v) && v.length && typeof v[0] === "object");
    if (hit) {
      rows = hit[1];
      path = `.${hit[0]}`;
    }
  }
  if (!Array.isArray(rows) || !rows.length || typeof rows[0] !== "object" || !rows[0]) return null;
  const cols = Object.keys(rows[0] as object)
    .filter((k) => typeof (rows as Record<string, unknown>[])[0][k] !== "object")
    .slice(0, 8);
  if (!cols.length) return null;
  return `const template = \`
<style>
  table { border-collapse: collapse; width: 100%; font: 13px system-ui, sans-serif; }
  th, td { border: 1px solid #dad5c8; padding: 6px 10px; text-align: left; }
  th { background: #eae6db; }
  tr:nth-child(even) td { background: #fbfaf6; }
</style>
<table>
  <tr>${cols.map((c) => `<th>${c}</th>`).join("")}</tr>
  {{#each rows}}
  <tr>${cols.map((c) => `<td>{{${c}}}</td>`).join("")}</tr>
  {{/each}}
</table>\`;

pm.visualizer.set(template, { rows: pm.response.json()${path} });`;
}

export function explainResponse(r: ResponseData): string[] {
  const out: string[] = [];
  const ct = header(r.headers, "content-type");
  out.push(`${r.status} ${r.statusText}: ${r.status < 300 ? "the request worked" : r.status < 400 ? "a redirect" : r.status < 500 ? "the server rejected the request" : "the server failed"}.`);
  if (ct) out.push(`The body is ${ct.split(";")[0]}, ${r.size.body} bytes${r.size.wire && r.size.wire !== r.size.body ? ` (${r.size.wire} bytes compressed on the wire)` : ""}.`);
  const j = tryJson(b64ToText(r.bodyB64));
  if (j.ok) {
    const v = j.value;
    if (Array.isArray(v)) out.push(`It's a JSON array of ${v.length} item${v.length === 1 ? "" : "s"}${v[0] && typeof v[0] === "object" ? ` with fields ${Object.keys(v[0]).slice(0, 8).join(", ")}` : ""}.`);
    else if (v && typeof v === "object") out.push(`It's a JSON object with ${Object.keys(v).length} top-level field${Object.keys(v).length === 1 ? "" : "s"}: ${Object.keys(v).slice(0, 10).join(", ")}.`);
  }
  const cache = header(r.headers, "cache-control");
  if (cache) out.push(`Caching: ${cache}.`);
  const rl = header(r.headers, "x-ratelimit-remaining") ?? header(r.headers, "ratelimit-remaining");
  if (rl) out.push(`Rate limit: ${rl} requests left${header(r.headers, "x-ratelimit-limit") ? ` of ${header(r.headers, "x-ratelimit-limit")}` : ""}.`);
  if (r.timings.total > 1000) out.push(`It took ${Math.round(r.timings.total)} ms${r.timings.ttfb ? `, ${Math.round(r.timings.ttfb)} ms of it waiting for the first byte (server time)` : ""}.`);
  const failed = r.tests.filter((t) => !t.passed && !t.skipped);
  if (failed.length) out.push(`${failed.length} test${failed.length === 1 ? "" : "s"} failed: ${failed.map((t) => t.name).join("; ")}.`);
  return out;
}

/* ------------------------------------------------------------------ Handlebars-compatible templates */

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

type Ctx = { data: unknown; parent?: Ctx; index?: number; key?: string; first?: boolean; last?: boolean };

function lookupPath(ctx: Ctx, path: string): unknown {
  const p = path.trim();
  if (p === "this" || p === ".") return ctx.data;
  if (p === "@index") return ctx.index;
  if (p === "@key") return ctx.key;
  if (p === "@first") return ctx.first;
  if (p === "@last") return ctx.last;
  let c: Ctx | undefined = ctx;
  let rest = p;
  while (rest.startsWith("../")) {
    c = c?.parent;
    rest = rest.slice(3);
  }
  if (rest.startsWith("this.")) rest = rest.slice(5);
  let v: unknown = c?.data;
  for (const seg of rest.split(".")) {
    if (v === null || v === undefined) return undefined;
    v = (v as Record<string, unknown>)[seg];
  }
  // Not found here: try enclosing contexts (Handlebars' implicit lookup for root data).
  if (v === undefined && c?.parent && !p.includes("../")) return lookupPath(c.parent, p);
  return v;
}

/** {{var}}, {{{raw}}}, {{#each}}/{{else}}, {{#if}}/{{#unless}}/{{else}}, {{#with}}, @index/@key/@first/@last, ../ paths. */
export function renderTemplate(tpl: string, data: unknown): string {
  const tokens = tpl.split(/(\{\{\{[\s\S]+?\}\}\}|\{\{[\s\S]+?\}\})/);
  let pos = 0;
  const run = (ctx: Ctx, stopAt: string[]): { out: string; stop?: string } => {
    let out = "";
    while (pos < tokens.length) {
      const t = tokens[pos++];
      if (!t.startsWith("{{")) {
        out += t;
        continue;
      }
      if (t.startsWith("{{{")) {
        out += String(lookupPath(ctx, t.slice(3, -3)) ?? "");
        continue;
      }
      const inner = t.slice(2, -2).trim();
      if (inner.startsWith("!")) continue;
      if (stopAt.includes(inner) || stopAt.some((s) => inner.startsWith("/") && s.startsWith("/") && inner === s)) return { out, stop: inner };
      if (inner === "else") return { out, stop: "else" };
      const m = /^#(each|if|unless|with)\s+(.+)$/.exec(inner);
      if (m) {
        const [, kind, arg] = m;
        const close = `/${kind}`;
        const start = pos;
        // First pass: find the body and the else-body by running with a dummy context.
        const val = lookupPath(ctx, arg);
        const truthy = Array.isArray(val) ? val.length > 0 : !!val;
        const runBlock = (c: Ctx) => {
          pos = start;
          const a = run(c, [close]);
          let b = "";
          if (a.stop === "else") b = run(c, [close]).out;
          return { main: a.out, alt: b, end: pos };
        };
        if (kind === "each") {
          if (Array.isArray(val) && val.length) {
            let acc = "";
            let end = start;
            val.forEach((item, i) => {
              const r = runBlock({ data: item, parent: ctx, index: i, first: i === 0, last: i === val.length - 1 });
              acc += r.main;
              end = r.end;
            });
            out += acc;
            pos = end;
          } else if (val && typeof val === "object" && Object.keys(val).length) {
            let acc = "";
            let end = start;
            const entries = Object.entries(val);
            entries.forEach(([k, item], i) => {
              const r = runBlock({ data: item, parent: ctx, index: i, key: k, first: i === 0, last: i === entries.length - 1 });
              acc += r.main;
              end = r.end;
            });
            out += acc;
            pos = end;
          } else {
            const r = runBlock(ctx);
            out += r.alt;
          }
        } else if (kind === "with") {
          const r = runBlock(val ? { data: val, parent: ctx } : ctx);
          out += val ? r.main : r.alt;
        } else {
          const r = runBlock(ctx);
          out += (kind === "if" ? truthy : !truthy) ? r.main : r.alt;
        }
        continue;
      }
      const v = lookupPath(ctx, inner);
      out += esc(typeof v === "object" && v !== null ? JSON.stringify(v) : v);
    }
    return { out };
  };
  return run({ data }, []).out;
}
