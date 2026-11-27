"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, X, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { methodColor } from "../lib/util";
import { triggerHaptic } from "@/lib/haptics";

export { Toggle } from "@/components/tools/pdf/kit";

/* ------------------------------------------------------------------ buttons */

type BtnProps = React.ComponentPropsWithRef<"button"> & { variant?: "primary" | "secondary" | "ghost" | "danger" | "accent"; size?: "sm" | "md"; icon?: LucideIcon };

export function Btn({ variant = "secondary", size = "sm", icon: Icon, className, children, ...rest }: BtnProps) {
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45",
        size === "sm" ? "h-8 px-2.5 text-[13px]" : "h-10 px-4 text-sm",
        variant === "primary" && "bg-ink text-paper hover:bg-ink/85",
        variant === "accent" && "bg-accent text-white hover:bg-accent/90",
        variant === "secondary" && "border border-line bg-surface text-ink hover:border-ink-3 hover:bg-paper",
        variant === "ghost" && "text-ink-2 hover:bg-paper-2 hover:text-ink",
        variant === "danger" && "border border-danger/40 bg-surface text-danger hover:bg-danger/10",
        className,
      )}
    >
      {Icon && <Icon aria-hidden className={size === "sm" ? "size-3.5" : "size-4"} />}
      {children}
    </button>
  );
}

export function IconBtn({ icon: Icon, label, active, className, size = "sm", ...rest }: React.ComponentPropsWithRef<"button"> & { icon: LucideIcon; label: string; active?: boolean; size?: "xs" | "sm" | "md" }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...rest}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40",
        size === "xs" ? "size-6" : size === "sm" ? "size-8" : "size-10",
        active ? "bg-ink text-paper" : "text-ink-2 hover:bg-paper-2 hover:text-ink",
        className,
      )}
    >
      <Icon aria-hidden className={size === "xs" ? "size-3.5" : "size-4"} />
    </button>
  );
}

export function MethodTag({ method, protocol, className }: { method: string; protocol?: string; className?: string }) {
  const label = !protocol || protocol === "http" ? method : protocol === "graphql" ? "GQL" : protocol === "socketio" ? "IO" : protocol === "grpc" ? "gRPC" : protocol.toUpperCase();
  return (
    <span className={cn("inline-block w-11 shrink-0 truncate text-right font-mono text-[12px] font-semibold", protocol && protocol !== "http" ? (protocol === "graphql" ? "text-[#c2367f]" : "text-ink-2") : methodColor(method), className)}>
      {label === "DELETE" ? "DEL" : label === "OPTIONS" ? "OPT" : label === "PROPFIND" ? "PROP" : label}
    </span>
  );
}

/* ------------------------------------------------------------------ inputs */

export function Input({ className, mono, ...rest }: React.InputHTMLAttributes<HTMLInputElement> & { mono?: boolean }) {
  return (
    <input
      {...rest}
      className={cn(
        "h-8 min-w-0 rounded-md border border-line bg-surface px-2.5 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-ink focus:ring-2 focus:ring-accent/20",
        // Full width unless the caller sets one (cn doesn't merge Tailwind conflicts, so w-full would win).
        !/(^|\s)(w-|flex-1)/.test(className ?? "") && "w-full",
        mono && "font-mono",
        className,
      )}
    />
  );
}

export function Select<T extends string>({ value, onChange, options, className, label, mono }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] | readonly T[]; className?: string; label: string; mono?: boolean }) {
  const opts = (options as (T | { value: T; label: string })[]).map((o) => (typeof o === "string" ? { value: o, label: o } : o));
  return (
    <span className={cn("relative inline-flex", className)}>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className={cn("h-8 w-full appearance-none rounded-md border border-line bg-surface pl-2.5 pr-7 text-[13px] text-ink outline-none hover:border-ink-3 focus:border-ink", mono && "font-mono")}
      >
        {opts.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown aria-hidden className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-ink-3" />
    </span>
  );
}

export function Textarea({ className, mono, ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { mono?: boolean }) {
  return (
    <textarea
      {...rest}
      className={cn("w-full rounded-md border border-line bg-surface px-2.5 py-2 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-ink focus:ring-2 focus:ring-accent/20", mono && "font-mono", className)}
    />
  );
}

export function Check2({ checked, onChange, label, className }: { checked: boolean; onChange: (v: boolean) => void; label: string; className?: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      title={label}
      onClick={() => onChange(!checked)}
      className={cn("inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors", checked ? "border-ink bg-ink text-paper" : "border-ink-3/60 bg-surface hover:border-ink", className)}
    >
      {checked && <Check aria-hidden className="size-3" strokeWidth={3} />}
    </button>
  );
}

/* ------------------------------------------------------------------ tabs */

export function SubTabs<T extends string>({ tabs, value, onChange, className, right }: { tabs: { id: T; label: string; count?: number | string; dot?: boolean }[]; value: T; onChange: (v: T) => void; className?: string; right?: ReactNode }) {
  return (
    <div className={cn("flex min-w-0 items-end border-b border-line", className)}>
      <div role="tablist" className="no-scrollbar flex min-w-0 flex-1 gap-0.5 overflow-x-auto px-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={value === t.id}
            onClick={() => onChange(t.id)}
            className={cn(
              "relative inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap px-2.5 text-[13px] transition-colors",
              value === t.id ? "font-medium text-ink" : "text-ink-2 hover:text-ink",
            )}
          >
            {t.label}
            {t.count !== undefined && t.count !== 0 && t.count !== "" && <span className={cn("font-mono text-[12px]", value === t.id ? "text-success" : "text-ink-3")}>({t.count})</span>}
            {t.dot && <span aria-hidden className="size-1.5 rounded-full bg-success" />}
            {value === t.id && <span aria-hidden className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent" />}
          </button>
        ))}
      </div>
      {right && <div className="flex shrink-0 items-center gap-1 pb-1 pr-1">{right}</div>}
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, options, className, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; className?: string; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("inline-flex shrink-0 rounded-md border border-line bg-paper p-0.5", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn("h-7 rounded-[7px] px-2.5 text-[12px] font-medium transition-colors", value === o.value ? "bg-ink text-paper" : "text-ink-2 hover:text-ink")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ floating layers */

/** Positions a layer under (or above) an anchor, inside the viewport, in a portal on <body>. */
export function useFloating(open: boolean, anchor: React.RefObject<HTMLElement | null>, align: "start" | "end" = "start") {
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number; maxH: number; minW: number } | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
    const a = anchor.current?.getBoundingClientRect();
    if (!a) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const below = vh - a.bottom;
    const up = below < 260 && a.top > below;
    const width = Math.min(320, vw - 16);
    let left = align === "end" ? a.right - width : a.left;
    left = Math.max(8, Math.min(left, vw - width - 8));
    setPos(up ? { bottom: vh - a.top + 4, left, maxH: Math.max(160, a.top - 16), minW: a.width } : { top: a.bottom + 4, left, maxH: Math.max(160, below - 16), minW: a.width });
    };
    // Measuring the anchor needs the DOM, so it happens here, before paint (no flash at 0,0).
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, anchor, align]);
  return pos;
}

export type MenuItem = { label: string; icon?: LucideIcon; onClick?: () => void; danger?: boolean; hint?: string; divider?: boolean; disabled?: boolean; checked?: boolean };

export function Menu({ trigger, items, align = "start", label, className }: { trigger: (p: { open: boolean; toggle: () => void; ref: React.RefObject<HTMLButtonElement | null> }) => ReactNode; items: MenuItem[]; align?: "start" | "end"; label: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement | null>(null);
  const pop = useRef<HTMLDivElement>(null);
  const pos = useFloating(open, ref, align);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | TouchEvent) => {
      if (!pop.current?.contains(e.target as Node) && !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        ref.current?.focus();
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const els = [...(pop.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
        const i = els.indexOf(document.activeElement as HTMLButtonElement);
        els[(i + (e.key === "ArrowDown" ? 1 : -1) + els.length) % els.length]?.focus();
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("touchstart", close);
    document.addEventListener("keydown", key);
    setTimeout(() => pop.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus(), 0);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("touchstart", close);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  return (
    <>
      {trigger({ open, toggle: () => setOpen((o) => !o), ref })}
      {open &&
        pos &&
        createPortal(
          <div
            ref={pop}
            role="menu"
            aria-label={label}
            style={{ left: pos.left, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxH, minWidth: Math.max(180, pos.minW) }}
            className={cn("fixed z-[140] w-max max-w-[min(320px,calc(100vw-16px))] overflow-y-auto overscroll-contain rounded-lg border border-line bg-surface p-1 shadow-float", className)}
            data-lenis-prevent
          >
            {items.map((it, i) =>
              it.divider ? (
                <div key={i} className="my-1 h-px bg-line" />
              ) : (
                <button
                  key={i}
                  type="button"
                  role="menuitem"
                  disabled={it.disabled}
                  onClick={() => {
                    setOpen(false);
                    it.onClick?.();
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] outline-none disabled:opacity-40 focus:bg-paper-2 hover:bg-paper-2",
                    it.danger ? "text-danger" : "text-ink",
                  )}
                >
                  {it.icon ? <it.icon aria-hidden className="size-3.5 shrink-0 text-ink-3" /> : it.checked !== undefined ? <span className="size-3.5 shrink-0">{it.checked && <Check aria-hidden className="size-3.5" />}</span> : null}
                  <span className="min-w-0 flex-1 truncate">{it.label}</span>
                  {it.hint && <span className="shrink-0 font-mono text-[12px] text-ink-3">{it.hint}</span>}
                </button>
              ),
            )}
          </div>,
          document.body,
        )}
    </>
  );
}

export function Popover({ anchor, open, onClose, children, align = "start", className }: { anchor: React.RefObject<HTMLElement | null>; open: boolean; onClose: () => void; children: ReactNode; align?: "start" | "end"; className?: string }) {
  const pop = useRef<HTMLDivElement>(null);
  const pos = useFloating(open, anchor, align);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!pop.current?.contains(e.target as Node) && !anchor.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", key);
    };
  }, [open, onClose, anchor]);
  if (!open || !pos) return null;
  return createPortal(
    <div
      ref={pop}
      style={{ left: pos.left, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxH }}
      className={cn("fixed z-[140] w-[min(420px,calc(100vw-16px))] overflow-y-auto overscroll-contain rounded-lg border border-line bg-surface shadow-float", className)}
      data-lenis-prevent
    >
      {children}
    </div>,
    document.body,
  );
}

export function Modal({ title, onClose, children, footer, wide, className }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", key);
    setTimeout(() => box.current?.querySelector<HTMLElement>("input, textarea, select, button:not([aria-label='Close'])")?.focus(), 30);
    return () => {
      document.removeEventListener("keydown", key);
      prev?.focus?.();
    };
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 z-[130] flex items-end justify-center bg-ink/30 backdrop-blur-[2px] sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
        className={cn("flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-lg border border-line bg-surface shadow-float sm:rounded-lg", wide ? "sm:max-w-[860px]" : "sm:max-w-[520px]", className)}
      >
        <div className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-3">
          <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold text-ink">{title}</h2>
          <IconBtn icon={X} label="Close" onClick={onClose} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4" data-lenis-prevent>
          {children}
        </div>
        {footer && <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-line bg-paper px-4 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------ layout helpers */

export function Resizer({ dir, onDrag, className, label }: { dir: "x" | "y"; onDrag: (delta: number, done?: boolean) => void; className?: string; label: string }) {
  const start = useRef<number | null>(null);
  return (
    <div
      role="separator"
      aria-orientation={dir === "x" ? "vertical" : "horizontal"}
      aria-label={label}
      tabIndex={0}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 60 : 16;
        if ((dir === "x" && e.key === "ArrowLeft") || (dir === "y" && e.key === "ArrowUp")) onDrag(-step, true);
        if ((dir === "x" && e.key === "ArrowRight") || (dir === "y" && e.key === "ArrowDown")) onDrag(step, true);
      }}
      onPointerDown={(e) => {
        start.current = dir === "x" ? e.clientX : e.clientY;
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (start.current === null) return;
        const p = dir === "x" ? e.clientX : e.clientY;
        onDrag(p - start.current);
        start.current = p;
      }}
      onPointerUp={() => {
        start.current = null;
        onDrag(0, true);
      }}
      className={cn(
        "group relative z-10 shrink-0 touch-none outline-none",
        dir === "x" ? "w-1.5 cursor-col-resize" : "h-1.5 cursor-row-resize",
        className,
      )}
    >
      <span className={cn("absolute bg-line transition-colors group-hover:bg-accent group-focus-visible:bg-accent", dir === "x" ? "inset-y-0 left-1/2 w-px -translate-x-1/2" : "inset-x-0 top-1/2 h-px -translate-y-1/2")} />
    </div>
  );
}

export function Empty({ icon: Icon, title, children, action }: { icon?: LucideIcon; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      {Icon && (
        <span className="mb-1 inline-flex size-11 items-center justify-center rounded-lg border border-line bg-paper">
          <Icon aria-hidden className="size-5 text-ink-3" />
        </span>
      )}
      <p className="text-sm font-medium text-ink">{title}</p>
      {children && <div className="max-w-sm text-[13px] leading-relaxed text-ink-3">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Note({ tone = "info", children, className }: { tone?: "info" | "warning" | "danger" | "success"; children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "rounded-md border px-3 py-2 text-[13px] leading-relaxed",
        tone === "info" && "border-line bg-paper text-ink-2",
        tone === "warning" && "border-warning/40 bg-warning/10 text-ink",
        tone === "danger" && "border-danger/40 bg-danger/10 text-ink",
        tone === "success" && "border-success/40 bg-success/10 text-ink",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("font-mono text-[12px] uppercase tracking-[0.08em] text-ink-3", className)}>{children}</span>;
}

/** Breakpoint tiers for the workspace: phones get a one-pane app, tablets fold the sidebar. */
export type Tier = "phone" | "tablet" | "desktop";
const tierOf = () => (typeof window === "undefined" ? "desktop" : window.innerWidth < 768 ? "phone" : window.innerWidth < 1100 ? "tablet" : "desktop");
const subscribe = (cb: () => void) => {
  window.addEventListener("resize", cb);
  return () => window.removeEventListener("resize", cb);
};
export function useTier(): Tier {
  return useSyncExternalStore(subscribe, tierOf, () => "desktop");
}

export const copyText = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text);
    triggerHaptic("success");
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    if (ok) triggerHaptic("success");
    return ok;
  }
};
