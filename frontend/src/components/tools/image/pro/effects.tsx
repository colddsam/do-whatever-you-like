"use client";

import { createElement, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { AnimatePresence, LayoutGroup, motion, MotionConfig } from "motion/react";
import { ChevronDown, ChevronLeft, ChevronRight, Clock, LayoutGrid, Search, X, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { demoParams, groupIcon, groupLabel, opBlurb, opIcon } from "./catalog";
import { ctx2d } from "./doc";
import { scaled, type Op } from "./ops";
import { compose } from "./render";
import type { Doc } from "./types";

/*
 * The Adjust tab: every adjustment and filter as a tile showing *your* picture with that effect,
 * its icon and its name. A chip row jumps between families, search narrows everything, and the
 * effects used last sit at the top. Groups fold open and closed; tiles fade in as their previews
 * arrive. Motion follows the visitor's reduced-motion setting.
 */

const EASE = [0.22, 1, 0.36, 1] as const;
const RECENT_KEY = "dwyl-pro-recent-effects";
const RECENT_MAX = 6;

/* ---------- Recently used (a per-viewer convenience, so browser storage is enough) ---------- */

function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

export function rememberEffect(id: string) {
  try {
    const next = [id, ...readRecent().filter((x) => x !== id)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event(RECENT_KEY));
  } catch {
    // Private windows can refuse storage; the list just stays empty.
  }
}

function useRecent() {
  const [ids, setIds] = useState<string[]>([]);
  useEffect(() => {
    const sync = () => setIds(readRecent());
    sync();
    window.addEventListener(RECENT_KEY, sync);
    return () => window.removeEventListener(RECENT_KEY, sync);
  }, []);
  return ids;
}

/* ---------- Previews: each effect run on a tiny copy of the picture ---------- */

/**
 * Small previews of the whole picture through each operation (with settings that show what it
 * does, not its neutral defaults), drawn a few per frame and redrawn a moment after the picture
 * changes. Returns JPEG data URLs keyed by operation id.
 */
export function useEffectPreviews(doc: Doc | null, ops: Op[], ctx: { fg: string; bg: string }) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const ctxRef = useRef(ctx);
  useLayoutEffect(() => {
    ctxRef.current = ctx;
  });
  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    const t = setTimeout(() => {
      const k = Math.min(1, 132 / Math.max(doc.w, doc.h));
      const small = compose(doc, { rect: { x: 0, y: 0, w: doc.w, h: doc.h }, scale: k });
      const g = ctx2d(small, true);
      const base = g.getImageData(0, 0, small.width, small.height);
      const out: Record<string, string> = {};
      let i = 0;
      const step = () => {
        if (cancelled) return;
        const t0 = performance.now();
        // A small time budget per frame keeps scrolling and typing smooth while previews fill in.
        while (i < ops.length && performance.now() - t0 < 12) {
          const op = ops[i++];
          try {
            const img = new ImageData(new Uint8ClampedArray(base.data), base.width, base.height);
            const res = op.apply(img, scaled(op, demoParams(op), k), { scale: k, ...ctxRef.current }) ?? img;
            g.putImageData(res, 0, 0);
            out[op.id] = small.toDataURL("image/jpeg", 0.82);
          } catch {
            // One preview failing never blocks the rest; that tile keeps its icon.
          }
        }
        setUrls({ ...out });
        if (i < ops.length) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [doc, ops]);
  return urls;
}

/* ---------- One tile ---------- */

/** An operation's icon (a static lucide component looked up by id). */
function OpGlyph({ op, ...props }: { op: Op } & ComponentProps<typeof Zap>) {
  return createElement(opIcon(op), props);
}

function Tile({ op, preview, active, onPick, index }: { op: Op; preview?: string; active: boolean; onPick: (op: Op) => void; index: number }) {
  return (
    <motion.button
      layout
      type="button"
      onClick={() => onPick(op)}
      aria-pressed={active}
      title={`${op.label}: ${opBlurb(op)}${op.instant ? " (applies in one tap)" : ""}`}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.28, ease: EASE, delay: Math.min(index * 0.018, 0.22) }}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.97 }}
      className={cn("group relative flex min-w-0 flex-col overflow-hidden rounded-sm border bg-surface text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/40", active ? "border-ink" : "border-line hover:border-ink-3")}
    >
      <span className="relative block aspect-[4/3] overflow-hidden bg-paper-2">
        <AnimatePresence initial={false}>
          {preview ? (
            <motion.img key="p" src={preview} alt="" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }} className="absolute inset-0 size-full object-cover transition-transform duration-500 group-hover:scale-[1.06]" />
          ) : (
            <motion.span key="i" exit={{ opacity: 0 }} className="absolute inset-0 flex items-center justify-center text-ink-3">
              <OpGlyph op={op} aria-hidden className="size-6" strokeWidth={1.5} />
            </motion.span>
          )}
        </AnimatePresence>
        {/* The effect's icon, always readable over the picture. */}
        <span className={cn("absolute bottom-1 left-1 flex size-6 items-center justify-center rounded-full shadow-card transition-colors", active ? "bg-accent text-paper" : "bg-ink/85 text-paper")}>
          <OpGlyph op={op} aria-hidden className="size-3.5" strokeWidth={2} />
        </span>
        {op.instant && (
          <span title="One tap" className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-surface/90 text-accent shadow-card">
            <Zap aria-hidden className="size-3" fill="currentColor" />
          </span>
        )}
        {active && <motion.span layoutId="pro-effect-active" aria-hidden className="absolute inset-0 rounded-[inherit] ring-2 ring-inset ring-ink" transition={{ duration: 0.3, ease: EASE }} />}
      </span>
      <span className={cn("line-clamp-2 flex min-h-[34px] items-center px-1.5 py-1 text-[12px] leading-tight", active ? "font-medium text-ink" : "text-ink-2 group-hover:text-ink")}>{op.label.replace(/\//g, "/​")}</span>
    </motion.button>
  );
}

/* ---------- The browser ---------- */

type Section = { group: string; ops: Op[] };

export function EffectsBrowser({ sections, active, onPick, previews }: { sections: Section[]; active: string | null; onPick: (op: Op) => void; previews: Record<string, string> }) {
  const [q, setQ] = useState("");
  const [chip, setChip] = useState<string>("all");
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const recentIds = useRecent();
  const searchRef = useRef<HTMLInputElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const chipsRef = useRef<HTMLDivElement>(null);
  // Pinned: the search bar has scrolled up to the top of the panel (it gets a shadow then).
  const [stuck, setStuck] = useState(false);
  // Which ends of the chip row have more chips past them (those edges fade).
  const [edges, setEdges] = useState({ l: false, r: false });
  // Mouse drag-to-scroll on the chip row (touch and trackpads scroll it natively).
  const chipDrag = useRef<{ x: number; left: number; moved: boolean; id: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const scrollChips = (dir: -1 | 1) => {
    const row = chipsRef.current;
    if (row) row.scrollBy({ left: dir * Math.max(120, row.clientWidth * 0.7), behavior: "smooth" });
  };
  /** Centres a chip in the row (never scrolls the page or the panel, unlike scrollIntoView). */
  const centreChip = (el: HTMLElement) => {
    const row = chipsRef.current;
    if (row) row.scrollTo({ left: el.offsetLeft - (row.clientWidth - el.offsetWidth) / 2, behavior: "smooth" });
  };
  const all = useMemo(() => sections.flatMap((s) => s.ops), [sections]);
  const query = q.trim().toLowerCase();

  const recent = recentIds.map((id) => all.find((o) => o.id === id)).filter((o): o is Op => !!o);
  const shown: Section[] = (() => {
    if (query)
      return sections
        .map((s) => ({ ...s, ops: s.ops.filter((o) => `${o.label} ${opBlurb(o)} ${groupLabel(s.group)} ${s.group}`.toLowerCase().includes(query)) }))
        .filter((s) => s.ops.length);
    if (chip === "recent") return recent.length ? [{ group: "Recent", ops: recent }] : [];
    if (chip !== "all") return sections.filter((s) => s.group === chip);
    return recent.length ? [{ group: "Recent", ops: recent }, ...sections] : sections;
  })();
  const count = shown.reduce((n, s) => n + s.ops.length, 0);

  const chips = [{ id: "all", label: "All", icon: LayoutGrid }, ...(recent.length ? [{ id: "recent", label: "Recent", icon: Clock }] : []), ...sections.map((s) => ({ id: s.group, label: groupLabel(s.group), icon: groupIcon(s.group) }))];
  const toggle = (g: string) =>
    setClosed((c) => {
      const n = new Set(c);
      if (n.has(g)) n.delete(g);
      else n.add(g);
      return n;
    });

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const root = el.closest<HTMLElement>(".overflow-y-auto");
    const io = new IntersectionObserver(([e]) => setStuck(!e.isIntersecting), { root, threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const row = chipsRef.current;
    if (!row) return;
    const measure = () => setEdges({ l: row.scrollLeft > 2, r: row.scrollLeft + row.clientWidth < row.scrollWidth - 2 });
    // A mouse wheel scrolls the chips sideways (no horizontal wheel on most mice).
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || row.scrollWidth <= row.clientWidth) return;
      e.preventDefault();
      row.scrollLeft += e.deltaY;
    };
    measure();
    row.addEventListener("scroll", measure, { passive: true });
    row.addEventListener("wheel", onWheel, { passive: false });
    const ro = new ResizeObserver(measure);
    ro.observe(row);
    return () => {
      row.removeEventListener("scroll", measure);
      row.removeEventListener("wheel", onWheel);
      ro.disconnect();
    };
  }, [chips.length]);

  // "/" jumps to the search box, as on the rest of the site's lists.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== "/" || (t && /INPUT|TEXTAREA|SELECT/.test(t.tagName))) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      <div>
        <div ref={sentinelRef} aria-hidden className="h-px" />
        {/* Search and family chips stay pinned while the tiles scroll under them, with room above
            the search once pinned and a soft shadow so the tiles read as passing underneath. */}
        <div
          className={cn(
            "sticky top-0 z-10 -mx-3 -mt-3 space-y-2.5 border-b bg-surface/95 px-3 pb-2.5 pt-3 backdrop-blur transition-[border-color,box-shadow] duration-200",
            stuck ? "border-line shadow-[0_8px_16px_-12px_rgb(21_20_15/0.35)]" : "border-transparent",
          )}
        >
          <label className="relative block">
            <span className="sr-only">Search effects</span>
            <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
            <input
              ref={searchRef}
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setQ("");
                if (e.key === "Enter" && shown[0]?.ops[0]) onPick(shown[0].ops[0]);
              }}
              placeholder={`Search ${all.length} effects  ( / )`}
              className="h-9 w-full rounded-md border border-line bg-paper pl-8 pr-8 text-[13px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-ink focus:bg-surface focus:ring-2 focus:ring-accent/20 [&::-webkit-search-cancel-button]:hidden"
            />
            <AnimatePresence>
              {q && (
                <motion.button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => (setQ(""), searchRef.current?.focus())}
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.6 }}
                  className="absolute right-1.5 top-1/2 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-sm text-ink-3 hover:bg-paper-2 hover:text-ink"
                >
                  <X aria-hidden className="size-3.5" />
                </motion.button>
              )}
            </AnimatePresence>
          </label>
          <LayoutGroup id="effect-chips">
            <div className="relative -mx-3">
              <div
                ref={chipsRef}
                role="tablist"
                aria-label="Effect families"
                aria-orientation="horizontal"
                className={cn(
                  "flex gap-1 overflow-x-auto px-3 py-0.5 [scrollbar-width:none] [touch-action:pan-x] [&::-webkit-scrollbar]:hidden",
                  dragging ? "cursor-grabbing select-none" : "cursor-grab",
                )}
                style={{
                  maskImage: `linear-gradient(to right, transparent, #000 ${edges.l ? 40 : 0}px, #000 calc(100% - ${edges.r ? 44 : 0}px), transparent)`,
                  WebkitMaskImage: `linear-gradient(to right, transparent, #000 ${edges.l ? 40 : 0}px, #000 calc(100% - ${edges.r ? 44 : 0}px), transparent)`,
                }}
                onPointerDown={(e) => {
                  if (e.pointerType !== "mouse" || e.button !== 0) return;
                  chipDrag.current = { x: e.clientX, left: e.currentTarget.scrollLeft, moved: false, id: e.pointerId };
                }}
                onPointerMove={(e) => {
                  const d = chipDrag.current;
                  if (!d || d.id !== e.pointerId) return;
                  const dx = e.clientX - d.x;
                  if (!d.moved && Math.abs(dx) < 5) return;
                  if (!d.moved) {
                    d.moved = true;
                    setDragging(true);
                    e.currentTarget.setPointerCapture(e.pointerId);
                  }
                  e.currentTarget.scrollLeft = d.left - dx;
                }}
                onPointerUp={() => {
                  // Keep a finished drag around for one click, so onClickCapture can swallow it.
                  if (!chipDrag.current?.moved) chipDrag.current = null;
                  setDragging(false);
                }}
                onPointerCancel={() => {
                  chipDrag.current = null;
                  setDragging(false);
                }}
                onClickCapture={(e) => {
                  // A drag ends with a click on whichever chip is under the pointer: ignore that one.
                  if (chipDrag.current?.moved) {
                    e.preventDefault();
                    e.stopPropagation();
                  }
                  chipDrag.current = null;
                }}
                onKeyDown={(e) => {
                  if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
                  const tabs = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("[role=tab]"));
                  const i = tabs.indexOf(document.activeElement as HTMLElement);
                  const next = tabs[Math.min(tabs.length - 1, Math.max(0, i + (e.key === "ArrowRight" ? 1 : -1)))];
                  if (!next) return;
                  e.preventDefault();
                  next.focus({ preventScroll: true });
                  centreChip(next);
                }}
                data-lenis-prevent
              >
                {chips.map((c) => {
                  const on = !query && chip === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      role="tab"
                      aria-selected={on}
                      onClick={(e) => {
                        setQ("");
                        setChip(c.id);
                        centreChip(e.currentTarget);
                      }}
                      onDragStart={(e) => e.preventDefault()}
                      className={cn("relative inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[12px] transition-colors", on ? "text-paper" : "text-ink-2 hover:bg-paper-2 hover:text-ink")}
                    >
                      {on && <motion.span layoutId="effect-chip" aria-hidden className="absolute inset-0 rounded-full bg-ink" transition={{ type: "spring", bounce: 0.2, duration: 0.4 }} />}
                      <c.icon aria-hidden className="relative size-3.5" />
                      <span className="relative whitespace-nowrap">{c.label}</span>
                    </button>
                  );
                })}
                <span aria-hidden className="w-6 shrink-0" />
              </div>
              {/* Arrows at the ends whenever more chips are hidden that way. */}
              <AnimatePresence>
                {edges.l && (
                  <motion.button
                    key="l"
                    type="button"
                    aria-label="Show earlier families"
                    onClick={() => scrollChips(-1)}
                    initial={{ opacity: 0, x: -4 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -4 }}
                    transition={{ duration: 0.15 }}
                    className="absolute left-1.5 top-1/2 z-10 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-surface text-ink-2 shadow-card transition-colors hover:border-ink-3 hover:text-ink"
                  >
                    <ChevronLeft aria-hidden className="size-4" />
                  </motion.button>
                )}
                {edges.r && (
                  <motion.button
                    key="r"
                    type="button"
                    aria-label="Show more families"
                    onClick={() => scrollChips(1)}
                    initial={{ opacity: 0, x: 4 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 4 }}
                    transition={{ duration: 0.15 }}
                    className="absolute right-1.5 top-1/2 z-10 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-surface text-ink-2 shadow-card transition-colors hover:border-ink-3 hover:text-ink"
                  >
                    <ChevronRight aria-hidden className="size-4" />
                  </motion.button>
                )}
              </AnimatePresence>
            </div>
          </LayoutGroup>
        </div>

        <p aria-live="polite" className="sr-only">
          {count} effects shown
        </p>

        <div className="space-y-1 pt-2">
          <AnimatePresence mode="popLayout" initial={false}>
            {shown.map((s) => {
              const GroupIcon = s.group === "Recent" ? Clock : groupIcon(s.group);
              const open = !!query || chip !== "all" || !closed.has(s.group);
              return (
                <motion.section key={`${s.group}`} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} aria-label={groupLabel(s.group)}>
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => toggle(s.group)}
                    disabled={!!query || chip !== "all"}
                    className="group/head flex h-9 w-full items-center gap-2 rounded-sm text-left text-ink-2 transition-colors hover:text-ink disabled:cursor-default disabled:hover:text-ink-2"
                  >
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-sm bg-paper-2 text-ink-2 transition-colors group-hover/head:bg-ink group-hover/head:text-paper group-disabled/head:bg-paper-2 group-disabled/head:text-ink-2">
                      <GroupIcon aria-hidden className="size-3.5" />
                    </span>
                    <span className="label-mono shrink-0 text-ink">{s.group === "Recent" ? "Recently used" : groupLabel(s.group)}</span>
                    <span className="inline-flex h-5 shrink-0 items-center rounded-full border border-line px-1.5 font-mono text-[12px] tabular-nums text-ink-3">{s.ops.length}</span>
                    {/* A hairline to the edge, the worksheet's section rule. */}
                    <span aria-hidden className="h-px min-w-3 flex-1 bg-line" />
                    {!query && chip === "all" && <ChevronDown aria-hidden className={cn("size-4 shrink-0 text-ink-3 transition-transform duration-300", !open && "-rotate-90")} />}
                  </button>
                  <AnimatePresence initial={false}>
                    {open && (
                      <motion.div key="grid" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: EASE }} className="overflow-hidden">
                        <div className="grid grid-cols-3 gap-1.5 pb-3 pt-1">
                          {s.ops.map((op, i) => (
                            <Tile key={`${s.group}:${op.id}`} op={op} index={i} preview={previews[op.id]} active={active === op.id} onPick={onPick} />
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.section>
              );
            })}
          </AnimatePresence>
          {!count && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="py-10 text-center">
              <Search aria-hidden className="mx-auto mb-2 size-5 text-ink-3" />
              <p className="text-[13px] text-ink-2">{query ? <>Nothing matches “{q}”.</> : "Nothing used yet."}</p>
              <p className="mt-1 text-[12px] text-ink-3">Try “blur”, “warm”, “vintage” or “black”.</p>
            </motion.div>
          )}
        </div>
      </div>
    </MotionConfig>
  );
}
