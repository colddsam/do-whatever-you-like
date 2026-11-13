import type { NextRequest } from "next/server";

/**
 * "What is my IP": the visitor's address as this server sees it, plus what the host's edge knows
 * about it (Vercel adds country, region and city headers). Nothing is stored or logged.
 */
export function GET(req: NextRequest) {
  const h = req.headers;
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = h.get("x-real-ip") ?? forwarded ?? h.get("cf-connecting-ip") ?? null;
  const decode = (v: string | null) => {
    if (!v) return null;
    try {
      return decodeURIComponent(v);
    } catch {
      return v;
    }
  };
  const local = !ip || ip === "::1" || ip === "127.0.0.1" || ip.startsWith("::ffff:127.");
  return Response.json(
    {
      ip: local ? null : ip,
      local,
      version: local ? null : ip!.includes(":") && !ip!.startsWith("::ffff:") ? 6 : 4,
      country: h.get("x-vercel-ip-country") ?? h.get("cf-ipcountry"),
      region: decode(h.get("x-vercel-ip-country-region")),
      city: decode(h.get("x-vercel-ip-city")),
      timezone: h.get("x-vercel-ip-timezone"),
      latitude: h.get("x-vercel-ip-latitude"),
      longitude: h.get("x-vercel-ip-longitude"),
      userAgent: h.get("user-agent"),
      language: h.get("accept-language")?.split(",")[0] ?? null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
