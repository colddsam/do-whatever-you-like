"use client";

import { useMemo, useState } from "react";
import { Download, Search, Star, Trash2 } from "lucide-react";
import { saveBlob } from "@/lib/files";
import { languageLabel, type TranslateLanguage } from "@/lib/translate";
import type { HistoryItem } from "@/lib/translate-extras";
import { writeDelimited } from "@/lib/translate-docs";
import { cn } from "@/lib/utils";
import { btn, CopyButton } from "./shared";
import { Dialog } from "./dialog";

function when(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} h ago`;
  return new Date(ts).toLocaleDateString();
}

/** Recent translations and the starred phrasebook, searchable, kept only in this browser. */
export function HistoryDrawer({
  open,
  onClose,
  items,
  onChange,
  onRestore,
  languages,
}: {
  open: boolean;
  onClose: () => void;
  items: HistoryItem[];
  onChange: (items: HistoryItem[]) => void;
  onRestore: (item: HistoryItem) => void;
  languages: TranslateLanguage[];
}) {
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"all" | "starred">("all");
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((i) => (tab === "all" || i.starred) && (!q || i.input.toLowerCase().includes(q) || i.output.toLowerCase().includes(q)));
  }, [items, query, tab]);

  const exportCsv = () => {
    const rows = [["date", "from", "to", "text", "translation", "starred"], ...shown.map((i) => [new Date(i.at).toISOString(), i.detected ?? i.source, i.target, i.input, i.output, i.starred ? "yes" : ""])];
    saveBlob(new Blob(["﻿" + writeDelimited(rows, ",")], { type: "text/csv;charset=utf-8" }), tab === "starred" ? "phrasebook.csv" : "translation-history.csv");
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="History & phrasebook"
      wide
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button type="button" className={btn} onClick={exportCsv} disabled={!shown.length}>
            <Download aria-hidden className="size-3.5" /> Export CSV
          </button>
          <button type="button" className={btn} disabled={!items.some((i) => !i.starred)} onClick={() => onChange(items.filter((i) => i.starred))}>
            <Trash2 aria-hidden className="size-3.5" /> Clear history (keeps starred)
          </button>
        </div>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" className="inline-flex rounded-sm border border-line p-0.5">
          {(["all", "starred"] as const).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cn("rounded-[4px] px-3 py-1 text-sm", tab === t ? "bg-ink text-paper" : "text-ink-2")}>
              {t === "all" ? `Recent (${items.length})` : `Phrasebook (${items.filter((i) => i.starred).length})`}
            </button>
          ))}
        </div>
        <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-sm border border-line bg-surface px-2.5">
          <Search aria-hidden className="size-4 text-ink-3" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" aria-label="Search history" className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
        </label>
      </div>
      {shown.length === 0 ? (
        <p className="mt-8 text-center text-sm text-ink-3">{tab === "starred" ? "Star a translation to keep it here." : "Translations you make will show up here."}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {shown.map((i) => (
            <li key={i.id} className="rounded-sm border border-line">
              <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-1.5 text-xs text-ink-3">
                <span>
                  {languageLabel(i.detected && i.source === "auto" ? i.detected : i.source, languages)} → {languageLabel(i.target, languages)} · {when(i.at)}
                </span>
                <div className="flex items-center gap-1">
                  <button type="button" aria-label={i.starred ? "Unstar" : "Star"} onClick={() => onChange(items.map((x) => (x.id === i.id ? { ...x, starred: !x.starred } : x)))} className="rounded-sm p-1 hover:text-ink">
                    <Star className={cn("size-3.5", i.starred && "fill-accent text-accent")} />
                  </button>
                  <CopyButton text={i.output} iconOnly label="Copy translation" ghost />
                  <button type="button" aria-label="Delete" onClick={() => onChange(items.filter((x) => x.id !== i.id))} className="rounded-sm p-1 hover:text-danger">
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
              <button type="button" onClick={() => onRestore(i)} className="grid w-full gap-1 px-3 py-2 text-left text-sm hover:bg-paper/60 sm:grid-cols-2 sm:gap-3">
                <span className="line-clamp-3 text-ink-2" dir="auto">{i.input}</span>
                <span className="line-clamp-3 text-ink" dir="auto">{i.output}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
