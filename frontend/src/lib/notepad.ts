/*
 * The smart notepad's logic (components/tools/text/notepad.tsx): find, inspect and transform text.
 * Pure functions, no DOM, so they're cheap to test and safe to run on every keystroke.
 */

export type FindOptions = { caseSensitive: boolean; wholeWord: boolean; regex: boolean };
export type Range = { start: number; end: number };

const MAX_MATCHES = 10_000;

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A global regex for the query, or an error message when a regex doesn't compile. */
export function buildFinder(query: string, o: FindOptions): RegExp | { error: string } | null {
  if (!query) return null;
  let source = o.regex ? query : escapeRegex(query);
  if (o.wholeWord) source = `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`;
  try {
    return new RegExp(source, `gu${o.caseSensitive ? "" : "i"}`);
  } catch (e) {
    return { error: e instanceof Error ? e.message.replace(/^Invalid regular expression: /, "") : "Invalid pattern" };
  }
}

/** Every match (empty matches skipped), capped so a pattern like `.` can't freeze the page. */
export function findAll(text: string, finder: RegExp | null): { ranges: Range[]; capped: boolean } {
  if (!finder) return { ranges: [], capped: false };
  const ranges: Range[] = [];
  finder.lastIndex = 0;
  for (const m of text.matchAll(finder)) {
    if (!m[0]) continue;
    ranges.push({ start: m.index!, end: m.index! + m[0].length });
    if (ranges.length >= MAX_MATCHES) return { ranges, capped: true };
  }
  return { ranges, capped: false };
}

/** The replacement in the match's capitals: FOX → CAT, Fox → Cat, fox → cat. */
export function keepCapitals(match: string, replacement: string): string {
  const letters = match.replace(/[^\p{L}]/gu, "");
  if (letters.length > 1 && letters === letters.toLocaleUpperCase() && letters !== letters.toLocaleLowerCase()) return replacement.toLocaleUpperCase();
  const first = letters[0];
  if (first && first === first.toLocaleUpperCase() && first !== first.toLocaleLowerCase()) return replacement.charAt(0).toLocaleUpperCase() + replacement.slice(1);
  return replacement;
}

/**
 * Replaces every match; `$1`-style groups work in regex mode, and are literal otherwise.
 * With `capitals`, a plain replacement follows each match's capitals (see keepCapitals).
 */
export function replaceAll(text: string, finder: RegExp, replacement: string, regexMode: boolean, capitals = false): { text: string; count: number } {
  let count = 0;
  const out = text.replace(finder, (...args) => {
    const match = args[0] as string;
    if (!match) return match;
    count++;
    if (!regexMode) return capitals ? keepCapitals(match, replacement) : replacement;
    // Re-run the single match so $1, $<name> and $& expand exactly as String.replace does.
    return match.replace(new RegExp(finder.source, finder.flags.replace("g", "")), replacement);
  });
  return { text: out, count };
}

/* ---------- position helpers ---------- */

/** 1-based line and column of an index. */
export function lineCol(text: string, index: number): { line: number; col: number } {
  let line = 1;
  let last = -1;
  for (let i = text.indexOf("\n"); i !== -1 && i < index; i = text.indexOf("\n", i + 1)) {
    line++;
    last = i;
  }
  return { line, col: index - last };
}

/** The index where a 1-based line starts (clamped to the text). */
export function lineStart(text: string, line: number): number {
  let idx = 0;
  for (let l = 1; l < line; l++) {
    const next = text.indexOf("\n", idx);
    if (next === -1) return idx;
    idx = next + 1;
  }
  return idx;
}

/* ---------- inspection ---------- */

export type Extracted = { kind: ExtractKind; label: string; items: { value: string; index: number; count: number }[] };
export type ExtractKind = "emails" | "urls" | "phones" | "numbers" | "hashtags" | "mentions" | "dates" | "ips";

const EXTRACTORS: { kind: ExtractKind; label: string; rx: RegExp }[] = [
  { kind: "emails", label: "Emails", rx: /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.\p{L}{2,}/gu },
  { kind: "urls", label: "Links", rx: /\b(?:https?:\/\/|www\.)[^\s<>"'`]+[^\s<>"'`.,;:!?)\]]/gi },
  { kind: "phones", label: "Phone numbers", rx: /(?<![\w.])\+?\(?\d[\d\s().-]{6,}\d(?![\w.])/g },
  { kind: "dates", label: "Dates", rx: /\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})\b/g },
  { kind: "ips", label: "IP addresses", rx: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g },
  { kind: "hashtags", label: "Hashtags", rx: /(?<![\p{L}\p{N}_&])#[\p{L}\p{N}_]+/gu },
  { kind: "mentions", label: "Mentions", rx: /(?<![\p{L}\p{N}_.])@[\p{L}\p{N}_.]+[\p{L}\p{N}_]/gu },
  { kind: "numbers", label: "Numbers", rx: /(?<![\p{L}\d.,])-?\d{1,3}(?:,\d{3})+(?:\.\d+)?(?![\d])|(?<![\p{L}\d.,])-?\d+(?:\.\d+)?(?![\d])/gu },
];

export function extract(text: string): Extracted[] {
  const out: Extracted[] = [];
  // Emails and links are found first; their spans are skipped by the other extractors, so the
  // digits in "user123@mail.com" or a URL's path don't show up as numbers or phone numbers.
  const taken: Range[] = [];
  const overlaps = (s: number, e: number) => taken.some((r) => s < r.end && e > r.start);
  for (const { kind, label, rx } of EXTRACTORS) {
    const seen = new Map<string, { value: string; index: number; count: number }>();
    for (const m of text.matchAll(rx)) {
      const value = m[0].trim();
      const start = m.index!;
      const end = start + m[0].length;
      if (overlaps(start, end)) continue;
      if (kind === "phones" && value.replace(/\D/g, "").length < 7) continue;
      if (kind === "phones" && /^\d{4}-\d{2}-\d{2}$/.test(value)) continue;
      const key = kind === "emails" || kind === "urls" ? value.toLowerCase() : value;
      const cur = seen.get(key);
      if (cur) cur.count++;
      else seen.set(key, { value, index: start, count: 1 });
      if (kind === "emails" || kind === "urls" || kind === "phones" || kind === "dates" || kind === "ips") taken.push({ start, end });
      if (seen.size > 2000) break;
    }
    if (seen.size) out.push({ kind, label, items: [...seen.values()] });
  }
  return out;
}

/** Sum, min, max and mean of the numbers in the text (commas as thousands separators). */
export function numberSummary(items: { value: string; count: number }[]) {
  const nums = items.flatMap((i) => Array<number>(i.count).fill(Number(i.value.replace(/,/g, "")))).filter(Number.isFinite);
  if (!nums.length) return null;
  const sum = nums.reduce((a, b) => a + b, 0);
  const round = (n: number) => Math.round(n * 1e6) / 1e6;
  return { count: nums.length, sum: round(sum), min: Math.min(...nums), max: Math.max(...nums), mean: round(sum / nums.length) };
}

export type Issue = {
  id: string;
  severity: "fix" | "info";
  label: string;
  detail: string;
  count: number;
  /** Where the first one is, to jump to it. */
  at?: Range;
  fix?: (s: string) => string;
  fixLabel?: string;
};

const INVISIBLE = /[­᠎​-‏‪-‮⁠-⁤﻿]|[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const ODD_SPACES = /[   -   　]/g;
const SMART = /[‘’‚‛“”„‟…]/g;

function firstRange(text: string, rx: RegExp): Range | undefined {
  rx.lastIndex = 0;
  const m = rx.exec(text);
  rx.lastIndex = 0;
  return m ? { start: m.index, end: m.index + Math.max(1, m[0].length) } : undefined;
}

const count = (text: string, rx: RegExp) => text.match(rx)?.length ?? 0;

/** Hidden characters a pasted text often carries (from PDFs, web pages, AI chats). */
export const INVISIBLE_RX = INVISIBLE;
export const ODD_SPACE_RX = ODD_SPACES;

export function findIssues(text: string): Issue[] {
  const issues: Issue[] = [];
  if (!text) return issues;
  const add = (i: Issue) => i.count > 0 && issues.push(i);

  add({
    id: "invisible",
    severity: "fix",
    label: "Hidden characters",
    detail: "Zero-width spaces, joiners, soft hyphens, direction marks or control characters you can't see.",
    count: count(text, INVISIBLE),
    at: firstRange(text, new RegExp(INVISIBLE.source, "g")),
    fix: (s) => s.replace(INVISIBLE, ""),
    fixLabel: "Remove",
  });
  add({
    id: "odd-spaces",
    severity: "fix",
    label: "Non-breaking or unusual spaces",
    detail: "Look like spaces but aren't: they break search, code and spreadsheets.",
    count: count(text, ODD_SPACES),
    at: firstRange(text, new RegExp(ODD_SPACES.source, "g")),
    fix: (s) => s.replace(ODD_SPACES, " "),
    fixLabel: "Make normal",
  });
  add({
    id: "trailing",
    severity: "fix",
    label: "Spaces at the end of lines",
    detail: "Trailing spaces or tabs.",
    count: count(text, /[ \t]+$/gm),
    at: firstRange(text, /[ \t]+$/gm),
    fix: (s) => s.replace(/[ \t]+$/gm, ""),
    fixLabel: "Trim",
  });
  add({
    id: "double-spaces",
    severity: "fix",
    label: "Double spaces",
    detail: "Two or more spaces between words.",
    count: count(text, /(?<=\S) {2,}(?=\S)/g),
    at: firstRange(text, /(?<=\S) {2,}(?=\S)/g),
    fix: (s) => s.replace(/(?<=\S) {2,}(?=\S)/g, " "),
    fixLabel: "Collapse",
  });
  add({
    id: "repeated-words",
    severity: "fix",
    label: "Repeated words",
    detail: "The same word twice in a row (“the the”).",
    count: count(text, /\b(\p{L}+)\s+\1\b/giu),
    at: firstRange(text, /\b(\p{L}+)\s+\1\b/giu),
    fix: (s) => s.replace(/\b(\p{L}+)(\s+\1\b)+/giu, "$1"),
    fixLabel: "Remove repeats",
  });
  add({
    id: "blank-runs",
    severity: "fix",
    label: "Runs of blank lines",
    detail: "Three or more empty lines in a row.",
    count: count(text, /\n[ \t]*\n(?:[ \t]*\n)+/g),
    at: firstRange(text, /\n[ \t]*\n(?:[ \t]*\n)+/g),
    fix: (s) => s.replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, "\n\n"),
    fixLabel: "Collapse",
  });

  const lines = text.split("\n");
  const seen = new Map<string, number>();
  let dupes = 0;
  let firstDupe: Range | undefined;
  let offset = 0;
  for (const line of lines) {
    const key = line.trim();
    if (key) {
      if (seen.has(key)) {
        dupes++;
        firstDupe ??= { start: offset, end: offset + line.length };
      } else seen.set(key, offset);
    }
    offset += line.length + 1;
  }
  add({
    id: "duplicate-lines",
    severity: "fix",
    label: "Duplicate lines",
    detail: "Lines that appear more than once (blank lines aside).",
    count: dupes,
    at: firstDupe,
    fix: (s) => dedupeLines(s),
    fixLabel: "Keep first of each",
  });
  add({
    id: "smart-quotes",
    severity: "info",
    label: "Curly quotes and ellipses",
    detail: "Fine in prose; in code, CSV or commands use straight quotes.",
    count: count(text, SMART),
    at: firstRange(text, new RegExp(SMART.source, "g")),
    fix: (s) => s.replace(/[‘’‚‛]/g, "'").replace(/[“”„‟]/g, '"').replace(/…/g, "..."),
    fixLabel: "Straighten",
  });
  const tabs = /^\t+/m.test(text);
  const spaces = /^ {2,}\S/m.test(text);
  if (tabs && spaces) {
    add({
      id: "mixed-indent",
      severity: "fix",
      label: "Tabs and spaces both used to indent",
      detail: "Mixed indentation lines up differently in every editor.",
      count: count(text, /^\t+/gm),
      at: firstRange(text, /^\t+/gm),
      fix: (s) => s.replace(/^\t+/gm, (t) => "  ".repeat(t.length)),
      fixLabel: "Tabs → 2 spaces",
    });
  }
  const longIdx = lines.findIndex((l) => l.length > 500);
  if (longIdx !== -1) {
    const start = lines.slice(0, longIdx).reduce((a, l) => a + l.length + 1, 0);
    add({
      id: "long-lines",
      severity: "info",
      label: "Very long lines",
      detail: "Lines over 500 characters; turn on word wrap to read them.",
      count: lines.filter((l) => l.length > 500).length,
      at: { start, end: start + lines[longIdx].length },
    });
  }
  const unbalanced = bracketProblem(text);
  if (unbalanced) {
    add({
      id: "brackets",
      severity: "info",
      label: "Unbalanced brackets",
      detail: unbalanced.message,
      count: 1,
      at: { start: unbalanced.index, end: unbalanced.index + 1 },
    });
  }
  return issues;
}

/** The first bracket that has no partner, if any (quotes and code strings aren't parsed). */
export function bracketProblem(text: string): { index: number; message: string } | null {
  const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  const stack: { ch: string; index: number }[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(" || ch === "[" || ch === "{") stack.push({ ch, index: i });
    else if (ch in pairs) {
      const top = stack.pop();
      if (!top) return { index: i, message: `A closing “${ch}” has no opening one.` };
      if (top.ch !== pairs[ch]) return { index: i, message: `“${top.ch}” is closed by “${ch}”.` };
    }
  }
  const open = stack.pop();
  return open ? { index: open.index, message: `“${open.ch}” is never closed.` } : null;
}

export type Format = { kind: "empty" | "json" | "csv" | "tsv" | "markdown" | "html" | "base64" | "list" | "text"; label: string; detail?: string; error?: { message: string; index?: number } };

/** What the text most likely is, so the inspector can say so (and check it). */
export function detectFormat(text: string): Format {
  const t = text.trim();
  if (!t) return { kind: "empty", label: "Empty" };
  if (/^[[{]/.test(t)) {
    try {
      const v = JSON.parse(t);
      const what = Array.isArray(v) ? `array of ${v.length}` : `object with ${Object.keys(v as object).length} keys`;
      return { kind: "json", label: "JSON", detail: `Valid · ${what}` };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Invalid JSON";
      const pos = /position (\d+)/.exec(msg);
      const lead = text.length - text.trimStart().length;
      return { kind: "json", label: "JSON", error: { message: msg.replace(/^JSON\.parse: /, ""), index: pos ? Number(pos[1]) + lead : undefined } };
    }
  }
  if (/^<(!doctype|html|\?xml|[a-z][\w:-]*[\s>/])/i.test(t)) return { kind: "html", label: "HTML / XML" };
  const lines = t.split("\n").filter((l) => l.trim());
  for (const [kind, sep, label] of [["tsv", "\t", "TSV"], ["csv", ",", "CSV"]] as const) {
    if (lines.length >= 2) {
      const cols = lines.slice(0, 50).map((l) => l.split(sep).length);
      if (cols[0] > 1 && cols.every((c) => c === cols[0])) return { kind, label, detail: `${lines.length} rows × ${cols[0]} columns` };
    }
  }
  if (t.length >= 16 && !/\s/.test(t.replace(/\n/g, "")) && /^[A-Za-z0-9+/_-]+={0,2}$/.test(t.replace(/\n/g, "")) && t.replace(/\n/g, "").length % 4 === 0 && /[0-9+/]/.test(t)) {
    return { kind: "base64", label: "Base64", detail: `${Math.floor((t.replace(/\n/g, "").length * 3) / 4)} bytes once decoded` };
  }
  const md = [/^#{1,6} /m, /^\s*[-*+] /m, /^\s*\d+\. /m, /\[[^\]]+\]\([^)]+\)/, /\*\*[^*]+\*\*/, /^```/m, /^> /m].filter((rx) => rx.test(t)).length;
  if (md >= 2) return { kind: "markdown", label: "Markdown" };
  const isList = lines.length >= 3 && !/\n\s*\n/.test(t) && lines.every((l) => l.length < 60 && !/[.!?:]\s+\S/.test(l));
  if (isList) return { kind: "list", label: "List", detail: `${lines.length} items` };
  return { kind: "text", label: "Plain text" };
}

const STOP = new Set(
  "a an and are as at be but by for from had has have he her his i if in into is it its me my no not of on or our she so than that the their them then there these they this to too up us was we were what when where which who will with would you your".split(" "),
);

/** Most used words (letters and digits, case-folded), optionally without the small ones. */
export function topWords(text: string, skipCommon: boolean, limit = 30): { word: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const m of text.toLocaleLowerCase().matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)) {
    const w = m[0].replace(/['’-]+$/, "");
    if (skipCommon && (STOP.has(w) || w.length < 2 || !/\p{L}/u.test(w))) continue;
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([word, count]) => ({ word, count }));
}

/** Counts for the overview and status bar. */
export function stats(text: string) {
  const words = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? [];
  const trimmed = text.trim();
  const sentences = trimmed ? trimmed.split(/(?<=[.!?。！？])\s+|\n{2,}/).filter((s) => s.trim()).length : 0;
  const paragraphs = trimmed ? trimmed.split(/\n\s*\n/).filter((p) => p.trim()).length : 0;
  const lines = text ? text.split("\n") : [];
  const chars = [...text].length;
  const unique = new Set(words.map((w) => w.toLocaleLowerCase())).size;
  const minutes = words.length / 225;
  return {
    chars,
    charsNoSpaces: [...text.replace(/\s/g, "")].length,
    words: words.length,
    unique,
    sentences,
    paragraphs,
    lines: lines.length,
    blankLines: lines.filter((l) => !l.trim()).length,
    longestLine: lines.reduce((a, l) => Math.max(a, l.length), 0),
    bytes: new TextEncoder().encode(text).length,
    nonAscii: [...text].filter((c) => c.codePointAt(0)! > 127).length,
    emoji: text.match(/\p{Extended_Pictographic}/gu)?.length ?? 0,
    readingTime: minutes < 1 ? `${Math.max(words.length ? 1 : 0, Math.round(minutes * 60))} sec` : `${Math.round(minutes)} min`,
  };
}

/* ---------- transforms ---------- */

export type TransformId =
  | "upper" | "lower" | "title" | "sentence" | "swap"
  | "trim-lines" | "remove-empty" | "dedupe" | "dedupe-any-case" | "sort-az" | "sort-za" | "sort-natural" | "sort-length" | "reverse-lines" | "shuffle" | "number-lines" | "unnumber-lines"
  | "join-lines" | "split-sentences" | "add-bullets" | "quote-lines"
  | "strip-invisible" | "straighten" | "collapse-spaces" | "tabs-to-spaces" | "strip-html" | "strip-markdown"
  | "json-pretty" | "json-minify" | "url-encode" | "url-decode";

const lines = (s: string) => s.split("\n");
const collator = new Intl.Collator(undefined, { sensitivity: "base" });
const natural = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function dedupeLines(s: string, anyCase = false): string {
  const seen = new Set<string>();
  return lines(s)
    .filter((l) => {
      const k = anyCase ? l.trim().toLocaleLowerCase() : l.trim();
      if (!k) return true;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .join("\n");
}

const titleCase = (s: string) => s.toLocaleLowerCase().replace(/(^|[\s\-–—(["“'‘/])(\p{L})/gu, (_, pre: string, ch: string) => pre + ch.toLocaleUpperCase());
const sentenceCase = (s: string) => s.toLocaleLowerCase().replace(/(^\s*|[.!?]\s+|\n\s*)(\p{L})/gu, (_, pre: string, ch: string) => pre + ch.toLocaleUpperCase()).replace(/\bi\b/g, "I");

/** Applies one transform; throws an Error with a readable message when it can't (bad JSON). */
export function transform(s: string, id: TransformId): string {
  switch (id) {
    case "upper": return s.toLocaleUpperCase();
    case "lower": return s.toLocaleLowerCase();
    case "title": return titleCase(s);
    case "sentence": return sentenceCase(s);
    case "swap": return [...s].map((c) => (c === c.toLocaleUpperCase() ? c.toLocaleLowerCase() : c.toLocaleUpperCase())).join("");
    case "trim-lines": return lines(s).map((l) => l.trim()).join("\n");
    case "remove-empty": return lines(s).filter((l) => l.trim()).join("\n");
    case "dedupe": return dedupeLines(s);
    case "dedupe-any-case": return dedupeLines(s, true);
    case "sort-az": return lines(s).sort(collator.compare).join("\n");
    case "sort-za": return lines(s).sort((a, b) => collator.compare(b, a)).join("\n");
    case "sort-natural": return lines(s).sort(natural.compare).join("\n");
    case "sort-length": return lines(s).sort((a, b) => a.length - b.length || collator.compare(a, b)).join("\n");
    case "reverse-lines": return lines(s).reverse().join("\n");
    case "shuffle": {
      const ls = lines(s);
      for (let i = ls.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [ls[i], ls[j]] = [ls[j], ls[i]];
      }
      return ls.join("\n");
    }
    case "number-lines": {
      const ls = lines(s);
      const w = String(ls.length).length;
      return ls.map((l, i) => `${String(i + 1).padStart(w, " ")}. ${l}`).join("\n");
    }
    case "unnumber-lines": return lines(s).map((l) => l.replace(/^\s*(?:\d+[.)]|[-*•+])\s+/, "")).join("\n");
    case "join-lines": return lines(s).map((l) => l.trim()).filter(Boolean).join(" ");
    case "split-sentences": return s.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/).join("\n");
    case "add-bullets": return lines(s).map((l) => (l.trim() ? `• ${l.replace(/^\s*(?:[-*•+]|\d+[.)])\s+/, "")}` : l)).join("\n");
    case "quote-lines": return lines(s).map((l) => `> ${l}`).join("\n");
    case "strip-invisible": return s.replace(INVISIBLE, "").replace(ODD_SPACES, " ");
    case "straighten": return s.replace(/[‘’‚‛]/g, "'").replace(/[“”„‟]/g, '"').replace(/…/g, "...").replace(/—/g, "--").replace(/–/g, "-");
    case "collapse-spaces": return lines(s).map((l) => l.replace(/(?<=\S)[ \t]{2,}/g, " ").trimEnd()).join("\n");
    case "tabs-to-spaces": return s.replace(/\t/g, "  ");
    case "strip-html": {
      const noScripts = s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "");
      const text = noScripts.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n").replace(/<[^>]+>/g, "");
      return decodeEntities(text).replace(/\n{3,}/g, "\n\n").trim();
    }
    case "strip-markdown":
      return s
        .replace(/^```[^\n]*\n?/gm, "")
        .replace(/^#{1,6}\s+/gm, "")
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
        .replace(/(\*\*|__)(.+?)\1/g, "$2")
        .replace(/(?<![\w*])([*_])(?!\s)(.+?)(?<!\s)\1(?![\w*])/g, "$2")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/^>\s?/gm, "")
        .replace(/^\s*[-*+]\s+/gm, "• ");
    case "json-pretty": return JSON.stringify(parseJson(s), null, 2);
    case "json-minify": return JSON.stringify(parseJson(s));
    case "url-encode": return encodeURIComponent(s);
    case "url-decode":
      try {
        return decodeURIComponent(s.replace(/\+/g, " "));
      } catch {
        throw new Error("That isn't valid URL-encoded text.");
      }
  }
}

function parseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch (e) {
    throw new Error(`Not valid JSON: ${e instanceof Error ? e.message : "parse error"}`);
  }
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const cp = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}
