"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, ChevronDown, Search } from "lucide-react";
import { CLUSTERS, clusterHref, getTool, liveCount, toolHref, toolsIn, tools, type Cluster, type ClusterId, type Tool } from "@/lib/tools";
import { cn } from "@/lib/utils";

const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * The navbar's Tools menu. Collections run down the left; the one under the pointer (or focus)
 * shows on the right in full, group by group, so any of the tools is two moves away.
 */
export function ToolsMenu({
  bubble,
  onHover,
  labelClass,
}: {
  /** The label colour the nav gives every link (it changes on the ink bubble). */
  labelClass: string;
  /** The nav's shared hover bubble, drawn behind the trigger when it's hovered or open. */
  bubble: React.ReactNode;
  onHover: (on: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<ClusterId>("pdf");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  const later = (fn: () => void, ms: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(fn, ms);
  };
  const show = () => later(() => setOpen(true), 70);
  const hide = () => later(() => setOpen(false), 180);
  const close = (focusTrigger = false) => {
    if (timer.current) clearTimeout(timer.current);
    setOpen(false);
    onHover(false);
    if (focusTrigger) trigger.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close(true);
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !trigger.current?.contains(t)) close();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const cluster = CLUSTERS.find((c) => c.id === current)!;

  return (
    <li
      onPointerEnter={(e) => {
        if (e.pointerType === "mouse") {
          onHover(true);
          show();
        }
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse") {
          onHover(false);
          hide();
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls="tools-menu"
        onClick={() => (open ? close() : setOpen(true))}
        onFocus={() => onHover(true)}
        onBlur={() => onHover(false)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>("a,button")?.focus());
          }
        }}
        className="relative flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-2 text-sm lg:px-3.5"
      >
        {bubble}
        <span className={cn("relative transition-colors duration-200", labelClass)}>Tools</span>
        <ChevronDown aria-hidden className={cn("relative size-3.5 text-ink-3 transition-transform duration-200", open && "rotate-180")} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            ref={panel}
            id="tools-menu"
            role="region"
            aria-label="All tools"
            data-lenis-prevent
            initial={{ opacity: 0, y: -6, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: 0.28, ease: EASE } }}
            exit={{ opacity: 0, y: -4, transition: { duration: 0.15 } }}
            className="absolute left-1/2 top-[calc(100%+10px)] z-50 w-[min(940px,calc(100vw-24px))] -translate-x-1/2 origin-top overflow-hidden rounded-lg border border-line bg-surface shadow-float"
          >
            <div className="grid grid-cols-[230px_1fr]">
              {/* Collections */}
              <ul className="border-r border-line bg-paper/60 p-2">
                {CLUSTERS.map((c, i) => {
                  const Icon = c.icon;
                  const on = c.id === current;
                  return (
                    <li key={c.id}>
                      <Link
                        href={clusterHref(c.id)}
                        onPointerEnter={() => setCurrent(c.id)}
                        onFocus={() => setCurrent(c.id)}
                        onClick={() => close()}
                        className={cn(
                          "relative flex items-center gap-3 rounded-md px-3 py-2.5 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/40",
                          on ? "text-paper" : "text-ink-2 hover:text-ink",
                        )}
                      >
                        {on && <motion.span layoutId="tools-menu-thumb" aria-hidden className="absolute inset-0 rounded-md bg-ink" transition={{ type: "spring", bounce: 0.22, duration: 0.45 }} />}
                        <span className={cn("label-mono relative w-5", on ? "text-paper-dim" : "text-ink-3")}>{String(i + 1).padStart(2, "0")}</span>
                        <Icon aria-hidden className="relative size-4 shrink-0" />
                        <span className="relative flex-1 font-medium">{c.name}</span>
                        <span className={cn("relative font-mono text-xs", on ? "text-paper-dim" : "text-ink-3")}>{toolsIn(c.id).length}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>

              {/* The collection in full */}
              <div className="min-h-[380px] p-5">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={cluster.id}
                    initial={{ opacity: 0, x: 6 }}
                    animate={{ opacity: 1, x: 0, transition: { duration: 0.22, ease: EASE } }}
                    exit={{ opacity: 0, transition: { duration: 0.1 } }}
                  >
                    <ClusterPreview cluster={cluster} onNavigate={() => close()} />
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>
            <div className="flex items-center justify-between gap-4 border-t border-line bg-paper/60 px-4 py-2.5">
              <Link href="/tools" onClick={() => close()} className="group inline-flex items-center gap-2 text-sm text-ink-2 transition-colors hover:text-ink">
                <Search aria-hidden className="size-4 text-ink-3" />
                Search and browse all {tools.length} tools
                <ArrowRight aria-hidden className="size-3.5 transition-transform duration-150 group-hover:translate-x-0.5" />
              </Link>
              <p className="label-mono text-ink-3">{liveCount} live · free · no sign-up</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

function ClusterPreview({ cluster, onNavigate }: { cluster: Cluster; onNavigate: () => void }) {
  const all = toolsIn(cluster.id);
  const hub = cluster.hub ? getTool(cluster.hub) : undefined;
  return (
    <div>
      <div className="flex items-start justify-between gap-6 border-b border-line pb-3">
        <div>
          <p className="text-[17px] font-semibold tracking-[-0.015em] text-ink">{cluster.title}</p>
          <p className="mt-0.5 text-sm text-ink-2">{cluster.blurb}</p>
        </div>
        <Link
          href={clusterHref(cluster.id)}
          onClick={onNavigate}
          className="group inline-flex shrink-0 items-center gap-1 pt-0.5 text-sm font-medium text-ink-2 transition-colors hover:text-ink"
        >
          All {all.length}
          <ArrowRight aria-hidden className="size-3.5 transition-transform duration-150 group-hover:translate-x-0.5" />
        </Link>
      </div>

      {cluster.groups ? (
        <div className="mt-4 grid grid-cols-3 gap-x-6 gap-y-5">
          {cluster.groups.map((g) => (
            <div key={g}>
              <p className="label-mono mb-1.5 text-ink-3">{g}</p>
              <ul>
                {all
                  .filter((t) => t.group === g)
                  .map((t) => (
                    <li key={t.id}>
                      <ToolLink tool={t} onNavigate={onNavigate} />
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <ul className="mt-3 grid grid-cols-2 gap-x-6">
          {all.map((t) => (
            <li key={t.id}>
              <ToolLink tool={t} onNavigate={onNavigate} described />
            </li>
          ))}
        </ul>
      )}

      {hub && (
        <Link
          href={toolHref(hub.id)}
          onClick={onNavigate}
          className="group mt-5 flex items-center gap-3 rounded-md border border-line bg-paper px-3 py-2.5 transition-colors hover:border-ink-3"
        >
          <hub.icon aria-hidden className="size-4 text-ink-2" />
          <span className="flex-1 text-sm">
            <span className="font-medium text-ink">{hub.name}</span>
            <span className="text-ink-3"> · {hub.description}</span>
          </span>
          <ArrowRight aria-hidden className="size-4 text-ink-3 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-ink" />
        </Link>
      )}
    </div>
  );
}

function ToolLink({ tool, onNavigate, described }: { tool: Tool; onNavigate: () => void; described?: boolean }) {
  const live = tool.status === "live";
  return (
    <Link
      href={toolHref(tool.id)}
      onClick={onNavigate}
      className={cn(
        "-mx-2 flex items-baseline gap-2 rounded-sm px-2 text-sm outline-none transition-colors hover:bg-paper-2 focus-visible:bg-paper-2",
        described ? "gap-3 py-2.5" : "py-1",
      )}
    >
      {described && (
        <span className="flex size-8 shrink-0 items-center justify-center self-center rounded-sm border border-line bg-paper text-ink-2">
          <tool.icon aria-hidden className="size-4" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate", live ? "text-ink" : "text-ink-3")}>{tool.name}</span>
        {described && <span className="block truncate text-xs text-ink-3">{tool.description}</span>}
      </span>
      {!live && <span className="label-mono shrink-0 text-[12px] text-ink-3">Soon</span>}
    </Link>
  );
}

/** Phones: the collections as rows in the menu sheet. */
export function MobileCollections({ onNavigate }: { onNavigate: () => void }) {
  return (
    <div className="border-b border-line pb-2">
      <p className="label-mono px-4 pb-1 pt-3 text-ink-3">Tools · {tools.length}</p>
      <ul>
        {CLUSTERS.map((c, i) => {
          const Icon = c.icon;
          return (
            <motion.li key={c.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: EASE, delay: 0.05 + i * 0.04 }}>
              <Link href={clusterHref(c.id)} onClick={onNavigate} className="flex items-center gap-3 rounded-md px-4 py-3 transition-colors hover:bg-paper-2">
                <span className="flex size-9 items-center justify-center rounded-md border border-line bg-paper text-ink">
                  <Icon aria-hidden className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[17px] font-semibold tracking-[-0.015em]">{c.name}</span>
                  <span className="block truncate text-xs text-ink-3">{c.blurb}</span>
                </span>
                <span className="font-mono text-xs text-ink-3">{toolsIn(c.id).length}</span>
              </Link>
            </motion.li>
          );
        })}
      </ul>
    </div>
  );
}
