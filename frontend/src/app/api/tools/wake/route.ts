import { backendConfig } from "@/lib/backend";

/**
 * Wakes the backend. Render's free instance sleeps after 15 idle minutes and takes 30-60 s to
 * boot, so tool pages call this as they open: the server boots while you paste a link, and the
 * real request doesn't pay for the cold start. Answers at once; the ping carries on server-side.
 */
export const maxDuration = 60;

export async function GET() {
  const backend = backendConfig();
  if (!backend) return Response.json({ ok: false }, { status: 503 });
  try {
    const res = await fetch(backend.endpoint("health"), {
      headers: { Authorization: `Bearer ${backend.token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(55_000),
    });
    return Response.json({ ok: res.ok }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ ok: false }, { headers: { "Cache-Control": "no-store" } });
  }
}
