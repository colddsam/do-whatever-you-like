"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, Sparkles, Wand2 } from "lucide-react";
import { getTool, stepsFor } from "@/lib/tools";
import { summarize } from "@/lib/utilities/text";
import { cn } from "@/lib/utils";
import { Workbench } from "../workbench";
import { Chips, Notice, Panel, Row, Slider } from "../pdf/kit";
import { Editor, Output } from "../dev/parts";
import { analyzeTextStats, inspectAndCleanText } from "../utilities/text-extra-engines";

type WritingMode = "grammar" | "rewrite" | "summarize";

type WritingIssue = {
  id: string;
  kind: "typo" | "punctuation" | "style" | "passive";
  label: string;
  snippet: string;
  suggestion?: string;
  apply?: (text: string) => string;
};

const TYPO_MAP: [RegExp, string][] = [
  [/\bteh\b/gi, "the"],
  [/\brecieve\b/gi, "receive"],
  [/\bseperate\b/gi, "separate"],
  [/\boccured\b/gi, "occurred"],
  [/\buntill\b/gi, "until"],
  [/\balot\b/gi, "a lot"],
  [/\bwich\b/gi, "which"],
  [/\bdont\b/gi, "don't"],
  [/\bcant\b/gi, "can't"],
  [/\bwont\b/gi, "won't"],
  [/\bim\b/g, "I'm"],
  [/\byoure\b/gi, "you're"],
  [/\bthier\b/gi, "their"],
  [/\bdefinately\b/gi, "definitely"],
  [/\benviroment\b/gi, "environment"],
];

const CONCISE_REPLACEMENTS: [RegExp, string, string][] = [
  [/\bin order to\b/gi, "to", "in order to → to"],
  [/\bdue to the fact that\b/gi, "because", "due to the fact that → because"],
  [/\bat this point in time\b/gi, "now", "at this point in time → now"],
  [/\bfor the purpose of\b/gi, "for", "for the purpose of → for"],
  [/\bin the event that\b/gi, "if", "in the event that → if"],
  [/\bmake a decision\b/gi, "decide", "make a decision → decide"],
  [/\bprior to\b/gi, "before", "prior to → before"],
  [/\bsubsequent to\b/gi, "after", "subsequent to → after"],
  [/\ba large number of\b/gi, "many", "a large number of → many"],
  [/\bin close proximity to\b/gi, "near", "in close proximity to → near"],
  [/\bwith regard to\b/gi, "about", "with regard to → about"],
  [/\bvery unique\b/gi, "unique", "very unique → unique"],
];

function matchCase(source: string, replacement: string): string {
  if (source === source.toUpperCase() && source.length > 1) return replacement.toUpperCase();
  if (source[0] && source[0] === source[0].toUpperCase()) return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  return replacement;
}

export function lintWriting(text: string): { issues: WritingIssue[]; fixAll: (s: string) => string } {
  const issues: WritingIssue[] = [];

  // Repeated adjacent words ("the the")
  const dupMatch = /\b([A-Za-z]+)\s+\1\b/i.exec(text);
  if (dupMatch) {
    issues.push({
      id: "dup-word",
      kind: "typo",
      label: `Repeated word “${dupMatch[1]}”`,
      snippet: dupMatch[0],
      suggestion: dupMatch[1],
      apply: (s) => s.replace(/\b([A-Za-z]+)\s+\1\b/gi, "$1"),
    });
  }

  // Common misspellings & missing apostrophes
  for (const [rx, fix] of TYPO_MAP) {
    const m = rx.exec(text);
    if (m) {
      issues.push({
        id: `typo-${fix}`,
        kind: "typo",
        label: `Spelling / contraction: “${m[0]}” → “${matchCase(m[0], fix)}”`,
        snippet: m[0],
        suggestion: matchCase(m[0], fix),
        apply: (s) => s.replace(rx, (orig) => matchCase(orig, fix)),
      });
    }
  }

  // Space before punctuation / double spaces
  if (/[ \t]{2,}/.test(text)) {
    issues.push({
      id: "double-space",
      kind: "punctuation",
      label: "Extra consecutive spaces",
      snippet: "  ",
      suggestion: "Single space",
      apply: (s) => s.replace(/[ \t]{2,}/g, " "),
    });
  }
  if (/\s+([,.;!?])/.test(text)) {
    issues.push({
      id: "space-before-punct",
      kind: "punctuation",
      label: "Space before punctuation",
      snippet: text.match(/\S+\s+[,.;!?]/)?.[0] ?? " ,",
      suggestion: "Remove extra space",
      apply: (s) => s.replace(/[ \t]+([,.;!?])/g, "$1"),
    });
  }
  if (/(^|[.!?]\s+)[a-z]/.test(text) || /\bi\b/.test(text)) {
    issues.push({
      id: "sentence-cap",
      kind: "punctuation",
      label: "Sentence start capitalization / lowercase “i”",
      snippet: "Sentence case check",
      suggestion: "Capitalize sentence starts",
      apply: (s) =>
        s
          .replace(/(^|[.!?]\s+)([a-z])/g, (_, pre: string, ch: string) => `${pre}${ch.toUpperCase()}`)
          .replace(/\bi\b/g, "I"),
    });
  }

  // Wordy phrases
  for (const [rx, repl, label] of CONCISE_REPLACEMENTS) {
    const m = rx.exec(text);
    if (m) {
      issues.push({
        id: `concise-${repl}`,
        kind: "style",
        label: `Wordy phrase: ${label}`,
        snippet: m[0],
        suggestion: matchCase(m[0], repl),
        apply: (s) => s.replace(rx, (orig) => matchCase(orig, repl)),
      });
    }
  }

  // Passive voice hints & long sentences
  const passiveMatch = /\b(was|were|is|are|been|being)\s+([a-z]+ed|written|built|made|sent|given|shown|taken)\b/i.exec(text);
  if (passiveMatch) {
    issues.push({
      id: "passive-voice",
      kind: "passive",
      label: `Possible passive voice (“${passiveMatch[0]}”) — consider active subject + verb`,
      snippet: passiveMatch[0],
    });
  }
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const longSentences = sentences.filter((s) => s.trim().split(/\s+/).length > 32);
  if (longSentences.length > 0) {
    issues.push({
      id: "long-sentence",
      kind: "style",
      label: `${longSentences.length} sentence${longSentences.length === 1 ? "" : "s"} exceed 32 words — consider splitting for clarity`,
      snippet: `${longSentences[0].slice(0, 72)}…`,
    });
  }

  const fixAll = (src: string) => {
    let next = inspectAndCleanText(src, {
      stripInvisible: true,
      replaceNbsp: true,
      straightenQuotes: true,
      normalizeDashes: false,
      collapseSpaces: true,
    }).cleaned;
    for (const issue of issues) {
      if (issue.apply) next = issue.apply(next);
    }
    return next;
  };

  return { issues, fixAll };
}

const SAMPLE_DRAFT = `In order to ship faster , the the engineering team made a decision to keep all utilities local. we built teh system due to the fact that privacy matters and cloud servers cost money. At this point in time, users can inspect files directly in their browser without waiting for uploads that were triggered earlier.`;

export function WritingHelperTool({ toolId }: { toolId: string }) {
  const tool = getTool(toolId)!;
  const [text, setText] = useState(SAMPLE_DRAFT);
  const [mode, setMode] = useState<WritingMode>("grammar");
  const [rewriteStyle, setRewriteStyle] = useState<"concise" | "clear" | "bullets" | "clean">("concise");
  const [summaryRatio, setSummaryRatio] = useState(40);
  const [summaryBullets, setSummaryBullets] = useState(true);

  const stats = useMemo(() => analyzeTextStats(text), [text]);
  const lint = useMemo(() => lintWriting(text), [text]);

  const rewriteOut = useMemo(() => {
    const { cleaned } = inspectAndCleanText(text, {
      stripInvisible: true,
      replaceNbsp: true,
      straightenQuotes: true,
      normalizeDashes: true,
      collapseSpaces: true,
    });
    if (rewriteStyle === "clean") return cleaned;

    let result = lint.fixAll(cleaned);
    for (const [rx, repl] of CONCISE_REPLACEMENTS) {
      result = result.replace(rx, (orig) => matchCase(orig, repl));
    }
    if (rewriteStyle === "clear") {
      result = result
        .replace(/\bvery\s+(good|great|important|fast|easy|simple|hard)\b/gi, (_, w: string) => w)
        .replace(/\b(really|actually|basically|literally|essentially)\s+/gi, "");
    }
    if (rewriteStyle === "bullets") {
      const sents = (result.replace(/\s+/g, " ").match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? []).map((s) => s.trim()).filter(Boolean);
      return sents.map((s) => `- ${s}`).join("\n");
    }
    return result;
  }, [text, rewriteStyle, lint]);

  const summaryRes = useMemo(() => {
    const res = summarize(text, summaryRatio / 100);
    if (!summaryBullets) return res;
    const sents = (res.summary.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? []).map((s) => s.trim()).filter(Boolean);
    return { ...res, summary: sents.map((s) => `• ${s}`).join("\n") };
  }, [text, summaryRatio, summaryBullets]);

  const safeIssueCount = lint.issues.filter((i) => Boolean(i.apply)).length;

  return (
    <Workbench
      steps={stepsFor(tool)}
      current={1}
      footer={<>Runs 100% in your browser using deterministic grammar rules and frequency summarization — zero API cost, zero tracking.</>}
    >
      <div className="space-y-4 p-4 sm:p-5">
        <Panel>
          <Row label="Mode">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Chips
                value={mode}
                onChange={setMode}
                options={[
                  { value: "grammar", label: `Fix grammar (${lint.issues.length})` },
                  { value: "rewrite", label: "Tighten & rewrite" },
                  { value: "summarize", label: "Summarise" },
                ]}
              />
              <div className="flex items-center gap-3 font-mono text-[12px] text-ink-3">
                <span>{stats.wordCount} words</span>
                <span>{stats.readingTime} read</span>
                {stats.fleschScore !== null && <span>Score {stats.fleschScore}/100</span>}
              </div>
            </div>
          </Row>
        </Panel>

        <Editor
          value={text}
          onChange={setText}
          name="draft.txt"
          rows={7}
          placeholder="Paste or type your writing here…"
          actions={
            <button
              type="button"
              onClick={() => setText(SAMPLE_DRAFT)}
              className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-line bg-surface px-2.5 text-[12px] text-ink-2 hover:text-ink"
            >
              <Sparkles aria-hidden className="size-3.5" /> Sample draft
            </button>
          }
        />

        {mode === "grammar" && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-paper px-4 py-3">
              <div className="flex items-center gap-2 text-sm text-ink">
                <CheckCircle2 aria-hidden className={cn("size-4", lint.issues.length === 0 ? "text-success" : "text-accent")} />
                <span>
                  {lint.issues.length === 0
                    ? "Looks clean! No grammar, typo or clarity flags found."
                    : `${lint.issues.length} suggestion${lint.issues.length === 1 ? "" : "s"} found`}
                </span>
              </div>
              {safeIssueCount > 0 && (
                <button
                  type="button"
                  onClick={() => setText(lint.fixAll(text))}
                  className="inline-flex h-8 items-center gap-1.5 rounded-[8px] bg-ink px-3 text-[12px] font-medium text-paper hover:bg-ink/90"
                >
                  <Wand2 aria-hidden className="size-3.5" /> Apply all {safeIssueCount} fixes
                </button>
              )}
            </div>

            {lint.issues.length > 0 && (
              <ul className="divide-y divide-line overflow-hidden rounded-md border border-line bg-surface">
                {lint.issues.map((issue) => (
                  <li key={issue.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "rounded-sm px-1.5 py-0.5 font-mono text-[12px] uppercase",
                            issue.kind === "typo"
                              ? "bg-danger/10 text-danger"
                              : issue.kind === "punctuation"
                                ? "bg-warning/15 text-warning"
                                : "bg-accent/10 text-accent",
                          )}
                        >
                          {issue.kind}
                        </span>
                        <p className="text-sm font-medium text-ink">{issue.label}</p>
                      </div>
                      <p className="truncate font-mono text-[12px] text-ink-3">Matched: “{issue.snippet}”</p>
                    </div>
                    {issue.apply && (
                      <button
                        type="button"
                        onClick={() => setText((cur) => issue.apply!(cur))}
                        className="inline-flex h-8 shrink-0 items-center rounded-[8px] border border-line bg-paper px-3 text-[12px] font-medium text-ink hover:border-ink-3"
                      >
                        Fix
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {mode === "rewrite" && (
          <div className="space-y-3">
            <Panel>
              <Row label="Style">
                <Chips
                  value={rewriteStyle}
                  onChange={setRewriteStyle}
                  options={[
                    { value: "concise", label: "Tight & concise" },
                    { value: "clear", label: "Remove filler & hedging" },
                    { value: "bullets", label: "Key bullet points" },
                    { value: "clean", label: "Clean quotes & whitespace" },
                  ]}
                />
              </Row>
            </Panel>
            <Output
              value={rewriteOut}
              name="rewritten.txt"
              lang={`${analyzeTextStats(rewriteOut).wordCount} words`}
              download="rewritten.txt"
            />
          </div>
        )}

        {mode === "summarize" && (
          <div className="space-y-3">
            <Panel>
              <Row label="Length">
                <Slider
                  label="Summary ratio"
                  value={summaryRatio}
                  min={15}
                  max={75}
                  step={5}
                  onChange={setSummaryRatio}
                  format={(v) => `${v}% (${summaryRes.kept}/${summaryRes.total} sentences)`}
                />
              </Row>
              <Row label="Format">
                <Chips
                  value={summaryBullets ? "bullets" : "paragraph"}
                  onChange={(v) => setSummaryBullets(v === "bullets")}
                  options={[
                    { value: "bullets", label: "Bullet points" },
                    { value: "paragraph", label: "Paragraph" },
                  ]}
                />
              </Row>
            </Panel>
            <Output value={summaryRes.summary} name="summary.txt" lang="Summary" download="summary.txt" />
          </div>
        )}

        <Notice tone="info">
          Writing checks combine local punctuation/typo rules, passive-voice and wordiness patterns, and extractive sentence ranking right in your browser.
        </Notice>
      </div>
    </Workbench>
  );
}
