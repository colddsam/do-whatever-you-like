"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import DOMPurify from "dompurify";
import katex from "katex";
import "katex/dist/katex.min.css";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Baseline,
  Bold,
  BookOpenText,
  CaseSensitive,
  CheckSquare,
  ClipboardPaste,
  Code2,
  Columns2,
  Copy,
  Download,
  FileText,
  Footprints,
  Highlighter,
  Image as ImageIcon,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Languages,
  Link2,
  List,
  ListOrdered,
  ListTree,
  MessageSquarePlus,
  Minus,
  Omega,
  PaintBucket,
  Paintbrush,
  Pilcrow,
  Plus,
  Printer,
  Quote,
  Redo2,
  RemoveFormatting,
  Scissors,
  Search,
  Sigma,
  SpellCheck,
  Square,
  Strikethrough,
  Subscript,
  Superscript,
  Table as TableIcon,
  Trash2,
  Type,
  Underline,
  Undo2,
  Volume2,
  WrapText,
} from "lucide-react";
import { saveBlob, uploadForm } from "@/lib/files";
import { FALLBACK_LANGUAGES, loadCapabilities, type TranslateLanguage } from "@/lib/translate";
import { loadGlossary, smartTranslate, speak, stopSpeaking } from "@/lib/translate-extras";
import { translateHtmlFragment } from "@/lib/translate-docs";
import { cn } from "@/lib/utils";
import { LanguagePicker } from "@/components/tools/text/translator/shared";
import { exportDocx, importDocx } from "./docx";
import { htmlToMarkdown, htmlToText, printDoc, standaloneHtml } from "./export";
import { DEFAULT_PAGE, docCss, MM_TO_PX, PARA_STYLES, pagePx, type PageSetup, type WordDoc } from "./model";
import { WORD_TEMPLATES } from "./templates";
import { lastOpen, loadDoc, newDocId, rememberOpen, saveDoc } from "../shared/store";
import { ColorButton, EditorFrame, ensureFont, FONT_SIZES, FONTS, inputCls, Menu, Modal, Popover, primaryCls, RBreak, RBtn, RGroup, Ribbon, RSelect, secondaryCls, TitleBar, useAutosave } from "../shared/ui";

type Saved = { name: string; doc: WordDoc };
const noop = () => () => {};
let idSeq = 0;
/** Unique ids for headings, comments and footnotes (module-level, so render stays pure). */
const uid = (p: string) => `${p}-${Date.now().toString(36)}${(idSeq++).toString(36)}`;

export function WordEditorEntry() {
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  const [boot, setBoot] = useState<{ id: string; data: Saved } | null>(null);
  useEffect(() => {
    if (!mounted) return;
    const id = lastOpen("word");
    (id ? loadDoc<Saved>(id) : Promise.resolve(null)).then((data) => {
      if (data && id) setBoot({ id, data });
      else setBoot({ id: newDocId(), data: { name: "Document1", doc: WORD_TEMPLATES[0].build() } });
    });
  }, [mounted]);
  if (!boot) return <div aria-hidden className="h-[calc(100dvh-140px)] min-h-[560px] animate-pulse rounded-lg border border-line bg-surface lg:h-[min(86dvh,1100px)]" />;
  return <WordApp key={boot.id} docId={boot.id} initial={boot.data} onSwitch={(id, data) => setBoot({ id, data })} />;
}

// ------------------------------------------------------------------ caret helpers (for custom undo)

function caretOffset(root: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || !root.contains(sel.anchorNode)) return -1;
  const r = sel.getRangeAt(0).cloneRange();
  r.selectNodeContents(root);
  r.setEnd(sel.getRangeAt(0).endContainer, sel.getRangeAt(0).endOffset);
  return r.toString().length;
}

function setCaret(root: HTMLElement, offset: number) {
  if (offset < 0) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let left = offset;
  let n: Node | null;
  while ((n = walker.nextNode())) {
    const len = (n as Text).data.length;
    if (left <= len) {
      const r = document.createRange();
      r.setStart(n, left);
      r.collapse(true);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(r);
      return;
    }
    left -= len;
  }
}

const SYMBOLS = ["©", "®", "™", "°", "±", "×", "÷", "≠", "≈", "≤", "≥", "∞", "√", "∑", "π", "µ", "Ω", "α", "β", "γ", "Δ", "λ", "σ", "€", "£", "¥", "₹", "¢", "§", "¶", "†", "•", "…", "—", "–", "«", "»", "←", "→", "↑", "↓", "⇒", "✓", "✗", "★", "☆", "♥", "☺", "☎", "✉", "⌘"];

const sanitize = (html: string) =>
  DOMPurify.sanitize(html, {
    ALLOWED_ATTR: ["style", "href", "src", "alt", "width", "height", "colspan", "rowspan", "class", "id", "dir", "data-checked", "data-latex", "data-comment", "title", "contenteditable", "data-level", "type", "start", "align"],
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "input", "button", "meta", "link"],
  });

/** Word's clipboard HTML carries mso- styles and <o:p>; keep the useful bits. */
function cleanPastedHtml(html: string): string {
  return sanitize(
    html
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<\/?o:p>/g, "")
      .replace(/\sclass="?Mso[^"\s>]*"?/g, "")
      .replace(/mso-[^:;"]+:[^;"]+;?/g, ""),
  );
}

type Tab = "File" | "Home" | "Insert" | "Layout" | "References" | "Review" | "View" | "Table";

function WordApp({ docId, initial, onSwitch }: { docId: string; initial: Saved; onSwitch: (id: string, data: Saved) => void }) {
  const [name, setName] = useState(initial.name);
  const [page, setPage] = useState<PageSetup>({ ...DEFAULT_PAGE, ...initial.doc.page, margins: { ...DEFAULT_PAGE.margins, ...initial.doc.page.margins } });
  const [html, setHtml] = useState(initial.doc.html);
  const [tab, setTab] = useState<Tab>("Home");
  const [zoom, setZoom] = useState(100);
  const [fit, setFit] = useState(true);
  // Phones open in Web layout (text reflows at full size); pages are one tap away in View.
  const [layout, setLayout] = useState<"print" | "web">(() => (typeof window !== "undefined" && window.innerWidth < 640 ? "web" : "print"));
  const [navOpen, setNavOpen] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [spell, setSpell] = useState(true);
  const [fmt, setFmt] = useState({ bold: false, italic: false, underline: false, strike: false, sub: false, sup: false, block: "p", font: "Calibri", size: 11, align: "left", ul: false, ol: false, inTable: false });
  const [dialog, setDialog] = useState<null | "find" | "link" | "image" | "table" | "equation" | "count" | "translate" | "templates" | "comment" | "footnote" | "watermark" | "margins">(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** The selected text when a dialog was opened (dialogs read it instead of the live selection ref). */
  const [dialogSel, setDialogSel] = useState("");
  const selImgRef = useRef<HTMLImageElement | null>(null);
  const [imgToolbar, setImgToolbar] = useState(false);
  const setSelImg = (img: HTMLImageElement | null) => {
    selImgRef.current = img;
    setImgToolbar(Boolean(img));
  };
  /** Runs an edit on the selected picture as one undo step. */
  const editImg = (f: (img: HTMLImageElement) => void) => {
    const img = selImgRef.current;
    if (!img) return;
    snapshot();
    f(img);
    changed(true);
  };
  const [painter, setPainter] = useState<{ b: boolean; i: boolean; u: boolean; color: string; font: string; size: number } | null>(null);
  const [reading, setReading] = useState(false);
  const [pages, setPages] = useState({ count: 1, current: 1, height: 0 });
  const [outline, setOutline] = useState<{ id: string; level: number; text: string }[]>([]);
  const [comments, setComments] = useState<{ id: string; text: string; quote: string }[]>([]);

  const bodyRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const savedRange = useRef<Range | null>(null);
  const hist = useRef<{ html: string; caret: number }[]>([{ html: initial.doc.html, caret: -1 }]);
  const histIdx = useRef(0);
  const histTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readCtrl = useRef<AbortController | null>(null);

  const data = useMemo(() => ({ name, doc: { html, page } }), [name, html, page]);
  const saveState = useAutosave(data, (d) => saveDoc({ id: docId, app: "word", name: d.name }, d));
  useEffect(() => rememberOpen("word", docId), [docId]);

  const flash = (m: string) => {
    setNotice(m);
    setTimeout(() => setNotice((n) => (n === m ? null : n)), 3500);
  };

  // ---------- meta: pages, outline, comments, stats
  const metaTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshMetaSoon = () => {
    if (metaTimer.current) clearTimeout(metaTimer.current);
    metaTimer.current = setTimeout(refreshMeta, 300);
  };
  const refreshMeta = () => {
    const root = bodyRef.current;
    if (!root) return;
    const ph = pagePx(page).h - (page.margins.top + page.margins.bottom) * MM_TO_PX;
    const height = root.scrollHeight;
    const breaks = root.querySelectorAll(".page-break").length;
    setPages((p) => ({ ...p, count: Math.max(1, Math.ceil(height / ph) + breaks), height }));
    setOutline(
      (Array.from(root.querySelectorAll("h1,h2,h3,h4")) as HTMLElement[]).map((h) => {
        if (!h.id) h.id = uid("h");
        return { id: h.id, level: Number(h.tagName[1]), text: h.textContent ?? "" };
      }),
    );
    setComments(
      (Array.from(root.querySelectorAll(".comment")) as HTMLElement[]).map((c) => {
        if (!c.id) c.id = uid("c");
        return { id: c.id, text: c.dataset.comment ?? "", quote: c.textContent ?? "" };
      }),
    );
  };

  const openWithSelection = (d: NonNullable<typeof dialog>) => {
    keepSelection();
    setDialogSel(savedRange.current && !savedRange.current.collapsed ? savedRange.current.toString() : "");
    setDialog(d);
  };

  // initial content (contentEditable is uncontrolled; React never re-renders its children)
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.innerHTML = sanitize(initial.doc.html);
    document.execCommand("styleWithCSS", false, "true");
    try {
      document.execCommand("defaultParagraphSeparator", false, "p");
    } catch {
      // older browsers
    }
    refreshMeta();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- history (snapshots + caret) so custom edits undo like typing
  const snapshot = useCallback(() => {
    const el = bodyRef.current;
    if (!el) return;
    const h = el.innerHTML;
    if (hist.current[histIdx.current]?.html === h) return;
    hist.current = hist.current.slice(0, histIdx.current + 1);
    hist.current.push({ html: h, caret: caretOffset(el) });
    if (hist.current.length > 300) hist.current.shift();
    histIdx.current = hist.current.length - 1;
  }, []);
  const syncHtml = useCallback(() => {
    const el = bodyRef.current;
    if (el) setHtml(el.innerHTML);
  }, []);
  const changed = useCallback(
    (immediate = false) => {
      normalizeBlocks(bodyRef.current);
      syncHtml();
      if (histTimer.current) clearTimeout(histTimer.current);
      if (immediate) snapshot();
      else histTimer.current = setTimeout(snapshot, 400);
      refreshMetaSoon();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snapshot, syncHtml],
  );
  const restore = (i: number) => {
    const el = bodyRef.current;
    const st = hist.current[i];
    if (!el || !st) return;
    histIdx.current = i;
    el.innerHTML = st.html;
    setHtml(st.html);
    el.focus();
    setCaret(el, st.caret);
    refreshMeta();
  };
  const undo = () => {
    snapshot();
    if (histIdx.current > 0) restore(histIdx.current - 1);
  };
  const redo = () => {
    if (histIdx.current < hist.current.length - 1) restore(histIdx.current + 1);
  };

  // ---------- selection & formatting state
  const keepSelection = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount && bodyRef.current?.contains(sel.anchorNode)) savedRange.current = sel.getRangeAt(0).cloneRange();
  };
  const restoreSelection = () => {
    const el = bodyRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    const r = savedRange.current;
    if (r && el.contains(r.startContainer)) {
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(r);
    }
  };

  const currentBlock = (): HTMLElement | null => {
    const sel = window.getSelection();
    let n: Node | null = sel?.anchorNode ?? null;
    while (n && n !== bodyRef.current) {
      if (n.nodeType === 1 && /^(P|H[1-6]|LI|BLOCKQUOTE|PRE|DIV|TD|TH)$/.test((n as Element).tagName)) return n as HTMLElement;
      n = n.parentNode;
    }
    return null;
  };

  const updateFmt = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !bodyRef.current?.contains(sel.anchorNode)) return;
    keepSelection();
    const anchor = (sel.anchorNode?.nodeType === 3 ? sel.anchorNode.parentElement : (sel.anchorNode as HTMLElement)) as HTMLElement | null;
    const cs = anchor ? getComputedStyle(anchor) : null;
    const blk = currentBlock();
    const tag = blk?.tagName.toLowerCase() ?? "p";
    const block = blk?.classList.contains("doc-title") ? "Title" : blk?.classList.contains("doc-subtitle") ? "Subtitle" : tag === "h1" ? "Heading1" : tag === "h2" ? "Heading2" : tag === "h3" ? "Heading3" : tag === "h4" ? "Heading4" : tag === "blockquote" ? "Quote" : tag === "pre" ? "Code" : "Normal";
    setFmt({
      bold: document.queryCommandState("bold"),
      italic: document.queryCommandState("italic"),
      underline: document.queryCommandState("underline"),
      strike: document.queryCommandState("strikeThrough"),
      sub: document.queryCommandState("subscript"),
      sup: document.queryCommandState("superscript"),
      block,
      font: (cs?.fontFamily.split(",")[0] ?? "Calibri").replace(/["']/g, "").trim(),
      size: cs ? Math.round(parseFloat(cs.fontSize) * 0.75 * 2) / 2 : 11,
      align: cs?.textAlign === "start" ? "left" : (cs?.textAlign ?? "left"),
      ul: document.queryCommandState("insertUnorderedList"),
      ol: document.queryCommandState("insertOrderedList"),
      inTable: Boolean(anchor?.closest("td,th")),
    });
    if (anchor?.closest("td,th") && tab !== "Table") setTab((t) => (t === "Home" ? t : t));
  }, [tab]);

  useEffect(() => {
    const onSel = () => updateFmt();
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, [updateFmt]);

  // ---------- commands
  const exec = (cmd: string, value?: string) => {
    restoreSelection();
    document.execCommand(cmd, false, value);
    changed(true);
    updateFmt();
  };

  const applyBlockStyle = (id: string) => {
    restoreSelection();
    const st = PARA_STYLES.find((s) => s.id === id);
    if (!st) return;
    document.execCommand("formatBlock", false, st.tag);
    const blk = currentBlock();
    if (blk) {
      blk.classList.remove("doc-title", "doc-subtitle");
      if (st.cls) blk.classList.add(st.cls);
      if (/^H[1-6]$/.test(blk.tagName) && !blk.id) blk.id = uid("h");
    }
    changed(true);
    updateFmt();
  };

  /** Applies inline CSS to the selection (font size in pt, letter case…) by wrapping it in spans. */
  const applyInlineStyle = (css: Partial<CSSStyleDeclaration>) => {
    restoreSelection();
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    if (sel.isCollapsed) {
      // style what you type next
      const span = document.createElement("span");
      Object.assign(span.style, css);
      span.textContent = "​";
      sel.getRangeAt(0).insertNode(span);
      const r = document.createRange();
      r.setStart(span.firstChild!, 1);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
      changed(true);
      return;
    }
    // Use the browser's fontSize to split runs, then turn the marker into real CSS.
    document.execCommand("styleWithCSS", false, "false");
    document.execCommand("fontSize", false, "7");
    document.execCommand("styleWithCSS", false, "true");
    bodyRef.current?.querySelectorAll('font[size="7"]').forEach((f) => {
      const span = document.createElement("span");
      Object.assign(span.style, css);
      span.innerHTML = f.innerHTML;
      f.replaceWith(span);
    });
    bodyRef.current?.querySelectorAll('span[style*="xxx-large"]').forEach((s) => {
      (s as HTMLElement).style.fontSize = css.fontSize ?? "";
    });
    changed(true);
    updateFmt();
  };

  const setFontSize = (pt: number) => applyInlineStyle({ fontSize: `${pt}pt` });
  const growFont = (d: number) => {
    const i = FONT_SIZES.findIndex((s) => s >= fmt.size);
    const next = FONT_SIZES[Math.max(0, Math.min(FONT_SIZES.length - 1, (i < 0 ? FONT_SIZES.length - 1 : i) + d))];
    setFontSize(next);
  };

  const changeCase = (mode: "upper" | "lower" | "title" | "sentence") => {
    restoreSelection();
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    const t = sel.toString();
    const out = mode === "upper" ? t.toUpperCase() : mode === "lower" ? t.toLowerCase() : mode === "title" ? t.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, a, b) => a + b.toUpperCase()) : t.toLowerCase().replace(/(^\s*\p{L}|[.!?]\s+\p{L})/gu, (m) => m.toUpperCase());
    document.execCommand("insertText", false, out);
    changed(true);
  };

  const blocksInSelection = (): HTMLElement[] => {
    const sel = window.getSelection();
    const root = bodyRef.current;
    if (!sel || !sel.rangeCount || !root) return [];
    const range = sel.getRangeAt(0);
    const all = Array.from(root.querySelectorAll("p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,td,th")) as HTMLElement[];
    const hits = all.filter((b) => range.intersectsNode(b) && !Array.from(b.querySelectorAll("p,li")).some((c) => range.intersectsNode(c) && c !== b));
    if (!hits.length) {
      const b = currentBlock();
      return b ? [b] : [];
    }
    return hits;
  };

  const setBlockCss = (prop: "lineHeight" | "marginTop" | "marginBottom" | "direction" | "textIndent", value: string) => {
    restoreSelection();
    snapshot();
    blocksInSelection().forEach((b) => (b.style[prop] = value));
    changed(true);
  };

  const insertHtml = (h: string) => {
    restoreSelection();
    document.execCommand("insertHTML", false, h);
    changed(true);
  };

  const insertTable = (rows: number, cols: number) => {
    const head = `<tr>${Array.from({ length: cols }, (_, i) => `<th>Header ${i + 1}</th>`).join("")}</tr>`;
    const body = Array.from({ length: rows - 1 }, () => `<tr>${Array.from({ length: cols }, () => "<td><br></td>").join("")}</tr>`).join("");
    insertHtml(`<table><tbody>${head}${body}</tbody></table><p><br></p>`);
  };

  const tableCell = (): HTMLTableCellElement | null => {
    const sel = window.getSelection();
    const n = sel?.anchorNode;
    const el = (n?.nodeType === 3 ? n.parentElement : (n as HTMLElement)) ?? null;
    return (el?.closest("td,th") as HTMLTableCellElement | null) ?? null;
  };
  const tableOp = (op: "rowAbove" | "rowBelow" | "colLeft" | "colRight" | "delRow" | "delCol" | "delTable" | "header" | "noBorders" | "borders") => {
    restoreSelection();
    const cell = tableCell();
    if (!cell) return flash("Put the cursor in a table first.");
    snapshot();
    const row = cell.parentElement as HTMLTableRowElement;
    const table = cell.closest("table")!;
    const idx = cell.cellIndex;
    const rows = Array.from(table.rows);
    if (op === "rowAbove" || op === "rowBelow") {
      const nr = document.createElement("tr");
      for (let i = 0; i < row.cells.length; i++) nr.appendChild(Object.assign(document.createElement("td"), { innerHTML: "<br>" }));
      row.parentElement!.insertBefore(nr, op === "rowAbove" ? row : row.nextSibling);
    } else if (op === "colLeft" || op === "colRight") {
      rows.forEach((r) => {
        const ref = r.cells[idx];
        const c = document.createElement(ref?.tagName === "TH" ? "th" : "td");
        c.innerHTML = "<br>";
        r.insertBefore(c, op === "colLeft" ? ref ?? null : ref?.nextSibling ?? null);
      });
    } else if (op === "delRow") {
      row.remove();
      if (!table.rows.length) table.remove();
    } else if (op === "delCol") {
      rows.forEach((r) => r.cells[idx]?.remove());
      if (!table.rows[0]?.cells.length) table.remove();
    } else if (op === "delTable") table.remove();
    else if (op === "header") {
      const first = table.rows[0];
      Array.from(first.cells).forEach((c) => {
        const n = document.createElement(c.tagName === "TH" ? "td" : "th");
        n.innerHTML = c.innerHTML;
        c.replaceWith(n);
      });
    } else if (op === "noBorders" || op === "borders") table.querySelectorAll("td,th").forEach((c) => ((c as HTMLElement).style.border = op === "noBorders" ? "1px dashed #ddd" : ""));
    changed(true);
  };

  const shadeCell = (color: string | null) => {
    restoreSelection();
    const cell = tableCell();
    if (!cell) return flash("Put the cursor in a table cell first.");
    snapshot();
    cell.style.backgroundColor = color ?? "";
    changed(true);
  };

  const buildToc = () => {
    const root = bodyRef.current;
    if (!root) return;
    snapshot();
    const heads = Array.from(root.querySelectorAll("h1:not(.doc-title),h2,h3")) as HTMLElement[];
    heads.forEach((h) => {
      if (!h.id) h.id = uid("h");
    });
    const inner = `<p><b>Contents</b></p>${heads.map((h) => `<p data-level="${h.tagName[1]}" style="padding-left:${(Number(h.tagName[1]) - 1) * 18}px"><a href="#${h.id}">${h.textContent?.replace(/</g, "&lt;")}</a></p>`).join("")}`;
    const existing = root.querySelector(".toc");
    if (existing) existing.innerHTML = inner;
    else {
      restoreSelection();
      document.execCommand("insertHTML", false, `<div class="toc" contenteditable="false">${inner}</div><p><br></p>`);
    }
    changed(true);
    flash(heads.length ? `Contents updated (${heads.length} headings).` : "Add some headings (Heading 1–3) first.");
  };

  const insertFootnote = (text: string) => {
    const root = bodyRef.current;
    if (!root || !text) return;
    const n = root.querySelectorAll("sup.fn-ref").length + 1;
    insertHtml(`<sup class="fn-ref"><a href="#fn-${n}" id="fnref-${n}">${n}</a></sup>`);
    let box = root.querySelector(".footnotes");
    if (!box) {
      box = document.createElement("div");
      box.className = "footnotes";
      box.innerHTML = "<ol></ol>";
      root.appendChild(box);
    }
    const li = document.createElement("li");
    li.id = `fn-${n}`;
    li.textContent = text;
    box.querySelector("ol")!.appendChild(li);
    changed(true);
  };

  const addComment = (text: string) => {
    restoreSelection();
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !text) return flash("Select some text to comment on.");
    const span = document.createElement("span");
    span.className = "comment";
    span.dataset.comment = text;
    span.title = text;
    const r = sel.getRangeAt(0);
    try {
      span.appendChild(r.extractContents());
      r.insertNode(span);
    } catch {
      return flash("Comment on text within one paragraph.");
    }
    changed(true);
  };

  const insertEquation = (latex: string) => {
    if (!latex.trim()) return;
    let rendered: string;
    try {
      rendered = katex.renderToString(latex, { throwOnError: true, output: "html" });
    } catch (e) {
      return flash(e instanceof Error ? e.message : "That equation has an error.");
    }
    const esc = latex.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    insertHtml(`<span class="math" contenteditable="false" data-latex="${esc}">${rendered}</span>&nbsp;`);
  };

  const insertImageFile = async (file: File) => {
    if (!file.type.startsWith("image/")) return flash("Choose a picture (PNG, JPG, GIF).");
    const url = await downscale(file, 1600);
    insertHtml(`<img src="${url}" alt="${file.name.replace(/"/g, "")}" style="width:100%;max-width:${Math.min(100, 100)}%">`);
  };

  // ---------- paste
  const onPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const items = Array.from(e.clipboardData.items);
    const img = items.find((i) => i.type.startsWith("image/"));
    if (img) {
      e.preventDefault();
      const f = img.getAsFile();
      if (f) insertImageFile(f);
      return;
    }
    const h = e.clipboardData.getData("text/html");
    if (h) {
      e.preventDefault();
      document.execCommand("insertHTML", false, cleanPastedHtml(h));
      changed(true);
    }
  };
  const pastePlain = async () => {
    try {
      const t = await navigator.clipboard.readText();
      restoreSelection();
      document.execCommand("insertText", false, t);
      changed(true);
    } catch {
      flash("Press Ctrl/⌘+Shift+V to paste as plain text.");
    }
  };

  // ---------- keyboard
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && k === "z" && !e.shiftKey) {
      e.preventDefault();
      return undo();
    }
    if (mod && (k === "y" || (k === "z" && e.shiftKey))) {
      e.preventDefault();
      return redo();
    }
    if (mod && k === "f") {
      e.preventDefault();
      return setDialog("find");
    }
    if (mod && k === "h") {
      e.preventDefault();
      return setDialog("find");
    }
    if (mod && k === "k") {
      e.preventDefault();
      return openWithSelection("link");
    }
    if (mod && k === "p") {
      e.preventDefault();
      return printDoc({ html, page }, name);
    }
    if (mod && k === "s") {
      e.preventDefault();
      return flash("Saved automatically in this browser. File → Download gets you a .docx.");
    }
    if (mod && e.shiftKey && k === "v") {
      e.preventDefault();
      return pastePlain();
    }
    if (mod && k === "enter") {
      e.preventDefault();
      return insertHtml('<div class="page-break" contenteditable="false"></div><p><br></p>');
    }
    if (mod && e.altKey && /^[1-4]$/.test(k)) {
      e.preventDefault();
      return applyBlockStyle(`Heading${k}`);
    }
    if (mod && k === "e") {
      e.preventDefault();
      return exec("justifyCenter");
    }
    if (mod && k === "l") {
      e.preventDefault();
      return exec("justifyLeft");
    }
    if (mod && k === "r") {
      e.preventDefault();
      return exec("justifyRight");
    }
    if (mod && k === "j") {
      e.preventDefault();
      return exec("justifyFull");
    }
    if (mod && k === "=") {
      e.preventDefault();
      return exec(e.shiftKey ? "superscript" : "subscript");
    }
    if (mod && (k === "]" || k === "[")) {
      e.preventDefault();
      return growFont(k === "]" ? 1 : -1);
    }
    if (e.key === "Tab") {
      // Tab moves between table cells, or indents lists
      const cell = tableCell();
      if (cell) {
        e.preventDefault();
        const cells = Array.from(cell.closest("table")!.querySelectorAll("td,th"));
        const next = cells[cells.indexOf(cell) + (e.shiftKey ? -1 : 1)];
        if (next) {
          const r = document.createRange();
          r.selectNodeContents(next);
          r.collapse(false);
          const s = window.getSelection();
          s?.removeAllRanges();
          s?.addRange(r);
        } else if (!e.shiftKey) tableOp("rowBelow");
        return;
      }
      e.preventDefault();
      if (fmt.ul || fmt.ol) return exec(e.shiftKey ? "outdent" : "indent");
      return insertHtml("&emsp;");
    }
    if (mod && ["b", "i", "u"].includes(k)) {
      // native, but record history
      setTimeout(() => changed(true), 0);
    }
    // Markdown-style shortcuts at the start of a paragraph: "# ", "- ", "1. ", "> "
    if (e.key === " ") {
      const blk = currentBlock();
      const t = blk?.textContent ?? "";
      const sel = window.getSelection();
      if (blk && blk.tagName === "P" && sel?.isCollapsed && caretAtEndOf(blk)) {
        const map: Record<string, () => void> = {
          "#": () => applyBlockStyle("Heading1"),
          "##": () => applyBlockStyle("Heading2"),
          "###": () => applyBlockStyle("Heading3"),
          "-": () => exec("insertUnorderedList"),
          "*": () => exec("insertUnorderedList"),
          "1.": () => exec("insertOrderedList"),
          ">": () => applyBlockStyle("Quote"),
          "[]": () => insertHtml('<ul class="checklist"><li data-checked="false"><br></li></ul>'),
        };
        if (map[t]) {
          e.preventDefault();
          // Empty the paragraph, put the caret back inside it and remember that selection, so
          // the command acts on this paragraph (not on the last saved selection).
          blk.innerHTML = "<br>";
          const r = document.createRange();
          r.setStart(blk, 0);
          r.collapse(true);
          sel.removeAllRanges();
          sel.addRange(r);
          keepSelection();
          map[t]();
        }
      }
    }
  };

  const caretAtEndOf = (el: HTMLElement) => {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return false;
    const r = document.createRange();
    r.selectNodeContents(el);
    r.setStart(sel.getRangeAt(0).endContainer, sel.getRangeAt(0).endOffset);
    return r.toString().length === 0;
  };

  // checklist toggling, image selection, links
  const onClickBody = (e: React.MouseEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (t.tagName === "IMG") {
      setSelImg(t as HTMLImageElement);
      return;
    }
    setSelImg(null);
    const li = t.closest("ul.checklist > li") as HTMLElement | null;
    if (li && e.nativeEvent.offsetX < 22) {
      li.dataset.checked = li.dataset.checked === "true" ? "false" : "true";
      changed(true);
    }
    const a = t.closest("a") as HTMLAnchorElement | null;
    if (a && (e.ctrlKey || e.metaKey)) {
      const href = a.getAttribute("href") ?? "";
      if (href.startsWith("#")) document.getElementById(href.slice(1))?.scrollIntoView({ behavior: "smooth" });
      else window.open(href, "_blank", "noopener,noreferrer");
    }
    if (painter) {
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) {
        document.execCommand("removeFormat");
        if (painter.b) document.execCommand("bold");
        if (painter.i) document.execCommand("italic");
        if (painter.u) document.execCommand("underline");
        document.execCommand("foreColor", false, painter.color);
        document.execCommand("fontName", false, painter.font);
        changed(true);
      }
      setPainter(null);
    }
  };

  const stats = useMemo(() => {
    const div = typeof document !== "undefined" ? document.createElement("div") : null;
    if (!div) return { words: 0, chars: 0, charsNoSpace: 0, paras: 0 };
    div.innerHTML = html;
    const text = div.textContent || "";
    // A detached node has no layout, so textContent glues neighbouring blocks and table cells
    // together ("Header 3" + "Hello" → "3Hello"). Count words on a copy with block boundaries spaced.
    div.innerHTML = html.replace(/<\/(p|h[1-6]|li|td|th|div|blockquote|pre|tr|table|ul|ol)>|<br\s*\/?>/gi, "$& ");
    const spaced = div.textContent || "";
    const words = (spaced.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length + (spaced.match(/[぀-ヿ一-鿿]/g) ?? []).length;
    return { words, chars: text.length, charsNoSpace: text.replace(/\s/g, "").length, paras: div.querySelectorAll("p,h1,h2,h3,h4,li,blockquote").length };
  }, [html]);

  // ---------- fit-to-width zoom on small screens
  const [viewW, setViewW] = useState(1000);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewW(el.clientWidth));
    ro.observe(el);
    setViewW(el.clientWidth);
    return () => ro.disconnect();
  }, [fullscreen]);
  const px = pagePx(page);
  const effZoom = layout === "web" ? 1 : fit ? Math.min(zoom / 100, (viewW - 32) / px.w) : zoom / 100;

  // ---------- open / new / download
  const loadInto = (doc: WordDoc, nm: string) => {
    const id = newDocId();
    void saveDoc({ id, app: "word", name: nm }, { name: nm, doc }).then(() => onSwitch(id, { name: nm, doc }));
  };
  const openFile = async (f: File) => {
    const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
    const base = f.name.replace(/\.[^.]+$/, "");
    try {
      if (ext === "docx" || ext === "docm" || ext === "dotx") return loadInto(importDocx(new Uint8Array(await f.arrayBuffer())), base);
      if (ext === "md" || ext === "markdown") {
        const { marked } = await import("marked");
        return loadInto({ html: sanitize(await marked.parse(await f.text())), page: { ...DEFAULT_PAGE } }, base);
      }
      if (ext === "html" || ext === "htm") {
        const d = new DOMParser().parseFromString(await f.text(), "text/html");
        return loadInto({ html: sanitize(d.body.innerHTML), page: { ...DEFAULT_PAGE } }, base);
      }
      if (ext === "txt") {
        const t = await f.text();
        return loadInto({ html: t.split(/\r?\n/).map((l) => `<p>${l.replace(/&/g, "&amp;").replace(/</g, "&lt;") || "<br>"}</p>`).join(""), page: { ...DEFAULT_PAGE } }, base);
      }
      if (["doc", "odt", "rtf", "pdf", "wpd", "pages"].includes(ext)) {
        flash("Converting on the server…");
        const form = new FormData();
        form.append("file", f, f.name);
        form.append("target", "docx");
        const out = await uploadForm("/api/tools/universal/convert", form, { fallbackName: `${base}.docx` });
        return loadInto(importDocx(new Uint8Array(await out.blob.arrayBuffer())), base);
      }
      flash("Open a Word (.docx, .doc), OpenDocument (.odt), RTF, PDF, HTML, Markdown or text file.");
    } catch (e) {
      flash(e instanceof Error ? e.message : "That file couldn't be opened.");
    }
  };

  const fileBase = (name || "document").replace(/[\\/:*?"<>|]+/g, " ").trim() || "document";
  const download = async (kind: "docx" | "pdf" | "pdf-server" | "html" | "md" | "txt" | "odt") => {
    const doc = { html: bodyRef.current?.innerHTML ?? html, page };
    if (kind === "docx") saveBlob(exportDocx(doc, name), `${fileBase}.docx`);
    else if (kind === "pdf") printDoc(doc, name);
    else if (kind === "html") saveBlob(new Blob([standaloneHtml(doc, name)], { type: "text/html;charset=utf-8" }), `${fileBase}.html`);
    else if (kind === "md") saveBlob(new Blob([htmlToMarkdown(doc.html)], { type: "text/markdown;charset=utf-8" }), `${fileBase}.md`);
    else if (kind === "txt") saveBlob(new Blob([htmlToText(doc.html)], { type: "text/plain;charset=utf-8" }), `${fileBase}.txt`);
    else {
      flash("Converting on the server…");
      try {
        const form = new FormData();
        form.append("file", new File([exportDocx(doc, name)], `${fileBase}.docx`), `${fileBase}.docx`);
        form.append("target", kind === "odt" ? "odt" : "pdf");
        const out = await uploadForm("/api/tools/universal/convert", form, { fallbackName: `${fileBase}.${kind === "odt" ? "odt" : "pdf"}` });
        saveBlob(out.blob, out.name);
      } catch (e) {
        flash(e instanceof Error ? e.message : "The server couldn't convert it. Try Print → Save as PDF.");
      }
    }
  };

  // ---------- read aloud & translate
  const readAloud = async () => {
    if (reading) {
      readCtrl.current?.abort();
      stopSpeaking();
      setReading(false);
      return;
    }
    const sel = window.getSelection();
    const text = (sel && !sel.isCollapsed && bodyRef.current?.contains(sel.anchorNode) ? sel.toString() : bodyRef.current?.innerText ?? "").trim();
    if (!text) return;
    const ctrl = new AbortController();
    readCtrl.current = ctrl;
    setReading(true);
    const lang = document.documentElement.lang?.split("-")[0] || "en";
    const chunks = text.match(/[\s\S]{1,1400}(?:[.!?。]\s|$)|[\s\S]{1,1400}/g) ?? [text];
    for (const c of chunks) {
      if (ctrl.signal.aborted) break;
      await speak(c, lang, { signal: ctrl.signal });
    }
    setReading(false);
  };

  // ---------- find & replace
  const findMatches = (q: string, matchCase: boolean): Range[] => {
    const root = bodyRef.current;
    if (!root || !q) return [];
    const out: Range[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n: Node | null;
    const needle = matchCase ? q : q.toLowerCase();
    while ((n = walker.nextNode())) {
      const t = matchCase ? (n as Text).data : (n as Text).data.toLowerCase();
      let i = t.indexOf(needle);
      while (i >= 0) {
        const r = document.createRange();
        r.setStart(n, i);
        r.setEnd(n, i + q.length);
        out.push(r);
        i = t.indexOf(needle, i + needle.length);
      }
    }
    return out;
  };
  const findIdx = useRef(-1);

  // ---------- render
  const TABS: Tab[] = ["File", "Home", "Insert", "Layout", "References", "Review", "View", ...(fmt.inTable ? (["Table"] as Tab[]) : [])];
  const ribbon = (
    <Ribbon tabs={TABS} active={tab} onTab={(t) => setTab(t as Tab)} right={<span className="hidden pr-2 text-xs text-ink-3 md:inline">{stats.words.toLocaleString()} words</span>}>
      {tab === "File" && (
        <>
          <RGroup label="New">
            <RBtn big icon={FileText} label="Blank" showLabel onClick={() => loadInto(WORD_TEMPLATES[0].build(), "Document1")} />
            <RBtn big icon={BookOpenText} label="Templates" showLabel onClick={() => setDialog("templates")} />
          </RGroup>
          <RGroup label="Download">
            <RBtn big icon={Download} label="Word .docx" showLabel onClick={() => download("docx")} />
            <RBtn big icon={Download} label="PDF (exact)" showLabel onClick={() => download("pdf-server")} />
            <RBtn big icon={Download} label="OpenDocument" showLabel onClick={() => download("odt")} />
            <RBtn big icon={Download} label="HTML" showLabel onClick={() => download("html")} />
            <RBtn big icon={Download} label="Markdown" showLabel onClick={() => download("md")} />
            <RBtn big icon={Download} label="Plain text" showLabel onClick={() => download("txt")} />
          </RGroup>
          <RGroup label="Print">
            <RBtn big icon={Printer} label="Print / Save PDF" showLabel onClick={() => download("pdf")} />
          </RGroup>
        </>
      )}
      {tab === "Home" && (
        <>
          <RGroup label="Undo">
            <RBtn icon={Undo2} label="Undo" shortcut="Ctrl+Z" onClick={undo} />
            <RBtn icon={Redo2} label="Redo" shortcut="Ctrl+Y" onClick={redo} />
          </RGroup>
          <RGroup label="Clipboard">
            <Menu
              icon={ClipboardPaste}
              label="Paste"
              items={[
                { label: "Paste", shortcut: "Ctrl+V", onClick: async () => { try { const t = await navigator.clipboard.readText(); insertHtml(t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>")); } catch { flash("Press Ctrl/⌘+V to paste."); } } },
                { label: "Paste as plain text", shortcut: "Ctrl+Shift+V", onClick: pastePlain },
              ]}
            />
            <RBtn icon={Scissors} label="Cut" shortcut="Ctrl+X" onClick={() => exec("cut")} />
            <RBtn icon={Copy} label="Copy" shortcut="Ctrl+C" onClick={() => exec("copy")} />
            <RBtn
              icon={Paintbrush}
              label="Format painter"
              active={Boolean(painter)}
              onClick={() => setPainter(painter ? null : { b: fmt.bold, i: fmt.italic, u: fmt.underline, color: "#000000", font: fmt.font, size: fmt.size })}
            />
          </RGroup>
          <RGroup label="Font" maxW={350}>
            <RSelect label="Font" value={fmt.font} width={136} onChange={(v) => { ensureFont(v); exec("fontName", v); }} options={FONTS.map((f) => ({ value: f, label: f, style: { fontFamily: f } }))} />
            <RSelect label="Font size" value={String(fmt.size)} width={62} onChange={(v) => setFontSize(Number(v))} options={FONT_SIZES.map((s) => ({ value: String(s), label: String(s) }))} />
            <RBtn label="Grow font" shortcut="Ctrl+]" onClick={() => growFont(1)}>
              <span className="text-sm font-semibold">A⁺</span>
            </RBtn>
            <RBtn label="Shrink font" shortcut="Ctrl+[" onClick={() => growFont(-1)}>
              <span className="text-xs font-semibold">A⁻</span>
            </RBtn>
            <Menu
              icon={CaseSensitive}
              label="Change case"
              showLabel={false}
              items={[
                { label: "Sentence case.", onClick: () => changeCase("sentence") },
                { label: "lowercase", onClick: () => changeCase("lower") },
                { label: "UPPERCASE", onClick: () => changeCase("upper") },
                { label: "Capitalize Each Word", onClick: () => changeCase("title") },
              ]}
            />
            <RBtn icon={RemoveFormatting} label="Clear formatting" onClick={() => { exec("removeFormat"); applyBlockStyle("Normal"); }} />
            <RBreak />
            <RBtn icon={Bold} label="Bold" shortcut="Ctrl+B" active={fmt.bold} onClick={() => exec("bold")} />
            <RBtn icon={Italic} label="Italic" shortcut="Ctrl+I" active={fmt.italic} onClick={() => exec("italic")} />
            <RBtn icon={Underline} label="Underline" shortcut="Ctrl+U" active={fmt.underline} onClick={() => exec("underline")} />
            <RBtn icon={Strikethrough} label="Strikethrough" active={fmt.strike} onClick={() => exec("strikeThrough")} />
            <RBtn icon={Subscript} label="Subscript" shortcut="Ctrl+=" active={fmt.sub} onClick={() => exec("subscript")} />
            <RBtn icon={Superscript} label="Superscript" shortcut="Ctrl+Shift+=" active={fmt.sup} onClick={() => exec("superscript")} />
            <ColorButton icon={Baseline} label="Font colour" onChange={(c) => exec("foreColor", c ?? "#000000")} />
            <ColorButton icon={Highlighter} label="Highlight" onChange={(c) => exec("hiliteColor", c ?? "transparent")} />
          </RGroup>
          <RGroup label="Paragraph" maxW={240}>
            <RBtn icon={List} label="Bullets" active={fmt.ul} onClick={() => exec("insertUnorderedList")} />
            <Menu
              icon={ListOrdered}
              label="Numbering"
              showLabel={false}
              items={[
                { label: "1. 2. 3.", onClick: () => numbering("1") },
                { label: "a. b. c.", onClick: () => numbering("a") },
                { label: "A. B. C.", onClick: () => numbering("A") },
                { label: "i. ii. iii.", onClick: () => numbering("i") },
                { label: "I. II. III.", onClick: () => numbering("I") },
              ]}
            />
            <RBtn icon={CheckSquare} label="Checklist" onClick={() => insertHtml('<ul class="checklist"><li data-checked="false">' + (window.getSelection()?.toString() || "<br>") + "</li></ul>")} />
            <RBtn icon={IndentDecrease} label="Decrease indent" onClick={() => exec("outdent")} />
            <RBtn icon={IndentIncrease} label="Increase indent" onClick={() => exec("indent")} />
            <RBreak />
            <RBtn icon={AlignLeft} label="Align left" shortcut="Ctrl+L" active={fmt.align === "left"} onClick={() => exec("justifyLeft")} />
            <RBtn icon={AlignCenter} label="Center" shortcut="Ctrl+E" active={fmt.align === "center"} onClick={() => exec("justifyCenter")} />
            <RBtn icon={AlignRight} label="Align right" shortcut="Ctrl+R" active={fmt.align === "right"} onClick={() => exec("justifyRight")} />
            <RBtn icon={AlignJustify} label="Justify" shortcut="Ctrl+J" active={fmt.align === "justify"} onClick={() => exec("justifyFull")} />
            <Menu
              icon={WrapText}
              label="Line spacing"
              showLabel={false}
              items={[
                { label: "Line spacing 1.0", onClick: () => setBlockCss("lineHeight", "1.0") },
                { label: "Line spacing 1.15", onClick: () => setBlockCss("lineHeight", "1.15") },
                { label: "Line spacing 1.5", onClick: () => setBlockCss("lineHeight", "1.5") },
                { label: "Line spacing 2.0", onClick: () => setBlockCss("lineHeight", "2.0") },
                { label: "Line spacing 2.5", onClick: () => setBlockCss("lineHeight", "2.5") },
                { label: "Line spacing 3.0", onClick: () => setBlockCss("lineHeight", "3.0") },
                { divider: true as const },
                { label: "Add space before", onClick: () => setBlockCss("marginTop", "12pt") },
                { label: "Remove space after", onClick: () => setBlockCss("marginBottom", "0") },
                { label: "First-line indent", onClick: () => setBlockCss("textIndent", "36pt") },
                { label: "Right-to-left paragraph", onClick: () => setBlockCss("direction", "rtl") },
                { label: "Left-to-right paragraph", onClick: () => setBlockCss("direction", "ltr") },
              ]}
            />
            <ColorButton icon={PaintBucket} label="Shading" onChange={(c) => { snapshot(); restoreSelection(); blocksInSelection().forEach((b) => (b.style.backgroundColor = c ?? "")); changed(true); }} />
          </RGroup>
          <RGroup label="Styles">
            <div className="flex max-w-[310px] gap-1 overflow-x-auto py-0.5 [scrollbar-width:thin]">
              {PARA_STYLES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => applyBlockStyle(s.id)}
                  className={cn(
                    "h-12 w-[72px] shrink-0 overflow-hidden rounded-[6px] border px-1.5 text-left leading-tight",
                    fmt.block === s.id ? "border-ink bg-ink/5" : "border-line bg-white hover:border-ink-3",
                  )}
                  title={s.label}
                >
                  <span
                    className="block truncate"
                    style={{
                      fontSize: s.id === "Title" ? 17 : s.id.startsWith("Heading") ? 15 - Number(s.id.slice(-1)) : 12,
                      fontWeight: s.id.startsWith("Heading") ? 600 : 400,
                      fontStyle: s.id === "Quote" ? "italic" : "normal",
                      fontFamily: s.id === "Code" ? "Consolas, monospace" : undefined,
                      color: s.id.startsWith("Heading") ? "#2f5496" : s.id === "Subtitle" ? "#595959" : "#111",
                    }}
                  >
                    AaBb
                  </span>
                  <span className="block truncate text-[10px] text-ink-3">{s.label}</span>
                </button>
              ))}
            </div>
          </RGroup>
          <RGroup label="Editing">
            <RBtn big icon={Search} label="Find & replace" showLabel onClick={() => setDialog("find")} />
          </RGroup>
        </>
      )}
      {tab === "Insert" && (
        <>
          <RGroup label="Pages">
            <RBtn big icon={Minus} label="Page break" showLabel shortcut="Ctrl+Enter" onClick={() => insertHtml('<div class="page-break" contenteditable="false"></div><p><br></p>')} />
          </RGroup>
          <RGroup label="Tables">
            <TablePicker onPick={(r, c) => insertTable(r, c)} />
          </RGroup>
          <RGroup label="Illustrations">
            <RBtn big icon={ImageIcon} label="Picture" showLabel onClick={() => { openWithSelection("image"); }} />
          </RGroup>
          <RGroup label="Links">
            <RBtn big icon={Link2} label="Link" showLabel shortcut="Ctrl+K" onClick={() => { openWithSelection("link"); }} />
          </RGroup>
          <RGroup label="Text">
            <RBtn big icon={Minus} label="Line" showLabel onClick={() => insertHtml("<hr><p><br></p>")} />
            <RBtn big icon={Code2} label="Code block" showLabel onClick={() => applyBlockStyle("Code")} />
            <RBtn big icon={Quote} label="Quote" showLabel onClick={() => applyBlockStyle("Quote")} />
            <RBtn big icon={Type} label="Date & time" showLabel onClick={() => insertHtml(new Date().toLocaleString())} />
          </RGroup>
          <RGroup label="Symbols">
            <RBtn big icon={Sigma} label="Equation" showLabel onClick={() => { openWithSelection("equation"); }} />
            <Menu icon={Omega} label="Symbol" big items={SYMBOLS.map((s) => ({ label: s, onClick: () => insertHtml(s) }))} />
          </RGroup>
          <RGroup label="Comments">
            <RBtn big icon={MessageSquarePlus} label="Comment" showLabel onClick={() => { openWithSelection("comment"); }} />
          </RGroup>
        </>
      )}
      {tab === "Layout" && (
        <>
          <RGroup label="Page setup">
            <Menu
              label="Margins"
              items={[
                { label: "Normal (2.54 cm)", checked: isMargins(25.4, 25.4), onClick: () => setPage((p) => ({ ...p, margins: { top: 25.4, right: 25.4, bottom: 25.4, left: 25.4 } })) },
                { label: "Narrow (1.27 cm)", checked: isMargins(12.7, 12.7), onClick: () => setPage((p) => ({ ...p, margins: { top: 12.7, right: 12.7, bottom: 12.7, left: 12.7 } })) },
                { label: "Moderate", checked: isMargins(25.4, 19.1), onClick: () => setPage((p) => ({ ...p, margins: { top: 25.4, right: 19.1, bottom: 25.4, left: 19.1 } })) },
                { label: "Wide (5.08 cm sides)", checked: isMargins(25.4, 50.8), onClick: () => setPage((p) => ({ ...p, margins: { top: 25.4, right: 50.8, bottom: 25.4, left: 50.8 } })) },
                { label: "Custom…", onClick: () => setDialog("margins") },
              ]}
            />
            <Menu label="Orientation" items={[{ label: "Portrait", checked: !page.landscape, onClick: () => setPage((p) => ({ ...p, landscape: false })) }, { label: "Landscape", checked: page.landscape, onClick: () => setPage((p) => ({ ...p, landscape: true })) }]} />
            <Menu label="Size" items={(["A4", "Letter", "Legal", "A5", "A3"] as const).map((s) => ({ label: s, checked: page.size === s, onClick: () => setPage((p) => ({ ...p, size: s })) }))} />
            <Menu icon={Columns2} label="Columns" items={([1, 2, 3] as const).map((n) => ({ label: `${n} column${n > 1 ? "s" : ""}`, checked: page.columns === n, onClick: () => setPage((p) => ({ ...p, columns: n })) }))} />
          </RGroup>
          <RGroup label="Page background">
            <ColorButton icon={PaintBucket} label="Page colour" value={page.pageColor} onChange={(c) => setPage((p) => ({ ...p, pageColor: c ?? undefined }))} />
            <RBtn label="Watermark" showLabel onClick={() => setDialog("watermark")} />
          </RGroup>
          <RGroup label="Header & footer">
            <input aria-label="Header text" placeholder="Header" value={page.header} onChange={(e) => setPage((p) => ({ ...p, header: e.target.value }))} className="h-8 w-32 rounded-[6px] border border-line px-2 text-[13px]" />
            <input aria-label="Footer text" placeholder="Footer" value={page.footer} onChange={(e) => setPage((p) => ({ ...p, footer: e.target.value }))} className="h-8 w-32 rounded-[6px] border border-line px-2 text-[13px]" />
            <Menu
              label="Page numbers"
              items={(
                [
                  ["none", "None"],
                  ["bottom-center", "Bottom, centre"],
                  ["bottom-right", "Bottom, right"],
                  ["top-right", "Top, right"],
                ] as const
              ).map(([v, l]) => ({ label: l, checked: page.pageNumbers === v, onClick: () => setPage((p) => ({ ...p, pageNumbers: v })) }))}
            />
          </RGroup>
        </>
      )}
      {tab === "References" && (
        <>
          <RGroup label="Contents">
            <RBtn big icon={ListTree} label="Table of contents" showLabel onClick={buildToc} />
          </RGroup>
          <RGroup label="Footnotes">
            <RBtn big icon={Footprints} label="Footnote" showLabel onClick={() => { openWithSelection("footnote"); }} />
          </RGroup>
        </>
      )}
      {tab === "Review" && (
        <>
          <RGroup label="Proofing">
            <RBtn big icon={SpellCheck} label="Spelling" showLabel active={spell} onClick={() => setSpell((s) => !s)} />
            <RBtn big icon={Pilcrow} label="Word count" showLabel onClick={() => setDialog("count")} />
          </RGroup>
          <RGroup label="Speech">
            <RBtn big icon={reading ? Square : Volume2} label={reading ? "Stop" : "Read aloud"} showLabel onClick={readAloud} />
          </RGroup>
          <RGroup label="Language">
            <RBtn big icon={Languages} label="Translate" showLabel onClick={() => { openWithSelection("translate"); }} />
          </RGroup>
          <RGroup label="Comments">
            <RBtn big icon={MessageSquarePlus} label="New comment" showLabel onClick={() => { openWithSelection("comment"); }} />
          </RGroup>
        </>
      )}
      {tab === "View" && (
        <>
          <RGroup label="Views">
            <RBtn label="Print layout" showLabel active={layout === "print"} onClick={() => setLayout("print")} />
            <RBtn label="Web layout" showLabel active={layout === "web"} onClick={() => setLayout("web")} />
            <RBtn label="Focus" showLabel active={focusMode} onClick={() => setFocusMode((f) => !f)} />
          </RGroup>
          <RGroup label="Show">
            <RBtn label="Navigation pane" showLabel active={navOpen} onClick={() => setNavOpen((v) => !v)} />
          </RGroup>
          <RGroup label="Zoom">
            <RBtn icon={Minus} label="Zoom out" onClick={() => { setFit(false); setZoom((z) => Math.max(50, z - 10)); }} />
            <span className="w-12 text-center text-sm">{Math.round(effZoom * 100)}%</span>
            <RBtn icon={Plus} label="Zoom in" onClick={() => { setFit(false); setZoom((z) => Math.min(200, z + 10)); }} />
            <RBtn label="Actual size" showLabel onClick={() => { setFit(false); setZoom(100); }} />
            <RBtn label="Page width" showLabel active={fit} onClick={() => { setFit(true); setZoom(100); }} />
          </RGroup>
        </>
      )}
      {tab === "Table" && (
        <>
          <RGroup label="Rows & columns">
            <RBtn label="Insert above" showLabel onClick={() => tableOp("rowAbove")} />
            <RBtn label="Insert below" showLabel onClick={() => tableOp("rowBelow")} />
            <RBtn label="Insert left" showLabel onClick={() => tableOp("colLeft")} />
            <RBtn label="Insert right" showLabel onClick={() => tableOp("colRight")} />
          </RGroup>
          <RGroup label="Delete">
            <RBtn label="Row" showLabel onClick={() => tableOp("delRow")} />
            <RBtn label="Column" showLabel onClick={() => tableOp("delCol")} />
            <RBtn icon={Trash2} label="Table" showLabel onClick={() => tableOp("delTable")} />
          </RGroup>
          <RGroup label="Design">
            <RBtn label="Header row" showLabel onClick={() => tableOp("header")} />
            <ColorButton icon={PaintBucket} label="Cell shading" onChange={shadeCell} />
            <RBtn label="Borders" showLabel onClick={() => tableOp("borders")} />
            <RBtn label="No borders" showLabel onClick={() => tableOp("noBorders")} />
          </RGroup>
        </>
      )}
    </Ribbon>
  );

  function isMargins(tb: number, lr: number) {
    const m = page.margins;
    return Math.abs(m.top - tb) < 0.2 && Math.abs(m.bottom - tb) < 0.2 && Math.abs(m.left - lr) < 0.2 && Math.abs(m.right - lr) < 0.2;
  }

  /** Applies a numbering style: restyles the current numbered list, or starts one (never toggles it off). */
  function numbering(t: string) {
    restoreSelection();
    const n = window.getSelection()?.anchorNode;
    const el = (n?.nodeType === 3 ? n.parentElement : (n as HTMLElement | null)) ?? null;
    if (!el?.closest(".doc-body ol")) exec("insertOrderedList");
    setListType(t);
  }

  function setListType(t: string) {
    const sel = window.getSelection();
    const n = sel?.anchorNode;
    const el = (n?.nodeType === 3 ? n.parentElement : (n as HTMLElement)) ?? null;
    const ol = el?.closest("ol");
    if (ol) {
      // The `type` attribute drives .docx export; the inline style is what renders, because CSS
      // attribute selectors on `type` are case-insensitive (a/A, i/I would collide) and the
      // Tailwind reset overrides the browser's own mapping.
      const css: Record<string, string> = { a: "lower-alpha", A: "upper-alpha", i: "lower-roman", I: "upper-roman" };
      if (t === "1") {
        ol.removeAttribute("type");
        ol.style.removeProperty("list-style-type");
      } else {
        ol.setAttribute("type", t);
        ol.style.listStyleType = css[t];
      }
      changed(true);
    }
  }

  const pageCss = useMemo(() => docCss(".word-doc"), []);
  const contentH = pagePx(page).h - (page.margins.top + page.margins.bottom) * MM_TO_PX;
  const pageCount = layout === "print" ? pages.count : 1;

  return (
    <EditorFrame fullscreen={fullscreen}>
      <style>{pageCss}{`.word-doc:focus{outline:none}.word-doc img.sel{outline:2px solid #2b579a}`}</style>
      {!focusMode && (
        <>
          <TitleBar
            app="word"
            icon={FileText}
            name={name}
            onRename={setName}
            saveState={saveState}
            onNew={() => loadInto(WORD_TEMPLATES[0].build(), "Document1")}
            onOpenFile={openFile}
            accept=".docx,.docm,.dotx,.doc,.odt,.rtf,.pdf,.html,.htm,.md,.markdown,.txt"
            onPickDoc={async (id) => {
              const d = await loadDoc<Saved>(id);
              if (d) onSwitch(id, d);
            }}
            currentId={docId}
            fullscreen={fullscreen}
            onFullscreen={() => setFullscreen((f) => !f)}
            extra={<RBtn icon={Download} label="Download .docx" onClick={() => download("docx")} />}
          />
          {ribbon}
        </>
      )}
      <div className="flex min-h-0 flex-1">
        {navOpen && !focusMode && (
          <aside className="hidden w-60 shrink-0 overflow-y-auto border-r border-line bg-paper/50 p-2 md:block" aria-label="Navigation">
            <p className="px-2 pb-1 text-[10px] uppercase tracking-wide text-ink-3">Headings</p>
            {outline.length === 0 && <p className="px-2 text-xs text-ink-3">Use Heading styles to build an outline.</p>}
            {outline.map((h) => (
              <button key={h.id} type="button" onClick={() => document.getElementById(h.id)?.scrollIntoView({ behavior: "smooth", block: "start" })} className="block w-full truncate rounded px-2 py-1 text-left text-[13px] hover:bg-white" style={{ paddingLeft: 8 + (h.level - 1) * 12 }}>
                {h.text || "(empty)"}
              </button>
            ))}
            {comments.length > 0 && (
              <>
                <p className="mt-4 px-2 pb-1 text-[10px] uppercase tracking-wide text-ink-3">Comments</p>
                {comments.map((c) => (
                  <div key={c.id} className="mb-1 rounded border border-[#f2c200]/60 bg-[#fff8d6] p-2 text-xs">
                    <p className="italic text-ink-3">“{c.quote.slice(0, 60)}”</p>
                    <p className="mt-1 text-ink">{c.text}</p>
                    <button
                      type="button"
                      className="mt-1 text-[11px] text-danger"
                      onClick={() => {
                        const el = document.getElementById(c.id);
                        if (el) {
                          snapshot();
                          el.replaceWith(...Array.from(el.childNodes));
                          changed(true);
                        }
                      }}
                    >
                      Resolve
                    </button>
                  </div>
                ))}
              </>
            )}
          </aside>
        )}
        <div ref={scrollRef} className={cn("relative min-w-0 flex-1 overflow-auto", layout === "print" ? "bg-[#e9e7e1] py-6" : "bg-white")} onMouseDown={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); bodyRef.current?.focus({ preventScroll: true }); } }}>
          {focusMode && (
            <button type="button" onClick={() => setFocusMode(false)} className="fixed right-4 top-4 z-50 rounded-md bg-ink px-3 py-1.5 text-xs text-paper shadow-float">
              Exit focus
            </button>
          )}
          <div style={layout === "print" ? { width: px.w * effZoom, margin: "0 auto" } : { maxWidth: 900, margin: "0 auto" }}>
            <div
              onMouseDown={(e) => {
                // A click in the page margins puts the caret at the nearest end of the text, like Word.
                const body = bodyRef.current;
                if (!body || body.contains(e.target as Node)) return;
                e.preventDefault();
                body.focus({ preventScroll: true });
                const r = document.createRange();
                r.selectNodeContents(body);
                const rect = body.getBoundingClientRect();
                r.collapse(e.clientY < rect.top);
                const sel = window.getSelection();
                sel?.removeAllRanges();
                sel?.addRange(r);
              }}
              className={cn("relative origin-top-left cursor-text", layout === "print" && "shadow-[0_1px_6px_rgba(0,0,0,.18)]")}
              style={
                layout === "print"
                  ? {
                      width: px.w,
                      minHeight: px.h * pageCount,
                      transform: `scale(${effZoom})`,
                      background: page.pageColor ?? "#fff",
                      padding: `${page.margins.top * MM_TO_PX}px ${page.margins.right * MM_TO_PX}px ${page.margins.bottom * MM_TO_PX}px ${page.margins.left * MM_TO_PX}px`,
                      marginBottom: px.h * pageCount * (effZoom - 1),
                    }
                  : { padding: "32px 24px", background: page.pageColor ?? "#fff" }
              }
            >
              {layout === "print" && (page.header || page.pageNumbers === "top-right") && (
                <div className="pointer-events-none absolute inset-x-0 flex justify-between text-[9pt] text-[#777]" style={{ top: 18, paddingLeft: page.margins.left * MM_TO_PX, paddingRight: page.margins.right * MM_TO_PX }}>
                  <span className="mx-auto">{page.header}</span>
                  {page.pageNumbers === "top-right" && <span>1</span>}
                </div>
              )}
              {page.watermark && (
                <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
                  {Array.from({ length: pageCount }, (_, i) => (
                    <div key={i} className="absolute inset-x-0 flex items-center justify-center" style={{ top: i * px.h, height: px.h }}>
                      <span className="-rotate-[40deg] whitespace-nowrap text-[90px] font-bold text-black/[0.06]">{page.watermark}</span>
                    </div>
                  ))}
                </div>
              )}
              {/* page boundaries */}
              {layout === "print" &&
                Array.from({ length: Math.max(0, pageCount - 1) }, (_, i) => (
                  <div key={i} aria-hidden className="pointer-events-none absolute inset-x-0 border-t-[10px] border-[#e9e7e1]" style={{ top: (i + 1) * px.h - 5 }}>
                    <span className="absolute right-2 top-1 text-[10px] text-ink-3">Page {i + 2}</span>
                  </div>
                ))}
              <div
                ref={bodyRef}
                className="word-doc doc-body relative"
                contentEditable
                suppressContentEditableWarning
                spellCheck={spell}
                role="textbox"
                aria-multiline="true"
                aria-label="Document"
                style={{ minHeight: contentH, columnCount: page.columns > 1 ? page.columns : undefined, columnGap: page.columns > 1 ? "12mm" : undefined }}
                onInput={() => changed()}
                onKeyDown={onKeyDown}
                onPaste={onPaste}
                onClick={onClickBody}
                onMouseUp={keepSelection}
                onKeyUp={keepSelection}
                onDrop={(e) => {
                  const f = e.dataTransfer.files?.[0];
                  if (f && f.type.startsWith("image/")) {
                    e.preventDefault();
                    insertImageFile(f);
                  }
                }}
              />
              {layout === "print" && (page.footer || page.pageNumbers.startsWith("bottom")) && (
                <div className="pointer-events-none absolute inset-x-0 flex text-[9pt] text-[#777]" style={{ top: px.h - 34, paddingLeft: page.margins.left * MM_TO_PX, paddingRight: page.margins.right * MM_TO_PX }}>
                  <span className={page.pageNumbers === "bottom-right" ? "" : "mx-auto"}>
                    {page.footer}
                    {page.pageNumbers === "bottom-center" && `${page.footer ? "    " : ""}1`}
                  </span>
                  {page.pageNumbers === "bottom-right" && <span className="ml-auto">1</span>}
                </div>
              )}
            </div>
          </div>
          {imgToolbar && (
            <div className="fixed bottom-16 left-1/2 z-40 flex -translate-x-1/2 flex-wrap items-center gap-1 rounded-md border border-line bg-white p-1.5 text-xs shadow-float">
              {[25, 50, 75, 100].map((w) => (
                <button key={w} type="button" className="rounded px-2 py-1 hover:bg-paper" onClick={() => editImg((img) => { img.style.width = `${w}%`; img.removeAttribute("width"); })}>
                  {w}%
                </button>
              ))}
              <button type="button" className="rounded px-2 py-1 hover:bg-paper" onClick={() => editImg((img) => { img.style.cssFloat = "left"; img.style.margin = "0 12px 8px 0"; })}>Wrap left</button>
              <button type="button" className="rounded px-2 py-1 hover:bg-paper" onClick={() => editImg((img) => { img.style.cssFloat = "right"; img.style.margin = "0 0 8px 12px"; })}>Wrap right</button>
              <button type="button" className="rounded px-2 py-1 hover:bg-paper" onClick={() => editImg((img) => { img.style.cssFloat = ""; img.style.display = "block"; img.style.margin = "8px auto"; })}>Centre</button>
              <button type="button" className="rounded px-2 py-1 hover:bg-paper" onClick={() => editImg((img) => { const alt = window.prompt("Alt text (describes the picture for screen readers)", img.alt); if (alt !== null) img.alt = alt; })}>Alt text</button>
              <button type="button" className="rounded px-2 py-1 text-danger hover:bg-paper" onClick={() => { editImg((img) => img.remove()); setSelImg(null); }}>Delete</button>
              <button type="button" aria-label="Close" className="rounded px-2 py-1 hover:bg-paper" onClick={() => setSelImg(null)}>✕</button>
            </div>
          )}
        </div>
      </div>
      {!focusMode && (
        <div className="flex items-center gap-3 border-t border-line bg-paper/70 px-3 py-1 text-xs text-ink-2">
          <span>Page {Math.min(pages.current, pageCount)} of {pageCount}</span>
          <button type="button" className="hover:text-ink" onClick={() => setDialog("count")}>{stats.words.toLocaleString()} words</button>
          <span className="hidden sm:inline">{stats.chars.toLocaleString()} characters</span>
          <span className="hidden md:inline">{page.size} · {page.landscape ? "Landscape" : "Portrait"}</span>
          <div className="ml-auto flex items-center gap-1">
            <button type="button" aria-label="Zoom out" onClick={() => { setFit(false); setZoom((z) => Math.max(50, z - 10)); }}>−</button>
            <input type="range" min={50} max={200} step={10} value={Math.round(effZoom * 100)} onChange={(e) => { setFit(false); setZoom(Number(e.target.value)); }} aria-label="Zoom" className="hidden w-24 accent-[#2b579a] sm:block" />
            <button type="button" aria-label="Zoom in" onClick={() => { setFit(false); setZoom((z) => Math.min(200, z + 10)); }}>+</button>
            <span className="w-9 text-right">{Math.round(effZoom * 100)}%</span>
          </div>
        </div>
      )}
      {notice && <div className="fixed bottom-6 left-1/2 z-[95] -translate-x-1/2 rounded-md bg-ink px-3 py-2 text-xs text-paper shadow-float" role="status">{notice}</div>}

      {/* dialogs */}
      {dialog === "find" && <FindReplace onClose={() => setDialog(null)} find={(q, mc) => {
        const list = findMatches(q, mc);
        if (!list.length) return 0;
        findIdx.current = (findIdx.current + 1) % list.length;
        const r = list[findIdx.current];
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(r);
        r.startContainer.parentElement?.scrollIntoView({ block: "center", behavior: "smooth" });
        keepSelection();
        return list.length;
      }} replace={(q, rep, mc) => {
        const sel = window.getSelection();
        const cur = sel?.toString() ?? "";
        if (cur && (mc ? cur === q : cur.toLowerCase() === q.toLowerCase())) {
          document.execCommand("insertText", false, rep);
          changed(true);
        }
      }} replaceAll={(q, rep, mc) => {
        snapshot();
        const list = findMatches(q, mc).reverse();
        list.forEach((r) => {
          r.deleteContents();
          r.insertNode(document.createTextNode(rep));
        });
        bodyRef.current?.normalize();
        changed(true);
        return list.length;
      }} />}
      {dialog === "link" && (
        <PromptModal title="Insert link" fields={[{ key: "url", label: "Web address", initial: "https://" }, { key: "text", label: "Text to show (optional)", initial: dialogSel }]} onClose={() => setDialog(null)} onSubmit={(v) => {
          setDialog(null);
          const url = v.url.trim();
          if (!url || url === "https://") return;
          const safe = /^(https?:|mailto:|tel:|#)/i.test(url) ? url : `https://${url}`;
          if (dialogSel && !v.text) exec("createLink", safe);
          else insertHtml(`<a href="${safe.replace(/"/g, "&quot;")}">${(v.text || url).replace(/</g, "&lt;")}</a>&nbsp;`);
        }} />
      )}
      {dialog === "image" && (
        <ImageDialog onClose={() => setDialog(null)} onFile={(f) => { setDialog(null); insertImageFile(f); }} onUrl={(u) => { setDialog(null); insertHtml(`<img src="${u.replace(/"/g, "&quot;")}" alt="" style="max-width:100%">`); }} />
      )}
      {dialog === "equation" && (
        <PromptModal title="Equation (LaTeX)" fields={[{ key: "tex", label: "e.g. E = mc^2, \\frac{a}{b}, \\sqrt{x^2+y^2}, \\sum_{i=1}^n i", initial: "x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}" }]} onClose={() => setDialog(null)} onSubmit={(v) => { setDialog(null); insertEquation(v.tex); }} />
      )}
      {dialog === "comment" && (
        <PromptModal title="Comment" fields={[{ key: "c", label: "Your comment on the selected text", initial: "", multiline: true }]} onClose={() => setDialog(null)} onSubmit={(v) => { setDialog(null); addComment(v.c.trim()); setNavOpen(true); }} />
      )}
      {dialog === "footnote" && (
        <PromptModal title="Footnote" fields={[{ key: "t", label: "Footnote text", initial: "", multiline: true }]} onClose={() => setDialog(null)} onSubmit={(v) => { setDialog(null); insertFootnote(v.t.trim()); }} />
      )}
      {dialog === "watermark" && (
        <PromptModal title="Watermark" fields={[{ key: "w", label: "Text (empty to remove), e.g. DRAFT, CONFIDENTIAL", initial: page.watermark ?? "DRAFT" }]} onClose={() => setDialog(null)} onSubmit={(v) => { setDialog(null); setPage((p) => ({ ...p, watermark: v.w.trim() || undefined })); }} />
      )}
      {dialog === "margins" && (
        <PromptModal
          title="Custom margins (mm)"
          fields={(["top", "right", "bottom", "left"] as const).map((k) => ({ key: k, label: k[0].toUpperCase() + k.slice(1), initial: String(Math.round(page.margins[k] * 10) / 10) }))}
          onClose={() => setDialog(null)}
          onSubmit={(v) => {
            setDialog(null);
            const n = (s: string) => Math.max(0, Math.min(100, Number(s) || 0));
            setPage((p) => ({ ...p, margins: { top: n(v.top), right: n(v.right), bottom: n(v.bottom), left: n(v.left) } }));
          }}
        />
      )}
      {dialog === "count" && (
        <Modal open onClose={() => setDialog(null)} title="Word count">
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-ink-2">Pages</dt><dd className="text-right font-medium">{pageCount}</dd>
            <dt className="text-ink-2">Words</dt><dd className="text-right font-medium">{stats.words.toLocaleString()}</dd>
            <dt className="text-ink-2">Characters (no spaces)</dt><dd className="text-right font-medium">{stats.charsNoSpace.toLocaleString()}</dd>
            <dt className="text-ink-2">Characters (with spaces)</dt><dd className="text-right font-medium">{stats.chars.toLocaleString()}</dd>
            <dt className="text-ink-2">Paragraphs</dt><dd className="text-right font-medium">{stats.paras}</dd>
            <dt className="text-ink-2">Reading time</dt><dd className="text-right font-medium">{Math.max(1, Math.round(stats.words / 230))} min</dd>
            <dt className="text-ink-2">Speaking time</dt><dd className="text-right font-medium">{Math.max(1, Math.round(stats.words / 140))} min</dd>
          </dl>
        </Modal>
      )}
      {dialog === "translate" && (
        <TranslateDialog
          hasSelection={Boolean(dialogSel.trim())}
          onClose={() => setDialog(null)}
          onRun={async (target, scope, rtl) => {
            try {
              if (scope === "selection") {
                const text = dialogSel;
                if (!text.trim()) return flash("Select some text first.");
                const res = await smartTranslate({ text, source: "auto", target, glossary: loadGlossary() });
                restoreSelection();
                document.execCommand("insertText", false, res.translated_text);
                changed(true);
              } else {
                const res = await translateHtmlFragment(bodyRef.current?.innerHTML ?? html, "auto", target, { rtl, glossary: loadGlossary() });
                loadInto({ html: res.html, page }, `${name} (${target})`);
              }
              setDialog(null);
            } catch (e) {
              flash(e instanceof Error ? e.message : "Translation failed.");
            }
          }}
        />
      )}
      {dialog === "templates" && (
        <Modal open onClose={() => setDialog(null)} title="Templates" wide>
          <div className="grid gap-3 sm:grid-cols-2">
            {WORD_TEMPLATES.map((t) => (
              <button key={t.id} type="button" onClick={() => { setDialog(null); const d = t.build(); loadInto(d, t.name); }} className="rounded-md border border-line p-4 text-left hover:border-ink-3">
                <span className="block font-medium text-ink">{t.name}</span>
                <span className="block text-sm text-ink-2">{t.description}</span>
              </button>
            ))}
          </div>
        </Modal>
      )}
    </EditorFrame>
  );
}

/**
 * Chrome puts lists and tables inside <p> when they're created from a paragraph; lift them out so
 * the document stays valid HTML (and exports to DOCX as real lists).
 */
function normalizeBlocks(root: HTMLElement | null) {
  if (!root) return;
  root.querySelectorAll("p > ul, p > ol, p > table, p > blockquote, p > pre, p > div, p > h1, p > h2, p > h3, p > h4").forEach((blk) => {
    const p = blk.parentElement as HTMLElement;
    const rest = Array.from(p.childNodes).filter((n) => n !== blk && !(n.nodeType === 3 && !(n as Text).data.trim()) && !(n.nodeType === 1 && (n as Element).tagName === "BR"));
    if (!rest.length) p.replaceWith(blk);
    else p.after(blk);
  });
}

async function downscale(file: File, max: number): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    if (s === 1 && file.size < 1_500_000 && /png|jpe?g|gif/.test(file.type)) {
      return await new Promise((res) => {
        const fr = new FileReader();
        fr.onload = () => res(String(fr.result));
        fr.readAsDataURL(file);
      });
    }
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * s);
    c.height = Math.round(img.naturalHeight * s);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL(file.type === "image/png" ? "image/png" : "image/jpeg", 0.88);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function TablePicker({ onPick }: { onPick: (r: number, c: number) => void }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const [hover, setHover] = useState({ r: 0, c: 0 });
  return (
    <div className="relative">
      <span data-popover-trigger>
        <RBtn big icon={TableIcon} label="Table" showLabel onClick={() => setOpen((o) => !o)} active={open || undefined} />
      </span>
      <Popover open={open} onClose={close} className="w-auto">
        <div className="p-1" onMouseLeave={() => setHover({ r: 0, c: 0 })}>
          <p className="mb-1.5 text-xs text-ink-2">{hover.r ? `${hover.r} × ${hover.c} table` : "Insert table"}</p>
          <div className="grid w-max grid-cols-8 gap-1 sm:gap-0.5">
            {Array.from({ length: 64 }, (_, i) => {
              const r = Math.floor(i / 8) + 1;
              const c = (i % 8) + 1;
              return (
                <button
                  key={i}
                  type="button"
                  aria-label={`${r} by ${c}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setHover({ r, c })}
                  onClick={() => {
                    setOpen(false);
                    onPick(Math.max(2, r), c);
                  }}
                  className={cn("size-8 rounded-[2px] border sm:size-5", r <= hover.r && c <= hover.c ? "border-[#2b579a] bg-[#dbe5f5]" : "border-line")}
                />
              );
            })}
          </div>
        </div>
      </Popover>
    </div>
  );
}

function PromptModal({ title, fields, onClose, onSubmit }: { title: string; fields: { key: string; label: string; initial: string; multiline?: boolean }[]; onClose: () => void; onSubmit: (v: Record<string, string>) => void }) {
  const [v, setV] = useState<Record<string, string>>(Object.fromEntries(fields.map((f) => [f.key, f.initial])));
  return (
    <Modal open onClose={onClose} title={title} footer={<><button type="button" className={secondaryCls} onClick={onClose}>Cancel</button><button type="button" className={primaryCls} onClick={() => onSubmit(v)}>OK</button></>}>
      <div className="space-y-3">
        {fields.map((f, i) => (
          <label key={f.key} className="block text-sm text-ink-2">
            {f.label}
            {f.multiline ? (
              <textarea autoFocus={i === 0} rows={3} value={v[f.key]} onChange={(e) => setV({ ...v, [f.key]: e.target.value })} className={cn(inputCls, "h-auto py-2")} />
            ) : (
              <input autoFocus={i === 0} value={v[f.key]} onChange={(e) => setV({ ...v, [f.key]: e.target.value })} onKeyDown={(e) => e.key === "Enter" && onSubmit(v)} className={inputCls} />
            )}
          </label>
        ))}
      </div>
    </Modal>
  );
}

function ImageDialog({ onClose, onFile, onUrl }: { onClose: () => void; onFile: (f: File) => void; onUrl: (u: string) => void }) {
  const [url, setUrl] = useState("");
  const ref = useRef<HTMLInputElement | null>(null);
  return (
    <Modal open onClose={onClose} title="Insert picture">
      <button type="button" className={cn(primaryCls, "w-full")} onClick={() => ref.current?.click()}>
        <ImageIcon className="size-4" /> Choose from this device
      </button>
      <input ref={ref} type="file" accept="image/*" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
      <p className="my-3 text-center text-xs text-ink-3">or paste / drop a picture into the page, or use a link</p>
      <div className="flex gap-2">
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/picture.jpg" className={inputCls} />
        <button type="button" className={secondaryCls} disabled={!/^https?:\/\//.test(url)} onClick={() => onUrl(url)}>Insert</button>
      </div>
    </Modal>
  );
}

function FindReplace({ onClose, find, replace, replaceAll }: { onClose: () => void; find: (q: string, mc: boolean) => number; replace: (q: string, r: string, mc: boolean) => void; replaceAll: (q: string, r: string, mc: boolean) => number }) {
  const [q, setQ] = useState("");
  const [r, setR] = useState("");
  const [mc, setMc] = useState(false);
  const [msg, setMsg] = useState("");
  return (
    <Modal open onClose={onClose} title="Find & replace">
      <div className="space-y-3">
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && setMsg(`${find(q, mc)} match(es)`)} placeholder="Find" className={inputCls} />
        <input value={r} onChange={(e) => setR(e.target.value)} placeholder="Replace with" className={inputCls} />
        <label className="flex items-center gap-2 text-sm text-ink-2"><input type="checkbox" checked={mc} onChange={(e) => setMc(e.target.checked)} /> Match case</label>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={primaryCls} disabled={!q} onClick={() => setMsg(`${find(q, mc)} match(es)`)}>Find next</button>
          <button type="button" className={secondaryCls} disabled={!q} onClick={() => { replace(q, r, mc); setMsg(`${find(q, mc)} left`); }}>Replace</button>
          <button type="button" className={secondaryCls} disabled={!q} onClick={() => setMsg(`Replaced ${replaceAll(q, r, mc)}`)}>Replace all</button>
        </div>
        {msg && <p className="text-sm text-ink-2">{msg}</p>}
      </div>
    </Modal>
  );
}

function TranslateDialog({ hasSelection, onClose, onRun }: { hasSelection: boolean; onClose: () => void; onRun: (target: string, scope: "selection" | "document", rtl: boolean) => Promise<void> }) {
  const [langs, setLangs] = useState<TranslateLanguage[]>(FALLBACK_LANGUAGES);
  const [target, setTarget] = useState("es");
  const [scope, setScope] = useState<"selection" | "document">(hasSelection ? "selection" : "document");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    loadCapabilities().then((c) => c.languages?.length && setLangs(c.languages)).catch(() => {});
  }, []);
  return (
    <Modal
      open
      onClose={onClose}
      title="Translate"
      footer={
        <>
          <button type="button" className={secondaryCls} onClick={onClose}>Cancel</button>
          <button type="button" className={primaryCls} disabled={busy} onClick={async () => { setBusy(true); await onRun(target, scope, Boolean(langs.find((l) => l.code === target)?.rtl)); setBusy(false); }}>
            {busy ? "Translating…" : "Translate"}
          </button>
        </>
      }
    >
      <LanguagePicker label="Into" value={target} onChange={setTarget} languages={langs} />
      <div className="mt-4 space-y-2 text-sm text-ink-2">
        <label className="flex items-center gap-2"><input type="radio" checked={scope === "selection"} disabled={!hasSelection} onChange={() => setScope("selection")} /> Replace the selected text</label>
        <label className="flex items-center gap-2"><input type="radio" checked={scope === "document"} onChange={() => setScope("document")} /> Translate the whole document into a new copy (formatting kept)</label>
      </div>
      <p className="mt-3 text-xs text-ink-3">Uses the same free engines and glossary as the Translator tool, 130 languages.</p>
    </Modal>
  );
}

