/**
 * Pure text conversions behind the Text and Developer tools. No network; every function is
 * deterministic (except the random ones, which use crypto.getRandomValues).
 */

const enc = new TextEncoder();
const dec = new TextDecoder("utf-8", { fatal: false });

/* ---------- text ⇄ codes (binary, hex, decimal/ASCII, octal) ---------- */

export type CodeBase = "binary" | "hex" | "decimal" | "octal";
const RADIX: Record<CodeBase, number> = { binary: 2, hex: 16, decimal: 10, octal: 8 };
const WIDTH: Record<CodeBase, number> = { binary: 8, hex: 2, decimal: 0, octal: 3 };

/** Text → one code per UTF-8 byte (ASCII stays one byte per character). */
export function textToCodes(text: string, base: CodeBase, sep = " ", upper = false): string {
  return Array.from(enc.encode(text), (b) => {
    const s = b.toString(RADIX[base]).padStart(WIDTH[base], "0");
    return upper ? s.toUpperCase() : s;
  }).join(sep);
}

/** Codes → text. Accepts spaces, commas or nothing between codes (fixed-width bases), and 0x/0b prefixes. */
export function codesToText(input: string, base: CodeBase): string {
  const t = input.trim();
  if (!t) return "";
  let parts = t.split(/[\s,;]+/).filter(Boolean);
  const valid = { binary: /^[01]+$/, hex: /^[0-9a-f]+$/i, decimal: /^\d+$/, octal: /^[0-7]+$/ }[base];
  parts = parts.map((p) => p.replace(/^0x/i, "").replace(/^0b/i, ""));
  if (parts.length === 1 && WIDTH[base] && parts[0].length > WIDTH[base]) {
    const w = WIDTH[base];
    if (parts[0].length % w) throw new Error(`Without spaces, ${base} needs groups of ${w} digits.`);
    parts = parts[0].match(new RegExp(`.{${w}}`, "g")) ?? [];
  }
  const bytes = parts.map((p) => {
    if (!valid.test(p)) throw new Error(`“${p}” isn't ${base === "hex" ? "a hex" : `a ${base}`} code.`);
    const n = parseInt(p, RADIX[base]);
    if (n > 255) {
      if (base === "decimal") return null; // A code point: handled below.
      throw new Error(`“${p}” is over 255; each code is one byte.`);
    }
    return n;
  });
  if (bytes.some((b) => b === null)) return parts.map((p) => String.fromCodePoint(parseInt(p, 10))).join("");
  return dec.decode(new Uint8Array(bytes as number[]));
}

/* ---------- fancy text ---------- */

const FLIP: Record<string, string> = {
  a: "ɐ", b: "q", c: "ɔ", d: "p", e: "ǝ", f: "ɟ", g: "ƃ", h: "ɥ", i: "ᴉ", j: "ɾ", k: "ʞ", l: "l", m: "ɯ", n: "u", o: "o", p: "d", q: "b", r: "ɹ", s: "s",
  t: "ʇ", u: "n", v: "ʌ", w: "ʍ", x: "x", y: "ʎ", z: "z", A: "∀", B: "ᗺ", C: "Ɔ", D: "ᗡ", E: "Ǝ", F: "Ⅎ", G: "⅁", H: "H", I: "I", J: "ſ", K: "ʞ", L: "˥",
  M: "W", N: "N", O: "O", P: "Ԁ", Q: "Ό", R: "ᴚ", S: "S", T: "⊥", U: "∩", V: "Λ", W: "M", X: "X", Y: "⅄", Z: "Z", "1": "Ɩ", "2": "ᄅ", "3": "Ɛ",
  "4": "ㄣ", "5": "ϛ", "6": "9", "7": "ㄥ", "8": "8", "9": "6", "0": "0", ".": "˙", ",": "'", "'": ",", '"': "„", "?": "¿", "!": "¡", "(": ")", ")": "(",
  "[": "]", "]": "[", "{": "}", "}": "{", "<": ">", ">": "<", "&": "⅋", _: "‾", ";": "؛",
};
const UNFLIP = Object.fromEntries(Object.entries(FLIP).map(([k, v]) => [v, k]));

export const upsideDown = (s: string) => [...s].reverse().map((c) => FLIP[c] ?? UNFLIP[c] ?? c).join("");

const MIRROR: Record<string, string> = {
  a: "ɒ", b: "d", c: "ɔ", d: "b", e: "ɘ", f: "ʇ", g: "ϱ", h: "ʜ", j: "ᒑ", k: "ʞ", p: "q", q: "p", r: "ɿ", s: "ꙅ", t: "ƚ", y: "ʏ", z: "ƹ",
  B: "ᙠ", C: "Ɔ", D: "ᗡ", E: "Ǝ", F: "ꟻ", G: "Ꭾ", J: "Ⴑ", K: "ꓘ", L: "⅃", N: "И", P: "ꟼ", Q: "Ọ", R: "Я", S: "Ƨ", Z: "Ƹ",
  "2": "S", "3": "Ɛ", "4": "ᔨ", "7": "Ⴖ", "(": ")", ")": "(", "[": "]", "]": "[", "{": "}", "}": "{", "<": ">", ">": "<", "?": "⸮", "/": "\\", "\\": "/",
};
export const mirror = (s: string) => s.split("\n").map((line) => [...line].reverse().map((c) => MIRROR[c] ?? c).join("")).join("\n");

export type ReverseMode = "characters" | "words" | "lines" | "each-word";
export function reverseText(s: string, mode: ReverseMode): string {
  if (mode === "characters") return [...s].reverse().join("");
  if (mode === "lines") return s.split("\n").reverse().join("\n");
  if (mode === "words") return s.split("\n").map((l) => l.split(/(\s+)/).reverse().join("")).join("\n");
  return s.split(/(\s+)/).map((w) => (/\s/.test(w) ? w : [...w].reverse().join(""))).join("");
}

/* ---------- numbers and words ---------- */

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const SCALES = ["", "thousand", "million", "billion", "trillion", "quadrillion", "quintillion"];
const INDIAN = [[BigInt(10) ** BigInt(7), "crore"], [BigInt(10) ** BigInt(5), "lakh"], [BigInt(1000), "thousand"]] as const;

function under1000(n: number): string {
  const parts: string[] = [];
  if (n >= 100) {
    parts.push(`${ONES[Math.floor(n / 100)]} hundred`);
    n %= 100;
    if (n) parts.push("and");
  }
  if (n >= 20) parts.push(TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : ""));
  else if (n || !parts.length) parts.push(ONES[n]);
  return parts.join(" ");
}

/** 1234.5 → "one thousand two hundred and thirty-four point five". Indian system: lakh and crore. */
export function numberToWords(input: string, system: "international" | "indian" = "international"): string {
  const t = input.replace(/[,\s_]/g, "").trim();
  if (!/^-?\d+(\.\d+)?$/.test(t)) throw new Error("Type a number like 1234 or 12.75.");
  const neg = t.startsWith("-");
  const [intPart, frac] = t.replace("-", "").split(".");
  let n = BigInt(intPart);
  if (n >= BigInt(10) ** BigInt(21)) throw new Error("That number is too big to say (up to 21 digits).");
  let words: string;
  if (n === BigInt(0)) words = "zero";
  else if (system === "indian") {
    const out: string[] = [];
    for (const [v, name] of INDIAN) {
      if (n >= v) {
        out.push(`${numberToWords(String(n / v), "indian")} ${name}`);
        n %= v;
      }
    }
    if (n) out.push(under1000(Number(n)));
    words = out.join(" ");
  } else {
    const groups: string[] = [];
    let i = 0;
    while (n > BigInt(0)) {
      const g = Number(n % BigInt(1000));
      if (g) groups.unshift(`${under1000(g)}${SCALES[i] ? " " + SCALES[i] : ""}`);
      n /= BigInt(1000);
      i++;
    }
    words = groups.join(" ");
  }
  if (frac) words += " point " + [...frac].map((d) => ONES[+d]).join(" ");
  return (neg ? "minus " : "") + words;
}

const WORD_VALUES: Record<string, number> = Object.fromEntries([
  ...ONES.map((w, i) => [w, i] as const),
  ...TENS.slice(2).map((w, i) => [w, (i + 2) * 10] as const),
]);
const MULT: Record<string, bigint> = { hundred: BigInt(100), thousand: BigInt(1000), million: BigInt(10) ** BigInt(6), billion: BigInt(10) ** BigInt(9), trillion: BigInt(10) ** BigInt(12), quadrillion: BigInt(10) ** BigInt(15), quintillion: BigInt(10) ** BigInt(18), lakh: BigInt(10) ** BigInt(5), lac: BigInt(10) ** BigInt(5), crore: BigInt(10) ** BigInt(7) };

/** "two million three hundred and five" → 2000305. Handles "point" decimals and "minus". */
export function wordsToNumber(input: string): string {
  const tokens = input.toLowerCase().replace(/-/g, " ").replace(/,/g, " ").split(/\s+/).filter((w) => w && w !== "and" && w !== "a");
  if (!tokens.length) return "";
  let neg = false;
  if (tokens[0] === "minus" || tokens[0] === "negative") {
    neg = true;
    tokens.shift();
  }
  let total = BigInt(0);
  let current = BigInt(0);
  let decimals = "";
  let inFraction = false;
  for (const w of tokens) {
    if (w === "point") {
      inFraction = true;
      continue;
    }
    if (inFraction) {
      if (!(w in WORD_VALUES) || WORD_VALUES[w] > 9) throw new Error(`After “point”, say single digits (“${w}” isn't one).`);
      decimals += String(WORD_VALUES[w]);
      continue;
    }
    if (w in WORD_VALUES) current += BigInt(WORD_VALUES[w]);
    else if (w === "hundred") current = (current || BigInt(1)) * BigInt(100);
    else if (w in MULT) {
      // Larger scales close the group: "two million three hundred thousand".
      const m = MULT[w];
      if (m >= BigInt(1000)) {
        total += (current || BigInt(1)) * m;
        current = BigInt(0);
      } else current *= m;
    } else if (/^\d+$/.test(w)) current += BigInt(w);
    else throw new Error(`“${w}” isn't a number word.`);
  }
  const value = (total + current).toString() + (decimals ? `.${decimals}` : "");
  return (neg ? "-" : "") + value;
}

/* ---------- Roman numerals ---------- */

const ROMAN: [number, string][] = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
export function toRoman(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 3999) throw new Error("Roman numerals run from 1 to 3999.");
  let out = "";
  for (const [v, s] of ROMAN)
    while (n >= v) {
      out += s;
      n -= v;
    }
  return out;
}
export function fromRoman(s: string): number {
  const t = s.trim().toUpperCase();
  if (!/^[MDCLXVI]+$/.test(t)) throw new Error("Roman numerals use only I, V, X, L, C, D and M.");
  const val: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  let n = 0;
  for (let i = 0; i < t.length; i++) n += val[t[i]] < (val[t[i + 1]] ?? 0) ? -val[t[i]] : val[t[i]];
  if (toRoman(n) !== t) throw new Error(`“${t}” isn't written the standard way; it would be ${toRoman(n)} (${n}).`);
  return n;
}

/* ---------- Morse ---------- */

export const MORSE: Record<string, string> = {
  A: ".-", B: "-...", C: "-.-.", D: "-..", E: ".", F: "..-.", G: "--.", H: "....", I: "..", J: ".---", K: "-.-", L: ".-..", M: "--", N: "-.", O: "---",
  P: ".--.", Q: "--.-", R: ".-.", S: "...", T: "-", U: "..-", V: "...-", W: ".--", X: "-..-", Y: "-.--", Z: "--..", "0": "-----", "1": ".----",
  "2": "..---", "3": "...--", "4": "....-", "5": ".....", "6": "-....", "7": "--...", "8": "---..", "9": "----.", ".": ".-.-.-", ",": "--..--",
  "?": "..--..", "'": ".----.", "!": "-.-.--", "/": "-..-.", "(": "-.--.", ")": "-.--.-", "&": ".-...", ":": "---...", ";": "-.-.-.", "=": "-...-",
  "+": ".-.-.", "-": "-....-", _: "..--.-", '"': ".-..-.", $: "...-..-", "@": ".--.-.",
};
const UNMORSE = Object.fromEntries(Object.entries(MORSE).map(([k, v]) => [v, k]));
export const toMorse = (s: string) =>
  s.toUpperCase().split(/\s+/).filter(Boolean).map((w) => [...w].map((c) => MORSE[c] ?? "").filter(Boolean).join(" ")).join(" / ");
export const fromMorse = (s: string) =>
  s.trim().split(/\s*[/|]\s*|\s{3,}/).map((w) => w.split(/\s+/).map((c) => UNMORSE[c.replace(/[·•]/g, ".").replace(/[–—_]/g, "-")] ?? (c ? "�" : "")).join("")).join(" ");
export const isMorse = (s: string) => /^[\s.\-/|·•–—_]+$/.test(s.trim()) && /[.\-·•–—]/.test(s);

/* ---------- escapes ---------- */

export const jsonEscape = (s: string) => JSON.stringify(s).slice(1, -1);
export function jsonUnescape(s: string): string {
  try {
    return JSON.parse(`"${s.replace(/(^|[^\\])"/g, '$1\\"')}"`);
  } catch {
    throw new Error("That text has an escape sequence JSON doesn't allow (like \\x or a lone backslash).");
  }
}

const HTML_NAMED: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export function htmlEncode(s: string, all = false): string {
  return [...s].map((c) => HTML_NAMED[c] ?? (all && c.codePointAt(0)! > 126 ? `&#${c.codePointAt(0)};` : c)).join("");
}
export function htmlDecode(s: string): string {
  if (typeof document === "undefined") return s.replace(/&(lt|gt|amp|quot|#39);/g, (m) => ({ "&lt;": "<", "&gt;": ">", "&amp;": "&", "&quot;": '"', "&#39;": "'" })[m] ?? m);
  const t = document.createElement("textarea");
  t.innerHTML = s;
  return t.value;
}

/* ---------- IEEE-754 ---------- */

export type FloatParts = { bits: string; hex: string; sign: number; exponent: string; mantissa: string; biased: number; unbiased: number; stored: string; error: string; kind: string };
export function ieee754(value: string, precision: 32 | 64): FloatParts {
  const t = value.trim().toLowerCase();
  const n = t === "nan" ? NaN : t === "inf" || t === "infinity" ? Infinity : t === "-inf" || t === "-infinity" ? -Infinity : Number(t);
  if (Number.isNaN(n) && t !== "nan") throw new Error("Type a number like 0.1, -2.5e10, Infinity or NaN.");
  const buf = new DataView(new ArrayBuffer(8));
  if (precision === 32) buf.setFloat32(0, n);
  else buf.setFloat64(0, n);
  const bytes = precision / 8;
  let bits = "";
  let hex = "";
  for (let i = 0; i < bytes; i++) {
    const b = buf.getUint8(i);
    bits += b.toString(2).padStart(8, "0");
    hex += b.toString(16).padStart(2, "0");
  }
  const eBits = precision === 32 ? 8 : 11;
  const bias = precision === 32 ? 127 : 1023;
  const exponent = bits.slice(1, 1 + eBits);
  const mantissa = bits.slice(1 + eBits);
  const biased = parseInt(exponent, 2);
  const stored = precision === 32 ? buf.getFloat32(0) : buf.getFloat64(0);
  const kind = biased === 0 ? (/1/.test(mantissa) ? "Subnormal" : "Zero") : biased === 2 ** eBits - 1 ? (/1/.test(mantissa) ? "NaN" : "Infinity") : "Normal";
  const exact = Number.isFinite(n) && Number.isFinite(stored) ? stored - n : 0;
  return {
    bits, hex: "0x" + hex.toUpperCase(), sign: +bits[0], exponent, mantissa, biased,
    unbiased: kind === "Normal" ? biased - bias : kind === "Subnormal" ? 1 - bias : 0,
    stored: precision === 32 ? stored.toPrecision(9) : stored.toPrecision(17), error: exact.toExponential(3), kind,
  };
}

/* ---------- cards ---------- */

export function luhn(digits: string): boolean {
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = +digits[i];
    if (dbl) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
    sum += d;
    dbl = !dbl;
  }
  return digits.length > 0 && sum % 10 === 0;
}
const CARDS: [string, RegExp, number[]][] = [
  ["Visa", /^4/, [13, 16, 19]], ["Mastercard", /^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/, [16]], ["American Express", /^3[47]/, [15]],
  ["Discover", /^(6011|65|64[4-9]|622)/, [16, 19]], ["JCB", /^35(2[89]|[3-8])/, [16, 19]], ["Diners Club", /^(36|38|30[0-5])/, [14, 16]],
  ["UnionPay", /^62/, [16, 17, 18, 19]], ["Maestro", /^(5018|5020|5038|6304|6759|676[1-3])/, [12, 13, 14, 15, 16, 17, 18, 19]], ["RuPay", /^(60|65|81|82|508)/, [16]],
];
export function checkCard(input: string) {
  const digits = input.replace(/[\s-]/g, "");
  if (!/^\d{8,19}$/.test(digits)) return { valid: false, brand: null as string | null, reason: "Card numbers have 8 to 19 digits.", digits };
  const brand = CARDS.find(([, re]) => re.test(digits));
  const lengthOk = brand ? brand[2].includes(digits.length) : true;
  const sum = luhn(digits);
  return {
    valid: sum && lengthOk,
    brand: brand?.[0] ?? null,
    reason: !sum ? "Fails the Luhn checksum: a digit is wrong or swapped." : !lengthOk ? `${brand![0]} numbers have ${brand![2].join(" or ")} digits.` : "Passes the Luhn checksum and length rules.",
    digits,
  };
}

/* ---------- summary (extractive) ---------- */

const STOP = new Set("a an the and or but if of at by for with about against between into through during before after above below to from up down in out on off over under again further then once here there when where why how all any both each few more most other some such no nor not only own same so than too very can will just don should now is are was were be been being have has had do does did i me my we our you your he him his she her it its they them their what which who whom this that these those am".split(" "));

/** The most representative sentences, in their original order (word-frequency scoring). */
export function summarize(text: string, ratio: number): { summary: string; kept: number; total: number } {
  const sentences = (text.replace(/\s+/g, " ").match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) ?? []).map((s) => s.trim()).filter(Boolean);
  if (sentences.length < 3) return { summary: sentences.join(" "), kept: sentences.length, total: sentences.length };
  const words = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}']+/gu)?.filter((w) => !STOP.has(w) && w.length > 2) ?? [];
  const freq = new Map<string, number>();
  for (const s of sentences) for (const w of words(s)) freq.set(w, (freq.get(w) ?? 0) + 1);
  const max = Math.max(...freq.values(), 1);
  const scored = sentences.map((s, i) => {
    const ws = words(s);
    const score = ws.reduce((a, w) => a + (freq.get(w) ?? 0) / max, 0) / Math.max(4, ws.length) + (i === 0 ? 0.15 : 0);
    return { s, i, score };
  });
  const keep = Math.max(1, Math.round(sentences.length * ratio));
  const chosen = [...scored].sort((a, b) => b.score - a.score).slice(0, keep).sort((a, b) => a.i - b.i);
  return { summary: chosen.map((c) => c.s).join(" "), kept: keep, total: sentences.length };
}

/* ---------- CSS to Less ---------- */

/** Nests flat CSS rules under their shared first selector part (".nav a" goes inside ".nav { }"). */
export function cssToLess(css: string): string {
  let clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  // At-rules (@media, @supports, @keyframes, @font-face, @import) are taken out whole, braces matched.
  const at: string[] = [];
  for (let i = clean.indexOf("@"); i !== -1; i = clean.indexOf("@", i)) {
    const open = clean.indexOf("{", i);
    const semi = clean.indexOf(";", i);
    if (open === -1 || (semi !== -1 && semi < open)) {
      const end = semi === -1 ? clean.length : semi + 1;
      at.push(clean.slice(i, end).trim());
      clean = clean.slice(0, i) + clean.slice(end);
      continue;
    }
    let depth = 0;
    let j = open;
    for (; j < clean.length; j++) {
      if (clean[j] === "{") depth++;
      else if (clean[j] === "}" && --depth === 0) break;
    }
    at.push(clean.slice(i, j + 1).trim());
    clean = clean.slice(0, i) + clean.slice(j + 1);
  }
  type Node = { decls: string[]; children: Map<string, Node> };
  const root: Node = { decls: [], children: new Map() };
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean))) {
    const decls = m[2].split(";").map((d) => d.trim()).filter(Boolean).map((d) => d.replace(/\s*:\s*/, ": "));
    for (const sel of m[1].split(",").map((x) => x.trim()).filter(Boolean)) {
      const parts = sel.split(/\s+(?![^[(]*[\])])/);
      let node = root;
      for (const part of parts) {
        if (!node.children.has(part)) node.children.set(part, { decls: [], children: new Map() });
        node = node.children.get(part)!;
      }
      node.decls.push(...decls);
    }
  }
  const out: string[] = [];
  const write = (node: Node, depth: number) => {
    for (const [sel, child] of node.children) {
      const pad = "  ".repeat(depth);
      out.push(`${pad}${sel} {`);
      for (const d of child.decls) out.push(`${pad}  ${d};`);
      write(child, depth + 1);
      out.push(`${pad}}`);
    }
  };
  write(root, 0);
  return [...at.filter((a) => a.startsWith("@import")), ...out, ...at.filter((a) => !a.startsWith("@import")).flatMap((a) => ["", a])].join("\n") + "\n";
}

/* ---------- lorem ipsum ---------- */

const LOREM = "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat duis aute irure in reprehenderit voluptate velit esse cillum fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt culpa qui officia deserunt mollit anim id est laborum".split(" ");
export function rand(n: number) {
  return crypto.getRandomValues(new Uint32Array(1))[0] % n;
}
export function lorem(kind: "paragraphs" | "sentences" | "words", count: number, classic: boolean): string {
  const sentence = () => {
    const len = 6 + rand(10);
    const ws = Array.from({ length: len }, () => LOREM[rand(LOREM.length)]);
    return ws.join(" ").replace(/^./, (c) => c.toUpperCase()) + ".";
  };
  const para = () => Array.from({ length: 4 + rand(4) }, sentence).join(" ");
  let out = kind === "words" ? Array.from({ length: count }, () => LOREM[rand(LOREM.length)]).join(" ") : kind === "sentences" ? Array.from({ length: count }, sentence).join(" ") : Array.from({ length: count }, para).join("\n\n");
  if (classic) out = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. " + out.replace(/^./, (c) => c.toUpperCase());
  return out;
}
