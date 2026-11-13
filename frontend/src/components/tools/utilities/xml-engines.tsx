"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { postJson } from "./post-json";
import { cn } from "@/lib/utils";
import { Chips, Notice, Panel, Row, TextField, Toggle } from "../pdf/kit";
import { CopyButton, Editor, JsonTree, Output } from "../dev/parts";
import { SandboxFrame } from "./code-engines";

const BOOKS = `<?xml version="1.0" encoding="UTF-8"?>
<library xmlns:dc="http://purl.org/dc/elements/1.1/">
  <book id="b1" year="2005" lang="en">
    <dc:title>Learning XML</dc:title>
    <author>Erik Ray</author>
    <price currency="USD">39.95</price>
  </book>
  <book id="b2" year="1999" lang="en">
    <dc:title>XSLT Programmer's Reference</dc:title>
    <author>Michael Kay</author>
    <price currency="USD">49.99</price>
  </book>
  <book id="b3" year="2021" lang="fr">
    <dc:title>XML pour les nuls</dc:title>
    <author>Jean Dupont</author>
    <price currency="EUR">24.00</price>
  </book>
</library>`;

function parseXml(text: string): { doc: Document | null; error: string | null } {
  if (!text.trim() || typeof DOMParser === "undefined") return { doc: null, error: null };
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const err = doc.getElementsByTagName("parsererror")[0];
  if (err) return { doc: null, error: (err.textContent ?? "Not well-formed XML.").replace(/^This page contains the following errors:/, "").split("\n").find((l) => l.trim()) ?? "Not well-formed XML." };
  return { doc, error: null };
}

/** Collects xmlns:prefix declarations so XPath can use the document's own prefixes. */
function nsResolver(doc: Document): XPathNSResolver {
  const map: Record<string, string> = {};
  for (const el of Array.from(doc.getElementsByTagName("*")).slice(0, 2000))
    for (const a of Array.from(el.attributes)) if (a.name.startsWith("xmlns:")) map[a.name.slice(6)] = a.value;
  return ((prefix: string | null) => (prefix ? (map[prefix] ?? null) : null)) as XPathNSResolver;
}

function pathOf(node: Node): string {
  const parts: string[] = [];
  let n: Node | null = node;
  while (n && n.nodeType !== Node.DOCUMENT_NODE) {
    if (n.nodeType === Node.ATTRIBUTE_NODE) {
      parts.unshift(`@${(n as Attr).name}`);
      n = (n as Attr).ownerElement;
      continue;
    }
    if (n.nodeType === Node.ELEMENT_NODE) {
      const el = n as Element;
      const same = el.parentNode ? Array.from(el.parentNode.childNodes).filter((c) => c.nodeName === el.nodeName) : [];
      parts.unshift(same.length > 1 ? `${el.nodeName}[${same.indexOf(el) + 1}]` : el.nodeName);
    } else if (n.nodeType === Node.TEXT_NODE) parts.unshift("text()");
    n = n.parentNode;
  }
  return "/" + parts.join("/");
}

const serialize = (n: Node) =>
  n.nodeType === Node.ATTRIBUTE_NODE ? `${(n as Attr).name}="${(n as Attr).value}"` : n.nodeType === Node.TEXT_NODE ? (n.textContent ?? "") : new XMLSerializer().serializeToString(n);

/* ---------- XPath ---------- */

const XPATH_EXAMPLES = ["//book/dc:title", "//book[price > 30]/author", "//book[@lang='fr']", "count(//book)", "sum(//price)", "//book/@id", "//author/text()"];

export function XPathEngine() {
  const [xml, setXml] = useState(BOOKS);
  const [expr, setExpr] = useState(XPATH_EXAMPLES[0]);
  const dx = useDeferredValue(xml);
  const de = useDeferredValue(expr);
  const result = useMemo(() => {
    const { doc, error } = parseXml(dx);
    if (error) return { error: `The XML isn't well-formed: ${error}` };
    if (!doc || !de.trim()) return { nodes: [] as Node[] };
    try {
      const r = doc.evaluate(de, doc, nsResolver(doc), XPathResult.ANY_TYPE, null);
      if (r.resultType === XPathResult.NUMBER_TYPE) return { scalar: String(r.numberValue), type: "number" };
      if (r.resultType === XPathResult.STRING_TYPE) return { scalar: r.stringValue, type: "string" };
      if (r.resultType === XPathResult.BOOLEAN_TYPE) return { scalar: String(r.booleanValue), type: "boolean" };
      const nodes: Node[] = [];
      for (let n = r.iterateNext(); n && nodes.length < 1000; n = r.iterateNext()) nodes.push(n);
      return { nodes };
    } catch (e) {
      return { error: `That XPath isn't valid: ${(e as Error).message.replace(/^.*?: /, "")}` };
    }
  }, [dx, de]);
  return (
    <>
      <Panel>
        <Row label="XPath">
          <TextField label="XPath expression" value={expr} onChange={setExpr} placeholder="//book[price > 30]/title" mono invalid={"error" in result} />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {XPATH_EXAMPLES.map((x) => (
              <button key={x} type="button" onClick={() => setExpr(x)} className="rounded-[6px] bg-paper-2 px-2 py-1 font-mono text-[12px] text-ink-2 hover:text-ink">
                {x}
              </button>
            ))}
          </div>
        </Row>
      </Panel>
      <Editor value={xml} onChange={setXml} name="data.xml" rows={10} invalid={"error" in result && result.error?.startsWith("The XML")} />
      {"error" in result && result.error ? (
        <Notice tone="danger">{result.error}</Notice>
      ) : "scalar" in result ? (
        <div className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface px-4 py-4">
          <div>
            <p className="label-mono text-ink-3">{result.type}</p>
            <p className="mt-1 font-mono text-2xl text-ink">{result.scalar}</p>
          </div>
          <CopyButton text={result.scalar ?? ""} />
        </div>
      ) : (
        <MatchList items={(result.nodes ?? []).map((n) => ({ path: pathOf(n), value: serialize(n) }))} />
      )}
    </>
  );
}

function MatchList({ items }: { items: { path: string; value: string }[] }) {
  return (
    <div className="overflow-hidden rounded-md border border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line bg-paper px-3 py-1.5">
        <span className="font-mono text-[12px] text-ink">
          {items.length} match{items.length === 1 ? "" : "es"}
        </span>
        <CopyButton text={items.map((i) => i.value).join("\n")} label="Copy all" />
      </div>
      {items.length ? (
        <ol className="max-h-[420px] divide-y divide-line overflow-auto" data-lenis-prevent>
          {items.map((it, i) => (
            <li key={i} className="px-3 py-2">
              <p className="font-mono text-[12px] text-ink-3">{it.path}</p>
              <pre className="mt-0.5 whitespace-pre-wrap break-all font-mono text-[13px] text-ink">{it.value}</pre>
            </li>
          ))}
        </ol>
      ) : (
        <p className="px-3 py-4 text-sm text-ink-3">Nothing matches.</p>
      )}
    </div>
  );
}

/* ---------- XSLT ---------- */

const XSL = `<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <xsl:output method="html" indent="yes"/>
  <xsl:template match="/">
    <html><body style="font-family:sans-serif">
      <h2>Books</h2>
      <table border="1" cellpadding="6">
        <tr><th>Title</th><th>Author</th><th>Price</th></tr>
        <xsl:for-each select="library/book">
          <xsl:sort select="price" data-type="number"/>
          <tr>
            <td><xsl:value-of select="dc:title"/></td>
            <td><xsl:value-of select="author"/></td>
            <td><xsl:value-of select="price"/> <xsl:value-of select="price/@currency"/></td>
          </tr>
        </xsl:for-each>
      </table>
    </body></html>
  </xsl:template>
</xsl:stylesheet>`;

export function XsltEngine() {
  const [xml, setXml] = useState(BOOKS);
  const [xsl, setXsl] = useState(XSL);
  const [view, setView] = useState<"preview" | "code">("preview");
  const [r, setR] = useState<{ busy: boolean; out?: string; html?: boolean; error?: string }>({ busy: true });
  const dx = useDeferredValue(xml);
  const ds = useDeferredValue(xsl);
  // Browsers are removing their built-in XSLT, so the transform runs on the server (libxslt), debounced.
  useEffect(() => {
    if (!dx.trim() || !ds.trim()) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setR((v) => ({ ...v, busy: true }));
      try {
        const res = await postJson<{ ok: boolean; output?: string; html?: boolean; error?: string }>("xslt", { xml: dx, xsl: ds }, ctrl.signal);
        setR(res.ok ? { busy: false, out: res.output ?? "", html: res.html } : { busy: false, error: res.error });
      } catch (e) {
        if (!ctrl.signal.aborted) setR({ busy: false, error: (e as Error).message });
      }
    }, 600);
    return () => {
      ctrl.abort();
      clearTimeout(t);
    };
  }, [dx, ds]);
  return (
    <>
      <div className="grid gap-3 @3xl:grid-cols-2">
        <Editor value={xml} onChange={setXml} name="data.xml" rows={12} />
        <Editor value={xsl} onChange={setXsl} name="transform.xsl" rows={12} />
      </div>
      {r.error ? (
        <Notice tone="danger">{r.error}</Notice>
      ) : (
        <>
          <Panel>
            <Row label="Show" hint={r.busy ? "Transforming…" : undefined}>
              <Chips value={r.html ? view : "code"} options={[{ value: "preview", label: "Preview", disabled: !r.html }, { value: "code", label: "Code" }]} onChange={setView} label="Show" />
            </Row>
          </Panel>
          {r.html && view === "preview" ? <SandboxFrame html={r.out ?? ""} /> : <Output value={r.out ?? ""} name="output" lang="XSLT 1.0 (libxslt)" download={r.html ? "output.html" : "output.xml"} />}
        </>
      )}
    </>
  );
}

/* ---------- XSD (server) ---------- */

const XSD = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="order">
    <xs:complexType>
      <xs:sequence>
        <xs:element name="customer" type="xs:string"/>
        <xs:element name="item" maxOccurs="unbounded">
          <xs:complexType>
            <xs:attribute name="sku" type="xs:string" use="required"/>
            <xs:attribute name="qty" type="xs:positiveInteger" use="required"/>
          </xs:complexType>
        </xs:element>
      </xs:sequence>
      <xs:attribute name="id" type="xs:integer" use="required"/>
    </xs:complexType>
  </xs:element>
</xs:schema>`;
const ORDER = `<?xml version="1.0"?>
<order id="1042">
  <customer>Ada Lovelace</customer>
  <item sku="A-1" qty="2"/>
  <item sku="B-7" qty="zero"/>
</order>`;

type XsdResult = { valid: boolean; stage: "xml" | "schema"; errors: { line: number | null; column: number | null; message: string }[] };

export function XsdEngine() {
  const [xml, setXml] = useState(ORDER);
  const [xsd, setXsd] = useState(XSD);
  const [state, setState] = useState<{ busy: boolean; res: XsdResult | null; error: string | null }>({ busy: false, res: null, error: null });
  const run = async () => {
    setState({ busy: true, res: null, error: null });
    try {
      setState({ busy: false, res: await postJson<XsdResult>("xsd", { xml, xsd }), error: null });
    } catch (e) {
      setState({ busy: false, res: null, error: (e as Error).message });
    }
  };
  const res = state.res;
  return (
    <>
      <div className="grid gap-3 @3xl:grid-cols-2">
        <Editor value={xml} onChange={setXml} name="document.xml" rows={12} />
        <Editor value={xsd} onChange={setXsd} name="schema.xsd" rows={12} />
      </div>
      <RunButton busy={state.busy} onClick={run} disabled={!xml.trim() || !xsd.trim()}>
        Validate
      </RunButton>
      {state.error && <Notice tone="danger">{state.error}</Notice>}
      {res && (
        <div className={cn("overflow-hidden rounded-md border bg-surface", res.valid ? "border-success/40" : "border-danger/40")} aria-live="polite">
          <p className={cn("border-b border-line px-3 py-2.5 text-sm font-medium", res.valid ? "bg-success/10 text-success" : "bg-danger/5 text-danger")}>
            {res.valid ? "✓ The XML is valid against the schema." : res.stage === "schema" && !res.errors.some((e) => /Element|attribute/i.test(e.message)) ? "✗ The schema itself has a problem." : `✗ ${res.errors.length} problem${res.errors.length === 1 ? "" : "s"} found.`}
          </p>
          {!res.valid && (
            <ul className="divide-y divide-line">
              {res.errors.map((e, i) => (
                <li key={i} className="px-3 py-2 text-sm text-ink">
                  {e.line ? <span className="mr-2 font-mono text-xs text-ink-3">line {e.line}</span> : null}
                  {e.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}

export function RunButton({ busy, onClick, disabled, children }: { busy: boolean; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || disabled}
      className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-ink px-5 text-sm font-medium text-paper transition-[opacity,transform] hover:opacity-90 active:scale-[0.98] disabled:opacity-40"
    >
      {busy && <span aria-hidden className="size-3.5 animate-spin rounded-full border-2 border-paper/30 border-t-paper" />}
      {busy ? "Working…" : children}
    </button>
  );
}

/* ---------- XML viewer ---------- */

function XmlNode({ el, depth, onPath }: { el: Element; depth: number; onPath: (p: string) => void }) {
  const [open, setOpen] = useState(depth < 3);
  const kids = Array.from(el.children);
  const text = kids.length ? "" : (el.textContent ?? "").trim();
  return (
    <div>
      <div className="flex min-w-0 items-start">
        {kids.length ? (
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={open ? "Collapse" : "Expand"} className="inline-flex size-5 shrink-0 items-center justify-center text-ink-3 hover:text-ink">
            <ChevronRight aria-hidden className={cn("size-3.5 transition-transform duration-200", open && "rotate-90")} />
          </button>
        ) : (
          <span className="inline-block w-5 shrink-0" />
        )}
        <button type="button" onClick={() => onPath(pathOf(el))} title="Copy XPath" className="rounded-[4px] px-0.5 text-accent hover:bg-paper-2">
          &lt;{el.nodeName}
        </button>
        {Array.from(el.attributes).map((a) => (
          <span key={a.name} className="ml-1.5 whitespace-nowrap">
            <span className="text-ink-2">{a.name}</span>=<span className="text-success">&quot;{a.value}&quot;</span>
          </span>
        ))}
        <span className="text-accent">&gt;</span>
        {text && <span className="ml-1 break-all text-ink">{text}</span>}
        {!open && kids.length > 0 && <span className="mx-1 rounded-sm bg-paper-2 px-1.5 text-[12px] text-ink-3">{kids.length} children</span>}
      </div>
      {open && kids.length > 0 && (
        <div className="ml-2.5 border-l border-line pl-1">
          {kids.slice(0, 500).map((k, i) => (
            <XmlNode key={i} el={k} depth={depth + 1} onPath={onPath} />
          ))}
        </div>
      )}
    </div>
  );
}

export function XmlViewerEngine() {
  const [xml, setXml] = useState(BOOKS);
  const [copied, setCopied] = useState("");
  const d = useDeferredValue(xml);
  const { doc, error } = useMemo(() => parseXml(d), [d]);
  const count = doc ? doc.getElementsByTagName("*").length : 0;
  const onPath = (p: string) => {
    void navigator.clipboard.writeText(p).catch(() => {});
    setCopied(p);
  };
  return (
    <>
      <Editor value={xml} onChange={setXml} name="data.xml" rows={8} invalid={Boolean(error)} />
      {error ? (
        <Notice tone="danger">The XML isn&apos;t well-formed: {error}</Notice>
      ) : (
        doc && (
          <div className="overflow-hidden rounded-md border border-line bg-surface">
            <div className="flex items-center justify-between gap-3 border-b border-line bg-paper px-3 py-1.5">
              <span className="font-mono text-[12px] text-ink">tree · {count} elements</span>
              <span className="truncate font-mono text-[12px] text-ink-3" aria-live="polite">{copied ? `Copied ${copied}` : "Click a tag to copy its XPath"}</span>
            </div>
            <div className="max-h-[480px] overflow-auto px-2 py-2 font-mono text-[13px] leading-relaxed" data-lenis-prevent>
              <XmlNode el={doc.documentElement} depth={0} onPath={onPath} />
            </div>
          </div>
        )
      )}
    </>
  );
}

/* ---------- JSONPath ---------- */

const STORE = `{
  "store": {
    "book": [
      { "category": "reference", "author": "Nigel Rees", "title": "Sayings of the Century", "price": 8.95 },
      { "category": "fiction", "author": "Evelyn Waugh", "title": "Sword of Honour", "price": 12.99 },
      { "category": "fiction", "author": "Herman Melville", "title": "Moby Dick", "isbn": "0-553-21311-3", "price": 8.99 },
      { "category": "fiction", "author": "J. R. R. Tolkien", "title": "The Lord of the Rings", "isbn": "0-395-19395-8", "price": 22.99 }
    ],
    "bicycle": { "color": "red", "price": 19.95 }
  }
}`;
const JP_EXAMPLES = ["$.store.book[*].author", "$..price", "$.store.book[?(@.price < 10)].title", "$..book[-1:]", "$..book[?(@.isbn)]", "$.store.*"];

export function JsonPathEngine() {
  const [json, setJson] = useState(STORE);
  const [path, setPath] = useState(JP_EXAMPLES[0]);
  const [showPaths, setShowPaths] = useState(false);
  const [res, setRes] = useState<{ values?: unknown[]; paths?: string[]; error?: string }>({});
  const dj = useDeferredValue(json);
  const dp = useDeferredValue(path);
  useEffect(() => {
    let live = true;
    void (async () => {
      let data: unknown;
      try {
        data = JSON.parse(dj);
      } catch (e) {
        if (live) setRes({ error: `The JSON isn't valid: ${(e as Error).message}` });
        return;
      }
      try {
        const { JSONPath } = await import("jsonpath-plus");
        const values = JSONPath({ path: dp, json: data as object, wrap: true, eval: "safe" }) as unknown[];
        const paths = JSONPath({ path: dp, json: data as object, resultType: "path", wrap: true, eval: "safe" }) as string[];
        if (live) setRes({ values, paths });
      } catch (e) {
        if (live) setRes({ error: `That JSONPath isn't valid: ${(e as Error).message}` });
      }
    })();
    return () => {
      live = false;
    };
  }, [dj, dp]);
  return (
    <>
      <Panel>
        <Row label="JSONPath">
          <TextField label="JSONPath" value={path} onChange={setPath} placeholder="$.store.book[*].author" mono invalid={Boolean(res.error)} />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {JP_EXAMPLES.map((x) => (
              <button key={x} type="button" onClick={() => setPath(x)} className="rounded-[6px] bg-paper-2 px-2 py-1 font-mono text-[12px] text-ink-2 hover:text-ink">
                {x}
              </button>
            ))}
          </div>
        </Row>
        <Row label="Show">
          <Toggle checked={showPaths} onChange={setShowPaths} label="Each match's path" />
        </Row>
      </Panel>
      <Editor value={json} onChange={setJson} name="data.json" rows={10} />
      {res.error ? (
        <Notice tone="danger">{res.error}</Notice>
      ) : showPaths ? (
        <MatchList items={(res.values ?? []).map((v, i) => ({ path: res.paths?.[i] ?? "", value: JSON.stringify(v, null, 2) }))} />
      ) : (
        <Output value={JSON.stringify(res.values ?? [], null, 2)} name="matches.json" lang={`${res.values?.length ?? 0} matches`}>
          {res.values?.length ? <JsonTree value={res.values} onPath={() => {}} /> : undefined}
        </Output>
      )}
    </>
  );
}

/* ---------- URI template ---------- */

export function UriTemplateEngine() {
  const [tpl, setTpl] = useState("https://api.example.com/users/{id}/repos{?type,sort,per_page}{#section}");
  const [vars, setVars] = useState(`{\n  "id": "octocat",\n  "type": "owner",\n  "sort": "updated",\n  "per_page": 50,\n  "section": "top"\n}`);
  const [res, setRes] = useState<{ url?: string; error?: string }>({});
  const dt = useDeferredValue(tpl);
  const dv = useDeferredValue(vars);
  useEffect(() => {
    let live = true;
    void (async () => {
      let values: Record<string, unknown>;
      try {
        values = JSON.parse(dv || "{}");
      } catch (e) {
        if (live) setRes({ error: `The values aren't valid JSON: ${(e as Error).message}` });
        return;
      }
      try {
        const { parseTemplate } = await import("url-template");
        const url = parseTemplate(dt).expand(values as Parameters<ReturnType<typeof parseTemplate>["expand"]>[0]);
        if (live) setRes({ url });
      } catch (e) {
        if (live) setRes({ error: (e as Error).message });
      }
    })();
    return () => {
      live = false;
    };
  }, [dt, dv]);
  const names = [...new Set([...dt.matchAll(/\{[+#./;?&]?([^}]+)\}/g)].flatMap((m) => m[1].split(",").map((s) => s.replace(/[:*].*$/, "").trim())))];
  return (
    <>
      <Panel>
        <Row label="Template" hint="RFC 6570">
          <TextField label="URI template" value={tpl} onChange={setTpl} mono />
          {names.length > 0 && <p className="mt-1.5 font-mono text-xs text-ink-3">Variables: {names.join(", ")}</p>}
        </Row>
      </Panel>
      <Editor value={vars} onChange={setVars} name="values.json" rows={8} invalid={Boolean(res.error)} />
      <Output value={res.url ?? ""} error={res.error} name="url" lang="Expanded URI" />
    </>
  );
}
