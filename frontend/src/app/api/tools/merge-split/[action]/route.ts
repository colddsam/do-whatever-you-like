import type { NextRequest } from "next/server";
import { apiError, proxyUpload } from "@/lib/backend";

/**
 * Merge and split (backend/app/api/v1/endpoints/merge_split.py).
 * POST /api/tools/merge-split/inspect → one `file` in, what it holds (pages, slides, headings, sheets) back as JSON
 * POST /api/tools/merge-split/split   → `file` + `plan` (JSON) in, a ZIP of parts back
 * POST /api/tools/merge-split/merge   → `files` + `options` (JSON) in, one file back
 */

const MAX_MB = 150; // Matches MAX_DOWNLOAD_SIZE_MB in backend/app/core/config.py.

const ACTIONS = {
  inspect: { timeoutMs: 4 * 60_000, failed: "We couldn't read that file." },
  split: { timeoutMs: 16 * 60_000, failed: "We couldn't split that file." },
  merge: { timeoutMs: 16 * 60_000, failed: "We couldn't merge those files." },
} as const;

type Action = keyof typeof ACTIONS;
const isAction = (v: string): v is Action => Object.hasOwn(ACTIONS, v);

export async function POST(req: NextRequest, ctx: RouteContext<"/api/tools/merge-split/[action]">) {
  const { action } = await ctx.params;
  if (!isAction(action)) return apiError(404, "Unknown action.");
  const cfg = ACTIONS[action];
  return proxyUpload(req, `merge-split/${action}`, {
    maxMB: MAX_MB,
    timeoutMs: cfg.timeoutMs,
    messages: {
      badBody: "Send the files as form data.",
      tooBig: `Together the files are over ${MAX_MB} MB.`,
      timeout: "That took too long. Try smaller files.",
      unreachable: "Couldn't reach the merge and split service. Is the backend running?",
      failed: cfg.failed,
    },
  });
}
