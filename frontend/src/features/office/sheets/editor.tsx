"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  ArrowDownAZ,
  ArrowDownZA,
  ChartArea,
  ChartBar,
  ChartColumn,
  ChartLine,
  ChartPie,
  ChartScatter,
  Bold,
  BookOpen,
  ClipboardPaste,
  Copy,
  Download,
  Eraser,
  FileSpreadsheet,
  Filter,
  Grid3x3,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Link2,
  ListChecks,
  ListFilter,
  Merge,
  Minus,
  PaintBucket,
  Paintbrush,
  Palette,
  Percent,
  Plus,
  Printer,
  Redo2,
  Rows3,
  Scissors,
  Search,
  Sigma,
  SquareDashed,
  Strikethrough,
  StickyNote,
  Table2,
  Type,
  Underline,
  Undo2,
  WrapText,
} from "lucide-react";
import { saveBlob, uploadForm } from "@/lib/files";
import { cn } from "@/lib/utils";
import { ChartBox } from "./charts";
import { ChartDialog, CondFormatDialog, FindDialog, FormatCellsDialog, FunctionDialog, NUMBER_FORMATS, SortDialog, ValidationDialog, type FindOpts } from "./dialogs";
import { addr, FUNCTION_INFO, FUNCTION_NAMES, formatValue, indexToCol, isError, referencedRanges, shiftFormula, type Scalar } from "./formula";
import { buildGeometry, colLeft, colWidth, contentSize, hitTest, rowHeight, rowTop, scrollToShow } from "./geometry";
import { printHtml, sheetToHtml, usedRange } from "./html";
import {
  blankSheet,
  blankWorkbook,
  DEFAULT_COL_W,
  DEFAULT_ROW_H,
  evalConditional,
  fillSeries,
  forEachCell,
  insertDelete,
  key,
  mergeAt,
  newId,
  normRange,
  parseInput,
  parseRangeText,
  recalc,
  removeDuplicates,
  sortRange,
  splitColumn,
  uniqueSheetName,
  unkey,
  type BorderSide,
  type Cell,
  type CellStyle,
  type ChartSpec,
  type Range,
  type Sheet,
  type Workbook,
} from "./model";
import { draw, cellFont } from "./render";
import { SHEET_TEMPLATES } from "./templates";
import { exportDelimited, exportXlsx, importDelimited, importXlsx } from "./xlsx";
import { lastOpen, loadDoc, newDocId, rememberOpen, saveDoc } from "../shared/store";
import { ColorButton, EditorFrame, ensureFont, FONT_SIZES, FONTS, inputCls, Menu, Modal, primaryCls, RBreak, RBtn, RGroup, Ribbon, RSelect, secondaryCls, TitleBar, useAutosave } from "../shared/ui";

type Saved = { name: string; wb: Workbook };
const noop = () => () => {};
const REF_COLORS = ["#4472c4", "#c0504d", "#9bbb59", "#8064a2", "#f79646", "#4bacc6"];

/** Loads the last workbook from this browser (or a fresh one), then shows the editor. */
export function SheetEditorEntry() {
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  const [boot, setBoot] = useState<{ id: string; data: Saved } | null>(null);
  useEffect(() => {
    if (!mounted) return;
    const id = lastOpen("sheet");
    (id ? loadDoc<Saved>(id) : Promise.resolve(null)).then((data) => {
      if (data && id) setBoot({ id, data });
      else setBoot({ id: newDocId(), data: { name: "Book1", wb: SHEET_TEMPLATES[0].build() } });
    });
  }, [mounted]);
  if (!boot) return <div aria-hidden className="h-[calc(100dvh-140px)] min-h-[560px] animate-pulse rounded-lg border border-line bg-surface lg:h-[min(86dvh,1100px)]" />;
  return <SheetApp key={boot.id} docId={boot.id} initial={boot.data} onSwitch={(id, data) => setBoot({ id, data })} />;
}

type Editing = { r: number; c: number; text: string; source: "cell" | "bar"; typed: boolean };
type Clip = { sheet: number; range: Range; cells: (Cell | undefined)[][]; cut: boolean; text: string };
const CHART_ICONS = { column: ChartColumn, bar: ChartBar, line: ChartLine, pie: ChartPie, area: ChartArea, scatter: ChartScatter } as const;

type Ctx = { x: number; y: number; kind: "cell" | "col" | "row" | "tab"; tab?: number } | null;

function SheetApp({ docId, initial, onSwitch }: { docId: string; initial: Saved; onSwitch: (id: string, data: Saved) => void }) {
  const [wb, setWbRaw] = useState<Workbook>(initial.wb);
  const [name, setName] = useState(initial.name);
  const undo = useRef<Workbook[]>([]);
  const redo = useRef<Workbook[]>([]);
  const [sel, setSel] = useState<Range>(() => {
    const m = mergeAt(initial.wb.sheets[initial.wb.active], 0, 0);
    return m ? { ...m } : { r1: 0, c1: 0, r2: 0, c2: 0 };
  });
  const [active, setActive] = useState({ r: 0, c: 0 });
  const [editing, setEditing] = useState<Editing | null>(null);
  const [scroll, setScroll] = useState({ x: 0, y: 0 });
  const [size, setSize] = useState({ w: 800, h: 500 });
  const [tab, setTab] = useState("Home");
  const [showFormulas, setShowFormulas] = useState(false);
  const [showHeaders, setShowHeaders] = useState(true);
  const [showBar, setShowBar] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [dialog, setDialog] = useState<null | "format" | "cond" | "valid" | "sort" | "find" | "func" | "chart" | "link" | "note" | "name" | "templates" | "dims" | "textcols">(null);
  const [chartDraft, setChartDraft] = useState<ChartSpec | null>(null);
  const [ctxMenu, setCtxMenu] = useState<Ctx>(null);
  const [clip, setClip] = useState<Clip | null>(null);
  const [fillPreview, setFillPreview] = useState<Range | null>(null);
  const [painter, setPainter] = useState<CellStyle | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [renamingTab, setRenamingTab] = useState<number | null>(null);
  const [filterMenu, setFilterMenu] = useState<{ col: number; x: number; y: number } | null>(null);
  const [listMenu, setListMenu] = useState<string[] | null>(null);
  const [hoverNote, setHoverNote] = useState<{ text: string; x: number; y: number } | null>(null);
  const [acIndex, setAcIndex] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const areaRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const barRef = useRef<HTMLInputElement | null>(null);
  const dragRef = useRef<null | { mode: "select" | "fill" | "colResize" | "rowResize" | "point"; start: { r: number; c: number }; index?: number; startPos?: number; startSize?: number; pointStart?: number }>(null);

  const si = wb.active;
  const sheet = wb.sheets[si];
  const zoom = (sheet.zoom ?? 100) / 100;
  const computed = useMemo(() => recalc(wb), [wb]);
  const comp = computed[si];
  const cond = useMemo(() => evalConditional(sheet, comp.values), [sheet, comp]);
  const geo = useMemo(() => buildGeometry(sheet, zoom, showHeaders), [sheet, zoom, showHeaders]);

  // ---------- persistence
  const data = useMemo(() => ({ name, wb }), [name, wb]);
  const saveState = useAutosave(data, (d) => saveDoc({ id: docId, app: "sheet", name: d.name }, d));
  useEffect(() => rememberOpen("sheet", docId), [docId]);

  // ---------- history
  const commit = useCallback((next: Workbook | ((w: Workbook) => Workbook)) => {
    setWbRaw((cur) => {
      const n = typeof next === "function" ? next(cur) : next;
      if (n === cur) return cur;
      undo.current.push(cur);
      if (undo.current.length > 200) undo.current.shift();
      redo.current = [];
      return n;
    });
  }, []);
  const doUndo = () => {
    const prev = undo.current.pop();
    if (!prev) return;
    redo.current.push(wb);
    setWbRaw(prev);
  };
  const doRedo = () => {
    const next = redo.current.pop();
    if (!next) return;
    undo.current.push(wb);
    setWbRaw(next);
  };
  const updateSheet = useCallback((f: (s: Sheet) => Sheet, index?: number) => commit((w) => ({ ...w, sheets: w.sheets.map((s, i) => (i === (index ?? w.active) ? f(s) : s)) })), [commit]);

  // ---------- layout
  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [fullscreen, showBar]);

  const refRanges = useMemo(() => {
    if (!editing || !editing.text.startsWith("=")) return [];
    return referencedRanges(editing.text)
      .filter((r) => !r.sheet || r.sheet.toLowerCase() === sheet.name.toLowerCase())
      .map((r, i) => {
        const g = parseRangeText(r.ref);
        return g ? { range: g, color: REF_COLORS[i % REF_COLORS.length] } : null;
      })
      .filter((x): x is { range: Range; color: string } => Boolean(x));
  }, [editing, sheet.name]);

  // ---------- draw
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const raf = requestAnimationFrame(() =>
      draw(cv, {
        sheet,
        comp,
        cond,
        geo,
        width: size.w,
        height: size.h,
        scrollX: scroll.x,
        scrollY: scroll.y,
        sel,
        active,
        copyRange: clip && clip.sheet === si ? clip.range : null,
        refRanges,
        showFormulas,
        editing: editing ? { r: editing.r, c: editing.c } : null,
        fillPreview,
        dpr: window.devicePixelRatio || 1,
      }),
    );
    return () => cancelAnimationFrame(raf);
  }, [sheet, comp, cond, geo, size, scroll, sel, active, clip, si, refRanges, showFormulas, editing, fillPreview]);

  // fonts used by the sheet
  useEffect(() => {
    const fonts = new Set<string>();
    for (const k in sheet.cells) if (sheet.cells[k].s?.font) fonts.add(sheet.cells[k].s!.font!);
    fonts.forEach(ensureFont);
  }, [sheet.cells]);

  // ---------- helpers
  const activeCell = sheet.cells[key(active.r, active.c)];
  const activeStyle: CellStyle = activeCell?.s ?? {};
  const selText = sel.r1 === sel.r2 && sel.c1 === sel.c2 ? addr(sel.r1, sel.c1) : `${addr(sel.r1, sel.c1)}:${addr(sel.r2, sel.c2)}`;
  const focusSink = () => requestAnimationFrame(() => editorRef.current?.focus({ preventScroll: true }));
  const flash = (m: string) => {
    setNotice(m);
    setTimeout(() => setNotice((n) => (n === m ? null : n)), 3500);
  };

  /** Selection bounded to the used area for whole-row/column operations. */
  const boundedSel = (): Range => {
    const u = usedRange(sheet, comp);
    return { r1: sel.r1, c1: sel.c1, r2: Math.min(sel.r2, Math.max(sel.r1, u.r2)), c2: Math.min(sel.c2, Math.max(sel.c1, u.c2)) };
  };

  const select = useCallback(
    (r: number, c: number, extend = false) => {
      const rr = Math.max(0, Math.min(sheet.rows - 1, r));
      const cc = Math.max(0, Math.min(sheet.cols - 1, c));
      if (extend) setSel(normRange(active, { r: rr, c: cc }));
      else {
        setActive({ r: rr, c: cc });
        const m = mergeAt(sheet, rr, cc);
        setSel(m ? { ...m } : { r1: rr, c1: cc, r2: rr, c2: cc });
      }
      // grow the sheet as you go down/right
      if (rr > sheet.rows - 30 || cc > sheet.cols - 5) {
        setWbRaw((w) => ({ ...w, sheets: w.sheets.map((s, i) => (i === w.active ? { ...s, rows: Math.max(s.rows, rr + 1000), cols: Math.max(s.cols, cc + 26) } : s)) }));
      }
      const sv = scrollRef.current;
      if (sv) {
        const t = scrollToShow(geo, extend ? rr : rr, extend ? cc : cc, size.w, size.h, sv.scrollLeft, sv.scrollTop);
        if (t) sv.scrollTo({ left: t.x, top: t.y });
      }
    },
    [active, geo, sheet, size],
  );

  const setCellsIn = (g: Range, f: (cell: Cell | undefined, r: number, c: number) => Cell | undefined) =>
    updateSheet((s) => {
      const cells = { ...s.cells };
      forEachCell(g, (r, c) => {
        const k = key(r, c);
        const next = f(cells[k], r, c);
        if (next && (next.v !== undefined || next.s || next.note || next.link)) cells[k] = next;
        else delete cells[k];
      });
      return { ...s, cells };
    });

  const applyStyle = (patch: Partial<CellStyle>) => {
    const g = boundedSel();
    updateSheet((sh) => {
      const cells = { ...sh.cells };
      forEachCell(g, (r, c) => {
        const k = key(r, c);
        const cell = cells[k];
        const st = { ...(cell?.s ?? {}), ...patch };
        for (const p of Object.keys(st) as (keyof CellStyle)[]) if (st[p] === undefined || st[p] === null || st[p] === false) delete st[p];
        const next = { ...(cell ?? {}), s: Object.keys(st).length ? st : undefined };
        if (next.v !== undefined || next.s || next.note || next.link) cells[k] = next;
        else delete cells[k];
      });
      // Like Excel, a bigger font makes its rows taller so the text isn't clipped (rows only grow,
      // so a height the user set by hand is never shrunk).
      if (!patch.size || patch.size <= 11) return { ...sh, cells };
      const rowH = { ...sh.rowH };
      const need = Math.ceil((patch.size * 96) / 72 * 1.3 + 6);
      for (let r = g.r1; r <= Math.min(g.r2, g.r1 + 2000); r++) if ((rowH[r] ?? DEFAULT_ROW_H) < need) rowH[r] = need;
      return { ...sh, cells, rowH };
    });
    focusSink();
  };
  const toggle = (k: "bold" | "italic" | "underline" | "strike" | "wrap") => applyStyle({ [k]: !activeStyle[k] });

  const writeCell = (r: number, c: number, raw: string): boolean => {
    // drop-down validation
    const rule = sheet.validations.find((v) => {
      const g = parseRangeText(v.range);
      return g && r >= g.r1 && r <= g.r2 && c >= g.c1 && c <= g.c2;
    });
    if (rule?.list && raw && !raw.startsWith("=") && !rule.list.some((x) => x.toLowerCase() === raw.trim().toLowerCase())) {
      flash(`That cell only accepts: ${rule.list.join(", ")}`);
      return false;
    }
    const p = parseInput(raw);
    // Like Excel, a formula that returns a date or time is shown as one.
    if (typeof p.v === "string" && p.v.startsWith("=") && !p.fmt) {
      const fn = /^=\s*([A-Z.]+)\(/i.exec(p.v)?.[1]?.toUpperCase();
      if (fn && ["TODAY", "DATE", "EDATE", "EOMONTH", "WORKDAY", "DATEVALUE"].includes(fn)) p.fmt = "yyyy-mm-dd";
      else if (fn === "NOW") p.fmt = "yyyy-mm-dd h:mm";
      else if (fn === "TIME" || fn === "TIMEVALUE") p.fmt = "h:mm";
    }
    setCellsIn({ r1: r, c1: c, r2: r, c2: c }, (cell) => {
      const s = cell?.s ? { ...cell.s } : undefined;
      const style = p.fmt && !s?.fmt ? { ...(s ?? {}), fmt: p.fmt } : s;
      return { ...(cell ?? {}), v: p.v === null ? undefined : p.v, s: style };
    });
    return true;
  };

  // ---------- editing
  const startEdit = (initialText?: string, source: "cell" | "bar" = "cell") => {
    const cell = sheet.cells[key(active.r, active.c)];
    const v = cell?.v;
    const text = initialText ?? (v === undefined || v === null ? "" : typeof v === "boolean" ? (v ? "TRUE" : "FALSE") : typeof v === "number" && cell?.s?.fmt && /%/.test(cell.s.fmt) ? `${+(v * 100).toPrecision(12)}%` : String(v));
    setEditing({ r: active.r, c: active.c, text, source, typed: initialText !== undefined });
    setAcIndex(0);
    if (source === "cell")
      requestAnimationFrame(() => {
        const el = editorRef.current;
        if (el) {
          el.focus({ preventScroll: true });
          el.setSelectionRange(el.value.length, el.value.length);
        }
      });
  };

  /** Excel: after Tab, Tab, Enter the cursor goes back to the column where the Tabs started. */
  const tabAnchor = useRef<{ r: number; c: number } | null>(null);
  const commitEdit = (move: "down" | "up" | "right" | "left" | null = "down") => {
    if (!editing) return;
    const ok = writeCell(editing.r, editing.c, editing.text);
    if (!ok) return;
    setEditing(null);
    if (move === "right") {
      if (!tabAnchor.current || tabAnchor.current.r !== editing.r) tabAnchor.current = { r: editing.r, c: editing.c };
    } else if (move !== "down") tabAnchor.current = null;
    if (move === "down" && tabAnchor.current && tabAnchor.current.r === editing.r) {
      const c = tabAnchor.current.c;
      tabAnchor.current = null;
      select(editing.r + 1, c);
    } else if (move === "down") select(editing.r + 1, editing.c);
    else if (move === "up") select(editing.r - 1, editing.c);
    else if (move === "right") select(editing.r, editing.c + 1);
    else if (move === "left") select(editing.r, editing.c - 1);
    focusSink();
  };
  const cancelEdit = () => {
    setEditing(null);
    focusSink();
  };

  /** Formula autocomplete: the function name being typed at the end of the text. */
  const acToken = editing && editing.text.startsWith("=") ? /([A-Za-z][A-Za-z0-9.]*)$/.exec(editing.text)?.[1] ?? "" : "";
  const acList = acToken && acToken.length >= 1 && !/^[A-Za-z]{1,3}\d+$/.test(acToken) ? FUNCTION_NAMES.filter((n) => n.startsWith(acToken.toUpperCase())).slice(0, 8) : [];
  const fnHint = (() => {
    if (!editing?.text.startsWith("=")) return null;
    let depth = 0;
    for (let i = editing.text.length - 1; i >= 0; i--) {
      const ch = editing.text[i];
      if (ch === ")") depth++;
      else if (ch === "(") {
        if (depth === 0) {
          const m = /([A-Za-z][A-Za-z0-9.]*)$/.exec(editing.text.slice(0, i));
          return m && FUNCTION_INFO[m[1].toUpperCase()] ? FUNCTION_INFO[m[1].toUpperCase()] : null;
        }
        depth--;
      }
    }
    return null;
  })();
  const applyAutocomplete = (fn: string) => {
    if (!editing) return;
    const text = editing.text.slice(0, editing.text.length - acToken.length) + fn + "(";
    setEditing({ ...editing, text });
    requestAnimationFrame(() => (editing.source === "bar" ? barRef.current : editorRef.current)?.focus());
  };
  const canPoint = editing && editing.text.startsWith("=") && /[=(,+\-*/^&<>:;]$/.test(editing.text.trimEnd());

  // ---------- clipboard
  const copyOut = (cut: boolean, e?: ClipboardEvent | React.ClipboardEvent) => {
    const g = boundedSel();
    const cells: (Cell | undefined)[][] = [];
    const lines: string[] = [];
    for (let r = g.r1; r <= g.r2; r++) {
      const row: (Cell | undefined)[] = [];
      const txt: string[] = [];
      for (let c = g.c1; c <= g.c2; c++) {
        row.push(sheet.cells[key(r, c)]);
        const v = comp.values.get(key(r, c)) ?? null;
        txt.push(v === null ? "" : typeof v === "number" ? formatValue(v, sheet.cells[key(r, c)]?.s?.fmt) : isError(v) ? v.code : String(v));
      }
      cells.push(row);
      lines.push(txt.join("\t"));
    }
    const text = lines.join("\n");
    setClip({ sheet: si, range: g, cells, cut, text });
    if (e && "clipboardData" in e && e.clipboardData) {
      e.preventDefault();
      e.clipboardData.setData("text/plain", text);
    } else navigator.clipboard?.writeText(text).catch(() => {});
  };

  const pasteIn = (text: string, valuesOnly = false) => {
    const internal = clip && clip.text === text.replace(/\r\n/g, "\n").replace(/\n$/, "");
    if (internal && clip) {
      const h = clip.cells.length;
      const w = clip.cells[0]?.length ?? 0;
      // A single copied cell fills the whole selection.
      const tr = h === 1 && w === 1 ? sel.r2 - sel.r1 + 1 : h;
      const tc = h === 1 && w === 1 ? sel.c2 - sel.c1 + 1 : w;
      const dr = sel.r1 - clip.range.r1;
      const dc = sel.c1 - clip.range.c1;
      commit((wbk) => {
        const sheets = wbk.sheets.map((s) => ({ ...s, cells: { ...s.cells } }));
        if (clip.cut) forEachCell(clip.range, (r, c) => delete sheets[clip.sheet].cells[key(r, c)]);
        const dest = sheets[wbk.active];
        for (let i = 0; i < tr; i++)
          for (let j = 0; j < tc; j++) {
            const src = clip.cells[i % h][j % w];
            const k = key(sel.r1 + i, sel.c1 + j);
            if (!src) {
              delete dest.cells[k];
              continue;
            }
            let v = src.v;
            if (typeof v === "string" && v.startsWith("=")) {
              if (valuesOnly) v = comp.values.get(key(clip.range.r1 + (i % h), clip.range.c1 + (j % w))) as never;
              else if (!clip.cut) v = shiftFormula(v, dr + (h === 1 ? i : 0), dc + (w === 1 ? j : 0));
            }
            dest.cells[k] = valuesOnly ? { v: v as Cell["v"], s: dest.cells[k]?.s } : { ...src, v };
          }
        return { ...wbk, sheets };
      });
      setSel({ r1: sel.r1, c1: sel.c1, r2: sel.r1 + tr - 1, c2: sel.c1 + tc - 1 });
      if (clip.cut) setClip(null);
      return;
    }
    const rows = text.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n").map((l) => l.split("\t"));
    commit((wbk) => {
      const sheets = wbk.sheets.map((s, i) => (i === wbk.active ? { ...s, cells: { ...s.cells } } : s));
      const dest = sheets[wbk.active];
      rows.forEach((row, i) =>
        row.forEach((v, j) => {
          const k = key(sel.r1 + i, sel.c1 + j);
          const p = parseInput(v);
          if (p.v === null) delete dest.cells[k];
          else dest.cells[k] = { ...dest.cells[k], v: p.v, s: p.fmt ? { ...(dest.cells[k]?.s ?? {}), fmt: p.fmt } : dest.cells[k]?.s };
        }),
      );
      return { ...wbk, sheets };
    });
    setSel({ r1: sel.r1, c1: sel.c1, r2: sel.r1 + rows.length - 1, c2: sel.c1 + Math.max(...rows.map((r) => r.length)) - 1 });
  };

  const pasteFromButton = async (valuesOnly = false) => {
    try {
      const text = await navigator.clipboard.readText();
      pasteIn(text, valuesOnly);
    } catch {
      flash("Press Ctrl/⌘+V to paste (the browser blocked reading the clipboard).");
    }
    focusSink();
  };

  // ---------- commands
  const clearSel = (what: "contents" | "formats" | "all") =>
    setCellsIn(boundedSel(), (cell) => {
      if (!cell) return undefined;
      if (what === "all") return undefined;
      if (what === "contents") return { ...cell, v: undefined };
      return { ...cell, s: undefined };
    });

  const insertDel = (kind: "row" | "col", where: "before" | "after" | "delete") => {
    const at = kind === "row" ? (where === "after" ? sel.r2 + 1 : sel.r1) : where === "after" ? sel.c2 + 1 : sel.c1;
    const n = kind === "row" ? sel.r2 - sel.r1 + 1 : sel.c2 - sel.c1 + 1;
    commit((w) => insertDelete(w, w.active, kind, at, where === "delete" ? -n : n));
  };

  const mergeSel = (mode: "center" | "across" | "merge" | "unmerge") => {
    updateSheet((s) => {
      const overlaps = (m: Range) => !(m.r2 < sel.r1 || m.r1 > sel.r2 || m.c2 < sel.c1 || m.c1 > sel.c2);
      const merges = s.merges.filter((m) => !overlaps(m));
      if (mode === "unmerge") return { ...s, merges };
      const cells = { ...s.cells };
      const add: Range[] = mode === "across" ? Array.from({ length: sel.r2 - sel.r1 + 1 }, (_, i) => ({ r1: sel.r1 + i, c1: sel.c1, r2: sel.r1 + i, c2: sel.c2 })) : [sel];
      for (const m of add) {
        if (m.r1 === m.r2 && m.c1 === m.c2) continue;
        forEachCell(m, (r, c) => {
          if (r === m.r1 && c === m.c1) return;
          if (cells[key(r, c)]) delete cells[key(r, c)];
        });
        if (mode === "center" || mode === "across") cells[key(m.r1, m.c1)] = { ...(cells[key(m.r1, m.c1)] ?? {}), s: { ...(cells[key(m.r1, m.c1)]?.s ?? {}), align: "center" } };
        merges.push(m);
      }
      return { ...s, merges, cells };
    });
  };

  const setBorders = (preset: string, side: BorderSide | null) => {
    const g = boundedSel();
    setCellsIn(g, (cell, r, c) => {
      const s: CellStyle = { ...(cell?.s ?? {}) };
      const b = side ?? undefined;
      const outer = { t: r === g.r1, b: r === g.r2, l: c === g.c1, r: c === g.c2 };
      if (preset === "none") {
        delete s.bt;
        delete s.bb;
        delete s.bl;
        delete s.br;
      }
      if (preset === "all") Object.assign(s, { bt: b, bb: b, bl: b, br: b });
      if (preset === "outside") {
        if (outer.t) s.bt = b;
        if (outer.b) s.bb = b;
        if (outer.l) s.bl = b;
        if (outer.r) s.br = b;
      }
      if (preset === "inside") {
        if (!outer.b) s.bb = b;
        if (!outer.r) s.br = b;
      }
      if (preset === "top" && outer.t) s.bt = b;
      if ((preset === "bottom" || preset === "thickBottom") && outer.b) s.bb = b;
      if (preset === "left" && outer.l) s.bl = b;
      if (preset === "right" && outer.r) s.br = b;
      for (const k of ["bt", "bb", "bl", "br"] as const) if (!s[k]) delete s[k];
      return { ...(cell ?? {}), s: Object.keys(s).length ? s : undefined };
    });
  };

  const changeDecimals = (delta: number) => {
    const v = comp.values.get(key(active.r, active.c));
    const fmt = activeStyle.fmt ?? (typeof v === "number" && !Number.isInteger(v) ? `0.${"0".repeat(Math.min(10, String(v).split(".")[1]?.length ?? 0))}` : "0");
    const m = /(0+)(\.(0*))?/.exec(fmt);
    if (!m) return;
    const decs = Math.max(0, (m[3]?.length ?? 0) + delta);
    const repl = `${m[1]}${decs ? "." + "0".repeat(decs) : ""}`;
    applyStyle({ fmt: fmt.replace(/0+(\.0*)?/g, repl) });
  };

  const autoSum = (fn = "SUM") => {
    const { r, c } = active;
    if (sel.r1 !== sel.r2 || sel.c1 !== sel.c2) {
      // a selected column/row block: put totals under each column
      const target = sel.r2 + 1;
      updateSheet((s) => {
        const cells = { ...s.cells };
        for (let cc = sel.c1; cc <= sel.c2; cc++) cells[key(target, cc)] = { ...(cells[key(target, cc)] ?? {}), v: `=${fn}(${addr(sel.r1, cc)}:${addr(sel.r2, cc)})` };
        return { ...s, cells };
      });
      return;
    }
    let top = r - 1;
    while (top >= 0 && typeof comp.values.get(key(top, c)) === "number") top--;
    let left = c - 1;
    while (left >= 0 && typeof comp.values.get(key(r, left)) === "number") left--;
    const range = top < r - 1 ? `${addr(top + 1, c)}:${addr(r - 1, c)}` : left < c - 1 ? `${addr(r, left + 1)}:${addr(r, c - 1)}` : "";
    setEditing({ r, c, text: `=${fn}(${range})`, source: "cell", typed: false });
    requestAnimationFrame(() => editorRef.current?.focus());
  };

  const fillDir = (dir: "down" | "right") => {
    const g = boundedSel();
    setCellsIn(g, (cell, r, c) => {
      const srcR = dir === "down" ? g.r1 : r;
      const srcC = dir === "right" ? g.c1 : c;
      if (r === srcR && c === srcC) return cell;
      const src = sheet.cells[key(srcR, srcC)];
      if (!src) return undefined;
      const v = typeof src.v === "string" && src.v.startsWith("=") ? shiftFormula(src.v, r - srcR, c - srcC) : src.v;
      return { ...src, v };
    });
  };

  const doFillHandle = (target: Range) => {
    // extend sel to target using series / formula shifting
    const down = target.r2 > sel.r2;
    const up = target.r1 < sel.r1;
    const right = target.c2 > sel.c2;
    const left = target.c1 < sel.c1;
    updateSheet((s) => {
      const cells = { ...s.cells };
      if (down || up) {
        const count = down ? target.r2 - sel.r2 : sel.r1 - target.r1;
        for (let c = sel.c1; c <= sel.c2; c++) {
          const seedCells = Array.from({ length: sel.r2 - sel.r1 + 1 }, (_, i) => s.cells[key(sel.r1 + i, c)]);
          const anyFormula = seedCells.some((x) => typeof x?.v === "string" && x.v.startsWith("="));
          const seeds = up ? [...seedCells].reverse() : seedCells;
          const series = anyFormula ? [] : fillSeries(seeds.map((x) => x?.v ?? null), count);
          for (let i = 0; i < count; i++) {
            const r = down ? sel.r2 + 1 + i : sel.r1 - 1 - i;
            const src = seeds[i % seeds.length];
            const srcR = down ? sel.r1 + (i % seedCells.length) : sel.r2 - (i % seedCells.length);
            const v = anyFormula ? (typeof src?.v === "string" && src.v.startsWith("=") ? shiftFormula(src.v, r - srcR, 0) : src?.v) : series[i];
            if (v === null || v === undefined) delete cells[key(r, c)];
            else cells[key(r, c)] = { ...(src ?? {}), v };
          }
        }
      } else if (left || right) {
        const count = right ? target.c2 - sel.c2 : sel.c1 - target.c1;
        for (let r = sel.r1; r <= sel.r2; r++) {
          const seedCells = Array.from({ length: sel.c2 - sel.c1 + 1 }, (_, j) => s.cells[key(r, sel.c1 + j)]);
          const anyFormula = seedCells.some((x) => typeof x?.v === "string" && x.v.startsWith("="));
          const seeds = left ? [...seedCells].reverse() : seedCells;
          const series = anyFormula ? [] : fillSeries(seeds.map((x) => x?.v ?? null), count);
          for (let i = 0; i < count; i++) {
            const c = right ? sel.c2 + 1 + i : sel.c1 - 1 - i;
            const src = seeds[i % seeds.length];
            const srcC = right ? sel.c1 + (i % seedCells.length) : sel.c2 - (i % seedCells.length);
            const v = anyFormula ? (typeof src?.v === "string" && src.v.startsWith("=") ? shiftFormula(src.v, 0, c - srcC) : src?.v) : series[i];
            if (v === null || v === undefined) delete cells[key(r, c)];
            else cells[key(r, c)] = { ...(src ?? {}), v };
          }
        }
      }
      return { ...s, cells };
    });
    setSel(normRange({ r: Math.min(target.r1, sel.r1), c: Math.min(target.c1, sel.c1) }, { r: Math.max(target.r2, sel.r2), c: Math.max(target.c2, sel.c2) }));
  };

  const autofitCol = (c: number) => {
    const cv = canvasRef.current?.getContext("2d");
    if (!cv) return;
    let w = 30;
    for (const k in sheet.cells) {
      const p = unkey(k);
      if (p.c !== c) continue;
      const s = sheet.cells[k].s;
      cv.font = cellFont(s, 1);
      const v = comp.values.get(k) ?? null;
      const text = v === null ? "" : typeof v === "number" ? formatValue(v, s?.fmt) : String(isError(v) ? v.code : v);
      w = Math.max(w, cv.measureText(text).width + 12);
    }
    updateSheet((s) => ({ ...s, colW: { ...s.colW, [c]: Math.min(600, Math.ceil(w)) } }));
  };

  const currentRegion = (): Range => {
    if (sel.r1 !== sel.r2 || sel.c1 !== sel.c2) return boundedSel();
    let { r1, c1, r2, c2 } = { r1: active.r, c1: active.c, r2: active.r, c2: active.c };
    const filled = (r: number, c: number) => r >= 0 && c >= 0 && comp.values.get(key(r, c)) !== undefined && comp.values.get(key(r, c)) !== null && comp.values.get(key(r, c)) !== "";
    let changed = true;
    while (changed) {
      changed = false;
      for (let c = c1; c <= c2; c++) {
        if (filled(r1 - 1, c)) { r1--; changed = true; break; }
      }
      for (let c = c1; c <= c2; c++) {
        if (filled(r2 + 1, c)) { r2++; changed = true; break; }
      }
      for (let r = r1; r <= r2; r++) {
        if (filled(r, c1 - 1)) { c1--; changed = true; break; }
      }
      for (let r = r1; r <= r2; r++) {
        if (filled(r, c2 + 1)) { c2++; changed = true; break; }
      }
    }
    // A title line sitting on top of a table ("Quarterly sales" above the header row) isn't part of
    // it: filters, sorting and charts must start at the real header row.
    const count = (r: number) => {
      let n = 0;
      for (let c = c1; c <= c2; c++) if (filled(r, c)) n++;
      return n;
    };
    while (r1 < active.r && r2 - r1 >= 2 && count(r1) <= 1 && count(r1 + 1) > 1) r1++;
    return { r1, c1, r2, c2 };
  };

  const sortQuick = (desc: boolean) => {
    const g = currentRegion();
    const first = comp.values.get(key(g.r1, active.c));
    const second = comp.values.get(key(g.r1 + 1, active.c));
    const hasHeader = typeof first === "string" && (typeof second === "number" || g.r2 > g.r1);
    updateSheet((s) => sortRange(s, comp.values, g, [{ col: active.c, desc }], hasHeader && typeof first === "string"));
  };

  const toggleFilter = () => {
    if (sheet.filter) {
      updateSheet((s) => ({ ...s, filter: undefined, hiddenRows: [] }));
      return;
    }
    const g = currentRegion();
    updateSheet((s) => ({ ...s, filter: { range: `${addr(g.r1, g.c1)}:${addr(g.r2, g.c2)}`, criteria: {} } }));
  };

  const applyFilter = (col: number, values: string[] | undefined) => {
    updateSheet((s) => {
      if (!s.filter) return s;
      const g = parseRangeText(s.filter.range)!;
      const criteria = { ...s.filter.criteria, [col]: { ...(s.filter.criteria[col] ?? {}), values } };
      const hidden: number[] = [];
      for (let r = g.r1 + 1; r <= g.r2; r++) {
        for (const [cStr, crit] of Object.entries(criteria)) {
          if (!crit.values) continue;
          const v = comp.values.get(key(r, Number(cStr))) ?? null;
          const txt = v === null ? "(Blanks)" : typeof v === "number" ? formatValue(v, s.cells[key(r, Number(cStr))]?.s?.fmt) : String(isError(v) ? v.code : v);
          if (!crit.values.includes(txt)) {
            hidden.push(r);
            break;
          }
        }
      }
      return { ...s, filter: { ...s.filter, criteria }, hiddenRows: hidden };
    });
  };

  const download = (kind: "xlsx" | "csv" | "tsv" | "html" | "pdf" | "json") => {
    const base = (name || "workbook").replace(/[\\/:*?"<>|]+/g, " ").trim() || "workbook";
    if (kind === "xlsx") saveBlob(exportXlsx(wb, computed, base), `${base}.xlsx`);
    else if (kind === "csv") saveBlob(new Blob(["﻿" + exportDelimited(sheet, comp, ",")], { type: "text/csv;charset=utf-8" }), `${base}${wb.sheets.length > 1 ? "-" + sheet.name : ""}.csv`);
    else if (kind === "tsv") saveBlob(new Blob([exportDelimited(sheet, comp, "\t")], { type: "text/tab-separated-values;charset=utf-8" }), `${base}.tsv`);
    else if (kind === "html") saveBlob(new Blob([sheetToHtml(sheet, comp, { title: base })], { type: "text/html;charset=utf-8" }), `${base}.html`);
    else if (kind === "pdf") printHtml(sheetToHtml(sheet, comp, { title: base, gridlines: sheet.gridlines }));
    else saveBlob(new Blob([JSON.stringify(wb.sheets.map((s, i) => ({ sheet: s.name, rows: rowsOf(s, computed[i]) })), null, 2)], { type: "application/json" }), `${base}.json`);
  };

  const openFile = async (f: File) => {
    const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
    try {
      let next: Workbook;
      if (ext === "xlsx" || ext === "xlsm" || ext === "xltx") next = importXlsx(new Uint8Array(await f.arrayBuffer()));
      else if (["csv", "tsv", "txt"].includes(ext)) next = importDelimited(await f.text(), f.name.replace(/\.[^.]+$/, ""));
      else if (["xls", "ods", "numbers"].includes(ext)) {
        flash("Converting on the server…");
        const form = new FormData();
        form.append("file", f, f.name);
        form.append("target", "xlsx");
        const out = await uploadForm("/api/tools/universal/convert", form, { fallbackName: "converted.xlsx" });
        next = importXlsx(new Uint8Array(await out.blob.arrayBuffer()));
      } else throw new Error("Open an Excel (.xlsx, .xls), OpenDocument (.ods) or CSV/TSV file.");
      const id = newDocId();
      const nm = f.name.replace(/\.[^.]+$/, "");
      await saveDoc({ id, app: "sheet", name: nm }, { name: nm, wb: next });
      onSwitch(id, { name: nm, wb: next });
    } catch (e) {
      flash(e instanceof Error ? e.message : "That file couldn't be opened.");
    }
  };

  const newDoc = async (wbk = blankWorkbook(), nm = "Book1") => {
    const id = newDocId();
    await saveDoc({ id, app: "sheet", name: nm }, { name: nm, wb: wbk });
    onSwitch(id, { name: nm, wb: wbk });
  };

  // find & replace
  const findRef = useRef<{ q: string; idx: number }>({ q: "", idx: -1 });
  const matches = (q: string, opts: FindOpts) => {
    const out: { si: number; r: number; c: number }[] = [];
    const test = (s: string) => (opts.whole ? (opts.matchCase ? s === q : s.toLowerCase() === q.toLowerCase()) : opts.matchCase ? s.includes(q) : s.toLowerCase().includes(q.toLowerCase()));
    (opts.allSheets ? wb.sheets.map((_, i) => i) : [si]).forEach((i) => {
      const s = wb.sheets[i];
      const keys = Object.keys(s.cells).map(unkey).sort((a, b) => a.r - b.r || a.c - b.c);
      for (const { r, c } of keys) {
        const cell = s.cells[key(r, c)];
        const raw = cell.v;
        const shown = opts.formulas ? String(raw ?? "") : (() => {
          const v = computed[i].values.get(key(r, c)) ?? null;
          return v === null ? "" : typeof v === "number" ? formatValue(v, cell.s?.fmt) : String(isError(v) ? v.code : v);
        })();
        if (shown && test(shown)) out.push({ si: i, r, c });
      }
    });
    return out;
  };
  const onFind = (q: string, opts: FindOpts) => {
    const list = matches(q, opts);
    if (!list.length) return 0;
    findRef.current = { q, idx: findRef.current.q === q ? (findRef.current.idx + 1) % list.length : 0 };
    const m = list[findRef.current.idx];
    if (m.si !== si) setWbRaw((w) => ({ ...w, active: m.si }));
    select(m.r, m.c);
    return list.length;
  };
  const replaceIn = (raw: Cell["v"], q: string, r: string, opts: FindOpts) => {
    if (typeof raw !== "string" && typeof raw !== "number") return raw;
    const s = String(raw);
    if (opts.whole) return (opts.matchCase ? s === q : s.toLowerCase() === q.toLowerCase()) ? r : raw;
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), opts.matchCase ? "g" : "gi");
    const out = s.replace(re, r);
    return out === s ? raw : parseInput(out).v ?? "";
  };
  const onReplace = (q: string, r: string, opts: FindOpts) => {
    const cell = sheet.cells[key(active.r, active.c)];
    if (cell) setCellsIn({ r1: active.r, c1: active.c, r2: active.r, c2: active.c }, (c) => ({ ...c!, v: replaceIn(c!.v, q, r, { ...opts, formulas: true }) as Cell["v"] }));
    onFind(q, opts);
  };
  const onReplaceAll = (q: string, r: string, opts: FindOpts) => {
    const list = matches(q, { ...opts, formulas: true });
    commit((w) => ({
      ...w,
      sheets: w.sheets.map((s, i) => {
        const hits = list.filter((m) => m.si === i);
        if (!hits.length) return s;
        const cells = { ...s.cells };
        for (const m of hits) cells[key(m.r, m.c)] = { ...cells[key(m.r, m.c)], v: replaceIn(cells[key(m.r, m.c)].v, q, r, opts) as Cell["v"] };
        return { ...s, cells };
      }),
    }));
    return list.length;
  };

  // ---------- keyboard (when not editing)
  const onSinkKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    const move = (dr: number, dc: number) => {
      e.preventDefault();
      const from = e.shiftKey ? { r: sel.r1 === active.r ? sel.r2 : sel.r1, c: sel.c1 === active.c ? sel.c2 : sel.c1 } : active;
      let r = from.r + dr;
      let c = from.c + dc;
      if (mod) {
        // jump to the edge of the data region
        const has = (rr: number, cc: number) => {
          const v = comp.values.get(key(rr, cc));
          return v !== undefined && v !== null && v !== "";
        };
        r = from.r;
        c = from.c;
        const startFilled = has(r, c) && has(r + dr, c + dc);
        while (r + dr >= 0 && c + dc >= 0 && r + dr < sheet.rows && c + dc < sheet.cols) {
          if (startFilled ? !has(r + dr, c + dc) : has(r + dr, c + dc)) {
            if (!startFilled) {
              r += dr;
              c += dc;
            }
            break;
          }
          r += dr;
          c += dc;
          if (!startFilled && Math.abs(r - from.r) + Math.abs(c - from.c) > 5000) break;
        }
      }
      if (e.shiftKey) setSel(normRange(active, { r: Math.max(0, r), c: Math.max(0, c) }));
      else select(r, c);
      const sv = scrollRef.current;
      if (sv && e.shiftKey) {
        const t = scrollToShow(geo, Math.max(0, r), Math.max(0, c), size.w, size.h, sv.scrollLeft, sv.scrollTop);
        if (t) sv.scrollTo({ left: t.x, top: t.y });
      }
    };
    if (k === "ArrowDown") return move(1, 0);
    if (k === "ArrowUp") return move(-1, 0);
    if (k === "ArrowRight") return move(0, 1);
    if (k === "ArrowLeft") return move(0, -1);
    if (k === "PageDown") return move(Math.max(1, Math.floor(size.h / (DEFAULT_ROW_H * zoom)) - 2), 0);
    if (k === "PageUp") return move(-Math.max(1, Math.floor(size.h / (DEFAULT_ROW_H * zoom)) - 2), 0);
    if (k === "Home") {
      e.preventDefault();
      return mod ? select(0, 0) : select(active.r, 0);
    }
    if (k === "End" && mod) {
      e.preventDefault();
      const u = usedRange(sheet, comp);
      return select(Math.max(0, u.r2), Math.max(0, u.c2));
    }
    if (k === "Enter" || k === "Tab") {
      e.preventDefault();
      const multi = sel.r1 !== sel.r2 || sel.c1 !== sel.c2;
      if (mod && k === "Enter") return;
      if (multi) {
        // move within the selection
        let { r, c } = active;
        if (k === "Tab") c += e.shiftKey ? -1 : 1;
        else r += e.shiftKey ? -1 : 1;
        if (c > sel.c2) {
          c = sel.c1;
          r++;
        }
        if (r > sel.r2) {
          r = sel.r1;
          c = k === "Enter" ? (c + 1 > sel.c2 ? sel.c1 : c + 1) : c;
        }
        if (c < sel.c1) c = sel.c2;
        if (r < sel.r1) r = sel.r2;
        setActive({ r, c });
        return;
      }
      if (k === "Tab") return select(active.r, active.c + (e.shiftKey ? -1 : 1));
      return select(active.r + (e.shiftKey ? -1 : 1), active.c);
    }
    if (k === "F2") {
      e.preventDefault();
      return startEdit();
    }
    if (k === "Delete") {
      e.preventDefault();
      return clearSel("contents");
    }
    if (k === "Backspace") {
      e.preventDefault();
      clearSel("contents");
      return startEdit("");
    }
    if (k === "Escape") {
      setClip(null);
      setPainter(null);
      return;
    }
    if (mod) {
      const lk = k.toLowerCase();
      const handled = () => e.preventDefault();
      if (lk === "z") return handled(), e.shiftKey ? doRedo() : doUndo();
      if (lk === "y") return handled(), doRedo();
      if (lk === "b") return handled(), toggle("bold");
      if (lk === "i") return handled(), toggle("italic");
      if (lk === "u") return handled(), toggle("underline");
      if (lk === "5") return handled(), toggle("strike");
      if (lk === "a") return handled(), setSel({ r1: 0, c1: 0, r2: sheet.rows - 1, c2: sheet.cols - 1 });
      if (lk === "f") return handled(), setDialog("find");
      if (lk === "h") return handled(), setDialog("find");
      if (lk === "d") return handled(), fillDir("down");
      if (lk === "r") return handled(), fillDir("right");
      if (lk === "k") return handled(), setDialog("link");
      if (lk === "1") return handled(), setDialog("format");
      if (lk === "p") return handled(), download("pdf");
      if (lk === "s") return handled(), flash("Saved automatically in this browser. Use File → Download to get a copy.");
      if (k === ";") return handled(), writeCell(active.r, active.c, new Date().toISOString().slice(0, 10));
      if (k === ":" || (e.shiftKey && k === ";")) return handled(), writeCell(active.r, active.c, new Date().toTimeString().slice(0, 5));
      if (e.shiftKey && lk === "l") return handled(), toggleFilter();
      if (k === " ") return handled(), setSel({ r1: 0, c1: sel.c1, r2: sheet.rows - 1, c2: sel.c2 });
      if (k === "=" || k === "+") return handled(), insertDel("row", "before");
      if (k === "-") return handled(), insertDel("row", "delete");
    }
    if (e.altKey && k === "=") {
      e.preventDefault();
      return autoSum();
    }
    if (e.shiftKey && k === " ") {
      e.preventDefault();
      return setSel({ r1: sel.r1, c1: 0, r2: sel.r2, c2: sheet.cols - 1 });
    }
  };

  // ---------- pointer
  const localPoint = (e: { clientX: number; clientY: number }) => {
    const rect = areaRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const fillHandleHit = (x: number, y: number) => {
    const fx = colLeft(geo, sel.c2, scroll.x) + colWidth(geo, sel.c2);
    const fy = rowTop(geo, sel.r2, scroll.y) + rowHeight(geo, sel.r2);
    return Math.abs(x - fx) <= 7 && Math.abs(y - fy) <= 7;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 2) return;
    setCtxMenu(null);
    setFilterMenu(null);
    setListMenu(null);
    const { x, y } = localPoint(e);
    if (x > size.w - 14 || y > size.h - 14) return; // scrollbars
    const hit = hitTest(geo, x, y, scroll.x, scroll.y);
    const touch = e.pointerType === "touch";
    if (fillHandleHit(x, y) && !editing) {
      dragRef.current = { mode: "fill", start: { r: sel.r2, c: sel.c2 } };
      (e.target as Element).setPointerCapture?.(e.pointerId);
      e.preventDefault();
      return;
    }
    if (hit.kind === "colHeader" && hit.edge !== null && !touch) {
      dragRef.current = { mode: "colResize", start: { r: 0, c: hit.edge }, index: hit.edge, startPos: x, startSize: sheet.colW[hit.edge] ?? DEFAULT_COL_W };
      (e.target as Element).setPointerCapture?.(e.pointerId);
      e.preventDefault();
      return;
    }
    if (hit.kind === "rowHeader" && hit.edge !== null && !touch) {
      dragRef.current = { mode: "rowResize", start: { r: hit.edge, c: 0 }, index: hit.edge, startPos: y, startSize: sheet.rowH[hit.edge] ?? DEFAULT_ROW_H };
      (e.target as Element).setPointerCapture?.(e.pointerId);
      e.preventDefault();
      return;
    }
    if (hit.kind === "cell" && editing && canPoint) {
      // point mode: clicking a cell while typing a formula inserts its address
      e.preventDefault();
      const ref = addr(hit.r, hit.c);
      setEditing({ ...editing, text: editing.text + ref });
      dragRef.current = { mode: "point", start: { r: hit.r, c: hit.c }, pointStart: editing.text.length };
      (e.target as Element).setPointerCapture?.(e.pointerId);
      requestAnimationFrame(() => (editing.source === "bar" ? barRef.current : editorRef.current)?.focus());
      return;
    }
    if (editing) commitEdit(null);
    if (hit.kind === "corner") {
      setActive({ r: 0, c: 0 });
      setSel({ r1: 0, c1: 0, r2: sheet.rows - 1, c2: sheet.cols - 1 });
    } else if (hit.kind === "colHeader") {
      if (e.shiftKey) setSel({ r1: 0, c1: Math.min(active.c, hit.c), r2: sheet.rows - 1, c2: Math.max(active.c, hit.c) });
      else {
        setActive({ r: 0, c: hit.c });
        setSel({ r1: 0, c1: hit.c, r2: sheet.rows - 1, c2: hit.c });
      }
      dragRef.current = touch ? null : { mode: "select", start: { r: -1, c: hit.c } };
    } else if (hit.kind === "rowHeader") {
      if (e.shiftKey) setSel({ r1: Math.min(active.r, hit.r), c1: 0, r2: Math.max(active.r, hit.r), c2: sheet.cols - 1 });
      else {
        setActive({ r: hit.r, c: 0 });
        setSel({ r1: hit.r, c1: 0, r2: hit.r, c2: sheet.cols - 1 });
      }
      dragRef.current = touch ? null : { mode: "select", start: { r: hit.r, c: -1 } };
    } else {
      if ((e.ctrlKey || e.metaKey) && sheet.cells[key(hit.r, hit.c)]?.link) {
        window.open(sheet.cells[key(hit.r, hit.c)].link, "_blank", "noopener,noreferrer");
        return;
      }
      if (painter) {
        const g = normRange({ r: hit.r, c: hit.c }, { r: hit.r, c: hit.c });
        setCellsIn(g, (cell) => ({ ...(cell ?? {}), s: painter }));
        setPainter(null);
      }
      select(hit.r, hit.c, e.shiftKey);
      if (!touch) {
        dragRef.current = { mode: "select", start: e.shiftKey ? active : { r: hit.r, c: hit.c } };
        (e.target as Element).setPointerCapture?.(e.pointerId);
      }
    }
    focusSink();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    const { x, y } = localPoint(e);
    if (!d) {
      // hover: notes, cursor
      const hit = hitTest(geo, x, y, scroll.x, scroll.y);
      const el = scrollRef.current;
      if (el) el.style.cursor = (hit.kind === "colHeader" && hit.edge !== null) ? "col-resize" : (hit.kind === "rowHeader" && hit.edge !== null) ? "row-resize" : fillHandleHit(x, y) ? "crosshair" : hit.kind === "cell" ? "cell" : "default";
      if (hit.kind === "cell") {
        const m = mergeAt(sheet, hit.r, hit.c);
        const note = sheet.cells[key(m?.r1 ?? hit.r, m?.c1 ?? hit.c)]?.note;
        setHoverNote(note ? { text: note, x: colLeft(geo, hit.c, scroll.x) + colWidth(geo, hit.c) + 4, y: rowTop(geo, hit.r, scroll.y) } : null);
      } else setHoverNote(null);
      return;
    }
    const hit = hitTest(geo, Math.max(geo.headerW + 1, Math.min(size.w - 2, x)), Math.max(geo.headerH + 1, Math.min(size.h - 2, y)), scroll.x, scroll.y);
    // auto-scroll near the edges
    const sv = scrollRef.current;
    if (sv && (d.mode === "select" || d.mode === "fill" || d.mode === "point")) {
      if (x > size.w - 20) sv.scrollLeft += 20;
      else if (x < geo.headerW + 10 && sv.scrollLeft > 0) sv.scrollLeft -= 20;
      if (y > size.h - 20) sv.scrollTop += 20;
      else if (y < geo.headerH + 10 && sv.scrollTop > 0) sv.scrollTop -= 20;
    }
    if (d.mode === "colResize") {
      const w = Math.max(12, Math.round((d.startSize ?? 100) + (x - (d.startPos ?? 0)) / zoom));
      setWbRaw((wbk) => ({ ...wbk, sheets: wbk.sheets.map((s, i) => (i === wbk.active ? { ...s, colW: { ...s.colW, [d.index!]: w } } : s)) }));
    } else if (d.mode === "rowResize") {
      const h = Math.max(8, Math.round((d.startSize ?? 24) + (y - (d.startPos ?? 0)) / zoom));
      setWbRaw((wbk) => ({ ...wbk, sheets: wbk.sheets.map((s, i) => (i === wbk.active ? { ...s, rowH: { ...s.rowH, [d.index!]: h } } : s)) }));
    } else if (hit.kind === "cell") {
      if (d.mode === "select") {
        if (d.start.r === -1) setSel({ r1: 0, c1: Math.min(d.start.c, hit.c), r2: sheet.rows - 1, c2: Math.max(d.start.c, hit.c) });
        else if (d.start.c === -1) setSel({ r1: Math.min(d.start.r, hit.r), c1: 0, r2: Math.max(d.start.r, hit.r), c2: sheet.cols - 1 });
        else setSel(normRange(d.start, hit));
      } else if (d.mode === "fill") {
        const dr = hit.r > sel.r2 ? hit.r - sel.r2 : hit.r < sel.r1 ? hit.r - sel.r1 : 0;
        const dc = hit.c > sel.c2 ? hit.c - sel.c2 : hit.c < sel.c1 ? hit.c - sel.c1 : 0;
        if (Math.abs(dr) >= Math.abs(dc) && dr !== 0) setFillPreview(dr > 0 ? { r1: sel.r1, c1: sel.c1, r2: hit.r, c2: sel.c2 } : { r1: hit.r, c1: sel.c1, r2: sel.r2, c2: sel.c2 });
        else if (dc !== 0) setFillPreview(dc > 0 ? { r1: sel.r1, c1: sel.c1, r2: sel.r2, c2: hit.c } : { r1: sel.r1, c1: hit.c, r2: sel.r2, c2: sel.c2 });
        else setFillPreview(null);
      } else if (d.mode === "point" && editing) {
        const ref = d.start.r === hit.r && d.start.c === hit.c ? addr(hit.r, hit.c) : `${addr(Math.min(d.start.r, hit.r), Math.min(d.start.c, hit.c))}:${addr(Math.max(d.start.r, hit.r), Math.max(d.start.c, hit.c))}`;
        setEditing({ ...editing, text: editing.text.slice(0, d.pointStart) + ref });
      }
    }
  };

  const onPointerUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (d?.mode === "colResize" || d?.mode === "rowResize") {
      // record the resize as one undo step
      undo.current.push(wb);
    }
    if (d?.mode === "fill" && fillPreview) {
      doFillHandle(fillPreview);
      setFillPreview(null);
    }
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const { x, y } = localPoint(e);
    const hit = hitTest(geo, x, y, scroll.x, scroll.y);
    if (hit.kind === "colHeader" && hit.edge !== null) return autofitCol(hit.edge);
    if (hit.kind === "rowHeader" && hit.edge !== null) return updateSheet((s) => ({ ...s, rowH: Object.fromEntries(Object.entries(s.rowH).filter(([k]) => Number(k) !== hit.edge)) }));
    if (hit.kind === "cell") {
      if (fillHandleHit(x, y)) {
        // double-click the fill handle: fill down as far as the column to the left has data
        let r = sel.r2;
        while (comp.values.get(key(r + 1, sel.c1 - 1)) !== undefined && comp.values.get(key(r + 1, sel.c1 - 1)) !== null && r < sheet.rows - 1) r++;
        if (r > sel.r2) doFillHandle({ ...sel, r2: r });
        return;
      }
      startEdit();
    }
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const { x, y } = localPoint(e);
    const hit = hitTest(geo, x, y, scroll.x, scroll.y);
    if (hit.kind === "cell" && !(hit.r >= sel.r1 && hit.r <= sel.r2 && hit.c >= sel.c1 && hit.c <= sel.c2)) select(hit.r, hit.c);
    setCtxMenu({ x, y, kind: hit.kind === "colHeader" ? "col" : hit.kind === "rowHeader" ? "row" : "cell" });
  };

  // keep focus on the grid
  useEffect(() => {
    if (!editing && !dialog) focusSink();
  }, [editing, dialog]);

  // ---------- derived UI
  const selStats = useMemo(() => {
    const g = boundedSel();
    if (g.r1 === g.r2 && g.c1 === g.c2) return null;
    let sum = 0;
    let count = 0;
    let nums = 0;
    let min = Infinity;
    let max = -Infinity;
    let cells = 0;
    forEachCell(g, (r, c) => {
      if (++cells > 200_000) return;
      const v = comp.values.get(key(r, c));
      if (v === undefined || v === null || v === "") return;
      count++;
      if (typeof v === "number") {
        nums++;
        sum += v;
        min = Math.min(min, v);
        max = Math.max(max, v);
      }
    });
    return { sum, count, nums, avg: nums ? sum / nums : 0, min, max };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, comp]);

  const editorRect = editing && editing.source === "cell" ? (() => {
    const m = mergeAt(sheet, editing.r, editing.c);
    const c2 = m?.c2 ?? editing.c;
    const r2 = m?.r2 ?? editing.r;
    let w = 0;
    for (let c = editing.c; c <= c2; c++) w += colWidth(geo, c);
    let h = 0;
    for (let r = editing.r; r <= r2; r++) h += rowHeight(geo, r);
    return { x: colLeft(geo, editing.c, scroll.x), y: rowTop(geo, editing.r, scroll.y), w, h };
  })() : null;

  const validationAtActive = sheet.validations.find((v) => {
    const g = parseRangeText(v.range);
    return g && active.r >= g.r1 && active.r <= g.r2 && active.c >= g.c1 && active.c <= g.c2;
  });

  const filterRange = sheet.filter ? parseRangeText(sheet.filter.range) : null;
  const filterValues = (col: number) => {
    if (!filterRange) return [];
    const set = new Set<string>();
    for (let r = filterRange.r1 + 1; r <= filterRange.r2; r++) {
      const v = comp.values.get(key(r, col)) ?? null;
      set.add(v === null ? "(Blanks)" : typeof v === "number" ? formatValue(v, sheet.cells[key(r, col)]?.s?.fmt) : String(isError(v) ? v.code : v));
    }
    return [...set].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  };

  const content = contentSize(geo);
  const fmtLabel = NUMBER_FORMATS.find((f) => f.fmt === (activeStyle.fmt ?? "General"))?.label ?? "Custom";

  // ---------- ribbon
  const TABS = ["File", "Home", "Insert", "Formulas", "Data", "View"];
  const ribbon = (
    <Ribbon tabs={TABS} active={tab} onTab={setTab} right={<span className="hidden pr-2 text-xs text-ink-3 md:inline">{selText}</span>}>
      {tab === "File" && (
        <>
          <RGroup label="New">
            <RBtn big icon={FileSpreadsheet} label="Blank" showLabel onClick={() => newDoc()} />
            <RBtn big icon={Table2} label="Templates" showLabel onClick={() => setDialog("templates")} />
          </RGroup>
          <RGroup label="Download">
            <RBtn big icon={Download} label="Excel .xlsx" showLabel onClick={() => download("xlsx")} />
            <RBtn big icon={Download} label="CSV" showLabel onClick={() => download("csv")} />
            <RBtn big icon={Download} label="TSV" showLabel onClick={() => download("tsv")} />
            <RBtn big icon={Download} label="HTML" showLabel onClick={() => download("html")} />
            <RBtn big icon={Download} label="JSON" showLabel onClick={() => download("json")} />
          </RGroup>
          <RGroup label="Print">
            <RBtn big icon={Printer} label="Print / PDF" showLabel onClick={() => download("pdf")} />
          </RGroup>
        </>
      )}
      {tab === "Home" && (
        <>
          <RGroup label="Undo" maxW={36}>
            <RBtn icon={Undo2} label="Undo" shortcut="Ctrl+Z" onClick={doUndo} disabled={!undo.current.length} />
            <RBtn icon={Redo2} label="Redo" shortcut="Ctrl+Y" onClick={doRedo} disabled={!redo.current.length} />
          </RGroup>
          <RGroup label="Clipboard" maxW={108}>
            <Menu
              icon={ClipboardPaste}
              label="Paste"
              items={[
                { label: "Paste", shortcut: "Ctrl+V", onClick: () => pasteFromButton(false) },
                { label: "Paste values only", onClick: () => pasteFromButton(true) },
              ]}
            />
            <RBreak />
            <RBtn icon={Scissors} label="Cut" shortcut="Ctrl+X" onClick={() => copyOut(true)} />
            <RBtn icon={Copy} label="Copy" shortcut="Ctrl+C" onClick={() => copyOut(false)} />
            <RBtn icon={Paintbrush} label="Format painter" active={Boolean(painter)} onClick={() => setPainter(painter ? null : activeStyle)} />
          </RGroup>
          <RGroup label="Font" maxW={266}>
            <RSelect label="Font" value={activeStyle.font ?? "Calibri"} width={130} onChange={(v) => { ensureFont(v); applyStyle({ font: v === "Calibri" ? undefined : v }); }} options={FONTS.map((f) => ({ value: f, label: f, style: { fontFamily: f } }))} />
            <RSelect label="Font size" value={String(activeStyle.size ?? 11)} width={64} onChange={(v) => applyStyle({ size: Number(v) === 11 ? undefined : Number(v) })} options={FONT_SIZES.map((s) => ({ value: String(s), label: String(s) }))} />
            <RBtn icon={Bold} label="Bold" shortcut="Ctrl+B" active={Boolean(activeStyle.bold)} onClick={() => toggle("bold")} />
            <RBtn icon={Italic} label="Italic" shortcut="Ctrl+I" active={Boolean(activeStyle.italic)} onClick={() => toggle("italic")} />
            <RBreak />
            <RBtn icon={Underline} label="Underline" shortcut="Ctrl+U" active={Boolean(activeStyle.underline)} onClick={() => toggle("underline")} />
            <RBtn icon={Strikethrough} label="Strikethrough" shortcut="Ctrl+5" active={Boolean(activeStyle.strike)} onClick={() => toggle("strike")} />
            <Menu
              icon={Grid3x3}
              label="Borders"
              showLabel={false}
              items={[
                { label: "All borders", onClick: () => setBorders("all", { style: "thin", color: "#000000" }) },
                { label: "Outside borders", onClick: () => setBorders("outside", { style: "thin", color: "#000000" }) },
                { label: "Thick outside", onClick: () => setBorders("outside", { style: "thick", color: "#000000" }) },
                { label: "Inside borders", onClick: () => setBorders("inside", { style: "thin", color: "#000000" }) },
                { label: "Bottom border", onClick: () => setBorders("bottom", { style: "thin", color: "#000000" }) },
                { label: "Thick bottom", onClick: () => setBorders("bottom", { style: "thick", color: "#000000" }) },
                { label: "Double bottom", onClick: () => setBorders("bottom", { style: "double", color: "#000000" }) },
                { label: "Top border", onClick: () => setBorders("top", { style: "thin", color: "#000000" }) },
                { divider: true },
                { label: "No border", onClick: () => setBorders("none", null) },
                { label: "More…", onClick: () => setDialog("format") },
              ]}
            />
            <ColorButton icon={PaintBucket} label="Fill colour" value={activeStyle.fill} onChange={(c) => applyStyle({ fill: c ?? undefined })} />
            <ColorButton icon={Type} label="Font colour" value={activeStyle.color} onChange={(c) => applyStyle({ color: c ?? undefined })} />
          </RGroup>
          <RGroup label="Alignment" maxW={186}>
            <RBtn icon={AlignVerticalJustifyStart} label="Top" active={activeStyle.valign === "top"} onClick={() => applyStyle({ valign: "top" })} />
            <RBtn icon={AlignVerticalJustifyCenter} label="Middle" active={activeStyle.valign === "middle"} onClick={() => applyStyle({ valign: "middle" })} />
            <RBtn icon={AlignVerticalJustifyEnd} label="Bottom" active={!activeStyle.valign || activeStyle.valign === "bottom"} onClick={() => applyStyle({ valign: undefined })} />
            <RBtn icon={WrapText} label="Wrap text" active={Boolean(activeStyle.wrap)} onClick={() => toggle("wrap")} />
            <Menu
              icon={Merge}
              label="Merge"
              showLabel={false}
              items={[
                { label: "Merge & center", onClick: () => mergeSel("center") },
                { label: "Merge across", onClick: () => mergeSel("across") },
                { label: "Merge cells", onClick: () => mergeSel("merge") },
                { label: "Unmerge cells", onClick: () => mergeSel("unmerge") },
              ]}
            />
            <RBreak />
            <RBtn icon={AlignLeft} label="Align left" active={activeStyle.align === "left"} onClick={() => applyStyle({ align: activeStyle.align === "left" ? undefined : "left" })} />
            <RBtn icon={AlignCenter} label="Center" active={activeStyle.align === "center"} onClick={() => applyStyle({ align: activeStyle.align === "center" ? undefined : "center" })} />
            <RBtn icon={AlignRight} label="Align right" active={activeStyle.align === "right"} onClick={() => applyStyle({ align: activeStyle.align === "right" ? undefined : "right" })} />
            <RBtn icon={IndentDecrease} label="Decrease indent" onClick={() => applyStyle({ indent: Math.max(0, (activeStyle.indent ?? 0) - 1) || undefined })} />
            <RBtn icon={IndentIncrease} label="Increase indent" onClick={() => applyStyle({ indent: (activeStyle.indent ?? 0) + 1 })} />
          </RGroup>
          <RGroup label="Number" maxW={212}>
            <RSelect
              label="Number format"
              value={activeStyle.fmt ?? "General"}
              width={170}
              onChange={(v) => applyStyle({ fmt: v === "General" ? undefined : v })}
              options={NUMBER_FORMATS.map((f) => ({ value: f.fmt, label: f.label }))}
            />
            <span className="sr-only">{fmtLabel}</span>
            <RBreak />
            <RBtn label="Currency" onClick={() => applyStyle({ fmt: '"$"#,##0.00' })}>
              <span className="text-sm font-semibold">$</span>
            </RBtn>
            <RBtn icon={Percent} label="Percent" onClick={() => applyStyle({ fmt: "0%" })} />
            <RBtn label="Comma style" onClick={() => applyStyle({ fmt: "#,##0.00" })}>
              <span className="text-sm font-semibold">,</span>
            </RBtn>
            <RBtn label="Increase decimal" onClick={() => changeDecimals(1)}>
              <span className="text-[11px] font-semibold">.0→.00</span>
            </RBtn>
            <RBtn label="Decrease decimal" onClick={() => changeDecimals(-1)}>
              <span className="text-[11px] font-semibold">.00→.0</span>
            </RBtn>
          </RGroup>
          <RGroup label="Styles" maxW={170}>
            <RBtn icon={Palette} label="Conditional format" showLabel onClick={() => setDialog("cond")} />
            <RBreak />
            <Menu
              icon={SquareDashed}
              label="Cell styles"
              items={[
                { label: "Good", onClick: () => applyStyle({ fill: "#c6efce", color: "#006100" }) },
                { label: "Bad", onClick: () => applyStyle({ fill: "#ffc7ce", color: "#9c0006" }) },
                { label: "Neutral", onClick: () => applyStyle({ fill: "#ffeb9c", color: "#9c5700" }) },
                { label: "Title", onClick: () => applyStyle({ bold: true, size: 18, color: "#1f3864" }) },
                { label: "Heading 1", onClick: () => applyStyle({ bold: true, size: 15, color: "#1f3864", bb: { style: "thick", color: "#4472c4" } }) },
                { label: "Heading 2", onClick: () => applyStyle({ bold: true, size: 13, color: "#1f3864", bb: { style: "medium", color: "#a9c4eb" } }) },
                { label: "Total", onClick: () => applyStyle({ bold: true, bt: { style: "thin", color: "#4472c4" }, bb: { style: "double", color: "#4472c4" } }) },
                { label: "Note", onClick: () => applyStyle({ fill: "#ffffcc", bt: { style: "thin", color: "#b2b2b2" }, bb: { style: "thin", color: "#b2b2b2" }, bl: { style: "thin", color: "#b2b2b2" }, br: { style: "thin", color: "#b2b2b2" } }) },
                { label: "Accent", onClick: () => applyStyle({ fill: "#1a7f4b", color: "#ffffff", bold: true }) },
                { divider: true },
                { label: "Format cells…", shortcut: "Ctrl+1", onClick: () => setDialog("format") },
              ]}
            />
          </RGroup>
          <RGroup label="Cells" maxW={176}>
            <Menu
              icon={Plus}
              label="Insert"
              items={[
                { label: "Insert rows above", onClick: () => insertDel("row", "before") },
                { label: "Insert rows below", onClick: () => insertDel("row", "after") },
                { label: "Insert columns left", onClick: () => insertDel("col", "before") },
                { label: "Insert columns right", onClick: () => insertDel("col", "after") },
                { label: "Insert sheet", onClick: () => addSheet() },
              ]}
            />
            <Menu
              icon={Minus}
              label="Delete"
              items={[
                { label: "Delete rows", onClick: () => insertDel("row", "delete") },
                { label: "Delete columns", onClick: () => insertDel("col", "delete") },
                { label: "Delete sheet", danger: true, onClick: () => deleteSheet(si), disabled: wb.sheets.length < 2 },
              ]}
            />
            <RBreak />
            <Menu
              icon={Rows3}
              label="Format"
              items={[
                { label: "Row height…", onClick: () => setDialog("dims") },
                { label: "AutoFit column width", onClick: () => { for (let c = sel.c1; c <= Math.min(sel.c2, sel.c1 + 50); c++) autofitCol(c); } },
                { label: "Hide rows", onClick: () => updateSheet((s) => ({ ...s, hiddenRows: [...new Set([...s.hiddenRows, ...range(sel.r1, sel.r2)])] })) },
                { label: "Hide columns", onClick: () => updateSheet((s) => ({ ...s, hiddenCols: [...new Set([...s.hiddenCols, ...range(sel.c1, sel.c2)])] })) },
                { label: "Unhide all rows & columns", onClick: () => updateSheet((s) => ({ ...s, hiddenRows: [], hiddenCols: [] })) },
              ]}
            />
          </RGroup>
          <RGroup label="Editing" maxW={200}>
            <Menu
              icon={Sigma}
              label="AutoSum"
              items={["SUM", "AVERAGE", "COUNT", "MAX", "MIN"].map((f) => ({ label: f === "SUM" ? "Sum (Alt+=)" : f[0] + f.slice(1).toLowerCase(), onClick: () => autoSum(f) }))}
            />
            <Menu
              icon={Eraser}
              label="Clear"
              items={[
                { label: "Clear all", onClick: () => clearSel("all") },
                { label: "Clear formats", onClick: () => clearSel("formats") },
                { label: "Clear contents", shortcut: "Del", onClick: () => clearSel("contents") },
              ]}
            />
            <RBreak />
            <Menu
              icon={ArrowDownAZ}
              label="Sort & filter"
              items={[
                { label: "Sort A → Z", icon: ArrowDownAZ, onClick: () => sortQuick(false) },
                { label: "Sort Z → A", icon: ArrowDownZA, onClick: () => sortQuick(true) },
                { label: "Custom sort…", onClick: () => setDialog("sort") },
                { divider: true },
                { label: sheet.filter ? "Remove filter" : "Filter", icon: Filter, shortcut: "Ctrl+Shift+L", onClick: toggleFilter },
              ]}
            />
            <RBtn icon={Search} label="Find & replace" shortcut="Ctrl+F" onClick={() => setDialog("find")} />
          </RGroup>
        </>
      )}
      {tab === "Insert" && (
        <>
          <RGroup label="Charts">
            {(
              [
                ["column", "Column"],
                ["bar", "Bar"],
                ["line", "Line"],
                ["pie", "Pie"],
                ["area", "Area"],
                ["scatter", "Scatter"],
              ] as const
            ).map(([t, l]) => (
              <RBtn key={t} big icon={CHART_ICONS[t]} label={l} showLabel onClick={() => openChart(t)} />
            ))}
          </RGroup>
          <RGroup label="Insert">
            <RBtn big icon={Sigma} label="Function" showLabel onClick={() => setDialog("func")} />
            <RBtn big icon={Link2} label="Link" showLabel onClick={() => setDialog("link")} />
            <RBtn big icon={StickyNote} label="Note" showLabel onClick={() => setDialog("note")} />
            <RBtn big icon={ListChecks} label="Drop-down" showLabel onClick={() => setDialog("valid")} />
          </RGroup>
          <RGroup label="Date & time">
            <RBtn label="Today" showLabel onClick={() => writeCell(active.r, active.c, "=TODAY()")} />
            <RBtn label="Now" showLabel onClick={() => { writeCell(active.r, active.c, "=NOW()"); setCellsIn({ r1: active.r, c1: active.c, r2: active.r, c2: active.c }, (c) => ({ ...c, s: { ...(c?.s ?? {}), fmt: "yyyy-mm-dd h:mm" } })); }} />
          </RGroup>
        </>
      )}
      {tab === "Formulas" && (
        <>
          <RGroup label="Library">
            <RBtn big icon={Sigma} label="Insert function" showLabel onClick={() => setDialog("func")} />
            {["Math", "Statistical", "Logical", "Lookup", "Text", "Date & time", "Financial", "Dynamic array"].map((cat) => (
              <Menu
                key={cat}
                label={cat}
                items={FUNCTION_NAMES.filter((n) => FUNCTION_INFO[n][0] === cat).slice(0, 40).map((n) => ({ label: n, onClick: () => insertFunction(n) }))}
              />
            ))}
          </RGroup>
          <RGroup label="Names">
            <RBtn big icon={BookOpen} label="Define name" showLabel onClick={() => setDialog("name")} />
          </RGroup>
          <RGroup label="Auditing">
            <RBtn big label="Show formulas" showLabel active={showFormulas} onClick={() => setShowFormulas((s) => !s)} icon={Sigma} />
          </RGroup>
        </>
      )}
      {tab === "Data" && (
        <>
          <RGroup label="Sort & filter">
            <RBtn big icon={ArrowDownAZ} label="A → Z" showLabel onClick={() => sortQuick(false)} />
            <RBtn big icon={ArrowDownZA} label="Z → A" showLabel onClick={() => sortQuick(true)} />
            <RBtn big icon={ListFilter} label="Sort…" showLabel onClick={() => setDialog("sort")} />
            <RBtn big icon={Filter} label={sheet.filter ? "Clear filter" : "Filter"} showLabel active={Boolean(sheet.filter)} onClick={toggleFilter} />
          </RGroup>
          <RGroup label="Tools">
            <RBtn big label="Remove duplicates" showLabel icon={Eraser} onClick={() => {
              const g = currentRegion();
              const first = comp.values.get(key(g.r1, g.c1));
              const res = removeDuplicates(sheet, comp.values, g, typeof first === "string");
              updateSheet(() => res.sheet);
              flash(`${res.removed} duplicate row(s) removed.`);
            }} />
            <RBtn big label="Text to columns" showLabel icon={Table2} onClick={() => setDialog("textcols")} />
            <RBtn big label="Data validation" showLabel icon={ListChecks} onClick={() => setDialog("valid")} />
          </RGroup>
        </>
      )}
      {tab === "View" && (
        <>
          <RGroup label="Show">
            <RBtn label="Gridlines" showLabel active={sheet.gridlines} onClick={() => updateSheet((s) => ({ ...s, gridlines: !s.gridlines }))} />
            <RBtn label="Headings" showLabel active={showHeaders} onClick={() => setShowHeaders((v) => !v)} />
            <RBtn label="Formula bar" showLabel active={showBar} onClick={() => setShowBar((v) => !v)} />
            <RBtn label="Formulas" showLabel active={showFormulas} onClick={() => setShowFormulas((v) => !v)} />
          </RGroup>
          <RGroup label="Freeze panes">
            <RBtn label="Freeze at selection" showLabel onClick={() => updateSheet((s) => ({ ...s, freeze: { r: active.r, c: active.c } }))} />
            <RBtn label="Top row" showLabel onClick={() => updateSheet((s) => ({ ...s, freeze: { r: 1, c: 0 } }))} />
            <RBtn label="First column" showLabel onClick={() => updateSheet((s) => ({ ...s, freeze: { r: 0, c: 1 } }))} />
            <RBtn label="Unfreeze" showLabel onClick={() => updateSheet((s) => ({ ...s, freeze: { r: 0, c: 0 } }))} />
          </RGroup>
          <RGroup label="Zoom">
            <RBtn label="Zoom out" icon={Minus} onClick={() => setZoom((sheet.zoom ?? 100) - 10)} />
            <span className="w-12 text-center text-sm">{sheet.zoom ?? 100}%</span>
            <RBtn label="Zoom in" icon={Plus} onClick={() => setZoom((sheet.zoom ?? 100) + 10)} />
            <RBtn label="Actual size" showLabel onClick={() => setZoom(100)} />
          </RGroup>
        </>
      )}
    </Ribbon>
  );

  function range(a: number, b: number) {
    return Array.from({ length: Math.min(b, a + 5000) - a + 1 }, (_, i) => a + i);
  }
  function setZoom(z: number) {
    setWbRaw((w) => ({ ...w, sheets: w.sheets.map((s, i) => (i === w.active ? { ...s, zoom: Math.max(40, Math.min(250, z)) } : s)) }));
  }
  function addSheet() {
    commit((w) => ({ ...w, sheets: [...w.sheets, blankSheet(uniqueSheetName(w))], active: w.sheets.length }));
    setSel({ r1: 0, c1: 0, r2: 0, c2: 0 });
    setActive({ r: 0, c: 0 });
  }
  function deleteSheet(i: number) {
    if (wb.sheets.length < 2) return;
    commit((w) => ({ ...w, sheets: w.sheets.filter((_, j) => j !== i), active: Math.max(0, Math.min(w.active, w.sheets.length - 2)) }));
  }
  function insertFunction(n: string) {
    setEditing({ r: active.r, c: active.c, text: `=${n}(`, source: "cell", typed: false });
    requestAnimationFrame(() => editorRef.current?.focus());
  }
  /** The data a new chart should plot: the current region minus a title row above the table and columns with no data. */
  function chartRegion(): Range {
    let { r1, c1, r2, c2 } = currentRegion();
    if (sel.r1 !== sel.r2 || sel.c1 !== sel.c2) return { r1, c1, r2, c2 };
    const filled = (r: number, c: number) => {
      const v = comp.values.get(key(r, c));
      return v !== undefined && v !== null && v !== "";
    };
    const rowCount = (r: number) => {
      let n = 0;
      for (let c = c1; c <= c2; c++) if (filled(r, c)) n++;
      return n;
    };
    while (r2 - r1 >= 2 && rowCount(r1) <= 1 && rowCount(r1 + 1) > 1) r1++;
    const colHasData = (c: number) => {
      for (let r = r1 + 1; r <= r2; r++) if (filled(r, c)) return true;
      return false;
    };
    // Series columns must hold numbers; a trailing text column (notes, status) isn't plottable.
    const colHasNumbers = (c: number) => {
      for (let r = r1 + 1; r <= r2; r++) if (typeof comp.values.get(key(r, c)) === "number") return true;
      return false;
    };
    while (c2 > c1 && !colHasData(c1)) c1++;
    while (c2 > c1 + 1 && !colHasNumbers(c2)) c2--;
    // A closing "Total" row would double-count (and dwarf every pie slice).
    if (r2 - r1 >= 2 && /^\s*(grand\s+)?(total|sum)s?\s*:?\s*$/i.test(String(comp.values.get(key(r2, c1)) ?? ""))) r2--;
    return { r1, c1, r2, c2 };
  }
  function openChart(type: ChartSpec["type"]) {
    const g = chartRegion();
    const sv = scrollRef.current;
    setChartDraft({
      id: newId("ch"),
      type,
      range: `${addr(g.r1, g.c1)}:${addr(g.r2, g.c2)}`,
      title: "\u0000",
      // Beside the data (one column gap, top-aligned with it) like Excel, never on top of it;
      // fall back to the visible area if that spot is far off-screen.
      ...(() => {
        const bx = (geo.headerW + geo.colX[Math.min(geo.cols, g.c2 + 1)] * zoom + 24) / zoom;
        const by = (geo.headerH + geo.rowY[g.r1] * zoom) / zoom;
        const viewR = ((sv?.scrollLeft ?? 0) + (sv?.clientWidth ?? 1200)) / zoom;
        return bx < viewR + 200 ? { x: bx, y: by } : { x: (sv?.scrollLeft ?? 0) / zoom + 80, y: (sv?.scrollTop ?? 0) / zoom + 40 };
      })(),
      w: 480,
      h: 300,
      headers: typeof comp.values.get(key(g.r1, g.c2)) === "string",
      legend: true,
    });
    setDialog("chart");
  }

  const switchSheet = (i: number) => {
    if (editing) commitEdit(null);
    setWbRaw((w) => ({ ...w, active: i }));
    setSel({ r1: 0, c1: 0, r2: 0, c2: 0 });
    setActive({ r: 0, c: 0 });
    scrollRef.current?.scrollTo({ left: 0, top: 0 });
  };

  // ---------- render
  return (
    <EditorFrame fullscreen={fullscreen}>
      <TitleBar
        app="sheet"
        icon={FileSpreadsheet}
        name={name}
        onRename={setName}
        saveState={saveState}
        onNew={() => newDoc()}
        onOpenFile={openFile}
        accept=".xlsx,.xlsm,.xltx,.xls,.ods,.numbers,.csv,.tsv,.txt"
        onPickDoc={async (id) => {
          const d = await loadDoc<Saved>(id);
          if (d) onSwitch(id, d);
        }}
        currentId={docId}
        fullscreen={fullscreen}
        onFullscreen={() => setFullscreen((f) => !f)}
        extra={<RBtn icon={Download} label="Download .xlsx" onClick={() => download("xlsx")} />}
      />
      {ribbon}
      {showBar && (
        <div className="flex items-center gap-1 border-b border-line bg-surface px-1.5 py-1">
          <input
            aria-label="Name box"
            defaultValue={selText}
            key={selText}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              const t = e.currentTarget.value.trim().toUpperCase();
              const named = wb.names[t];
              const g = parseRangeText(named ? named.replace(/^.*!/, "").replace(/\$/g, "") : t);
              if (g) {
                setActive({ r: g.r1, c: g.c1 });
                setSel(g);
                select(g.r1, g.c1, false);
                setSel(g);
              } else flash("Type a cell like B7, a range like A1:C9, or a defined name.");
              focusSink();
            }}
            className="h-7 w-24 shrink-0 rounded-[5px] border border-line bg-surface px-2 font-mono text-xs outline-none focus:border-ink sm:w-28"
          />
          <button type="button" title="Insert function" onClick={() => setDialog("func")} className="h-7 shrink-0 rounded-[5px] px-2 font-serif text-sm italic text-ink-2 hover:bg-paper">
            fx
          </button>
          <div className="relative min-w-0 flex-1">
            <input
              ref={barRef}
              aria-label="Formula bar"
              value={editing ? editing.text : showValue(activeCell?.v)}
              onFocus={() => {
                if (!editing) startEdit(undefined, "bar");
              }}
              onChange={(e) => setEditing((ed) => (ed ? { ...ed, text: e.target.value } : { r: active.r, c: active.c, text: e.target.value, source: "bar", typed: false }))}
              onKeyDown={(e) => {
                if (acList.length && (e.key === "Tab" || (e.key === "Enter" && acToken))) {
                  e.preventDefault();
                  applyAutocomplete(acList[acIndex] ?? acList[0]);
                  return;
                }
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitEdit("down");
                } else if (e.key === "Escape") cancelEdit();
                else if (e.key === "Tab") {
                  e.preventDefault();
                  commitEdit("right");
                }
              }}
              className="h-7 w-full rounded-[5px] border border-line bg-surface px-2 font-mono text-[13px] outline-none focus:border-ink"
            />
          </div>
        </div>
      )}

      <div ref={areaRef} className="relative min-h-0 flex-1 select-none overflow-hidden bg-white" onWheel={(e) => { if (e.ctrlKey) { e.preventDefault(); setZoom((sheet.zoom ?? 100) + (e.deltaY < 0 ? 10 : -10)); } }}>
        <canvas ref={canvasRef} className="pointer-events-none absolute left-0 top-0" />
        <div
          ref={scrollRef}
          className="absolute inset-0 overflow-auto [touch-action:pan-x_pan-y]"
          onScroll={(e) => setScroll({ x: e.currentTarget.scrollLeft, y: e.currentTarget.scrollTop })}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={onDoubleClick}
          onContextMenu={onContextMenu}
          onPointerLeave={() => setHoverNote(null)}
        >
          <div style={{ width: content.w, height: content.h }} />
        </div>

        {/* overlays in the scrolling area: charts, filter buttons, list arrow */}
        <div className="pointer-events-none absolute overflow-hidden" style={{ left: geo.headerW, top: geo.headerH, right: 14, bottom: 14 }}>
          {sheet.charts.map((ch) => (
            <div key={ch.id} className="pointer-events-auto">
              <ChartBox
                spec={ch}
                comp={comp}
                sheet={sheet}
                zoom={zoom}
                left={ch.x * zoom - scroll.x}
                top={ch.y * zoom - scroll.y}
                onChange={(next) => setWbRaw((w) => ({ ...w, sheets: w.sheets.map((s, i) => (i === w.active ? { ...s, charts: s.charts.map((c) => (c.id === next.id ? next : c)) } : s)) }))}
                onEdit={() => {
                  setChartDraft(ch);
                  setDialog("chart");
                }}
                onDelete={() => updateSheet((s) => ({ ...s, charts: s.charts.filter((c) => c.id !== ch.id) }))}
              />
            </div>
          ))}
        </div>
        {filterRange &&
          range(filterRange.c1, filterRange.c2).map((c) => {
            const x = colLeft(geo, c, scroll.x) + colWidth(geo, c) - 18;
            const y = rowTop(geo, filterRange.r1, scroll.y) + rowHeight(geo, filterRange.r1) - 18;
            if (x < geo.headerW || y < geo.headerH || x > size.w || y > size.h) return null;
            const activeCrit = sheet.filter?.criteria[c]?.values;
            return (
              <button
                key={c}
                type="button"
                aria-label={`Filter column ${indexToCol(c)}`}
                onClick={() => setFilterMenu({ col: c, x, y: y + 18 })}
                className={cn("absolute z-10 flex size-4 items-center justify-center rounded-[3px] border text-[9px]", activeCrit ? "border-accent bg-accent text-white" : "border-line bg-white text-ink-2")}
                style={{ left: x, top: y }}
              >
                ▼
              </button>
            );
          })}
        {validationAtActive?.list && !editing && (() => {
          const x = colLeft(geo, active.c, scroll.x) + colWidth(geo, active.c) + 2;
          const y = rowTop(geo, active.r, scroll.y);
          return (
            <button
              type="button"
              aria-label="Choose from list"
              onClick={() => setListMenu(validationAtActive.list ?? [])}
              className="absolute z-10 flex h-5 w-5 items-center justify-center rounded-[3px] border border-line bg-white text-[10px] text-ink-2 shadow"
              style={{ left: x, top: y + 1 }}
            >
              ▼
            </button>
          );
        })()}
        {listMenu && (
          <ul className="absolute z-20 max-h-56 min-w-32 overflow-y-auto rounded-[5px] border border-line bg-white py-1 shadow-float" style={{ left: colLeft(geo, active.c, scroll.x), top: rowTop(geo, active.r, scroll.y) + rowHeight(geo, active.r) }}>
            {listMenu.map((v) => (
              <li key={v}>
                <button type="button" className="w-full px-3 py-1.5 text-left text-sm hover:bg-paper" onClick={() => { writeCell(active.r, active.c, v); setListMenu(null); focusSink(); }}>
                  {v}
                </button>
              </li>
            ))}
          </ul>
        )}
        {filterMenu && (
          <FilterPopover
            values={filterValues(filterMenu.col)}
            selected={sheet.filter?.criteria[filterMenu.col]?.values}
            x={Math.min(filterMenu.x, size.w - 230)}
            y={filterMenu.y}
            onSort={(desc) => {
              const g = parseRangeText(sheet.filter!.range)!;
              updateSheet((s) => sortRange(s, comp.values, g, [{ col: filterMenu.col, desc }], true));
              setFilterMenu(null);
            }}
            onApply={(vals) => {
              applyFilter(filterMenu.col, vals);
              setFilterMenu(null);
            }}
            onClose={() => setFilterMenu(null)}
          />
        )}

        {hoverNote && !editing && (
          <div className="pointer-events-none absolute z-20 max-w-60 whitespace-pre-wrap rounded-[4px] border border-[#e0d58c] bg-[#ffffe1] px-2 py-1.5 text-xs text-ink shadow" style={{ left: Math.min(hoverNote.x, size.w - 250), top: hoverNote.y }}>
            {hoverNote.text}
          </div>
        )}

        {/*
          One textarea is both the keyboard sink and the in-cell editor (like Google Sheets): it sits
          invisibly on the active cell, so the first key typed starts editing without moving focus
          and no character is ever lost, IME and phone keyboards included.
        */}
        {(() => {
          const inCell = Boolean(editing && editing.source === "cell" && editorRect);
          const ax = colLeft(geo, active.c, scroll.x);
          const ay = rowTop(geo, active.r, scroll.y);
          const box = inCell && editorRect ? editorRect : { x: Math.max(0, ax), y: Math.max(0, ay), w: 1, h: 1 };
          return (
            <div className="absolute z-30" style={{ left: box.x, top: box.y }}>
              <textarea
                ref={editorRef}
                aria-label={inCell && editing ? `Editing ${addr(editing.r, editing.c)}` : `Spreadsheet grid, cell ${addr(active.r, active.c)}. Type to edit.`}
                value={inCell && editing ? editing.text : ""}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                onChange={(e) => {
                  const v = e.target.value;
                  if (editing && editing.source === "cell") setEditing({ ...editing, text: v });
                  else if (v) setEditing({ r: active.r, c: active.c, text: v, source: "cell", typed: true });
                  setAcIndex(0);
                }}
                onCopy={(e) => !inCell && copyOut(false, e)}
                onCut={(e) => !inCell && copyOut(true, e)}
                onPaste={(e) => {
                  if (inCell) return;
                  e.preventDefault();
                  pasteIn(e.clipboardData.getData("text/plain"));
                }}
                onKeyDown={(e) => {
                  if (!inCell || !editing) return onSinkKey(e);
                  if (acList.length) {
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      return setAcIndex((i) => (i + 1) % acList.length);
                    }
                    if (e.key === "ArrowUp") {
                      e.preventDefault();
                      return setAcIndex((i) => (i - 1 + acList.length) % acList.length);
                    }
                    if (e.key === "Tab") {
                      e.preventDefault();
                      return applyAutocomplete(acList[acIndex]);
                    }
                  }
                  if (e.key === "Enter" && e.altKey) {
                    e.preventDefault();
                    const el = e.currentTarget;
                    const pos = el.selectionStart;
                    const t = editing.text.slice(0, pos) + "\n" + editing.text.slice(el.selectionEnd);
                    setEditing({ ...editing, text: t });
                    requestAnimationFrame(() => el.setSelectionRange(pos + 1, pos + 1));
                    return;
                  }
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if ((e.ctrlKey || e.metaKey) && (sel.r1 !== sel.r2 || sel.c1 !== sel.c2)) {
                      // Ctrl+Enter: the same entry in every selected cell (formulas shift)
                      const txt = editing.text;
                      setCellsIn(sel, (cell, r, c) => {
                        const p = parseInput(txt.startsWith("=") ? shiftFormula(txt, r - editing.r, c - editing.c) : txt);
                        return { ...(cell ?? {}), v: p.v ?? undefined };
                      });
                      setEditing(null);
                      return;
                    }
                    return commitEdit(e.shiftKey ? "up" : "down");
                  }
                  if (e.key === "Tab") {
                    e.preventDefault();
                    return commitEdit(e.shiftKey ? "left" : "right");
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    return cancelEdit();
                  }
                  if (editing.typed && !editing.text.startsWith("=") && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
                    e.preventDefault();
                    return commitEdit(e.key === "ArrowUp" ? "up" : e.key === "ArrowDown" ? "down" : e.key === "ArrowLeft" ? "left" : "right");
                  }
                }}
                style={
                  inCell && editing && editorRect
                    ? {
                        minWidth: editorRect.w,
                        minHeight: editorRect.h,
                        width: Math.max(editorRect.w, Math.min(520, editing.text.length * 8 * zoom + 24)),
                        font: cellFont(sheet.cells[key(editing.r, editing.c)]?.s, zoom),
                      }
                    : { width: 1, height: 1, opacity: 0, padding: 0, border: 0, caretColor: "transparent" }
                }
                rows={inCell && editing ? Math.max(1, editing.text.split("\n").length) : 1}
                className={cn(
                  "resize-none overflow-hidden outline-none",
                  inCell && "border-2 border-[#1a7f4b] bg-white px-1 py-0.5 leading-tight text-ink shadow-md",
                )}
              />
              {inCell && (acList.length > 0 || fnHint) && (
                <div className="mt-0.5 w-72 overflow-hidden rounded-[5px] border border-line bg-white text-xs shadow-float" data-keep-edit>
                  {fnHint && !acList.length && (
                    <p className="px-2.5 py-1.5">
                      <span className="font-mono font-semibold text-ink">{fnHint[1]}</span>
                      <span className="block text-ink-3">{fnHint[2]}</span>
                    </p>
                  )}
                  {acList.map((n, i) => (
                    <button
                      key={n}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        applyAutocomplete(n);
                      }}
                      className={cn("block w-full px-2.5 py-1 text-left", i === acIndex ? "bg-[#d8ebdf]" : "hover:bg-paper")}
                    >
                      <span className="font-mono font-semibold">{n}</span>
                      <span className="ml-2 text-ink-3">{FUNCTION_INFO[n][2]}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })()}

        {ctxMenu && (
          <ContextMenu
            x={Math.min(ctxMenu.x, size.w - 230)}
            y={Math.min(ctxMenu.y, size.h - 320)}
            onClose={() => setCtxMenu(null)}
            items={[
              ["Cut", () => copyOut(true)],
              ["Copy", () => copyOut(false)],
              ["Paste", () => pasteFromButton(false)],
              ["Paste values", () => pasteFromButton(true)],
              null,
              ...(ctxMenu.kind !== "col" ? ([["Insert row above", () => insertDel("row", "before")], ["Insert row below", () => insertDel("row", "after")], ["Delete row(s)", () => insertDel("row", "delete")]] as const) : []),
              ...(ctxMenu.kind !== "row" ? ([["Insert column left", () => insertDel("col", "before")], ["Insert column right", () => insertDel("col", "after")], ["Delete column(s)", () => insertDel("col", "delete")]] as const) : []),
              null,
              ["Clear contents", () => clearSel("contents")],
              ["Sort A → Z", () => sortQuick(false)],
              ["Sort Z → A", () => sortQuick(true)],
              ["Filter", toggleFilter],
              null,
              ["Insert note", () => setDialog("note")],
              ["Insert link", () => setDialog("link")],
              ["Format cells…", () => setDialog("format")],
              ...(ctxMenu.kind === "row" ? ([["Hide row(s)", () => updateSheet((s) => ({ ...s, hiddenRows: [...new Set([...s.hiddenRows, ...range(sel.r1, sel.r2)])] }))]] as const) : []),
              ...(ctxMenu.kind === "col" ? ([["Hide column(s)", () => updateSheet((s) => ({ ...s, hiddenCols: [...new Set([...s.hiddenCols, ...range(sel.c1, sel.c2)])] }))]] as const) : []),
            ]}
          />
        )}
        {notice && <div className="absolute bottom-3 left-1/2 z-40 -translate-x-1/2 rounded-md bg-ink px-3 py-2 text-xs text-paper shadow-float" role="status">{notice}</div>}
      </div>

      {/* sheet tabs + status */}
      <div className="flex items-center gap-1 border-t border-line bg-paper/70 px-1.5 py-1 text-xs">
        <RBtn icon={Plus} label="Add sheet" onClick={addSheet} />
        <div className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto [scrollbar-width:none]">
          {wb.sheets.map((s, i) =>
            renamingTab === i ? (
              <input
                key={s.id}
                autoFocus
                defaultValue={s.name}
                aria-label="Sheet name"
                onBlur={(e) => {
                  const v = e.currentTarget.value.trim().slice(0, 31).replace(/[\\/?*[\]:]/g, "");
                  if (v && !wb.sheets.some((x, j) => j !== i && x.name.toLowerCase() === v.toLowerCase())) {
                    const old = s.name;
                    commit((w) => ({
                      ...w,
                      sheets: w.sheets.map((x, j) => {
                        const renamed = j === i ? { ...x, name: v } : x;
                        // keep references to the renamed sheet working
                        const cells: Record<string, Cell> = {};
                        for (const [k, cell] of Object.entries(renamed.cells)) {
                          cells[k] = typeof cell.v === "string" && cell.v.startsWith("=") && cell.v.includes(old) ? { ...cell, v: cell.v.split(`'${old}'!`).join(`${quoteName(v)}!`).split(`${old}!`).join(`${quoteName(v)}!`) } : cell;
                        }
                        return { ...renamed, cells };
                      }),
                    }));
                  }
                  setRenamingTab(null);
                }}
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                className="h-7 w-28 rounded-[5px] border border-ink bg-white px-2"
              />
            ) : (
              <button
                key={s.id}
                type="button"
                onClick={() => switchSheet(i)}
                onDoubleClick={() => setRenamingTab(i)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  switchSheet(i);
                  setCtxMenu({ x: e.clientX - (areaRef.current?.getBoundingClientRect().left ?? 0), y: (areaRef.current?.clientHeight ?? 300) - 200, kind: "tab", tab: i });
                }}
                className={cn("h-7 shrink-0 rounded-[5px] border px-3", i === si ? "border-line bg-white font-semibold text-[#1a7f4b]" : "border-transparent text-ink-2 hover:bg-white/70")}
                style={s.tabColor ? { boxShadow: `inset 0 -3px 0 ${s.tabColor}` } : undefined}
              >
                {s.name}
              </button>
            ),
          )}
        </div>
        {selStats && (
          <span className="hidden shrink-0 gap-3 px-2 text-ink-2 md:flex">
            {selStats.nums > 0 && <span>Average: {formatValue(selStats.avg, "#,##0.##")}</span>}
            <span>Count: {selStats.count}</span>
            {selStats.nums > 0 && <span>Min: {formatValue(selStats.min, "#,##0.##")}</span>}
            {selStats.nums > 0 && <span>Max: {formatValue(selStats.max, "#,##0.##")}</span>}
            {selStats.nums > 0 && <span className="font-semibold text-ink">Sum: {formatValue(selStats.sum, "#,##0.##")}</span>}
          </span>
        )}
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" className="px-1 text-ink-2" aria-label="Zoom out" onClick={() => setZoom((sheet.zoom ?? 100) - 10)}>−</button>
          <input type="range" min={40} max={250} step={10} value={sheet.zoom ?? 100} onChange={(e) => setZoom(Number(e.target.value))} aria-label="Zoom" className="hidden w-24 accent-[#1a7f4b] sm:block" />
          <button type="button" className="px-1 text-ink-2" aria-label="Zoom in" onClick={() => setZoom((sheet.zoom ?? 100) + 10)}>+</button>
          <span className="w-9 text-right text-ink-3">{sheet.zoom ?? 100}%</span>
        </div>
      </div>

      {ctxMenu?.kind === "tab" && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          fixedBottom
          onClose={() => setCtxMenu(null)}
          items={[
            ["Rename", () => setRenamingTab(ctxMenu.tab!)],
            ["Duplicate", () => commit((w) => ({ ...w, sheets: [...w.sheets.slice(0, ctxMenu.tab! + 1), { ...structuredClone(w.sheets[ctxMenu.tab!]), id: newId(), name: uniqueSheetName(w, w.sheets[ctxMenu.tab!].name + " ") }, ...w.sheets.slice(ctxMenu.tab! + 1)] }))],
            ["Move left", () => commit((w) => moveSheet(w, ctxMenu.tab!, -1))],
            ["Move right", () => commit((w) => moveSheet(w, ctxMenu.tab!, 1))],
            ...["#c00000", "#ed7d31", "#ffc000", "#70ad47", "#4472c4", "#7030a0"].map((c) => [`Tab colour ${c}`, () => updateSheet((s) => ({ ...s, tabColor: c }), ctxMenu.tab)] as const),
            ["No tab colour", () => updateSheet((s) => ({ ...s, tabColor: undefined }), ctxMenu.tab)],
            null,
            ["Delete sheet", () => deleteSheet(ctxMenu.tab!)],
          ]}
        />
      )}

      {/* dialogs */}
      {dialog === "format" && (
        <FormatCellsDialog
          open
          onClose={() => setDialog(null)}
          style={activeStyle}
          sample={typeof comp.values.get(key(active.r, active.c)) === "number" ? (comp.values.get(key(active.r, active.c)) as number) : 1234.5678}
          onApply={(p) => applyStyle(p)}
          onBorders={setBorders}
        />
      )}
      {dialog === "cond" && <CondFormatDialog open onClose={() => setDialog(null)} rules={sheet.cond} selection={`${addr(boundedSel().r1, boundedSel().c1)}:${addr(boundedSel().r2, boundedSel().c2)}`} onChange={(rules) => updateSheet((s) => ({ ...s, cond: rules }))} />}
      {dialog === "valid" && <ValidationDialog open onClose={() => setDialog(null)} rules={sheet.validations} selection={`${addr(boundedSel().r1, boundedSel().c1)}:${addr(boundedSel().r2, boundedSel().c2)}`} onChange={(v) => updateSheet((s) => ({ ...s, validations: v }))} />}
      {dialog === "sort" && (
        <SortDialog
          open
          onClose={() => setDialog(null)}
          range={currentRegion()}
          headerNames={(hasHeader) => {
            const g = currentRegion();
            return range(g.c1, g.c2).map((c) => {
              const v = comp.values.get(key(g.r1, c));
              return hasHeader && v !== null && v !== undefined ? `${String(v)} (${indexToCol(c)})` : `Column ${indexToCol(c)}`;
            });
          }}
          onSort={(levels, hasHeader) => updateSheet((s) => sortRange(s, comp.values, currentRegion(), levels, hasHeader))}
        />
      )}
      {dialog === "find" && <FindDialog open onClose={() => setDialog(null)} onFind={onFind} onReplace={onReplace} onReplaceAll={onReplaceAll} />}
      {dialog === "func" && <FunctionDialog open onClose={() => setDialog(null)} onInsert={insertFunction} />}
      {dialog === "chart" && chartDraft && (
        <ChartDialog
          open
          onClose={() => setDialog(null)}
          initial={chartDraft}
          onSave={(c) => {
            const spec = { ...c, title: c.title === "\u0000" ? "" : c.title };
            updateSheet((s) => ({ ...s, charts: s.charts.some((x) => x.id === spec.id) ? s.charts.map((x) => (x.id === spec.id ? spec : x)) : [...s.charts, spec] }));
          }}
        />
      )}
      {dialog === "templates" && (
        <Modal open onClose={() => setDialog(null)} title="Templates" wide>
          <div className="grid gap-3 sm:grid-cols-2">
            {SHEET_TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setDialog(null);
                  newDoc(t.build(), t.name);
                }}
                className="rounded-md border border-line p-4 text-left hover:border-ink-3"
              >
                <span className="block font-medium text-ink">{t.name}</span>
                <span className="block text-sm text-ink-2">{t.description}</span>
              </button>
            ))}
          </div>
        </Modal>
      )}
      {(dialog === "link" || dialog === "note" || dialog === "name" || dialog === "dims" || dialog === "textcols") && (
        <SimplePrompt
          kind={dialog}
          initial={dialog === "link" ? activeCell?.link ?? "https://" : dialog === "note" ? activeCell?.note ?? "" : dialog === "dims" ? String(sheet.rowH[active.r] ?? DEFAULT_ROW_H) : dialog === "textcols" ? "," : ""}
          onClose={() => setDialog(null)}
          onSubmit={(v) => {
            if (dialog === "link") setCellsIn({ r1: active.r, c1: active.c, r2: active.r, c2: active.c }, (c) => ({ ...(c ?? {}), link: v && v !== "https://" ? v : undefined, v: c?.v ?? v }));
            if (dialog === "note") setCellsIn({ r1: active.r, c1: active.c, r2: active.r, c2: active.c }, (c) => ({ ...(c ?? {}), note: v || undefined }));
            if (dialog === "name" && /^[A-Za-z_][A-Za-z0-9_.]*$/.test(v)) commit((w) => ({ ...w, names: { ...w.names, [v.toUpperCase()]: `${quoteName(sheet.name)}!$${indexToCol(sel.c1)}$${sel.r1 + 1}:$${indexToCol(sel.c2)}$${sel.r2 + 1}` } }));
            if (dialog === "dims" && Number(v) > 0) updateSheet((s) => ({ ...s, rowH: { ...s.rowH, ...Object.fromEntries(range(sel.r1, Math.min(sel.r2, sel.r1 + 2000)).map((r) => [r, Number(v)])) } }));
            if (dialog === "textcols" && v) updateSheet((s) => splitColumn(s, boundedSel(), v));
            setDialog(null);
          }}
        />
      )}
    </EditorFrame>
  );
}

const quoteName = (n: string) => (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(n) ? n : `'${n.replace(/'/g, "''")}'`);
const showValue = (v: Cell["v"]) => (v === undefined || v === null ? "" : typeof v === "boolean" ? (v ? "TRUE" : "FALSE") : String(v));

function moveSheet(w: Workbook, i: number, dir: number): Workbook {
  const j = i + dir;
  if (j < 0 || j >= w.sheets.length) return w;
  const sheets = [...w.sheets];
  [sheets[i], sheets[j]] = [sheets[j], sheets[i]];
  return { ...w, sheets, active: j };
}

function rowsOf(sh: Sheet, comp: ReturnType<typeof recalc>[number]) {
  const u = usedRange(sh, comp);
  const out: Record<string, Scalar | string>[] = [];
  const head: string[] = [];
  for (let c = 0; c <= u.c2; c++) {
    const v = comp.values.get(key(0, c));
    head.push(v === null || v === undefined ? indexToCol(c) : String(v));
  }
  for (let r = 1; r <= u.r2; r++) {
    const row: Record<string, Scalar | string> = {};
    for (let c = 0; c <= u.c2; c++) {
      const v = comp.values.get(key(r, c)) ?? null;
      row[head[c]] = isError(v) ? v.code : v;
    }
    out.push(row);
  }
  return out;
}

function ContextMenu({ x, y, items, onClose, fixedBottom }: { x: number; y: number; items: (readonly [string, () => void] | null)[]; onClose: () => void; fixedBottom?: boolean }) {
  const originRef = useRef<HTMLSpanElement | null>(null);
  const menuRef = useRef<HTMLUListElement | null>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const d = () => onClose();
    window.addEventListener("keydown", k);
    const t = setTimeout(() => window.addEventListener("pointerdown", d), 0);
    window.addEventListener("resize", d);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", k);
      window.removeEventListener("pointerdown", d);
      window.removeEventListener("resize", d);
    };
  }, [onClose]);
  // Rendered in <body> with fixed coordinates so the editor frame can't clip it; opens up/left
  // when there's no room below/right of the click, and always stays on screen.
  useLayoutEffect(() => {
    const o = originRef.current?.getBoundingClientRect();
    const m = menuRef.current;
    if (!o || !m) return;
    const w = m.offsetWidth;
    const h = m.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = o.left;
    if (left + w > vw - 8) left = Math.max(8, o.left - w);
    let top = fixedBottom ? o.top - h : o.top;
    if (top + h > vh - 8) top = o.top - h >= 8 ? o.top - h : vh - 8 - h;
    m.style.left = `${Math.round(Math.max(8, left))}px`;
    m.style.top = `${Math.round(Math.max(8, top))}px`;
    m.style.visibility = "visible";
  }, [x, y, fixedBottom]);
  return (
    <>
      <span ref={originRef} aria-hidden className="pointer-events-none absolute size-0" style={{ left: Math.max(4, x), top: fixedBottom ? "100%" : Math.max(4, y) }} />
      {createPortal(
        <ul
          ref={menuRef}
          role="menu"
          className="invisible fixed z-[85] max-h-[min(70vh,calc(100dvh-16px))] min-w-52 overflow-y-auto rounded-[6px] border border-line bg-white py-1 text-[13px] shadow-float"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {items.map((it, i) =>
            it === null ? (
              <li key={i} className="my-1 border-t border-line" />
            ) : (
              <li key={i}>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onClose();
                    it[1]();
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-paper"
                >
                  {it[0].startsWith("Tab colour") ? (
                    <>
                      <span className="size-3 rounded-sm" style={{ background: it[0].split(" ").pop() }} /> Tab colour
                    </>
                  ) : (
                    it[0]
                  )}
                </button>
              </li>
            ),
          )}
        </ul>,
        document.body,
      )}
    </>
  );
}

function FilterPopover({ values, selected, x, y, onApply, onSort, onClose }: { values: string[]; selected?: string[]; x: number; y: number; onApply: (v: string[] | undefined) => void; onSort: (desc: boolean) => void; onClose: () => void }) {
  const [checked, setChecked] = useState<Set<string>>(new Set(selected ?? values));
  const [q, setQ] = useState("");
  const shown = values.filter((v) => v.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="absolute z-30 w-56 rounded-[6px] border border-line bg-white p-2 text-[13px] shadow-float" style={{ left: Math.max(4, x), top: y }} onPointerDown={(e) => e.stopPropagation()}>
      <button type="button" className="block w-full rounded px-2 py-1 text-left hover:bg-paper" onClick={() => onSort(false)}>
        Sort A → Z
      </button>
      <button type="button" className="block w-full rounded px-2 py-1 text-left hover:bg-paper" onClick={() => onSort(true)}>
        Sort Z → A
      </button>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className={cn(inputCls, "mt-1 h-8")} />
      <label className="mt-1 flex items-center gap-2 px-1 py-1">
        <input type="checkbox" checked={checked.size === values.length} onChange={(e) => setChecked(new Set(e.target.checked ? values : []))} /> (Select all)
      </label>
      <ul className="max-h-48 overflow-y-auto">
        {shown.map((v) => (
          <li key={v}>
            <label className="flex items-center gap-2 px-1 py-0.5">
              <input
                type="checkbox"
                checked={checked.has(v)}
                onChange={(e) =>
                  setChecked((s) => {
                    const n = new Set(s);
                    if (e.target.checked) n.add(v);
                    else n.delete(v);
                    return n;
                  })
                }
              />
              <span className="truncate">{v}</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex justify-end gap-1.5">
        <button type="button" className={cn(secondaryCls, "h-8 px-3")} onClick={onClose}>
          Cancel
        </button>
        <button type="button" className={cn(primaryCls, "h-8 px-3")} onClick={() => onApply(checked.size === values.length ? undefined : [...checked])}>
          OK
        </button>
      </div>
    </div>
  );
}

function SimplePrompt({ kind, initial, onClose, onSubmit }: { kind: string; initial: string; onClose: () => void; onSubmit: (v: string) => void }) {
  const [v, setV] = useState(initial);
  const meta: Record<string, [string, string]> = {
    link: ["Insert link", "Web address (Ctrl+click the cell to open it)"],
    note: ["Note", "Shown when you hover the cell"],
    name: ["Define name", "A name for the selected range, e.g. SalesData — use it in formulas"],
    dims: ["Row height", "Height in pixels for the selected rows"],
    textcols: ["Text to columns", "Split the selected column at this delimiter (use \\t for tab)"],
  };
  const [title, hint] = meta[kind] ?? ["", ""];
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <button type="button" className={secondaryCls} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={primaryCls} onClick={() => onSubmit(v.trim())}>
            OK
          </button>
        </>
      }
    >
      <label className="block text-sm text-ink-2">
        {hint}
        {kind === "note" ? (
          <textarea autoFocus value={v} onChange={(e) => setV(e.target.value)} rows={4} className={cn(inputCls, "h-auto py-2")} />
        ) : (
          <input autoFocus value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === "Enter" && onSubmit(v.trim())} className={inputCls} />
        )}
      </label>
    </Modal>
  );
}

