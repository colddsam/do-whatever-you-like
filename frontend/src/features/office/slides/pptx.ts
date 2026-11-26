/**
 * PowerPoint .pptx import/export for the slide editor (OOXML written with fflate).
 * Coordinates: our slides are 960×540 (16:9) or 720×540 (4:3) units = 72 per inch, so
 * 1 unit = 12 700 EMU and a text size in units equals its size in points.
 */
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import { elementInner, elId, newDeck, SIZE, themeOf, type Deck, type El, type ShapeKind, type Slide, type TextStyle, type Transition } from "./model";

const EMU = 12700;
const NS = {
  a: "http://schemas.openxmlformats.org/drawingml/2006/main",
  p: "http://schemas.openxmlformats.org/presentationml/2006/main",
  r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
};
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
const emu = (v: number) => Math.round(v * EMU);

const PRST: Record<ShapeKind, string> = {
  rect: "rect", roundRect: "roundRect", ellipse: "ellipse", triangle: "triangle", rightTriangle: "rtTriangle", diamond: "diamond", pentagon: "pentagon",
  hexagon: "hexagon", octagon: "octagon", star5: "star5", arrowRight: "rightArrow", arrowLeft: "leftArrow", arrowUp: "upArrow", arrowDown: "downArrow",
  chevron: "chevron", parallelogram: "parallelogram", trapezoid: "trapezoid", heart: "heart", cloud: "cloud", speech: "wedgeRoundRectCallout", plus: "mathPlus",
  line: "line", arrowLine: "line",
};
const FROM_PRST: Record<string, ShapeKind> = Object.fromEntries(Object.entries(PRST).map(([k, v]) => [v, k as ShapeKind]));
FROM_PRST.rect = "rect";
FROM_PRST.line = "line";
FROM_PRST.straightConnector1 = "line";
FROM_PRST.flowChartProcess = "rect";
FROM_PRST.flowChartAlternateProcess = "roundRect";
FROM_PRST.wedgeRectCallout = "speech";

function hex(c: string | undefined): string | null {
  if (!c) return null;
  const s = c.trim();
  if (s.startsWith("#")) {
    const h = s.slice(1);
    return (h.length === 3 ? h.split("").map((x) => x + x).join("") : h.slice(0, 6)).toUpperCase();
  }
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(s);
  if (m) return [m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, "0")).join("").toUpperCase();
  const g = /#[0-9a-f]{3,6}/i.exec(s);
  return g ? hex(g[0]) : null;
}

// ------------------------------------------------------------------ text → DrawingML paragraphs

function runsXml(node: Node, base: { b?: boolean; i?: boolean; u?: boolean; color?: string; size?: number; font?: string; href?: string }, ctx: { rels: string[] }): string {
  let out = "";
  node.childNodes.forEach((ch) => {
    if (ch.nodeType === 3) {
      const t = (ch as Text).data;
      if (!t) return;
      const attrs = `lang="en-US"${base.size ? ` sz="${Math.round(base.size * 100)}"` : ""}${base.b ? ' b="1"' : ""}${base.i ? ' i="1"' : ""}${base.u ? ' u="sng"' : ""} dirty="0"`;
      let inner = "";
      if (base.color) inner += `<a:solidFill><a:srgbClr val="${base.color}"/></a:solidFill>`;
      if (base.font) inner += `<a:latin typeface="${esc(base.font)}"/><a:cs typeface="${esc(base.font)}"/>`;
      if (base.href) {
        const id = `rId${ctx.rels.length + 10}`;
        ctx.rels.push(`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${esc(base.href)}" TargetMode="External"/>`);
        inner += `<a:hlinkClick r:id="${id}"/>`;
      }
      out += `<a:r><a:rPr ${attrs}>${inner}</a:rPr><a:t>${esc(t)}</a:t></a:r>`;
      return;
    }
    if (ch.nodeType !== 1) return;
    const el = ch as HTMLElement;
    if (el.tagName === "BR") {
      out += "<a:br/>";
      return;
    }
    const f = { ...base };
    if (/^(B|STRONG)$/.test(el.tagName)) f.b = true;
    if (/^(I|EM)$/.test(el.tagName)) f.i = true;
    if (el.tagName === "U") f.u = true;
    if (el.tagName === "A") f.href = el.getAttribute("href") ?? undefined;
    if (el.style.fontWeight === "bold" || Number(el.style.fontWeight) >= 600) f.b = true;
    if (el.style.fontStyle === "italic") f.i = true;
    if (el.style.textDecoration.includes("underline")) f.u = true;
    const c = hex(el.style.color) ?? hex(el.getAttribute("color") ?? undefined);
    if (c) f.color = c;
    if (el.style.fontSize) f.size = parseFloat(el.style.fontSize) * (el.style.fontSize.endsWith("pt") ? 1.333 : 1);
    if (el.style.fontFamily) f.font = el.style.fontFamily.split(",")[0].replace(/["']/g, "").trim();
    out += runsXml(el, f, ctx);
  });
  return out;
}

function textBodyXml(el: El, deck: Deck, ctx: { rels: string[] }): string {
  const t: TextStyle = el.text ?? { size: 20, align: "left", valign: "top" };
  const theme = themeOf(deck.theme);
  const color = hex(t.color ?? (el.role === "title" ? theme.title : theme.text)) ?? "000000";
  const font = t.font ?? (el.role === "title" ? theme.titleFont : theme.bodyFont);
  const algn = { left: "l", center: "ctr", right: "r", justify: "just" }[t.align];
  const anchor = { top: "t", middle: "ctr", bottom: "b" }[t.valign];
  const div = document.createElement("div");
  div.innerHTML = el.html ?? "";
  const paras: string[] = [];
  const base = { b: t.bold, i: t.italic, u: t.underline, color, size: t.size, font };
  const lnSpc = t.lineHeight ? `<a:lnSpc><a:spcPct val="${Math.round(t.lineHeight * 100000 / 1.2)}"/></a:lnSpc>` : "";
  const para = (n: Node, bullet: boolean, level = 0) => {
    const runs = runsXml(n, base, ctx);
    const bu = bullet ? `<a:buFont typeface="Arial"/><a:buChar char="•"/>` : "<a:buNone/>";
    paras.push(`<a:p><a:pPr algn="${algn}"${bullet ? ` marL="${342900 + level * 342900}" indent="-342900"` : ""}${level ? ` lvl="${level}"` : ""}>${lnSpc}${bu}</a:pPr>${runs}<a:endParaRPr lang="en-US" sz="${Math.round(t.size * 100)}" dirty="0"/></a:p>`);
  };
  const walk = (container: Element, level = 0) => {
    let loose: Node[] = [];
    const flush = () => {
      if (loose.some((n) => (n.textContent ?? "").trim())) {
        const wrap = document.createElement("span");
        loose.forEach((n) => wrap.appendChild(n.cloneNode(true)));
        para(wrap, false);
      }
      loose = [];
    };
    Array.from(container.childNodes).forEach((n) => {
      if (n.nodeType === 1 && /^(P|DIV|H[1-6])$/.test((n as Element).tagName)) {
        flush();
        para(n, Boolean(t.bullets && level));
      } else if (n.nodeType === 1 && /^(UL|OL)$/.test((n as Element).tagName)) {
        flush();
        Array.from((n as Element).children).forEach((li) => {
          const clone = li.cloneNode(true) as Element;
          clone.querySelectorAll("ul,ol").forEach((x) => x.remove());
          para(clone, true, level);
          li.querySelectorAll(":scope > ul, :scope > ol").forEach((sub) => walk(Object.assign(document.createElement("div"), { innerHTML: sub.outerHTML }), level + 1));
        });
      } else loose.push(n);
    });
    flush();
  };
  walk(div);
  if (!paras.length) paras.push(`<a:p><a:pPr algn="${algn}"/><a:endParaRPr lang="en-US" sz="${Math.round(t.size * 100)}" dirty="0"/></a:p>`);
  return `<p:txBody><a:bodyPr wrap="square" lIns="76200" tIns="38100" rIns="76200" bIns="38100" rtlCol="0" anchor="${anchor}"><a:normAutofit/></a:bodyPr><a:lstStyle/>${paras.join("")}</p:txBody>`;
}

// ------------------------------------------------------------------ export

async function svgToPng(svg: string, w: number, h: number): Promise<Uint8Array | null> {
  try {
    const img = new Image();
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"'));
    await img.decode();
    const c = document.createElement("canvas");
    c.width = Math.round(w * 2);
    c.height = Math.round(h * 2);
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"));
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

async function imageBytes(src: string): Promise<{ bytes: Uint8Array; ext: string } | null> {
  try {
    const m = /^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,(.+)$/i.exec(src);
    if (m) {
      const bin = atob(m[2]);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const ext = m[1].toLowerCase().replace("jpeg", "jpg");
      if (ext === "webp" || ext === "svg+xml") {
        // PowerPoint needs PNG/JPG: re-encode through a canvas
        const img = new Image();
        img.src = src;
        await img.decode();
        const c = document.createElement("canvas");
        c.width = img.naturalWidth || 800;
        c.height = img.naturalHeight || 600;
        c.getContext("2d")!.drawImage(img, 0, 0);
        const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"));
        if (!blob) return null;
        return { bytes: new Uint8Array(await blob.arrayBuffer()), ext: "png" };
      }
      return { bytes, ext };
    }
    const res = await fetch(src);
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    return { bytes: new Uint8Array(await res.arrayBuffer()), ext: type.includes("png") ? "png" : type.includes("gif") ? "gif" : "jpg" };
  } catch {
    return null;
  }
}

const TRANS: Record<Transition, string> = {
  none: "",
  fade: '<p:transition spd="med"><p:fade/></p:transition>',
  slide: '<p:transition spd="med"><p:push dir="l"/></p:transition>',
  push: '<p:transition spd="med"><p:push dir="u"/></p:transition>',
  zoom: '<p:transition spd="med"><p:zoom/></p:transition>',
  flip: '<p:transition spd="med"><p:split orient="vert" dir="out"/></p:transition>',
  cover: '<p:transition spd="med"><p:cover dir="l"/></p:transition>',
};

export async function exportPptx(deck: Deck, title: string): Promise<Blob> {
  const { w, h } = SIZE[deck.ratio];
  const theme = themeOf(deck.theme);
  const files: Zippable = {};
  const media: Record<string, Uint8Array> = {};
  let mediaN = 0;
  const slideIds: string[] = [];
  const presRels: string[] = ['<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>', '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>', '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster" Target="notesMasters/notesMaster1.xml"/>'];
  const ctypes: string[] = [];

  for (let si = 0; si < deck.slides.length; si++) {
    const slide = deck.slides[si];
    const n = si + 1;
    const rels: string[] = ['<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>', `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide${n}.xml"/>`];
    const ctx = { rels };
    let shapes = "";
    let id = 2;
    const addImage = async (bytes: Uint8Array, ext: string) => {
      const name = `image${++mediaN}.${ext}`;
      media[`ppt/media/${name}`] = bytes;
      const rid = `rId${rels.length + 10}`;
      rels.push(`<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${name}"/>`);
      return rid;
    };
    const xfrm = (el: El) => `<a:xfrm${el.rot ? ` rot="${Math.round(el.rot * 60000)}"` : ""}><a:off x="${emu(el.x)}" y="${emu(el.y)}"/><a:ext cx="${emu(Math.max(1, el.w))}" cy="${emu(Math.max(1, el.h))}"/></a:xfrm>`;
    for (const el of slide.elements) {
      const sid = id++;
      const alpha = el.opacity !== undefined && el.opacity < 1 ? `<a:alpha val="${Math.round(el.opacity * 100000)}"/>` : "";
      if (el.type === "text") {
        shapes += `<p:sp><p:nvSpPr><p:cNvPr id="${sid}" name="TextBox ${sid}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(el)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>${textBodyXml(el, deck, ctx)}</p:sp>`;
      } else if (el.type === "shape" && el.shape) {
        const s = el.shape;
        const fill = hex(s.fill ?? theme.accent[0]);
        const ln = s.stroke ? `<a:ln w="${Math.round((s.strokeW ?? 2) * EMU)}"><a:solidFill><a:srgbClr val="${hex(s.stroke)}"/></a:solidFill>${s.kind === "arrowLine" ? '<a:tailEnd type="triangle"/>' : ""}</a:ln>` : s.kind === "line" || s.kind === "arrowLine" ? `<a:ln w="${Math.round((s.strokeW ?? 3) * EMU)}"><a:solidFill><a:srgbClr val="${fill}"/></a:solidFill>${s.kind === "arrowLine" ? '<a:tailEnd type="triangle"/>' : ""}</a:ln>` : "<a:ln><a:noFill/></a:ln>";
        if (s.kind === "line" || s.kind === "arrowLine") {
          const line = { ...el, y: el.y + el.h / 2, h: 0 };
          shapes += `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${sid}" name="Line ${sid}"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr>${xfrm(line)}<a:prstGeom prst="line"><a:avLst/></a:prstGeom>${ln}</p:spPr></p:cxnSp>`;
        } else {
          shapes += `<p:sp><p:nvSpPr><p:cNvPr id="${sid}" name="Shape ${sid}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(el)}<a:prstGeom prst="${PRST[s.kind]}"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${fill}">${alpha}</a:srgbClr></a:solidFill>${ln}${s.shadow ? '<a:effectLst><a:outerShdw blurRad="76200" dist="38100" dir="5400000" algn="t" rotWithShape="0"><a:srgbClr val="000000"><a:alpha val="35000"/></a:srgbClr></a:outerShdw></a:effectLst>' : ""}</p:spPr>${el.html ? textBodyXml({ ...el, text: { ...(el.text ?? { size: 18, align: "center", valign: "middle" }) } }, deck, ctx) : ""}</p:sp>`;
        }
      } else if (el.type === "image" && el.src) {
        const img = await imageBytes(el.src);
        if (!img) continue;
        const rid = await addImage(img.bytes, img.ext);
        shapes += `<p:pic><p:nvPicPr><p:cNvPr id="${sid}" name="Picture ${sid}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rid}">${alpha ? `<a:alphaModFix amt="${Math.round((el.opacity ?? 1) * 100000)}"/>` : ""}</a:blip><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm(el)}<a:prstGeom prst="${el.radius ? "roundRect" : "rect"}"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
      } else if (el.type === "table" && el.table) {
        const t = el.table;
        const cols = Math.max(...t.rows.map((r) => r.length));
        const cw = emu(el.w / cols);
        const rh = emu(el.h / t.rows.length);
        const color = hex(t.color ?? theme.accent[0]);
        const rows = t.rows
          .map((r, ri) => `<a:tr h="${rh}">${Array.from({ length: cols }, (_, ci) => `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="${Math.round((el.text?.size ?? 16) * 100)}"${ri === 0 && t.header ? ' b="1"' : ""} dirty="0"><a:solidFill><a:srgbClr val="${ri === 0 && t.header ? "FFFFFF" : "222222"}"/></a:solidFill></a:rPr><a:t>${esc(r[ci] ?? "")}</a:t></a:r></a:p></a:txBody><a:tcPr><a:lnL w="9525"><a:solidFill><a:srgbClr val="D0D0D0"/></a:solidFill></a:lnL><a:lnR w="9525"><a:solidFill><a:srgbClr val="D0D0D0"/></a:solidFill></a:lnR><a:lnT w="9525"><a:solidFill><a:srgbClr val="D0D0D0"/></a:solidFill></a:lnT><a:lnB w="9525"><a:solidFill><a:srgbClr val="D0D0D0"/></a:solidFill></a:lnB><a:solidFill><a:srgbClr val="${ri === 0 && t.header ? color : ri % 2 ? "F3F3F3" : "FFFFFF"}"/></a:solidFill></a:tcPr></a:tc>`).join("")}</a:tr>`)
          .join("");
        shapes += `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${sid}" name="Table ${sid}"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${emu(el.x)}" y="${emu(el.y)}"/><a:ext cx="${emu(el.w)}" cy="${emu(el.h)}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="${t.header ? 1 : 0}" bandRow="1"/><a:tblGrid>${Array.from({ length: cols }, () => `<a:gridCol w="${cw}"/>`).join("")}</a:tblGrid>${rows}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
      } else if (el.type === "chart" && el.chart) {
        const png = await svgToPng(elementInner(el, theme), el.w, el.h);
        if (!png) continue;
        const rid = await addImage(png, "png");
        shapes += `<p:pic><p:nvPicPr><p:cNvPr id="${sid}" name="Chart ${sid}" descr="Chart"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm(el)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
      }
    }
    // background
    const bgSrc = slide.bg ?? theme.bg;
    let bg = "";
    const urlM = /url\(["']?(.+?)["']?\)/.exec(bgSrc);
    if (urlM) {
      const img = await imageBytes(urlM[1]);
      if (img) bg = `<p:bg><p:bgPr><a:blipFill dpi="0" rotWithShape="1"><a:blip r:embed="${await addImage(img.bytes, img.ext)}"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></a:blipFill><a:effectLst/></p:bgPr></p:bg>`;
    } else if (/gradient/.test(bgSrc)) {
      const cols = bgSrc.match(/#[0-9a-f]{3,6}/gi) ?? ["#ffffff"];
      bg = `<p:bg><p:bgPr><a:gradFill rotWithShape="1"><a:gsLst>${cols.map((c, i) => `<a:gs pos="${Math.round((i / Math.max(1, cols.length - 1)) * 100000)}"><a:srgbClr val="${hex(c)}"/></a:gs>`).join("")}</a:gsLst><a:lin ang="2700000" scaled="0"/></a:gradFill><a:effectLst/></p:bgPr></p:bg>`;
    } else {
      const c = hex(bgSrc);
      if (c) bg = `<p:bg><p:bgPr><a:solidFill><a:srgbClr val="${c}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>`;
    }
    files[`ppt/slides/slide${n}.xml`] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}"${slide.hidden ? ' show="0"' : ""}><p:cSld>${bg}<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>${TRANS[slide.transition] ?? ""}</p:sld>`);
    files[`ppt/slides/_rels/slide${n}.xml.rels`] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join("")}</Relationships>`);
    const notesParas = (slide.notes || "").split(/\n/).map((l) => `<a:p><a:r><a:rPr lang="en-US" dirty="0"/><a:t>${esc(l)}</a:t></a:r></a:p>`).join("") || "<a:p><a:endParaRPr lang=\"en-US\"/></a:p>";
    files[`ppt/notesSlides/notesSlide${n}.xml`] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notes xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${notesParas}</p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`);
    files[`ppt/notesSlides/_rels/notesSlide${n}.xml.rels`] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster" Target="../notesMasters/notesMaster1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="../slides/slide${n}.xml"/></Relationships>`);
    presRels.push(`<Relationship Id="rId${n + 10}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${n}.xml"/>`);
    slideIds.push(`<p:sldId id="${255 + n}" r:id="rId${n + 10}"/>`);
    ctypes.push(`<Override PartName="/ppt/slides/slide${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/notesSlides/notesSlide${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>`);
  }

  const cx = emu(w);
  const cy = emu(h);
  files["ppt/presentation.xml"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}" saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:notesMasterIdLst><p:notesMasterId r:id="rId3"/></p:notesMasterIdLst><p:sldIdLst>${slideIds.join("")}</p:sldIdLst><p:sldSz cx="${cx}" cy="${cy}"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle><a:defPPr><a:defRPr lang="en-US"/></a:defPPr></p:defaultTextStyle></p:presentation>`);
  files["ppt/_rels/presentation.xml.rels"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${presRels.join("")}</Relationships>`);
  const themeXml = (name: string) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="${NS.a}" name="${esc(name)}"><a:themeElements><a:clrScheme name="${esc(name)}"><a:dk1><a:srgbClr val="${hex(theme.title) ?? "000000"}"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>${theme.accent.map((c, i) => `<a:accent${i + 1}><a:srgbClr val="${hex(c)}"/></a:accent${i + 1}>`).join("")}<a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="${esc(name)}"><a:majorFont><a:latin typeface="${esc(theme.titleFont)}"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="${esc(theme.bodyFont)}"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
  files["ppt/theme/theme1.xml"] = strToU8(themeXml(theme.name));
  files["ppt/theme/theme2.xml"] = strToU8(themeXml("Notes"));
  const emptyTree = '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree>';
  const clrMap = '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>';
  files["ppt/slideMasters/slideMaster1.xml"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}"><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>${emptyTree}</p:cSld>${clrMap}<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="4400"><a:latin typeface="+mj-lt"/></a:defRPr></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="2400"/></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`);
  files["ppt/slideMasters/_rels/slideMaster1.xml.rels"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`);
  files["ppt/slideLayouts/slideLayout1.xml"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}" type="blank" preserve="1"><p:cSld name="Blank">${emptyTree}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`);
  files["ppt/slideLayouts/_rels/slideLayout1.xml.rels"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`);
  files["ppt/notesMasters/notesMaster1.xml"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notesMaster xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}"><p:cSld>${emptyTree}</p:cSld>${clrMap}</p:notesMaster>`);
  files["ppt/notesMasters/_rels/notesMaster1.xml.rels"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme2.xml"/></Relationships>`);
  for (const [k, v] of Object.entries(media)) files[k] = v;
  const exts = new Set(Object.keys(media).map((k) => k.split(".").pop()!));
  const mime: Record<string, string> = { png: "image/png", jpg: "image/jpeg", gif: "image/gif" };
  files["[Content_Types].xml"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${[...exts].map((e) => `<Default Extension="${e}" ContentType="${mime[e] ?? "image/png"}"/>`).join("")}<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/notesMasters/notesMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/ppt/theme/theme2.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${ctypes.join("")}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`);
  files["_rels/.rels"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`);
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  files["docProps/core.xml"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(title)}</dc:title><dc:creator>Do-Whatever-You-Like Slides</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`);
  files["docProps/app.xml"] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Microsoft Office PowerPoint</Application><Slides>${deck.slides.length}</Slides></Properties>`);
  const ordered: Zippable = { "[Content_Types].xml": files["[Content_Types].xml"] };
  for (const [k, v] of Object.entries(files)) if (k !== "[Content_Types].xml") ordered[k] = v;
  return new Blob([zipSync(ordered, { level: 6 }) as BlobPart], { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
}

// ------------------------------------------------------------------ import

const kids = (el: Element | null | undefined, name?: string) => (el ? Array.from(el.children).filter((c) => !name || c.localName === name) : []);
const child = (el: Element | null | undefined, name: string) => kids(el, name)[0];
const desc = (el: Element | null | undefined, name: string) => (el ? (Array.from(el.getElementsByTagNameNS("*", name)) as Element[]) : []);

function bytesToDataUrl(bytes: Uint8Array, ext: string): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "gif" ? "image/gif" : ext === "svg" ? "image/svg+xml" : ext === "emf" || ext === "wmf" ? "image/png" : `image/${ext}`;
  return `data:${mime};base64,${btoa(bin)}`;
}

const SCHEME: Record<string, string> = { tx1: "#000000", dk1: "#000000", bg1: "#FFFFFF", lt1: "#FFFFFF", tx2: "#44546A", dk2: "#44546A", bg2: "#E7E6E6", lt2: "#E7E6E6", accent1: "#4472C4", accent2: "#ED7D31", accent3: "#A5A5A5", accent4: "#FFC000", accent5: "#5B9BD5", accent6: "#70AD47", hlink: "#0563C1" };

function colorOf(fill: Element | undefined, scheme: Record<string, string>): string | undefined {
  if (!fill) return undefined;
  const s = child(fill, "srgbClr")?.getAttribute("val");
  if (s) return `#${s}`;
  const sc = child(fill, "schemeClr")?.getAttribute("val");
  if (sc) return scheme[sc] ?? SCHEME[sc];
  const sys = child(fill, "sysClr")?.getAttribute("lastClr");
  return sys ? `#${sys}` : undefined;
}

export function importPptx(bytes: Uint8Array): Deck {
  const files = unzipSync(bytes);
  const parse = (p: string) => {
    const b = files[p];
    if (!b) return null;
    const d = new DOMParser().parseFromString(strFromU8(b), "application/xml");
    return d.getElementsByTagName("parsererror").length ? null : d;
  };
  const relsOf = (part: string) => {
    const dir = part.slice(0, part.lastIndexOf("/"));
    const file = part.slice(part.lastIndexOf("/") + 1);
    const d = parse(`${dir}/_rels/${file}.rels`);
    const m = new Map<string, { target: string; type: string }>();
    if (d) for (const r of Array.from(d.getElementsByTagName("Relationship"))) {
      const t = r.getAttribute("Target") ?? "";
      const abs = r.getAttribute("TargetMode") === "External" ? t : t.startsWith("/") ? t.slice(1) : normalize(`${dir}/${t}`);
      m.set(r.getAttribute("Id") ?? "", { target: abs, type: r.getAttribute("Type") ?? "" });
    }
    return m;
  };
  const pres = parse("ppt/presentation.xml");
  if (!pres) throw new Error("That file isn't a valid PowerPoint presentation.");
  const sz = desc(pres.documentElement, "sldSz")[0];
  const cx = Number(sz?.getAttribute("cx") ?? 12192000);
  const cy = Number(sz?.getAttribute("cy") ?? 6858000);
  const deck = newDeck("office");
  deck.ratio = cx / cy < 1.5 ? "4:3" : "16:9";
  deck.slides = [];
  const target = SIZE[deck.ratio];
  const scale = target.w / (cx / EMU);
  const presRels = relsOf("ppt/presentation.xml");
  // theme colours
  const scheme: Record<string, string> = { ...SCHEME };
  const themeRel = [...presRels.values()].find((r) => r.type.endsWith("/theme"));
  const themeDoc = themeRel ? parse(themeRel.target) : null;
  const clr = desc(themeDoc?.documentElement, "clrScheme")[0];
  if (clr) for (const c of kids(clr)) {
    const v = child(c, "srgbClr")?.getAttribute("val") ?? child(c, "sysClr")?.getAttribute("lastClr");
    if (v) scheme[c.localName] = `#${v}`;
  }
  scheme.tx1 = scheme.dk1 ?? scheme.tx1;
  scheme.bg1 = scheme.lt1 ?? scheme.bg1;
  scheme.tx2 = scheme.dk2 ?? scheme.tx2;
  scheme.bg2 = scheme.lt2 ?? scheme.bg2;

  // Default text sizes come from the slide master's text styles (in points = our units).
  const masterSizes = { title: 44, body: 28, other: 18 };
  const masterRel = [...presRels.values()].find((r) => r.type.endsWith("/slideMaster"));
  const masterDoc = masterRel ? parse(masterRel.target) : null;
  const lvl1 = (styleName: string) => Number(desc(desc(desc(masterDoc?.documentElement, styleName)[0], "lvl1pPr")[0], "defRPr")[0]?.getAttribute("sz") ?? 0) / 100;
  if (masterDoc) {
    masterSizes.title = lvl1("titleStyle") || 44;
    masterSizes.body = lvl1("bodyStyle") || 28;
    masterSizes.other = lvl1("otherStyle") || 18;
  }

  const placeholderXfrm = (parts: string[], ph: Element | undefined) => {
    if (!ph) return null;
    const type = ph.getAttribute("type") ?? "body";
    const idx = ph.getAttribute("idx");
    for (const part of parts) {
      const d = parse(part);
      if (!d) continue;
      for (const sp of desc(d.documentElement, "sp")) {
        const p2 = desc(sp, "ph")[0];
        if (!p2) continue;
        const t2 = p2.getAttribute("type") ?? "body";
        if ((idx && p2.getAttribute("idx") === idx) || t2 === type || (type === "ctrTitle" && t2 === "title") || (type === "subTitle" && t2 === "body")) {
          const x = desc(child(sp, "spPr"), "xfrm")[0];
          if (x) return x;
        }
      }
    }
    return null;
  };

  for (const sid of desc(pres.documentElement, "sldId")) {
    const rid = sid.getAttributeNS(NS.r, "id") ?? "";
    const part = presRels.get(rid)?.target;
    if (!part) continue;
    const doc = parse(part);
    if (!doc) continue;
    const rels = relsOf(part);
    const layoutPart = [...rels.values()].find((r) => r.type.endsWith("/slideLayout"))?.target;
    const masterPart = layoutPart ? [...relsOf(layoutPart).values()].find((r) => r.type.endsWith("/slideMaster"))?.target : undefined;
    const inherit = [layoutPart, masterPart].filter(Boolean) as string[];
    const slide: Slide = { id: elId(), layout: "blank", elements: [], notes: "", transition: "none", hidden: doc.documentElement.getAttribute("show") === "0" };
    const bgPr = desc(doc.documentElement, "bgPr")[0];
    if (bgPr) {
      const solid = child(bgPr, "solidFill");
      const blip = desc(bgPr, "blip")[0];
      const grad = child(bgPr, "gradFill");
      if (solid) slide.bg = colorOf(solid, scheme);
      else if (grad) {
        const stops = desc(grad, "gs").map((g) => colorOf(g, scheme)).filter(Boolean);
        if (stops.length) slide.bg = `linear-gradient(135deg,${stops.join(",")})`;
      } else if (blip) {
        const r = rels.get(blip.getAttributeNS(NS.r, "embed") ?? "");
        const b = r ? files[r.target] : undefined;
        if (b) slide.bg = `url(${bytesToDataUrl(b, r!.target.split(".").pop()!.toLowerCase())}) center/cover no-repeat`;
      }
    }
    if (!slide.bg) slide.bg = "#ffffff";
    if (desc(doc.documentElement, "transition")[0]) slide.transition = "fade";

    const geom = (xfrmEl: Element | null | undefined, off = { x: 0, y: 0 }) => {
      const o = child(xfrmEl ?? undefined, "off");
      const e = child(xfrmEl ?? undefined, "ext");
      if (!o || !e) return null;
      return {
        x: (Number(o.getAttribute("x")) / EMU) * scale + off.x,
        y: (Number(o.getAttribute("y")) / EMU) * scale + off.y,
        w: (Number(e.getAttribute("cx")) / EMU) * scale,
        h: (Number(e.getAttribute("cy")) / EMU) * scale,
        rot: Number(xfrmEl?.getAttribute("rot") ?? 0) / 60000,
      };
    };

    const textOf = (txBody: Element | undefined, ph: Element | undefined): { html: string; style: TextStyle } | null => {
      if (!txBody) return null;
      const ps = kids(txBody, "p");
      if (!ps.some((p) => (p.textContent ?? "").trim())) return null;
      const anchor = child(txBody, "bodyPr")?.getAttribute("anchor");
      const phType = ph?.getAttribute("type");
      const isTitle = phType === "title" || phType === "ctrTitle";
      let size = isTitle ? masterSizes.title : ph ? masterSizes.body : masterSizes.other;
      let align: TextStyle["align"] = phType === "ctrTitle" || phType === "subTitle" ? "center" : "left";
      let color: string | undefined;
      let bullets = phType === "body" || (!!ph && !phType && !isTitle);
      let html = "";
      let inList = false;
      const firstR = desc(txBody, "rPr")[0];
      if (firstR?.getAttribute("sz")) size = Number(firstR.getAttribute("sz")) / 100;
      const fc = colorOf(child(firstR, "solidFill"), scheme);
      if (fc) color = fc;
      for (const p of ps) {
        const pPr = child(p, "pPr");
        const algn = pPr?.getAttribute("algn");
        if (algn) align = algn === "ctr" ? "center" : algn === "r" ? "right" : algn === "just" ? "justify" : "left";
        const noBullet = child(pPr, "buNone");
        const hasBullet = Boolean(child(pPr, "buChar") || child(pPr, "buAutoNum")) || (bullets && !noBullet);
        if (noBullet) bullets = false;
        let inner = "";
        for (const r of kids(p)) {
          if (r.localName === "br") inner += "<br>";
          if (r.localName !== "r" && r.localName !== "fld") continue;
          const t = (child(r, "t")?.textContent ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
          const rPr = child(r, "rPr");
          let s = t;
          if (rPr?.getAttribute("b") === "1") s = `<b>${s}</b>`;
          if (rPr?.getAttribute("i") === "1") s = `<i>${s}</i>`;
          if (rPr?.getAttribute("u") && rPr.getAttribute("u") !== "none") s = `<u>${s}</u>`;
          const rc = colorOf(child(rPr, "solidFill"), scheme);
          const rs = rPr?.getAttribute("sz");
          const css = [rc && rc !== color ? `color:${rc}` : "", rs && Number(rs) / 100 !== size ? `font-size:${Number(rs) / 100}px` : ""].filter(Boolean).join(";");
          if (css) s = `<span style="${css}">${s}</span>`;
          inner += s;
        }
        if (hasBullet && inner.trim()) {
          if (!inList) {
            html += "<ul>";
            inList = true;
          }
          html += `<li>${inner}</li>`;
        } else {
          if (inList) {
            html += "</ul>";
            inList = false;
          }
          html += `<p>${inner || "<br>"}</p>`;
        }
      }
      if (inList) html += "</ul>";
      return { html, style: { size: size * 1, align, valign: anchor === "ctr" ? "middle" : anchor === "b" ? "bottom" : isTitle ? "middle" : "top", color, bold: isTitle ? undefined : undefined, bullets } };
    };

    const walk = (tree: Element, off = { x: 0, y: 0 }) => {
      for (const node of kids(tree)) {
        if (node.localName === "grpSp") {
          const gx = desc(child(node, "grpSpPr"), "xfrm")[0];
          const o = child(gx, "off");
          const chOff = child(gx, "chOff");
          const dx = o && chOff ? ((Number(o.getAttribute("x")) - Number(chOff.getAttribute("x"))) / EMU) * scale : 0;
          const dy = o && chOff ? ((Number(o.getAttribute("y")) - Number(chOff.getAttribute("y"))) / EMU) * scale : 0;
          walk(node, { x: off.x + dx, y: off.y + dy });
          continue;
        }
        const spPr = child(node, "spPr");
        const ph = desc(node, "ph")[0];
        let g = geom(desc(spPr, "xfrm")[0], off);
        if (!g && ph) g = geom(placeholderXfrm(inherit, ph), off);
        if (node.localName === "graphicFrame") g = geom(child(node, "xfrm"), off);
        if (!g) continue;
        const base = { id: elId(), x: g.x, y: g.y, w: Math.max(4, g.w), h: Math.max(4, g.h), rot: g.rot };
        if (node.localName === "sp" || node.localName === "cxnSp") {
          const prst = child(spPr, "prstGeom")?.getAttribute("prst") ?? "rect";
          const fill = colorOf(child(spPr, "solidFill"), scheme);
          const ln = child(spPr, "ln");
          const stroke = child(ln, "noFill") ? undefined : colorOf(child(ln, "solidFill"), scheme);
          const txt = textOf(child(node, "txBody"), ph);
          const phType = ph?.getAttribute("type");
          const role: El["role"] = phType === "title" || phType === "ctrTitle" ? "title" : phType === "subTitle" ? "subtitle" : ph ? "body" : undefined;
          if (node.localName === "cxnSp" || prst === "line" || prst.includes("Connector")) {
            const tail = child(ln, "tailEnd")?.getAttribute("type");
            slide.elements.push({ ...base, h: Math.max(10, base.h), type: "shape", shape: { kind: tail && tail !== "none" ? "arrowLine" : "line", stroke: stroke ?? "#000000", strokeW: Math.max(1, Number(ln?.getAttribute("w") ?? 12700) / EMU) } });
            continue;
          }
          if (fill || stroke) {
            slide.elements.push({ ...base, type: "shape", shape: { kind: FROM_PRST[prst] ?? "rect", fill: fill ?? "transparent", stroke, strokeW: stroke ? Math.max(1, Number(ln?.getAttribute("w") ?? 12700) / EMU) : undefined }, html: txt?.html, text: txt ? { ...txt.style, valign: txt.style.valign === "top" ? "middle" : txt.style.valign } : undefined, role });
          } else if (txt) slide.elements.push({ ...base, type: "text", html: txt.html, text: txt.style, role });
        } else if (node.localName === "pic") {
          const blip = desc(node, "blip")[0];
          const r = rels.get(blip?.getAttributeNS(NS.r, "embed") ?? "");
          const b = r ? files[r.target] : undefined;
          if (b) slide.elements.push({ ...base, type: "image", src: bytesToDataUrl(b, r!.target.split(".").pop()!.toLowerCase()), fit: "contain" });
        } else if (node.localName === "graphicFrame") {
          const tbl = desc(node, "tbl")[0];
          if (tbl) {
            const rows = desc(tbl, "tr").map((tr) => desc(tr, "tc").map((tc) => desc(tc, "t").map((t) => t.textContent).join("")));
            slide.elements.push({ ...base, type: "table", table: { rows, header: desc(tbl, "tblPr")[0]?.getAttribute("firstRow") === "1" }, text: { size: 14, align: "left", valign: "top" } });
          }
        }
      }
    };
    const tree = desc(doc.documentElement, "spTree")[0];
    if (tree) walk(tree);
    const notesPart = [...rels.values()].find((r) => r.type.endsWith("/notesSlide"))?.target;
    const notes = notesPart ? parse(notesPart) : null;
    if (notes) {
      const body = desc(notes.documentElement, "sp").find((sp) => desc(sp, "ph")[0]?.getAttribute("type") === "body");
      slide.notes = desc(body, "p").map((p) => desc(p, "t").map((t) => t.textContent).join("")).join("\n").trim();
    }
    deck.slides.push(slide);
  }
  if (!deck.slides.length) throw new Error("That presentation has no slides.");
  return deck;
}

function normalize(path: string): string {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (part === "..") out.pop();
    else if (part && part !== ".") out.push(part);
  }
  return out.join("/");
}
