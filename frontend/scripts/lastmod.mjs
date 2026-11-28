/**
 * Keeps src/lib/lastmod.json: a real "last changed" date for every sitemap URL, so the sitemap's
 * <lastmod> means something (Google ignores it once every URL carries the build time).
 *
 *   npm run lastmod          (also runs before every build)
 *
 * Each page gets a fingerprint of the content that shapes it: a tool's catalog entry and guide, a
 * collection's copy and tool list, a static page's source file. When a fingerprint changes, that
 * page's date becomes today; otherwise it keeps its date. Commit the JSON after a build so the
 * dates stick. A page seen for the first time is dated from git history when it is available.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const root = fileURLToPath(new URL("..", import.meta.url));
const src = `${root}src`;
const OUT = `${src}/lib/lastmod.json`;
const jiti = createJiti(import.meta.url, { alias: { "@": src } });

const { tools, CLUSTERS, toolHref, clusterHref, toolsIn } = await jiti.import("@/lib/tools");
const { guideFor, howTo } = await jiti.import("@/lib/guides");
const { HUBS } = await jiti.import("@/lib/hubs");

/** Plain data only: icons and other components drop out, so a refactor doesn't count as a change. */
const plain = (v) =>
  JSON.stringify(v, (_, x) => (typeof x === "function" || (x && typeof x === "object" && "$$typeof" in x) ? undefined : x));
const hash = (...parts) => createHash("sha1").update(parts.map(plain).join("\n")).digest("hex").slice(0, 16);
const file = (p) => (existsSync(`${src}/${p}`) ? readFileSync(`${src}/${p}`, "utf8") : "");

const live = tools.filter((t) => t.status === "live");
const card = (t) => [t.id, t.name, t.description];

/** path → [fingerprint, git pathspec or search term used to date a page seen for the first time] */
const pages = new Map([
  ["/", [hash(file("app/page.tsx"), live.map(card)), { files: ["src/app/page.tsx", "src/components/sections"] }]],
  ["/tools", [hash(file("app/tools/page.tsx"), live.map(card)), { files: ["src/app/tools/page.tsx"] }]],
  ["/blog", [hash(file("app/blog/page.tsx"), file("lib/blog.ts")), { files: ["src/lib/blog.ts"] }]],
  ...CLUSTERS.map((c) => [
    clusterHref(c.id),
    [hash(c, HUBS[c.id], toolsIn(c.id).filter((t) => t.status === "live").map(card)), { files: ["src/lib/hubs.ts"] }],
  ]),
  ...live.map((t) => [toolHref(t.id), [hash(t, guideFor(t), howTo(t)), { term: `"${t.id}"` }]]),
  ...["support", "about", "terms", "privacy", "cookies", "fair-use", "copyright", "disclaimer", "accessibility"].map((p) => [`/${p}`, [hash(file(`app/${p}/page.tsx`)), { files: [`src/app/${p}/page.tsx`] }]]),
]);

const shallow = (() => {
  try {
    return execFileSync("git", ["rev-parse", "--is-shallow-repository"], { cwd: root, encoding: "utf8" }).trim() !== "false";
  } catch {
    return true;
  }
})();

/** When git (full history) last touched these files, or last added/removed this id. */
function gitDate({ files, term }) {
  if (shallow) return undefined;
  const args = ["log", "-1", "--format=%cs", ...(term ? [`-S${term}`, "--", "src/lib"] : ["--", ...files])];
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim() || undefined;
  } catch {
    return undefined;
  }
}

const today = new Date().toISOString().slice(0, 10);
const old = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
const next = {};
let changed = 0;
for (const [path, [fp, from]] of pages) {
  const prev = old[path];
  if (prev?.hash === fp) next[path] = prev;
  else {
    next[path] = { hash: fp, date: prev ? today : (gitDate(from) ?? today) };
    changed++;
  }
}
const removed = Object.keys(old).filter((p) => !pages.has(p)).length;
writeFileSync(OUT, `${JSON.stringify(next, null, 1)}\n`);
console.log(`lastmod: ${pages.size} pages, ${changed} new or changed, ${removed} removed`);
