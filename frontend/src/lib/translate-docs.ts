/**
 * Document translation in the browser, keeping the file's layout and formatting.
 *
 * Every format is read into "segments" (paragraphs, cells, cues, strings…), the segments are
 * translated in batches through /api/tools/translate/batch, and the file is rebuilt with the
 * translations put back where the text came from. Office files are edited in their XML, so
 * styles, images, tables, charts and everything else stay exactly as they were.
 *
 * Supported: DOCX/DOCM/DOTX, PPTX/PPSX, XLSX/XLSM, ODT/ODP/ODS, EPUB, HTML, Markdown, TXT, CSV/TSV,
 * JSON (i18n files), PO/POT, XLIFF, SRT/VTT. PDF and legacy DOC/PPT/XLS/RTF are first converted to
 * their Office equivalent by the universal converter on the server.
 */
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import { uploadForm } from "./files";
import { DEFAULT_PROTECT_PATTERNS, smartTranslateBatch, type GlossaryRule } from "./translate-extras";

export type DocOutput = "translated" | "bilingual";

export type DocKind =
  | "docx" | "pptx" | "xlsx" | "odt" | "odp" | "ods" | "epub" | "html" | "md" | "txt" | "csv" | "tsv"
  | "json" | "po" | "xliff" | "srt" | "vtt";

export const DOC_EXTENSIONS: Record<string, DocKind> = {
  docx: "docx", docm: "docx", dotx: "docx",
  pptx: "pptx", ppsx: "pptx", pptm: "pptx", potx: "pptx",
  xlsx: "xlsx", xlsm: "xlsx", xltx: "xlsx",
  odt: "odt", odp: "odp", ods: "ods",
  epub: "epub",
  html: "html", htm: "html", xhtml: "html",
  md: "md", markdown: "md",
  txt: "txt", text: "txt", log: "txt",
  csv: "csv", tsv: "tsv",
  json: "json", arb: "json",
  po: "po", pot: "po",
  xlf: "xliff", xliff: "xliff",
  srt: "srt", vtt: "vtt",
};

/** Formats the server converts first (to the Office format we can edit). */
export const CONVERT_FIRST: Record<string, { to: string; kind: DocKind; label: string }> = {
  pdf: { to: "docx", kind: "docx", label: "PDF → Word" },
  doc: { to: "docx", kind: "docx", label: "DOC → DOCX" },
  rtf: { to: "docx", kind: "docx", label: "RTF → DOCX" },
  ppt: { to: "pptx", kind: "pptx", label: "PPT → PPTX" },
  xls: { to: "xlsx", kind: "xlsx", label: "XLS → XLSX" },
};

export const DOC_ACCEPT = [...Object.keys(DOC_EXTENSIONS), ...Object.keys(CONVERT_FIRST)].map((e) => `.${e}`).join(",");

const MIME: Record<DocKind, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  odt: "application/vnd.oasis.opendocument.text",
  odp: "application/vnd.oasis.opendocument.presentation",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  epub: "application/epub+zip",
  html: "text/html",
  md: "text/markdown",
  txt: "text/plain",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  json: "application/json",
  po: "text/x-gettext-translation",
  xliff: "application/xliff+xml",
  srt: "application/x-subrip",
  vtt: "text/vtt",
};

export function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

export function docKindFor(name: string): DocKind | null {
  return DOC_EXTENSIONS[extOf(name)] ?? null;
}

/** A unit of text to translate, and how to put the translation back. */
type Segment = { text: string; apply: (translated: string) => void };

export type PreparedDoc = {
  kind: DocKind;
  segments: Segment[];
  build: () => Blob;
};

// ---------------------------------------------------------------- helpers

/** Worth sending to a translator: has letters and isn't a number, URL, code or formula. */
export function isTranslatable(s: string): boolean {
  const t = s.trim();
  if (!t) return false;
  if (!/\p{L}/u.test(t)) return false;
  if (/^(https?:\/\/|www\.|mailto:)\S+$/i.test(t)) return false;
  if (/^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(t)) return false;
  if (/^[#$]?[A-Z]{1,3}\$?\d+(:\$?[A-Z]{1,3}\$?\d+)?$/.test(t)) return false; // cell refs
  if (/^[0-9a-f]{8,}$/i.test(t) || /^[0-9a-f-]{32,36}$/i.test(t)) return false; // hashes, uuids
  if (/^[A-Z0-9_]{2,}$/.test(t) && t.includes("_")) return false; // CONSTANT_KEYS
  return true;
}

function splitEdges(s: string): [string, string, string] {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s)!;
  return [m[1], m[2], m[3]];
}

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

function parseXml(xml: string): Document | null {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  return doc.getElementsByTagName("parsererror").length ? null : doc;
}

function serializeXml(doc: Document, hadDecl: boolean): string {
  const body = new XMLSerializer().serializeToString(doc);
  return (hadDecl && !body.startsWith("<?xml") ? XML_DECL : "") + body;
}

const NS = {
  w: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
  a: "http://schemas.openxmlformats.org/drawingml/2006/main",
  x: "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
  text: "urn:oasis:names:tc:opendocument:xmlns:text:1.0",
  xml: "http://www.w3.org/XML/1998/namespace",
};

/** Closest ancestor (or self) that is one of the paragraph elements. */
function owningParagraph(node: Node, isPara: (el: Element) => boolean): Element | null {
  let cur: Node | null = node.parentNode;
  while (cur && cur.nodeType === 1) {
    if (isPara(cur as Element)) return cur as Element;
    cur = cur.parentNode;
  }
  return null;
}

type Slot = { get: () => string; set: (v: string) => void };

/**
 * Generic paragraph walker for XML formats: each paragraph's text slots are joined into one
 * segment; the translation goes into the first slot and the rest are emptied, which keeps the
 * first run's formatting (font, size, colour) for the whole paragraph.
 */
function xmlParagraphSegments(
  doc: Document,
  opts: {
    isPara: (el: Element) => boolean;
    paraElements: Element[];
    slotsOf: (p: Element) => Slot[];
    output: DocOutput;
    bilingual?: (p: Element, translated: string) => void;
    onTranslated?: (p: Element) => void;
  },
): Segment[] {
  const segs: Segment[] = [];
  for (const p of opts.paraElements) {
    const slots = opts.slotsOf(p);
    if (!slots.length) continue;
    const full = slots.map((s) => s.get()).join("");
    if (!isTranslatable(full)) continue;
    const [lead, , trail] = splitEdges(full);
    segs.push({
      text: full.trim(),
      apply: (translated) => {
        const value = lead + translated.trim() + trail;
        if (opts.output === "bilingual" && opts.bilingual) {
          opts.bilingual(p, value);
          return;
        }
        slots[0].set(value);
        for (let i = 1; i < slots.length; i++) slots[i].set("");
        opts.onTranslated?.(p);
      },
    });
  }
  return segs;
}

function elementsNS(root: Document | Element, ns: string, local: string): Element[] {
  return Array.from(root.getElementsByTagNameNS(ns, local));
}

/** Text slots (w:t / a:t / t) inside a paragraph, excluding those in nested paragraphs. */
function ooxmlSlots(p: Element, ns: string, isPara: (el: Element) => boolean): Slot[] {
  return elementsNS(p, ns, "t")
    .filter((t) => owningParagraph(t, isPara) === p)
    .map((t) => ({
      get: () => t.textContent ?? "",
      set: (v: string) => {
        t.textContent = v;
        if (ns === NS.w || ns === NS.x) t.setAttributeNS(NS.xml, "xml:space", "preserve");
      },
    }));
}

/** ODF: every text node under the paragraph (spans included), except nested paragraphs and notes. */
function odfSlots(p: Element, isPara: (el: Element) => boolean): Slot[] {
  const out: Slot[] = [];
  const walker = p.ownerDocument.createTreeWalker(p, NodeFilter.SHOW_TEXT);
  let n: Node | null;
  while ((n = walker.nextNode())) {
    const node = n as Text;
    if (owningParagraph(node, isPara) !== p) continue;
    out.push({ get: () => node.data, set: (v) => (node.data = v) });
  }
  return out;
}

function cloneAfter(p: Element, translated: string, slotsOf: (el: Element) => Slot[], style?: (clone: Element) => void) {
  const clone = p.cloneNode(true) as Element;
  const slots = slotsOf(clone);
  if (!slots.length) return;
  slots[0].set(translated);
  for (let i = 1; i < slots.length; i++) slots[i].set("");
  style?.(clone);
  p.parentNode?.insertBefore(clone, p.nextSibling);
}

/** Word: grey italic runs for the translation line in bilingual output. */
function styleWordClone(clone: Element) {
  const doc = clone.ownerDocument;
  for (const r of elementsNS(clone, NS.w, "r")) {
    let rPr = Array.from(r.children).find((c) => c.localName === "rPr");
    if (!rPr) {
      rPr = doc.createElementNS(NS.w, "w:rPr");
      r.insertBefore(rPr, r.firstChild);
    }
    if (!Array.from(rPr.children).some((c) => c.localName === "i")) rPr.appendChild(doc.createElementNS(NS.w, "w:i"));
    const color = Array.from(rPr.children).find((c) => c.localName === "color") ?? rPr.appendChild(doc.createElementNS(NS.w, "w:color"));
    color.setAttributeNS(NS.w, "w:val", "2F5597");
  }
}

/** Word: mark a paragraph right-to-left (Arabic, Hebrew, Urdu…). */
function makeWordRtl(p: Element) {
  const doc = p.ownerDocument;
  let pPr = Array.from(p.children).find((c) => c.localName === "pPr");
  if (!pPr) {
    pPr = doc.createElementNS(NS.w, "w:pPr");
    p.insertBefore(pPr, p.firstChild);
  }
  if (!Array.from(pPr.children).some((c) => c.localName === "bidi")) pPr.insertBefore(doc.createElementNS(NS.w, "w:bidi"), pPr.firstChild);
  for (const r of elementsNS(p, NS.w, "r")) {
    let rPr = Array.from(r.children).find((c) => c.localName === "rPr");
    if (!rPr) {
      rPr = doc.createElementNS(NS.w, "w:rPr");
      r.insertBefore(rPr, r.firstChild);
    }
    if (!Array.from(rPr.children).some((c) => c.localName === "rtl")) rPr.appendChild(doc.createElementNS(NS.w, "w:rtl"));
  }
}

// ---------------------------------------------------------------- zip formats

type ZipPlan = {
  kind: DocKind;
  partMatch: RegExp;
  prepare: (doc: Document, output: DocOutput, rtl: boolean, path: string) => Segment[];
};

const wordPara = (el: Element) => el.namespaceURI === NS.w && el.localName === "p";
const drawPara = (el: Element) => el.namespaceURI === NS.a && el.localName === "p";
const cellPara = (el: Element) => el.namespaceURI === NS.x && (el.localName === "si" || el.localName === "is");
const odfPara = (el: Element) => el.namespaceURI === NS.text && (el.localName === "p" || el.localName === "h");

const ZIP_PLANS: Partial<Record<DocKind, ZipPlan>> = {
  docx: {
    kind: "docx",
    partMatch: /^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/,
    prepare: (doc, output, rtl) =>
      xmlParagraphSegments(doc, {
        isPara: wordPara,
        paraElements: elementsNS(doc, NS.w, "p"),
        slotsOf: (p) => ooxmlSlots(p, NS.w, wordPara),
        output,
        bilingual: (p, t) =>
          cloneAfter(p, t, (el) => ooxmlSlots(el, NS.w, wordPara), (clone) => {
            styleWordClone(clone);
            if (rtl) makeWordRtl(clone);
          }),
        onTranslated: rtl ? makeWordRtl : undefined,
      }),
  },
  pptx: {
    kind: "pptx",
    partMatch: /^ppt\/(slides\/slide\d+|notesSlides\/notesSlide\d+|diagrams\/data\d+)\.xml$/,
    prepare: (doc, output, rtl) =>
      xmlParagraphSegments(doc, {
        isPara: drawPara,
        paraElements: elementsNS(doc, NS.a, "p"),
        slotsOf: (p) => ooxmlSlots(p, NS.a, drawPara),
        output,
        bilingual: (p, t) => cloneAfter(p, t, (el) => ooxmlSlots(el, NS.a, drawPara)),
        onTranslated: rtl
          ? (p) => {
              let pPr = Array.from(p.children).find((c) => c.localName === "pPr");
              if (!pPr) {
                pPr = p.ownerDocument.createElementNS(NS.a, "a:pPr");
                p.insertBefore(pPr, p.firstChild);
              }
              pPr.setAttribute("rtl", "1");
              pPr.setAttribute("algn", "r");
            }
          : undefined,
      }),
  },
  xlsx: {
    kind: "xlsx",
    partMatch: /^xl\/(sharedStrings|worksheets\/sheet\d+)\.xml$/,
    prepare: (doc, output) =>
      xmlParagraphSegments(doc, {
        isPara: cellPara,
        paraElements: [...elementsNS(doc, NS.x, "si"), ...elementsNS(doc, NS.x, "is")],
        slotsOf: (p) => ooxmlSlots(p, NS.x, cellPara),
        output,
        bilingual: (p, t) => {
          const slots = ooxmlSlots(p, NS.x, cellPara);
          if (slots.length) slots[slots.length - 1].set(slots[slots.length - 1].get() + "\n" + t);
        },
      }),
  },
};

const odfPlan = (kind: DocKind): ZipPlan => ({
  kind,
  partMatch: /^(content|styles)\.xml$/,
  prepare: (doc, output) => {
    const paras = [...elementsNS(doc, NS.text, "p"), ...elementsNS(doc, NS.text, "h")];
    return xmlParagraphSegments(doc, {
      isPara: odfPara,
      paraElements: paras,
      slotsOf: (p) => odfSlots(p, odfPara),
      output,
      bilingual: (p, t) => cloneAfter(p, t, (el) => odfSlots(el, odfPara)),
    });
  },
});
ZIP_PLANS.odt = odfPlan("odt");
ZIP_PLANS.odp = odfPlan("odp");
ZIP_PLANS.ods = odfPlan("ods");

// ---------------------------------------------------------------- HTML

const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "CODE", "PRE", "SVG", "MATH", "KBD", "SAMP", "VAR", "TEMPLATE", "TEXTAREA"]);

/** Text nodes and translatable attributes of an HTML/XHTML document. */
function htmlSegments(doc: Document, targetLang: string, rtl: boolean): Segment[] {
  const segs: Segment[] = [];
  const root = doc.body ?? doc.documentElement;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      let el = node.parentElement;
      while (el) {
        if (SKIP_TAGS.has(el.tagName.toUpperCase()) || el.getAttribute("translate") === "no" || el.classList.contains("notranslate")) {
          return NodeFilter.FILTER_REJECT;
        }
        el = el.parentElement;
      }
      return isTranslatable((node as Text).data) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  let n: Node | null;
  while ((n = walker.nextNode())) {
    const node = n as Text;
    const [lead, core, trail] = splitEdges(node.data.replace(/\s+/g, " "));
    segs.push({ text: core, apply: (t) => (node.data = lead + t.trim() + trail) });
  }
  const attrEls = (doc.documentElement ?? doc).querySelectorAll("[alt],[title],[placeholder],[aria-label],meta[name=description],meta[property='og:title'],meta[property='og:description']");
  attrEls.forEach((el) => {
    const attrs = el.tagName.toUpperCase() === "META" ? ["content"] : ["alt", "title", "placeholder", "aria-label"];
    for (const a of attrs) {
      const v = el.getAttribute(a);
      if (v && isTranslatable(v)) segs.push({ text: v.trim(), apply: (t) => el.setAttribute(a, t.trim()) });
    }
  });
  const title = doc.querySelector("title");
  if (title && isTranslatable(title.textContent ?? "") && !segs.some((s) => s.text === title.textContent?.trim())) {
    segs.push({ text: (title.textContent ?? "").trim(), apply: (t) => (title.textContent = t) });
  }
  const html = doc.documentElement;
  if (html) {
    html.setAttribute("lang", targetLang);
    if (rtl) html.setAttribute("dir", "rtl");
    else html.removeAttribute("dir");
  }
  return segs;
}

// ---------------------------------------------------------------- text formats

function linesFormat(text: string, output: DocOutput, opts: { markdown?: boolean } = {}): { segments: Segment[]; build: () => string } {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const outLines: string[][] = lines.map((l) => [l]);
  const segments: Segment[] = [];
  let inFence = false;
  lines.forEach((line, i) => {
    if (opts.markdown && /^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    let prefix = "";
    let body = line;
    if (opts.markdown) {
      if (/^\s*([-*_]\s*){3,}$/.test(line) || /^\s*\|?\s*:?-{3,}/.test(line)) return; // rules, table separators
      const m = /^(\s*(?:#{1,6}\s+|>\s*|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)*)([\s\S]*)$/.exec(line)!;
      prefix = m[1];
      body = m[2];
      if (/^\s*\|.*\|\s*$/.test(body)) {
        // table row: translate each cell
        const cells = body.split("|");
        cells.forEach((cell, ci) => {
          if (!isTranslatable(cell)) return;
          const [lead, core, trail] = splitEdges(cell);
          segments.push({
            text: core,
            apply: (t) => {
              cells[ci] = lead + t.trim() + trail;
              outLines[i] = [prefix + cells.join("|")];
            },
          });
        });
        return;
      }
    }
    if (!isTranslatable(body)) return;
    const [lead, core, trail] = splitEdges(body);
    segments.push({
      text: core,
      apply: (t) => {
        const translatedLine = prefix + lead + t.trim() + trail;
        outLines[i] = output === "bilingual" ? [line, translatedLine] : [translatedLine];
      },
    });
  });
  return { segments, build: () => outLines.flat().join("\n") };
}

function subtitleFormat(text: string, output: DocOutput): { segments: Segment[]; build: () => string } {
  const blocks = text.replace(/﻿/g, "").replace(/\r\n?/g, "\n").split(/\n{2,}/);
  const out = [...blocks];
  const segments: Segment[] = [];
  blocks.forEach((block, bi) => {
    const lines = block.split("\n");
    const ts = lines.findIndex((l) => l.includes("-->"));
    if (ts === -1) return;
    const payload = lines.slice(ts + 1).filter((l) => l.trim());
    const joined = payload.join(" ").trim();
    if (!isTranslatable(joined.replace(/<[^>]+>/g, ""))) return;
    segments.push({
      text: joined,
      apply: (t) => {
        const head = lines.slice(0, ts + 1);
        out[bi] = [...head, ...(output === "bilingual" ? [...payload, t.trim()] : [t.trim()])].join("\n");
      },
    });
  });
  return { segments, build: () => out.join("\n\n") + "\n" };
}

/** RFC 4180-ish CSV/TSV reader and writer that round-trips quoting. */
export function parseDelimited(text: string, delim: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"' && cell === "") quoted = true;
    else if (c === delim) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

export function writeDelimited(rows: string[][], delim: string): string {
  return rows
    .map((r) => r.map((c) => (c.includes(delim) || c.includes('"') || c.includes("\n") || c.includes("\r") ? `"${c.replace(/"/g, '""')}"` : c)).join(delim))
    .join("\r\n");
}

function delimitedFormat(text: string, delim: string, output: DocOutput): { segments: Segment[]; build: () => string } {
  const rows = parseDelimited(text.replace(/^﻿/, ""), delim);
  const segments: Segment[] = [];
  rows.forEach((row, ri) =>
    row.forEach((cell, ci) => {
      if (!isTranslatable(cell) || /^[\d\s.,%$€£₹+-]+$/.test(cell)) return;
      segments.push({
        text: cell.trim(),
        apply: (t) => {
          rows[ri][ci] = output === "bilingual" ? `${cell}\n${t.trim()}` : t.trim();
        },
      });
    }),
  );
  return { segments, build: () => "﻿" + writeDelimited(rows, delim) };
}

function jsonFormat(text: string): { segments: Segment[]; build: () => string } {
  const data = JSON.parse(text) as unknown;
  const segments: Segment[] = [];
  const indent = /^\s*[[{]\s*\n(\s+)/.exec(text)?.[1] ?? "  ";
  const walk = (node: unknown, setter: (v: unknown) => void, key?: string) => {
    if (typeof node === "string") {
      if (key && key.startsWith("@")) return; // ARB metadata
      if (!isTranslatable(node) || /^[a-z][\w.-]*\.[a-z]{2,4}$/i.test(node) || /^#[0-9a-f]{3,8}$/i.test(node)) return;
      const [lead, core, trail] = splitEdges(node);
      segments.push({ text: core, apply: (t) => setter(lead + t.trim() + trail) });
    } else if (Array.isArray(node)) {
      node.forEach((v, i) => walk(v, (nv) => (node[i] = nv)));
    } else if (node && typeof node === "object") {
      const obj = node as Record<string, unknown>;
      for (const k of Object.keys(obj)) walk(obj[k], (nv) => (obj[k] = nv), k);
    }
  };
  let root = data;
  walk(data, (v) => (root = v));
  return { segments, build: () => JSON.stringify(root, null, indent) + "\n" };
}

function poUnquote(lines: string[]): string {
  return lines
    .map((l) => /^"(.*)"\s*$/.exec(l.trim())?.[1] ?? "")
    .join("")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

function poQuote(s: string): string {
  const esc = s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\t/g, "\\t");
  const parts = esc.split("\n");
  if (parts.length === 1) return `"${esc}"`;
  return ['""', ...parts.map((p, i) => `"${p}${i < parts.length - 1 ? "\\n" : ""}"`).filter((x) => x !== '""')].join("\n");
}

function poFormat(text: string): { segments: Segment[]; build: () => string } {
  const entries = text.replace(/\r\n?/g, "\n").split(/\n{2,}/);
  const out = [...entries];
  const segments: Segment[] = [];
  entries.forEach((entry, ei) => {
    const lines = entry.split("\n");
    const field = (name: string): { start: number; end: number } | null => {
      const start = lines.findIndex((l) => l.startsWith(name + " "));
      if (start === -1) return null;
      let end = start + 1;
      while (end < lines.length && lines[end].trim().startsWith('"')) end++;
      return { start, end };
    };
    const id = field("msgid");
    if (!id) return;
    const msgid = poUnquote([lines[id.start].slice(6), ...lines.slice(id.start + 1, id.end)]);
    if (!msgid) return; // header
    const plural = field("msgid_plural");
    const msgidPlural = plural ? poUnquote([lines[plural.start].slice(13), ...lines.slice(plural.start + 1, plural.end)]) : "";
    const translations: Record<string, string> = {};
    const rebuild = () => {
      // msgstr lines always close a PO entry, so everything before the first one is kept.
      const firstStr = lines.findIndex((l) => /^msgstr(\[\d+\])? /.test(l));
      const kept = firstStr >= 0 ? lines.slice(0, firstStr) : lines;
      const strs = plural
        ? [0, 1].map((n) => `msgstr[${n}] ${poQuote(translations[n === 0 ? "s" : "p"] ?? translations.s ?? "")}`)
        : [`msgstr ${poQuote(translations.s ?? "")}`];
      out[ei] = [...kept, ...strs].join("\n");
    };
    if (isTranslatable(msgid)) segments.push({ text: msgid, apply: (t) => ((translations.s = t), rebuild()) });
    if (plural && isTranslatable(msgidPlural)) segments.push({ text: msgidPlural, apply: (t) => ((translations.p = t), rebuild()) });
  });
  return { segments, build: () => out.join("\n\n") };
}

function xliffFormat(text: string, targetLang: string): { segments: Segment[]; build: () => string } {
  const doc = parseXml(text);
  if (!doc) throw new Error("That XLIFF file isn't valid XML.");
  const root = doc.documentElement;
  const v2 = root.getAttribute("version")?.startsWith("2");
  const segments: Segment[] = [];
  if (v2) root.setAttribute("trgLang", targetLang);
  else Array.from(doc.getElementsByTagName("file")).forEach((f) => f.setAttribute("target-language", targetLang));
  const units = Array.from(doc.getElementsByTagName(v2 ? "segment" : "trans-unit"));
  for (const unit of units) {
    const src = Array.from(unit.children).find((c) => c.localName === "source");
    if (!src) continue;
    const text = src.textContent ?? "";
    if (!isTranslatable(text)) continue;
    segments.push({
      text: text.trim(),
      apply: (t) => {
        let tgt = Array.from(unit.children).find((c) => c.localName === "target");
        if (!tgt) {
          tgt = doc.createElementNS(src.namespaceURI, "target");
          unit.insertBefore(tgt, src.nextSibling);
        }
        tgt.textContent = t.trim();
        if (!v2) tgt.setAttribute("state", "translated");
      },
    });
  }
  return { segments, build: () => serializeXml(doc, text.trimStart().startsWith("<?xml")) };
}

// ---------------------------------------------------------------- prepare

export async function prepareDocument(
  bytes: Uint8Array,
  kind: DocKind,
  opts: { output: DocOutput; targetLang: string; rtl: boolean },
): Promise<PreparedDoc> {
  const { output, targetLang, rtl } = opts;
  const text = () => strFromU8(bytes);

  if (kind === "epub" || ZIP_PLANS[kind]) {
    const files = unzipSync(bytes);
    const segments: Segment[] = [];
    const docs: { path: string; doc: Document; hadDecl: boolean; html: boolean }[] = [];
    for (const [path, data] of Object.entries(files)) {
      if (kind === "epub") {
        if (!/\.(x?html?|xhtml)$/i.test(path)) continue;
        const raw = strFromU8(data);
        const doc = new DOMParser().parseFromString(raw, "application/xhtml+xml");
        if (doc.getElementsByTagName("parsererror").length) continue;
        segments.push(...htmlSegments(doc, targetLang, rtl));
        docs.push({ path, doc, hadDecl: raw.trimStart().startsWith("<?xml"), html: true });
        continue;
      }
      const plan = ZIP_PLANS[kind]!;
      if (!plan.partMatch.test(path)) continue;
      const raw = strFromU8(data);
      const doc = parseXml(raw);
      if (!doc) continue;
      segments.push(...plan.prepare(doc, output, rtl, path));
      docs.push({ path, doc, hadDecl: raw.trimStart().startsWith("<?xml"), html: false });
    }
    return {
      kind,
      segments,
      build: () => {
        const outFiles: Zippable = {};
        // mimetype must stay first and uncompressed (ODF, EPUB).
        if (files.mimetype) outFiles.mimetype = [files.mimetype, { level: 0 }];
        for (const [path, data] of Object.entries(files)) {
          if (path === "mimetype") continue;
          const changed = docs.find((d) => d.path === path);
          outFiles[path] = changed ? strToU8(serializeXml(changed.doc, changed.hadDecl)) : data;
        }
        return new Blob([zipSync(outFiles, { level: 6 }) as BlobPart], { type: MIME[kind] });
      },
    };
  }

  if (kind === "html") {
    const raw = text();
    const doc = new DOMParser().parseFromString(raw, "text/html");
    const segments = htmlSegments(doc, targetLang, rtl);
    const doctype = /^\s*<!doctype[^>]*>/i.exec(raw)?.[0] ?? "<!DOCTYPE html>";
    return { kind, segments, build: () => new Blob([doctype + "\n" + doc.documentElement.outerHTML], { type: MIME.html }) };
  }

  const wrap = (f: { segments: Segment[]; build: () => string }): PreparedDoc => ({
    kind,
    segments: f.segments,
    build: () => new Blob([f.build()], { type: `${MIME[kind]};charset=utf-8` }),
  });
  switch (kind) {
    case "md":
      return wrap(linesFormat(text(), output, { markdown: true }));
    case "txt":
      return wrap(linesFormat(text(), output));
    case "srt":
    case "vtt":
      return wrap(subtitleFormat(text(), output));
    case "csv":
      return wrap(delimitedFormat(text(), detectCsvDelimiter(text()), output));
    case "tsv":
      return wrap(delimitedFormat(text(), "\t", output));
    case "json":
      return wrap(jsonFormat(text()));
    case "po":
      return wrap(poFormat(text()));
    case "xliff":
      return wrap(xliffFormat(text(), targetLang));
    default:
      throw new Error("That file type can't be translated yet.");
  }
}

function detectCsvDelimiter(text: string): string {
  const head = text.split(/\r?\n/).slice(0, 5).join("\n");
  const counts = [",", ";", "\t", "|"].map((d) => [d, head.split(d).length] as const);
  return counts.sort((a, b) => b[1] - a[1])[0][0];
}

// ---------------------------------------------------------------- run

/** Markdown links/images and inline code also stay untouched. */
const MD_PROTECT: RegExp[] = [...DEFAULT_PROTECT_PATTERNS, /\]\([^)\s]+(?:\s+"[^"]*")?\)/g, /!\[[^\]]*\]/g, /<[^>]+>/g];

export type DocProgress = { done: number; total: number; phase: "converting" | "reading" | "translating" | "building" };

export type TranslatedDoc = {
  blob: Blob;
  name: string;
  kind: DocKind;
  segments: number;
  pairs: { source: string; translated: string }[];
  detected: string;
  convertedFrom?: string;
};

/** Runs the whole pipeline for one file. */
export async function translateDocument(
  file: File,
  opts: {
    source: string;
    target: string;
    output: DocOutput;
    rtl: boolean;
    glossary?: GlossaryRule[];
    signal?: AbortSignal;
    onProgress?: (p: DocProgress) => void;
  },
): Promise<TranslatedDoc> {
  const ext = extOf(file.name);
  let kind = DOC_EXTENSIONS[ext] ?? null;
  let bytes: Uint8Array;
  let convertedFrom: string | undefined;
  const baseName = file.name.replace(/\.[^.]+$/, "");
  let outExt = ext;

  if (!kind && CONVERT_FIRST[ext]) {
    const plan = CONVERT_FIRST[ext];
    opts.onProgress?.({ done: 0, total: 1, phase: "converting" });
    const form = new FormData();
    form.append("file", file, file.name);
    form.append("target", plan.to);
    const converted = await uploadForm("/api/tools/universal/convert", form, { signal: opts.signal, fallbackName: `${baseName}.${plan.to}` });
    bytes = new Uint8Array(await converted.blob.arrayBuffer());
    kind = plan.kind;
    outExt = plan.to;
    convertedFrom = ext.toUpperCase();
  } else if (kind) {
    bytes = new Uint8Array(await file.arrayBuffer());
  } else {
    throw new Error("That file type isn't supported. Try Word, PowerPoint, Excel, PDF, HTML, Markdown, text, subtitles, JSON, PO or XLIFF.");
  }

  opts.onProgress?.({ done: 0, total: 1, phase: "reading" });
  const prepared = await prepareDocument(bytes, kind, { output: opts.output, targetLang: opts.target, rtl: opts.rtl });
  if (!prepared.segments.length) throw new Error("There's no text in that file to translate.");

  // Unique lines only (repeated headers, table labels…), with line breaks kept by translating lines.
  const unique: string[] = [];
  const index = new Map<string, number>();
  const lineMap = prepared.segments.map((s) =>
    s.text.split("\n").map((line) => {
      const key = line.trim();
      if (!key) return -1;
      if (!index.has(key)) {
        index.set(key, unique.length);
        unique.push(key);
      }
      return index.get(key)!;
    }),
  );

  const translatedUnique: string[] = new Array(unique.length).fill("");
  const total = unique.length;
  let detected = opts.source;
  let done = 0;
  const patterns = kind === "md" ? MD_PROTECT : DEFAULT_PROTECT_PATTERNS;
  const batches: number[][] = [];
  let cur: number[] = [];
  let chars = 0;
  unique.forEach((u, i) => {
    if (cur.length && (cur.length >= 120 || chars + u.length > 12_000)) {
      batches.push(cur);
      cur = [];
      chars = 0;
    }
    cur.push(i);
    chars += u.length + 1;
  });
  if (cur.length) batches.push(cur);

  opts.onProgress?.({ done: 0, total, phase: "translating" });
  for (const batch of batches) {
    if (opts.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    const texts = batch.map((i) => unique[i].slice(0, 4500));
    const res = await smartTranslateBatch(texts, detected === "auto" ? "auto" : detected, opts.target, {
      glossary: opts.glossary,
      signal: opts.signal,
      protectPatterns: patterns,
    });
    if (detected === "auto" && res.detected_language && res.detected_language !== "auto") detected = res.detected_language;
    res.translated_texts.forEach((t, k) => (translatedUnique[batch[k]] = t));
    done += batch.length;
    opts.onProgress?.({ done, total, phase: "translating" });
  }

  opts.onProgress?.({ done: total, total, phase: "building" });
  const pairs: { source: string; translated: string }[] = [];
  prepared.segments.forEach((seg, si) => {
    const lines = seg.text.split("\n");
    const out = lines.map((line, li) => (lineMap[si][li] >= 0 ? translatedUnique[lineMap[si][li]] : line)).join("\n");
    seg.apply(out);
    if (pairs.length < 400) pairs.push({ source: seg.text, translated: out });
  });

  const blob = prepared.build();
  const suffix = opts.output === "bilingual" ? `${opts.target}-bilingual` : opts.target;
  return {
    blob,
    name: `${baseName}.${suffix}.${outExt}`,
    kind,
    segments: prepared.segments.length,
    pairs,
    detected,
    convertedFrom,
  };
}

/**
 * Translates an HTML fragment in place (text nodes and alt/title attributes), keeping all markup.
 * Used by the Word editor's Translate command.
 */
export async function translateHtmlFragment(
  html: string,
  source: string,
  target: string,
  opts: { rtl?: boolean; glossary?: GlossaryRule[]; signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {},
): Promise<{ html: string; detected: string }> {
  const doc = new DOMParser().parseFromString(`<!DOCTYPE html><html><body>${html}</body></html>`, "text/html");
  const segs = htmlSegments(doc, target, Boolean(opts.rtl));
  const texts = segs.map((s) => s.text);
  let detected = source;
  const out: string[] = new Array(texts.length).fill("");
  for (let i = 0; i < texts.length; i += 120) {
    if (opts.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    const res = await smartTranslateBatch(texts.slice(i, i + 120), detected, target, { glossary: opts.glossary, signal: opts.signal });
    if (detected === "auto" && res.detected_language) detected = res.detected_language;
    res.translated_texts.forEach((t, k) => (out[i + k] = t));
    opts.onProgress?.(Math.min(texts.length, i + 120), texts.length);
  }
  segs.forEach((s, i) => s.apply(out[i] || s.text));
  return { html: doc.body.innerHTML, detected };
}
