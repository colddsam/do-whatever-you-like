/**
 * Pure TypeScript Username Generator, Platform Rule Validator & Closest-Alternative Engine.
 * Zero external dependencies, 100% free & deterministic + creative variations.
 */

export type ServiceKind = "social" | "mail";

export type ServiceCategory =
  | "Social"
  | "Developer"
  | "Creator"
  | "Community"
  | "Gaming"
  | "Webmail"
  | "Domain Mail";

export type ServiceDef = {
  id: string;
  name: string;
  kind: ServiceKind;
  category: ServiceCategory;
  /** Profile or email display format, e.g. "@{u}" or "{u}@gmail.com". */
  handleFormat: string;
  /** External URL to view profile, check signup, or inspect domain. */
  urlTemplate: string;
  minLength: number;
  maxLength: number;
  ruleSummary: string;
  /** Whether automated server checks give deterministic taken/available signals (vs syntax + registry/manual verify). */
  directProbe: boolean;
  defaultEnabled: boolean;
  validate: (username: string) => { valid: boolean; reason?: string };
};

export type AvailabilityStatus =
  | "available" // Confirmed 404 / null / [] / NXDOMAIN / exists:false
  | "occupied" // Confirmed existing profile / Proton key / Gravatar / OpenPGP / registered domain / exists:true
  | "unclaimed_registry" // Webmail passes strict provider rules + not in Gravatar/OpenPGP public registries
  | "unverified" // Platform blocks anonymous bot checks (403/429); click link to verify manually
  | "invalid"; // Fails platform handle length or character rules

export type ServiceCheckResult = {
  serviceId: string;
  username: string;
  status: AvailabilityStatus;
  detail: string;
  url: string;
  latencyMs?: number;
};

export type UsernameStyle = "all" | "clean" | "professional" | "developer" | "creative" | "short";
export type SeparatorStyle = "mixed" | "none" | "underscore" | "dot" | "hyphen";

export type UsernameGenOptions = {
  name: string;
  keywords?: string;
  style?: UsernameStyle;
  separator?: SeparatorStyle;
  numberSuffix?: string;
  maxLength?: number;
  includeAffixes?: boolean;
};

export type GeneratedUsername = {
  username: string;
  category: "Exact & Clean" | "Short & Initials" | "Role & Niche" | "Prefixed" | "Suffixed" | "Creative";
  score: number;
  compatibleCount: number;
  totalServices: number;
};

function rule(
  re: RegExp,
  minLength: number,
  maxLength: number,
  msg: string,
  extra?: (u: string) => string | undefined,
): (username: string) => { valid: boolean; reason?: string } {
  return (username: string) => {
    const u = username.trim();
    if (!u) return { valid: false, reason: "Username is empty." };
    if (u.length < minLength) return { valid: false, reason: `Minimum ${minLength} characters required.` };
    if (u.length > maxLength) return { valid: false, reason: `Maximum ${maxLength} characters allowed.` };
    if (!re.test(u)) return { valid: false, reason: msg };
    const extraErr = extra?.(u);
    if (extraErr) return { valid: false, reason: extraErr };
    return { valid: true };
  };
}

export const SOCIAL_PLATFORMS: ServiceDef[] = [
  {
    id: "github",
    name: "GitHub",
    kind: "social",
    category: "Developer",
    handleFormat: "@{u}",
    urlTemplate: "https://github.com/{u}",
    minLength: 1,
    maxLength: 39,
    ruleSummary: "1–39 chars, letters, digits, single hyphens (no leading/trailing hyphen)",
    directProbe: true,
    defaultEnabled: true,
    validate: rule(/^[a-zA-Z0-9-]+$/, 1, 39, "Only letters, numbers and hyphens (-) allowed.", (u) => {
      if (u.startsWith("-") || u.endsWith("-")) return "Cannot begin or end with a hyphen.";
      if (u.includes("--")) return "Cannot contain consecutive hyphens (--).";
      return undefined;
    }),
  },
  {
    id: "youtube",
    name: "YouTube",
    kind: "social",
    category: "Creator",
    handleFormat: "@{u}",
    urlTemplate: "https://www.youtube.com/@{u}",
    minLength: 3,
    maxLength: 30,
    ruleSummary: "3–30 chars, letters, numbers, underscores, hyphens, periods",
    directProbe: true,
    defaultEnabled: true,
    validate: rule(/^[a-zA-Z0-9._-]+$/, 3, 30, "Use letters, numbers, dots (.), hyphens (-) or underscores (_).", (u) => {
      if (/^[._-]|[._-]$/.test(u)) return "Cannot start or end with punctuation.";
      return undefined;
    }),
  },
  {
    id: "bluesky",
    name: "Bluesky",
    kind: "social",
    category: "Social",
    handleFormat: "@{u}.bsky.social",
    urlTemplate: "https://bsky.app/profile/{u}.bsky.social",
    minLength: 3,
    maxLength: 20,
    ruleSummary: "3–20 chars, lowercase letters, digits and hyphens only (no underscores)",
    directProbe: true,
    defaultEnabled: true,
    validate: rule(/^[a-zA-Z0-9-]+$/, 3, 20, "Bluesky handles allow letters, numbers and hyphens (-) only.", (u) => {
      if (u.startsWith("-") || u.endsWith("-")) return "Cannot begin or end with a hyphen.";
      return undefined;
    }),
  },
  {
    id: "mastodon",
    name: "Mastodon",
    kind: "social",
    category: "Social",
    handleFormat: "@{u}@mastodon.social",
    urlTemplate: "https://mastodon.social/@{u}",
    minLength: 1,
    maxLength: 30,
    ruleSummary: "1–30 chars, letters, numbers and underscores only",
    directProbe: true,
    defaultEnabled: true,
    validate: rule(/^[a-zA-Z0-9_]+$/, 1, 30, "Only letters, numbers and underscores (_) allowed."),
  },
  {
    id: "devto",
    name: "DEV.to",
    kind: "social",
    category: "Developer",
    handleFormat: "dev.to/{u}",
    urlTemplate: "https://dev.to/{u}",
    minLength: 2,
    maxLength: 30,
    ruleSummary: "2–30 chars, letters, numbers and underscores",
    directProbe: true,
    defaultEnabled: true,
    validate: rule(/^[a-zA-Z0-9_]+$/, 2, 30, "Only letters, numbers and underscores (_) allowed."),
  },
  {
    id: "gitlab",
    name: "GitLab",
    kind: "social",
    category: "Developer",
    handleFormat: "gitlab.com/{u}",
    urlTemplate: "https://gitlab.com/{u}",
    minLength: 2,
    maxLength: 40,
    ruleSummary: "Letters, numbers, underscores, dots and hyphens (no consecutive dots)",
    directProbe: true,
    defaultEnabled: false,
    validate: rule(/^[a-zA-Z0-9._-]+$/, 2, 40, "Letters, numbers, '.', '_' and '-' only.", (u) => {
      if (/^[._-]|[._-]$/.test(u)) return "Cannot start or end with punctuation.";
      if (u.includes("..")) return "Cannot contain consecutive dots.";
      return undefined;
    }),
  },
  {
    id: "huggingface",
    name: "Hugging Face",
    kind: "social",
    category: "Developer",
    handleFormat: "hf.co/{u}",
    urlTemplate: "https://huggingface.co/{u}",
    minLength: 2,
    maxLength: 40,
    ruleSummary: "2–40 chars, letters, numbers and hyphens",
    directProbe: true,
    defaultEnabled: true,
    validate: rule(/^[a-zA-Z0-9-]+$/, 2, 40, "Letters, numbers and hyphens (-) only.", (u) => {
      if (u.startsWith("-") || u.endsWith("-")) return "Cannot begin or end with a hyphen.";
      return undefined;
    }),
  },
  {
    id: "hackernews",
    name: "Hacker News",
    kind: "social",
    category: "Community",
    handleFormat: "{u}",
    urlTemplate: "https://news.ycombinator.com/user?id={u}",
    minLength: 2,
    maxLength: 15,
    ruleSummary: "2–15 chars, letters, numbers, hyphens and underscores",
    directProbe: true,
    defaultEnabled: false,
    validate: rule(/^[a-zA-Z0-9_-]+$/, 2, 15, "2–15 chars, letters, numbers, '-' or '_' only."),
  },
  {
    id: "npm",
    name: "npm Registry",
    kind: "social",
    category: "Developer",
    handleFormat: "~{u}",
    urlTemplate: "https://www.npmjs.com/~{u}",
    minLength: 1,
    maxLength: 40,
    ruleSummary: "Lowercase URL-safe characters, digits and hyphens",
    directProbe: true,
    defaultEnabled: false,
    validate: rule(/^[a-zA-Z0-9._-]+$/, 1, 40, "URL-safe characters only."),
  },
  {
    id: "crates",
    name: "crates.io (Rust)",
    kind: "social",
    category: "Developer",
    handleFormat: "{u}",
    urlTemplate: "https://crates.io/users/{u}",
    minLength: 1,
    maxLength: 39,
    ruleSummary: "Matches GitHub login rules",
    directProbe: true,
    defaultEnabled: false,
    validate: rule(/^[a-zA-Z0-9-]+$/, 1, 39, "Letters, numbers and hyphens only."),
  },
  {
    id: "rubygems",
    name: "RubyGems",
    kind: "social",
    category: "Developer",
    handleFormat: "{u}",
    urlTemplate: "https://rubygems.org/profiles/{u}",
    minLength: 2,
    maxLength: 40,
    ruleSummary: "2–40 chars, letters, numbers, hyphens and underscores",
    directProbe: true,
    defaultEnabled: false,
    validate: rule(/^[a-zA-Z0-9_-]+$/, 2, 40, "Letters, numbers, '-' and '_' only."),
  },
  {
    id: "dockerhub",
    name: "Docker Hub",
    kind: "social",
    category: "Developer",
    handleFormat: "{u}",
    urlTemplate: "https://hub.docker.com/u/{u}",
    minLength: 4,
    maxLength: 30,
    ruleSummary: "4–30 lowercase letters and numbers only (no dots/hyphens/underscores)",
    directProbe: true,
    defaultEnabled: false,
    validate: rule(/^[a-z0-9]+$/, 4, 30, "Docker Hub requires 4–30 lowercase letters and digits only (no punctuation)."),
  },
  {
    id: "chess",
    name: "Chess.com",
    kind: "social",
    category: "Gaming",
    handleFormat: "{u}",
    urlTemplate: "https://www.chess.com/member/{u}",
    minLength: 3,
    maxLength: 25,
    ruleSummary: "3–25 chars, letters, numbers, underscores and hyphens",
    directProbe: true,
    defaultEnabled: false,
    validate: rule(/^[a-zA-Z0-9_-]+$/, 3, 25, "Letters, numbers, '-' and '_' only."),
  },
  {
    id: "lichess",
    name: "Lichess",
    kind: "social",
    category: "Gaming",
    handleFormat: "@{u}",
    urlTemplate: "https://lichess.org/@/{u}",
    minLength: 2,
    maxLength: 20,
    ruleSummary: "2–20 chars, starts with letter, letters/numbers/hyphens/underscores",
    directProbe: true,
    defaultEnabled: false,
    validate: rule(/^[a-zA-Z0-9_-]+$/, 2, 20, "Letters, numbers, '-' and '_' only.", (u) => {
      if (/[_-]{2}/.test(u)) return "Cannot have consecutive hyphens/underscores.";
      return undefined;
    }),
  },
  {
    id: "minecraft",
    name: "Minecraft Java",
    kind: "social",
    category: "Gaming",
    handleFormat: "{u}",
    urlTemplate: "https://namemc.com/profile/{u}",
    minLength: 3,
    maxLength: 16,
    ruleSummary: "3–16 chars, letters, numbers and underscores only",
    directProbe: true,
    defaultEnabled: false,
    validate: rule(/^[a-zA-Z0-9_]+$/, 3, 16, "Minecraft allows 3–16 letters, numbers and underscores (_) only."),
  },
  {
    id: "scratch",
    name: "Scratch",
    kind: "social",
    category: "Community",
    handleFormat: "@{u}",
    urlTemplate: "https://scratch.mit.edu/users/{u}/",
    minLength: 3,
    maxLength: 20,
    ruleSummary: "3–20 chars, letters, numbers, hyphens and underscores",
    directProbe: true,
    defaultEnabled: false,
    validate: rule(/^[a-zA-Z0-9_-]+$/, 3, 20, "3–20 chars, letters, numbers, '-' or '_' only."),
  },
  // Major social apps: Instagram & Facebook run cookie-free backend probes with honest fallback on rate limits or private profiles.
  {
    id: "instagram",
    name: "Instagram",
    kind: "social",
    category: "Social",
    handleFormat: "@{u}",
    urlTemplate: "https://www.instagram.com/{u}/",
    minLength: 1,
    maxLength: 30,
    ruleSummary: "1–30 chars, letters, digits, dots and underscores (no trailing/double dot)",
    directProbe: true,
    defaultEnabled: true,
    validate: rule(/^[a-zA-Z0-9._]+$/, 1, 30, "Instagram allows letters, digits, '.' and '_' only.", (u) => {
      if (u.endsWith(".")) return "Cannot end with a period (.).";
      if (u.includes("..")) return "Cannot contain consecutive periods (..).";
      return undefined;
    }),
  },
  {
    id: "facebook",
    name: "Facebook",
    kind: "social",
    category: "Social",
    handleFormat: "@{u}",
    urlTemplate: "https://www.facebook.com/{u}",
    minLength: 5,
    maxLength: 50,
    ruleSummary: "5–50 chars, letters, numbers and dots only (no underscores or hyphens)",
    directProbe: true,
    defaultEnabled: true,
    validate: rule(/^[a-zA-Z0-9.]+$/, 5, 50, "Facebook handles require 5–50 letters, numbers and periods (.) only.", (u) => {
      if (u.startsWith(".") || u.endsWith(".")) return "Cannot start or end with a period (.).";
      if (u.includes("..")) return "Cannot contain consecutive periods (..).";
      if (/\.(com|net|org)$/i.test(u)) return "Cannot end with domain extensions like .com or .net.";
      return undefined;
    }),
  },
  {
    id: "x",
    name: "X (Twitter)",
    kind: "social",
    category: "Social",
    handleFormat: "@{u}",
    urlTemplate: "https://x.com/{u}",
    minLength: 5,
    maxLength: 15,
    ruleSummary: "5–15 chars, letters, numbers and underscores only",
    directProbe: true,
    defaultEnabled: true,
    validate: rule(/^[a-zA-Z0-9_]+$/, 5, 15, "X allows 5–15 letters, numbers and underscores (_) only."),
  },
  {
    id: "tiktok",
    name: "TikTok",
    kind: "social",
    category: "Creator",
    handleFormat: "@{u}",
    urlTemplate: "https://www.tiktok.com/@{u}",
    minLength: 2,
    maxLength: 24,
    ruleSummary: "2–24 chars, letters, numbers, underscores and periods (no trailing dot)",
    directProbe: true,
    defaultEnabled: true,
    validate: rule(/^[a-zA-Z0-9._]+$/, 2, 24, "Letters, digits, '.' and '_' only.", (u) => {
      if (u.endsWith(".")) return "Cannot end with a period (.).";
      if (u.includes("..")) return "Cannot contain consecutive periods.";
      return undefined;
    }),
  },
  {
    id: "reddit",
    name: "Reddit",
    kind: "social",
    category: "Community",
    handleFormat: "u/{u}",
    urlTemplate: "https://www.reddit.com/user/{u}",
    minLength: 3,
    maxLength: 20,
    ruleSummary: "3–20 chars, letters, numbers, hyphens and underscores",
    directProbe: true,
    defaultEnabled: true,
    validate: rule(/^[a-zA-Z0-9_-]+$/, 3, 20, "Reddit allows 3–20 letters, digits, '-' and '_' only."),
  },
];

export const MAIL_SERVICES: ServiceDef[] = [
  {
    id: "gmail",
    name: "Gmail",
    kind: "mail",
    category: "Webmail",
    handleFormat: "{u}@gmail.com",
    urlTemplate: "https://accounts.google.com/signup",
    minLength: 6,
    maxLength: 30,
    ruleSummary: "6–30 chars, letters, digits and dots only (no _ or -)",
    directProbe: false,
    defaultEnabled: true,
    validate: rule(/^[a-zA-Z0-9.]+$/, 6, 30, "Gmail allows 6–30 letters, digits and dots (.) only — no hyphens or underscores.", (u) => {
      if (u.startsWith(".") || u.endsWith(".")) return "Cannot start or end with a dot.";
      if (u.includes("..")) return "Cannot contain consecutive dots.";
      if (/^[0-9.]+$/.test(u)) return "Gmail requires at least one letter.";
      return undefined;
    }),
  },
  {
    id: "outlook",
    name: "Outlook Mail",
    kind: "mail",
    category: "Webmail",
    handleFormat: "{u}@outlook.com",
    urlTemplate: "https://signup.live.com/",
    minLength: 1,
    maxLength: 64,
    ruleSummary: "Starts with a letter; letters, digits, '.', '_' and '-' allowed",
    directProbe: false,
    defaultEnabled: true,
    validate: rule(/^[a-zA-Z][a-zA-Z0-9._-]*$/, 1, 64, "Must start with a letter and use only letters, digits, '.', '_' or '-'.", (u) => {
      if (u.includes("..")) return "Cannot contain consecutive dots.";
      if (u.endsWith(".")) return "Cannot end with a period.";
      return undefined;
    }),
  },
  {
    id: "proton_me",
    name: "Proton Mail",
    kind: "mail",
    category: "Webmail",
    handleFormat: "{u}@proton.me",
    urlTemplate: "https://account.proton.me/signup",
    minLength: 3,
    maxLength: 40,
    ruleSummary: "Letters, numbers, '.', '_' and '-' (must start/end alphanumeric)",
    directProbe: false,
    defaultEnabled: true,
    validate: rule(/^[a-zA-Z0-9][a-zA-Z0-9._-]*[a-zA-Z0-9]$/, 3, 40, "Start & end alphanumeric; '.', '_' and '-' allowed inside.", (u) => {
      if (/(\.\.|__|-\-)/.test(u)) return "Avoid repeated punctuation.";
      return undefined;
    }),
  },
  {
    id: "icloud",
    name: "iCloud Mail",
    kind: "mail",
    category: "Webmail",
    handleFormat: "{u}@icloud.com",
    urlTemplate: "https://www.icloud.com/",
    minLength: 3,
    maxLength: 20,
    ruleSummary: "3–20 chars, starts with a letter, letters, digits, '.' and '_'",
    directProbe: false,
    defaultEnabled: false,
    validate: rule(/^[a-zA-Z][a-zA-Z0-9._]*$/, 3, 20, "Must start with a letter; letters, digits, '.' and '_' only.", (u) => {
      if (u.includes("..")) return "Cannot contain consecutive dots.";
      if (u.endsWith(".")) return "Cannot end with a period.";
      return undefined;
    }),
  },
  {
    id: "yahoo",
    name: "Yahoo Mail",
    kind: "mail",
    category: "Webmail",
    handleFormat: "{u}@yahoo.com",
    urlTemplate: "https://login.yahoo.com/account/create",
    minLength: 4,
    maxLength: 32,
    ruleSummary: "4–32 chars, starts with a letter; letters, digits, '_' and '.'",
    directProbe: false,
    defaultEnabled: false,
    validate: rule(/^[a-zA-Z][a-zA-Z0-9._]*$/, 4, 32, "4–32 chars, start with a letter; letters, digits, '.' and '_' only."),
  },
  {
    id: "mail_ru",
    name: "Mail.ru",
    kind: "mail",
    category: "Webmail",
    handleFormat: "{u}@mail.ru",
    urlTemplate: "https://account.mail.ru/signup",
    minLength: 3,
    maxLength: 31,
    ruleSummary: "3–31 chars, letters, digits, '.', '_' and '-' (live account check)",
    directProbe: true,
    defaultEnabled: true,
    validate: rule(/^[a-zA-Z0-9][a-zA-Z0-9._-]*[a-zA-Z0-9]$/, 3, 31, "Must start & end alphanumeric; '.', '_', '-' inside."),
  },
  {
    id: "domain_com",
    name: ".com Domain Mail",
    kind: "mail",
    category: "Domain Mail",
    handleFormat: "hello@{u}.com",
    urlTemplate: "https://{u}.com",
    minLength: 2,
    maxLength: 63,
    ruleSummary: "Live DNS check for custom email domain {u}.com",
    directProbe: true,
    defaultEnabled: true,
    validate: rule(/^[a-zA-Z0-9-]+$/, 2, 63, "Domain labels allow letters, numbers and hyphens only.", (u) => {
      if (u.startsWith("-") || u.endsWith("-")) return "Domain label cannot begin or end with '-'.";
      return undefined;
    }),
  },
  {
    id: "domain_dev",
    name: ".dev Domain Mail",
    kind: "mail",
    category: "Domain Mail",
    handleFormat: "hi@{u}.dev",
    urlTemplate: "https://{u}.dev",
    minLength: 2,
    maxLength: 63,
    ruleSummary: "Live DNS check for custom email domain {u}.dev",
    directProbe: true,
    defaultEnabled: true,
    validate: rule(/^[a-zA-Z0-9-]+$/, 2, 63, "Domain labels allow letters, numbers and hyphens only.", (u) => {
      if (u.startsWith("-") || u.endsWith("-")) return "Domain label cannot begin or end with '-'.";
      return undefined;
    }),
  },
  {
    id: "domain_io",
    name: ".io Domain Mail",
    kind: "mail",
    category: "Domain Mail",
    handleFormat: "me@{u}.io",
    urlTemplate: "https://{u}.io",
    minLength: 2,
    maxLength: 63,
    ruleSummary: "Live DNS check for custom email domain {u}.io",
    directProbe: true,
    defaultEnabled: false,
    validate: rule(/^[a-zA-Z0-9-]+$/, 2, 63, "Domain labels allow letters, numbers and hyphens only.", (u) => {
      if (u.startsWith("-") || u.endsWith("-")) return "Domain label cannot begin or end with '-'.";
      return undefined;
    }),
  },
  {
    id: "domain_in",
    name: ".in Domain Mail",
    kind: "mail",
    category: "Domain Mail",
    handleFormat: "mail@{u}.in",
    urlTemplate: "https://{u}.in",
    minLength: 2,
    maxLength: 63,
    ruleSummary: "Live DNS check for custom email domain {u}.in",
    directProbe: true,
    defaultEnabled: false,
    validate: rule(/^[a-zA-Z0-9-]+$/, 2, 63, "Domain labels allow letters, numbers and hyphens only.", (u) => {
      if (u.startsWith("-") || u.endsWith("-")) return "Domain label cannot begin or end with '-'.";
      return undefined;
    }),
  },
];

export const ALL_SERVICES: ServiceDef[] = [...SOCIAL_PLATFORMS, ...MAIL_SERVICES];
export const SERVICE_MAP = new Map<string, ServiceDef>(ALL_SERVICES.map((s) => [s.id, s]));

export function formatServiceHandle(service: ServiceDef, username: string): string {
  return service.handleFormat.replace(/\{u\}/g, username);
}

export function formatServiceUrl(service: ServiceDef, username: string): string {
  return service.urlTemplate.replace(/\{u\}/g, encodeURIComponent(username));
}

export function validateHandleForService(username: string, serviceId: string): { valid: boolean; reason?: string } {
  const svc = SERVICE_MAP.get(serviceId);
  if (!svc) return { valid: false, reason: "Unknown service." };
  return svc.validate(username);
}

/* ================= Username Generation & Brandability Scoring ================= */

function tokenizeInput(raw: string): string[] {
  return raw
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/['’`]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function resolveSeps(separator: SeparatorStyle): string[] {
  if (separator === "none") return [""];
  if (separator === "underscore") return ["_"];
  if (separator === "dot") return ["."];
  if (separator === "hyphen") return ["-"];
  return ["", ".", "_"];
}

function scoreUsername(u: string, baseTokens: string[]): number {
  let score = 74;
  if (u.length >= 5 && u.length <= 14) score += 14;
  else if (u.length >= 3 && u.length <= 18) score += 7;
  else if (u.length > 22) score -= 14;

  // Penalize stacked numbers unless intentional short digit
  const digitCount = (u.match(/\d/g) ?? []).length;
  if (digitCount === 0) score += 8;
  else if (digitCount <= 2) score += 2;
  else score -= digitCount * 2;

  // Clean separator count (0 or 1 looks best)
  const sepCount = (u.match(/[._-]/g) ?? []).length;
  if (sepCount === 0) score += 6;
  else if (sepCount === 1) score += 3;
  else score -= sepCount * 4;

  // Exact root presence bonus
  if (baseTokens[0] && u.includes(baseTokens[0])) score += 4;

  return Math.max(25, Math.min(99, score));
}

function compatCount(u: string): number {
  let n = 0;
  for (const s of ALL_SERVICES) {
    if (s.validate(u).valid) n++;
  }
  return n;
}

const PROFESSIONAL_SUFFIXES = ["hq", "co", "studio", "labs", "works", "official", "media", "pro"];
const DEV_SUFFIXES = ["dev", "codes", "build", "stack", "io", "py", "ts", "sh", "ops"];
const CREATIVE_SUFFIXES = ["x", "vibe", "craft", "zen", "ly", "ify", "space", "verse", "hub"];
const PREFIXES = ["iam", "hey", "the", "its", "real", "by", "meet", "hi"];
const CREATIVE_PREFIXES = ["neo", "just", "pure", "echo", "pixel", "nova"];

export function generateUsernames(options: UsernameGenOptions): GeneratedUsername[] {
  const nameTokens = tokenizeInput(options.name || "alex mercer");
  const kwTokens = tokenizeInput(options.keywords || "");
  const style: UsernameStyle = options.style ?? "all";
  const seps = resolveSeps(options.separator ?? "mixed");
  const primarySep = seps[0] ?? "";
  const num = (options.numberSuffix ?? "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 6);
  const maxLen = Math.max(8, Math.min(30, options.maxLength ?? 22));
  const includeAffixes = options.includeAffixes ?? true;

  const first = nameTokens[0] ?? "user";
  const last = nameTokens.length > 1 ? nameTokens[nameTokens.length - 1] : "";
  const joined = nameTokens.join("");
  const candidates = new Map<string, GeneratedUsername["category"]>();

  const push = (raw: string, category: GeneratedUsername["category"]) => {
    const clean = raw.toLowerCase().replace(/[^a-z0-9._-]/g, "").replace(/^[._-]+|[._-]+$/g, "");
    if (!clean || clean.length < 3 || clean.length > maxLen) return;
    if (/(\.\.|__|--)/.test(clean)) return;
    if (!candidates.has(clean)) candidates.set(clean, category);
  };

  // 1. Exact & clean base forms
  for (const sep of seps) {
    if (nameTokens.length >= 2) {
      push(nameTokens.join(sep), "Exact & Clean");
      push(`${last}${sep}${first}`, "Exact & Clean");
    } else {
      push(first, "Exact & Clean");
    }
  }
  if (nameTokens.length >= 2) {
    push(`${first}${primarySep}${last[0]}`, "Exact & Clean");
    push(`${first[0]}${primarySep}${last}`, "Exact & Clean");
    push(`${first.slice(0, 3)}${primarySep}${last}`, "Exact & Clean");
  }

  // 2. Short & initials
  if (nameTokens.length >= 2) {
    const initials = nameTokens.map((t) => t[0]).join("");
    push(`${initials}${primarySep}${last}`, "Short & Initials");
    push(`${first}${initials}`, "Short & Initials");
    if (kwTokens[0]) {
      push(`${initials}${primarySep}${kwTokens[0]}`, "Short & Initials");
    }
  }
  if (first.length >= 5) {
    const noVowels = first[0] + first.slice(1).replace(/[aeiou]/g, "");
    if (noVowels.length >= 3) {
      push(noVowels, "Short & Initials");
      if (last) push(`${noVowels}${primarySep}${last[0]}`, "Short & Initials");
    }
    push(`${first.slice(0, 4)}${last ? last.slice(0, 3) : "hq"}`, "Short & Initials");
  }

  // 3. Niche / Keyword combinations
  for (const kw of kwTokens.slice(0, 3)) {
    for (const sep of seps.slice(0, 2)) {
      push(`${first}${sep}${kw}`, "Role & Niche");
      push(`${joined}${sep}${kw}`, "Role & Niche");
      push(`${kw}${sep}${first}`, "Role & Niche");
    }
  }

  // 4. Prefixes & Suffixes adapted to chosen style
  if (includeAffixes) {
    if (style === "all" || style === "clean" || style === "professional") {
      for (const sfx of PROFESSIONAL_SUFFIXES) {
        push(`${first}${primarySep}${sfx}`, "Suffixed");
        if (last) push(`${joined}${primarySep}${sfx}`, "Suffixed");
      }
      for (const pfx of PREFIXES.slice(0, 5)) {
        push(`${pfx}${primarySep}${first}`, "Prefixed");
        if (last && joined.length <= 12) push(`${pfx}${primarySep}${joined}`, "Prefixed");
      }
    }

    if (style === "all" || style === "developer") {
      for (const sfx of DEV_SUFFIXES) {
        push(`${first}${primarySep}${sfx}`, "Role & Niche");
        if (last) push(`${first}${last[0]}${primarySep}${sfx}`, "Role & Niche");
      }
      push(`0x${first}`, "Creative");
      push(`sudo${primarySep}${first}`, "Creative");
    }

    if (style === "all" || style === "creative") {
      for (const sfx of CREATIVE_SUFFIXES) {
        push(`${first}${sfx}`, "Creative");
        if (primarySep) push(`${first}${primarySep}${sfx}`, "Creative");
      }
      for (const pfx of CREATIVE_PREFIXES) {
        push(`${pfx}${primarySep}${first}`, "Prefixed");
      }
      // Stylish doubled trailing letter when natural (e.g. samrat -> samratt, alex -> alexx)
      if (first.length >= 3 && /[a-z]/.test(first[first.length - 1])) {
        push(`${first}${first[first.length - 1]}`, "Creative");
      }
    }

    if (style === "short") {
      push(`${first}x`, "Short & Initials");
      push(`${first}co`, "Short & Initials");
      push(`${first}hq`, "Short & Initials");
      push(`im${first}`, "Short & Initials");
      push(`hi${first}`, "Short & Initials");
    }
  }

  // 5. Number / year suffixes if user entered one (or subtle fallback years)
  if (num) {
    push(`${first}${primarySep}${num}`, "Suffixed");
    push(`${joined}${primarySep}${num}`, "Suffixed");
    if (kwTokens[0]) push(`${first}${kwTokens[0]}${num}`, "Suffixed");
  }

  let items: GeneratedUsername[] = Array.from(candidates.entries()).map(([username, category]) => ({
    username,
    category,
    score: scoreUsername(username, nameTokens),
    compatibleCount: compatCount(username),
    totalServices: ALL_SERVICES.length,
  }));

  // Style filter bias so style chips visibly tailor the output order & list
  if (style === "short") {
    items = items.filter((item) => item.username.length <= 13);
  } else if (style === "clean") {
    items = items.filter((item) => !/\d/.test(item.username));
  }

  items.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.username.length - b.username.length;
  });

  return items.slice(0, 36);
}

/**
 * Generates closest available candidate handles when a typed username is already occupied.
 * Prioritizes minimal edit distance & natural prefixes/suffixes matching the user's text/name.
 */
export function generateClosestAlternatives(
  occupiedUsername: string,
  seedName?: string,
  keywords?: string[],
  count = 14,
): string[] {
  const cleanBase = occupiedUsername
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/^[._-]+|[._-]+$/g, "");
  if (!cleanBase) return [];

  const tokens = tokenizeInput(seedName || "");
  const kws = (keywords ?? []).flatMap((k) => tokenizeInput(k));
  const out: string[] = [];
  const seen = new Set<string>([cleanBase]);

  const add = (candidate: string) => {
    const c = candidate.toLowerCase().replace(/[^a-z0-9._-]/g, "").replace(/^[._-]+|[._-]+$/g, "");
    if (!c || c.length < 3 || c.length > 26 || seen.has(c) || /(\.\.|__|--)/.test(c)) return;
    seen.add(c);
    out.push(c);
  };

  // 1. Minimal punctuation variants (hyphen/dot/underscore swaps or insertions if >= 2 words exist)
  if (cleanBase.includes("_")) {
    add(cleanBase.replace(/_/g, "."));
    add(cleanBase.replace(/_/g, "-"));
    add(cleanBase.replace(/_/g, ""));
  } else if (cleanBase.includes(".")) {
    add(cleanBase.replace(/\./g, "_"));
    add(cleanBase.replace(/\./g, "-"));
    add(cleanBase.replace(/\./g, ""));
  } else if (cleanBase.includes("-")) {
    add(cleanBase.replace(/-/g, "_"));
    add(cleanBase.replace(/-/g, "."));
    add(cleanBase.replace(/-/g, ""));
  } else if (tokens.length >= 2) {
    add(`${tokens[0]}.${tokens[1]}`);
    add(`${tokens[0]}_${tokens[1]}`);
    add(`${tokens[0]}-${tokens[1]}`);
  }

  // 2. Closest high-trust prefixes/suffixes
  const nearSuffixes = ["hq", "dev", "real", "official", "co", "io", "app", "x"];
  const nearPrefixes = ["iam", "hey", "the", "its", "real"];

  for (const kw of kws.slice(0, 2)) {
    add(`${cleanBase}${kw}`);
    add(`${cleanBase}.${kw}`);
    add(`${cleanBase}-${kw}`);
  }

  for (const s of nearSuffixes) {
    add(`${cleanBase}${s}`);
    add(`${cleanBase}-${s}`);
    add(`${cleanBase}.${s}`);
  }

  for (const p of nearPrefixes) {
    add(`${p}${cleanBase}`);
    add(`${p}-${cleanBase}`);
  }

  // 3. Doubled tail letter & short two-digit year fallback
  const lastChar = cleanBase[cleanBase.length - 1];
  if (/[a-z]/.test(lastChar)) add(`${cleanBase}${lastChar}`);
  add(`${cleanBase}01`);
  add(`${cleanBase}26`);

  return out.slice(0, count);
}
