import type { NextRequest } from "next/server";
import { apiError, proxyUpload } from "@/lib/backend";

/**
 * Font checker (backend/app/api/v1/endpoints/fonts.py).
 * POST /api/tools/fonts/inspect  → a font file (+ `index` for collections) in, a JSON report back
 * POST /api/tools/fonts/document → a document in, the fonts it uses (and embedded font files) back
 */

const ACTIONS = {
  inspect: { maxMB: 60, failed: "We couldn't check that font." },
  document: { maxMB: 150, failed: "We couldn't read the fonts in that file." },
} as const;

export async function POST(req: NextRequest, ctx: RouteContext<"/api/tools/fonts/[action]">) {
  const { action } = await ctx.params;
  if (!Object.hasOwn(ACTIONS, action)) return apiError(404, "Unknown action.");
  const cfg = ACTIONS[action as keyof typeof ACTIONS];
  return proxyUpload(req, `fonts/${action}`, {
    maxMB: cfg.maxMB,
    timeoutMs: 4 * 60_000,
    messages: {
      badBody: "Send the file as form data.",
      tooBig: `That file is over ${cfg.maxMB} MB.`,
      timeout: "That took too long. Try a smaller file.",
      unreachable: "Couldn't reach the font service. Is the backend running?",
      failed: cfg.failed,
    },
  });
}
