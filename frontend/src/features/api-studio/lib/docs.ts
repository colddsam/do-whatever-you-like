import { marked } from "marked";
import DOMPurify from "dompurify";
import type { Collection, Folder, RequestItem, TreeNode } from "../types";
import { generate, snipFrom } from "./codegen";
import { emptyScopes } from "./vars";
import { AUTH_TYPES } from "./auth";

/** Collection documentation: markdown descriptions, every request's details and examples, as a standalone HTML page. */

export const md = (s: string) => DOMPurify.sanitize(marked.parse(s || "", { async: false }) as string);

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const slug = (s: string, id: string) => `${s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${id.slice(0, 6)}`;

function table(title: string, rows: { key: string; value: string; description?: string }[]) {
  if (!rows.length) return "";
  return `<h4>${title}</h4><table><tr><th>Key</th><th>Value</th><th>Description</th></tr>${rows.map((r) => `<tr><td><code>${esc(r.key)}</code></td><td><code>${esc(r.value)}</code></td><td>${esc(r.description ?? "")}</td></tr>`).join("")}</table>`;
}

function requestHtml(c: Collection, r: RequestItem, parents: Folder[], lang: string) {
  const scopes = emptyScopes();
  const snippet = generate(lang, snipFrom(r, scopes, true, parents, c));
  const auth = r.auth.type === "inherit" ? "" : `<p class="muted">Authorization: ${esc(AUTH_TYPES.find((a) => a.id === r.auth.type)?.label ?? r.auth.type)}</p>`;
  const body =
    r.body.mode === "raw" && r.body.raw
      ? `<h4>Body · ${r.body.rawLang}</h4><pre>${esc(r.body.raw)}</pre>`
      : r.body.mode === "graphql"
        ? `<h4>GraphQL query</h4><pre>${esc(r.body.graphql.query)}</pre>${r.body.graphql.variables ? `<pre>${esc(r.body.graphql.variables)}</pre>` : ""}`
        : r.body.mode === "urlencoded"
          ? table("Body · urlencoded", r.body.urlencoded)
          : r.body.mode === "formdata"
            ? table("Body · form-data", r.body.formdata.map((f) => ({ ...f, value: f.type === "file" ? `<file ${f.file?.name ?? ""}>` : f.value })))
            : "";
  const examples = r.examples
    .map((e) => `<details><summary>Example: ${esc(e.name)} · <b>${e.status}</b> ${esc(e.statusText)}</summary><pre>${esc(e.body)}</pre></details>`)
    .join("");
  return `<section id="${slug(r.name, r.id)}"><h3><span class="m m-${r.method.toLowerCase()}">${esc(r.protocol === "http" || r.protocol === "graphql" ? r.method : r.protocol.toUpperCase())}</span> ${esc(r.name)}</h3>
<pre class="url">${esc(r.url)}</pre>${auth}${md(r.description)}${table("Headers", r.headers.filter((h) => h.enabled))}${table("Query params", r.params.filter((p) => p.enabled))}${table("Path variables", r.pathVars)}${body}
<h4>Example request</h4><pre>${esc(snippet)}</pre>${examples}</section>`;
}

export function collectionDocsHtml(c: Collection, lang = "curl"): string {
  const toc: string[] = [];
  const parts: string[] = [];
  const walk = (items: TreeNode[], parents: Folder[], depth: number) => {
    for (const n of items) {
      if (n.kind === "folder") {
        toc.push(`<li class="d${depth}"><a href="#${slug(n.name, n.id)}">${esc(n.name)}</a></li>`);
        parts.push(`<section id="${slug(n.name, n.id)}" class="folder"><h2>${esc(n.name)}</h2>${md(n.description)}</section>`);
        walk(n.items, [...parents, n], depth + 1);
      } else {
        toc.push(`<li class="d${depth}"><a href="#${slug(n.name, n.id)}"><span class="m m-${n.method.toLowerCase()}">${esc(n.method)}</span> ${esc(n.name)}</a></li>`);
        parts.push(requestHtml(c, n, parents, lang));
      }
    }
  };
  walk(c.items, [], 0);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(c.name)} · API documentation</title>
<style>
:root{--paper:#f3f0e8;--surface:#fbfaf6;--ink:#15140f;--ink2:#57544a;--ink3:#8a867a;--line:#dad5c8;--accent:#eb4a10}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.6 system-ui,-apple-system,Segoe UI,sans-serif}
.wrap{display:grid;grid-template-columns:280px 1fr;min-height:100vh}nav{position:sticky;top:0;height:100vh;overflow:auto;border-right:1px solid var(--line);padding:24px 16px;background:var(--surface)}
nav ul{list-style:none;margin:0;padding:0}nav li{margin:2px 0}nav a{color:var(--ink2);text-decoration:none;font-size:13px}nav a:hover{color:var(--ink)}.d1{padding-left:12px}.d2{padding-left:24px}.d3{padding-left:36px}
main{padding:40px min(6vw,64px);max-width:980px}h1{font-size:40px;letter-spacing:-.03em;margin:0 0 8px}h2{border-top:1px solid var(--line);padding-top:32px;margin-top:40px}section{margin-bottom:40px}
pre{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:12px;overflow:auto;font:12.5px/1.5 ui-monospace,Menlo,monospace}pre.url{font-size:13px}
table{border-collapse:collapse;width:100%;font-size:13px;margin:8px 0 16px}th,td{border:1px solid var(--line);padding:6px 10px;text-align:left;vertical-align:top}th{background:#eae6db}
code{font:12.5px ui-monospace,Menlo,monospace}.m{font:600 12px ui-monospace,monospace;margin-right:4px}.m-get{color:#2f7d4f}.m-post{color:#b7791f}.m-put{color:#2f5fa8}.m-patch{color:#7a4ea3}.m-delete{color:#c2410c}
.muted{color:var(--ink3);font-size:13px}details{margin:8px 0}summary{cursor:pointer;font-size:13px}
@media (max-width:800px){.wrap{grid-template-columns:1fr}nav{position:static;height:auto;border-right:0;border-bottom:1px solid var(--line)}}
</style></head><body><div class="wrap"><nav><strong>${esc(c.name)}</strong><ul>${toc.join("")}</ul></nav><main><h1>${esc(c.name)}</h1>${md(c.description)}
${c.variables.length ? table("Variables", c.variables.map((v) => ({ key: v.key, value: v.type === "secret" ? "••••••" : v.value, description: v.description }))) : ""}
${parts.join("\n")}<p class="muted">Generated by the Do-Whatever-You-Like API client.</p></main></div></body></html>`;
}
