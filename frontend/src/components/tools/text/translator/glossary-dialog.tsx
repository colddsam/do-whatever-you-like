"use client";

import { useRef, useState } from "react";
import { Download, Plus, Trash2, Upload } from "lucide-react";
import { saveBlob } from "@/lib/files";
import { languageLabel, type TranslateLanguage } from "@/lib/translate";
import { parseGlossaryText, type GlossaryRule } from "@/lib/translate-extras";
import { writeDelimited } from "@/lib/translate-docs";
import { btn } from "./shared";
import { Dialog } from "./dialog";

/** Terms that must never be translated (brand names) or always translated one way. Saved in this browser. */
export function GlossaryDialog({
  open,
  onClose,
  rules,
  onChange,
  target,
  languages,
}: {
  open: boolean;
  onClose: () => void;
  rules: GlossaryRule[];
  onChange: (rules: GlossaryRule[]) => void;
  target: string;
  languages: TranslateLanguage[];
}) {
  const [term, setTerm] = useState("");
  const [replacement, setReplacement] = useState("");
  const [scope, setScope] = useState<"*" | "current">("*");
  const fileRef = useRef<HTMLInputElement | null>(null);

  const add = () => {
    if (!term.trim()) return;
    onChange([
      { id: `${Date.now()}`, term: term.trim(), replacement: replacement.trim(), target: scope === "*" ? "*" : target },
      ...rules.filter((r) => !(r.term.toLowerCase() === term.trim().toLowerCase() && r.target === (scope === "*" ? "*" : target))),
    ]);
    setTerm("");
    setReplacement("");
  };

  const exportCsv = () => {
    const rows = [["term", "replacement", "language"], ...rules.map((r) => [r.term, r.replacement, r.target])];
    saveBlob(new Blob(["﻿" + writeDelimited(rows, ",")], { type: "text/csv;charset=utf-8" }), "translator-glossary.csv");
  };

  const importFile = async (file: File) => {
    const text = await file.text();
    const parsed = parseGlossaryText(text.replace(/^﻿/, ""));
    const clean = parsed.filter((r) => r.term.toLowerCase() !== "term");
    // A third CSV column is the language the rule applies to.
    for (const r of clean) {
      const parts = r.replacement.split(",");
      if (parts.length > 1) {
        const lang = parts.pop()!.trim();
        if (lang === "*" || languages.some((l) => l.code === lang)) {
          r.target = lang;
          r.replacement = parts.join(",").trim();
        }
      }
    }
    onChange([...clean, ...rules].slice(0, 300));
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Glossary"
      wide
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-2">
            <button type="button" className={btn} onClick={() => fileRef.current?.click()}>
              <Upload aria-hidden className="size-3.5" /> Import CSV
            </button>
            <input ref={fileRef} type="file" accept=".csv,.tsv,.txt" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) importFile(f); }} />
            <button type="button" className={btn} onClick={exportCsv} disabled={!rules.length}>
              <Download aria-hidden className="size-3.5" /> Export
            </button>
          </div>
          {rules.length > 0 && (
            <button type="button" className={btn} onClick={() => onChange([])}>
              <Trash2 aria-hidden className="size-3.5" /> Clear all
            </button>
          )}
        </div>
      }
    >
      <p className="text-sm text-ink-2">
        Brand names, product names and jargon: leave the translation empty to keep a term exactly as written, or give the word
        it should always become. Rules apply to text, documents and pictures, and stay in this browser.
      </p>
      <form
        className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Term (e.g. Do-Whatever)" aria-label="Term" className="h-10 rounded-sm border border-line bg-surface px-3 text-sm outline-none focus:border-ink" />
        <input value={replacement} onChange={(e) => setReplacement(e.target.value)} placeholder="Always translate as… (empty = keep)" aria-label="Replacement" className="h-10 rounded-sm border border-line bg-surface px-3 text-sm outline-none focus:border-ink" />
        <select value={scope} onChange={(e) => setScope(e.target.value as "*" | "current")} aria-label="Applies to" className="h-10 rounded-sm border border-line bg-surface px-2 text-sm">
          <option value="*">All languages</option>
          <option value="current">Only {languageLabel(target, languages)}</option>
        </select>
        <button type="submit" disabled={!term.trim()} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-sm bg-ink px-4 text-sm font-medium text-paper disabled:opacity-40">
          <Plus aria-hidden className="size-4" /> Add
        </button>
      </form>
      {rules.length === 0 ? (
        <p className="mt-6 text-center text-sm text-ink-3">No rules yet.</p>
      ) : (
        <ul className="mt-4 divide-y divide-line rounded-sm border border-line">
          {rules.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate font-medium text-ink">{r.term}</span>
              <span className="text-ink-3">→</span>
              <span className="min-w-0 flex-1 truncate text-ink-2">{r.replacement || <em className="text-ink-3">keep as is</em>}</span>
              <span className="hidden shrink-0 text-xs text-ink-3 sm:inline">{r.target === "*" ? "all" : languageLabel(r.target, languages)}</span>
              <button type="button" aria-label={`Remove ${r.term}`} onClick={() => onChange(rules.filter((x) => x.id !== r.id))} className="rounded-sm p-1 text-ink-3 hover:text-danger">
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
