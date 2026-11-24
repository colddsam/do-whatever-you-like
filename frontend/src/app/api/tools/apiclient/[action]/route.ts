import type { NextRequest } from "next/server";
import { apiError, postJson } from "@/lib/backend";

/**
 * The API client's relay (backend/app/api/v1/endpoints/apiclient.py): JSON in, JSON out.
 * POST /api/tools/apiclient/{send|grpc}
 */

const ACTIONS: Record<string, { maxBytes: number; timeoutMs: number; failed: string }> = {
  send: { maxBytes: 4_400_000, timeoutMs: 59_000, failed: "The request couldn't be sent." },
  grpc: { maxBytes: 4_400_000, timeoutMs: 59_000, failed: "The gRPC call failed." },
};

export const maxDuration = 60;

export async function POST(req: NextRequest, ctx: RouteContext<"/api/tools/apiclient/[action]">) {
  const { action } = await ctx.params;
  const opts = ACTIONS[action];
  if (!opts) return apiError(404, "Unknown action.");
  return postJson(req, `apiclient/${action}`, opts);
}
