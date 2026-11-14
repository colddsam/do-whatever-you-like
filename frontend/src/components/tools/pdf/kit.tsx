"use client";

import { useId, useState } from "react";
import { AlertTriangle, Eye, EyeOff, Info } from "lucide-react";
import { outOfBounds, parseRanges } from "@/lib/pdf";
import { cn } from "@/lib/utils";
import { Chip } from "./parts";

/*
 * Option controls for the single-purpose PDF tools. They follow the QR tool's "Look" rows:
 * hairline-separated rows, a mono label over the controls, ink for whatever is selected.
 */

/** One option: mono label (and an optional hint) over its controls. Rows are hairline-separated. */
export function Row({
  label,
  hint,
  htmlFor,
  children,
  className,
}: {
  label: string;
  hint?: React.ReactNode;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("border-b border-line py-3.5 first:pt-0 last:border-b-0 last:pb-0", className)}>
      <div className="flex items-baseline justify-between gap-3">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="label-mono text-ink-3">
            {label}
          </label>
        ) : (
          <p className="label-mono text-ink-3">{label}</p>
        )}
        {hint && <p className="text-right text-xs text-ink-3">{hint}</p>}
      </div>
      <div className="mt-2.5">{children}</div>
    </div>
  );
}

/** The dashed panel the options sit in (the same one the toolkit uses). */
export function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("rounded-md border border-dashed border-line px-3 py-3.5 sm:px-4 sm:py-4", className)}>{children}</div>;
}

export type ChipOption<T extends string | number> = { value: T; label: React.ReactNode; title?: string; disabled?: boolean };

export function Chips<T extends string | number>({
  value,
  options,
  onChange,
  disabled,
  label,
}: {
  value: T;
  options: ChipOption<T>[];
  onChange: (v: T) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <span key={String(o.value)} title={o.title} className="inline-flex">
          <Chip selected={o.value === value} disabled={disabled || o.disabled} onClick={() => onChange(o.value)}>
            {o.label}
          </Chip>
        </span>
      ))}
    </div>
  );
}

/** A switch: ink track when on. The whole row is the label, so the text toggles it too. */
export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: React.ReactNode;
  description?: React.ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className={cn("flex cursor-pointer items-start gap-3", disabled && "cursor-not-allowed opacity-50")}>
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input
          id={id}
          type="checkbox"
          role="switch"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="peer sr-only"
        />
        <span
          aria-hidden
          className="h-5 w-9 rounded-full border border-line bg-paper-2 transition-colors duration-150 peer-checked:border-ink peer-checked:bg-ink peer-focus-visible:ring-4 peer-focus-visible:ring-accent/25"
        />
        <span
          aria-hidden
          className="absolute left-0.5 top-0.5 size-4 rounded-full bg-surface shadow-sm transition-transform duration-150 peer-checked:translate-x-4"
        />
      </span>
      <span className="min-w-0">
        <span className="block text-sm text-ink">{label}</span>
        {description && <span className="mt-0.5 block text-xs leading-relaxed text-ink-3">{description}</span>}
      </span>
    </label>
  );
}

export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
  label,
  disabled,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  label: string;
  disabled?: boolean;
}) {
  const id = useId();
  const shown = format ? format(value) : String(value);
  return (
    <div className="flex items-center gap-4">
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
        aria-valuetext={shown}
        className="h-9 min-w-0 flex-1 cursor-pointer accent-ink disabled:cursor-not-allowed"
      />
      <output htmlFor={id} className="min-w-14 shrink-0 whitespace-nowrap text-right font-mono text-sm tabular-nums text-ink">
        {shown}
      </output>
    </div>
  );
}

/** Colour swatches + the native picker. These are the user's colours (document content), not site tokens. */
export function Swatches({
  value,
  colors,
  onChange,
  disabled,
}: {
  value: string;
  colors: { value: string; name: string }[];
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {colors.map((c) => (
        <button
          key={c.value}
          type="button"
          title={c.name}
          aria-label={c.name}
          aria-pressed={value.toLowerCase() === c.value.toLowerCase()}
          disabled={disabled}
          onClick={() => onChange(c.value)}
          className={cn(
            "size-9 rounded-sm border p-1 transition-colors",
            value.toLowerCase() === c.value.toLowerCase() ? "border-ink" : "border-line hover:border-ink-3",
          )}
        >
          <span className="block size-full rounded-[3px]" style={{ background: c.value }} />
        </button>
      ))}
      <label
        htmlFor={id}
        title="Any colour"
        className="relative inline-flex h-9 cursor-pointer items-center gap-2 rounded-sm border border-line px-2 text-xs text-ink-2 hover:border-ink-3"
      >
        <span className="size-5 rounded-[3px] border border-line" style={{ background: value }} />
        <span className="font-mono uppercase">{value}</span>
        <input
          id={id}
          type="color"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 cursor-pointer opacity-0"
        />
      </label>
    </div>
  );
}

const CELLS6 = ["tl", "tc", "tr", "bl", "bc", "br"] as const;
const CELLS9 = ["tl", "tc", "tr", "ml", "mc", "mr", "bl", "bc", "br"] as const;
const NAMES: Record<string, string> = {
  tl: "Top left",
  tc: "Top centre",
  tr: "Top right",
  ml: "Middle left",
  mc: "Centre",
  mr: "Middle right",
  bl: "Bottom left",
  bc: "Bottom centre",
  br: "Bottom right",
};

/**
 * Where on the page: a small sheet with a dot per position. Six (header/footer) or nine cells.
 * Arrow keys move between cells, like the mode switches.
 */
export function PositionGrid({
  value,
  onChange,
  cells = 9,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  cells?: 6 | 9;
  disabled?: boolean;
}) {
  const list = cells === 6 ? CELLS6 : CELLS9;
  const rows = cells === 6 ? 2 : 3;
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const d = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 3, ArrowUp: -3 }[e.key];
    if (!d) return;
    e.preventDefault();
    const n = i + d;
    if (n >= 0 && n < list.length) onChange(list[n]);
  };
  return (
    <div
      role="radiogroup"
      aria-label="Position on the page"
      className={cn(
        "grid h-[104px] w-[80px] grid-cols-3 rounded-[4px] border border-line bg-surface p-1.5",
        rows === 2 ? "grid-rows-[1fr_1fr] content-between" : "grid-rows-3",
      )}
    >
      {list.map((cell, i) => {
        const on = value === cell;
        return (
          <button
            key={cell}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={NAMES[cell]}
            title={NAMES[cell]}
            tabIndex={on ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(cell)}
            onKeyDown={(e) => onKey(e, i)}
            className={cn(
              "flex items-center justify-center rounded-[3px] outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
              rows === 2 && "h-7",
              !on && "hover:bg-paper-2",
            )}
          >
            <span className={cn("rounded-full transition-all duration-150", on ? "size-2.5 bg-ink" : "size-1.5 bg-ink-3/60")} />
          </button>
        );
      })}
    </div>
  );
}

/** "All pages" or a typed selection (1-3, 7), checked against the page count as you type. */
export function PagesField({
  value,
  onChange,
  pages,
  disabled,
  allLabel = "All pages",
  someLabel = "Some pages",
}: {
  /** "" = all pages. */
  value: string;
  onChange: (v: string) => void;
  pages: number | null;
  disabled?: boolean;
  allLabel?: string;
  someLabel?: string;
}) {
  const id = useId();
  const [some, setSome] = useState(Boolean(value));
  const error = pagesError(value, pages);
  return (
    <div>
      <Chips
        value={some ? "some" : "all"}
        disabled={disabled}
        onChange={(v) => {
          setSome(v === "some");
          if (v === "all") onChange("");
        }}
        options={[
          { value: "all", label: allLabel },
          { value: "some", label: someLabel },
        ]}
      />
      {some && (
        <div className="mt-2.5">
          <input
            id={id}
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            placeholder={pages && pages > 2 ? `1-${Math.min(3, pages)}, ${pages}` : "1"}
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            aria-label="Pages"
            aria-invalid={Boolean(error)}
            className={cn(
              "h-11 w-full rounded-md border bg-surface px-3.5 font-mono text-[14px] text-ink outline-none transition-[border-color,box-shadow] placeholder:text-ink-3 focus:border-ink focus:ring-4 focus:ring-accent/15",
              error ? "border-danger/60" : "border-line",
            )}
          />
          <p className={cn("mt-1.5 text-xs", error ? "text-danger" : "text-ink-3")}>
            {error ?? `Pages and ranges, with commas${pages ? ` · 1 to ${pages}` : ""}.`}
          </p>
        </div>
      )}
    </div>
  );
}

/** Same rules as the backend's page selection; null when it's fine (or empty, meaning all). */
export function pagesError(value: string, pages: number | null): string | null {
  if (!value.trim()) return null;
  const parsed = parseRanges(value.replace(/\+/g, ","));
  return parsed.error ?? (pages ? outOfBounds(parsed.parts, pages) : null);
}

export function TextField({
  value,
  onChange,
  label,
  placeholder,
  disabled,
  maxLength,
  mono,
  type = "text",
  autoComplete = "off",
  invalid,
  inputMode,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  placeholder?: string;
  disabled?: boolean;
  maxLength?: number;
  mono?: boolean;
  type?: string;
  autoComplete?: string;
  invalid?: boolean;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      aria-invalid={invalid}
      placeholder={placeholder}
      disabled={disabled}
      maxLength={maxLength}
      autoComplete={autoComplete}
      inputMode={inputMode}
      spellCheck={false}
      className={cn(
        "h-11 w-full rounded-md border bg-surface px-3.5 text-[15px] text-ink outline-none transition-[border-color,box-shadow] placeholder:text-ink-3 focus:border-ink focus:ring-4 focus:ring-accent/15 disabled:opacity-60",
        mono && "font-mono text-[14px]",
        invalid ? "border-danger/60" : "border-line",
      )}
    />
  );
}

/** A password box with a show/hide eye. Never autofilled from the browser's saved passwords. */
export function PasswordField({
  value,
  onChange,
  label,
  placeholder,
  disabled,
  invalid,
  autoComplete = "new-password",
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  autoComplete?: string;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <TextField
        type={shown ? "text" : "password"}
        value={value}
        onChange={onChange}
        label={label}
        placeholder={placeholder}
        disabled={disabled}
        invalid={invalid}
        maxLength={128}
        autoComplete={autoComplete}
      />
      <button
        type="button"
        onClick={() => setShown((v) => !v)}
        aria-label={shown ? "Hide password" : "Show password"}
        title={shown ? "Hide password" : "Show password"}
        className="absolute right-1 top-1 inline-flex size-9 items-center justify-center rounded-[8px] text-ink-3 hover:bg-paper-2 hover:text-ink"
      >
        {shown ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
      </button>
    </div>
  );
}

export function Notice({
  tone = "info",
  children,
  className,
}: {
  tone?: "info" | "warning" | "danger";
  children: React.ReactNode;
  className?: string;
}) {
  const Icon = tone === "info" ? Info : AlertTriangle;
  return (
    <p
      role={tone === "danger" ? "alert" : undefined}
      className={cn(
        "flex items-start gap-2 rounded-md border px-3 py-2.5 text-[13px] leading-relaxed",
        tone === "info" && "border-line bg-paper text-ink-2",
        tone === "warning" && "border-warning/40 bg-warning/5 text-ink-2",
        tone === "danger" && "border-danger/40 bg-danger/5 text-ink-2",
        className,
      )}
    >
      <Icon
        aria-hidden
        className={cn("mt-0.5 size-4 shrink-0", tone === "info" ? "text-ink-3" : tone === "warning" ? "text-warning" : "text-danger")}
      />
      <span className="min-w-0">{children}</span>
    </p>
  );
}
