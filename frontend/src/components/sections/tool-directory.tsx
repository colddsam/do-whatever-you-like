"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, ArrowUpRight, Plus, Search, X } from "lucide-react";
import { CLUSTERS, searchTools, toolHref, toolsIn, type Cluster, type ClusterId, type Tool } from "@/lib/tools";
import { Badge, Kbd } from "@/components/ui/primitives";
import { getLenis } from "@/lib/smooth-scroll";
import { cn } from "@/lib/utils";

const EASE = [0.22, 1, 0.36, 1] as const;

/** Under the navbar (64px) with a little air. */
const STICKY_TOP = 72;

function scrollToId(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const lenis = getLenis();
  if (lenis) lenis.scrollTo(el, { offset: -STICKY_TOP - 48 });
  else window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - STICKY_TOP - 48, behavior: "smooth" });
  history.replaceState(null, "", `#${id}`);
}

/**
 * The toolbox as a directory: nine collections, each in its family's groups, with a filter that
 * narrows everything as you type and an index that follows you down the page.
 */
export function ToolDirectory() {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<ClusterId>(CLUSTERS[0].id);
  const input = useRef<HTMLInputElement>(null);

  // Support /tools?q=... links (e.g. WebSite SearchAction) without opting out of static rendering.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("q");
    if (q) queueMicrotask(() => setQuery(q));
  }, []);

  // "/" jumps to the filter from anywhere on the page, like most directories.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (e.key === "/" && !typing) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Which collection is being read: the last one whose heading has passed a line a third down the screen.
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      let current: ClusterId = CLUSTERS[0].id;
      for (const c of CLUSTERS) {
        const el = document.getElementById(c.id);
        if (el && el.getBoundingClientRect().top < window.innerHeight * 0.35) current = c.id;
      }
      setActive(current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [query]);

  const matches = useMemo(() => (query.trim() ? new Set(searchTools(query).map((t) => t.id)) : null), [query]);
  const visible = (t: Tool) => !matches || matches.has(t.id);
  const counts = useMemo(
    () => Object.fromEntries(CLUSTERS.map((c) => [c.id, toolsIn(c.id).filter((t) => !matches || matches.has(t.id)).length])) as Record<ClusterId, number>,
    [matches],
  );
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <div className="mt-12 md:mt-14">
      {/* Filter */}
      <div className="grid md:grid-cols-12 md:gap-8">
        <label className="flex h-14 items-center gap-3 rounded-lg border border-line bg-surface px-4 shadow-float transition-[border-color,box-shadow] focus-within:border-ink focus-within:ring-4 focus-within:ring-accent/15 md:col-span-9 md:col-start-4">
          <Search aria-hidden className="size-[18px] shrink-0 text-ink-3" />
          <span className="sr-only">Filter tools</span>
          <input
            ref={input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setQuery("")}
            placeholder="Filter tools: “pdf to word”, “heic”, “blur”, “mp3”…"
            autoComplete="off"
            spellCheck={false}
            className="h-full min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-3"
          />
          {query ? (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                input.current?.focus();
              }}
              aria-label="Clear the filter"
              className="inline-flex size-8 items-center justify-center rounded-[8px] text-ink-3 hover:bg-paper-2 hover:text-ink"
            >
              <X aria-hidden className="size-4" />
            </button>
          ) : (
            <Kbd className="hidden sm:inline-flex">/</Kbd>
          )}
        </label>
      </div>

      {/* Phones and tablets: the collections as a sticky chip bar. */}
      <nav
        aria-label="Collections"
        className="sticky z-30 -mx-5 mt-6 border-y border-line bg-paper/90 px-5 py-2 backdrop-blur-md md:-mx-8 md:px-8 lg:hidden"
        style={{ top: STICKY_TOP - 8 }}
      >
        <ul className="flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {CLUSTERS.map((c) => (
            <li key={c.id} className="shrink-0">
              <button
                type="button"
                onClick={() => scrollToId(c.id)}
                disabled={!counts[c.id]}
                aria-current={active === c.id ? "true" : undefined}
                className={cn(
                  "inline-flex h-9 items-center gap-1.5 rounded-sm border px-3 text-sm transition-colors disabled:opacity-35",
                  active === c.id ? "border-ink bg-ink text-paper" : "border-line bg-surface text-ink-2 hover:border-ink-3 hover:text-ink",
                )}
              >
                {c.name}
                <span className={cn("font-mono text-[12px]", active === c.id ? "text-paper-dim" : "text-ink-3")}>{counts[c.id]}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="mt-8 grid gap-10 lg:mt-12 lg:grid-cols-12 lg:gap-8">
        {/* Desktop: the index rail. */}
        <aside className="hidden lg:col-span-3 lg:block">
          <nav aria-label="Collections" className="sticky" style={{ top: STICKY_TOP + 24 }}>
            <p className="label-mono border-b border-line pb-3 text-ink-3">
              {matches ? `${total} ${total === 1 ? "match" : "matches"}` : `${total} tools · ${CLUSTERS.length} collections`}
            </p>
            <ul className="mt-2 space-y-0.5">
              {CLUSTERS.map((c, i) => (
                <RailItem key={c.id} cluster={c} index={i} count={counts[c.id]} active={active === c.id} filtered={Boolean(matches)} />
              ))}
            </ul>
            <Link
              href="/#request"
              className="group mt-6 flex items-center gap-2 border-t border-line pt-4 text-sm text-ink-2 transition-colors hover:text-ink"
            >
              <Plus aria-hidden className="size-4" /> Request a tool
              <ArrowUpRight aria-hidden className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
            </Link>
          </nav>
        </aside>

        <div className="min-w-0 space-y-16 lg:col-span-9 md:space-y-20">
          {total === 0 && (
            <div className="rounded-lg border border-dashed border-line px-6 py-14 text-center">
              <p className="text-[15px] text-ink-2">
                No tool for <span className="font-medium text-ink">“{query}”</span> yet.
              </p>
              <p className="mt-1 text-sm text-ink-3">Try another word, or ask for it: the most-requested tools get built first.</p>
              <Link
                href={`/?idea=${encodeURIComponent(query.trim())}#request`}
                className="mt-4 inline-flex text-sm font-medium text-ink underline decoration-line underline-offset-4 hover:decoration-ink"
              >
                Request “{query}”
              </Link>
            </div>
          )}
          {CLUSTERS.map((c, i) => (counts[c.id] ? <ClusterSection key={c.id} cluster={c} index={i} visible={visible} filtered={Boolean(matches)} /> : null))}
        </div>
      </div>
    </div>
  );
}

function RailItem({ cluster, index, count, active, filtered }: { cluster: Cluster; index: number; count: number; active: boolean; filtered: boolean }) {
  const Icon = cluster.icon;
  return (
    <li>
      <button
        type="button"
        onClick={() => scrollToId(cluster.id)}
        disabled={!count}
        aria-current={active ? "true" : undefined}
        className={cn(
          "relative flex w-full items-center gap-3 rounded-md px-2.5 py-2.5 text-left text-[15px] transition-colors disabled:opacity-35",
          active ? "text-paper" : "text-ink-2 hover:bg-paper-2 hover:text-ink",
        )}
      >
        {active && <motion.span layoutId="directory-rail" aria-hidden className="absolute inset-0 rounded-md bg-ink" transition={{ type: "spring", bounce: 0.22, duration: 0.5 }} />}
        <span className={cn("label-mono relative w-5 shrink-0", active ? "text-paper-dim" : "text-ink-3")}>{String(index + 1).padStart(2, "0")}</span>
        <Icon aria-hidden className="relative size-4 shrink-0" />
        <span className="relative min-w-0 flex-1 truncate font-medium">{cluster.name}</span>
        <span className={cn("relative font-mono text-xs", active ? "text-paper-dim" : "text-ink-3")}>{count}</span>
      </button>
      {/* The groups of the collection being read, so long collections can be jumped through too. */}
      <AnimatePresence initial={false}>
        {active && cluster.groups && !filtered && (
          <motion.ul
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1, transition: { duration: 0.35, ease: EASE } }}
            exit={{ height: 0, opacity: 0, transition: { duration: 0.2 } }}
            className="ml-[38px] overflow-hidden border-l border-line"
          >
            {cluster.groups.map((g) => (
              <li key={g}>
                <button
                  type="button"
                  onClick={() => scrollToId(groupId(cluster.id, g))}
                  className="block w-full py-1.5 pl-3 text-left text-sm text-ink-2 transition-colors hover:text-ink"
                >
                  {g}
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </li>
  );
}

const groupId = (cluster: ClusterId, group: string) => `${cluster}-${group.toLowerCase().replace(/[^a-z]+/g, "-")}`;

function ClusterSection({ cluster, index, visible, filtered }: { cluster: Cluster; index: number; visible: (t: Tool) => boolean; filtered: boolean }) {
  const Icon = cluster.icon;
  const all = toolsIn(cluster.id);
  const shown = all.filter(visible);
  const hub = cluster.hub ? all.find((t) => t.id === cluster.hub) : undefined;
  const words = cluster.title.split(" ");
  const sections: [string | null, Tool[]][] = cluster.groups
    ? [
        ...(hub && visible(hub) ? ([[null, [hub]]] as [null, Tool[]][]) : []),
        ...cluster.groups.map((g) => [g, shown.filter((t) => t.group === g)] as [string, Tool[]]),
      ]
    : [[null, shown]];

  return (
    <section id={cluster.id} aria-labelledby={`${cluster.id}-title`} className="scroll-mt-40">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-line pb-5">
        <div className="flex items-start gap-4">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-md border border-line bg-surface text-ink">
            <Icon aria-hidden className="size-5" />
          </span>
          <div>
            <p className="label-mono text-ink-3">
              {String(index + 1).padStart(2, "0")} — {cluster.name} · {filtered ? `${shown.length} of ${all.length}` : `${all.length} ${all.length === 1 ? "tool" : "tools"}`}
            </p>
            <h2 id={`${cluster.id}-title`} className="mt-1.5 text-2xl font-semibold tracking-[-0.02em] md:text-[28px]">
              {words.slice(0, -1).join(" ")} <span className="serif-em">{words.at(-1)}</span>
            </h2>
            <p className="mt-1 text-[15px] text-ink-2">{cluster.blurb}</p>
          </div>
        </div>
        {hub && (
          <Link
            href={toolHref(hub.id)}
            className="group inline-flex h-10 shrink-0 items-center gap-1.5 rounded-md border border-line bg-surface px-3.5 text-sm font-medium text-ink transition-colors hover:border-ink-3"
          >
            Open the {hub.name}
            <ArrowRight aria-hidden className="size-4 transition-transform duration-150 group-hover:translate-x-0.5" />
          </Link>
        )}
      </div>

      <div className="mt-6 space-y-8">
        {sections.map(([group, list]) =>
          list.length ? (
            <div key={group ?? "all"} id={group ? groupId(cluster.id, group) : undefined} className="scroll-mt-40">
              {group && (
                <p className="label-mono mb-3 flex items-center gap-2 text-ink-2">
                  {group} <span className="text-ink-3">· {list.length}</span>
                </p>
              )}
              <ul className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2 xl:grid-cols-3">
                {list.map((t) => (
                  <ToolCell key={t.id} tool={t} hub={t.id === cluster.hub} />
                ))}
                {!(list.length === 1 && list[0].id === cluster.hub) && <Fill count={list.length} />}
              </ul>
            </div>
          ) : null,
        )}
      </div>
    </section>
  );
}

function ToolCell({ tool, hub }: { tool: Tool; hub?: boolean }) {
  const Icon = tool.icon;
  const live = tool.status === "live";
  return (
    <li className={cn("bg-paper", hub && "sm:col-span-2 xl:col-span-3")}>
      <Link
        href={toolHref(tool.id)}
        className={cn("group flex h-full items-start gap-3.5 p-4 transition-colors duration-150 hover:bg-surface md:p-5", hub && "bg-paper-2/40")}
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-line bg-surface text-ink transition-colors duration-150 group-hover:border-ink group-hover:bg-ink group-hover:text-paper">
          <Icon aria-hidden className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1 text-[15px] font-semibold tracking-[-0.01em] text-ink">
            {tool.name}
            {hub && <span className="label-mono ml-1.5 font-normal text-ink-3">All-in-one</span>}
            <ArrowUpRight
              aria-hidden
              className="size-3.5 shrink-0 text-ink-3 opacity-0 transition-[opacity,transform] duration-150 ease-out-soft group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:opacity-100"
            />
          </span>
          <span className="mt-0.5 block text-sm leading-relaxed text-ink-2">{tool.description}</span>
        </span>
        {!live && <Badge className="shrink-0">Soon</Badge>}
      </Link>
    </li>
  );
}

/** Closes a short last row of a hairline grid with plain paper, so there's no grey hole. */
function Fill({ count }: { count: number }) {
  const sm = count % 2 ? 1 : 0;
  const xl = (3 - (count % 3)) % 3;
  if (!sm && !xl) return null;
  return (
    <li
      aria-hidden
      className={cn(
        "bg-paper-2/40 max-sm:hidden",
        sm ? "sm:col-span-1" : "sm:hidden",
        xl === 0 ? "xl:hidden" : xl === 1 ? "xl:col-span-1 xl:block" : "xl:col-span-2 xl:block",
      )}
    />
  );
}

