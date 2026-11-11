"use client";

import { useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowDownUp,
  ArrowLeft,
  ArrowRight,
  Check,
  GripVertical,
  Plus,
  RotateCcw,
  RotateCw,
  Trash2,
  Undo2,
} from "lucide-react";
import { formatBytes } from "@/lib/media";
import { arrangeFresh, pagesLabel, thumbUrl, turn, type ArrangedPage } from "@/lib/pdf";
import { cn } from "@/lib/utils";

const EASE = [0.22, 1, 0.36, 1] as const;
const SLIDE = { type: "spring", bounce: 0.18, duration: 0.45 } as const;
const pad = (n: number) => String(n).padStart(2, "0");
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Pages in a grid that grows with the workbench: ~3 across on a phone, 6–7 on a laptop. */
const GRID = "grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-2 sm:grid-cols-[repeat(auto-fill,minmax(104px,1fr))] sm:gap-3";

/* ---------- One page ---------- */

/**
 * A page of the uploaded PDF, drawn on the server. Sits in a 3:4 frame; a quarter turn scales
 * it to 75% so a turned page still fits the frame. While it loads, the frame shows its number.
 */
export function PageImage({
  token,
  page,
  spin = 0,
  rot = 0,
  className,
}: {
  token: string;
  page: number;
  /** Total degrees turned, for the animation (270 → 360 turns forward, not back). */
  spin?: number;
  rot?: number;
  className?: string;
}) {
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const quarter = rot % 180 !== 0;
  return (
    <span className={cn("relative block aspect-[3/4] overflow-hidden rounded-[4px] bg-paper-2", className)}>
      {state !== "ready" && (
        <span
          aria-hidden
          className={cn(
            "absolute inset-0 flex items-center justify-center font-mono text-[11px] text-ink-3",
            state === "loading" && "animate-pulse",
          )}
        >
          {state === "failed" ? "—" : page}
        </span>
      )}
      <motion.img
        key={token}
        src={thumbUrl(token, page)}
        alt=""
        loading="lazy"
        decoding="async"
        draggable={false}
        onLoad={() => setState("ready")}
        onError={() => setState("failed")}
        initial={false}
        animate={{ rotate: spin, scale: quarter ? 0.75 : 1, opacity: state === "ready" ? 1 : 0 }}
        transition={{ rotate: { duration: 0.45, ease: EASE }, scale: { duration: 0.45, ease: EASE }, opacity: { duration: 0.3 } }}
        className="absolute inset-0 size-full object-contain p-1"
      />
    </span>
  );
}

/* ---------- Organize ---------- */

type BoardProps = {
  token: string;
  pageCount: number;
  pages: ArrangedPage[];
  locked: boolean;
  onChange: (pages: ArrangedPage[]) => void;
};

/**
 * Organize: every page of the PDF in its new order. Pick pages (click, Space, or Shift/Ctrl for
 * several), then rotate, move or remove them from the toolbar; or drag one to a new place. Removed
 * pages wait in a tray below and go back where they came from.
 */
export function OrganizeBoard({ token, pageCount, pages, locked, onChange }: BoardProps) {
  const hintId = useId();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const anchor = useRef<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const tiles = useRef(new Map<string, HTMLLIElement>());
  const drag = useRef<{ key: string; x: number; y: number; active: boolean; last: string | null } | null>(null);
  const justDragged = useRef(false);

  // Forget selections of pages that are gone (removed, or a new PDF).
  const live = pages.filter((p) => selected.has(p.key));
  const sel = new Set(live.map((p) => p.key));
  const removed = arrangeFresh(pageCount).filter((f) => !pages.some((p) => p.page === f.page));
  const tabKey = focusKey && pages.some((p) => p.key === focusKey) ? focusKey : pages[0]?.key;

  const focusTile = (key: string | undefined) => {
    if (!key) return;
    setFocusKey(key);
    requestAnimationFrame(() => tiles.current.get(key)?.focus({ preventScroll: false }));
  };

  /* --- edits --- */

  const rotate = (by: 90 | -90, only?: string) => {
    const keys = only ? new Set([only]) : sel;
    if (!keys.size) return;
    onChange(pages.map((p) => (keys.has(p.key) ? { ...p, rot: turn(p.rot, by), spin: (p.spin ?? 0) + by } : p)));
    setAnnounce(`${plural(keys.size, "page")} turned ${by > 0 ? "right" : "left"}.`);
  };

  /** Moves the chosen pages one place earlier or later, keeping their order. */
  const shift = (dir: -1 | 1, only?: string) => {
    const keys = only ? new Set([only]) : sel;
    if (!keys.size) return;
    const next = [...pages];
    const order = dir < 0 ? next.map((_, i) => i) : next.map((_, i) => next.length - 1 - i);
    let moved = false;
    for (const i of order) {
      const j = i + dir;
      if (!keys.has(next[i].key) || j < 0 || j >= next.length || keys.has(next[j].key)) continue;
      [next[i], next[j]] = [next[j], next[i]];
      moved = true;
    }
    if (!moved) return;
    onChange(next);
    const first = next.findIndex((p) => keys.has(p.key));
    setAnnounce(
      keys.size === 1
        ? `Page ${next[first].page} is now at position ${first + 1} of ${next.length}.`
        : `${plural(keys.size, "page")} moved ${dir < 0 ? "earlier" : "later"}.`,
    );
  };

  const remove = (only?: string) => {
    const keys = only ? new Set([only]) : sel;
    if (!keys.size) return;
    if (keys.size >= pages.length) {
      setAnnounce("Keep at least one page.");
      return;
    }
    const idx = pages.findIndex((p) => keys.has(p.key));
    const next = pages.filter((p) => !keys.has(p.key));
    onChange(next);
    setSelected(new Set());
    setAnnounce(`${plural(keys.size, "page")} removed. Restore ${keys.size === 1 ? "it" : "them"} from the tray below.`);
    focusTile(next[Math.min(idx, next.length - 1)]?.key);
  };

  /** Puts a removed page back before the first kept page that came after it in the original. */
  const restore = (page: number) => {
    const fresh = { key: `p${page}`, page, rot: 0 as const, spin: 0 };
    const at = pages.findIndex((p) => p.page > page);
    const next = [...pages];
    next.splice(at < 0 ? next.length : at, 0, fresh);
    onChange(next);
    setAnnounce(`Page ${page} restored at position ${(at < 0 ? next.length : at + 1)}.`);
  };

  const restoreAll = () => {
    const next = [...pages];
    for (const r of removed) {
      const at = next.findIndex((p) => p.page > r.page);
      next.splice(at < 0 ? next.length : at, 0, { ...r, spin: 0 });
    }
    onChange(next);
    setAnnounce(`${plural(removed.length, "page")} restored.`);
  };

  const reverse = () => {
    onChange([...pages].reverse());
    setAnnounce("Page order reversed.");
  };

  const resetAll = () => {
    onChange(arrangeFresh(pageCount));
    setSelected(new Set());
    setAnnounce("Back to the original order, nothing turned or removed.");
  };

  /* --- selection --- */

  /** A click or Space picks a page or puts it back (so several can be picked on touch too); Shift adds a run. */
  const toggle = (key: string, shiftKey = false) => {
    const from = anchor.current;
    const run =
      shiftKey && from && pages.some((p) => p.key === from)
        ? (() => {
            const a = pages.findIndex((p) => p.key === from);
            const b = pages.findIndex((p) => p.key === key);
            return pages.slice(Math.min(a, b), Math.max(a, b) + 1).map((p) => p.key);
          })()
        : null;
    if (!run) anchor.current = key;
    // Functional, so quick successive clicks never work from a stale selection.
    setSelected((prev) => {
      const next = new Set([...prev].filter((k) => pages.some((p) => p.key === k)));
      if (run) run.forEach((k) => next.add(k));
      else if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setFocusKey(key);
  };

  /* --- dragging: mouse anywhere on a page, touch/pen by the grip --- */

  const moveTo = (key: string, to: number) => {
    const from = pages.findIndex((p) => p.key === key);
    if (from < 0 || to < 0 || to >= pages.length || from === to) return;
    const next = [...pages];
    const [it] = next.splice(from, 1);
    next.splice(to, 0, it);
    onChange(next);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLLIElement>, key: string) => {
    if (locked || e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    const grip = (e.target as HTMLElement).closest("[data-grip]");
    if (e.pointerType !== "mouse" && !grip) return;
    drag.current = { key, x: e.clientX, y: e.clientY, active: false, last: null };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (!d.active) {
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) return;
      d.active = true;
      setDragging(d.key);
    }
    const box = scroller.current?.getBoundingClientRect();
    if (box) {
      if (e.clientY < box.top + 40) scroller.current!.scrollBy({ top: -14 });
      else if (e.clientY > box.bottom - 40) scroller.current!.scrollBy({ top: 14 });
    }
    const over = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>(
      "[data-page-key]",
    )?.dataset.pageKey;
    // While a page slides out from under the pointer it's still "under" it; ignore it until the
    // pointer moves onto something else, so pages don't flip back and forth.
    if (!over || over === d.key) {
      if (over === d.key) d.last = null;
      return;
    }
    if (over === d.last) return;
    d.last = over;
    moveTo(d.key, pages.findIndex((p) => p.key === over));
  };

  const endDrag = () => {
    const d = drag.current;
    drag.current = null;
    if (!d?.active) return;
    justDragged.current = true;
    setTimeout(() => (justDragged.current = false), 0);
    setDragging(null);
    const at = pages.findIndex((p) => p.key === d.key);
    setAnnounce(`Page ${pages[at]?.page} dropped at position ${at + 1} of ${pages.length}.`);
  };

  /* --- keyboard: arrows move focus, Space picks, Alt+arrows move, R turns, Delete removes --- */

  const columns = () => {
    const els = pages.map((p) => tiles.current.get(p.key)).filter(Boolean) as HTMLLIElement[];
    if (els.length < 2) return 1;
    const top = els[0].offsetTop;
    const n = els.findIndex((el) => el.offsetTop !== top);
    return n < 0 ? els.length : n;
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLLIElement>, key: string, i: number) => {
    if (e.target !== e.currentTarget || locked) return;
    const step =
      e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" ? -columns() : e.key === "ArrowDown" ? columns() : 0;
    if (step) {
      e.preventDefault();
      if (e.altKey) {
        moveTo(key, Math.min(Math.max(i + step, 0), pages.length - 1));
        const to = Math.min(Math.max(i + step, 0), pages.length - 1);
        setAnnounce(`Page ${pages[i].page} moved to position ${to + 1} of ${pages.length}.`);
        focusTile(key);
      } else {
        focusTile(pages[Math.min(Math.max(i + step, 0), pages.length - 1)]?.key);
      }
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      focusTile(pages[e.key === "Home" ? 0 : pages.length - 1]?.key);
    } else if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      toggle(key, e.shiftKey);
    } else if (e.key === "r" || e.key === "R") {
      e.preventDefault();
      rotate(e.shiftKey ? -90 : 90, sel.has(key) ? undefined : key);
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      remove(sel.has(key) ? undefined : key);
    } else if (e.key === "Escape") {
      setSelected(new Set());
    } else if ((e.key === "a" || e.key === "A") && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      setSelected(new Set(pages.map((p) => p.key)));
    }
  };

  // Drop any half-finished drag if the board is locked mid-way (a job started).
  useEffect(() => {
    if (locked) drag.current = null;
  }, [locked]);

  const selCount = sel.size;
  const allSelected = selCount === pages.length && pages.length > 0;
  const first = pages.findIndex((p) => sel.has(p.key));
  const last = pages.length - 1 - [...pages].reverse().findIndex((p) => sel.has(p.key));
  const turned = pages.filter((p) => p.rot).length;

  return (
    <div>
      {/* What's picked, and whole-document actions. */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-line pb-2.5">
        <p className="label-mono min-w-0 text-ink-3" aria-live="polite">
          {selCount ? (
            <span className="text-ink">{plural(selCount, "page")} picked</span>
          ) : (
            <>
              {plural(pages.length, "page")}
              {removed.length ? ` · ${removed.length} removed` : ""}
              {turned ? ` · ${turned} turned` : ""}
            </>
          )}
        </p>
        <div className="flex items-center gap-3 text-xs">
          <button
            type="button"
            disabled={locked}
            onClick={() => setSelected(allSelected ? new Set() : new Set(pages.map((p) => p.key)))}
            className="text-ink-3 underline-offset-4 hover:text-ink hover:underline disabled:opacity-40"
          >
            {allSelected ? "Unpick all" : "Pick all"}
          </button>
          <button
            type="button"
            disabled={locked || pages.length < 2}
            onClick={reverse}
            className="inline-flex items-center gap-1 text-ink-3 underline-offset-4 hover:text-ink hover:underline disabled:opacity-40"
          >
            <ArrowDownUp aria-hidden className="size-3" /> Reverse
          </button>
          <button
            type="button"
            disabled={locked}
            onClick={resetAll}
            className="inline-flex items-center gap-1 text-ink-3 underline-offset-4 hover:text-ink hover:underline disabled:opacity-40"
          >
            <Undo2 aria-hidden className="size-3" /> Reset
          </button>
        </div>
      </div>

      <div
        role="toolbar"
        aria-label="Change the picked pages"
        className="mt-2.5 flex flex-wrap items-center gap-1.5"
      >
        <ToolButton label="Turn left" icon={RotateCcw} disabled={locked || !selCount} onClick={() => rotate(-90)} />
        <ToolButton label="Turn right" icon={RotateCw} disabled={locked || !selCount} onClick={() => rotate(90)} />
        <span aria-hidden className="mx-0.5 h-5 w-px bg-line" />
        <ToolButton label="Earlier" icon={ArrowLeft} disabled={locked || !selCount || first <= 0} onClick={() => shift(-1)} />
        <ToolButton
          label="Later"
          icon={ArrowRight}
          disabled={locked || !selCount || last >= pages.length - 1}
          onClick={() => shift(1)}
        />
        <span aria-hidden className="mx-0.5 h-5 w-px bg-line" />
        <ToolButton
          label="Remove"
          icon={Trash2}
          disabled={locked || !selCount || selCount >= pages.length}
          onClick={() => remove()}
        />
      </div>
      <p id={hintId} className="mt-2 text-xs text-ink-3">
        <span className="max-sm:hidden">
          Click pages to pick them (Shift for a run), then use the buttons. Drag a page to move it. Keys: arrows, Space to
          pick, Alt + arrows to move, R to turn, Delete to remove.
        </span>
        <span className="sm:hidden">Tap pages to pick them, then use the buttons. Drag a page by its grip to move it.</span>
      </p>

      <div
        ref={scroller}
        className="relative mt-3 max-h-[min(64vh,560px)] overflow-y-auto overscroll-contain rounded-md border border-line bg-paper p-2 sm:p-3"
      >
        <ol
          role="listbox"
          aria-multiselectable
          aria-label="Pages in their new order"
          aria-describedby={hintId}
          className={cn(GRID, dragging && "cursor-grabbing")}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          {pages.map((p, i) => {
            const picked = sel.has(p.key);
            const isDrag = dragging === p.key;
            const moved = p.page !== i + 1;
            return (
              <motion.li
                key={p.key}
                ref={(el) => {
                  if (el) tiles.current.set(p.key, el);
                  else tiles.current.delete(p.key);
                }}
                layout
                transition={SLIDE}
                data-page-key={p.key}
                role="option"
                tabIndex={p.key === tabKey ? 0 : -1}
                aria-selected={picked}
                aria-label={`Position ${i + 1}: page ${p.page}${p.rot ? `, turned ${p.rot}°` : ""}${picked ? ", picked" : ""}`}
                onFocus={() => setFocusKey(p.key)}
                onPointerDown={(e) => onPointerDown(e, p.key)}
                onClick={(e) => {
                  if (locked || justDragged.current) return;
                  toggle(p.key, e.shiftKey);
                }}
                onKeyDown={(e) => onKeyDown(e, p.key, i)}
                className={cn(
                  "group relative cursor-pointer select-none rounded-md border bg-surface p-1 outline-none transition-[border-color,box-shadow] duration-150",
                  "focus-visible:ring-4 focus-visible:ring-accent/25",
                  picked ? "border-ink ring-1 ring-ink" : "border-line hover:border-ink-3",
                  isDrag && "z-10 shadow-card",
                  locked && "pointer-events-none opacity-60",
                )}
                animate={{ scale: isDrag ? 1.04 : 1 }}
              >
                <PageImage token={token} page={p.page} rot={p.rot} spin={p.spin ?? 0} />

                {/* New position, top-left. Ink when picked. */}
                <span
                  className={cn(
                    "absolute left-1.5 top-1.5 inline-flex h-5 items-center rounded-[4px] px-1 font-mono text-[11px] font-medium tabular-nums",
                    picked ? "bg-ink text-paper" : "border border-line bg-surface/95 text-ink",
                  )}
                >
                  {picked ? <Check aria-hidden className="mr-0.5 size-3" /> : null}
                  {pad(i + 1)}
                </span>
                {p.rot ? (
                  <span className="absolute right-1.5 top-1.5 inline-flex h-5 items-center rounded-[4px] border border-line bg-surface/95 px-1 font-mono text-[10px] text-ink-2">
                    {p.rot}°
                  </span>
                ) : null}

                <span className="mt-1 flex h-6 items-center justify-between gap-1 px-0.5">
                  <span className={cn("truncate font-mono text-[11px]", moved ? "text-ink" : "text-ink-3")}>
                    p. {p.page}
                  </span>
                  <span
                    data-grip
                    aria-hidden
                    className="-mr-1 flex h-6 w-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-[4px] text-ink-3 hover:bg-paper-2 hover:text-ink active:cursor-grabbing"
                  >
                    <GripVertical className="size-3.5" />
                  </span>
                </span>
              </motion.li>
            );
          })}
        </ol>
      </div>
      <p className="sr-only" aria-live="assertive">
        {announce}
      </p>

      {/* Removed pages wait here; each goes back where it came from. */}
      <AnimatePresence initial={false}>
        {removed.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto", transition: { duration: 0.4, ease: EASE } }}
            exit={{ opacity: 0, height: 0, transition: { duration: 0.2 } }}
            className="overflow-hidden"
          >
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <p className="label-mono mr-1 text-ink-3">Removed</p>
              {removed.map((r) => (
                <button
                  key={r.page}
                  type="button"
                  disabled={locked}
                  onClick={() => restore(r.page)}
                  title={`Put page ${r.page} back`}
                  className="inline-flex h-8 items-center gap-1 rounded-sm border border-dashed border-line bg-surface px-2 font-mono text-xs text-ink-3 line-through decoration-ink-3/60 transition-colors hover:border-ink-3 hover:text-ink hover:no-underline"
                >
                  p. {r.page}
                  <Plus aria-hidden className="size-3" />
                </button>
              ))}
              {removed.length > 1 && (
                <button
                  type="button"
                  disabled={locked}
                  onClick={restoreAll}
                  className="ml-1 text-xs text-ink-3 underline-offset-4 hover:text-ink hover:underline"
                >
                  Restore all
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ToolButton({
  label,
  icon: Icon,
  disabled,
  onClick,
}: {
  label: string;
  icon: typeof RotateCw;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-sm border border-line bg-surface px-2.5 text-sm text-ink-2 transition-colors duration-150 hover:border-ink-3 hover:text-ink disabled:pointer-events-none disabled:opacity-40 sm:h-9"
    >
      <Icon aria-hidden className="size-4" />
      <span className="max-sm:hidden">{label}</span>
    </button>
  );
}

/* ---------- Split: pick which pages go together ---------- */

/**
 * The page grid under split's range field. Each page wears the number of the part it lands in;
 * clicking a page puts it in the part you're filling (or takes it out). Pages in no part are left
 * out. Edits are written back to the range field, so both always agree.
 */
export function SplitPicker({
  token,
  pageCount,
  groups,
  locked,
  sizes,
  onChange,
}: {
  token: string;
  pageCount: number;
  /** Pages per part (1-based), from the range field. */
  groups: number[][];
  locked: boolean;
  /** Size of each part, once measured. */
  sizes: (number | undefined)[];
  onChange: (groups: number[][]) => void;
}) {
  const [active, setActive] = useState(0);
  const last = useRef<number | null>(null);
  const current = Math.min(active, groups.length); // groups.length = "a new part"
  const isNew = current === groups.length;

  const partsOf = (page: number) => groups.flatMap((g, i) => (g.includes(page) ? [i] : []));
  const leftOut = Array.from({ length: pageCount }, (_, i) => i + 1).filter((p) => !partsOf(p).length).length;

  const click = (page: number, e: React.MouseEvent) => {
    if (locked) return;
    const next = groups.map((g) => [...g]);
    if (current === next.length) next.push([]);
    const into = next[current];

    const run =
      e.shiftKey && last.current !== null
        ? Array.from({ length: Math.abs(page - last.current) + 1 }, (_, i) => Math.min(page, last.current!) + i)
        : [page];
    const taking = !e.shiftKey && into.includes(page);
    last.current = page;

    for (let gi = 0; gi < next.length; gi++) {
      // A page goes in one part only: moving it here takes it out of the others.
      next[gi] = next[gi].filter((p) => !run.includes(p));
    }
    if (!taking) next[current] = [...next[current], ...run].sort((a, b) => a - b);

    // Dropping an emptied part shifts the parts after it; keep filling the same one.
    const emptyBefore = next.slice(0, current).filter((g) => !g.length).length;
    setActive(current - emptyBefore);
    onChange(next.filter((g) => g.length));
  };

  const removePart = (i: number) => {
    onChange(groups.filter((_, gi) => gi !== i));
    setActive((a) => (a > i ? a - 1 : a === i ? Math.max(0, i - 1) : a));
  };

  return (
    <div className="mt-3">
      {/* The parts you'll get. One is being filled (ink); "New part" starts another. */}
      <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Part you're filling">
        {groups.map((g, i) => (
          <span key={i} className="inline-flex">
            <button
              type="button"
              role="radio"
              aria-checked={current === i}
              disabled={locked}
              onClick={() => setActive(i)}
              className={cn(
                "inline-flex h-9 items-center gap-1.5 rounded-l-sm border px-2.5 text-sm transition-colors duration-150",
                current === i
                  ? "border-ink bg-ink text-paper"
                  : "border-line bg-surface text-ink-2 hover:border-ink-3 hover:text-ink",
              )}
            >
              <span className={cn("font-mono text-[11px]", current === i ? "text-paper-dim" : "text-ink-3")}>
                {pad(i + 1)}
              </span>
              <span className="max-w-[14rem] truncate">{pagesLabel(g)}</span>
              {sizes[i] !== undefined && (
                <span className={cn("font-mono text-[11px]", current === i ? "text-paper-dim" : "text-ink-3")}>
                  {formatBytes(sizes[i]!)}
                </span>
              )}
            </button>
            <button
              type="button"
              disabled={locked}
              onClick={() => removePart(i)}
              aria-label={`Remove part ${i + 1}`}
              title={`Remove part ${i + 1}`}
              className={cn(
                "inline-flex h-9 w-7 items-center justify-center rounded-r-sm border border-l-0 text-xs transition-colors",
                current === i
                  ? "border-ink bg-ink text-paper-dim hover:text-paper"
                  : "border-line bg-surface text-ink-3 hover:text-ink",
              )}
            >
              ×
            </button>
          </span>
        ))}
        <button
          type="button"
          role="radio"
          aria-checked={isNew}
          disabled={locked}
          onClick={() => setActive(groups.length)}
          className={cn(
            "inline-flex h-9 items-center gap-1 rounded-sm border border-dashed px-2.5 text-sm transition-colors duration-150",
            isNew ? "border-ink text-ink" : "border-line text-ink-3 hover:border-ink-3 hover:text-ink",
          )}
        >
          <Plus aria-hidden className="size-3.5" /> {groups.length ? "New part" : "First part"}
        </button>
      </div>

      <p className="mt-2 text-xs text-ink-3" aria-live="polite">
        {isNew ? (
          <>Click pages to start part {pad(current + 1)}.</>
        ) : (
          <>
            Click pages to add them to part {pad(current + 1)}, or take them out.
          </>
        )}{" "}
        <span className="max-sm:hidden">Shift-click adds a run. </span>
        {leftOut > 0 && groups.length > 0 ? `${plural(leftOut, "page")} in no part ${leftOut === 1 ? "is" : "are"} left out.` : ""}
      </p>

      <div
        className="mt-2.5 max-h-[min(56vh,480px)] overflow-y-auto overscroll-contain rounded-md border border-line bg-paper p-2 sm:p-3"
      >
        <ol className={GRID} aria-label="Pages of your PDF">
          {Array.from({ length: pageCount }, (_, i) => i + 1).map((page) => {
            const parts = partsOf(page);
            const inActive = parts.includes(current);
            const out = parts.length === 0 && groups.length > 0;
            return (
              <li key={page}>
                <button
                  type="button"
                  disabled={locked}
                  aria-pressed={inActive}
                  aria-label={`Page ${page}${parts.length ? `, in part ${parts.map((p) => p + 1).join(" and ")}` : out ? ", left out" : ""}`}
                  onClick={(e) => click(page, e)}
                  className={cn(
                    "relative block w-full rounded-md border bg-surface p-1 text-left outline-none transition-[border-color,opacity,box-shadow] duration-150",
                    "focus-visible:ring-4 focus-visible:ring-accent/25",
                    inActive ? "border-ink ring-1 ring-ink" : "border-line hover:border-ink-3",
                    out && "opacity-45 hover:opacity-80",
                  )}
                >
                  <PageImage token={token} page={page} />
                  {parts.length > 0 && (
                    <span className="absolute left-1.5 top-1.5 flex gap-0.5">
                      {parts.map((pi) => (
                        <span
                          key={pi}
                          className={cn(
                            "inline-flex h-5 items-center rounded-[4px] px-1 font-mono text-[11px] font-medium",
                            pi === current ? "bg-ink text-paper" : "border border-line bg-surface/95 text-ink",
                          )}
                        >
                          {pad(pi + 1)}
                        </span>
                      ))}
                    </span>
                  )}
                  <span className="mt-1 flex h-5 items-center justify-between px-0.5">
                    <span className="font-mono text-[11px] text-ink-3">p. {page}</span>
                    {out && <span className="label-mono text-[9px] text-ink-3">out</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
