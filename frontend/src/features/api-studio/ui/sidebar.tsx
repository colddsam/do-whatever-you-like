"use client";

import { useMemo, useState } from "react";
import {
  Activity, ArrowDown, ArrowUp, BookOpen, Box, Check, ChevronRight, Clock, Copy, Download, FileCode2, Folder as FolderIcon, FolderOpen, FolderPlus, Globe2, History, KeyRound, Layers, MoreHorizontal,
  Pencil, Play, Plus, Search, Server, Share2, Trash2, Upload, Workflow,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Collection, Folder, HistoryEntry, TreeNode } from "../types";
import { dayLabel, findNode, newFolder, newRequest, relTime, uid, walk } from "../lib/util";
import { mockUrl } from "../lib/mock";
import { collectionToPostman, environmentToPostman } from "../lib/postman-format";
import { downloadFile, safeName } from "../lib/util";
import { useApi, type SidebarSection } from "../store";
import { IconBtn, Input, Menu, MethodTag, type MenuItem } from "./kit";

export const SECTIONS: { id: SidebarSection; label: string; short: string; icon: typeof Layers }[] = [
  { id: "collections", label: "Collections", short: "Collections", icon: Layers },
  { id: "environments", label: "Environments", short: "Envs", icon: Globe2 },
  { id: "history", label: "History", short: "History", icon: History },
  { id: "mocks", label: "Mock servers", short: "Mocks", icon: Server },
  { id: "monitors", label: "Monitors", short: "Monitors", icon: Activity },
  { id: "flows", label: "Flows", short: "Flows", icon: Workflow },
  { id: "specs", label: "APIs & Specs", short: "APIs", icon: FileCode2 },
];

export function Rail({ onPick }: { onPick?: () => void }) {
  const prefs = useApi((s) => s.prefs);
  const setPrefs = useApi((s) => s.setPrefs);
  return (
    <nav aria-label="Sidebar sections" className="flex shrink-0 flex-col gap-0.5 border-r border-line bg-paper p-1">
      {SECTIONS.map((s) => {
        const active = prefs.sidebarOpen && prefs.sidebar === s.id;
        return (
          <button
            key={s.id}
            type="button"
            title={s.label}
            aria-label={s.label}
            aria-pressed={active}
            onClick={() => {
              setPrefs(active ? { sidebarOpen: false } : { sidebar: s.id, sidebarOpen: true });
              onPick?.();
            }}
            className={cn("flex w-[68px] flex-col items-center gap-0.5 rounded-md px-0.5 py-1.5 text-[12px] leading-tight transition-colors", active ? "bg-ink text-paper" : "text-ink-2 hover:bg-paper-2 hover:text-ink")}
          >
            <s.icon aria-hidden className="size-4" />
            <span className="w-full truncate text-center text-[12px] tracking-[-0.01em]">{s.short}</span>
          </button>
        );
      })}
    </nav>
  );
}

export function SidebarPanel({ onNavigate }: { onNavigate?: () => void }) {
  const section = useApi((s) => s.prefs.sidebar);
  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      {section === "collections" && <CollectionsPanel onNavigate={onNavigate} />}
      {section === "environments" && <EnvironmentsPanel onNavigate={onNavigate} />}
      {section === "history" && <HistoryPanel onNavigate={onNavigate} />}
      {section === "mocks" && <ListPanel kind="mocks" onNavigate={onNavigate} />}
      {section === "monitors" && <ListPanel kind="monitors" onNavigate={onNavigate} />}
      {section === "flows" && <ListPanel kind="flows" onNavigate={onNavigate} />}
      {section === "specs" && <ListPanel kind="specs" onNavigate={onNavigate} />}
    </div>
  );
}

function PanelHead({ title, children, query, setQuery }: { title: string; children?: React.ReactNode; query?: string; setQuery?: (q: string) => void }) {
  return (
    <div className="shrink-0 space-y-1.5 border-b border-line p-2">
      <div className="flex items-center gap-1">
        <h2 className="min-w-0 flex-1 truncate px-1 text-[13px] font-semibold text-ink">{title}</h2>
        {children}
      </div>
      {setQuery && (
        <div className="relative">
          <Search aria-hidden className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-ink-3" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" aria-label={`Search ${title.toLowerCase()}`} className="pl-7" />
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ collections */

type Drag = { collectionId: string; id: string } | null;
let dragging: Drag = null;

function CollectionsPanel({ onNavigate }: { onNavigate?: () => void }) {
  const ws = useApi((s) => s.ws);
  const addCollection = useApi((s) => s.addCollection);
  const setDialog = useApi((s) => s.setDialog);
  const openTab = useApi((s) => s.openTab);
  const [q, setQ] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [toggled, setOpen] = useState<Record<string, boolean>>({});
  // Unless toggled by hand, the path to the request being worked on is open (and the first collection).
  const activeRef = useApi((st) => st.tabs.find((t) => t.id === st.activeTabId)?.ref);
  const open = useMemo(() => {
    const auto: Record<string, boolean> = {};
    if (ws.collections[0]) auto[ws.collections[0].id] = true;
    const c = ws.collections.find((x) => x.id === activeRef?.collectionId);
    if (c) {
      auto[c.id] = true;
      if (activeRef?.itemId) findNode(c.items, activeRef.itemId)?.parents.forEach((p) => (auto[p.id] = true));
    }
    return { ...auto, ...toggled };
  }, [ws.collections, activeRef, toggled]);
  const toggle = (id: string, v?: boolean) => setOpen((o) => ({ ...o, [id]: v ?? !open[id] }));
  const matches = useMemo(() => {
    if (!q.trim()) return null;
    const s = new Set<string>();
    const needle = q.toLowerCase();
    for (const c of ws.collections)
      walk(c.items, (n, parents) => {
        if (n.name.toLowerCase().includes(needle) || (n.kind === "request" && n.url.toLowerCase().includes(needle))) {
          s.add(n.id);
          s.add(c.id);
          parents.forEach((p) => s.add(p.id));
        }
      });
    return s;
  }, [q, ws.collections]);

  return (
    <>
      <PanelHead title={ws.name} query={q} setQuery={setQ}>
        <IconBtn
          icon={Plus}
          label="New collection"
          onClick={() => {
            const c = addCollection();
            setRenaming(c.id);
            toggle(c.id, true);
            openTab("collection", c.id, c.name);
          }}
        />
        <IconBtn icon={Upload} label="Import" onClick={() => setDialog({ type: "import" })} />
      </PanelHead>
      <div className="min-h-0 flex-1 overflow-y-auto py-1" data-lenis-prevent>
        {!ws.collections.length && (
          <div className="px-4 py-8 text-center text-[13px] text-ink-3">
            <p>Collections group your requests.</p>
            <button type="button" className="mt-2 font-medium text-ink underline" onClick={() => addCollection()}>
              Create a collection
            </button>
          </div>
        )}
        {ws.collections
          .filter((c) => !matches || matches.has(c.id))
          .map((c) => (
            <CollectionRow key={c.id} c={c} open={!!open[c.id] || !!matches} toggle={toggle} openMap={open} renaming={renaming} setRenaming={setRenaming} matches={matches} onNavigate={onNavigate} />
          ))}
      </div>
    </>
  );
}

function useNodeMenu(c: Collection, n: TreeNode | null, setRenaming: (id: string | null) => void, toggle: (id: string, v?: boolean) => void): MenuItem[] {
  const s = useApi.getState();
  const parentItems = (id: string) => {
    const hit = findNode(c.items, id);
    return hit?.parents.at(-1)?.items ?? c.items;
  };
  const move = (id: string, d: -1 | 1) => {
    const items = parentItems(id);
    const i = items.findIndex((x) => x.id === id);
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    s.moveNode(c.id, id, c.id, findNode(c.items, id)?.parents.at(-1)?.id ?? null, j);
  };
  const addReq = (parentId: string | null) => {
    const r = newRequest({ name: "New Request" });
    s.addNode(c.id, parentId, r);
    toggle(parentId ?? c.id, true);
    s.openNode(c.id, r.id);
  };
  const addFolder = (parentId: string | null) => {
    const f = newFolder("New Folder");
    s.addNode(c.id, parentId, f);
    toggle(parentId ?? c.id, true);
    setRenaming(f.id);
  };
  if (!n)
    return [
      { label: "Add request", icon: Plus, onClick: () => addReq(null) },
      { label: "Add folder", icon: FolderPlus, onClick: () => addFolder(null) },
      { divider: true, label: "" },
      { label: "Run collection", icon: Play, onClick: () => s.openTab("runner", c.id, `Runner · ${c.name}`) },
      { label: "View documentation", icon: BookOpen, onClick: () => s.openTab("docs", c.id, `Docs · ${c.name}`) },
      {
        label: "Mock collection",
        icon: Server,
        onClick: () => {
          const m = { id: uid().slice(0, 10), name: `${c.name} mock`, collectionId: c.id, delayMs: 0, enabled: true, createdAt: Date.now(), log: [] };
          s.mutate((w) => ({ ...w, mocks: [...w.mocks, m] }));
          s.openTab("mock", m.id, m.name);
          s.notify(`Mock server ready at ${mockUrl(m)}`, "success");
        },
      },
      {
        label: "Monitor collection",
        icon: Activity,
        onClick: () => {
          const m = { id: uid(), name: `${c.name} monitor`, collectionId: c.id, intervalMin: 15, enabled: false, notify: true, createdAt: Date.now(), runs: [] };
          s.mutate((w) => ({ ...w, monitors: [...w.monitors, m] }));
          s.openTab("monitor", m.id, m.name);
        },
      },
      { label: "Share", icon: Share2, onClick: () => s.setDialog({ type: "share", collectionId: c.id }) },
      { label: "Export", icon: Download, onClick: () => s.setDialog({ type: "export", collectionId: c.id }) },
      { divider: true, label: "" },
      { label: "Rename", icon: Pencil, onClick: () => setRenaming(c.id) },
      { label: "Duplicate", icon: Copy, onClick: () => s.duplicateCollection(c.id) },
      { label: "Delete", icon: Trash2, danger: true, onClick: () => s.setDialog({ type: "confirm", title: `Delete "${c.name}"?`, body: "The collection, its requests, saved examples, mocks and monitors will be removed. This can't be undone.", danger: true, action: () => s.deleteCollection(c.id) }) },
    ];
  if (n.kind === "folder")
    return [
      { label: "Add request", icon: Plus, onClick: () => addReq(n.id) },
      { label: "Add folder", icon: FolderPlus, onClick: () => addFolder(n.id) },
      { label: "Run folder", icon: Play, onClick: () => s.openTab("runner", `${c.id}:${n.id}`, `Runner · ${n.name}`, { collectionId: c.id, itemId: n.id }) },
      { label: "Edit folder (auth, scripts, docs)", icon: FolderOpen, onClick: () => s.openNode(c.id, n.id) },
      { divider: true, label: "" },
      { label: "Rename", icon: Pencil, onClick: () => setRenaming(n.id) },
      { label: "Duplicate", icon: Copy, onClick: () => s.duplicateNode(c.id, n.id) },
      { label: "Move up", icon: ArrowUp, onClick: () => move(n.id, -1) },
      { label: "Move down", icon: ArrowDown, onClick: () => move(n.id, 1) },
      { label: "Delete", icon: Trash2, danger: true, onClick: () => s.setDialog({ type: "confirm", title: `Delete "${n.name}"?`, body: "The folder and everything in it will be removed.", danger: true, action: () => s.deleteNode(c.id, n.id) }) },
    ];
  return [
    { label: "Open in a new tab", icon: Plus, onClick: () => s.openNode(c.id, n.id) },
    { label: "Share", icon: Share2, onClick: () => s.setDialog({ type: "share", collectionId: c.id, itemId: n.id }) },
    { divider: true, label: "" },
    { label: "Rename", icon: Pencil, onClick: () => setRenaming(n.id) },
    { label: "Duplicate", icon: Copy, onClick: () => s.duplicateNode(c.id, n.id) },
    { label: "Move up", icon: ArrowUp, onClick: () => move(n.id, -1) },
    { label: "Move down", icon: ArrowDown, onClick: () => move(n.id, 1) },
    { label: "Delete", icon: Trash2, danger: true, onClick: () => s.deleteNode(c.id, n.id) },
  ];
}

function RenameInput({ value, onDone }: { value: string; onDone: (v: string | null) => void }) {
  const [v, setV] = useState(value);
  return (
    <input
      autoFocus
      aria-label="New name"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={() => onDone(v.trim() || null)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onDone(v.trim() || null);
        if (e.key === "Escape") onDone(null);
      }}
      className="h-6 min-w-0 flex-1 rounded-[5px] border border-ink bg-surface px-1.5 text-[13px] outline-none"
    />
  );
}

function CollectionRow({ c, open, toggle, openMap, renaming, setRenaming, matches, onNavigate }: { c: Collection; open: boolean; toggle: (id: string, v?: boolean) => void; openMap: Record<string, boolean>; renaming: string | null; setRenaming: (id: string | null) => void; matches: Set<string> | null; onNavigate?: () => void }) {
  const s = useApi.getState();
  const activeTab = useApi((st) => st.tabs.find((t) => t.id === st.activeTabId));
  const items = useNodeMenu(c, null, setRenaming, toggle);
  const [over, setOver] = useState(false);
  return (
    <div>
      <div
        className={cn("group mx-1 flex h-8 items-center gap-1 rounded-md pr-1 hover:bg-paper-2", activeTab?.kind === "collection" && activeTab.target === c.id && "bg-paper-2", over && "ring-1 ring-accent")}
        onDragOver={(e) => {
          if (dragging) {
            e.preventDefault();
            setOver(true);
          }
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (dragging) s.moveNode(dragging.collectionId, dragging.id, c.id, null);
          dragging = null;
        }}
      >
        <button type="button" aria-label={open ? "Collapse" : "Expand"} aria-expanded={open} onClick={() => toggle(c.id)} className="inline-flex size-6 shrink-0 items-center justify-center rounded text-ink-3 hover:text-ink">
          <ChevronRight aria-hidden className={cn("size-3.5 transition-transform", open && "rotate-90")} />
        </button>
        <Box aria-hidden className="size-3.5 shrink-0 text-ink-3" />
        {renaming === c.id ? (
          <RenameInput
            value={c.name}
            onDone={(v) => {
              if (v) s.updateCollection(c.id, (x) => ({ ...x, name: v }));
              setRenaming(null);
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              s.openTab("collection", c.id, c.name);
              toggle(c.id, true);
              onNavigate?.();
            }}
            onDoubleClick={() => setRenaming(c.id)}
            className="min-w-0 flex-1 truncate text-left text-[13px] font-medium text-ink"
          >
            {c.name}
          </button>
        )}
        <Menu label={`${c.name} actions`} align="end" items={items} trigger={({ toggle: t, ref }) => <IconBtn ref={ref} icon={MoreHorizontal} label="Collection actions" size="xs" onClick={t} className="opacity-0 focus:opacity-100 group-hover:opacity-100 max-md:opacity-100" />} />
      </div>
      {open && (
        <div>
          {c.items.length === 0 && (
            <p className="py-1 pl-10 text-[12px] text-ink-3">
              This collection is empty.{" "}
              <button
                type="button"
                className="underline hover:text-ink"
                onClick={() => {
                  const r = newRequest({ name: "New Request" });
                  s.addNode(c.id, null, r);
                  s.openNode(c.id, r.id);
                }}
              >
                Add a request
              </button>
            </p>
          )}
          {c.items
            .filter((n) => !matches || matches.has(n.id))
            .map((n) => (
              <NodeRow key={n.id} c={c} n={n} depth={1} openMap={openMap} toggle={toggle} renaming={renaming} setRenaming={setRenaming} matches={matches} onNavigate={onNavigate} />
            ))}
        </div>
      )}
    </div>
  );
}

function NodeRow({ c, n, depth, openMap, toggle, renaming, setRenaming, matches, onNavigate }: { c: Collection; n: TreeNode; depth: number; openMap: Record<string, boolean>; toggle: (id: string, v?: boolean) => void; renaming: string | null; setRenaming: (id: string | null) => void; matches: Set<string> | null; onNavigate?: () => void }) {
  const s = useApi.getState();
  const active = useApi((st) => {
    const t = st.tabs.find((x) => x.id === st.activeTabId);
    return t?.ref?.itemId === n.id;
  });
  const dirty = useApi((st) => st.tabs.some((t) => t.ref?.itemId === n.id && t.dirty));
  const items = useNodeMenu(c, n, setRenaming, toggle);
  const open = n.kind === "folder" && (!!openMap[n.id] || !!matches);
  const [over, setOver] = useState<"in" | "before" | null>(null);
  return (
    <div>
      <div
        draggable={renaming !== n.id}
        onDragStart={(e) => {
          dragging = { collectionId: c.id, id: n.id };
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", n.name);
        }}
        onDragEnd={() => {
          dragging = null;
          setOver(null);
        }}
        onDragOver={(e) => {
          if (!dragging || dragging.id === n.id) return;
          e.preventDefault();
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          setOver(n.kind === "folder" && e.clientY > r.top + r.height * 0.3 ? "in" : "before");
        }}
        onDragLeave={() => setOver(null)}
        onDrop={(e) => {
          e.preventDefault();
          const d = dragging;
          dragging = null;
          const where = over;
          setOver(null);
          if (!d || d.id === n.id) return;
          if (where === "in" && n.kind === "folder") {
            s.moveNode(d.collectionId, d.id, c.id, n.id);
            toggle(n.id, true);
          } else {
            const hit = findNode(c.items, n.id);
            const parent: Folder | undefined = hit?.parents.at(-1);
            const siblings = (parent ? parent.items : c.items).filter((x) => x.id !== d.id);
            s.moveNode(d.collectionId, d.id, c.id, parent?.id ?? null, Math.max(0, siblings.findIndex((x) => x.id === n.id)));
          }
        }}
        style={{ paddingLeft: depth * 14 }}
        className={cn("group relative mx-1 flex h-8 items-center gap-1 rounded-md pr-1 hover:bg-paper-2", active && "bg-paper-2", over === "in" && "ring-1 ring-accent")}
      >
        {over === "before" && <span aria-hidden className="absolute inset-x-1 -top-px h-0.5 rounded bg-accent" />}
        {n.kind === "folder" ? (
          <button type="button" aria-label={open ? "Collapse" : "Expand"} aria-expanded={open} onClick={() => toggle(n.id)} className="inline-flex size-6 shrink-0 items-center justify-center rounded text-ink-3 hover:text-ink">
            <ChevronRight aria-hidden className={cn("size-3.5 transition-transform", open && "rotate-90")} />
          </button>
        ) : (
          <span className="w-1 shrink-0" />
        )}
        {n.kind === "folder" ? (open ? <FolderOpen aria-hidden className="size-3.5 shrink-0 text-ink-3" /> : <FolderIcon aria-hidden className="size-3.5 shrink-0 text-ink-3" />) : <MethodTag method={n.method} protocol={n.protocol} className="w-10" />}
        {renaming === n.id ? (
          <RenameInput
            value={n.name}
            onDone={(v) => {
              if (v) s.updateNode(c.id, n.id, (x) => ({ ...x, name: v }));
              setRenaming(null);
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              if (n.kind === "folder") toggle(n.id);
              else {
                s.openNode(c.id, n.id, true);
                onNavigate?.();
              }
            }}
            onDoubleClick={() => (n.kind === "request" ? s.pinTab(useApi.getState().activeTabId ?? "") : setRenaming(n.id))}
            className="min-w-0 flex-1 truncate text-left text-[13px] text-ink"
            title={n.kind === "request" ? `${n.method} ${n.url}` : n.name}
          >
            {n.name}
          </button>
        )}
        {dirty && <span aria-label="Unsaved changes" className="size-1.5 shrink-0 rounded-full bg-accent" />}
        <Menu label={`${n.name} actions`} align="end" items={items} trigger={({ toggle: t, ref }) => <IconBtn ref={ref} icon={MoreHorizontal} label="Actions" size="xs" onClick={t} className="opacity-0 focus:opacity-100 group-hover:opacity-100 max-md:opacity-100" />} />
      </div>
      {open &&
        n.kind === "folder" &&
        (n.items.length ? (
          n.items.filter((x) => !matches || matches.has(x.id)).map((x) => <NodeRow key={x.id} c={c} n={x} depth={depth + 1} openMap={openMap} toggle={toggle} renaming={renaming} setRenaming={setRenaming} matches={matches} onNavigate={onNavigate} />)
        ) : (
          <p className="py-1 text-[12px] text-ink-3" style={{ paddingLeft: (depth + 1) * 14 + 22 }}>
            This folder is empty
          </p>
        ))}
    </div>
  );
}

/* ------------------------------------------------------------------ environments */

function EnvironmentsPanel({ onNavigate }: { onNavigate?: () => void }) {
  const ws = useApi((s) => s.ws);
  const s = useApi.getState();
  const [q, setQ] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const openTab = useApi((st) => st.openTab);
  const activeTab = useApi((st) => st.tabs.find((t) => t.id === st.activeTabId));
  const row = (id: string, label: string, icon: typeof Globe2, onClick: () => void, extra?: React.ReactNode, isActive?: boolean) => (
    <div key={id} className={cn("group mx-1 flex h-8 items-center gap-2 rounded-md px-2 hover:bg-paper-2", isActive && "bg-paper-2")}>
      {(() => {
        const I = icon;
        return <I aria-hidden className="size-3.5 shrink-0 text-ink-3" />;
      })()}
      {renaming === id ? (
        <RenameInput
          value={label}
          onDone={(v) => {
            if (v) s.updateEnvironment(id, (e) => ({ ...e, name: v }));
            setRenaming(null);
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            onClick();
            onNavigate?.();
          }}
          className="min-w-0 flex-1 truncate text-left text-[13px] text-ink"
        >
          {label}
        </button>
      )}
      {extra}
    </div>
  );
  return (
    <>
      <PanelHead title="Environments" query={q} setQuery={setQ}>
        <IconBtn
          icon={Plus}
          label="New environment"
          onClick={() => {
            const e = s.addEnvironment();
            setRenaming(e.id);
            openTab("environment", e.id, e.name);
          }}
        />
        <IconBtn icon={Upload} label="Import" onClick={() => s.setDialog({ type: "import" })} />
      </PanelHead>
      <div className="min-h-0 flex-1 overflow-y-auto py-1" data-lenis-prevent>
        {row("globals", "Globals", Globe2, () => openTab("globals", "globals", "Globals"), undefined, activeTab?.kind === "globals")}
        {row("vault", "Vault", KeyRound, () => openTab("vault", "vault", "Vault"), undefined, activeTab?.kind === "vault")}
        <div className="mx-3 my-1 h-px bg-line" />
        {ws.environments
          .filter((e) => !q || e.name.toLowerCase().includes(q.toLowerCase()))
          .map((e) =>
            row(
              e.id,
              e.name,
              Box,
              () => openTab("environment", e.id, e.name),
              <>
                <button
                  type="button"
                  aria-label={ws.activeEnvId === e.id ? "Active environment" : "Set as active environment"}
                  title={ws.activeEnvId === e.id ? "Active" : "Set active"}
                  onClick={() => s.setActiveEnv(ws.activeEnvId === e.id ? null : e.id)}
                  className={cn("inline-flex size-6 items-center justify-center rounded", ws.activeEnvId === e.id ? "text-success" : "text-ink-3 opacity-0 hover:text-ink group-hover:opacity-100 max-md:opacity-100")}
                >
                  <Check aria-hidden className="size-3.5" />
                </button>
                <Menu
                  label="Environment actions"
                  align="end"
                  items={[
                    { label: ws.activeEnvId === e.id ? "Deactivate" : "Set active", icon: Check, onClick: () => s.setActiveEnv(ws.activeEnvId === e.id ? null : e.id) },
                    { label: "Rename", icon: Pencil, onClick: () => setRenaming(e.id) },
                    { label: "Duplicate", icon: Copy, onClick: () => s.addEnvironment({ ...e, id: uid(), name: `${e.name} Copy`, values: e.values.map((v) => ({ ...v, id: uid() })) }) },
                    { label: "Export", icon: Download, onClick: () => downloadFile(`${safeName(e.name)}.postman_environment.json`, JSON.stringify(environmentToPostman(e), null, 2)) },
                    { label: "Delete", icon: Trash2, danger: true, onClick: () => s.setDialog({ type: "confirm", title: `Delete "${e.name}"?`, body: "Its variables will be removed.", danger: true, action: () => s.deleteEnvironment(e.id) }) },
                  ]}
                  trigger={({ toggle, ref }) => <IconBtn ref={ref} icon={MoreHorizontal} label="Actions" size="xs" onClick={toggle} className="opacity-0 focus:opacity-100 group-hover:opacity-100 max-md:opacity-100" />}
                />
              </>,
              activeTab?.kind === "environment" && activeTab.target === e.id,
            ),
          )}
        {!ws.environments.length && <p className="px-4 py-6 text-center text-[13px] text-ink-3">An environment is a set of variables (like a base URL and keys) you can switch between: dev, staging, production.</p>}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ history */

function HistoryPanel({ onNavigate }: { onNavigate?: () => void }) {
  const history = useApi((s) => s.ws.history);
  const s = useApi.getState();
  const [q, setQ] = useState("");
  const groups = useMemo(() => {
    const out = new Map<string, HistoryEntry[]>();
    for (const h of history) {
      if (q && !`${h.request.method} ${h.request.url} ${h.request.name}`.toLowerCase().includes(q.toLowerCase())) continue;
      const k = dayLabel(h.at);
      out.set(k, [...(out.get(k) ?? []), h]);
    }
    return [...out];
  }, [history, q]);
  return (
    <>
      <PanelHead title="History" query={q} setQuery={setQ}>
        <IconBtn icon={Trash2} label="Clear all history" disabled={!history.length} onClick={() => s.setDialog({ type: "confirm", title: "Clear all history?", body: "Every request in History will be removed.", danger: true, action: () => s.mutate((w) => ({ ...w, history: [] })) })} />
      </PanelHead>
      <div className="min-h-0 flex-1 overflow-y-auto py-1" data-lenis-prevent>
        {!history.length && <p className="px-4 py-8 text-center text-[13px] text-ink-3">Requests you send show up here.</p>}
        {groups.map(([day, list]) => (
          <section key={day}>
            <h3 className="sticky top-0 z-[1] bg-surface px-3 py-1 font-mono text-[12px] uppercase tracking-[0.08em] text-ink-3">{day}</h3>
            {list.map((h) => (
              <div key={h.id} className="group mx-1 flex h-8 items-center gap-1.5 rounded-md pr-1 hover:bg-paper-2">
                <MethodTag method={h.request.method} protocol={h.request.protocol} />
                <button
                  type="button"
                  onClick={() => {
                    s.newRequestTab(h.request.protocol, { ...h.request, id: uid() });
                    onNavigate?.();
                  }}
                  className="min-w-0 flex-1 truncate text-left text-[12.5px] text-ink"
                  title={`${h.request.url}\n${new Date(h.at).toLocaleString()}`}
                >
                  {h.request.url.replace(/^https?:\/\//, "")}
                </button>
                <span className={cn("shrink-0 font-mono text-[12px]", !h.status ? "text-danger" : h.status < 300 ? "text-success" : h.status < 400 ? "text-warning" : "text-danger")}>{h.status ?? "ERR"}</span>
                <Menu
                  label="History entry actions"
                  align="end"
                  items={[
                    { label: "Open in a new tab", icon: Plus, onClick: () => s.newRequestTab(h.request.protocol, { ...h.request, id: uid() }) },
                    {
                      label: "Save to a collection…",
                      icon: Box,
                      onClick: () => {
                        s.newRequestTab(h.request.protocol, { ...h.request, id: uid() });
                        const tabId = useApi.getState().activeTabId;
                        if (tabId) s.setDialog({ type: "save", tabId });
                      },
                    },
                    { label: "Copy URL", icon: Copy, onClick: () => void navigator.clipboard?.writeText(h.request.url).then(() => s.notify("URL copied", "success")) },
                    { divider: true, label: "" },
                    { label: "Remove from history", icon: Trash2, danger: true, onClick: () => s.mutate((w) => ({ ...w, history: w.history.filter((x) => x.id !== h.id) })) },
                  ]}
                  trigger={({ toggle, ref }) => <IconBtn ref={ref} icon={MoreHorizontal} label="History entry actions" size="xs" onClick={toggle} className="opacity-0 focus:opacity-100 group-hover:opacity-100 max-md:opacity-100" />}
                />
              </div>
            ))}
          </section>
        ))}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ mocks, monitors, flows, specs */

function ListPanel({ kind, onNavigate }: { kind: "mocks" | "monitors" | "flows" | "specs"; onNavigate?: () => void }) {
  const ws = useApi((s) => s.ws);
  const s = useApi.getState();
  const activeTab = useApi((st) => st.tabs.find((t) => t.id === st.activeTabId));
  const tabKind = { mocks: "mock", monitors: "monitor", flows: "flow", specs: "spec" }[kind] as "mock" | "monitor" | "flow" | "spec";
  const items: { id: string; name: string; sub: string }[] =
    kind === "mocks"
      ? ws.mocks.map((m) => ({ id: m.id, name: m.name, sub: ws.collections.find((c) => c.id === m.collectionId)?.name ?? "Missing collection" }))
      : kind === "monitors"
        ? ws.monitors.map((m) => ({ id: m.id, name: m.name, sub: `${m.enabled ? `Every ${m.intervalMin} min` : "Paused"}${m.lastRunAt ? ` · ran ${relTime(m.lastRunAt)}` : ""}` }))
        : kind === "flows"
          ? ws.flows.map((f) => ({ id: f.id, name: f.name, sub: `${f.blocks.length} blocks` }))
          : ws.specs.map((sp) => ({ id: sp.id, name: sp.name, sub: `${sp.format.toUpperCase()} · ${relTime(sp.updatedAt)}` }));
  const title = SECTIONS.find((x) => x.id === kind)!.label;
  const create = () => {
    const first = ws.collections[0];
    if (kind === "mocks") {
      if (!first) return s.notify("Create a collection first: mocks answer from its saved examples.", "danger");
      const m = { id: uid().slice(0, 10), name: "New mock server", collectionId: first.id, delayMs: 0, enabled: true, createdAt: Date.now(), log: [] };
      s.mutate((w) => ({ ...w, mocks: [...w.mocks, m] }));
      s.openTab("mock", m.id, m.name);
    } else if (kind === "monitors") {
      if (!first) return s.notify("Create a collection first: monitors run a collection on a schedule.", "danger");
      const m = { id: uid(), name: "New monitor", collectionId: first.id, intervalMin: 15, enabled: false, notify: true, createdAt: Date.now(), runs: [] };
      s.mutate((w) => ({ ...w, monitors: [...w.monitors, m] }));
      s.openTab("monitor", m.id, m.name);
    } else if (kind === "flows") {
      const f = { id: uid(), name: "New flow", createdAt: Date.now(), blocks: [{ id: uid(), type: "start" as const, x: 40, y: 120, data: {} }], edges: [] };
      s.mutate((w) => ({ ...w, flows: [...w.flows, f] }));
      s.openTab("flow", f.id, f.name);
    } else {
      const sp = { id: uid(), name: "New API spec", format: "yaml" as const, updatedAt: Date.now(), content: 'openapi: 3.0.3\ninfo:\n  title: My API\n  version: 1.0.0\nservers:\n  - url: https://api.example.com\npaths:\n  /items:\n    get:\n      summary: List items\n      responses:\n        "200":\n          description: OK\n          content:\n            application/json:\n              schema:\n                type: array\n                items:\n                  type: object\n                  properties:\n                    id: { type: integer, example: 1 }\n                    name: { type: string, example: Widget }\n' };
      s.mutate((w) => ({ ...w, specs: [...w.specs, sp] }));
      s.openTab("spec", sp.id, sp.name);
    }
    onNavigate?.();
  };
  const remove = (id: string) =>
    s.mutate((w) => ({ ...w, mocks: w.mocks.filter((x) => x.id !== id), monitors: w.monitors.filter((x) => x.id !== id), flows: w.flows.filter((x) => x.id !== id), specs: w.specs.filter((x) => x.id !== id) }));
  const empty = {
    mocks: "A mock server answers requests from a collection's saved examples, so you can build against an API before it exists.",
    monitors: "A monitor runs a collection on a schedule and records how it did. It runs while this tool is open in a tab.",
    flows: "Flows chain requests visually: send, check, branch, loop and pass data along, without writing a script.",
    specs: "Write an OpenAPI spec with live validation, preview its documentation, and turn it into a collection.",
  }[kind];
  return (
    <>
      <PanelHead title={title}>
        <IconBtn icon={Plus} label={`New ${tabKind}`} onClick={create} />
      </PanelHead>
      <div className="min-h-0 flex-1 overflow-y-auto py-1" data-lenis-prevent>
        {!items.length && (
          <div className="px-4 py-8 text-center text-[13px] text-ink-3">
            <p>{empty}</p>
            <button type="button" className="mt-2 font-medium text-ink underline" onClick={create}>
              Create one
            </button>
          </div>
        )}
        {items.map((it) => (
          <div key={it.id} className={cn("group mx-1 flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-paper-2", activeTab?.kind === tabKind && activeTab.target === it.id && "bg-paper-2")}>
            {kind === "mocks" ? <Server aria-hidden className="size-3.5 shrink-0 text-ink-3" /> : kind === "monitors" ? <Clock aria-hidden className="size-3.5 shrink-0 text-ink-3" /> : kind === "flows" ? <Workflow aria-hidden className="size-3.5 shrink-0 text-ink-3" /> : <FileCode2 aria-hidden className="size-3.5 shrink-0 text-ink-3" />}
            <button
              type="button"
              onClick={() => {
                s.openTab(tabKind, it.id, it.name);
                onNavigate?.();
              }}
              className="min-w-0 flex-1 text-left"
            >
              <span className="block truncate text-[13px] text-ink">{it.name}</span>
              <span className="block truncate text-[12px] text-ink-3">{it.sub}</span>
            </button>
            <IconBtn icon={Trash2} label="Delete" size="xs" onClick={() => s.setDialog({ type: "confirm", title: `Delete "${it.name}"?`, body: "This can't be undone.", danger: true, action: () => remove(it.id) })} className="opacity-0 group-hover:opacity-100 max-md:opacity-100" />
          </div>
        ))}
      </div>
    </>
  );
}

export { collectionToPostman };
