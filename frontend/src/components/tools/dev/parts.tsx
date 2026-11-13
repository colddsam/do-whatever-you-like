"use client";

import { useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronRight, Copy, Download } from "lucide-react";
import { saveBlob } from "@/lib/files";
import { formatBytes } from "@/lib/media";
import { cn } from "@/lib/utils";

/*
 * Building blocks of the developer utilities: an input editor and an output panel that read like a
 * code editor (a file tab on top, a mono status bar under), and a copy button that answers with a
 * spring. Everything is in the Worksheet tokens.
 */

/** Copies text, then shows a check for a moment (announced to screen readers). */
export function CopyButton({ text, label = "Copy", className, onCopied }: { text: string; label?: string; className?: string; onCopied?: () => void }) {
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return (
    <button
      type="button"
      disabled={!text}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          return;
        }
        setDone(true);
        onCopied?.();
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setDone(false), 1400);
      }}
      className={cn(
        "relative inline-flex h-8 items-center gap-1.5 overflow-hidden rounded-[8px] border px-2.5 text-[13px] transition-colors duration-150 disabled:pointer-events-none disabled:opacity-40",
        done ? "border-success/40 bg-success/10 text-success" : "border-line bg-surface text-ink-2 hover:border-ink-3 hover:text-ink",
        className,
      )}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={done ? "done" : "copy"}
          initial={{ scale: 0.4, opacity: 0, rotate: done ? -30 : 0 }}
          animate={{ scale: 1, opacity: 1, rotate: 0 }}
          exit={{ scale: 0.4, opacity: 0 }}
          transition={{ type: "spring", stiffness: 520, damping: 26 }}
          className="inline-flex"
        >
          {done ? <Check aria-hidden className="size-3.5" /> : <Copy aria-hidden className="size-3.5" />}
        </motion.span>
      </AnimatePresence>
      {label && <span className="hidden @[17rem]:inline">{done ? "Copied" : label}</span>}
      <span className="sr-only" aria-live="polite">
        {done ? "Copied to the clipboard" : ""}
      </span>
    </button>
  );
}

/** A multi-line input with a tab-style header and a mono status line. */
export function Editor({
  value,
  onChange,
  name,
  placeholder,
  rows = 10,
  invalid,
  actions,
  spellCheck = false,
}: {
  value: string;
  onChange: (v: string) => void;
  name: string;
  placeholder?: string;
  rows?: number;
  invalid?: boolean;
  actions?: React.ReactNode;
  spellCheck?: boolean;
}) {
  const id = useId();
  const lines = value ? value.split("\n").length : 0;
  return (
    <div className={cn("overflow-hidden rounded-md border bg-surface transition-colors focus-within:border-ink", invalid ? "border-danger/60" : "border-line")}>
      <div className="flex items-center justify-between gap-2 border-b border-line bg-paper px-1.5">
        <label htmlFor={id} className="-mb-px inline-flex h-9 items-center border-b border-ink px-2 font-mono text-[12px] text-ink">
          {name}
        </label>
        <div className="flex items-center gap-1">
          {actions}
          {value && (
            <button type="button" onClick={() => onChange("")} className="inline-flex h-8 items-center rounded-[8px] px-2 text-[13px] text-ink-3 hover:bg-paper-2 hover:text-ink">
              Clear
            </button>
          )}
        </div>
      </div>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        spellCheck={spellCheck}
        autoCapitalize="off"
        autoComplete="off"
        aria-invalid={invalid}
        className="block w-full resize-y bg-transparent px-3 py-2.5 font-mono text-[13px] leading-relaxed text-ink outline-none placeholder:text-ink-3"
      />
      <p className="flex justify-between border-t border-line bg-paper px-3 py-1 font-mono text-[11px] text-ink-3">
        <span>{lines ? `${lines} line${lines === 1 ? "" : "s"}` : "empty"}</span>
        <span>{value.length.toLocaleString("en")} chars</span>
      </p>
    </div>
  );
}

/** The result, read-only, with copy and (optionally) download. */
export function Output({
  value,
  name,
  lang,
  error,
  download,
  children,
  wrap = true,
}: {
  value: string;
  name: string;
  lang: string;
  error?: React.ReactNode;
  /** Offer the text as a file with this name. */
  download?: string;
  children?: React.ReactNode;
  wrap?: boolean;
}) {
  const lines = value ? value.split("\n").length : 0;
  const bytes = new TextEncoder().encode(value).length;
  return (
    <div className={cn("@container overflow-hidden rounded-md border bg-surface", error ? "border-danger/50" : "border-line")}>
      <div className="flex items-center justify-between gap-2 border-b border-line bg-paper px-1.5">
        <span className="-mb-px inline-flex h-9 items-center border-b border-ink px-2 font-mono text-[12px] text-ink">{name}</span>
        <div className="flex items-center gap-1">
          {download && value && !error && (
            <button
              type="button"
              onClick={() => saveBlob(new Blob([value], { type: "text/plain;charset=utf-8" }), download)}
              className="inline-flex h-8 items-center gap-1.5 rounded-[8px] px-2 text-[13px] text-ink-2 hover:bg-paper-2 hover:text-ink"
            >
              <Download aria-hidden className="size-3.5" />
              <span className="hidden sm:inline">Download</span>
            </button>
          )}
          <CopyButton text={error ? "" : value} />
        </div>
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={error ? "error" : "value"}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0, transition: { duration: 0.25, ease: [0.22, 1, 0.36, 1] } }}
          exit={{ opacity: 0, transition: { duration: 0.12 } }}
        >
          {error ? (
            <div role="alert" className="px-3 py-3 text-sm text-danger">
              {error}
            </div>
          ) : children ? (
            children
          ) : (
            <pre
              className={cn(
                "max-h-[420px] overflow-auto overscroll-contain px-3 py-2.5 font-mono text-[13px] leading-relaxed text-ink",
                wrap ? "whitespace-pre-wrap break-all" : "whitespace-pre",
              )}
              data-lenis-prevent
            >
              {value || <span className="text-ink-3">The result appears here as you type.</span>}
            </pre>
          )}
        </motion.div>
      </AnimatePresence>
      <p className="flex justify-between gap-3 whitespace-nowrap border-t border-line bg-paper px-3 py-1 font-mono text-[11px] text-ink-3">
        <span className="truncate">{lang}</span>
        <span className="shrink-0">{value && !error ? `${lines} line${lines === 1 ? "" : "s"} · ${formatBytes(bytes)}` : "—"}</span>
      </p>
    </div>
  );
}

/** A labelled value with its own copy button (hashes, conversions, IDs). */
export function ValueRow({ label, value, mono = true, highlight = false, note }: { label: string; value: string; mono?: boolean; highlight?: boolean; note?: React.ReactNode }) {
  return (
    <li className={cn("flex items-center gap-3 px-3 py-2 transition-colors duration-200", highlight && "bg-success/10")}>
      <span className="label-mono w-20 shrink-0 text-ink-3 @md:w-28">{label}</span>
      <span className={cn("min-w-0 flex-1 text-[13px] text-ink [overflow-wrap:anywhere]", mono && "font-mono")}>
        {value || <span className="text-ink-3">—</span>}
        {note && <span className="mt-0.5 block font-sans text-xs text-ink-3">{note}</span>}
      </span>
      <CopyButton text={value} label="" className="shrink-0 px-2" />
    </li>
  );
}

export function ValueList({ children }: { children: React.ReactNode }) {
  return <ul className="@container divide-y divide-line overflow-hidden rounded-md border border-line bg-surface">{children}</ul>;
}

/* ---------- JSON tree ---------- */

const TYPE_TONE: Record<string, string> = {
  string: "text-success",
  number: "text-accent",
  boolean: "text-warning",
  null: "text-ink-3",
};

/** A collapsible tree: counts on closed nodes, typed values, click a key to copy its path. */
export function JsonTree({ value, onPath }: { value: unknown; onPath: (path: string) => void }) {
  return (
    <div className="max-h-[420px] overflow-auto overscroll-contain px-2 py-2 font-mono text-[13px] leading-relaxed" data-lenis-prevent>
      <Node name={null} value={value} path="$" depth={0} onPath={onPath} />
    </div>
  );
}

function Node({ name, value, path, depth, onPath }: { name: string | null; value: unknown; path: string; depth: number; onPath: (p: string) => void }) {
  const [open, setOpen] = useState(depth < 2);
  const isArr = Array.isArray(value);
  const isObj = value !== null && typeof value === "object";
  const keyEl =
    name !== null ? (
      <button type="button" onClick={() => onPath(path)} title={`Copy ${path}`} className="rounded-[4px] px-0.5 text-ink hover:bg-paper-2">
        {isArr || /^\d+$/.test(name) ? name : `"${name}"`}
        <span className="text-ink-3">: </span>
      </button>
    ) : null;
  if (!isObj) {
    const type = value === null ? "null" : typeof value;
    return (
      <div className="flex min-w-0 gap-0.5 pl-5">
        {keyEl}
        <span className={cn("break-all", TYPE_TONE[type] ?? "text-ink")}>{type === "string" ? JSON.stringify(value) : String(value)}</span>
      </div>
    );
  }
  const entries = isArr ? (value as unknown[]).map((v, i) => [String(i), v] as const) : Object.entries(value as object);
  return (
    <div>
      <div className="flex items-center">
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label={open ? "Collapse" : "Expand"} className="inline-flex size-5 shrink-0 items-center justify-center text-ink-3 hover:text-ink">
          <ChevronRight aria-hidden className={cn("size-3.5 transition-transform duration-200", open && "rotate-90")} />
        </button>
        {keyEl}
        <span className="text-ink-2">{isArr ? "[" : "{"}</span>
        {!open && (
          <button type="button" onClick={() => setOpen(true)} className="mx-1 rounded-sm bg-paper-2 px-1.5 text-[11px] text-ink-3 hover:text-ink">
            {entries.length} {isArr ? (entries.length === 1 ? "item" : "items") : entries.length === 1 ? "key" : "keys"}
          </button>
        )}
        {!open && <span className="text-ink-2">{isArr ? "]" : "}"}</span>}
      </div>
      {open && (
        <div className="ml-2.5 border-l border-line pl-1">
          {entries.slice(0, 500).map(([k, v]) => (
            <Node key={k} name={k} value={v} path={isArr ? `${path}[${k}]` : /^[A-Za-z_$][\w$]*$/.test(k) ? `${path}.${k}` : `${path}[${JSON.stringify(k)}]`} depth={depth + 1} onPath={onPath} />
          ))}
          {entries.length > 500 && <p className="pl-5 text-[11px] text-ink-3">… {entries.length - 500} more (switch to Text to see them all)</p>}
        </div>
      )}
      {open && <span className="pl-5 text-ink-2">{isArr ? "]" : "}"}</span>}
    </div>
  );
}

/** A small file picker that reads bytes (hash, Base64). */
export function FilePick({ label, onFile, file }: { label: string; onFile: (f: File | null) => void; file: File | null }) {
  const id = useId();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label
        htmlFor={id}
        className="inline-flex h-9 cursor-pointer items-center rounded-[8px] border border-dashed border-ink-3/60 px-3 text-sm text-ink-2 transition-colors hover:border-ink hover:text-ink has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-accent/15"
      >
        <input id={id} type="file" className="sr-only" onChange={(e) => (onFile(e.target.files?.[0] ?? null), (e.target.value = ""))} />
        {label}
      </label>
      {file && (
        <span className="inline-flex min-w-0 items-center gap-2 text-sm text-ink">
          <span className="truncate">{file.name}</span>
          <span className="font-mono text-xs text-ink-3">{formatBytes(file.size)}</span>
          <button type="button" onClick={() => onFile(null)} className="text-xs text-ink-3 underline-offset-4 hover:text-ink hover:underline">
            Use text instead
          </button>
        </span>
      )}
    </div>
  );
}
