/** The Word editor's document: rich HTML body plus page setup, header and footer. */

export type PageSize = "A4" | "Letter" | "Legal" | "A5" | "A3";
export type PageSetup = {
  size: PageSize;
  landscape: boolean;
  /** margins in millimetres */
  margins: { top: number; right: number; bottom: number; left: number };
  columns: 1 | 2 | 3;
  pageColor?: string;
  watermark?: string;
  header: string;
  footer: string;
  /** "none" | "bottom-center" | "bottom-right" | "top-right" */
  pageNumbers: "none" | "bottom-center" | "bottom-right" | "top-right";
  differentFirst?: boolean;
};

export type WordDoc = { html: string; page: PageSetup };

/** Page sizes in millimetres (portrait). */
export const PAGE_MM: Record<PageSize, [number, number]> = { A4: [210, 297], Letter: [215.9, 279.4], Legal: [215.9, 355.6], A5: [148, 210], A3: [297, 420] };
export const MM_TO_PX = 96 / 25.4;
export const MM_TO_TWIP = 1440 / 25.4;

export const DEFAULT_PAGE: PageSetup = {
  size: "A4",
  landscape: false,
  margins: { top: 25.4, right: 25.4, bottom: 25.4, left: 25.4 },
  columns: 1,
  header: "",
  footer: "",
  pageNumbers: "none",
};

export function pagePx(p: PageSetup): { w: number; h: number } {
  const [w, h] = PAGE_MM[p.size];
  const [W, H] = p.landscape ? [h, w] : [w, h];
  return { w: Math.round(W * MM_TO_PX), h: Math.round(H * MM_TO_PX) };
}

/** Paragraph styles (the Styles gallery), as tag + class. */
export const PARA_STYLES: { id: string; label: string; tag: string; cls?: string }[] = [
  { id: "Normal", label: "Normal", tag: "p" },
  { id: "Title", label: "Title", tag: "h1", cls: "doc-title" },
  { id: "Subtitle", label: "Subtitle", tag: "p", cls: "doc-subtitle" },
  { id: "Heading1", label: "Heading 1", tag: "h1" },
  { id: "Heading2", label: "Heading 2", tag: "h2" },
  { id: "Heading3", label: "Heading 3", tag: "h3" },
  { id: "Heading4", label: "Heading 4", tag: "h4" },
  { id: "Quote", label: "Quote", tag: "blockquote" },
  { id: "Code", label: "Code", tag: "pre" },
];

/** Shared document CSS for the editor, print and HTML export. */
export function docCss(scope = ".doc-body"): string {
  return `
${scope}{font-family:Calibri,Carlito,"Segoe UI",Arial,sans-serif;font-size:11pt;line-height:1.15;color:#111;word-wrap:break-word}
${scope} p{margin:0 0 8pt}
${scope} h1{font-size:20pt;font-weight:600;color:#1f3864;margin:18pt 0 6pt;line-height:1.2}
${scope} h2{font-size:16pt;font-weight:600;color:#2f5496;margin:14pt 0 4pt;line-height:1.2}
${scope} h3{font-size:13pt;font-weight:600;color:#1f3864;margin:12pt 0 4pt}
${scope} h4{font-size:11pt;font-weight:600;font-style:italic;color:#2f5496;margin:10pt 0 2pt}
${scope} h1.doc-title{font-size:28pt;font-weight:400;color:#111;margin:0 0 4pt;letter-spacing:-0.5px}
${scope} p.doc-subtitle{font-size:15pt;color:#595959;margin:0 0 12pt}
${scope} blockquote{margin:10pt 36pt;padding:4pt 12pt;border-left:3px solid #4472c4;color:#404040;font-style:italic}
${scope} pre{font-family:Consolas,"Courier New",monospace;font-size:10pt;background:#f4f4f4;border:1px solid #e1e1e1;padding:8pt;white-space:pre-wrap;margin:0 0 8pt}
${scope} code{font-family:Consolas,"Courier New",monospace;background:#f1f1f1;padding:0 2px;border-radius:2px}
${scope} ul,${scope} ol{margin:0 0 8pt;padding-left:24pt}
${scope} ul{list-style:disc}${scope} ul ul{list-style:circle}${scope} ul ul ul{list-style:square}
/* Typed lists (a, A, i, I) carry an inline list-style-type; see setListType in the editor. */
${scope} ol:not([type]){list-style:decimal}${scope} ol ol:not([type]){list-style:lower-alpha}${scope} ol ol ol:not([type]){list-style:lower-roman}
${scope} li{margin:0 0 2pt}
${scope} ul.checklist{list-style:none;padding-left:4pt}
${scope} ul.checklist li{display:flex;gap:6px;align-items:baseline}
${scope} ul.checklist li::before{content:"☐";font-size:1.05em}
${scope} ul.checklist li[data-checked="true"]::before{content:"☑"}
${scope} ul.checklist li[data-checked="true"]{text-decoration:line-through;color:#777}
${scope} table{border-collapse:collapse;width:100%;margin:0 0 8pt}
${scope} td,${scope} th{border:1px solid #bfbfbf;padding:4pt 6pt;vertical-align:top;min-width:24px}
${scope} th{background:#f2f2f2;font-weight:600;text-align:left}
${scope} img{max-width:100%;height:auto;display:inline-block;vertical-align:baseline}
${scope} hr{border:0;border-top:1px solid #a6a6a6;margin:10pt 0}
${scope} a{color:#0563c1;text-decoration:underline}
${scope} .page-break{break-after:page;page-break-after:always;height:0;border-top:1px dashed #b4b4b4;margin:14pt 0;position:relative}
${scope} .page-break::after{content:"Page break";position:absolute;left:50%;top:-8px;transform:translateX(-50%);font:10px system-ui;background:#fff;color:#999;padding:0 6px}
${scope} .toc{border:1px solid #e3e3e3;padding:8pt 12pt;margin:0 0 12pt;background:#fafafa}
${scope} .toc p{margin:0 0 2pt}
${scope} .toc a{text-decoration:none;color:inherit}
${scope} .footnotes{border-top:1px solid #bbb;margin-top:18pt;padding-top:6pt;font-size:9pt}
${scope} .math{font-style:normal}
${scope} mark{padding:0 1px}
${scope} .comment{background:#fff2a8;border-bottom:2px solid #f2c200;cursor:help}
`;
}
