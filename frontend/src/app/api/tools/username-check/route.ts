import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { backendConfig } from "@/lib/backend";
import {
  formatServiceHandle,
  formatServiceUrl,
  SERVICE_MAP,
  type AvailabilityStatus,
  type ServiceCheckResult,
} from "@/lib/username";

export const maxDuration = 30;

const UA = "Mozilla/5.0 (compatible; DoWhateverYouLike-HandleCheck/1.0; +https://do-whatever-you-like.colddsam.com)";
const PROBE_TIMEOUT_MS = 3500;
const BACKEND_IG_TIMEOUT_MS = 24_000;
const BACKEND_META_TIMEOUT_MS = 24_000;
const BACKEND_META_SERVICES = new Set(["facebook"]);

let igFallbackCanary = {
  ok: false,
  checkedAt: 0,
  cooldownUntil: 0,
};
let igCanaryInFlight: Promise<boolean> | null = null;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function fetchInstagramHtmlSignals(username: string): Promise<"occupied" | "empty_200" | "blocked"> {
  const lower = username.toLowerCase();
  const targetUrl = `https://www.instagram.com/${encodeURIComponent(username)}/`;
  const userRegex = new RegExp(`"username"\\s*:\\s*"${escapeRegex(lower)}"`, "i");
  const ogRegex = /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i;

  const headerProfiles: Record<string, string>[] = [
    {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Sec-Fetch-User": "?1",
    },
    {
      "User-Agent": "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
  ];

  for (const headers of headerProfiles) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6500);
      let res: Response;
      try {
        res = await fetch(targetUrl, {
          headers,
          redirect: "manual",
          cache: "no-store",
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      const location = (res.headers.get("location") ?? "").toLowerCase();
      if (res.status === 403 || res.status === 429 || (res.status >= 300 && res.status < 400) || location.includes("login")) {
        continue;
      }
      if (res.status !== 200) {
        continue;
      }
      const html = await res.text();
      const ogText = (html.match(ogRegex)?.[1] ?? "").toLowerCase();
      if (
        html.includes("xig_user_by_username") ||
        userRegex.test(html) ||
        ogText.includes(`@${lower}`) ||
        ogText.includes(`&#064;${lower}`)
      ) {
        return "occupied";
      }
      if (html.length > 0) {
        return "empty_200";
      }
    } catch {
      // Try next header profile.
    }
  }
  return "blocked";
}

async function verifyInstagramPublicCanary(): Promise<boolean> {
  const now = Date.now();
  if (now < igFallbackCanary.cooldownUntil) {
    return false;
  }
  if (igFallbackCanary.ok && now - igFallbackCanary.checkedAt < 30_000) {
    return true;
  }
  if (igCanaryInFlight) {
    return igCanaryInFlight;
  }
  igCanaryInFlight = (async () => {
    try {
      const res = await fetchInstagramHtmlSignals("instagram");
      const ok = res === "occupied";
      const ts = Date.now();
      igFallbackCanary = ok
        ? { ok: true, checkedAt: ts, cooldownUntil: 0 }
        : { ok: false, checkedAt: ts, cooldownUntil: ts + 12_000 };
      return ok;
    } finally {
      igCanaryInFlight = null;
    }
  })();
  return igCanaryInFlight;
}

async function probeInstagramPublicFallback(
  username: string,
): Promise<{ status: AvailabilityStatus; detail: string }> {
  const signal = await fetchInstagramHtmlSignals(username);
  if (signal === "occupied") {
    return {
      status: "occupied",
      detail: `@${username} is occupied on Instagram (cookie-free public profile check)`,
    };
  }
  if (signal === "empty_200" && username.toLowerCase() !== "instagram" && (await verifyInstagramPublicCanary())) {
    return {
      status: "available",
      detail: "No active public Instagram profile found (cookie-free check) — click link to confirm signup",
    };
  }
  if (signal === "empty_200") {
    return {
      status: "unverified",
      detail: "Instagram rate-limited anonymous lookups without cookies — click link to confirm",
    };
  }
  return {
    status: "unverified",
    detail: "Could not confirm Instagram anonymously right now — click link to verify",
  };
}
let tiktokUnreachableUntil = 0;
let redditAvailCooldownUntil = 0;
let redditRssCooldownUntil = 0;

const EMAIL_DOMAIN_BY_SERVICE: Record<string, string> = {
  gmail: "gmail.com",
  outlook: "outlook.com",
  proton_me: "proton.me",
  icloud: "icloud.com",
  yahoo: "yahoo.com",
  mail_ru: "mail.ru",
};

const CUSTOM_DOMAIN_TLD: Record<string, string> = {
  domain_com: "com",
  domain_dev: "dev",
  domain_io: "io",
  domain_in: "in",
};

function sha256Hex(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

async function fetchTimed(
  url: string,
  init: RequestInit = {},
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<Response> {
  return fetch(url, {
    ...init,
    cache: "no-store",
    redirect: "follow",
    headers: {
      "User-Agent": UA,
      Accept: "application/json,text/html,text/plain,*/*",
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function checkDomainAvailability(domain: string): Promise<{ status: AvailabilityStatus; detail: string }> {
  try {
    const res = await fetchTimed(`https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=NS`, {
      headers: { Accept: "application/json" },
    });
    if (res.ok) {
      const data = (await res.json()) as { Status?: number; Answer?: unknown[]; Authority?: unknown[] };
      if (data.Status === 3) {
        return { status: "available", detail: `${domain} has no DNS records (NXDOMAIN) — likely available` };
      }
      if (data.Status === 0) {
        const hasRecords = Array.isArray(data.Answer) && data.Answer.length > 0;
        return {
          status: "occupied",
          detail: hasRecords ? `${domain} is already registered (active nameservers)` : `${domain} zone already exists in DNS`,
        };
      }
    }
  } catch {
    // Fall back to Cloudflare DoH below.
  }

  try {
    const res = await fetchTimed(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=NS`, {
      headers: { Accept: "application/dns-json" },
    });
    if (res.ok) {
      const data = (await res.json()) as { Status?: number };
      if (data.Status === 3) {
        return { status: "available", detail: `${domain} returned NXDOMAIN — likely available` };
      }
      if (data.Status === 0) {
        return { status: "occupied", detail: `${domain} is already registered` };
      }
    }
  } catch {
    // Ignore transient timeout.
  }

  return { status: "unverified", detail: `Could not reach DNS resolver for ${domain}` };
}

async function checkPublicEmailIdentity(email: string, serviceName: string): Promise<{ status: AvailabilityStatus; detail: string }> {
  const hash = sha256Hex(email);
  const [gravRes, pgpRes] = await Promise.allSettled([
    fetchTimed(`https://en.gravatar.com/${hash}.json`, { headers: { Accept: "application/json" } }, 2800),
    fetchTimed(`https://keys.openpgp.org/vks/v1/by-email/${encodeURIComponent(email)}`, { headers: { Accept: "text/plain" } }, 2800),
  ]);

  if (gravRes.status === "fulfilled" && gravRes.value.status === 200) {
    return { status: "occupied", detail: `Matched an existing public Gravatar profile for ${email}` };
  }
  if (pgpRes.status === "fulfilled" && pgpRes.value.status === 200) {
    return { status: "occupied", detail: `Matched a registered OpenPGP public key for ${email}` };
  }

  return {
    status: "unclaimed_registry",
    detail: `Passes ${serviceName} handle rules & unclaimed in public key registries — click to verify at signup`,
  };
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

async function probeFacebookPublicFallback(url: string): Promise<{ status: AvailabilityStatus; detail: string; canonicalUrl?: string }> {
  try {
    const res = await fetch(url, {
      cache: "no-store",
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
      },
      signal: AbortSignal.timeout(4000),
    });

    const finalUrl = res.url || url;
    if (res.status !== 200 || /\/(login|checkpoint)/i.test(finalUrl)) {
      return {
        status: "unverified",
        detail: "No public Facebook Page matched without cookies (may be free or a private profile — click link to confirm)",
      };
    }

    const html = (await res.text()).slice(0, 300_000);
    const low = html.toLowerCase();
    if (
      low.includes("this content isn't available") ||
      low.includes("this content isn&#039;t available") ||
      low.includes("this page isn't available") ||
      low.includes("log in or sign up to view")
    ) {
      return {
        status: "unverified",
        detail: "No public Facebook Page matched without cookies (may be free or a private profile — click link to confirm)",
      };
    }

    const og =
      html.match(/<meta[^>]+(?:property|name)=["']og:title["'][^>]+content=["']([^"']+)["']/i) ??
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']og:title["']/i);
    const title = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const entity = html.match(/"(?:pageID|userID|entity_id)"\s*:\s*"?(\d{4,})"?/);
    const rawLabel = decodeHtmlEntities((og?.[1] ?? title?.[1] ?? "").trim());
    const generic = new Set(["", "facebook", "log into facebook", "log in to facebook", "error", "watch"]);
    const label = generic.has(rawLabel.toLowerCase()) ? "" : rawLabel;

    if (label || entity) {
      return {
        status: "occupied",
        detail: `Public Facebook profile/page found${label ? ` (${label})` : ""} without cookies`,
        canonicalUrl: finalUrl,
      };
    }
  } catch {
    // Ignore transient timeout and fall back to manual verification link.
  }

  return {
    status: "unverified",
    detail: "No public Facebook Page matched without cookies (may be free or a private profile — click link to confirm)",
  };
}

async function probeTikTokPublicFallback(url: string): Promise<{ status: AvailabilityStatus; detail: string }> {
  if (Date.now() < tiktokUnreachableUntil) {
    return {
      status: "unverified",
      detail: "TikTok is unreachable from this network region (works on Vercel/Render US & EU) — click link to confirm",
    };
  }

  try {
    const res = await fetch(url, {
      cache: "no-store",
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(2500),
    });

    if (res.status === 200) {
      const html = (await res.text()).slice(0, 600_000);
      const match = html.match(/<script[^>]+id=["']__UNIVERSAL_DATA_FOR_REHYDRATION__["'][^>]*>([\s\S]*?)<\/script>/i);
      if (match?.[1]) {
        const payload = JSON.parse(match[1]) as {
          __DEFAULT_SCOPE__?: {
            "webapp.user-detail"?: {
              statusCode?: number;
              userInfo?: { user?: { id?: string; uniqueId?: string } };
            };
          };
        };
        const detail = payload.__DEFAULT_SCOPE__?.["webapp.user-detail"];
        if (detail?.statusCode === 0 && detail.userInfo?.user?.id) {
          const uid = detail.userInfo.user.uniqueId;
          return {
            status: "occupied",
            detail: `${uid ? `@${uid}` : "TikTok account"} exists on TikTok (cookie-free public check)`,
          };
        }
        if (detail?.statusCode === 10221 || detail?.statusCode === 10202) {
          return {
            status: "available",
            detail: "No active TikTok profile found (cookie-free check) — click link to confirm signup",
          };
        }
      }
    }
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    const msg = err instanceof Error ? err.message.toLowerCase() : "";
    if (name === "TimeoutError" || name === "AbortError" || msg.includes("fetch failed") || msg.includes("connect")) {
      tiktokUnreachableUntil = Date.now() + 60_000;
      return {
        status: "unverified",
        detail: "TikTok is unreachable from this network region (works on Vercel/Render US & EU) — click link to confirm",
      };
    }
  }

  return {
    status: "unverified",
    detail: "TikTok challenged anonymous request — click link to confirm directly",
  };
}

async function probeXHandle(
  username: string,
  encodedU: string,
): Promise<{ status: AvailabilityStatus; detail: string }> {
  const browserUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";
  try {
    const res = await fetchTimed(
      `https://api.twitter.com/i/users/username_available.json?username=${encodedU}`,
      { headers: { "User-Agent": browserUA, Accept: "application/json" } },
      4000,
    );
    if (res.status === 200) {
      const data = (await res.json()) as { valid?: boolean; reason?: string; desc?: string };
      if (data.valid === true || data.reason === "available") {
        return { status: "available", detail: "Available on X (Twitter)" };
      }
      if (data.reason === "taken") {
        return { status: "occupied", detail: `@${username} is already taken on X (Twitter)` };
      }
      if (data.reason === "is_banned_word" || data.reason === "contains_banned_word") {
        return { status: "occupied", detail: "Unavailable or reserved handle on X (Twitter)" };
      }
      if (data.reason === "invalid_username") {
        return { status: "invalid", detail: data.desc || "Invalid X handle format" };
      }
    }
  } catch {
    // Fall through to oEmbed backup.
  }

  try {
    const oembed = await fetchTimed(
      `https://publish.twitter.com/oembed?url=${encodeURIComponent(`https://twitter.com/${username}`)}`,
      { headers: { "User-Agent": browserUA, Accept: "application/json" } },
      3500,
    );
    if (oembed.status === 200) {
      return { status: "occupied", detail: `@${username} exists on X (Twitter)` };
    }
  } catch {
    // Ignore transient error.
  }

  return { status: "unverified", detail: `Could not confirm @${username} on X right now — click link to check` };
}

async function probeRedditHandle(
  username: string,
  encodedU: string,
): Promise<{ status: AvailabilityStatus; detail: string }> {
  const browserUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";

  // 1) Direct unauthenticated endpoint (works cleanly from unblocked networks).
  if (Date.now() >= redditAvailCooldownUntil) {
    try {
      const res = await fetchTimed(
        `https://www.reddit.com/api/username_available.json?user=${encodedU}`,
        { headers: { "User-Agent": browserUA, Accept: "application/json" } },
        3200,
      );
      if (res.status === 200) {
        const text = (await res.text()).trim();
        if (text === "true") return { status: "available", detail: "Available on Reddit" };
        if (text === "false") return { status: "occupied", detail: "Occupied on Reddit" };
      } else if (res.status === 403 || res.status === 429) {
        redditAvailCooldownUntil = Date.now() + 60_000;
      }
    } catch {
      // Fall through to RSS + public archive.
    }
  }

  // 2) Atom RSS feed probe (returns 200 Atom for active accounts, 404 Atom for nonexistent handles) with 429 cooldown.
  if (Date.now() >= redditRssCooldownUntil) {
    try {
      const rss = await fetchTimed(
        `https://www.reddit.com/user/${encodedU}/.rss`,
        {
          headers: {
            "User-Agent": "desktop:dwyl.handlecheck:v1.0 (by /u/dwyl_checker)",
            Accept: "application/atom+xml,application/xml,text/xml",
          },
        },
        3200,
      );
      if (rss.status === 429) {
        redditRssCooldownUntil = Date.now() + 60_000;
      } else {
        const head = (await rss.text()).slice(0, 300);
        if (rss.status === 200 && head.includes("<feed")) {
          return { status: "occupied", detail: `u/${username} is active on Reddit` };
        }
        if (rss.status === 404 && head.includes("<feed")) {
          return { status: "available", detail: "Available on Reddit" };
        }
      }
    } catch {
      // Continue to archive fallback.
    }
  }

  // 3) Public Reddit archive fallback (Arctic Shift) when Reddit blocks datacenter/server IPs with 403/429.
  try {
    const arch = await fetchTimed(
      `https://arctic-shift.photon-reddit.com/api/users/search?author=${encodedU}`,
      { headers: { Accept: "application/json" } },
      3800,
    );
    if (arch.status === 200) {
      const json = (await arch.json()) as { data?: Array<{ author?: string; name?: string }> };
      const target = username.toLowerCase();
      const hit = (json.data ?? []).some((row) => (row.author ?? row.name ?? "").toLowerCase() === target);
      if (hit) {
        return {
          status: "occupied",
          detail: `Matched active Reddit post/comment history for u/${username} (public archive check)`,
        };
      }
    }
  } catch {
    // Ignore transient archive error.
  }

  return {
    status: "unverified",
    detail: `Reddit blocked live checks from this IP & no public post history matched u/${username} — click link to confirm`,
  };
}

async function fetchBackendServiceProbes(
  usernames: string[],
  services: string[],
  targetServices: string[],
  timeoutMs: number,
): Promise<{ attempted: boolean; map: Map<string, ServiceCheckResult> }> {
  const map = new Map<string, ServiceCheckResult>();
  const backend = backendConfig();
  const wanted = services.filter((id) => targetServices.includes(id));
  if (!backend || wanted.length === 0) {
    return { attempted: false, map };
  }

  const validPairs = wanted.filter((svcId) =>
    usernames.some((u) => SERVICE_MAP.get(svcId)?.validate(u).valid),
  );
  const validUsernames = usernames.filter((u) =>
    validPairs.some((svcId) => SERVICE_MAP.get(svcId)?.validate(u).valid),
  );

  if (validPairs.length === 0 || validUsernames.length === 0) {
    return { attempted: false, map };
  }

  try {
    const res = await fetch(backend.endpoint("devtools/username-check"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${backend.token}`,
      },
      body: JSON.stringify({ usernames: validUsernames, services: validPairs }),
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (res.ok) {
      const data = (await res.json()) as { results?: Record<string, ServiceCheckResult[]> };
      if (data?.results && typeof data.results === "object") {
        for (const [uname, items] of Object.entries(data.results)) {
          if (!Array.isArray(items)) continue;
          for (const item of items) {
            map.set(`${item.serviceId}::${uname}`, item);
          }
        }
      }
    }
  } catch {
    // Backend may be sleeping (Render cold start) or offline; callers fall back cleanly.
  }

  return { attempted: true, map };
}

async function probeService(
  serviceId: string,
  username: string,
  metaBackendPromise?: Promise<{ attempted: boolean; map: Map<string, ServiceCheckResult> }>,
  igBackendPromise?: Promise<{ attempted: boolean; map: Map<string, ServiceCheckResult> }>,
): Promise<ServiceCheckResult> {
  const svc = SERVICE_MAP.get(serviceId);
  const started = Date.now();

  if (!svc) {
    return {
      serviceId,
      username,
      status: "invalid",
      detail: "Unsupported service.",
      url: "",
    };
  }

  const url = formatServiceUrl(svc, username);
  const validity = svc.validate(username);
  if (!validity.valid) {
    return {
      serviceId,
      username,
      status: "invalid",
      detail: validity.reason ?? "Does not meet platform rules.",
      url,
      latencyMs: Date.now() - started,
    };
  }

  const u = encodeURIComponent(username);
  const lower = encodeURIComponent(username.toLowerCase());
  const finish = (status: AvailabilityStatus, detail: string): ServiceCheckResult => ({
    serviceId,
    username,
    status,
    detail,
    url,
    latencyMs: Date.now() - started,
  });

  try {
    // 1. Custom domain mail checks
    if (serviceId in CUSTOM_DOMAIN_TLD) {
      const domain = `${username.toLowerCase()}.${CUSTOM_DOMAIN_TLD[serviceId]}`;
      const res = await checkDomainAvailability(domain);
      return finish(res.status, res.detail);
    }

    // 2. Live Mail.ru account existence endpoint
    if (serviceId === "mail_ru") {
      const email = formatServiceHandle(svc, username.toLowerCase());
      const res = await fetchTimed(`https://account.mail.ru/api/v1/user/exists?email=${encodeURIComponent(email)}`);
      if (res.ok) {
        const json = (await res.json()) as { body?: { exists?: boolean } };
        if (json?.body?.exists === true) return finish("occupied", `${email} is already registered`);
        if (json?.body?.exists === false) return finish("available", `${email} is available`);
      }
      return finish("unverified", "Mail.ru availability check throttled — click link to confirm");
    }

    // 3. Major freemail rules + Gravatar / OpenPGP public registry probes
    if (serviceId in EMAIL_DOMAIN_BY_SERVICE) {
      const email = `${username.toLowerCase()}@${EMAIL_DOMAIN_BY_SERVICE[serviceId]}`;
      const res = await checkPublicEmailIdentity(email, svc.name);
      return finish(res.status, res.detail);
    }

    // 4. Deterministic social/developer/creator/gaming probes
    switch (serviceId) {
      case "github": {
        const res = await fetchTimed(`https://github.com/${u}`);
        if (res.status === 404) return finish("available", "No GitHub user or organization at this handle");
        if (res.status === 200) return finish("occupied", "GitHub profile or organization exists");
        break;
      }
      case "youtube": {
        const res = await fetchTimed(`https://www.youtube.com/@${u}`);
        if (res.status === 404) return finish("available", "No YouTube channel uses this @handle");
        if (res.status === 200) return finish("occupied", "YouTube @handle is already claimed");
        break;
      }
      case "bluesky": {
        const res = await fetchTimed(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${lower}.bsky.social`);
        if (res.status === 200) return finish("occupied", `${username.toLowerCase()}.bsky.social is active`);
        if (res.status === 400) {
          const text = await res.text().catch(() => "");
          if (text.includes("Profile not found")) {
            return finish("available", `${username.toLowerCase()}.bsky.social is available`);
          }
        }
        break;
      }
      case "mastodon": {
        const res = await fetchTimed(`https://mastodon.social/api/v1/accounts/lookup?acct=${lower}`);
        if (res.status === 404) return finish("available", "Available on mastodon.social");
        if (res.status === 200) return finish("occupied", "Account exists on mastodon.social");
        break;
      }
      case "devto": {
        const res = await fetchTimed(`https://dev.to/api/users/by_username?url=${lower}`);
        if (res.status === 404) return finish("available", "Available on DEV Community");
        if (res.status === 200) return finish("occupied", "Claimed on DEV Community");
        break;
      }
      case "gitlab": {
        const res = await fetchTimed(`https://gitlab.com/api/v4/users?username=${lower}`);
        if (res.ok) {
          const arr = (await res.json()) as unknown[];
          if (Array.isArray(arr) && arr.length === 0) return finish("available", "Available on GitLab");
          if (Array.isArray(arr) && arr.length > 0) return finish("occupied", "Claimed on GitLab");
        }
        break;
      }
      case "huggingface": {
        const res = await fetchTimed(`https://huggingface.co/${u}`);
        if (res.status === 404) return finish("available", "Available on Hugging Face");
        if (res.status === 200) return finish("occupied", "Claimed on Hugging Face");
        break;
      }
      case "hackernews": {
        const res = await fetchTimed(`https://hacker-news.firebaseio.com/v0/user/${u}.json`);
        if (res.ok) {
          const txt = (await res.text()).trim();
          if (txt === "null") return finish("available", "Available on Hacker News");
          if (txt.startsWith("{")) return finish("occupied", "Claimed on Hacker News");
        }
        break;
      }
      case "npm": {
        const res = await fetchTimed(`https://registry.npmjs.org/-/v1/search?text=maintainer:${lower}&size=1`);
        if (res.ok) {
          const json = (await res.json()) as { total?: number };
          if (json.total === 0) return finish("available", "No published npm packages under this maintainer handle");
          if (typeof json.total === "number" && json.total > 0) return finish("occupied", "Active npm maintainer handle found");
        }
        break;
      }
      case "crates": {
        const res = await fetchTimed(`https://crates.io/api/v1/users/${lower}`);
        if (res.status === 404) return finish("available", "Available on crates.io");
        if (res.status === 200) return finish("occupied", "Claimed on crates.io");
        break;
      }
      case "rubygems": {
        const res = await fetchTimed(`https://rubygems.org/api/v1/profiles/${lower}.json`);
        if (res.status === 404) return finish("available", "Available on RubyGems");
        if (res.status === 200) return finish("occupied", "Claimed on RubyGems");
        break;
      }
      case "dockerhub": {
        const res = await fetchTimed(`https://hub.docker.com/v2/users/${lower}/`);
        if (res.status === 404) return finish("available", "Available on Docker Hub");
        if (res.status === 200) return finish("occupied", "Claimed on Docker Hub");
        break;
      }
      case "chess": {
        const res = await fetchTimed(`https://api.chess.com/pub/player/${lower}`);
        if (res.status === 404) return finish("available", "Available on Chess.com");
        if (res.status === 200) return finish("occupied", "Player exists on Chess.com");
        break;
      }
      case "lichess": {
        const res = await fetchTimed(`https://lichess.org/api/user/${lower}`);
        if (res.status === 404) return finish("available", "Available on Lichess");
        if (res.status === 200) return finish("occupied", "Player exists on Lichess");
        break;
      }
      case "minecraft": {
        const res = await fetchTimed(`https://api.mojang.com/users/profiles/minecraft/${u}`);
        if (res.status === 404 || res.status === 204) return finish("available", "No Minecraft Java profile with this IGN");
        if (res.status === 200) return finish("occupied", "Minecraft Java IGN is taken");
        break;
      }
      case "scratch": {
        const res = await fetchTimed(`https://api.scratch.mit.edu/users/${u}`);
        if (res.status === 404) return finish("available", "Available on Scratch");
        if (res.status === 200) return finish("occupied", "Claimed on Scratch");
        break;
      }
      case "reddit": {
        const rd = await probeRedditHandle(username, u);
        return finish(rd.status, rd.detail);
      }
      case "instagram": {
        if (igBackendPromise) {
          const { map } = await igBackendPromise;
          const backendHit = map.get(`instagram::${username}`);
          if (backendHit && (backendHit.status === "occupied" || backendHit.status === "available")) {
            return {
              ...backendHit,
              url: backendHit.url || url,
              latencyMs: backendHit.latencyMs ?? Date.now() - started,
            };
          }
        }
        const fb = await probeInstagramPublicFallback(username);
        return finish(fb.status, fb.detail);
      }
      case "facebook": {
        if (metaBackendPromise) {
          const { map } = await metaBackendPromise;
          const backendHit = map.get(`facebook::${username}`);
          if (backendHit) {
            return {
              ...backendHit,
              url: backendHit.url || url,
              latencyMs: backendHit.latencyMs ?? Date.now() - started,
            };
          }
        }
        const fb = await probeFacebookPublicFallback(url);
        return {
          serviceId,
          username,
          status: fb.status,
          detail: fb.detail,
          url: fb.canonicalUrl || url,
          latencyMs: Date.now() - started,
        };
      }
      case "x": {
        const xRes = await probeXHandle(username, u);
        return finish(xRes.status, xRes.detail);
      }
      case "tiktok": {
        const tt = await probeTikTokPublicFallback(url);
        if (tt.status === "occupied" || tt.status === "available") {
          return finish(tt.status, tt.detail);
        }
        const ttBackend = await fetchBackendServiceProbes([username], ["tiktok"], ["tiktok"], 14_000);
        const backendHit = ttBackend.map.get(`tiktok::${username}`);
        if (backendHit && (backendHit.status === "occupied" || backendHit.status === "available")) {
          return {
            ...backendHit,
            url: backendHit.url || url,
            latencyMs: backendHit.latencyMs ?? Date.now() - started,
          };
        }
        return finish(tt.status, tt.detail);
      }
      default:
        break;
    }
  } catch {
    // Individual platform timeout/error shouldn't fail the batch.
  }

  return finish("unverified", `Could not confirm ${svc.name} right now — click link to verify`);
}

export async function POST(req: NextRequest) {
  let body: { usernames?: unknown; services?: unknown };
  try {
    body = (await req.json()) as { usernames?: unknown; services?: unknown };
  } catch {
    return Response.json({ detail: "Invalid JSON body." }, { status: 400 });
  }

  const rawUsernames = Array.isArray(body.usernames) ? body.usernames : [];
  const rawServices = Array.isArray(body.services) ? body.services : [];

  const usernames = Array.from(
    new Set(
      rawUsernames
        .filter((x): x is string => typeof x === "string")
        .map((x) => x.trim().replace(/^@+/, ""))
        .filter((x) => x.length >= 1 && x.length <= 64),
    ),
  ).slice(0, 8);

  const services = Array.from(
    new Set(
      rawServices
        .filter((x): x is string => typeof x === "string")
        .filter((id) => SERVICE_MAP.has(id)),
    ),
  ).slice(0, 35);

  if (usernames.length === 0 || services.length === 0) {
    return Response.json({ detail: "Provide at least one username and one service." }, { status: 400 });
  }

  // Run Instagram (cookie-free Instaloader) & Facebook (cookie-free yt-dlp) independently so slow yt-dlp batches never time out Instagram.
  const metaBackendPromise = fetchBackendServiceProbes(usernames, services, Array.from(BACKEND_META_SERVICES), BACKEND_META_TIMEOUT_MS);
  const igBackendPromise = fetchBackendServiceProbes(usernames, services, ["instagram"], BACKEND_IG_TIMEOUT_MS);

  // Run all (username, service) probes concurrently with bounded per-probe timeouts.
  const jobs: Array<Promise<ServiceCheckResult>> = [];
  for (const username of usernames) {
    for (const serviceId of services) {
      jobs.push(probeService(serviceId, username, metaBackendPromise, igBackendPromise));
    }
  }

  const results = await Promise.all(jobs);
  const byUsername: Record<string, ServiceCheckResult[]> = {};
  for (const username of usernames) byUsername[username] = [];
  for (const r of results) {
    byUsername[r.username]?.push(r);
  }

  return Response.json(
    { results: byUsername, checkedAt: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
