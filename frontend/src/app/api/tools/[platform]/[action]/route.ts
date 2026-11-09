import type { NextRequest } from "next/server";

/**
 * Backend-for-frontend proxy for the downloader tools.
 *
 * The FastAPI service requires a secret bearer token, so the browser talks to this
 * route and the token stays on the server. File downloads are streamed straight
 * through, never buffered here.
 */

const PLATFORMS = ["youtube", "instagram", "facebook"] as const;
const ACTIONS = ["extract", "download"] as const;
type Platform = (typeof PLATFORMS)[number];
type Action = (typeof ACTIONS)[number];

const EXTRACT_TIMEOUT_MS = 60_000;
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;

const isPlatform = (v: string): v is Platform => (PLATFORMS as readonly string[]).includes(v);
const isAction = (v: string): v is Action => (ACTIONS as readonly string[]).includes(v);

function error(status: number, detail: string) {
  return Response.json({ detail }, { status });
}

/** FastAPI returns `detail` as a string, or as a list of validation errors. */
function readDetail(body: unknown): string | undefined {
  if (!body || typeof body !== "object" || !("detail" in body)) return undefined;
  const detail = (body as { detail: unknown }).detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail) && detail[0] && typeof detail[0].msg === "string") return detail[0].msg;
  return undefined;
}

export async function POST(req: NextRequest, ctx: RouteContext<"/api/tools/[platform]/[action]">) {
  const { platform, action } = await ctx.params;
  if (!isPlatform(platform) || !isAction(action)) return error(404, "Unknown tool.");

  const baseUrl = process.env.BACKEND_URL;
  const token = process.env.BACKEND_TOKEN;
  if (!baseUrl || !token) {
    return error(503, "The downloader service isn't configured yet. Set BACKEND_URL and BACKEND_TOKEN.");
  }

  let url: unknown;
  try {
    ({ url } = await req.json());
  } catch {
    return error(400, "Send a JSON body with a `url` field.");
  }
  if (typeof url !== "string" || url.trim().length < 5 || url.length > 512) {
    return error(400, "Paste a full link to a public post.");
  }

  // Instagram's schema names the field differently from the other two.
  const payload = platform === "instagram" ? { url_or_shortcode: url.trim() } : { url: url.trim() };

  let upstream: Response;
  try {
    upstream = await fetch(`${baseUrl.replace(/\/$/, "")}/api/v1/${platform}/${action}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.any([
        req.signal,
        AbortSignal.timeout(action === "extract" ? EXTRACT_TIMEOUT_MS : DOWNLOAD_TIMEOUT_MS),
      ]),
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "TimeoutError") {
      return error(504, "That took too long. Try again, or try a shorter video.");
    }
    return error(502, "Couldn't reach the downloader service. Is the backend running?");
  }

  if (!upstream.ok) {
    const body = await upstream.json().catch(() => null);
    // Never leak the backend's auth failure as-is; it's a server misconfiguration.
    if (upstream.status === 401) return error(502, "The downloader service rejected our credentials.");
    return error(upstream.status, readDetail(body) ?? "Something went wrong fetching that link.");
  }

  if (action === "extract") {
    return Response.json(await upstream.json(), { headers: { "Cache-Control": "no-store" } });
  }

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
