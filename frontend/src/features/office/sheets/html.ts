/** A sheet as a standalone HTML table (download, or print / Save as PDF). */
import { isError } from "./formula";
import { DEFAULT_COL_W, DEFAULT_ROW_H, evalConditional, key, mergeAt, unkey, type BorderSide, type Computed, type Sheet } from "./model";
import { displayOf } from "./render";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const border = (b?: BorderSide) => (b ? `${b.style === "thick" ? 3 : b.style === "medium" ? 2 : 1}px ${b.style === "dashed" ? "dashed" : b.style === "dotted" ? "dotted" : b.style === "double" ? "double" : "solid"} ${b.color}` : "");

export function usedRange(sh: Sheet, comp: Computed) {
  let r2 = -1;
  let c2 = -1;
  const take = (k: string) => {
    const { r, c } = unkey(k);
    if (r > r2) r2 = r;
    if (c > c2) c2 = c;
  };
  for (const k in sh.cells) if (sh.cells[k].v !== undefined && sh.cells[k].v !== null && sh.cells[k].v !== "") take(k);
  for (const k of comp.spillOwner.keys()) take(k);
  for (const m of sh.merges) {
    r2 = Math.max(r2, m.r2);
    c2 = Math.max(c2, m.c2);
  }
  return { r1: 0, c1: 0, r2, c2 };
}

export function sheetToHtml(sh: Sheet, comp: Computed, opts: { gridlines?: boolean; title?: string } = {}): string {
  const u = usedRange(sh, comp);
  const cond = evalConditional(sh, comp.values);
  const hidR = new Set(sh.hiddenRows);
  const hidC = new Set(sh.hiddenCols);
  let rows = "";
  for (let r = 0; r <= u.r2; r++) {
    if (hidR.has(r)) continue;
    let tds = "";
    for (let c = 0; c <= u.c2; c++) {
      if (hidC.has(c)) continue;
      const m = mergeAt(sh, r, c);
      if (m && (m.r1 !== r || m.c1 !== c)) continue;
      const k = key(r, c);
      const cell = sh.cells[k];
      const s = { ...cell?.s, ...cond.get(k)?.style };
      const v = comp.values.get(k) ?? null;
      const d = displayOf(v, s, cell?.v, false);
      const css = [
        s.bold && "font-weight:bold",
        s.italic && "font-style:italic",
        (s.underline || s.strike) && `text-decoration:${[s.underline && "underline", s.strike && "line-through"].filter(Boolean).join(" ")}`,
        s.font && `font-family:'${s.font}'`,
        s.size && `font-size:${s.size}pt`,
        `color:${d.color ?? s.color ?? "#000"}`,
        s.fill && `background:${s.fill}`,
        `text-align:${s.align ?? d.align}`,
        `vertical-align:${s.valign === "middle" ? "middle" : s.valign ?? "bottom"}`,
        s.wrap ? "white-space:pre-wrap" : "white-space:nowrap",
        s.bt && `border-top:${border(s.bt)}`,
        s.bb && `border-bottom:${border(s.bb)}`,
        s.bl && `border-left:${border(s.bl)}`,
        s.br && `border-right:${border(s.br)}`,
        s.indent && `padding-left:${4 + s.indent * 9}px`,
      ]
        .filter(Boolean)
        .join(";");
      const span = m ? ` rowspan="${m.r2 - m.r1 + 1}" colspan="${m.c2 - m.c1 + 1}"` : "";
      const content = cell?.link ? `<a href="${esc(cell.link)}">${esc(d.text)}</a>` : esc(d.text);
      tds += `<td${span} style="${css}"${isError(v) ? ' class="err"' : ""}>${content}</td>`;
    }
    rows += `<tr style="height:${sh.rowH[r] ?? DEFAULT_ROW_H}px">${tds}</tr>`;
  }
  let cols = "";
  for (let c = 0; c <= u.c2; c++) if (!hidC.has(c)) cols += `<col style="width:${sh.colW[c] ?? DEFAULT_COL_W}px">`;
  const grid = opts.gridlines ?? sh.gridlines;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(opts.title ?? sh.name)}</title><style>
body{font-family:Calibri,Carlito,'Segoe UI',Arial,sans-serif;font-size:11pt;margin:16px}
table{border-collapse:collapse;table-layout:fixed}
td{padding:2px 4px;overflow:hidden;${grid ? "border:1px solid #d9d9d9;" : ""}}
.err{color:#c00000}
@page{size:auto;margin:12mm}
@media print{body{margin:0}}
</style></head><body><table>${cols}${rows}</table></body></html>`;
}

/** Prints through a hidden frame; the browser's dialog offers "Save as PDF". */
export function printHtml(html: string) {
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(html);
  doc.close();
  const go = () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 60_000);
  };
  if (doc.readyState === "complete") setTimeout(go, 250);
  else frame.onload = () => setTimeout(go, 250);
}
