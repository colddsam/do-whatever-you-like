"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { ArrowDownUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { Chips, Notice, Panel, Row, Slider, TextField, Toggle } from "../pdf/kit";
import { Editor, Output } from "../dev/parts";

/* ---------- find & replace ---------- */

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

type Hit = { start: number; end: number; text: string; line: number };

/** Copies the case pattern of `like` onto `word`: HELLO → WORLD, Hello → World. */
function keepCase(like: string, word: string) {
  if (like === like.toUpperCase() && like !== like.toLowerCase()) return word.toUpperCase();
  if (like[0] === like[0]?.toUpperCase() && like.slice(1) === like.slice(1).toLowerCase()) return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  if (like === like.toLowerCase()) return word.toLowerCase();
  return word;
}

const SAMPLE_TEXT = `The quick brown fox jumps over the lazy dog.
The Fox was quick, and the dog was not.
Contact: ada@example.com, linus@example.org
Order #1042 shipped on 2026-11-14; order #1043 ships on 2026-11-20.`;

export function FindReplaceEngine() {
  const [text, setText] = useState(SAMPLE_TEXT);
  const [find, setFind] = useState("fox");
  const [replace, setReplace] = useState("cat");
  const [regex, setRegex] = useState(false);
  const [matchCase, setMatchCase] = useState(false);
  const [whole, setWhole] = useState(false);
  const [preserve, setPreserve] = useState(true);
  const d = useDeferredValue(text);
  const df = useDeferredValue(find);

  const { re, error } = useMemo(() => {
    if (!df) return { re: null, error: null };
    try {
      let src = regex ? df : escapeRe(df);
      if (whole) src = `(?<![\\p{L}\\p{N}_])(?:${src})(?![\\p{L}\\p{N}_])`;
      return { re: new RegExp(src, `g${matchCase ? "" : "i"}mu`), error: null };
    } catch (e) {
      return { re: null, error: `That pattern isn't valid: ${(e as Error).message.replace(/^Invalid regular expression: /, "")}` };
    }
  }, [df, regex, matchCase, whole]);

  const hits = useMemo(() => {
    if (!re) return [] as Hit[];
    const out: Hit[] = [];
    for (const m of d.matchAll(re)) {
      if (m[0] === "" && out.length > 5000) break;
      out.push({ start: m.index!, end: m.index! + m[0].length, text: m[0], line: d.slice(0, m.index).split("\n").length });
      if (out.length >= 10000) break;
    }
    return out.filter((h) => h.end > h.start);
  }, [d, re]);

  const result = useMemo(() => {
    if (!re) return d;
    return d.replace(re, (...args) => {
      const match = args[0] as string;
      const groups = args.slice(1, -2) as string[];
      let rep = regex ? replace.replace(/\$(\d+|&)/g, (_, g: string) => (g === "&" ? match : (groups[Number(g) - 1] ?? ""))) : replace;
      if (preserve && !regex) rep = keepCase(match, rep);
      return rep;
    });
  }, [d, re, replace, regex, preserve]);

  // Highlighted view: text with every match marked.
  const marked = useMemo(() => {
    const parts: React.ReactNode[] = [];
    let at = 0;
    hits.slice(0, 2000).forEach((h, i) => {
      if (h.start > at) parts.push(d.slice(at, h.start));
      parts.push(
        <mark key={i} className="rounded-[3px] bg-accent/25 px-px text-ink">
          {h.text}
        </mark>,
      );
      at = h.end;
    });
    parts.push(d.slice(at));
    return parts;
  }, [d, hits]);

  const lines = [...new Set(hits.map((h) => h.line))];
  return (
    <>
      <Panel>
        <Row label="Find">
          <TextField label="Find" value={find} onChange={setFind} placeholder={regex ? "A pattern, e.g. \\d{4}-\\d{2}-\\d{2}" : "A word or phrase"} mono={regex} invalid={Boolean(error)} />
        </Row>
        <Row label="Replace with" hint={regex ? "$1, $2… insert groups; $& the whole match" : undefined}>
          <TextField label="Replace with" value={replace} onChange={setReplace} placeholder="Leave empty to delete the matches" mono={regex} />
        </Row>
        <Row label="Options">
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            <Toggle checked={matchCase} onChange={setMatchCase} label="Match case" />
            <Toggle checked={whole} onChange={setWhole} label="Whole words only" />
            <Toggle checked={regex} onChange={setRegex} label="Pattern (regex)" />
            {!regex && <Toggle checked={preserve} onChange={setPreserve} label="Keep capitals" description="Fox → Cat, FOX → CAT" />}
          </div>
        </Row>
      </Panel>
      {error && <Notice tone="danger">{error}</Notice>}
      <Editor value={text} onChange={setText} name="text" rows={8} spellCheck />
      <div className="overflow-hidden rounded-md border border-line bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-paper px-3 py-1.5">
          <span className="font-mono text-[12px] text-ink">
            {hits.length} match{hits.length === 1 ? "" : "es"}
            {lines.length > 0 && ` on line${lines.length === 1 ? "" : "s"} ${lines.slice(0, 12).join(", ")}${lines.length > 12 ? "…" : ""}`}
          </span>
        </div>
        <pre className="max-h-[260px] overflow-auto whitespace-pre-wrap break-words px-3 py-2.5 font-mono text-[13px] leading-relaxed text-ink-2" data-lenis-prevent>
          {marked}
        </pre>
      </div>
      <Output value={result} name="replaced.txt" lang={hits.length ? `${hits.length} replaced` : "Nothing to replace"} download="replaced.txt" />
    </>
  );
}

/* ---------- split ---------- */

type By = "lines" | "comma" | "space" | "custom" | "regex" | "length" | "sentences" | "words" | "chars";
type Shape = "lines" | "numbered" | "json" | "csv" | "quoted";

export function SplitEngine() {
  const [text, setText] = useState("apple, banana,  cherry,,date, banana, elderberry, fig");
  const [by, setBy] = useState<By>("comma");
  const [custom, setCustom] = useState(";");
  const [pattern, setPattern] = useState("[,;|]\\s*");
  const [len, setLen] = useState(10);
  const [trim, setTrim] = useState(true);
  const [dropEmpty, setDropEmpty] = useState(true);
  const [unique, setUnique] = useState(false);
  const [sort, setSort] = useState(false);
  const [shape, setShape] = useState<Shape>("lines");
  const d = useDeferredValue(text);

  const { parts, error } = useMemo(() => {
    let out: string[] = [];
    try {
      switch (by) {
        case "lines": out = d.split(/\r?\n/); break;
        case "comma": out = d.split(","); break;
        case "space": out = d.split(/\s+/); break;
        case "custom": out = custom ? d.split(custom.replace(/\\n/g, "\n").replace(/\\t/g, "\t")) : [d]; break;
        case "regex": out = d.split(new RegExp(pattern, "u")); break;
        case "length": for (let i = 0; i < d.length; i += Math.max(1, len)) out.push(d.slice(i, i + Math.max(1, len))); break;
        case "sentences": out = [...new Intl.Segmenter(undefined, { granularity: "sentence" }).segment(d)].map((s) => s.segment); break;
        case "words": out = [...new Intl.Segmenter(undefined, { granularity: "word" }).segment(d)].filter((s) => s.isWordLike).map((s) => s.segment); break;
        case "chars": out = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(d)].map((s) => s.segment); break;
      }
    } catch (e) {
      return { parts: [], error: `That pattern isn't valid: ${(e as Error).message}` };
    }
    if (trim) out = out.map((s) => s.trim());
    if (dropEmpty) out = out.filter((s) => s.length);
    if (unique) out = [...new Set(out)];
    if (sort) out = [...out].sort(new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }).compare);
    return { parts: out, error: null };
  }, [d, by, custom, pattern, len, trim, dropEmpty, unique, sort]);

  const result = useMemo(() => {
    switch (shape) {
      case "numbered": return parts.map((p, i) => `${i + 1}. ${p}`).join("\n");
      case "json": return JSON.stringify(parts, null, 2);
      case "csv": return parts.map((p) => (/[",\n]/.test(p) ? `"${p.replace(/"/g, '""')}"` : p)).join(",");
      case "quoted": return parts.map((p) => `"${p.replace(/"/g, '\\"')}"`).join(", ");
      default: return parts.join("\n");
    }
  }, [parts, shape]);

  return (
    <>
      <Panel>
        <Row label="Split by">
          <Chips
            value={by}
            options={[
              { value: "lines", label: "New lines" }, { value: "comma", label: "Commas" }, { value: "space", label: "Spaces" }, { value: "sentences", label: "Sentences" },
              { value: "words", label: "Words" }, { value: "chars", label: "Characters" }, { value: "custom", label: "Custom text" }, { value: "regex", label: "Pattern" }, { value: "length", label: "Every N characters" },
            ]}
            onChange={setBy}
            label="Split by"
          />
          <div className="mt-3">
            {by === "custom" && <TextField label="Separator" value={custom} onChange={setCustom} placeholder="; or | or \t" mono />}
            {by === "regex" && <TextField label="Pattern" value={pattern} onChange={setPattern} mono invalid={Boolean(error)} />}
            {by === "length" && <Slider label="Characters per piece" value={len} min={1} max={500} onChange={setLen} format={(v) => String(v)} />}
          </div>
        </Row>
        <Row label="Clean up">
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            <Toggle checked={trim} onChange={setTrim} label="Trim spaces" />
            <Toggle checked={dropEmpty} onChange={setDropEmpty} label="Drop empty pieces" />
            <Toggle checked={unique} onChange={setUnique} label="Remove duplicates" />
            <Toggle checked={sort} onChange={setSort} label="Sort A–Z" />
          </div>
        </Row>
        <Row label="Output as">
          <Chips value={shape} options={[{ value: "lines", label: "One per line" }, { value: "numbered", label: "Numbered" }, { value: "json", label: "JSON array" }, { value: "csv", label: "CSV row" }, { value: "quoted", label: "Quoted list" }]} onChange={setShape} label="Output as" />
        </Row>
      </Panel>
      {error && <Notice tone="danger">{error}</Notice>}
      <Editor value={text} onChange={setText} name="text" rows={6} spellCheck />
      <div className="flex items-center gap-2 text-ink-3" aria-hidden>
        <ArrowDownUp className="size-4" />
        <span className={cn("font-mono text-[12px]")}>{parts.length} piece{parts.length === 1 ? "" : "s"}</span>
      </div>
      <Output value={result} name={shape === "json" ? "pieces.json" : shape === "csv" ? "pieces.csv" : "pieces.txt"} lang={`${parts.length} pieces`} download={shape === "json" ? "pieces.json" : shape === "csv" ? "pieces.csv" : "pieces.txt"} />
    </>
  );
}
