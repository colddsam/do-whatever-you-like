/**
 * Spreadsheet formula engine (no dependencies, so it is unit-tested directly with Node).
 *
 * - Excel syntax: A1, $A$1, A1:B9, A:A, 3:3, Sheet2!A1, 'My sheet'!A1:B2, {1,2;3,4}, "text",
 *   TRUE/FALSE, #N/A…, operators + - * / ^ & = <> < > <= >= and postfix %.
 * - 200+ functions (maths, statistics, lookup, text, date, logical, financial, dynamic arrays).
 * - Errors propagate like Excel (#DIV/0!, #N/A, #NAME?, #REF!, #VALUE!, #NUM!, #SPILL!, #CIRC!).
 * - Dates are Excel serial numbers (1900 system, days since 1899-12-30).
 */

// ============================================================ values

export class CellError {
  code: string;
  constructor(code: string) {
    this.code = code;
  }
  toString() {
    return this.code;
  }
}
export const ERR = {
  DIV0: new CellError("#DIV/0!"),
  NA: new CellError("#N/A"),
  NAME: new CellError("#NAME?"),
  REF: new CellError("#REF!"),
  VALUE: new CellError("#VALUE!"),
  NUM: new CellError("#NUM!"),
  NULL: new CellError("#NULL!"),
  SPILL: new CellError("#SPILL!"),
  CIRC: new CellError("#CIRC!"),
  CALC: new CellError("#CALC!"),
};
const ERROR_CODES = new Map(Object.values(ERR).map((e) => [e.code, e]));

export type Scalar = number | string | boolean | CellError | null;
/** A 2-D block of values (rows of columns): ranges, array constants and spilled results. */
export type Matrix = Scalar[][];
export type Value = Scalar | Matrix;

export const isMatrix = (v: unknown): v is Matrix => Array.isArray(v);
export const isError = (v: unknown): v is CellError => v instanceof CellError;

// ============================================================ addresses

export type CellRef = { sheet?: string; r: number; c: number; absR?: boolean; absC?: boolean };
export type RangeRef = { sheet?: string; r1: number; c1: number; r2: number; c2: number };

export function colToIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function indexToCol(i: number): string {
  let s = "";
  let n = i + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function addr(r: number, c: number): string {
  return `${indexToCol(c)}${r + 1}`;
}

export function parseAddr(a: string): { r: number; c: number } | null {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/.exec(a.trim());
  if (!m) return null;
  return { r: Number(m[2]) - 1, c: colToIndex(m[1]) };
}

export function rangeToString(r: RangeRef): string {
  const a = addr(r.r1, r.c1);
  const b = addr(r.r2, r.c2);
  return a === b ? a : `${a}:${b}`;
}

export function quoteSheet(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_.]*$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`;
}

// ============================================================ tokenizer

type Tok =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "bool"; v: boolean }
  | { t: "err"; v: CellError }
  | { t: "ref"; v: string; sheet?: string }
  | { t: "name"; v: string }
  | { t: "op"; v: string }
  | { t: "("; v: string }
  | { t: ")"; v: string }
  | { t: ","; v: string }
  | { t: ";"; v: string }
  | { t: "{"; v: string }
  | { t: "}"; v: string };

const REF_RE = /^(\$?[A-Za-z]{1,3}\$?\d{1,7}(?::\$?[A-Za-z]{1,3}\$?\d{1,7})?|\$?[A-Za-z]{1,3}:\$?[A-Za-z]{1,3}|\$?\d{1,7}:\$?\d{1,7})(?![A-Za-z0-9_(.])/;

export function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const s = src;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      let str = "";
      while (j < s.length) {
        if (s[j] === '"') {
          if (s[j + 1] === '"') {
            str += '"';
            j += 2;
            continue;
          }
          break;
        }
        str += s[j++];
      }
      if (j >= s.length) throw new Error("Unclosed text");
      out.push({ t: "str", v: str });
      i = j + 1;
      continue;
    }
    if (ch === "#") {
      const m = /^#(DIV\/0!|N\/A|NAME\?|REF!|VALUE!|NUM!|NULL!|SPILL!|CALC!|CIRC!)/i.exec(s.slice(i));
      if (!m) throw new Error("Bad error literal");
      out.push({ t: "err", v: ERROR_CODES.get(m[0].toUpperCase()) ?? ERR.VALUE });
      i += m[0].length;
      continue;
    }
    // sheet-qualified reference: 'My sheet'!A1 or Sheet1!A1
    let sheet: string | undefined;
    let rest = s.slice(i);
    const q = /^'((?:[^']|'')+)'!/.exec(rest) ?? /^([A-Za-z_][A-Za-z0-9_.]*)!/.exec(rest);
    if (q) {
      sheet = q[1].replace(/''/g, "'");
      rest = rest.slice(q[0].length);
      const m = REF_RE.exec(rest);
      if (!m) throw new Error("Bad sheet reference");
      out.push({ t: "ref", v: m[1].toUpperCase(), sheet });
      i += q[0].length + m[0].length;
      continue;
    }
    const prev = out[out.length - 1];
    const afterValue = prev && (prev.t === "num" || prev.t === "str" || prev.t === "ref" || prev.t === ")" || prev.t === "bool");
    const refM = REF_RE.exec(rest);
    if (refM && !(afterValue && /^\d/.test(rest))) {
      // A bare row range like 3:3 must not swallow a number in "1:2" arithmetic contexts.
      out.push({ t: "ref", v: refM[1].toUpperCase() });
      i += refM[0].length;
      continue;
    }
    const num = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(rest);
    if (num) {
      out.push({ t: "num", v: Number(num[0]) });
      i += num[0].length;
      continue;
    }
    const name = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(rest);
    if (name) {
      const up = name[0].toUpperCase();
      if ((up === "TRUE" || up === "FALSE") && s[i + name[0].length] !== "(") out.push({ t: "bool", v: up === "TRUE" });
      else out.push({ t: "name", v: up });
      i += name[0].length;
      continue;
    }
    const two = s.slice(i, i + 2);
    if (two === "<=" || two === ">=" || two === "<>") {
      out.push({ t: "op", v: two });
      i += 2;
      continue;
    }
    if ("+-*/^&=<>%".includes(ch)) {
      out.push({ t: "op", v: ch });
      i++;
      continue;
    }
    if (ch === "(" || ch === ")" || ch === "," || ch === ";" || ch === "{" || ch === "}") {
      out.push({ t: ch, v: ch } as Tok);
      i++;
      continue;
    }
    throw new Error(`Unexpected "${ch}"`);
  }
  return out;
}

// ============================================================ parser

export type Node =
  | { k: "num"; v: number }
  | { k: "str"; v: string }
  | { k: "bool"; v: boolean }
  | { k: "err"; v: CellError }
  | { k: "ref"; sheet?: string; ref: string }
  | { k: "name"; v: string }
  | { k: "fn"; name: string; args: Node[] }
  | { k: "un"; op: string; a: Node }
  | { k: "bin"; op: string; a: Node; b: Node }
  | { k: "arr"; rows: Node[][] }
  | { k: "empty" };

const PREC: Record<string, number> = { "=": 1, "<>": 1, "<": 1, ">": 1, "<=": 1, ">=": 1, "&": 2, "+": 3, "-": 3, "*": 4, "/": 4, "^": 5 };

export function parse(formula: string): Node {
  const toks = tokenize(formula.replace(/^=/, ""));
  let p = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];
  const expect = (t: string) => {
    const k = next();
    if (!k || k.t !== t) throw new Error(`Expected ${t}`);
  };

  function primary(): Node {
    const tok = next();
    if (!tok) throw new Error("Unexpected end of formula");
    switch (tok.t) {
      case "num":
        return { k: "num", v: tok.v };
      case "str":
        return { k: "str", v: tok.v };
      case "bool":
        return { k: "bool", v: tok.v };
      case "err":
        return { k: "err", v: tok.v };
      case "ref":
        return { k: "ref", ref: tok.v, sheet: tok.sheet };
      case "op":
        // Excel binds a leading minus tighter than ^, so -2^2 is 4.
        if (tok.v === "-" || tok.v === "+") return { k: "un", op: tok.v, a: postfix() };
        throw new Error(`Unexpected ${tok.v}`);
      case "(": {
        const e = expr(0);
        expect(")");
        return e;
      }
      case "{": {
        const rows: Node[][] = [[]];
        while (peek() && peek().t !== "}") {
          rows[rows.length - 1].push(expr(0));
          const sep = peek();
          if (sep?.t === ",") next();
          else if (sep?.t === ";") {
            next();
            rows.push([]);
          }
        }
        expect("}");
        return { k: "arr", rows };
      }
      case "name": {
        if (peek()?.t === "(") {
          next();
          const args: Node[] = [];
          if (peek()?.t !== ")") {
            for (;;) {
              if (peek()?.t === "," || peek()?.t === ")") args.push({ k: "empty" });
              else args.push(expr(0));
              if (peek()?.t === ",") {
                next();
                if (peek()?.t === ")") args.push({ k: "empty" });
                continue;
              }
              break;
            }
          }
          expect(")");
          return { k: "fn", name: tok.v.replace(/^_XLFN\./, ""), args };
        }
        return { k: "name", v: tok.v };
      }
      default:
        throw new Error(`Unexpected ${tok.v}`);
    }
  }

  function postfix(): Node {
    let n = primary();
    while (peek()?.t === "op" && peek().v === "%") {
      next();
      n = { k: "un", op: "%", a: n };
    }
    return n;
  }

  function expr(min: number): Node {
    let left = postfix();
    for (;;) {
      const tok = peek();
      if (!tok || tok.t !== "op" || PREC[tok.v] === undefined) break;
      const prec = PREC[tok.v];
      if (prec < min) break;
      next();
      // ^ is left-associative in Excel too.
      const right = expr(prec + 1);
      left = { k: "bin", op: tok.v, a: left, b: right };
    }
    return left;
  }

  const tree = expr(0);
  if (p < toks.length) throw new Error(`Unexpected ${toks[p].v}`);
  return tree;
}

// ============================================================ evaluation context

export type EvalContext = {
  /** Current sheet name and the cell being computed (for ROW(), COLUMN() and relative ops). */
  sheet: string;
  row: number;
  col: number;
  /** Computed value of one cell (the engine handles recursion and cycles). */
  get: (sheet: string, r: number, c: number) => Scalar;
  /** Size of the used area of a sheet, to bound whole-column/row references. */
  bounds: (sheet: string) => { rows: number; cols: number };
  sheetExists: (sheet: string) => boolean;
  /** Defined names → reference text (e.g. "Sheet1!$A$1:$A$9"). */
  names?: Record<string, string>;
  now?: () => Date;
};

type Arg = { node: Node; value: () => Value; range?: () => RangeRef | null };

export function resolveRange(ref: string, sheet: string | undefined, ctx: EvalContext): RangeRef | null {
  const sh = sheet ?? ctx.sheet;
  const [a, b] = ref.split(":");
  const cellA = parseAddr(a);
  if (cellA) {
    const cellB = b ? parseAddr(b) : cellA;
    if (!cellB) return null;
    return { sheet: sh, r1: Math.min(cellA.r, cellB.r), c1: Math.min(cellA.c, cellB.c), r2: Math.max(cellA.r, cellB.r), c2: Math.max(cellA.c, cellB.c) };
  }
  const bounds = ctx.bounds(sh);
  if (/^\$?[A-Z]{1,3}$/.test(a) && b && /^\$?[A-Z]{1,3}$/.test(b)) {
    const c1 = colToIndex(a.replace("$", ""));
    const c2 = colToIndex(b.replace("$", ""));
    return { sheet: sh, r1: 0, c1: Math.min(c1, c2), r2: Math.max(0, bounds.rows - 1), c2: Math.max(c1, c2) };
  }
  if (/^\$?\d+$/.test(a) && b && /^\$?\d+$/.test(b)) {
    const r1 = Number(a.replace("$", "")) - 1;
    const r2 = Number(b.replace("$", "")) - 1;
    return { sheet: sh, r1: Math.min(r1, r2), c1: 0, r2: Math.max(r1, r2), c2: Math.max(0, bounds.cols - 1) };
  }
  return null;
}

function readRange(r: RangeRef, ctx: EvalContext): Matrix {
  const sh = r.sheet ?? ctx.sheet;
  const out: Matrix = [];
  for (let i = r.r1; i <= r.r2; i++) {
    const row: Scalar[] = [];
    for (let j = r.c1; j <= r.c2; j++) row.push(ctx.get(sh, i, j));
    out.push(row);
  }
  return out;
}

// ============================================================ coercion

export function toNumber(v: Scalar): number | CellError {
  if (v === null || v === "") return 0;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (isError(v)) return v;
  const s = v.trim();
  const pct = /^([-+]?[\d,]*\.?\d+(?:e[-+]?\d+)?)%$/i.exec(s);
  if (pct) return Number(pct[1].replace(/,/g, "")) / 100;
  const n = Number(s.replace(/^\$|,/g, ""));
  if (s && !Number.isNaN(n)) return n;
  const d = parseDateString(s);
  if (d !== null) return d;
  return ERR.VALUE;
}

export function toText(v: Scalar): string {
  if (v === null) return "";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "number") return formatGeneral(v);
  if (isError(v)) return v.code;
  return v;
}

export function toBool(v: Scalar): boolean | CellError {
  if (v === null) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (isError(v)) return v;
  const u = v.toUpperCase();
  if (u === "TRUE") return true;
  if (u === "FALSE") return false;
  return ERR.VALUE;
}

export function formatGeneral(n: number): string {
  if (!Number.isFinite(n)) return "#NUM!";
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n);
  const abs = Math.abs(n);
  if (abs !== 0 && (abs < 1e-9 || abs >= 1e15)) return n.toExponential(5).replace(/\.?0+e/, "E").replace("e", "E");
  return String(Number(n.toPrecision(15)));
}

/** Top-left value of a matrix, or the scalar itself. */
function scalarOf(v: Value): Scalar {
  if (isMatrix(v)) return v.length && v[0].length ? v[0][0] : null;
  return v;
}

function flatten(v: Value): Scalar[] {
  return isMatrix(v) ? v.flat() : [v];
}

// ============================================================ dates

const DAY_MS = 86_400_000;
const EPOCH = Date.UTC(1899, 11, 30);

export function dateToSerial(y: number, m: number, d: number): number {
  return Math.round((Date.UTC(y, m - 1, d) - EPOCH) / DAY_MS);
}

export function serialToDate(serial: number): Date {
  return new Date(EPOCH + Math.floor(serial) * DAY_MS + Math.round((serial - Math.floor(serial)) * DAY_MS));
}

export function jsDateToSerial(d: Date): number {
  return (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()) - EPOCH) / DAY_MS;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Recognises typed dates and times: 2026-03-14, 14/03/2026, 3/14/2026, 14 Mar 2026, Mar 14, 2026, 9:30, 9:30 PM. */
export function parseDateString(s: string): number | null {
  const t = s.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(t);
  if (m) {
    const base = dateToSerial(+m[1], +m[2], +m[3]);
    return m[4] ? base + (+m[4] * 3600 + +m[5] * 60 + +(m[6] ?? 0)) / 86400 : base;
  }
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(t);
  if (m) {
    let a = +m[1];
    let b = +m[2];
    let y = +m[3];
    if (y < 100) y += y < 50 ? 2000 : 1900;
    // Day-first unless that is impossible (13/… is a day; …/13 means month-first).
    if (b > 12 && a <= 12) [a, b] = [b, a];
    if (a > 31 || b > 12) return null;
    return dateToSerial(y, b, a);
  }
  m = /^(\d{1,2})\s+([A-Za-z]{3,})\.?\s+(\d{4})$/.exec(t);
  if (m) {
    const mi = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
    if (mi >= 0) return dateToSerial(+m[3], mi + 1, +m[1]);
  }
  m = /^([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(t);
  if (m) {
    const mi = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    if (mi >= 0) return dateToSerial(+m[3], mi + 1, +m[2]);
  }
  m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?$/.exec(t);
  if (m) {
    let h = +m[1];
    if (m[4]) {
      const pm = m[4].toLowerCase() === "pm";
      if (h === 12) h = pm ? 12 : 0;
      else if (pm) h += 12;
    }
    if (h > 23 || +m[2] > 59) return null;
    return (h * 3600 + +m[2] * 60 + +(m[3] ?? 0)) / 86400;
  }
  return null;
}

// ============================================================ evaluator

export function evaluate(node: Node, ctx: EvalContext): Value {
  try {
    return evalNode(node, ctx);
  } catch (e) {
    if (e instanceof CellError) return e;
    // Very deep dependency chains: let the workbook resume the calculation (model.ts).
    if (e instanceof RangeError) throw e;
    return ERR.VALUE;
  }
}

function evalNode(n: Node, ctx: EvalContext): Value {
  switch (n.k) {
    case "num":
      return n.v;
    case "str":
      return n.v;
    case "bool":
      return n.v;
    case "err":
      return n.v;
    case "empty":
      return null;
    case "ref": {
      if (n.sheet && !ctx.sheetExists(n.sheet)) return ERR.REF;
      const r = resolveRange(n.ref, n.sheet, ctx);
      if (!r) return ERR.REF;
      if (r.r1 === r.r2 && r.c1 === r.c2) return ctx.get(r.sheet ?? ctx.sheet, r.r1, r.c1);
      return readRange(r, ctx);
    }
    case "name": {
      const def = ctx.names?.[n.v];
      if (!def) return ERR.NAME;
      return evalNode(parse(def), ctx);
    }
    case "arr":
      return n.rows.map((row) => row.map((c) => scalarOf(evalNode(c, ctx))));
    case "un": {
      const v = evalNode(n.a, ctx);
      return mapUnary(v, (x) => {
        const num = toNumber(x);
        if (isError(num)) return num;
        return n.op === "-" ? -num : n.op === "%" ? num / 100 : num;
      });
    }
    case "bin":
      return binary(n.op, evalNode(n.a, ctx), evalNode(n.b, ctx));
    case "fn":
      return callFunction(n.name, n.args, ctx);
  }
}

function mapUnary(v: Value, f: (x: Scalar) => Scalar): Value {
  return isMatrix(v) ? v.map((row) => row.map(f)) : f(v);
}

function compare(a: Scalar, b: Scalar): number {
  // Excel ordering: numbers < text < booleans; blanks act as 0 / "" / FALSE.
  const rank = (x: Scalar) => (typeof x === "number" ? 0 : typeof x === "string" ? 1 : typeof x === "boolean" ? 2 : 0);
  if (a === null) a = typeof b === "string" ? "" : typeof b === "boolean" ? false : 0;
  if (b === null) b = typeof a === "string" ? "" : typeof a === "boolean" ? false : 0;
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (typeof a === "string" && typeof b === "string") {
    const x = a.toLowerCase();
    const y = b.toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  }
  const x = Number(a);
  const y = Number(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

function binScalar(op: string, a: Scalar, b: Scalar): Scalar {
  if (isError(a)) return a;
  if (isError(b)) return b;
  if (op === "&") return toText(a) + toText(b);
  if (["=", "<>", "<", ">", "<=", ">="].includes(op)) {
    const c = compare(a, b);
    switch (op) {
      case "=":
        return c === 0;
      case "<>":
        return c !== 0;
      case "<":
        return c < 0;
      case ">":
        return c > 0;
      case "<=":
        return c <= 0;
      default:
        return c >= 0;
    }
  }
  const x = toNumber(a);
  const y = toNumber(b);
  if (isError(x)) return x;
  if (isError(y)) return y;
  switch (op) {
    case "+":
      return x + y;
    case "-":
      return x - y;
    case "*":
      return x * y;
    case "/":
      return y === 0 ? ERR.DIV0 : x / y;
    case "^": {
      const r = Math.pow(x, y);
      return Number.isFinite(r) ? r : ERR.NUM;
    }
  }
  return ERR.VALUE;
}

/** Element-wise with broadcasting (a single row/column/value stretches to the other's size). */
function binary(op: string, a: Value, b: Value): Value {
  if (!isMatrix(a) && !isMatrix(b)) return binScalar(op, a, b);
  const A = isMatrix(a) ? a : [[a]];
  const B = isMatrix(b) ? b : [[b]];
  const rows = Math.max(A.length, B.length);
  const cols = Math.max(A[0]?.length ?? 0, B[0]?.length ?? 0);
  const at = (M: Matrix, i: number, j: number): Scalar => {
    const r = M.length === 1 ? 0 : i;
    const c = M[0].length === 1 ? 0 : j;
    return M[r]?.[c] ?? ERR.NA;
  };
  const out: Matrix = [];
  for (let i = 0; i < rows; i++) {
    const row: Scalar[] = [];
    for (let j = 0; j < cols; j++) row.push(binScalar(op, at(A, i, j), at(B, i, j)));
    out.push(row);
  }
  return out;
}

// ============================================================ functions

type Fn = (args: Arg[], ctx: EvalContext) => Value;
const FN: Record<string, Fn> = {};

/** Function catalogue for autocomplete & the function browser: name → [category, signature, description]. */
export const FUNCTION_INFO: Record<string, [string, string, string]> = {};

function def(names: string, category: string, signature: string, description: string, fn: Fn) {
  for (const name of names.split(",")) {
    FN[name] = fn;
    FUNCTION_INFO[name] = [category, signature.replace(/^\w+/, name), description];
  }
}

function makeArgs(nodes: Node[], ctx: EvalContext): Arg[] {
  return nodes.map((node) => {
    let cached: Value | undefined;
    return {
      node,
      value: () => (cached === undefined ? (cached = evalNode(node, ctx)) : cached),
      range: () => (node.k === "ref" ? resolveRange(node.ref, node.sheet, ctx) : null),
    };
  });
}

function callFunction(name: string, nodes: Node[], ctx: EvalContext): Value {
  const fn = FN[name];
  if (!fn) return ERR.NAME;
  return fn(makeArgs(nodes, ctx), ctx);
}

// ---------- helpers for function bodies

/** Numbers from arguments the way SUM sees them: numbers in ranges; typed numbers/booleans/text-numbers directly. */
function nums(args: Arg[], opts: { includeTextInRanges?: boolean } = {}): number[] | CellError {
  const out: number[] = [];
  for (const a of args) {
    if (a.node.k === "empty") continue;
    const v = a.value();
    if (isMatrix(v)) {
      for (const x of v.flat()) {
        if (isError(x)) return x;
        if (typeof x === "number") out.push(x);
        else if (opts.includeTextInRanges && (typeof x === "string" || typeof x === "boolean")) out.push(typeof x === "boolean" ? (x ? 1 : 0) : 0);
      }
    } else {
      if (isError(v)) return v;
      if (v === null) continue;
      const n = toNumber(v);
      if (isError(n)) return n;
      out.push(n);
    }
  }
  return out;
}

function num(a: Arg | undefined, fallback?: number): number {
  if (!a || a.node.k === "empty") {
    if (fallback === undefined) throw ERR.VALUE;
    return fallback;
  }
  const v = scalarOf(a.value());
  if (isError(v)) throw v;
  const n = toNumber(v);
  if (isError(n)) throw n;
  return n;
}

function str(a: Arg | undefined, fallback?: string): string {
  if (!a || a.node.k === "empty") {
    if (fallback === undefined) throw ERR.VALUE;
    return fallback;
  }
  const v = scalarOf(a.value());
  if (isError(v)) throw v;
  return toText(v);
}

function bool(a: Arg | undefined, fallback?: boolean): boolean {
  if (!a || a.node.k === "empty") {
    if (fallback === undefined) throw ERR.VALUE;
    return fallback;
  }
  const v = scalarOf(a.value());
  if (isError(v)) throw v;
  const b = toBool(v);
  if (isError(b)) throw b;
  return b;
}

function matrix(a: Arg | undefined): Matrix {
  if (!a) throw ERR.VALUE;
  const v = a.value();
  if (isError(v)) throw v;
  return isMatrix(v) ? v : [[v]];
}

/** Applies f element-wise when an argument is an array (so =UPPER(A1:A3) spills). */
function lift1(a: Arg, f: (x: Scalar) => Scalar): Value {
  const v = a.value();
  return isMatrix(v) ? v.map((r) => r.map(f)) : f(v);
}

function guard(f: () => Value): Value {
  try {
    return f();
  } catch (e) {
    if (e instanceof CellError) return e;
    if (e instanceof RangeError) throw e;
    return ERR.VALUE;
  }
}

/** COUNTIF-style criteria: ">5", "<>x", "=a*", "app?e", 5, TRUE. */
export function makeCriteria(crit: Scalar): (v: Scalar) => boolean {
  if (typeof crit === "number" || typeof crit === "boolean") return (v) => compare(v, crit) === 0 && v !== null;
  const s = toText(crit);
  const m = /^(<=|>=|<>|<|>|=)?([\s\S]*)$/.exec(s)!;
  const op = m[1] ?? "=";
  const rawTarget = m[2];
  const tn = rawTarget.trim() !== "" ? toNumber(rawTarget) : ERR.VALUE;
  const target: Scalar = !isError(tn) && rawTarget.trim() !== "" ? tn : rawTarget;
  if (typeof target === "string" && (op === "=" || op === "<>") && /[*?]/.test(target)) {
    const re = new RegExp("^" + target.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/~\*/g, "\u0001").replace(/~\?/g, "\u0002").replace(/\*/g, "[\\s\\S]*").replace(/\?/g, ".").replace(/\u0001/g, "\\*").replace(/\u0002/g, "\\?") + "$", "i");
    return (v) => (op === "=" ? re.test(toText(v)) : !re.test(toText(v)));
  }
  if (target === "" && op === "=") return (v) => v === null || v === "";
  if (target === "" && op === "<>") return (v) => v !== null && v !== "";
  return (v) => {
    if (v === null) return op === "<>";
    if (typeof target === "number" && typeof v !== "number") {
      const vn = typeof v === "string" ? toNumber(v) : ERR.VALUE;
      if (isError(vn)) return op === "<>";
      v = vn;
    }
    if (typeof target === "string" && typeof v === "number" && (op === "=" || op === "<>")) return op === "<>";
    const c = compare(v, target);
    switch (op) {
      case "=":
        return c === 0;
      case "<>":
        return c !== 0;
      case "<":
        return c < 0;
      case ">":
        return c > 0;
      case "<=":
        return c <= 0;
      default:
        return c >= 0;
    }
  };
}

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const mean = (a: number[]) => (a.length ? sum(a) / a.length : NaN);
function variance(a: number[], sample: boolean): number {
  if (a.length < (sample ? 2 : 1)) throw ERR.DIV0;
  const m = mean(a);
  return sum(a.map((x) => (x - m) ** 2)) / (a.length - (sample ? 1 : 0));
}
function sorted(a: number[]) {
  return [...a].sort((x, y) => x - y);
}
function percentileInc(a: number[], p: number): number {
  if (!a.length || p < 0 || p > 1) throw ERR.NUM;
  const s = sorted(a);
  const rank = p * (s.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return s[lo] + (s[hi] - s[lo]) * (rank - lo);
}
function roundTo(x: number, d: number, mode: "round" | "up" | "down" = "round"): number {
  const f = Math.pow(10, d);
  const v = x * f;
  const r = mode === "round" ? Math.sign(v) * Math.round(Math.abs(v) + 1e-9) : mode === "up" ? Math.sign(v) * Math.ceil(Math.abs(v) - 1e-9) : Math.sign(v) * Math.floor(Math.abs(v) + 1e-9);
  return r / f;
}
const numOrErr = (n: number): Scalar => (Number.isFinite(n) ? n : ERR.NUM);

// ---------- maths

def("SUM", "Math", "SUM(number1, [number2], …)", "Adds numbers and ranges.", (a) => guard(() => {
  const n = nums(a);
  return isError(n) ? n : sum(n);
}));
def("PRODUCT", "Math", "PRODUCT(number1, …)", "Multiplies numbers.", (a) => guard(() => {
  const n = nums(a);
  return isError(n) ? n : n.reduce((x, y) => x * y, 1);
}));
def("ABS", "Math", "ABS(number)", "Absolute value.", (a) => guard(() => lift1(a[0], (x) => { const n = toNumber(x); return isError(n) ? n : Math.abs(n); })));
def("SQRT", "Math", "SQRT(number)", "Square root.", (a) => guard(() => { const n = num(a[0]); return n < 0 ? ERR.NUM : Math.sqrt(n); }));
def("POWER", "Math", "POWER(number, power)", "Raises to a power.", (a) => guard(() => numOrErr(Math.pow(num(a[0]), num(a[1])))));
def("EXP", "Math", "EXP(number)", "e raised to a power.", (a) => guard(() => numOrErr(Math.exp(num(a[0])))));
def("LN", "Math", "LN(number)", "Natural logarithm.", (a) => guard(() => { const n = num(a[0]); return n <= 0 ? ERR.NUM : Math.log(n); }));
def("LOG", "Math", "LOG(number, [base])", "Logarithm (base 10 by default).", (a) => guard(() => { const n = num(a[0]); const b = num(a[1], 10); return n <= 0 || b <= 0 || b === 1 ? ERR.NUM : Math.log(n) / Math.log(b); }));
def("LOG10", "Math", "LOG10(number)", "Base-10 logarithm.", (a) => guard(() => { const n = num(a[0]); return n <= 0 ? ERR.NUM : Math.log10(n); }));
def("MOD", "Math", "MOD(number, divisor)", "Remainder after division (sign of the divisor).", (a) => guard(() => { const n = num(a[0]); const d = num(a[1]); return d === 0 ? ERR.DIV0 : n - d * Math.floor(n / d); }));
def("QUOTIENT", "Math", "QUOTIENT(numerator, denominator)", "Integer part of a division.", (a) => guard(() => { const d = num(a[1]); return d === 0 ? ERR.DIV0 : Math.trunc(num(a[0]) / d); }));
def("INT", "Math", "INT(number)", "Rounds down to an integer.", (a) => guard(() => Math.floor(num(a[0]))));
def("TRUNC", "Math", "TRUNC(number, [digits])", "Cuts off decimals.", (a) => guard(() => roundTo(num(a[0]), num(a[1], 0), "down")));
def("ROUND", "Math", "ROUND(number, digits)", "Rounds to a number of digits.", (a) => guard(() => roundTo(num(a[0]), num(a[1], 0))));
def("ROUNDUP", "Math", "ROUNDUP(number, digits)", "Rounds away from zero.", (a) => guard(() => roundTo(num(a[0]), num(a[1], 0), "up")));
def("ROUNDDOWN", "Math", "ROUNDDOWN(number, digits)", "Rounds toward zero.", (a) => guard(() => roundTo(num(a[0]), num(a[1], 0), "down")));
def("MROUND", "Math", "MROUND(number, multiple)", "Rounds to the nearest multiple.", (a) => guard(() => { const m = num(a[1]); return m === 0 ? 0 : Math.round(num(a[0]) / m) * m; }));
def("CEILING,CEILING.MATH", "Math", "CEILING(number, [significance])", "Rounds up to a multiple.", (a) => guard(() => { const s = Math.abs(num(a[1], 1)); return s === 0 ? 0 : Math.ceil(num(a[0]) / s - 1e-12) * s; }));
def("FLOOR,FLOOR.MATH", "Math", "FLOOR(number, [significance])", "Rounds down to a multiple.", (a) => guard(() => { const s = Math.abs(num(a[1], 1)); return s === 0 ? 0 : Math.floor(num(a[0]) / s + 1e-12) * s; }));
def("EVEN", "Math", "EVEN(number)", "Rounds up to an even integer.", (a) => guard(() => { const n = num(a[0]); const r = Math.ceil(Math.abs(n) / 2) * 2; return n < 0 ? -r : r; }));
def("ODD", "Math", "ODD(number)", "Rounds up to an odd integer.", (a) => guard(() => { const n = num(a[0]); let r = Math.ceil(Math.abs(n)); if (r % 2 === 0) r++; return n < 0 ? -r : r; }));
def("SIGN", "Math", "SIGN(number)", "1, 0 or -1.", (a) => guard(() => Math.sign(num(a[0]))));
def("PI", "Math", "PI()", "The number π.", () => Math.PI);
def("RAND", "Math", "RAND()", "Random number between 0 and 1.", () => Math.random());
def("RANDBETWEEN", "Math", "RANDBETWEEN(bottom, top)", "Random whole number in a range.", (a) => guard(() => { const lo = Math.ceil(num(a[0])); const hi = Math.floor(num(a[1])); return lo > hi ? ERR.NUM : lo + Math.floor(Math.random() * (hi - lo + 1)); }));
def("FACT", "Math", "FACT(number)", "Factorial.", (a) => guard(() => { const n = Math.floor(num(a[0])); if (n < 0) return ERR.NUM; let r = 1; for (let i = 2; i <= n; i++) r *= i; return numOrErr(r); }));
def("COMBIN", "Math", "COMBIN(number, chosen)", "Number of combinations.", (a) => guard(() => { const n = Math.floor(num(a[0])); const k = Math.floor(num(a[1])); if (k < 0 || n < k) return ERR.NUM; let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return Math.round(r); }));
def("PERMUT", "Math", "PERMUT(number, chosen)", "Number of permutations.", (a) => guard(() => { const n = Math.floor(num(a[0])); const k = Math.floor(num(a[1])); if (k < 0 || n < k) return ERR.NUM; let r = 1; for (let i = 0; i < k; i++) r *= n - i; return r; }));
def("GCD", "Math", "GCD(number1, …)", "Greatest common divisor.", (a) => guard(() => { const n = nums(a); if (isError(n)) return n; const g = (x: number, y: number): number => (y ? g(y, x % y) : x); return n.map(Math.floor).reduce((x, y) => g(Math.abs(x), Math.abs(y)), 0); }));
def("LCM", "Math", "LCM(number1, …)", "Least common multiple.", (a) => guard(() => { const n = nums(a); if (isError(n)) return n; const g = (x: number, y: number): number => (y ? g(y, x % y) : x); return n.map(Math.floor).reduce((x, y) => (x && y ? Math.abs(x * y) / g(x, y) : 0), 1); }));
def("SIN", "Math", "SIN(angle)", "Sine (radians).", (a) => guard(() => Math.sin(num(a[0]))));
def("COS", "Math", "COS(angle)", "Cosine (radians).", (a) => guard(() => Math.cos(num(a[0]))));
def("TAN", "Math", "TAN(angle)", "Tangent (radians).", (a) => guard(() => Math.tan(num(a[0]))));
def("ASIN", "Math", "ASIN(number)", "Arcsine.", (a) => guard(() => numOrErr(Math.asin(num(a[0])))));
def("ACOS", "Math", "ACOS(number)", "Arccosine.", (a) => guard(() => numOrErr(Math.acos(num(a[0])))));
def("ATAN", "Math", "ATAN(number)", "Arctangent.", (a) => guard(() => Math.atan(num(a[0]))));
def("ATAN2", "Math", "ATAN2(x, y)", "Arctangent of x and y.", (a) => guard(() => Math.atan2(num(a[1]), num(a[0]))));
def("DEGREES", "Math", "DEGREES(angle)", "Radians to degrees.", (a) => guard(() => (num(a[0]) * 180) / Math.PI));
def("RADIANS", "Math", "RADIANS(angle)", "Degrees to radians.", (a) => guard(() => (num(a[0]) * Math.PI) / 180));
def("SUMSQ", "Math", "SUMSQ(number1, …)", "Sum of squares.", (a) => guard(() => { const n = nums(a); return isError(n) ? n : sum(n.map((x) => x * x)); }));
def("SUMPRODUCT", "Math", "SUMPRODUCT(array1, [array2], …)", "Multiplies matching items and adds them.", (a) => guard(() => {
  const ms = a.map(matrix);
  const rows = ms[0].length;
  const cols = ms[0][0]?.length ?? 0;
  if (ms.some((m) => m.length !== rows || (m[0]?.length ?? 0) !== cols)) return ERR.VALUE;
  let total = 0;
  for (let i = 0; i < rows; i++)
    for (let j = 0; j < cols; j++) {
      let p = 1;
      for (const m of ms) {
        const v = m[i][j];
        if (isError(v)) return v;
        p *= typeof v === "number" ? v : typeof v === "boolean" ? (v ? 1 : 0) : 0;
      }
      total += p;
    }
  return total;
}));
def("SUMIF", "Math", "SUMIF(range, criteria, [sum_range])", "Adds the cells that meet a condition.", (a) => guard(() => {
  const r = matrix(a[0]);
  const test = makeCriteria(scalarOf(a[1].value()));
  const s = a[2] ? matrix(a[2]) : r;
  let total = 0;
  r.forEach((row, i) => row.forEach((v, j) => { if (test(v)) { const x = s[i]?.[j]; if (typeof x === "number") total += x; } }));
  return total;
}));
function multiIf(a: Arg[], start: number): boolean[][] | CellError {
  const first = matrix(a[start]);
  const mask = first.map((row) => row.map(() => true));
  for (let k = start; k + 1 < a.length; k += 2) {
    const r = matrix(a[k]);
    if (r.length !== first.length || r[0].length !== first[0].length) return ERR.VALUE;
    const test = makeCriteria(scalarOf(a[k + 1].value()));
    r.forEach((row, i) => row.forEach((v, j) => { if (!test(v)) mask[i][j] = false; }));
  }
  return mask;
}
def("SUMIFS", "Math", "SUMIFS(sum_range, criteria_range1, criteria1, …)", "Adds cells that meet several conditions.", (a) => guard(() => {
  const s = matrix(a[0]);
  const mask = multiIf(a, 1);
  if (isError(mask)) return mask;
  let t = 0;
  s.forEach((row, i) => row.forEach((v, j) => { if (mask[i]?.[j] && typeof v === "number") t += v; }));
  return t;
}));
def("SUBTOTAL", "Math", "SUBTOTAL(function_num, ref1, …)", "Subtotal with AVERAGE(1), COUNT(2), COUNTA(3), MAX(4), MIN(5), PRODUCT(6), STDEV(7), SUM(9)…", (a, ctx) => guard(() => {
  const code = num(a[0]) % 100;
  const map: Record<number, string> = { 1: "AVERAGE", 2: "COUNT", 3: "COUNTA", 4: "MAX", 5: "MIN", 6: "PRODUCT", 7: "STDEV", 8: "STDEVP", 9: "SUM", 10: "VAR", 11: "VARP" };
  const name = map[code];
  return name ? FN[name](a.slice(1), ctx) : ERR.VALUE;
}));
def("AGGREGATE", "Math", "AGGREGATE(function_num, options, ref1, …)", "Like SUBTOTAL, ignoring errors.", (a, ctx) => guard(() => {
  const code = num(a[0]);
  const map: Record<number, string> = { 1: "AVERAGE", 2: "COUNT", 3: "COUNTA", 4: "MAX", 5: "MIN", 6: "PRODUCT", 7: "STDEV", 8: "STDEVP", 9: "SUM", 10: "VAR", 11: "VARP", 12: "MEDIAN", 14: "LARGE", 15: "SMALL" };
  const name = map[code];
  if (!name) return ERR.VALUE;
  const clean = a.slice(2).map((x) => ({ ...x, value: () => { const v = x.value(); return isMatrix(v) ? v.map((r) => r.map((y) => (isError(y) ? null : y))) : isError(v) ? null : v; } }));
  return FN[name](clean, ctx);
}));

// ---------- statistics

def("AVERAGE", "Statistical", "AVERAGE(number1, …)", "Arithmetic mean.", (a) => guard(() => { const n = nums(a); return isError(n) ? n : n.length ? mean(n) : ERR.DIV0; }));
def("AVERAGEA", "Statistical", "AVERAGEA(value1, …)", "Mean counting text as 0 and TRUE as 1.", (a) => guard(() => { const n = nums(a, { includeTextInRanges: true }); return isError(n) ? n : n.length ? mean(n) : ERR.DIV0; }));
def("AVERAGEIF", "Statistical", "AVERAGEIF(range, criteria, [average_range])", "Mean of the cells that meet a condition.", (a) => guard(() => {
  const r = matrix(a[0]);
  const test = makeCriteria(scalarOf(a[1].value()));
  const s = a[2] ? matrix(a[2]) : r;
  const vals: number[] = [];
  r.forEach((row, i) => row.forEach((v, j) => { if (test(v)) { const x = s[i]?.[j]; if (typeof x === "number") vals.push(x); } }));
  return vals.length ? mean(vals) : ERR.DIV0;
}));
def("AVERAGEIFS", "Statistical", "AVERAGEIFS(average_range, criteria_range1, criteria1, …)", "Mean with several conditions.", (a) => guard(() => {
  const s = matrix(a[0]);
  const mask = multiIf(a, 1);
  if (isError(mask)) return mask;
  const vals: number[] = [];
  s.forEach((row, i) => row.forEach((v, j) => { if (mask[i]?.[j] && typeof v === "number") vals.push(v); }));
  return vals.length ? mean(vals) : ERR.DIV0;
}));
def("COUNT", "Statistical", "COUNT(value1, …)", "Counts numbers.", (a) => {
  let c = 0;
  for (const x of a) {
    if (x.node.k === "empty") continue;
    const v = x.value();
    if (isMatrix(v)) c += v.flat().filter((y) => typeof y === "number").length;
    else if (typeof v === "number" || (typeof v === "string" && !isError(toNumber(v)) && v.trim() !== "") || typeof v === "boolean") c++;
  }
  return c;
});
def("COUNTA", "Statistical", "COUNTA(value1, …)", "Counts non-empty cells.", (a) => {
  let c = 0;
  for (const x of a) {
    if (x.node.k === "empty") continue;
    const v = x.value();
    c += flatten(v).filter((y) => y !== null && y !== "").length;
  }
  return c;
});
def("COUNTBLANK", "Statistical", "COUNTBLANK(range)", "Counts empty cells.", (a) => guard(() => matrix(a[0]).flat().filter((y) => y === null || y === "").length));
def("COUNTIF", "Statistical", "COUNTIF(range, criteria)", "Counts cells that meet a condition.", (a) => guard(() => { const test = makeCriteria(scalarOf(a[1].value())); return matrix(a[0]).flat().filter(test).length; }));
def("COUNTIFS", "Statistical", "COUNTIFS(criteria_range1, criteria1, …)", "Counts cells meeting several conditions.", (a) => guard(() => { const mask = multiIf(a, 0); return isError(mask) ? mask : mask.flat().filter(Boolean).length; }));
def("MAX", "Statistical", "MAX(number1, …)", "Largest number.", (a) => guard(() => { const n = nums(a); return isError(n) ? n : n.length ? Math.max(...n) : 0; }));
def("MIN", "Statistical", "MIN(number1, …)", "Smallest number.", (a) => guard(() => { const n = nums(a); return isError(n) ? n : n.length ? Math.min(...n) : 0; }));
def("MAXA", "Statistical", "MAXA(value1, …)", "Largest value, text as 0.", (a) => guard(() => { const n = nums(a, { includeTextInRanges: true }); return isError(n) ? n : n.length ? Math.max(...n) : 0; }));
def("MINA", "Statistical", "MINA(value1, …)", "Smallest value, text as 0.", (a) => guard(() => { const n = nums(a, { includeTextInRanges: true }); return isError(n) ? n : n.length ? Math.min(...n) : 0; }));
def("MAXIFS", "Statistical", "MAXIFS(max_range, criteria_range1, criteria1, …)", "Largest value meeting conditions.", (a) => guard(() => { const s = matrix(a[0]); const mask = multiIf(a, 1); if (isError(mask)) return mask; const v = s.flatMap((r, i) => r.filter((x, j) => mask[i]?.[j] && typeof x === "number")) as number[]; return v.length ? Math.max(...v) : 0; }));
def("MINIFS", "Statistical", "MINIFS(min_range, criteria_range1, criteria1, …)", "Smallest value meeting conditions.", (a) => guard(() => { const s = matrix(a[0]); const mask = multiIf(a, 1); if (isError(mask)) return mask; const v = s.flatMap((r, i) => r.filter((x, j) => mask[i]?.[j] && typeof x === "number")) as number[]; return v.length ? Math.min(...v) : 0; }));
def("MEDIAN", "Statistical", "MEDIAN(number1, …)", "Middle value.", (a) => guard(() => { const n = nums(a); return isError(n) ? n : n.length ? percentileInc(n, 0.5) : ERR.NUM; }));
def("MODE,MODE.SNGL", "Statistical", "MODE(number1, …)", "Most frequent value.", (a) => guard(() => {
  const n = nums(a);
  if (isError(n)) return n;
  const counts = new Map<number, number>();
  let best: number | null = null;
  let bestC = 1;
  for (const x of n) {
    const c = (counts.get(x) ?? 0) + 1;
    counts.set(x, c);
    if (c > bestC) {
      bestC = c;
      best = x;
    }
  }
  return best === null ? ERR.NA : best;
}));
def("STDEV,STDEV.S", "Statistical", "STDEV(number1, …)", "Sample standard deviation.", (a) => guard(() => { const n = nums(a); return isError(n) ? n : Math.sqrt(variance(n, true)); }));
def("STDEVP,STDEV.P", "Statistical", "STDEVP(number1, …)", "Population standard deviation.", (a) => guard(() => { const n = nums(a); return isError(n) ? n : Math.sqrt(variance(n, false)); }));
def("VAR,VAR.S", "Statistical", "VAR(number1, …)", "Sample variance.", (a) => guard(() => { const n = nums(a); return isError(n) ? n : variance(n, true); }));
def("VARP,VAR.P", "Statistical", "VARP(number1, …)", "Population variance.", (a) => guard(() => { const n = nums(a); return isError(n) ? n : variance(n, false); }));
def("LARGE", "Statistical", "LARGE(array, k)", "k-th largest value.", (a) => guard(() => { const n = nums([a[0]]); if (isError(n)) return n; const k = Math.floor(num(a[1])); const s = sorted(n).reverse(); return k < 1 || k > s.length ? ERR.NUM : s[k - 1]; }));
def("SMALL", "Statistical", "SMALL(array, k)", "k-th smallest value.", (a) => guard(() => { const n = nums([a[0]]); if (isError(n)) return n; const k = Math.floor(num(a[1])); const s = sorted(n); return k < 1 || k > s.length ? ERR.NUM : s[k - 1]; }));
def("RANK,RANK.EQ", "Statistical", "RANK(number, ref, [order])", "Rank of a number in a list.", (a) => guard(() => { const x = num(a[0]); const n = nums([a[1]]); if (isError(n)) return n; const asc = num(a[2], 0) !== 0; if (!n.includes(x)) return ERR.NA; return 1 + n.filter((y) => (asc ? y < x : y > x)).length; }));
def("RANK.AVG", "Statistical", "RANK.AVG(number, ref, [order])", "Rank, averaging ties.", (a) => guard(() => { const x = num(a[0]); const n = nums([a[1]]); if (isError(n)) return n; const asc = num(a[2], 0) !== 0; if (!n.includes(x)) return ERR.NA; const better = n.filter((y) => (asc ? y < x : y > x)).length; const ties = n.filter((y) => y === x).length; return better + (ties + 1) / 2; }));
def("PERCENTILE,PERCENTILE.INC", "Statistical", "PERCENTILE(array, k)", "k-th percentile (0–1).", (a) => guard(() => { const n = nums([a[0]]); return isError(n) ? n : percentileInc(n, num(a[1])); }));
def("QUARTILE,QUARTILE.INC", "Statistical", "QUARTILE(array, quart)", "Quartile (0–4).", (a) => guard(() => { const n = nums([a[0]]); const q = Math.floor(num(a[1])); return isError(n) ? n : q < 0 || q > 4 ? ERR.NUM : percentileInc(n, q / 4); }));
def("PERCENTRANK,PERCENTRANK.INC", "Statistical", "PERCENTRANK(array, x)", "Rank as a percentage.", (a) => guard(() => { const n = nums([a[0]]); if (isError(n)) return n; const x = num(a[1]); const s = sorted(n); if (x < s[0] || x > s[s.length - 1]) return ERR.NA; const below = s.filter((y) => y < x).length; return Math.floor((below / (s.length - 1)) * 1000) / 1000; }));
def("CORREL,PEARSON", "Statistical", "CORREL(array1, array2)", "Correlation coefficient.", (a) => guard(() => {
  const x = matrix(a[0]).flat();
  const y = matrix(a[1]).flat();
  const pairs = x.map((v, i) => [v, y[i]]).filter(([p, q]) => typeof p === "number" && typeof q === "number") as [number, number][];
  if (pairs.length < 2) return ERR.DIV0;
  const mx = mean(pairs.map((p) => p[0]));
  const my = mean(pairs.map((p) => p[1]));
  const sxy = sum(pairs.map(([p, q]) => (p - mx) * (q - my)));
  const sxx = sum(pairs.map(([p]) => (p - mx) ** 2));
  const syy = sum(pairs.map(([, q]) => (q - my) ** 2));
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : ERR.DIV0;
}));
function regression(a: Arg[]) {
  const y = matrix(a[0]).flat();
  const x = matrix(a[1]).flat();
  const pairs = x.map((v, i) => [v, y[i]]).filter(([p, q]) => typeof p === "number" && typeof q === "number") as [number, number][];
  if (pairs.length < 2) throw ERR.DIV0;
  const mx = mean(pairs.map((p) => p[0]));
  const my = mean(pairs.map((p) => p[1]));
  const sxx = sum(pairs.map(([p]) => (p - mx) ** 2));
  if (!sxx) throw ERR.DIV0;
  const slope = sum(pairs.map(([p, q]) => (p - mx) * (q - my))) / sxx;
  return { slope, intercept: my - slope * mx, pairs, my };
}
def("SLOPE", "Statistical", "SLOPE(known_ys, known_xs)", "Slope of the trend line.", (a) => guard(() => regression(a).slope));
def("INTERCEPT", "Statistical", "INTERCEPT(known_ys, known_xs)", "Where the trend line crosses y.", (a) => guard(() => regression(a).intercept));
def("FORECAST,FORECAST.LINEAR", "Statistical", "FORECAST(x, known_ys, known_xs)", "Predicts a value on the linear trend.", (a) => guard(() => { const r = regression(a.slice(1)); return r.intercept + r.slope * num(a[0]); }));
def("RSQ", "Statistical", "RSQ(known_ys, known_xs)", "R² of the trend line.", (a, ctx) => guard(() => { const c = FN.CORREL([a[1], a[0]], ctx); return typeof c === "number" ? c * c : c; }));
def("TREND", "Statistical", "TREND(known_ys, known_xs, new_xs)", "Values on the linear trend.", (a) => guard(() => { const r = regression(a); const nx = a[2] ? matrix(a[2]) : matrix(a[1]); return nx.map((row) => row.map((v) => (typeof v === "number" ? r.intercept + r.slope * v : ERR.VALUE))); }));
def("GEOMEAN", "Statistical", "GEOMEAN(number1, …)", "Geometric mean.", (a) => guard(() => { const n = nums(a); if (isError(n)) return n; if (!n.length || n.some((x) => x <= 0)) return ERR.NUM; return Math.exp(mean(n.map(Math.log))); }));
def("HARMEAN", "Statistical", "HARMEAN(number1, …)", "Harmonic mean.", (a) => guard(() => { const n = nums(a); if (isError(n)) return n; if (!n.length || n.some((x) => x <= 0)) return ERR.NUM; return n.length / sum(n.map((x) => 1 / x)); }));
def("AVEDEV", "Statistical", "AVEDEV(number1, …)", "Mean absolute deviation.", (a) => guard(() => { const n = nums(a); if (isError(n)) return n; const m = mean(n); return mean(n.map((x) => Math.abs(x - m))); }));
def("STANDARDIZE", "Statistical", "STANDARDIZE(x, mean, standard_dev)", "z-score.", (a) => guard(() => { const sd = num(a[2]); return sd <= 0 ? ERR.NUM : (num(a[0]) - num(a[1])) / sd; }));
function erf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
}
def("NORM.DIST,NORMDIST", "Statistical", "NORM.DIST(x, mean, standard_dev, cumulative)", "Normal distribution.", (a) => guard(() => { const x = num(a[0]); const m = num(a[1]); const sd = num(a[2]); if (sd <= 0) return ERR.NUM; const z = (x - m) / sd; return bool(a[3], true) ? 0.5 * (1 + erf(z / Math.SQRT2)) : Math.exp(-0.5 * z * z) / (sd * Math.sqrt(2 * Math.PI)); }));
def("NORM.S.DIST,NORMSDIST", "Statistical", "NORM.S.DIST(z, [cumulative])", "Standard normal distribution.", (a) => guard(() => { const z = num(a[0]); return bool(a[1], true) ? 0.5 * (1 + erf(z / Math.SQRT2)) : Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI); }));

// ---------- logical

def("IF", "Logical", "IF(test, value_if_true, [value_if_false])", "Chooses by a condition.", (a) => {
  const t = a[0].value();
  if (isMatrix(t)) return t.map((row) => row.map((x) => { const b = toBool(x); return isError(b) ? b : b ? scalarOf(a[1]?.value() ?? true) : a[2] ? scalarOf(a[2].value()) : false; }));
  const b = toBool(t);
  if (isError(b)) return b;
  if (b) return a[1] ? (a[1].node.k === "empty" ? 0 : a[1].value()) : true;
  return a[2] ? (a[2].node.k === "empty" ? 0 : a[2].value()) : false;
});
def("IFS", "Logical", "IFS(test1, value1, [test2, value2], …)", "First value whose test is TRUE.", (a) => {
  for (let i = 0; i + 1 < a.length; i += 2) {
    const b = toBool(scalarOf(a[i].value()));
    if (isError(b)) return b;
    if (b) return a[i + 1].value();
  }
  return ERR.NA;
});
def("IFERROR", "Logical", "IFERROR(value, value_if_error)", "A fallback when there's an error.", (a) => { const v = a[0].value(); if (isMatrix(v)) return v.map((r) => r.map((x) => (isError(x) ? scalarOf(a[1].value()) : x))); return isError(v) ? a[1].value() : v; });
def("IFNA", "Logical", "IFNA(value, value_if_na)", "A fallback for #N/A.", (a) => { const v = a[0].value(); return v === ERR.NA || (isError(v) && v.code === "#N/A") ? a[1].value() : v; });
def("AND", "Logical", "AND(logical1, …)", "TRUE if all are TRUE.", (a) => { let seen = false; for (const x of a) for (const v of flatten(x.value())) { if (v === null || typeof v === "string") continue; const b = toBool(v); if (isError(b)) return b; seen = true; if (!b) return false; } return seen ? true : ERR.VALUE; });
def("OR", "Logical", "OR(logical1, …)", "TRUE if any is TRUE.", (a) => { let seen = false; for (const x of a) for (const v of flatten(x.value())) { if (v === null || typeof v === "string") continue; const b = toBool(v); if (isError(b)) return b; seen = true; if (b) return true; } return seen ? false : ERR.VALUE; });
def("XOR", "Logical", "XOR(logical1, …)", "TRUE if an odd number are TRUE.", (a) => { let c = 0; for (const x of a) for (const v of flatten(x.value())) { if (v === null || typeof v === "string") continue; const b = toBool(v); if (isError(b)) return b; if (b) c++; } return c % 2 === 1; });
def("NOT", "Logical", "NOT(logical)", "Reverses TRUE/FALSE.", (a) => guard(() => !bool(a[0])));
def("TRUE", "Logical", "TRUE()", "The value TRUE.", () => true);
def("FALSE", "Logical", "FALSE()", "The value FALSE.", () => false);
def("SWITCH", "Logical", "SWITCH(expression, value1, result1, …, [default])", "Matches a value against a list.", (a) => {
  const e = scalarOf(a[0].value());
  let i = 1;
  for (; i + 1 < a.length; i += 2) if (compare(e, scalarOf(a[i].value())) === 0) return a[i + 1].value();
  return i < a.length ? a[i].value() : ERR.NA;
});
def("CHOOSE", "Lookup", "CHOOSE(index, value1, value2, …)", "Picks the n-th value.", (a) => guard(() => { const i = Math.floor(num(a[0])); return i < 1 || i >= a.length ? ERR.VALUE : a[i].value(); }));

// ---------- information

def("ISBLANK", "Information", "ISBLANK(value)", "TRUE for an empty cell.", (a) => lift1(a[0], (v) => v === null));
def("ISNUMBER", "Information", "ISNUMBER(value)", "TRUE for a number.", (a) => lift1(a[0], (v) => typeof v === "number"));
def("ISTEXT", "Information", "ISTEXT(value)", "TRUE for text.", (a) => lift1(a[0], (v) => typeof v === "string"));
def("ISNONTEXT", "Information", "ISNONTEXT(value)", "TRUE if not text.", (a) => lift1(a[0], (v) => typeof v !== "string"));
def("ISLOGICAL", "Information", "ISLOGICAL(value)", "TRUE for TRUE/FALSE.", (a) => lift1(a[0], (v) => typeof v === "boolean"));
def("ISERROR", "Information", "ISERROR(value)", "TRUE for any error.", (a) => lift1(a[0], (v) => isError(v)));
def("ISERR", "Information", "ISERR(value)", "TRUE for errors other than #N/A.", (a) => lift1(a[0], (v) => isError(v) && v.code !== "#N/A"));
def("ISNA", "Information", "ISNA(value)", "TRUE for #N/A.", (a) => lift1(a[0], (v) => isError(v) && v.code === "#N/A"));
def("ISEVEN", "Information", "ISEVEN(number)", "TRUE for even numbers.", (a) => guard(() => Math.floor(Math.abs(num(a[0]))) % 2 === 0));
def("ISODD", "Information", "ISODD(number)", "TRUE for odd numbers.", (a) => guard(() => Math.floor(Math.abs(num(a[0]))) % 2 === 1));
def("ISFORMULA", "Information", "ISFORMULA(reference)", "TRUE if the cell has a formula.", () => false);
def("NA", "Information", "NA()", "The #N/A error.", () => ERR.NA);
def("N", "Information", "N(value)", "Converts a value to a number.", (a) => { const v = scalarOf(a[0].value()); return typeof v === "number" ? v : typeof v === "boolean" ? (v ? 1 : 0) : isError(v) ? v : 0; });
def("TYPE", "Information", "TYPE(value)", "1 number, 2 text, 4 logical, 16 error, 64 array.", (a) => { const v = a[0].value(); return isMatrix(v) ? 64 : typeof v === "number" || v === null ? 1 : typeof v === "string" ? 2 : typeof v === "boolean" ? 4 : 16; });
def("ERROR.TYPE", "Information", "ERROR.TYPE(error_val)", "Number for an error type.", (a) => { const v = scalarOf(a[0].value()); const codes = ["#NULL!", "#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#NUM!", "#N/A"]; return isError(v) ? codes.indexOf(v.code) + 1 || ERR.NA : ERR.NA; });
def("ROW", "Lookup", "ROW([reference])", "Row number.", (a, ctx) => { const r = a[0]?.range?.(); return r ? r.r1 + 1 : ctx.row + 1; });
def("COLUMN", "Lookup", "COLUMN([reference])", "Column number.", (a, ctx) => { const r = a[0]?.range?.(); return r ? r.c1 + 1 : ctx.col + 1; });
def("ROWS", "Lookup", "ROWS(array)", "Number of rows.", (a) => guard(() => matrix(a[0]).length));
def("COLUMNS", "Lookup", "COLUMNS(array)", "Number of columns.", (a) => guard(() => matrix(a[0])[0]?.length ?? 0));
def("ADDRESS", "Lookup", "ADDRESS(row, column, [abs_num], [a1], [sheet])", "Cell address as text.", (a) => guard(() => {
  const r = Math.floor(num(a[0]));
  const c = Math.floor(num(a[1]));
  const abs = num(a[2], 1);
  const col = indexToCol(c - 1);
  const s = (abs === 1 || abs === 3 ? "$" : "") + col + (abs === 1 || abs === 2 ? "$" : "") + r;
  return a[4] ? `${quoteSheet(str(a[4]))}!${s}` : s;
}));

// ---------- lookup

function lookupIndex(needle: Scalar, list: Scalar[], mode: number): number {
  if (mode === 0) {
    if (typeof needle === "string" && /[*?]/.test(needle)) {
      const test = makeCriteria(needle);
      return list.findIndex((v) => test(v));
    }
    return list.findIndex((v) => v !== null && compare(v, needle) === 0);
  }
  if (mode === 1) {
    // largest value <= needle (sorted ascending)
    let best = -1;
    for (let i = 0; i < list.length; i++) {
      const v = list[i];
      if (v === null) continue;
      if (typeof v !== typeof needle && !(typeof v === "number" && typeof needle === "number")) continue;
      if (compare(v, needle) <= 0) best = i;
      else break;
    }
    return best;
  }
  let best = -1;
  for (let i = 0; i < list.length; i++) {
    const v = list[i];
    if (v === null) continue;
    if (compare(v, needle) >= 0) best = i;
    else break;
  }
  return best;
}

def("VLOOKUP", "Lookup", "VLOOKUP(lookup_value, table, col_index, [approximate])", "Looks down the first column and returns a value from that row.", (a) => guard(() => {
  const needle = scalarOf(a[0].value());
  const t = matrix(a[1]);
  const ci = Math.floor(num(a[2]));
  const approx = bool(a[3], true);
  if (ci < 1 || ci > (t[0]?.length ?? 0)) return ERR.REF;
  const i = lookupIndex(needle, t.map((r) => r[0]), approx ? 1 : 0);
  return i < 0 ? ERR.NA : t[i][ci - 1];
}));
def("HLOOKUP", "Lookup", "HLOOKUP(lookup_value, table, row_index, [approximate])", "Looks across the first row and returns a value from that column.", (a) => guard(() => {
  const needle = scalarOf(a[0].value());
  const t = matrix(a[1]);
  const ri = Math.floor(num(a[2]));
  const approx = bool(a[3], true);
  if (ri < 1 || ri > t.length) return ERR.REF;
  const i = lookupIndex(needle, t[0], approx ? 1 : 0);
  return i < 0 ? ERR.NA : t[ri - 1][i];
}));
def("LOOKUP", "Lookup", "LOOKUP(lookup_value, lookup_vector, [result_vector])", "Approximate lookup in a sorted list.", (a) => guard(() => {
  const needle = scalarOf(a[0].value());
  const v = matrix(a[1]);
  const list = v.length === 1 ? v[0] : v.map((r) => r[0]);
  const res = a[2] ? matrix(a[2]).flat() : v.length === 1 ? v[v.length - 1] : v.map((r) => r[r.length - 1]);
  const i = lookupIndex(needle, list, 1);
  return i < 0 ? ERR.NA : res[i] ?? ERR.NA;
}));
def("MATCH", "Lookup", "MATCH(lookup_value, lookup_array, [match_type])", "Position of a value in a list.", (a) => guard(() => {
  const needle = scalarOf(a[0].value());
  const list = matrix(a[1]).flat();
  const i = lookupIndex(needle, list, num(a[2], 1));
  return i < 0 ? ERR.NA : i + 1;
}));
def("XMATCH", "Lookup", "XMATCH(lookup_value, lookup_array, [match_mode], [search_mode])", "Position of a value (exact by default).", (a) => guard(() => {
  const needle = scalarOf(a[0].value());
  let list = matrix(a[1]).flat();
  const mode = num(a[2], 0);
  const rev = num(a[3], 1) < 0;
  if (rev) list = [...list].reverse();
  let i = -1;
  if (mode === 0 || mode === 2) i = lookupIndex(needle, list, 0);
  else {
    let bestV: Scalar = null;
    list.forEach((v, k) => {
      if (v === null) return;
      const c = compare(v, needle);
      if (c === 0 && i < 0) { i = k; bestV = v; return; }
      if (mode === -1 && c < 0 && (bestV === null || compare(v, bestV) > 0) && !(i >= 0 && compare(list[i], needle) === 0)) { i = k; bestV = v; }
      if (mode === 1 && c > 0 && (bestV === null || compare(v, bestV) < 0) && !(i >= 0 && compare(list[i], needle) === 0)) { i = k; bestV = v; }
    });
  }
  if (i < 0) return ERR.NA;
  return rev ? list.length - i : i + 1;
}));
def("XLOOKUP", "Lookup", "XLOOKUP(lookup_value, lookup_array, return_array, [if_not_found], [match_mode], [search_mode])", "Finds a value and returns what's next to it, any direction.", (a, ctx) => guard(() => {
  const look = matrix(a[1]);
  const ret = matrix(a[2]);
  const vertical = look.length > 1;
  const pos = FN.XMATCH([a[0], a[1], a[4] ?? { node: { k: "empty" }, value: () => null }, a[5] ?? { node: { k: "empty" }, value: () => null }], ctx);
  if (isError(pos)) return a[3] && a[3].node.k !== "empty" ? a[3].value() : pos;
  const i = (pos as number) - 1;
  if (vertical) return ret.length === look.length ? (ret[0].length === 1 ? ret[i][0] : [ret[i]]) : ERR.VALUE;
  return ret[0].length === look[0].length ? (ret.length === 1 ? ret[0][i] : ret.map((r) => [r[i]])) : ERR.VALUE;
}));
def("INDEX", "Lookup", "INDEX(array, row_num, [column_num])", "Value at a row and column.", (a) => guard(() => {
  const m = matrix(a[0]);
  let r = Math.floor(num(a[1], 0));
  let c = Math.floor(num(a[2], 0));
  if (m.length === 1 && !a[2]) {
    c = r;
    r = 1;
  }
  if (r < 0 || c < 0 || r > m.length || c > (m[0]?.length ?? 0)) return ERR.REF;
  if (r === 0 && c === 0) return m;
  if (r === 0) return m.map((row) => [row[c - 1]]);
  if (c === 0) return m[0].length === 1 ? m[r - 1][0] : [m[r - 1]];
  return m[r - 1][c - 1];
}));
def("TRANSPOSE", "Lookup", "TRANSPOSE(array)", "Swaps rows and columns.", (a) => guard(() => { const m = matrix(a[0]); return m[0].map((_, j) => m.map((row) => row[j])); }));
def("OFFSET", "Lookup", "OFFSET(reference, rows, cols, [height], [width])", "A range shifted from a starting cell.", (a, ctx) => guard(() => {
  const base = a[0].range?.();
  if (!base) return ERR.REF;
  const r1 = base.r1 + Math.floor(num(a[1]));
  const c1 = base.c1 + Math.floor(num(a[2]));
  const h = Math.floor(num(a[3], base.r2 - base.r1 + 1));
  const w = Math.floor(num(a[4], base.c2 - base.c1 + 1));
  if (r1 < 0 || c1 < 0 || h < 1 || w < 1) return ERR.REF;
  const m = readRange({ sheet: base.sheet, r1, c1, r2: r1 + h - 1, c2: c1 + w - 1 }, ctx);
  return h === 1 && w === 1 ? m[0][0] : m;
}));
def("INDIRECT", "Lookup", "INDIRECT(ref_text)", "A reference from text.", (a, ctx) => guard(() => {
  const t = str(a[0]);
  try {
    return evalNode(parse(t), ctx);
  } catch {
    return ERR.REF;
  }
}));
def("HYPERLINK", "Lookup", "HYPERLINK(link, [friendly_name])", "A clickable link.", (a) => guard(() => (a[1] ? str(a[1]) : str(a[0]))));

// ---------- dynamic arrays

def("SEQUENCE", "Dynamic array", "SEQUENCE(rows, [columns], [start], [step])", "A list of sequential numbers.", (a) => guard(() => {
  const r = Math.floor(num(a[0]));
  const c = Math.floor(num(a[1], 1));
  const s = num(a[2], 1);
  const st = num(a[3], 1);
  if (r < 1 || c < 1 || r * c > 100_000) return ERR.VALUE;
  return Array.from({ length: r }, (_, i) => Array.from({ length: c }, (_, j) => s + (i * c + j) * st));
}));
def("UNIQUE", "Dynamic array", "UNIQUE(array, [by_col], [exactly_once])", "Distinct rows of a range.", (a) => guard(() => {
  const m = matrix(a[0]);
  const once = bool(a[2], false);
  const key = (row: Scalar[]) => row.map((v) => (typeof v === "string" ? v.toLowerCase() : String(v))).join("\u0000");
  const counts = new Map<string, number>();
  m.forEach((row) => counts.set(key(row), (counts.get(key(row)) ?? 0) + 1));
  const seen = new Set<string>();
  const out = m.filter((row) => {
    const k = key(row);
    if (seen.has(k)) return false;
    seen.add(k);
    return !once || counts.get(k) === 1;
  });
  return out.length ? out : ERR.CALC;
}));
def("SORT", "Dynamic array", "SORT(array, [sort_index], [sort_order], [by_col])", "Sorts a range.", (a) => guard(() => {
  const m = matrix(a[0]);
  const idx = Math.floor(num(a[1], 1)) - 1;
  const ord = num(a[2], 1);
  return [...m].sort((x, y) => compare(x[idx], y[idx]) * (ord < 0 ? -1 : 1));
}));
def("SORTBY", "Dynamic array", "SORTBY(array, by_array, [order])", "Sorts by another range.", (a) => guard(() => {
  const m = matrix(a[0]);
  const by = matrix(a[1]).flat();
  const ord = num(a[2], 1);
  return m.map((row, i) => ({ row, k: by[i] })).sort((x, y) => compare(x.k, y.k) * (ord < 0 ? -1 : 1)).map((x) => x.row);
}));
def("FILTER", "Dynamic array", "FILTER(array, include, [if_empty])", "Rows that meet a condition.", (a) => guard(() => {
  const m = matrix(a[0]);
  const inc = matrix(a[1]).map((r) => r[0]);
  const out = m.filter((_, i) => { const b = toBool(inc[i] ?? false); return !isError(b) && b; });
  if (!out.length) return a[2] ? a[2].value() : ERR.CALC;
  return out;
}));
def("TAKE", "Dynamic array", "TAKE(array, rows, [columns])", "First (or last) rows.", (a) => guard(() => { const m = matrix(a[0]); const r = Math.floor(num(a[1], m.length)); const out = r >= 0 ? m.slice(0, r) : m.slice(r); const c = a[2] ? Math.floor(num(a[2])) : null; return c === null ? out : out.map((row) => (c >= 0 ? row.slice(0, c) : row.slice(c))); }));
def("DROP", "Dynamic array", "DROP(array, rows, [columns])", "Without the first (or last) rows.", (a) => guard(() => { const m = matrix(a[0]); const r = Math.floor(num(a[1], 0)); const out = r >= 0 ? m.slice(r) : m.slice(0, r); const c = a[2] ? Math.floor(num(a[2])) : null; return c === null ? out : out.map((row) => (c >= 0 ? row.slice(c) : row.slice(0, c))); }));
def("VSTACK", "Dynamic array", "VSTACK(array1, array2, …)", "Stacks ranges vertically.", (a) => guard(() => { const ms = a.map(matrix); const w = Math.max(...ms.map((m) => m[0]?.length ?? 0)); return ms.flatMap((m) => m.map((row) => [...row, ...Array(w - row.length).fill(ERR.NA)])); }));
def("HSTACK", "Dynamic array", "HSTACK(array1, array2, …)", "Stacks ranges side by side.", (a) => guard(() => { const ms = a.map(matrix); const h = Math.max(...ms.map((m) => m.length)); return Array.from({ length: h }, (_, i) => ms.flatMap((m) => m[i] ?? Array(m[0].length).fill(ERR.NA))); }));
def("TOCOL", "Dynamic array", "TOCOL(array)", "All values in one column.", (a) => guard(() => matrix(a[0]).flat().map((v) => [v])));
def("TOROW", "Dynamic array", "TOROW(array)", "All values in one row.", (a) => guard(() => [matrix(a[0]).flat()]));

// ---------- text

def("CONCATENATE,CONCAT", "Text", "CONCAT(text1, …)", "Joins text.", (a) => { let s = ""; for (const x of a) for (const v of flatten(x.value())) { if (isError(v)) return v; s += toText(v); } return s; });
def("TEXTJOIN", "Text", "TEXTJOIN(delimiter, ignore_empty, text1, …)", "Joins text with a delimiter.", (a) => guard(() => {
  const d = str(a[0]);
  const ign = bool(a[1]);
  const parts: string[] = [];
  for (const x of a.slice(2)) for (const v of flatten(x.value())) { if (isError(v)) return v; const t = toText(v); if (!ign || t !== "") parts.push(t); }
  return parts.join(d);
}));
def("LEFT", "Text", "LEFT(text, [num_chars])", "First characters.", (a) => guard(() => Array.from(str(a[0])).slice(0, Math.max(0, num(a[1], 1))).join("")));
def("RIGHT", "Text", "RIGHT(text, [num_chars])", "Last characters.", (a) => guard(() => { const t = Array.from(str(a[0])); const n = Math.max(0, num(a[1], 1)); return n ? t.slice(-n).join("") : ""; }));
def("MID", "Text", "MID(text, start, num_chars)", "Characters from the middle.", (a) => guard(() => { const s = num(a[1]); if (s < 1) return ERR.VALUE; return Array.from(str(a[0])).slice(s - 1, s - 1 + Math.max(0, num(a[2]))).join(""); }));
def("LEN", "Text", "LEN(text)", "Number of characters.", (a) => lift1(a[0], (v) => (isError(v) ? v : Array.from(toText(v)).length)));
def("UPPER", "Text", "UPPER(text)", "Capital letters.", (a) => lift1(a[0], (v) => (isError(v) ? v : toText(v).toUpperCase())));
def("LOWER", "Text", "LOWER(text)", "Small letters.", (a) => lift1(a[0], (v) => (isError(v) ? v : toText(v).toLowerCase())));
def("PROPER", "Text", "PROPER(text)", "Capitalises Each Word.", (a) => lift1(a[0], (v) => (isError(v) ? v : toText(v).toLowerCase().replace(/(^|[^\p{L}'])(\p{L})/gu, (_, p, c) => p + c.toUpperCase()))));
def("TRIM", "Text", "TRIM(text)", "Removes extra spaces.", (a) => lift1(a[0], (v) => (isError(v) ? v : toText(v).replace(/ +/g, " ").trim())));
def("CLEAN", "Text", "CLEAN(text)", "Removes non-printing characters.", (a) => lift1(a[0], (v) => (isError(v) ? v : toText(v).replace(/[\u0000-\u001f]/g, ""))));
def("SUBSTITUTE", "Text", "SUBSTITUTE(text, old_text, new_text, [instance])", "Replaces text by text.", (a) => guard(() => {
  const t = str(a[0]);
  const o = str(a[1]);
  const n = str(a[2]);
  if (!o) return t;
  if (a[3]) {
    const k = Math.floor(num(a[3]));
    let idx = -1;
    for (let i = 0; i < k; i++) { idx = t.indexOf(o, idx + 1); if (idx < 0) return t; }
    return t.slice(0, idx) + n + t.slice(idx + o.length);
  }
  return t.split(o).join(n);
}));
def("REPLACE", "Text", "REPLACE(old_text, start, num_chars, new_text)", "Replaces characters by position.", (a) => guard(() => { const t = Array.from(str(a[0])); const s = num(a[1]) - 1; t.splice(s, num(a[2]), str(a[3])); return t.join(""); }));
def("FIND", "Text", "FIND(find_text, within_text, [start])", "Position of text (case-sensitive).", (a) => guard(() => { const i = str(a[1]).indexOf(str(a[0]), num(a[2], 1) - 1); return i < 0 ? ERR.VALUE : i + 1; }));
def("SEARCH", "Text", "SEARCH(find_text, within_text, [start])", "Position of text (any case, wildcards).", (a) => guard(() => {
  const needle = str(a[0]);
  const hay = str(a[1]);
  const start = num(a[2], 1) - 1;
  const re = new RegExp(needle.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, "."), "i");
  const m = re.exec(hay.slice(start));
  return m ? m.index + start + 1 : ERR.VALUE;
}));
def("REPT", "Text", "REPT(text, times)", "Repeats text.", (a) => guard(() => { const n = Math.floor(num(a[1])); return n < 0 ? ERR.VALUE : str(a[0]).repeat(Math.min(n, 32767)); }));
def("EXACT", "Text", "EXACT(text1, text2)", "TRUE if text is identical.", (a) => guard(() => str(a[0]) === str(a[1])));
def("CHAR", "Text", "CHAR(number)", "Character from a code.", (a) => guard(() => String.fromCharCode(num(a[0]))));
def("UNICHAR", "Text", "UNICHAR(number)", "Character from a Unicode number.", (a) => guard(() => String.fromCodePoint(num(a[0]))));
def("CODE", "Text", "CODE(text)", "Code of the first character.", (a) => guard(() => { const t = str(a[0]); return t ? t.charCodeAt(0) : ERR.VALUE; }));
def("UNICODE", "Text", "UNICODE(text)", "Unicode number of the first character.", (a) => guard(() => { const t = str(a[0]); return t ? t.codePointAt(0)! : ERR.VALUE; }));
def("T", "Text", "T(value)", "Text, or empty.", (a) => { const v = scalarOf(a[0].value()); return typeof v === "string" ? v : ""; });
def("VALUE", "Text", "VALUE(text)", "Text to number.", (a) => lift1(a[0], (v) => (typeof v === "number" ? v : toNumber(v))));
def("NUMBERVALUE", "Text", "NUMBERVALUE(text, [decimal], [group])", "Text to number with separators.", (a) => guard(() => { const dec = str(a[1], "."); const grp = str(a[2], ","); const t = str(a[0]).split(grp).join("").replace(dec, "."); const n = toNumber(t); return n; }));
def("TEXT", "Text", "TEXT(value, format_text)", "Formats a number as text.", (a) => guard(() => { const v = scalarOf(a[0].value()); if (isError(v)) return v; const n = typeof v === "number" ? v : toNumber(v); return isError(n) ? toText(v) : formatValue(n, str(a[1])); }));
def("FIXED", "Text", "FIXED(number, [decimals], [no_commas])", "Number as text with fixed decimals.", (a) => guard(() => { const d = num(a[1], 2); return formatValue(roundTo(num(a[0]), d), (bool(a[2], false) ? "0" : "#,##0") + (d > 0 ? "." + "0".repeat(d) : "")); }));
def("DOLLAR", "Text", "DOLLAR(number, [decimals])", "Number as currency text.", (a) => guard(() => { const d = num(a[1], 2); return formatValue(num(a[0]), "$#,##0" + (d > 0 ? "." + "0".repeat(d) : "")); }));
def("TEXTBEFORE", "Text", "TEXTBEFORE(text, delimiter, [instance])", "Text before a delimiter.", (a) => guard(() => { const t = str(a[0]); const d = str(a[1]); const k = num(a[2], 1); const parts = t.split(d); if (parts.length <= Math.abs(k)) return ERR.NA; return k > 0 ? parts.slice(0, k).join(d) : parts.slice(0, parts.length + k).join(d); }));
def("TEXTAFTER", "Text", "TEXTAFTER(text, delimiter, [instance])", "Text after a delimiter.", (a) => guard(() => { const t = str(a[0]); const d = str(a[1]); const k = num(a[2], 1); const parts = t.split(d); if (parts.length <= Math.abs(k)) return ERR.NA; return k > 0 ? parts.slice(k).join(d) : parts.slice(parts.length + k).join(d); }));
def("TEXTSPLIT", "Text", "TEXTSPLIT(text, col_delimiter, [row_delimiter])", "Splits text into cells.", (a) => guard(() => { const t = str(a[0]); const cd = str(a[1]); const rd = a[2] && a[2].node.k !== "empty" ? str(a[2]) : null; const rows = rd ? t.split(rd) : [t]; const m = rows.map((r) => r.split(cd)); const w = Math.max(...m.map((r) => r.length)); return m.map((r) => [...r, ...Array(w - r.length).fill(ERR.NA)]); }));

// ---------- date & time

def("TODAY", "Date & time", "TODAY()", "Today's date.", (_a, ctx) => Math.floor(jsDateToSerial(ctx.now?.() ?? new Date())));
def("NOW", "Date & time", "NOW()", "The date and time now.", (_a, ctx) => jsDateToSerial(ctx.now?.() ?? new Date()));
def("DATE", "Date & time", "DATE(year, month, day)", "A date from parts.", (a) => guard(() => { let y = Math.floor(num(a[0])); if (y < 1900) y += 1900; return dateToSerial(y, Math.floor(num(a[1])), Math.floor(num(a[2]))); }));
def("TIME", "Date & time", "TIME(hour, minute, second)", "A time from parts.", (a) => guard(() => ((num(a[0]) * 3600 + num(a[1]) * 60 + num(a[2])) / 86400) % 1));
def("DATEVALUE", "Date & time", "DATEVALUE(date_text)", "Text to a date.", (a) => guard(() => { const d = parseDateString(str(a[0])); return d === null ? ERR.VALUE : Math.floor(d); }));
def("TIMEVALUE", "Date & time", "TIMEVALUE(time_text)", "Text to a time.", (a) => guard(() => { const d = parseDateString(str(a[0])); return d === null ? ERR.VALUE : d % 1; }));
const dpart = (f: (d: Date) => number) => (a: Arg[]) => guard(() => f(serialToDate(num(a[0]))));
def("YEAR", "Date & time", "YEAR(date)", "Year of a date.", dpart((d) => d.getUTCFullYear()));
def("MONTH", "Date & time", "MONTH(date)", "Month of a date.", dpart((d) => d.getUTCMonth() + 1));
def("DAY", "Date & time", "DAY(date)", "Day of the month.", dpart((d) => d.getUTCDate()));
def("HOUR", "Date & time", "HOUR(time)", "Hour of a time.", (a) => guard(() => Math.floor(((num(a[0]) % 1) * 24) + 1e-9)));
def("MINUTE", "Date & time", "MINUTE(time)", "Minute of a time.", (a) => guard(() => Math.floor(((num(a[0]) % 1) * 1440 + 1e-9) % 60)));
def("SECOND", "Date & time", "SECOND(time)", "Second of a time.", (a) => guard(() => Math.round((num(a[0]) % 1) * 86400) % 60));
def("WEEKDAY", "Date & time", "WEEKDAY(date, [return_type])", "Day of the week (1 = Sunday).", (a) => guard(() => { const d = serialToDate(num(a[0])).getUTCDay(); const t = num(a[1], 1); return t === 2 ? ((d + 6) % 7) + 1 : t === 3 ? (d + 6) % 7 : d + 1; }));
def("WEEKNUM", "Date & time", "WEEKNUM(date, [return_type])", "Week of the year.", (a) => guard(() => { const d = serialToDate(num(a[0])); const start = Date.UTC(d.getUTCFullYear(), 0, 1); const jan1 = new Date(start).getUTCDay(); const off = num(a[1], 1) === 2 ? (jan1 + 6) % 7 : jan1; return Math.floor(((d.getTime() - start) / DAY_MS + off) / 7) + 1; }));
def("ISOWEEKNUM", "Date & time", "ISOWEEKNUM(date)", "ISO week number.", (a) => guard(() => { const d = serialToDate(num(a[0])); const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day); const y0 = Date.UTC(t.getUTCFullYear(), 0, 1); return Math.ceil(((t.getTime() - y0) / DAY_MS + 1) / 7); }));
function addMonths(serial: number, months: number): Date {
  const d = serialToDate(serial);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + months;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), last)));
}
def("EDATE", "Date & time", "EDATE(start_date, months)", "Date months before or after.", (a) => guard(() => { const d = addMonths(num(a[0]), Math.trunc(num(a[1]))); return dateToSerial(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); }));
def("EOMONTH", "Date & time", "EOMONTH(start_date, months)", "Last day of a month.", (a) => guard(() => { const d = serialToDate(num(a[0])); const e = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + Math.trunc(num(a[1])) + 1, 0)); return dateToSerial(e.getUTCFullYear(), e.getUTCMonth() + 1, e.getUTCDate()); }));
def("DAYS", "Date & time", "DAYS(end_date, start_date)", "Days between two dates.", (a) => guard(() => Math.floor(num(a[0])) - Math.floor(num(a[1]))));
def("DAYS360", "Date & time", "DAYS360(start_date, end_date)", "Days on a 360-day year.", (a) => guard(() => { const s = serialToDate(num(a[0])); const e = serialToDate(num(a[1])); let d1 = s.getUTCDate(); let d2 = e.getUTCDate(); if (d1 === 31) d1 = 30; if (d2 === 31 && d1 >= 30) d2 = 30; return (e.getUTCFullYear() - s.getUTCFullYear()) * 360 + (e.getUTCMonth() - s.getUTCMonth()) * 30 + (d2 - d1); }));
def("DATEDIF", "Date & time", "DATEDIF(start_date, end_date, unit)", "Difference in days (D), months (M) or years (Y).", (a) => guard(() => {
  const s = serialToDate(num(a[0]));
  const e = serialToDate(num(a[1]));
  const u = str(a[2]).toUpperCase();
  if (e < s) return ERR.NUM;
  let months = (e.getUTCFullYear() - s.getUTCFullYear()) * 12 + (e.getUTCMonth() - s.getUTCMonth());
  if (e.getUTCDate() < s.getUTCDate()) months--;
  switch (u) {
    case "D":
      return Math.round((e.getTime() - s.getTime()) / DAY_MS);
    case "M":
      return months;
    case "Y":
      return Math.floor(months / 12);
    case "YM":
      return months % 12;
    case "MD": {
      let d = e.getUTCDate() - s.getUTCDate();
      if (d < 0) d += new Date(Date.UTC(e.getUTCFullYear(), e.getUTCMonth(), 0)).getUTCDate();
      return d;
    }
    case "YD": {
      const ss = new Date(Date.UTC(e.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate()));
      if (ss > e) ss.setUTCFullYear(ss.getUTCFullYear() - 1);
      return Math.round((e.getTime() - ss.getTime()) / DAY_MS);
    }
  }
  return ERR.NUM;
}));
def("YEARFRAC", "Date & time", "YEARFRAC(start_date, end_date)", "Fraction of a year between dates.", (a) => guard(() => Math.abs(num(a[1]) - num(a[0])) / 365.25));
function holidaysOf(a: Arg | undefined): Set<number> {
  if (!a || a.node.k === "empty") return new Set();
  return new Set(matrix(a).flat().filter((x) => typeof x === "number").map((x) => Math.floor(x as number)));
}
def("NETWORKDAYS", "Date & time", "NETWORKDAYS(start_date, end_date, [holidays])", "Working days between dates.", (a) => guard(() => {
  let s = Math.floor(num(a[0]));
  let e = Math.floor(num(a[1]));
  const sign = e >= s ? 1 : -1;
  if (sign < 0) [s, e] = [e, s];
  const hol = holidaysOf(a[2]);
  let n = 0;
  for (let d = s; d <= e; d++) {
    const wd = serialToDate(d).getUTCDay();
    if (wd !== 0 && wd !== 6 && !hol.has(d)) n++;
  }
  return n * sign;
}));
def("WORKDAY", "Date & time", "WORKDAY(start_date, days, [holidays])", "Date after a number of working days.", (a) => guard(() => {
  let d = Math.floor(num(a[0]));
  let left = Math.trunc(num(a[1]));
  const step = left >= 0 ? 1 : -1;
  const hol = holidaysOf(a[2]);
  while (left !== 0) {
    d += step;
    const wd = serialToDate(d).getUTCDay();
    if (wd !== 0 && wd !== 6 && !hol.has(d)) left -= step;
  }
  return d;
}));

// ---------- financial

def("PMT", "Financial", "PMT(rate, nper, pv, [fv], [type])", "Payment for a loan.", (a) => guard(() => {
  const r = num(a[0]);
  const n = num(a[1]);
  const pv = num(a[2]);
  const fv = num(a[3], 0);
  const t = num(a[4], 0);
  if (r === 0) return -(pv + fv) / n;
  const f = Math.pow(1 + r, n);
  return -(r * (fv + f * pv)) / ((1 + r * t) * (f - 1));
}));
def("FV", "Financial", "FV(rate, nper, pmt, [pv], [type])", "Future value of an investment.", (a) => guard(() => {
  const r = num(a[0]);
  const n = num(a[1]);
  const p = num(a[2]);
  const pv = num(a[3], 0);
  const t = num(a[4], 0);
  if (r === 0) return -(pv + p * n);
  const f = Math.pow(1 + r, n);
  return -(pv * f + (p * (1 + r * t) * (f - 1)) / r);
}));
def("PV", "Financial", "PV(rate, nper, pmt, [fv], [type])", "Present value.", (a) => guard(() => {
  const r = num(a[0]);
  const n = num(a[1]);
  const p = num(a[2]);
  const fv = num(a[3], 0);
  const t = num(a[4], 0);
  if (r === 0) return -(fv + p * n);
  const f = Math.pow(1 + r, n);
  return -(fv + (p * (1 + r * t) * (f - 1)) / r) / f;
}));
def("NPER", "Financial", "NPER(rate, pmt, pv, [fv], [type])", "Number of payment periods.", (a) => guard(() => {
  const r = num(a[0]);
  const p = num(a[1]);
  const pv = num(a[2]);
  const fv = num(a[3], 0);
  const t = num(a[4], 0);
  if (r === 0) return -(pv + fv) / p;
  const z = p * (1 + r * t);
  return numOrErr(Math.log((z - fv * r) / (z + pv * r)) / Math.log(1 + r));
}));
def("NPV", "Financial", "NPV(rate, value1, …)", "Net present value.", (a) => guard(() => { const r = num(a[0]); const n = nums(a.slice(1)); if (isError(n)) return n; return n.reduce((s, v, i) => s + v / Math.pow(1 + r, i + 1), 0); }));
function irr(values: number[], guess: number): number {
  let r = guess;
  for (let i = 0; i < 100; i++) {
    let f = 0;
    let df = 0;
    values.forEach((v, k) => {
      f += v / Math.pow(1 + r, k);
      df -= (k * v) / Math.pow(1 + r, k + 1);
    });
    if (Math.abs(df) < 1e-12) break;
    const next = r - f / df;
    if (Math.abs(next - r) < 1e-10) return next;
    r = next;
  }
  if (!Number.isFinite(r)) throw ERR.NUM;
  return r;
}
def("IRR", "Financial", "IRR(values, [guess])", "Internal rate of return.", (a) => guard(() => { const n = nums([a[0]]); if (isError(n)) return n; return irr(n, num(a[1], 0.1)); }));
def("RATE", "Financial", "RATE(nper, pmt, pv, [fv], [type], [guess])", "Interest rate per period.", (a) => guard(() => {
  const n = num(a[0]);
  const p = num(a[1]);
  const pv = num(a[2]);
  const fv = num(a[3], 0);
  const t = num(a[4], 0);
  let r = num(a[5], 0.1);
  for (let i = 0; i < 100; i++) {
    const f = Math.pow(1 + r, n);
    const y = pv * f + p * (1 + r * t) * ((f - 1) / r) + fv;
    const f2 = Math.pow(1 + r + 1e-6, n);
    const y2 = pv * f2 + p * (1 + (r + 1e-6) * t) * ((f2 - 1) / (r + 1e-6)) + fv;
    const d = (y2 - y) / 1e-6;
    if (!d) break;
    const nr = r - y / d;
    if (Math.abs(nr - r) < 1e-10) return nr;
    r = nr;
  }
  return Number.isFinite(r) ? r : ERR.NUM;
}));
def("IPMT", "Financial", "IPMT(rate, per, nper, pv)", "Interest part of a payment.", (a, ctx) => guard(() => {
  const r = num(a[0]);
  const per = num(a[1]);
  const n = num(a[2]);
  const pv = num(a[3]);
  const pmt = FN.PMT([a[0], a[2], a[3]], ctx) as number;
  const balance = pv * Math.pow(1 + r, per - 1) + (pmt * (Math.pow(1 + r, per - 1) - 1)) / r;
  void n;
  return -balance * r;
}));
def("PPMT", "Financial", "PPMT(rate, per, nper, pv)", "Principal part of a payment.", (a, ctx) => guard(() => (FN.PMT([a[0], a[2], a[3]], ctx) as number) - (FN.IPMT(a, ctx) as number)));
def("SLN", "Financial", "SLN(cost, salvage, life)", "Straight-line depreciation.", (a) => guard(() => (num(a[0]) - num(a[1])) / num(a[2])));
def("EFFECT", "Financial", "EFFECT(nominal_rate, npery)", "Effective annual rate.", (a) => guard(() => Math.pow(1 + num(a[0]) / num(a[1]), num(a[1])) - 1));

// ---------- engineering / conversion

def("DEC2BIN", "Engineering", "DEC2BIN(number)", "Decimal to binary.", (a) => guard(() => Math.floor(num(a[0])).toString(2)));
def("DEC2HEX", "Engineering", "DEC2HEX(number)", "Decimal to hexadecimal.", (a) => guard(() => Math.floor(num(a[0])).toString(16).toUpperCase()));
def("BIN2DEC", "Engineering", "BIN2DEC(text)", "Binary to decimal.", (a) => guard(() => { const n = parseInt(str(a[0]), 2); return Number.isNaN(n) ? ERR.NUM : n; }));
def("HEX2DEC", "Engineering", "HEX2DEC(text)", "Hexadecimal to decimal.", (a) => guard(() => { const n = parseInt(str(a[0]), 16); return Number.isNaN(n) ? ERR.NUM : n; }));
def("ROMAN", "Math", "ROMAN(number)", "Roman numerals.", (a) => guard(() => {
  let n = Math.floor(num(a[0]));
  if (n < 0 || n > 3999) return ERR.VALUE;
  const t: [number, string][] = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let s = "";
  for (const [v, r] of t) while (n >= v) { s += r; n -= v; }
  return s;
}));
def("CONVERT", "Engineering", "CONVERT(number, from_unit, to_unit)", "Converts units (m, km, mi, ft, in, kg, lbm, g, C, F, K, l, gal…).", (a) => guard(() => {
  const n = num(a[0]);
  const f = str(a[1]);
  const t = str(a[2]);
  const temp = (x: number, u: string) => (u === "C" ? x : u === "F" ? ((x - 32) * 5) / 9 : u === "K" ? x - 273.15 : NaN);
  const fromC = (x: number, u: string) => (u === "C" ? x : u === "F" ? (x * 9) / 5 + 32 : u === "K" ? x + 273.15 : NaN);
  if (["C", "F", "K"].includes(f) && ["C", "F", "K"].includes(t)) return fromC(temp(n, f), t);
  const U: Record<string, [string, number]> = { m: ["len", 1], km: ["len", 1000], cm: ["len", 0.01], mm: ["len", 0.001], mi: ["len", 1609.344], ft: ["len", 0.3048], in: ["len", 0.0254], yd: ["len", 0.9144], kg: ["mass", 1], g: ["mass", 0.001], lbm: ["mass", 0.45359237], ozm: ["mass", 0.028349523125], l: ["vol", 1], L: ["vol", 1], ml: ["vol", 0.001], gal: ["vol", 3.785411784], s: ["time", 1], min: ["time", 60], hr: ["time", 3600], day: ["time", 86400] };
  const a1 = U[f];
  const b1 = U[t];
  if (!a1 || !b1 || a1[0] !== b1[0]) return ERR.NA;
  return (n * a1[1]) / b1[1];
}));

/** Names of every function, for autocomplete. */
export const FUNCTION_NAMES = Object.keys(FUNCTION_INFO).sort();

// ============================================================ number formats

function isDateFormat(fmt: string): boolean {
  const clean = fmt.replace(/"[^"]*"|\[[^\]]*\]|\\./g, "");
  return /[ymdhs]/i.test(clean) && !/[#0?]/.test(clean.replace(/\.0+/, ""));
}

function formatDate(serial: number, fmt: string): string {
  const d = serialToDate(serial);
  const hasAmPm = /AM\/PM|am\/pm|A\/P/.test(fmt);
  const H = d.getUTCHours();
  const minutesContext = (i: number, tokens: string[]) => {
    // "m" right after h or before s means minutes.
    const prev = tokens.slice(0, i).reverse().find((t) => /^[hHsSyYdD]/.test(t) || /^m/i.test(t));
    const next = tokens.slice(i + 1).find((t) => /^[hHsSyYdD]/.test(t) || /^m/i.test(t));
    return (prev && /^h/i.test(prev)) || (next && /^s/i.test(next));
  };
  const tokens = fmt.match(/"[^"]*"|\\.|yyyy|yy|mmmm|mmm|mm|m|dddd|ddd|dd|d|hh|h|ss|s|AM\/PM|am\/pm|A\/P|./gi) ?? [];
  const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return tokens
    .map((tok, i) => {
      if (tok.startsWith('"')) return tok.slice(1, -1);
      if (tok.startsWith("\\")) return tok.slice(1);
      const low = tok.toLowerCase();
      switch (low) {
        case "yyyy":
          return String(d.getUTCFullYear());
        case "yy":
          return String(d.getUTCFullYear()).slice(-2);
        case "mmmm":
          return MONTH_NAMES[d.getUTCMonth()];
        case "mmm":
          return MONTH_NAMES[d.getUTCMonth()].slice(0, 3);
        case "mm":
          return minutesContext(i, tokens) ? String(d.getUTCMinutes()).padStart(2, "0") : String(d.getUTCMonth() + 1).padStart(2, "0");
        case "m":
          return minutesContext(i, tokens) ? String(d.getUTCMinutes()) : String(d.getUTCMonth() + 1);
        case "dddd":
          return DAY_NAMES[d.getUTCDay()];
        case "ddd":
          return DAY_NAMES[d.getUTCDay()].slice(0, 3);
        case "dd":
          return String(d.getUTCDate()).padStart(2, "0");
        case "d":
          return String(d.getUTCDate());
        case "hh":
          return String(hasAmPm ? H % 12 || 12 : H).padStart(2, "0");
        case "h":
          return String(hasAmPm ? H % 12 || 12 : H);
        case "ss":
          return String(d.getUTCSeconds()).padStart(2, "0");
        case "s":
          return String(d.getUTCSeconds());
        case "am/pm":
          return H < 12 ? (tok === "am/pm" ? "am" : "AM") : tok === "am/pm" ? "pm" : "PM";
        case "a/p":
          return H < 12 ? "A" : "P";
      }
      return tok;
    })
    .join("");
}

function formatNumberPattern(n: number, pat: string): string {
  let p = pat;
  let prefix = "";
  let suffix = "";
  // literal text and currency symbols around the number
  const lit = /^((?:"[^"]*"|\\.|[^#0?.,%])*)([#0?.,]+(?:[eE][+-]0+)?)((?:"[^"]*"|\\.|[^#0?.,])*)$/.exec(p);
  if (!lit) return formatGeneral(n);
  const strip = (s: string) => s.replace(/"([^"]*)"/g, "$1").replace(/\\(.)/g, "$1").replace(/_./g, " ").replace(/\*./g, "");
  prefix = strip(lit[1]);
  p = lit[2];
  suffix = strip(lit[3]);
  if (suffix.includes("%")) n *= 100 * (suffix.split("%").length - 1);
  const sci = /[eE][+-](0+)$/.exec(p);
  if (sci) {
    const mant = p.slice(0, sci.index);
    const decs = (mant.split(".")[1] ?? "").length;
    const [m, e] = n.toExponential(decs).split("e");
    return prefix + m + "E" + (Number(e) < 0 ? "-" : "+") + String(Math.abs(Number(e))).padStart(sci[1].length, "0") + suffix;
  }
  // thousands scaling: trailing commas divide by 1000
  while (p.endsWith(",")) {
    n /= 1000;
    p = p.slice(0, -1);
  }
  const [ip, dp = ""] = p.split(".");
  const minDec = (dp.match(/0/g) ?? []).length;
  const maxDec = dp.replace(/[^0#?]/g, "").length;
  let s = Math.abs(n).toFixed(maxDec);
  if (maxDec > minDec) {
    s = s.replace(/0+$/, (z) => z.slice(0, Math.max(0, z.length - (maxDec - minDec))));
    // keep at least minDec decimals
    const parts = s.split(".");
    if (parts[1] !== undefined) {
      if (parts[1].length < minDec) parts[1] = parts[1].padEnd(minDec, "0");
      s = parts[1].length ? `${parts[0]}.${parts[1]}` : parts[0];
    }
  }
  const parts = s.split(".");
  let i = parts[0];
  const d = parts[1];
  const minInt = (ip.match(/0/g) ?? []).length;
  if (i === "0" && minInt === 0) i = "";
  i = i.padStart(minInt, "0");
  if (ip.includes(",")) i = i.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const neg = n < 0 && Number(s) !== 0;
  return (neg ? "-" : "") + prefix + i + (d !== undefined && d !== "" ? "." + d : maxDec && minDec ? "." + "0".repeat(minDec) : "") + suffix;
}

/**
 * Formats a number with an Excel number-format code: General, 0, 0.00, #,##0.00, 0%, 0.00E+00,
 * "$"#,##0.00, [Red] negatives, up to four sections (positive;negative;zero;text), and dates/times.
 */
export function formatValue(v: number, fmt: string | undefined): string {
  if (!fmt || fmt === "General") return formatGeneral(v);
  const sections = fmt.split(/;(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  let sec = sections[0];
  let val = v;
  if (sections.length > 1 && v < 0) {
    sec = sections[1];
    val = Math.abs(v);
  } else if (sections.length > 2 && v === 0) sec = sections[2];
  const clean = sec.replace(/\[(Red|Blue|Green|Black|White|Yellow|Magenta|Cyan|Color\d+)\]/gi, "").replace(/\[\$([^\]-]*)(-[^\]]*)?\]/g, '"$1"');
  if (isDateFormat(clean)) return formatDate(val, clean.replace(/\[[hms]+\]/gi, (m) => m.slice(1, -1)));
  if (clean === "@") return formatGeneral(val);
  return formatNumberPattern(val, clean);
}

/** Colour named in a format section, e.g. [Red] for negatives. */
export function formatColor(v: number, fmt: string | undefined): string | null {
  if (!fmt) return null;
  const sections = fmt.split(";");
  const sec = sections.length > 1 && v < 0 ? sections[1] : sections[0];
  const m = /\[(Red|Blue|Green|Black|White|Yellow|Magenta|Cyan)\]/i.exec(sec);
  if (!m) return null;
  return { red: "#d00", blue: "#0645ad", green: "#0a7d32", black: "#000", white: "#fff", yellow: "#c9a400", magenta: "#c0c", cyan: "#0aa" }[m[1].toLowerCase()] ?? null;
}

export function isDateFmt(fmt: string | undefined): boolean {
  return Boolean(fmt && fmt !== "General" && isDateFormat(fmt.split(";")[0].replace(/\[[^\]]*\]/g, "")));
}

// ============================================================ formula rewriting

/**
 * Shifts relative references by (dr, dc) for copy/paste and fill. Absolute parts ($A, $1) stay.
 * References that would fall off the sheet become #REF!.
 */
export function shiftFormula(formula: string, dr: number, dc: number): string {
  if (!formula.startsWith("=")) return formula;
  let out = "";
  let i = 0;
  const s = formula;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '"') {
      const end = s.indexOf('"', i + 1);
      const j = end < 0 ? s.length : end + 1;
      out += s.slice(i, j);
      i = j;
      continue;
    }
    const rest = s.slice(i);
    const sheetM = /^(?:'(?:[^']|'')+'|[A-Za-z_][A-Za-z0-9_.]*)!/.exec(rest);
    const prefixLen = sheetM ? sheetM[0].length : 0;
    const prevCh = out[out.length - 1] ?? "";
    const m = /^(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})(?![A-Za-z0-9_(])/.exec(rest.slice(prefixLen));
    if (m && !/[A-Za-z0-9_.]/.test(prevCh)) {
      const c = colToIndex(m[2]) + (m[1] ? 0 : dc);
      const r = Number(m[4]) - 1 + (m[3] ? 0 : dr);
      out += rest.slice(0, prefixLen);
      out += c < 0 || r < 0 ? "#REF!" : `${m[1]}${indexToCol(c)}${m[3]}${r + 1}`;
      i += prefixLen + m[0].length;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/**
 * Rewrites references after rows/columns are inserted or deleted on `sheet`.
 * kind "row"/"col", at = first index, count > 0 inserts, < 0 deletes.
 */
export function adjustForInsert(formula: string, formulaSheet: string, sheet: string, kind: "row" | "col", at: number, count: number): string {
  if (!formula.startsWith("=")) return formula;
  return formula.replace(/((?:'(?:[^']|'')+'|[A-Za-z_][A-Za-z0-9_.]*)!)?(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})(?![A-Za-z0-9_(])/g, (full, sh: string | undefined, ac: string, col: string, ar: string, row: string, offset: number, whole: string) => {
    const before = whole[offset - 1] ?? "";
    if (/[A-Za-z0-9_."]/.test(before)) return full;
    const refSheet = sh ? sh.slice(0, -1).replace(/^'|'$/g, "").replace(/''/g, "'") : formulaSheet;
    if (refSheet !== sheet) return full;
    let r = Number(row) - 1;
    let c = colToIndex(col);
    if (kind === "row" && r >= at) {
      if (count < 0 && r < at - count) return (sh ?? "") + "#REF!";
      r += count;
    }
    if (kind === "col" && c >= at) {
      if (count < 0 && c < at - count) return (sh ?? "") + "#REF!";
      c += count;
    }
    return `${sh ?? ""}${ac}${indexToCol(c)}${ar}${r + 1}`;
  });
}

/** Cell references a formula reads (for dependency highlighting / tracing). */
export function referencedRanges(formula: string): { sheet?: string; ref: string }[] {
  try {
    return tokenize(formula.replace(/^=/, ""))
      .filter((t): t is Extract<Tok, { t: "ref" }> => t.t === "ref")
      .map((t) => ({ sheet: t.sheet, ref: t.v }));
  } catch {
    return [];
  }
}
