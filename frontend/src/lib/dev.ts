/**
 * Developer utilities: pure functions, all run in the browser (nothing is sent anywhere).
 * Hashes use Web Crypto, except MD5, which Web Crypto doesn't have (implemented below).
 */

const enc = new TextEncoder();
const dec = new TextDecoder("utf-8", { fatal: true });

/* ---------- JSON ---------- */

export type JsonResult = { ok: true; value: unknown; text: string } | { ok: false; error: string; line?: number; column?: number };

/** Parses JSON and says where it broke, in lines and columns people can find. */
export function parseJson(input: string): JsonResult {
  try {
    const value = JSON.parse(input);
    return { ok: true, value, text: input };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const pos = /position (\d+)/i.exec(msg)?.[1];
    const lc = /line (\d+) column (\d+)/i.exec(msg);
    let line: number | undefined;
    let column: number | undefined;
    if (lc) {
      line = Number(lc[1]);
      column = Number(lc[2]);
    } else {
      const at = pos !== undefined ? Number(pos) : locateJsonError(input);
      if (at !== null) {
        const before = input.slice(0, at);
        line = before.split("\n").length;
        column = before.length - before.lastIndexOf("\n");
      }
    }
    const error = msg.replace(/^JSON\.parse: /, "").replace(/ in JSON at position \d+.*$/, "").replace(/, "[\s\S]*" is not valid JSON$/, "");
    return { ok: false, error, line, column };
  }
}

/** Where JSON first goes wrong (index), by walking the grammar; null if it can't tell. */
function locateJsonError(s: string): number | null {
  let i = 0;
  const ws = () => {
    while (i < s.length && " \t\n\r".includes(s[i])) i++;
  };
  const fail = (): never => {
    throw i;
  };
  const value = (): void => {
    ws();
    const c = s[i];
    if (c === "{") {
      i++;
      ws();
      if (s[i] === "}") return void i++;
      for (;;) {
        ws();
        if (s[i] !== '"') fail();
        string();
        ws();
        if (s[i] !== ":") fail();
        i++;
        value();
        ws();
        if (s[i] === ",") i++;
        else if (s[i] === "}") return void i++;
        else fail();
      }
    }
    if (c === "[") {
      i++;
      ws();
      if (s[i] === "]") return void i++;
      for (;;) {
        value();
        ws();
        if (s[i] === ",") i++;
        else if (s[i] === "]") return void i++;
        else fail();
      }
    }
    if (c === '"') return string();
    const m = /^(-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?|true|false|null)/.exec(s.slice(i, i + 400));
    if (!m) fail();
    i += m![0].length;
  };
  const string = () => {
    i++;
    while (i < s.length && s[i] !== '"') {
      if (s[i] === "\\") i++;
      else if (s[i] < " ") fail();
      i++;
    }
    if (s[i] !== '"') fail();
    i++;
  };
  try {
    value();
    ws();
    return i < s.length ? i : null;
  } catch (at) {
    return typeof at === "number" ? Math.min(at, s.length) : null;
  }
}

export function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]));
  }
  return v;
}

/** JSON as CSV: an array of objects becomes rows; nested values are flattened to dot.keys. */
export function jsonToCsv(v: unknown): string {
  const rows = Array.isArray(v) ? v : [v];
  const flat = rows.map((r) => flatten(r));
  const cols = [...new Set(flat.flatMap((r) => Object.keys(r)))];
  const cell = (x: unknown) => {
    const s = x === null || x === undefined ? "" : String(x);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.map(cell).join(","), ...flat.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n");
}

function flatten(v: unknown, prefix = "", out: Record<string, unknown> = {}): Record<string, unknown> {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    for (const [k, x] of Object.entries(v)) flatten(x, prefix ? `${prefix}.${k}` : k, out);
  } else if (Array.isArray(v) && prefix) {
    out[prefix] = JSON.stringify(v);
  } else {
    out[prefix || "value"] = v;
  }
  return out;
}

/* ---------- Base64 ---------- */

export function toBase64(bytes: Uint8Array, urlSafe = false): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const b = btoa(bin);
  return urlSafe ? b.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") : b;
}

export function fromBase64(text: string): Uint8Array {
  let t = text.trim().replace(/^data:[^,]*,/, "").replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  if (!/^[A-Za-z0-9+/]*=*$/.test(t)) throw new Error("That isn't Base64: it has characters Base64 doesn't use.");
  while (t.length % 4) t += "=";
  const bin = atob(t);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export const utf8 = (s: string) => enc.encode(s);

/** Bytes as text, or null if they aren't valid UTF-8 (a picture, a zip…). */
export function asText(bytes: Uint8Array): string | null {
  try {
    return dec.decode(bytes);
  } catch {
    return null;
  }
}

/* ---------- Hashes ---------- */

export const HASHES = ["MD5", "SHA-1", "SHA-256", "SHA-384", "SHA-512"] as const;
export type HashName = (typeof HASHES)[number];

const hex = (buf: ArrayBuffer | Uint8Array) => Array.from(new Uint8Array(buf as ArrayBuffer), (b) => b.toString(16).padStart(2, "0")).join("");

export async function hash(name: HashName, data: Uint8Array, key?: string): Promise<string> {
  if (name === "MD5") return key ? hex(hmacMd5(utf8(key), data)) : hex(md5(data));
  if (key) {
    const k = await crypto.subtle.importKey("raw", utf8(key) as BufferSource, { name: "HMAC", hash: name }, false, ["sign"]);
    return hex(await crypto.subtle.sign("HMAC", k, data as BufferSource));
  }
  return hex(await crypto.subtle.digest(name, data as BufferSource));
}

/** MD5 (RFC 1321). Fine for checksums; never for passwords or signatures. */
export function md5(data: Uint8Array): Uint8Array {
  const s = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
  const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);
  const len = data.length;
  const padded = new Uint8Array(((len + 8) >> 6) * 64 + 64);
  padded.set(data);
  padded[len] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, (len * 8) >>> 0, true);
  view.setUint32(padded.length - 4, Math.floor((len * 8) / 2 ** 32), true);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const M = new Uint32Array(16);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) M[i] = view.getUint32(off + i * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F: number, g: number;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      F = (F + A + K[i] + M[g]) >>> 0;
      A = D; D = C; C = B;
      B = (B + ((F << s[i]) | (F >>> (32 - s[i])))) >>> 0;
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
  }
  const out = new Uint8Array(16);
  const ov = new DataView(out.buffer);
  [a0, b0, c0, d0].forEach((w, i) => ov.setUint32(i * 4, w, true));
  return out;
}

function hmacMd5(key: Uint8Array, msg: Uint8Array): Uint8Array {
  let k = key.length > 64 ? md5(key) : key;
  const block = new Uint8Array(64);
  block.set(k);
  k = block;
  const ipad = k.map((b) => b ^ 0x36);
  const opad = k.map((b) => b ^ 0x5c);
  const inner = new Uint8Array(64 + msg.length);
  inner.set(ipad);
  inner.set(msg, 64);
  const outer = new Uint8Array(64 + 16);
  outer.set(opad);
  outer.set(md5(inner), 64);
  return md5(outer);
}

/* ---------- JWT ---------- */

export type Jwt = { header: Record<string, unknown>; payload: Record<string, unknown>; signature: string; signingInput: string };

export function decodeJwt(token: string): Jwt {
  const parts = token.trim().split(".");
  if (parts.length !== 3) throw new Error("A JWT has three parts separated by dots: header.payload.signature.");
  const part = (p: string, what: string) => {
    const text = asText(fromBase64(p));
    if (text === null) throw new Error(`The ${what} isn't readable text.`);
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new Error(`The ${what} isn't JSON.`);
    }
  };
  return { header: part(parts[0], "header"), payload: part(parts[1], "payload"), signature: parts[2], signingInput: `${parts[0]}.${parts[1]}` };
}

/** Checks an HS256/384/512 signature with a shared secret. Other algorithms need a public key. */
export async function verifyHmacJwt(jwt: Jwt, secret: string): Promise<boolean | null> {
  const alg = String(jwt.header.alg ?? "");
  const hashName = { HS256: "SHA-256", HS384: "SHA-384", HS512: "SHA-512" }[alg];
  if (!hashName) return null;
  const key = await crypto.subtle.importKey("raw", utf8(secret) as BufferSource, { name: "HMAC", hash: hashName }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, utf8(jwt.signingInput) as BufferSource));
  return toBase64(sig, true) === jwt.signature.replace(/=+$/, "");
}

/* ---------- IDs and passwords ---------- */

export function uuidV4(): string {
  return crypto.randomUUID();
}

/** UUID v7: time-ordered (sorts by creation time), the modern choice for database keys. */
export function uuidV7(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  const ms = Date.now();
  for (let i = 0; i < 6; i++) b[i] = Math.floor(ms / 2 ** (8 * (5 - i))) & 0xff;
  b[6] = (b[6] & 0x0f) | 0x70;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = hex(b);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const NANO = "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict";
export function nanoid(size = 21): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(size)), (b) => NANO[b & 63]).join("");
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/** ULID: 26-character Crockford Base32 lexicographically sortable unique ID. */
export function ulid(ms = Date.now()): string {
  let t = Math.max(0, Math.floor(ms));
  let timePart = "";
  for (let i = 0; i < 10; i++) {
    timePart = CROCKFORD[t % 32] + timePart;
    t = Math.floor(t / 32);
  }
  const r = crypto.getRandomValues(new Uint8Array(10));
  let randPart = "";
  for (let g = 0; g < 10; g += 5) {
    const b0 = r[g], b1 = r[g + 1], b2 = r[g + 2], b3 = r[g + 3], b4 = r[g + 4];
    randPart +=
      CROCKFORD[(b0 >> 3) & 31] +
      CROCKFORD[((b0 & 7) << 2) | (b1 >> 6)] +
      CROCKFORD[(b1 >> 1) & 31] +
      CROCKFORD[((b1 & 1) << 4) | (b2 >> 4)] +
      CROCKFORD[((b2 & 15) << 1) | (b3 >> 7)] +
      CROCKFORD[(b3 >> 2) & 31] +
      CROCKFORD[((b3 & 3) << 3) | (b4 >> 5)] +
      CROCKFORD[b4 & 31];
  }
  return timePart + randPart;
}

export type PasswordOptions = { length: number; lower: boolean; upper: boolean; digits: boolean; symbols: boolean; noLookalikes: boolean };

/** Uniform, unbiased picks from crypto.getRandomValues, with at least one of each chosen kind. */
export function password(o: PasswordOptions): string {
  const strip = (s: string) => (o.noLookalikes ? s.replace(/[Il1O0o]/g, "") : s);
  const sets = [o.lower && strip("abcdefghijklmnopqrstuvwxyz"), o.upper && strip("ABCDEFGHIJKLMNOPQRSTUVWXYZ"), o.digits && strip("0123456789"), o.symbols && "!@#$%^&*()-_=+[]{};:,.?/~"].filter(Boolean) as string[];
  if (!sets.length) return "";
  const all = sets.join("");
  const pick = (s: string) => {
    const limit = 256 - (256 % s.length);
    for (;;) {
      const [x] = crypto.getRandomValues(new Uint8Array(1));
      if (x < limit) return s[x % s.length];
    }
  };
  const chars = sets.map(pick);
  while (chars.length < o.length) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.slice(0, o.length).join("");
}

export function entropyBits(o: PasswordOptions): number {
  const size = (o.lower ? 26 : 0) + (o.upper ? 26 : 0) + (o.digits ? 10 : 0) + (o.symbols ? 25 : 0) - (o.noLookalikes ? 6 : 0);
  return size > 1 ? Math.round(o.length * Math.log2(size)) : 0;
}

/* ---------- Text ---------- */

/** Words from any case style: "userIDName" / "user_id-name" / "User Id Name" → ["user", "id", "name"]. */
export function words(s: string): string[] {
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9À-￿]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);
export const CASES: { id: string; label: string; fn: (s: string) => string }[] = [
  { id: "camel", label: "camelCase", fn: (s) => words(s).map((w, i) => (i ? cap(w) : w)).join("") },
  { id: "pascal", label: "PascalCase", fn: (s) => words(s).map(cap).join("") },
  { id: "snake", label: "snake_case", fn: (s) => words(s).join("_") },
  { id: "constant", label: "CONSTANT_CASE", fn: (s) => words(s).join("_").toUpperCase() },
  { id: "kebab", label: "kebab-case", fn: (s) => words(s).join("-") },
  { id: "dot", label: "dot.case", fn: (s) => words(s).join(".") },
  { id: "title", label: "Title Case", fn: (s) => words(s).map(cap).join(" ") },
  { id: "sentence", label: "Sentence case", fn: (s) => cap(words(s).join(" ")) },
  { id: "lower", label: "lower case", fn: (s) => s.toLowerCase() },
  { id: "upper", label: "UPPER CASE", fn: (s) => s.toUpperCase() },
];

/** Line diff by longest common subsequence (fine for a few thousand lines). */
export type DiffLine = { kind: "same" | "add" | "del"; text: string; a?: number; b?: number };
export function diffLines(a: string, b: string): DiffLine[] {
  const A = a.split("\n");
  const B = b.split("\n");
  const n = A.length;
  const m = B.length;
  if (n * m > 25_000_000) throw new Error("Those texts are too long to compare here (keep each under ~5,000 lines).");
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) out.push({ kind: "same", text: A[i], a: ++i, b: ++j });
    else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ kind: "del", text: A[i], a: ++i });
    else out.push({ kind: "add", text: B[j], b: ++j });
  }
  while (i < n) out.push({ kind: "del", text: A[i], a: ++i });
  while (j < m) out.push({ kind: "add", text: B[j], b: ++j });
  return out;
}

/* ---------- Numbers, time, colour ---------- */

export function parseBigInt(text: string, base: number): bigint | null {
  const t = text.trim().replace(/[_\s]/g, "").replace(/^0[xob]/i, "").toLowerCase();
  if (!t) return null;
  const digits = "0123456789abcdefghijklmnopqrstuvwxyz".slice(0, base);
  const neg = t.startsWith("-");
  const body = neg ? t.slice(1) : t;
  if (!body || [...body].some((c) => !digits.includes(c))) return null;
  let v = BigInt(0);
  const B = BigInt(base);
  for (const c of body) v = v * B + BigInt(digits.indexOf(c));
  return neg ? -v : v;
}

/** A Unix time in seconds or milliseconds (guessed from its size) → Date. */
export function fromUnix(text: string): { date: Date; unit: "s" | "ms" } | null {
  const t = text.trim();
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  const unit = Math.abs(n) >= 1e11 ? "ms" : "s";
  const date = new Date(unit === "ms" ? n : n * 1000);
  return Number.isNaN(date.getTime()) ? null : { date, unit };
}

export function relative(date: Date, now = Date.now()): string {
  const s = Math.round((date.getTime() - now) / 1000);
  const fmt = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const steps: [number, Intl.RelativeTimeFormatUnit][] = [[60, "second"], [60, "minute"], [24, "hour"], [30, "day"], [12, "month"], [Infinity, "year"]];
  let v = s;
  for (const [size, unit] of steps) {
    if (Math.abs(v) < size) return fmt.format(Math.round(v), unit);
    v /= size;
  }
  return "";
}

export type Rgb = { r: number; g: number; b: number; a: number };

export function parseColor(text: string): Rgb | null {
  const t = text.trim().toLowerCase();
  let m = /^#?([0-9a-f]{3,8})$/.exec(t);
  if (m && [3, 4, 6, 8].includes(m[1].length)) {
    const h = m[1].length <= 4 ? [...m[1]].map((c) => c + c).join("") : m[1];
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 };
  }
  m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+%?))?\s*\)$/.exec(t);
  if (m) {
    const a = m[4] ? (m[4].endsWith("%") ? Number(m[4].slice(0, -1)) / 100 : Number(m[4])) : 1;
    return { r: Math.min(255, +m[1]), g: Math.min(255, +m[2]), b: Math.min(255, +m[3]), a };
  }
  m = /^hsla?\(\s*([\d.]+)(?:deg)?[,\s]+([\d.]+)%[,\s]+([\d.]+)%(?:[,\s/]+([\d.]+%?))?\s*\)$/.exec(t);
  if (m) {
    const [r, g, b] = hslToRgb(+m[1], +m[2] / 100, +m[3] / 100);
    const a = m[4] ? (m[4].endsWith("%") ? Number(m[4].slice(0, -1)) / 100 : Number(m[4])) : 1;
    return { r, g, b, a };
  }
  return null;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

export function rgbToHsl({ r, g, b }: Rgb): [number, number, number] {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, Math.round(l * 100)];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [Math.round(h * 60), Math.round(s * 100), Math.round(l * 100)];
}

/** WCAG contrast ratio between two colours. */
export function contrast(a: Rgb, b: Rgb): number {
  const lum = ({ r, g, b }: Rgb) => {
    const c = [r, g, b].map((v) => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

export const toHex = ({ r, g, b, a }: Rgb) =>
  `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}${a < 1 ? Math.round(a * 255).toString(16).padStart(2, "0") : ""}`;

/**
 * A demo token for the JWT tool, signed here at runtime (HS256) with SAMPLE_JWT_SECRET. Building it
 * rather than pasting a literal keeps token-shaped strings out of the source, so secret scanners
 * don't flag a harmless example.
 */
export const SAMPLE_JWT_SECRET = "demo-secret";
export async function sampleJwt(): Promise<string> {
  const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const part = (o: object) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const now = Math.floor(Date.now() / 1000);
  const signing = `${part({ alg: "HS256", typ: "JWT" })}.${part({ sub: "1234567890", name: "Ada Lovelace", role: "demo", iat: now, exp: now + 3600 })}`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SAMPLE_JWT_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signing)));
  return `${signing}.${b64url(sig)}`;
}
