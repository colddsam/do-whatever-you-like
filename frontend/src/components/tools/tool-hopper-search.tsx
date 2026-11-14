"use client";

import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "motion/react";
import { ArrowRight, ArrowUpRight, CornerDownLeft, Search, Sparkles, X } from "lucide-react";
import { clusterOf, getCluster, toolHref, tools, toolsIn, type ClusterId } from "@/lib/tools";
import { analyzeTaskQuery, type ScoredToolMatch, type TaskSuggestion } from "@/lib/tool-search";
import { Kbd, SignalDot } from "@/components/ui/primitives";
import { getLenis } from "@/lib/smooth-scroll";
import { cn } from "@/lib/utils";

const EASE = [0.22, 1, 0.36, 1] as const;
const SPRING = { type: "spring", stiffness: 460, damping: 36, mass: 0.7 } as const;
const noopSubscribe = () => () => {};

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
    return true;
  }
  return Boolean(target.closest("[contenteditable='true'], .cm-editor, .monaco-editor"));
}

export type ToolHopperSearchProps = {
  /** `"directory"` renders the full /tools filter bar; `"compact"` renders a breadcrumb trigger for /tools/[id] & categories. */
  mode: "directory" | "compact";
  query?: string;
  onQueryChange?: (q: string) => void;
  currentToolId?: string;
  contextClusterId?: ClusterId;
  matchCount?: number;
};

/**
 * Animated, Google-style task search & quick tool-hopper for `/tools`, `/tools/[id]` and category pages.
 * Never obscures workspaces or toolbars: inline at the top, auto-condenses to a discreet floating pill on
 * scroll, and opens a spring-animated Spotlight overlay on click, `/` or `⌘K`.
 */
export function ToolHopperSearch({
  mode,
  query: controlledQuery,
  onQueryChange,
  currentToolId,
  contextClusterId,
  matchCount,
}: ToolHopperSearchProps) {
  const pathname = usePathname();
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const listboxId = useId();
  const isMac = useSyncExternalStore(
    noopSubscribe,
    () => /Mac|iPhone|iPad/.test(navigator.platform),
    () => true,
  );

  const [innerQuery, setInnerQuery] = useState("");
  const query = controlledQuery ?? innerQuery;
  const setQuery = (next: string) => {
    if (controlledQuery === undefined) setInnerQuery(next);
    onQueryChange?.(next);
  };

  const [inlineFocused, setInlineFocused] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [scrolledPast, setScrolledPast] = useState(false);
  const [scrollingDown, setScrollingDown] = useState(false);
  const [pillHovered, setPillHovered] = useState(false);
  const [active, setActive] = useState(0);

  // Close transient overlays automatically on navigation or query change without effects.
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (prevPathname !== pathname) {
    setPrevPathname(pathname);
    setModalOpen(false);
    setInlineFocused(false);
    setScrolledPast(false);
    setScrollingDown(false);
  }

  const [prevQuery, setPrevQuery] = useState(query);
  if (prevQuery !== query) {
    setPrevQuery(query);
    setActive(0);
  }

  const anchorRef = useRef<HTMLDivElement>(null);
  const inlineWrapperRef = useRef<HTMLDivElement>(null);
  const inlineInputRef = useRef<HTMLInputElement>(null);
  const modalInputRef = useRef<HTMLInputElement>(null);
  const lastScrollY = useRef(0);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const analysis = useMemo(
    () => analyzeTaskQuery(query, { contextClusterId, currentToolId, limit: 6 }),
    [query, contextClusterId, currentToolId],
  );
  const quickHops = useMemo<ScoredToolMatch[]>(() => {
    const picked = contextClusterId
      ? toolsIn(contextClusterId).filter((t) => t.id !== currentToolId && t.status === "live")
      : tools.filter((t) => t.status === "live");
    return picked.slice(0, 6).map((tool) => {
      const cluster = getCluster(clusterOf(tool));
      return {
        tool,
        score: 1,
        matchReason: `${tool.takes} → ${tool.gives}`,
        cluster,
      };
    });
  }, [contextClusterId, currentToolId]);
  const results = useMemo(() => {
    if (query.trim()) return analysis.results.slice(0, 8);
    return modalOpen ? quickHops : [];
  }, [query, analysis.results, modalOpen, quickHops]);
  const topSuggestion = query.trim() ? analysis.suggestions[0] : undefined;
  const currentCluster = contextClusterId ? getCluster(contextClusterId) : undefined;

  // Detect when the inline trigger scrolls out of view + scroll direction to keep the floating pill subtle.
  useEffect(() => {
    const el = anchorRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        const passed = !entry.isIntersecting && entry.boundingClientRect.top < 80;
        setScrolledPast(passed);
        if (passed) setInlineFocused(false);
      },
      { threshold: 0, rootMargin: "-68px 0px 0px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [pathname]);

  useEffect(() => {
    lastScrollY.current = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      const delta = y - lastScrollY.current;
      if (delta > 6 && y > 120) setScrollingDown(true);
      else if (delta < -6) setScrollingDown(false);
      lastScrollY.current = y;

      if (idleTimer.current) clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(() => setScrollingDown(false), 1200);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, []);

  // Global "/" and "⌘K / Ctrl+K" shortcuts without ever stealing keys inside tool editors or form fields.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isCmdK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";
      const isSlash = e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey && !isEditableTarget(e.target);

      if (!isCmdK && !isSlash) return;
      e.preventDefault();

      if (mode === "directory" && !scrolledPast && !modalOpen) {
        setInlineFocused(true);
        inlineInputRef.current?.focus();
        return;
      }
      setModalOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, scrolledPast, modalOpen]);

  // Dismiss inline dropdown on outside click.
  useEffect(() => {
    if (!inlineFocused) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!inlineWrapperRef.current?.contains(e.target as Node)) {
        setInlineFocused(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [inlineFocused]);

  // Focus input & pause Lenis background wheel when the Spotlight overlay is open.
  useEffect(() => {
    if (!modalOpen) return;
    getLenis()?.stop();
    const raf = requestAnimationFrame(() => modalInputRef.current?.focus());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setModalOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey);
      getLenis()?.start();
    };
  }, [modalOpen]);

  const navigateToTool = (id: string) => {
    setInlineFocused(false);
    setModalOpen(false);
    router.push(toolHref(id));
  };

  const applySuggestion = (s: TaskSuggestion, openIfDirect = false) => {
    if (openIfDirect && s.tool && s.kind === "tool") {
      navigateToTool(s.tool.id);
      return;
    }
    setQuery(s.phrase);
    if (modalOpen) modalInputRef.current?.focus();
    else inlineInputRef.current?.focus();
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, inModal: boolean) => {
    if (e.key === "ArrowDown" && results.length > 0) {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp" && results.length > 0) {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Tab" && topSuggestion && topSuggestion.phrase.toLowerCase() !== query.trim().toLowerCase()) {
      e.preventDefault();
      setQuery(topSuggestion.phrase);
    } else if (e.key === "Enter") {
      if (results[active]) {
        e.preventDefault();
        navigateToTool(results[active].tool.id);
      } else if (analysis.availability.topTool) {
        e.preventDefault();
        navigateToTool(analysis.availability.topTool.id);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (inModal) {
        setModalOpen(false);
      } else if (inlineFocused) {
        setInlineFocused(false);
        inlineInputRef.current?.blur();
      } else if (query) {
        setQuery("");
      }
    }
  };

  const condensedPill = scrolledPast && scrollingDown && !pillHovered;

  return (
    <LayoutGroup>
      {/* Inline top anchor */}
      <div ref={anchorRef} className={mode === "directory" ? "grid md:grid-cols-12 md:gap-8" : "relative"}>
        {mode === "directory" ? (
          <div ref={inlineWrapperRef} className="relative md:col-span-9 md:col-start-4">
            <label
              className={cn(
                "flex h-14 items-center gap-3 rounded-lg border bg-surface px-4 shadow-float transition-[border-color,box-shadow]",
                inlineFocused
                  ? "border-ink ring-4 ring-accent/15"
                  : "border-line hover:border-ink-3 focus-within:border-ink focus-within:ring-4 focus-within:ring-accent/15",
              )}
            >
              <Search aria-hidden className={cn("size-[18px] shrink-0 transition-colors", inlineFocused ? "text-ink" : "text-ink-3")} />
              <span className="sr-only">Search tools or describe a task</span>
              <input
                ref={inlineInputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setInlineFocused(true);
                }}
                onFocus={() => setInlineFocused(true)}
                onKeyDown={(e) => handleInputKeyDown(e, false)}
                placeholder="Describe a task or search: “shrink pdf”, “cut out background”, “epub to pdf”…"
                role="combobox"
                aria-expanded={inlineFocused}
                aria-controls={listboxId}
                aria-activedescendant={results[active] ? `hopper-${results[active].tool.id}` : undefined}
                autoComplete="off"
                spellCheck={false}
                className="h-full min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-3"
              />

              {/* Inline availability indicator + completion hint */}
              <AnimatePresence mode="popLayout" initial={false}>
                {query.trim() ? (
                  <motion.span
                    key={analysis.availability.status}
                    initial={{ opacity: 0, scale: 0.92 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.92 }}
                    transition={{ duration: 0.16, ease: EASE }}
                    className={cn(
                      "label-mono hidden shrink-0 items-center gap-1.5 rounded-sm border px-2 py-0.5 sm:inline-flex",
                      analysis.availability.status === "available" || analysis.availability.status === "converter-route"
                        ? "border-success/25 bg-success/10 text-success"
                        : analysis.availability.status === "coming-soon"
                          ? "border-warning/30 bg-warning/10 text-warning"
                          : "border-line bg-paper text-ink-3",
                    )}
                  >
                    {(analysis.availability.status === "available" || analysis.availability.status === "converter-route") && (
                      <SignalDot />
                    )}
                    {analysis.availability.status === "available" || analysis.availability.status === "converter-route"
                      ? `${matchCount ?? analysis.availability.liveMatches} found`
                      : analysis.availability.status === "coming-soon"
                        ? "Soon"
                        : "Not yet"}
                  </motion.span>
                ) : (
                  <span key="kbd-hint" className="hidden items-center gap-1 sm:inline-flex">
                    <Kbd>/</Kbd>
                  </span>
                )}
              </AnimatePresence>

              {query && (
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    inlineInputRef.current?.focus();
                  }}
                  aria-label="Clear search"
                  className="inline-flex size-8 items-center justify-center rounded-[8px] text-ink-3 transition-colors hover:bg-paper-2 hover:text-ink"
                >
                  <X aria-hidden className="size-4" />
                </button>
              )}
            </label>

            {/* Google-style animated dropdown over /tools only while actively focused */}
            <AnimatePresence>
              {inlineFocused && (
                <motion.div
                  initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.985 }}
                  animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: 0.22, ease: EASE } }}
                  exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.99, transition: { duration: 0.14 } }}
                  data-lenis-prevent
                  className="absolute inset-x-0 top-[calc(100%+8px)] z-40 overflow-hidden rounded-lg border border-line bg-surface shadow-float"
                >
                  <SearchPanelBody
                    listboxId={listboxId}
                    query={query}
                    analysis={analysis}
                    results={results}
                    active={active}
                    onHover={setActive}
                    onApplySuggestion={applySuggestion}
                    onSelectTool={navigateToTool}
                    footerAction={
                      query.trim() && (matchCount ?? results.length) > 0
                        ? {
                            label: `Show all ${matchCount ?? results.length} in directory`,
                            onClick: () => {
                              setInlineFocused(false);
                              inlineInputRef.current?.blur();
                            },
                          }
                        : undefined
                    }
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            aria-label="Search tools or describe a task"
            className="group inline-flex h-9 items-center gap-2 rounded-full border border-line bg-surface px-3 text-xs text-ink-2 shadow-card transition-[border-color,background-color,color] hover:border-ink-3 hover:text-ink"
          >
            <Search aria-hidden className="size-3.5 shrink-0 text-ink-3 transition-colors group-hover:text-ink" />
            <span className="max-sm:hidden">Hop to a tool…</span>
            <span className="sm:hidden">Search</span>
            <Kbd className="max-sm:hidden">/</Kbd>
          </button>
        )}
      </div>

      {/* Floating scroll pill OR expanded Spotlight overlay */}
      <AnimatePresence>
        {modalOpen ? (
          <motion.div
            key="hopper-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { duration: 0.2 } }}
            exit={{ opacity: 0, transition: { duration: 0.16 } }}
            onClick={() => setModalOpen(false)}
            className="fixed inset-0 z-[60] bg-ink/20 backdrop-blur-[2px]"
          >
            <motion.div
              layoutId={reduceMotion ? undefined : "tool-hopper-floating"}
              transition={SPRING}
              role="dialog"
              aria-modal="true"
              aria-label="Search and switch tools"
              data-lenis-prevent
              onClick={(e) => e.stopPropagation()}
              className="mx-auto mt-16 w-[calc(100%-24px)] max-w-2xl overflow-hidden rounded-lg border border-line bg-surface shadow-float md:mt-20"
            >
              <div className="border-b border-line px-4">
                <div className="flex h-14 items-center gap-3">
                  <Search aria-hidden className="size-[18px] shrink-0 text-ink" />
                  <input
                    ref={modalInputRef}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => handleInputKeyDown(e, true)}
                    placeholder={
                      currentCluster
                        ? `Search all tools or ${currentCluster.name.toLowerCase()} tasks…`
                        : "Describe what you want to do, or hop to any tool…"
                    }
                    role="combobox"
                    aria-expanded="true"
                    aria-controls={`${listboxId}-modal`}
                    aria-activedescendant={results[active] ? `hopper-modal-${results[active].tool.id}` : undefined}
                    autoComplete="off"
                    spellCheck={false}
                    className="h-full min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-3"
                  />
                  {query && (
                    <button
                      type="button"
                      onClick={() => {
                        setQuery("");
                        modalInputRef.current?.focus();
                      }}
                      aria-label="Clear search"
                      className="inline-flex size-8 items-center justify-center rounded-[8px] text-ink-3 hover:bg-paper-2 hover:text-ink"
                    >
                      <X aria-hidden className="size-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    aria-label="Close search"
                    className="inline-flex h-8 items-center gap-1 rounded-sm border border-line bg-paper px-2 font-mono text-[11px] text-ink-2 transition-colors hover:border-ink-3 hover:text-ink"
                  >
                    Esc
                  </button>
                </div>
                {currentCluster && !query.trim() && (
                  <p className="label-mono pb-2.5 text-ink-3">
                    Currently in <span className="text-ink">{currentCluster.name}</span> · hop cleanly without losing your place
                  </p>
                )}
              </div>

              <SearchPanelBody
                listboxId={`${listboxId}-modal`}
                idPrefix="hopper-modal-"
                query={query}
                analysis={analysis}
                results={results}
                active={active}
                onHover={setActive}
                onApplySuggestion={applySuggestion}
                onSelectTool={navigateToTool}
                footerAction={
                  mode === "directory" && query.trim() && (matchCount ?? results.length) > 0
                    ? {
                        label: `Show all ${matchCount ?? results.length} on page`,
                        onClick: () => setModalOpen(false),
                      }
                    : {
                        label: "Browse all 9 collections",
                        href: "/tools",
                        onClick: () => setModalOpen(false),
                      }
                }
              />
            </motion.div>
          </motion.div>
        ) : scrolledPast ? (
          <motion.div
            key="hopper-floating-pill"
            layoutId={reduceMotion ? undefined : "tool-hopper-floating"}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.94 }}
            transition={SPRING}
            onMouseEnter={() => setPillHovered(true)}
            onMouseLeave={() => setPillHovered(false)}
            className="fixed bottom-5 right-5 z-[45] flex items-center gap-1 rounded-full border border-line bg-surface/95 p-1 shadow-float backdrop-blur-xl"
          >
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              aria-label="Open tool search"
              className={cn(
                "flex h-9 items-center gap-2 rounded-full text-sm text-ink transition-[padding,background-color] hover:bg-paper-2",
                condensedPill ? "px-2.5" : "pl-3 pr-2.5",
              )}
            >
              <Search aria-hidden className="size-4 shrink-0 text-ink" />
              <AnimatePresence initial={false} mode="popLayout">
                {!condensedPill && (
                  <motion.span
                    key="pill-label"
                    initial={reduceMotion ? false : { opacity: 0, width: 0 }}
                    animate={{ opacity: 1, width: "auto" }}
                    exit={reduceMotion ? undefined : { opacity: 0, width: 0 }}
                    transition={{ duration: 0.2, ease: EASE }}
                    className="overflow-hidden whitespace-nowrap font-medium text-ink"
                  >
                    {query.trim() ? `“${query.trim()}”` : "Hop to tool"}
                  </motion.span>
                )}
              </AnimatePresence>
              {mode === "directory" && query.trim() && matchCount !== undefined ? (
                <span className="label-mono rounded-full bg-ink px-1.5 py-0.5 text-[11px] text-paper">{matchCount}</span>
              ) : (
                <Kbd className="max-sm:hidden">{isMac ? "⌘K" : "/"}</Kbd>
              )}
            </button>
            {mode === "directory" && query.trim() && !condensedPill && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear active filter"
                className="inline-flex size-8 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-paper-2 hover:text-ink"
              >
                <X aria-hidden className="size-3.5" />
              </button>
            )}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </LayoutGroup>
  );
}

function SearchPanelBody({
  listboxId,
  idPrefix = "hopper-",
  query,
  analysis,
  results,
  active,
  onHover,
  onApplySuggestion,
  onSelectTool,
  footerAction,
}: {
  listboxId: string;
  idPrefix?: string;
  query: string;
  analysis: ReturnType<typeof analyzeTaskQuery>;
  results: ScoredToolMatch[];
  active: number;
  onHover: (i: number) => void;
  onApplySuggestion: (s: TaskSuggestion, openIfDirect?: boolean) => void;
  onSelectTool: (id: string) => void;
  footerAction?: { label: string; href?: string; onClick: () => void };
}) {
  const { availability, suggestions } = analysis;
  const trimmed = query.trim();

  return (
    <div>
      {/* Task availability strip */}
      <div className="flex items-center justify-between gap-3 border-b border-line bg-paper/60 px-4 py-2.5">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={`${availability.status}-${trimmed ? "q" : "idle"}`}
            initial={{ opacity: 0, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -3 }}
            transition={{ duration: 0.16, ease: EASE }}
            className="flex min-w-0 items-center gap-2 text-xs"
          >
            {(availability.status === "available" || availability.status === "converter-route") && <SignalDot pulse />}
            <span
              className={cn(
                "label-mono shrink-0 font-medium",
                availability.status === "available" || availability.status === "converter-route"
                  ? "text-success"
                  : availability.status === "coming-soon"
                    ? "text-warning"
                    : "text-ink-2",
              )}
            >
              {availability.label}
            </span>
            <span className="truncate text-ink-3">· {availability.detail}</span>
          </motion.div>
        </AnimatePresence>

        {availability.status === "unavailable" && trimmed && (
          <Link
            href={`/?idea=${encodeURIComponent(trimmed)}#request`}
            onClick={footerAction?.onClick}
            className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-line bg-surface px-2.5 py-1 text-xs font-medium text-ink transition-colors hover:border-ink-3"
          >
            Request it <ArrowUpRight aria-hidden className="size-3" />
          </Link>
        )}
      </div>

      {/* Google-style animated query / task suggestions */}
      {suggestions.length > 0 && (
        <div className="border-b border-line px-2 py-2">
          <p className="label-mono flex items-center gap-1.5 px-2 pb-1 text-ink-3">
            <Sparkles aria-hidden className="size-3 text-accent" />
            {trimmed ? "Suggested tasks & completions" : "Popular tasks you can try"}
          </p>
          <div className="grid grid-cols-1 gap-0.5 sm:grid-cols-2">
            {suggestions.slice(0, 6).map((s, idx) => (
              <motion.button
                key={s.id}
                type="button"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18, ease: EASE, delay: idx * 0.02 }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onApplySuggestion(s, true)}
                className="group flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-paper-2"
              >
                <Search aria-hidden className="size-3.5 shrink-0 text-ink-3 group-hover:text-ink" />
                <span className="min-w-0 flex-1 truncate">
                  {s.matchedPrefix ? (
                    <>
                      <span className="text-ink-3">{s.matchedPrefix}</span>
                      <span className="font-semibold text-ink">{s.completion}</span>
                    </>
                  ) : (
                    <span className="text-ink-2 group-hover:text-ink">{s.phrase}</span>
                  )}
                </span>
                {s.cluster && (
                  <span className="label-mono shrink-0 text-[10px] text-ink-3">{s.cluster.name}</span>
                )}
              </motion.button>
            ))}
          </div>
        </div>
      )}

      {/* Ranked tool matches */}
      <ul
        id={listboxId}
        role="listbox"
        aria-label="Matching tools"
        className="max-h-[300px] overflow-y-auto overscroll-contain p-2"
      >
        {trimmed && results.length === 0 && (
          <li className="px-3 py-8 text-center">
            <p className="text-sm text-ink-2">
              No tool in our toolbox handles <span className="font-medium text-ink">“{trimmed}”</span> yet.
            </p>
            <p className="mt-1 text-xs text-ink-3">
              Try simpler task words (e.g. “compress pdf”, “cut background”, “epub to pdf”) or ask us to add it.
            </p>
            <Link
              href={`/?idea=${encodeURIComponent(trimmed)}#request`}
              className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-ink underline decoration-line underline-offset-4 hover:decoration-ink"
            >
              Request “{trimmed}” <ArrowRight aria-hidden className="size-3.5" />
            </Link>
          </li>
        )}

        {results.map(({ tool, matchReason, cluster }, i) => {
          const Icon = tool.icon;
          const isActive = i === active;
          return (
            <motion.li
              key={tool.id}
              id={`${idPrefix}${tool.id}`}
              role="option"
              aria-selected={isActive}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.16, ease: EASE, delay: Math.min(i, 6) * 0.018 }}
              onMouseEnter={() => onHover(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onSelectTool(tool.id)}
              className="relative flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2.5"
            >
              {isActive && (
                <motion.span
                  aria-hidden
                  layoutId={`${idPrefix}active-row`}
                  transition={{ type: "spring", stiffness: 520, damping: 40, mass: 0.6 }}
                  className="absolute inset-0 rounded-md bg-paper-2"
                />
              )}
              <span
                className={cn(
                  "relative flex size-8 shrink-0 items-center justify-center rounded-sm border transition-colors",
                  isActive ? "border-ink bg-ink text-paper" : "border-line bg-paper text-ink-2",
                )}
              >
                <Icon aria-hidden className="size-4" />
              </span>
              <span className="relative min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-ink">{tool.name}</span>
                  <span className="label-mono shrink-0 text-[10px] text-ink-3">{cluster.name}</span>
                </span>
                <span className="block truncate text-xs text-ink-3">
                  {matchReason ? `${matchReason} · ${tool.description}` : tool.description}
                </span>
              </span>
              {tool.status === "live" ? (
                <span className="label-mono relative flex shrink-0 items-center gap-1.5 text-ink">
                  <SignalDot /> Live
                </span>
              ) : (
                <span className="label-mono relative shrink-0 text-ink-3">Soon</span>
              )}
              <span className={cn("relative hidden w-5 justify-end sm:flex", !isActive && "invisible")}>
                <CornerDownLeft aria-hidden className="size-3.5 text-ink-2" />
              </span>
            </motion.li>
          );
        })}
      </ul>

      {/* Footer */}
      <div className="flex items-center justify-between gap-3 border-t border-line bg-paper/60 px-4 py-2 text-xs text-ink-3">
        <div className="hidden items-center gap-3 sm:flex">
          <span className="flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> pick
          </span>
          <span className="flex items-center gap-1">
            <Kbd>Tab</Kbd> complete
          </span>
          <span className="flex items-center gap-1">
            <Kbd>↵</Kbd> open
          </span>
        </div>
        {footerAction &&
          (footerAction.href ? (
            <Link
              href={footerAction.href}
              onClick={footerAction.onClick}
              className="ml-auto inline-flex items-center gap-1 font-medium text-ink-2 transition-colors hover:text-ink"
            >
              {footerAction.label} <ArrowRight aria-hidden className="size-3.5" />
            </Link>
          ) : (
            <button
              type="button"
              onClick={footerAction.onClick}
              className="ml-auto inline-flex items-center gap-1 font-medium text-ink-2 transition-colors hover:text-ink"
            >
              {footerAction.label} <ArrowRight aria-hidden className="size-3.5" />
            </button>
          ))}
      </div>
    </div>
  );
}
