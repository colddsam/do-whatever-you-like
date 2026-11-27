"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Copy, Loader2, Search, Square, Volume2, X } from "lucide-react";
import { COMMON_TARGET_CODES, type TranslateLanguage } from "@/lib/translate";
import { filterLanguages, speak, stopSpeaking, type VoiceGender } from "@/lib/translate-extras";
import { cn } from "@/lib/utils";
import { triggerHaptic } from "@/lib/haptics";

const BTN_BASE = "inline-flex items-center justify-center gap-1.5 rounded-sm border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40";
const BTN_TONE = {
  idle: "border-line bg-surface text-ink-2 hover:border-ink-3 hover:text-ink",
  on: "border-ink bg-ink text-paper",
  accent: "border-accent/40 bg-accent/10 text-ink",
  ghost: "border-transparent bg-transparent text-ink-3 hover:text-ink",
} as const;
const BTN_SIZE = { xs: "p-1", sm: "px-2.5 py-1.5 text-xs", md: "px-3 py-2 text-sm", lg: "h-11 px-3.5 text-sm" } as const;

/** Button classes with one tone and one size (cn() doesn't merge conflicting Tailwind classes). */
export const bx = (tone: keyof typeof BTN_TONE = "idle", size: keyof typeof BTN_SIZE = "sm") => `${BTN_BASE} ${BTN_TONE[tone]} ${BTN_SIZE[size]}`;
export const btn = bx();

export const primaryBtn =
  "inline-flex h-11 items-center justify-center gap-2 rounded-md bg-ink px-5 text-sm font-medium text-paper transition-colors hover:bg-ink/85 disabled:cursor-not-allowed disabled:opacity-40";

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    triggerHaptic("success");
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      const ok = document.execCommand("copy");
      if (ok) triggerHaptic("success");
      return ok;
    } finally {
      ta.remove();
    }
  }
}

export function CopyButton({ text, label = "Copy", className, iconOnly, ghost }: { text: string; label?: string; className?: string; iconOnly?: boolean; ghost?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      disabled={!text.trim()}
      onClick={async () => {
        if (await copyText(text)) {
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        }
      }}
      title={label}
      aria-label={label}
      className={cn(bx(copied ? "accent" : ghost ? "ghost" : "idle", ghost ? "xs" : "sm"), className)}
    >
      {copied ? <Check aria-hidden className="size-3.5 text-accent" /> : <Copy aria-hidden className="size-3.5" />}
      {!iconOnly && <span>{copied ? "Copied" : label}</span>}
    </button>
  );
}

/** Reads text with a natural neural voice (server), falling back to the browser's voice. */
export function SpeakButton({
  text,
  lang,
  gender = "female",
  rate = 0,
  label = "Listen",
  iconOnly,
  className,
}: {
  text: string;
  lang: string;
  gender?: VoiceGender;
  rate?: number;
  label?: string;
  iconOnly?: boolean;
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "loading" | "playing">("idle");
  const ctrl = useRef<AbortController | null>(null);
  useEffect(() => () => ctrl.current?.abort(), []);
  const toggle = async () => {
    if (state !== "idle") {
      ctrl.current?.abort();
      stopSpeaking();
      setState("idle");
      return;
    }
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setState("loading");
    const started = setTimeout(() => !c.signal.aborted && setState("playing"), 400);
    await speak(text, lang, { gender, rate, signal: c.signal });
    clearTimeout(started);
    if (ctrl.current === c) setState("idle");
  };
  return (
    <button
      type="button"
      onClick={toggle}
      disabled={!text.trim() || !lang || lang === "auto"}
      title={state === "idle" ? label : "Stop"}
      aria-label={state === "idle" ? label : "Stop reading"}
      className={cn(bx(state !== "idle" ? "accent" : "idle"), className)}
    >
      {state === "loading" ? (
        <Loader2 aria-hidden className="size-3.5 animate-spin" />
      ) : state === "playing" ? (
        <Square aria-hidden className="size-3.5 text-accent" />
      ) : (
        <Volume2 aria-hidden className="size-3.5" />
      )}
      {!iconOnly && <span>{state === "idle" ? label : "Stop"}</span>}
    </button>
  );
}

/**
 * A searchable language picker: type a name (English or native) or a code. Popular and recent
 * languages first. A popover on wide screens, a sheet from the bottom on phones.
 */
export function LanguagePicker({
  value,
  onChange,
  languages,
  allowAuto,
  label,
  recents = [],
  disabled,
  detectedName,
  compact,
  defaultOpen,
  onDismiss,
  align = "start",
}: {
  value: string;
  onChange: (code: string) => void;
  languages: TranslateLanguage[];
  allowAuto?: boolean;
  label: string;
  recents?: string[];
  disabled?: boolean;
  /** Shown next to "Detect language" once something was detected. */
  detectedName?: string;
  compact?: boolean;
  /** Open the list straight away (pickers that appear on demand, like "Add language"). */
  defaultOpen?: boolean;
  /** Closed without choosing (Esc, outside click, ×). */
  onDismiss?: () => void;
  /** Which edge the list lines up with on wide screens ("end" for pickers on the right). */
  align?: "start" | "end";
}) {
  const [open, setOpenRaw] = useState(Boolean(defaultOpen));
  const setOpen = (next: boolean | ((o: boolean) => boolean)) => {
    setOpenRaw((o) => {
      const v = typeof next === "function" ? next(o) : next;
      if (o && !v) setTimeout(() => onDismissRef.current?.(), 0);
      return v;
    });
  };
  const onDismissRef = useRef(onDismiss);
  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listId = useId();

  const current = languages.find((l) => l.code === value);
  const display = value === "auto" ? (detectedName ? `Detect · ${detectedName}` : "Detect language") : current?.name ?? "Choose a language";

  const filtered = useMemo(() => filterLanguages(languages, query), [languages, query]);
  const popular = useMemo(() => {
    const map = new Map(languages.map((l) => [l.code, l]));
    const seen = new Set<string>();
    const out: TranslateLanguage[] = [];
    for (const c of [...recents, ...COMMON_TARGET_CODES]) {
      const l = map.get(c);
      if (l && !seen.has(c)) {
        seen.add(c);
        out.push(l);
      }
    }
    return out.slice(0, 12);
  }, [languages, recents]);

  const flat = useMemo(() => {
    const items: { code: string; name: string; native?: string }[] = [];
    if (allowAuto && !query) items.push({ code: "auto", name: "Detect language" });
    const list = query ? filtered : [...popular, ...languages.filter((l) => !popular.includes(l))];
    for (const l of list) items.push({ code: l.code, name: l.name, native: l.native_name });
    return items;
  }, [allowAuto, query, filtered, popular, languages]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => {
      clearTimeout(t);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  const choose = (code: string) => {
    // setOpenRaw (not setOpen) so choosing a language never fires onDismiss.
    onChange(code);
    setOpenRaw(false);
    setQuery("");
  };

  const popularCount = query ? 0 : (allowAuto ? 1 : 0) + popular.length;

  return (
    <div ref={rootRef} className="relative min-w-0">
      <span className="label-mono block text-ink-3">{label}</span>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          setCursor(0);
          setOpen((o) => !o);
        }}
        className={cn(
          "mt-1.5 flex w-full items-center justify-between gap-2 rounded-sm border border-line bg-surface px-3 text-left text-sm text-ink outline-none transition-colors hover:border-ink-3 focus-visible:border-ink disabled:cursor-not-allowed disabled:opacity-50",
          compact ? "h-9" : "h-10",
        )}
      >
        <span className="min-w-0 truncate">
          {display}
          {current && current.native_name !== current.name && value !== "auto" && <span className="ml-1.5 text-ink-3">{current.native_name}</span>}
        </span>
        <ChevronDown aria-hidden className={cn("size-4 shrink-0 text-ink-3 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <>
          <div aria-hidden className="fixed inset-0 z-40 bg-ink/30 sm:hidden" onClick={() => setOpen(false)} />
          <div
            className={cn(
              "z-50 flex flex-col overflow-hidden border border-line bg-surface shadow-float",
              "fixed inset-x-0 bottom-0 max-h-[78dvh] rounded-t-lg",
              "sm:absolute sm:inset-x-auto sm:bottom-auto sm:top-full sm:mt-1 sm:max-h-[420px] sm:w-[min(560px,90vw)] sm:rounded-md",
              align === "end" ? "sm:right-0" : "sm:left-0",
            )}
          >
            <div className="flex items-center gap-2 border-b border-line px-3 py-2">
              <Search aria-hidden className="size-4 shrink-0 text-ink-3" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setCursor(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setOpen(false);
                  else if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setCursor((c) => Math.min(flat.length - 1, c + 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setCursor((c) => Math.max(0, c - 1));
                  } else if (e.key === "Enter" && flat[cursor]) {
                    e.preventDefault();
                    choose(flat[cursor].code);
                  }
                }}
                placeholder="Search 130 languages (name, native name or code)"
                aria-label={`Search ${label.toLowerCase()}`}
                aria-controls={listId}
                className="h-9 min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-3"
              />
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded-sm p-1 text-ink-3 hover:text-ink">
                <X className="size-4" />
              </button>
            </div>
            <ul id={listId} role="listbox" aria-label={label} className="grid flex-1 grid-cols-1 gap-0.5 overflow-y-auto overscroll-contain p-2 sm:grid-cols-2">
              {flat.length === 0 && <li className="col-span-full px-3 py-6 text-center text-sm text-ink-3">No language matches “{query}”.</li>}
              {flat.map((item, i) => (
                <li key={`${item.code}-${i}`} role="option" aria-selected={item.code === value} className={cn(i === popularCount && popularCount > 0 && "sm:col-span-2")}>
                  {i === popularCount && popularCount > 0 && <p className="label-mono mb-1 mt-2 border-t border-line px-2 pt-2 text-ink-3">All languages</p>}
                  <button
                    type="button"
                    onClick={() => choose(item.code)}
                    onMouseEnter={() => setCursor(i)}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded-sm px-2.5 py-2 text-left text-sm",
                      i === cursor ? "bg-paper-2 text-ink" : "text-ink-2 hover:bg-paper",
                      item.code === value && "font-medium text-ink",
                    )}
                  >
                    <span className="min-w-0 truncate">
                      {item.name}
                      {item.native && item.native !== item.name && <span className="ml-1.5 text-ink-3">{item.native}</span>}
                    </span>
                    {item.code === value && <Check aria-hidden className="size-4 shrink-0 text-accent" />}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

export function ProgressBar({ value, label }: { value: number | null; label?: string }) {
  return (
    <div className="space-y-1.5">
      {label && <p className="text-xs text-ink-2">{label}</p>}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-paper-2" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value === null ? undefined : Math.round(value * 100)}>
        <div
          className={cn("h-full rounded-full bg-accent transition-[width] duration-300", value === null && "w-1/3 animate-pulse")}
          style={value === null ? undefined : { width: `${Math.max(2, Math.round(value * 100))}%` }}
        />
      </div>
    </div>
  );
}
