/**
 * Random data, made with crypto.getRandomValues (uniform, unbiased by rejection sampling).
 */

export type RandomKind =
  | "names" | "string" | "alnum" | "letters" | "integer" | "decimal" | "fraction" | "prime" | "hex" | "binary" | "bytes"
  | "date" | "time" | "ip" | "mac" | "json" | "csv" | "tsv" | "xml" | "regex" | "bitmap";

/** A uniform integer in [0, n). */
export function randInt(n: number): number {
  if (n <= 0) return 0;
  if (n > 2 ** 32) return Math.floor(randFloat() * n);
  const limit = Math.floor(2 ** 32 / n) * n;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % n;
  }
}
/** A uniform float in [0, 1) with 53 bits. */
export function randFloat(): number {
  const b = new Uint32Array(2);
  crypto.getRandomValues(b);
  return ((b[0] >>> 5) * 67108864 + (b[1] >>> 6)) / 9007199254740992;
}
export const randBetween = (min: number, max: number) => min + randInt(max - min + 1);
export const pick = <T,>(list: readonly T[]) => list[randInt(list.length)];
export function shuffle<T>(list: T[]): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const CHARSETS = {
  lower: "abcdefghijklmnopqrstuvwxyz",
  upper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  digits: "0123456789",
  symbols: "!@#$%^&*()-_=+[]{};:,.<>/?~",
};
export const randString = (len: number, chars: string) => (chars ? Array.from({ length: len }, () => chars[randInt(chars.length)]).join("") : "");

export function isPrime(n: number): boolean {
  if (n < 2) return false;
  if (n % 2 === 0) return n === 2;
  if (n % 3 === 0) return n === 3;
  for (let i = 5; i * i <= n; i += 6) if (n % i === 0 || n % (i + 2) === 0) return false;
  return true;
}
export function randomPrime(min: number, max: number): number | null {
  for (let tries = 0; tries < 20000; tries++) {
    const n = randBetween(min, max);
    if (isPrime(n)) return n;
  }
  for (let n = min; n <= max; n++) if (isPrime(n)) return n;
  return null;
}
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
export function randomFraction(maxDen: number, proper: boolean) {
  const den = randBetween(2, Math.max(2, maxDen));
  const num = proper ? randBetween(1, den - 1) : randBetween(1, den * 3);
  const g = gcd(num, den);
  return `${num / g}/${den / g}`;
}

export function randomIp(v: 4 | 6, publicOnly: boolean): string {
  if (v === 6) return Array.from({ length: 8 }, (_, i) => (i === 0 ? (0x2000 + randInt(0x1000)) : randInt(0x10000)).toString(16)).join(":");
  for (;;) {
    const p = Array.from({ length: 4 }, () => randInt(256));
    if (!publicOnly) return p.join(".");
    const [a, b] = p;
    const reserved = a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b < 32) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b < 128);
    if (!reserved) return p.join(".");
  }
}
export function randomMac(sep: string, upper: boolean, local: boolean): string {
  const b = Array.from({ length: 6 }, () => randInt(256));
  if (local) b[0] = (b[0] | 2) & 0xfe; // Locally administered, unicast: never clashes with a real vendor.
  const s = b.map((x) => x.toString(16).padStart(2, "0")).join(sep);
  return upper ? s.toUpperCase() : s;
}

export function randomDate(from: string, to: string): Date {
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  return new Date(lo + Math.floor(randFloat() * (hi - lo + 1)));
}

/* ---------- records: names, emails, cities ---------- */

const FIRST = ["Aarav", "Olivia", "Liam", "Emma", "Noah", "Ava", "Mateo", "Sofia", "Arjun", "Mia", "Lucas", "Isla", "Ethan", "Zara", "Kenji", "Amara", "Diego", "Priya", "Leo", "Chloe", "Omar", "Hana", "Felix", "Ines", "Ravi", "Nora", "Jonas", "Lea", "Samir", "Grace", "Yusuf", "Elena", "Kofi", "Maya", "Ivan", "Aisha", "Hugo", "Freya", "Tariq", "Lin"];
const LAST = ["Sharma", "Smith", "Garcia", "Müller", "Rossi", "Kim", "Nguyen", "Okafor", "Silva", "Tanaka", "Cohen", "Ali", "Brown", "Dubois", "Kowalski", "Haddad", "Johansson", "Patel", "Lopez", "Wilson", "Chen", "Singh", "Ivanova", "Mensah", "Novak", "Das", "Fischer", "Moreau", "Sato", "Costa"];
const CITIES = ["Mumbai", "London", "Tokyo", "Lagos", "São Paulo", "Berlin", "Toronto", "Sydney", "Nairobi", "Seoul", "Paris", "Mexico City", "Dubai", "Singapore", "Kolkata", "Madrid", "Cairo", "Oslo", "Austin", "Lima"];
const WORDS = ["alpha", "bright", "cedar", "delta", "ember", "falcon", "garnet", "harbor", "indigo", "juniper", "kestrel", "lumen", "maple", "nimbus", "onyx", "pixel", "quartz", "river", "summit", "tundra"];

export type FieldType = "id" | "uuid" | "first" | "last" | "name" | "email" | "city" | "int" | "float" | "bool" | "date" | "word" | "ip";
export const FIELD_TYPES: FieldType[] = ["id", "uuid", "first", "last", "name", "email", "city", "int", "float", "bool", "date", "word", "ip"];
export type Field = { name: string; type: FieldType };
export const DEFAULT_FIELDS: Field[] = [
  { name: "id", type: "id" },
  { name: "name", type: "name" },
  { name: "email", type: "email" },
  { name: "city", type: "city" },
  { name: "age", type: "int" },
  { name: "active", type: "bool" },
];

function fieldValue(t: FieldType, i: number): string | number | boolean {
  switch (t) {
    case "id": return i + 1;
    case "uuid": return crypto.randomUUID();
    case "first": return pick(FIRST);
    case "last": return pick(LAST);
    case "name": return `${pick(FIRST)} ${pick(LAST)}`;
    case "email": return `${pick(FIRST).toLowerCase()}.${pick(LAST).toLowerCase().normalize("NFD").replace(/[^a-z]/g, "")}${randInt(100)}@example.com`;
    case "city": return pick(CITIES);
    case "int": return randBetween(18, 90);
    case "float": return Math.round(randFloat() * 100000) / 100;
    case "bool": return randInt(2) === 1;
    case "date": return randomDate("2015-01-01", "2026-12-31").toISOString().slice(0, 10);
    case "word": return pick(WORDS);
    case "ip": return randomIp(4, true);
  }
}

export function randomRecords(fields: Field[], count: number): Record<string, string | number | boolean>[] {
  return Array.from({ length: count }, (_, i) => Object.fromEntries(fields.filter((f) => f.name.trim()).map((f) => [f.name.trim(), fieldValue(f.type, i)])));
}

export function recordsAs(rows: Record<string, string | number | boolean>[], kind: "json" | "csv" | "tsv" | "xml"): string {
  if (kind === "json") return JSON.stringify(rows, null, 2);
  const keys = Object.keys(rows[0] ?? {});
  if (kind === "xml") {
    const tag = (k: string) => (/^[A-Za-z_][\w.-]*$/.test(k) ? k : "field");
    const esc = (v: unknown) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return `<?xml version="1.0" encoding="UTF-8"?>\n<records>\n${rows.map((r) => `  <record>\n${keys.map((k) => `    <${tag(k)}>${esc(r[k])}</${tag(k)}>`).join("\n")}\n  </record>`).join("\n")}\n</records>\n`;
  }
  const sep = kind === "csv" ? "," : "\t";
  const cell = (v: unknown) => {
    const s = String(v);
    return kind === "csv" && /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s.replace(/\t/g, " ");
  };
  return [keys.map(cell).join(sep), ...rows.map((r) => keys.map((k) => cell(r[k])).join(sep))].join("\n") + "\n";
}

/** Strings matching a regular expression (randexp), with unbounded repeats capped. */
export async function fromRegex(pattern: string, flags: string, count: number, maxRepeat: number): Promise<string[]> {
  const RandExp = (await import("randexp")).default;
  const re = new RegExp(pattern, flags.replace(/[gy]/g, ""));
  const r = new RandExp(re);
  r.max = maxRepeat;
  r.randInt = (a: number, b: number) => randBetween(a, b);
  return Array.from({ length: count }, () => r.gen());
}
