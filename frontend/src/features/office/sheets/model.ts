/**
 * The workbook model behind the spreadsheet editor: sheets of sparse cells with styles, the
 * calculation engine (dependency-free recompute with caching, cycle detection and spilled
 * arrays), typed-input parsing, and structural edits (insert/delete rows & columns, sort…).
 */
import {
  adjustForInsert,
  CellError,
  ERR,
  evaluate,
  isError,
  isMatrix,
  jsDateToSerial,
  parse,
  parseDateString,
  type EvalContext,
  type Node,
  type Scalar,
} from "./formula";

export type HAlign = "left" | "center" | "right";
export type VAlign = "top" | "middle" | "bottom";
export type BorderSide = { style: "thin" | "medium" | "thick" | "dashed" | "dotted" | "double"; color: string };

export type CellStyle = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  font?: string;
  size?: number;
  color?: string;
  fill?: string;
  align?: HAlign;
  valign?: VAlign;
  wrap?: boolean;
  indent?: number;
  rotate?: number;
  fmt?: string;
  bt?: BorderSide;
  br?: BorderSide;
  bb?: BorderSide;
  bl?: BorderSide;
};

export type Cell = {
  /** What the user typed: a formula starting with "=", or a literal value. */
  v?: string | number | boolean | null;
  s?: CellStyle;
  /** A note shown on hover (Excel "Notes"). */
  note?: string;
  link?: string;
};

export type Merge = { r1: number; c1: number; r2: number; c2: number };

export type CondRule = {
  id: string;
  range: string;
  type: "gt" | "lt" | "between" | "eq" | "text" | "dup" | "unique" | "top" | "bottom" | "above" | "below" | "blank" | "scale" | "bar" | "formula";
  a?: string;
  b?: string;
  style?: CellStyle;
  /** colour scale: low/high colours; data bar: colour */
  colors?: string[];
};

export type Validation = { id: string; range: string; type: "list" | "number" | "date" | "length"; list?: string[]; min?: number; max?: number; message?: string };

export type ChartSpec = {
  id: string;
  type: "column" | "bar" | "line" | "area" | "pie" | "doughnut" | "scatter" | "radar";
  range: string;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** First row holds series names; first column holds categories. */
  headers: boolean;
  legend: boolean;
  stacked?: boolean;
};

export type SheetFilter = { range: string; criteria: Record<number, { values?: string[]; sort?: "asc" | "desc" }> };

export type Sheet = {
  id: string;
  name: string;
  cells: Record<string, Cell>;
  colW: Record<number, number>;
  rowH: Record<number, number>;
  hiddenRows: number[];
  hiddenCols: number[];
  merges: Merge[];
  freeze: { r: number; c: number };
  cond: CondRule[];
  validations: Validation[];
  charts: ChartSpec[];
  filter?: SheetFilter;
  tabColor?: string;
  gridlines: boolean;
  rows: number;
  cols: number;
  zoom?: number;
};

export type Workbook = { sheets: Sheet[]; active: number; names: Record<string, string> };

export const DEFAULT_COL_W = 100;
export const DEFAULT_ROW_H = 24;
export const key = (r: number, c: number) => `${r},${c}`;
export const unkey = (k: string) => {
  const [r, c] = k.split(",").map(Number);
  return { r, c };
};

let seq = 0;
export const newId = (p = "s") => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;

export function blankSheet(name: string): Sheet {
  return {
    id: newId(),
    name,
    cells: {},
    colW: {},
    rowH: {},
    hiddenRows: [],
    hiddenCols: [],
    merges: [],
    freeze: { r: 0, c: 0 },
    cond: [],
    validations: [],
    charts: [],
    gridlines: true,
    rows: 1000,
    cols: 52,
  };
}

export function blankWorkbook(): Workbook {
  return { sheets: [blankSheet("Sheet1")], active: 0, names: {} };
}

export function uniqueSheetName(wb: Workbook, base = "Sheet"): string {
  for (let i = wb.sheets.length + 1; ; i++) {
    const n = `${base}${i}`;
    if (!wb.sheets.some((s) => s.name.toLowerCase() === n.toLowerCase())) return n;
  }
}

// ------------------------------------------------------------------ typed input

/**
 * What a typed entry becomes, Excel-style: numbers, 12% (with a percent format), $1,200 (currency),
 * 2026-01-15 / 15/01/2026 (dates), 9:30 PM (times), TRUE/FALSE, or text. A leading ' forces text.
 */
export function parseInput(raw: string): { v: string | number | boolean | null; fmt?: string } {
  if (raw === "") return { v: null };
  if (raw.startsWith("'")) return { v: raw.slice(1) };
  if (raw.startsWith("=") && raw.length > 1) return { v: raw };
  const t = raw.trim();
  if (/^(true|false)$/i.test(t)) return { v: t.toUpperCase() === "TRUE" };
  if (/^[-+]?(\d{1,3}(,\d{3})+|\d+)?(\.\d+)?(e[-+]?\d+)?$/i.test(t) && /\d/.test(t)) {
    return { v: Number(t.replace(/,/g, "")), fmt: t.includes(",") ? "#,##0" + (t.includes(".") ? ".00" : "") : undefined };
  }
  let m = /^[-+]?(\d+(?:\.\d+)?)%$/.exec(t);
  if (m) return { v: Number(t.replace("%", "")) / 100, fmt: m[1].includes(".") ? "0.00%" : "0%" };
  m = /^(-)?([$€£₹¥])\s?([\d,]*\.?\d+)$/.exec(t);
  if (m) {
    const n = Number(m[3].replace(/,/g, "")) * (m[1] ? -1 : 1);
    const sym = m[2];
    return { v: n, fmt: `"${sym}"#,##0${m[3].includes(".") ? ".00" : ""}` };
  }
  const d = parseDateString(t);
  if (d !== null) {
    const timeOnly = d < 1 && /:/.test(t);
    const hasTime = /:/.test(t);
    return { v: d, fmt: timeOnly ? (/[ap]m/i.test(t) ? "h:mm AM/PM" : "h:mm") : hasTime ? "yyyy-mm-dd h:mm" : /^\d{4}-/.test(t) ? "yyyy-mm-dd" : /[A-Za-z]/.test(t) ? "d mmm yyyy" : "dd/mm/yyyy" };
  }
  return { v: raw };
}

// ------------------------------------------------------------------ calculation

/** Results of a recalculation: cell values plus which cells are filled by another cell's spill. */
export type Computed = {
  values: Map<string, Scalar>;
  /** spill anchor key → size, and the cells it covers */
  spills: Map<string, { rows: number; cols: number }>;
  spillOwner: Map<string, string>;
};

const astCache = new Map<string, Node | CellError>();
function ast(formula: string): Node | CellError {
  let n = astCache.get(formula);
  if (!n) {
    try {
      n = parse(formula);
    } catch (e) {
      // Out of stack while parsing isn't a syntax error: don't remember it.
      if (e instanceof RangeError) throw e;
      n = ERR.NAME;
    }
    if (astCache.size > 20_000) astCache.clear();
    astCache.set(formula, n);
  }
  return n;
}

export function sheetBounds(sh: Sheet): { rows: number; cols: number } {
  let rows = 0;
  let cols = 0;
  for (const k in sh.cells) {
    const { r, c } = unkey(k);
    if (r + 1 > rows) rows = r + 1;
    if (c + 1 > cols) cols = c + 1;
  }
  return { rows, cols };
}

/**
 * Recomputes every formula in the workbook (fast enough for tens of thousands of cells).
 * Spilled arrays are found in a first pass; if any exist, a second pass computes each spill's
 * anchor before anything reads a cell it covers, so order never matters.
 */
export function recalc(wb: Workbook, now = new Date()): Computed[] {
  const first = recalcPass(wb, now, null);
  if (first.every((c) => c.spills.size === 0)) return first;
  return recalcPass(wb, now, first.map((c) => c.spillOwner));
}

function recalcPass(wb: Workbook, now: Date, knownOwners: Map<string, string>[] | null): Computed[] {
  const bySheet = new Map(wb.sheets.map((s, i) => [s.name.toLowerCase(), i]));
  const results: Computed[] = wb.sheets.map(() => ({ values: new Map(), spills: new Map(), spillOwner: new Map() }));
  const state = wb.sheets.map(() => new Map<string, 0 | 1>()); // 0 visiting, 1 done
  const bounds = wb.sheets.map(sheetBounds);
  /** Cells being computed right now, outermost first (for resuming after a stack overflow). */
  const active: [number, number, number][] = [];

  const compute = (si: number, r: number, c: number): Scalar => {
    const k = key(r, c);
    const res = results[si];
    const st = state[si].get(k);
    if (st === 1) return res.values.get(k) ?? null;
    if (st === 0) return ERR.CIRC;
    const cell = wb.sheets[si].cells[k];
    const raw = cell?.v;
    const preOwner = knownOwners?.[si].get(k);
    if (preOwner && !res.spillOwner.has(k) && (raw === undefined || raw === null || raw === "")) {
      const a = unkey(preOwner);
      compute(si, a.r, a.c);
    }
    const owner = res.spillOwner.get(k);
    if (owner && (raw === undefined || raw === null || raw === "")) return res.values.get(k) ?? null;
    if (typeof raw !== "string" || !raw.startsWith("=")) {
      state[si].set(k, 1);
      const v = raw === undefined ? null : raw;
      res.values.set(k, v);
      return v;
    }
    state[si].set(k, 0);
    active.push([si, r, c]);
    const node = ast(raw);
    const sheetName = wb.sheets[si].name;
    const ctx: EvalContext = {
      sheet: sheetName,
      row: r,
      col: c,
      get: (sh, rr, cc) => {
        const idx = bySheet.get(sh.toLowerCase());
        if (idx === undefined) return ERR.REF;
        return compute(idx, rr, cc);
      },
      bounds: (sh) => bounds[bySheet.get(sh.toLowerCase()) ?? si] ?? { rows: 0, cols: 0 },
      sheetExists: (sh) => bySheet.has(sh.toLowerCase()),
      names: wb.names,
      now: () => now,
    };
    let out = node instanceof CellError ? node : evaluate(node, ctx);
    let value: Scalar;
    if (isMatrix(out)) {
      const rows = out.length;
      const cols = out[0]?.length ?? 0;
      if (rows === 1 && cols === 1) value = out[0][0];
      else {
        // Spill into the cells below/right if they're all empty.
        let blocked = false;
        for (let i = 0; i < rows && !blocked; i++)
          for (let j = 0; j < cols; j++) {
            if (!i && !j) continue;
            const kk = key(r + i, c + j);
            const other = wb.sheets[si].cells[kk]?.v;
            if ((other !== undefined && other !== null && other !== "") || (res.spillOwner.has(kk) && res.spillOwner.get(kk) !== k)) {
              blocked = true;
              break;
            }
          }
        if (blocked) value = ERR.SPILL;
        else {
          res.spills.set(k, { rows, cols });
          for (let i = 0; i < rows; i++)
            for (let j = 0; j < cols; j++) {
              const kk = key(r + i, c + j);
              const v = out[i][j];
              if (i || j) {
                res.spillOwner.set(kk, k);
                res.values.set(kk, v);
                state[si].set(kk, 1);
              }
            }
          value = out[0][0];
        }
      }
      out = value;
    } else value = out;
    if (value === null && typeof raw === "string" && raw.startsWith("=")) value = 0;
    active.pop();
    state[si].set(k, 1);
    res.values.set(k, value);
    return value;
  };

  // A long chain (A1 needs A2 needs A3…) can overflow the call stack. When it does, the cells
  // that were in progress are queued as checkpoints every 200 levels and computed deepest
  // first, each with a fresh stack, so chains of any length finish.
  const computeSafely = (si: number, r: number, c: number) => {
    const todo: [number, number, number][] = [[si, r, c]];
    let overflows = 0;
    while (todo.length) {
      const [a, b, d] = todo[todo.length - 1];
      try {
        compute(a, b, d);
        todo.pop();
      } catch (e) {
        if (!(e instanceof RangeError)) throw e;
        const snap = active.splice(0);
        for (const st of state) for (const [k, v] of st) if (v === 0) st.delete(k);
        if (++overflows > 10_000 || snap.length < 2) {
          results[a].values.set(key(b, d), ERR.CALC);
          state[a].set(key(b, d), 1);
          todo.pop();
          continue;
        }
        for (let i = 200; i < snap.length; i += 200) todo.push(snap[i]);
      }
    }
  };
  wb.sheets.forEach((sh, si) => {
    for (const k in sh.cells) {
      const { r, c } = unkey(k);
      computeSafely(si, r, c);
    }
  });
  return results;
}

// ------------------------------------------------------------------ ranges

export type Range = { r1: number; c1: number; r2: number; c2: number };

export function normRange(a: { r: number; c: number }, b: { r: number; c: number }): Range {
  return { r1: Math.min(a.r, b.r), c1: Math.min(a.c, b.c), r2: Math.max(a.r, b.r), c2: Math.max(a.c, b.c) };
}

export function inRange(r: number, c: number, g: Range) {
  return r >= g.r1 && r <= g.r2 && c >= g.c1 && c <= g.c2;
}

export function forEachCell(g: Range, f: (r: number, c: number) => void) {
  for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) f(r, c);
}

/** Merge that covers a cell, if any. */
export function mergeAt(sh: Sheet, r: number, c: number): Merge | undefined {
  return sh.merges.find((m) => inRange(r, c, m));
}

// ------------------------------------------------------------------ structural edits

function rekeyCells(cells: Record<string, Cell>, f: (r: number, c: number) => { r: number; c: number } | null): Record<string, Cell> {
  const out: Record<string, Cell> = {};
  for (const k in cells) {
    const { r, c } = unkey(k);
    const n = f(r, c);
    if (n) out[key(n.r, n.c)] = cells[k];
  }
  return out;
}

function shiftIndexMap(m: Record<number, number>, at: number, count: number): Record<number, number> {
  const out: Record<number, number> = {};
  for (const [k, v] of Object.entries(m)) {
    const i = Number(k);
    if (i < at) out[i] = v;
    else if (count > 0 || i >= at - count) out[i + count] = v;
  }
  return out;
}

/** Inserts (count > 0) or deletes (count < 0) rows or columns, fixing every formula in the book. */
export function insertDelete(wb: Workbook, si: number, kind: "row" | "col", at: number, count: number): Workbook {
  const target = wb.sheets[si];
  const sheets = wb.sheets.map((sh, i) => {
    const fixFormulas = (cells: Record<string, Cell>) => {
      const out: Record<string, Cell> = {};
      for (const k in cells) {
        const cell = cells[k];
        out[k] = typeof cell.v === "string" && cell.v.startsWith("=") ? { ...cell, v: adjustForInsert(cell.v, sh.name, target.name, kind, at, count) } : cell;
      }
      return out;
    };
    if (i !== si) return { ...sh, cells: fixFormulas(sh.cells) };
    const moved = rekeyCells(sh.cells, (r, c) => {
      const idx = kind === "row" ? r : c;
      if (idx < at) return { r, c };
      if (count < 0 && idx < at - count) return null;
      return kind === "row" ? { r: r + count, c } : { r, c: c + count };
    });
    const shiftMerge = (m: Merge): Merge | null => {
      const lo = kind === "row" ? m.r1 : m.c1;
      const hi = kind === "row" ? m.r2 : m.c2;
      let nlo = lo;
      let nhi = hi;
      if (count > 0) {
        if (lo >= at) nlo += count;
        if (hi >= at) nhi += count;
      } else {
        const del0 = at;
        const del1 = at - count - 1;
        const shift = (x: number) => (x > del1 ? x + count : x >= del0 ? del0 : x);
        nlo = shift(lo);
        nhi = hi > del1 ? hi + count : hi >= del0 ? del0 - 1 : hi;
        if (nhi < nlo) return null;
      }
      const res = kind === "row" ? { ...m, r1: nlo, r2: nhi } : { ...m, c1: nlo, c2: nhi };
      return res.r1 === res.r2 && res.c1 === res.c2 ? null : res;
    };
    return {
      ...sh,
      cells: fixFormulas(moved),
      colW: kind === "col" ? shiftIndexMap(sh.colW, at, count) : sh.colW,
      rowH: kind === "row" ? shiftIndexMap(sh.rowH, at, count) : sh.rowH,
      merges: sh.merges.map(shiftMerge).filter((m): m is Merge => Boolean(m)),
      rows: kind === "row" ? Math.max(1, sh.rows + count) : sh.rows,
      cols: kind === "col" ? Math.max(1, sh.cols + count) : sh.cols,
    };
  });
  return { ...wb, sheets };
}

// ------------------------------------------------------------------ sorting & data tools

function sortKey(v: Scalar): [number, number | string] {
  if (v === null || v === "") return [3, ""];
  if (typeof v === "number") return [0, v];
  if (typeof v === "boolean") return [2, v ? 1 : 0];
  if (isError(v)) return [4, v.code];
  return [1, v.toLowerCase()];
}

/** Sorts the rows of a range by one or more columns (values as shown), keeping styles with their rows. */
export function sortRange(sh: Sheet, values: Map<string, Scalar>, g: Range, by: { col: number; desc: boolean }[], hasHeader: boolean): Sheet {
  const start = hasHeader ? g.r1 + 1 : g.r1;
  const rows: { cells: (Cell | undefined)[]; keys: [number, number | string][] }[] = [];
  for (let r = start; r <= g.r2; r++) {
    const cells: (Cell | undefined)[] = [];
    for (let c = g.c1; c <= g.c2; c++) cells.push(sh.cells[key(r, c)]);
    rows.push({ cells, keys: by.map((b) => sortKey(values.get(key(r, b.col)) ?? null)) });
  }
  rows.sort((a, b) => {
    for (let i = 0; i < by.length; i++) {
      const [ta, va] = a.keys[i];
      const [tb, vb] = b.keys[i];
      if (ta !== tb) return ta - tb; // blanks always last
      if (va === vb) continue;
      const cmp = va < vb ? -1 : 1;
      return by[i].desc && ta < 3 ? -cmp : cmp;
    }
    return 0;
  });
  const cells = { ...sh.cells };
  rows.forEach((row, i) => {
    const r = start + i;
    row.cells.forEach((cell, j) => {
      const k = key(r, g.c1 + j);
      if (cell) cells[k] = cell;
      else delete cells[k];
    });
  });
  return { ...sh, cells };
}

export function removeDuplicates(sh: Sheet, values: Map<string, Scalar>, g: Range, hasHeader: boolean): { sheet: Sheet; removed: number } {
  const start = hasHeader ? g.r1 + 1 : g.r1;
  const seen = new Set<string>();
  const kept: (Cell | undefined)[][] = [];
  let removed = 0;
  for (let r = start; r <= g.r2; r++) {
    const sig = Array.from({ length: g.c2 - g.c1 + 1 }, (_, j) => String(values.get(key(r, g.c1 + j)) ?? "").toLowerCase()).join("\u0001");
    if (seen.has(sig)) {
      removed++;
      continue;
    }
    seen.add(sig);
    kept.push(Array.from({ length: g.c2 - g.c1 + 1 }, (_, j) => sh.cells[key(r, g.c1 + j)]));
  }
  const cells = { ...sh.cells };
  for (let r = start; r <= g.r2; r++)
    for (let c = g.c1; c <= g.c2; c++) {
      const row = kept[r - start];
      const cell = row?.[c - g.c1];
      if (cell) cells[key(r, c)] = cell;
      else delete cells[key(r, c)];
    }
  return { sheet: { ...sh, cells }, removed };
}

/** Text to columns: splits the first column of a range by a delimiter into the columns to the right. */
export function splitColumn(sh: Sheet, g: Range, delim: string): Sheet {
  const cells = { ...sh.cells };
  for (let r = g.r1; r <= g.r2; r++) {
    const k = key(r, g.c1);
    const v = cells[k]?.v;
    if (typeof v !== "string" || v.startsWith("=")) continue;
    v.split(delim === "\\t" ? "\t" : delim).forEach((part, j) => {
      const parsed = parseInput(part.trim());
      cells[key(r, g.c1 + j)] = { ...(cells[key(r, g.c1 + j)] ?? {}), v: parsed.v, s: parsed.fmt ? { ...(cells[key(r, g.c1 + j)]?.s ?? {}), fmt: parsed.fmt } : cells[key(r, g.c1 + j)]?.s };
    });
  }
  return { ...sh, cells };
}

// ------------------------------------------------------------------ fill series

/** Predicts the next values for a fill-handle drag from the selected seed values. */
export function fillSeries(seed: (string | number | boolean | null | undefined)[], count: number): (string | number | boolean | null)[] {
  const vals = seed.map((v) => (v === undefined ? null : v));
  if (!vals.length) return [];
  const nums = vals.every((v) => typeof v === "number");
  if (nums) {
    const n = vals as number[];
    const step = n.length > 1 ? n[n.length - 1] - n[n.length - 2] : 1;
    const isLinear = n.length < 3 || n.every((x, i) => i === 0 || Math.abs(x - n[i - 1] - step) < 1e-9);
    if (n.length === 1) return Array.from({ length: count }, (_, i) => n[0] + (i + 1));
    return isLinear ? Array.from({ length: count }, (_, i) => n[n.length - 1] + step * (i + 1)) : Array.from({ length: count }, (_, i) => n[i % n.length]);
  }
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const last = vals[vals.length - 1];
  if (typeof last === "string") {
    for (const list of [days, months]) {
      const full = list.findIndex((x) => x.toLowerCase() === last.toLowerCase());
      const short = list.findIndex((x) => x.slice(0, 3).toLowerCase() === last.toLowerCase());
      const idx = full >= 0 ? full : short;
      if (idx >= 0) {
        const fmt = (s: string) => {
          const out = full >= 0 ? s : s.slice(0, 3);
          return last === last.toUpperCase() ? out.toUpperCase() : last === last.toLowerCase() ? out.toLowerCase() : out;
        };
        return Array.from({ length: count }, (_, i) => fmt(list[(idx + i + 1) % list.length]));
      }
    }
    const m = /^(.*?)(\d+)(\D*)$/.exec(last);
    if (m && !last.startsWith("=")) {
      const prev = vals.length > 1 && typeof vals[vals.length - 2] === "string" ? /^(.*?)(\d+)(\D*)$/.exec(vals[vals.length - 2] as string) : null;
      const step = prev && prev[1] === m[1] ? Number(m[2]) - Number(prev[2]) || 1 : 1;
      return Array.from({ length: count }, (_, i) => `${m[1]}${String(Number(m[2]) + step * (i + 1)).padStart(m[2].startsWith("0") ? m[2].length : 0, "0")}${m[3]}`);
    }
  }
  return Array.from({ length: count }, (_, i) => vals[i % vals.length]);
}

// ------------------------------------------------------------------ conditional formatting

export function parseRangeText(text: string): Range | null {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d+)(?::\$?([A-Za-z]{1,3})\$?(\d+))?$/.exec(text.trim());
  if (!m) return null;
  const col = (s: string) => {
    let n = 0;
    for (const ch of s.toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64;
    return n - 1;
  };
  const r1 = Number(m[2]) - 1;
  const c1 = col(m[1]);
  const r2 = m[3] ? Number(m[4]) - 1 : r1;
  const c2 = m[3] ? col(m[3]) : c1;
  return { r1: Math.min(r1, r2), c1: Math.min(c1, c2), r2: Math.max(r1, r2), c2: Math.max(c1, c2) };
}

export type CondResult = { style?: CellStyle; bar?: { pct: number; color: string } };

/** Per-cell results of every conditional-formatting rule on a sheet. */
export function evalConditional(sh: Sheet, values: Map<string, Scalar>): Map<string, CondResult> {
  const out = new Map<string, CondResult>();
  for (const rule of sh.cond) {
    const g = parseRangeText(rule.range);
    if (!g) continue;
    const cells: { k: string; v: Scalar }[] = [];
    forEachCell(g, (r, c) => {
      const k = key(r, c);
      cells.push({ k, v: values.get(k) ?? null });
    });
    const numsList = cells.map((x) => x.v).filter((v): v is number => typeof v === "number");
    const min = Math.min(...numsList);
    const max = Math.max(...numsList);
    const avg = numsList.reduce((a, b) => a + b, 0) / (numsList.length || 1);
    const counts = new Map<string, number>();
    for (const { v } of cells) if (v !== null && v !== "") counts.set(String(v).toLowerCase(), (counts.get(String(v).toLowerCase()) ?? 0) + 1);
    const sortedNums = [...numsList].sort((a, b) => b - a);
    const n = Number(rule.a ?? 10);
    const a = Number(rule.a);
    const b = Number(rule.b);
    for (const { k, v } of cells) {
      let hit = false;
      switch (rule.type) {
        case "gt":
          hit = typeof v === "number" && v > a;
          break;
        case "lt":
          hit = typeof v === "number" && v < a;
          break;
        case "between":
          hit = typeof v === "number" && v >= Math.min(a, b) && v <= Math.max(a, b);
          break;
        case "eq":
          hit = v !== null && String(v).toLowerCase() === String(rule.a ?? "").toLowerCase();
          break;
        case "text":
          hit = v !== null && String(v).toLowerCase().includes(String(rule.a ?? "").toLowerCase());
          break;
        case "dup":
          hit = v !== null && v !== "" && (counts.get(String(v).toLowerCase()) ?? 0) > 1;
          break;
        case "unique":
          hit = v !== null && v !== "" && counts.get(String(v).toLowerCase()) === 1;
          break;
        case "top":
          hit = typeof v === "number" && sortedNums.indexOf(v) < n && sortedNums.indexOf(v) >= 0;
          break;
        case "bottom":
          hit = typeof v === "number" && [...sortedNums].reverse().indexOf(v) < n && sortedNums.indexOf(v) >= 0;
          break;
        case "above":
          hit = typeof v === "number" && v > avg;
          break;
        case "below":
          hit = typeof v === "number" && v < avg;
          break;
        case "blank":
          hit = v === null || v === "";
          break;
        case "scale":
          if (typeof v === "number" && max > min) {
            const t = (v - min) / (max - min);
            const [lo, mid, hi] = rule.colors ?? ["#f8696b", "#ffeb84", "#63be7b"];
            const fill = hi ? (t < 0.5 ? mix(lo, mid, t * 2) : mix(mid, hi, (t - 0.5) * 2)) : mix(lo, mid, t);
            out.set(k, { ...out.get(k), style: { ...out.get(k)?.style, fill } });
          }
          continue;
        case "bar":
          if (typeof v === "number" && max > 0) out.set(k, { ...out.get(k), bar: { pct: Math.max(0, Math.min(1, (v - Math.min(0, min)) / (max - Math.min(0, min)))), color: rule.colors?.[0] ?? "#638ec6" } });
          continue;
      }
      if (hit) out.set(k, { ...out.get(k), style: { ...out.get(k)?.style, ...rule.style } });
    }
  }
  return out;
}

function mix(a: string, b: string, t: number): string {
  const pa = hexToRgb(a);
  const pb = hexToRgb(b);
  const c = pa.map((x, i) => Math.round(x + (pb[i] - x) * Math.max(0, Math.min(1, t))));
  return `#${c.map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

function hexToRgb(h: string): number[] {
  const s = h.replace("#", "");
  const full = s.length === 3 ? s.split("").map((x) => x + x).join("") : s;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) || 0);
}

// ------------------------------------------------------------------ misc

export function todaySerial(): number {
  return Math.floor(jsDateToSerial(new Date()));
}

export { ERR };
