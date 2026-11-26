"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { FUNCTION_INFO, FUNCTION_NAMES, formatValue, indexToCol } from "./formula";
import { newId, type BorderSide, type CellStyle, type ChartSpec, type CondRule, type Range, type Validation } from "./model";
import { inputCls, Modal, primaryCls, secondaryCls } from "../shared/ui";

// ------------------------------------------------------------------ number formats

export const NUMBER_FORMATS: { label: string; fmt: string }[] = [
  { label: "General", fmt: "General" },
  { label: "Number", fmt: "#,##0.00" },
  { label: "Currency ($)", fmt: '"$"#,##0.00' },
  { label: "Currency (₹)", fmt: '"₹"#,##0.00' },
  { label: "Currency (€)", fmt: '"€"#,##0.00' },
  { label: "Currency (£)", fmt: '"£"#,##0.00' },
  { label: "Accounting", fmt: '"$"#,##0.00;("$"#,##0.00)' },
  { label: "Short date", fmt: "dd/mm/yyyy" },
  { label: "ISO date", fmt: "yyyy-mm-dd" },
  { label: "Long date", fmt: "dddd, d mmmm yyyy" },
  { label: "Time", fmt: "h:mm AM/PM" },
  { label: "Date & time", fmt: "yyyy-mm-dd h:mm" },
  { label: "Duration", fmt: "[h]:mm:ss" },
  { label: "Percentage", fmt: "0.00%" },
  { label: "Scientific", fmt: "0.00E+00" },
  { label: "Thousands (K)", fmt: '#,##0.0,"K"' },
  { label: "Millions (M)", fmt: '#,##0.0,,"M"' },
  { label: "Text", fmt: "@" },
];

type NumTab = "Number" | "Alignment" | "Border" | "Protection";

export function FormatCellsDialog({
  open,
  onClose,
  style,
  sample,
  onApply,
  onBorders,
}: {
  open: boolean;
  onClose: () => void;
  style: CellStyle;
  sample: number;
  onApply: (patch: Partial<CellStyle>) => void;
  onBorders: (preset: string, side: BorderSide | null) => void;
}) {
  const [tab, setTab] = useState<NumTab>("Number");
  const [fmt, setFmt] = useState(style.fmt ?? "General");
  const [decimals, setDecimals] = useState(2);
  const [thousands, setThousands] = useState(true);
  const [negRed, setNegRed] = useState(false);
  const [align, setAlign] = useState<CellStyle["align"] | "">(style.align ?? "");
  const [valign, setValign] = useState<CellStyle["valign"] | "">(style.valign ?? "");
  const [wrap, setWrap] = useState(Boolean(style.wrap));
  const [indent, setIndent] = useState(style.indent ?? 0);
  const [rotate, setRotate] = useState(style.rotate ?? 0);
  const [bStyle, setBStyle] = useState<BorderSide["style"]>("thin");
  const [bColor, setBColor] = useState("#000000");

  const builtNumber = `${thousands ? "#,##0" : "0"}${decimals ? "." + "0".repeat(decimals) : ""}`;
  const preview = (() => {
    try {
      return formatValue(sample, fmt);
    } catch {
      return "—";
    }
  })();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Format cells"
      wide
      footer={
        <>
          <button type="button" className={secondaryCls} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={primaryCls}
            onClick={() => {
              onApply({ fmt: fmt === "General" ? undefined : fmt, align: align || undefined, valign: valign || undefined, wrap: wrap || undefined, indent: indent || undefined, rotate: rotate || undefined });
              onClose();
            }}
          >
            Apply
          </button>
        </>
      }
    >
      <div role="tablist" className="mb-4 flex gap-1 border-b border-line">
        {(["Number", "Alignment", "Border"] as NumTab[]).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cn("-mb-px border-b-2 px-3 py-2 text-sm", tab === t ? "border-accent text-ink" : "border-transparent text-ink-2")}>
            {t}
          </button>
        ))}
      </div>
      {tab === "Number" && (
        <div className="grid gap-4 sm:grid-cols-[200px_1fr]">
          <ul className="max-h-72 overflow-y-auto rounded-[6px] border border-line">
            {NUMBER_FORMATS.map((f) => (
              <li key={f.fmt}>
                <button type="button" onClick={() => setFmt(f.fmt)} className={cn("w-full px-3 py-1.5 text-left text-sm", fmt === f.fmt ? "bg-ink text-paper" : "hover:bg-paper")}>
                  {f.label}
                </button>
              </li>
            ))}
          </ul>
          <div className="space-y-3">
            <div className="rounded-[6px] border border-line bg-paper/50 p-3">
              <p className="text-[11px] uppercase tracking-wide text-ink-3">Preview</p>
              <p className="mt-1 font-mono text-lg text-ink">{preview}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm text-ink-2">
                Decimal places
                <input type="number" min={0} max={10} value={decimals} onChange={(e) => setDecimals(Math.max(0, Math.min(10, Number(e.target.value))))} className={inputCls} />
              </label>
              <label className="mt-6 flex items-center gap-2 text-sm text-ink-2">
                <input type="checkbox" checked={thousands} onChange={(e) => setThousands(e.target.checked)} /> 1000 separator (,)
              </label>
              <label className="flex items-center gap-2 text-sm text-ink-2">
                <input type="checkbox" checked={negRed} onChange={(e) => setNegRed(e.target.checked)} /> Negatives in red
              </label>
              <button type="button" className={secondaryCls} onClick={() => setFmt(negRed ? `${builtNumber};[Red]-${builtNumber}` : builtNumber)}>
                Use number format
              </button>
            </div>
            <label className="block text-sm text-ink-2">
              Custom format code
              <input value={fmt} onChange={(e) => setFmt(e.target.value)} className={cn(inputCls, "font-mono")} />
            </label>
            <p className="text-xs text-ink-3">Codes work like Excel: 0 · # · , · % · E+00 · &quot;text&quot; · [Red] · positive;negative;zero · yyyy mm dd hh:mm AM/PM.</p>
          </div>
        </div>
      )}
      {tab === "Alignment" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm text-ink-2">
            Horizontal
            <select value={align} onChange={(e) => setAlign(e.target.value as CellStyle["align"])} className={inputCls}>
              <option value="">General</option>
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
          </label>
          <label className="text-sm text-ink-2">
            Vertical
            <select value={valign} onChange={(e) => setValign(e.target.value as CellStyle["valign"])} className={inputCls}>
              <option value="">Bottom</option>
              <option value="top">Top</option>
              <option value="middle">Middle</option>
              <option value="bottom">Bottom</option>
            </select>
          </label>
          <label className="text-sm text-ink-2">
            Indent
            <input type="number" min={0} max={15} value={indent} onChange={(e) => setIndent(Number(e.target.value))} className={inputCls} />
          </label>
          <label className="text-sm text-ink-2">
            Text angle (°)
            <input type="number" min={-90} max={90} value={rotate} onChange={(e) => setRotate(Number(e.target.value))} className={inputCls} />
          </label>
          <label className="flex items-center gap-2 text-sm text-ink-2">
            <input type="checkbox" checked={wrap} onChange={(e) => setWrap(e.target.checked)} /> Wrap text
          </label>
        </div>
      )}
      {tab === "Border" && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <label className="text-sm text-ink-2">
              Line
              <select value={bStyle} onChange={(e) => setBStyle(e.target.value as BorderSide["style"])} className={inputCls}>
                {["thin", "medium", "thick", "dashed", "dotted", "double"].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-ink-2">
              Colour
              <input type="color" value={bColor} onChange={(e) => setBColor(e.target.value)} className="block h-9 w-16 rounded border border-line" />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              ["all", "All borders"],
              ["outside", "Outside"],
              ["inside", "Inside"],
              ["top", "Top"],
              ["bottom", "Bottom"],
              ["left", "Left"],
              ["right", "Right"],
              ["thickBottom", "Thick bottom"],
              ["none", "No border"],
            ].map(([p, l]) => (
              <button key={p} type="button" className={secondaryCls} onClick={() => onBorders(p, p === "none" ? null : { style: p === "thickBottom" ? "thick" : bStyle, color: bColor })}>
                {l}
              </button>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------ conditional formatting

const COND_TYPES: { type: CondRule["type"]; label: string; needs: 0 | 1 | 2 }[] = [
  { type: "gt", label: "Greater than", needs: 1 },
  { type: "lt", label: "Less than", needs: 1 },
  { type: "between", label: "Between", needs: 2 },
  { type: "eq", label: "Equal to", needs: 1 },
  { type: "text", label: "Text contains", needs: 1 },
  { type: "dup", label: "Duplicate values", needs: 0 },
  { type: "unique", label: "Unique values", needs: 0 },
  { type: "top", label: "Top N items", needs: 1 },
  { type: "bottom", label: "Bottom N items", needs: 1 },
  { type: "above", label: "Above average", needs: 0 },
  { type: "below", label: "Below average", needs: 0 },
  { type: "blank", label: "Blank cells", needs: 0 },
  { type: "scale", label: "Colour scale (red–yellow–green)", needs: 0 },
  { type: "bar", label: "Data bars", needs: 0 },
];

const COND_STYLES: { label: string; style: CellStyle }[] = [
  { label: "Light red fill, dark red text", style: { fill: "#ffc7ce", color: "#9c0006" } },
  { label: "Yellow fill, dark yellow text", style: { fill: "#ffeb9c", color: "#9c5700" } },
  { label: "Green fill, dark green text", style: { fill: "#c6efce", color: "#006100" } },
  { label: "Light red fill", style: { fill: "#ffc7ce" } },
  { label: "Red text", style: { color: "#c00000" } },
  { label: "Bold", style: { bold: true } },
];

export function CondFormatDialog({ open, onClose, rules, selection, onChange }: { open: boolean; onClose: () => void; rules: CondRule[]; selection: string; onChange: (r: CondRule[]) => void }) {
  const [type, setType] = useState<CondRule["type"]>("gt");
  const [range, setRange] = useState(selection);
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [styleIdx, setStyleIdx] = useState(0);
  const needs = COND_TYPES.find((t) => t.type === type)?.needs ?? 0;
  return (
    <Modal open={open} onClose={onClose} title="Conditional formatting" wide>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm text-ink-2">
          Apply to range
          <input value={range} onChange={(e) => setRange(e.target.value.toUpperCase())} className={cn(inputCls, "font-mono")} />
        </label>
        <label className="text-sm text-ink-2">
          Format cells when
          <select value={type} onChange={(e) => setType(e.target.value as CondRule["type"])} className={inputCls}>
            {COND_TYPES.map((t) => (
              <option key={t.type} value={t.type}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        {needs >= 1 && (
          <label className="text-sm text-ink-2">
            {type === "top" || type === "bottom" ? "N" : "Value"}
            <input value={a} onChange={(e) => setA(e.target.value)} className={inputCls} />
          </label>
        )}
        {needs === 2 && (
          <label className="text-sm text-ink-2">
            And
            <input value={b} onChange={(e) => setB(e.target.value)} className={inputCls} />
          </label>
        )}
        {type !== "scale" && type !== "bar" && (
          <label className="text-sm text-ink-2 sm:col-span-2">
            Style
            <select value={styleIdx} onChange={(e) => setStyleIdx(Number(e.target.value))} className={inputCls}>
              {COND_STYLES.map((s, i) => (
                <option key={s.label} value={i}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <button
        type="button"
        className={cn(primaryCls, "mt-3")}
        disabled={!/^\$?[A-Z]{1,3}\$?\d+(:\$?[A-Z]{1,3}\$?\d+)?$/.test(range) || (needs > 0 && !a)}
        onClick={() => {
          onChange([...rules, { id: newId("cf"), range, type, a, b, style: COND_STYLES[styleIdx].style, colors: type === "scale" ? ["#f8696b", "#ffeb84", "#63be7b"] : type === "bar" ? ["#638ec6"] : undefined }]);
          setA("");
          setB("");
        }}
      >
        <Plus className="size-4" /> Add rule
      </button>
      <h3 className="mt-5 text-[11px] uppercase tracking-wide text-ink-3">Rules on this sheet</h3>
      {rules.length === 0 ? (
        <p className="mt-2 text-sm text-ink-3">No rules yet.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line rounded-[6px] border border-line">
          {rules.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="inline-block h-5 w-8 rounded border border-line" style={{ background: r.type === "scale" ? "linear-gradient(90deg,#f8696b,#ffeb84,#63be7b)" : r.type === "bar" ? "#638ec6" : r.style?.fill ?? "#fff", color: r.style?.color }} />
              <span className="flex-1">
                {COND_TYPES.find((t) => t.type === r.type)?.label} {r.a ?? ""} {r.type === "between" ? `and ${r.b}` : ""}
              </span>
              <span className="font-mono text-xs text-ink-3">{r.range}</span>
              <button type="button" aria-label="Delete rule" onClick={() => onChange(rules.filter((x) => x.id !== r.id))} className="p-1 text-ink-3 hover:text-danger">
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------ data validation

export function ValidationDialog({ open, onClose, rules, selection, onChange }: { open: boolean; onClose: () => void; rules: Validation[]; selection: string; onChange: (v: Validation[]) => void }) {
  const [range, setRange] = useState(selection);
  const [list, setList] = useState("Yes, No, Maybe");
  return (
    <Modal open={open} onClose={onClose} title="Data validation (drop-down list)">
      <label className="block text-sm text-ink-2">
        Cells
        <input value={range} onChange={(e) => setRange(e.target.value.toUpperCase())} className={cn(inputCls, "font-mono")} />
      </label>
      <label className="mt-3 block text-sm text-ink-2">
        Allowed values (comma-separated)
        <input value={list} onChange={(e) => setList(e.target.value)} className={inputCls} />
      </label>
      <button
        type="button"
        className={cn(primaryCls, "mt-3")}
        onClick={() => onChange([...rules.filter((r) => r.range !== range), { id: newId("dv"), range, type: "list", list: list.split(",").map((s) => s.trim()).filter(Boolean) }])}
      >
        Add drop-down
      </button>
      <ul className="mt-4 divide-y divide-line rounded-[6px] border border-line">
        {rules.map((r) => (
          <li key={r.id} className="flex items-center gap-3 px-3 py-2 text-sm">
            <span className="font-mono text-xs">{r.range}</span>
            <span className="flex-1 truncate text-ink-2">{r.list?.join(", ")}</span>
            <button type="button" aria-label="Remove" onClick={() => onChange(rules.filter((x) => x.id !== r.id))} className="p-1 text-ink-3 hover:text-danger">
              <Trash2 className="size-4" />
            </button>
          </li>
        ))}
        {!rules.length && <li className="px-3 py-3 text-sm text-ink-3">No drop-downs on this sheet.</li>}
      </ul>
    </Modal>
  );
}

// ------------------------------------------------------------------ sort

export function SortDialog({ open, onClose, range, headerNames, onSort }: { open: boolean; onClose: () => void; range: Range; headerNames: (hasHeader: boolean) => string[]; onSort: (levels: { col: number; desc: boolean }[], hasHeader: boolean) => void }) {
  const [hasHeader, setHasHeader] = useState(true);
  const [levels, setLevels] = useState([{ col: range.c1, desc: false }]);
  const names = headerNames(hasHeader);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Sort"
      footer={
        <>
          <button type="button" className={secondaryCls} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={primaryCls}
            onClick={() => {
              onSort(levels, hasHeader);
              onClose();
            }}
          >
            Sort
          </button>
        </>
      }
    >
      <label className="flex items-center gap-2 text-sm text-ink-2">
        <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} /> My data has headers
      </label>
      <div className="mt-3 space-y-2">
        {levels.map((lv, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-16 text-xs text-ink-3">{i === 0 ? "Sort by" : "Then by"}</span>
            <select value={lv.col} onChange={(e) => setLevels((l) => l.map((x, j) => (j === i ? { ...x, col: Number(e.target.value) } : x)))} className={inputCls}>
              {names.map((n, j) => (
                <option key={j} value={range.c1 + j}>
                  {n}
                </option>
              ))}
            </select>
            <select value={lv.desc ? "desc" : "asc"} onChange={(e) => setLevels((l) => l.map((x, j) => (j === i ? { ...x, desc: e.target.value === "desc" } : x)))} className={cn(inputCls, "w-36")}>
              <option value="asc">A → Z / 1 → 9</option>
              <option value="desc">Z → A / 9 → 1</option>
            </select>
            {i > 0 && (
              <button type="button" aria-label="Remove level" onClick={() => setLevels((l) => l.filter((_, j) => j !== i))} className="p-1 text-ink-3 hover:text-danger">
                <Trash2 className="size-4" />
              </button>
            )}
          </div>
        ))}
      </div>
      {levels.length < 4 && (
        <button type="button" className={cn(secondaryCls, "mt-3")} onClick={() => setLevels((l) => [...l, { col: range.c1, desc: false }])}>
          <Plus className="size-4" /> Add level
        </button>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------ find & replace

export function FindDialog({
  open,
  onClose,
  onFind,
  onReplace,
  onReplaceAll,
}: {
  open: boolean;
  onClose: () => void;
  onFind: (q: string, opts: FindOpts) => number;
  onReplace: (q: string, r: string, opts: FindOpts) => void;
  onReplaceAll: (q: string, r: string, opts: FindOpts) => number;
}) {
  const [q, setQ] = useState("");
  const [r, setR] = useState("");
  const [opts, setOpts] = useState<FindOpts>({ matchCase: false, whole: false, formulas: false, allSheets: false });
  const [msg, setMsg] = useState("");
  return (
    <Modal open={open} onClose={onClose} title="Find & replace">
      <div className="space-y-3">
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find" className={inputCls} onKeyDown={(e) => e.key === "Enter" && setMsg(`${onFind(q, opts)} match(es)`)} />
        <input value={r} onChange={(e) => setR(e.target.value)} placeholder="Replace with" className={inputCls} />
        <div className="flex flex-wrap gap-4 text-sm text-ink-2">
          {(
            [
              ["matchCase", "Match case"],
              ["whole", "Entire cell"],
              ["formulas", "Look in formulas"],
              ["allSheets", "All sheets"],
            ] as const
          ).map(([k, l]) => (
            <label key={k} className="flex items-center gap-1.5">
              <input type="checkbox" checked={opts[k]} onChange={(e) => setOpts((o) => ({ ...o, [k]: e.target.checked }))} /> {l}
            </label>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={primaryCls} disabled={!q} onClick={() => setMsg(`${onFind(q, opts)} match(es)`)}>
            Find next
          </button>
          <button type="button" className={secondaryCls} disabled={!q} onClick={() => onReplace(q, r, opts)}>
            Replace
          </button>
          <button type="button" className={secondaryCls} disabled={!q} onClick={() => setMsg(`Replaced ${onReplaceAll(q, r, opts)}`)}>
            Replace all
          </button>
        </div>
        {msg && <p className="text-sm text-ink-2">{msg}</p>}
      </div>
    </Modal>
  );
}
export type FindOpts = { matchCase: boolean; whole: boolean; formulas: boolean; allSheets: boolean };

// ------------------------------------------------------------------ charts

const CHART_TYPES: { type: ChartSpec["type"]; label: string }[] = [
  { type: "column", label: "Column" },
  { type: "bar", label: "Bar" },
  { type: "line", label: "Line" },
  { type: "area", label: "Area" },
  { type: "pie", label: "Pie" },
  { type: "doughnut", label: "Doughnut" },
  { type: "scatter", label: "Scatter" },
  { type: "radar", label: "Radar" },
];

export function ChartDialog({ open, onClose, initial, onSave }: { open: boolean; onClose: () => void; initial: ChartSpec; onSave: (c: ChartSpec) => void }) {
  const [c, setC] = useState(initial);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Chart"
      footer={
        <>
          <button type="button" className={secondaryCls} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={primaryCls}
            onClick={() => {
              onSave(c);
              onClose();
            }}
          >
            {initial.title === "\u0000" ? "Insert" : "Save"}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-4 gap-2">
        {CHART_TYPES.map((t) => (
          <button key={t.type} type="button" onClick={() => setC({ ...c, type: t.type })} className={cn("rounded-[6px] border px-2 py-3 text-sm", c.type === t.type ? "border-ink bg-ink text-paper" : "border-line hover:border-ink-3")}>
            {t.label}
          </button>
        ))}
      </div>
      <label className="mt-3 block text-sm text-ink-2">
        Data range
        <input value={c.range} onChange={(e) => setC({ ...c, range: e.target.value.toUpperCase() })} className={cn(inputCls, "font-mono")} />
      </label>
      <label className="mt-3 block text-sm text-ink-2">
        Title
        <input value={c.title === "\u0000" ? "" : c.title} onChange={(e) => setC({ ...c, title: e.target.value })} className={inputCls} />
      </label>
      <div className="mt-3 flex flex-wrap gap-4 text-sm text-ink-2">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={c.headers} onChange={(e) => setC({ ...c, headers: e.target.checked })} /> First row is series names
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={c.legend} onChange={(e) => setC({ ...c, legend: e.target.checked })} /> Legend
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={Boolean(c.stacked)} onChange={(e) => setC({ ...c, stacked: e.target.checked })} /> Stacked
        </label>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ function browser

export function FunctionDialog({ open, onClose, onInsert }: { open: boolean; onClose: () => void; onInsert: (name: string) => void }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("All");
  const cats = useMemo(() => ["All", ...Array.from(new Set(Object.values(FUNCTION_INFO).map((i) => i[0]))).sort()], []);
  const list = FUNCTION_NAMES.filter((n) => (cat === "All" || FUNCTION_INFO[n][0] === cat) && (!q || n.includes(q.toUpperCase()) || FUNCTION_INFO[n][2].toLowerCase().includes(q.toLowerCase())));
  return (
    <Modal open={open} onClose={onClose} title={`Insert function (${FUNCTION_NAMES.length})`} wide>
      <div className="flex flex-wrap gap-2">
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search, e.g. lookup, average, date…" className={cn(inputCls, "flex-1")} />
        <select value={cat} onChange={(e) => setCat(e.target.value)} className={cn(inputCls, "w-44")}>
          {cats.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </div>
      <ul className="mt-3 max-h-[50vh] divide-y divide-line overflow-y-auto rounded-[6px] border border-line">
        {list.map((n) => (
          <li key={n}>
            <button
              type="button"
              onClick={() => {
                onInsert(n);
                onClose();
              }}
              className="w-full px-3 py-2 text-left hover:bg-paper"
            >
              <span className="font-mono text-sm font-semibold text-ink">{FUNCTION_INFO[n][1]}</span>
              <span className="ml-2 text-[11px] text-accent">{FUNCTION_INFO[n][0]}</span>
              <span className="block text-xs text-ink-2">{FUNCTION_INFO[n][2]}</span>
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

export function colName(c: number) {
  return indexToCol(c);
}
