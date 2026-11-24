"use client";

import { useMemo, useRef, useState } from "react";
import { ChevronRight, FileUp, Loader2, Paperclip, RefreshCw, Search, Wand2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Body, BodyMode, RawLang, RequestItem } from "../types";
import { putFile } from "../lib/blobs";
import { fmtBytes, prettyXml, tryJson } from "../lib/util";
import { buildOperation, INTROSPECTION, isLeaf, namedType, parseIntrospection, toggleField, typeMap, typeString, type GqlSchema, type GqlType } from "../lib/graphql";
import { prepare } from "../lib/engine";
import { send, pickAgent } from "../lib/agent";
import { useApi } from "../store";
import { CodeEditor } from "./code-editor";
import { Btn, Check2, Input, Note, Select } from "./kit";
import { KVTable } from "./kv-table";
import { useVarInfo } from "./var-input";

const MODES: { id: BodyMode; label: string }[] = [
  { id: "none", label: "none" },
  { id: "formdata", label: "form-data" },
  { id: "urlencoded", label: "x-www-form-urlencoded" },
  { id: "raw", label: "raw" },
  { id: "binary", label: "binary" },
  { id: "graphql", label: "GraphQL" },
];

const LANGS: { value: RawLang; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "javascript", label: "JavaScript" },
  { value: "json", label: "JSON" },
  { value: "html", label: "HTML" },
  { value: "xml", label: "XML" },
];

export function BodyEditor({ req, onChange, collectionId, onRun }: { req: RequestItem; onChange: (b: Body) => void; collectionId?: string; onRun: () => void }) {
  const body = req.body;
  const vars = useVarInfo(collectionId);
  const set = (patch: Partial<Body>) => onChange({ ...body, ...patch });
  const binInput = useRef<HTMLInputElement>(null);
  const beautify = () => {
    if (body.rawLang === "json") {
      const j = tryJson(body.raw.replace(/\{\{[^{}]+\}\}/g, (m) => `"__V${btoa(m)}__"`));
      if (j.ok) set({ raw: JSON.stringify(j.value, null, 2).replace(/"__V([A-Za-z0-9+/=]+)__"/g, (_m, b) => atob(b)) });
    } else if (body.rawLang === "xml" || body.rawLang === "html") set({ raw: prettyXml(body.raw) });
  };
  const jsonError = body.mode === "raw" && body.rawLang === "json" && body.raw.trim() && !tryJson(body.raw.replace(/\{\{[^{}]+\}\}/g, "0")).ok;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div role="radiogroup" aria-label="Body type" className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {MODES.map((m) => (
            <label key={m.id} className="inline-flex cursor-pointer items-center gap-1.5 text-[13px] text-ink-2">
              <input type="radio" name={`body-${req.id}`} checked={body.mode === m.id} onChange={() => set({ mode: m.id })} className="size-3.5 accent-[var(--color-ink)]" />
              <span className={body.mode === m.id ? "font-medium text-ink" : ""}>{m.label}</span>
            </label>
          ))}
        </div>
        {body.mode === "raw" && (
          <div className="ml-auto flex items-center gap-1">
            <Select label="Raw language" value={body.rawLang} onChange={(v) => set({ rawLang: v })} options={LANGS} />
            {(body.rawLang === "json" || body.rawLang === "xml" || body.rawLang === "html") && (
              <Btn variant="ghost" icon={Wand2} onClick={beautify}>
                Beautify
              </Btn>
            )}
          </div>
        )}
      </div>

      {body.mode === "none" && <p className="py-6 text-center text-[13px] text-ink-3">This request does not have a body</p>}
      {body.mode === "formdata" && <KVTable kind="form" rows={body.formdata} onChange={(formdata) => set({ formdata })} />}
      {body.mode === "urlencoded" && <KVTable kind="urlencoded" rows={body.urlencoded} onChange={(urlencoded) => set({ urlencoded })} />}
      {body.mode === "raw" && (
        <>
          <CodeEditor value={body.raw} onChange={(raw) => set({ raw })} language={body.rawLang} vars={vars} onRun={onRun} className="min-h-[180px] flex-1 rounded-md border border-line" ariaLabel="Request body" placeholder="Type or paste the body" />
          {jsonError && <p className="text-[12px] text-warning">This isn&apos;t valid JSON yet (variables are allowed).</p>}
        </>
      )}
      {body.mode === "binary" && (
        <div className="rounded-md border border-dashed border-ink-3/50 bg-paper p-5 text-center">
          <input
            ref={binInput}
            type="file"
            className="sr-only"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) set({ binary: await putFile(f) });
              e.target.value = "";
            }}
          />
          {body.binary ? (
            <span className="inline-flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-1.5 text-[13px]">
              <Paperclip aria-hidden className="size-3.5 text-ink-3" />
              {body.binary.name} <span className="text-ink-3">{fmtBytes(body.binary.size)}</span>
              <button type="button" aria-label="Remove file" onClick={() => set({ binary: undefined })} className="text-ink-3 hover:text-ink">
                <X aria-hidden className="size-3.5" />
              </button>
            </span>
          ) : (
            <Btn icon={FileUp} onClick={() => binInput.current?.click()}>
              Select file
            </Btn>
          )}
          <p className="mt-2 text-[12px] text-ink-3">The file is sent as the whole body. It stays in this browser between visits.</p>
        </div>
      )}
      {body.mode === "graphql" && <GraphqlEditor req={req} onChange={(graphql) => set({ graphql })} collectionId={collectionId} onRun={onRun} />}
    </div>
  );
}

function GraphqlEditor({ req, onChange, collectionId, onRun }: { req: RequestItem; onChange: (g: Body["graphql"]) => void; collectionId?: string; onRun: () => void }) {
  const g = req.body.graphql;
  const vars = useVarInfo(collectionId);
  const [schema, setSchema] = useState<GqlSchema | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showExplorer, setShowExplorer] = useState(true);

  const fetchSchema = async () => {
    setBusy(true);
    setError(null);
    try {
      const s = useApi.getState();
      const { env } = s.engineEnv({ collectionId, itemId: req.id });
      const probe: RequestItem = { ...req, method: "POST", body: { ...req.body, mode: "raw", rawLang: "json", raw: JSON.stringify({ query: INTROSPECTION }) } };
      const p = await prepare(probe, env);
      const res = await send(p, { agent: pickAgent(req.settings.agent === "auto" ? s.settings.defaultAgent : req.settings.agent, p.url), followRedirects: true, followOriginalMethod: true, followAuthHeader: false, maxRedirects: 5, strictSSL: true, timeoutMs: 30000, credentials: s.settings.browserCredentials });
      setSchema(parseIntrospection(JSON.parse(new TextDecoder().decode(res.body))));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const apply = (next: Set<string>) => {
    setSelected(next);
    if (!schema) return;
    const op = buildOperation(schema, next);
    onChange({ query: op.query, variables: Object.keys(op.variables).length ? JSON.stringify(op.variables, null, 2) : "" });
  };

  return (
    <div className="grid min-h-0 flex-1 gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,300px)]">
      <div className="flex min-h-0 flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-medium text-ink-2">Query</span>
          <span className="flex items-center gap-1">
            <Btn variant="ghost" icon={busy ? Loader2 : schema ? RefreshCw : Search} onClick={fetchSchema} disabled={busy} className={busy ? "[&_svg]:animate-spin" : ""}>
              {schema ? "Refresh schema" : "Fetch schema"}
            </Btn>
            {schema && (
              <Btn variant="ghost" onClick={() => setShowExplorer((x) => !x)} className="lg:hidden">
                {showExplorer ? "Hide" : "Show"} explorer
              </Btn>
            )}
          </span>
        </div>
        <CodeEditor value={g.query} onChange={(query) => onChange({ ...g, query })} language="graphql" vars={vars} onRun={onRun} className="min-h-[160px] flex-1 rounded-md border border-line" ariaLabel="GraphQL query" placeholder="query { … }" />
        <span className="text-[12px] font-medium text-ink-2">GraphQL variables (JSON)</span>
        <CodeEditor value={g.variables} onChange={(variables) => onChange({ ...g, variables })} language="json" vars={vars} onRun={onRun} className="h-[110px] shrink-0 rounded-md border border-line" ariaLabel="GraphQL variables" placeholder='{ "id": 1 }' />
        {error && <Note tone="danger">{error}</Note>}
      </div>
      {schema && showExplorer && <SchemaExplorer schema={schema} selected={selected} onToggle={(p) => apply(toggleField(selected, p))} />}
    </div>
  );
}

function SchemaExplorer({ schema, selected, onToggle }: { schema: GqlSchema; selected: Set<string>; onToggle: (path: string) => void }) {
  const types = useMemo(() => typeMap(schema), [schema]);
  const [q, setQ] = useState("");
  const roots = [
    { kind: "query", name: schema.queryType?.name },
    { kind: "mutation", name: schema.mutationType?.name },
    { kind: "subscription", name: schema.subscriptionType?.name },
  ].filter((r) => r.name) as { kind: string; name: string }[];
  return (
    <div className="flex max-h-[520px] min-h-0 flex-col overflow-hidden rounded-md border border-line bg-paper">
      <div className="border-b border-line p-1.5">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search fields" aria-label="Search schema" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5 text-[12.5px]" data-lenis-prevent>
        <p className="px-1 pb-1.5 text-[12px] text-ink-3">Tick fields to build the query.</p>
        {roots.map((r) => (
          <TypeNode key={r.kind} types={types} type={types.get(r.name)!} path={r.kind} label={r.kind} selected={selected} onToggle={onToggle} depth={0} filter={q.toLowerCase()} open />
        ))}
      </div>
    </div>
  );
}

function TypeNode({ types, type, path, label, selected, onToggle, depth, filter, open: startOpen }: { types: Map<string, GqlType>; type: GqlType; path: string; label: string; selected: Set<string>; onToggle: (p: string) => void; depth: number; filter: string; open?: boolean }) {
  const [open, setOpen] = useState(!!startOpen);
  if (!type?.fields) return null;
  const fields = type.fields.filter((f) => !filter || depth > 0 || f.name.toLowerCase().includes(filter));
  return (
    <div>
      {depth === 0 && (
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-1 rounded px-1 py-0.5 font-mono font-semibold uppercase tracking-[0.06em] text-ink-2 hover:bg-paper-2">
          <ChevronRight aria-hidden className={cn("size-3.5 transition-transform", open && "rotate-90")} />
          {label}
        </button>
      )}
      {open && (
        <ul className={cn(depth === 0 ? "ml-2" : "ml-4 border-l border-line pl-1")}>
          {fields.map((f) => {
            const fp = `${path}/${f.name}`;
            const leaf = isLeaf(types, f.type);
            const on = selected.has(fp);
            return (
              <li key={f.name}>
                <div className="flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-paper-2" title={f.description ?? undefined}>
                  <Check2 checked={on} onChange={() => onToggle(fp)} label={`Select ${f.name}`} />
                  <span className={cn("font-mono", on ? "text-ink" : "text-ink-2", f.isDeprecated && "line-through")}>{f.name}</span>
                  {f.args.length > 0 && <span className="font-mono text-[12px] text-ink-3">({f.args.map((a) => `${a.name}: ${typeString(a.type)}`).join(", ")})</span>}
                  <span className="ml-auto truncate font-mono text-[12px] text-ink-3">{typeString(f.type)}</span>
                </div>
                {on && !leaf && depth < 6 && <TypeNode types={types} type={types.get(namedType(f.type))!} path={fp} label={f.name} selected={selected} onToggle={onToggle} depth={depth + 1} filter={filter} open />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
