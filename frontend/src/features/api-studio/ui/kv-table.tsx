"use client";

import { useId, useRef, useState } from "react";
import { Eye, EyeOff, FileUp, Paperclip, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { KV } from "../types";
import { putFile } from "../lib/blobs";
import { fmtBytes, kv, parseBulk, toBulk } from "../lib/util";
import { Check2, IconBtn, Label, Textarea } from "./kit";
import { VarInput } from "./var-input";

export const COMMON_HEADERS = [
  "Accept", "Accept-Charset", "Accept-Encoding", "Accept-Language", "Authorization", "Cache-Control", "Connection", "Content-Disposition", "Content-Encoding", "Content-Language",
  "Content-Type", "Cookie", "Date", "DNT", "Expect", "Forwarded", "From", "If-Match", "If-Modified-Since", "If-None-Match", "If-Range", "If-Unmodified-Since", "Origin", "Pragma",
  "Prefer", "Range", "Referer", "TE", "Upgrade", "User-Agent", "Via", "X-Api-Key", "X-Correlation-Id", "X-CSRF-Token", "X-Forwarded-For", "X-Forwarded-Host", "X-Forwarded-Proto",
  "X-Request-Id", "X-Requested-With", "Idempotency-Key",
];
export const COMMON_TYPES = ["application/json", "application/xml", "application/x-www-form-urlencoded", "multipart/form-data", "text/plain", "text/html", "text/csv", "application/octet-stream", "application/graphql", "application/ld+json", "application/vnd.api+json"];

type Kind = "params" | "headers" | "form" | "urlencoded" | "pathvars";

export function KVTable({
  rows,
  onChange,
  kind,
  auto,
  className,
}: {
  rows: KV[];
  onChange: (rows: KV[]) => void;
  kind: Kind;
  /** Headers the tool adds by itself (shown read-only when "hidden" headers are revealed). */
  auto?: { key: string; value: string; why: string }[];
  className?: string;
}) {
  const [bulk, setBulk] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [showDesc, setShowDesc] = useState(rows.some((r) => r.description));
  const [showAuto, setShowAuto] = useState(false);
  const listId = useId();
  const fixedKeys = kind === "pathvars";
  const sep = kind === "params" || kind === "urlencoded" ? "=" : ":";

  const set = (i: number, patch: Partial<KV>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  // Typing into the empty last row makes it a real row and moves the caret into it, so the next keystroke continues there.
  const [focus, setFocus] = useState<{ id: string; field: "key" | "value" | "description" } | null>(null);
  const add = (patch: Partial<KV>, field: "key" | "value" | "description") => {
    const row = kv(patch.key ?? "", patch.value ?? "", patch);
    onChange([...rows, row]);
    setFocus({ id: row.id, field });
  };
  const remove = (i: number) => onChange(rows.filter((_, j) => j !== i));
  const allOn = rows.length > 0 && rows.every((r) => r.enabled);

  return (
    <div className={cn("min-w-0", className)}>
      <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        {kind === "headers" && auto && (
          <button type="button" onClick={() => setShowAuto((s) => !s)} className="inline-flex items-center gap-1 text-[12px] text-ink-3 hover:text-ink">
            {showAuto ? <EyeOff aria-hidden className="size-3.5" /> : <Eye aria-hidden className="size-3.5" />}
            {showAuto ? "Hide" : `${auto.length} hidden`} auto-generated headers
          </button>
        )}
        <span className="ml-auto flex items-center gap-3">
          {!fixedKeys && !bulk && (
            <button type="button" onClick={() => setShowDesc((s) => !s)} className="text-[12px] text-ink-3 hover:text-ink">
              {showDesc ? "Hide" : "Show"} descriptions
            </button>
          )}
          {!fixedKeys && (
            <button
              type="button"
              onClick={() => {
                if (bulk) onChange(parseBulk(bulkText, sep));
                else setBulkText(toBulk(rows, sep));
                setBulk(!bulk);
              }}
              className="text-[12px] font-medium text-ink-2 hover:text-ink"
            >
              {bulk ? "Key-Value Edit" : "Bulk Edit"}
            </button>
          )}
        </span>
      </div>

      {bulk ? (
        <div>
          <Textarea
            mono
            rows={Math.max(6, bulkText.split("\n").length + 1)}
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            onBlur={() => onChange(parseBulk(bulkText, sep))}
            aria-label="Bulk edit"
            placeholder={sep === ":" ? "Rows are separated by new lines\nKeys and values are separated by :\nPrepend // to any row you want to add but keep disabled" : "Rows are separated by new lines\nKeys and values are separated by =\nPrepend // to disable a row"}
          />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-line" data-lenis-prevent>
          <table className="w-full min-w-[420px] border-collapse text-[13px]">
            <thead>
              <tr className="bg-paper text-left">
                <th className="w-8 border-b border-line px-2 py-1.5">
                  {!fixedKeys && rows.length > 0 && <Check2 checked={allOn} onChange={(v) => onChange(rows.map((r) => ({ ...r, enabled: v })))} label="Toggle all" />}
                </th>
                <th className="border-b border-l border-line px-2 py-1.5">
                  <Label>Key</Label>
                </th>
                <th className="border-b border-l border-line px-2 py-1.5">
                  <Label>Value</Label>
                </th>
                {showDesc && (
                  <th className="hidden border-b border-l border-line px-2 py-1.5 sm:table-cell">
                    <Label>Description</Label>
                  </th>
                )}
                <th className="w-9 border-b border-line" />
              </tr>
            </thead>
            <tbody>
              {showAuto &&
                auto?.map((a) => (
                  <tr key={a.key} className="bg-paper/60 text-ink-3" title={a.why}>
                    <td className="border-b border-line px-2 py-1">
                      <Check2 checked onChange={() => undefined} label="Added automatically" className="opacity-50" />
                    </td>
                    <td className="border-b border-l border-line px-2.5 py-1 font-mono text-[12px]">{a.key}</td>
                    <td className="border-b border-l border-line px-2.5 py-1 font-mono text-[12px]">{a.value}</td>
                    {showDesc && <td className="hidden border-b border-l border-line px-2.5 py-1 text-[12px] sm:table-cell">{a.why}</td>}
                    <td className="border-b border-line" />
                  </tr>
                ))}
              {rows.map((r, i) => (
                <Row
                  key={r.id}
                  r={r}
                  kind={kind}
                  showDesc={showDesc}
                  listId={listId}
                  onPatch={(p) => set(i, p)}
                  onRemove={fixedKeys ? undefined : () => remove(i)}
                  focusField={focus?.id === r.id ? focus.field : undefined}
                />
              ))}
              {!fixedKeys && (
                <tr>
                  <td className="px-2 py-1" />
                  <td className="border-l border-line p-1">
                    <VarInput ariaLabel="New key" list={kind === "headers" ? listId : undefined} value="" placeholder="Key" onChange={(v) => add({ key: v }, "key")} className="border-transparent bg-transparent focus-within:bg-surface" />
                  </td>
                  <td className="border-l border-line p-1">
                    <VarInput ariaLabel="New value" value="" placeholder="Value" onChange={(v) => add({ value: v }, "value")} className="border-transparent bg-transparent focus-within:bg-surface" />
                  </td>
                  {showDesc && (
                    <td className="hidden border-l border-line p-1 sm:table-cell">
                      <input aria-label="New description" placeholder="Description" onChange={(e) => add({ description: e.target.value }, "description")} className="h-[30px] w-full bg-transparent px-2.5 text-[13px] outline-none placeholder:text-ink-3" value="" />
                    </td>
                  )}
                  <td />
                </tr>
              )}
            </tbody>
          </table>
          {kind === "headers" && (
            <datalist id={listId}>
              {COMMON_HEADERS.map((h) => (
                <option key={h} value={h} />
              ))}
            </datalist>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ r, kind, showDesc, listId, onPatch, onRemove, focusField }: { focusField?: "key" | "value" | "description"; r: KV; kind: Kind; showDesc: boolean; listId: string; onPatch: (p: Partial<KV>) => void; onRemove?: () => void }) {
  const file = useRef<HTMLInputElement>(null);
  const isFile = kind === "form" && r.type === "file";
  return (
    <tr className={cn("group", !r.enabled && "text-ink-3")}>
      <td className="border-b border-line px-2 py-1 align-middle">{kind !== "pathvars" && <Check2 checked={r.enabled} onChange={(v) => onPatch({ enabled: v })} label={r.enabled ? "Disable row" : "Enable row"} />}</td>
      <td className="border-b border-l border-line p-1 align-middle">
        <div className="flex items-center gap-1">
          {kind === "pathvars" ? (
            <span className="px-2 font-mono text-[12.5px] text-ink">{r.key}</span>
          ) : (
            <VarInput ariaLabel="Key" autoFocus={focusField === "key"} list={kind === "headers" ? listId : undefined} value={r.key} onChange={(v) => onPatch({ key: v })} placeholder="Key" className={cn("flex-1 border-transparent bg-transparent focus-within:bg-surface", !r.enabled && "opacity-60")} />
          )}
          {kind === "form" && (
            <select
              aria-label="Field type"
              value={r.type ?? "text"}
              onChange={(e) => onPatch({ type: e.target.value as "text" | "file", value: "", file: undefined })}
              className="h-7 shrink-0 rounded-[6px] border border-line bg-paper px-1 text-[12px] text-ink-2 outline-none"
            >
              <option value="text">Text</option>
              <option value="file">File</option>
            </select>
          )}
        </div>
      </td>
      <td className="border-b border-l border-line p-1 align-middle">
        {isFile ? (
          <div className="flex items-center gap-1.5 px-1">
            <input
              ref={file}
              type="file"
              className="sr-only"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) onPatch({ file: await putFile(f) });
                e.target.value = "";
              }}
            />
            {r.file ? (
              <span className="inline-flex min-w-0 items-center gap-1 rounded-[6px] border border-line bg-paper px-2 py-0.5 text-[12px]">
                <Paperclip aria-hidden className="size-3 shrink-0 text-ink-3" />
                <span className="truncate">{r.file.name}</span>
                <span className="shrink-0 text-ink-3">{fmtBytes(r.file.size)}</span>
                <button type="button" aria-label="Remove file" onClick={() => onPatch({ file: undefined })} className="text-ink-3 hover:text-ink">
                  <X aria-hidden className="size-3" />
                </button>
              </span>
            ) : (
              <button type="button" onClick={() => file.current?.click()} className="inline-flex h-7 items-center gap-1 rounded-[6px] border border-dashed border-ink-3/60 px-2 text-[12px] text-ink-2 hover:border-ink hover:text-ink">
                <FileUp aria-hidden className="size-3.5" /> Select file
              </button>
            )}
            {r.description?.startsWith("File:") && !r.file && <span className="truncate text-[12px] text-ink-3">{r.description}</span>}
          </div>
        ) : (
          <VarInput ariaLabel="Value" autoFocus={focusField === "value"} value={r.value} onChange={(v) => onPatch({ value: v })} placeholder="Value" className={cn("border-transparent bg-transparent focus-within:bg-surface", !r.enabled && "opacity-60")} />
        )}
      </td>
      {showDesc && (
        <td className="hidden border-b border-l border-line p-1 align-middle sm:table-cell">
          <input aria-label="Description" autoFocus={focusField === "description"} onFocus={(e) => e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length)} value={r.description ?? ""} onChange={(e) => onPatch({ description: e.target.value })} placeholder="Description" className="h-[30px] w-full rounded-md bg-transparent px-2.5 text-[13px] text-ink-2 outline-none placeholder:text-ink-3 focus:bg-surface" />
        </td>
      )}
      <td className="border-b border-line px-0.5 align-middle">
        {onRemove && <IconBtn icon={Trash2} label="Delete row" size="xs" onClick={onRemove} className="opacity-60 group-hover:opacity-100 max-sm:opacity-100" />}
      </td>
    </tr>
  );
}
