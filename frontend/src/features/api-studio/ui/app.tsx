"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Code2, Cookie as CookieIcon, Eye, FolderKanban, Keyboard, Maximize2, Menu as MenuIcon, Minimize2, MoreHorizontal, PanelLeft, Search, Plus, Settings, Terminal, Upload, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Workbench } from "@/components/tools/workbench";
import type { Protocol, Tab } from "../types";
import { activeEnv, useApi } from "../store";
import { readShareHash } from "../lib/share";
import { Btn, IconBtn, Label, Menu, MethodTag, Popover, Resizer, useTier } from "./kit";
import { Rail, SidebarPanel } from "./sidebar";
import { RequestWorkspace } from "./request-pane";
import { RealtimeWorkspace, closeRealtime } from "./realtime-pane";
import { GrpcWorkspace } from "./grpc-pane";
import { CollectionView, EnvironmentView, FolderView, MockView } from "./views";
import { RunnerView } from "./runner-view";
import { DocsView, MonitorView, SpecView, useMonitorScheduler } from "./more-views";
import { FlowView } from "./flow-view";
import { ConsolePanel, RightPanel } from "./panels";
import { Dialogs } from "./dialogs";

const STEPS = ["Build a request", "Send it", "Test, save & share"] as const;

export function ApiStudio() {
  const loaded = useApi((s) => s.loaded);
  const init = useApi((s) => s.init);
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    void init().then(() => {
      // A share link (#import=…) opens the import dialog with what it carries.
      const shared = readShareHash(location.hash);
      if (shared) {
        useApi.getState().setDialog({ type: "import", text: shared });
        history.replaceState(null, "", location.pathname + location.search);
      }
    });
  }, [init]);
  useMonitorScheduler();
  const active = useApi((s) => s.tabs.find((t) => t.id === s.activeTabId));
  const sending = useApi((s) => (active ? !!s.sending[active.id] : false));
  const hasRes = useApi((s) => (active ? !!s.responses[active.id] : false));
  const step = sending ? 1 : hasRes ? 2 : 0;

  useEffect(() => {
    if (!fullscreen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => void (document.body.style.overflow = prev);
  }, [fullscreen]);

  const body = (
    <Workbench
      steps={STEPS}
      current={step}
      className={cn(fullscreen && "fixed inset-0 z-[100] flex flex-col rounded-none border-0 [&>ol]:hidden")}
      footer={
        fullscreen ? undefined : (
          <>
            Your collections, environments and history stay in this browser. Requests go out from your browser, or through our server when an API doesn&apos;t allow browser calls (public addresses only; nothing is kept). Don&apos;t paste production secrets into any online tool.
          </>
        )
      }
    >
      <div className={cn("relative flex flex-col bg-surface text-ink", fullscreen ? "min-h-0 flex-1" : "h-[calc(100dvh-116px)] min-h-[540px] sm:h-[calc(100dvh-96px)] md:h-[min(86dvh,1040px)] lg:h-[min(88dvh,1120px)]")}>
        {loaded ? <Shell fullscreen={fullscreen} setFullscreen={setFullscreen} /> : <div aria-hidden className="h-full animate-pulse bg-paper" />}
      </div>
    </Workbench>
  );
  return fullscreen ? createPortal(body, document.body) : body;
}

function Shell({ fullscreen, setFullscreen }: { fullscreen: boolean; setFullscreen: (f: boolean) => void }) {
  const tier = useTier();
  const prefs = useApi((s) => s.prefs);
  const setPrefs = useApi((s) => s.setPrefs);
  const tabs = useApi((s) => s.tabs);
  const activeId = useApi((s) => s.activeTabId);
  const active = tabs.find((t) => t.id === activeId);
  const toast = useApi((s) => s.toast);
  const [drawer, setDrawer] = useState(false);
  const [sideW, setSideW] = useState(prefs.sidebarW);
  const [consoleH, setConsoleH] = useState(220);
  useShortcuts(setFullscreen, fullscreen);

  const sidebarOpen = tier === "phone" ? drawer : prefs.sidebarOpen;
  const rightOverlay = tier !== "desktop";

  return (
    <div data-api-studio className="flex h-full min-h-0 flex-col">
      <TopBar tier={tier} fullscreen={fullscreen} setFullscreen={setFullscreen} onMenu={() => setDrawer(true)} />
      <div className="relative flex min-h-0 flex-1">
        {tier !== "phone" && <Rail />}
        {tier !== "phone" && sidebarOpen && (
          <>
            <aside className={cn("min-h-0 shrink-0 border-r border-line", tier === "tablet" && "absolute inset-y-0 left-[78px] z-30 shadow-float")} style={{ width: tier === "tablet" ? Math.min(320, sideW) : sideW }}>
              <SidebarPanel onNavigate={tier === "tablet" ? () => setPrefs({ sidebarOpen: false }) : undefined} />
            </aside>
            {tier === "desktop" && (
              <Resizer
                dir="x"
                label="Resize sidebar"
                className="-ml-1.5 -mr-1.5"
                onDrag={(d, done) =>
                  setSideW((w) => {
                    const next = Math.min(520, Math.max(200, w + d));
                    if (done) setPrefs({ sidebarW: next });
                    return next;
                  })
                }
              />
            )}
          </>
        )}
        {tier === "phone" && drawer && (
          <div className="absolute inset-0 z-40 flex" role="dialog" aria-label="Sidebar">
            <div className="flex h-full w-[min(360px,88vw)] min-h-0 border-r border-line bg-surface shadow-float">
              <Rail />
              <div className="min-w-0 flex-1">
                <SidebarPanel onNavigate={() => setDrawer(false)} />
              </div>
            </div>
            <button type="button" aria-label="Close sidebar" className="flex-1 bg-ink/25 backdrop-blur-[1px]" onClick={() => setDrawer(false)} />
          </div>
        )}
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <TabsBar tier={tier} />
          <div className="relative min-h-0 flex-1">
            {active ? <ActiveView tab={active} tier={tier} /> : <Welcome />}
          </div>
          {prefs.consoleOpen && (
            <>
              <Resizer dir="y" label="Resize console" onDrag={(d) => setConsoleH((h) => Math.min(600, Math.max(120, h - d)))} />
              <div className="shrink-0 border-t border-line" style={{ height: tier === "phone" ? "45%" : consoleH }}>
                <ConsolePanel onClose={() => setPrefs({ consoleOpen: false })} />
              </div>
            </>
          )}
          <StatusBar />
        </main>
        {prefs.right && (
          <aside className={cn("min-h-0 shrink-0 border-l border-line", rightOverlay ? "absolute inset-y-0 right-0 z-30 w-[min(420px,92%)] shadow-float" : "w-[380px]")}>
            <RightPanel tab={active} which={prefs.right} onClose={() => setPrefs({ right: null })} />
          </aside>
        )}
      </div>
      <Dialogs />
      {toast && (
        <div role="status" className={cn("pointer-events-none absolute bottom-10 left-1/2 z-[120] max-w-[90%] -translate-x-1/2 rounded-md px-3 py-2 text-[13px] shadow-float", toast.tone === "danger" ? "bg-danger text-white" : "bg-ink text-paper")}>
          {toast.text}
        </div>
      )}
    </div>
  );
}

function TopBar({ tier, fullscreen, setFullscreen, onMenu }: { tier: ReturnType<typeof useTier>; fullscreen: boolean; setFullscreen: (f: boolean) => void; onMenu: () => void }) {
  const ws = useApi((s) => s.ws);
  const s = useApi.getState();
  const prefs = useApi((st) => st.prefs);
  const env = activeEnv(ws);
  const eye = useRef<HTMLButtonElement>(null);
  const [look, setLook] = useState(false);
  return (
    <header className="flex h-11 shrink-0 items-center gap-1 border-b border-line bg-paper px-1.5 sm:gap-1.5 sm:px-2">
      {tier === "phone" ? <IconBtn icon={MenuIcon} label="Open sidebar" onClick={onMenu} /> : <IconBtn icon={PanelLeft} label="Toggle sidebar (Ctrl+\\)" active={prefs.sidebarOpen} onClick={() => s.setPrefs({ sidebarOpen: !prefs.sidebarOpen })} />}
      <button type="button" onClick={() => s.setDialog({ type: "workspaces" })} className="inline-flex h-8 min-w-0 max-w-[160px] items-center gap-1.5 rounded-md px-2 text-[13px] font-medium hover:bg-paper-2 sm:max-w-[220px]" title="Workspaces">
        <FolderKanban aria-hidden className="size-4 shrink-0 text-ink-3" />
        <span className="truncate">{ws.name}</span>
        <ChevronDown aria-hidden className="size-3.5 shrink-0 text-ink-3" />
      </button>
      <Btn variant="primary" icon={Plus} onClick={() => s.setDialog({ type: "new" })} className="max-sm:px-2">
        <span className="max-sm:sr-only">New</span>
      </Btn>
      <Btn icon={Upload} onClick={() => s.setDialog({ type: "import" })} className="max-sm:hidden">
        Import
      </Btn>
      <button type="button" onClick={() => s.setDialog({ type: "search" })} className="mx-1 hidden h-8 min-w-0 max-w-[280px] flex-1 items-center gap-2 rounded-md border border-line bg-surface px-2.5 text-left text-[13px] text-ink-3 hover:border-ink-3 md:inline-flex" title="Quick search (Ctrl+K)">
        <Search aria-hidden className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">Search requests, commands…</span>
        <kbd className="shrink-0 rounded border border-line px-1 font-mono text-[12px]">Ctrl K</kbd>
      </button>
      <IconBtn icon={Search} label="Quick search" onClick={() => s.setDialog({ type: "search" })} className="md:hidden" />
      <span className="flex-1" />
      <select
        aria-label="Active environment"
        value={ws.activeEnvId ?? ""}
        onChange={(e) => s.setActiveEnv(e.target.value || null)}
        className="h-8 w-[118px] min-w-0 rounded-md border border-line bg-surface px-2 text-[13px] outline-none hover:border-ink-3 focus:border-ink sm:w-[180px]"
      >
        <option value="">No environment</option>
        {ws.environments.map((e) => (
          <option key={e.id} value={e.id}>
            {e.name}
          </option>
        ))}
      </select>
      <IconBtn ref={eye} icon={Eye} label="Environment quick look" active={look} onClick={() => setLook((l) => !l)} />
      <Popover anchor={eye} open={look} onClose={() => setLook(false)} align="end">
        <QuickLook onClose={() => setLook(false)} />
      </Popover>
      <IconBtn icon={CookieIcon} label="Cookies" onClick={() => s.setDialog({ type: "cookies" })} className="max-sm:hidden" />
      <IconBtn icon={Settings} label="Settings (Ctrl+,)" onClick={() => s.setDialog({ type: "settings" })} />
      <IconBtn icon={Keyboard} label="Keyboard shortcuts (?)" onClick={() => s.setDialog({ type: "shortcuts" })} className="max-md:hidden" />
      {/* Phones: what the narrow bar can't fit lives in one menu. */}
      <span className="sm:hidden">
        <Menu
          label="More"
          align="end"
          items={[
            { label: "Import", icon: Upload, onClick: () => s.setDialog({ type: "import" }) },
            { label: "Cookies", icon: CookieIcon, onClick: () => s.setDialog({ type: "cookies" }) },
            { label: "Workspaces", icon: FolderKanban, onClick: () => s.setDialog({ type: "workspaces" }) },
            { label: "Console", icon: Terminal, onClick: () => s.setPrefs({ consoleOpen: !prefs.consoleOpen }) },
            { label: "Keyboard shortcuts", icon: Keyboard, onClick: () => s.setDialog({ type: "shortcuts" }) },
          ]}
          trigger={({ toggle, ref }) => <IconBtn ref={ref} icon={MoreHorizontal} label="More actions" onClick={toggle} />}
        />
      </span>
      <IconBtn icon={fullscreen ? Minimize2 : Maximize2} label={fullscreen ? "Exit full screen" : "Full screen"} onClick={() => setFullscreen(!fullscreen)} />
      {env && tier === "desktop" && <span className="sr-only">Active environment: {env.name}</span>}
    </header>
  );
}

function QuickLook({ onClose }: { onClose: () => void }) {
  const ws = useApi((s) => s.ws);
  const s = useApi.getState();
  const env = activeEnv(ws);
  const collectionId = useApi((st) => st.tabs.find((t) => t.id === st.activeTabId)?.ref?.collectionId);
  const collection = ws.collections.find((c) => c.id === collectionId);
  const rows = (vars: typeof ws.globals) =>
    vars.filter((v) => v.enabled).length ? (
      <table className="w-full text-[12px]">
        <thead>
          <tr className="text-left text-ink-3">
            <th className="pb-1 font-normal">Variable</th>
            <th className="pb-1 font-normal">Current value</th>
          </tr>
        </thead>
        <tbody>
          {vars.filter((v) => v.enabled).map((v) => (
            <tr key={v.id}>
              <td className="max-w-[140px] truncate py-0.5 pr-2 font-mono">{v.key}</td>
              <td className="max-w-[200px] truncate py-0.5 font-mono text-ink-2">{v.type === "secret" ? "••••••" : (v.current ?? v.value) || <span className="text-ink-3">empty</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    ) : (
      <p className="text-[12px] text-ink-3">No variables.</p>
    );
  return (
    <div className="space-y-3 p-3">
      <section>
        <div className="mb-1 flex items-center justify-between">
          <Label>{env ? env.name : "No environment selected"}</Label>
          {env && (
            <button type="button" className="text-[12px] underline" onClick={() => { s.openTab("environment", env.id, env.name); onClose(); }}>
              Edit
            </button>
          )}
        </div>
        {env ? rows(env.values) : <p className="text-[12px] leading-relaxed text-ink-3">No environment variables apply. Requests still use the open collection&apos;s variables and globals, below.</p>}
      </section>
      {collection && (
        <section className="border-t border-line pt-2">
          <div className="mb-1 flex items-center justify-between gap-2">
            <Label className="truncate">Collection · {collection.name}</Label>
            <button type="button" className="shrink-0 text-[12px] underline" onClick={() => { s.openTab("collection", collection.id, collection.name); onClose(); }}>
              Edit
            </button>
          </div>
          {rows(collection.variables)}
        </section>
      )}
      <p className="text-[12px] leading-relaxed text-ink-3">When a name is set in more than one place, the environment wins over the collection, and the collection over globals.</p>
      <section className="border-t border-line pt-2">
        <div className="mb-1 flex items-center justify-between">
          <Label>Globals</Label>
          <button type="button" className="text-[12px] underline" onClick={() => { s.openTab("globals", "globals", "Globals"); onClose(); }}>
            Edit
          </button>
        </div>
        {rows(ws.globals)}
      </section>
    </div>
  );
}

function tabLabel(t: Tab): { tag?: React.ReactNode; kind: string } {
  if (t.kind === "request" && t.draft) return { tag: <MethodTag method={t.draft.method} protocol={t.draft.protocol} className="w-auto" />, kind: "" };
  const map: Record<string, string> = { collection: "COL", folder: "DIR", environment: "ENV", globals: "ENV", vault: "KEY", runner: "RUN", docs: "DOC", mock: "MOCK", monitor: "MON", flow: "FLOW", spec: "API", performance: "PERF" };
  return { kind: map[t.kind] ?? "" };
}

/** Closes a tab, asking first when that would lose unsaved work. */
function closeTabSafely(t: Tab) {
  const s = useApi.getState();
  const doClose = () => {
    closeRealtime(t.id);
    s.closeTab(t.id);
  };
  // Edits to a saved request, or a new request that has something in it.
  const hasWork = t.dirty && (t.ref?.itemId || !!(t.draft && (t.draft.url.trim() || t.draft.body.raw.trim() || t.draft.scripts.prerequest.trim() || t.draft.scripts.test.trim())));
  if (hasWork) s.setDialog({ type: "confirm", title: `Close "${t.title}" without saving?`, body: t.ref?.itemId ? "Your changes to this request will be lost. Press Ctrl/⌘+S to save first." : "This request isn't saved in a collection yet, so it will be lost. Press Ctrl/⌘+S to save it first.", danger: true, confirmLabel: "Close without saving", action: doClose });
  else doClose();
}

function TabsBar({ tier }: { tier: ReturnType<typeof useTier> }) {
  const tabs = useApi((s) => s.tabs);
  const activeId = useApi((s) => s.activeTabId);
  const s = useApi.getState();
  const strip = useRef<HTMLDivElement>(null);
  const close = closeTabSafely;
  useEffect(() => {
    strip.current?.querySelector<HTMLElement>(`[data-tab="${activeId}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeId]);
  const newItems: { label: string; p: Protocol }[] = [
    { label: "HTTP request", p: "http" },
    { label: "GraphQL request", p: "graphql" },
    { label: "WebSocket", p: "ws" },
    { label: "Socket.IO", p: "socketio" },
    { label: "MQTT", p: "mqtt" },
    { label: "gRPC", p: "grpc" },
  ];
  return (
    <div className="flex h-10 shrink-0 items-stretch border-b border-line bg-paper">
      <div ref={strip} role="tablist" aria-label="Open tabs" className="no-scrollbar flex min-w-0 flex-1 overflow-x-auto">
        {tabs.map((t) => {
          const { tag, kind } = tabLabel(t);
          const on = t.id === activeId;
          return (
            <div
              key={t.id}
              data-tab={t.id}
              role="tab"
              aria-selected={on}
              tabIndex={on ? 0 : -1}
              onClick={() => s.setActive(t.id)}
              onDoubleClick={() => s.pinTab(t.id)}
              onAuxClick={(e) => e.button === 1 && close(t)}
              onKeyDown={(e) => e.key === "Enter" && s.setActive(t.id)}
              className={cn("group relative flex max-w-[220px] shrink-0 cursor-pointer items-center gap-1.5 border-r border-line pl-2.5 pr-1 text-[13px]", on ? "bg-surface text-ink" : "text-ink-2 hover:bg-paper-2")}
              title={t.title}
            >
              {on && <span aria-hidden className="absolute inset-x-0 top-0 h-0.5 bg-accent" />}
              {tag ?? <span className="font-mono text-[12px] font-semibold text-ink-3">{kind}</span>}
              <span className={cn("min-w-0 truncate", t.preview && "italic")}>{t.title}</span>
              <span className="relative inline-flex size-6 shrink-0 items-center justify-center">
                {t.dirty && <span aria-label="Unsaved changes" className="absolute size-2 rounded-full bg-accent group-hover:hidden" />}
                <button type="button" aria-label={`Close ${t.title}`} onClick={(e) => { e.stopPropagation(); close(t); }} className={cn("inline-flex size-6 items-center justify-center rounded text-ink-3 hover:bg-paper-2 hover:text-ink", t.dirty ? "opacity-0 group-hover:opacity-100" : on || tier !== "desktop" ? "" : "opacity-0 group-hover:opacity-100")}>
                  <X aria-hidden className="size-3.5" />
                </button>
              </span>
            </div>
          );
        })}
      </div>
      <Menu
        label="New tab"
        align="end"
        items={newItems.map((n) => ({ label: n.label, onClick: () => s.newRequestTab(n.p) }))}
        trigger={({ toggle, ref }) => (
          <button ref={ref} type="button" aria-label="New tab" onClick={toggle} className="inline-flex w-10 shrink-0 items-center justify-center border-l border-line text-ink-2 hover:bg-paper-2 hover:text-ink">
            <Plus aria-hidden className="size-4" />
          </button>
        )}
      />
      {tabs.length > 1 && (
        <Menu
          label="Tab actions"
          align="end"
          items={[
            { label: "Close current tab", onClick: () => { const t = tabs.find((x) => x.id === activeId); if (t) close(t); } },
            { label: "Close other tabs", onClick: () => activeId && s.closeOthers(activeId) },
            { label: "Close all saved tabs", onClick: () => useApi.setState((st) => ({ tabs: st.tabs.filter((t) => t.dirty), activeTabId: st.tabs.find((t) => t.dirty)?.id ?? null })) },
            { divider: true, label: "" },
            ...tabs.map((t) => ({ label: t.title, checked: t.id === activeId, onClick: () => s.setActive(t.id) })),
          ]}
          trigger={({ toggle, ref }) => (
            <button ref={ref} type="button" aria-label="All tabs" onClick={toggle} className="inline-flex w-9 shrink-0 items-center justify-center border-l border-line text-ink-2 hover:bg-paper-2">
              <ChevronDown aria-hidden className="size-4" />
            </button>
          )}
        />
      )}
    </div>
  );
}

function ActiveView({ tab, tier }: { tab: Tab; tier: ReturnType<typeof useTier> }) {
  switch (tab.kind) {
    case "request": {
      const p = tab.draft?.protocol;
      if (p === "ws" || p === "socketio" || p === "mqtt") return <RealtimeWorkspace key={tab.id} tab={tab} tier={tier} />;
      if (p === "grpc") return <GrpcWorkspace key={tab.id} tab={tab} tier={tier} />;
      return <RequestWorkspace key={tab.id} tab={tab} tier={tier} />;
    }
    case "collection":
      return <CollectionView key={tab.id} id={tab.target!} />;
    case "folder":
      return <FolderView key={tab.id} collectionId={tab.ref!.collectionId} id={tab.target!} />;
    case "environment":
      return <EnvironmentView key={tab.id} kind="environment" id={tab.target} />;
    case "globals":
      return <EnvironmentView key={tab.id} kind="globals" />;
    case "vault":
      return <EnvironmentView key={tab.id} kind="vault" />;
    case "runner":
    case "performance":
      return <RunnerView key={tab.id} target={tab.target!} refCollection={tab.ref?.collectionId} />;
    case "docs":
      return <DocsView key={tab.id} collectionId={tab.target!} />;
    case "mock":
      return <MockView key={tab.id} id={tab.target!} />;
    case "monitor":
      return <MonitorView key={tab.id} id={tab.target!} />;
    case "flow":
      return <FlowView key={tab.id} id={tab.target!} />;
    case "spec":
      return <SpecView key={tab.id} id={tab.target!} />;
  }
}

function Welcome() {
  const s = useApi.getState();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-lg font-semibold">
        Start a <span className="font-serif text-xl italic text-accent">request</span>
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <Btn variant="primary" icon={Plus} onClick={() => s.newRequestTab("http")}>HTTP request</Btn>
        <Btn onClick={() => s.newRequestTab("graphql")}>GraphQL</Btn>
        <Btn onClick={() => s.newRequestTab("ws")}>WebSocket</Btn>
        <Btn onClick={() => s.newRequestTab("grpc")}>gRPC</Btn>
        <Btn icon={Upload} onClick={() => s.setDialog({ type: "import" })}>Import</Btn>
      </div>
      <p className="max-w-sm text-[13px] text-ink-3">Or paste a cURL command into a request&apos;s URL bar. Press <kbd className="rounded border border-line px-1 font-mono text-[12px]">?</kbd> for shortcuts.</p>
    </div>
  );
}

function StatusBar() {
  const prefs = useApi((s) => s.prefs);
  const s = useApi.getState();
  const errors = useApi((st) => st.console.filter((e) => (e.kind === "log" && e.level === "error") || (e.kind === "net" && !!e.error)).length);
  const running = useApi((st) => st.ws.monitors.filter((m) => m.enabled).length);
  const item = "inline-flex h-7 items-center gap-1.5 rounded px-1.5 text-[12px] text-ink-2 hover:bg-paper-2 hover:text-ink";
  return (
    <footer className="flex h-8 shrink-0 items-center gap-1 border-t border-line bg-paper px-1.5">
      <button type="button" className={cn(item, prefs.consoleOpen && "text-ink")} onClick={() => s.setPrefs({ consoleOpen: !prefs.consoleOpen })}>
        <Terminal aria-hidden className="size-3.5" /> Console
        {errors > 0 && <span className="rounded-sm bg-danger px-1 font-mono text-[12px] text-white">{errors}</span>}
      </button>
      <button type="button" className={item} onClick={() => s.setDialog({ type: "cookies" })}>
        <CookieIcon aria-hidden className="size-3.5" /> Cookies
      </button>
      {running > 0 && (
        <button type="button" className={item} onClick={() => s.setPrefs({ sidebar: "monitors", sidebarOpen: true })}>
          <span className="size-1.5 animate-pulse rounded-full bg-success" /> {running} monitor{running > 1 ? "s" : ""} on
        </button>
      )}
      <span className="flex-1" />
      <button type="button" className={cn(item, prefs.right === "code" && "text-ink")} onClick={() => s.setPrefs({ right: prefs.right === "code" ? null : "code" })}>
        <Code2 aria-hidden className="size-3.5" /> <span className="max-sm:hidden">Code</span>
      </button>
    </footer>
  );
}

function useShortcuts(setFullscreen: (f: boolean) => void, fullscreen: boolean) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useApi.getState();
      const mod = e.ctrlKey || e.metaKey;
      const typing = (e.target as HTMLElement)?.closest?.("input, textarea, select, [contenteditable='true'], .cm-editor");
      const tab = s.tabs.find((t) => t.id === s.activeTabId);
      if (mod && e.key === "Enter" && tab?.kind === "request" && (tab.draft?.protocol === "http" || tab.draft?.protocol === "graphql")) {
        e.preventDefault();
        void s.send(tab.id);
      } else if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (tab?.draft) {
          if (e.shiftKey) s.setDialog({ type: "save", tabId: tab.id });
          else if (s.saveTab(tab.id)) s.notify("Saved", "success");
        }
      } else if ((mod && e.key.toLowerCase() === "t" && !e.shiftKey) || (e.altKey && e.key.toLowerCase() === "n")) {
        e.preventDefault();
        s.newRequestTab();
      } else if ((mod && e.key.toLowerCase() === "w") || (e.altKey && e.key.toLowerCase() === "w")) {
        if (tab) {
          e.preventDefault();
          closeTabSafely(tab);
        }
      } else if ((mod && e.key === "Tab") || (e.altKey && (e.key === "ArrowRight" || e.key === "ArrowLeft"))) {
        e.preventDefault();
        const i = s.tabs.findIndex((t) => t.id === s.activeTabId);
        const back = e.shiftKey || e.key === "ArrowLeft";
        const next = s.tabs[(i + (back ? -1 : 1) + s.tabs.length) % s.tabs.length];
        if (next) s.setActive(next.id);
      } else if (mod && e.key.toLowerCase() === "o") {
        e.preventDefault();
        s.setDialog({ type: "import" });
      } else if (mod && e.key === "\\") {
        e.preventDefault();
        s.setPrefs({ sidebarOpen: !s.prefs.sidebarOpen });
      } else if (mod && e.altKey && e.key.toLowerCase() === "c") {
        e.preventDefault();
        s.setPrefs({ consoleOpen: !s.prefs.consoleOpen });
      } else if (mod && e.key === ",") {
        e.preventDefault();
        s.setDialog({ type: "settings" });
      } else if (e.key === "?" && !typing && !s.dialog) {
        s.setDialog({ type: "shortcuts" });
      } else if (e.key === "Escape" && fullscreen && !s.dialog) {
        setFullscreen(false);
      }
    };
    // Ctrl/⌘+K is also the site's tool search. While working in the client it opens the client's quick search
    // only: taken in the capture phase, before the site's listeners, and stopped there. Focus in the site's own
    // header (outside the client) still gets the site search.
    const onCmdK = (e: KeyboardEvent) => {
      if (!((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k")) return;
      const root = document.querySelector("[data-api-studio]");
      const t = e.target as Node | null;
      if (!root || !(t === document.body || (t && root.contains(t)) || (t instanceof Element && t.closest("[role=dialog][aria-label='Quick search']")))) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const s = useApi.getState();
      s.setDialog(s.dialog?.type === "search" ? null : { type: "search" });
    };
    window.addEventListener("keydown", onCmdK, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onCmdK, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [setFullscreen, fullscreen]);
}
