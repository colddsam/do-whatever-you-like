import type { Cookie } from "../types";
import { withScheme } from "./url";

/**
 * The cookie jar: cookies set by responses that came through our server are kept here (per domain),
 * and sent back with later requests to matching addresses, as a browser would. Requests sent by the
 * browser agent use the browser's own cookies instead (a page can't read or set those).
 */

export function parseSetCookie(header: string, url: string): Cookie | null {
  let u: URL;
  try {
    u = new URL(withScheme(url));
  } catch {
    return null;
  }
  const parts = header.split(";").map((s) => s.trim());
  const first = parts.shift() ?? "";
  const eq = first.indexOf("=");
  if (eq <= 0) return null;
  const c: Cookie = { name: first.slice(0, eq).trim(), value: first.slice(eq + 1).trim(), domain: u.hostname.toLowerCase(), path: defaultPath(u.pathname), httpOnly: false, secure: false, hostOnly: true };
  for (const attr of parts) {
    const i = attr.indexOf("=");
    const k = (i < 0 ? attr : attr.slice(0, i)).trim().toLowerCase();
    const v = i < 0 ? "" : attr.slice(i + 1).trim();
    if (k === "domain" && v) {
      const d = v.replace(/^\./, "").toLowerCase();
      // A server may only set cookies for its own domain or a parent of it.
      if (u.hostname.toLowerCase() === d || u.hostname.toLowerCase().endsWith(`.${d}`)) {
        c.domain = d;
        c.hostOnly = false;
      } else return null;
    } else if (k === "path" && v.startsWith("/")) c.path = v;
    else if (k === "expires") {
      const t = Date.parse(v);
      if (!Number.isNaN(t) && c.expires === undefined) c.expires = t;
    } else if (k === "max-age") {
      const n = Number(v);
      if (!Number.isNaN(n)) c.expires = Date.now() + n * 1000;
    } else if (k === "httponly") c.httpOnly = true;
    else if (k === "secure") c.secure = true;
    else if (k === "samesite") c.sameSite = v;
  }
  return c;
}

function defaultPath(path: string): string {
  if (!path || !path.startsWith("/")) return "/";
  const i = path.lastIndexOf("/");
  return i <= 0 ? "/" : path.slice(0, i);
}

export const expired = (c: Cookie) => c.expires !== undefined && c.expires <= Date.now();

/** Puts cookies in the jar (replacing same name+domain+path; an expired one deletes it). */
export function storeCookies(jar: Cookie[], incoming: Cookie[]): Cookie[] {
  let out = [...jar];
  for (const c of incoming) {
    out = out.filter((x) => !(x.name === c.name && x.domain === c.domain && x.path === c.path));
    if (!expired(c)) out.push(c);
  }
  return out;
}

export function cookiesFor(jar: Cookie[], url: string): Cookie[] {
  let u: URL;
  try {
    u = new URL(withScheme(url));
  } catch {
    return [];
  }
  const host = u.hostname.toLowerCase();
  return jar
    .filter((c) => !expired(c))
    .filter((c) => (c.hostOnly ? host === c.domain : host === c.domain || host.endsWith(`.${c.domain}`)))
    .filter((c) => u.pathname === c.path || u.pathname.startsWith(c.path.endsWith("/") ? c.path : `${c.path}/`) || c.path === "/")
    .filter((c) => !c.secure || u.protocol === "https:")
    .sort((a, b) => b.path.length - a.path.length);
}

export const cookieHeader = (cs: Cookie[]) => cs.map((c) => `${c.name}=${c.value}`).join("; ");

/** The cookie as a Set-Cookie line (for the jar editor). */
export function toSetCookie(c: Cookie): string {
  const parts = [`${c.name}=${c.value}`, `Path=${c.path}`];
  if (!c.hostOnly) parts.push(`Domain=${c.domain}`);
  if (c.expires) parts.push(`Expires=${new Date(c.expires).toUTCString()}`);
  if (c.secure) parts.push("Secure");
  if (c.httpOnly) parts.push("HttpOnly");
  if (c.sameSite) parts.push(`SameSite=${c.sameSite}`);
  return parts.join("; ");
}
