import nodemailer from "nodemailer";
import { backendConfig, readDetail } from "@/lib/backend";
import { CONTACT_EMAIL, SITE_NAME, SITE_URL } from "@/lib/site";

export const maxDuration = 60;

const EMAIL_RE = /^[^@\s<>()\[\],;:\\"]+@[^@\s<>()\[\],;:\\"]+\.[^@\s<>()\[\],;:\\"]+$/;
const MAX_BODY_BYTES = 8_192;
const RATE_LIMIT_PER_HOUR = 20;

const rateBuckets = new Map<string, number[]>();

type ParsedRequest = {
  idea: string;
  category: string;
  replyTo: string;
  pageUrl: string;
  website: string;
};

function envFirst(...names: string[]): string {
  for (const name of names) {
    const val = process.env[name]?.trim();
    if (val) return val;
  }
  return "";
}

function cleanLine(value: unknown, maxLen: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\r\n\x00-\x08\x0b\x0c\x0e-\x1f\x7f]+/g, " ").trim().slice(0, maxLen);
}

function safeHttpUrl(value: unknown, maxLen: number, allowLocalHttp = false): string {
  const cleaned = cleanLine(value, maxLen);
  if (!cleaned) return "";
  try {
    const u = new URL(cleaned);
    if (u.protocol === "https:") return u.toString();
    if (allowLocalHttp && u.protocol === "http:" && (u.hostname === "127.0.0.1" || u.hostname === "localhost")) {
      return u.toString();
    }
  } catch {
    return "";
  }
  return "";
}

function escapeHtml(raw: string): string {
  return raw
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildMailto(toEmail: string, idea: string, category: string, replyTo: string, pageUrl: string): string {
  const preview = cleanLine(idea, 70);
  const subject = `[${SITE_NAME}] Tool Request: ${preview}`;
  const body = [
    "Hi,",
    "",
    "I'd like to request a tool on Do-Whatever-You-Like:",
    "",
    idea,
    "",
    category ? `Category: ${category}` : "",
    replyTo ? `My email: ${replyTo}` : "",
    pageUrl ? `Page: ${pageUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return `mailto:${encodeURIComponent(toEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function checkRateLimit(clientKey: string): boolean {
  const now = Date.now();
  const cutoff = now - 3_600_000;
  for (const [k, times] of rateBuckets.entries()) {
    const fresh = times.filter((t) => t >= cutoff);
    if (fresh.length === 0) rateBuckets.delete(k);
    else rateBuckets.set(k, fresh);
  }
  const bucket = rateBuckets.get(clientKey) ?? [];
  if (bucket.length >= RATE_LIMIT_PER_HOUR) return false;
  bucket.push(now);
  rateBuckets.set(clientKey, bucket);
  return true;
}

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (fwd) return fwd;
  return req.headers.get("x-real-ip")?.trim() || "local";
}

function buildEmailContent(toEmail: string, input: ParsedRequest) {
  const preview = cleanLine(input.idea, 70);
  const ellipsis = cleanLine(input.idea, 80).length > 70 ? "…" : "";
  const subject = `[${SITE_NAME}] Tool Request: ${preview}${ellipsis}`;
  const sentAt = new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";

  const text = [
    `New tool request from ${SITE_NAME}`,
    "",
    "Requested tool / task:",
    input.idea,
    "",
    `Category: ${input.category || "Not specified"}`,
    `Reply email: ${input.replyTo || "Anonymous (none provided)"}`,
    `Page: ${input.pageUrl || SITE_URL}`,
    `Sent at: ${sentAt}`,
  ].join("\n");

  const html =
    `<div style="font-family:Inter,Arial,sans-serif;max-width:600px;padding:20px;border:1px solid #e6e2da;border-radius:10px;background:#faf8f3;color:#15140f">` +
    `<p style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#8a867a;margin:0 0 8px">${escapeHtml(SITE_NAME)} · Tool Request</p>` +
    `<div style="background:#ffffff;border:1px solid #e6e2da;border-radius:8px;padding:16px;margin:12px 0;font-size:15px;line-height:1.55">${escapeHtml(input.idea).replaceAll("\n", "<br>")}</div>` +
    `<table style="width:100%;font-size:13px;color:#57544a;border-collapse:collapse">` +
    `<tr><td style="padding:4px 0;width:110px"><strong>Category</strong></td><td>${escapeHtml(input.category || "Not specified")}</td></tr>` +
    `<tr><td style="padding:4px 0"><strong>Reply to</strong></td><td>${escapeHtml(input.replyTo || "Anonymous (none provided)")}</td></tr>` +
    `<tr><td style="padding:4px 0"><strong>Page</strong></td><td>${escapeHtml(input.pageUrl || SITE_URL)}</td></tr>` +
    `<tr><td style="padding:4px 0"><strong>Sent at</strong></td><td>${escapeHtml(sentAt)}</td></tr>` +
    `</table></div>`;

  return { toEmail, subject, text, html };
}

function vercelProviders(): string[] {
  const list: string[] = [];
  if (envFirst("RESEND_API_KEY", "TOOL_REQUEST_RESEND_API_KEY")) list.push("resend");
  if (envFirst("BREVO_API_KEY", "TOOL_REQUEST_BREVO_API_KEY")) list.push("brevo");
  if (envFirst("WEB3FORMS_ACCESS_KEY", "TOOL_REQUEST_WEB3FORMS_ACCESS_KEY")) list.push("web3forms");
  if (safeHttpUrl(envFirst("TOOL_REQUEST_APPS_SCRIPT_URL", "APPS_SCRIPT_URL"), 400, true)) list.push("apps_script");
  const smtpUser = envFirst("SMTP_USER", "GMAIL_USER", "TOOL_REQUEST_SMTP_USER");
  const smtpPass = envFirst("SMTP_PASS", "GMAIL_APP_PASSWORD", "TOOL_REQUEST_SMTP_PASS");
  const smtpHost = envFirst("SMTP_HOST", "TOOL_REQUEST_SMTP_HOST") || (smtpUser.toLowerCase().endsWith("@gmail.com") ? "smtp.gmail.com" : "");
  if (smtpHost && smtpUser && smtpPass) list.push("smtp");
  if (safeHttpUrl(envFirst("TOOL_REQUEST_WEBHOOK_URL"), 400, true)) list.push("webhook");
  return list;
}

async function tryDirectProviders(toEmail: string, input: ParsedRequest): Promise<{ provider: string; activationRequired?: boolean } | null> {
  const { subject, text, html } = buildEmailContent(toEmail, input);
  const replyTo = input.replyTo;

  const resendKey = envFirst("RESEND_API_KEY", "TOOL_REQUEST_RESEND_API_KEY");
  if (resendKey) {
    try {
      const from = envFirst("RESEND_FROM", "TOOL_REQUEST_RESEND_FROM") || `${SITE_NAME} <onboarding@resend.dev>`;
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [toEmail], subject, text, html, ...(replyTo ? { reply_to: replyTo } : {}) }),
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) return { provider: "resend" };
    } catch {
      // Fall through to next provider or backend.
    }
  }

  const brevoKey = envFirst("BREVO_API_KEY", "TOOL_REQUEST_BREVO_API_KEY");
  if (brevoKey) {
    try {
      const sender = envFirst("BREVO_SENDER_EMAIL", "TOOL_REQUEST_BREVO_SENDER_EMAIL") || toEmail;
      const res = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { "api-key": brevoKey, "Content-Type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          sender: { name: SITE_NAME, email: sender },
          to: [{ email: toEmail }],
          subject,
          textContent: text,
          htmlContent: html,
          ...(replyTo ? { replyTo: { email: replyTo } } : {}),
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) return { provider: "brevo" };
    } catch {
      // Fall through cleanly.
    }
  }

  const web3Key = envFirst("WEB3FORMS_ACCESS_KEY", "TOOL_REQUEST_WEB3FORMS_ACCESS_KEY");
  if (web3Key) {
    try {
      const res = await fetch("https://api.web3forms.com/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          access_key: web3Key,
          subject,
          from_name: SITE_NAME,
          message: text,
          ...(replyTo ? { replyto: replyTo, email: replyTo } : {}),
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const body = (await res.json().catch(() => null)) as { success?: boolean } | null;
      if (res.ok && body?.success) return { provider: "web3forms" };
    } catch {
      // Fall through cleanly.
    }
  }

  const appsScriptUrl = safeHttpUrl(envFirst("TOOL_REQUEST_APPS_SCRIPT_URL", "APPS_SCRIPT_URL"), 400, true);
  if (appsScriptUrl) {
    try {
      const res = await fetch(appsScriptUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: toEmail, subject, text, html, replyTo }),
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) return { provider: "apps_script" };
    } catch {
      // Fall through cleanly.
    }
  }

  const smtpUser = envFirst("SMTP_USER", "GMAIL_USER", "TOOL_REQUEST_SMTP_USER");
  const smtpPass = envFirst("SMTP_PASS", "GMAIL_APP_PASSWORD", "TOOL_REQUEST_SMTP_PASS");
  const smtpHost = envFirst("SMTP_HOST", "TOOL_REQUEST_SMTP_HOST") || (smtpUser.toLowerCase().endsWith("@gmail.com") ? "smtp.gmail.com" : "");
  if (smtpHost && smtpUser && smtpPass) {
    try {
      const port = Number(envFirst("SMTP_PORT", "TOOL_REQUEST_SMTP_PORT") || "465");
      const secure = envFirst("SMTP_SECURE") ? envFirst("SMTP_SECURE") === "true" : port === 465;
      const fromEmail = envFirst("SMTP_FROM", "TOOL_REQUEST_SMTP_FROM") || smtpUser || toEmail;
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: Number.isFinite(port) && port > 0 ? port : 465,
        secure,
        auth: { user: smtpUser, pass: smtpPass },
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 12_000,
      });
      await transporter.sendMail({
        from: `"${SITE_NAME}" <${fromEmail}>`,
        to: toEmail,
        ...(replyTo ? { replyTo } : {}),
        subject,
        text,
        html,
      });
      return { provider: "smtp" };
    } catch {
      // Fall through cleanly.
    }
  }

  const webhookUrl = safeHttpUrl(envFirst("TOOL_REQUEST_WEBHOOK_URL"), 400, true);
  if (webhookUrl) {
    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: `**${subject}**\n\n${text}`, text: `${subject}\n\n${text}`, to: toEmail }),
        signal: AbortSignal.timeout(12_000),
      });
      if (res.ok) return { provider: "webhook" };
    } catch {
      // Fall through cleanly.
    }
  }

  return null;
}

async function tryFormSubmitFallback(toEmail: string, input: ParsedRequest): Promise<{ provider: string; activationRequired: boolean } | null> {
  if (envFirst("TOOL_REQUEST_FORMSUBMIT_ENABLED").toLowerCase() === "false") return null;
  const { subject, text } = buildEmailContent(toEmail, input);
  let origin = SITE_URL;
  if (input.pageUrl) {
    try {
      origin = new URL(input.pageUrl).origin;
    } catch {
      origin = SITE_URL;
    }
  }

  try {
    const res = await fetch(`https://formsubmit.co/ajax/${encodeURIComponent(toEmail)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Origin: origin,
        Referer: `${origin}/`,
      },
      body: JSON.stringify({
        _subject: subject,
        _captcha: "false",
        _template: "table",
        _url: input.pageUrl || `${origin}/#request`,
        email: input.replyTo || toEmail,
        message: text,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const ct = res.headers.get("content-type")?.toLowerCase() ?? "";
    if (!ct.includes("json")) return null;
    const data = (await res.json()) as { success?: boolean | string; message?: string };
    const msg = String(data.message ?? "");
    const needsActivation = /activation|activate form/i.test(msg);
    if (needsActivation) return { provider: "formsubmit", activationRequired: true };
    const ok = data.success === true || data.success === "true" || data.success === "True";
    if (res.ok && ok) return { provider: "formsubmit", activationRequired: false };
    return null;
  } catch {
    return null;
  }
}

export async function GET() {
  const toEmail = envFirst("TOOL_REQUEST_TO_EMAIL") || CONTACT_EMAIL;
  const providers = vercelProviders();
  const backend = backendConfig();
  let backendReady = false;
  let backendProviders: string[] = [];

  if (backend) {
    try {
      const upstream = await fetch(backend.endpoint("tool-request/capabilities"), {
        headers: { Authorization: `Bearer ${backend.token}` },
        cache: "no-store",
        signal: AbortSignal.timeout(5_000),
      });
      if (upstream.ok) {
        const data = (await upstream.json()) as { configured_providers?: string[]; ready?: boolean };
        backendProviders = Array.isArray(data.configured_providers) ? data.configured_providers : [];
        backendReady = Boolean(data.ready);
      }
    } catch {
      backendReady = false;
    }
  }

  return Response.json(
    {
      to_email: toEmail,
      ready: providers.length > 0 || backendReady,
      providers: Array.from(new Set([...providers, ...backendProviders])),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(req: Request) {
  const ip = clientIp(req);
  if (!checkRateLimit(ip)) {
    return Response.json(
      { detail: "Too many tool requests sent recently. Please try again in a little while." },
      { status: 429, headers: { "Cache-Control": "no-store" } },
    );
  }

  const rawText = await req.text().catch(() => "");
  if (!rawText || rawText.length > MAX_BODY_BYTES) {
    return Response.json(
      { detail: rawText ? "That request is too long." : "Send your tool idea in the message box." },
      { status: rawText ? 413 : 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(rawText);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid");
    body = parsed as Record<string, unknown>;
  } catch {
    return Response.json({ detail: "Invalid request payload." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  const rawIdea = typeof body.idea === "string" ? body.idea.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]+/g, "").trim() : "";
  if (rawIdea.length < 3 || rawIdea.length > 1200) {
    return Response.json(
      { detail: rawIdea.length > 1200 ? "Please keep the description under 1,200 characters." : "Please describe the tool you want in at least 3 characters." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const category = cleanLine(body.category, 60);
  const replyTo = cleanLine(body.replyTo ?? body.reply_to, 160);
  if (replyTo && !EMAIL_RE.test(replyTo)) {
    return Response.json(
      { detail: "Please enter a valid reply email address, or leave it blank." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const pageUrl = safeHttpUrl(body.pageUrl ?? body.page_url ?? req.headers.get("referer"), 300, true);
  const website = cleanLine(body.website, 200);
  const toEmail = envFirst("TOOL_REQUEST_TO_EMAIL") || CONTACT_EMAIL;
  const mailto = buildMailto(toEmail, rawIdea, category, replyTo, pageUrl);

  if (website) {
    return Response.json(
      { ok: true, delivered: false, provider: "filtered", to_email: toEmail, message: "Request ignored." },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const parsed: ParsedRequest = { idea: rawIdea, category, replyTo, pageUrl, website };

  // 1. Try direct server-side email providers configured on Vercel/Next.js first (instant, zero Render wake delay).
  const direct = await tryDirectProviders(toEmail, parsed);
  if (direct) {
    return Response.json(
      {
        ok: true,
        delivered: true,
        provider: direct.provider,
        to_email: toEmail,
        activation_required: Boolean(direct.activationRequired),
        message: `Sent! Your tool request was delivered to ${toEmail}.`,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  // 2. Otherwise delegate to FastAPI POST /api/v1/tool-request when backend is configured.
  const backend = backendConfig();
  let backendResponded = false;
  if (backend) {
    try {
      const upstream = await fetch(backend.endpoint("tool-request"), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${backend.token}`,
          "Content-Type": "application/json",
          "X-Forwarded-For": ip,
        },
        body: JSON.stringify({
          idea: parsed.idea,
          category: parsed.category || null,
          reply_to: parsed.replyTo || null,
          page_url: parsed.pageUrl || null,
          website: null,
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(55_000),
      });
      backendResponded = true;
      const json = await upstream.json().catch(() => null);
      if (upstream.ok && json && typeof json === "object") {
        return Response.json(json, { status: 200, headers: { "Cache-Control": "no-store" } });
      }
      if (upstream.status === 400 || upstream.status === 429) {
        return Response.json(
          { detail: readDetail(json) ?? "Could not send request.", mailto },
          { status: upstream.status, headers: { "Cache-Control": "no-store" } },
        );
      }
    } catch {
      // Backend unreachable or timed out; continue to FormSubmit / mailto fallback.
    }
  }

  // 3. Keyless FormSubmit fallback (when backend wasn't configured or couldn't be reached).
  if (!backendResponded) {
    const fs = await tryFormSubmitFallback(toEmail, parsed);
    if (fs) {
      return Response.json(
        {
          ok: true,
          delivered: true,
          provider: fs.provider,
          to_email: toEmail,
          activation_required: fs.activationRequired,
          message: fs.activationRequired
            ? `Request queued — check ${toEmail} once to click FormSubmit's activation link so future messages arrive.`
            : `Sent! Your tool request was delivered to ${toEmail}.`,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
  }

  return Response.json(
    {
      detail: `Couldn't send automatically from the server right now. Use the button below to email ${toEmail} directly.`,
      mailto,
      to_email: toEmail,
    },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}
