/**
 * DOCX (Office Open XML) import and export for the Word editor, written against the spec with
 * fflate. Export walks the editor's HTML; import turns document.xml back into that HTML.
 *
 * Kept: paragraph styles (Title, Subtitle, Heading 1–6, Quote, Code), fonts, sizes, colours,
 * highlight, bold/italic/underline/strike, sub/superscript, alignment, indents, line spacing,
 * bulleted/numbered/nested lists, tables (header shading, colspan, cell fills), images,
 * hyperlinks, page breaks, page size/orientation/margins/columns, header and footer with page numbers.
 */
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import { DEFAULT_PAGE, MM_TO_TWIP, PAGE_MM, type PageSetup, type WordDoc } from "./model";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

// ===================================================================== export

type RunFmt = {
  b?: boolean;
  i?: boolean;
  u?: boolean;
  strike?: boolean;
  sub?: boolean;
  sup?: boolean;
  color?: string;
  highlight?: string;
  font?: string;
  sizePt?: number;
  code?: boolean;
  caps?: boolean;
};

function cssColorToHex(c: string | null | undefined): string | undefined {
  if (!c) return undefined;
  const s = c.trim().toLowerCase();
  if (!s || s === "transparent" || s === "inherit" || s === "initial") return undefined;
  if (s.startsWith("#")) {
    const h = s.slice(1);
    return (h.length === 3 ? h.split("").map((x) => x + x).join("") : h.slice(0, 6)).toUpperCase();
  }
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(s);
  if (m) {
    if (m[4] !== undefined && Number(m[4]) === 0) return undefined;
    return [m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, "0")).join("").toUpperCase();
  }
  const named: Record<string, string> = { black: "000000", white: "FFFFFF", red: "FF0000", blue: "0000FF", green: "008000", yellow: "FFFF00", orange: "FFA500", purple: "800080", gray: "808080", grey: "808080" };
  return named[s];
}

/** CSS font-size (pt, px, or the legacy 1–7 scale of <font size>) to points. */
function fontSizePt(v: string | null | undefined): number | undefined {
  if (!v) return undefined;
  const m = /([\d.]+)(pt|px|em|rem)?/.exec(v);
  if (!m) return undefined;
  const n = Number(m[1]);
  if (m[2] === "px") return Math.round(n * 0.75 * 2) / 2;
  if (m[2] === "em" || m[2] === "rem") return Math.round(n * 11 * 2) / 2;
  return n;
}
const LEGACY_SIZES = [0, 7.5, 10, 12, 13.5, 18, 24, 36];

function runProps(f: RunFmt): string {
  const p: string[] = [];
  if (f.code) p.push('<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>');
  else if (f.font) p.push(`<w:rFonts w:ascii="${esc(f.font)}" w:hAnsi="${esc(f.font)}" w:cs="${esc(f.font)}" w:eastAsia="${esc(f.font)}"/>`);
  if (f.b) p.push("<w:b/><w:bCs/>");
  if (f.i) p.push("<w:i/><w:iCs/>");
  if (f.caps) p.push("<w:caps/>");
  if (f.strike) p.push("<w:strike/>");
  if (f.color) p.push(`<w:color w:val="${f.color}"/>`);
  if (f.sizePt) p.push(`<w:sz w:val="${Math.round(f.sizePt * 2)}"/><w:szCs w:val="${Math.round(f.sizePt * 2)}"/>`);
  if (f.highlight) p.push(`<w:shd w:val="clear" w:color="auto" w:fill="${f.highlight}"/>`);
  if (f.u) p.push('<w:u w:val="single"/>');
  if (f.sub) p.push('<w:vertAlign w:val="subscript"/>');
  if (f.sup) p.push('<w:vertAlign w:val="superscript"/>');
  return p.length ? `<w:rPr>${p.join("")}</w:rPr>` : "";
}

type Ctx = {
  rels: string[];
  media: Record<string, Uint8Array>;
  numbering: { abstract: string[]; nums: string[] };
  imageId: number;
  docPrId: number;
};

function addRel(ctx: Ctx, type: string, target: string, external = false): string {
  const id = `rId${ctx.rels.length + 10}`;
  ctx.rels.push(`<Relationship Id="${id}" Type="${type}" Target="${esc(target)}"${external ? ' TargetMode="External"' : ""}/>`);
  return id;
}

function dataUrlBytes(src: string): { bytes: Uint8Array; ext: string } | null {
  const m = /^data:image\/(png|jpe?g|gif|webp|bmp|svg\+xml);base64,(.+)$/i.exec(src);
  if (!m) return null;
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const ext = m[1].toLowerCase().replace("jpeg", "jpg").replace("svg+xml", "svg");
  return { bytes, ext };
}

function imageRun(ctx: Ctx, img: HTMLImageElement, maxWidthPx: number): string {
  const data = dataUrlBytes(img.getAttribute("src") ?? "");
  if (!data || data.ext === "svg" || data.ext === "webp") return ""; // Word can't show these inline reliably
  ctx.imageId++;
  const name = `image${ctx.imageId}.${data.ext}`;
  ctx.media[`word/media/${name}`] = data.bytes;
  const rid = addRel(ctx, "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image", `media/${name}`);
  let w = Number(img.getAttribute("width")) || img.naturalWidth || parseFloat(img.style.width) || 300;
  let h = Number(img.getAttribute("height")) || img.naturalHeight || 200;
  if (img.style.width.endsWith("%")) w = (maxWidthPx * parseFloat(img.style.width)) / 100;
  if (img.naturalWidth && img.naturalHeight) h = (w * img.naturalHeight) / img.naturalWidth;
  if (w > maxWidthPx) {
    h = (h * maxWidthPx) / w;
    w = maxWidthPx;
  }
  const cx = Math.round(w * 9525);
  const cy = Math.round(h * 9525);
  const id = ctx.docPrId++;
  const alt = esc(img.getAttribute("alt") ?? "");
  return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="Picture ${id}" descr="${alt}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="${name}" descr="${alt}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}

function inlineRuns(node: Node, fmt: RunFmt, ctx: Ctx, maxImgPx: number): string {
  let out = "";
  node.childNodes.forEach((ch) => {
    if (ch.nodeType === 3) {
      const text = (ch as Text).data.replace(/\s+/g, " ");
      if (!text) return;
      out += `<w:r>${runProps(fmt)}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
      return;
    }
    if (ch.nodeType !== 1) return;
    const el = ch as HTMLElement;
    const tag = el.tagName;
    if (tag === "BR") {
      out += "<w:r><w:br/></w:r>";
      return;
    }
    if (tag === "IMG") {
      out += imageRun(ctx, el as HTMLImageElement, maxImgPx);
      return;
    }
    if (el.classList.contains("math")) {
      out += `<w:r>${runProps({ ...fmt, i: true, font: "Cambria Math" })}<w:t xml:space="preserve">${esc(el.getAttribute("data-latex") ?? el.textContent ?? "")}</w:t></w:r>`;
      return;
    }
    const f: RunFmt = { ...fmt };
    if (tag === "B" || tag === "STRONG") f.b = true;
    if (tag === "I" || tag === "EM") f.i = true;
    if (tag === "U" || tag === "INS") f.u = true;
    if (tag === "S" || tag === "STRIKE" || tag === "DEL") f.strike = true;
    if (tag === "SUB") f.sub = true;
    if (tag === "SUP") f.sup = true;
    if (tag === "CODE" || tag === "KBD") f.code = true;
    if (tag === "MARK") f.highlight = cssColorToHex(el.style.backgroundColor) ?? "FFFF00";
    if (tag === "FONT") {
      const face = el.getAttribute("face");
      if (face) f.font = face.split(",")[0].replace(/["']/g, "").trim();
      const col = cssColorToHex(el.getAttribute("color"));
      if (col) f.color = col;
      const sz = Number(el.getAttribute("size"));
      if (sz) f.sizePt = LEGACY_SIZES[Math.max(1, Math.min(7, sz))];
    }
    const st = el.style;
    if (st.fontWeight === "bold" || Number(st.fontWeight) >= 600) f.b = true;
    if (st.fontStyle === "italic") f.i = true;
    if (st.textDecoration.includes("underline") || st.textDecorationLine?.includes("underline")) f.u = true;
    if (st.textDecoration.includes("line-through") || st.textDecorationLine?.includes("line-through")) f.strike = true;
    if (st.textTransform === "uppercase") f.caps = true;
    const col = cssColorToHex(st.color);
    if (col) f.color = col;
    const bg = cssColorToHex(st.backgroundColor);
    if (bg) f.highlight = bg;
    if (st.fontFamily) f.font = st.fontFamily.split(",")[0].replace(/["']/g, "").trim();
    const sz = fontSizePt(st.fontSize);
    if (sz) f.sizePt = sz;
    if (st.verticalAlign === "sub") f.sub = true;
    if (st.verticalAlign === "super") f.sup = true;
    if (tag === "A") {
      const href = el.getAttribute("href") ?? "";
      const inner = inlineRuns(el, { ...f, color: f.color ?? "0563C1", u: true }, ctx, maxImgPx);
      if (href.startsWith("#")) {
        out += `<w:hyperlink w:anchor="${esc(href.slice(1))}">${inner}</w:hyperlink>`;
        return;
      }
      if (!/^(https?:|mailto:|tel:)/i.test(href)) {
        out += inner;
        return;
      }
      const rid = addRel(ctx, "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink", href, true);
      out += `<w:hyperlink r:id="${rid}">${inner}</w:hyperlink>`;
      return;
    }
    out += inlineRuns(el, f, ctx, maxImgPx);
  });
  return out;
}

function paraProps(el: HTMLElement, opts: { style?: string; numId?: number; ilvl?: number; inheritAlign?: string } = {}): string {
  const p: string[] = [];
  if (opts.style) p.push(`<w:pStyle w:val="${opts.style}"/>`);
  if (opts.numId !== undefined) p.push(`<w:numPr><w:ilvl w:val="${opts.ilvl ?? 0}"/><w:numId w:val="${opts.numId}"/></w:numPr>`);
  const st = el.style;
  const align = st.textAlign || el.getAttribute("align") || opts.inheritAlign;
  const ml = parseFloat(st.marginLeft || st.paddingLeft || "0");
  const ti = parseFloat(st.textIndent || "0");
  if (el.getAttribute("dir") === "rtl" || st.direction === "rtl") p.push("<w:bidi/>");
  const lh = parseFloat(st.lineHeight);
  const before = st.marginTop ? fontSizePt(st.marginTop) : undefined;
  const after = st.marginBottom ? fontSizePt(st.marginBottom) : undefined;
  if (lh || before !== undefined || after !== undefined) {
    p.push(`<w:spacing${before !== undefined ? ` w:before="${Math.round(before * 20)}"` : ""}${after !== undefined ? ` w:after="${Math.round(after * 20)}"` : ""}${lh && !st.lineHeight.endsWith("px") && !st.lineHeight.endsWith("pt") ? ` w:line="${Math.round(lh * 240)}" w:lineRule="auto"` : ""}/>`);
  }
  if (ml || ti) p.push(`<w:ind${ml ? ` w:left="${Math.round(ml * 15)}"` : ""}${ti ? ` w:firstLine="${Math.round(ti * 15)}"` : ""}/>`);
  const map: Record<string, string> = { left: "left", center: "center", right: "right", justify: "both", start: "left", end: "right" };
  if (align && map[align]) p.push(`<w:jc w:val="${map[align]}"/>`);
  return p.length ? `<w:pPr>${p.join("")}</w:pPr>` : "";
}

function listNum(ctx: Ctx, ordered: boolean, olType?: string): number {
  const absId = ctx.numbering.abstract.length;
  const lvls = Array.from({ length: 9 }, (_, i) => {
    const indent = 720 * (i + 1);
    if (!ordered) {
      const ch = ["•", "◦", "▪"][i % 3];
      return `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="${ch}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${indent}" w:hanging="360"/></w:pPr><w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Arial" w:hint="default"/></w:rPr></w:lvl>`.replace('w:ascii="Symbol" ', "");
    }
    const fmts = olType === "a" ? ["lowerLetter", "lowerRoman", "decimal"] : olType === "A" ? ["upperLetter", "decimal", "lowerLetter"] : olType === "i" ? ["lowerRoman", "decimal", "lowerLetter"] : olType === "I" ? ["upperRoman", "upperLetter", "decimal"] : ["decimal", "lowerLetter", "lowerRoman"];
    return `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${fmts[i % 3]}"/><w:lvlText w:val="%${i + 1}."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${indent}" w:hanging="360"/></w:pPr></w:lvl>`;
  }).join("");
  ctx.numbering.abstract.push(`<w:abstractNum w:abstractNumId="${absId}"><w:multiLevelType w:val="hybridMultilevel"/>${lvls}</w:abstractNum>`);
  const numId = ctx.numbering.nums.length + 1;
  ctx.numbering.nums.push(`<w:num w:numId="${numId}"><w:abstractNumId w:val="${absId}"/></w:num>`);
  return numId;
}

function blocks(container: Element, ctx: Ctx, maxImgPx: number, inheritedNum?: { numId: number; level: number }): string {
  let out = "";
  const emptyPara = '<w:p/>';
  container.childNodes.forEach((node) => {
    if (node.nodeType === 3) {
      const t = (node as Text).data;
      if (t.trim()) out += `<w:p>${inlineRuns({ childNodes: [node] } as unknown as Node, {}, ctx, maxImgPx)}</w:p>`;
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as HTMLElement;
    const tag = el.tagName;
    if (el.classList.contains("page-break")) {
      out += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
      return;
    }
    if (el.classList.contains("toc")) {
      out += `<w:p><w:pPr><w:pStyle w:val="TOCHeading"/></w:pPr><w:r><w:t>Contents</w:t></w:r></w:p>`;
      el.querySelectorAll("p").forEach((p) => {
        const lvl = Number(p.getAttribute("data-level") ?? 1);
        out += `<w:p><w:pPr><w:pStyle w:val="TOC${lvl}"/><w:ind w:left="${(lvl - 1) * 360}"/></w:pPr>${inlineRuns(p, {}, ctx, maxImgPx)}</w:p>`;
      });
      return;
    }
    switch (tag) {
      case "H1":
      case "H2":
      case "H3":
      case "H4":
      case "H5":
      case "H6": {
        const style = el.classList.contains("doc-title") ? "Title" : `Heading${tag[1]}`;
        const bm = el.id ? `<w:bookmarkStart w:id="${ctx.docPrId}" w:name="${esc(el.id)}"/><w:bookmarkEnd w:id="${ctx.docPrId++}"/>` : "";
        out += `<w:p>${paraProps(el, { style })}${bm}${inlineRuns(el, {}, ctx, maxImgPx)}</w:p>`;
        return;
      }
      case "P":
      case "DIV": {
        if (Array.from(el.children).some((c) => /^(P|H\d|UL|OL|TABLE|BLOCKQUOTE|PRE|DIV)$/.test(c.tagName))) {
          out += blocks(el, ctx, maxImgPx);
          return;
        }
        const style = el.classList.contains("doc-subtitle") ? "Subtitle" : undefined;
        out += `<w:p>${paraProps(el, { style })}${inlineRuns(el, {}, ctx, maxImgPx)}</w:p>`;
        return;
      }
      case "BLOCKQUOTE":
        if (Array.from(el.children).some((c) => /^(P|UL|OL)$/.test(c.tagName))) {
          el.querySelectorAll(":scope > *").forEach((c) => (out += `<w:p>${paraProps(c as HTMLElement, { style: "Quote" })}${inlineRuns(c, {}, ctx, maxImgPx)}</w:p>`));
        } else out += `<w:p>${paraProps(el, { style: "Quote" })}${inlineRuns(el, {}, ctx, maxImgPx)}</w:p>`;
        return;
      case "PRE":
        (el.textContent ?? "").split("\n").forEach((line) => (out += `<w:p><w:pPr><w:pStyle w:val="Code"/></w:pPr><w:r><w:t xml:space="preserve">${esc(line)}</w:t></w:r></w:p>`));
        return;
      case "HR":
        out += '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="A6A6A6"/></w:pBdr></w:pPr></w:p>';
        return;
      case "UL":
      case "OL": {
        const numId = inheritedNum && inheritedNum.level >= 0 ? inheritedNum.numId : listNum(ctx, tag === "OL", el.getAttribute("type") ?? undefined);
        const level = inheritedNum ? inheritedNum.level + 1 : 0;
        const checklist = el.classList.contains("checklist");
        el.querySelectorAll(":scope > li").forEach((li) => {
          const liEl = li as HTMLElement;
          const clone = liEl.cloneNode(true) as HTMLElement;
          clone.querySelectorAll(":scope > ul, :scope > ol").forEach((n) => n.remove());
          const box = checklist ? `<w:r><w:t xml:space="preserve">${liEl.getAttribute("data-checked") === "true" ? "☑" : "☐"} </w:t></w:r>` : "";
          out += `<w:p>${checklist ? paraProps(liEl) : paraProps(liEl, { style: "ListParagraph", numId, ilvl: level })}${box}${inlineRuns(clone, {}, ctx, maxImgPx)}</w:p>`;
          liEl.querySelectorAll(":scope > ul, :scope > ol").forEach((sub) => {
            const wrap = document.createElement("div");
            wrap.appendChild(sub.cloneNode(true));
            out += blocks(wrap, ctx, maxImgPx, { numId: sub.tagName === liEl.parentElement?.tagName ? numId : listNum(ctx, sub.tagName === "OL"), level });
          });
        });
        return;
      }
      case "TABLE": {
        const rows = Array.from(el.querySelectorAll(":scope > tbody > tr, :scope > thead > tr, :scope > tr")) as HTMLTableRowElement[];
        const cols = Math.max(1, ...rows.map((r) => Array.from(r.cells).reduce((n, c) => n + (c.colSpan || 1), 0)));
        const total = Math.round(maxImgPx * 15);
        const colW = Math.floor(total / cols);
        out += `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="5000" w:type="pct"/><w:tblBorders><w:top w:val="single" w:sz="4" w:color="BFBFBF"/><w:left w:val="single" w:sz="4" w:color="BFBFBF"/><w:bottom w:val="single" w:sz="4" w:color="BFBFBF"/><w:right w:val="single" w:sz="4" w:color="BFBFBF"/><w:insideH w:val="single" w:sz="4" w:color="BFBFBF"/><w:insideV w:val="single" w:sz="4" w:color="BFBFBF"/></w:tblBorders><w:tblLook w:val="04A0"/></w:tblPr><w:tblGrid>${Array.from({ length: cols }, () => `<w:gridCol w:w="${colW}"/>`).join("")}</w:tblGrid>`;
        rows.forEach((tr, ri) => {
          const header = tr.parentElement?.tagName === "THEAD" || Array.from(tr.cells).every((c) => c.tagName === "TH");
          out += `<w:tr>${header && ri === 0 ? "<w:trPr><w:tblHeader/></w:trPr>" : ""}`;
          Array.from(tr.cells).forEach((cell) => {
            const span = cell.colSpan || 1;
            const fill = cssColorToHex(cell.style.backgroundColor) ?? (cell.tagName === "TH" ? "F2F2F2" : undefined);
            const inner = Array.from(cell.children).some((c) => /^(P|UL|OL|TABLE|H\d|DIV)$/.test(c.tagName)) ? blocks(cell, ctx, maxImgPx / cols) : `<w:p>${paraProps(cell)}${inlineRuns(cell, cell.tagName === "TH" ? { b: true } : {}, ctx, maxImgPx / cols)}</w:p>`;
            out += `<w:tc><w:tcPr><w:tcW w:w="${colW * span}" w:type="dxa"/>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ""}${fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : ""}</w:tcPr>${inner || emptyPara}</w:tc>`;
          });
          out += "</w:tr>";
        });
        out += "</w:tbl><w:p/>";
        return;
      }
      case "FIGURE":
      case "SECTION":
      case "ARTICLE":
        out += blocks(el, ctx, maxImgPx);
        return;
      case "IMG":
        out += `<w:p><w:pPr><w:jc w:val="center"/></w:pPr>${imageRun(ctx, el as HTMLImageElement, maxImgPx)}</w:p>`;
        return;
      default:
        out += `<w:p>${paraProps(el)}${inlineRuns(el, {}, ctx, maxImgPx)}</w:p>`;
    }
  });
  return out;
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="80" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:asciiTheme="majorHAnsi" w:hAnsiTheme="majorHAnsi"/><w:spacing w:val="-10"/><w:kern w:val="28"/><w:sz w:val="56"/><w:szCs w:val="56"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:rPr><w:color w:val="595959"/><w:spacing w:val="15"/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style>
${[1, 2, 3, 4, 5, 6]
  .map((n) => {
    const sz = [40, 32, 26, 22, 22, 22][n - 1];
    const color = n === 2 || n === 4 ? "2F5496" : "1F3864";
    return `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="${n === 1 ? 360 : 240}" w:after="80"/><w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:b/><w:bCs/>${n === 4 ? "<w:i/>" : ""}<w:color w:val="${color}"/><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr></w:style>`;
  })
  .join("")}
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="4472C4"/></w:pBdr><w:ind w:left="720" w:right="720"/></w:pPr><w:rPr><w:i/><w:iCs/><w:color w:val="404040"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F4F4F4"/><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="20"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="40"/><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="TOCHeading"><w:name w:val="TOC Heading"/><w:basedOn w:val="Heading1"/><w:next w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="TOC1"><w:name w:val="toc 1"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="60"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="TOC2"><w:name w:val="toc 2"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="60"/><w:ind w:left="220"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="TOC3"><w:name w:val="toc 3"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="60"/><w:ind w:left="440"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Header"><w:name w:val="header"/><w:basedOn w:val="Normal"/><w:pPr><w:tabs><w:tab w:val="center" w:pos="4680"/><w:tab w:val="right" w:pos="9360"/></w:tabs><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/><w:pPr><w:tabs><w:tab w:val="center" w:pos="4680"/><w:tab w:val="right" w:pos="9360"/></w:tabs><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:style>
<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:style>
<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>
</w:styles>`;

function hfXml(kind: "hdr" | "ftr", text: string, pageNum: boolean, align: "center" | "right"): string {
  const runs = text ? `<w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r>` : "";
  const num = pageNum ? `${text ? '<w:r><w:t xml:space="preserve">   </w:t></w:r>' : ""}<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>` : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:${kind} xmlns:w="${W}" xmlns:r="${R}"><w:p><w:pPr><w:pStyle w:val="${kind === "hdr" ? "Header" : "Footer"}"/><w:jc w:val="${align}"/></w:pPr>${runs}${num}</w:p></w:${kind}>`;
}

export function exportDocx(doc: WordDoc, title: string): Blob {
  const page = doc.page;
  const [mmW, mmH] = PAGE_MM[page.size];
  const [pw, ph] = page.landscape ? [mmH, mmW] : [mmW, mmH];
  const contentPx = ((pw - page.margins.left - page.margins.right) * 96) / 25.4 / page.columns;
  const ctx: Ctx = { rels: [], media: {}, numbering: { abstract: [], nums: [] }, imageId: 0, docPrId: 1 };
  const container = document.createElement("div");
  container.innerHTML = doc.html;
  let body = blocks(container, ctx, contentPx);
  if (!body) body = "<w:p/>";

  const hasHeader = Boolean(page.header) || page.pageNumbers === "top-right";
  const hasFooter = Boolean(page.footer) || page.pageNumbers === "bottom-center" || page.pageNumbers === "bottom-right";
  const files: Zippable = {};
  let hdrRef = "";
  let ftrRef = "";
  if (hasHeader) {
    files["word/header1.xml"] = strToU8(hfXml("hdr", page.header, page.pageNumbers === "top-right", page.pageNumbers === "top-right" ? "right" : "center"));
    hdrRef = `<w:headerReference w:type="default" r:id="${addRel(ctx, "http://schemas.openxmlformats.org/officeDocument/2006/relationships/header", "header1.xml")}"/>`;
  }
  if (hasFooter) {
    files["word/footer1.xml"] = strToU8(hfXml("ftr", page.footer, page.pageNumbers.startsWith("bottom"), page.pageNumbers === "bottom-right" ? "right" : "center"));
    ftrRef = `<w:footerReference w:type="default" r:id="${addRel(ctx, "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer", "footer1.xml")}"/>`;
  }
  const tw = (mm: number) => Math.round(mm * MM_TO_TWIP);
  const sect = `<w:sectPr>${hdrRef}${ftrRef}<w:pgSz w:w="${tw(pw)}" w:h="${tw(ph)}"${page.landscape ? ' w:orient="landscape"' : ""}/><w:pgMar w:top="${tw(page.margins.top)}" w:right="${tw(page.margins.right)}" w:bottom="${tw(page.margins.bottom)}" w:left="${tw(page.margins.left)}" w:header="709" w:footer="709" w:gutter="0"/><w:cols w:num="${page.columns}" w:space="720"/>${page.differentFirst ? "<w:titlePg/>" : ""}</w:sectPr>`;
  const background = page.pageColor ? `<w:background w:color="${page.pageColor.replace("#", "").toUpperCase()}"/>` : "";
  files["word/document.xml"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">${background}<w:body>${body}${sect}</w:body></w:document>`);
  files["word/styles.xml"] = strToU8(STYLES_XML);
  const numbering = ctx.numbering.abstract.length ? `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="${W}">${ctx.numbering.abstract.join("")}${ctx.numbering.nums.join("")}</w:numbering>` : null;
  if (numbering) {
    files["word/numbering.xml"] = strToU8(numbering);
    addRel(ctx, "http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering", "numbering.xml");
  }
  files["word/settings.xml"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="${W}">${page.pageColor ? '<w:displayBackgroundShape/>' : ""}<w:defaultTabStop w:val="720"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`);
  addRel(ctx, "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles", "styles.xml");
  addRel(ctx, "http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings", "settings.xml");
  files["word/_rels/document.xml.rels"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${ctx.rels.join("")}</Relationships>`);
  for (const [k, v] of Object.entries(ctx.media)) files[k] = v;
  const exts = new Set(Object.keys(ctx.media).map((k) => k.split(".").pop()!));
  const ctype: Record<string, string> = { png: "image/png", jpg: "image/jpeg", gif: "image/gif", bmp: "image/bmp" };
  files["[Content_Types].xml"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${[...exts].map((e) => `<Default Extension="${e}" ContentType="${ctype[e] ?? "application/octet-stream"}"/>`).join("")}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>${numbering ? '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' : ""}${hasHeader ? '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' : ""}${hasFooter ? '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' : ""}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`);
  files["_rels/.rels"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`);
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  files["docProps/core.xml"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(title)}</dc:title><dc:creator>Do-Whatever-You-Like Docs</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`);
  files["docProps/app.xml"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Microsoft Office Word</Application></Properties>`);
  const ordered: Zippable = { "[Content_Types].xml": files["[Content_Types].xml"] };
  for (const [k, v] of Object.entries(files)) if (k !== "[Content_Types].xml") ordered[k] = v;
  return new Blob([zipSync(ordered, { level: 6 }) as BlobPart], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
}

// ===================================================================== import

const child = (el: Element | null | undefined, name: string) => (el ? Array.from(el.children).find((c) => c.localName === name) : undefined);
const kids = (el: Element | null | undefined, name?: string) => (el ? Array.from(el.children).filter((c) => !name || c.localName === name) : []);
const attr = (el: Element | null | undefined, name: string) => el?.getAttributeNS(W, name) ?? el?.getAttribute(`w:${name}`) ?? null;
const hesc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const HIGHLIGHT: Record<string, string> = { yellow: "#ffff00", green: "#00ff00", cyan: "#00ffff", magenta: "#ff00ff", blue: "#0000ff", red: "#ff0000", darkBlue: "#000080", darkCyan: "#008080", darkGreen: "#008000", darkMagenta: "#800080", darkRed: "#800000", darkYellow: "#808000", darkGray: "#808080", lightGray: "#c0c0c0", black: "#000000" };

type Imp = {
  rels: Map<string, { target: string; external: boolean }>;
  files: Record<string, Uint8Array>;
  styleMap: Map<string, string>;
  numFmt: Map<string, Map<number, string>>; // numId -> level -> fmt
  /** Paragraph styles that carry their own numbering (Word's "List Bullet", "List Number"). */
  styleNum: Map<string, { numId: string; ilvl: number }>;
};

function runCss(rPr: Element | undefined): { open: string; close: string } {
  if (!rPr) return { open: "", close: "" };
  const css: string[] = [];
  let open = "";
  let close = "";
  const on = (name: string) => {
    const e = child(rPr, name);
    return Boolean(e) && attr(e, "val") !== "0" && attr(e, "val") !== "false" && attr(e, "val") !== "none";
  };
  if (on("b")) {
    open += "<b>";
    close = "</b>" + close;
  }
  if (on("i")) {
    open += "<i>";
    close = "</i>" + close;
  }
  if (on("u")) {
    open += "<u>";
    close = "</u>" + close;
  }
  if (on("strike") || on("dstrike")) {
    open += "<s>";
    close = "</s>" + close;
  }
  const va = attr(child(rPr, "vertAlign"), "val");
  if (va === "superscript") {
    open += "<sup>";
    close = "</sup>" + close;
  }
  if (va === "subscript") {
    open += "<sub>";
    close = "</sub>" + close;
  }
  const color = attr(child(rPr, "color"), "val");
  if (color && color !== "auto" && color !== "000000") css.push(`color:#${color}`);
  const hl = attr(child(rPr, "highlight"), "val");
  const shd = attr(child(rPr, "shd"), "fill");
  if (hl && HIGHLIGHT[hl]) css.push(`background-color:${HIGHLIGHT[hl]}`);
  else if (shd && shd !== "auto" && shd !== "FFFFFF") css.push(`background-color:#${shd}`);
  const sz = Number(attr(child(rPr, "sz"), "val"));
  if (sz && sz !== 22) css.push(`font-size:${sz / 2}pt`);
  const fonts = child(rPr, "rFonts");
  const face = attr(fonts, "ascii") ?? attr(fonts, "hAnsi");
  if (face && !/^(Calibri|Calibri Light)$/i.test(face)) css.push(`font-family:'${face}'`);
  if (on("caps")) css.push("text-transform:uppercase");
  if (css.length) {
    open = `<span style="${css.join(";")}">` + open;
    close = close + "</span>";
  }
  return { open, close };
}

function bytesToDataUrl(bytes: Uint8Array, ext: string): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "gif" ? "image/gif" : ext === "bmp" ? "image/bmp" : ext === "svg" ? "image/svg+xml" : "image/png";
  return `data:${mime};base64,${btoa(bin)}`;
}

function runsHtml(p: Element, imp: Imp): string {
  let out = "";
  const walk = (el: Element) => {
    for (const ch of kids(el)) {
      switch (ch.localName) {
        case "r": {
          const { open, close } = runCss(child(ch, "rPr"));
          let inner = "";
          for (const part of kids(ch)) {
            if (part.localName === "t") inner += hesc(part.textContent ?? "");
            else if (part.localName === "tab") inner += "&emsp;";
            else if (part.localName === "br") inner += attr(part, "type") === "page" ? "\u0000PAGEBREAK\u0000" : "<br>";
            else if (part.localName === "drawing" || part.localName === "pict") {
              const blip = part.getElementsByTagNameNS("*", "blip")[0] ?? part.getElementsByTagNameNS("*", "imagedata")[0];
              const rid = blip?.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "embed") ?? blip?.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
              const rel = rid ? imp.rels.get(rid) : undefined;
              if (rel) {
                const path = rel.target.startsWith("/") ? rel.target.slice(1) : `word/${rel.target}`;
                const bytes = imp.files[path];
                if (bytes) {
                  const ext = path.split(".").pop()!.toLowerCase();
                  const extent = part.getElementsByTagNameNS("*", "extent")[0];
                  const w = extent ? Math.round(Number(extent.getAttribute("cx")) / 9525) : 0;
                  const alt = part.getElementsByTagNameNS("*", "docPr")[0]?.getAttribute("descr") ?? "";
                  inner += `<img src="${bytesToDataUrl(bytes, ext)}" alt="${hesc(alt)}"${w ? ` width="${w}"` : ""}>`;
                }
              }
            } else if (part.localName === "sym") inner += String.fromCharCode(parseInt(attr(part, "char") ?? "20", 16));
          }
          if (inner) out += open + inner + close;
          break;
        }
        case "hyperlink": {
          const rid = ch.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
          const anchor = attr(ch, "anchor");
          const href = rid ? imp.rels.get(rid)?.target : anchor ? `#${anchor}` : "";
          const before = out;
          out = "";
          walk(ch);
          const inner = out;
          out = before + (href ? `<a href="${hesc(href)}">${inner}</a>` : inner);
          break;
        }
        case "smartTag":
        case "ins":
        case "sdt":
        case "sdtContent":
        case "fldSimple":
          walk(ch);
          break;
        default:
          break;
      }
    }
  };
  walk(p);
  return out;
}

function paraStyleAttr(pPr: Element | undefined): string {
  if (!pPr) return "";
  const css: string[] = [];
  const jc = attr(child(pPr, "jc"), "val");
  const map: Record<string, string> = { center: "center", right: "right", end: "right", both: "justify", distribute: "justify" };
  if (jc && map[jc]) css.push(`text-align:${map[jc]}`);
  const ind = child(pPr, "ind");
  const left = Number(attr(ind, "left") ?? attr(ind, "start") ?? 0);
  if (left && !child(pPr, "numPr")) css.push(`margin-left:${Math.round(left / 15)}px`);
  const first = Number(attr(ind, "firstLine") ?? 0);
  if (first) css.push(`text-indent:${Math.round(first / 15)}px`);
  const sp = child(pPr, "spacing");
  const line = Number(attr(sp, "line") ?? 0);
  if (line && attr(sp, "lineRule") !== "exact" && attr(sp, "lineRule") !== "atLeast" && line !== 276 && line !== 259) css.push(`line-height:${(line / 240).toFixed(2)}`);
  const bidi = child(pPr, "bidi") ? ' dir="rtl"' : "";
  return (css.length ? ` style="${css.join(";")}"` : "") + bidi;
}

function blocksHtml(container: Element, imp: Imp): string {
  let out = "";
  type ListItem = { level: number; ordered: boolean; html: string };
  let list: ListItem[] = [];
  let listNumId = "";
  /** Builds properly nested <ul>/<ol> from (level, ordered, html) items. */
  const flushList = () => {
    if (!list.length) return;
    let html = "";
    const stack: string[] = [];
    for (const it of list) {
      const tag = it.ordered ? "ol" : "ul";
      const cur = stack.length - 1;
      if (it.level > cur) {
        for (let l = cur + 1; l <= it.level; l++) {
          html += `<${tag}>`;
          stack.push(tag);
          if (l < it.level) html += "<li>";
        }
      } else {
        html += "</li>";
        while (stack.length - 1 > it.level) html += `</${stack.pop()}></li>`;
      }
      html += `<li>${it.html}`;
    }
    html += "</li>";
    while (stack.length) {
      html += `</${stack.pop()}>`;
      if (stack.length) html += "</li>";
    }
    out += html;
    list = [];
  };
  for (const el of kids(container)) {
    if (el.localName === "p") {
      const pPr = child(el, "pPr");
      const styleId = attr(child(pPr, "pStyle"), "val") ?? "";
      const styleName = (imp.styleMap.get(styleId) ?? styleId).toLowerCase().replace(/\s+/g, "");
      const ownNum = child(pPr, "numPr");
      const styleNum = imp.styleNum.get(styleId);
      let content = runsHtml(el, imp);
      const pageBreaks = content.split("\u0000PAGEBREAK\u0000");
      content = pageBreaks.join("");
      const attrs = paraStyleAttr(pPr);
      if ((ownNum || styleNum) && content.trim()) {
        const numId = (ownNum ? attr(child(ownNum, "numId"), "val") : null) ?? styleNum?.numId ?? "";
        const level = Number((ownNum ? attr(child(ownNum, "ilvl"), "val") : null) ?? styleNum?.ilvl ?? 0);
        const fmt = imp.numFmt.get(numId)?.get(level) ?? "bullet";
        if (numId !== "0") {
          // A different list definition at the top level starts a new list (bullets then numbers).
          if (list.length && level === 0 && listNumId !== numId) flushList();
          listNumId = numId;
          list.push({ level, ordered: fmt !== "bullet" && fmt !== "none", html: content });
          continue;
        }
      }
      flushList();
      let tag = "p";
      let cls = "";
      const hm = /^heading(\d)$/.exec(styleName);
      if (styleName === "title") {
        tag = "h1";
        cls = ' class="doc-title"';
      }
      else if (styleName === "subtitle") cls = ' class="doc-subtitle"';
      else if (hm) tag = `h${Math.min(6, Number(hm[1]))}`;
      else if (styleName === "quote" || styleName === "intensequote") tag = "blockquote";
      else if (/code|htmlpreformatted/.test(styleName)) tag = "pre";
      out += `<${tag}${cls}${attrs}>${content || "<br>"}</${tag}>`;
      if (pageBreaks.length > 1) out += '<div class="page-break" contenteditable="false"></div>';
      continue;
    }
    flushList();
    if (el.localName === "tbl") {
      let html = "<table><tbody>";
      kids(el, "tr").forEach((tr, ri) => {
        html += "<tr>";
        for (const tc of kids(tr, "tc")) {
          const tcPr = child(tc, "tcPr");
          if (attr(child(tcPr, "vMerge"), "val") === null && child(tcPr, "vMerge")) continue;
          const span = Number(attr(child(tcPr, "gridSpan"), "val") ?? 1);
          const fill = attr(child(tcPr, "shd"), "fill");
          const header = ri === 0 && child(child(tr, "trPr"), "tblHeader");
          const tag = header ? "th" : "td";
          html += `<${tag}${span > 1 ? ` colspan="${span}"` : ""}${fill && fill !== "auto" && fill !== "FFFFFF" ? ` style="background-color:#${fill}"` : ""}>${blocksHtml(tc, imp) || "<br>"}</${tag}>`;
        }
        html += "</tr>";
      });
      out += html + "</tbody></table>";
    } else if (el.localName === "sdt") out += blocksHtml(child(el, "sdtContent") ?? el, imp);
  }
  flushList();
  return out;
}

function textOfPart(doc: Document | null): string {
  if (!doc) return "";
  return Array.from(doc.getElementsByTagNameNS(W, "p"))
    .map((p) => Array.from(p.getElementsByTagNameNS(W, "t")).map((t) => t.textContent).join(""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function importDocx(bytes: Uint8Array): WordDoc {
  const files = unzipSync(bytes);
  const parse = (p: string) => {
    const b = files[p];
    if (!b) return null;
    const d = new DOMParser().parseFromString(strFromU8(b), "application/xml");
    return d.getElementsByTagName("parsererror").length ? null : d;
  };
  const doc = parse("word/document.xml");
  if (!doc) throw new Error("That file isn't a valid Word document.");
  const relsDoc = parse("word/_rels/document.xml.rels");
  const rels = new Map<string, { target: string; external: boolean }>();
  if (relsDoc) for (const r of Array.from(relsDoc.getElementsByTagName("Relationship"))) rels.set(r.getAttribute("Id") ?? "", { target: r.getAttribute("Target") ?? "", external: r.getAttribute("TargetMode") === "External" });
  const styles = parse("word/styles.xml");
  const styleMap = new Map<string, string>();
  const styleNum = new Map<string, { numId: string; ilvl: number }>();
  if (styles)
    for (const s of Array.from(styles.getElementsByTagNameNS(W, "style"))) {
      const id = attr(s, "styleId") ?? "";
      styleMap.set(id, attr(child(s, "name"), "val") ?? "");
      const np = child(child(s, "pPr"), "numPr");
      const nid = attr(child(np, "numId"), "val");
      if (nid) styleNum.set(id, { numId: nid, ilvl: Number(attr(child(np, "ilvl"), "val") ?? 0) });
    }
  const numbering = parse("word/numbering.xml");
  const numFmt = new Map<string, Map<number, string>>();
  if (numbering) {
    const abs = new Map<string, Map<number, string>>();
    for (const a of Array.from(numbering.getElementsByTagNameNS(W, "abstractNum"))) {
      const m = new Map<number, string>();
      for (const lvl of kids(a, "lvl")) m.set(Number(attr(lvl, "ilvl")), attr(child(lvl, "numFmt"), "val") ?? "decimal");
      abs.set(attr(a, "abstractNumId") ?? "", m);
    }
    for (const n of Array.from(numbering.getElementsByTagNameNS(W, "num"))) numFmt.set(attr(n, "numId") ?? "", abs.get(attr(child(n, "abstractNumId"), "val") ?? "") ?? new Map());
  }
  const body = doc.getElementsByTagNameNS(W, "body")[0];
  const html = blocksHtml(body, { rels, files, styleMap, numFmt, styleNum });

  // page setup
  const sect = Array.from(body.children).reverse().find((c) => c.localName === "sectPr") ?? body.getElementsByTagNameNS(W, "sectPr")[0];
  const page: PageSetup = { ...DEFAULT_PAGE, margins: { ...DEFAULT_PAGE.margins } };
  if (sect) {
    const pgSz = child(sect, "pgSz");
    const w = Number(attr(pgSz, "w"));
    const h = Number(attr(pgSz, "h"));
    if (w && h) {
      page.landscape = w > h;
      const [sw, sh] = [Math.min(w, h), Math.max(w, h)].map((t) => t / MM_TO_TWIP);
      const best = (Object.entries(PAGE_MM) as [PageSetup["size"], [number, number]][]).sort((a, b) => Math.abs(a[1][0] - sw) + Math.abs(a[1][1] - sh) - (Math.abs(b[1][0] - sw) + Math.abs(b[1][1] - sh)))[0];
      page.size = best[0];
    }
    const m = child(sect, "pgMar");
    if (m) page.margins = { top: Number(attr(m, "top") ?? 1440) / MM_TO_TWIP, right: Number(attr(m, "right") ?? 1440) / MM_TO_TWIP, bottom: Number(attr(m, "bottom") ?? 1440) / MM_TO_TWIP, left: Number(attr(m, "left") ?? 1440) / MM_TO_TWIP };
    const cols = Number(attr(child(sect, "cols"), "num") ?? 1);
    if (cols === 2 || cols === 3) page.columns = cols;
    const hdr = kids(sect, "headerReference").find((x) => attr(x, "type") === "default");
    const ftr = kids(sect, "footerReference").find((x) => attr(x, "type") === "default");
    const partOf = (ref: Element | undefined) => {
      const rid = ref?.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
      const t = rid ? rels.get(rid)?.target : undefined;
      return t ? parse(`word/${t}`) : null;
    };
    const hDoc = partOf(hdr);
    const fDoc = partOf(ftr);
    page.header = textOfPart(hDoc);
    page.footer = textOfPart(fDoc);
    const hasPage = (d: Document | null) => Boolean(d && /PAGE/.test(Array.from(d.getElementsByTagNameNS(W, "instrText")).map((x) => x.textContent).join(" ") + Array.from(d.getElementsByTagNameNS(W, "fldSimple")).map((x) => attr(x, "instr")).join(" ")));
    if (hasPage(fDoc)) page.pageNumbers = "bottom-center";
    else if (hasPage(hDoc)) page.pageNumbers = "top-right";
  }
  const bg = attr(doc.getElementsByTagNameNS(W, "background")[0], "color");
  if (bg && bg !== "FFFFFF" && bg !== "auto") page.pageColor = `#${bg}`;
  return { html: html || "<p><br></p>", page };
}
