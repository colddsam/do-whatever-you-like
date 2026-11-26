/**
 * The translator's extras, shared by the Translator and Interpreter tools:
 * language detection, the word panel (dictionary, alternatives, romanisation), natural voices,
 * glossary/placeholder protection, history & phrasebook, and the round-trip quality check.
 */
import { FileToolError } from "./files";
import { translateBatch, translateText, type TranslateLanguage } from "./translate";

export const TRANSLATE_DETECT_ENDPOINT = "/api/tools/translate/detect";
export const TRANSLATE_INSIGHTS_ENDPOINT = "/api/tools/translate/insights";
export const TRANSLATE_SPEAK_ENDPOINT = "/api/tools/translate/speak";

export type TranslateStyle = "default" | "formal" | "casual" | "simple" | "natural";
export const STYLE_LABELS: Record<TranslateStyle, string> = {
  default: "Standard",
  formal: "Formal",
  casual: "Casual",
  simple: "Simple",
  natural: "Idiomatic",
};

async function errorDetail(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { detail?: string };
    if (typeof body?.detail === "string" && body.detail.trim()) return body.detail;
  } catch {
    // not JSON
  }
  return fallback;
}

async function postJson<T>(url: string, body: unknown, fallback: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new FileToolError(await errorDetail(res, fallback), res.status);
  return (await res.json()) as T;
}

// ---------------------------------------------------------------- detection

export type DetectResult = {
  language: string;
  language_name: string;
  confidence: number;
  candidates: { code: string; name: string; confidence: number }[];
};

export function detectLanguage(text: string, signal?: AbortSignal): Promise<DetectResult> {
  return postJson(TRANSLATE_DETECT_ENDPOINT, { text: text.slice(0, 4000) }, "Couldn't detect the language.", signal);
}

// ---------------------------------------------------------------- word panel

export type Insights = {
  text: string;
  translation: string;
  detected_language: string;
  confidence: number;
  source_romanization: string;
  target_romanization: string;
  alternatives: { source: string; options: string[] }[];
  dictionary: { pos: string; base: string; entries: { word: string; reverse: string[]; score: number }[] }[];
  definitions: { pos: string; items: { gloss: string; example: string }[] }[];
  examples: string[];
  synonyms: { pos: string; words: string[] }[];
  did_you_mean: string;
};

export const INSIGHTS_MAX_CHARS = 600;

export function lookupInsights(text: string, source: string, target: string, signal?: AbortSignal): Promise<Insights> {
  return postJson(
    TRANSLATE_INSIGHTS_ENDPOINT,
    { text: text.slice(0, INSIGHTS_MAX_CHARS), source: source || "auto", target },
    "Word details aren't available right now.",
    signal,
  );
}

export function hasInsights(i: Insights | null | undefined): boolean {
  if (!i) return false;
  return Boolean(
    i.source_romanization ||
      i.target_romanization ||
      i.alternatives.length ||
      i.dictionary.length ||
      i.definitions.length ||
      i.examples.length ||
      i.synonyms.length ||
      i.did_you_mean,
  );
}

// ---------------------------------------------------------------- voices

export type VoiceGender = "female" | "male";

const speechCache = new Map<string, Blob>();
let currentAudio: HTMLAudioElement | null = null;
let currentUrl: string | null = null;

/** Neural voice from the server (Edge → Google → espeak). Cached per text/lang/voice/rate. */
export async function fetchSpeech(
  text: string,
  language: string,
  opts: { gender?: VoiceGender; rate?: number; signal?: AbortSignal } = {},
): Promise<Blob> {
  const gender = opts.gender ?? "female";
  const rate = Math.round(opts.rate ?? 0);
  const key = `${language}|${gender}|${rate}|${text}`;
  const hit = speechCache.get(key);
  if (hit) return hit;
  const res = await fetch(TRANSLATE_SPEAK_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: text.slice(0, 2000), language, gender, rate }),
    signal: opts.signal,
  });
  if (!res.ok) throw new FileToolError(await errorDetail(res, "No voice is available for that language."), res.status);
  const blob = await res.blob();
  if (speechCache.size > 40) speechCache.delete(speechCache.keys().next().value!);
  speechCache.set(key, blob);
  return blob;
}

export function stopSpeaking() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = "";
    currentAudio = null;
  }
  if (currentUrl) {
    URL.revokeObjectURL(currentUrl);
    currentUrl = null;
  }
  if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
}

/** Picks the best installed browser voice for a language, or null. */
export function browserVoiceFor(lang: string, gender: VoiceGender = "female"): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  const base = lang.toLowerCase().split("-")[0];
  const matches = voices.filter((v) => v.lang.toLowerCase().replace("_", "-").split("-")[0] === base);
  if (!matches.length) return null;
  const exact = matches.filter((v) => v.lang.toLowerCase().replace("_", "-") === lang.toLowerCase());
  const pool = exact.length ? exact : matches;
  const genderHint = gender === "male" ? /male|david|mark|guy|daniel|james|man\b/i : /female|zira|susan|samantha|aria|jenny|woman/i;
  return pool.find((v) => /natural|neural|online|google/i.test(v.name)) ?? pool.find((v) => genderHint.test(v.name)) ?? pool[0];
}

/**
 * Speaks text: the server's neural voice first (works for ~90 languages on every device), then the
 * browser's own voice. Resolves when playback ends (or fails), so callers can queue lines.
 */
export async function speak(
  text: string,
  language: string,
  opts: { gender?: VoiceGender; rate?: number; signal?: AbortSignal; preferBrowser?: boolean } = {},
): Promise<"neural" | "browser" | "none"> {
  stopSpeaking();
  const clean = text.trim();
  if (!clean) return "none";
  const tryBrowser = () =>
    new Promise<"browser" | "none">((resolve) => {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) return resolve("none");
      const utt = new SpeechSynthesisUtterance(clean.slice(0, 4000));
      utt.lang = language;
      const v = browserVoiceFor(language, opts.gender);
      if (v) utt.voice = v;
      utt.rate = Math.max(0.5, Math.min(2, 1 + (opts.rate ?? 0) / 100));
      utt.onend = () => resolve("browser");
      utt.onerror = () => resolve("none");
      opts.signal?.addEventListener("abort", () => {
        window.speechSynthesis.cancel();
        resolve("none");
      });
      window.speechSynthesis.speak(utt);
    });
  if (opts.preferBrowser && browserVoiceFor(language, opts.gender)) return tryBrowser();
  try {
    const blob = await fetchSpeech(clean, language, opts);
    if (opts.signal?.aborted) return "none";
    const url = URL.createObjectURL(blob);
    currentUrl = url;
    const audio = new Audio(url);
    currentAudio = audio;
    return await new Promise((resolve) => {
      const done = (r: "neural" | "none") => {
        if (currentAudio === audio) stopSpeaking();
        resolve(r);
      };
      audio.onended = () => done("neural");
      audio.onerror = () => done("none");
      opts.signal?.addEventListener("abort", () => done("none"));
      audio.play().catch(() => {
        // Autoplay blocked or decode failure: fall back to the browser voice.
        if (currentAudio === audio) stopSpeaking();
        tryBrowser().then(resolve);
      });
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return "none";
    return tryBrowser();
  }
}

// ---------------------------------------------------------------- glossary & placeholders

export type GlossaryRule = {
  id: string;
  /** Text to look for in the source (case-insensitive, whole words when it's a word). */
  term: string;
  /** What to put in the translation; empty means "keep the term as it is". */
  replacement: string;
  /** Limit to one target language, or "*" for all. */
  target: string;
};

const TOKEN_OPEN = "⟦";
const TOKEN_CLOSE = "⟧";

/** Things no translation engine should touch: URLs, emails, {placeholders}, %s, `code`, @mentions, #tags. */
export const DEFAULT_PROTECT_PATTERNS: RegExp[] = [
  /https?:\/\/[^\s<>"')\]]+/g,
  /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g,
  /\{\{[^{}\n]{1,60}\}\}|\{[A-Za-z_][\w.]{0,40}\}|%(?:\d+\$)?[sdif@]|\$\{[^}\n]{1,40}\}/g,
  /`[^`\n]{1,80}`/g,
];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export type Protected = { text: string; restore: (translated: string) => string; count: number };

/**
 * Swaps glossary terms and protected patterns for ⟦n⟧ tokens before translation, and puts the
 * replacements (or the original text) back afterwards. The tokens survive every engine we use.
 */
export function protectText(
  text: string,
  opts: { glossary?: GlossaryRule[]; target?: string; patterns?: RegExp[] } = {},
): Protected {
  const values: string[] = [];
  let out = text;
  const tokenFor = (value: string) => {
    values.push(value);
    return `${TOKEN_OPEN}${values.length - 1}${TOKEN_CLOSE}`;
  };
  // Never let the user's own text contain a token we'd later "restore".
  out = out.replace(/[⟦⟧]/g, "");
  for (const re of opts.patterns ?? DEFAULT_PROTECT_PATTERNS) {
    out = out.replace(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"), (m) => tokenFor(m));
  }
  const rules = (opts.glossary ?? [])
    .filter((r) => r.term.trim() && (r.target === "*" || !opts.target || r.target.toLowerCase() === opts.target.toLowerCase()))
    .sort((a, b) => b.term.length - a.term.length);
  for (const rule of rules) {
    const term = rule.term.trim();
    const wordy = /^[\p{L}\p{N}]/u.test(term) && /[\p{L}\p{N}]$/u.test(term) && /^[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}\d\s'’-]+$/u.test(term);
    const re = new RegExp(wordy ? `(?<![\\p{L}\\p{N}])${escapeRegex(term)}(?![\\p{L}\\p{N}])` : escapeRegex(term), "giu");
    out = out.replace(re, (m) => tokenFor(rule.replacement.trim() || m));
  }
  // Patterns can nest (a URL inside a Markdown link), so a token's value may hold another token:
  // unwind until nothing changes.
  const restore = (translated: string) => {
    let out = translated;
    for (let pass = 0; pass <= values.length && /⟦\s*\d+\s*⟧/.test(out); pass++) {
      const next = out.replace(/⟦\s*(\d+)\s*⟧/g, (m, n) => values[Number(n)] ?? m);
      if (next === out) break;
      out = next;
    }
    return out;
  };
  return { text: out, restore, count: values.length };
}

const GLOSSARY_KEY = "dwyl.translator.glossary.v1";

export function loadGlossary(): GlossaryRule[] {
  try {
    const raw = localStorage.getItem(GLOSSARY_KEY);
    const parsed = raw ? (JSON.parse(raw) as GlossaryRule[]) : [];
    return Array.isArray(parsed) ? parsed.filter((r) => r && typeof r.term === "string") : [];
  } catch {
    return [];
  }
}

export function saveGlossary(rules: GlossaryRule[]) {
  try {
    localStorage.setItem(GLOSSARY_KEY, JSON.stringify(rules.slice(0, 300)));
  } catch {
    // storage full or blocked
  }
}

/** Parses "term => replacement" / CSV lines into rules (import). */
export function parseGlossaryText(raw: string, target = "*"): GlossaryRule[] {
  const rules: GlossaryRule[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const parts = t.includes("=>") ? t.split("=>") : t.includes("\t") ? t.split("\t") : t.split(",");
    const term = (parts[0] ?? "").trim().replace(/^"|"$/g, "");
    const replacement = (parts.slice(1).join(",") ?? "").trim().replace(/^"|"$/g, "");
    if (term) rules.push({ id: `${Date.now()}-${rules.length}`, term, replacement, target });
  }
  return rules;
}

// ---------------------------------------------------------------- translate with everything

export type SmartTranslateOptions = {
  text: string;
  source: string;
  target: string;
  mode?: "text" | "subtitles";
  style?: TranslateStyle;
  glossary?: GlossaryRule[];
  protectPatterns?: boolean;
  signal?: AbortSignal;
};

export async function smartTranslate(opts: SmartTranslateOptions) {
  const prot = protectText(opts.text, {
    glossary: opts.glossary,
    target: opts.target,
    patterns: opts.protectPatterns === false ? [] : DEFAULT_PROTECT_PATTERNS,
  });
  const res = await fetch("/api/tools/translate/text", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: prot.text,
      source: opts.source || "auto",
      target: opts.target,
      mode: opts.mode ?? "text",
      style: opts.style ?? "default",
    }),
    signal: opts.signal,
  });
  if (!res.ok) throw new FileToolError(await errorDetail(res, "Translation failed. Try again in a moment."), res.status);
  const data = (await res.json()) as Awaited<ReturnType<typeof translateText>> & { style?: string };
  return {
    ...data,
    source_text: opts.text,
    translated_text: prot.restore(data.translated_text),
    protected_count: prot.count,
  };
}

/** Batch version (documents, sentence view), with protection per line. */
export async function smartTranslateBatch(
  texts: string[],
  source: string,
  target: string,
  opts: { glossary?: GlossaryRule[]; signal?: AbortSignal; protectPatterns?: RegExp[] } = {},
) {
  const prots = texts.map((t) => protectText(t, { glossary: opts.glossary, target, patterns: opts.protectPatterns }));
  const res = await translateBatch({ texts: prots.map((p) => p.text), source, target, signal: opts.signal });
  return { ...res, translated_texts: res.translated_texts.map((t, i) => prots[i].restore(t)) };
}

// ---------------------------------------------------------------- quality check

function charNgrams(s: string, n = 3): Map<string, number> {
  const clean = ` ${s.toLowerCase().replace(/[\p{P}\p{S}]+/gu, " ").replace(/\s+/g, " ").trim()} `;
  const m = new Map<string, number>();
  for (let i = 0; i + n <= clean.length; i++) {
    const g = clean.slice(i, i + n);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/** chrF-style similarity (0–100) between the source and its round-trip back-translation. */
export function roundTripScore(original: string, back: string): number {
  if (!original.trim() || !back.trim()) return 0;
  let total = 0;
  for (const n of [2, 3, 4]) {
    const a = charNgrams(original, n);
    const b = charNgrams(back, n);
    let overlap = 0;
    let sa = 0;
    let sb = 0;
    a.forEach((v, k) => {
      sa += v;
      overlap += Math.min(v, b.get(k) ?? 0);
    });
    b.forEach((v) => (sb += v));
    const p = sb ? overlap / sb : 0;
    const r = sa ? overlap / sa : 0;
    total += p + r ? (2 * p * r) / (p + r) : 0;
  }
  return Math.round((total / 3) * 100);
}

export function scoreLabel(score: number): { label: string; tone: "success" | "warning" | "danger" } {
  if (score >= 70) return { label: "Meaning kept well", tone: "success" };
  if (score >= 45) return { label: "Mostly kept — skim it", tone: "warning" };
  return { label: "Check this one", tone: "danger" };
}

// ---------------------------------------------------------------- sentences

/** Splits text into sentences, keeping the separators so it can be stitched back. */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  const re = /[^.!?。！？।\n]+(?:[.!?。！？।]+["'”’)\]]*|\n+|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (!m[0]) {
      re.lastIndex++;
      continue;
    }
    out.push(m[0]);
  }
  return out.length ? out : [text];
}

// ---------------------------------------------------------------- history & phrasebook

export type HistoryItem = {
  id: string;
  at: number;
  source: string;
  target: string;
  detected?: string;
  input: string;
  output: string;
  starred?: boolean;
};

const HISTORY_KEY = "dwyl.translator.history.v1";
const HISTORY_MAX = 150;

export function loadHistory(): HistoryItem[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const parsed = raw ? (JSON.parse(raw) as HistoryItem[]) : [];
    return Array.isArray(parsed) ? parsed.filter((h) => h && typeof h.input === "string") : [];
  } catch {
    return [];
  }
}

export function saveHistory(items: HistoryItem[]) {
  try {
    // Starred items are never pushed out by new ones.
    const starred = items.filter((i) => i.starred);
    const rest = items.filter((i) => !i.starred).slice(0, Math.max(0, HISTORY_MAX - starred.length));
    const merged = [...items].filter((i) => i.starred || rest.includes(i));
    localStorage.setItem(HISTORY_KEY, JSON.stringify(merged.map((i) => ({ ...i, input: i.input.slice(0, 5000), output: i.output.slice(0, 5000) }))));
  } catch {
    // storage full or blocked
  }
}

export function pushHistory(items: HistoryItem[], entry: Omit<HistoryItem, "id" | "at">): HistoryItem[] {
  const dupe = items.find((i) => i.input === entry.input && i.target === entry.target);
  const next: HistoryItem = { ...entry, id: dupe?.id ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, at: Date.now(), starred: dupe?.starred };
  return [next, ...items.filter((i) => i !== dupe)];
}

// ---------------------------------------------------------------- recents

const RECENT_KEY = "dwyl.translator.recentLangs.v1";

export function loadRecentLanguages(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const parsed = raw ? (JSON.parse(raw) as string[]) : [];
    return Array.isArray(parsed) ? parsed.filter((c) => typeof c === "string").slice(0, 8) : [];
  } catch {
    return [];
  }
}

export function rememberLanguage(code: string): string[] {
  if (!code || code === "auto") return loadRecentLanguages();
  const next = [code, ...loadRecentLanguages().filter((c) => c !== code)].slice(0, 8);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  return next;
}

/** Match by English name, native name or code; accents and case ignored. */
export function filterLanguages(list: TranslateLanguage[], query: string): TranslateLanguage[] {
  const fold = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const q = fold(query.trim());
  if (!q) return list;
  return list
    .map((l) => {
      const name = fold(l.name);
      const native = fold(l.native_name);
      const code = l.code.toLowerCase();
      const score = code === q ? 0 : name.startsWith(q) ? 1 : native.startsWith(q) ? 2 : name.includes(q) || native.includes(q) ? 3 : code.startsWith(q) ? 4 : 9;
      return { l, score };
    })
    .filter((x) => x.score < 9)
    .sort((a, b) => a.score - b.score || a.l.name.localeCompare(b.l.name))
    .map((x) => x.l);
}

// ---------------------------------------------------------------- speech recognition (browser)

/** BCP-47 tag the browser's recogniser expects for one of our language codes. */
export function recognitionLocale(code: string): string {
  const map: Record<string, string> = {
    en: "en-US", hi: "hi-IN", bn: "bn-IN", es: "es-ES", fr: "fr-FR", ar: "ar-SA", de: "de-DE", pt: "pt-BR",
    ru: "ru-RU", ja: "ja-JP", ko: "ko-KR", zh: "zh-CN", "zh-cn": "zh-CN", "zh-tw": "zh-TW", yue: "yue-Hant-HK",
    it: "it-IT", ta: "ta-IN", te: "te-IN", mr: "mr-IN", ur: "ur-PK", tr: "tr-TR", vi: "vi-VN", id: "id-ID",
    gu: "gu-IN", kn: "kn-IN", ml: "ml-IN", pa: "pa-IN", ne: "ne-NP", nl: "nl-NL", pl: "pl-PL", uk: "uk-UA",
    th: "th-TH", fa: "fa-IR", he: "he-IL", sv: "sv-SE", no: "nb-NO", da: "da-DK", fi: "fi-FI", el: "el-GR",
    cs: "cs-CZ", ro: "ro-RO", hu: "hu-HU", ms: "ms-MY", tl: "fil-PH", sw: "sw-KE", af: "af-ZA", zu: "zu-ZA",
    ca: "ca-ES", hr: "hr-HR", sr: "sr-RS", sk: "sk-SK", sl: "sl-SI", bg: "bg-BG", lt: "lt-LT", lv: "lv-LV",
    et: "et-EE", is: "is-IS", ka: "ka-GE", hy: "hy-AM", az: "az-AZ", kk: "kk-KZ", uz: "uz-UZ", km: "km-KH",
    lo: "lo-LA", my: "my-MM", si: "si-LK", am: "am-ET", so: "so-SO", jv: "jv-ID", su: "su-ID", mn: "mn-MN",
    sq: "sq-AL", mk: "mk-MK", bs: "bs-BA", eu: "eu-ES", gl: "gl-ES", cy: "cy-GB", ga: "ga-IE", mt: "mt-MT",
  };
  return map[code.toLowerCase()] ?? code;
}
