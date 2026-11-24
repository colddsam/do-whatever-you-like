"use client";

import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Box, Clock, Command, Folder as FolderIcon, Globe2, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useApi } from "../store";
import { walk } from "../lib/util";
import { MethodTag } from "./kit";

/**
 * Quick search (Ctrl/⌘+K): every request, folder, collection, environment, recent history entry and
 * command in one list. Typing narrows it (name first, then URL and location); arrows and Enter pick.
 */

type Item = { id: string; kind: "request" | "folder" | "collection" | "environment" | "history" | "command"; label: string; sub?: string; method?: string; protocol?: string; run: () => void };

const KIND_LABEL: Record<Item["kind"], string> = { request: "Requests", folder: "Folders", collection: "Collections", environment: "Environments", history: "Recent", command: "Commands" };

export function QuickSearch({ onClose }: { onClose: () => void }) {
  const ws = useApi((s) => s.ws);
  const [q, setQ] = useState("");
  const [index, setIndex] = useState(0);
  const list = useRef<HTMLDivElement>(null);

  const all = useMemo<Item[]>(() => {
    const s = useApi.getState();
    const out: Item[] = [];
    for (const c of ws.collections) {
      out.push({ id: c.id, kind: "collection", label: c.name, run: () => s.openTab("collection", c.id, c.name) });
      walk(c.items, (n, parents) => {
        const where = [c.name, ...parents.map((p) => p.name)].join(" / ");
        if (n.kind === "folder") out.push({ id: n.id, kind: "folder", label: n.name, sub: where, run: () => s.openNode(c.id, n.id) });
        else out.push({ id: n.id, kind: "request", label: n.name, sub: `${where} · ${n.url}`, method: n.method, protocol: n.protocol, run: () => s.openNode(c.id, n.id) });
      });
    }
    for (const e of ws.environments) {
      out.push({ id: e.id, kind: "environment", label: e.name, sub: ws.activeEnvId === e.id ? "Active" : "Edit variables", run: () => s.openTab("environment", e.id, e.name) });
      if (ws.activeEnvId !== e.id) out.push({ id: `use-${e.id}`, kind: "command", label: `Use environment: ${e.name}`, run: () => s.setActiveEnv(e.id) });
    }
    if (ws.activeEnvId) out.push({ id: "no-env", kind: "command", label: "Use no environment", run: () => s.setActiveEnv(null) });
    for (const h of ws.history.slice(0, 40))
      out.push({ id: `h-${h.id}`, kind: "history", label: h.request.name, sub: `${h.request.url}${h.status ? ` · ${h.status}` : ""}`, method: h.request.method, protocol: h.request.protocol, run: () => s.newRequestTab(h.request.protocol, { ...h.request, id: crypto.randomUUID().slice(0, 16) }) });
    const cmd = (label: string, run: () => void) => out.push({ id: `cmd-${label}`, kind: "command", label, run });
    cmd("New HTTP request", () => s.newRequestTab("http"));
    cmd("New GraphQL request", () => s.newRequestTab("graphql"));
    cmd("New WebSocket request", () => s.newRequestTab("ws"));
    cmd("New Socket.IO request", () => s.newRequestTab("socketio"));
    cmd("New MQTT request", () => s.newRequestTab("mqtt"));
    cmd("New gRPC request", () => s.newRequestTab("grpc"));
    cmd("New collection", () => {
      const c = s.addCollection();
      s.openTab("collection", c.id, c.name);
    });
    cmd("New environment", () => {
      const e = s.addEnvironment();
      s.openTab("environment", e.id, e.name);
    });
    cmd("Import…", () => setTimeout(() => s.setDialog({ type: "import" }), 0));
    cmd("Settings", () => setTimeout(() => s.setDialog({ type: "settings" }), 0));
    cmd("Cookies", () => setTimeout(() => s.setDialog({ type: "cookies" }), 0));
    cmd("Workspaces", () => setTimeout(() => s.setDialog({ type: "workspaces" }), 0));
    cmd("Keyboard shortcuts", () => setTimeout(() => s.setDialog({ type: "shortcuts" }), 0));
    cmd("Toggle console", () => s.setPrefs({ consoleOpen: !s.prefs.consoleOpen }));
    cmd("Toggle sidebar", () => s.setPrefs({ sidebarOpen: !s.prefs.sidebarOpen }));
    cmd("Show code snippet", () => s.setPrefs({ right: "code" }));
    cmd("Globals", () => s.openTab("globals", "globals", "Globals"));
    cmd("Vault", () => s.openTab("vault", "vault", "Vault"));
    return out;
  }, [ws]);

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return all.filter((i) => i.kind !== "history").slice(0, 60);
    const words = needle.split(/\s+/);
    const scored: { item: Item; score: number }[] = [];
    for (const item of all) {
      const name = item.label.toLowerCase();
      const rest = `${item.sub ?? ""} ${item.method ?? ""}`.toLowerCase();
      if (!words.every((w) => name.includes(w) || rest.includes(w))) continue;
      let score = 0;
      if (name === needle) score += 100;
      if (name.startsWith(needle)) score += 50;
      if (name.includes(needle)) score += 20;
      score += words.filter((w) => name.includes(w)).length * 5;
      if (item.kind === "request") score += 3;
      if (item.kind === "history") score -= 2;
      scored.push({ item, score });
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, 60).map((x) => x.item);
  }, [all, q]);

  const pick = (item: Item | undefined) => {
    if (!item) return;
    onClose();
    item.run();
  };
  const move = (d: number) => {
    const next = (index + d + results.length) % Math.max(1, results.length);
    setIndex(next);
    list.current?.querySelector<HTMLElement>(`[data-i="${next}"]`)?.scrollIntoView({ block: "nearest" });
  };

  return createPortal(
    <div className="fixed inset-0 z-[130] flex items-start justify-center bg-ink/30 px-3 pt-[10vh] backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Quick search" className="flex max-h-[70vh] w-full max-w-[620px] flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-float">
        <div className="flex items-center gap-2 border-b border-line px-3">
          <Search aria-hidden className="size-4 shrink-0 text-ink-3" />
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                move(1);
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                move(-1);
              } else if (e.key === "Enter") {
                e.preventDefault();
                pick(results[index]);
              } else if (e.key === "Escape") {
                e.preventDefault();
                onClose();
              }
            }}
            placeholder="Search requests, collections, environments, commands…"
            aria-label="Quick search"
            role="combobox"
            aria-expanded="true"
            aria-controls="api-quick-results"
            aria-activedescendant={results[index] ? `qs-${index}` : undefined}
            className="h-12 min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-3"
          />
          <kbd className="hidden rounded border border-line px-1.5 font-mono text-[12px] text-ink-3 sm:inline">Esc</kbd>
        </div>
        <div ref={list} id="api-quick-results" role="listbox" aria-label="Results" className="min-h-0 flex-1 overflow-y-auto p-1" data-lenis-prevent>
          {!results.length && <p className="p-6 text-center text-[13px] text-ink-3">Nothing matches “{q}”.</p>}
          {results.map((item, i) => {
            const header = !q.trim() && (i === 0 || results[i - 1].kind !== item.kind) ? KIND_LABEL[item.kind] : null;
            const Icon = item.kind === "collection" ? Box : item.kind === "folder" ? FolderIcon : item.kind === "environment" ? Globe2 : item.kind === "history" ? Clock : item.kind === "command" ? Command : null;
            return (
              <div key={item.id}>
                {header && <p className="px-2.5 pb-1 pt-2 font-mono text-[12px] uppercase tracking-[0.08em] text-ink-3">{header}</p>}
                <button
                  id={`qs-${i}`}
                  data-i={i}
                  type="button"
                  role="option"
                  aria-selected={i === index}
                  onMouseMove={() => setIndex(i)}
                  onClick={() => pick(item)}
                  className={cn("flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left", i === index ? "bg-ink text-paper" : "text-ink")}
                >
                  {item.method ? <MethodTag method={item.method} protocol={item.protocol} className={cn("w-12", i === index && "!text-paper")} /> : Icon ? <Icon aria-hidden className={cn("size-4 shrink-0", i === index ? "text-paper/70" : "text-ink-3")} /> : null}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px]">{item.label}</span>
                    {item.sub && <span className={cn("block truncate text-[12px]", i === index ? "text-paper/70" : "text-ink-3")}>{item.sub}</span>}
                  </span>
                  {q.trim() && <span className={cn("shrink-0 font-mono text-[12px]", i === index ? "text-paper/70" : "text-ink-3")}>{KIND_LABEL[item.kind]}</span>}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}
