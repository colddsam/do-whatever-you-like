"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Copy, Info, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ConsoleEntry, Tab } from "../types";
import { generate, LANGUAGES, snipFrom } from "../lib/codegen";
import { fmtBytes, fmtMs, relTime } from "../lib/util";
import { locate, scopesFor, useApi } from "../store";
import { CodeEditor } from "./code-editor";
import { copyText, IconBtn, Input, Label, MethodTag, Segmented, Select, Toggle } from "./kit";

/* ------------------------------------------------------------------ console */

export function ConsolePanel({ onClose }: { onClose: () => void }) {
  const entries = useApi((s) => s.console);
  const clear = useApi((s) => s.clearConsole);
  const [level, setLevel] = useState<"all" | "net" | "log" | "warn" | "error">("all");
  const [q, setQ] = useState("");
  const [timestamps, setTimestamps] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const list = useMemo(
    () =>
      entries.filter((e) => {
        if (level === "net" && e.kind !== "net") return false;
        if (level === "log" && !(e.kind === "log" && (e.level === "log" || e.level === "info" || e.level === "debug"))) return false;
        if (level === "warn" && !(e.kind === "log" && e.level === "warn")) return false;
        if (level === "error" && !((e.kind === "log" && e.level === "error") || (e.kind === "net" && (e.error || (e.status ?? 0) >= 400)))) return false;
        if (q && !(e.kind === "net" ? `${e.method} ${e.url}` : e.text).toLowerCase().includes(q.toLowerCase())) return false;
        return true;
      }),
    [entries, level, q],
  );
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [list.length]);
  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-2 py-1">
        <span className="text-[13px] font-semibold">Console</span>
        <Segmented label="Show" value={level} onChange={setLevel} options={[{ value: "all", label: "All" }, { value: "net", label: "Network" }, { value: "log", label: "Logs" }, { value: "warn", label: "Warnings" }, { value: "error", label: "Errors" }]} />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search console" className="h-7 w-36" />
        <label className="hidden items-center gap-1.5 text-[12px] text-ink-2 sm:inline-flex">
          <input type="checkbox" checked={timestamps} onChange={(e) => setTimestamps(e.target.checked)} className="accent-[var(--color-ink)]" /> Timestamps
        </label>
        <span className="ml-auto flex items-center">
          <IconBtn icon={Trash2} label="Clear console" onClick={clear} />
          <IconBtn icon={X} label="Close console" onClick={onClose} />
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto font-mono text-[12px]" data-lenis-prevent>
        {!list.length && <p className="p-4 text-center font-sans text-[13px] text-ink-3">Requests, responses and console.log() output from scripts show here.</p>}
        {list.map((e) => <ConsoleRow key={e.id} e={e} timestamps={timestamps} />)}
        <div ref={end} />
      </div>
    </div>
  );
}

function ConsoleRow({ e, timestamps }: { e: ConsoleEntry; timestamps: boolean }) {
  const [open, setOpen] = useState(false);
  const time = timestamps && <span className="shrink-0 text-ink-3">{new Date(e.at).toLocaleTimeString()}</span>;
  if (e.kind === "log")
    return (
      <div className={cn("flex gap-2 border-b border-line px-2.5 py-1", e.level === "error" ? "bg-danger/5 text-danger" : e.level === "warn" ? "bg-warning/5 text-warning" : "text-ink-2")}>
        {time}
        <span className="min-w-0 flex-1 whitespace-pre-wrap break-all">{e.text}</span>
        {e.source && <span className="hidden shrink-0 text-ink-3 sm:inline">{e.source}</span>}
      </div>
    );
  return (
    <div className="border-b border-line">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-2.5 py-1 text-left hover:bg-paper">
        <ChevronRight aria-hidden className={cn("size-3 shrink-0 text-ink-3 transition-transform", open && "rotate-90")} />
        {time}
        <MethodTag method={e.method} className="w-auto text-left" />
        <span className="min-w-0 flex-1 truncate">{e.url}</span>
        {e.error ? <span className="shrink-0 text-danger">Error</span> : <span className={cn("shrink-0", (e.status ?? 0) < 400 ? "text-success" : "text-danger")}>{e.status}</span>}
        <span className="shrink-0 text-ink-3">{fmtMs(e.ms)}</span>
        <span className="hidden shrink-0 text-ink-3 sm:inline">{fmtBytes(e.size)}</span>
      </button>
      {open && (
        <div className="space-y-2 bg-paper/50 px-7 pb-2">
          {e.error && <p className="whitespace-pre-wrap font-sans text-[12.5px] text-danger">{e.error}</p>}
          <details open>
            <summary className="cursor-pointer text-ink-3">Request headers</summary>
            <pre className="whitespace-pre-wrap break-all">{e.request.headers.map(([k, v]) => `${k}: ${v}`).join("\n")}</pre>
          </details>
          {e.request.bodyPreview && (
            <details>
              <summary className="cursor-pointer text-ink-3">Request body</summary>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all">{e.request.bodyPreview}</pre>
            </details>
          )}
          {e.response && (
            <>
              <details>
                <summary className="cursor-pointer text-ink-3">Response headers</summary>
                <pre className="whitespace-pre-wrap break-all">{e.response.headers.map(([k, v]) => `${k}: ${v}`).join("\n")}</pre>
              </details>
              <details>
                <summary className="cursor-pointer text-ink-3">Response body</summary>
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all">{e.response.body.slice(0, 50_000) || "(empty)"}</pre>
              </details>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ code snippet & info */

export function RightPanel({ tab, which, onClose }: { tab: Tab | undefined; which: "code" | "info"; onClose: () => void }) {
  const ws = useApi((s) => s.ws);
  const [lang, setLang] = useState(() => {
    try {
      return localStorage.getItem("api-studio:lang") ?? "curl";
    } catch {
      return "curl";
    }
  });
  const [keepVars, setKeepVars] = useState(false);
  const req = tab?.draft;
  const { collection, parents } = locate(ws, tab?.ref?.collectionId, tab?.ref?.itemId);
  const code = useMemo(() => (req && (req.protocol === "http" || req.protocol === "graphql") ? generate(lang, snipFrom(req, scopesFor(ws, tab?.ref?.collectionId), keepVars, parents, collection)) : ""), [req, lang, keepVars, ws, tab?.ref?.collectionId, parents, collection]);
  const cm = LANGUAGES.find((l) => l.id === lang)?.cm ?? "text";
  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-2 py-1.5">
        <span className="flex-1 text-[13px] font-semibold">{which === "code" ? "Code snippet" : "Request info"}</span>
        <IconBtn icon={X} label="Close panel" onClick={onClose} />
      </div>
      {which === "code" ? (
        !req || (req.protocol !== "http" && req.protocol !== "graphql") ? (
          <p className="p-4 text-[13px] text-ink-3">Open an HTTP or GraphQL request to see it as code.</p>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
            <div className="flex items-center gap-1.5">
              <Select
                label="Language"
                value={lang}
                onChange={(v) => {
                  setLang(v);
                  try {
                    localStorage.setItem("api-studio:lang", v);
                  } catch {
                    /* private mode */
                  }
                }}
                options={LANGUAGES.map((l) => ({ value: l.id, label: l.label }))}
                className="min-w-0 flex-1"
              />
              <IconBtn icon={Copy} label="Copy snippet" onClick={async () => (await copyText(code)) && useApi.getState().notify("Copied to clipboard", "success")} />
            </div>
            <Toggle checked={keepVars} onChange={setKeepVars} label="Keep {{variables}}" />
            <CodeEditor key={lang} value={code} readOnly wrap language={cm === "Plain text" ? "text" : cm} className="min-h-0 flex-1 rounded-md border border-line" ariaLabel="Code snippet" />
          </div>
        )
      ) : (
        <div className="space-y-3 overflow-y-auto p-3 text-[13px]" data-lenis-prevent>
          {req ? (
            <dl className="space-y-2">
              <div><Label>Name</Label><dd>{req.name}</dd></div>
              <div><Label>Location</Label><dd>{[collection?.name, ...parents.map((p) => p.name)].filter(Boolean).join(" / ") || "Not saved"}</dd></div>
              <div><Label>ID</Label><dd className="font-mono text-[12px]">{req.id}</dd></div>
              {collection && <div><Label>Collection updated</Label><dd>{relTime(collection.updatedAt)}</dd></div>}
              <div><Label>Examples</Label><dd>{req.examples.length}</dd></div>
            </dl>
          ) : (
            <p className="flex gap-2 text-ink-3"><Info aria-hidden className="size-4" /> Nothing selected.</p>
          )}
        </div>
      )}
    </div>
  );
}
