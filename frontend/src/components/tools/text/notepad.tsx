"use client";

import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  AtSign,
  Braces,
  Calendar,
  CaseSensitive,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardPaste,
  CornerDownRight,
  Download,
  FolderOpen,
  Globe,
  Hash,
  Link2,
  Mail,
  Minus,
  Phone,
  Plus,
  Redo2,
  Regex,
  Replace,
  Search,
  Sparkles,
  Undo2,
  Wand2,
  WholeWord,
  WrapText,
  X,
  type LucideIcon,
} from "lucide-react";
import { getTool, stepsFor } from "@/lib/tools";
import { saveBlob } from "@/lib/files";
import { formatBytes } from "@/lib/media";
import {
  INVISIBLE_RX,
  ODD_SPACE_RX,
  buildFinder,
  detectFormat,
  extract,
  findAll,
  findIssues,
  keepCapitals,
  lineCol,
  lineStart,
  numberSummary,
  replaceAll,
  stats as textStats,
  topWords,
  transform,
  type ExtractKind,
  type FindOptions,
  type Range,
  type TransformId,
} from "@/lib/notepad";
import { readStartParams } from "@/lib/start-params";
import { cn } from "@/lib/utils";
import { Workbench } from "../workbench";
import { Toggle } from "../pdf/kit";
import { CopyButton } from "../dev/parts";

/*
 * Smart notepad: paste text, see what's in it, fix it, copy it out. Notes live in this browser's
 * local storage only. The editor is a plain textarea over a mirror that draws the highlights
 * (find matches, hidden characters, the spot you jumped to), so typing stays native and fast,
 * and every edit goes through the browser's own undo stack.
 */

type Note = { id: string; title: string; text: string; updated: number };
type Saved = { notes: Note[]; active: string; wrap: boolean; size: number };
type InspectorTab = "overview" | "found" | "issues" | "words";
type Mark = Range & { tone: "match" | "current" | "flash" | "hidden" | "space" };

const STORE_KEY = "dw:notepad:v1";
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const HIGHLIGHT_LIMIT = 5000;
const SIZES = [12, 13, 14, 15, 16, 18, 20];

const newId = () => Math.random().toString(36).slice(2, 10);
const blankNote = (text = "", title = ""): Note => ({ id: newId(), title, text, updated: Date.now() });

const SAMPLE = `Meeting notes – launch plan 🚀
Owner: @priya_k · Contact: priya.k@example.com · +1 (415) 555-0134
Docs: https://example.com/launch?ref=notes

Budget: 1,250 for ads, 480 for design and 75.5 for tools.
Deadline 2026-12-01, review on 15/11/2026.

Todo:
- Finalise the the landing page copy
- Send “final” assets to the team
- Send “final” assets to the team
- Book the review call (room 4B)

#launch #q4​`;

const EXTRACT_ICONS: Record<ExtractKind, LucideIcon> = {
  emails: Mail,
  urls: Link2,
  phones: Phone,
  numbers: Hash,
  hashtags: Hash,
  mentions: AtSign,
  dates: Calendar,
  ips: Globe,
};

const TRANSFORMS: { group: string; items: { id: TransformId; label: string }[] }[] = [
  {
    group: "Case",
    items: [
      { id: "upper", label: "UPPER" },
      { id: "lower", label: "lower" },
      { id: "title", label: "Title Case" },
      { id: "sentence", label: "Sentence case" },
      { id: "swap", label: "sWAP" },
    ],
  },
  {
    group: "Lines",
    items: [
      { id: "trim-lines", label: "Trim" },
      { id: "remove-empty", label: "Remove empty" },
      { id: "dedupe", label: "Remove duplicates" },
      { id: "dedupe-any-case", label: "Remove duplicates (any case)" },
      { id: "sort-az", label: "Sort A→Z" },
      { id: "sort-za", label: "Sort Z→A" },
      { id: "sort-natural", label: "Sort 1→10" },
      { id: "sort-length", label: "Sort by length" },
      { id: "reverse-lines", label: "Reverse" },
      { id: "shuffle", label: "Shuffle" },
      { id: "number-lines", label: "Number" },
      { id: "unnumber-lines", label: "Un-number" },
      { id: "add-bullets", label: "Bullets" },
      { id: "quote-lines", label: "> Quote" },
      { id: "join-lines", label: "Join lines" },
      { id: "split-sentences", label: "Sentence per line" },
    ],
  },
  {
    group: "Clean",
    items: [
      { id: "strip-invisible", label: "Remove hidden chars" },
      { id: "straighten", label: "Straight quotes" },
      { id: "collapse-spaces", label: "Collapse spaces" },
      { id: "tabs-to-spaces", label: "Tabs → spaces" },
      { id: "strip-html", label: "Strip HTML" },
      { id: "strip-markdown", label: "Strip Markdown" },
    ],
  },
  {
    group: "Convert",
    items: [
      { id: "json-pretty", label: "Format JSON" },
      { id: "json-minify", label: "Minify JSON" },
      { id: "url-encode", label: "URL encode" },
      { id: "url-decode", label: "URL decode" },
    ],
  },
];

function readSaved(): Saved | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Saved;
    if (!Array.isArray(v.notes) || !v.notes.length) return null;
    return v;
  } catch {
    return null;
  }
}

const titleOf = (n: Note) => n.title.trim() || n.text.trim().split("\n")[0].slice(0, 40).trim() || "Untitled";

const EXT: Record<string, string> = { json: "json", markdown: "md", csv: "csv", tsv: "tsv", html: "html" };
const safeName = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "note";

/** Small icon button for the toolbar. */
function ToolButton({
  icon: Icon,
  label,
  onClick,
  active,
  disabled,
  showLabel,
  shortcut,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  showLabel?: boolean;
  shortcut?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-label={showLabel ? undefined : label}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[8px] border px-2 text-[13px] transition-colors duration-150 disabled:pointer-events-none disabled:opacity-40",
        active ? "border-ink bg-ink text-paper" : "border-transparent text-ink-2 hover:border-line hover:bg-surface hover:text-ink",
      )}
    >
      <Icon aria-hidden className="size-4" />
      {showLabel && <span className="hidden sm:inline">{label}</span>}
    </button>
  );
}

const noop = () => () => {};

/** Notes come from local storage, so the editor only renders in the browser (a same-sized placeholder on the server). */
export function NotepadTool({ toolId }: { toolId: string }) {
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  if (!mounted) return <div className="h-[760px] animate-pulse rounded-lg border border-line bg-surface" aria-hidden />;
  return <Notepad toolId={toolId} saved={readSaved()} start={readStartParams()} />;
}

/**
 * `start` comes from the address: ?open=find|replace opens the find bar, ?tab=issues the issues
 * list, ?panel=lines points at the line tools (the old Find and replace, Invisible character
 * cleaner and Sort lines pages redirect here that way).
 */
function Notepad({ toolId, saved, start }: { toolId: string; saved: Saved | null; start: Record<string, string> }) {
  const tool = getTool(toolId)!;

  // ---------- notes & persistence ----------
  const [notes, setNotes] = useState<Note[]>(() => saved?.notes ?? [blankNote()]);
  const [activeId, setActiveId] = useState<string>(() => (saved && saved.notes.some((n) => n.id === saved.active) ? saved.active : notes[0].id));
  const [wrap, setWrap] = useState(saved?.wrap !== false);
  const [size, setSize] = useState(saved && SIZES.includes(saved.size) ? saved.size : 14);
  const [storeFull, setStoreFull] = useState(false);
  const [closed, setClosed] = useState<{ note: Note; index: number } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify({ notes, active: activeId, wrap, size } satisfies Saved));
        setStoreFull(false);
      } catch {
        setStoreFull(true);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [notes, activeId, wrap, size]);

  const note = notes.find((n) => n.id === activeId) ?? notes[0];
  const text = note.text;
  const setText = useCallback(
    (next: string) => setNotes((ns) => ns.map((n) => (n.id === activeId ? { ...n, text: next, updated: Date.now() } : n))),
    [activeId],
  );

  // ---------- editor refs & selection ----------
  const taRef = useRef<HTMLTextAreaElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const gutterRef = useRef<HTMLPreElement>(null);
  const flashRef = useRef<HTMLElement | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const findRef = useRef<HTMLInputElement>(null);
  const [sel, setSel] = useState<Range>({ start: 0, end: 0 });
  const [flash, setFlash] = useState<Range | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "warn"; undo?: () => void } | null>(null);
  const [exported, setExported] = useState(false);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.undo ? 6000 : 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const readSel = () => {
    const ta = taRef.current;
    if (ta) setSel({ start: ta.selectionStart, end: ta.selectionEnd });
  };

  const syncScroll = () => {
    const ta = taRef.current;
    if (!ta) return;
    if (mirrorRef.current) {
      mirrorRef.current.scrollTop = ta.scrollTop;
      mirrorRef.current.scrollLeft = ta.scrollLeft;
    }
    if (gutterRef.current) gutterRef.current.scrollTop = ta.scrollTop;
  };

  /** Replaces [start, end) through the browser, so Ctrl+Z undoes it like typing. */
  const edit = useCallback(
    (start: number, end: number, insert: string, selectInserted = true) => {
      const ta = taRef.current;
      const expected = text.slice(0, start) + insert + text.slice(end);
      if (ta) {
        ta.focus();
        ta.setSelectionRange(start, end);
        let ok = false;
        try {
          ok = document.execCommand("insertText", false, insert);
        } catch {
          ok = false;
        }
        if (!ok || ta.value !== expected) setText(expected);
        requestAnimationFrame(() => {
          if (selectInserted) ta.setSelectionRange(start, start + insert.length);
          readSel();
        });
      } else setText(expected);
    },
    [text, setText],
  );

  /** Selects a range and scrolls it into view (the mirror marks it, then we read its position). */
  const jump = useCallback((r: Range) => {
    const ta = taRef.current;
    if (!ta) return;
    ta.focus({ preventScroll: true });
    ta.setSelectionRange(r.start, r.end);
    setSel(r);
    setFlash({ ...r });
  }, []);

  useLayoutEffect(() => {
    const ta = taRef.current;
    const el = flashRef.current;
    if (!flash || !ta || !el) return;
    ta.scrollTop = Math.max(0, el.offsetTop - ta.clientHeight / 3);
    if (!wrap) ta.scrollLeft = Math.max(0, el.offsetLeft - ta.clientWidth / 3);
    syncScroll();
  }, [flash, wrap]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 1600);
    return () => clearTimeout(t);
  }, [flash]);

  // ---------- find & replace ----------
  const [findOpen, setFindOpen] = useState(start.open === "find" || start.open === "replace");
  const [replaceOpen, setReplaceOpen] = useState(start.open === "replace");
  const [keepCaps, setKeepCaps] = useState(false);
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [opts, setOpts] = useState<FindOptions>({ caseSensitive: false, wholeWord: false, regex: false });
  const [current, setCurrent] = useState(0);
  const [gotoLine, setGotoLine] = useState("");

  const finder = useMemo(() => (findOpen ? buildFinder(query, opts) : null), [findOpen, query, opts]);
  const finderError = finder && "error" in finder ? finder.error : null;
  const regex = finder && !("error" in finder) ? finder : null;

  // Analysis runs on a deferred copy, so typing in a long note never waits for it.
  const deferred = useDeferredValue(text);
  const fresh = deferred === text;
  const matches = useMemo(() => findAll(deferred, regex), [deferred, regex]);
  const matchCount = matches.ranges.length;
  const currentIndex = matchCount ? Math.min(current, matchCount - 1) : 0;

  const goMatch = (dir: 1 | -1) => {
    if (!matchCount) return;
    // From the caret: the next match after it (or the previous one before it).
    let i: number;
    if (dir === 1) {
      i = matches.ranges.findIndex((m) => m.start >= sel.end);
      if (i === -1 || (matches.ranges[i].start === sel.start && matches.ranges[i].end === sel.end)) i = i === -1 ? 0 : (i + 1) % matchCount;
    } else {
      i = -1;
      for (let k = matchCount - 1; k >= 0; k--) {
        if (matches.ranges[k].end <= sel.start) {
          i = k;
          break;
        }
      }
      if (i === -1) i = matchCount - 1;
    }
    setCurrent(i);
    jump(matches.ranges[i]);
  };

  const replaceOne = () => {
    if (!regex || !matchCount) return;
    const m = matches.ranges[currentIndex];
    const isSelected = sel.start === m.start && sel.end === m.end;
    if (!isSelected) return jump(m);
    const piece = text.slice(m.start, m.end);
    const one = opts.regex
      ? piece.replace(new RegExp(regex.source, regex.flags.replace("g", "")), replacement)
      : keepCaps
        ? keepCapitals(piece, replacement)
        : replacement;
    edit(m.start, m.end, one, false);
    requestAnimationFrame(() => {
      const ta = taRef.current;
      if (ta) ta.setSelectionRange(m.start + one.length, m.start + one.length);
      readSel();
    });
  };

  const replaceEvery = () => {
    if (!regex || !matchCount) return;
    const res = replaceAll(text, regex, replacement, opts.regex, keepCaps);
    edit(0, text.length, res.text, false);
    setToast({ text: `Replaced ${res.count.toLocaleString("en")} match${res.count === 1 ? "" : "es"}`, tone: "ok" });
  };

  const openFind = (withReplace: boolean) => {
    const ta = taRef.current;
    const picked = ta ? text.slice(ta.selectionStart, ta.selectionEnd) : "";
    if (picked && !picked.includes("\n") && picked.length < 200) setQuery(picked);
    setFindOpen(true);
    if (withReplace) setReplaceOpen(true);
    requestAnimationFrame(() => findRef.current?.select());
  };

  const searchFor = (word: string) => {
    setOpts({ caseSensitive: false, wholeWord: true, regex: false });
    setQuery(word);
    setFindOpen(true);
    setCurrent(0);
    const f = buildFinder(word, { caseSensitive: false, wholeWord: true, regex: false });
    const first = f && !("error" in f) ? findAll(text, f).ranges[0] : undefined;
    if (first) jump(first);
  };

  const doGoto = () => {
    const n = parseInt(gotoLine, 10);
    if (!Number.isFinite(n) || n < 1) return;
    const start = lineStart(text, n);
    const nl = text.indexOf("\n", start);
    jump({ start, end: nl === -1 ? text.length : nl });
  };

  // ---------- analysis ----------
  const [tab, setTab] = useState<InspectorTab>(start.tab === "issues" || start.tab === "found" || start.tab === "words" ? start.tab : "overview");
  const [skipCommon, setSkipCommon] = useState(true);
  const counts = useMemo(() => textStats(deferred), [deferred]);
  const format = useMemo(() => detectFormat(deferred), [deferred]);
  const found = useMemo(() => extract(deferred), [deferred]);
  const issues = useMemo(() => findIssues(deferred), [deferred]);
  const words = useMemo(() => topWords(deferred, skipCommon, 40), [deferred, skipCommon]);
  const fixable = issues.filter((i) => i.fix && i.severity === "fix");
  const foundTotal = found.reduce((a, f) => a + f.items.length, 0);

  const selected = text.slice(sel.start, sel.end);
  const hasSelection = sel.end > sel.start;
  const caret = useMemo(() => lineCol(text, sel.end), [text, sel.end]);
  const selWords = hasSelection ? (selected.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.length ?? 0) : 0;

  // ---------- highlights in the mirror ----------
  const marks = useMemo<Mark[]>(() => {
    if (!fresh) return [];
    const out: Mark[] = [];
    if (flash) out.push({ ...flash, tone: "flash" });
    matches.ranges.forEach((m, i) => out.push({ ...m, tone: i === currentIndex && findOpen ? "current" : "match" }));
    if (deferred.length < 400_000) {
      for (const [rx, tone] of [
        [INVISIBLE_RX, "hidden"],
        [ODD_SPACE_RX, "space"],
      ] as const) {
        for (const m of deferred.matchAll(new RegExp(rx.source, "g"))) {
          out.push({ start: m.index!, end: m.index! + m[0].length, tone });
          if (out.length > HIGHLIGHT_LIMIT) break;
        }
      }
    }
    const rank = { flash: 0, current: 1, match: 2, hidden: 3, space: 4 };
    out.sort((a, b) => a.start - b.start || rank[a.tone] - rank[b.tone]);
    const clean: Mark[] = [];
    for (const m of out) {
      const prev = clean[clean.length - 1];
      if (prev && m.start < prev.end) continue;
      clean.push(m);
      if (clean.length > HIGHLIGHT_LIMIT) break;
    }
    return clean;
  }, [fresh, flash, matches, currentIndex, findOpen, deferred]);

  const mirror = useMemo(() => {
    const parts: React.ReactNode[] = [];
    let pos = 0;
    marks.forEach((m, i) => {
      if (m.start > pos) parts.push(text.slice(pos, m.start));
      const piece = text.slice(m.start, m.end);
      parts.push(
        <mark
          key={i}
          ref={m.tone === "flash" ? (el) => void (flashRef.current = el) : undefined}
          className={cn(
            "rounded-[2px] text-transparent",
            m.tone === "match" && "bg-accent/20",
            m.tone === "current" && "bg-accent/50",
            m.tone === "flash" && "bg-accent/40",
            m.tone === "space" && "bg-warning/30",
            // Zero-width characters get a visible red bar where they sit, without moving the text.
            m.tone === "hidden" && "relative bg-transparent before:absolute before:-inset-y-0.5 before:left-0 before:w-[2px] before:bg-danger",
          )}
        >
          {piece}
        </mark>,
      );
      pos = m.end;
    });
    parts.push(text.slice(pos));
    return parts;
  }, [marks, text]);

  const lineCount = useMemo(() => (text ? text.split("\n").length : 1), [text]);
  const gutter = useMemo(() => (wrap ? "" : Array.from({ length: lineCount }, (_, i) => i + 1).join("\n")), [wrap, lineCount]);

  // ---------- actions ----------
  const runTransform = (id: TransformId) => {
    const scopeStart = hasSelection ? sel.start : 0;
    const scopeEnd = hasSelection ? sel.end : text.length;
    const source = text.slice(scopeStart, scopeEnd);
    if (!source) return setToast({ text: "Nothing to change yet: paste or type some text first.", tone: "warn" });
    try {
      const out = transform(source, id);
      if (out === source) return setToast({ text: "Already done: nothing changed.", tone: "ok" });
      edit(scopeStart, scopeEnd, out, hasSelection);
    } catch (e) {
      setToast({ text: e instanceof Error ? e.message : "That didn't work on this text.", tone: "warn" });
    }
  };

  const fixIssue = (fix: (s: string) => string, label: string) => {
    const out = fix(text);
    if (out !== text) edit(0, text.length, out, false);
    setToast({ text: label, tone: "ok" });
  };

  const fixAll = () => {
    let out = text;
    for (const i of fixable) out = i.fix!(out);
    if (out !== text) edit(0, text.length, out, false);
    setToast({ text: `Fixed ${fixable.length} kind${fixable.length === 1 ? "" : "s"} of issue`, tone: "ok" });
  };

  const pasteClipboard = async () => {
    try {
      const clip = await navigator.clipboard.readText();
      if (!clip) return setToast({ text: "The clipboard is empty.", tone: "warn" });
      const ta = taRef.current;
      const start = ta ? ta.selectionStart : text.length;
      const end = ta ? ta.selectionEnd : text.length;
      edit(start, end, clip, false);
      requestAnimationFrame(() => {
        ta?.setSelectionRange(start + clip.length, start + clip.length);
        readSel();
      });
    } catch {
      taRef.current?.focus();
      setToast({ text: "Your browser blocked clipboard access. Press Ctrl+V (⌘V on Mac) to paste.", tone: "warn" });
    }
  };

  const loadFiles = async (files: FileList | File[]) => {
    const list = [...files].filter((f) => f.size <= MAX_FILE_BYTES);
    if (list.length < files.length) setToast({ text: "Files over 5 MB were skipped.", tone: "warn" });
    const added: Note[] = [];
    for (const f of list) {
      const content = (await f.text()).replace(/\r\n?/g, "\n");
      if (content.includes("\u0000")) {
        setToast({ text: `${f.name} isn't a text file.`, tone: "warn" });
        continue;
      }
      added.push(blankNote(content, f.name.replace(/\.[^.]+$/, "")));
    }
    if (!added.length) return;
    if (!text.trim() && added.length) {
      const [first, ...rest] = added;
      setNotes((ns) => [...ns.map((n) => (n.id === activeId ? { ...n, text: first.text, title: first.title, updated: Date.now() } : n)), ...rest]);
    } else {
      setNotes((ns) => [...ns, ...added]);
      setActiveId(added[0].id);
    }
    setFlash(null);
  };

  const download = () => {
    const ext = EXT[format.kind] ?? "txt";
    const type = ext === "json" ? "application/json" : ext === "html" ? "text/html" : ext === "md" ? "text/markdown" : ext === "csv" ? "text/csv" : "text/plain";
    saveBlob(new Blob([text], { type: `${type};charset=utf-8` }), `${safeName(titleOf(note))}.${ext}`);
    setExported(true);
  };

  const addNote = () => {
    const n = blankNote();
    setNotes((ns) => [...ns, n]);
    setActiveId(n.id);
    setSel({ start: 0, end: 0 });
    requestAnimationFrame(() => taRef.current?.focus());
  };

  const closeNote = (id: string) => {
    const index = notes.findIndex((n) => n.id === id);
    const victim = notes[index];
    const rest = notes.filter((n) => n.id !== id);
    const nextNotes = rest.length ? rest : [blankNote()];
    setNotes(nextNotes);
    if (id === activeId) setActiveId(nextNotes[Math.max(0, index - 1)]?.id ?? nextNotes[0].id);
    if (victim.text.trim()) {
      setClosed({ note: victim, index });
      setToast({
        text: `Closed “${titleOf(victim)}”`,
        tone: "ok",
        undo: () => {
          setNotes((ns) => {
            const copy = ns.length === 1 && !ns[0].text ? [] : [...ns];
            copy.splice(Math.min(index, copy.length), 0, victim);
            return copy;
          });
          setActiveId(victim.id);
          setClosed(null);
        },
      });
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "f") {
      e.preventDefault();
      openFind(false);
    } else if (mod && e.key.toLowerCase() === "h") {
      e.preventDefault();
      openFind(true);
    } else if (mod && e.key.toLowerCase() === "s") {
      e.preventDefault();
      download();
    } else if (e.key === "F3") {
      e.preventDefault();
      goMatch(e.shiftKey ? -1 : 1);
    } else if (e.key === "Escape" && findOpen) {
      setFindOpen(false);
      taRef.current?.focus();
    }
  };

  const step = exported ? 3 : text.trim() ? 1 : 0;
  const nothing = !text;

  return (
    <Workbench
      steps={stepsFor(tool)}
      current={step}
      footer={
        <>
          Notes are kept only in this browser (local storage) and never uploaded. Shortcuts: Ctrl+F find, Ctrl+H replace, F3 next match, Ctrl+S save
          a copy, Ctrl+Z undo (also undoes fixes and transforms).
        </>
      }
    >
      <div onKeyDown={onKeyDown} className="@container">
        {/* Notes */}
        <div className="flex items-center gap-1 overflow-x-auto border-b border-line bg-paper px-2" role="tablist" aria-label="Notes" data-lenis-prevent>
          {notes.map((n) => {
            const active = n.id === activeId;
            return (
              <div
                key={n.id}
                role="tab"
                aria-selected={active}
                className={cn(
                  "group -mb-px flex h-10 shrink-0 items-center gap-1 border-b pl-2.5 pr-1 text-[13px] transition-colors",
                  active ? "border-ink text-ink" : "border-transparent text-ink-3 hover:text-ink",
                )}
              >
                {renaming === n.id ? (
                  <input
                    autoFocus
                    defaultValue={n.title || titleOf(n)}
                    aria-label="Note name"
                    maxLength={60}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      setNotes((ns) => ns.map((x) => (x.id === n.id ? { ...x, title: v } : x)));
                      setRenaming(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      if (e.key === "Escape") setRenaming(null);
                      e.stopPropagation();
                    }}
                    className="h-7 w-40 rounded-sm border border-ink bg-surface px-1.5 text-[13px] text-ink outline-none"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      if (active) setRenaming(n.id);
                      else {
                        setActiveId(n.id);
                        setSel({ start: 0, end: 0 });
                        setFlash(null);
                      }
                    }}
                    title={active ? "Click to rename" : titleOf(n)}
                    className="max-w-[12rem] truncate"
                  >
                    {titleOf(n)}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => closeNote(n.id)}
                  aria-label={`Close ${titleOf(n)}`}
                  className={cn("inline-flex size-6 items-center justify-center rounded-sm text-ink-3 hover:bg-paper-2 hover:text-ink", !active && "opacity-0 group-hover:opacity-100 focus:opacity-100")}
                >
                  <X aria-hidden className="size-3.5" />
                </button>
              </div>
            );
          })}
          <button
            type="button"
            onClick={addNote}
            className="ml-1 inline-flex h-8 shrink-0 items-center gap-1 rounded-[8px] px-2 text-[13px] text-ink-3 hover:bg-paper-2 hover:text-ink"
          >
            <Plus aria-hidden className="size-4" /> New note
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-0.5 border-b border-line bg-surface px-2 py-1.5">
          <ToolButton icon={ClipboardPaste} label="Paste" showLabel onClick={pasteClipboard} />
          <ToolButton icon={FolderOpen} label="Open file" showLabel onClick={() => fileRef.current?.click()} />
          <input
            ref={fileRef}
            type="file"
            multiple
            accept=".txt,.md,.markdown,.csv,.tsv,.json,.log,.xml,.html,.htm,.yaml,.yml,.ini,.srt,.vtt,.js,.ts,.py,.css,.sql,text/*"
            className="sr-only"
            tabIndex={-1}
            onChange={(e) => {
              if (e.target.files?.length) void loadFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <ToolButton icon={Download} label="Download" showLabel onClick={download} disabled={nothing} shortcut="Ctrl+S" />
          <span className="mx-1 h-5 w-px bg-line" aria-hidden />
          <ToolButton icon={Undo2} label="Undo" onClick={() => (taRef.current?.focus(), document.execCommand("undo"))} shortcut="Ctrl+Z" />
          <ToolButton icon={Redo2} label="Redo" onClick={() => (taRef.current?.focus(), document.execCommand("redo"))} shortcut="Ctrl+Y" />
          <span className="mx-1 h-5 w-px bg-line" aria-hidden />
          <ToolButton icon={Search} label="Find" onClick={() => (findOpen ? setFindOpen(false) : openFind(false))} active={findOpen} shortcut="Ctrl+F" />
          <ToolButton icon={Replace} label="Replace" onClick={() => openFind(!replaceOpen || !findOpen)} active={findOpen && replaceOpen} shortcut="Ctrl+H" />
          <ToolButton icon={WrapText} label="Word wrap" onClick={() => setWrap((w) => !w)} active={wrap} />
          <span className="flex items-center" role="group" aria-label="Text size">
            <ToolButton icon={Minus} label="Smaller text" onClick={() => setSize((s) => SIZES[Math.max(0, SIZES.indexOf(s) - 1)])} disabled={size === SIZES[0]} />
            <span className="w-9 text-center font-mono text-[12px] text-ink-3">{size}px</span>
            <ToolButton icon={Plus} label="Larger text" onClick={() => setSize((s) => SIZES[Math.min(SIZES.length - 1, SIZES.indexOf(s) + 1)])} disabled={size === SIZES[SIZES.length - 1]} />
          </span>
          <span className="ml-auto flex items-center gap-1">
            {nothing && (
              <button
                type="button"
                onClick={() => setText(SAMPLE)}
                className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-line bg-surface px-2.5 text-[13px] text-ink-2 hover:border-ink-3 hover:text-ink"
              >
                <Sparkles aria-hidden className="size-3.5" /> Try a sample
              </button>
            )}
            <CopyButton text={text} label="Copy all" onCopied={() => setExported(true)} />
          </span>
        </div>

        {/* Find & replace */}
        <AnimatePresence initial={false}>
          {findOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className="overflow-hidden border-b border-line bg-paper"
            >
              <div className="space-y-2 px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <div className={cn("flex h-9 min-w-0 flex-1 basis-56 items-center rounded-[8px] border bg-surface pl-2.5", finderError ? "border-danger/60" : "border-line focus-within:border-ink")}>
                    <Search aria-hidden className="size-4 shrink-0 text-ink-3" />
                    <input
                      ref={findRef}
                      value={query}
                      onChange={(e) => {
                        setQuery(e.target.value);
                        setCurrent(0);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          goMatch(e.shiftKey ? -1 : 1);
                        }
                      }}
                      placeholder="Find"
                      aria-label="Find"
                      aria-invalid={Boolean(finderError)}
                      spellCheck={false}
                      className="h-full min-w-0 flex-1 bg-transparent px-2 font-mono text-[13px] text-ink outline-none placeholder:text-ink-3"
                    />
                    <span className="shrink-0 px-1 font-mono text-[12px] text-ink-3" aria-live="polite">
                      {query ? (finderError ? "bad pattern" : matchCount ? `${currentIndex + 1}/${matchCount.toLocaleString("en")}${matches.capped ? "+" : ""}` : "0 found") : ""}
                    </span>
                    {(
                      [
                        ["caseSensitive", CaseSensitive, "Match case"],
                        ["wholeWord", WholeWord, "Whole words"],
                        ["regex", Regex, "Regular expression"],
                      ] as const
                    ).map(([key, Icon, label]) => (
                      <button
                        key={key}
                        type="button"
                        aria-pressed={opts[key]}
                        title={label}
                        aria-label={label}
                        onClick={() => setOpts((o) => ({ ...o, [key]: !o[key] }))}
                        className={cn("mr-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-sm", opts[key] ? "bg-ink text-paper" : "text-ink-3 hover:bg-paper-2 hover:text-ink")}
                      >
                        <Icon aria-hidden className="size-4" />
                      </button>
                    ))}
                  </div>
                  <ToolButton icon={ChevronUp} label="Previous match" onClick={() => goMatch(-1)} disabled={!matchCount} shortcut="Shift+Enter" />
                  <ToolButton icon={ChevronDown} label="Next match" onClick={() => goMatch(1)} disabled={!matchCount} shortcut="Enter" />
                  <form
                    className="flex h-9 items-center rounded-[8px] border border-line bg-surface focus-within:border-ink"
                    onSubmit={(e) => {
                      e.preventDefault();
                      doGoto();
                    }}
                  >
                    <CornerDownRight aria-hidden className="ml-2 size-4 text-ink-3" />
                    <input
                      value={gotoLine}
                      onChange={(e) => setGotoLine(e.target.value.replace(/\D/g, ""))}
                      inputMode="numeric"
                      placeholder="Line"
                      aria-label={`Go to line (1 to ${lineCount})`}
                      className="h-full w-16 bg-transparent px-2 font-mono text-[13px] text-ink outline-none placeholder:text-ink-3"
                    />
                  </form>
                  <ToolButton icon={X} label="Close find" onClick={() => setFindOpen(false)} shortcut="Esc" />
                </div>
                {finderError && <p className="font-mono text-[12px] text-danger">{finderError}</p>}
                {replaceOpen && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <div className="flex h-9 min-w-0 flex-1 basis-56 items-center rounded-[8px] border border-line bg-surface pl-2.5 focus-within:border-ink">
                      <Replace aria-hidden className="size-4 shrink-0 text-ink-3" />
                      <input
                        value={replacement}
                        onChange={(e) => setReplacement(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            replaceOne();
                          }
                        }}
                        placeholder={opts.regex ? "Replace with ($1 for groups)" : "Replace with"}
                        aria-label="Replace with"
                        spellCheck={false}
                        className="h-full min-w-0 flex-1 bg-transparent px-2 font-mono text-[13px] text-ink outline-none placeholder:text-ink-3"
                      />
                    </div>
                    {!opts.regex && (
                      <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 px-1 text-[13px] text-ink-2" title="FOX → CAT, Fox → Cat">
                        <input type="checkbox" checked={keepCaps} onChange={(e) => setKeepCaps(e.target.checked)} className="size-4 accent-[var(--color-ink)]" />
                        Keep capitals
                      </label>
                    )}
                    <button
                      type="button"
                      onClick={replaceOne}
                      disabled={!matchCount}
                      className="inline-flex h-9 items-center rounded-[8px] border border-line bg-surface px-3 text-[13px] text-ink hover:border-ink-3 disabled:opacity-40"
                    >
                      Replace
                    </button>
                    <button
                      type="button"
                      onClick={replaceEvery}
                      disabled={!matchCount}
                      className="inline-flex h-9 items-center rounded-[8px] bg-ink px-3 text-[13px] font-medium text-paper hover:bg-ink/90 disabled:opacity-40"
                    >
                      Replace all{matchCount ? ` ${matchCount.toLocaleString("en")}` : ""}
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="grid @4xl:grid-cols-[minmax(0,1fr)_340px]">
          {/* Editor */}
          <div className="min-w-0 @4xl:border-r @4xl:border-line">
            <div
              className={cn("relative flex h-[520px] min-h-[260px] resize-y overflow-hidden bg-surface", dragging && "outline-2 -outline-offset-4 outline-dashed outline-accent")}
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes("Files")) {
                  e.preventDefault();
                  setDragging(true);
                }
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                if (!e.dataTransfer.files.length) return;
                e.preventDefault();
                setDragging(false);
                void loadFiles(e.dataTransfer.files);
              }}
            >
              {!wrap && (
                <pre
                  ref={gutterRef}
                  aria-hidden
                  className="shrink-0 select-none overflow-hidden border-r border-line bg-paper px-2.5 py-3 text-right font-mono text-ink-3"
                  style={{ fontSize: size, lineHeight: 1.6, minWidth: `${String(lineCount).length + 2}ch` }}
                >
                  {gutter}
                </pre>
              )}
              <div className="relative min-w-0 flex-1">
                <div
                  ref={mirrorRef}
                  aria-hidden
                  className={cn(
                    "pointer-events-none absolute inset-0 overflow-hidden px-4 pb-10 pt-3 font-mono text-transparent",
                    wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre",
                  )}
                  style={{ fontSize: size, lineHeight: 1.6, scrollbarGutter: "stable", overflowWrap: wrap ? "anywhere" : undefined }}
                >
                  {mirror}
                  {" "}
                </div>
                <textarea
                  ref={taRef}
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                    setFlash(null);
                    setExported(false);
                  }}
                  onSelect={readSel}
                  onKeyUp={readSel}
                  onClick={readSel}
                  onScroll={syncScroll}
                  wrap={wrap ? "soft" : "off"}
                  spellCheck={false}
                  autoCapitalize="off"
                  autoComplete="off"
                  aria-label={`Note: ${titleOf(note)}`}
                  placeholder={"Paste or type anything here: notes, a message, data, code, an AI answer…\n\nThen look right: what's in it, what's wrong with it, and one-click fixes."}
                  data-lenis-prevent
                  className={cn(
                    "absolute inset-0 resize-none overflow-auto bg-transparent px-4 pb-10 pt-3 font-mono text-ink caret-accent outline-none placeholder:text-ink-3 selection:bg-ink/15",
                    wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre",
                  )}
                  style={{ fontSize: size, lineHeight: 1.6, scrollbarGutter: "stable", overflowWrap: wrap ? "anywhere" : undefined }}
                />
              </div>
            </div>

            {/* Status bar */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line bg-paper px-3 py-1.5 font-mono text-[12px] text-ink-3">
              <span>
                Ln {caret.line}, Col {caret.col}
              </span>
              {hasSelection && (
                <span className="text-ink">
                  {[...selected].length.toLocaleString("en")} selected · {selWords} word{selWords === 1 ? "" : "s"}
                </span>
              )}
              <span>{counts.words.toLocaleString("en")} words</span>
              <span>{counts.chars.toLocaleString("en")} chars</span>
              <span>{counts.lines.toLocaleString("en")} lines</span>
              <span className="hidden sm:inline">{formatBytes(counts.bytes)} UTF-8</span>
              <span className="ml-auto">
                {storeFull ? (
                  <span className="text-danger">Too big to keep in this browser: download a copy</span>
                ) : (
                  <span className="inline-flex items-center gap-1">
                    <CheckCircle2 aria-hidden className="size-3.5 text-success" /> Saved in this browser
                  </span>
                )}
              </span>
            </div>

            {/* Transforms */}
            <div className="space-y-2.5 border-t border-line px-3 py-3 @4xl:border-b-0">
              <p className="flex items-center gap-2 text-[13px] text-ink-2">
                <Wand2 aria-hidden className="size-4 text-ink-3" />
                {hasSelection ? (
                  <span>
                    Changes apply to your <strong className="font-medium text-ink">selection</strong> ({[...selected].length.toLocaleString("en")} chars)
                  </span>
                ) : (
                  <span>Changes apply to the whole note (select some text to change only that). Ctrl+Z undoes them.</span>
                )}
              </p>
              {TRANSFORMS.map((g) => (
                <div
                  key={g.group}
                  ref={g.group === "Lines" && start.panel === "lines" ? (el) => el?.scrollIntoView({ block: "center" }) : undefined}
                  className={cn(
                    "flex flex-wrap items-center gap-1.5",
                    g.group === "Lines" && start.panel === "lines" && "-mx-1.5 rounded-md bg-accent/5 px-1.5 py-1.5 ring-1 ring-accent/30",
                  )}
                >
                  <span className="label-mono w-16 shrink-0 text-ink-3">{g.group}</span>
                  {g.items.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => runTransform(t.id)}
                      disabled={nothing}
                      className="inline-flex h-7 items-center rounded-sm border border-line bg-surface px-2 text-[12px] text-ink-2 transition-colors hover:border-ink-3 hover:text-ink disabled:opacity-40"
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>

          {/* Inspector */}
          <aside aria-label="Inspector" className="min-w-0 border-t border-line @4xl:border-t-0">
            <div role="tablist" aria-label="Inspector" className="grid grid-cols-4 border-b border-line bg-paper">
              {(
                [
                  ["overview", "Overview", null],
                  ["found", "Found", foundTotal],
                  ["issues", "Issues", issues.length],
                  ["words", "Words", null],
                ] as const
              ).map(([id, label, n]) => (
                <button
                  key={id}
                  role="tab"
                  type="button"
                  aria-selected={tab === id}
                  onClick={() => setTab(id)}
                  className={cn(
                    "-mb-px flex h-10 items-center justify-center gap-1 border-b text-[13px] transition-colors",
                    tab === id ? "border-ink font-medium text-ink" : "border-transparent text-ink-3 hover:text-ink",
                  )}
                >
                  {label}
                  {n ? (
                    <span className={cn("rounded-sm px-1 font-mono text-[12px]", id === "issues" ? "bg-accent/10 text-accent" : "bg-paper-2 text-ink-2")}>{n > 99 ? "99+" : n}</span>
                  ) : null}
                </button>
              ))}
            </div>

            <div className="max-h-[720px] overflow-y-auto overscroll-contain p-3" data-lenis-prevent>
              {nothing ? (
                <div className="space-y-2 py-6 text-center">
                  <p className="text-sm text-ink-2">Paste or type something to inspect it.</p>
                  <p className="text-[13px] text-ink-3">Or drop a .txt, .md, .csv or .json file onto the editor.</p>
                </div>
              ) : tab === "overview" ? (
                <div className="space-y-3">
                  <div className={cn("rounded-md border px-3 py-2.5", format.error ? "border-danger/40 bg-danger/5" : "border-line bg-paper")}>
                    <p className="label-mono text-ink-3">Looks like</p>
                    <p className="mt-1 flex items-center gap-2 text-sm font-medium text-ink">
                      <Braces aria-hidden className="size-4 text-ink-3" />
                      {format.label}
                      {format.error ? <span className="font-normal text-danger">· invalid</span> : null}
                    </p>
                    {format.detail && <p className="mt-0.5 text-[13px] text-ink-2">{format.detail}</p>}
                    {format.error && (
                      <div className="mt-1 space-y-1.5">
                        <p className="text-[13px] text-ink-2">{format.error.message}</p>
                        {format.error.index !== undefined && (
                          <button type="button" onClick={() => jump({ start: format.error!.index!, end: format.error!.index! + 1 })} className="text-[13px] font-medium text-ink underline underline-offset-2">
                            Show me where
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line">
                    {(
                      [
                        ["Words", counts.words],
                        ["Unique words", counts.unique],
                        ["Characters", counts.chars],
                        ["No spaces", counts.charsNoSpaces],
                        ["Sentences", counts.sentences],
                        ["Paragraphs", counts.paragraphs],
                        ["Lines", counts.lines],
                        ["Blank lines", counts.blankLines],
                        ["Longest line", counts.longestLine],
                        ["Non-ASCII", counts.nonAscii],
                        ["Emoji", counts.emoji],
                        ["Reading time", counts.readingTime],
                      ] as const
                    ).map(([k, v]) => (
                      <div key={k} className="bg-surface px-3 py-2">
                        <dt className="text-[12px] text-ink-3">{k}</dt>
                        <dd className="font-mono text-[15px] text-ink">{typeof v === "number" ? v.toLocaleString("en") : v}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="text-[12px] text-ink-3">Size: {formatBytes(counts.bytes)} as UTF-8.</p>
                </div>
              ) : tab === "found" ? (
                found.length === 0 ? (
                  <p className="py-6 text-center text-[13px] text-ink-3">No emails, links, phone numbers, dates, numbers, hashtags or mentions found.</p>
                ) : (
                  <div className="space-y-4">
                    {found.map((f) => {
                      const Icon = EXTRACT_ICONS[f.kind];
                      const summary = f.kind === "numbers" ? numberSummary(f.items) : null;
                      return (
                        <section key={f.kind} className="@container">
                          <div className="mb-1.5 flex items-center justify-between gap-2">
                            <h3 className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
                              <Icon aria-hidden className="size-4 text-ink-3" />
                              {f.label}
                              <span className="font-mono text-[12px] font-normal text-ink-3">{f.items.length}</span>
                            </h3>
                            <CopyButton text={f.items.map((i) => i.value).join("\n")} label="Copy" />
                          </div>
                          {summary && (
                            <p className="mb-1.5 rounded-sm bg-paper px-2 py-1 font-mono text-[12px] text-ink-2">
                              Sum {summary.sum.toLocaleString("en")} · Avg {summary.mean.toLocaleString("en")} · Min {summary.min.toLocaleString("en")} · Max {summary.max.toLocaleString("en")}
                            </p>
                          )}
                          <ul className="divide-y divide-line overflow-hidden rounded-md border border-line">
                            {f.items.slice(0, 50).map((i) => (
                              <li key={i.value}>
                                <button
                                  type="button"
                                  onClick={() => jump({ start: i.index, end: i.index + i.value.length })}
                                  title="Show it in the note"
                                  className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left hover:bg-paper"
                                >
                                  <span className="min-w-0 truncate font-mono text-[12px] text-ink">{i.value}</span>
                                  {i.count > 1 && <span className="shrink-0 font-mono text-[12px] text-ink-3">×{i.count}</span>}
                                </button>
                              </li>
                            ))}
                          </ul>
                          {f.items.length > 50 && <p className="mt-1 text-[12px] text-ink-3">+{f.items.length - 50} more (Copy gets them all)</p>}
                        </section>
                      );
                    })}
                  </div>
                )
              ) : tab === "issues" ? (
                issues.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-6 text-center">
                    <CheckCircle2 aria-hidden className="size-6 text-success" />
                    <p className="text-sm text-ink">Nothing to fix.</p>
                    <p className="text-[13px] text-ink-3">No hidden characters, stray spaces, repeats or broken brackets.</p>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {fixable.length > 1 && (
                      <button
                        type="button"
                        onClick={fixAll}
                        className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-[8px] bg-ink px-3 text-[13px] font-medium text-paper hover:bg-ink/90"
                      >
                        <Wand2 aria-hidden className="size-4" /> Fix all {fixable.length}
                      </button>
                    )}
                    <ul className="space-y-2">
                      {issues.map((i) => (
                        <li key={i.id} className="rounded-md border border-line bg-surface px-3 py-2.5">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
                                <span className={cn("size-1.5 shrink-0 rounded-full", i.severity === "fix" ? "bg-accent" : "bg-ink-3")} aria-hidden />
                                {i.label}
                                <span className="font-mono text-[12px] font-normal text-ink-3">{i.count.toLocaleString("en")}</span>
                              </p>
                              <p className="mt-0.5 text-[12px] leading-relaxed text-ink-3">{i.detail}</p>
                            </div>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {i.at && (
                              <button type="button" onClick={() => jump(i.at!)} className="inline-flex h-7 items-center rounded-sm border border-line px-2 text-[12px] text-ink-2 hover:border-ink-3 hover:text-ink">
                                Show
                              </button>
                            )}
                            {i.fix && (
                              <button
                                type="button"
                                onClick={() => fixIssue(i.fix!, `${i.fixLabel ?? "Fixed"}: ${i.label.toLowerCase()}`)}
                                className="inline-flex h-7 items-center rounded-sm border border-ink bg-ink px-2 text-[12px] text-paper hover:bg-ink/90"
                              >
                                {i.fixLabel ?? "Fix"}
                              </button>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                    <p className="text-[12px] text-ink-3">Hidden characters show as red bars in the editor; odd spaces are shaded.</p>
                  </div>
                )
              ) : (
                <div className="space-y-3">
                  <Toggle checked={skipCommon} onChange={setSkipCommon} label="Skip common words" description="the, and, of, numbers…" />
                  {words.length === 0 ? (
                    <p className="py-4 text-center text-[13px] text-ink-3">No words yet.</p>
                  ) : (
                    <ol className="space-y-1">
                      {words.map((w) => (
                        <li key={w.word}>
                          <button
                            type="button"
                            onClick={() => searchFor(w.word)}
                            title={`Find “${w.word}”`}
                            className="group relative flex h-7 w-full items-center justify-between overflow-hidden rounded-sm px-2 text-left hover:bg-paper"
                          >
                            <span
                              aria-hidden
                              className="absolute inset-y-1 left-0 rounded-r-sm bg-accent/10 transition-colors group-hover:bg-accent/20"
                              style={{ width: `${Math.max(4, (w.count / words[0].count) * 100)}%` }}
                            />
                            <span className="relative truncate text-[13px] text-ink">{w.word}</span>
                            <span className="relative font-mono text-[12px] text-ink-3">{w.count}</span>
                          </button>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>

      {/* Toast */}
      <div className="pointer-events-none fixed inset-x-0 bottom-5 z-50 flex justify-center px-4" aria-live="polite">
        <AnimatePresence>
          {toast && (
            <motion.div
              key={toast.text}
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.2 }}
              className={cn(
                "pointer-events-auto flex max-w-md items-center gap-3 rounded-md border px-3.5 py-2.5 text-[13px] shadow-float",
                toast.tone === "warn" ? "border-warning/40 bg-surface text-ink" : "border-ink bg-ink text-paper",
              )}
            >
              <span>{toast.text}</span>
              {toast.undo && closed && (
                <button
                  type="button"
                  onClick={() => {
                    toast.undo!();
                    setToast(null);
                  }}
                  className="font-medium underline underline-offset-2"
                >
                  Undo
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Workbench>
  );
}
