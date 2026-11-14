"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUpRight, CornerDownLeft, Search, Sparkles } from "lucide-react";
import { CLUSTERS, exampleTasks, toolHref, tools, toolsIn, type Tool } from "@/lib/tools";
import { analyzeTaskQuery } from "@/lib/tool-search";
import { Kbd, SignalDot } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

const noopSubscribe = () => () => {};
const EASE = [0.22, 1, 0.36, 1] as const;

/** Cycles through example tasks with a typewriter effect. */
function useTypewriter(phrases: string[], enabled: boolean) {
  const [text, setText] = useState("");

  useEffect(() => {
    if (!enabled) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let timer: ReturnType<typeof setTimeout>;
    if (reduce) {
      timer = setTimeout(() => setText(phrases[0]), 0);
      return () => clearTimeout(timer);
    }
    let phrase = 0;
    let char = 0;
    let deleting = false;

    const tick = () => {
      const current = phrases[phrase];
      if (!deleting) {
        char++;
        setText(current.slice(0, char));
        if (char === current.length) {
          deleting = true;
          timer = setTimeout(tick, 1600);
          return;
        }
        timer = setTimeout(tick, 55);
      } else {
        char--;
        setText(current.slice(0, char));
        if (char === 0) {
          deleting = false;
          phrase = (phrase + 1) % phrases.length;
          timer = setTimeout(tick, 350);
          return;
        }
        timer = setTimeout(tick, 25);
      }
    };
    timer = setTimeout(tick, 600);
    return () => clearTimeout(timer);
  }, [phrases, enabled]);

  return text;
}

export function CommandPalette({
  query: controlledQuery,
  onQueryChange,
  introDelay = 0,
}: {
  /** Optional controlled query, e.g. driven by suggestion chips. */
  query?: string;
  onQueryChange?: (q: string) => void;
  /** Seconds to wait before the intro row stagger starts. */
  introDelay?: number;
} = {}) {
  const [innerQuery, setInnerQuery] = useState("");
  const query = controlledQuery ?? innerQuery;
  const setQuery = (q: string) => {
    if (controlledQuery === undefined) setInnerQuery(q);
    onQueryChange?.(q);
  };
  // Rows stagger in once on first paint; later result changes render instantly.
  const [intro, setIntro] = useState(true);
  const [atEnd, setAtEnd] = useState(false);
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);
  const isMac = useSyncExternalStore(
    noopSubscribe,
    () => /Mac|iPhone|iPad/.test(navigator.platform),
    () => true,
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const analysis = useMemo(() => analyzeTaskQuery(query, { limit: 5 }), [query]);

  // Results come grouped by collection: in collection order when browsing, best match first when searching.
  const groups = useMemo(() => {
    if (!query.trim()) {
      return CLUSTERS.map((c) => ({
        cluster: c,
        list: toolsIn(c.id).map((tool) => ({ tool, matchReason: "" })),
      }));
    }
    const byCluster = new Map<string, Array<{ tool: Tool; matchReason: string }>>();
    for (const match of analysis.results) {
      const id = match.cluster.id;
      byCluster.set(id, [...(byCluster.get(id) ?? []), { tool: match.tool, matchReason: match.matchReason }]);
    }
    return [...byCluster].map(([id, list]) => ({ cluster: CLUSTERS.find((c) => c.id === id)!, list }));
  }, [query, analysis.results]);
  const results = useMemo(() => groups.flatMap((g) => g.list), [groups]);
  const topSuggestion = query.trim() ? analysis.suggestions[0] : undefined;
  const placeholder = useTypewriter(exampleTasks, !focused && query === "");
  const liveCount = tools.filter((t) => t.status === "live").length;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setIntro(false), (introDelay + 1.2) * 1000);
    return () => clearTimeout(t);
  }, [introDelay]);

  const updateEdge = () => {
    const el = listRef.current;
    if (el) setAtEnd(el.scrollTop + el.clientHeight >= el.scrollHeight - 4);
  };
  // Reset the highlight whenever the query changes, including from outside.
  const [prevQuery, setPrevQuery] = useState(query);
  if (prevQuery !== query) {
    setPrevQuery(query);
    setActive(0);
  }
  useEffect(() => {
    const raf = requestAnimationFrame(updateEdge);
    return () => cancelAnimationFrame(raf);
  }, [query]);

  // Keep the highlighted row in view by scrolling the list only. scrollIntoView would also
  // scroll the page, which made it jump on load whenever the palette started below the fold.
  useEffect(() => {
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    if (!list || !row) return;
    const l = list.getBoundingClientRect();
    const r = row.getBoundingClientRect();
    if (r.top < l.top) list.scrollTop -= l.top - r.top;
    else if (r.bottom > l.bottom) list.scrollTop += r.bottom - l.bottom;
  }, [active]);

  const router = useRouter();
  const open = (id: string) => router.push(toolHref(id));

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && results[active]) {
      e.preventDefault();
      open(results[active].tool.id);
    } else if (e.key === "Tab" && topSuggestion && topSuggestion.phrase.toLowerCase() !== query.trim().toLowerCase()) {
      e.preventDefault();
      setQuery(topSuggestion.phrase);
    } else if (e.key === "Escape") {
      setQuery("");
      inputRef.current?.blur();
    }
  };

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface shadow-float">
      {/* Input */}
      <label className="flex h-14 items-center gap-3 border-b border-line px-4">
        <Search aria-hidden className="size-[18px] shrink-0 text-ink-3" />
        <span className="sr-only">Search for a task</span>
        <div className="relative flex-1">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={onKeyDown}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-results"
            aria-activedescendant={results[active] ? `palette-${results[active].tool.id}` : undefined}
            autoComplete="off"
            spellCheck={false}
            className="peer w-full bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-3"
            placeholder={focused ? "What do you want to do?" : ""}
          />
          {!focused && query === "" && (
            <span aria-hidden className="pointer-events-none absolute inset-0 flex items-center text-[15px] text-ink-3">
              {placeholder}
              <span className="ml-px h-[18px] w-px animate-blink bg-ink" />
            </span>
          )}
        </div>
        <span className="hidden items-center gap-1 sm:flex">
          <Kbd>{isMac ? "⌘" : "Ctrl"}</Kbd>
          <Kbd>K</Kbd>
        </span>
      </label>

      {/* Results & animated availability / query suggestions */}
      <div className="px-2 pt-2">
        <div className="flex items-center justify-between gap-2 px-2 pb-1.5 pt-1">
          <AnimatePresence mode="wait" initial={false}>
            {!query.trim() ? (
              <motion.p
                key="idle"
                initial={{ opacity: 0, y: 2 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -2 }}
                transition={{ duration: 0.16, ease: EASE }}
                className="label-mono text-ink-3"
              >
                All tools
              </motion.p>
            ) : (
              <motion.p
                key={`${analysis.availability.status}-${analysis.availability.topTool?.id ?? "none"}`}
                initial={{ opacity: 0, y: 3 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -3 }}
                transition={{ duration: 0.18, ease: EASE }}
                className="label-mono flex min-w-0 items-center gap-1.5 truncate text-ink-2"
              >
                {(analysis.availability.status === "available" || analysis.availability.status === "converter-route") && (
                  <SignalDot />
                )}
                <span
                  className={cn(
                    "shrink-0 font-medium",
                    analysis.availability.status === "available" || analysis.availability.status === "converter-route"
                      ? "text-success"
                      : analysis.availability.status === "coming-soon"
                        ? "text-warning"
                        : "text-ink-3",
                  )}
                >
                  {analysis.availability.label}
                </span>
                <span className="truncate text-ink-3">· {analysis.availability.detail}</span>
              </motion.p>
            )}
          </AnimatePresence>
        </div>

        <AnimatePresence initial={false}>
          {query.trim() && analysis.suggestions.length > 0 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto", transition: { duration: 0.22, ease: EASE } }}
              exit={{ opacity: 0, height: 0, transition: { duration: 0.15 } }}
              className="overflow-hidden px-1 pb-1.5"
            >
              <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <Sparkles aria-hidden className="size-3 shrink-0 text-accent" />
                {analysis.suggestions.map((s, idx) => (
                  <motion.button
                    key={s.id}
                    type="button"
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2, ease: EASE, delay: idx * 0.025 }}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setQuery(s.phrase);
                      inputRef.current?.focus();
                    }}
                    className="inline-flex h-6 shrink-0 items-center gap-1 rounded-sm border border-line bg-paper px-2 text-xs text-ink-2 transition-colors hover:border-ink-3 hover:bg-paper-2 hover:text-ink"
                  >
                    {s.matchedPrefix ? (
                      <span>
                        <span className="text-ink-3">{s.matchedPrefix}</span>
                        <span className="font-semibold text-ink">{s.completion}</span>
                      </span>
                    ) : (
                      <span>{s.phrase}</span>
                    )}
                  </motion.button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <ul
        ref={listRef}
        id="palette-results"
        role="listbox"
        aria-label="Tools"
        onScroll={updateEdge}
        className={cn(
          // 4 rows on mobile, 5 on larger screens (52px rows + 8px padding), plus a peek of the next row.
          "h-[236px] overflow-y-auto px-2 pb-2 transition-[mask-size] sm:h-[288px]",
          !atEnd && "[mask-image:linear-gradient(to_bottom,black_calc(100%-56px),transparent)]",
        )}
      >
        {results.length === 0 && (
          <li className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <p className="text-sm text-ink-2">
              No tool for <span className="font-medium text-ink">“{query}”</span> yet.
            </p>
            <Link
              href={`/?idea=${encodeURIComponent(query.trim())}#request`}
              className="text-sm font-medium text-ink underline decoration-line underline-offset-4 hover:decoration-ink"
            >
              Request it
            </Link>
          </li>
        )}
        {groups.map(({ cluster, list }) => [
          <li key={`h-${cluster.id}`} role="presentation" className="label-mono flex items-center justify-between px-2 pb-1 pt-3 text-ink-3 first:pt-1">
            <span>{cluster.name}</span>
            <span>{list.length}</span>
          </li>,
          ...list.map(({ tool, matchReason }) => {
          const i = results.findIndex((r) => r.tool.id === tool.id);
          const Icon = tool.icon;
          const isActive = i === active;
          return (
            <motion.li
              key={tool.id}
              initial={intro ? { opacity: 0, y: 8 } : false}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: EASE, delay: intro ? introDelay + i * 0.05 : 0 }}
              id={`palette-${tool.id}`}
              data-index={i}
              role="option"
              aria-selected={isActive}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => open(tool.id)}
              className="relative flex h-[52px] cursor-pointer items-center gap-3 rounded-md px-2"
            >
              {isActive && (
                <motion.span
                  aria-hidden
                  layoutId="palette-active"
                  transition={{ type: "spring", stiffness: 520, damping: 42, mass: 0.6 }}
                  className="absolute inset-0 -z-0 rounded-md bg-paper-2"
                />
              )}
              <span
                className={cn(
                  "relative flex size-8 shrink-0 items-center justify-center rounded-sm border transition-colors duration-150",
                  isActive ? "border-ink bg-ink text-paper" : "border-line bg-paper text-ink-2",
                )}
              >
                <Icon aria-hidden className="size-4" />
              </span>
              <span className="relative min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink">{tool.name}</span>
                <span className="block truncate text-xs text-ink-3">
                  {query.trim() && matchReason ? `${matchReason} · ${tool.description}` : tool.description}
                </span>
              </span>
              {tool.status === "live" ? (
                <span className="label-mono relative flex items-center gap-1.5 text-ink">
                  <SignalDot /> Live
                </span>
              ) : (
                <span className="label-mono relative text-ink-3">Soon</span>
              )}
              <span className={cn("relative hidden w-6 justify-end sm:flex", !isActive && "invisible")}>
                {tool.status === "live" ? (
                  <CornerDownLeft aria-hidden className="size-3.5 text-ink-2" />
                ) : (
                  <ArrowUpRight aria-hidden className="size-3.5 text-ink-2" />
                )}
              </span>
            </motion.li>
          );
        }),
        ])}
      </ul>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-line bg-paper/60 px-4 py-2.5">
        <div className="hidden items-center gap-3 text-xs text-ink-3 sm:flex">
          <span className="flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> navigate
          </span>
          <span className="flex items-center gap-1">
            <Kbd>↵</Kbd> open
          </span>
        </div>
        <p className="label-mono flex items-center gap-1.5 text-ink-2">
          <SignalDot pulse /> {liveCount} live · {tools.length - liveCount} in the works
        </p>
      </div>
    </div>
  );
}
