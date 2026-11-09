"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { ArrowUpRight, CornerDownLeft, Search } from "lucide-react";
import { exampleTasks, searchTools, toolHref, tools } from "@/lib/tools";
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

  const results = useMemo(() => searchTools(query), [query]);
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

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
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
      open(results[active].id);
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
            aria-activedescendant={results[active] ? `palette-${results[active].id}` : undefined}
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

      {/* Results */}
      <div className="px-2 pt-2">
        <p className="label-mono px-2 pb-1.5 pt-1 text-ink-3">
          {query ? `${results.length} result${results.length === 1 ? "" : "s"}` : "All tools"}
        </p>
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
            <Link href="/#request" className="text-sm font-medium text-ink underline decoration-line underline-offset-4 hover:decoration-ink">
              Request it
            </Link>
          </li>
        )}
        {results.map((tool, i) => {
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
                <span className="block truncate text-xs text-ink-3">{tool.description}</span>
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
        })}
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
