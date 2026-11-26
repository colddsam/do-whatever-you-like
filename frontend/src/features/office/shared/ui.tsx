"use client";

/**
 * Ribbon building blocks shared by the Word, Excel and PowerPoint editors: tabbed ribbon,
 * icon buttons with tooltips, dropdown menus, colour pickers, the title bar with autosave
 * status, "My files", and a full-screen toggle. Designed to collapse gracefully on phones
 * (ribbon scrolls sideways, menus become bottom sheets).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, FilePlus2, Files, FolderOpen, Maximize2, Minimize2, Trash2, X, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { deleteDoc, listDocs, timeAgo, type DocMeta, type OfficeApp } from "./store";

// ------------------------------------------------------------------ buttons

export function RBtn({
  icon: Icon,
  label,
  onClick,
  active,
  disabled,
  showLabel,
  shortcut,
  big,
  className,
  children,
}: {
  icon?: LucideIcon;
  label: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  showLabel?: boolean;
  shortcut?: string;
  big?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-label={label}
      aria-pressed={active === undefined ? undefined : active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-1 rounded-[6px] border text-[13px] transition-colors disabled:pointer-events-none disabled:opacity-35",
        big ? "h-14 min-w-14 flex-col px-2 text-[11px]" : "h-8 min-w-8 px-1.5",
        active ? "border-ink/30 bg-ink/10 text-ink" : "border-transparent text-ink-2 hover:border-line hover:bg-surface hover:text-ink",
        className,
      )}
    >
      {Icon && <Icon aria-hidden className={big ? "size-5" : "size-4"} />}
      {showLabel && <span className={big ? "leading-tight" : "hidden whitespace-nowrap sm:inline"}>{label}</span>}
      {children}
    </button>
  );
}

/** A labelled ribbon group. `maxW` lets a wide group wrap onto two rows (like Word's Font group). */
export function RGroup({ label, children, className, maxW }: { label: string; children: ReactNode; className?: string; maxW?: number }) {
  return (
    <div className={cn("flex shrink-0 flex-col border-r border-line px-1.5 last:border-r-0", className)} role="group" aria-label={label}>
      <div className="flex min-h-[64px] flex-wrap content-center items-center gap-0.5" style={maxW ? { maxWidth: maxW } : undefined}>
        {children}
      </div>
      <span className="hidden pb-0.5 text-center text-[10px] uppercase tracking-wide text-ink-3 lg:block">{label}</span>
    </div>
  );
}

/** Keeps editor focus: toolbar selects shouldn't steal the text selection on mousedown. */
export function RSelect({
  value,
  onChange,
  options,
  label,
  width = 120,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; style?: React.CSSProperties }[];
  label: string;
  width?: number;
}) {
  return (
    <select
      aria-label={label}
      title={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{ width }}
      className="h-8 shrink-0 rounded-[6px] border border-line bg-surface px-1.5 text-[13px] text-ink outline-none focus:border-ink"
    >
      {!options.some((o) => o.value === value) && <option value={value}>{value || "—"}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value} style={o.style}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** Forces the next ribbon controls in a wrapping RGroup onto a new row. */
export function RBreak() {
  return <span aria-hidden className="h-0 basis-full" />;
}

// ------------------------------------------------------------------ popovers & menus

/**
 * A dropdown anchored to its trigger. It is portalled to <body> and positioned with
 * `position: fixed`, so the ribbon's sideways scrolling can never clip it; it flips above the
 * trigger when there is no room below and stays inside the viewport. On phones it is a bottom sheet.
 */
export function Popover({
  open,
  onClose,
  children,
  align = "start",
  className,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  align?: "start" | "end";
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const el = ref.current;
      const anchor = anchorRef.current?.parentElement;
      if (!el || !anchor) return;
      if (window.innerWidth < 640) {
        el.style.top = el.style.left = "";
        return;
      }
      const r = anchor.getBoundingClientRect();
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let left = align === "end" ? r.right - w : r.left;
      left = Math.max(8, Math.min(left, vw - w - 8));
      let top = r.bottom + 4;
      if (top + h > vh - 8 && r.top - h - 4 >= 8) top = r.top - h - 4;
      top = Math.max(8, Math.min(top, vh - h - 8));
      el.style.left = `${Math.round(left)}px`;
      el.style.top = `${Math.round(top)}px`;
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, align]);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (ref.current?.contains(t)) return;
      // A click on this popover's own trigger toggles it there; any other click closes it.
      const trigger = t.closest?.("[data-popover-trigger]");
      if (trigger && anchorRef.current?.parentElement?.contains(trigger)) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const t = setTimeout(() => document.addEventListener("pointerdown", down), 0);
    document.addEventListener("keydown", key);
    return () => {
      clearTimeout(t);
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      <span ref={anchorRef} hidden />
      {createPortal(
        <>
          <div aria-hidden className="fixed inset-0 z-[80] bg-ink/25 sm:hidden" onPointerDown={onClose} />
          <div
            ref={ref}
            className={cn(
              "fixed z-[81] overflow-y-auto border border-line bg-surface shadow-float",
              "inset-x-0 bottom-0 max-h-[75dvh] rounded-t-lg p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]",
              "sm:inset-auto sm:max-h-[min(440px,calc(100dvh-16px))] sm:rounded-md sm:p-1.5",
              className,
            )}
          >
            {children}
          </div>
        </>,
        document.body,
      )}
    </>
  );
}

export type MenuItem =
  | { label: string; icon?: LucideIcon; onClick: () => void; shortcut?: string; checked?: boolean; disabled?: boolean; danger?: boolean }
  | { divider: true }
  | { heading: string };

export function Menu({
  icon,
  label,
  items,
  showLabel = true,
  align,
  big,
  caret = true,
}: {
  icon?: LucideIcon;
  label: string;
  items: MenuItem[];
  showLabel?: boolean;
  align?: "start" | "end";
  big?: boolean;
  caret?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <div className="relative">
      <span data-popover-trigger>
        <RBtn icon={icon} label={label} showLabel={showLabel} big={big} active={open || undefined} onClick={() => setOpen((o) => !o)}>
          {caret && !big && <ChevronDown aria-hidden className="size-3 opacity-60" />}
        </RBtn>
      </span>
      <Popover open={open} onClose={close} align={align} className="min-w-56">
        <ul role="menu" aria-label={label}>
          {items.map((it, i) =>
            "divider" in it ? (
              <li key={i} role="separator" className="my-1 border-t border-line" />
            ) : "heading" in it ? (
              <li key={i} className="px-2.5 pb-1 pt-2 text-[10px] uppercase tracking-wide text-ink-3">
                {it.heading}
              </li>
            ) : (
              <li key={i} role="none">
                <button
                  type="button"
                  role="menuitem"
                  disabled={it.disabled}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setOpen(false);
                    it.onClick();
                  }}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-[5px] px-2.5 py-2 text-left text-[13px] hover:bg-paper disabled:opacity-40 sm:py-1.5",
                    it.danger ? "text-danger" : "text-ink",
                  )}
                >
                  <span className="flex size-4 items-center justify-center">{it.checked ? <Check className="size-4 text-accent" /> : it.icon ? <it.icon className="size-4 text-ink-2" /> : null}</span>
                  <span className="flex-1">{it.label}</span>
                  {it.shortcut && <span className="font-mono text-[11px] text-ink-3">{it.shortcut}</span>}
                </button>
              </li>
            ),
          )}
        </ul>
      </Popover>
    </div>
  );
}

// ------------------------------------------------------------------ colours

export const PALETTE = [
  ["#000000", "#434343", "#666666", "#999999", "#b7b7b7", "#cccccc", "#d9d9d9", "#efefef", "#f3f3f3", "#ffffff"],
  ["#980000", "#ff0000", "#ff9900", "#ffff00", "#00ff00", "#00ffff", "#4a86e8", "#0000ff", "#9900ff", "#ff00ff"],
  ["#e6b8af", "#f4cccc", "#fce5cd", "#fff2cc", "#d9ead3", "#d0e0e3", "#c9daf8", "#cfe2f3", "#d9d2e9", "#ead1dc"],
  ["#dd7e6b", "#ea9999", "#f9cb9c", "#ffe599", "#b6d7a8", "#a2c4c9", "#a4c2f4", "#9fc5e8", "#b4a7d6", "#d5a6bd"],
  ["#cc4125", "#e06666", "#f6b26b", "#ffd966", "#93c47d", "#76a5af", "#6d9eeb", "#6fa8dc", "#8e7cc3", "#c27ba0"],
  ["#a61c00", "#cc0000", "#e69138", "#f1c232", "#6aa84f", "#45818e", "#3c78d8", "#3d85c6", "#674ea7", "#a64d79"],
  ["#5b0f00", "#660000", "#783f04", "#7f6000", "#274e13", "#0c343d", "#1c4587", "#073763", "#20124d", "#4c1130"],
];

export function ColorButton({
  icon: Icon,
  label,
  value,
  onChange,
  allowNone = true,
}: {
  icon: LucideIcon;
  label: string;
  value?: string;
  onChange: (c: string | null) => void;
  allowNone?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const [custom, setCustom] = useState(value ?? "#000000");
  return (
    <div className="relative">
      <span data-popover-trigger>
        <RBtn label={label} onClick={() => setOpen((o) => !o)} active={open || undefined}>
          <span className="flex flex-col items-center">
            <Icon aria-hidden className="size-4" />
            <span className="mt-px h-1 w-4 rounded-sm border border-line" style={{ background: value ?? "transparent" }} />
          </span>
          <ChevronDown aria-hidden className="size-3 opacity-60" />
        </RBtn>
      </span>
      <Popover open={open} onClose={close} className="w-auto">
        <div className="space-y-1 p-1">
          {allowNone && (
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { onChange(null); setOpen(false); }} className="mb-1 w-full rounded-[5px] border border-line px-2 py-1 text-left text-xs text-ink-2 hover:bg-paper">
              Automatic / none
            </button>
          )}
          {PALETTE.map((row, i) => (
            <div key={i} className="flex gap-1">
              {row.map((c) => (
                <button
                  key={c}
                  type="button"
                  title={c}
                  aria-label={c}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onChange(c);
                    setOpen(false);
                  }}
                  className={cn("size-6 rounded-[3px] border sm:size-5", value?.toLowerCase() === c ? "border-ink ring-2 ring-accent/50" : "border-line")}
                  style={{ background: c }}
                />
              ))}
            </div>
          ))}
          <label className="mt-2 flex items-center gap-2 text-xs text-ink-2">
            Custom
            <input type="color" value={custom} onChange={(e) => setCustom(e.target.value)} className="h-7 w-10 cursor-pointer rounded border border-line bg-surface" />
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { onChange(custom); setOpen(false); }} className="rounded-[5px] border border-line px-2 py-1 hover:bg-paper">
              Apply
            </button>
          </label>
        </div>
      </Popover>
    </div>
  );
}

// ------------------------------------------------------------------ ribbon

export function Ribbon({ tabs, active, onTab, children, right }: { tabs: string[]; active: string; onTab: (t: string) => void; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="border-b border-line bg-paper/70">
      <div className="flex items-center gap-1 px-2 pt-1">
        <div role="tablist" aria-label="Ribbon" className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto [scrollbar-width:none]">
          {tabs.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={active === t}
              onClick={() => onTab(t)}
              className={cn(
                "shrink-0 rounded-t-[6px] px-3 py-1.5 text-[13px] font-medium transition-colors",
                active === t ? "bg-surface text-ink shadow-[0_-1px_0_var(--color-line),1px_0_0_var(--color-line),-1px_0_0_var(--color-line)]" : "text-ink-2 hover:text-ink",
              )}
            >
              {t}
            </button>
          ))}
        </div>
        {right}
      </div>
      <div className="flex items-stretch overflow-x-auto bg-surface py-1 [scrollbar-width:thin]">{children}</div>
    </div>
  );
}

// ------------------------------------------------------------------ title bar & files

export type SaveState = "saved" | "saving" | "unsaved" | "error";

export function TitleBar({
  app,
  icon: Icon,
  name,
  onRename,
  saveState,
  onNew,
  onOpenFile,
  accept,
  onPickDoc,
  currentId,
  fullscreen,
  onFullscreen,
  extra,
}: {
  app: OfficeApp;
  icon: LucideIcon;
  name: string;
  onRename: (n: string) => void;
  saveState: SaveState;
  onNew: () => void;
  onOpenFile: (f: File) => void;
  accept: string;
  onPickDoc: (id: string) => void;
  currentId: string;
  fullscreen: boolean;
  onFullscreen: () => void;
  extra?: ReactNode;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [filesOpen, setFilesOpen] = useState(false);
  const [docs, setDocs] = useState<DocMeta[]>([]);
  const closeFiles = useCallback(() => setFilesOpen(false), []);
  const openFiles = async () => {
    setDocs(await listDocs(app));
    setFilesOpen((o) => !o);
  };
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-2 py-1.5 sm:px-3">
      <Icon aria-hidden className="size-5 shrink-0 text-accent" />
      <input
        value={name}
        onChange={(e) => onRename(e.target.value)}
        aria-label="Document name"
        className="h-8 w-40 min-w-0 flex-1 rounded-[6px] border border-transparent bg-transparent px-1.5 text-sm font-medium text-ink outline-none hover:border-line focus:border-ink sm:max-w-xs sm:flex-none"
      />
      <span className={cn("text-xs", saveState === "error" ? "text-danger" : "text-ink-3")} aria-live="polite">
        {saveState === "saved" ? "Saved in this browser" : saveState === "saving" ? "Saving…" : saveState === "unsaved" ? "Unsaved changes" : "Couldn't save (storage full?)"}
      </span>
      <div className="ml-auto flex items-center gap-1">
        {extra}
        <RBtn icon={FilePlus2} label="New" showLabel onClick={onNew} />
        <RBtn icon={FolderOpen} label="Open file" showLabel onClick={() => fileRef.current?.click()} />
        <input
          ref={fileRef}
          type="file"
          accept={accept}
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) onOpenFile(f);
          }}
        />
        <div className="relative">
          <span data-popover-trigger>
            <RBtn icon={Files} label="My files" showLabel onClick={openFiles} active={filesOpen || undefined}>
              <ChevronDown aria-hidden className="size-3 opacity-60" />
            </RBtn>
          </span>
          <Popover open={filesOpen} onClose={closeFiles} align="end" className="w-80">
            <p className="px-2 pb-1 pt-1 text-[10px] uppercase tracking-wide text-ink-3">Saved in this browser</p>
            {docs.length === 0 && <p className="px-2 py-4 text-sm text-ink-3">Nothing saved yet.</p>}
            <ul>
              {docs.map((d) => (
                <li key={d.id} className={cn("flex items-center gap-1 rounded-[5px] hover:bg-paper", d.id === currentId && "bg-paper")}>
                  <button
                    type="button"
                    className="min-w-0 flex-1 px-2 py-1.5 text-left"
                    onClick={() => {
                      setFilesOpen(false);
                      onPickDoc(d.id);
                    }}
                  >
                    <span className="block truncate text-sm text-ink">{d.name || "Untitled"}</span>
                    <span className="block text-[11px] text-ink-3">
                      {timeAgo(d.updatedAt)} · {Math.max(1, Math.round(d.size / 1024))} KB
                    </span>
                  </button>
                  {d.id !== currentId && (
                    <button
                      type="button"
                      aria-label={`Delete ${d.name}`}
                      className="rounded p-1.5 text-ink-3 hover:text-danger"
                      onClick={async () => {
                        await deleteDoc(d.id);
                        setDocs(await listDocs(app));
                      }}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </Popover>
        </div>
        <RBtn icon={fullscreen ? Minimize2 : Maximize2} label={fullscreen ? "Exit full screen" : "Full screen"} onClick={onFullscreen} />
      </div>
    </div>
  );
}

/** Editor frame: in the page normally; covers the whole viewport in full-screen mode. */
export function EditorFrame({ fullscreen, children, height = "h-[calc(100dvh-140px)] min-h-[560px] lg:h-[min(86dvh,1100px)]" }: { fullscreen: boolean; children: ReactNode; height?: string }) {
  useEffect(() => {
    if (!fullscreen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [fullscreen]);
  return (
    <div className={cn("flex flex-col overflow-hidden border-line bg-surface", fullscreen ? "fixed inset-0 z-[70]" : cn("rounded-lg border shadow-float", height))}>{children}</div>
  );
}

export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center sm:items-center sm:p-6">
      <div aria-hidden className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label={title} className={cn("relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-lg border border-line bg-surface shadow-float sm:rounded-lg", wide ? "sm:max-w-3xl" : "sm:max-w-lg")}>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="rounded p-1.5 text-ink-3 hover:bg-paper hover:text-ink">
            <X className="size-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-4 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export const inputCls = "h-9 w-full rounded-[6px] border border-line bg-surface px-2.5 text-sm text-ink outline-none focus:border-ink";
export const primaryCls = "inline-flex h-9 items-center justify-center gap-1.5 rounded-[6px] bg-ink px-4 text-sm font-medium text-paper hover:bg-ink/85 disabled:opacity-40";
export const secondaryCls = "inline-flex h-9 items-center justify-center gap-1.5 rounded-[6px] border border-line bg-surface px-4 text-sm text-ink hover:border-ink-3";

export const FONTS = [
  "Calibri", "Arial", "Helvetica", "Times New Roman", "Georgia", "Garamond", "Cambria", "Verdana", "Tahoma", "Trebuchet MS", "Segoe UI",
  "Roboto", "Open Sans", "Lato", "Montserrat", "Poppins", "Inter", "Merriweather", "Playfair Display", "Courier New", "Consolas", "Comic Sans MS", "Noto Sans", "Noto Sans Devanagari", "Noto Sans Bengali", "Noto Sans Arabic",
];
export const FONT_SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 54, 60, 72, 96];

/** Loads a Google Font on demand (only the ones a document actually uses). */
const loadedFonts = new Set<string>();
const SYSTEM = new Set(["Calibri", "Arial", "Helvetica", "Times New Roman", "Georgia", "Garamond", "Cambria", "Verdana", "Tahoma", "Trebuchet MS", "Segoe UI", "Courier New", "Consolas", "Comic Sans MS"]);
export function ensureFont(name?: string) {
  if (!name || SYSTEM.has(name) || loadedFonts.has(name) || typeof document === "undefined") return;
  loadedFonts.add(name);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name).replace(/%20/g, "+")}:ital,wght@0,400;0,700;1,400;1,700&display=swap`;
  document.head.appendChild(link);
}

/**
 * Debounced autosave that never drops the last edit: a pending save is flushed at once when the
 * editor unmounts, the tab is hidden or the page is being closed.
 */
export function useAutosave<T>(data: T, save: (d: T) => Promise<boolean>, delay = 600): SaveState {
  const [state, setState] = useState<SaveState>("saved");
  const first = useRef(true);
  const saveRef = useRef(save);
  const pending = useRef<T | null>(null);
  useEffect(() => {
    saveRef.current = save;
  }, [save]);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    pending.current = data;
    const t1 = setTimeout(() => setState("unsaved"), 0);
    const t = setTimeout(async () => {
      pending.current = null;
      setState("saving");
      setState((await saveRef.current(data)) ? "saved" : "error");
    }, delay);
    return () => {
      clearTimeout(t1);
      clearTimeout(t);
    };
  }, [data, delay]);
  useEffect(() => {
    const flush = () => {
      if (pending.current === null) return;
      const d = pending.current;
      pending.current = null;
      void saveRef.current(d);
    };
    const onHide = () => document.visibilityState === "hidden" && flush();
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onHide);
      flush();
    };
  }, []);
  return state;
}
