/** Word editor exports besides DOCX: print/PDF with real pages, HTML, Markdown and plain text. */
import { docCss, PAGE_MM, type WordDoc } from "./model";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const cssStr = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/** A standalone HTML page that prints with the document's page size, margins, header, footer and page numbers. */
export function printableHtml(doc: WordDoc, title: string): string {
  const p = doc.page;
  const [w, h] = PAGE_MM[p.size];
  const [W, H] = p.landscape ? [h, w] : [w, h];
  const num = 'counter(page) " / " counter(pages)';
  const bottom = p.pageNumbers === "bottom-center" ? (p.footer ? `${cssStr(p.footer + "    ")} ${num}` : num) : p.footer ? cssStr(p.footer) : "";
  const top = p.header ? cssStr(p.header) : "";
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.19.1/dist/katex.min.css">
<style>
@page{size:${W}mm ${H}mm;margin:${p.margins.top}mm ${p.margins.right}mm ${p.margins.bottom}mm ${p.margins.left}mm;
${top ? `@top-center{content:${top};font:9pt Calibri,Arial,sans-serif;color:#555}` : ""}
${p.pageNumbers === "top-right" ? `@top-right{content:${num};font:9pt Calibri,Arial,sans-serif;color:#555}` : ""}
${bottom ? `@bottom-center{content:${bottom};font:9pt Calibri,Arial,sans-serif;color:#555}` : ""}
${p.pageNumbers === "bottom-right" ? `@bottom-right{content:${num};font:9pt Calibri,Arial,sans-serif;color:#555}` : ""}}
html,body{margin:0;background:${p.pageColor ?? "#fff"};-webkit-print-color-adjust:exact;print-color-adjust:exact}
${docCss(".doc-body")}
.doc-body{${p.columns > 1 ? `column-count:${p.columns};column-gap:12mm;` : ""}}
.doc-body .page-break{border:0;margin:0}.doc-body .page-break::after{display:none}
.doc-body .toc{background:none}
${p.watermark ? `.wm{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;z-index:-1}.wm span{font:700 90pt Calibri,Arial,sans-serif;color:rgba(0,0,0,.07);transform:rotate(-40deg);white-space:nowrap}` : ""}
@media screen{body{background:#eee}.sheet{background:${p.pageColor ?? "#fff"};width:${W}mm;min-height:${H}mm;margin:12px auto;padding:${p.margins.top}mm ${p.margins.right}mm ${p.margins.bottom}mm ${p.margins.left}mm;box-sizing:border-box;box-shadow:0 1px 6px rgba(0,0,0,.15)}}
</style></head><body>${p.watermark ? `<div class="wm"><span>${esc(p.watermark)}</span></div>` : ""}<div class="sheet"><div class="doc-body">${doc.html}</div></div></body></html>`;
}

export function printDoc(doc: WordDoc, title: string) {
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.appendChild(frame);
  const d = frame.contentDocument!;
  d.open();
  d.write(printableHtml(doc, title));
  d.close();
  const go = () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 60_000);
  };
  setTimeout(go, 500);
}

/** HTML to Markdown for the common blocks and inline marks. */
export function htmlToMarkdown(html: string): string {
  const root = document.createElement("div");
  root.innerHTML = html;
  const inline = (n: Node): string => {
    if (n.nodeType === 3) return (n as Text).data.replace(/\s+/g, " ").replace(/([*_`[\]\\])/g, "\\$1");
    if (n.nodeType !== 1) return "";
    const el = n as HTMLElement;
    const inner = Array.from(el.childNodes).map(inline).join("");
    switch (el.tagName) {
      case "B":
      case "STRONG":
        return inner.trim() ? `**${inner}**` : inner;
      case "I":
      case "EM":
        return inner.trim() ? `*${inner}*` : inner;
      case "S":
      case "STRIKE":
      case "DEL":
        return `~~${inner}~~`;
      case "CODE":
        return "`" + (el.textContent ?? "") + "`";
      case "A":
        return `[${inner}](${el.getAttribute("href") ?? ""})`;
      case "IMG":
        return `![${el.getAttribute("alt") ?? ""}](${(el.getAttribute("src") ?? "").startsWith("data:") ? "image" : el.getAttribute("src")})`;
      case "BR":
        return "  \n";
      default:
        return el.classList.contains("math") ? `$${el.getAttribute("data-latex") ?? ""}$` : inner;
    }
  };
  const block = (el: Element, depth = 0): string => {
    const tag = el.tagName;
    if (/^H[1-6]$/.test(tag)) return `${"#".repeat(Number(tag[1]))} ${inline(el).trim()}\n\n`;
    if (tag === "P" || tag === "DIV") {
      if (el.classList.contains("page-break")) return "\n---\n\n";
      if (el.classList.contains("toc")) return "";
      return `${inline(el).trim()}\n\n`;
    }
    if (tag === "BLOCKQUOTE") return `> ${inline(el).trim()}\n\n`;
    if (tag === "PRE") return "```\n" + (el.textContent ?? "") + "\n```\n\n";
    if (tag === "HR") return "---\n\n";
    if (tag === "UL" || tag === "OL") {
      let i = 1;
      return (
        Array.from(el.children)
          .map((li) => {
            const nested = Array.from(li.children).filter((c) => c.tagName === "UL" || c.tagName === "OL");
            const clone = li.cloneNode(true) as Element;
            clone.querySelectorAll(":scope > ul, :scope > ol").forEach((x) => x.remove());
            const check = el.classList.contains("checklist") ? (li.getAttribute("data-checked") === "true" ? "[x] " : "[ ] ") : "";
            const bullet = tag === "OL" ? `${i++}.` : "-";
            return `${"  ".repeat(depth)}${bullet} ${check}${inline(clone).trim()}\n${nested.map((n) => block(n, depth + 1)).join("")}`;
          })
          .join("") + (depth ? "" : "\n")
      );
    }
    if (tag === "TABLE") {
      const rows = Array.from(el.querySelectorAll("tr")).map((tr) => Array.from(tr.children).map((c) => inline(c).trim().replace(/\|/g, "\\|")));
      if (!rows.length) return "";
      const w = Math.max(...rows.map((r) => r.length));
      const line = (r: string[]) => `| ${Array.from({ length: w }, (_, i) => r[i] ?? "").join(" | ")} |`;
      return [line(rows[0]), `| ${Array(w).fill("---").join(" | ")} |`, ...rows.slice(1).map(line)].join("\n") + "\n\n";
    }
    return `${inline(el).trim()}\n\n`;
  };
  return Array.from(root.children).map((c) => block(c)).join("").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

export function htmlToText(html: string): string {
  const root = document.createElement("div");
  root.innerHTML = html.replace(/<\/(p|h\d|li|tr|blockquote|pre|div)>/gi, "</$1>\n").replace(/<br\s*\/?>/gi, "\n");
  return (root.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

export function standaloneHtml(doc: WordDoc, title: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>body{max-width:820px;margin:40px auto;padding:0 20px;background:${doc.page.pageColor ?? "#fff"}}${docCss(".doc-body")}</style></head><body><article class="doc-body">${doc.html}</article></body></html>`;
}
