/**
 * Excel .xlsx read/write for the spreadsheet editor, written against the OOXML spec with fflate
 * (no SheetJS). Keeps values, formulas (with cached results), fonts, fills, borders, alignment,
 * number formats, merges, column widths, row heights, freeze panes, gridlines, tab colours,
 * conditional formatting, list validations and defined names. Also CSV/TSV in and out.
 */
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import { addr, colToIndex, formatValue, isError, shiftFormula as shiftShared, type Scalar } from "./formula";
import {
  blankSheet,
  key,
  parseInput,
  unkey,
  type BorderSide,
  type Cell,
  type CellStyle,
  type Computed,
  type CondRule,
  type Sheet,
  type Workbook,
  DEFAULT_COL_W,
  DEFAULT_ROW_H,
} from "./model";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
const argb = (hex: string) => "FF" + hex.replace("#", "").padStart(6, "0").slice(0, 6).toUpperCase();
const NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

// ===================================================================== export

const BUILTIN_FMT: Record<string, number> = {
  General: 0, "0": 1, "0.00": 2, "#,##0": 3, "#,##0.00": 4, "0%": 9, "0.00%": 10, "0.00E+00": 11, "h:mm AM/PM": 18, "h:mm:ss AM/PM": 19, "h:mm": 20, "h:mm:ss": 21, "@": 49,
};

function borderXml(side: string, b?: BorderSide) {
  if (!b) return `<${side}/>`;
  return `<${side} style="${b.style === "dashed" ? "dashed" : b.style === "dotted" ? "dotted" : b.style === "double" ? "double" : b.style}"><color rgb="${argb(b.color)}"/></${side}>`;
}

class StyleTable {
  fonts: string[] = ['<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>'];
  fills: string[] = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
  borders: string[] = ["<border><left/><right/><top/><bottom/><diagonal/></border>"];
  numFmts: string[] = [];
  numFmtIds = new Map<string, number>();
  xfs: string[] = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
  xfIndex = new Map<string, number>(["{}"].map((k) => [k, 0]));
  dxfs: string[] = [];

  private idx(list: string[], xml: string) {
    let i = list.indexOf(xml);
    if (i < 0) {
      list.push(xml);
      i = list.length - 1;
    }
    return i;
  }

  fontXml(s: CellStyle) {
    return `<font>${s.bold ? "<b/>" : ""}${s.italic ? "<i/>" : ""}${s.strike ? "<strike/>" : ""}${s.underline ? "<u/>" : ""}<sz val="${s.size ?? 11}"/>${s.color ? `<color rgb="${argb(s.color)}"/>` : ""}<name val="${esc(s.font ?? "Calibri")}"/></font>`;
  }

  fmtId(fmt: string): number {
    if (fmt in BUILTIN_FMT) return BUILTIN_FMT[fmt];
    let id = this.numFmtIds.get(fmt);
    if (id === undefined) {
      id = 164 + this.numFmts.length;
      this.numFmtIds.set(fmt, id);
      this.numFmts.push(`<numFmt numFmtId="${id}" formatCode="${esc(fmt)}"/>`);
    }
    return id;
  }

  xf(s: CellStyle | undefined): number {
    if (!s || !Object.keys(s).length) return 0;
    const k = JSON.stringify(s);
    const hit = this.xfIndex.get(k);
    if (hit !== undefined) return hit;
    const fontId = this.idx(this.fonts, this.fontXml(s));
    const fillId = s.fill ? this.idx(this.fills, `<fill><patternFill patternType="solid"><fgColor rgb="${argb(s.fill)}"/><bgColor indexed="64"/></patternFill></fill>`) : 0;
    const borderId = s.bt || s.br || s.bb || s.bl ? this.idx(this.borders, `<border>${borderXml("left", s.bl)}${borderXml("right", s.br)}${borderXml("top", s.bt)}${borderXml("bottom", s.bb)}<diagonal/></border>`) : 0;
    const numFmtId = s.fmt ? this.fmtId(s.fmt) : 0;
    const align = s.align || s.valign || s.wrap || s.indent || s.rotate;
    const alignXml = align
      ? `<alignment${s.align ? ` horizontal="${s.align}"` : ""}${s.valign ? ` vertical="${s.valign === "middle" ? "center" : s.valign}"` : ""}${s.wrap ? ' wrapText="1"' : ""}${s.indent ? ` indent="${s.indent}"` : ""}${s.rotate ? ` textRotation="${s.rotate < 0 ? 90 - s.rotate : s.rotate}"` : ""}/>`
      : "";
    const xml = `<xf numFmtId="${numFmtId}" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0"${numFmtId ? ' applyNumberFormat="1"' : ""}${fontId ? ' applyFont="1"' : ""}${fillId ? ' applyFill="1"' : ""}${borderId ? ' applyBorder="1"' : ""}${align ? ' applyAlignment="1">' + alignXml + "</xf>" : "/>"}`;
    this.xfs.push(xml);
    const i = this.xfs.length - 1;
    this.xfIndex.set(k, i);
    return i;
  }

  dxf(s: CellStyle | undefined): number {
    const st = s ?? {};
    const font = st.bold || st.italic || st.color ? `<font>${st.bold ? "<b/>" : ""}${st.italic ? "<i/>" : ""}${st.color ? `<color rgb="${argb(st.color)}"/>` : ""}</font>` : "";
    const fill = st.fill ? `<fill><patternFill patternType="solid"><fgColor rgb="${argb(st.fill)}"/><bgColor rgb="${argb(st.fill)}"/></patternFill></fill>` : "";
    this.dxfs.push(`<dxf>${font}${fill}</dxf>`);
    return this.dxfs.length - 1;
  }

  xml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="${NS_MAIN}">${this.numFmts.length ? `<numFmts count="${this.numFmts.length}">${this.numFmts.join("")}</numFmts>` : ""}<fonts count="${this.fonts.length}">${this.fonts.join("")}</fonts><fills count="${this.fills.length}">${this.fills.join("")}</fills><borders count="${this.borders.length}">${this.borders.join("")}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${this.xfs.length}">${this.xfs.join("")}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>${this.dxfs.length ? `<dxfs count="${this.dxfs.length}">${this.dxfs.join("")}</dxfs>` : '<dxfs count="0"/>'}</styleSheet>`;
  }
}

function condXml(rules: CondRule[], st: StyleTable, priority: { n: number }): string {
  const byRange = new Map<string, string[]>();
  for (const r of rules) {
    const p = priority.n++;
    let x = "";
    const dxf = () => st.dxf(r.style);
    const n = (v?: string) => esc(String(Number(v) || 0));
    switch (r.type) {
      case "gt":
        x = `<cfRule type="cellIs" dxfId="${dxf()}" priority="${p}" operator="greaterThan"><formula>${n(r.a)}</formula></cfRule>`;
        break;
      case "lt":
        x = `<cfRule type="cellIs" dxfId="${dxf()}" priority="${p}" operator="lessThan"><formula>${n(r.a)}</formula></cfRule>`;
        break;
      case "between":
        x = `<cfRule type="cellIs" dxfId="${dxf()}" priority="${p}" operator="between"><formula>${n(r.a)}</formula><formula>${n(r.b)}</formula></cfRule>`;
        break;
      case "eq":
        x = `<cfRule type="cellIs" dxfId="${dxf()}" priority="${p}" operator="equal"><formula>${Number.isFinite(Number(r.a)) && r.a !== "" ? n(r.a) : `"${esc(r.a ?? "")}"`}</formula></cfRule>`;
        break;
      case "text": {
        const first = r.range.split(":")[0].replace(/\$/g, "");
        x = `<cfRule type="containsText" dxfId="${dxf()}" priority="${p}" operator="containsText" text="${esc(r.a ?? "")}"><formula>NOT(ISERROR(SEARCH("${esc(r.a ?? "")}",${first})))</formula></cfRule>`;
        break;
      }
      case "dup":
        x = `<cfRule type="duplicateValues" dxfId="${dxf()}" priority="${p}"/>`;
        break;
      case "unique":
        x = `<cfRule type="uniqueValues" dxfId="${dxf()}" priority="${p}"/>`;
        break;
      case "top":
      case "bottom":
        x = `<cfRule type="top10" dxfId="${dxf()}" priority="${p}" rank="${Number(r.a) || 10}"${r.type === "bottom" ? ' bottom="1"' : ""}/>`;
        break;
      case "above":
      case "below":
        x = `<cfRule type="aboveAverage" dxfId="${dxf()}" priority="${p}"${r.type === "below" ? ' aboveAverage="0"' : ""}/>`;
        break;
      case "blank":
        x = `<cfRule type="containsBlanks" dxfId="${dxf()}" priority="${p}"><formula>LEN(TRIM(${r.range.split(":")[0]}))=0</formula></cfRule>`;
        break;
      case "scale": {
        const [lo, mid, hi] = r.colors ?? ["#f8696b", "#ffeb84", "#63be7b"];
        x = hi
          ? `<cfRule type="colorScale" priority="${p}"><colorScale><cfvo type="min"/><cfvo type="percentile" val="50"/><cfvo type="max"/><color rgb="${argb(lo)}"/><color rgb="${argb(mid)}"/><color rgb="${argb(hi)}"/></colorScale></cfRule>`
          : `<cfRule type="colorScale" priority="${p}"><colorScale><cfvo type="min"/><cfvo type="max"/><color rgb="${argb(lo)}"/><color rgb="${argb(mid)}"/></colorScale></cfRule>`;
        break;
      }
      case "bar":
        x = `<cfRule type="dataBar" priority="${p}"><dataBar><cfvo type="min"/><cfvo type="max"/><color rgb="${argb(r.colors?.[0] ?? "#638ec6")}"/></dataBar></cfRule>`;
        break;
      default:
        continue;
    }
    byRange.set(r.range, [...(byRange.get(r.range) ?? []), x]);
  }
  return [...byRange].map(([range, xs]) => `<conditionalFormatting sqref="${esc(range.replace(/\$/g, ""))}">${xs.join("")}</conditionalFormatting>`).join("");
}

function sheetXml(sh: Sheet, comp: Computed, st: StyleTable, shared: { list: string[]; index: Map<string, number> }, selected: boolean): string {
  const rows = new Map<number, string[]>();
  const keys = Object.keys(sh.cells)
    .map(unkey)
    .sort((a, b) => a.r - b.r || a.c - b.c);
  let maxR = 0;
  let maxC = 0;
  for (const { r, c } of keys) {
    const cell = sh.cells[key(r, c)];
    const s = st.xf(cell.s);
    const ref = addr(r, c);
    const raw = cell.v;
    let xml = "";
    if (typeof raw === "string" && raw.startsWith("=")) {
      const val = comp.values.get(key(r, c));
      const f = `<f>${esc(raw.slice(1))}</f>`;
      if (typeof val === "number") xml = `<c r="${ref}"${s ? ` s="${s}"` : ""}>${f}<v>${val}</v></c>`;
      else if (typeof val === "boolean") xml = `<c r="${ref}"${s ? ` s="${s}"` : ""} t="b">${f}<v>${val ? 1 : 0}</v></c>`;
      else if (isError(val)) xml = `<c r="${ref}"${s ? ` s="${s}"` : ""} t="e">${f}<v>${esc(val.code)}</v></c>`;
      else xml = `<c r="${ref}"${s ? ` s="${s}"` : ""} t="str">${f}<v>${esc(String(val ?? ""))}</v></c>`;
    } else if (typeof raw === "number") xml = `<c r="${ref}"${s ? ` s="${s}"` : ""}><v>${raw}</v></c>`;
    else if (typeof raw === "boolean") xml = `<c r="${ref}"${s ? ` s="${s}"` : ""} t="b"><v>${raw ? 1 : 0}</v></c>`;
    else if (typeof raw === "string" && raw !== "") {
      let i = shared.index.get(raw);
      if (i === undefined) {
        i = shared.list.length;
        shared.list.push(raw);
        shared.index.set(raw, i);
      }
      xml = `<c r="${ref}"${s ? ` s="${s}"` : ""} t="s"><v>${i}</v></c>`;
    } else if (s) xml = `<c r="${ref}" s="${s}"/>`;
    if (!xml) continue;
    maxR = Math.max(maxR, r);
    maxC = Math.max(maxC, c);
    rows.set(r, [...(rows.get(r) ?? []), xml]);
  }
  for (const r of Object.keys(sh.rowH).map(Number)) if (!rows.has(r)) rows.set(r, []);
  const hidden = new Set(sh.hiddenRows);
  for (const r of hidden) if (!rows.has(r)) rows.set(r, []);
  const rowXml = [...rows.keys()]
    .sort((a, b) => a - b)
    .map((r) => {
      const h = sh.rowH[r];
      return `<row r="${r + 1}"${h ? ` ht="${(h * 0.75).toFixed(2)}" customHeight="1"` : ""}${hidden.has(r) ? ' hidden="1"' : ""}>${rows.get(r)!.join("")}</row>`;
    })
    .join("");
  const colIdx = new Set([...Object.keys(sh.colW).map(Number), ...sh.hiddenCols]);
  const colsXml = colIdx.size
    ? `<cols>${[...colIdx]
        .sort((a, b) => a - b)
        .map((c) => `<col min="${c + 1}" max="${c + 1}" width="${Math.max(1, ((sh.colW[c] ?? DEFAULT_COL_W) - 5) / 7).toFixed(2)}" customWidth="1"${sh.hiddenCols.includes(c) ? ' hidden="1"' : ""}/>`)
        .join("")}</cols>`
    : "";
  const { r: fr, c: fc } = sh.freeze;
  const pane =
    fr || fc
      ? `<pane${fc ? ` xSplit="${fc}"` : ""}${fr ? ` ySplit="${fr}"` : ""} topLeftCell="${addr(fr, fc)}" activePane="${fr && fc ? "bottomRight" : fr ? "bottomLeft" : "topRight"}" state="frozen"/>`
      : "";
  const merges = sh.merges.length ? `<mergeCells count="${sh.merges.length}">${sh.merges.map((m) => `<mergeCell ref="${addr(m.r1, m.c1)}:${addr(m.r2, m.c2)}"/>`).join("")}</mergeCells>` : "";
  const cond = condXml(sh.cond, st, { n: 1 });
  const dv = sh.validations.filter((v) => v.type === "list" && v.list?.length);
  const dvXml = dv.length
    ? `<dataValidations count="${dv.length}">${dv.map((v) => `<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" sqref="${esc(v.range)}"><formula1>"${esc((v.list ?? []).join(",").replace(/"/g, ""))}"</formula1></dataValidation>`).join("")}</dataValidations>`
    : "";
  const filter = sh.filter ? `<autoFilter ref="${esc(sh.filter.range)}"/>` : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="${NS_MAIN}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${sh.tabColor ? `<sheetPr><tabColor rgb="${argb(sh.tabColor)}"/></sheetPr>` : ""}<dimension ref="A1:${addr(maxR, maxC)}"/><sheetViews><sheetView workbookViewId="0"${selected ? ' tabSelected="1"' : ""}${sh.gridlines ? "" : ' showGridLines="0"'}${sh.zoom && sh.zoom !== 100 ? ` zoomScale="${sh.zoom}"` : ""}>${pane}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>${colsXml}<sheetData>${rowXml}</sheetData>${filter}${merges}${cond}${dvXml}<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>`;
}

export function exportXlsx(wb: Workbook, computed: Computed[], title = "Workbook"): Blob {
  const st = new StyleTable();
  const shared = { list: [] as string[], index: new Map<string, number>() };
  const files: Zippable = {};
  const sheetXmls = wb.sheets.map((sh, i) => sheetXml(sh, computed[i], st, shared, i === wb.active));
  sheetXmls.forEach((x, i) => (files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(x)));
  const names = Object.entries(wb.names)
    .map(([n, v]) => `<definedName name="${esc(n)}">${esc(v.replace(/^=/, ""))}</definedName>`)
    .join("");
  const filterNames = wb.sheets
    .map((sh, i) => (sh.filter ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${esc(sh.name.replace(/'/g, "''"))}'!${esc(sh.filter.range.replace(/(\D+)(\d+)/g, "$$$1$$$2"))}</definedName>` : ""))
    .join("");
  files["xl/workbook.xml"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="${NS_MAIN}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="${wb.active}"/></bookViews><sheets>${wb.sheets.map((sh, i) => `<sheet name="${esc(sh.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>${names || filterNames ? `<definedNames>${names}${filterNames}</definedNames>` : ""}<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`);
  files["xl/_rels/workbook.xml.rels"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${wb.sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${wb.sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId${wb.sheets.length + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`);
  files["xl/sharedStrings.xml"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="${NS_MAIN}" count="${shared.list.length}" uniqueCount="${shared.list.length}">${shared.list.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join("")}</sst>`);
  files["xl/styles.xml"] = strToU8(st.xml());
  files["[Content_Types].xml"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${wb.sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`);
  files["_rels/.rels"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`);
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  files["docProps/core.xml"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(title)}</dc:title><dc:creator>Do-Whatever-You-Like Sheets</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`);
  files["docProps/app.xml"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Microsoft Excel</Application></Properties>`);
  const ordered: Zippable = { "[Content_Types].xml": files["[Content_Types].xml"] };
  for (const [k, v] of Object.entries(files)) if (k !== "[Content_Types].xml") ordered[k] = v;
  return new Blob([zipSync(ordered, { level: 6 }) as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

// ===================================================================== import

const BUILTIN_CODES: Record<number, string> = {
  1: "0", 2: "0.00", 3: "#,##0", 4: "#,##0.00", 5: '"$"#,##0;-"$"#,##0', 6: '"$"#,##0;[Red]-"$"#,##0', 7: '"$"#,##0.00;-"$"#,##0.00', 8: '"$"#,##0.00;[Red]-"$"#,##0.00',
  9: "0%", 10: "0.00%", 11: "0.00E+00", 12: "0.00", 13: "0.00", 14: "dd/mm/yyyy", 15: "d-mmm-yy", 16: "d-mmm", 17: "mmm-yy", 18: "h:mm AM/PM", 19: "h:mm:ss AM/PM",
  20: "h:mm", 21: "h:mm:ss", 22: "dd/mm/yyyy h:mm", 37: "#,##0;(#,##0)", 38: "#,##0;[Red](#,##0)", 39: "#,##0.00;(#,##0.00)", 40: "#,##0.00;[Red](#,##0.00)", 45: "mm:ss", 46: "[h]:mm:ss", 47: "mm:ss.0", 48: "##0.0E+0", 49: "@",
};

/** Office theme colours (default theme), for fonts/fills that use theme="n". */
const THEME = ["#FFFFFF", "#000000", "#E7E6E6", "#44546A", "#4472C4", "#ED7D31", "#A5A5A5", "#FFC000", "#5B9BD5", "#70AD47", "#0563C1", "#954F72"];
const INDEXED = ["#000000", "#FFFFFF", "#FF0000", "#00FF00", "#0000FF", "#FFFF00", "#FF00FF", "#00FFFF", "#000000", "#FFFFFF", "#FF0000", "#00FF00", "#0000FF", "#FFFF00", "#FF00FF", "#00FFFF", "#800000", "#008000", "#000080", "#808000", "#800080", "#008080", "#C0C0C0", "#808080"];

function tint(hex: string, t: number): string {
  const n = hex.replace("#", "");
  const c = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16));
  const out = c.map((v) => Math.round(t < 0 ? v * (1 + t) : v + (255 - v) * t));
  return "#" + out.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("");
}

function colorOf(el: Element | null | undefined): string | undefined {
  if (!el) return undefined;
  const rgb = el.getAttribute("rgb");
  let hex: string | undefined;
  if (rgb) hex = "#" + rgb.slice(-6);
  else if (el.getAttribute("theme") !== null) {
    // Cell styles index theme colours as 0 lt1 (white), 1 dk1 (black), 2 lt2, 3 dk2, 4… accents;
    // THEME is already in that order (theme1.xml lists dk1 first, which is the usual trap).
    hex = THEME[Number(el.getAttribute("theme"))];
  } else if (el.getAttribute("indexed") !== null) hex = INDEXED[Number(el.getAttribute("indexed"))];
  const t = Number(el.getAttribute("tint") ?? 0);
  return hex && t ? tint(hex, t) : hex;
}

const child = (el: Element | null | undefined, name: string) => (el ? Array.from(el.children).find((c) => c.localName === name) : undefined);
const children = (el: Element | null | undefined, name: string) => (el ? Array.from(el.children).filter((c) => c.localName === name) : []);
const all = (el: Document | Element, name: string) => Array.from(el.getElementsByTagNameNS("*", name));

function readStyles(doc: Document | null): CellStyle[] {
  if (!doc) return [];
  const fmts = new Map<number, string>();
  for (const f of all(doc, "numFmt")) fmts.set(Number(f.getAttribute("numFmtId")), f.getAttribute("formatCode") ?? "General");
  const fonts = children(child(doc.documentElement, "fonts"), "font").map((f) => {
    const s: CellStyle = {};
    if (child(f, "b") && child(f, "b")?.getAttribute("val") !== "0") s.bold = true;
    if (child(f, "i") && child(f, "i")?.getAttribute("val") !== "0") s.italic = true;
    if (child(f, "u") && child(f, "u")?.getAttribute("val") !== "none") s.underline = true;
    if (child(f, "strike") && child(f, "strike")?.getAttribute("val") !== "0") s.strike = true;
    const sz = Number(child(f, "sz")?.getAttribute("val"));
    if (sz && sz !== 11) s.size = sz;
    const name = child(f, "name")?.getAttribute("val");
    if (name && name !== "Calibri") s.font = name;
    const col = colorOf(child(f, "color"));
    if (col && col.toUpperCase() !== "#000000") s.color = col;
    return s;
  });
  const fills = children(child(doc.documentElement, "fills"), "fill").map((f) => {
    const p = child(f, "patternFill");
    if (!p || p.getAttribute("patternType") !== "solid") return undefined;
    return colorOf(child(p, "fgColor")) ?? colorOf(child(p, "bgColor"));
  });
  const side = (b: Element | undefined): BorderSide | undefined => {
    const style = b?.getAttribute("style");
    if (!b || !style) return undefined;
    const map: Record<string, BorderSide["style"]> = { thin: "thin", hair: "thin", medium: "medium", thick: "thick", dashed: "dashed", mediumDashed: "dashed", dotted: "dotted", double: "double" };
    return { style: map[style] ?? "thin", color: colorOf(child(b, "color")) ?? "#000000" };
  };
  const borders = children(child(doc.documentElement, "borders"), "border").map((b) => ({ bl: side(child(b, "left")), br: side(child(b, "right")), bt: side(child(b, "top")), bb: side(child(b, "bottom")) }));
  return children(child(doc.documentElement, "cellXfs"), "xf").map((xf) => {
    const s: CellStyle = { ...(fonts[Number(xf.getAttribute("fontId") ?? 0)] ?? {}) };
    const fill = fills[Number(xf.getAttribute("fillId") ?? 0)];
    if (fill) s.fill = fill;
    const b = borders[Number(xf.getAttribute("borderId") ?? 0)];
    if (b) for (const k of ["bl", "br", "bt", "bb"] as const) if (b[k]) s[k] = b[k];
    const id = Number(xf.getAttribute("numFmtId") ?? 0);
    if (id) {
      const code = fmts.get(id) ?? BUILTIN_CODES[id];
      if (code && code !== "General") s.fmt = code;
    }
    const al = child(xf, "alignment");
    if (al) {
      const h = al.getAttribute("horizontal");
      if (h === "left" || h === "center" || h === "right") s.align = h;
      if (h === "centerContinuous") s.align = "center";
      const v = al.getAttribute("vertical");
      if (v === "top" || v === "bottom") s.valign = v;
      if (v === "center") s.valign = "middle";
      if (al.getAttribute("wrapText") === "1" || al.getAttribute("wrapText") === "true") s.wrap = true;
      const ind = Number(al.getAttribute("indent"));
      if (ind) s.indent = ind;
      const rot = Number(al.getAttribute("textRotation"));
      if (rot) s.rotate = rot > 90 ? 90 - rot : rot;
    }
    return s;
  });
}

function parseXml(bytes: Uint8Array | undefined): Document | null {
  if (!bytes) return null;
  const doc = new DOMParser().parseFromString(strFromU8(bytes), "application/xml");
  return doc.getElementsByTagName("parsererror").length ? null : doc;
}

function rangeFromRef(ref: string) {
  const [a, b] = ref.split(":");
  const pa = /^([A-Z]+)(\d+)$/.exec(a.replace(/\$/g, ""));
  const pb = /^([A-Z]+)(\d+)$/.exec((b ?? a).replace(/\$/g, ""));
  if (!pa || !pb) return null;
  return { r1: Number(pa[2]) - 1, c1: colToIndex(pa[1]), r2: Number(pb[2]) - 1, c2: colToIndex(pb[1]) };
}

export function importXlsx(bytes: Uint8Array): Workbook {
  const files = unzipSync(bytes);
  const lower = new Map(Object.keys(files).map((k) => [k.toLowerCase(), k]));
  const get = (p: string) => files[lower.get(p.replace(/^\//, "").toLowerCase()) ?? ""];
  const wbDoc = parseXml(get("xl/workbook.xml"));
  if (!wbDoc) throw new Error("That file isn't a valid Excel workbook.");
  const rels = parseXml(get("xl/_rels/workbook.xml.rels"));
  const relMap = new Map((rels ? all(rels, "Relationship") : []).map((r) => [r.getAttribute("Id"), r.getAttribute("Target") ?? ""]));
  const sst = parseXml(get("xl/sharedStrings.xml"));
  const strings = sst ? children(sst.documentElement, "si").map((si) => all(si, "t").filter((t) => t.parentElement?.localName !== "rPh").map((t) => t.textContent ?? "").join("")) : [];
  const styles = readStyles(parseXml(get("xl/styles.xml")));
  const dxfs = (() => {
    const d = parseXml(get("xl/styles.xml"));
    return d
      ? children(child(d.documentElement, "dxfs"), "dxf").map((x) => {
          const s: CellStyle = {};
          const f = child(x, "font");
          if (child(f, "b")) s.bold = true;
          if (child(f, "i")) s.italic = true;
          const c = colorOf(child(f, "color"));
          if (c) s.color = c;
          const p = child(child(x, "fill"), "patternFill");
          const fill = colorOf(child(p, "bgColor")) ?? colorOf(child(p, "fgColor"));
          if (fill) s.fill = fill;
          return s;
        })
      : [];
  })();

  const names: Record<string, string> = {};
  for (const dn of all(wbDoc, "definedName")) {
    const n = dn.getAttribute("name") ?? "";
    if (n && !n.startsWith("_xlnm") && dn.getAttribute("localSheetId") === null) names[n.toUpperCase()] = dn.textContent ?? "";
  }

  const sheets: Sheet[] = [];
  for (const s of all(wbDoc, "sheet")) {
    const name = s.getAttribute("name") ?? `Sheet${sheets.length + 1}`;
    const rid = s.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") ?? s.getAttribute("r:id");
    let target = relMap.get(rid) ?? "";
    target = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
    const doc = parseXml(get(target));
    const sh = blankSheet(name);
    if (s.getAttribute("state") === "hidden") sh.tabColor = sh.tabColor ?? undefined;
    if (!doc) {
      sheets.push(sh);
      continue;
    }
    const root = doc.documentElement;
    const tab = child(child(root, "sheetPr"), "tabColor");
    if (tab) sh.tabColor = colorOf(tab);
    const view = child(child(root, "sheetViews"), "sheetView");
    if (view?.getAttribute("showGridLines") === "0") sh.gridlines = false;
    const zoom = Number(view?.getAttribute("zoomScale"));
    if (zoom) sh.zoom = zoom;
    const pane = child(view, "pane");
    if (pane?.getAttribute("state") === "frozen" || pane?.getAttribute("state") === "frozenSplit") sh.freeze = { r: Number(pane.getAttribute("ySplit") ?? 0), c: Number(pane.getAttribute("xSplit") ?? 0) };
    for (const col of children(child(root, "cols"), "col")) {
      const min = Number(col.getAttribute("min")) - 1;
      const max = Math.min(Number(col.getAttribute("max")) - 1, min + 200);
      const w = Number(col.getAttribute("width"));
      for (let c = min; c <= max; c++) {
        if (w && col.getAttribute("customWidth") !== "0") sh.colW[c] = Math.round(w * 7 + 5);
        if (col.getAttribute("hidden") === "1") sh.hiddenCols.push(c);
      }
    }
    let maxR = 0;
    let maxC = 0;
    for (const row of children(child(root, "sheetData"), "row")) {
      const r = Number(row.getAttribute("r")) - 1;
      const ht = Number(row.getAttribute("ht"));
      if (ht && row.getAttribute("customHeight") === "1") sh.rowH[r] = Math.round(ht / 0.75);
      if (row.getAttribute("hidden") === "1") sh.hiddenRows.push(r);
      let nextC = 0;
      for (const c of children(row, "c")) {
        const ref = c.getAttribute("r");
        const pos = ref ? rangeFromRef(ref) : null;
        const rr = pos ? pos.r1 : r;
        const cc = pos ? pos.c1 : nextC;
        nextC = cc + 1;
        const t = c.getAttribute("t");
        const vEl = child(c, "v");
        const fEl = child(c, "f");
        const sIdx = Number(c.getAttribute("s") ?? 0);
        const cell: Cell = {};
        const style = styles[sIdx];
        if (style && Object.keys(style).length) cell.s = { ...style };
        const f = fEl?.textContent;
        if (f) cell.v = "=" + f;
        else if (t === "s") cell.v = strings[Number(vEl?.textContent)] ?? "";
        else if (t === "inlineStr") cell.v = all(c, "t").map((x) => x.textContent ?? "").join("");
        else if (t === "b") cell.v = vEl?.textContent === "1";
        else if (t === "str" || t === "e") cell.v = vEl?.textContent ?? "";
        else if (vEl?.textContent) cell.v = Number(vEl.textContent);
        if (cell.v === undefined && !cell.s) continue;
        sh.cells[key(rr, cc)] = cell;
        maxR = Math.max(maxR, rr);
        maxC = Math.max(maxC, cc);
      }
    }
    // shared formulas: <f t="shared" si="0"/> refer back to the master; expand them
    expandSharedFormulas(doc, sh);
    for (const m of all(root, "mergeCell")) {
      const g = rangeFromRef(m.getAttribute("ref") ?? "");
      if (g) sh.merges.push(g);
    }
    for (const cf of children(root, "conditionalFormatting")) {
      const range = (cf.getAttribute("sqref") ?? "").split(" ")[0];
      for (const rule of children(cf, "cfRule")) {
        const type = rule.getAttribute("type");
        const op = rule.getAttribute("operator");
        const fs = children(rule, "formula").map((x) => (x.textContent ?? "").replace(/^"|"$/g, ""));
        const style = dxfs[Number(rule.getAttribute("dxfId") ?? -1)];
        const base = { id: `cf${Math.random().toString(36).slice(2, 8)}`, range, style };
        if (type === "cellIs") {
          const map: Record<string, CondRule["type"]> = { greaterThan: "gt", lessThan: "lt", between: "between", equal: "eq" };
          if (op && map[op]) sh.cond.push({ ...base, type: map[op], a: fs[0], b: fs[1] });
        } else if (type === "duplicateValues") sh.cond.push({ ...base, type: "dup" });
        else if (type === "uniqueValues") sh.cond.push({ ...base, type: "unique" });
        else if (type === "containsText") sh.cond.push({ ...base, type: "text", a: rule.getAttribute("text") ?? "" });
        else if (type === "top10") sh.cond.push({ ...base, type: rule.getAttribute("bottom") === "1" ? "bottom" : "top", a: rule.getAttribute("rank") ?? "10" });
        else if (type === "aboveAverage") sh.cond.push({ ...base, type: rule.getAttribute("aboveAverage") === "0" ? "below" : "above" });
        else if (type === "colorScale") sh.cond.push({ ...base, type: "scale", colors: all(rule, "color").map((c) => colorOf(c) ?? "#ffffff") });
        else if (type === "dataBar") sh.cond.push({ ...base, type: "bar", colors: [colorOf(all(rule, "color")[0]) ?? "#638ec6"] });
      }
    }
    for (const dv of all(root, "dataValidation")) {
      if (dv.getAttribute("type") !== "list") continue;
      const f1 = child(dv, "formula1")?.textContent ?? "";
      if (!f1.startsWith('"')) continue;
      sh.validations.push({ id: `dv${Math.random().toString(36).slice(2, 8)}`, range: (dv.getAttribute("sqref") ?? "").split(" ")[0], type: "list", list: f1.replace(/^"|"$/g, "").split(",") });
    }
    const af = child(root, "autoFilter")?.getAttribute("ref");
    if (af) sh.filter = { range: af, criteria: {} };
    sh.rows = Math.max(1000, maxR + 100);
    sh.cols = Math.max(52, maxC + 10);
    sheets.push(sh);
  }
  if (!sheets.length) throw new Error("That workbook has no sheets.");
  const activeTab = Number(child(child(wbDoc.documentElement, "bookViews"), "workbookView")?.getAttribute("activeTab") ?? 0);
  return { sheets, active: Math.min(activeTab, sheets.length - 1), names };
}

function expandSharedFormulas(doc: Document, sh: Sheet) {
  const masters = new Map<string, { r: number; c: number; f: string }>();
  for (const c of all(doc, "c")) {
    const f = child(c, "f");
    if (f?.getAttribute("t") === "shared" && f.textContent && f.getAttribute("si") !== null) {
      const pos = rangeFromRef(c.getAttribute("r") ?? "");
      if (pos) masters.set(f.getAttribute("si")!, { r: pos.r1, c: pos.c1, f: f.textContent });
    }
  }
  if (!masters.size) return;
  for (const c of all(doc, "c")) {
    const f = child(c, "f");
    if (f?.getAttribute("t") !== "shared" || f.textContent) continue;
    const m = masters.get(f.getAttribute("si") ?? "");
    const pos = rangeFromRef(c.getAttribute("r") ?? "");
    if (!m || !pos) continue;
    const cell = sh.cells[key(pos.r1, pos.c1)] ?? {};
    cell.v = shiftShared("=" + m.f, pos.r1 - m.r, pos.c1 - m.c);
    sh.cells[key(pos.r1, pos.c1)] = cell;
  }
}


// ===================================================================== CSV

export function importDelimited(text: string, name = "Sheet1"): Workbook {
  const clean = text.replace(/^﻿/, "");
  const head = clean.split(/\r?\n/).slice(0, 5).join("\n");
  const delim = [",", ";", "\t", "|"].map((d) => [d, head.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (q) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += ch;
    } else if (ch === '"' && cell === "") q = true;
    else if (ch === delim) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && clean[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const sh = blankSheet(name.slice(0, 31) || "Sheet1");
  rows.forEach((r, i) =>
    r.forEach((v, j) => {
      if (v === "") return;
      const p = parseInput(v);
      sh.cells[key(i, j)] = p.fmt ? { v: p.v, s: { fmt: p.fmt } } : { v: p.v };
    }),
  );
  sh.rows = Math.max(1000, rows.length + 100);
  sh.cols = Math.max(52, Math.max(0, ...rows.map((r) => r.length)) + 10);
  return { sheets: [sh], active: 0, names: {} };
}

/** Values as displayed (formatted), one sheet. */
export function displayText(v: Scalar, fmt?: string): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return formatValue(v, fmt);
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (isError(v)) return v.code;
  return v;
}

export function exportDelimited(sh: Sheet, comp: Computed, delim = ","): string {
  let maxR = -1;
  let maxC = -1;
  for (const k in sh.cells) {
    const { r, c } = unkey(k);
    if (sh.cells[k].v !== undefined && sh.cells[k].v !== null) {
      maxR = Math.max(maxR, r);
      maxC = Math.max(maxC, c);
    }
  }
  for (const k of comp.spillOwner.keys()) {
    const { r, c } = unkey(k);
    maxR = Math.max(maxR, r);
    maxC = Math.max(maxC, c);
  }
  const lines: string[] = [];
  for (let r = 0; r <= maxR; r++) {
    const row: string[] = [];
    for (let c = 0; c <= maxC; c++) {
      const s = displayText(comp.values.get(key(r, c)) ?? null, sh.cells[key(r, c)]?.s?.fmt);
      row.push(s.includes(delim) || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s);
    }
    lines.push(row.join(delim));
  }
  return lines.join("\r\n");
}

export { DEFAULT_ROW_H };
