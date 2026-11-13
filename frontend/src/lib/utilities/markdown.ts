/**
 * Markdown → safe HTML for the Markdown editor and viewer, all in the browser.
 *
 * GitHub-flavoured Markdown (marked): tables, task lists, strikethrough, autolinks, plus footnotes,
 * heading anchors, highlighted code blocks (highlight.js), $math$ and $$math$$ (KaTeX) and
 * ```mermaid diagrams (drawn afterwards by renderMermaid). Every render is sanitised with DOMPurify,
 * so a pasted document can't run scripts or load frames in this page.
 */

import type { Tokens } from "marked";

export type Heading = { level: number; text: string; id: string };
export type Rendered = { html: string; headings: Heading[]; hasMath: boolean; hasMermaid: boolean };

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** GitHub's anchor style: lower case, punctuation dropped, spaces to dashes, repeats numbered. */
function slugger() {
  const seen = new Map<string, number>();
  return (text: string) => {
    const base =
      text
        .toLowerCase()
        .trim()
        .replace(/<[^>]+>/g, "")
        .replace(/[^\p{L}\p{N}\s_-]/gu, "")
        .replace(/\s+/g, "-") || "section";
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n ? `${base}-${n}` : base;
  };
}

type Libs = {
  Marked: typeof import("marked").Marked;
  footnote: typeof import("marked-footnote").default;
  DOMPurify: typeof import("dompurify").default;
  hljs: typeof import("highlight.js").default;
};
let libs: Promise<Libs> | null = null;
const load = () =>
  (libs ??= Promise.all([import("marked"), import("marked-footnote"), import("dompurify"), import("highlight.js/lib/common")]).then(
    ([m, f, d, h]) => ({ Marked: m.Marked, footnote: f.default, DOMPurify: d.default, hljs: h.default }),
  ));

let katex: Promise<typeof import("katex").default> | null = null;
const loadKatex = () => (katex ??= import("katex").then((k) => k.default));

const MATH_BLOCK = /^\$\$([\s\S]+?)\$\$(?:\n|$)/;
const MATH_INLINE = /^\$(?!\s)((?:\\.|[^\\$\n])+?)(?<!\s)\$(?!\d)/;

export async function renderMarkdown(src: string): Promise<Rendered> {
  const { Marked, footnote, DOMPurify, hljs } = await load();
  const hasMath = /\$\$[\s\S]+?\$\$|(^|[^\\$])\$(?!\s)[^$\n]+?\$(?!\d)/.test(src);
  const hasMermaid = /^```\s*mermaid\b/m.test(src);
  const k = hasMath ? await loadKatex() : null;
  const headings: Heading[] = [];
  const slug = slugger();

  const marked = new Marked({ gfm: true, breaks: false });
  marked.use(footnote({ description: "Footnotes" }));
  marked.use({
    extensions: [
      {
        name: "mathBlock",
        level: "block",
        start: (s: string) => s.indexOf("$$"),
        tokenizer(s: string) {
          const m = MATH_BLOCK.exec(s);
          return m ? { type: "mathBlock", raw: m[0], text: m[1].trim() } : undefined;
        },
        renderer: (t) => (k ? `<div class="md-math">${k.renderToString(String(t.text), { displayMode: true, throwOnError: false, output: "htmlAndMathml" })}</div>` : `<pre>${escapeHtml(t.raw)}</pre>`),
      },
      {
        name: "mathInline",
        level: "inline",
        start: (s: string) => s.indexOf("$"),
        tokenizer(s: string) {
          const m = MATH_INLINE.exec(s);
          return m ? { type: "mathInline", raw: m[0], text: m[1] } : undefined;
        },
        renderer: (t) => (k ? k.renderToString(String(t.text), { throwOnError: false, output: "htmlAndMathml" }) : escapeHtml(t.raw)),
      },
    ],
    renderer: {
      heading({ tokens, depth }: Tokens.Heading) {
        const inner = this.parser.parseInline(tokens);
        const text = inner.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
        const id = slug(text);
        headings.push({ level: depth, text, id });
        return `<h${depth} id="${id}"><a class="md-anchor" href="#${id}" aria-hidden="true">#</a>${inner}</h${depth}>\n`;
      },
      code({ text, lang }: Tokens.Code) {
        const language = (lang ?? "").trim().split(/\s+/)[0].toLowerCase();
        if (language === "mermaid") return `<div class="md-mermaid" data-code="${escapeHtml(text)}"><pre>${escapeHtml(text)}</pre></div>\n`;
        let body = escapeHtml(text);
        let label = language;
        if (language && hljs.getLanguage(language)) body = hljs.highlight(text, { language, ignoreIllegals: true }).value;
        else if (!language && text.length < 20000) {
          const auto = hljs.highlightAuto(text);
          if (auto.relevance > 6) {
            body = auto.value;
            label = auto.language ?? "";
          }
        }
        return `<pre class="md-code"${label ? ` data-lang="${escapeHtml(label)}"` : ""}><code class="hljs${label ? ` language-${escapeHtml(label)}` : ""}">${body}</code></pre>\n`;
      },
    },
  });

  const raw = await marked.parse(src);
  hardenLinks(DOMPurify);
  const html = DOMPurify.sanitize(raw, {
    // DOMPurify's defaults already cover HTML, SVG and MathML (KaTeX); a USE_PROFILES list would
    // also drop the data-* attributes below.
    ADD_ATTR: ["data-code", "data-lang", "aria-hidden", "target"],
    FORBID_TAGS: ["style", "form", "iframe", "object", "embed"],
  });
  return { html, headings, hasMath, hasMermaid };
}

/** Links in the preview open in a new tab (safely), except jumps within the document. */
let hooked = false;
function hardenLinks(DOMPurify: Libs["DOMPurify"]) {
  if (hooked) return;
  hooked = true;
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    const href = node.tagName === "A" ? node.getAttribute("href") : null;
    if (href && !href.startsWith("#")) {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer nofollow");
    }
  });
}

/** The .md-prose rules from this page's stylesheets, for the exported HTML file. */
export function proseCss(): string {
  const out: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // A cross-origin sheet (fonts): nothing of ours in it.
    }
    for (const r of Array.from(rules)) if (r.cssText.includes(".md-prose")) out.push(r.cssText);
  }
  return out.join("\n");
}

/** Draws every ```mermaid block inside `root` as an SVG (mermaid in strict mode: no scripts, no HTML labels). */
export async function renderMermaid(root: HTMLElement, dark: boolean) {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>(".md-mermaid:not(.md-mermaid-done)"));
  if (!blocks.length) return;
  const mermaid = (await import("mermaid")).default;
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: dark ? "dark" : "neutral", fontFamily: "inherit" });
  let n = 0;
  for (const el of blocks) {
    const code = el.getAttribute("data-code") ?? el.querySelector("pre")?.textContent ?? "";
    el.classList.add("md-mermaid-done");
    try {
      const { svg } = await mermaid.render(`mmd-${Date.now().toString(36)}-${n++}`, code);
      el.innerHTML = svg;
    } catch (e) {
      el.innerHTML = `<p class="md-error">Diagram error: ${escapeHtml(String((e as Error).message ?? e).split("\n")[0])}</p><pre>${escapeHtml(code)}</pre>`;
    }
  }
}

export function stats(src: string) {
  const text = src.replace(/```[\s\S]*?```/g, " ").replace(/[#>*_`~\-[\]()!|]/g, " ");
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  return { words, chars: src.length, lines: src ? src.split("\n").length : 0, minutes: Math.max(1, Math.round(words / 220)) };
}

/** Turns a GitHub/GitLab/Gist page link into its raw file, which allows cross-origin reads. */
export function rawUrl(input: string): string {
  const u = input.trim();
  let m = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/.exec(u);
  if (m) return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}`;
  m = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/?$/.exec(u);
  if (m) return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/HEAD/README.md`;
  m = /^https?:\/\/gitlab\.com\/(.+?)\/-\/blob\/(.+)$/.exec(u);
  if (m) return `https://gitlab.com/${m[1]}/-/raw/${m[2]}`;
  m = /^https?:\/\/gist\.github\.com\/([^/]+)\/([0-9a-f]+)\/?$/.exec(u);
  if (m) return `https://gist.githubusercontent.com/${m[1]}/${m[2]}/raw`;
  return u;
}

/** A complete, self-contained HTML page of the rendered document, for download or print. */
export function standaloneHtml(title: string, bodyHtml: string, css: string, hasMath: boolean) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
${hasMath ? '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.19.1/dist/katex.min.css">' : ""}
<style>
body { margin: 0; background: #fff; color: #1f2328; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
main { max-width: 820px; margin: 0 auto; padding: 40px 24px 80px; }
@media print { main { padding: 0; } .md-anchor { display: none; } pre, table, img, .md-mermaid { break-inside: avoid; } }
${css}
</style>
</head>
<body>
<main class="md-prose">
${bodyHtml}
</main>
</body>
</html>
`;
}
