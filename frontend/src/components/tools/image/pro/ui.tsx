"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronLeft, ChevronRight, Menu as MenuGlyph, Pipette, RotateCcw, X, type LucideIcon } from "lucide-react";
import { RichColorPicker } from "@/components/tools/design/rich-color-picker";
import { cn } from "@/lib/utils";

/*
 * Small controls for the pro editor. They use the site's tokens (paper, ink, line, accent) and the
 * same shapes as the rest of the toolbox, just denser: the editor is a workspace, not a form.
 */

export type MenuItem =
  | { type?: "item"; label: string; shortcut?: string; onSelect: () => void; disabled?: boolean; checked?: boolean; icon?: LucideIcon }
  | { type: "sep" }
  | { type: "sub"; label: string; items: MenuItem[]; disabled?: boolean; icon?: LucideIcon };

/** Menus, flyouts and their submenus carry this attribute, so "click outside" knows what's inside. */
export const FLOAT_ATTR = "data-pro-float";
export const insideFloat = (t: EventTarget | null) => t instanceof Element && !!t.closest(`[${FLOAT_ATTR}]`);

/**
 * Something that floats next to an anchor (a dropdown, a submenu, a tool flyout). It's portalled to
 * <body> and positioned in viewport pixels, so scrolling or clipped containers (the menu bar scrolls
 * sideways on phones) can never cut it off, and it's nudged back on screen near the edges.
 */
export function Floating({
  anchor,
  side,
  children,
  className,
  role,
  onKeyDown,
  floatRef,
}: {
  anchor: HTMLElement;
  side: "below" | "above" | "right";
  children: React.ReactNode;
  className?: string;
  role?: string;
  onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
  floatRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const own = useRef<HTMLDivElement>(null);
  const ref = floatRef ?? own;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const place = () => {
      const a = anchor.getBoundingClientRect();
      const W = window.innerWidth;
      const H = window.innerHeight;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      let x = side === "right" ? a.right + 2 : a.left;
      let y = side === "below" ? a.bottom + 4 : side === "above" ? a.top - h - 4 : a.top - 4;
      // A submenu with no room on the right opens to the left instead.
      if (side === "right" && x + w > W - 8) x = Math.max(8, a.left - w - 2);
      x = Math.min(Math.max(8, x), Math.max(8, W - w - 8));
      if (side === "above" && y < 8) y = a.bottom + 4;
      y = Math.min(Math.max(8, y), Math.max(8, H - h - 8));
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      el.style.maxHeight = `${H - 16}px`;
      el.style.visibility = "visible";
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor, side, ref]);
  if (typeof document === "undefined") return null;
  return createPortal(
    <motion.div
      ref={ref}
      role={role}
      {...{ [FLOAT_ATTR]: "" }}
      onKeyDown={onKeyDown}
      initial={{ opacity: 0, y: side === "above" ? 4 : side === "below" ? -4 : 0, x: side === "right" ? -4 : 0 }}
      animate={{ opacity: 1, y: 0, x: 0 }}
      transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
      style={{ position: "fixed", left: 0, top: 0, visibility: "hidden" }}
      className={cn("z-[130] overflow-y-auto overscroll-contain", className)}
      data-lenis-prevent
    >
      {children}
    </motion.div>,
    document.body,
  );
}

/** One dropdown: the item list, with keyboard support and submenus. */
function MenuList({ items, onClose, anchor, side }: { items: MenuItem[]; onClose: () => void; anchor: HTMLElement; side: "below" | "above" | "right" }) {
  const ref = useRef<HTMLDivElement>(null);
  const [sub, setSub] = useState<{ i: number; el: HTMLElement } | null>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("[role=menuitem]:not([disabled])")?.focus({ preventScroll: true });
  }, []);
  const move = (dir: 1 | -1) => {
    const all = Array.from(ref.current?.querySelectorAll<HTMLElement>(":scope > [role=menuitem]:not([disabled])") ?? []);
    const i = all.indexOf(document.activeElement as HTMLElement);
    all[(i + dir + all.length) % all.length]?.focus();
  };
  return (
    <Floating
      floatRef={ref}
      anchor={anchor}
      side={side}
      role="menu"
      onKeyDown={(e) => {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          move(1);
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          move(-1);
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
      className="min-w-56 rounded-md border border-line bg-surface p-1 shadow-float"
    >
      {items.map((it, i) => {
        if (it.type === "sep") return <div key={i} role="separator" className="my-1 h-px bg-line" />;
        if (it.type === "sub")
          return (
            // The submenu floats on its own, so it stays open while the pointer travels to it;
            // pointing at any other item closes it.
            <div key={i} onMouseEnter={(e) => !it.disabled && sub?.i !== i && setSub({ i, el: e.currentTarget })}>
              <button
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={sub?.i === i}
                disabled={it.disabled}
                onClick={(e) => setSub(sub?.i === i ? null : { i, el: e.currentTarget.parentElement! })}
                onKeyDown={(e) => {
                  if (e.key !== "ArrowRight") return;
                  e.preventDefault();
                  setSub({ i, el: e.currentTarget.parentElement! });
                }}
                className="flex h-8 w-full items-center gap-2 rounded-sm px-2.5 text-left text-[13px] text-ink-2 outline-none hover:bg-paper-2 hover:text-ink focus-visible:bg-paper-2 focus-visible:text-ink disabled:opacity-40"
              >
                <span aria-hidden className="flex size-3.5 shrink-0 items-center">{it.icon && <it.icon className="size-3.5" />}</span>
                <span className="flex-1 truncate">{it.label}</span>
                <ChevronRight aria-hidden className="size-3.5 text-ink-3" />
              </button>
              {sub?.i === i && (
                <MenuList
                  items={it.items}
                  anchor={sub.el}
                  side="right"
                  onClose={() => {
                    setSub(null);
                    onClose();
                  }}
                />
              )}
            </div>
          );
        return (
          <button
            key={i}
            type="button"
            role="menuitem"
            disabled={it.disabled}
            onMouseEnter={() => sub && setSub(null)}
            onClick={() => {
              onClose();
              it.onSelect();
            }}
            className="flex h-8 w-full items-center gap-2 rounded-sm px-2.5 text-left text-[13px] text-ink-2 outline-none hover:bg-paper-2 hover:text-ink focus-visible:bg-paper-2 focus-visible:text-ink disabled:opacity-40"
          >
            <span className="flex size-3.5 shrink-0 items-center">{it.checked ? <Check aria-hidden className="size-3.5" /> : it.icon ? <it.icon aria-hidden className="size-3.5" /> : null}</span>
            <span className="flex-1 truncate">{it.label}</span>
            {it.shortcut && <span className="font-mono text-[12px] text-ink-3">{it.shortcut}</span>}
          </button>
        );
      })}
    </Floating>
  );
}

/**
 * On narrow screens the seven menus don't fit side by side: one "Menu" button opens them as
 * submenus instead (nothing is hidden off the edge).
 */
export function CompactMenu({ menus }: { menus: { label: string; items: MenuItem[] }[] }) {
  const [open, setOpen] = useState<HTMLElement | null>(null);
  const [stack, setStack] = useState<{ title: string; items: MenuItem[] }[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node) && !insideFloat(e.target)) {
        setOpen(null);
        setStack([]);
      }
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);
  const top = stack[stack.length - 1];
  const closeAll = () => {
    setOpen(null);
    setStack([]);
  };
  return (
    <div ref={ref}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={!!open}
        onClick={(e) => {
          if (open) closeAll();
          else {
            setStack([]);
            setOpen(e.currentTarget);
          }
        }}
        className={cn("inline-flex h-8 items-center gap-1.5 rounded-sm px-2.5 text-[13px] transition-colors", open ? "bg-ink text-paper" : "text-ink-2 hover:bg-paper-2 hover:text-ink")}
      >
        <MenuGlyph aria-hidden className="size-4" /> Menu
      </button>
      {open && (
        <Floating
          anchor={open}
          side="below"
          role="menu"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              if (stack.length > 0) setStack((s) => s.slice(0, -1));
              else closeAll();
            }
          }}
          className="w-[min(280px,calc(100vw-24px))] rounded-md border border-line bg-surface p-1 shadow-float"
        >
          {top ? (
            <>
              <button
                type="button"
                onClick={() => setStack((s) => s.slice(0, -1))}
                className="flex h-9 w-full items-center gap-1.5 rounded-sm border-b border-line px-2 text-left text-[13px] font-medium text-ink hover:bg-paper-2"
              >
                <ChevronLeft aria-hidden className="size-4 shrink-0 text-ink-3" />
                <span className="truncate">{top.title}</span>
              </button>
              <div className="pt-1">
                {top.items.map((it, i) => {
                  if (it.type === "sep") return <div key={i} role="separator" className="my-1 h-px bg-line" />;
                  if (it.type === "sub")
                    return (
                      <button
                        key={i}
                        type="button"
                        role="menuitem"
                        disabled={it.disabled}
                        onClick={() => setStack((s) => [...s, { title: it.label, items: it.items }])}
                        className="flex h-9 w-full items-center gap-2 rounded-sm px-2.5 text-left text-[13px] text-ink-2 hover:bg-paper-2 hover:text-ink disabled:opacity-40"
                      >
                        <span aria-hidden className="flex size-3.5 shrink-0 items-center">{it.icon && <it.icon className="size-3.5" />}</span>
                        <span className="flex-1 truncate">{it.label}</span>
                        <ChevronRight aria-hidden className="size-3.5 text-ink-3" />
                      </button>
                    );
                  return (
                    <button
                      key={i}
                      type="button"
                      role="menuitem"
                      disabled={it.disabled}
                      onClick={() => {
                        closeAll();
                        it.onSelect();
                      }}
                      className="flex h-9 w-full items-center gap-2 rounded-sm px-2.5 text-left text-[13px] text-ink-2 hover:bg-paper-2 hover:text-ink disabled:opacity-40"
                    >
                      <span className="flex size-3.5 shrink-0 items-center">{it.checked ? <Check aria-hidden className="size-3.5" /> : it.icon ? <it.icon aria-hidden className="size-3.5" /> : null}</span>
                      <span className="flex-1 truncate">{it.label}</span>
                      {it.shortcut && <span className="hidden font-mono text-[12px] text-ink-3 sm:inline">{it.shortcut}</span>}
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            menus.map((m) => (
              <button
                key={m.label}
                type="button"
                role="menuitem"
                onClick={() => setStack([{ title: m.label, items: m.items }])}
                className="flex h-9 w-full items-center justify-between gap-2 rounded-sm px-2.5 text-left text-[13px] text-ink-2 hover:bg-paper-2 hover:text-ink"
              >
                <span className="truncate font-medium text-ink">{m.label}</span>
                <ChevronRight aria-hidden className="size-4 text-ink-3" />
              </button>
            ))
          )}
        </Floating>
      )}
    </div>
  );
}

/** The menu bar: File, Edit, Image… Hovering moves between open menus, like a desktop app. */
export function MenuBar({ menus }: { menus: { label: string; items: MenuItem[] }[] }) {
  const [open, setOpen] = useState<{ i: number; el: HTMLElement } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open === null) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && !insideFloat(e.target) && setOpen(null);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);
  return (
    <div ref={ref} role="menubar" className="flex items-center">
      {menus.map((m, i) => (
        <div key={m.label}>
          <button
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={open?.i === i}
            onClick={(e) => setOpen(open?.i === i ? null : { i, el: e.currentTarget })}
            onMouseEnter={(e) => open !== null && open.i !== i && setOpen({ i, el: e.currentTarget })}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") (e.currentTarget.parentElement?.nextElementSibling?.querySelector("button") as HTMLElement | null)?.focus();
              if (e.key === "ArrowLeft") (e.currentTarget.parentElement?.previousElementSibling?.querySelector("button") as HTMLElement | null)?.focus();
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setOpen({ i, el: e.currentTarget });
              }
            }}
            className={cn(
              "h-8 shrink-0 whitespace-nowrap rounded-sm px-2.5 text-[13px] transition-colors",
              open?.i === i ? "bg-ink text-paper" : "text-ink-2 hover:bg-paper-2 hover:text-ink",
            )}
          >
            {m.label}
          </button>
          {open?.i === i && <MenuList items={m.items} anchor={open.el} side="below" onClose={() => setOpen(null)} />}
        </div>
      ))}
    </div>
  );
}

/** A button that opens a small menu (layer panel's "new adjustment layer", blend modes on phones). */
export function MenuButton({ label, items, children, className }: { label: string; items: MenuItem[]; children: React.ReactNode; className?: string }) {
  const [open, setOpen] = useState<HTMLElement | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && !insideFloat(e.target) && setOpen(null);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);
  return (
    <div ref={ref}>
      <button type="button" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={!!open} onClick={(e) => setOpen(open ? null : e.currentTarget)} className={className}>
        {children}
      </button>
      {open && <MenuList items={items} anchor={open} side="above" onClose={() => setOpen(null)} />}
    </div>
  );
}

export function IconBtn({
  label,
  onClick,
  active,
  disabled,
  children,
  className,
  shortcut,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
  className?: string;
  shortcut?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={shortcut ? `${label} (${shortcut})` : label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-sm transition-colors disabled:opacity-35",
        active ? "bg-ink text-paper" : "text-ink-2 hover:bg-paper-2 hover:text-ink",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** A compact number box with a label, for option bars and dialogs. Drag the label to scrub. */
export function NumField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
  width = "w-16",
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  width?: string;
}) {
  const id = useId();
  const [text, setText] = useState(String(value));
  // Follow the value when it changes from outside (scrubbing, another control).
  const [shownFor, setShownFor] = useState(value);
  if (value !== shownFor) {
    setShownFor(value);
    setText(String(Math.round(value * 100) / 100));
  }
  const fix = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
  const scrub = useRef<{ x: number; v: number } | null>(null);
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5">
      <label
        htmlFor={id}
        className="cursor-ew-resize select-none text-[12px] text-ink-3"
        onPointerDown={(e) => {
          scrub.current = { x: e.clientX, v: value };
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!scrub.current) return;
          onChange(fix(Math.round((scrub.current.v + ((e.clientX - scrub.current.x) / 2) * step) / step) * step));
        }}
        onPointerUp={() => (scrub.current = null)}
      >
        {label}
      </label>
      <span className="relative inline-flex">
        <input
          id={id}
          inputMode="decimal"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            const n = Number(text);
            if (Number.isFinite(n)) onChange(fix(n));
            else setText(String(value));
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              e.preventDefault();
              onChange(fix(value + (e.key === "ArrowUp" ? 1 : -1) * step * (e.shiftKey ? 10 : 1)));
            }
          }}
          className={cn("h-7 rounded-sm border border-line bg-surface px-1.5 font-mono text-[12px] text-ink outline-none focus:border-ink focus:ring-2 focus:ring-accent/20", width, unit && "pr-5")}
        />
        {unit && <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 font-mono text-[12px] text-ink-3">{unit}</span>}
      </span>
    </span>
  );
}

/** A colour square that opens a rich HSV/HEX/RGB/HSL/Swatches popover, with optional inline hex. */
export function ColorWell({
  value,
  onChange,
  label,
  hex,
  size = "size-7",
  onEyedropper,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  hex?: boolean;
  size?: string;
  onEyedropper?: () => void;
}) {
  const id = useId();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [prevColor, setPrevColor] = useState(value);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!anchor) return;
    const close = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node) && !insideFloat(e.target)) setAnchor(null);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setAnchor(null);
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [anchor]);

  return (
    <div ref={wrapRef} className="inline-flex items-center">
      <button
        id={id}
        type="button"
        title={label}
        aria-label={label}
        aria-expanded={!!anchor}
        onClick={(e) => {
          if (anchor) setAnchor(null);
          else {
            setPrevColor(value);
            setAnchor(e.currentTarget);
          }
        }}
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span className={cn("rounded-sm border border-line shadow-[inset_0_0_0_1px_rgb(255_255_255/0.6)]", size)} style={{ background: value }} />
        {hex && <span className="font-mono text-[12px] uppercase text-ink-2">{value}</span>}
      </button>
      {anchor && (
        <Floating anchor={anchor} side="below" role="dialog" className="w-64 rounded-md border border-line bg-surface p-2.5 shadow-float">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="label-mono truncate text-ink-3">{label}</span>
            <button type="button" onClick={() => setAnchor(null)} aria-label="Close colour picker" className="inline-flex size-6 items-center justify-center rounded-sm text-ink-3 hover:bg-paper-2 hover:text-ink">
              <X aria-hidden className="size-3.5" />
            </button>
          </div>
          <RichColorPicker
            compact
            value={value}
            previous={prevColor}
            onChange={onChange}
            onEyedropper={
              onEyedropper
                ? () => {
                    setAnchor(null);
                    onEyedropper();
                  }
                : undefined
            }
            actions={
              onEyedropper ? undefined : (
                <div className="flex items-center justify-between gap-2">
                  <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-ink-3 hover:text-ink">
                    <Pipette aria-hidden className="size-3" />
                    <span>Native OS picker</span>
                    <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#000000"} onChange={(e) => onChange(e.target.value)} className="sr-only" />
                  </label>
                  <button type="button" onClick={() => setAnchor(null)} className="h-6 rounded-sm bg-ink px-2.5 text-[11px] font-medium text-paper">
                    Done
                  </button>
                </div>
              )
            }
          />
        </Floating>
      )}
    </div>
  );
}

export function Select<T extends string>({ value, onChange, options, label, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string; className?: string }) {
  return (
    <select
      aria-label={label}
      title={label}
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className={cn("h-7 rounded-sm border border-line bg-surface px-1.5 text-[12px] text-ink outline-none focus:border-ink", className)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Check2({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 text-[12px] text-ink-2">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-3.5 accent-ink" />
      {label}
    </label>
  );
}

/** A modal dialog over the editor (portalled, so it works in full screen too). */
export function Dialog({
  open,
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>("input,select,textarea,button:not([data-close])")?.focus());
    return () => prev?.focus?.();
  }, [open]);
  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[120] flex items-end justify-center bg-ink/30 p-3 backdrop-blur-[2px] sm:items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onPointerDown={(e) => e.target === e.currentTarget && onClose()}
          data-lenis-prevent
        >
          <motion.div
            ref={ref}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                onClose();
              }
            }}
            initial={{ y: 12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 8, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className={cn("flex max-h-[88vh] w-full flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-float", wide ? "max-w-2xl" : "max-w-md")}
          >
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <h2 className="text-[15px] font-medium text-ink">{title}</h2>
              <button type="button" data-close aria-label="Close" onClick={onClose} className="inline-flex size-8 items-center justify-center rounded-sm text-ink-2 hover:bg-paper-2 hover:text-ink">
                <X aria-hidden className="size-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>
            {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-paper/50 px-4 py-3">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export function Btn({
  children,
  onClick,
  primary,
  disabled,
  className,
  type = "button",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  primary?: boolean;
  disabled?: boolean;
  className?: string;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3.5 text-[13px] font-medium transition-[background-color,border-color,transform] active:translate-y-px disabled:opacity-40",
        primary ? "bg-ink text-paper hover:bg-ink/85" : "border border-line bg-surface text-ink-2 hover:border-ink-3 hover:text-ink",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** A labelled range for panels: label and value on one line, slider under it. */
export function RangeRow({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  unit = "",
  signed,
  def,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  unit?: string;
  signed?: boolean;
  /** The neutral value: marked on the track; a changed slider shows its value in the accent and a reset. */
  def?: number;
}) {
  const id = useId();
  const home = def ?? (min < 0 && max > 0 ? 0 : min);
  const changed = def !== undefined && Math.abs(value - def) > 1e-9;
  const shown = `${signed && value > 0 ? "+" : ""}${Math.round(value * 100) / 100}${unit}`;
  const pct = (v: number) => ((Math.min(max, Math.max(min, v)) - min) / (max - min || 1)) * 100;
  // The fill runs from the neutral point to the value, so +/− sliders fill outwards from the middle.
  const a = Math.min(pct(home), pct(value));
  const b = Math.max(pct(home), pct(value));
  return (
    <div className="group/range py-1">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className={cn("text-[12px] transition-colors", changed ? "text-ink" : "text-ink-2")}>
          {label}
        </label>
        <span className="flex items-center gap-1">
          <AnimatePresence>
            {changed && (
              <motion.button
                type="button"
                aria-label={`Reset ${label}`}
                title="Reset"
                onClick={() => onChange(home)}
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.6 }}
                transition={{ duration: 0.15 }}
                className="inline-flex size-5 items-center justify-center rounded-sm text-ink-3 hover:bg-paper-2 hover:text-ink"
              >
                <RotateCcw aria-hidden className="size-3" />
              </motion.button>
            )}
          </AnimatePresence>
          <button type="button" title="Double-click to reset" onDoubleClick={() => onChange(home)} className={cn("min-w-9 text-right font-mono text-[12px] tabular-nums transition-colors", changed ? "text-accent" : "text-ink")}>
            {shown}
          </button>
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={() => onChange(home)}
        style={{ "--a": `${a}%`, "--b": `${b}%`, "--h": `${pct(home)}%` } as React.CSSProperties}
        className="pro-range h-6 w-full cursor-pointer"
      />
    </div>
  );
}
