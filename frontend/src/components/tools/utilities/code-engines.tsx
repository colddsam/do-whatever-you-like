"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Download, FolderOpen, Monitor, Smartphone, Tablet } from "lucide-react";
import { saveBlob } from "@/lib/files";
import { formatBytes } from "@/lib/media";
import {
  CodeProblem,
  DEFAULT_FORMAT,
  formatCode,
  minifyCode,
  SQL_DIALECTS,
  validateCode,
  type CodeError,
  type FormatLang,
  type FormatOptions,
  type MinifyLang,
  type ValidateLang,
  type Validation,
} from "@/lib/utilities/code";
import { cn } from "@/lib/utils";
import { Chips, Notice, Panel, Row, Slider, Toggle } from "../pdf/kit";
import { CopyButton, Editor, Output } from "../dev/parts";
import type { EngineProps } from "./text-engines";

/* ---------- samples ---------- */

const SAMPLES: Record<string, string> = {
  html: `<!DOCTYPE html><html><head><title>Hello</title><style>body{font-family:sans-serif;margin:0}</style></head><body><!-- greeting --><div class="card"><h1>Hello   world</h1><p>Some <b>bold</b> text.</p><ul><li>One</li><li>Two</li></ul></div><script>const add=(a,b)=>a+b;console.log(add(1,2))</script></body></html>`,
  css: `.card{display:flex;gap:12px;padding:16px 24px;color:#ff0000;background:rgba(0,0,0,.05)}.card h1{font-size:2rem;margin:0px}@media (max-width:600px){.card{flex-direction:column}}`,
  javascript: `function greet(name){const msg=\`Hello, \${name}!\`;if(!name){return null}return msg}\nconst items=[1,2,3].map(x=>x*2).filter(Boolean);console.log(greet("world"),items)`,
  typescript: `interface User{id:number;name:string;email?:string}\nfunction byId<T extends {id:number}>(list:T[],id:number):T|undefined{return list.find(x=>x.id===id)}\nconst u:User={id:1,name:"Ada"};console.log(byId([u],1))`,
  jsx: `export default function Card({title,items}){return <div className="card"><h2>{title}</h2><ul>{items.map(i=><li key={i.id}>{i.label}</li>)}</ul></div>}`,
  angular: `<div class="list"><app-item *ngFor="let item of items; trackBy: trackById" [item]="item" (select)="onSelect($event)"></app-item><p *ngIf="!items.length">Nothing here</p>{{ total | currency:'USD' }}</div>`,
  xml: `<?xml version="1.0" encoding="UTF-8"?><catalog><book id="bk101"><author>Gambardella, Matthew</author><title>XML Developer's Guide</title><price currency="USD">44.95</price></book><book id="bk102"><author>Ralls, Kim</author><title>Midnight Rain</title><price currency="USD">5.95</price></book></catalog>`,
  php: `<?php\nnamespace App;\nclass Greeter{private string $name;public function __construct(string $name){$this->name=$name;}\npublic function greet():string{return "Hello, ".$this->name;}}\n$g=new Greeter("world");echo $g->greet();`,
  java: `public class Main{public static void main(String[] args){int[] nums={3,1,2};java.util.Arrays.sort(nums);for(int n:nums){System.out.println(n);}}}`,
  sql: `select u.id,u.name,count(o.id) as orders from users u left join orders o on o.user_id=u.id where u.created_at>'2024-01-01' and u.active=1 group by u.id,u.name having count(o.id)>2 order by orders desc limit 10;`,
  yaml: `server:\n    port: 8080\n    hosts: [ "a.example.com","b.example.com" ]\ndatabase: {user: admin, pool: 10}\n# comment kept\nfeatures:\n- auth\n-   billing`,
  markdown: `# Title\nSome *text* with __bold__.\n* one\n* two\n\n|a|b|\n|-|-|\n|1|2|`,
  json: `{"name":"Do-Whatever","tools":["format","minify"],"free":true}`,
};

const FORMAT_LANGS: { value: FormatLang; label: string }[] = [
  { value: "html", label: "HTML" }, { value: "css", label: "CSS / SCSS / Less" }, { value: "javascript", label: "JavaScript" }, { value: "typescript", label: "TypeScript" },
  { value: "jsx", label: "React / JSX" }, { value: "angular", label: "Angular" }, { value: "xml", label: "XML" }, { value: "php", label: "PHP" },
  { value: "java", label: "Java" }, { value: "sql", label: "SQL" }, { value: "yaml", label: "YAML" }, { value: "markdown", label: "Markdown" },
];
const EXT: Record<string, string> = { html: "html", css: "css", javascript: "js", typescript: "ts", jsx: "jsx", angular: "html", xml: "xml", php: "php", java: "java", sql: "sql", yaml: "yaml", markdown: "md", json: "json" };

/** A located error, with the offending line quoted. */
function ProblemList({ problems, code }: { problems: CodeError[]; code: string }) {
  const lines = code.split("\n");
  return (
    <ul className="divide-y divide-line">
      {problems.slice(0, 50).map((p, i) => (
        <li key={i} className="px-3 py-2.5">
          <p className="text-sm text-danger">
            {p.line ? <span className="mr-2 font-mono text-xs text-ink-3">line {p.line}{p.column !== undefined ? `:${p.column}` : ""}</span> : null}
            {p.message}
          </p>
          {p.line && lines[p.line - 1] !== undefined && (
            <pre className="mt-1.5 overflow-x-auto rounded-sm bg-paper px-2 py-1 font-mono text-[12px] text-ink-2" data-lenis-prevent>
              {lines[p.line - 1].slice(0, 300)}
              {p.column !== undefined && `\n${" ".repeat(Math.max(0, Math.min(300, p.column - (p.column > 0 && lines[p.line - 1].length >= p.column ? 1 : 0))))}^`}
            </pre>
          )}
        </li>
      ))}
    </ul>
  );
}

/* ---------- format ---------- */

export function FormatEngine({ preset }: EngineProps) {
  const [lang, setLang] = useState<FormatLang>((preset.lang as FormatLang) ?? "html");
  const [input, setInput] = useState(SAMPLES[lang]);
  const [o, setO] = useState<FormatOptions>(DEFAULT_FORMAT);
  const [out, setOut] = useState<{ code: string; problems: CodeError[] | null; busy: boolean }>({ code: "", problems: null, busy: true });
  const d = useDeferredValue(input);
  const set = (p: Partial<FormatOptions>) => setO((v) => ({ ...v, ...p }));
  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      try {
        const code = await formatCode(d, lang, o);
        if (live) setOut({ code, problems: null, busy: false });
      } catch (err) {
        if (live) setOut({ code: "", problems: err instanceof CodeProblem ? err.problems : [{ message: (err as Error).message }], busy: false });
      }
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [d, lang, o]);
  const jsLike = ["javascript", "typescript", "jsx"].includes(lang);
  return (
    <>
      <Panel>
        <Row label="Language">
          <Chips value={lang} options={FORMAT_LANGS} onChange={(l) => (setLang(l), setInput(SAMPLES[l]))} label="Language" />
        </Row>
        <Row label="Indent">
          <div className="flex flex-wrap items-center gap-4">
            <Chips value={o.useTabs ? 0 : o.tabWidth} options={[{ value: 2, label: "2 spaces" }, { value: 4, label: "4 spaces" }, { value: 0, label: "Tabs" }]} onChange={(v) => set(v ? { tabWidth: v, useTabs: false } : { useTabs: true })} label="Indent" />
          </div>
        </Row>
        {lang === "sql" ? (
          <>
            <Row label="Dialect">
              <Chips value={o.sqlDialect} options={SQL_DIALECTS} onChange={(v) => set({ sqlDialect: v })} label="SQL dialect" />
            </Row>
            <Row label="Keywords">
              <Chips value={o.keywordCase} options={[{ value: "upper", label: "UPPER" }, { value: "lower", label: "lower" }, { value: "preserve", label: "As written" }]} onChange={(v) => set({ keywordCase: v })} label="Keyword case" />
            </Row>
          </>
        ) : (
          <Row label="Line length">
            <Slider label="Line length" value={o.printWidth} min={40} max={160} step={10} onChange={(v) => set({ printWidth: v })} format={(v) => `${v} chars`} />
          </Row>
        )}
        {jsLike && (
          <Row label="Style">
            <div className="flex flex-wrap gap-x-6 gap-y-3">
              <Toggle checked={o.singleQuote} onChange={(v) => set({ singleQuote: v })} label="Single quotes" />
              <Toggle checked={o.semi} onChange={(v) => set({ semi: v })} label="Semicolons" />
            </div>
          </Row>
        )}
      </Panel>
      <Editor value={input} onChange={setInput} name={`input.${EXT[lang]}`} rows={10} invalid={Boolean(out.problems)} />
      <Output
        value={out.code}
        name={`formatted.${EXT[lang]}`}
        lang={out.busy ? "Formatting…" : lang === "sql" ? "sql-formatter" : "Prettier"}
        download={`formatted.${EXT[lang]}`}
        wrap={false}
        error={out.problems ? <ProblemList problems={out.problems} code={d} /> : undefined}
      />
    </>
  );
}

/* ---------- minify ---------- */

export function MinifyEngine({ preset }: EngineProps) {
  const [lang, setLang] = useState<MinifyLang>((preset.lang as MinifyLang) ?? "javascript");
  const [input, setInput] = useState(SAMPLES[lang]);
  const [mangle, setMangle] = useState(true);
  const [comments, setComments] = useState(false);
  const [inlineAssets, setInline] = useState(true);
  const [out, setOut] = useState<{ code: string; problems: CodeError[] | null; busy: boolean }>({ code: "", problems: null, busy: true });
  const d = useDeferredValue(input);
  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      try {
        const code = await minifyCode(d, lang, { mangle, comments, inlineAssets });
        if (live) setOut({ code, problems: null, busy: false });
      } catch (err) {
        if (live) setOut({ code: "", problems: err instanceof CodeProblem ? err.problems : [{ message: (err as Error).message }], busy: false });
      }
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [d, lang, mangle, comments, inlineAssets]);
  const before = new TextEncoder().encode(d).length;
  const after = new TextEncoder().encode(out.code).length;
  const saved = before ? Math.round((1 - after / before) * 100) : 0;
  return (
    <>
      <Panel>
        <Row label="Language">
          <Chips value={lang} options={[{ value: "javascript", label: "JavaScript" }, { value: "css", label: "CSS" }, { value: "html", label: "HTML" }]} onChange={(l) => (setLang(l), setInput(SAMPLES[l]))} label="Language" />
        </Row>
        <Row label="Options">
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            {lang !== "css" && <Toggle checked={mangle} onChange={setMangle} label="Shorten variable names" />}
            {lang === "html" && <Toggle checked={inlineAssets} onChange={setInline} label="Minify inline CSS and JS" />}
            <Toggle checked={comments} onChange={setComments} label={lang === "html" ? "Keep comments" : "Keep licence comments (/*!)"} />
          </div>
        </Row>
      </Panel>
      <Editor value={input} onChange={setInput} name={`input.${EXT[lang]}`} rows={10} invalid={Boolean(out.problems)} />
      <Output
        value={out.code}
        name={`min.${EXT[lang]}`}
        lang={out.busy ? "Minifying…" : out.code ? `${formatBytes(before)} → ${formatBytes(after)} · ${saved}% smaller` : lang === "javascript" ? "Terser" : lang === "css" ? "csso" : "HTML"}
        download={`min.${EXT[lang]}`}
        error={out.problems ? <ProblemList problems={out.problems} code={d} /> : undefined}
      />
    </>
  );
}

/* ---------- validate ---------- */

const VALIDATE_SAMPLES: Record<ValidateLang, string> = {
  javascript: `$(function () {\n  $(".btn").on("click", function () {\n    const n = 1;\n    console.log("clicked" n);\n  });\n});`,
  css: `.card {\n  display: flex;\n  colour: red;\n  margin: 10px auto 0;\n  width: 12pz;\n}`,
  xml: `<?xml version="1.0"?>\n<note>\n  <to>Tove</to>\n  <from>Jani</Ffrom>\n</note>`,
  yaml: `name: app\nversion: 1.2\nservices:\n  - web\n  - worker\nenv:\n  DEBUG: true\n   PORT: 8080`,
  json: `{"a": 1, "b": [1, 2,]}`,
};

export function ValidateEngine({ preset }: EngineProps) {
  const [lang, setLang] = useState<ValidateLang>((preset.lang as ValidateLang) ?? "javascript");
  const [input, setInput] = useState(VALIDATE_SAMPLES[lang]);
  const [res, setRes] = useState<Validation | null>(null);
  const d = useDeferredValue(input);
  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      const r = await validateCode(d, lang).catch((e) => ({ ok: false, problems: [{ message: (e as Error).message }], summary: "Couldn't check." }) as Validation);
      if (live) setRes(r);
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [d, lang]);
  return (
    <>
      <Panel>
        <Row label="Language">
          <Chips value={lang} options={[{ value: "javascript", label: "JavaScript / jQuery / JSX" }, { value: "css", label: "CSS" }, { value: "xml", label: "XML" }, { value: "yaml", label: "YAML" }, { value: "json", label: "JSON" }]} onChange={(l) => (setLang(l), setInput(VALIDATE_SAMPLES[l]))} label="Language" />
        </Row>
      </Panel>
      <Editor value={input} onChange={setInput} name={`input.${EXT[lang]}`} rows={10} invalid={res ? !res.ok && res.problems.length > 0 : false} />
      {res && (
        <div className={cn("overflow-hidden rounded-md border bg-surface", res.ok ? "border-success/40" : res.problems.length ? "border-danger/40" : "border-line")} aria-live="polite">
          <p className={cn("flex items-center justify-between gap-3 border-b border-line px-3 py-2.5 text-sm font-medium", res.ok ? "bg-success/10 text-success" : res.problems.length ? "bg-danger/5 text-danger" : "text-ink-3")}>
            <span>{res.ok ? `✓ ${res.summary}` : res.problems.length ? `✗ ${res.summary}` : res.summary}</span>
          </p>
          {res.problems.length > 0 && <ProblemList problems={res.problems} code={d} />}
        </div>
      )}
      {res?.ok && res.extra && <Output value={res.extra} name="as.json" lang="The YAML, read as JSON" />}
    </>
  );
}

/* ---------- code editor (CodeMirror) ---------- */

type CmLang = { name: string; ext: string };

/** CodeMirror 6, styled with the site's tokens, with a language picked from 140+ (loaded on demand). */
export function CodeArea({
  value,
  onChange,
  language,
  wrap,
  onReady,
  className = "h-[460px]",
}: {
  value: string;
  onChange: (v: string) => void;
  language: string;
  wrap: boolean;
  /** Hands out the EditorView once it exists (toolbars, scroll sync). */
  onReady?: (view: import("@codemirror/view").EditorView) => void;
  className?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<import("@codemirror/view").EditorView | null>(null);
  const comps = useRef<{ lang: import("@codemirror/state").Compartment; wrap: import("@codemirror/state").Compartment } | null>(null);
  const changed = useRef(onChange);
  const ready = useRef(onReady);
  useEffect(() => {
    changed.current = onChange;
    ready.current = onReady;
  });
  const initial = useRef(value);

  useEffect(() => {
    let dead = false;
    void (async () => {
      const [{ basicSetup }, { EditorView, keymap }, { EditorState, Compartment }, { indentWithTab }] = await Promise.all([
        import("codemirror"),
        import("@codemirror/view"),
        import("@codemirror/state"),
        import("@codemirror/commands"),
      ]);
      if (dead || !host.current) return;
      const lang = new Compartment();
      const wrapC = new Compartment();
      comps.current = { lang, wrap: wrapC };
      const theme = EditorView.theme({
        "&": { fontSize: "13px", backgroundColor: "var(--color-surface)", color: "var(--color-ink)", height: "100%" },
        ".cm-scroller": { fontFamily: "var(--font-mono), ui-monospace, monospace", lineHeight: "1.6" },
        ".cm-gutters": { backgroundColor: "var(--color-paper)", color: "var(--color-ink-3)", borderRight: "1px solid var(--color-line)" },
        ".cm-activeLine": { backgroundColor: "color-mix(in oklab, var(--color-accent) 6%, transparent)" },
        ".cm-activeLineGutter": { backgroundColor: "color-mix(in oklab, var(--color-accent) 10%, transparent)", color: "var(--color-ink)" },
        "&.cm-focused": { outline: "none" },
        ".cm-cursor": { borderLeftColor: "var(--color-ink)" },
        "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": { backgroundColor: "color-mix(in oklab, var(--color-accent) 22%, transparent) !important" },
        ".cm-panels": { backgroundColor: "var(--color-paper)", color: "var(--color-ink)" },
      });
      view.current = new EditorView({
        parent: host.current,
        state: EditorState.create({
          doc: initial.current,
          extensions: [
            basicSetup,
            keymap.of([indentWithTab]),
            theme,
            lang.of([]),
            wrapC.of([]),
            EditorView.updateListener.of((u) => {
              if (u.docChanged) changed.current(u.state.doc.toString());
            }),
          ],
        }),
      });
      ready.current?.(view.current);
    })();
    return () => {
      dead = true;
      view.current?.destroy();
      view.current = null;
    };
  }, []);

  // Language: load its support on demand and swap it in.
  useEffect(() => {
    let dead = false;
    void (async () => {
      const { languages } = await import("@codemirror/language-data");
      for (let i = 0; i < 40 && !view.current; i++) await new Promise((r) => setTimeout(r, 50));
      const desc = languages.find((l) => l.name === language);
      const support = desc ? await desc.load().catch(() => null) : null;
      if (dead || !view.current || !comps.current) return;
      view.current.dispatch({ effects: comps.current.lang.reconfigure(support ?? []) });
    })();
    return () => {
      dead = true;
    };
  }, [language]);

  useEffect(() => {
    void (async () => {
      const { EditorView } = await import("@codemirror/view");
      for (let i = 0; i < 40 && !view.current; i++) await new Promise((r) => setTimeout(r, 50));
      if (view.current && comps.current) view.current.dispatch({ effects: comps.current.wrap.reconfigure(wrap ? EditorView.lineWrapping : []) });
    })();
  }, [wrap]);

  // Outside changes (open a file, clear): replace the document.
  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);

  return <div ref={host} className={cn("overflow-hidden [&_.cm-editor]:h-full", className)} data-lenis-prevent />;
}

const POPULAR = ["Plain text", "JavaScript", "TypeScript", "Python", "Java", "C++", "C#", "PHP", "HTML", "CSS", "SQL", "JSON", "Markdown", "Go", "Rust", "Kotlin", "Swift", "Ruby", "Shell", "YAML", "XML", "LaTeX"];
const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* private mode: nothing saved */
    }
  },
};

export function EditorEngine({ preset }: EngineProps) {
  const plain = preset.lang === "text";
  const key = plain ? "dw:text-editor" : "dw:code-editor";
  const [langs, setLangs] = useState<CmLang[]>([]);
  const [language, setLanguage] = useState(plain ? "Plain text" : "JavaScript");
  const [value, setValue] = useState(plain ? "Start typing. Everything is saved in this browser as you go.\n" : SAMPLES.javascript.replace(/;/g, ";\n"));
  const [wrap, setWrap] = useState(plain);
  const [filter, setFilter] = useState("");
  const [preview, setPreview] = useState(false);
  const loaded = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void import("@codemirror/language-data").then(({ languages }) => setLangs(languages.map((l) => ({ name: l.name, ext: l.extensions[0] ?? "txt" }))));
    // Restore the last session (per editor).
    const saved = store.get(key);
    if (saved) {
      try {
        const s = JSON.parse(saved) as { value: string; language: string };
        queueMicrotask(() => {
          setValue(s.value);
          if (!plain) setLanguage(s.language);
        });
      } catch {
        /* ignore */
      }
    }
    loaded.current = true;
  }, [key, plain]);

  useEffect(() => {
    if (!loaded.current) return;
    const t = setTimeout(() => store.set(key, JSON.stringify({ value, language })), 400);
    return () => clearTimeout(t);
  }, [value, language, key]);

  const ext = langs.find((l) => l.name === language)?.ext ?? "txt";
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const all = [{ name: "Plain text", ext: "txt" }, ...langs];
    return f ? all.filter((l) => l.name.toLowerCase().includes(f) || l.ext.includes(f)) : all.filter((l) => POPULAR.includes(l.name));
  }, [filter, langs]);

  const open = async (file: File) => {
    if (file.size > 5 * 1024 * 1024) return;
    const text = await file.text();
    setValue(text);
    const e = file.name.split(".").pop()?.toLowerCase() ?? "";
    const { languages } = await import("@codemirror/language-data");
    const match = languages.find((l) => l.extensions.includes(e)) ?? languages.find((l) => l.filename?.test(file.name));
    if (match && !plain) setLanguage(match.name);
  };
  const lines = value.split("\n").length;
  const words = value.trim() ? value.trim().split(/\s+/).length : 0;
  const canPreview = language === "HTML" || language === "SVG";

  return (
    <>
      {!plain && (
        <Panel>
          <Row label="Language" hint={`${langs.length + 1} languages`}>
            <input
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search languages: python, rust, cobol, dockerfile…"
              aria-label="Search languages"
              className="mb-2 h-10 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-ink"
            />
            <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto" data-lenis-prevent>
              {shown.map((l) => (
                <button
                  key={l.name}
                  type="button"
                  onClick={() => setLanguage(l.name)}
                  aria-pressed={language === l.name}
                  className={cn("inline-flex h-8 items-center rounded-[8px] border px-2.5 text-[13px] transition-colors", language === l.name ? "border-ink bg-ink text-paper" : "border-line bg-surface text-ink-2 hover:border-ink-3 hover:text-ink")}
                >
                  {l.name}
                </button>
              ))}
              {!shown.length && <p className="text-sm text-ink-3">No language matches “{filter}”.</p>}
            </div>
          </Row>
        </Panel>
      )}
      <div className="overflow-hidden rounded-md border border-line bg-surface focus-within:border-ink">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-paper px-1.5 py-1">
          <span className="-mb-1 inline-flex h-9 items-center border-b border-ink px-2 font-mono text-[12px] text-ink">
            {plain ? "notes.txt" : `untitled.${ext}`}
          </span>
          <div className="flex flex-wrap items-center gap-1">
            <input ref={fileInput} type="file" className="sr-only" onChange={(e) => (e.target.files?.[0] && void open(e.target.files[0]), (e.target.value = ""))} />
            <button type="button" onClick={() => fileInput.current?.click()} className="inline-flex h-8 items-center gap-1.5 rounded-[8px] px-2 text-[13px] text-ink-2 hover:bg-paper-2 hover:text-ink">
              <FolderOpen aria-hidden className="size-3.5" />
              Open
            </button>
            <button type="button" onClick={() => saveBlob(new Blob([value], { type: "text/plain;charset=utf-8" }), plain ? "notes.txt" : `untitled.${ext}`)} className="inline-flex h-8 items-center gap-1.5 rounded-[8px] px-2 text-[13px] text-ink-2 hover:bg-paper-2 hover:text-ink">
              <Download aria-hidden className="size-3.5" />
              Download
            </button>
            <button type="button" onClick={() => setWrap((w) => !w)} aria-pressed={wrap} className={cn("inline-flex h-8 items-center rounded-[8px] px-2 text-[13px] hover:bg-paper-2", wrap ? "text-ink" : "text-ink-3")}>
              Wrap
            </button>
            {canPreview && (
              <button type="button" onClick={() => setPreview((p) => !p)} aria-pressed={preview} className={cn("inline-flex h-8 items-center rounded-[8px] px-2 text-[13px] hover:bg-paper-2", preview ? "text-ink" : "text-ink-3")}>
                Preview
              </button>
            )}
            <CopyButton text={value} />
          </div>
        </div>
        <CodeArea value={value} onChange={setValue} language={plain ? "" : language} wrap={wrap} />
        <p className="flex justify-between gap-3 border-t border-line bg-paper px-3 py-1 font-mono text-[11px] text-ink-3">
          <span>{plain ? "Plain text" : language} · saved in this browser</span>
          <span>
            {lines} lines · {words} words · {value.length.toLocaleString("en")} chars
          </span>
        </p>
      </div>
      {preview && canPreview && <SandboxFrame html={value} />}
    </>
  );
}

/* ---------- HTML viewer ---------- */

/** A sandboxed iframe: scripts run in an opaque origin, so they can't reach this site, its storage or cookies. */
function SandboxFrame({ html, width }: { html: string; width?: number }) {
  return (
    <div className="overflow-x-auto rounded-md border border-line bg-paper-2 p-2" data-lenis-prevent>
      <iframe
        title="Preview"
        sandbox="allow-scripts allow-forms allow-modals allow-popups"
        srcDoc={html}
        className="mx-auto block h-[520px] rounded-sm border border-line bg-white transition-[width] duration-300"
        style={{ width: width ? `${width}px` : "100%", maxWidth: width ? undefined : "100%" }}
      />
    </div>
  );
}

const SAMPLE_PAGE = `<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem; color: #222; }
    .card { border: 1px solid #ddd; border-radius: 12px; padding: 1.5rem; max-width: 28rem; }
    button { background: #eb4a10; color: white; border: 0; padding: .6rem 1rem; border-radius: 8px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Hello!</h1>
    <p>Edit the HTML on the left and watch this update.</p>
    <button onclick="this.textContent = 'Clicked ' + (++window.n || (window.n = 1)) + '×'">Click me</button>
  </div>
</body>
</html>`;

export function HtmlViewerEngine() {
  const [html, setHtml] = useState(SAMPLE_PAGE);
  const [width, setWidth] = useState(0);
  const d = useDeferredValue(html);
  return (
    <>
      <Editor value={html} onChange={setHtml} name="index.html" rows={12} />
      <Panel>
        <Row label="Width">
          <Chips
            value={width}
            options={[
              { value: 0, label: <span className="inline-flex items-center gap-1.5"><Monitor aria-hidden className="size-3.5" />Full</span> },
              { value: 768, label: <span className="inline-flex items-center gap-1.5"><Tablet aria-hidden className="size-3.5" />Tablet 768</span> },
              { value: 390, label: <span className="inline-flex items-center gap-1.5"><Smartphone aria-hidden className="size-3.5" />Phone 390</span> },
            ]}
            onChange={setWidth}
            label="Preview width"
          />
        </Row>
      </Panel>
      <SandboxFrame html={d} width={width || undefined} />
      <Notice>The preview runs in a sandbox: its scripts can&apos;t read this site, your cookies or your storage.</Notice>
    </>
  );
}

export { SandboxFrame };
