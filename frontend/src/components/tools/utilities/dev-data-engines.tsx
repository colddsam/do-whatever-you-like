"use client";

import { useMemo, useState } from "react";
import { ArrowLeftRight, AlertTriangle, Code2, FileCode2, Shield } from "lucide-react";
import * as yaml from "js-yaml";
import { Marked } from "marked";
import { jsonToCsv, parseJson } from "@/lib/dev";
import { cn } from "@/lib/utils";
import { Chips, Notice, Panel, Row, TextField, Toggle } from "../pdf/kit";
import { CopyButton, Editor, Output, TextFilePick, ValueList, ValueRow } from "../dev/parts";
import type { EngineProps } from "./text-engines";

/* ========================================================================
 * 1. DATA FORMAT CROSS-CONVERTER (JSON ↔ CSV / YAML / XML, HTML ↔ Markdown)
 * ======================================================================== */

type ConvertPair = "json-csv" | "json-yaml" | "json-xml" | "html-md";

const PAIRS: { id: ConvertPair; a: string; b: string; label: string; exts: [string, string] }[] = [
  { id: "json-csv", a: "JSON", b: "CSV", label: "JSON ↔ CSV", exts: ["json", "csv"] },
  { id: "json-yaml", a: "JSON", b: "YAML", label: "JSON ↔ YAML", exts: ["json", "yaml"] },
  { id: "json-xml", a: "JSON", b: "XML", label: "JSON ↔ XML", exts: ["json", "xml"] },
  { id: "html-md", a: "HTML", b: "Markdown", label: "HTML ↔ Markdown", exts: ["html", "md"] },
];

const SAMPLES: Record<`${ConvertPair}:${"a2b" | "b2a"}`, string> = {
  "json-csv:a2b": JSON.stringify(
    [
      { id: 1, name: "Aarav Mehta", role: "Backend Engineer", city: "Bengaluru", active: true },
      { id: 2, name: "Maya Chen", role: "Product Designer", city: "Toronto", active: true },
      { id: 3, name: "Lucas Silva", role: "Data Analyst", city: "Lisbon", active: false },
    ],
    null,
    2,
  ),
  "json-csv:b2a": `id,name,role,city,active\n1,Aarav Mehta,Backend Engineer,Bengaluru,true\n2,Maya Chen,Product Designer,Toronto,true\n3,Lucas Silva,Data Analyst,Lisbon,false`,
  "json-yaml:a2b": JSON.stringify(
    {
      service: "invoice-worker",
      runtime: { node: "22", memoryMB: 512, regions: ["ap-south-1", "us-east-1"] },
      retries: { max: 3, backoffSeconds: 1.5 },
    },
    null,
    2,
  ),
  "json-yaml:b2a": `service: invoice-worker\nruntime:\n  node: "22"\n  memoryMB: 512\n  regions:\n    - ap-south-1\n    - us-east-1\nretries:\n  max: 3\n  backoffSeconds: 1.5`,
  "json-xml:a2b": JSON.stringify(
    {
      catalog: {
        book: [
          { "@id": "bk101", title: "Designing Data-Intensive Apps", author: "Martin Kleppmann", year: 2017 },
          { "@id": "bk102", title: "Clean Architecture", author: "Robert C. Martin", year: 2017 },
        ],
      },
    },
    null,
    2,
  ),
  "json-xml:b2a": `<?xml version="1.0" encoding="UTF-8"?>\n<catalog>\n  <book id="bk101">\n    <title>Designing Data-Intensive Apps</title>\n    <author>Martin Kleppmann</author>\n    <year>2017</year>\n  </book>\n  <book id="bk102">\n    <title>Clean Architecture</title>\n    <author>Robert C. Martin</author>\n    <year>2017</year>\n  </book>\n</catalog>`,
  "html-md:a2b": `<article>\n  <h1>Release Notes v2.4</h1>\n  <p>Built for <strong>speed</strong> and <em>zero server cost</em>. See <a href="https://example.com/docs">the docs</a>.</p>\n  <ul>\n    <li>Client-side ZIP &amp; SQLite tools</li>\n    <li>Instant colour scale exports</li>\n  </ul>\n  <pre><code class="language-ts">const ready = true;\n</code></pre>\n</article>`,
  "html-md:b2a": `# Release Notes v2.4\n\nBuilt for **speed** and _zero server cost_. See [the docs](https://example.com/docs).\n\n- Client-side ZIP & SQLite tools\n- Instant colour scale exports\n\n\`\`\`ts\nconst ready = true;\n\`\`\``,
};

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/).find((l) => l.trim()) ?? "";
  const candidates = [",", "\t", ";", "|"] as const;
  let best = ",";
  let bestCount = -1;
  for (const delim of candidates) {
    let inQuotes = false;
    let count = 0;
    for (let i = 0; i < firstLine.length; i++) {
      const ch = firstLine[i];
      if (ch === '"') inQuotes = !inQuotes;
      else if (!inQuotes && ch === delim) count++;
    }
    if (count > bestCount) {
      bestCount = count;
      best = delim;
    }
  }
  return bestCount > 0 ? best : ",";
}

export function parseCsvRows(text: string, delimiter = ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\r" && next === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i++;
    } else if (ch === "\n" || ch === "\r") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

function coerceCsvValue(raw: string): unknown {
  const t = raw.trim();
  if (t === "") return "";
  if (t === "true") return true;
  if (t === "false") return false;
  if (t === "null") return null;
  if (/^-?\d+(?:\.\d+)?$/.test(t) && Number.isFinite(Number(t))) {
    // Preserve leading zeros such as postal codes / IDs like "007".
    if (/^-?0\d/.test(t)) return raw;
    return Number(t);
  }
  return raw;
}

function csvToJson(text: string, delimOpt: string, headers: boolean, coerce: boolean): unknown {
  const clean = text.replace(/^\uFEFF/, "");
  const delim = delimOpt === "auto" ? detectDelimiter(clean) : delimOpt;
  const rows = parseCsvRows(clean, delim);
  if (rows.length === 0) return [];
  const conv = (v: string) => (coerce ? coerceCsvValue(v) : v);
  if (!headers) return rows.map((r) => r.map(conv));
  const cols = rows[0].map((c, idx) => c.trim() || `column_${idx + 1}`);
  return rows.slice(1).map((r) => {
    const obj: Record<string, unknown> = {};
    cols.forEach((col, i) => {
      obj[col] = i < r.length ? conv(r[i]) : "";
    });
    return obj;
  });
}

function flattenObject(obj: Record<string, unknown>, prefix = "", out: Record<string, unknown> = {}): Record<string, unknown> {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      flattenObject(v as Record<string, unknown>, key, out);
    } else {
      out[key] = Array.isArray(v) ? JSON.stringify(v) : v;
    }
  }
  return out;
}

function objectsToDelimited(value: unknown, delim: string, flatten: boolean): string {
  const arr = Array.isArray(value) ? value : [value];
  if (delim === "," && !flatten) {
    const res = jsonToCsv(arr);
    if (res !== null) return res;
  }
  const rows: Record<string, unknown>[] = arr.map((item): Record<string, unknown> => {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      return flatten ? flattenObject(item as Record<string, unknown>) : (item as Record<string, unknown>);
    }
    return { value: item };
  });
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    return s.includes(delim) || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.map(esc).join(delim), ...rows.map((r) => cols.map((c) => esc(r[c])).join(delim))].join("\n");
}

const xmlEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function jsonToXml(value: unknown, rootName: string, indentSize: number): string {
  const pad = (d: number) => " ".repeat(d * indentSize);
  const sanitizeTag = (k: string) => (/^[A-Za-z_][\w.-]*$/.test(k) ? k : `item`);

  const emitNode = (tag: string, val: unknown, depth: number): string => {
    const safeTag = sanitizeTag(tag);
    if (val === null || val === undefined) return `${pad(depth)}<${safeTag} />`;
    if (typeof val !== "object") return `${pad(depth)}<${safeTag}>${xmlEscape(String(val))}</${safeTag}>`;
    if (Array.isArray(val)) {
      return val.map((item) => emitNode(safeTag, item, depth)).join("\n");
    }
    const entries = Object.entries(val as Record<string, unknown>);
    const attrs: string[] = [];
    const children: [string, unknown][] = [];
    let textVal: string | null = null;
    for (const [k, v] of entries) {
      if (k === "#text") textVal = v === null || v === undefined ? "" : String(v);
      else if (k.startsWith("@") && k.length > 1) attrs.push(`${sanitizeTag(k.slice(1))}="${xmlEscape(String(v ?? ""))}"`);
      else children.push([k, v]);
    }
    const open = attrs.length ? `<${safeTag} ${attrs.join(" ")}` : `<${safeTag}`;
    if (children.length === 0 && textVal === null) return `${pad(depth)}${open} />`;
    if (children.length === 0 && textVal !== null) return `${pad(depth)}${open}>${xmlEscape(textVal)}</${safeTag}>`;
    const inner = [
      ...(textVal !== null ? [`${pad(depth + 1)}${xmlEscape(textVal)}`] : []),
      ...children.map(([k, v]) => emitNode(k, v, depth + 1)),
    ].join("\n");
    return `${pad(depth)}${open}>\n${inner}\n${pad(depth)}</${safeTag}>`;
  };

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const topKeys = Object.keys(value as Record<string, unknown>).filter((k) => !k.startsWith("@") && k !== "#text");
    if (topKeys.length === 1) {
      return `<?xml version="1.0" encoding="UTF-8"?>\n${emitNode(topKeys[0], (value as Record<string, unknown>)[topKeys[0]], 0)}`;
    }
  }
  const body = Array.isArray(value)
    ? value.map((item) => emitNode("item", item, 1)).join("\n")
    : emitNode(rootName || "root", value, 0);
  if (Array.isArray(value)) {
    const safeRoot = sanitizeTag(rootName || "root");
    return `<?xml version="1.0" encoding="UTF-8"?>\n<${safeRoot}>\n${body}\n</${safeRoot}>`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n${body}`;
}

function xmlNodeToJson(el: Element): unknown {
  const out: Record<string, unknown> = {};
  for (const attr of Array.from(el.attributes)) {
    out[`@${attr.name}`] = coerceCsvValue(attr.value);
  }
  const childElements = Array.from(el.children);
  const textParts = Array.from(el.childNodes)
    .filter((n) => n.nodeType === Node.TEXT_NODE || n.nodeType === Node.CDATA_SECTION_NODE)
    .map((n) => n.nodeValue ?? "")
    .join("")
    .trim();

  if (childElements.length === 0) {
    if (Object.keys(out).length === 0) return textParts ? coerceCsvValue(textParts) : "";
    if (textParts) out["#text"] = coerceCsvValue(textParts);
    return out;
  }

  for (const child of childElements) {
    const val = xmlNodeToJson(child);
    const cur = out[child.tagName];
    if (cur === undefined) out[child.tagName] = val;
    else if (Array.isArray(cur)) cur.push(val);
    else out[child.tagName] = [cur, val];
  }
  if (textParts) out["#text"] = textParts;
  return out;
}

function xmlToJson(xmlText: string): Record<string, unknown> {
  if (typeof DOMParser === "undefined") throw new Error("XML parsing needs a browser DOMParser.");
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  const err = doc.querySelector("parsererror");
  if (err) throw new Error(err.textContent?.split("\n")[0] || "Invalid XML syntax.");
  return { [doc.documentElement.tagName]: xmlNodeToJson(doc.documentElement) };
}

function htmlToMarkdown(html: string): string {
  if (typeof DOMParser === "undefined") return html;
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, style, noscript").forEach((el) => el.remove());

  const inline = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return (node.nodeValue ?? "").replace(/\s+/g, " ");
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();
    const inner = Array.from(el.childNodes).map(inline).join("");
    switch (tag) {
      case "br":
        return "  \n";
      case "strong":
      case "b":
        return inner.trim() ? `**${inner.trim()}**` : "";
      case "em":
      case "i":
        return inner.trim() ? `_${inner.trim()}_` : "";
      case "del":
      case "s":
        return inner.trim() ? `~~${inner.trim()}~~` : "";
      case "code": {
        const text = el.textContent ?? "";
        return text.includes("`") ? `\`\` ${text} \`\`` : `\`${text}\``;
      }
      case "a": {
        const href = el.getAttribute("href") ?? "";
        return `[${inner.trim() || href}](${href})`;
      }
      case "img": {
        const src = el.getAttribute("src") ?? "";
        const alt = el.getAttribute("alt") ?? "";
        return `![${alt}](${src})`;
      }
      default:
        return inner;
    }
  };

  const renderTable = (table: HTMLElement): string => {
    const rows = Array.from(table.querySelectorAll("tr")).map((tr) =>
      Array.from(tr.children).map((cell) => inline(cell).trim().replace(/\|/g, "\\|")),
    );
    if (rows.length === 0) return "";
    const cols = Math.max(...rows.map((r) => r.length));
    const padRow = (r: string[]) => `| ${Array.from({ length: cols }, (_, i) => r[i] ?? "").join(" | ")} |`;
    const sep = `| ${Array.from({ length: cols }, () => "---").join(" | ")} |`;
    return [padRow(rows[0]), sep, ...rows.slice(1).map(padRow)].join("\n");
  };

  const renderList = (list: HTMLElement, depth: number): string => {
    const ordered = list.tagName.toLowerCase() === "ol";
    const indent = "  ".repeat(depth);
    let idx = Number(list.getAttribute("start") || 1);
    return Array.from(list.children)
      .filter((c) => c.tagName.toLowerCase() === "li")
      .map((li) => {
        const checkbox = li.querySelector<HTMLInputElement>(":scope > input[type='checkbox']");
        const checkPrefix = checkbox ? (checkbox.checked ? "[x] " : "[ ] ") : "";
        const inlineParts: string[] = [];
        const nested: string[] = [];
        for (const child of Array.from(li.childNodes)) {
          if (child instanceof HTMLElement && ["ul", "ol"].includes(child.tagName.toLowerCase())) {
            nested.push(renderList(child, depth + 1));
          } else if (child !== checkbox) {
            inlineParts.push(inline(child));
          }
        }
        const bullet = ordered ? `${idx++}.` : "-";
        const line = `${indent}${bullet} ${checkPrefix}${inlineParts.join("").trim()}`;
        return nested.length ? `${line}\n${nested.join("\n")}` : line;
      })
      .join("\n");
  };

  const block = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return (node.nodeValue ?? "").trim();
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) return `${"#".repeat(Number(tag[1]))} ${inline(el).trim()}`;
    if (tag === "p") return inline(el).trim();
    if (tag === "hr") return "---";
    if (tag === "pre") {
      const code = el.querySelector("code");
      const lang = /language-([\w-]+)/.exec(code?.className ?? "")?.[1] ?? "";
      const raw = (code ?? el).textContent?.replace(/\n$/, "") ?? "";
      return `\`\`\`${lang}\n${raw}\n\`\`\``;
    }
    if (tag === "blockquote") {
      return blockChildren(el)
        .split("\n")
        .map((l) => (l ? `> ${l}` : ">"))
        .join("\n");
    }
    if (tag === "ul" || tag === "ol") return renderList(el, 0);
    if (tag === "table") return renderTable(el);
    if (["div", "article", "section", "main", "header", "footer", "aside", "body"].includes(tag)) {
      return blockChildren(el);
    }
    return inline(el).trim();
  };

  const blockChildren = (parent: Element): string => {
    const parts: string[] = [];
    let inlineAcc = "";
    const flushInline = () => {
      if (inlineAcc.trim()) parts.push(inlineAcc.trim());
      inlineAcc = "";
    };
    for (const child of Array.from(parent.childNodes)) {
      if (
        child.nodeType === Node.ELEMENT_NODE &&
        ["h1", "h2", "h3", "h4", "h5", "h6", "p", "ul", "ol", "pre", "blockquote", "table", "hr", "div", "article", "section", "main"].includes(
          (child as HTMLElement).tagName.toLowerCase(),
        )
      ) {
        flushInline();
        const b = block(child);
        if (b) parts.push(b);
      } else {
        inlineAcc += inline(child);
      }
    }
    flushInline();
    return parts.join("\n\n");
  };

  return blockChildren(doc.body).replace(/\n{3,}/g, "\n\n").trim();
}

export function DataConvertEngine({ preset }: EngineProps) {
  const initPair = (PAIRS.some((p) => p.id === preset.pair) ? preset.pair : "json-csv") as ConvertPair;
  const initDir = preset.dir === "b2a" ? "b2a" : "a2b";
  const [pair, setPair] = useState<ConvertPair>(initPair);
  const [dir, setDir] = useState<"a2b" | "b2a">(initDir);
  const [input, setInput] = useState(() => SAMPLES[`${initPair}:${initDir}`]);
  const [delim, setDelim] = useState("auto");
  const [headers, setHeaders] = useState(true);
  const [autoTypes, setAutoTypes] = useState(true);
  const [flatten, setFlatten] = useState(true);
  const [xmlRoot, setXmlRoot] = useState("root");
  const [indent, setIndent] = useState(2);

  const active = PAIRS.find((p) => p.id === pair)!;
  const fromLabel = dir === "a2b" ? active.a : active.b;
  const toLabel = dir === "a2b" ? active.b : active.a;
  const outExt = dir === "a2b" ? active.exts[1] : active.exts[0];

  const selectPair = (nextPair: ConvertPair, nextDir = dir) => {
    setPair(nextPair);
    setDir(nextDir);
    setInput(SAMPLES[`${nextPair}:${nextDir}`]);
  };

  const out = useMemo(() => {
    const raw = input.trim();
    if (!raw) return { text: "", error: undefined };
    try {
      if (pair === "json-csv") {
        if (dir === "a2b") {
          const parsed = parseJson(raw);
          if (!parsed.ok) return { text: "", error: parsed.error };
          return { text: objectsToDelimited(parsed.value, delim === "auto" ? "," : delim, flatten), error: undefined };
        }
        return { text: JSON.stringify(csvToJson(raw, delim, headers, autoTypes), null, indent), error: undefined };
      }
      if (pair === "json-yaml") {
        if (dir === "a2b") {
          const parsed = parseJson(raw);
          if (!parsed.ok) return { text: "", error: parsed.error };
          return { text: yaml.dump(parsed.value, { indent, noRefs: true, lineWidth: 120 }).trimEnd(), error: undefined };
        }
        const docs = yaml.loadAll(raw);
        const val = docs.length > 1 ? docs : docs[0];
        return { text: JSON.stringify(val ?? null, null, indent), error: undefined };
      }
      if (pair === "json-xml") {
        if (dir === "a2b") {
          const parsed = parseJson(raw);
          if (!parsed.ok) return { text: "", error: parsed.error };
          return { text: jsonToXml(parsed.value, xmlRoot.trim() || "root", indent), error: undefined };
        }
        return { text: JSON.stringify(xmlToJson(raw), null, indent), error: undefined };
      }
      if (dir === "a2b") {
        return { text: htmlToMarkdown(raw), error: undefined };
      }
      const md = new Marked({ gfm: true, breaks: false });
      const htmlOut = md.parse(raw, { async: false });
      return { text: typeof htmlOut === "string" ? htmlOut.trim() : "", error: undefined };
    } catch (e) {
      return { text: "", error: e instanceof Error ? e.message : "Could not convert this input." };
    }
  }, [input, pair, dir, delim, headers, autoTypes, flatten, xmlRoot, indent]);

  const swap = () => {
    const nextDir = dir === "a2b" ? "b2a" : "a2b";
    setDir(nextDir);
    if (out.text && !out.error) setInput(out.text);
    else setInput(SAMPLES[`${pair}:${nextDir}`]);
  };

  return (
    <>
      <Panel>
        <Row label="Pair">
          <div className="flex flex-wrap items-center gap-2">
            <Chips
              value={pair}
              onChange={(p) => selectPair(p, "a2b")}
              options={PAIRS.map((p) => ({ value: p.id, label: p.label }))}
              label="Format pair"
            />
          </div>
        </Row>
        <Row label="Direction">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={swap}
              className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-line bg-surface px-3 text-[13px] font-medium text-ink transition-colors hover:border-ink-3"
            >
              <span className="font-mono text-[12px] text-ink-3">{fromLabel}</span>
              <ArrowLeftRight aria-hidden className="size-3.5 text-ink-3" />
              <span className="font-mono text-[12px] text-ink">{toLabel}</span>
            </button>
            <button
              type="button"
              onClick={() => setInput(SAMPLES[`${pair}:${dir}`])}
              className="inline-flex h-8 items-center rounded-[8px] border border-line bg-paper px-3 text-[13px] text-ink-2 transition-colors hover:border-ink-3 hover:text-ink"
            >
              Load sample {fromLabel}
            </button>
          </div>
        </Row>
        {pair === "json-csv" && (
          <Row label="CSV options">
            <div className="flex flex-wrap items-center gap-3">
              <Chips
                value={delim}
                onChange={setDelim}
                options={[
                  ...(dir === "b2a" ? [{ value: "auto", label: "Auto" }] : []),
                  { value: ",", label: "Comma (,)" },
                  { value: ";", label: "Semicolon (;)" },
                  { value: "\t", label: "Tab" },
                ]}
              />
              {dir === "a2b" ? (
                <Toggle checked={flatten} onChange={setFlatten} label="Flatten nested objects" />
              ) : (
                <>
                  <Toggle checked={headers} onChange={setHeaders} label="First row is header" />
                  <Toggle checked={autoTypes} onChange={setAutoTypes} label="Infer numbers & booleans" />
                </>
              )}
            </div>
          </Row>
        )}
        {pair === "json-xml" && dir === "a2b" && (
          <Row label="Root element">
            <div className="max-w-52">
              <TextField value={xmlRoot} onChange={setXmlRoot} label="Root element" placeholder="root" mono />
            </div>
          </Row>
        )}
        {pair !== "html-md" && !(pair === "json-csv" && dir === "a2b") && (
          <Row label="Indent">
            <Chips value={indent} onChange={setIndent} options={[{ value: 2, label: "2 spaces" }, { value: 4, label: "4 spaces" }]} />
          </Row>
        )}
      </Panel>
      <Editor
        value={input}
        onChange={setInput}
        name={`input.${dir === "a2b" ? active.exts[0] : active.exts[1]}`}
        rows={10}
        placeholder={`Paste ${fromLabel} or load a file`}
        actions={
          <TextFilePick
            accept={`.${active.exts[0]},.${active.exts[1]},.txt,.tsv`}
            onText={setInput}
          />
        }
      />
      <Output
        value={out.text}
        name={`converted.${outExt}`}
        lang={toLabel}
        error={out.error}
        download={`converted.${outExt}`}
        wrap={outExt === "html" || outExt === "md"}
      />
    </>
  );
}

/* ========================================================================
 * 2. JSON / SQL CREATE TABLE -> CODE TYPES (TS / Python Pydantic / Go)
 * ======================================================================== */

type TargetLang = "ts" | "pydantic" | "dataclass" | "go";

const SAMPLE_JSON_PAYLOAD = JSON.stringify(
  {
    orderId: "ord_94810",
    createdAt: "2026-10-18T09:15:00Z",
    paid: true,
    totalInr: 2499.5,
    customer: {
      id: 42,
      name: "Priya Nair",
      email: "priya@example.com",
      gstin: null,
    },
    items: [
      { sku: "KB-01", qty: 1, unitPrice: 1999.5, tags: ["mechanical", "wireless"] },
      { sku: "MS-04", qty: 2, unitPrice: 250 },
    ],
  },
  null,
  2,
);

const SAMPLE_SQL_DDL = `CREATE TABLE customers (
  id BIGINT PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  full_name TEXT NOT NULL,
  gstin VARCHAR(15),
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  credit_limit DECIMAL(12, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE invoices (
  id UUID PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES customers(id),
  subtotal_paise INTEGER NOT NULL,
  metadata JSONB,
  issued_on DATE NOT NULL
);`;

type FieldSpec = {
  name: string;
  type: InferredType;
  optional: boolean;
  nullable: boolean;
};

type InferredType =
  | { kind: "primitive"; p: "string" | "number" | "integer" | "boolean" | "null" | "any" | "datetime" | "uuid" }
  | { kind: "array"; elem: InferredType }
  | { kind: "object"; name: string; fields: FieldSpec[] };

const toPascal = (s: string) => {
  const parts = s.replace(/[^a-zA-Z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
  const out = parts.map((p) => p[0].toUpperCase() + p.slice(1)).join("");
  return /^[A-Za-z_]/.test(out) ? out : `T${out}`;
};

const toSnake = (s: string) =>
  s
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase() || "field";

const singularize = (s: string) => (s.length > 3 && s.endsWith("ies") ? `${s.slice(0, -3)}y` : s.length > 2 && s.endsWith("s") && !s.endsWith("ss") ? s.slice(0, -1) : s);

function mergeTypes(a: InferredType, b: InferredType): InferredType {
  if (a.kind === "primitive" && a.p === "null") return b;
  if (b.kind === "primitive" && b.p === "null") return a;
  if (a.kind === "primitive" && b.kind === "primitive") {
    if (a.p === b.p) return a;
    if ((a.p === "integer" && b.p === "number") || (a.p === "number" && b.p === "integer")) {
      return { kind: "primitive", p: "number" };
    }
    return { kind: "primitive", p: "any" };
  }
  if (a.kind === "array" && b.kind === "array") {
    return { kind: "array", elem: mergeTypes(a.elem, b.elem) };
  }
  if (a.kind === "object" && b.kind === "object") {
    const mapA = new Map(a.fields.map((f) => [f.name, f]));
    const mapB = new Map(b.fields.map((f) => [f.name, f]));
    const allNames = [...new Set([...mapA.keys(), ...mapB.keys()])];
    const fields: FieldSpec[] = allNames.map((name) => {
      const fa = mapA.get(name);
      const fb = mapB.get(name);
      if (fa && fb) {
        return {
          name,
          type: mergeTypes(fa.type, fb.type),
          optional: fa.optional || fb.optional,
          nullable: fa.nullable || fb.nullable,
        };
      }
      const existing = (fa ?? fb)!;
      return { ...existing, optional: true };
    });
    return { kind: "object", name: a.name, fields };
  }
  return { kind: "primitive", p: "any" };
}

function inferFromJson(val: unknown, hintName: string): InferredType {
  if (val === null || val === undefined) return { kind: "primitive", p: "null" };
  if (typeof val === "boolean") return { kind: "primitive", p: "boolean" };
  if (typeof val === "number") return { kind: "primitive", p: Number.isInteger(val) ? "integer" : "number" };
  if (typeof val === "string") {
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val)) return { kind: "primitive", p: "uuid" };
    if (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/.test(val)) return { kind: "primitive", p: "datetime" };
    return { kind: "primitive", p: "string" };
  }
  if (Array.isArray(val)) {
    if (val.length === 0) return { kind: "array", elem: { kind: "primitive", p: "any" } };
    const elemName = singularize(hintName);
    let acc = inferFromJson(val[0], elemName);
    for (let i = 1; i < val.length; i++) acc = mergeTypes(acc, inferFromJson(val[i], elemName));
    return { kind: "array", elem: acc };
  }
  if (typeof val === "object") {
    const fields: FieldSpec[] = Object.entries(val as Record<string, unknown>).map(([k, v]) => {
      const child = inferFromJson(v, k);
      return { name: k, type: child, optional: false, nullable: v === null };
    });
    return { kind: "object", name: toPascal(hintName), fields };
  }
  return { kind: "primitive", p: "any" };
}

function splitTopLevelCommas(body: string): string[] {
  const parts: string[] = [];
  let cur = "";
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quote) {
      cur += ch;
      if (ch === quote && body[i - 1] !== "\\") quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (ch === "," && depth === 0) {
      if (cur.trim()) parts.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

function sqlTypeToInferred(rawType: string): InferredType {
  const t = rawType.toUpperCase();
  if (/\b(BOOL|BOOLEAN|TINYINT\(1\))\b/.test(t)) return { kind: "primitive", p: "boolean" };
  if (/\b(INT|INTEGER|BIGINT|SMALLINT|TINYINT|SERIAL|BIGSERIAL|INT2|INT4|INT8)\b/.test(t)) return { kind: "primitive", p: "integer" };
  if (/\b(DECIMAL|NUMERIC|FLOAT|DOUBLE|REAL|MONEY)\b/.test(t)) return { kind: "primitive", p: "number" };
  if (/\b(JSON|JSONB)\b/.test(t)) return { kind: "primitive", p: "any" };
  if (/\bUUID\b/.test(t)) return { kind: "primitive", p: "uuid" };
  if (/\b(TIMESTAMP|TIMESTAMPTZ|DATETIME|DATE)\b/.test(t)) return { kind: "primitive", p: "datetime" };
  return { kind: "primitive", p: "string" };
}

function parseSqlTables(sql: string): { name: string; fields: FieldSpec[] }[] {
  const cleaned = sql
    .replace(/--[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const tables: { name: string; fields: FieldSpec[] }[] = [];
  const re = /CREATE\s+(?:TEMP(?:ORARY)?\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:[`"\[]?[\w]+[`"\]]?\.)?[`"\[]?([\w]+)[`"\]]?\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    const rawName = m[1];
    let i = m.index + m[0].length;
    let depth = 1;
    let quote: string | null = null;
    const start = i;
    while (i < cleaned.length && depth > 0) {
      const ch = cleaned[i];
      if (quote) {
        if (ch === quote && cleaned[i - 1] !== "\\") quote = null;
      } else if (ch === "'" || ch === '"' || ch === "`") {
        quote = ch;
      } else if (ch === "(") depth++;
      else if (ch === ")") depth--;
      i++;
    }
    const body = cleaned.slice(start, Math.max(start, i - 1));
    const defs = splitTopLevelCommas(body);
    const fields: FieldSpec[] = [];
    for (const def of defs) {
      if (/^(PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE|CONSTRAINT|CHECK|INDEX|KEY)\b/i.test(def)) continue;
      const colMatch = /^[`"\[]?([\w-]+)[`"\]]?\s+([A-Za-z0-9_]+(?:\s*\([^)]+\))?(?:\s+PRECISION|\s+WITHOUT\s+TIME\s+ZONE|\s+WITH\s+TIME\s+ZONE)?)([\s\S]*)$/i.exec(def);
      if (!colMatch) continue;
      const colName = colMatch[1];
      const colType = colMatch[2];
      const rest = colMatch[3] ?? "";
      const isNotNull = /\bNOT\s+NULL\b/i.test(rest) || /\bPRIMARY\s+KEY\b/i.test(rest);
      const hasDefault = /\bDEFAULT\b/i.test(rest);
      fields.push({
        name: colName,
        type: sqlTypeToInferred(colType),
        optional: hasDefault && !isNotNull,
        nullable: !isNotNull,
      });
    }
    if (fields.length > 0) {
      tables.push({ name: toPascal(singularize(rawName)), fields });
    }
  }
  return tables;
}

function collectObjects(root: InferredType): { name: string; fields: FieldSpec[] }[] {
  const seen = new Map<string, FieldSpec[]>();
  const walk = (t: InferredType) => {
    if (t.kind === "array") {
      walk(t.elem);
    } else if (t.kind === "object") {
      if (!seen.has(t.name)) seen.set(t.name, t.fields);
      for (const f of t.fields) walk(f.type);
    }
  };
  walk(root);
  return [...seen.entries()].map(([name, fields]) => ({ name, fields }));
}

function renderCodeTypes(
  models: { name: string; fields: FieldSpec[] }[],
  lang: TargetLang,
  options: { tsExport: boolean; tsZod: boolean; optionalNullable: boolean },
): string {
  const tsType = (t: InferredType): string => {
    if (t.kind === "primitive") {
      if (t.p === "integer" || t.p === "number") return "number";
      if (t.p === "boolean") return "boolean";
      if (t.p === "null") return "null";
      if (t.p === "any") return "unknown";
      return "string";
    }
    if (t.kind === "array") return `${tsType(t.elem)}[]`;
    return t.name;
  };

  const zodType = (t: InferredType): string => {
    if (t.kind === "primitive") {
      if (t.p === "integer") return "z.number().int()";
      if (t.p === "number") return "z.number()";
      if (t.p === "boolean") return "z.boolean()";
      if (t.p === "null") return "z.null()";
      if (t.p === "uuid") return "z.string().uuid()";
      if (t.p === "datetime") return "z.string().datetime()";
      if (t.p === "any") return "z.unknown()";
      return "z.string()";
    }
    if (t.kind === "array") return `z.array(${zodType(t.elem)})`;
    return `${t.name}Schema`;
  };

  const pyType = (t: InferredType): string => {
    if (t.kind === "primitive") {
      if (t.p === "integer") return "int";
      if (t.p === "number") return "float";
      if (t.p === "boolean") return "bool";
      if (t.p === "null") return "None";
      if (t.p === "datetime") return "datetime";
      if (t.p === "uuid") return "UUID";
      if (t.p === "any") return "Any";
      return "str";
    }
    if (t.kind === "array") return `list[${pyType(t.elem)}]`;
    return t.name;
  };

  const goType = (t: InferredType, nullable: boolean): string => {
    const star = nullable ? "*" : "";
    if (t.kind === "primitive") {
      if (t.p === "integer") return `${star}int64`;
      if (t.p === "number") return `${star}float64`;
      if (t.p === "boolean") return `${star}bool`;
      if (t.p === "null") return "any";
      if (t.p === "datetime") return `${star}time.Time`;
      if (t.p === "any") return "any";
      return `${star}string`;
    }
    if (t.kind === "array") return `[]${goType(t.elem, false)}`;
    return `${star}${t.name}`;
  };

  if (lang === "ts") {
    const exp = options.tsExport ? "export " : "";
    const ifaceBlocks = models.map((m) => {
      const lines = m.fields.map((f) => {
        const key = /^[a-zA-Z_$][\w$]*$/.test(f.name) ? f.name : JSON.stringify(f.name);
        const opt = f.optional || (options.optionalNullable && f.nullable) ? "?" : "";
        const nullSuffix = f.nullable && !(f.type.kind === "primitive" && f.type.p === "null") ? " | null" : "";
        return `  ${key}${opt}: ${tsType(f.type)}${nullSuffix};`;
      });
      return `${exp}interface ${m.name} {\n${lines.join("\n")}\n}`;
    });
    if (!options.tsZod) return ifaceBlocks.join("\n\n");
    const zodBlocks = [...models].reverse().map((m) => {
      const lines = m.fields.map((f) => {
        const key = /^[a-zA-Z_$][\w$]*$/.test(f.name) ? f.name : JSON.stringify(f.name);
        let z = zodType(f.type);
        if (f.nullable) z += ".nullable()";
        if (f.optional || (options.optionalNullable && f.nullable)) z += ".optional()";
        return `  ${key}: ${z},`;
      });
      return `${exp}const ${m.name}Schema = z.object({\n${lines.join("\n")}\n});`;
    });
    return `import { z } from "zod";\n\n${ifaceBlocks.join("\n\n")}\n\n${zodBlocks.join("\n\n")}`;
  }

  if (lang === "pydantic" || lang === "dataclass") {
    const allPy = models.flatMap((m) => m.fields.map((f) => pyType(f.type))).join(" ");
    const imports: string[] = [];
    if (lang === "pydantic") imports.push("from pydantic import BaseModel, Field");
    else imports.push("from dataclasses import dataclass, field");
    if (allPy.includes("datetime")) imports.push("from datetime import datetime");
    if (allPy.includes("UUID")) imports.push("from uuid import UUID");
    if (allPy.includes("Any")) imports.push("from typing import Any");

    const blocks = [...models].reverse().map((m) => {
      const header = lang === "pydantic" ? `class ${m.name}(BaseModel):` : `@dataclass\nclass ${m.name}:`;
      const lines = m.fields.map((f) => {
        const pyField = toSnake(f.name);
        let ann = pyType(f.type);
        const isNull = f.nullable || f.optional;
        if (isNull && ann !== "None") ann = `${ann} | None`;
        const aliasPart = pyField !== f.name && lang === "pydantic" ? `alias="${f.name}"` : "";
        if (lang === "pydantic") {
          if (isNull && aliasPart) return `    ${pyField}: ${ann} = Field(default=None, ${aliasPart})`;
          if (isNull) return `    ${pyField}: ${ann} = None`;
          if (aliasPart) return `    ${pyField}: ${ann} = Field(${aliasPart})`;
          return `    ${pyField}: ${ann}`;
        }
        return isNull ? `    ${pyField}: ${ann} = None` : `    ${pyField}: ${ann}`;
      });
      return `${header}\n${lines.length ? lines.join("\n") : "    pass"}`;
    });
    return `${imports.join("\n")}\n\n\n${blocks.join("\n\n\n")}`;
  }

  // Go struct
  const usesTime = models.some((m) => m.fields.some((f) => f.type.kind === "primitive" && f.type.p === "datetime"));
  const header = usesTime ? `import "time"\n\n` : "";
  const blocks = models.map((m) => {
    const lines = m.fields.map((f) => {
      const goField = toPascal(f.name);
      const nullable = f.nullable || f.optional;
      const omit = nullable ? ",omitempty" : "";
      return `\t${goField} ${goType(f.type, nullable)} \`json:"${f.name}${omit}"\``;
    });
    return `type ${m.name} struct {\n${lines.join("\n")}\n}`;
  });
  return `${header}${blocks.join("\n\n")}`;
}

export function CodeTypesEngine({ preset }: EngineProps) {
  const initLang = (["ts", "pydantic", "dataclass", "go"].includes(preset.lang) ? preset.lang : "ts") as TargetLang;
  const initSource = preset.source === "sql" ? "sql" : "auto";
  const [input, setInput] = useState(() => (initSource === "sql" ? SAMPLE_SQL_DDL : SAMPLE_JSON_PAYLOAD));
  const [sourceKind, setSourceKind] = useState<"auto" | "json" | "sql">(initSource);
  const [lang, setLang] = useState<TargetLang>(initLang);
  const [rootName, setRootName] = useState("Order");
  const [tsExport, setTsExport] = useState(true);
  const [tsZod, setTsZod] = useState(false);
  const [optionalNullable, setOptionalNullable] = useState(true);

  const detectedKind = useMemo(() => {
    if (sourceKind !== "auto") return sourceKind;
    return /^\s*CREATE\s+(?:TEMP(?:ORARY)?\s+)?TABLE\b/i.test(input) ? "sql" : "json";
  }, [sourceKind, input]);

  const out = useMemo(() => {
    const trimmed = input.trim();
    if (!trimmed) return { text: "", error: undefined };
    try {
      let models: { name: string; fields: FieldSpec[] }[];
      if (detectedKind === "sql") {
        models = parseSqlTables(trimmed);
        if (models.length === 0) return { text: "", error: "No SQL CREATE TABLE statements with columns found." };
      } else {
        const parsed = parseJson(trimmed);
        if (!parsed.ok) return { text: "", error: parsed.error };
        const cleanRoot = toPascal(rootName.trim() || "Root");
        const inferred = inferFromJson(parsed.value, cleanRoot);
        if (inferred.kind === "array") {
          models = collectObjects(inferred.elem);
          if (models.length === 0) {
            return { text: "", error: "Root JSON is an array of primitives. Provide an object or array of objects." };
          }
        } else if (inferred.kind === "object") {
          models = collectObjects(inferred);
        } else {
          return { text: "", error: "Provide a JSON object, array of objects, or SQL CREATE TABLE." };
        }
      }
      return {
        text: renderCodeTypes(models, lang, { tsExport, tsZod, optionalNullable }),
        error: undefined,
      };
    } catch (e) {
      return { text: "", error: e instanceof Error ? e.message : "Could not generate types." };
    }
  }, [input, detectedKind, lang, rootName, tsExport, tsZod, optionalNullable]);

  const extMap: Record<TargetLang, { ext: string; label: string }> = {
    ts: { ext: "ts", label: "TypeScript" },
    pydantic: { ext: "py", label: "Python Pydantic" },
    dataclass: { ext: "py", label: "Python Dataclass" },
    go: { ext: "go", label: "Go Struct" },
  };

  return (
    <>
      <Panel>
        <Row label="Target">
          <Chips
            value={lang}
            onChange={setLang}
            options={[
              { value: "ts", label: "TypeScript" },
              { value: "pydantic", label: "Python Pydantic" },
              { value: "dataclass", label: "Python dataclass" },
              { value: "go", label: "Go struct" },
            ]}
          />
        </Row>
        <Row label="Input">
          <div className="flex flex-wrap items-center gap-2">
            <Chips
              value={sourceKind}
              onChange={setSourceKind}
              options={[
                { value: "auto", label: `Auto (${detectedKind.toUpperCase()})` },
                { value: "json", label: "JSON" },
                { value: "sql", label: "SQL CREATE TABLE" },
              ]}
            />
            <button
              type="button"
              onClick={() => (setSourceKind("json"), setInput(SAMPLE_JSON_PAYLOAD))}
              className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-line bg-paper px-3 text-[13px] text-ink-2 transition-colors hover:border-ink-3 hover:text-ink"
            >
              <Code2 aria-hidden className="size-3.5" /> Sample JSON
            </button>
            <button
              type="button"
              onClick={() => (setSourceKind("sql"), setInput(SAMPLE_SQL_DDL))}
              className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-line bg-paper px-3 text-[13px] text-ink-2 transition-colors hover:border-ink-3 hover:text-ink"
            >
              <FileCode2 aria-hidden className="size-3.5" /> Sample SQL
            </button>
          </div>
        </Row>
        {detectedKind === "json" && (
          <Row label="Root name">
            <div className="max-w-52">
              <TextField value={rootName} onChange={setRootName} label="Root type name" placeholder="Order" mono />
            </div>
          </Row>
        )}
        <Row label="Options">
          <div className="flex flex-wrap gap-4">
            {lang === "ts" && <Toggle checked={tsExport} onChange={setTsExport} label="export keyword" />}
            {lang === "ts" && <Toggle checked={tsZod} onChange={setTsZod} label="Include Zod schema" />}
            {lang === "ts" && <Toggle checked={optionalNullable} onChange={setOptionalNullable} label="Make nullable fields optional (?)" />}
          </div>
        </Row>
      </Panel>
      <Editor
        value={input}
        onChange={setInput}
        name={detectedKind === "sql" ? "schema.sql" : "payload.json"}
        rows={11}
        placeholder="Paste JSON payload or SQL CREATE TABLE statement(s)"
        actions={<TextFilePick accept=".json,.sql,.txt" onText={setInput} />}
      />
      <Output
        value={out.text}
        name={`types.${extMap[lang].ext}`}
        lang={extMap[lang].label}
        error={out.error}
        download={`types.${extMap[lang].ext}`}
        wrap={false}
      />
    </>
  );
}

/* ========================================================================
 * 3. CHMOD LINUX PERMISSIONS CALCULATOR
 * ======================================================================== */

const CHMOD_PRESETS = [
  { mode: 0o644, label: "644 · Default file" },
  { mode: 0o755, label: "755 · Script / directory" },
  { mode: 0o600, label: "600 · SSH private key" },
  { mode: 0o400, label: "400 · Secret read-only" },
  { mode: 0o775, label: "775 · Team shared" },
  { mode: 0o777, label: "777 · Full open" },
];

export function formatChmodSymbolic(mode: number, isDir: boolean): string {
  const lead = isDir ? "d" : "-";
  const triad = (shift: number, specialBit: number, lowChar: string, highChar: string) => {
    const bits = (mode >> shift) & 0o7;
    const r = bits & 4 ? "r" : "-";
    const w = bits & 2 ? "w" : "-";
    const hasX = Boolean(bits & 1);
    const hasSp = Boolean(mode & specialBit);
    const x = hasSp ? (hasX ? lowChar : highChar) : hasX ? "x" : "-";
    return `${r}${w}${x}`;
  };
  return `${lead}${triad(6, 0o4000, "s", "S")}${triad(3, 0o2000, "s", "S")}${triad(0, 0o1000, "t", "T")}`;
}

export function formatChmodOctal(mode: number): string {
  const sp = (mode >> 9) & 0o7;
  const rwx = (mode & 0o777).toString(8).padStart(3, "0");
  return sp > 0 ? `${sp}${rwx}` : rwx;
}

export function parseChmodSymbolic(sym: string): { mode: number; isDir?: boolean } | null {
  const s = sym.trim();
  const body = s.length === 10 ? s.slice(1) : s.length === 9 ? s : null;
  if (!body) return null;
  let mode = 0;
  const check = (idx: number, expected: string, bit: number) => {
    const ch = body[idx];
    if (ch === expected) mode |= bit;
    else if (ch !== "-") return false;
    return true;
  };
  if (!check(0, "r", 0o400) || !check(1, "w", 0o200)) return null;
  const ux = body[2];
  if (ux === "x") mode |= 0o100;
  else if (ux === "s") mode |= 0o4100;
  else if (ux === "S") mode |= 0o4000;
  else if (ux !== "-") return null;

  if (!check(3, "r", 0o040) || !check(4, "w", 0o020)) return null;
  const gx = body[5];
  if (gx === "x") mode |= 0o010;
  else if (gx === "s") mode |= 0o2010;
  else if (gx === "S") mode |= 0o2000;
  else if (gx !== "-") return null;

  if (!check(6, "r", 0o004) || !check(7, "w", 0o002)) return null;
  const ox = body[8];
  if (ox === "x") mode |= 0o001;
  else if (ox === "t") mode |= 0o1001;
  else if (ox === "T") mode |= 0o1000;
  else if (ox !== "-") return null;

  return { mode, isDir: s.length === 10 ? s[0] === "d" : undefined };
}

export function ChmodEngine({ preset }: EngineProps) {
  const initialMode = /^[0-7]{3,4}$/.test(preset.mode ?? "") ? parseInt(preset.mode, 8) : 0o755;
  const [mode, setMode] = useState(initialMode);
  const [isDir, setIsDir] = useState(false);
  const [recursive, setRecursive] = useState(false);
  const [targetPath, setTargetPath] = useState("script.sh");
  const [octalDraft, setOctalDraft] = useState<string | null>(null);
  const [symDraft, setSymDraft] = useState<string | null>(null);

  const octal = formatChmodOctal(mode);
  const symbolic = formatChmodSymbolic(mode, isDir);
  const command = `chmod ${recursive ? "-R " : ""}${octal} ${targetPath.trim() || "file"}`;
  const toggleBit = (bit: number) => {
    setOctalDraft(null);
    setSymDraft(null);
    setMode((m) => m ^ bit);
  };

  const roles: { label: string; shift: number }[] = [
    { label: "Owner (u)", shift: 6 },
    { label: "Group (g)", shift: 3 },
    { label: "Public / Other (o)", shift: 0 },
  ];

  const describeRole = (shift: number) => {
    const v = (mode >> shift) & 0o7;
    if (v === 0) return "No access (0)";
    const parts = [v & 4 ? "read" : "", v & 2 ? "write" : "", v & 1 ? (isDir ? "enter/list" : "execute") : ""].filter(Boolean);
    return `${parts.join(", ")} (${v})`;
  };

  return (
    <>
      <Panel>
        <Row label="Presets">
          <div className="flex flex-wrap gap-1.5">
            {CHMOD_PRESETS.map((p) => (
              <button
                key={p.mode}
                type="button"
                onClick={() => (setMode(p.mode), setOctalDraft(null), setSymDraft(null))}
                className={cn(
                  "h-8 rounded-[8px] border px-2.5 font-mono text-[12px] transition-colors",
                  mode === p.mode ? "border-ink bg-ink text-paper" : "border-line bg-surface text-ink-2 hover:border-ink-3 hover:text-ink",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </Row>
        <Row label="Numeric / Symbolic">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label-mono mb-1 block text-ink-3" htmlFor="chmod-octal">
                Octal (000–7777)
              </label>
              <input
                id="chmod-octal"
                value={octalDraft ?? octal}
                onFocus={() => setOctalDraft(octal)}
                onBlur={() => setOctalDraft(null)}
                onChange={(e) => {
                  const v = e.target.value;
                  setOctalDraft(v);
                  const clean = v.trim();
                  if (/^[0-7]{3,4}$/.test(clean)) setMode(parseInt(clean, 8));
                }}
                maxLength={4}
                className="h-10 w-full rounded-[8px] border border-line bg-surface px-3 font-mono text-[16px] font-semibold tracking-wider text-ink outline-none focus:border-ink"
              />
            </div>
            <div>
              <label className="label-mono mb-1 block text-ink-3" htmlFor="chmod-sym">
                Symbolic (-rwxr-xr-x)
              </label>
              <input
                id="chmod-sym"
                value={symDraft ?? symbolic}
                onFocus={() => setSymDraft(symbolic)}
                onBlur={() => setSymDraft(null)}
                onChange={(e) => {
                  const v = e.target.value;
                  setSymDraft(v);
                  const parsed = parseChmodSymbolic(v);
                  if (parsed) {
                    setMode(parsed.mode);
                    if (parsed.isDir !== undefined) setIsDir(parsed.isDir);
                  }
                }}
                maxLength={10}
                className="h-10 w-full rounded-[8px] border border-line bg-surface px-3 font-mono text-[16px] font-semibold tracking-wider text-ink outline-none focus:border-ink"
              />
            </div>
          </div>
        </Row>
        <Row label="Type">
          <Chips
            value={isDir ? "dir" : "file"}
            onChange={(v) => (setIsDir(v === "dir"), setSymDraft(null))}
            options={[
              { value: "file", label: "Regular file (-)" },
              { value: "dir", label: "Directory (d)" },
            ]}
          />
        </Row>
      </Panel>

      {/* Interactive Permission Matrix */}
      <div className="overflow-x-auto rounded-md border border-line bg-surface">
        <table className="w-full min-w-[440px] border-collapse text-left">
          <thead>
            <tr className="border-b border-line bg-paper text-[12px] text-ink-2">
              <th className="px-4 py-2.5 font-mono uppercase tracking-wider">Scope</th>
              <th className="px-3 py-2.5 font-medium">Read (4)</th>
              <th className="px-3 py-2.5 font-medium">Write (2)</th>
              <th className="px-3 py-2.5 font-medium">Execute (1)</th>
              <th className="px-3 py-2.5 font-mono">Digit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/60 text-sm">
            {roles.map((r) => {
              const rBit = 4 << r.shift;
              const wBit = 2 << r.shift;
              const xBit = 1 << r.shift;
              const digit = (mode >> r.shift) & 0o7;
              return (
                <tr key={r.label} className="hover:bg-paper/40">
                  <td className="px-4 py-3 font-medium text-ink">{r.label}</td>
                  {[
                    { bit: rBit, name: "Read", ch: "r" },
                    { bit: wBit, name: "Write", ch: "w" },
                    { bit: xBit, name: "Execute", ch: "x" },
                  ].map((perm) => {
                    const checked = Boolean(mode & perm.bit);
                    return (
                      <td key={perm.name} className="px-3 py-2.5">
                        <label className="inline-flex cursor-pointer items-center gap-2 select-none">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleBit(perm.bit)}
                            className="size-4 accent-accent"
                          />
                          <span className={cn("font-mono text-[13px]", checked ? "font-medium text-ink" : "text-ink-3")}>
                            {perm.ch}
                          </span>
                        </label>
                      </td>
                    );
                  })}
                  <td className="px-3 py-2.5 font-mono text-[14px] font-semibold text-ink">{digit}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="flex flex-wrap items-center gap-4 border-t border-line bg-paper/50 px-4 py-3 text-sm">
          <span className="label-mono text-ink-3">Special bits</span>
          {[
            { bit: 0o4000, label: "Setuid (4)" },
            { bit: 0o2000, label: "Setgid (2)" },
            { bit: 0o1000, label: "Sticky bit (1)" },
          ].map((sp) => (
            <label key={sp.label} className="inline-flex cursor-pointer items-center gap-2 text-[13px] text-ink-2">
              <input
                type="checkbox"
                checked={Boolean(mode & sp.bit)}
                onChange={() => toggleBit(sp.bit)}
                className="size-4 accent-accent"
              />
              {sp.label}
            </label>
          ))}
        </div>
      </div>

      {Boolean(mode & 0o002) && (
        <Notice tone="warning">
          <span className="inline-flex items-center gap-1.5">
            <AlertTriangle aria-hidden className="size-4 shrink-0" />
            <span>
              <strong>World-writable ({octal}):</strong> any local user on the system can modify this {isDir ? "directory" : "file"}. Avoid on production servers unless sticky bit (1777) is intended.
            </span>
          </span>
        </Notice>
      )}

      <Panel>
        <Row label="Command">
          <div className="grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <TextField value={targetPath} onChange={setTargetPath} label="Target file or folder" placeholder="script.sh" mono />
            <Toggle checked={recursive} onChange={setRecursive} label="Recursive (-R)" />
          </div>
          <div className="mt-3 flex items-center justify-between gap-2 rounded-[8px] border border-line bg-paper px-3 py-2">
            <code className="flex items-center gap-2 font-mono text-[13px] text-ink">
              <Shield aria-hidden className="size-3.5 text-ink-3" />
              {command}
            </code>
            <CopyButton text={command} label="Copy" />
          </div>
        </Row>
      </Panel>

      <ValueList>
        <ValueRow label="Owner (u)" value={describeRole(6)} />
        <ValueRow label="Group (g)" value={describeRole(3)} />
        <ValueRow label="Public (o)" value={describeRole(0)} />
        <ValueRow label="Symbolic" value={symbolic} />
      </ValueList>
    </>
  );
}
