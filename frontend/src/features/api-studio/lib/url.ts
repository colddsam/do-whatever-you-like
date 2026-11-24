import type { KV } from "../types";
import { kv } from "./util";

/**
 * URLs stay as typed (with {{variables}} and :path variables inside), so they're handled as strings
 * rather than with the URL class, which would percent-encode the braces and reject a URL that starts
 * with {{baseUrl}}. Query parameters and the Params table are two views of the same thing.
 */

export function splitUrl(url: string): { base: string; query: string | null; hash: string } {
  let rest = url;
  let hash = "";
  const h = rest.indexOf("#");
  if (h >= 0) {
    hash = rest.slice(h);
    rest = rest.slice(0, h);
  }
  const q = rest.indexOf("?");
  if (q < 0) return { base: rest, query: null, hash };
  return { base: rest.slice(0, q), query: rest.slice(q + 1), hash };
}

export function parseQuery(query: string | null): KV[] {
  if (query === null || query === "") return [];
  return query.split("&").map((pair) => {
    const i = pair.indexOf("=");
    return i < 0 ? kv(pair, "", { description: "" }) : kv(pair.slice(0, i), pair.slice(i + 1));
  });
}

/** The URL changed: rebuild the params table from its query, keeping disabled rows and descriptions. */
export function paramsFromUrl(url: string, old: KV[]): KV[] {
  const parsed = parseQuery(splitUrl(url).query);
  const enabledOld = old.filter((p) => p.enabled);
  const out: KV[] = parsed.map((p, i) => {
    const prev = enabledOld[i];
    return prev ? { ...prev, key: p.key, value: p.value } : p;
  });
  // Disabled rows aren't in the URL; keep them where they were.
  old.forEach((p, i) => {
    if (!p.enabled) out.splice(Math.min(i, out.length), 0, p);
  });
  return out;
}

/** The params table changed: rewrite the URL's query (a row with no value keeps the bare key, as typed). */
export function urlFromParams(url: string, params: KV[]): string {
  const { base, hash } = splitUrl(url);
  const q = params
    .filter((p) => p.enabled && (p.key || p.value))
    .map((p) => (p.value === "" ? p.key : `${p.key}=${p.value}`))
    .join("&");
  return base + (q ? `?${q}` : "") + hash;
}

/** `:name` segments in the path (not the port in host:8080). */
export function pathVarNames(url: string): string[] {
  const { base } = splitUrl(url);
  const noScheme = base.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  const slash = noScheme.indexOf("/");
  if (slash < 0) return [];
  const path = noScheme.slice(slash);
  const names: string[] = [];
  for (const seg of path.split("/")) {
    const m = /^:([A-Za-z_][\w.-]*)$/.exec(seg) ?? /^:([A-Za-z_][\w.-]*)(?=[;.])/.exec(seg);
    if (m && !names.includes(m[1])) names.push(m[1]);
  }
  return names;
}

export function pathVarsFromUrl(url: string, old: KV[]): KV[] {
  return pathVarNames(url).map((name) => old.find((p) => p.key === name) ?? kv(name, ""));
}

/** Replace :name path segments with their (already resolved) values. */
export function applyPathVars(url: string, vars: KV[]): string {
  if (!vars.length) return url;
  const { base, query, hash } = splitUrl(url);
  const m = /^([a-z][a-z0-9+.-]*:\/\/[^/]*)(.*)$/i.exec(base);
  const head = m ? m[1] : "";
  const path = m ? m[2] : base;
  const map = new Map(vars.map((v) => [v.key, v.value]));
  const out = path
    .split("/")
    .map((seg) => {
      const mm = /^:([A-Za-z_][\w.-]*)(.*)$/.exec(seg);
      return mm && map.has(mm[1]) ? encodeURIComponent(map.get(mm[1]) ?? "") + mm[2] : seg;
    })
    .join("/");
  return head + out + (query !== null ? `?${query}` : "") + hash;
}

/** Percent-encode what must be encoded without touching existing %XX escapes (Postman's "Encode URL automatically"). */
export function encodeUrl(url: string): string {
  const { base, query, hash } = splitUrl(url);
  const enc = (s: string, extra: RegExp) => s.replace(extra, (c) => encodeURIComponent(c)).replace(/%(?![0-9A-Fa-f]{2})/g, "%25");
  const b = enc(base, /[^A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]/g);
  const q =
    query === null
      ? ""
      : "?" +
        query
          .split("&")
          .map((pair) => enc(pair, /[^A-Za-z0-9\-._~:/?@!$'()*+,;=%]/g))
          .join("&");
  return b + q + hash;
}

/** Adds http:// when there's no scheme (as Postman does). */
export function withScheme(url: string): string {
  const u = url.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) return u;
  return `http://${u}`;
}

export function hostOf(url: string): string {
  try {
    return new URL(withScheme(url)).hostname;
  } catch {
    return "";
  }
}

/** Addresses only the user's own device or network can reach (the cloud agent can't). */
export function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (!h) return false;
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".lan") || h === "0.0.0.0" || !h.includes(".") && !h.includes(":")) return true;
  if (/^127\.|^10\.|^192\.168\.|^169\.254\.|^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (h === "::1" || h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd")) return true;
  return false;
}
