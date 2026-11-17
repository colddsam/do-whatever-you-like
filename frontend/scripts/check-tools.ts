/**
 * Consistency check for the tool registry, run after adding, renaming or merging tools:
 *
 *   cd frontend && npx tsx --tsconfig tsconfig.json scripts/check-tools.ts
 *
 * - Every merged page (src/lib/merged-tools.ts) is out of the directory and redirects to a live
 *   tool, with a starting mode that tool actually reads.
 * - Featured lists, hubs and guides' "see also" links only name live tools.
 * - Every tool has a workspace, and the playground maps no unknown ids.
 * - Search still finds the merged variants by their old names ("md5 hash", "excel viewer"…).
 */
import { readFileSync } from "node:fs";
import { CLUSTERS, clusterOf, getTool, tools } from "../src/lib/tools";
import { MERGED_TOOLS, mergedHref } from "../src/lib/merged-tools";
import { UTILITIES, getUtility } from "../src/lib/utilities/catalog";
import { guideFor } from "../src/lib/guides";
import { rankToolsForTask } from "../src/lib/tool-search";

let fails = 0;
const fail = (m: string) => (fails++, console.log("FAIL", m));
const ids = new Set(tools.map((t) => t.id));

// 1. Redirects: every old page is gone and lands on a live tool, with a mode that tool understands.
const NON_UTILITY_PARAMS: Record<string, Record<string, string[]>> = {
  notepad: { open: ["find", "replace"], tab: ["issues", "found", "words"], panel: ["lines"] },
  writing: { mode: ["summarize", "rewrite"] },
  "split-pdf": { pages: ["chosen"] },
  "trim-media": { mode: ["parts"] },
  "convert-image": { to: ["jpg", "png", "webp", "gif", "animated"] },
};
for (const [old, m] of Object.entries(MERGED_TOOLS)) {
  if (ids.has(old)) fail(`${old} still listed`);
  const target = getTool(m.to);
  if (!target || target.status !== "live") { fail(`${old} -> ${m.to} missing`); continue; }
  if (MERGED_TOOLS[m.to]) fail(`${old} -> ${m.to} which is itself merged`);
  const u = getUtility(m.to);
  for (const [k, v] of Object.entries(m.params ?? {})) {
    if (u) {
      const same = UTILITIES.filter((x) => x.engine === u.engine);
      if (!same.some((x) => x.preset?.[k] === v)) fail(`${old}: ${k}=${v} isn't a ${u.engine} preset value`);
    } else if (!NON_UTILITY_PARAMS[m.to]?.[k]?.includes(v)) fail(`${old}: ${m.to} doesn't read ${k}=${v}`);
  }
  if (!mergedHref(old)!.startsWith(`/tools/${m.to}`)) fail(`${old}: bad href`);
}

// 2. Every featured id, hub and "see also" link points at a live tool.
for (const c of CLUSTERS) {
  for (const id of c.featured) if (!ids.has(id)) fail(`featured ${c.id}: ${id}`);
  if (c.hub && !ids.has(c.hub)) fail(`hub ${c.id}: ${c.hub}`);
}
for (const t of tools) {
  for (const id of guideFor(t)?.see ?? []) if (!ids.has(id)) fail(`guide ${t.id} sees ${id}`);
  if (!clusterOf(t)) fail(`${t.id} has no collection`);
}

// 3. Every tool has a workspace (same rules as components/tools/playground.tsx).
const pg = readFileSync(new URL("../src/components/tools/playground.tsx", import.meta.url), "utf8");
const byId = new Set([...pg.slice(pg.indexOf("const byId")).matchAll(/^\s+"?([a-z0-9-]+)"?:\s/gm)].map((m) => m[1]));
for (const t of tools) {
  const ok = byId.has(t.id) || t.devTab || getUtility(t.id) || t.preset || t.kind === "link";
  if (!ok && t.status === "live") fail(`${t.id} has no workspace`);
}
for (const id of byId) if (!ids.has(id) && !["loading"].includes(id)) fail(`playground maps unknown ${id}`);

// 4. Search still finds the merged variants by their old names.
const probes: [string, string][] = [
  ["md5 hash", "hash-generator"], ["sha256", "hash-generator"], ["hmac", "hash-generator"], ["random number generator", "random-generator"],
  ["sql formatter", "code-formatter"], ["minify css", "code-minifier"], ["yaml validator", "code-validator"], ["json to csv", "data-format-converter"],
  ["excel viewer", "document-viewer"], ["pdf viewer", "document-viewer"], ["rotate pdf", "organize-pdf"], ["extract pages from pdf", "split-pdf"],
  ["heic to jpg", "convert-image"], ["jpg to png", "convert-image"], ["find and replace", "notepad"], ["remove duplicate lines", "notepad"],
  ["summarize text", "writing"], ["box shadow", "css-generator"], ["currency converter", "unit-converter"], ["pomodoro", "stopwatch"],
  ["mx lookup", "dns-lookup"], ["binary to text", "text-to-binary"], ["mirror text", "upside-down-text"], ["split video into parts", "trim-media"],
];
for (const [q, want] of probes) {
  const top = rankToolsForTask(q).slice(0, 5).map((t) => t.id);
  if (!top.includes(want)) fail(`search "${q}" top5 ${JSON.stringify(top)} lacks ${want}`);
}

const per = CLUSTERS.map((c) => `${c.id}=${tools.filter((t) => clusterOf(t) === c.id).length}`);
console.log(`tools: ${tools.length} (${tools.filter((t) => t.status === "live").length} live) · merged pages: ${Object.keys(MERGED_TOOLS).length}`);
console.log(per.join(" "));
console.log(fails ? `${fails} problem(s)` : "ALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
