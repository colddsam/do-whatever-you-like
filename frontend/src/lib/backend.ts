// Server-only: imported by route handlers, never by client components.
import { createHmac } from "node:crypto";

/**
 * Shared bits for the route handlers that proxy to the FastAPI service.
 * The backend needs a secret bearer token, so the browser only ever talks to /api/tools/*.
 */

export function apiError(status: number, detail: string) {
  return Response.json({ detail }, { status });
}

/** BACKEND_URL + BACKEND_TOKEN, or null when the server isn't configured. */
export function backendConfig() {
  const baseUrl = process.env.BACKEND_URL;
  const token = process.env.BACKEND_TOKEN;
  if (!baseUrl || !token) return null;
  return { endpoint: (path: string) => `${baseUrl.replace(/\/$/, "")}/api/v1/${path}`, token };
}

/** How long a direct-upload ticket stays valid. It's checked when the upload starts, not when it ends. */
const TICKET_SECONDS = 15 * 60;

/**
 * Direct mode, for hosts that cap what a route handler may receive (Vercel: 4.5 MB per request,
 * 300 s per call). Instead of forwarding the bytes, the route signs a short-lived ticket for one
 * backend endpoint and the browser sends the file straight to BACKEND_PUBLIC_URL with it.
 * The bearer token never leaves the server; backend/app/auth/authorization.py checks the ticket.
 * Off (null) when BACKEND_PUBLIC_URL isn't set, e.g. in local development.
 */
export function directTarget(path: string, maxBytes: number) {
  const publicUrl = process.env.BACKEND_PUBLIC_URL;
  const token = process.env.BACKEND_TOKEN;
  if (!publicUrl || !token) return null;
  const url = `${publicUrl.replace(/\/$/, "")}/api/v1/${path}`;
  const expires = Math.floor(Date.now() / 1000) + TICKET_SECONDS;
  const claims = Buffer.from(JSON.stringify({ p: new URL(url).pathname, e: expires, m: maxBytes })).toString("base64url");
  const ticket = `${claims}.${createHmac("sha256", token).update(claims).digest("hex")}`;
  return { url, ticket, expires };
}

/** `POST …?direct=1` asks a file route where to send the file instead of sending it. */
export const wantsDirect = (req: Request) => new URL(req.url).searchParams.get("direct") === "1";

export const notConfigured = () =>
  apiError(503, "This tool's service isn't configured yet. Set BACKEND_URL and BACKEND_TOKEN.");

/** FastAPI returns `detail` as a string, or as a list of validation errors. */
export function readDetail(body: unknown): string | undefined {
  if (!body || typeof body !== "object" || !("detail" in body)) return undefined;
  const detail = (body as { detail: unknown }).detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail) && detail[0] && typeof detail[0].msg === "string") return detail[0].msg;
  return undefined;
}

/** Turns a failed upstream response into a safe error for the browser. */
export async function upstreamError(upstream: Response, fallback: string) {
  const body = await upstream.json().catch(() => null);
  // Never leak the backend's auth failure as-is; it's a server misconfiguration.
  if (upstream.status === 401) return apiError(502, "The tool service rejected our credentials.");
  return apiError(upstream.status, readDetail(body) ?? fallback);
}

/**
 * Streams a multipart upload straight to a FastAPI endpoint (never buffering it here) and
 * streams the resulting file back. Used by every file tool's route under app/api/tools.
 */
export async function proxyUpload(
  req: Request,
  path: string,
  {
    maxMB,
    timeoutMs = 10 * 60_000,
    messages,
  }: {
    /** Whole-request cap; a little headroom is added for the multipart boundaries. */
    maxMB: number;
    timeoutMs?: number;
    messages: { badBody: string; tooBig: string; timeout: string; unreachable: string; failed: string };
  },
) {
  const backend = backendConfig();
  if (!backend) return notConfigured();
  if (wantsDirect(req)) {
    return Response.json(directTarget(path, (maxMB + 1) * 1024 * 1024) ?? { direct: false }, {
      headers: { "Cache-Control": "no-store" },
    });
  }

  const type = req.headers.get("content-type") ?? "";
  if (!type.startsWith("multipart/form-data") || !req.body) return apiError(400, messages.badBody);

  const length = Number(req.headers.get("content-length")) || 0;
  if (length > (maxMB + 1) * 1024 * 1024) return apiError(413, messages.tooBig);

  const headers: Record<string, string> = { Authorization: `Bearer ${backend.token}`, "Content-Type": type };
  if (length) headers["Content-Length"] = String(length);

  let upstream: Response;
  try {
    upstream = await fetch(backend.endpoint(path), {
      method: "POST",
      headers,
      body: req.body,
      // Required by Node's fetch to send a streamed body.
      duplex: "half",
      cache: "no-store",
      signal: AbortSignal.any([req.signal, AbortSignal.timeout(timeoutMs)]),
    } as RequestInit & { duplex: "half" });
  } catch (e) {
    if (e instanceof DOMException && e.name === "TimeoutError") return apiError(504, messages.timeout);
    return apiError(502, messages.unreachable);
  }

  if (!upstream.ok) return upstreamError(upstream, messages.failed);
  return passFile(upstream);
}

/** Streams a file response straight through, keeping the headers the browser needs. */
export function passFile(upstream: Response) {
  const headers = new Headers({ "Cache-Control": "no-store" });
  // x-pdf-info / x-image-info / x-convert-info: tools that report what they did (pages repaired, the route taken).
  for (const h of ["content-type", "content-length", "content-disposition", "x-pdf-info", "x-image-info", "x-convert-info"]) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  // Next may re-chunk streamed bodies and drop Content-Length; keep the size for progress bars.
  const size = upstream.headers.get("content-length");
  if (size) headers.set("x-file-size", size);
  return new Response(upstream.body, { status: 200, headers });
}

/** GETs a small JSON answer from the backend (capabilities, language lists). Cached for a minute. */
export async function getJson(path: string, failed: string) {
  const backend = backendConfig();
  if (!backend) return notConfigured();
  let upstream: Response;
  try {
    upstream = await fetch(backend.endpoint(path), {
      headers: { Authorization: `Bearer ${backend.token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return apiError(502, "Couldn't reach the tool service. Is the backend running?");
  }
  if (!upstream.ok) return upstreamError(upstream, failed);
  return new Response(upstream.body, {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "private, max-age=60" },
  });
}

/** POSTs a small JSON body to the backend and passes its JSON answer back (developer tools). */
export async function postJson(req: Request, path: string, opts: { maxBytes: number; timeoutMs: number; failed: string }) {
  const backend = backendConfig();
  if (!backend) return notConfigured();
  const body = await req.text().catch(() => "");
  if (!body) return apiError(400, "Send the details as JSON.");
  if (body.length > opts.maxBytes) return apiError(413, "That's too much input for this tool.");
  let upstream: Response;
  try {
    upstream = await fetch(backend.endpoint(path), {
      method: "POST",
      headers: { Authorization: `Bearer ${backend.token}`, "Content-Type": "application/json" },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    return apiError(timedOut ? 504 : 502, timedOut ? "That took too long. Try again." : "Couldn't reach the tool service. Is the backend running?");
  }
  if (!upstream.ok) return upstreamError(upstream, opts.failed);
  return new Response(upstream.body, { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
