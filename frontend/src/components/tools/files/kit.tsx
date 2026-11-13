"use client";

import { useState } from "react";
import { Reorder, useDragControls } from "motion/react";
import { ArrowDown, ArrowUp, GripVertical, X } from "lucide-react";
import { formatBytes } from "@/lib/media";
import { cn } from "@/lib/utils";
import { FileDrop } from "../file-drop";
import { IconButton, plural, Sheet } from "../pdf/parts";

/*
 * Shared by the any-file tools (compress, merge, split): a list of files that can be reordered
 * by dragging or with the arrow buttons (announced to screen readers), with a compact drop zone
 * underneath for adding more. Same look as Merge PDF's list.
 */

export type Item = { id: string; file: File };

let uid = 0;
export const toItems = (files: File[]): Item[] => files.map((file) => ({ id: `i${++uid}`, file }));

export function FileStack({
  items,
  locked,
  accept,
  error,
  title,
  addTitle,
  addFormats,
  canAdd,
  sortable = true,
  meta,
  onChange,
  onAdd,
}: {
  items: Item[];
  locked: boolean;
  accept: string;
  error: string | null;
  /** The mono line over the list: "Merge order", "To compress". */
  title: string;
  addTitle: string;
  addFormats: string;
  canAdd: boolean;
  sortable?: boolean;
  /** A short line under each name (its kind, what will happen to it). */
  meta?: (item: Item) => React.ReactNode;
  onChange: (items: Item[]) => void;
  onAdd: (files: File[]) => void;
}) {
  const [announce, setAnnounce] = useState("");
  const total = items.reduce((n, i) => n + i.file.size, 0);
  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length) return;
    const next = [...items];
    const [it] = next.splice(from, 1);
    next.splice(to, 0, it);
    onChange(next);
    setAnnounce(`${it.file.name} moved to position ${to + 1} of ${items.length}.`);
  };

  return (
    <div>
      <div className="flex items-baseline justify-between gap-4 px-1 pb-2">
        <p className="label-mono truncate text-ink-3">
          {title} · {plural(items.length, "file")} · {formatBytes(total)}
        </p>
        {!locked && (
          <button type="button" onClick={() => onChange([])} className="shrink-0 text-xs text-ink-3 underline-offset-4 hover:text-ink hover:underline">
            Clear all
          </button>
        )}
      </div>
      <Reorder.Group as="ol" axis="y" values={items} onReorder={onChange} className="space-y-1.5">
        {items.map((item, i) => (
          <Row
            key={item.id}
            item={item}
            index={i}
            count={items.length}
            locked={locked}
            sortable={sortable}
            meta={meta?.(item)}
            onMove={move}
            onRemove={() => onChange(items.filter((x) => x.id !== item.id))}
          />
        ))}
      </Reorder.Group>
      <p className="sr-only" aria-live="assertive">
        {announce}
      </p>
      {!locked && canAdd && (
        <div className="mt-2">
          <FileDrop compact multiple accept={accept} title={addTitle} formats={addFormats} error={error} onFiles={onAdd} />
        </div>
      )}
      {(locked || !canAdd) && error && (
        <p role="alert" className="px-1 pt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

function Row({
  item,
  index,
  count,
  locked,
  sortable,
  meta,
  onMove,
  onRemove,
}: {
  item: Item;
  index: number;
  count: number;
  locked: boolean;
  sortable: boolean;
  meta: React.ReactNode;
  onMove: (from: number, to: number) => void;
  onRemove: () => void;
}) {
  const controls = useDragControls();
  return (
    <Reorder.Item
      value={item}
      dragListener={false}
      dragControls={controls}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      whileDrag={{ scale: 1.01, boxShadow: "var(--shadow-card)" }}
      className="relative flex items-center gap-2 rounded-md border border-line bg-paper p-1.5 pr-1 sm:gap-3 sm:p-2"
    >
      {!locked && sortable && (
        <span
          onPointerDown={(e) => controls.start(e)}
          aria-hidden
          className="hidden h-10 w-5 cursor-grab touch-none items-center justify-center text-ink-3 hover:text-ink active:cursor-grabbing sm:flex"
        >
          <GripVertical className="size-4" />
        </span>
      )}
      <Sheet index={index + 1} label={(item.file.name.split(".").pop() ?? "").toUpperCase().slice(0, 4)} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-medium text-ink" title={item.file.name}>
          {item.file.name}
        </p>
        <p className="mt-0.5 truncate text-sm text-ink-2">
          <span className="font-mono text-xs">{formatBytes(item.file.size)}</span>
          {meta ? <span className="text-ink-3"> · {meta}</span> : null}
        </p>
      </div>
      {!locked && (
        <div className="flex shrink-0 items-center">
          {sortable && (
            <>
              <IconButton label={`Move ${item.file.name} up`} disabled={index === 0} onClick={() => onMove(index, index - 1)}>
                <ArrowUp aria-hidden className="size-4" />
              </IconButton>
              <IconButton label={`Move ${item.file.name} down`} disabled={index === count - 1} onClick={() => onMove(index, index + 1)}>
                <ArrowDown aria-hidden className="size-4" />
              </IconButton>
            </>
          )}
          <IconButton label={`Remove ${item.file.name}`} onClick={onRemove}>
            <X aria-hidden className="size-4" />
          </IconButton>
        </div>
      )}
    </Reorder.Item>
  );
}

/** A number input in the Worksheet style, with a unit after it ("slides", "rows", "minutes"). */
export function CountField({
  value,
  onChange,
  min = 1,
  max,
  unit,
  label,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  unit: string;
  label: string;
  disabled?: boolean;
}) {
  return (
    <label className="inline-flex items-center gap-2.5">
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={Number.isFinite(value) ? value : ""}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => onChange(Math.max(min, Math.floor(Number(e.target.value) || min)))}
        className="h-10 w-24 rounded-md border border-line bg-surface px-3 font-mono text-[14px] text-ink outline-none transition-[border-color,box-shadow] focus:border-ink focus:ring-4 focus:ring-accent/15 disabled:opacity-50"
      />
      <span className="text-sm text-ink-2">{unit}</span>
    </label>
  );
}

/** A one-line text input in the Worksheet style (ranges, times). */
export function LineField({
  value,
  onChange,
  placeholder,
  label,
  error,
  hint,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  label: string;
  error?: string | null;
  hint?: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <div>
      <input
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        aria-invalid={Boolean(error)}
        autoComplete="off"
        spellCheck={false}
        className={cn(
          "h-11 w-full rounded-md border bg-surface px-3.5 font-mono text-[14px] text-ink outline-none transition-[border-color,box-shadow] placeholder:text-ink-3 focus:border-ink focus:ring-4 focus:ring-accent/15",
          error ? "border-danger/60" : "border-line",
        )}
      />
      {(error || hint) && <p className={cn("mt-1.5 text-xs", error ? "text-danger" : "text-ink-3")}>{error ?? hint}</p>}
    </div>
  );
}
