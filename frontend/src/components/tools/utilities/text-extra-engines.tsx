"use client";

import { useMemo, useState } from "react";
import { ArrowLeftRight, Sparkles } from "lucide-react";
import { CASES, words as splitWords } from "@/lib/dev";
import { cn } from "@/lib/utils";
import { Chips, Notice, Panel, Row, Slider, Toggle } from "../pdf/kit";
import { CopyButton, Editor, Output, TextFilePick } from "../dev/parts";
import type { EngineProps } from "./text-engines";

/* ========================================================================
 * 1. WORD, CHARACTER & READING TIME COUNTER
 * ======================================================================== */

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "from", "had", "has", "have",
  "he", "her", "hers", "him", "his", "how", "i", "if", "in", "into", "is", "it", "its", "just",
  "me", "my", "no", "not", "of", "on", "or", "our", "out", "she", "so", "than", "that", "the",
  "their", "them", "then", "there", "these", "they", "this", "to", "too", "up", "us", "was", "we",
  "were", "what", "when", "where", "which", "who", "will", "with", "would", "you", "your",
]);

function countSyllables(word: string): number {
  const clean = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!clean) return 0;
  if (clean.length <= 3) return 1;
  const trimmed = clean.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
  const m = trimmed.match(/[aeiouy]{1,2}/g);
  return Math.max(1, m ? m.length : 1);
}

function segmentWords(text: string): string[] {
  if (!text.trim()) return [];
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const seg = new Intl.Segmenter("en", { granularity: "word" });
    const out: string[] = [];
    for (const part of seg.segment(text)) {
      if (part.isWordLike) out.push(part.segment);
    }
    return out;
  }
  return text.match(/[\p{L}\p{N}'-]+/gu) ?? [];
}

function formatDurationMinutes(wordsCount: number, wpm: number): string {
  if (wordsCount === 0) return "0 sec";
  const secTotal = Math.max(1, Math.round((wordsCount / Math.max(40, wpm)) * 60));
  const min = Math.floor(secTotal / 60);
  const sec = secTotal % 60;
  if (min === 0) return `${sec} sec`;
  return sec === 0 ? `${min} min` : `${min} min ${sec} sec`;
}

export function analyzeTextStats(text: string, readingWpm = 225, speakingWpm = 130) {
  const words = segmentWords(text);
  const charsWithSpaces = [...text].length;
  const charsNoSpaces = [...text.replace(/\s+/g, "")].length;
  const trimmed = text.trim();
  const sentences = trimmed
    ? trimmed
        .split(/(?<=[.!?])\s+|\n{2,}/)
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  const paragraphs = trimmed ? trimmed.split(/\r?\n\s*\r?\n/).filter((p) => p.trim()) : [];
  const lines = text ? text.split(/\r?\n/).length : 0;

  const avgWordLen = words.length ? (words.reduce((a, w) => a + w.length, 0) / words.length).toFixed(1) : "0.0";
  const avgSentenceLen = words.length && sentences.length ? (words.length / sentences.length).toFixed(1) : "0.0";

  let fleschScore: number | null = null;
  let fleschLabel = "Add prose to score";
  if (words.length >= 10 && sentences.length > 0) {
    const syllables = words.reduce((a, w) => a + countSyllables(w), 0);
    fleschScore = Math.max(
      0,
      Math.min(100, Math.round(206.835 - 1.015 * (words.length / sentences.length) - 84.6 * (syllables / words.length))),
    );
    fleschLabel =
      fleschScore >= 80
        ? "Very easy (conversational)"
        : fleschScore >= 60
          ? "Plain English (ideal)"
          : fleschScore >= 40
            ? "Fairly difficult (technical)"
            : "Dense / academic";
  }

  return {
    words,
    wordCount: words.length,
    charsWithSpaces,
    charsNoSpaces,
    sentenceCount: sentences.length,
    paragraphCount: paragraphs.length,
    lineCount: lines,
    readingTime: formatDurationMinutes(words.length, readingWpm),
    speakingTime: formatDurationMinutes(words.length, speakingWpm),
    avgWordLen,
    avgSentenceLen,
    fleschScore,
    fleschLabel,
  };
}

const SAMPLE_PROSE = `Great developer tools do not interrupt your focus. They open in milliseconds, stay completely private inside your browser, and respect your data.

Whether you are counting characters for a product headline or cleaning invisible spaces pasted out of a PDF, immediate visual feedback turns slow chores into quick checks.`;

export function WordCountEngine({}: EngineProps) {
  const [text, setText] = useState(SAMPLE_PROSE);
  const [wpm, setWpm] = useState(225);
  const [includeStop, setIncludeStop] = useState(false);

  const info = useMemo(() => analyzeTextStats(text, wpm, 130), [text, wpm]);

  const keywords = useMemo(() => {
    const counts = new Map<string, number>();
    const lowerWords = info.words.map((w) => w.toLowerCase());
    for (const w of lowerWords) {
      if (w.length < 2) continue;
      if (!includeStop && STOP_WORDS.has(w)) continue;
      counts.set(w, (counts.get(w) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 10)
      .map(([word, count]) => ({
        word,
        count,
        pct: info.wordCount ? ((count / info.wordCount) * 100).toFixed(1) : "0",
      }));
  }, [info.words, info.wordCount, includeStop]);

  const limits = [
    { name: "Meta description", max: 160 },
    { name: "X / Twitter post", max: 280 },
    { name: "YouTube title", max: 100 },
    { name: "LinkedIn post", max: 3000 },
  ];

  return (
    <>
      <Editor
        value={text}
        onChange={setText}
        name="document.txt"
        rows={9}
        placeholder="Type or paste your text to count words, characters, sentences and reading time…"
        actions={<TextFilePick accept=".txt,.md,.csv,.html" onText={setText} />}
      />

      {/* Primary KPI Grid */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        {[
          { label: "Words", val: info.wordCount.toLocaleString() },
          { label: "Characters", val: info.charsWithSpaces.toLocaleString() },
          { label: "No spaces", val: info.charsNoSpaces.toLocaleString() },
          { label: "Sentences", val: info.sentenceCount.toLocaleString() },
          { label: "Paragraphs", val: info.paragraphCount.toLocaleString() },
          { label: "Read time", val: info.readingTime },
        ].map((kpi) => (
          <div key={kpi.label} className="rounded-md border border-line bg-surface px-3 py-2.5">
            <p className="label-mono text-ink-3">{kpi.label}</p>
            <p className="mt-1 font-mono text-xl font-semibold text-ink tabular-nums">{kpi.val}</p>
          </div>
        ))}
      </div>

      <Panel>
        <Row label="Reading pace">
          <div className="grid gap-3 @xl:grid-cols-[minmax(0,1fr)_auto] @xl:items-center">
            <Slider value={wpm} min={120} max={360} step={5} onChange={setWpm} label="Reading speed" format={(v) => `${v} wpm`} />
            <div className="flex flex-wrap gap-4 font-mono text-[13px] text-ink-2">
              <span>Speak: <strong className="text-ink">{info.speakingTime}</strong></span>
              <span>Avg word: <strong className="text-ink">{info.avgWordLen}</strong> ch</span>
              <span>Avg sentence: <strong className="text-ink">{info.avgSentenceLen}</strong> w</span>
            </div>
          </div>
        </Row>
        <Row label="Readability">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-mono text-base font-semibold text-ink">
              {info.fleschScore !== null ? `${info.fleschScore} / 100` : "—"}
            </span>
            <span className="text-sm text-ink-2">{info.fleschLabel} (Flesch Reading Ease)</span>
          </div>
        </Row>
      </Panel>

      {/* Character Limits */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-md border border-line bg-surface p-4">
          <p className="label-mono mb-3 text-ink-3">Platform length checks</p>
          <div className="space-y-3">
            {limits.map((lim) => {
              const pct = Math.min(100, Math.round((info.charsWithSpaces / lim.max) * 100));
              const over = info.charsWithSpaces > lim.max;
              return (
                <div key={lim.name} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-ink">{lim.name}</span>
                    <span className={cn("font-mono", over ? "font-semibold text-danger" : "text-ink-3")}>
                      {info.charsWithSpaces} / {lim.max}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-paper-2">
                    <div
                      className={cn("h-full transition-all", over ? "bg-danger" : pct > 85 ? "bg-warning" : "bg-accent")}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Keyword density */}
        <div className="rounded-md border border-line bg-surface p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="label-mono text-ink-3">Top keywords</p>
            <Toggle checked={includeStop} onChange={setIncludeStop} label="Include stop words" />
          </div>
          {keywords.length === 0 ? (
            <p className="text-sm text-ink-3">Add text to see word frequency and keyword density.</p>
          ) : (
            <div className="space-y-1.5">
              {keywords.map((kw) => (
                <div key={kw.word} className="flex items-center justify-between border-b border-line/50 py-1 text-sm last:border-b-0">
                  <span className="font-mono text-[13px] text-ink">{kw.word}</span>
                  <span className="font-mono text-[12px] text-ink-2">
                    {kw.count}× ({kw.pct}%)
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/* ========================================================================
 * 2. CASE CONVERTER
 * ======================================================================== */

const EXTRA_CASES: { id: string; label: string; fn: (s: string) => string }[] = [
  ...CASES,
  {
    id: "train",
    label: "Train-Case",
    fn: (s) => splitWords(s).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("-"),
  },
  {
    id: "path",
    label: "path/case",
    fn: (s) => splitWords(s).join("/"),
  },
  {
    id: "alternating",
    label: "aLtErNaTiNg",
    fn: (s) =>
      [...s]
        .map((c, i) => (i % 2 ? c.toUpperCase() : c.toLowerCase()))
        .join(""),
  },
  {
    id: "inverse",
    label: "iNVERSE cASE",
    fn: (s) =>
      [...s]
        .map((c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()))
        .join(""),
  },
];

export function CaseConvertEngine({ preset }: EngineProps) {
  const [input, setInput] = useState("invoice_total_amount_inr\ngetUserBillingProfile");
  const [perLine, setPerLine] = useState(true);
  const [picked, setPicked] = useState(preset.case ?? "camel");

  const convert = (fn: (s: string) => string, text: string) =>
    perLine ? text.split(/\r?\n/).map(fn).join("\n") : fn(text);

  const selectedCase = EXTRA_CASES.find((c) => c.id === picked) ?? EXTRA_CASES[0];
  const primaryOut = useMemo(
    () => (perLine ? input.split(/\r?\n/).map(selectedCase.fn).join("\n") : selectedCase.fn(input)),
    [selectedCase, input, perLine],
  );

  return (
    <>
      <Editor
        value={input}
        onChange={setInput}
        name="identifiers.txt"
        rows={5}
        placeholder="Paste identifiers, headings or lines to convert…"
        actions={<TextFilePick accept=".txt,.csv" onText={setInput} />}
      />
      <Panel>
        <Row label="Active case">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Chips value={picked} onChange={setPicked} options={EXTRA_CASES.map((c) => ({ value: c.id, label: c.label }))} />
          </div>
          <div className="mt-3">
            <Toggle checked={perLine} onChange={setPerLine} label="Convert each line separately" />
          </div>
        </Row>
      </Panel>
      <Output value={primaryOut} name={`${picked}.txt`} lang={selectedCase.label} download={`${picked}.txt`} />

      <div className="overflow-hidden rounded-md border border-line bg-surface">
        <div className="border-b border-line bg-paper px-3.5 py-2">
          <span className="label-mono text-ink-3">All 14 case previews</span>
        </div>
        <div className="divide-y divide-line/60">
          {EXTRA_CASES.map((c) => {
            const val = convert(c.fn, input.split(/\r?\n/)[0] ?? input);
            return (
              <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5">
                <span className="w-36 shrink-0 font-mono text-[12px] text-ink-3">{c.label}</span>
                <code className="min-w-0 flex-1 truncate font-mono text-[13px] text-ink">{val || "—"}</code>
                <CopyButton text={convert(c.fn, input)} label="Copy" />
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

/* ========================================================================
 * 3. LIST COMPARATOR (SET OPERATIONS)
 * ======================================================================== */

type SetOp = "intersection" | "only-a" | "only-b" | "union" | "sym-diff";

export function compareLists(
  rawA: string,
  rawB: string,
  opts: { trim: boolean; ignoreCase: boolean; ignoreEmpty: boolean; sort: boolean },
) {
  const prep = (raw: string) => {
    const items = raw.split(/\r?\n/).map((line) => (opts.trim ? line.trim() : line));
    return opts.ignoreEmpty ? items.filter((l) => l.length > 0) : items;
  };
  const keyOf = (s: string) => (opts.ignoreCase ? s.toLowerCase() : s);

  const listA = prep(rawA);
  const listB = prep(rawB);

  const countMapA = new Map<string, { label: string; count: number }>();
  for (const item of listA) {
    const k = keyOf(item);
    const cur = countMapA.get(k);
    if (cur) cur.count++;
    else countMapA.set(k, { label: item, count: 1 });
  }
  const countMapB = new Map<string, { label: string; count: number }>();
  for (const item of listB) {
    const k = keyOf(item);
    const cur = countMapB.get(k);
    if (cur) cur.count++;
    else countMapB.set(k, { label: item, count: 1 });
  }

  const keysA = new Set(countMapA.keys());
  const keysB = new Set(countMapB.keys());

  const finalize = (arr: string[]) => (opts.sort ? [...arr].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })) : arr);

  const intersection = finalize([...keysA].filter((k) => keysB.has(k)).map((k) => countMapA.get(k)!.label));
  const onlyA = finalize([...keysA].filter((k) => !keysB.has(k)).map((k) => countMapA.get(k)!.label));
  const onlyB = finalize([...keysB].filter((k) => !keysA.has(k)).map((k) => countMapB.get(k)!.label));
  const unionMap = new Map<string, string>();
  for (const [k, v] of countMapA) unionMap.set(k, v.label);
  for (const [k, v] of countMapB) if (!unionMap.has(k)) unionMap.set(k, v.label);
  const union = finalize([...unionMap.values()]);
  const symDiff = finalize([
    ...[...keysA].filter((k) => !keysB.has(k)).map((k) => countMapA.get(k)!.label),
    ...[...keysB].filter((k) => !keysA.has(k)).map((k) => countMapB.get(k)!.label),
  ]);

  const dupsA = [...countMapA.values()].filter((v) => v.count > 1).map((v) => `${v.label} (×${v.count})`);
  const dupsB = [...countMapB.values()].filter((v) => v.count > 1).map((v) => `${v.label} (×${v.count})`);

  return { intersection, onlyA, onlyB, union, symDiff, dupsA, dupsB, uniqueA: keysA.size, uniqueB: keysB.size };
}

export function ListCompareEngine({ preset }: EngineProps) {
  const [listA, setListA] = useState("react\nnext.js\ntypescript\ntailwindcss\nvitest\nreact");
  const [listB, setListB] = useState("typescript\ntailwindcss\nplaywright\nzod");
  const [trim, setTrim] = useState(true);
  const [ignoreCase, setIgnoreCase] = useState(true);
  const [ignoreEmpty, setIgnoreEmpty] = useState(true);
  const [sort, setSort] = useState(true);
  const [op, setOp] = useState<SetOp>(() =>
    preset.op === "only-a" || preset.op === "only-b" || preset.op === "union" || preset.op === "sym-diff"
      ? preset.op
      : "intersection",
  );

  const res = useMemo(() => compareLists(listA, listB, { trim, ignoreCase, ignoreEmpty, sort }), [listA, listB, trim, ignoreCase, ignoreEmpty, sort]);

  const activeItems =
    op === "intersection"
      ? res.intersection
      : op === "only-a"
        ? res.onlyA
        : op === "only-b"
          ? res.onlyB
          : op === "sym-diff"
            ? res.symDiff
            : res.union;

  return (
    <>
      <div className="grid gap-3 md:grid-cols-2">
        <Editor
          value={listA}
          onChange={setListA}
          name={`List A (${res.uniqueA} unique)`}
          rows={8}
          placeholder="One item per line"
          actions={<TextFilePick accept=".txt,.csv" onText={setListA} />}
        />
        <Editor
          value={listB}
          onChange={setListB}
          name={`List B (${res.uniqueB} unique)`}
          rows={8}
          placeholder="One item per line"
          actions={<TextFilePick accept=".txt,.csv" onText={setListB} />}
        />
      </div>

      <Panel>
        <Row label="Operation">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Chips
              value={op}
              onChange={setOp}
              options={[
                { value: "intersection", label: `A ∩ B Both (${res.intersection.length})` },
                { value: "only-a", label: `A − B Only A (${res.onlyA.length})` },
                { value: "only-b", label: `B − A Only B (${res.onlyB.length})` },
                { value: "union", label: `A ∪ B Combined (${res.union.length})` },
                { value: "sym-diff", label: `A Δ B Either only (${res.symDiff.length})` },
              ]}
            />
            <button
              type="button"
              onClick={() => (setListA(listB), setListB(listA))}
              className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-line bg-surface px-2.5 text-[12px] text-ink-2 hover:text-ink"
            >
              <ArrowLeftRight aria-hidden className="size-3.5" /> Swap A / B
            </button>
          </div>
        </Row>
        <Row label="Matching">
          <div className="flex flex-wrap gap-4">
            <Toggle checked={trim} onChange={setTrim} label="Trim spaces" />
            <Toggle checked={ignoreCase} onChange={setIgnoreCase} label="Ignore case" />
            <Toggle checked={ignoreEmpty} onChange={setIgnoreEmpty} label="Ignore blank lines" />
            <Toggle checked={sort} onChange={setSort} label="Sort A–Z" />
          </div>
        </Row>
      </Panel>

      <Output
        value={activeItems.join("\n")}
        name={`${op}.txt`}
        lang={`${activeItems.length} items`}
        download={`${op}.txt`}
      />

      {(res.dupsA.length > 0 || res.dupsB.length > 0) && (
        <Notice tone="info">
          Duplicates ignored in set math —{" "}
          {res.dupsA.length > 0 && <span>List A: {res.dupsA.join(", ")}. </span>}
          {res.dupsB.length > 0 && <span>List B: {res.dupsB.join(", ")}.</span>}
        </Notice>
      )}
    </>
  );
}

/* ========================================================================
 * 4. INVISIBLE CHARACTER & SMART QUOTE CLEANER
 * ======================================================================== */

const INVISIBLE_NAMES: Record<number, { tag: string; label: string }> = {
  0x00a0: { tag: "NBSP", label: "Non-breaking space" },
  0x00ad: { tag: "SHY", label: "Soft hyphen" },
  0x200b: { tag: "ZWSP", label: "Zero-width space" },
  0x200c: { tag: "ZWNJ", label: "Zero-width non-joiner" },
  0x200d: { tag: "ZWJ", label: "Zero-width joiner" },
  0x200e: { tag: "LRM", label: "Left-to-right mark" },
  0x200f: { tag: "RLM", label: "Right-to-left mark" },
  0x2028: { tag: "LS", label: "Line separator" },
  0x2029: { tag: "PS", label: "Paragraph separator" },
  0x202a: { tag: "LRE", label: "Bidi embedding" },
  0x202b: { tag: "RLE", label: "Bidi embedding" },
  0x202c: { tag: "PDF", label: "Bidi pop" },
  0x202d: { tag: "LRO", label: "Bidi override" },
  0x202e: { tag: "RLO", label: "Bidi override" },
  0x2060: { tag: "WJ", label: "Word joiner" },
  0xfeff: { tag: "BOM", label: "Byte-order mark / ZWNBSP" },
  0x3000: { tag: "IDSP", label: "Ideographic space" },
};

const SMART_PUNCT = new Set(["\u2018", "\u2019", "\u201c", "\u201d", "\u2013", "\u2014", "\u2026"]);

export function inspectAndCleanText(
  input: string,
  opts: { stripInvisible: boolean; replaceNbsp: boolean; straightenQuotes: boolean; normalizeDashes: boolean; collapseSpaces: boolean },
) {
  const counts = new Map<string, { label: string; code: string; count: number }>();
  for (const ch of input) {
    const cp = ch.codePointAt(0)!;
    const inv = INVISIBLE_NAMES[cp];
    if (inv || SMART_PUNCT.has(ch) || (cp < 32 && cp !== 9 && cp !== 10 && cp !== 13)) {
      const code = `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
      const label = inv ? `${inv.label} (${inv.tag})` : ch === "\u2014" ? "Em dash (—)" : ch === "\u2013" ? "En dash (–)" : SMART_PUNCT.has(ch) ? `Smart punct (${ch})` : "Control char";
      const cur = counts.get(code);
      if (cur) cur.count++;
      else counts.set(code, { label, code, count: 1 });
    }
  }

  let out = input;
  if (opts.stripInvisible) {
    out = out.replace(/[\u00ad\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g, "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
  }
  if (opts.replaceNbsp) {
    out = out.replace(/[\u00a0\u2007\u202f\u3000]/g, " ").replace(/[\u2028\u2029]/g, "\n");
  }
  if (opts.straightenQuotes) {
    out = out.replace(/[\u2018\u2019\u201a\u201b]/g, "'").replace(/[\u201c\u201d\u201e\u201f]/g, '"').replace(/\u2026/g, "...");
  }
  if (opts.normalizeDashes) {
    out = out.replace(/\u2014/g, "--").replace(/\u2013/g, "-");
  }
  if (opts.collapseSpaces) {
    out = out
      .split(/\r?\n/)
      .map((line) => line.replace(/[ \t]{2,}/g, " ").trimEnd())
      .join("\n");
  }

  return { cleaned: out, findings: [...counts.values()] };
}

const SAMPLE_DIRTY = `\uFEFF\u201CHello\u200B world\u201D\u00A0\u2014 this\u200D text came from a PDF\u2026\u200B  and has\u00A0hidden\u00AD characters.`;

export function TextCleanerEngine({}: EngineProps) {
  const [input, setInput] = useState(SAMPLE_DIRTY);
  const [stripInvisible, setStripInvisible] = useState(true);
  const [replaceNbsp, setReplaceNbsp] = useState(true);
  const [straightenQuotes, setStraightenQuotes] = useState(true);
  const [normalizeDashes, setNormalizeDashes] = useState(true);
  const [collapseSpaces, setCollapseSpaces] = useState(true);

  const res = useMemo(
    () => inspectAndCleanText(input, { stripInvisible, replaceNbsp, straightenQuotes, normalizeDashes, collapseSpaces }),
    [input, stripInvisible, replaceNbsp, straightenQuotes, normalizeDashes, collapseSpaces],
  );

  const tokens = useMemo(() => {
    return [...input].map((ch, idx) => {
      const cp = ch.codePointAt(0)!;
      const inv = INVISIBLE_NAMES[cp];
      if (inv) return { key: idx, kind: "inv" as const, text: `[${inv.tag} U+${cp.toString(16).toUpperCase().padStart(4, "0")}]` };
      if (SMART_PUNCT.has(ch)) return { key: idx, kind: "smart" as const, text: ch };
      return { key: idx, kind: "ok" as const, text: ch };
    });
  }, [input]);

  return (
    <>
      <Editor
        value={input}
        onChange={setInput}
        name="pasted.txt"
        rows={5}
        placeholder="Paste suspicious text copied from PDFs, Word or AI chats…"
        actions={
          <button
            type="button"
            onClick={() => setInput(SAMPLE_DIRTY)}
            className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-line bg-surface px-2.5 text-[12px] text-ink-2 hover:text-ink"
          >
            <Sparkles aria-hidden className="size-3.5" /> Sample dirty text
          </button>
        }
      />

      {/* Annotated xray inspector */}
      <div className="overflow-hidden rounded-md border border-line bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-paper px-3.5 py-2">
          <span className="label-mono text-ink-2">Hidden character X-ray</span>
          <span className="font-mono text-[12px] text-ink-3">{res.findings.reduce((a, f) => a + f.count, 0)} special characters detected</span>
        </div>
        <div className="p-3.5 font-mono text-[13px] leading-relaxed text-ink">
          {tokens.map((t) =>
            t.kind === "inv" ? (
              <span key={t.key} className="mx-0.5 inline-block rounded bg-danger/15 px-1 text-[12px] font-semibold text-danger">
                {t.text}
              </span>
            ) : t.kind === "smart" ? (
              <span key={t.key} className="mx-0.5 inline-block rounded bg-warning/20 px-1 font-semibold text-warning">
                {t.text}
              </span>
            ) : (
              <span key={t.key}>{t.text}</span>
            ),
          )}
        </div>
        {res.findings.length > 0 && (
          <div className="flex flex-wrap gap-1.5 border-t border-line bg-paper/50 px-3.5 py-2.5">
            {res.findings.map((f) => (
              <span key={f.code} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-0.5 font-mono text-[12px] text-ink-2">
                <span className="font-semibold text-ink">{f.code}</span>
                <span>{f.label}</span>
                <span className="text-accent">×{f.count}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      <Panel>
        <Row label="Clean rules">
          <div className="grid gap-2.5 sm:grid-cols-2">
            <Toggle checked={stripInvisible} onChange={setStripInvisible} label="Strip zero-width, BOM & bidi marks" />
            <Toggle checked={replaceNbsp} onChange={setReplaceNbsp} label="Convert non-breaking spaces to spaces" />
            <Toggle checked={straightenQuotes} onChange={setStraightenQuotes} label="Straighten curly quotes & ellipsis" />
            <Toggle checked={normalizeDashes} onChange={setNormalizeDashes} label="Replace em/en dashes with -- / -" />
            <Toggle checked={collapseSpaces} onChange={setCollapseSpaces} label="Collapse repeated spaces & trailing gaps" />
          </div>
        </Row>
      </Panel>

      <Output value={res.cleaned} name="cleaned.txt" lang="Clean text" download="cleaned.txt" />
    </>
  );
}
