"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  FileSpreadsheet,
  FileStack,
  FileText,
  Presentation,
  Printer,
  RotateCcw,
  Search,
  Sparkles,
} from "lucide-react";
import { inflateSync, unzipSync, unzlibSync, zipSync } from "fflate";
import { saveBlob } from "@/lib/files";
import { formatBytes } from "@/lib/media";
import { getTool, stepsFor, toolHref } from "@/lib/tools";
import { cn } from "@/lib/utils";
import { FileDrop } from "../file-drop";
import { Workbench } from "../workbench";
import { CopyButton } from "../dev/parts";
import { Chips, Notice, Panel, Row, Toggle } from "../pdf/kit";
import { PdfPreview } from "../pdf/parts";
import { parseCsvRows } from "../utilities/dev-data-engines";

/* ========================================================================
 * SHARED BYTES & PURE-TS XML AST PARSER (Works in Browser + Node)
 * ======================================================================== */

const utf8Dec = new TextDecoder("utf-8", { fatal: false });
const utf8Enc = new TextEncoder();

function decodeXmlEntities(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, ref: string) => {
    if (ref === "amp") return "&";
    if (ref === "lt") return "<";
    if (ref === "gt") return ">";
    if (ref === "quot") return '"';
    if (ref === "apos") return "'";
    if (ref.startsWith("#x")) {
      const code = Number.parseInt(ref.slice(2), 16);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : "";
    }
    const code = Number.parseInt(ref.slice(1), 10);
    return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : "";
  });
}

type XmlNode = {
  tag: string;
  local: string;
  attrs: Record<string, string>;
  children: (XmlNode | string)[];
};

function parseXmlAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const val = decodeXmlEntities(m[2] ?? m[3] ?? "");
    attrs[m[1]] = val;
    const colon = m[1].indexOf(":");
    if (colon >= 0) {
      const shortKey = m[1].slice(colon + 1);
      if (!(shortKey in attrs)) attrs[shortKey] = val;
    }
  }
  return attrs;
}

function parseXml(xml: string): XmlNode {
  const root: XmlNode = { tag: "#root", local: "#root", attrs: {}, children: [] };
  const stack: XmlNode[] = [root];
  const len = xml.length;
  let i = 0;

  while (i < len) {
    const lt = xml.indexOf("<", i);
    if (lt < 0) {
      const tail = xml.slice(i);
      if (tail) stack[stack.length - 1].children.push(decodeXmlEntities(tail));
      break;
    }
    if (lt > i) {
      stack[stack.length - 1].children.push(decodeXmlEntities(xml.slice(i, lt)));
    }
    if (xml.startsWith("<!--", lt)) {
      const end = xml.indexOf("-->", lt + 4);
      i = end < 0 ? len : end + 3;
      continue;
    }
    if (xml.startsWith("<![CDATA[", lt)) {
      const end = xml.indexOf("]]>", lt + 9);
      if (end < 0) {
        stack[stack.length - 1].children.push(xml.slice(lt + 9));
        break;
      }
      stack[stack.length - 1].children.push(xml.slice(lt + 9, end));
      i = end + 3;
      continue;
    }
    if (xml.startsWith("<?", lt) || xml.startsWith("<!", lt)) {
      const end = xml.indexOf(">", lt + 2);
      i = end < 0 ? len : end + 1;
      continue;
    }
    // Find tag close while respecting quoted attributes containing >
    let j = lt + 1;
    let quote = "";
    while (j < len) {
      const ch = xml[j];
      if (quote) {
        if (ch === quote) quote = "";
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === ">") {
        break;
      }
      j++;
    }
    if (j >= len) break;
    const rawTag = xml.slice(lt + 1, j).trim();
    i = j + 1;
    if (!rawTag) continue;

    if (rawTag.startsWith("/")) {
      const closeName = rawTag.slice(1).trim();
      for (let k = stack.length - 1; k >= 1; k--) {
        if (stack[k].tag === closeName || stack[k].local === closeName.split(":").pop()) {
          stack.length = k;
          break;
        }
      }
      continue;
    }

    const selfClosing = rawTag.endsWith("/");
    const body = selfClosing ? rawTag.slice(0, -1).trimEnd() : rawTag;
    const sp = body.search(/\s/);
    const tag = sp < 0 ? body : body.slice(0, sp);
    const local = tag.includes(":") ? tag.slice(tag.indexOf(":") + 1) : tag;
    const attrs = sp < 0 ? {} : parseXmlAttrs(body.slice(sp + 1));
    const node: XmlNode = { tag, local, attrs, children: [] };
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
  }
  return root;
}

function xmlElements(node: XmlNode): XmlNode[] {
  return node.children.filter((c): c is XmlNode => typeof c !== "string");
}

function findFirst(node: XmlNode, local: string): XmlNode | undefined {
  for (const child of node.children) {
    if (typeof child === "string") continue;
    if (child.local === local || child.tag === local) return child;
    const nested = findFirst(child, local);
    if (nested) return nested;
  }
  return undefined;
}

function findAll(node: XmlNode, local: string, out: XmlNode[] = []): XmlNode[] {
  for (const child of node.children) {
    if (typeof child === "string") continue;
    if (child.local === local || child.tag === local) out.push(child);
    findAll(child, local, out);
  }
  return out;
}

function nodeText(node: XmlNode): string {
  let out = "";
  for (const child of node.children) {
    if (typeof child === "string") out += child;
    else if (child.local === "br" || child.local === "cr") out += "\n";
    else if (child.local === "tab") out += "\t";
    else out += nodeText(child);
  }
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
  }
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function mimeForExt(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".bmp")) return "image/bmp";
  return "application/octet-stream";
}

function isOle2Binary(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 8 &&
    bytes[0] === 0xd0 &&
    bytes[1] === 0xcf &&
    bytes[2] === 0x11 &&
    bytes[3] === 0xe0 &&
    bytes[4] === 0xa1 &&
    bytes[5] === 0xb1 &&
    bytes[6] === 0x1a &&
    bytes[7] === 0xe1
  );
}

function isZipHeader(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05);
}

function resolveZipPath(baseFile: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = baseFile.split("/").slice(0, -1);
  for (const seg of target.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}

function normalizeZipMap(files: Record<string, Uint8Array>): Map<string, Uint8Array> {
  const map = new Map<string, Uint8Array>();
  for (const [k, v] of Object.entries(files)) {
    map.set(k.replace(/^\/+/, "").toLowerCase(), v);
  }
  return map;
}

function readZipText(map: Map<string, Uint8Array>, path: string): string | null {
  const bytes = map.get(path.replace(/^\/+/, "").toLowerCase());
  return bytes ? utf8Dec.decode(bytes) : null;
}

function parseRels(xml: string | null): Map<string, { target: string; external: boolean }> {
  const rels = new Map<string, { target: string; external: boolean }>();
  if (!xml) return rels;
  const doc = parseXml(xml);
  for (const rel of findAll(doc, "Relationship")) {
    const id = rel.attrs.Id;
    const target = rel.attrs.Target;
    if (id && target) {
      rels.set(id, { target, external: (rel.attrs.TargetMode ?? "").toLowerCase() === "external" });
    }
  }
  return rels;
}

function colLettersToIndex(ref: string): { row: number; col: number } {
  const m = /^([A-Za-z]+)(\d+)$/.exec(ref.trim());
  if (!m) return { row: -1, col: -1 };
  let col = 0;
  const letters = m[1].toUpperCase();
  for (let i = 0; i < letters.length; i++) {
    col = col * 26 + (letters.charCodeAt(i) - 64);
  }
  return { row: Number(m[2]) - 1, col: col - 1 };
}

export function indexToColLetters(idx: number): string {
  let n = idx;
  let out = "";
  while (n >= 0) {
    out = String.fromCharCode((n % 26) + 65) + out;
    n = Math.floor(n / 26) - 1;
  }
  return out;
}

/* ========================================================================
 * 1. SPREADSHEET PARSER (XLSX, XLSM, ODS, XLS XML/HTML, CSV, TSV)
 * ======================================================================== */

export type SpreadsheetSheet = {
  name: string;
  rows: string[][];
  colCount: number;
  formulas: Record<string, string>;
  merges: string[];
};

export type SpreadsheetDoc = {
  kind: "spreadsheet";
  format: "XLSX" | "ODS" | "CSV" | "TSV" | "XLS XML" | "XLS HTML";
  fileName: string;
  sheets: SpreadsheetSheet[];
  delimiter?: string;
};

const EXCEL_DATE_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 36, 45, 46, 47, 50, 51, 57, 58]);

function looksLikeDateFormat(code: string): boolean {
  const cleaned = code.replace(/\[[^\]]*\]/g, "").replace(/"[^"]*"/g, "").toLowerCase();
  return /[yd]{2,}|m{1,4}[/-]|[:][ms]/.test(cleaned) && !/#|0\.00/.test(cleaned);
}

function formatExcelSerialDate(serial: number): string {
  if (!Number.isFinite(serial) || serial < 0 || serial > 2958465) return String(serial);
  // Excel 1900 date system includes phantom Feb 29 1900 for serial >= 60
  const adj = serial > 59 ? serial - 25569 : serial - 25568;
  const wholeDays = Math.floor(adj);
  const frac = serial - Math.floor(serial);
  if (serial < 1 && serial > 0) {
    const secs = Math.round(frac * 86400);
    const hh = String(Math.floor(secs / 3600)).padStart(2, "0");
    const mm = String(Math.floor((secs % 3600) / 60)).padStart(2, "0");
    return `${hh}:${mm}`;
  }
  const d = new Date(wholeDays * 86400 * 1000);
  if (Number.isNaN(d.getTime())) return String(serial);
  return d.toISOString().slice(0, 10);
}

function detectDelimiter(text: string, hintExt: string): string {
  if (hintExt === "tsv" || hintExt === "tab") return "\t";
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0).slice(0, 10);
  const candidates = [",", "\t", ";", "|"];
  let best = ",";
  let bestScore = -1;
  for (const delim of candidates) {
    const counts = lines.map((l) => parseCsvRows(l, delim)[0]?.length ?? 1);
    const cols = counts[0] ?? 1;
    if (cols <= 1) continue;
    const consistent = counts.filter((c) => c === cols).length;
    const score = cols * 10 + consistent * 5;
    if (score > bestScore) {
      bestScore = score;
      best = delim;
    }
  }
  return best;
}

export function parseSpreadsheetBytes(name: string, bytes: Uint8Array): SpreadsheetDoc {
  const lower = name.toLowerCase();
  const ext = lower.split(".").pop() ?? "";

  if (isOle2Binary(bytes)) {
    throw new Error(
      `Legacy binary .${ext || "xls"} (Excel 97–2003 OLE2) cannot be unpacked purely inside the browser. Use Excel to PDF or Convert Anything to convert it to .xlsx or .pdf first.`,
    );
  }

  // ZIP-based spreadsheets: .xlsx, .xlsm, .xltx, .ods
  if (isZipHeader(bytes)) {
    const map = normalizeZipMap(unzipSync(bytes));

    // OpenDocument Spreadsheet (.ods)
    if (ext === "ods" || map.has("content.xml")) {
      const content = readZipText(map, "content.xml");
      if (!content) throw new Error("Invalid .ods file: missing content.xml.");
      const doc = parseXml(content);
      const sheets: SpreadsheetSheet[] = [];
      for (const tbl of findAll(doc, "table")) {
        const sheetName = tbl.attrs.name || `Sheet ${sheets.length + 1}`;
        const rows: string[][] = [];
        const formulas: Record<string, string> = {};
        let maxCol = 0;
        const rowNodes = xmlElements(tbl).filter((n) => n.local === "table-row");
        for (const rNode of rowNodes) {
          if (rows.length >= 25_000) break;
          const rowRepeat = Math.min(20, Number(rNode.attrs["number-rows-repeated"] ?? 1) || 1);
          const vals: string[] = [];
          for (const cNode of xmlElements(rNode)) {
            if (cNode.local !== "table-cell" && cNode.local !== "covered-table-cell") continue;
            const colRepeat = Math.min(64, Number(cNode.attrs["number-columns-repeated"] ?? 1) || 1);
            const pTexts = findAll(cNode, "p").map((p) => nodeText(p)).filter(Boolean);
            const rawVal =
              pTexts.join("\n") ||
              cNode.attrs["date-value"] ||
              cNode.attrs.value ||
              "";
            const formula = cNode.attrs.formula;
            if (formula) {
              const coord = `${indexToColLetters(vals.length)}${rows.length + 1}`;
              formulas[coord] = formula.replace(/^of:/i, "");
            }
            // Skip massive trailing empty repeated cells
            if (!rawVal && colRepeat > 32) break;
            for (let k = 0; k < colRepeat && vals.length < 256; k++) vals.push(rawVal);
          }
          while (vals.length > 0 && vals[vals.length - 1] === "") vals.pop();
          if (vals.length === 0 && rowRepeat > 5) continue;
          maxCol = Math.max(maxCol, vals.length);
          for (let r = 0; r < rowRepeat && rows.length < 25_000; r++) {
            rows.push([...vals]);
          }
        }
        sheets.push({
          name: sheetName,
          rows: rows.map((r) => [...r, ...Array(Math.max(0, maxCol - r.length)).fill("")]),
          colCount: maxCol,
          formulas,
          merges: [],
        });
      }
      if (sheets.length === 0) throw new Error("No tables found inside .ods archive.");
      return { kind: "spreadsheet", format: "ODS", fileName: name, sheets };
    }

    // OOXML .xlsx / .xlsm
    const ssXml = readZipText(map, "xl/sharedstrings.xml");
    const sharedStrings: string[] = [];
    if (ssXml) {
      const ssDoc = parseXml(ssXml);
      for (const si of findAll(ssDoc, "si")) {
        const ts = findAll(si, "t");
        sharedStrings.push(ts.map((t) => nodeText(t)).join(""));
      }
    }

    const stylesXml = readZipText(map, "xl/styles.xml");
    const xfIsDate: boolean[] = [];
    if (stylesXml) {
      const stDoc = parseXml(stylesXml);
      const customFmts = new Map<number, string>();
      for (const nf of findAll(stDoc, "numFmt")) {
        const id = Number(nf.attrs.numFmtId);
        if (Number.isFinite(id) && nf.attrs.formatCode) customFmts.set(id, nf.attrs.formatCode);
      }
      const cellXfs = findFirst(stDoc, "cellXfs");
      if (cellXfs) {
        for (const xf of xmlElements(cellXfs)) {
          if (xf.local !== "xf") continue;
          const id = Number(xf.attrs.numFmtId ?? 0);
          const custom = customFmts.get(id);
          xfIsDate.push(EXCEL_DATE_IDS.has(id) || (custom ? looksLikeDateFormat(custom) : false));
        }
      }
    }

    const wbXml = readZipText(map, "xl/workbook.xml");
    const wbRels = parseRels(readZipText(map, "xl/_rels/workbook.xml.rels"));
    const sheetSpecs: { name: string; path: string }[] = [];
    if (wbXml) {
      const wbDoc = parseXml(wbXml);
      for (const sh of findAll(wbDoc, "sheet")) {
        const rid = sh.attrs.id || sh.attrs["r:id"];
        const rel = rid ? wbRels.get(rid) : undefined;
        if (rel && !rel.external) {
          sheetSpecs.push({
            name: sh.attrs.name || `Sheet ${sheetSpecs.length + 1}`,
            path: resolveZipPath("xl/workbook.xml", rel.target),
          });
        }
      }
    }
    if (sheetSpecs.length === 0) {
      const fallbackKeys = [...map.keys()]
        .filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(k))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      fallbackKeys.forEach((p, idx) => sheetSpecs.push({ name: `Sheet ${idx + 1}`, path: p }));
    }
    if (sheetSpecs.length === 0) {
      throw new Error("Could not locate any worksheets inside this spreadsheet archive.");
    }

    const sheets: SpreadsheetSheet[] = [];
    for (const spec of sheetSpecs) {
      const wsXml = readZipText(map, spec.path);
      if (!wsXml) continue;
      const wsDoc = parseXml(wsXml);
      const formulas: Record<string, string> = {};
      const merges = findAll(wsDoc, "mergeCell")
        .map((m) => m.attrs.ref)
        .filter(Boolean);
      const sparseRows = new Map<number, Map<number, string>>();
      let maxRow = 0;
      let maxCol = 0;
      let seqRow = 0;

      for (const rNode of findAll(wsDoc, "row")) {
        const rNumAttr = Number(rNode.attrs.r);
        const rIdx = Number.isFinite(rNumAttr) && rNumAttr > 0 ? rNumAttr - 1 : seqRow;
        seqRow = rIdx + 1;
        if (rIdx >= 25_000) break;
        const rowMap = sparseRows.get(rIdx) ?? new Map<number, string>();
        let seqCol = 0;

        for (const cNode of xmlElements(rNode)) {
          if (cNode.local !== "c") continue;
          const ref = cNode.attrs.r;
          const parsedCoord = ref ? colLettersToIndex(ref) : { row: rIdx, col: -1 };
          const cIdx = parsedCoord.col >= 0 ? parsedCoord.col : seqCol;
          seqCol = cIdx + 1;
          if (cIdx >= 256) continue;

          const fNode = findFirst(cNode, "f");
          if (fNode) {
            const fExpr = nodeText(fNode).trim();
            if (fExpr) formulas[ref || `${indexToColLetters(cIdx)}${rIdx + 1}`] = `=${fExpr}`;
          }

          const cellType = cNode.attrs.t ?? "n";
          const styleIdx = Number(cNode.attrs.s ?? -1);
          const vNode = findFirst(cNode, "v");
          const rawV = vNode ? nodeText(vNode) : "";
          let display = "";

          if (cellType === "s") {
            const idx = Number.parseInt(rawV, 10);
            display = Number.isFinite(idx) ? (sharedStrings[idx] ?? "") : "";
          } else if (cellType === "inlineStr") {
            const isNode = findFirst(cNode, "is");
            display = isNode ? nodeText(isNode) : "";
          } else if (cellType === "b") {
            display = rawV === "1" ? "TRUE" : "FALSE";
          } else if (cellType === "str" || cellType === "e") {
            display = rawV;
          } else if (rawV !== "") {
            const num = Number(rawV);
            if (Number.isFinite(num) && styleIdx >= 0 && xfIsDate[styleIdx]) {
              display = formatExcelSerialDate(num);
            } else {
              display = rawV;
            }
          }

          if (display !== "" || fNode) {
            rowMap.set(cIdx, display);
            maxRow = Math.max(maxRow, rIdx + 1);
            maxCol = Math.max(maxCol, cIdx + 1);
          }
        }
        sparseRows.set(rIdx, rowMap);
      }

      const rowCount = Math.max(1, maxRow);
      const colCount = Math.max(1, maxCol);
      const rows: string[][] = Array.from({ length: rowCount }, (_, r) => {
        const rm = sparseRows.get(r);
        return Array.from({ length: colCount }, (_, c) => rm?.get(c) ?? "");
      });
      sheets.push({ name: spec.name, rows, colCount, formulas, merges });
    }
    return { kind: "spreadsheet", format: "XLSX", fileName: name, sheets };
  }

  // Text / XML Spreadsheet 2003 / HTML Table .xls / CSV / TSV
  const text = utf8Dec.decode(bytes).replace(/^\ufeff/, "");
  const trimmed = text.trimStart();

  if (trimmed.startsWith("<?xml") && /<Workbook\b/i.test(text)) {
    const doc = parseXml(text);
    const sheets: SpreadsheetSheet[] = [];
    for (const ws of findAll(doc, "Worksheet")) {
      const sheetName = ws.attrs.Name || `Sheet ${sheets.length + 1}`;
      const rows: string[][] = [];
      let maxCol = 0;
      for (const rNode of findAll(ws, "Row")) {
        const vals: string[] = [];
        for (const cNode of xmlElements(rNode)) {
          if (cNode.local !== "Cell") continue;
          const idxAttr = Number(cNode.attrs.Index);
          if (Number.isFinite(idxAttr) && idxAttr > 0) {
            while (vals.length < idxAttr - 1) vals.push("");
          }
          const dataNode = findFirst(cNode, "Data");
          vals.push(dataNode ? nodeText(dataNode) : nodeText(cNode));
        }
        maxCol = Math.max(maxCol, vals.length);
        rows.push(vals);
      }
      sheets.push({
        name: sheetName,
        rows: rows.map((r) => [...r, ...Array(Math.max(0, maxCol - r.length)).fill("")]),
        colCount: Math.max(1, maxCol),
        formulas: {},
        merges: [],
      });
    }
    if (sheets.length > 0) return { kind: "spreadsheet", format: "XLS XML", fileName: name, sheets };
  }

  if (/<table\b/i.test(text) && /<t[dh]\b/i.test(text)) {
    const doc = parseXml(text);
    const sheets: SpreadsheetSheet[] = [];
    findAll(doc, "table").forEach((tbl, idx) => {
      const rows = findAll(tbl, "tr").map((tr) =>
        xmlElements(tr)
          .filter((c) => c.local === "td" || c.local === "th")
          .map((c) => nodeText(c).trim()),
      );
      const maxCol = rows.reduce((m, r) => Math.max(m, r.length), 1);
      if (rows.length > 0) {
        sheets.push({
          name: `Sheet ${idx + 1}`,
          rows: rows.map((r) => [...r, ...Array(maxCol - r.length).fill("")]),
          colCount: maxCol,
          formulas: {},
          merges: [],
        });
      }
    });
    if (sheets.length > 0) return { kind: "spreadsheet", format: "XLS HTML", fileName: name, sheets };
  }

  const delimiter = detectDelimiter(text, ext);
  const parsed = parseCsvRows(text, delimiter);
  const maxCol = parsed.reduce((m, r) => Math.max(m, r.length), 1);
  const rows = parsed.map((r) => [...r, ...Array(maxCol - r.length).fill("")]);
  return {
    kind: "spreadsheet",
    format: delimiter === "\t" ? "TSV" : "CSV",
    fileName: name,
    delimiter,
    sheets: [{ name: name.replace(/\.[^.]+$/, "") || "Sheet 1", rows, colCount: maxCol, formulas: {}, merges: [] }],
  };
}

/* ========================================================================
 * 2. WORD & DOCUMENT PARSER (DOCX, DOCM, ODT, RTF, TXT/MD)
 * ======================================================================== */

export type DocRun = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  code?: boolean;
  color?: string;
  href?: string;
  image?: { dataUrl: string; alt?: string };
};

export type DocBlock =
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; text: string; id: string }
  | { type: "paragraph"; runs: DocRun[]; align?: string; quote?: boolean }
  | { type: "list-item"; runs: DocRun[]; level: number }
  | { type: "table"; rows: { text: string; colSpan?: number }[][] }
  | { type: "image"; dataUrl: string; alt?: string };

export type WordDoc = {
  kind: "word";
  format: "DOCX" | "ODT" | "RTF" | "TEXT";
  fileName: string;
  title?: string;
  author?: string;
  modified?: string;
  blocks: DocBlock[];
  outline: { id: string; level: number; text: string }[];
  stats: { words: number; chars: number; paragraphs: number; tables: number; images: number; readingMinutes: number };
};

function parseRtfToBlocks(rawRtf: string): DocBlock[] {
  const skipGroups = new Set(["fonttbl", "colortbl", "stylesheet", "info", "pict", "object", "header", "footer", "fldinst", "headerl", "headerr", "footerl", "footerr"]);
  const stack: { skip: boolean; uc: number }[] = [{ skip: false, uc: 1 }];
  let out = "";
  let i = 0;
  let skipNextChars = 0;

  while (i < rawRtf.length) {
    const ch = rawRtf[i];
    if (ch === "{") {
      const top = stack[stack.length - 1];
      stack.push({ skip: top.skip, uc: top.uc });
      i++;
      continue;
    }
    if (ch === "}") {
      if (stack.length > 1) stack.pop();
      skipNextChars = 0;
      i++;
      continue;
    }
    const cur = stack[stack.length - 1];
    if (ch === "\r" || ch === "\n") {
      i++;
      continue;
    }
    if (ch === "\\") {
      i++;
      const next = rawRtf[i];
      if (!next) break;
      if (next === "\\" || next === "{" || next === "}") {
        if (!cur.skip && skipNextChars === 0) out += next;
        if (skipNextChars > 0) skipNextChars--;
        i++;
        continue;
      }
      if (next === "*") {
        cur.skip = true;
        i++;
        continue;
      }
      if (next === "~") {
        if (!cur.skip) out += " ";
        i++;
        continue;
      }
      if (next === "-") {
        i++;
        continue;
      }
      if (next === "'") {
        const hex = rawRtf.slice(i + 1, i + 3);
        const code = Number.parseInt(hex, 16);
        if (!cur.skip && Number.isFinite(code)) {
          // Common Windows-1252 smart quotes / dashes
          const win1252: Record<number, string> = { 0x91: "‘", 0x92: "’", 0x93: "“", 0x94: "”", 0x96: "–", 0x97: "—" };
          out += win1252[code] ?? String.fromCharCode(code);
        }
        i += 3;
        continue;
      }
      const ctrlMatch = /^([a-zA-Z]+)(-?\d+)? ?/.exec(rawRtf.slice(i));
      if (!ctrlMatch) {
        i++;
        continue;
      }
      const word = ctrlMatch[1];
      const param = ctrlMatch[2] !== undefined ? Number(ctrlMatch[2]) : undefined;
      i += ctrlMatch[0].length;
      if (skipGroups.has(word)) {
        cur.skip = true;
        continue;
      }
      if (word === "uc" && param !== undefined) {
        cur.uc = Math.max(0, param);
        continue;
      }
      if (cur.skip) continue;
      if (word === "par" || word === "line") out += "\n";
      else if (word === "tab") out += "\t";
      else if (word === "emdash") out += "—";
      else if (word === "endash") out += "–";
      else if (word === "bullet") out += "• ";
      else if (word === "lquote") out += "‘";
      else if (word === "rquote") out += "’";
      else if (word === "ldblquote") out += "“";
      else if (word === "rdblquote") out += "”";
      else if (word === "u" && param !== undefined) {
        const code = param < 0 ? param + 65536 : param;
        out += String.fromCodePoint(code);
        skipNextChars = cur.uc;
      }
      continue;
    }
    if (!cur.skip) {
      if (skipNextChars > 0) skipNextChars--;
      else out += ch;
    }
    i++;
  }

  return out
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({ type: "paragraph" as const, runs: [{ text: line }] }));
}

function summarizeBlocks(blocks: DocBlock[]): WordDoc["stats"] {
  let textAll = "";
  let paragraphs = 0;
  let tables = 0;
  let images = 0;
  for (const b of blocks) {
    if (b.type === "heading") {
      textAll += " " + b.text;
      paragraphs++;
    } else if (b.type === "paragraph" || b.type === "list-item") {
      paragraphs++;
      for (const r of b.runs) {
        if (r.text) textAll += " " + r.text;
        if (r.image) images++;
      }
    } else if (b.type === "table") {
      tables++;
      for (const row of b.rows) {
        for (const cell of row) textAll += " " + cell.text;
      }
    } else if (b.type === "image") {
      images++;
    }
  }
  const clean = textAll.trim();
  const words = clean ? clean.split(/\s+/).length : 0;
  return {
    words,
    chars: clean.length,
    paragraphs,
    tables,
    images,
    readingMinutes: Math.max(1, Math.ceil(words / 225)),
  };
}

export function parseWordBytes(name: string, bytes: Uint8Array): WordDoc {
  const lower = name.toLowerCase();
  const ext = lower.split(".").pop() ?? "";

  if (isOle2Binary(bytes)) {
    throw new Error(
      `Legacy binary .${ext || "doc"} (Word 97–2003 OLE2) cannot be decoded purely in the browser. Use Word to PDF or Convert Anything to convert it to .docx or .pdf first.`,
    );
  }

  if (isZipHeader(bytes)) {
    const map = normalizeZipMap(unzipSync(bytes));

    // ODT
    if (ext === "odt" || (!map.has("word/document.xml") && map.has("content.xml"))) {
      const content = readZipText(map, "content.xml");
      if (!content) throw new Error("Invalid .odt file: missing content.xml.");
      const meta = readZipText(map, "meta.xml");
      const metaDoc = meta ? parseXml(meta) : null;
      const title = metaDoc ? nodeText(findFirst(metaDoc, "title") ?? { tag: "", local: "", attrs: {}, children: [] }).trim() : "";
      const author = metaDoc ? nodeText(findFirst(metaDoc, "creator") ?? { tag: "", local: "", attrs: {}, children: [] }).trim() : "";

      const doc = parseXml(content);
      const officeText = findFirst(doc, "text") ?? doc;
      const blocks: DocBlock[] = [];
      const outline: WordDoc["outline"] = [];
      let hIdx = 0;

      const walkOdt = (parent: XmlNode) => {
        for (const el of xmlElements(parent)) {
          if (el.local === "h") {
            const text = nodeText(el).trim();
            if (!text) continue;
            const lvl = Math.max(1, Math.min(6, Number(el.attrs["outline-level"] ?? 1) || 1)) as 1 | 2 | 3 | 4 | 5 | 6;
            const id = `h-${++hIdx}`;
            blocks.push({ type: "heading", level: lvl, text, id });
            outline.push({ id, level: lvl, text });
          } else if (el.local === "p") {
            const imgNode = findFirst(el, "image");
            if (imgNode?.attrs.href) {
              const rawImg = map.get(imgNode.attrs.href.toLowerCase());
              if (rawImg && rawImg.length <= 5 * 1024 * 1024) {
                blocks.push({ type: "image", dataUrl: `data:${mimeForExt(imgNode.attrs.href)};base64,${bytesToBase64(rawImg)}`, alt: imgNode.attrs.href });
              }
            }
            const t = nodeText(el).trim();
            if (t) blocks.push({ type: "paragraph", runs: [{ text: t }] });
          } else if (el.local === "list") {
            for (const li of findAll(el, "list-item")) {
              const t = nodeText(li).trim();
              if (t) blocks.push({ type: "list-item", runs: [{ text: t }], level: 0 });
            }
          } else if (el.local === "table") {
            const rows = findAll(el, "table-row").map((tr) =>
              xmlElements(tr)
                .filter((c) => c.local === "table-cell")
                .map((c) => ({ text: nodeText(c).trim() })),
            );
            if (rows.length > 0) blocks.push({ type: "table", rows });
          } else {
            walkOdt(el);
          }
        }
      };
      walkOdt(officeText);
      return {
        kind: "word",
        format: "ODT",
        fileName: name,
        title: title || undefined,
        author: author || undefined,
        blocks,
        outline,
        stats: summarizeBlocks(blocks),
      };
    }

    // DOCX
    const docXml = readZipText(map, "word/document.xml");
    if (!docXml) throw new Error("Invalid .docx archive: missing word/document.xml.");
    const rels = parseRels(readZipText(map, "word/_rels/document.xml.rels"));

    // Embedded media map
    const mediaDataUrls = new Map<string, string>();
    for (const [k, v] of map.entries()) {
      if (k.startsWith("word/media/") && v.length <= 5 * 1024 * 1024) {
        mediaDataUrls.set(k, `data:${mimeForExt(k)};base64,${bytesToBase64(v)}`);
      }
    }

    // Core properties
    const coreXml = readZipText(map, "docProps/core.xml");
    const coreDoc = coreXml ? parseXml(coreXml) : null;
    const title = coreDoc ? nodeText(findFirst(coreDoc, "title") ?? { tag: "", local: "", attrs: {}, children: [] }).trim() : "";
    const author = coreDoc ? nodeText(findFirst(coreDoc, "creator") ?? { tag: "", local: "", attrs: {}, children: [] }).trim() : "";
    const modified = coreDoc ? nodeText(findFirst(coreDoc, "modified") ?? { tag: "", local: "", attrs: {}, children: [] }).trim() : "";

    // Style heading lookup
    const styleHeading = new Map<string, 1 | 2 | 3 | 4 | 5 | 6>();
    const styleNames = new Map<string, string>();
    const stylesXml = readZipText(map, "word/styles.xml");
    if (stylesXml) {
      const stDoc = parseXml(stylesXml);
      for (const st of findAll(stDoc, "style")) {
        const sid = st.attrs.styleId;
        if (!sid) continue;
        const nameNode = findFirst(st, "name");
        const sName = (nameNode?.attrs.val ?? sid).toLowerCase();
        styleNames.set(sid, sName);
        const outlineNode = findFirst(st, "outlineLvl");
        if (outlineNode?.attrs.val !== undefined) {
          const lvl = Math.min(6, Math.max(1, Number(outlineNode.attrs.val) + 1)) as 1 | 2 | 3 | 4 | 5 | 6;
          styleHeading.set(sid, lvl);
        } else if (sName === "title") {
          styleHeading.set(sid, 1);
        } else if (/heading\s*([1-6])/.test(sName)) {
          styleHeading.set(sid, Number(/heading\s*([1-6])/.exec(sName)![1]) as 1 | 2 | 3 | 4 | 5 | 6);
        }
      }
    }

    const extractRuns = (container: XmlNode, href?: string): DocRun[] => {
      const runs: DocRun[] = [];
      for (const child of xmlElements(container)) {
        if (child.local === "hyperlink") {
          const rid = child.attrs.id || child.attrs["r:id"];
          const rel = rid ? rels.get(rid) : undefined;
          const linkUrl = rel?.external ? rel.target : undefined;
          runs.push(...extractRuns(child, linkUrl));
          continue;
        }
        if (child.local === "ins") {
          runs.push(...extractRuns(child, href));
          continue;
        }
        if (child.local !== "r") continue;

        // Check embedded image
        const blip = findFirst(child, "blip");
        const embedId = blip?.attrs.embed || blip?.attrs["r:embed"];
        if (embedId) {
          const rel = rels.get(embedId);
          if (rel && !rel.external) {
            const targetPath = resolveZipPath("word/document.xml", rel.target).toLowerCase();
            const dataUrl = mediaDataUrls.get(targetPath);
            const docPr = findFirst(child, "docPr");
            if (dataUrl) runs.push({ text: "", image: { dataUrl, alt: docPr?.attrs.descr || docPr?.attrs.name } });
          }
        }

        const rPr = findFirst(child, "rPr");
        const hasFlag = (tag: string) => {
          const n = rPr ? findFirst(rPr, tag) : undefined;
          if (!n) return false;
          const v = (n.attrs.val ?? "").toLowerCase();
          return v !== "0" && v !== "false" && v !== "none";
        };
        const rFonts = rPr ? findFirst(rPr, "rFonts") : undefined;
        const fontName = (rFonts?.attrs.ascii ?? rFonts?.attrs.hAnsi ?? "").toLowerCase();
        const isMono = /consolas|courier|mono|fira|jetbrains|menlo/.test(fontName);
        const colorNode = rPr ? findFirst(rPr, "color") : undefined;
        const rawColor = colorNode?.attrs.val;
        const color = rawColor && /^[0-9a-fA-F]{6}$/.test(rawColor) && rawColor.toLowerCase() !== "000000" ? `#${rawColor}` : undefined;

        let txt = "";
        for (const rn of xmlElements(child)) {
          if (rn.local === "t" || rn.local === "delText") txt += nodeText(rn);
          else if (rn.local === "tab") txt += "\t";
          else if (rn.local === "br" || rn.local === "cr") txt += "\n";
        }
        if (txt) {
          runs.push({
            text: txt,
            bold: hasFlag("b"),
            italic: hasFlag("i"),
            underline: hasFlag("u"),
            strike: hasFlag("strike"),
            code: isMono,
            color,
            href,
          });
        }
      }
      return runs;
    };

    const doc = parseXml(docXml);
    const body = findFirst(doc, "body") ?? doc;
    const blocks: DocBlock[] = [];
    const outline: WordDoc["outline"] = [];
    let hCount = 0;

    for (const el of xmlElements(body)) {
      if (el.local === "p") {
        const pPr = findFirst(el, "pPr");
        const pStyleId = pPr ? findFirst(pPr, "pStyle")?.attrs.val : undefined;
        const numPr = pPr ? findFirst(pPr, "numPr") : undefined;
        const ilvl = numPr ? Number(findFirst(numPr, "ilvl")?.attrs.val ?? 0) : 0;
        const jc = pPr ? findFirst(pPr, "jc")?.attrs.val : undefined;

        const runs = extractRuns(el);
        const textOnly = runs.map((r) => r.text).join("").trim();
        const onlyImages = runs.filter((r) => r.image && !r.text);

        if (runs.length === 0) continue;

        for (const im of onlyImages) {
          if (im.image) blocks.push({ type: "image", dataUrl: im.image.dataUrl, alt: im.image.alt });
        }
        if (!textOnly) continue;

        let hLevel = pStyleId ? styleHeading.get(pStyleId) : undefined;
        if (!hLevel && pStyleId) {
          const m = /^(?:Heading|Titre|Overskrift)([1-6])$/i.exec(pStyleId);
          if (m) hLevel = Number(m[1]) as 1 | 2 | 3 | 4 | 5 | 6;
          else if (/^Title$/i.test(pStyleId)) hLevel = 1;
        }

        if (hLevel) {
          const id = `h-${++hCount}`;
          blocks.push({ type: "heading", level: hLevel, text: textOnly, id });
          outline.push({ id, level: hLevel, text: textOnly });
        } else if (numPr) {
          blocks.push({ type: "list-item", runs: runs.filter((r) => !r.image), level: Math.min(4, Math.max(0, ilvl)) });
        } else {
          const sLower = pStyleId ? (styleNames.get(pStyleId) ?? pStyleId).toLowerCase() : "";
          blocks.push({
            type: "paragraph",
            runs: runs.filter((r) => !r.image),
            align: jc,
            quote: /quote/.test(sLower),
          });
        }
      } else if (el.local === "tbl") {
        const rows = xmlElements(el)
          .filter((n) => n.local === "tr")
          .map((tr) =>
            xmlElements(tr)
              .filter((c) => c.local === "tc")
              .map((tc) => {
                const tcPr = findFirst(tc, "tcPr");
                const span = tcPr ? Number(findFirst(tcPr, "gridSpan")?.attrs.val ?? 1) : 1;
                const cellText = xmlElements(tc)
                  .filter((p) => p.local === "p")
                  .map((p) => extractRuns(p).map((r) => r.text).join(""))
                  .join("\n")
                  .trim();
                return { text: cellText, colSpan: span > 1 ? span : undefined };
              }),
          );
        if (rows.length > 0) blocks.push({ type: "table", rows });
      }
    }

    return {
      kind: "word",
      format: "DOCX",
      fileName: name,
      title: title || undefined,
      author: author || undefined,
      modified: modified || undefined,
      blocks,
      outline,
      stats: summarizeBlocks(blocks),
    };
  }

  // RTF or plain text / Markdown
  const text = utf8Dec.decode(bytes);
  if (ext === "rtf" || text.trimStart().startsWith("{\\rtf")) {
    const blocks = parseRtfToBlocks(text);
    return { kind: "word", format: "RTF", fileName: name, blocks, outline: [], stats: summarizeBlocks(blocks) };
  }

  const blocks: DocBlock[] = [];
  const outline: WordDoc["outline"] = [];
  let hIdx = 0;
  for (const para of text.replace(/\r\n/g, "\n").split(/\n{2,}/)) {
    const t = para.trim();
    if (!t) continue;
    const hm = /^(#{1,6})\s+(.+)$/.exec(t);
    if (hm) {
      const level = hm[1].length as 1 | 2 | 3 | 4 | 5 | 6;
      const id = `h-${++hIdx}`;
      blocks.push({ type: "heading", level, text: hm[2].trim(), id });
      outline.push({ id, level, text: hm[2].trim() });
    } else {
      blocks.push({ type: "paragraph", runs: [{ text: t }] });
    }
  }
  return { kind: "word", format: "TEXT", fileName: name, blocks, outline, stats: summarizeBlocks(blocks) };
}

/* ========================================================================
 * 3. POWERPOINT & PRESENTATION PARSER (PPTX, PPSX, PPTM, ODP)
 * ======================================================================== */

export type SlideBox = {
  kind: "text" | "image";
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
  textLines?: { text: string; isTitle?: boolean; level: number }[];
  dataUrl?: string;
  fillColor?: string;
};

export type SlideInfo = {
  index: number;
  title: string;
  subtitle?: string;
  bullets: { text: string; level: number }[];
  tables: string[][][];
  images: { dataUrl: string; alt?: string }[];
  boxes: SlideBox[];
  notes: string;
};

export type PresentationDoc = {
  kind: "presentation";
  format: "PPTX" | "ODP";
  fileName: string;
  title?: string;
  author?: string;
  aspectRatio: number;
  slides: SlideInfo[];
};

export function parsePresentationBytes(name: string, bytes: Uint8Array): PresentationDoc {
  const lower = name.toLowerCase();
  const ext = lower.split(".").pop() ?? "";

  if (isOle2Binary(bytes)) {
    throw new Error(
      `Legacy binary .${ext || "ppt"} (PowerPoint 97–2003 OLE2) cannot be read purely in the browser. Convert it to .pptx or .pdf with PowerPoint to PDF or Convert Anything first.`,
    );
  }
  if (!isZipHeader(bytes)) {
    throw new Error("Unsupported presentation file (expected a .pptx, .ppsx or .odp archive).");
  }

  const map = normalizeZipMap(unzipSync(bytes));

  // ODP
  if (ext === "odp" || (!map.has("ppt/presentation.xml") && map.has("content.xml"))) {
    const content = readZipText(map, "content.xml");
    if (!content) throw new Error("Invalid .odp archive: missing content.xml.");
    const doc = parseXml(content);
    const slides: SlideInfo[] = [];
    findAll(doc, "page").forEach((pg, idx) => {
      const bullets: { text: string; level: number }[] = [];
      const images: { dataUrl: string; alt?: string }[] = [];
      const tables: string[][][] = [];
      let title = "";

      for (const fr of xmlElements(pg)) {
        if (fr.local === "frame") {
          const pClass = (fr.attrs.class ?? "").toLowerCase();
          const ps = findAll(fr, "p").map((p) => nodeText(p).trim()).filter(Boolean);
          if (pClass === "title" && ps.length > 0 && !title) {
            title = ps[0];
          } else {
            for (const p of ps) bullets.push({ text: p, level: 0 });
          }
          const im = findFirst(fr, "image");
          if (im?.attrs.href) {
            const raw = map.get(im.attrs.href.toLowerCase());
            if (raw && raw.length <= 5 * 1024 * 1024) {
              images.push({ dataUrl: `data:${mimeForExt(im.attrs.href)};base64,${bytesToBase64(raw)}`, alt: im.attrs.href });
            }
          }
        } else if (fr.local === "table") {
          const tbl = findAll(fr, "table-row").map((tr) =>
            xmlElements(tr).filter((c) => c.local === "table-cell").map((c) => nodeText(c).trim()),
          );
          if (tbl.length > 0) tables.push(tbl);
        }
      }
      const notesNode = findFirst(pg, "notes");
      const notes = notesNode ? findAll(notesNode, "p").map((p) => nodeText(p).trim()).filter(Boolean).join("\n") : "";
      slides.push({
        index: idx + 1,
        title: title || bullets[0]?.text || `Slide ${idx + 1}`,
        bullets: title ? bullets : bullets.slice(1),
        tables,
        images,
        boxes: [],
        notes,
      });
    });
    if (slides.length === 0) throw new Error("No slides found in .odp presentation.");
    return { kind: "presentation", format: "ODP", fileName: name, aspectRatio: 16 / 9, slides };
  }

  // PPTX / PPSX / PPTM
  const presXml = readZipText(map, "ppt/presentation.xml");
  if (!presXml) throw new Error("Invalid .pptx archive: missing ppt/presentation.xml.");
  const presDoc = parseXml(presXml);
  const sldSz = findFirst(presDoc, "sldSz");
  const slideW = Number(sldSz?.attrs.cx ?? 12192000) || 12192000;
  const slideH = Number(sldSz?.attrs.cy ?? 6858000) || 6858000;
  const aspectRatio = slideW / slideH;

  const coreXml = readZipText(map, "docProps/core.xml");
  const coreDoc = coreXml ? parseXml(coreXml) : null;
  const deckTitle = coreDoc ? nodeText(findFirst(coreDoc, "title") ?? { tag: "", local: "", attrs: {}, children: [] }).trim() : "";
  const deckAuthor = coreDoc ? nodeText(findFirst(coreDoc, "creator") ?? { tag: "", local: "", attrs: {}, children: [] }).trim() : "";

  const presRels = parseRels(readZipText(map, "ppt/_rels/presentation.xml.rels"));
  let slidePaths: string[] = [];
  for (const sldId of findAll(presDoc, "sldId")) {
    const rid = sldId.attrs.id || sldId.attrs["r:id"];
    const rel = rid ? presRels.get(rid) : undefined;
    if (rel && !rel.external) {
      slidePaths.push(resolveZipPath("ppt/presentation.xml", rel.target));
    }
  }
  if (slidePaths.length === 0) {
    slidePaths = [...map.keys()]
      .filter((k) => /^ppt\/slides\/slide\d+\.xml$/i.test(k))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }
  if (slidePaths.length === 0) throw new Error("No slides found inside this presentation.");

  const readXfrm = (node: XmlNode) => {
    const xfrm = findFirst(node, "xfrm");
    const off = xfrm ? findFirst(xfrm, "off") : undefined;
    const ext = xfrm ? findFirst(xfrm, "ext") : undefined;
    const x = Number(off?.attrs.x ?? 0);
    const y = Number(off?.attrs.y ?? 0);
    const cx = Number(ext?.attrs.cx ?? 0);
    const cy = Number(ext?.attrs.cy ?? 0);
    if (!Number.isFinite(cx) || cx <= 0 || !Number.isFinite(cy) || cy <= 0) return null;
    return {
      xPct: Math.max(0, Math.min(95, (x / slideW) * 100)),
      yPct: Math.max(0, Math.min(95, (y / slideH) * 100)),
      wPct: Math.max(4, Math.min(100, (cx / slideW) * 100)),
      hPct: Math.max(4, Math.min(100, (cy / slideH) * 100)),
    };
  };

  const slides: SlideInfo[] = [];
  slidePaths.forEach((sPath, sIdx) => {
    const sXml = readZipText(map, sPath);
    if (!sXml) return;
    const sDoc = parseXml(sXml);
    const sFileName = sPath.split("/").pop()!;
    const relsPath = sPath.replace(/[^/]+$/, `_rels/${sFileName}.rels`);
    const sRels = parseRels(readZipText(map, relsPath));

    let notes = "";
    for (const r of sRels.values()) {
      if (!r.external && /notesslide/i.test(r.target)) {
        const nXml = readZipText(map, resolveZipPath(sPath, r.target));
        if (nXml) {
          const nDoc = parseXml(nXml);
          const nParas: string[] = [];
          for (const sp of findAll(nDoc, "sp")) {
            const ph = findFirst(sp, "ph");
            if (ph?.attrs.type === "sldNum") continue;
            for (const p of findAll(sp, "p")) {
              const t = findAll(p, "t").map((tn) => nodeText(tn)).join("").trim();
              if (t) nParas.push(t);
            }
          }
          notes = nParas.join("\n");
        }
      }
    }

    let title = "";
    let subtitle = "";
    const bullets: { text: string; level: number }[] = [];
    const tables: string[][][] = [];
    const images: { dataUrl: string; alt?: string }[] = [];
    const boxes: SlideBox[] = [];

    const spTree = findFirst(sDoc, "spTree") ?? sDoc;
    for (const el of xmlElements(spTree)) {
      if (el.local === "sp") {
        const ph = findFirst(el, "ph");
        const phType = (ph?.attrs.type ?? "").toLowerCase();
        if (phType === "sldnum" || phType === "dt" || phType === "ftr") continue;

        const spPr = findFirst(el, "spPr");
        const srgb = spPr ? findFirst(spPr, "srgbClr") : undefined;
        const fillHex = srgb?.attrs.val && /^[0-9a-fA-F]{6}$/.test(srgb.attrs.val) ? `#${srgb.attrs.val}` : undefined;

        const paras = findAll(el, "p");
        const boxLines: { text: string; isTitle?: boolean; level: number }[] = [];
        for (const p of paras) {
          const line = findAll(p, "t").map((tn) => nodeText(tn)).join("").trim();
          if (!line) continue;
          const pPr = findFirst(p, "pPr");
          const lvl = Math.min(4, Math.max(0, Number(pPr?.attrs.lvl ?? 0) || 0));
          if ((phType === "title" || phType === "ctrtitle") && !title) {
            title = line;
            boxLines.push({ text: line, isTitle: true, level: 0 });
          } else if (phType === "subtitle" && !subtitle) {
            subtitle = line;
            boxLines.push({ text: line, level: 0 });
          } else {
            bullets.push({ text: line, level: lvl });
            boxLines.push({ text: line, isTitle: phType === "title" || phType === "ctrtitle", level: lvl });
          }
        }
        const rect = readXfrm(el);
        if (rect && (boxLines.length > 0 || fillHex)) {
          boxes.push({ kind: "text", ...rect, textLines: boxLines, fillColor: fillHex });
        }
      } else if (el.local === "pic") {
        const blip = findFirst(el, "blip");
        const rid = blip?.attrs.embed || blip?.attrs["r:embed"];
        const rel = rid ? sRels.get(rid) : undefined;
        if (rel && !rel.external) {
          const mediaKey = resolveZipPath(sPath, rel.target).toLowerCase();
          const raw = map.get(mediaKey);
          if (raw && raw.length <= 5 * 1024 * 1024) {
            const dataUrl = `data:${mimeForExt(mediaKey)};base64,${bytesToBase64(raw)}`;
            const descr = findFirst(el, "cNvPr")?.attrs.descr || findFirst(el, "cNvPr")?.attrs.name;
            images.push({ dataUrl, alt: descr });
            const rect = readXfrm(el);
            if (rect) boxes.push({ kind: "image", ...rect, dataUrl });
          }
        }
      } else if (el.local === "graphicFrame") {
        for (const tblNode of findAll(el, "tbl")) {
          const rows = findAll(tblNode, "tr").map((tr) =>
            findAll(tr, "tc").map((tc) => findAll(tc, "t").map((t) => nodeText(t)).join("").trim()),
          );
          if (rows.length > 0) tables.push(rows);
        }
      }
    }

    slides.push({
      index: sIdx + 1,
      title: title || bullets[0]?.text || `Slide ${sIdx + 1}`,
      subtitle: subtitle || undefined,
      bullets: title ? bullets : bullets.slice(1),
      tables,
      images,
      boxes,
      notes,
    });
  });

  return {
    kind: "presentation",
    format: "PPTX",
    fileName: name,
    title: deckTitle || undefined,
    author: deckAuthor || undefined,
    aspectRatio,
    slides,
  };
}

/* ========================================================================
 * 4. PDF STRUCTURE & TEXT INSPECTOR (Pure-TS + FlateDecode via fflate)
 * ======================================================================== */

export type PdfDocInfo = {
  kind: "pdf";
  fileName: string;
  size: number;
  version: string;
  pageCount: number;
  encrypted: boolean;
  pageSizePt: [number, number] | null;
  title?: string;
  author?: string;
  subject?: string;
  creator?: string;
  producer?: string;
  fonts: string[];
  extractedText: string;
};

function decodePdfLiteral(raw: string): string {
  // Handle UTF-16BE BOM (\xfe\xff or \376\377) if present
  let s = raw
    .replace(/\\(\d{1,3})/g, (_, oct: string) => String.fromCharCode(Number.parseInt(oct, 8)))
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")")
    .replace(/\\\\/g, "\\");
  if (s.charCodeAt(0) === 0xfe && s.charCodeAt(1) === 0xff) {
    let u16 = "";
    for (let i = 2; i + 1 < s.length; i += 2) {
      u16 += String.fromCharCode((s.charCodeAt(i) << 8) | s.charCodeAt(i + 1));
    }
    s = u16;
  }
  return s.trim();
}

function extractPdfStreamText(streamText: string): string[] {
  const chunks: string[] = [];
  // Simple Tj: (text) Tj
  const tjRe = /\(([^()\\]*(?:\\.[^()\\]*)*)\)\s*Tj/g;
  let m: RegExpExecArray | null;
  while ((m = tjRe.exec(streamText)) !== null) {
    chunks.push(decodePdfLiteral(m[1]));
  }
  // TJ array: [(text1) -10 (text2)] TJ
  const arrRe = /\[([^\]]+)\]\s*TJ/g;
  while ((m = arrRe.exec(streamText)) !== null) {
    const parts: string[] = [];
    const inner = /\(([^()\\]*(?:\\.[^()\\]*)*)\)/g;
    let im: RegExpExecArray | null;
    while ((im = inner.exec(m[1])) !== null) parts.push(decodePdfLiteral(im[1]));
    if (parts.length > 0) chunks.push(parts.join(" "));
  }
  return chunks;
}

export function inspectPdfBytes(name: string, bytes: Uint8Array): PdfDocInfo {
  const latin1 = new TextDecoder("latin1").decode(bytes);
  if (!latin1.startsWith("%PDF-")) {
    throw new Error("Not a valid PDF file (missing %PDF- header).");
  }
  const version = /^%PDF-(\d\.\d)/.exec(latin1)?.[1] ?? "1.4";
  const encrypted = /\/Encrypt\b/.test(latin1);

  const pageMatches = latin1.match(/\/Type\s*\/Page\b(?!s)/g) ?? [];
  const pageCount = Math.max(1, pageMatches.length);

  let pageSizePt: [number, number] | null = null;
  const mb = /\/MediaBox\s*\[\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\]/.exec(latin1);
  if (mb) {
    const w = Math.abs(Number(mb[3]) - Number(mb[1]));
    const h = Math.abs(Number(mb[4]) - Number(mb[2]));
    if (w > 0 && h > 0) pageSizePt = [Math.round(w), Math.round(h)];
  }

  const readInfo = (key: string): string | undefined => {
    const re = new RegExp(`\\/${key}\\s*\\(([^()\\\\]*(?:\\\\.[^()\\\\]*)*)\\)`);
    const m = re.exec(latin1);
    return m ? decodePdfLiteral(m[1]) || undefined : undefined;
  };

  const fontSet = new Set<string>();
  const fontRe = /\/BaseFont\s*\/([A-Za-z0-9_+.-]+)/g;
  let fm: RegExpExecArray | null;
  while ((fm = fontRe.exec(latin1)) !== null) {
    fontSet.add(fm[1].replace(/^[A-Z]{6}\+/, ""));
  }

  // Extract readable text from uncompressed and FlateDecode streams
  const textRuns: string[] = [];
  const streamRe = /(<<[\s\S]{0,600}?>>)\s*stream\r?\n([\s\S]*?)\r?\n?endstream/g;
  let sm: RegExpExecArray | null;
  let inspectedStreams = 0;
  while ((sm = streamRe.exec(latin1)) !== null && inspectedStreams < 120) {
    inspectedStreams++;
    const dict = sm[1];
    const bodyStart = sm.index + sm[0].indexOf("stream") + 6 + (latin1[sm.index + sm[0].indexOf("stream") + 6] === "\r" ? 2 : 1);
    const rawBody = sm[2];
    const bodyEnd = bodyStart + rawBody.length;
    if (bodyEnd > bytes.length) continue;

    let decoded = "";
    if (/\/FlateDecode\b/.test(dict)) {
      const slice = bytes.subarray(bodyStart, bodyEnd);
      try {
        decoded = new TextDecoder("latin1").decode(unzlibSync(slice));
      } catch {
        try {
          decoded = new TextDecoder("latin1").decode(inflateSync(slice));
        } catch {
          decoded = "";
        }
      }
    } else if (!/\/DCTDecode\b|\/JPXDecode\b/.test(dict)) {
      decoded = rawBody;
    }

    if (decoded && /\bBT\b[\s\S]*?\bET\b/.test(decoded)) {
      const extracted = extractPdfStreamText(decoded);
      if (extracted.length > 0) textRuns.push(extracted.join(" "));
    }
  }

  return {
    kind: "pdf",
    fileName: name,
    size: bytes.length,
    version,
    pageCount,
    encrypted,
    pageSizePt,
    title: readInfo("Title"),
    author: readInfo("Author"),
    subject: readInfo("Subject"),
    creator: readInfo("Creator"),
    producer: readInfo("Producer"),
    fonts: [...fontSet],
    extractedText: textRuns.join("\n\n").trim(),
  };
}

/* ========================================================================
 * 5. BUILT-IN SAMPLE OFFICE GENERATORS (Valid XLSX, DOCX, PPTX via fflate)
 * ======================================================================== */

export function buildSampleXlsx(): Uint8Array {
  return zipSync({
    "[Content_Types].xml": utf8Enc.encode(
      `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
</Types>`,
    ),
    "_rels/.rels": utf8Enc.encode(
      `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    ),
    "xl/workbook.xml": utf8Enc.encode(
      `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Q1 Expenses (INR)" sheetId="1" r:id="rId1"/>
    <sheet name="Regional Summary" sheetId="2" r:id="rId2"/>
  </sheets>
</workbook>`,
    ),
    "xl/_rels/workbook.xml.rels": utf8Enc.encode(
      `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>`,
    ),
    "xl/sharedStrings.xml": utf8Enc.encode(
      `<?xml version="1.0" encoding="UTF-8"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="12" uniqueCount="12">
  <si><t>Item</t></si>
  <si><t>Category</t></si>
  <si><t>Qty</t></si>
  <si><t>Unit Price</t></si>
  <si><t>Line Total</t></si>
  <si><t>Cloud Hosting (Free Tier)</t></si>
  <si><t>Infrastructure</t></si>
  <si><t>Domain &amp; DNS</t></si>
  <si><t>Operations</t></si>
  <si><t>Design Assets</t></si>
  <si><t>Creative</t></si>
  <si><t>City</t></si>
</sst>`,
    ),
    "xl/worksheets/sheet1.xml": utf8Enc.encode(
      `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c><c r="E1" t="s"><v>4</v></c></row>
    <row r="2"><c r="A2" t="s"><v>5</v></c><c r="B2" t="s"><v>6</v></c><c r="C2"><v>12</v></c><c r="D2"><v>0</v></c><c r="E2"><f>C2*D2</f><v>0</v></c></row>
    <row r="3"><c r="A3" t="s"><v>7</v></c><c r="B3" t="s"><v>8</v></c><c r="C3"><v>1</v></c><c r="D3"><v>999</v></c><c r="E3"><f>C3*D3</f><v>999</v></c></row>
    <row r="4"><c r="A4" t="s"><v>9</v></c><c r="B4" t="s"><v>10</v></c><c r="C4"><v>4</v></c><c r="D4"><v>1250</v></c><c r="E4"><f>C4*D4</f><v>5000</v></c></row>
  </sheetData>
</worksheet>`,
    ),
    "xl/worksheets/sheet2.xml": utf8Enc.encode(
      `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1"><c r="A1" t="s"><v>11</v></c><c r="B1" t="inlineStr"><is><t>Active Teams</t></is></c><c r="C1" t="inlineStr"><is><t>Monthly Active</t></is></c></row>
    <row r="2"><c r="A2" t="inlineStr"><is><t>Bengaluru</t></is></c><c r="B2"><v>14</v></c><c r="C2"><v>4280</v></c></row>
    <row r="3"><c r="A3" t="inlineStr"><is><t>Mumbai</t></is></c><c r="B3"><v>11</v></c><c r="C3"><v>3150</v></c></row>
  </sheetData>
</worksheet>`,
    ),
  });
}

export function buildSampleDocx(): Uint8Array {
  return zipSync({
    "[Content_Types].xml": utf8Enc.encode(
      `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
    ),
    "_rels/.rels": utf8Enc.encode(
      `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
    ),
    "docProps/core.xml": utf8Enc.encode(
      `<?xml version="1.0" encoding="UTF-8"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:title>Q4 Product Architecture Brief</dc:title>
  <dc:creator>Editorial &amp; Engineering</dc:creator>
</cp:coreProperties>`,
    ),
    "word/document.xml": utf8Enc.encode(
      `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>Zero-Cost Office Document Viewer</w:t></w:r></w:p>
    <w:p><w:r><w:t xml:space="preserve">This sample </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>Word (.docx)</w:t></w:r><w:r><w:t xml:space="preserve"> document opens directly in your browser without uploading a single byte to any server.</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Supported Microsoft 365 Formats</w:t></w:r></w:p>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/></w:numPr></w:pPr><w:r><w:t>Excel workbooks (.xlsx, .xlsm, .ods) and delimited CSV/TSV files</w:t></w:r></w:p>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/></w:numPr></w:pPr><w:r><w:t>Word documents (.docx, .odt, .rtf) with headings, lists and tables</w:t></w:r></w:p>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/></w:numPr></w:pPr><w:r><w:t>PowerPoint decks (.pptx, .odp) with speaker notes</w:t></w:r></w:p>
    <w:tbl>
      <w:tr><w:tc><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Format</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Processing</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Server Cost</w:t></w:r></w:p></w:tc></w:tr>
      <w:tr><w:tc><w:p><w:r><w:t>DOCX / XLSX / PPTX</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Local Browser</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>₹0 / $0</w:t></w:r></w:p></w:tc></w:tr>
      <w:tr><w:tc><w:p><w:r><w:t>PDF / CSV / RTF</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Local Browser</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>₹0 / $0</w:t></w:r></w:p></w:tc></w:tr>
    </w:tbl>
  </w:body>
</w:document>`,
    ),
  });
}

export function buildSamplePptx(): Uint8Array {
  return zipSync({
    "[Content_Types].xml": utf8Enc.encode(
      `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
</Types>`,
    ),
    "_rels/.rels": utf8Enc.encode(
      `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`,
    ),
    "ppt/presentation.xml": utf8Enc.encode(
      `<?xml version="1.0" encoding="UTF-8"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:sldIdLst>
    <p:sldId id="256" r:id="rId1"/>
    <p:sldId id="257" r:id="rId2"/>
  </p:sldIdLst>
  <p:sldSz cx="12192000" cy="6858000"/>
</p:presentation>`,
    ),
    "ppt/_rels/presentation.xml.rels": utf8Enc.encode(
      `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>
</Relationships>`,
    ),
    "ppt/slides/slide1.xml": utf8Enc.encode(
      `<?xml version="1.0" encoding="UTF-8"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree>
    <p:sp><p:nvSpPr><p:nvPr><p:ph type="ctrTitle"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="914400" y="1371600"/><a:ext cx="10363200" cy="1828800"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:t>Free Client-Side Office Viewer</a:t></a:r></a:p></p:txBody></p:sp>
    <p:sp><p:nvSpPr><p:nvPr><p:ph type="subTitle"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="1371600" y="3429000"/><a:ext cx="9448800" cy="1200000"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:t>Read PPTX decks, speaker notes and slide tables directly in your browser</a:t></a:r></a:p></p:txBody></p:sp>
  </p:spTree></p:cSld>
</p:sld>`,
    ),
    "ppt/slides/_rels/slide1.xml.rels": utf8Enc.encode(
      `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/>
</Relationships>`,
    ),
    "ppt/notesSlides/notesSlide1.xml": utf8Enc.encode(
      `<?xml version="1.0" encoding="UTF-8"?>
<p:notes xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Welcome audience! Emphasize zero backend cost and full privacy.</a:t></a:r></a:p></a:txBody></p:sp></p:spTree></p:cSld>
</p:notes>`,
    ),
    "ppt/slides/slide2.xml": utf8Enc.encode(
      `<?xml version="1.0" encoding="UTF-8"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree>
    <p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="457200"/><a:ext cx="10820400" cy="914400"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:t>Architecture &amp; Capabilities</a:t></a:r></a:p></p:txBody></p:sp>
    <p:sp><p:nvSpPr><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="1600200"/><a:ext cx="5200000" cy="4000000"/></a:xfrm></p:spPr><p:txBody>
      <a:p><a:pPr lvl="0"/><a:r><a:t>Parses XML/OOXML ZIP containers via fflate</a:t></a:r></a:p>
      <a:p><a:pPr lvl="1"/><a:r><a:t>Preserves slide titles, nested bullets &amp; images</a:t></a:r></a:p>
      <a:p><a:pPr lvl="0"/><a:r><a:t>Extracts embedded tables &amp; presenter notes</a:t></a:r></a:p>
    </p:txBody></p:sp>
    <p:graphicFrame><a:tbl xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <a:tr><a:tc><a:txBody><a:p><a:r><a:t>Tier</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>Latency</a:t></a:r></a:p></a:txBody></a:tc></a:tr>
      <a:tr><a:tc><a:txBody><a:p><a:r><a:t>Browser Local</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>&lt; 25 ms</a:t></a:r></a:p></a:txBody></a:tc></a:tr>
    </a:tbl></p:graphicFrame>
  </p:spTree></p:cSld>
</p:sld>`,
    ),
  });
}

/* ========================================================================
 * 6. DISPATCHER + INTERACTIVE SUB-VIEWERS ("The Worksheet" DESIGN SYSTEM)
 * ======================================================================== */

type ParsedDocument = SpreadsheetDoc | WordDoc | PresentationDoc | PdfDocInfo;

function parseAnyDocument(name: string, bytes: Uint8Array): ParsedDocument {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf" || utf8Dec.decode(bytes.subarray(0, 5)) === "%PDF-") {
    return inspectPdfBytes(name, bytes);
  }
  if (["xlsx", "xlsm", "xltx", "ods", "csv", "tsv", "tab", "xls"].includes(ext)) {
    return parseSpreadsheetBytes(name, bytes);
  }
  if (["pptx", "ppsx", "pptm", "potx", "odp", "ppt"].includes(ext)) {
    return parsePresentationBytes(name, bytes);
  }
  if (["docx", "docm", "dotx", "dotm", "odt", "rtf", "doc", "txt", "md"].includes(ext)) {
    return parseWordBytes(name, bytes);
  }
  // Sniff ZIP contents if unknown extension
  if (isZipHeader(bytes)) {
    const map = normalizeZipMap(unzipSync(bytes));
    if (map.has("xl/workbook.xml") || map.has("xl/worksheets/sheet1.xml")) return parseSpreadsheetBytes(name, bytes);
    if (map.has("ppt/presentation.xml")) return parsePresentationBytes(name, bytes);
    if (map.has("word/document.xml")) return parseWordBytes(name, bytes);
  }
  return parseWordBytes(name, bytes);
}

/* ---------- Spreadsheet Sub-View ---------- */

function SpreadsheetView({ doc }: { doc: SpreadsheetDoc }) {
  const [sheetIdx, setSheetIdx] = useState(0);
  const [firstRowHeader, setFirstRowHeader] = useState(true);
  const [search, setSearch] = useState("");
  const [sortCol, setSortCol] = useState<{ idx: number; dir: "asc" | "desc" } | null>(null);
  const [selectedCell, setSelectedCell] = useState<{ r: number; c: number }>({ r: 0, c: 0 });

  const sheet = doc.sheets[sheetIdx] ?? doc.sheets[0];
  const headers = useMemo(() => {
    if (!sheet || sheet.rows.length === 0) return [];
    if (firstRowHeader) {
      return sheet.rows[0].map((v, idx) => v.trim() || indexToColLetters(idx));
    }
    return Array.from({ length: sheet.colCount }, (_, idx) => indexToColLetters(idx));
  }, [sheet, firstRowHeader]);

  const dataRows = useMemo(() => {
    if (!sheet) return [];
    const base = firstRowHeader ? sheet.rows.slice(1) : sheet.rows;
    const withOrigIdx = base.map((cells, idx) => ({
      cells,
      excelRowNum: (firstRowHeader ? idx + 2 : idx + 1),
    }));
    const q = search.trim().toLowerCase();
    const filtered = q
      ? withOrigIdx.filter((r) => r.cells.some((cell) => cell.toLowerCase().includes(q)))
      : withOrigIdx;

    if (!sortCol) return filtered;
    const copy = [...filtered];
    copy.sort((a, b) => {
      const va = a.cells[sortCol.idx] ?? "";
      const vb = b.cells[sortCol.idx] ?? "";
      const na = Number(va);
      const nb = Number(vb);
      const cmp =
        va !== "" && vb !== "" && Number.isFinite(na) && Number.isFinite(nb)
          ? na - nb
          : va.localeCompare(vb, undefined, { numeric: true });
      return sortCol.dir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [sheet, firstRowHeader, search, sortCol]);

  const visibleRows = dataRows.slice(0, 400);
  const selectedCoord = `${indexToColLetters(selectedCell.c)}${selectedCell.r + 1}`;
  const selectedValue = sheet?.rows[selectedCell.r]?.[selectedCell.c] ?? "";
  const selectedFormula = sheet?.formulas[selectedCoord];

  const colStats = useMemo(() => {
    const idx = selectedCell.c;
    const vals = dataRows
      .map((r) => r.cells[idx] ?? "")
      .filter((v) => v !== "" && Number.isFinite(Number(v)))
      .map(Number);
    if (vals.length === 0) return null;
    const sum = vals.reduce((s, n) => s + n, 0);
    return {
      count: vals.length,
      sum,
      avg: sum / vals.length,
      min: Math.min(...vals),
      max: Math.max(...vals),
    };
  }, [dataRows, selectedCell.c]);

  const exportCsv = () => {
    const esc = (v: string) => (/[,"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const all = [headers, ...dataRows.map((r) => r.cells)].map((r) => r.map(esc).join(",")).join("\n");
    saveBlob(new Blob([all], { type: "text/csv;charset=utf-8" }), `${sheet.name}.csv`);
  };

  const exportJson = () => {
    const records = dataRows.map((r) => Object.fromEntries(headers.map((h, i) => [h, r.cells[i] ?? ""])));
    saveBlob(new Blob([JSON.stringify(records, null, 2)], { type: "application/json" }), `${sheet.name}.json`);
  };

  const markdownOut = useMemo(() => {
    const head = `| ${headers.join(" | ")} |`;
    const sep = `| ${headers.map(() => "---").join(" | ")} |`;
    const body = visibleRows.slice(0, 60).map((r) => `| ${headers.map((_, i) => (r.cells[i] ?? "").replace(/\|/g, "\\|")).join(" | ")} |`);
    return [head, sep, ...body].join("\n");
  }, [headers, visibleRows]);

  return (
    <div className="space-y-4">
      <Panel>
        {doc.sheets.length > 1 && (
          <Row label={`Sheets (${doc.sheets.length})`}>
            <Chips
              value={sheetIdx}
              onChange={(idx) => {
                setSheetIdx(idx);
                setSortCol(null);
                setSelectedCell({ r: 0, c: 0 });
              }}
              options={doc.sheets.map((s, idx) => ({ value: idx, label: `${s.name} (${s.rows.length})` }))}
            />
          </Row>
        )}
        <Row label="Filter & display" hint={`${dataRows.length.toLocaleString()} rows × ${sheet.colCount} cols`}>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[200px] flex-1">
              <Search aria-hidden className="pointer-events-none absolute left-3 top-3 size-4 text-ink-3" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Filter spreadsheet rows"
                placeholder="Search any cell across rows…"
                className="h-10 w-full rounded-md border border-line bg-surface pl-9 pr-3 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-ink focus:ring-4 focus:ring-accent/15"
              />
            </div>
            <Toggle checked={firstRowHeader} onChange={setFirstRowHeader} label="First row as header" />
          </div>
        </Row>
        <Row label="Export">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={exportCsv}
              className="inline-flex h-9 items-center gap-1.5 rounded-[8px] border border-line bg-surface px-3 text-[13px] font-medium text-ink hover:border-ink-3"
            >
              <Download aria-hidden className="size-3.5" /> CSV
            </button>
            <button
              type="button"
              onClick={exportJson}
              className="inline-flex h-9 items-center gap-1.5 rounded-[8px] border border-line bg-surface px-3 text-[13px] font-medium text-ink hover:border-ink-3"
            >
              <Download aria-hidden className="size-3.5" /> JSON
            </button>
            <CopyButton text={markdownOut} label="Copy Markdown" />
          </div>
        </Row>
      </Panel>

      {/* Formula & Cell Inspector bar (fx) */}
      <div className="flex flex-wrap items-center gap-2.5 rounded-md border border-line bg-paper px-3.5 py-2.5">
        <span className="rounded-[5px] border border-line bg-surface px-2 py-0.5 font-mono text-[12px] font-semibold text-ink">
          {selectedCoord}
        </span>
        <span className="font-mono text-[12px] italic text-ink-3">fx</span>
        <code className="min-w-0 flex-1 truncate font-mono text-[13px] text-ink">
          {selectedFormula ? `${selectedFormula}  →  ${selectedValue}` : selectedValue || "—"}
        </code>
        {colStats && (
          <span className="font-mono text-[12px] text-ink-2">
            Col Sum {colStats.sum.toLocaleString(undefined, { maximumFractionDigits: 2 })} · Avg{" "}
            {colStats.avg.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </span>
        )}
      </div>

      {/* Interactive Grid */}
      <div className="overflow-hidden rounded-md border border-line bg-surface" data-lenis-prevent>
        <div className="max-h-[460px] overflow-auto">
          <table className="w-full border-collapse text-left">
            <thead className="sticky top-0 z-10 bg-paper">
              <tr className="border-b border-line">
                <th className="w-11 border-r border-line bg-paper px-2.5 py-2 text-center font-mono text-[12px] text-ink-3">#</th>
                {headers.map((h, ci) => (
                  <th
                    key={`${h}-${ci}`}
                    onClick={() =>
                      setSortCol((prev) =>
                        prev?.idx === ci ? (prev.dir === "asc" ? { idx: ci, dir: "desc" } : null) : { idx: ci, dir: "asc" },
                      )
                    }
                    title="Click to sort column"
                    className="cursor-pointer select-none whitespace-nowrap border-r border-line/70 px-3 py-2 text-[12px] font-semibold text-ink hover:bg-paper-2"
                  >
                    <span className="mr-1 font-mono text-ink-3">{indexToColLetters(ci)}</span>
                    {firstRowHeader ? h : ""}
                    {sortCol?.idx === ci && <span className="ml-1 font-mono text-accent">{sortCol.dir === "asc" ? "↑" : "↓"}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {visibleRows.map((r) => (
                <tr key={r.excelRowNum} className="hover:bg-paper/60">
                  <td
                    onClick={() => setSelectedCell({ r: r.excelRowNum - 1, c: 0 })}
                    className="cursor-pointer border-r border-line bg-paper/40 px-2.5 py-1.5 text-center font-mono text-[12px] text-ink-3"
                  >
                    {r.excelRowNum}
                  </td>
                  {headers.map((_, ci) => {
                    const val = r.cells[ci] ?? "";
                    const isSel = selectedCell.r === r.excelRowNum - 1 && selectedCell.c === ci;
                    const coord = `${indexToColLetters(ci)}${r.excelRowNum}`;
                    const hasFormula = Boolean(sheet.formulas[coord]);
                    return (
                      <td
                        key={ci}
                        onClick={() => setSelectedCell({ r: r.excelRowNum - 1, c: ci })}
                        className={cn(
                          "max-w-[260px] cursor-pointer truncate border-r border-line/40 px-3 py-1.5 text-[13px] text-ink",
                          val !== "" && Number.isFinite(Number(val)) && "text-right font-mono tabular-nums",
                          isSel && "bg-accent/10 ring-1 ring-inset ring-accent",
                        )}
                      >
                        {hasFormula && <span className="mr-1 font-mono text-[12px] text-accent">ƒ</span>}
                        {val}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {dataRows.length > 400 && (
          <div className="border-t border-line bg-paper px-3.5 py-2 text-[12px] text-ink-3">
            Showing first 400 of {dataRows.length.toLocaleString()} matching rows. Export CSV or JSON for the full dataset.
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- Word / Document Sub-View ---------- */

function renderRuns(runs: DocRun[], query: string) {
  return runs.map((r, idx) => {
    if (r.image) return null;
    const style: React.CSSProperties | undefined = r.color ? { color: r.color } : undefined;
    const content = query && r.text.toLowerCase().includes(query.toLowerCase()) ? highlightQuery(r.text, query) : r.text;
    const cls = cn(
      r.bold && "font-semibold",
      r.italic && "italic",
      r.underline && "underline underline-offset-2",
      r.strike && "line-through",
      r.code && "rounded-[4px] bg-paper-2 px-1 py-0.5 font-mono text-[13px]",
    );
    if (r.href) {
      return (
        <a key={idx} href={r.href} target="_blank" rel="noreferrer noopener" style={style} className={cn(cls, "text-accent underline")}>
          {content}
        </a>
      );
    }
    return (
      <span key={idx} style={style} className={cls}>
        {content}
      </span>
    );
  });
}

function highlightQuery(text: string, q: string) {
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="rounded-[2px] bg-amber-200 px-0.5 text-ink">{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  );
}

function WordView({ doc }: { doc: WordDoc }) {
  const [search, setSearch] = useState("");
  const [wideMode, setWideMode] = useState(false);

  const plainText = useMemo(
    () =>
      doc.blocks
        .map((b) => {
          if (b.type === "heading") return b.text;
          if (b.type === "paragraph") return b.runs.map((r) => r.text).join("");
          if (b.type === "list-item") return `• ${b.runs.map((r) => r.text).join("")}`;
          if (b.type === "table") return b.rows.map((r) => r.map((c) => c.text).join("\t")).join("\n");
          return "";
        })
        .filter(Boolean)
        .join("\n\n"),
    [doc.blocks],
  );

  const markdownText = useMemo(
    () =>
      doc.blocks
        .map((b) => {
          if (b.type === "heading") return `${"#".repeat(b.level)} ${b.text}`;
          if (b.type === "paragraph") return b.runs.map((r) => (r.bold ? `**${r.text}**` : r.italic ? `*${r.text}*` : r.text)).join("");
          if (b.type === "list-item") return `${"  ".repeat(b.level)}- ${b.runs.map((r) => r.text).join("")}`;
          if (b.type === "table" && b.rows.length > 0) {
            const cols = b.rows[0].length;
            const lines = b.rows.map((r) => `| ${r.map((c) => c.text.replace(/\|/g, "\\|")).join(" | ")} |`);
            lines.splice(1, 0, `| ${Array(cols).fill("---").join(" | ")} |`);
            return lines.join("\n");
          }
          return "";
        })
        .filter(Boolean)
        .join("\n\n"),
    [doc.blocks],
  );

  const printDoc = () => {
    const win = window.open("", "_blank");
    if (!win) return;
    const htmlBody = doc.blocks
      .map((b) => {
        if (b.type === "heading") return `<h${b.level}>${b.text.replace(/</g, "&lt;")}</h${b.level}>`;
        if (b.type === "paragraph") return `<p>${b.runs.map((r) => r.text.replace(/</g, "&lt;")).join("")}</p>`;
        if (b.type === "list-item") return `<p style="margin-left:${b.level * 18}px">• ${b.runs.map((r) => r.text.replace(/</g, "&lt;")).join("")}</p>`;
        if (b.type === "image") return `<p><img src="${b.dataUrl}" style="max-width:100%" /></p>`;
        if (b.type === "table") {
          return `<table>${b.rows.map((row) => `<tr>${row.map((c) => `<td>${c.text.replace(/</g, "&lt;")}</td>`).join("")}</tr>`).join("")}</table>`;
        }
        return "";
      })
      .join("\n");
    win.document.write(
      `<!doctype html><html><head><title>${doc.title || doc.fileName}</title><style>body{font-family:system-ui,sans-serif;max-width:740px;margin:32px auto;line-height:1.6;color:#111}table{border-collapse:collapse;width:100%;margin:12px 0}td{border:1px solid #d4d4d8;padding:6px 10px}</style></head><body>${htmlBody}<script>window.onload=()=>window.print()</script></body></html>`,
    );
    win.document.close();
  };

  return (
    <div className="space-y-4">
      <Panel>
        <Row
          label="Document stats"
          hint={`${doc.stats.words.toLocaleString()} words · ${doc.stats.readingMinutes} min read · ${doc.stats.tables} tables · ${doc.stats.images} images`}
        >
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[200px] flex-1">
              <Search aria-hidden className="pointer-events-none absolute left-3 top-3 size-4 text-ink-3" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search inside document"
                placeholder="Find in document…"
                className="h-10 w-full rounded-md border border-line bg-surface pl-9 pr-3 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-ink focus:ring-4 focus:ring-accent/15"
              />
            </div>
            <Toggle checked={wideMode} onChange={setWideMode} label="Full width" />
          </div>
        </Row>
        <Row label="Export">
          <div className="flex flex-wrap items-center gap-2">
            <CopyButton text={plainText} label="Copy Text" />
            <CopyButton text={markdownText} label="Copy Markdown" />
            <button
              type="button"
              onClick={() => saveBlob(new Blob([markdownText], { type: "text/markdown;charset=utf-8" }), `${doc.fileName.replace(/\.[^.]+$/, "")}.md`)}
              className="inline-flex h-9 items-center gap-1.5 rounded-[8px] border border-line bg-surface px-3 text-[13px] font-medium text-ink hover:border-ink-3"
            >
              <Download aria-hidden className="size-3.5" /> .md
            </button>
            <button
              type="button"
              onClick={printDoc}
              className="inline-flex h-9 items-center gap-1.5 rounded-[8px] border border-line bg-surface px-3 text-[13px] font-medium text-ink hover:border-ink-3"
            >
              <Printer aria-hidden className="size-3.5" /> Print / PDF
            </button>
          </div>
        </Row>
      </Panel>

      <div className={cn("grid gap-4", doc.outline.length > 0 && "lg:grid-cols-[220px_minmax(0,1fr)]")}>
        {doc.outline.length > 0 && (
          <aside className="h-fit rounded-md border border-line bg-paper p-3">
            <p className="label-mono mb-2 text-ink-3">Outline ({doc.outline.length})</p>
            <ul className="space-y-1.5">
              {doc.outline.map((item) => (
                <li key={item.id} style={{ paddingLeft: `${(item.level - 1) * 10}px` }}>
                  <a
                    href={`#${item.id}`}
                    className="block truncate text-[13px] text-ink-2 transition-colors hover:text-ink"
                  >
                    {item.text}
                  </a>
                </li>
              ))}
            </ul>
          </aside>
        )}

        <article className="rounded-md border border-line bg-surface p-5 sm:p-8" data-lenis-prevent>
          <div className={cn("space-y-4", !wideMode && "mx-auto max-w-[68ch]")}>
            {(doc.title || doc.author) && (
              <header className="border-b border-line pb-3 text-[12px] text-ink-3">
                {doc.title && <span className="mr-3 font-medium text-ink">{doc.title}</span>}
                {doc.author && <span>By {doc.author}</span>}
              </header>
            )}

            {doc.blocks.length === 0 ? (
              <p className="text-sm text-ink-3">This document contains no readable paragraphs.</p>
            ) : (
              doc.blocks.map((b, idx) => {
                if (b.type === "heading") {
                  const sizes: Record<number, string> = {
                    1: "text-2xl font-semibold tracking-tight pt-2",
                    2: "text-xl font-semibold tracking-tight pt-2 border-b border-line/60 pb-1",
                    3: "text-lg font-semibold pt-1",
                    4: "text-base font-semibold",
                    5: "text-sm font-semibold",
                    6: "text-sm font-medium text-ink-2",
                  };
                  return (
                    <div key={idx} id={b.id} className={cn("text-ink", sizes[b.level])}>
                      {search ? highlightQuery(b.text, search) : b.text}
                    </div>
                  );
                }
                if (b.type === "list-item") {
                  return (
                    <div key={idx} style={{ paddingLeft: `${16 + b.level * 18}px` }} className="relative text-[15px] leading-relaxed text-ink">
                      <span aria-hidden className="absolute left-1 top-2 size-1.5 rounded-full bg-ink-2" style={{ left: `${4 + b.level * 18}px` }} />
                      {renderRuns(b.runs, search)}
                    </div>
                  );
                }
                if (b.type === "image") {
                  return (
                    <figure key={idx} className="my-3 overflow-hidden rounded-[6px] border border-line bg-paper p-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={b.dataUrl} alt={b.alt || "Embedded image"} className="max-h-[420px] w-auto max-w-full rounded-[4px]" />
                      {b.alt && <figcaption className="mt-1.5 text-[12px] text-ink-3">{b.alt}</figcaption>}
                    </figure>
                  );
                }
                if (b.type === "table") {
                  return (
                    <div key={idx} className="my-3 overflow-x-auto rounded-[6px] border border-line">
                      <table className="w-full border-collapse text-left text-[13px]">
                        <tbody className="divide-y divide-line">
                          {b.rows.map((row, rIdx) => (
                            <tr key={rIdx} className={rIdx === 0 ? "bg-paper font-semibold" : "bg-surface"}>
                              {row.map((cell, cIdx) => (
                                <td key={cIdx} colSpan={cell.colSpan} className="border-r border-line/60 px-3 py-2 text-ink last:border-r-0">
                                  {cell.text || "—"}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                }
                return (
                  <p
                    key={idx}
                    className={cn(
                      "whitespace-pre-wrap text-[15px] leading-relaxed text-ink",
                      b.align === "center" && "text-center",
                      b.align === "right" && "text-right",
                      b.quote && "border-l-2 border-accent/60 pl-4 italic text-ink-2",
                    )}
                  >
                    {renderRuns(b.runs, search)}
                  </p>
                );
              })
            )}
          </div>
        </article>
      </div>
    </div>
  );
}

/* ---------- PowerPoint / Presentation Sub-View ---------- */

function PresentationView({ doc }: { doc: PresentationDoc }) {
  const [slideIdx, setSlideIdx] = useState(0);
  const [viewMode, setViewMode] = useState<"stage" | "outline">("stage");

  const slide = doc.slides[slideIdx] ?? doc.slides[0];

  const markdownDeck = useMemo(
    () =>
      doc.slides
        .map((s) => {
          const lines = [`## Slide ${s.index}: ${s.title}`];
          if (s.subtitle) lines.push(`*${s.subtitle}*`);
          for (const b of s.bullets) lines.push(`${"  ".repeat(b.level)}- ${b.text}`);
          if (s.notes) lines.push(`\n> **Notes:** ${s.notes}`);
          return lines.join("\n");
        })
        .join("\n\n---\n\n"),
    [doc.slides],
  );

  return (
    <div className="space-y-4">
      <Panel>
        <Row label="Deck controls" hint={`Slide ${slide.index} of ${doc.slides.length}${doc.title ? ` · ${doc.title}` : ""}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Chips
              value={viewMode}
              onChange={setViewMode}
              options={[
                { value: "stage", label: "Visual slide stage" },
                { value: "outline", label: "Structured slides" },
              ]}
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={slideIdx === 0}
                onClick={() => setSlideIdx((i) => Math.max(0, i - 1))}
                aria-label="Previous slide"
                className="inline-flex h-9 items-center gap-1 rounded-[8px] border border-line bg-surface px-2.5 text-[13px] text-ink disabled:opacity-40"
              >
                <ChevronLeft aria-hidden className="size-4" /> Prev
              </button>
              <button
                type="button"
                disabled={slideIdx >= doc.slides.length - 1}
                onClick={() => setSlideIdx((i) => Math.min(doc.slides.length - 1, i + 1))}
                aria-label="Next slide"
                className="inline-flex h-9 items-center gap-1 rounded-[8px] border border-line bg-surface px-2.5 text-[13px] text-ink disabled:opacity-40"
              >
                Next <ChevronRight aria-hidden className="size-4" />
              </button>
              <CopyButton text={markdownDeck} label="Copy Deck Markdown" />
            </div>
          </div>
        </Row>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-[200px_minmax(0,1fr)]">
        {/* Slide Filmstrip Rail */}
        <aside className="max-h-[500px] space-y-2 overflow-y-auto rounded-md border border-line bg-paper p-2.5" data-lenis-prevent>
          {doc.slides.map((s, idx) => (
            <button
              key={s.index}
              type="button"
              onClick={() => setSlideIdx(idx)}
              className={cn(
                "w-full rounded-[6px] border p-2.5 text-left transition-colors",
                idx === slideIdx ? "border-ink bg-surface shadow-sm" : "border-line/70 bg-surface/60 hover:border-ink-3",
              )}
            >
              <p className="font-mono text-[12px] text-ink-3">Slide {String(s.index).padStart(2, "0")}</p>
              <p className="mt-0.5 line-clamp-2 text-[13px] font-medium text-ink">{s.title}</p>
            </button>
          ))}
        </aside>

        {/* Main Slide Viewport */}
        <div className="space-y-3">
          {viewMode === "stage" && slide.boxes.length > 0 ? (
            <div
              className="relative w-full overflow-hidden rounded-md border border-line bg-white shadow-sm"
              style={{ aspectRatio: `${doc.aspectRatio}` }}
            >
              {slide.boxes.map((box, bIdx) => (
                <div
                  key={bIdx}
                  style={{
                    left: `${box.xPct}%`,
                    top: `${box.yPct}%`,
                    width: `${box.wPct}%`,
                    height: `${box.hPct}%`,
                    backgroundColor: box.fillColor,
                  }}
                  className="absolute overflow-hidden p-2"
                >
                  {box.kind === "image" && box.dataUrl ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={box.dataUrl} alt="" className="size-full object-contain" />
                  ) : (
                    <div className="space-y-1 text-zinc-900">
                      {box.textLines?.map((ln, lIdx) => (
                        <p
                          key={lIdx}
                          style={{ paddingLeft: `${ln.level * 12}px` }}
                          className={cn(
                            ln.isTitle ? "text-[clamp(16px,2.2vw,26px)] font-bold leading-tight" : "text-[clamp(12px,1.2vw,16px)] leading-snug",
                          )}
                        >
                          {!ln.isTitle && ln.level >= 0 && box.textLines!.length > 1 ? `• ${ln.text}` : ln.text}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {slide.tables.length > 0 && (
                <div className="absolute inset-x-[6%] bottom-[6%] max-h-[42%] overflow-auto rounded border border-zinc-300 bg-white/95 p-2 shadow-sm">
                  {slide.tables.map((tbl, tIdx) => (
                    <table key={tIdx} className="w-full border-collapse text-left text-[12px] text-zinc-900">
                      <tbody>
                        {tbl.map((r, rIdx) => (
                          <tr key={rIdx} className={rIdx === 0 ? "bg-zinc-100 font-semibold" : "border-t border-zinc-200"}>
                            {r.map((c, cIdx) => (
                              <td key={cIdx} className="px-2 py-1">{c}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4 rounded-md border border-line bg-surface p-6">
              <div>
                <p className="label-mono text-ink-3">Slide {slide.index}</p>
                <h3 className="mt-1 text-xl font-semibold text-ink">{slide.title}</h3>
                {slide.subtitle && <p className="mt-1 text-sm text-ink-2">{slide.subtitle}</p>}
              </div>
              {slide.bullets.length > 0 && (
                <ul className="space-y-2">
                  {slide.bullets.map((b, i) => (
                    <li key={i} style={{ paddingLeft: `${b.level * 18}px` }} className="text-[15px] leading-relaxed text-ink">
                      • {b.text}
                    </li>
                  ))}
                </ul>
              )}
              {slide.tables.map((tbl, tIdx) => (
                <div key={tIdx} className="overflow-x-auto rounded border border-line">
                  <table className="w-full border-collapse text-left text-[13px]">
                    <tbody>
                      {tbl.map((r, rIdx) => (
                        <tr key={rIdx} className={rIdx === 0 ? "bg-paper font-semibold" : "border-t border-line"}>
                          {r.map((c, cIdx) => (
                            <td key={cIdx} className="px-3 py-2 text-ink">{c}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
              {slide.images.length > 0 && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {slide.images.map((im, i) => (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img key={i} src={im.dataUrl} alt={im.alt || `Slide ${slide.index} visual`} className="max-h-56 w-auto rounded border border-line object-contain" />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Presenter Speaker Notes */}
          <div className="rounded-md border border-dashed border-line bg-paper px-4 py-3">
            <p className="label-mono text-ink-3">Speaker notes</p>
            <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-ink-2">
              {slide.notes || "No speaker notes recorded on this slide."}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- PDF Reader + Inspector Sub-View ---------- */

function PdfViewerView({ doc, blobUrl }: { doc: PdfDocInfo; blobUrl: string }) {
  const [tab, setTab] = useState<"reader" | "inspect">("reader");

  return (
    <div className="space-y-4">
      <Panel>
        <Row label="PDF view mode" hint={`PDF ${doc.version} · ${doc.pageCount} pages · ${formatBytes(doc.size)}`}>
          <Chips
            value={tab}
            onChange={setTab}
            options={[
              { value: "reader", label: "Interactive PDF reader" },
              { value: "inspect", label: "Text, fonts & metadata" },
            ]}
          />
        </Row>
      </Panel>

      {tab === "reader" ? (
        <PdfPreview url={blobUrl} name={doc.fileName} className="mt-0" />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Version", val: `PDF ${doc.version}` },
              { label: "Detected pages", val: String(doc.pageCount) },
              {
                label: "Page size",
                val: doc.pageSizePt ? `${doc.pageSizePt[0]} × ${doc.pageSizePt[1]} pt` : "Mixed / Unknown",
              },
              { label: "Encryption", val: doc.encrypted ? "Password / Restricted" : "None" },
            ].map((item) => (
              <div key={item.label} className="rounded-md border border-line bg-surface px-3.5 py-2.5">
                <p className="label-mono text-ink-3">{item.label}</p>
                <p className="mt-1 font-mono text-[14px] font-medium text-ink">{item.val}</p>
              </div>
            ))}
          </div>

          <Panel>
            <Row label="Document properties">
              <div className="grid gap-2 text-[13px] sm:grid-cols-2">
                <div><span className="text-ink-3">Title: </span><span className="text-ink">{doc.title || "—"}</span></div>
                <div><span className="text-ink-3">Author: </span><span className="text-ink">{doc.author || "—"}</span></div>
                <div><span className="text-ink-3">Creator: </span><span className="text-ink">{doc.creator || "—"}</span></div>
                <div><span className="text-ink-3">Producer: </span><span className="text-ink">{doc.producer || "—"}</span></div>
              </div>
            </Row>
            <Row label={`Embedded fonts (${doc.fonts.length})`}>
              <p className="font-mono text-[12px] leading-relaxed text-ink-2">
                {doc.fonts.length > 0 ? doc.fonts.join(", ") : "No named PostScript fonts detected"}
              </p>
            </Row>
          </Panel>

          <div className="rounded-md border border-line bg-surface p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="label-mono text-ink-3">Extracted stream text</span>
              {doc.extractedText && <CopyButton text={doc.extractedText} label="Copy text" />}
            </div>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap font-mono text-[13px] leading-relaxed text-ink">
              {doc.extractedText || "No uncompressed or FlateDecode text runs extracted. Use the Interactive PDF reader tab for scanned/vector PDFs or our OCR PDF tool to extract scanned text."}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- Main Workbench Tool Component ---------- */

const ACCEPT_BY_TOOL: Record<string, { label: string; types: string }> = {
  "excel-viewer": { label: "XLSX, XLSM, ODS, CSV or TSV", types: ".xlsx,.xlsm,.xltx,.ods,.csv,.tsv,.xls" },
  "csv-viewer": { label: "CSV or TSV files", types: ".csv,.tsv,.tab,.txt" },
  "word-viewer": { label: "DOCX, ODT, RTF or Markdown", types: ".docx,.docm,.dotx,.odt,.rtf,.md,.txt,.doc" },
  "powerpoint-viewer": { label: "PPTX, PPSX or ODP decks", types: ".pptx,.ppsx,.pptm,.odp,.ppt" },
  "pdf-viewer": { label: "PDF documents", types: ".pdf,application/pdf" },
  "document-viewer": {
    label: "XLSX, CSV, DOCX, PPTX, PDF, ODT, ODS, ODP, RTF…",
    types: ".xlsx,.xlsm,.ods,.csv,.tsv,.docx,.docm,.odt,.rtf,.pptx,.ppsx,.odp,.pdf,.xls,.doc,.ppt,.md,.txt",
  },
};

export function DocumentViewerTool({ toolId }: { toolId: string }) {
  const tool = getTool(toolId);
  const steps = tool ? stepsFor(tool) : (["Add document", "Inspect or search", "Export"] as const);
  const accept = ACCEPT_BY_TOOL[toolId] ?? ACCEPT_BY_TOOL["document-viewer"];

  const [doc, setDoc] = useState<ParsedDocument | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
  }, []);

  async function loadBytes(fileName: string, bytes: Uint8Array, mime = "application/octet-stream") {
    setError(null);
    try {
      const parsed = parseAnyDocument(fileName, bytes);
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      const nextUrl = URL.createObjectURL(new Blob([copy], { type: parsed.kind === "pdf" ? "application/pdf" : mime }));
      urlRef.current = nextUrl;
      setBlobUrl(nextUrl);
      setDoc(parsed);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open this document.");
    }
  }

  async function handleFile(f: File) {
    const ab = await f.arrayBuffer();
    await loadBytes(f.name, new Uint8Array(ab), f.type || "application/octet-stream");
  }

  const reset = () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    setBlobUrl(null);
    setDoc(null);
    setError(null);
  };

  const KindIcon =
    doc?.kind === "spreadsheet"
      ? FileSpreadsheet
      : doc?.kind === "presentation"
        ? Presentation
        : doc?.kind === "pdf"
          ? FileStack
          : doc?.kind === "word"
            ? FileText
            : Eye;

  return (
    <Workbench
      steps={steps}
      current={doc ? 2 : 0}
      footer={
        <>
          Opened 100% inside your browser using{" "}
          <span className="font-mono text-ink-2">fflate</span> &amp; pure TypeScript codecs. Microsoft 365 files and PDFs are never uploaded.
        </>
      }
    >
      <div className="space-y-4 p-4 sm:p-6">
        {!doc ? (
          <div className="space-y-4">
            <FileDrop
              accept={accept.types}
              title={`Drop ${accept.label} here to open`}
              formats={accept.label}
              error={error}
              onFile={handleFile}
            />

            {error && (
              <Notice tone="warning">
                Need to convert a legacy binary <code>.doc</code> / <code>.xls</code> / <code>.ppt</code>? Open{" "}
                <a href={toolHref("convert-anything")} className="underline underline-offset-4 hover:text-ink">
                  Convert anything
                </a>{" "}
                to convert it cleanly.
              </Notice>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed border-line bg-paper px-3.5 py-2.5">
              <span className="flex items-center gap-2 text-[13px] text-ink-2">
                <Sparkles aria-hidden className="size-4 text-ink-3" />
                Try a sample Microsoft 365 file immediately:
              </span>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => void loadBytes("Q1-Expenses.xlsx", buildSampleXlsx())}
                  className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-line bg-surface px-2.5 text-[12px] font-medium text-ink hover:border-ink-3"
                >
                  <FileSpreadsheet aria-hidden className="size-3.5" /> Sample Excel (.xlsx)
                </button>
                <button
                  type="button"
                  onClick={() => void loadBytes("Architecture-Brief.docx", buildSampleDocx())}
                  className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-line bg-surface px-2.5 text-[12px] font-medium text-ink hover:border-ink-3"
                >
                  <FileText aria-hidden className="size-3.5" /> Sample Word (.docx)
                </button>
                <button
                  type="button"
                  onClick={() => void loadBytes("Product-Overview.pptx", buildSamplePptx())}
                  className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-line bg-surface px-2.5 text-[12px] font-medium text-ink hover:border-ink-3"
                >
                  <Presentation aria-hidden className="size-3.5" /> Sample PowerPoint (.pptx)
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Active Document Top Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-paper px-3.5 py-2.5">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-[6px] border border-line bg-surface text-ink">
                  <KindIcon aria-hidden className="size-4" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{doc.fileName}</p>
                  <p className="font-mono text-[12px] text-ink-3">
                    {doc.kind === "spreadsheet"
                      ? `${doc.format} · ${doc.sheets.length} sheet(s)`
                      : doc.kind === "word"
                        ? `${doc.format} · ${doc.stats.words.toLocaleString()} words`
                        : doc.kind === "presentation"
                          ? `${doc.format} · ${doc.slides.length} slide(s)`
                          : `PDF ${doc.version} · ${doc.pageCount} page(s)`}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {blobUrl && (
                  <a
                    href={blobUrl}
                    download={doc.fileName}
                    className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-line bg-surface px-2.5 text-[12px] text-ink-2 hover:border-ink-3 hover:text-ink"
                  >
                    <Download aria-hidden className="size-3.5" /> Download original
                  </a>
                )}
                <button
                  type="button"
                  onClick={reset}
                  className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-line bg-surface px-2.5 text-[12px] text-ink-2 hover:border-ink-3 hover:text-ink"
                >
                  <RotateCcw aria-hidden className="size-3.5" /> Open another file
                </button>
              </div>
            </div>

            {doc.kind === "spreadsheet" && <SpreadsheetView key={doc.fileName} doc={doc} />}
            {doc.kind === "word" && <WordView key={doc.fileName} doc={doc} />}
            {doc.kind === "presentation" && <PresentationView key={doc.fileName} doc={doc} />}
            {doc.kind === "pdf" && blobUrl && <PdfViewerView key={doc.fileName} doc={doc} blobUrl={blobUrl} />}
          </div>
        )}
      </div>
    </Workbench>
  );
}
