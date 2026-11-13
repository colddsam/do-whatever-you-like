import type { NextRequest } from "next/server";
import { apiError, postJson } from "@/lib/backend";

/**
 * Developer and network tools (backend/app/api/v1/endpoints/devtools.py): JSON in, JSON out.
 * POST /api/tools/devtools/{dns|reverse|port|http|xsd|xslt}
 */

const ACTIONS: Record<string, { maxBytes: number; timeoutMs: number; failed: string }> = {
  dns: { maxBytes: 4_000, timeoutMs: 30_000, failed: "The DNS lookup failed." },
  reverse: { maxBytes: 1_000, timeoutMs: 20_000, failed: "The reverse lookup failed." },
  port: { maxBytes: 1_000, timeoutMs: 20_000, failed: "The port check failed." },
  http: { maxBytes: 1_200_000, timeoutMs: 60_000, failed: "The request failed." },
  xsd: { maxBytes: 4_000_000, timeoutMs: 60_000, failed: "The XML couldn't be validated." },
  xslt: { maxBytes: 4_000_000, timeoutMs: 60_000, failed: "The XML couldn't be transformed." },
};

export const maxDuration = 60;

export async function POST(req: NextRequest, ctx: RouteContext<"/api/tools/devtools/[action]">) {
  const { action } = await ctx.params;
  const opts = ACTIONS[action];
  if (!opts) return apiError(404, "Unknown action.");
  return postJson(req, `devtools/${action}`, opts);
}
