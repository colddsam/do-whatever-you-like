/**
 * Client helpers for the QR generator. Mirrors backend/app/schemas/qrcode.py and the payload
 * rules in backend/app/services/qrcode.py, so the workspace can check input and show what a
 * scanner will read before anything is sent.
 */

export const QR_ENDPOINT = "/api/tools/qrcode/generate";
export const QR_MAX_CHARS = 4096; // MAX_DATA_LENGTH
export const LOGO_MAX_MB = 10; // MAX_LOGO_SIZE_MB
export const LOGO_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp"];

export type ContentType = "url" | "text" | "wifi" | "vcard" | "email" | "sms" | "phone" | "geo" | "event";
export type ModuleStyle = "square" | "gapped" | "circle" | "rounded" | "vertical_bars" | "horizontal_bars";
export type EyeStyle = "square" | "rounded" | "circle";
export type ColorMask = "solid" | "radial_gradient" | "square_gradient" | "horizontal_gradient" | "vertical_gradient";
export type OutputFormat = "png" | "svg" | "webp" | "jpeg" | "pdf";
export type ErrorCorrection = "L" | "M" | "Q" | "H";

/** Every field any content type uses, kept in one flat record so switching types keeps what was typed. */
export type Fields = Record<string, string>;

export type Look = {
  module: ModuleStyle;
  eye: EyeStyle;
  mask: ColorMask;
  fill: string;
  gradient: string;
  /** "#RRGGBB" or "transparent". */
  back: string;
  /** Null = same as the dots. */
  eyeColor: string | null;
  ec: ErrorCorrection;
  boxSize: number;
  border: number;
  format: OutputFormat;
};

export type LogoOptions = { ratio: number; pad: boolean; radius: number };

export const DEFAULT_LOOK: Look = {
  module: "square",
  eye: "square",
  mask: "solid",
  fill: "#15140F",
  gradient: "#EB4A10",
  back: "#FFFFFF",
  eyeColor: null,
  ec: "M",
  boxSize: 12,
  border: 4,
  format: "png",
};

export const DEFAULT_LOGO: LogoOptions = { ratio: 0.22, pad: true, radius: 8 };

export const MODULE_STYLES: { value: ModuleStyle; label: string }[] = [
  { value: "square", label: "Square" },
  { value: "rounded", label: "Rounded" },
  { value: "circle", label: "Dots" },
  { value: "gapped", label: "Gapped" },
  { value: "vertical_bars", label: "Columns" },
  { value: "horizontal_bars", label: "Rows" },
];

export const EYE_STYLES: { value: EyeStyle; label: string }[] = [
  { value: "square", label: "Square" },
  { value: "rounded", label: "Rounded" },
  { value: "circle", label: "Dotted" },
];

export const MASKS: { value: ColorMask; label: string }[] = [
  { value: "solid", label: "Solid" },
  { value: "radial_gradient", label: "Radial" },
  { value: "square_gradient", label: "Square" },
  { value: "horizontal_gradient", label: "Left → right" },
  { value: "vertical_gradient", label: "Top → bottom" },
];

export const EC_LEVELS: { value: ErrorCorrection; label: string; hint: string }[] = [
  { value: "L", label: "L", hint: "7%" },
  { value: "M", label: "M", hint: "15%" },
  { value: "Q", label: "Q", hint: "25%" },
  { value: "H", label: "H", hint: "30%" },
];

export const FORMATS: { value: OutputFormat; label: string; hint: string }[] = [
  { value: "png", label: "PNG", hint: "Screens and docs" },
  { value: "svg", label: "SVG", hint: "Any size, flat colour" },
  { value: "webp", label: "WebP", hint: "Small, for the web" },
  { value: "jpeg", label: "JPEG", hint: "No transparency" },
  { value: "pdf", label: "PDF", hint: "Print, 300 dpi" },
];

/** Colour presets for the dots and the background. These are the user's colours, not the site's. */
export const FILL_SWATCHES = ["#000000", "#15140F", "#EB4A10", "#1D4ED8", "#166534", "#7E22CE"];
export const BACK_SWATCHES = ["#FFFFFF", "#F3F0E8", "#FEF3C7", "#E0F2FE", "#000000"];

/* ---------- Content ---------- */

type FieldDef = {
  key: string;
  label: string;
  placeholder?: string;
  type?: "text" | "url" | "email" | "tel" | "number" | "password" | "datetime-local" | "textarea";
  required?: boolean;
  max?: number;
  /** Half width on wider screens. */
  half?: boolean;
  mono?: boolean;
  autoComplete?: string;
};

export const CONTENT: Record<ContentType, { label: string; hint: string; fields: FieldDef[] }> = {
  url: {
    label: "Link",
    hint: "Opens a page",
    fields: [{ key: "url", label: "Link", placeholder: "https://example.com", type: "url", required: true, mono: true, max: 4096 }],
  },
  text: {
    label: "Text",
    hint: "Shows a note",
    fields: [{ key: "text", label: "Text", placeholder: "Anything you like…", type: "textarea", required: true, max: 4096 }],
  },
  wifi: {
    label: "Wi-Fi",
    hint: "Joins a network",
    fields: [
      { key: "ssid", label: "Network name", placeholder: "MyHomeWiFi", required: true, max: 128, autoComplete: "off" },
      { key: "password", label: "Password", type: "password", max: 128, autoComplete: "off" },
    ],
  },
  vcard: {
    label: "Contact",
    hint: "Saves a card",
    fields: [
      { key: "first_name", label: "First name", placeholder: "Jane", required: true, max: 100, half: true, autoComplete: "given-name" },
      { key: "last_name", label: "Last name", placeholder: "Doe", max: 100, half: true, autoComplete: "family-name" },
      { key: "organization", label: "Company", placeholder: "Acme Corp", max: 150, half: true, autoComplete: "organization" },
      { key: "title", label: "Job title", placeholder: "Designer", max: 100, half: true, autoComplete: "organization-title" },
      { key: "phone", label: "Phone", placeholder: "+1 555 0199", type: "tel", max: 40, half: true, autoComplete: "tel" },
      { key: "vemail", label: "Email", placeholder: "jane@example.com", type: "email", max: 150, half: true, autoComplete: "email" },
      { key: "website", label: "Website", placeholder: "https://example.com", type: "url", max: 256, mono: true },
      { key: "address", label: "Address", placeholder: "123 Main St, Metropolis", max: 256, autoComplete: "street-address" },
    ],
  },
  email: {
    label: "Email",
    hint: "Starts an email",
    fields: [
      { key: "to", label: "To", placeholder: "hello@example.com", type: "email", required: true, max: 254 },
      { key: "subject", label: "Subject", placeholder: "Hello", max: 200 },
      { key: "body", label: "Message", placeholder: "Hi there!", type: "textarea", max: 1000 },
    ],
  },
  sms: {
    label: "SMS",
    hint: "Starts a text",
    fields: [
      { key: "sms_phone", label: "Phone number", placeholder: "+1 555 0199", type: "tel", required: true, max: 40 },
      { key: "message", label: "Message", placeholder: "Hello from a QR code!", type: "textarea", max: 500 },
    ],
  },
  phone: {
    label: "Call",
    hint: "Dials a number",
    fields: [{ key: "tel", label: "Phone number", placeholder: "+1 555 0199", type: "tel", required: true, max: 40, mono: true }],
  },
  geo: {
    label: "Place",
    hint: "Opens a map",
    fields: [
      { key: "lat", label: "Latitude", placeholder: "37.7749", type: "number", required: true, half: true, mono: true },
      { key: "lng", label: "Longitude", placeholder: "-122.4194", type: "number", required: true, half: true, mono: true },
      { key: "query", label: "Label", placeholder: "San Francisco, CA", max: 200 },
    ],
  },
  event: {
    label: "Event",
    hint: "Adds to a calendar",
    fields: [
      { key: "ev_title", label: "Title", placeholder: "Team sync", required: true, max: 200 },
      { key: "start", label: "Starts", type: "datetime-local", required: true, half: true },
      { key: "end", label: "Ends", type: "datetime-local", required: true, half: true },
      { key: "location", label: "Where", placeholder: "Conference room A", max: 200 },
      { key: "description", label: "Notes", placeholder: "Weekly project sync", type: "textarea", max: 500 },
    ],
  },
};

export const CONTENT_TYPES = Object.keys(CONTENT) as ContentType[];
export const isContentType = (v: unknown): v is ContentType => typeof v === "string" && v in CONTENT;

/** Wi-Fi extras that aren't text fields. */
export type WifiExtras = { encryption: "WPA" | "WEP" | "nopass"; hidden: boolean };

const v = (f: Fields, k: string) => (f[k] ?? "").trim();
const looksLikeEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const looksLikePhone = (s: string) => /^[+()\d\s.-]{3,40}$/.test(s) && /\d{3}/.test(s.replace(/\D/g, ""));

/** "2026-11-15T09:00" (local) → "20261115T090000Z" (UTC), the iCal form the backend passes through. */
export function toICal(local: string): string | null {
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export function normalizeUrl(s: string) {
  return /^[a-z][a-z\d+.-]*:/i.test(s) ? s : `https://${s}`;
}

/** What's missing or wrong, in plain words, or null when the content can be encoded. */
export function checkContent(type: ContentType, f: Fields, wifi: WifiExtras): string | null {
  switch (type) {
    case "url": {
      const s = v(f, "url");
      if (!s) return "Add a link to encode.";
      try {
        const u = new URL(normalizeUrl(s));
        if (/^https?:$/.test(u.protocol) && !u.hostname.includes(".") && u.hostname !== "localhost")
          return "That link needs a domain, like example.com.";
      } catch {
        return "That doesn't look like a link.";
      }
      return null;
    }
    case "text":
      return v(f, "text") ? null : "Type the text to encode.";
    case "wifi":
      if (!v(f, "ssid")) return "Add the network name.";
      if (wifi.encryption !== "nopass" && !f.password) return "Add the password, or pick “None” for an open network.";
      return null;
    case "vcard": {
      if (!v(f, "first_name")) return "Add at least a first name.";
      const e = v(f, "vemail");
      if (e && !looksLikeEmail(e)) return "That email address doesn't look right.";
      const p = v(f, "phone");
      if (p && !looksLikePhone(p)) return "That phone number doesn't look right.";
      return null;
    }
    case "email": {
      const e = v(f, "to");
      if (!e) return "Add the address to send to.";
      return looksLikeEmail(e) ? null : "That email address doesn't look right.";
    }
    case "sms": {
      const p = v(f, "sms_phone");
      if (!p) return "Add the number to text.";
      return looksLikePhone(p) ? null : "That phone number doesn't look right.";
    }
    case "phone": {
      const p = v(f, "tel");
      if (!p) return "Add the number to call.";
      return looksLikePhone(p) ? null : "That phone number doesn't look right.";
    }
    case "geo": {
      const lat = Number(v(f, "lat"));
      const lng = Number(v(f, "lng"));
      if (!v(f, "lat") || !v(f, "lng")) return "Add a latitude and longitude, or use your location.";
      if (!Number.isFinite(lat) || lat < -90 || lat > 90) return "Latitude runs from −90 to 90.";
      if (!Number.isFinite(lng) || lng < -180 || lng > 180) return "Longitude runs from −180 to 180.";
      return null;
    }
    case "event": {
      if (!v(f, "ev_title")) return "Give the event a title.";
      const s = toICal(v(f, "start"));
      const e = toICal(v(f, "end"));
      if (!s || !e) return "Set when it starts and ends.";
      if (new Date(v(f, "end")) <= new Date(v(f, "start"))) return "The event has to end after it starts.";
      return null;
    }
  }
}

/** The backend's `data` field: a plain string for simple types, a JSON object for structured ones. */
export function contentData(type: ContentType, f: Fields, wifi: WifiExtras): string {
  const opt = (k: string) => v(f, k) || undefined;
  switch (type) {
    case "url":
      return normalizeUrl(v(f, "url"));
    case "text":
      return f.text ?? "";
    case "phone":
      return v(f, "tel");
    case "wifi":
      return JSON.stringify({
        ssid: f.ssid ?? "",
        password: wifi.encryption === "nopass" ? "" : (f.password ?? ""),
        encryption: wifi.encryption,
        hidden: wifi.hidden,
      });
    case "vcard":
      return JSON.stringify({
        first_name: v(f, "first_name"),
        last_name: v(f, "last_name"),
        organization: opt("organization"),
        title: opt("title"),
        phone: opt("phone"),
        email: opt("vemail"),
        website: opt("website") && normalizeUrl(v(f, "website")),
        address: opt("address"),
      });
    case "email":
      return JSON.stringify({ email: v(f, "to"), subject: opt("subject"), body: opt("body") });
    case "sms":
      return JSON.stringify({ phone: v(f, "sms_phone"), message: opt("message") });
    case "geo":
      return JSON.stringify({ latitude: Number(v(f, "lat")), longitude: Number(v(f, "lng")), query: opt("query") });
    case "event":
      return JSON.stringify({
        title: v(f, "ev_title"),
        start_time: toICal(v(f, "start")),
        end_time: toICal(v(f, "end")),
        location: opt("location"),
        description: opt("description"),
      });
  }
}

const escWifi = (s: string) => s.replace(/([\\;,:"])/g, "\\$1");

/** Exactly what a scanner will read: the same string backend's `build_payload` encodes. */
export function scannerReads(type: ContentType, f: Fields, wifi: WifiExtras): string {
  switch (type) {
    case "url":
      return normalizeUrl(v(f, "url"));
    case "text":
      return (f.text ?? "").trim();
    case "phone": {
      const p = v(f, "tel");
      return p.toLowerCase().startsWith("tel:") ? p : `tel:${p}`;
    }
    case "wifi":
      return `WIFI:T:${wifi.encryption};S:${escWifi(f.ssid ?? "")};P:${escWifi(wifi.encryption === "nopass" ? "" : (f.password ?? ""))};H:${wifi.hidden};;`;
    case "vcard": {
      const first = v(f, "first_name");
      const last = v(f, "last_name");
      const lines = ["BEGIN:VCARD", "VERSION:3.0", `N:${last};${first};;;`, `FN:${`${first} ${last}`.trim()}`];
      if (v(f, "organization")) lines.push(`ORG:${v(f, "organization")}`);
      if (v(f, "title")) lines.push(`TITLE:${v(f, "title")}`);
      if (v(f, "phone")) lines.push(`TEL;TYPE=CELL:${v(f, "phone")}`);
      if (v(f, "vemail")) lines.push(`EMAIL:${v(f, "vemail")}`);
      if (v(f, "website")) lines.push(`URL:${normalizeUrl(v(f, "website"))}`);
      if (v(f, "address")) lines.push(`ADR;TYPE=WORK:;;${v(f, "address")};;;;`);
      lines.push("END:VCARD");
      return lines.join("\n");
    }
    case "email": {
      const q = [
        v(f, "subject") && `subject=${encodeURIComponent(v(f, "subject"))}`,
        v(f, "body") && `body=${encodeURIComponent(v(f, "body"))}`,
      ].filter(Boolean);
      return `mailto:${v(f, "to")}${q.length ? `?${q.join("&")}` : ""}`;
    }
    case "sms":
      return `SMSTO:${v(f, "sms_phone")}:${v(f, "message")}`;
    case "geo": {
      const base = `geo:${Number(v(f, "lat"))},${Number(v(f, "lng"))}`;
      return v(f, "query") ? `${base}?q=${encodeURIComponent(v(f, "query"))}` : base;
    }
    case "event": {
      const lines = [
        "BEGIN:VEVENT",
        `SUMMARY:${v(f, "ev_title")}`,
        `DTSTART:${toICal(v(f, "start")) ?? ""}`,
        `DTEND:${toICal(v(f, "end")) ?? ""}`,
      ];
      if (v(f, "location")) lines.push(`LOCATION:${v(f, "location")}`);
      if (v(f, "description")) lines.push(`DESCRIPTION:${v(f, "description")}`);
      lines.push("END:VEVENT");
      return lines.join("\n");
    }
  }
}

/* ---------- Look rules (the backend enforces these too) ---------- */

/** Which formats can't be picked with the current look, and why. */
export function formatBlock(format: OutputFormat, look: Look, hasLogo: boolean): string | null {
  if (format === "svg" && hasLogo) return "SVG can't hold a centre logo.";
  if ((format === "jpeg" || format === "pdf") && look.back === "transparent")
    return `${format.toUpperCase()} can't be transparent.`;
  return null;
}

/** SVG is drawn as flat paths, so some styling only reaches the raster and PDF formats. */
export function svgDrops(look: Look): string[] {
  const out: string[] = [];
  if (look.mask !== "solid") out.push("gradient");
  if (look.eyeColor) out.push("eye colour");
  if (look.eye !== "square") out.push("eye shape");
  if (!["square", "circle", "rounded"].includes(look.module)) out.push("dot shape");
  return out;
}

/* ---------- Colour ---------- */

export const isHex = (s: string) => /^#[0-9a-f]{6}$/i.test(s);

/** "1ba" → "#11BBAA", "#eb4a10" → "#EB4A10"; null when it isn't a colour. */
export function parseHex(input: string): string | null {
  let s = input.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(s)) s = s.replace(/./g, "$&$&");
  return /^[0-9a-f]{6}$/i.test(s) ? `#${s.toUpperCase()}` : null;
}

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

/**
 * A heads-up when scanning may be unreliable: low contrast, or light dots on a dark ground,
 * which some older scanners can't read.
 */
export function scanWarning(look: Look): string | null {
  const back = look.back === "transparent" ? "#FFFFFF" : look.back;
  const fills = [look.fill, ...(look.mask !== "solid" ? [look.gradient] : []), ...(look.eyeColor ? [look.eyeColor] : [])];
  const worst = Math.min(...fills.map((c) => contrast(c, back)));
  if (worst < 2.5) return "Low contrast. Many phones will struggle to scan this. Darken the dots or lighten the background.";
  if (luminance(look.fill) > luminance(back)) return "Light dots on a dark background. Most phones cope, but some older scanners don't.";
  if (look.back === "transparent") return "Transparent background. Make sure it sits on something light.";
  return null;
}

/* ---------- Request ---------- */

export function buildForm(
  type: ContentType,
  fields: Fields,
  wifi: WifiExtras,
  look: Look,
  format: OutputFormat,
  logo: { file: Blob; name: string; options: LogoOptions } | null,
) {
  const form = new FormData();
  form.append("content_type", type);
  form.append("data", contentData(type, fields, wifi));
  form.append("error_correction", look.ec);
  form.append("box_size", String(look.boxSize));
  form.append("border", String(look.border));
  form.append("module_style", look.module);
  form.append("eye_style", look.eye);
  form.append("color_mask", look.mask);
  form.append("fill_color", look.fill);
  if (look.mask !== "solid") form.append("gradient_color", look.gradient);
  form.append("back_color", look.back);
  if (look.eyeColor) form.append("eye_color", look.eyeColor);
  form.append("output_format", format);
  if (logo) {
    form.append("logo_size_ratio", String(logo.options.ratio));
    form.append("logo_border", String(logo.options.pad));
    form.append("logo_corner_radius", String(logo.options.radius));
    form.append("logo", logo.file, logo.name);
  }
  return form;
}

/**
 * Logos are re-sent with every preview, so big ones are scaled down first. The backend shrinks
 * them to at most 30% of the code anyway, so 768px is more than enough for any module size.
 */
export async function prepareLogo(file: File): Promise<{ file: Blob; name: string; src: string }> {
  const src = URL.createObjectURL(file);
  if (file.size < 600 * 1024 || typeof createImageBitmap !== "function") return { file, name: file.name, src };
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 768 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
    if (!blob) return { file, name: file.name, src };
    return { file: blob, name: file.name.replace(/\.[^.]+$/, "") + ".png", src };
  } catch {
    return { file, name: file.name, src };
  }
}

/** A filename people will recognise later, e.g. "qr-example.com.png". */
export function qrFilename(type: ContentType, f: Fields, format: OutputFormat) {
  const subject =
    type === "url"
      ? (() => {
          try {
            return new URL(normalizeUrl(v(f, "url"))).hostname.replace(/^www\./, "");
          } catch {
            return "link";
          }
        })()
      : type === "wifi"
        ? `wifi-${v(f, "ssid")}`
        : type === "vcard"
          ? `${v(f, "first_name")}-${v(f, "last_name")}`
          : type === "event"
            ? v(f, "ev_title")
            : CONTENT[type].label;
  const slug =
    subject
      .toLowerCase()
      .replace(/[^a-z0-9.]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "code";
  return `qr-${slug}.${format === "jpeg" ? "jpg" : format}`;
}
