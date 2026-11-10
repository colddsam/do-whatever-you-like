// Server-only: imported by route handlers, never by client components.
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
  for (const h of ["content-type", "content-length", "content-disposition"]) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  // Next may re-chunk streamed bodies and drop Content-Length; keep the size for progress bars.
  const size = upstream.headers.get("content-length");
  if (size) headers.set("x-file-size", size);
  return new Response(upstream.body, { status: 200, headers });
}
