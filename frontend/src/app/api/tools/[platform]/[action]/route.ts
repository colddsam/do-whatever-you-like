import type { NextRequest } from "next/server";
import { apiError, backendConfig, directTarget, notConfigured, passFile, upstreamError, wantsDirect } from "@/lib/backend";

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

export async function POST(req: NextRequest, ctx: RouteContext<"/api/tools/[platform]/[action]">) {
  const { platform, action } = await ctx.params;
  if (!isPlatform(platform) || !isAction(action)) return apiError(404, "Unknown tool.");

  const backend = backendConfig();
  if (!backend) return notConfigured();

  let url: unknown;
  try {
    ({ url } = await req.json());
  } catch {
    return apiError(400, "Send a JSON body with a `url` field.");
  }
  if (typeof url !== "string" || url.trim().length < 5 || url.length > 512) {
    return apiError(400, "Paste a full link to a public post.");
  }

  // Instagram's schema names the field differently from the other two.
  const payload = platform === "instagram" ? { url_or_shortcode: url.trim() } : { url: url.trim() };

  // Downloads can outlast a hosted route's time limit, so the browser may fetch them directly.
  if (action === "download" && wantsDirect(req)) {
    const direct = directTarget(`${platform}/${action}`, 64 * 1024);
    return Response.json(direct ? { ...direct, body: payload } : { direct: false }, { headers: { "Cache-Control": "no-store" } });
  }

  let upstream: Response;
  try {
    upstream = await fetch(backend.endpoint(`${platform}/${action}`), {
      method: "POST",
      headers: { Authorization: `Bearer ${backend.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.any([
        req.signal,
        AbortSignal.timeout(action === "extract" ? EXTRACT_TIMEOUT_MS : DOWNLOAD_TIMEOUT_MS),
      ]),
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "TimeoutError") {
      return apiError(504, "That took too long. Try again, or try a shorter video.");
    }
    return apiError(502, "Couldn't reach the downloader service. Is the backend running?");
  }

  if (!upstream.ok) return upstreamError(upstream, "Something went wrong fetching that link.");

  if (action === "extract") {
    return Response.json(await upstream.json(), { headers: { "Cache-Control": "no-store" } });
  }
  return passFile(upstream);
}
