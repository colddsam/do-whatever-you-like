"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Bold,
  Code,
  Columns2,
  Download,
  Eye,
  FileCode,
  FileDown,
  FileText,
  FolderOpen,
  Heading,
  Image as ImageIcon,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  ListTree,
  Minus,
  PenLine,
  Printer,
  Quote,
  SquareCode,
  Strikethrough,
  Table,
  type LucideIcon,
} from "lucide-react";
import type { EditorView } from "@codemirror/view";
import Link from "next/link";
import { saveBlob } from "@/lib/files";
import { proseCss, rawUrl, renderMarkdown, renderMermaid, standaloneHtml, stats, type Heading as Head } from "@/lib/utilities/markdown";
import { cn } from "@/lib/utils";
import { Notice } from "../pdf/kit";
import { CopyButton } from "../dev/parts";
import { CodeArea } from "./code-engines";
import type { EngineProps } from "./text-engines";
import "katex/dist/katex.min.css";
import "./markdown.css";

type Mode = "edit" | "split" | "preview";

const SAMPLE = `# Project Aurora

A **Markdown** editor and viewer that runs in your browser. Edit on the left, see it on the right.

## What it handles

- GitHub-flavoured Markdown: **bold**, _italic_, ~~strikethrough~~, \`inline code\`, [links](https://commonmark.org)
- Task lists
  - [x] Write the spec
  - [ ] Ship it
- Tables, footnotes[^1], quotes and code with highlighting

| Feature | Status | Notes |
| :-- | :-: | --: |
| Live preview | ✅ | As you type |
| Export | ✅ | .md, .html, PDF |
| Diagrams | ✅ | Mermaid |

> Simplicity is prerequisite for reliability. — Edsger W. Dijkstra

\`\`\`ts
export function greet(name: string): string {
  return \`Hello, \${name}!\`;
}
\`\`\`

## Maths

Inline $E = mc^2$, and on its own line:

$$
\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}
$$

## A diagram

\`\`\`mermaid
flowchart LR
  A[Write] --> B{Looks right?}
  B -- Yes --> C[Export]
  B -- No --> A
\`\`\`

---

[^1]: Footnotes collect at the end of the document.
`;

const store = {
  get(k: string) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* private mode: not saved */
    }
  },
};

/* ---------- editing commands ---------- */

type Cmd = (view: EditorView) => Promise<void>;

/** Wraps each selection in `before`/`after` (or unwraps it if it's already wrapped). */
const wrap =
  (before: string, after = before, placeholder = "text"): Cmd =>
  async (view) => {
    const { EditorSelection } = await import("@codemirror/state");
    view.dispatch(
      view.state.changeByRange((r) => {
        const sel = view.state.sliceDoc(r.from, r.to);
        const pre = view.state.sliceDoc(r.from - before.length, r.from);
        const post = view.state.sliceDoc(r.to, r.to + after.length);
        if (sel && pre === before && post === after) {
          return { changes: [{ from: r.from - before.length, to: r.from, insert: "" }, { from: r.to, to: r.to + after.length, insert: "" }], range: EditorSelection.range(r.from - before.length, r.to - before.length) };
        }
        const text = sel || placeholder;
        return { changes: { from: r.from, to: r.to, insert: before + text + after }, range: EditorSelection.range(r.from + before.length, r.from + before.length + text.length) };
      }),
    );
    view.focus();
  };

/** Puts `prefix` at the start of every selected line (or takes it off if all have it). */
const linePrefix =
  (prefix: (i: number) => string, match: RegExp): Cmd =>
  async (view) => {
    const changes: { from: number; to?: number; insert: string }[] = [];
    const lines = new Set<number>();
    for (const r of view.state.selection.ranges) for (let l = view.state.doc.lineAt(r.from).number; l <= view.state.doc.lineAt(r.to).number; l++) lines.add(l);
    const list = [...lines].map((n) => view.state.doc.line(n));
    const all = list.every((l) => match.test(l.text));
    list.forEach((l, i) => {
      const m = match.exec(l.text);
      if (all && m) changes.push({ from: l.from, to: l.from + m[0].length, insert: "" });
      else changes.push({ from: l.from, to: l.from + (m?.[0].length ?? 0), insert: prefix(i) });
    });
    view.dispatch({ changes });
    view.focus();
  };

/** Inserts a block on its own lines at the cursor, with `select` (a part of it) selected. */
const block =
  (text: string, select?: string): Cmd =>
  async (view) => {
    const { EditorSelection } = await import("@codemirror/state");
    const r = view.state.selection.main;
    const line = view.state.doc.lineAt(r.from);
    const lead = line.text.trim() ? "\n\n" : line.number > 1 && view.state.doc.line(line.number - 1).text.trim() ? "\n" : "";
    const insert = `${lead}${text}\n`;
    const at = r.to;
    const offset = select ? insert.indexOf(select) : insert.length;
    view.dispatch({ changes: { from: at, to: at, insert }, selection: select ? EditorSelection.range(at + offset, at + offset + select.length) : EditorSelection.cursor(at + insert.length) });
    view.focus();
  };

const TOOLS: ({ label: string; icon: LucideIcon; run: Cmd; keys?: string } | "|")[] = [
  { label: "Heading", icon: Heading, run: linePrefix(() => "## ", /^#{1,6}\s/) },
  { label: "Bold", icon: Bold, run: wrap("**"), keys: "Ctrl+B" },
  { label: "Italic", icon: Italic, run: wrap("_"), keys: "Ctrl+I" },
  { label: "Strikethrough", icon: Strikethrough, run: wrap("~~") },
  "|",
  { label: "Link", icon: Link2, run: wrap("[", "](https://)", "link text"), keys: "Ctrl+K" },
  { label: "Image", icon: ImageIcon, run: wrap("![", "](https://)", "alt text") },
  { label: "Inline code", icon: Code, run: wrap("`", "`", "code") },
  { label: "Code block", icon: SquareCode, run: block("```js\nconsole.log('hello');\n```", "console.log('hello');") },
  "|",
  { label: "Quote", icon: Quote, run: linePrefix(() => "> ", /^>\s?/) },
  { label: "Bulleted list", icon: List, run: linePrefix(() => "- ", /^[-*+]\s(?!\[[ x]\])/) },
  { label: "Numbered list", icon: ListOrdered, run: linePrefix((i) => `${i + 1}. `, /^\d+\.\s/) },
  { label: "Task list", icon: ListChecks, run: linePrefix(() => "- [ ] ", /^[-*+]\s\[[ x]\]\s/) },
  { label: "Table", icon: Table, run: block("| Column | Column |\n| --- | --- |\n| Cell | Cell |", "Column") },
  { label: "Divider", icon: Minus, run: block("---") },
];

/* ---------- engine ---------- */

export function MarkdownEngine({ preset }: EngineProps) {
  const viewer = preset.mode === "preview";
  const key = viewer ? "dw:markdown-viewer" : "dw:markdown-editor";
  const [doc, setDoc] = useState(SAMPLE);
  const [name, setName] = useState("document.md");
  const [mode, setMode] = useState<Mode>(viewer ? "preview" : "split");
  const [outline, setOutline] = useState(false);
  const [rendered, setRendered] = useState<{ html: string; headings: Head[]; hasMath: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setNarrow(e.contentRect.width < 576));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const view = useRef<EditorView | null>(null);
  const preview = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const syncing = useRef<"editor" | "preview" | null>(null);
  const loaded = useRef(false);
  const deferred = useDeferredValue(doc);

  // Restore the last document (each page keeps its own), then save as you type.
  useEffect(() => {
    const saved = store.get(key);
    if (saved) {
      try {
        const s = JSON.parse(saved) as { doc: string; name: string };
        queueMicrotask(() => {
          setDoc(s.doc);
          setName(s.name || "document.md");
        });
      } catch {
        /* ignore */
      }
    }
    loaded.current = true;
  }, [key]);
  useEffect(() => {
    if (!loaded.current) return;
    const t = setTimeout(() => store.set(key, JSON.stringify({ doc, name })), 400);
    return () => clearTimeout(t);
  }, [doc, name, key]);

  // Render (debounced), then draw diagrams into the sanitised HTML.
  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      try {
        const r = await renderMarkdown(deferred);
        if (live) {
          setRendered(r);
          setError(null);
        }
      } catch (e) {
        if (live) setError((e as Error).message);
      }
    }, 120);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [deferred]);
  useEffect(() => {
    if (preview.current && rendered) void renderMermaid(preview.current, false);
  }, [rendered, mode, narrow]);

  /* Scroll sync: the editor and the preview follow each other by position. */
  const onEditorScroll = useCallback(() => {
    const ed = view.current?.scrollDOM;
    const pv = preview.current;
    if (!ed || !pv || syncing.current === "preview") return;
    syncing.current = "editor";
    follow(ed, pv);
    requestAnimationFrame(() => (syncing.current = null));
  }, []);
  const onPreviewScroll = () => {
    const ed = view.current?.scrollDOM;
    const pv = preview.current;
    if (!ed || !pv || syncing.current === "editor") return;
    syncing.current = "preview";
    follow(pv, ed);
    requestAnimationFrame(() => (syncing.current = null));
  };
  const onReady = useCallback(
    (v: EditorView) => {
      view.current = v;
      v.scrollDOM.addEventListener("scroll", onEditorScroll, { passive: true });
    },
    [onEditorScroll],
  );

  const run = (cmd: Cmd) => {
    if (view.current) void cmd(view.current);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    const tool = TOOLS.find((t) => t !== "|" && t.keys === `Ctrl+${k.toUpperCase()}`);
    if (tool && tool !== "|") {
      e.preventDefault();
      run(tool.run);
    }
  };

  /* Files in and out */
  const openText = (text: string, filename: string) => {
    setDoc(text);
    setName(/\.(md|markdown|mdx|txt)$/i.test(filename) ? filename : `${filename.replace(/\.[^.]+$/, "")}.md`);
    if (viewer) setMode("preview");
    preview.current?.scrollTo({ top: 0 });
  };
  const openFile = async (file: File) => {
    if (file.size > 5 * 1024 * 1024) return setNotice("That file is over 5 MB. Markdown files are usually far smaller; is it the right file?");
    if (!/\.(md|markdown|mdown|mkd|mdx|txt|text)$/i.test(file.name) && file.type && !file.type.startsWith("text/")) return setNotice("That doesn't look like a Markdown or text file.");
    setNotice(null);
    openText(await file.text(), file.name);
  };
  const openLink = async () => {
    const url = rawUrl(link);
    if (!/^https?:\/\//i.test(url)) return setNotice("Paste a full link that starts with https://");
    setLoading(true);
    setNotice(null);
    try {
      const res = await fetch(url, { headers: { Accept: "text/markdown, text/plain, */*" } });
      if (!res.ok) throw new Error(res.status === 404 ? "That file wasn't found (404)." : `The site answered ${res.status}.`);
      const len = Number(res.headers.get("content-length") ?? 0);
      if (len > 5 * 1024 * 1024) throw new Error("That file is over 5 MB.");
      const text = await res.text();
      if (/^\s*<!doctype html|^\s*<html/i.test(text)) throw new Error("That link is a web page, not a Markdown file. For GitHub, use the file's link; it's converted to the raw file for you.");
      openText(text, decodeURIComponent(new URL(url).pathname.split("/").pop() || "document.md"));
      setLink("");
    } catch (e) {
      setNotice(e instanceof TypeError ? "That site doesn't let other pages read its files. Download the file and open it here instead. (GitHub, GitLab and Gist links work.)" : (e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const title = rendered?.headings[0]?.text || name.replace(/\.[^.]+$/, "");
  const exportHtml = () => standaloneHtml(title, preview.current?.innerHTML ?? rendered?.html ?? "", proseCss(), Boolean(rendered?.hasMath));
  const download = (kind: "md" | "html") => {
    const base = name.replace(/\.[^.]+$/, "") || "document";
    if (kind === "md") saveBlob(new Blob([doc], { type: "text/markdown;charset=utf-8" }), `${base}.md`);
    else saveBlob(new Blob([exportHtml()], { type: "text/html;charset=utf-8" }), `${base}.html`);
  };
  const print = () => {
    // A hidden frame with the clean, standalone page: the browser's print dialog saves it as PDF.
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
    frame.srcdoc = exportHtml();
    frame.onload = () => {
      const w = frame.contentWindow;
      if (!w) return;
      // Fonts and images settle first, so the PDF isn't missing anything.
      setTimeout(() => {
        w.focus();
        w.print();
        setTimeout(() => frame.remove(), 60_000);
      }, 400);
    };
    document.body.appendChild(frame);
  };

  const s = useMemo(() => stats(doc), [doc]);
  // Side by side needs room: on narrow screens Split shows the editor, with Preview one tap away.
  const shown: Mode = narrow && mode === "split" ? "edit" : mode;
  const showEditor = shown !== "preview";
  const showPreview = shown !== "edit";

  return (
    <div
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDrag(true);
        }
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const f = e.dataTransfer.files[0];
        if (f) void openFile(f);
      }}
      ref={root}
      className="relative grid gap-3"
    >
      {/* Open a document */}
      <div className="flex flex-col gap-2 rounded-md border border-dashed border-line px-3 py-3 @2xl:flex-row @2xl:items-center">
        <input ref={fileInput} type="file" accept=".md,.markdown,.mdown,.mkd,.mdx,.txt,text/markdown,text/plain" className="sr-only" onChange={(e) => (e.target.files?.[0] && void openFile(e.target.files[0]), (e.target.value = ""))} />
        <button type="button" onClick={() => fileInput.current?.click()} className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-md bg-ink px-4 text-sm font-medium text-paper transition-[opacity,transform] hover:opacity-90 active:scale-[0.98]">
          <FolderOpen aria-hidden className="size-4" />
          Open a .md file
        </button>
        <span className="hidden text-xs text-ink-3 @2xl:inline">or drop one here, or</span>
        <form
          className="flex min-w-0 flex-1 gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void openLink();
          }}
        >
          <input
            type="url"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="Paste a link: github.com/user/repo/blob/main/README.md"
            aria-label="Link to a Markdown file"
            className="h-10 min-w-0 flex-1 rounded-md border border-line bg-surface px-3 font-mono text-[13px] text-ink outline-none placeholder:font-sans placeholder:text-ink-3 focus:border-ink"
          />
          <button type="submit" disabled={!link.trim() || loading} className="inline-flex h-10 shrink-0 items-center rounded-md border border-line bg-surface px-3.5 text-sm font-medium text-ink hover:border-ink-3 disabled:opacity-40">
            {loading ? "Loading…" : "Load"}
          </button>
        </form>
      </div>
      {notice && <Notice tone="warning">{notice}</Notice>}

      <div className="overflow-hidden rounded-md border border-line bg-surface">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-line bg-paper px-2 py-1.5">
          <div role="tablist" aria-label="View" className="flex rounded-[9px] border border-line bg-surface p-0.5">
            {(
              [
                { id: "edit", label: "Edit", icon: PenLine },
                { id: "split", label: "Split", icon: Columns2 },
                { id: "preview", label: "Preview", icon: Eye },
              ] as const
            ).map((m) => (
              <button
                key={m.id}
                type="button"
                role="tab"
                aria-selected={shown === m.id}
                onClick={() => setMode(m.id)}
                className={cn("relative h-7 items-center gap-1.5 rounded-[7px] px-2.5 text-[13px] transition-colors", m.id === "split" ? "hidden @xl:inline-flex" : "inline-flex", shown === m.id ? "text-paper" : "text-ink-2 hover:text-ink")}
              >
                {shown === m.id && <motion.span layoutId="md-mode" aria-hidden className="absolute inset-0 rounded-[7px] bg-ink" transition={{ type: "spring", bounce: 0.2, duration: 0.4 }} />}
                <m.icon aria-hidden className="relative size-3.5" />
                <span className="relative">{m.label}</span>
              </button>
            ))}
          </div>
          {showEditor && (
            <div role="toolbar" aria-label="Formatting" className="flex flex-wrap items-center">
              {TOOLS.map((t, i) =>
                t === "|" ? (
                  <span key={i} aria-hidden className="mx-1 h-5 w-px bg-line" />
                ) : (
                  <button key={t.label} type="button" title={t.keys ? `${t.label} (${t.keys})` : t.label} aria-label={t.label} onClick={() => run(t.run)} className="inline-flex size-8 items-center justify-center rounded-[7px] text-ink-2 transition-colors hover:bg-paper-2 hover:text-ink">
                    <t.icon aria-hidden className="size-4" />
                  </button>
                ),
              )}
            </div>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-1">
            {showPreview && (
              <button type="button" onClick={() => setOutline((o) => !o)} aria-pressed={outline} title="Outline" className={cn("inline-flex h-8 items-center gap-1.5 rounded-[8px] px-2 text-[13px] hover:bg-paper-2", outline ? "text-ink" : "text-ink-2")}>
                <ListTree aria-hidden className="size-4" />
                <span className="hidden @xl:inline">Outline</span>
              </button>
            )}
            <CopyButton text={doc} label="Copy" />
          </div>
        </div>

        {/* Editor and preview */}
        <div className={cn("grid", shown === "split" && "grid-cols-2")}>
          <div className={cn("min-w-0", !showEditor && "hidden", shown === "split" && "border-r border-line")} onKeyDownCapture={onKeyDown}>
            <CodeArea value={doc} onChange={setDoc} language="Markdown" wrap onReady={onReady} className="h-[560px]" />
          </div>
          <div className={cn("relative min-w-0", !showPreview && "hidden")}>
            <AnimatePresence>
              {outline && rendered && (
                <motion.nav
                  aria-label="Outline"
                  initial={{ opacity: 0, x: 12 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 12 }}
                  transition={{ duration: 0.2 }}
                  className="absolute right-3 top-3 z-10 max-h-[calc(100%-24px)] w-60 overflow-auto rounded-md border border-line bg-surface p-2 shadow-float"
                  data-lenis-prevent
                >
                  <p className="label-mono px-2 pb-1 text-ink-3">Outline</p>
                  {rendered.headings.length ? (
                    rendered.headings.map((h) => (
                      <button
                        key={h.id}
                        type="button"
                        onClick={() => {
                          const el = preview.current?.querySelector(`#${CSS.escape(h.id)}`) as HTMLElement | null;
                          if (el && preview.current) preview.current.scrollTo({ top: el.offsetTop - 12, behavior: "smooth" });
                        }}
                        className="block w-full truncate rounded-[6px] py-1 pr-2 text-left text-[13px] text-ink-2 hover:bg-paper-2 hover:text-ink"
                        style={{ paddingLeft: 8 + (h.level - 1) * 12 }}
                      >
                        {h.text}
                      </button>
                    ))
                  ) : (
                    <p className="px-2 py-1 text-[13px] text-ink-3">No headings yet.</p>
                  )}
                </motion.nav>
              )}
            </AnimatePresence>
            <div
              ref={preview}
              onScroll={onPreviewScroll}
              onClick={(e) => {
                // In-document links (#section, footnotes) scroll the preview, not the page.
                const a = (e.target as HTMLElement).closest("a");
                const href = a?.getAttribute("href");
                if (a && href?.startsWith("#") && preview.current) {
                  e.preventDefault();
                  const el = preview.current.querySelector(`#${CSS.escape(decodeURIComponent(href.slice(1)))}`) as HTMLElement | null;
                  if (el) preview.current.scrollTo({ top: el.offsetTop - 12, behavior: "smooth" });
                }
              }}
              className={cn("md-prose h-[560px] overflow-auto overscroll-contain px-5 py-5 @3xl:px-8", shown === "preview" && "@3xl:px-12")}
              data-lenis-prevent
              // Sanitised by DOMPurify in renderMarkdown.
              dangerouslySetInnerHTML={{ __html: rendered?.html ?? "" }}
            />
            {error && <p className="absolute inset-x-3 bottom-3 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
          </div>
        </div>

        {/* Status */}
        <p className="flex flex-wrap justify-between gap-x-4 gap-y-1 border-t border-line bg-paper px-3 py-1.5 font-mono text-[11px] text-ink-3">
          <span className="truncate">
            {name} · saved in this browser
          </span>
          <span>
            {s.words.toLocaleString("en")} words · {s.chars.toLocaleString("en")} chars · {s.lines} lines · {s.minutes} min read
          </span>
        </p>
      </div>

      {/* Export */}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => download("md")} className="inline-flex h-10 items-center gap-2 rounded-md bg-ink px-4 text-sm font-medium text-paper transition-[opacity,transform] hover:opacity-90 active:scale-[0.98]">
          <Download aria-hidden className="size-4" /> Download .md
        </button>
        <button type="button" onClick={() => download("html")} disabled={!rendered} className="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-surface px-4 text-sm font-medium text-ink hover:border-ink-3 disabled:opacity-40">
          <FileCode aria-hidden className="size-4" /> Download HTML
        </button>
        <button type="button" onClick={print} disabled={!rendered} className="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-surface px-4 text-sm font-medium text-ink hover:border-ink-3 disabled:opacity-40">
          <Printer aria-hidden className="size-4" /> Print or save as PDF
        </button>
        <CopyButton text={rendered ? exportHtmlBody(rendered.html) : ""} label="Copy HTML" className="h-10 px-4" />
        <span className="ml-auto hidden items-center gap-1.5 self-center text-xs text-ink-3 @2xl:inline-flex">
          <FileText aria-hidden className="size-3.5" />
          Need Word or PDF directly? Use the <Link href="/tools/convert-anything" className="underline underline-offset-4 hover:text-ink">universal converter</Link>.
        </span>
      </div>

      {drag && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-md border-2 border-dashed border-ink bg-paper/85 text-sm font-medium text-ink">
          <FileDown aria-hidden className="mr-2 size-5" /> Drop to open
        </div>
      )}
    </div>
  );
}

/** Scrolls `to` to the same relative position as `from`. */
function follow(from: HTMLElement, to: HTMLElement) {
  to.scrollTop = (from.scrollTop / Math.max(1, from.scrollHeight - from.clientHeight)) * (to.scrollHeight - to.clientHeight);
}

/** The HTML for pasting into a CMS or email: the rendered body, without the heading anchors. */
function exportHtmlBody(html: string) {
  return html.replace(/<a class="md-anchor"[^>]*>#<\/a>/g, "");
}
