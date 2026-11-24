"use client";

import { useEffect, useRef } from "react";
import type { EditorView } from "@codemirror/view";
import type { Compartment } from "@codemirror/state";
import { cn } from "@/lib/utils";

/**
 * CodeMirror 6 for bodies, scripts, responses and snippets, in the site's tokens. {{variables}} are
 * coloured (green when defined, red when not) with a hover card showing the value and its scope,
 * `{{` suggests every variable, and script editors complete the `pm` API.
 */

export type VarInfo = { known: (name: string) => boolean; describe: (name: string) => { value: string; scope: string } | null; names: () => { name: string; scope: string; value: string }[] };

const LANG_NAMES: Record<string, string> = { json: "JSON", javascript: "JavaScript", html: "HTML", xml: "XML", yaml: "YAML", css: "CSS", markdown: "Markdown", graphql: "", text: "" };

export const PM_COMPLETIONS: { label: string; detail: string; type?: string }[] = [
  ["pm.test(name, fn)", "Define a test"],
  ["pm.expect(value)", "Chai assertion"],
  ["pm.response.json()", "Body as JSON"],
  ["pm.response.text()", "Body as text"],
  ["pm.response.code", "Status code"],
  ["pm.response.status", "Status text"],
  ["pm.response.headers.get(name)", "A response header"],
  ["pm.response.responseTime", "Time in ms"],
  ["pm.response.responseSize", "Body size in bytes"],
  ["pm.response.to.have.status(200)", "Assert status"],
  ["pm.response.to.have.header(name)", "Assert a header"],
  ["pm.response.to.have.jsonBody(path, value)", "Assert JSON"],
  ["pm.response.to.have.jsonSchema(schema)", "Validate JSON schema"],
  ["pm.response.to.be.ok", "Status is 200"],
  ["pm.response.to.be.success", "Status is 2xx"],
  ["pm.response.to.be.json", "Body is JSON"],
  ["pm.request.url", "The request URL"],
  ["pm.request.headers.add({ key, value })", "Add a header"],
  ["pm.request.headers.upsert({ key, value })", "Set a header"],
  ["pm.request.headers.remove(name)", "Remove a header"],
  ["pm.request.body.update(text)", "Replace the body"],
  ["pm.request.method", "The method"],
  ["pm.environment.get(name)", "Environment variable"],
  ["pm.environment.set(name, value)", "Set an environment variable"],
  ["pm.environment.unset(name)", "Remove an environment variable"],
  ["pm.collectionVariables.get(name)", "Collection variable"],
  ["pm.collectionVariables.set(name, value)", "Set a collection variable"],
  ["pm.globals.get(name)", "Global variable"],
  ["pm.globals.set(name, value)", "Set a global variable"],
  ["pm.variables.get(name)", "Variable from any scope"],
  ["pm.variables.set(name, value)", "Local variable"],
  ["pm.variables.replaceIn(text)", "Resolve {{vars}} in text"],
  ["pm.iterationData.get(name)", "Data file value"],
  ["pm.vault.get(name)", "Vault secret (async)"],
  ["pm.cookies.get(name)", "Response cookie"],
  ["pm.cookies.jar()", "The cookie jar"],
  ["pm.sendRequest(req, callback)", "Send another request"],
  ["pm.execution.setNextRequest(name)", "Runner: jump to a request"],
  ["pm.execution.skipRequest()", "Skip this request"],
  ["pm.visualizer.set(template, data)", "Visualize the response"],
  ["pm.info.requestName", "This request's name"],
  ["pm.info.iteration", "Runner iteration"],
  ["pm.require('lodash')", "lodash, crypto-js, chai, ajv, uuid, tv4, xml2js"],
  ["console.log()", "Log to the console"],
  ["CryptoJS", "crypto-js"],
  ["xml2Json(text)", "XML to JSON"],
].map(([label, detail]) => ({ label, detail, type: "function" }));

export function CodeEditor({
  value,
  onChange,
  language = "text",
  readOnly,
  wrap,
  vars,
  scripts,
  className,
  placeholder,
  onReady,
  onRun,
  ariaLabel,
}: {
  value: string;
  onChange?: (v: string) => void;
  language?: string;
  readOnly?: boolean;
  wrap?: boolean;
  vars?: VarInfo;
  scripts?: boolean;
  className?: string;
  placeholder?: string;
  onReady?: (v: EditorView) => void;
  /** Ctrl/⌘+Enter inside the editor. */
  onRun?: () => void;
  ariaLabel?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const comps = useRef<{ lang: Compartment; wrap: Compartment; ro: Compartment } | null>(null);
  const latest = useRef({ onChange, vars, onRun, onReady });
  useEffect(() => {
    latest.current = { onChange, vars, onRun, onReady };
  });
  const initial = useRef(value);

  useEffect(() => {
    let dead = false;
    void (async () => {
      const [{ basicSetup }, cmView, { EditorState, Compartment, Prec }, { indentWithTab }, ac] = await Promise.all([
        import("codemirror"),
        import("@codemirror/view"),
        import("@codemirror/state"),
        import("@codemirror/commands"),
        import("@codemirror/autocomplete"),
      ]);
      const { EditorView, keymap, Decoration, MatchDecorator, ViewPlugin, hoverTooltip, placeholder: ph } = cmView;
      if (dead || !host.current) return;
      const lang = new Compartment();
      const wrapC = new Compartment();
      const ro = new Compartment();
      comps.current = { lang, wrap: wrapC, ro };
      const theme = EditorView.theme({
        "&": { fontSize: "12.5px", backgroundColor: "var(--color-surface)", color: "var(--color-ink)", height: "100%" },
        ".cm-scroller": { fontFamily: "var(--font-mono), ui-monospace, monospace", lineHeight: "1.6" },
        ".cm-gutters": { backgroundColor: "var(--color-paper)", color: "var(--color-ink-3)", borderRight: "1px solid var(--color-line)" },
        ".cm-activeLine": { backgroundColor: "color-mix(in oklab, var(--color-accent) 5%, transparent)" },
        ".cm-activeLineGutter": { backgroundColor: "color-mix(in oklab, var(--color-accent) 9%, transparent)", color: "var(--color-ink)" },
        "&.cm-focused": { outline: "none" },
        ".cm-cursor": { borderLeftColor: "var(--color-ink)" },
        "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": { backgroundColor: "color-mix(in oklab, var(--color-accent) 20%, transparent) !important" },
        ".cm-panels": { backgroundColor: "var(--color-paper)", color: "var(--color-ink)", borderColor: "var(--color-line)" },
        ".cm-panel input, .cm-panel button": { fontSize: "12px" },
        ".cm-var-ok": { color: "var(--color-success)", backgroundColor: "color-mix(in oklab, var(--color-success) 10%, transparent)", borderRadius: "3px" },
        ".cm-var-bad": { color: "var(--color-danger)", backgroundColor: "color-mix(in oklab, var(--color-danger) 10%, transparent)", borderRadius: "3px" },
        ".cm-tooltip": { border: "1px solid var(--color-line)", backgroundColor: "var(--color-surface)", borderRadius: "8px", boxShadow: "0 12px 32px -12px rgba(21,20,15,.25)" },
        ".cm-tooltip-autocomplete ul li[aria-selected]": { backgroundColor: "var(--color-ink)", color: "var(--color-paper)" },
        ".cm-tooltip-autocomplete": { fontFamily: "var(--font-mono), monospace", fontSize: "12px" },
        ".cm-placeholder": { color: "var(--color-ink-3)" },
        ".cm-foldGutter span": { color: "var(--color-ink-3)" },
      });
      const matcher = new MatchDecorator({
        regexp: /\{\{([^{}]+?)\}\}/g,
        decoration: (m) => Decoration.mark({ class: latest.current.vars?.known(m[1].trim()) || /^\$/.test(m[1].trim()) ? "cm-var-ok" : "cm-var-bad" }),
      });
      const varPlugin = ViewPlugin.fromClass(
        class {
          decorations;
          constructor(v: EditorView) {
            this.decorations = matcher.createDeco(v);
          }
          update(u: import("@codemirror/view").ViewUpdate) {
            this.decorations = matcher.updateDeco(u, this.decorations);
          }
        },
        { decorations: (v) => v.decorations },
      );
      const varHover = hoverTooltip((v, pos) => {
        const line = v.state.doc.lineAt(pos);
        for (const m of line.text.matchAll(/\{\{([^{}]+?)\}\}/g)) {
          const from = line.from + (m.index ?? 0);
          const to = from + m[0].length;
          if (pos < from || pos > to) continue;
          const name = m[1].trim();
          const info = name.startsWith("$") ? { value: "A new random value each time it's sent", scope: "Dynamic" } : latest.current.vars?.describe(name);
          return {
            pos: from,
            end: to,
            above: true,
            create() {
              const dom = document.createElement("div");
              dom.style.cssText = "padding:8px 10px;max-width:320px;font:12px var(--font-sans),sans-serif";
              const s = document.createElement("div");
              s.style.cssText = "font:12px var(--font-mono),monospace;text-transform:uppercase;letter-spacing:.08em;color:var(--color-ink-3)";
              s.textContent = info ? info.scope : "Not defined";
              const val = document.createElement("div");
              val.style.cssText = "margin-top:4px;font:12px var(--font-mono),monospace;word-break:break-all;color:var(--color-ink)";
              val.textContent = info ? info.value || "(empty)" : `{{${name}}} isn't set in the active environment, the collection, or globals.`;
              dom.append(s, val);
              return { dom };
            },
          };
        }
        return null;
      });
      const varComplete = (ctx: import("@codemirror/autocomplete").CompletionContext) => {
        const m = ctx.matchBefore(/\{\{[^{}\s]*$/);
        if (!m) return null;
        const list = latest.current.vars?.names() ?? [];
        const { DYNAMIC_NAMES } = DYN;
        return {
          from: m.from + 2,
          options: [
            ...list.map((x) => ({ label: x.name, detail: x.scope, info: x.value, apply: `${x.name}}}`, type: "variable" })),
            ...DYNAMIC_NAMES.map((n) => ({ label: `$${n}`, detail: "dynamic", apply: `$${n}}}`, type: "constant" })),
          ],
          validFor: /^[^{}\s]*$/,
        };
      };
      const pmComplete = (ctx: import("@codemirror/autocomplete").CompletionContext) => {
        const m = ctx.matchBefore(/[\w.]+$/);
        if (!m || (m.from === m.to && !ctx.explicit)) return null;
        return { from: m.from, options: PM_COMPLETIONS.filter((c) => c.label.startsWith(m.text.slice(0, 2))).map((c) => ({ ...c, apply: c.label.replace(/\(.*\)$/, c.label.endsWith("()") ? "()" : "(") })) };
      };
      const runKey = Prec.highest(
        keymap.of([
          {
            key: "Mod-Enter",
            run: () => {
              latest.current.onRun?.();
              return !!latest.current.onRun;
            },
          },
        ]),
      );
      view.current = new EditorView({
        parent: host.current,
        state: EditorState.create({
          doc: initial.current,
          extensions: [
            runKey,
            basicSetup,
            keymap.of([indentWithTab]),
            theme,
            lang.of([]),
            wrapC.of(wrap ? EditorView.lineWrapping : []),
            ro.of(EditorState.readOnly.of(!!readOnly)),
            varPlugin,
            varHover,
            ac.autocompletion({ override: scripts ? [varComplete, pmComplete] : [varComplete], activateOnTyping: true }),
            ...(placeholder ? [ph(placeholder)] : []),
            EditorView.contentAttributes.of({ "aria-label": ariaLabel ?? "Code editor" }),
            EditorView.updateListener.of((u) => {
              if (u.docChanged) latest.current.onChange?.(u.state.doc.toString());
            }),
          ],
        }),
      });
      latest.current.onReady?.(view.current);
    })();
    return () => {
      dead = true;
      view.current?.destroy();
      view.current = null;
    };
    // The editor is created once; later prop changes are applied through compartments below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let dead = false;
    void (async () => {
      const name = LANG_NAMES[language] ?? language;
      for (let i = 0; i < 60 && !view.current; i++) await new Promise((r) => setTimeout(r, 30));
      if (!name) {
        if (!dead && view.current && comps.current) view.current.dispatch({ effects: comps.current.lang.reconfigure([]) });
        return;
      }
      const { languages } = await import("@codemirror/language-data");
      const desc = languages.find((l) => l.name === name);
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
      const [{ EditorView }, { EditorState }] = await Promise.all([import("@codemirror/view"), import("@codemirror/state")]);
      for (let i = 0; i < 60 && !view.current; i++) await new Promise((r) => setTimeout(r, 30));
      if (view.current && comps.current)
        view.current.dispatch({ effects: [comps.current.wrap.reconfigure(wrap ? EditorView.lineWrapping : []), comps.current.ro.reconfigure(EditorState.readOnly.of(!!readOnly))] });
    })();
  }, [wrap, readOnly]);

  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);

  return <div ref={host} className={cn("min-h-0 overflow-hidden [&_.cm-editor]:h-full", className)} data-lenis-prevent />;
}

// Loaded lazily with the editor so the dynamic-variable list isn't in the page's first chunk.
const DYN = { DYNAMIC_NAMES: [] as string[] };
void import("../lib/vars").then((m) => (DYN.DYNAMIC_NAMES = m.DYNAMIC_NAMES));
