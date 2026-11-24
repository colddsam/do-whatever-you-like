"use client";

import { create } from "zustand";
import { del, get, set } from "idb-keyval";
import type { AppSettings, Collection, ConsoleEntry, Cookie, Environment, Folder, HistoryEntry, LogLevel, Mock, Protocol, RequestItem, ResponseData, RunSummary, SseEvent, Tab, TabKind, TreeNode, Variable, Workspace } from "./types";
import { clone, findNode, insertNode, isAncestor, mapNode, newCollection, newFolder, newRequest, reId, requestsIn, uid, variable } from "./lib/util";
import { execute, type EngineEnv, type NetLog } from "./lib/engine";
import { toMap, type Scopes } from "./lib/vars";
import { sampleWorkspace } from "./lib/sample";

export const DEFAULT_SETTINGS: AppSettings = {
  timeoutMs: 30_000,
  maxResponseMB: 50,
  sslVerify: true,
  followRedirects: true,
  sendNoCache: true,
  sendRequestId: false,
  trimKeys: true,
  defaultAgent: "auto",
  browserCredentials: false,
  scriptTimeoutMs: 10_000,
  historyLimit: 300,
  saveResponses: true,
  layout: "auto",
  wrapResponse: false,
  vaultInScripts: false,
};

export type SidebarSection = "collections" | "environments" | "history" | "mocks" | "monitors" | "flows" | "specs";
export type Dialog =
  | { type: "import"; text?: string }
  | { type: "settings"; tab?: string }
  | { type: "cookies" }
  | { type: "save"; tabId: string }
  | { type: "shortcuts" }
  | { type: "new" }
  | { type: "export"; collectionId: string }
  | { type: "share"; collectionId: string; itemId?: string }
  | { type: "workspaces" }
  | { type: "search" }
  | { type: "confirm"; title: string; body: string; action: () => void; danger?: boolean; confirmLabel?: string };

type Meta = { workspaces: { id: string; name: string }[]; active: string; settings: AppSettings; prefs: Prefs };
type Prefs = { sidebar: SidebarSection; sidebarOpen: boolean; consoleOpen: boolean; right: null | "code" | "info"; sidebarW: number; split: number };

type State = {
  loaded: boolean;
  workspaces: { id: string; name: string }[];
  ws: Workspace;
  settings: AppSettings;
  prefs: Prefs;
  tabs: Tab[];
  activeTabId: string | null;
  responses: Record<string, ResponseData>;
  live: Record<string, { events: SseEvent[] }>;
  sending: Record<string, AbortController>;
  console: ConsoleEntry[];
  dialog: Dialog | null;
  toast: { id: string; text: string; tone?: "danger" | "success" } | null;
};

type Actions = {
  init: () => Promise<void>;
  setPrefs: (p: Partial<Prefs>) => void;
  setSettings: (p: Partial<AppSettings>) => void;
  setDialog: (d: Dialog | null) => void;
  notify: (text: string, tone?: "danger" | "success") => void;
  mutate: (fn: (w: Workspace) => Workspace) => void;
  // workspaces
  switchWorkspace: (id: string) => Promise<void>;
  createWorkspace: (name: string) => Promise<void>;
  renameWorkspace: (id: string, name: string) => void;
  deleteWorkspace: (id: string) => Promise<void>;
  // collections & items
  addCollection: (c?: Collection) => Collection;
  updateCollection: (id: string, fn: (c: Collection) => Collection) => void;
  deleteCollection: (id: string) => void;
  duplicateCollection: (id: string) => void;
  addNode: (collectionId: string, parentId: string | null, node: TreeNode, index?: number) => void;
  updateNode: (collectionId: string, id: string, fn: (n: TreeNode) => TreeNode) => void;
  deleteNode: (collectionId: string, id: string) => void;
  duplicateNode: (collectionId: string, id: string) => void;
  moveNode: (fromCollection: string, id: string, toCollection: string, toParent: string | null, index?: number) => void;
  // environments & variables
  addEnvironment: (e?: Environment) => Environment;
  updateEnvironment: (id: string, fn: (e: Environment) => Environment) => void;
  deleteEnvironment: (id: string) => void;
  setActiveEnv: (id: string | null) => void;
  setGlobals: (v: Variable[]) => void;
  setVault: (v: Variable[]) => void;
  setCookies: (c: Cookie[]) => void;
  // tabs
  openNode: (collectionId: string, itemId: string, preview?: boolean) => void;
  openTab: (kind: TabKind, target: string | undefined, title: string, ref?: Tab["ref"]) => void;
  newRequestTab: (protocol?: Protocol, partial?: Partial<RequestItem>) => void;
  closeTab: (id: string) => void;
  closeOthers: (id: string) => void;
  setActive: (id: string) => void;
  pinTab: (id: string) => void;
  updateDraft: (tabId: string, fn: (r: RequestItem) => RequestItem) => void;
  saveTab: (tabId: string, target?: { collectionId: string; parentId: string | null; name: string }) => boolean;
  revertTab: (tabId: string) => void;
  // sending
  send: (tabId: string) => Promise<void>;
  cancel: (tabId: string) => void;
  clearResponse: (tabId: string) => void;
  engineEnv: (opts: { collectionId?: string; itemId?: string; signal?: AbortSignal; data?: Record<string, string>; iteration?: number; iterationCount?: number; envId?: string | null; onEvent?: (e: SseEvent) => void }) => { env: EngineEnv; commit: () => void };
  // console & history
  log: (level: LogLevel, text: string, source?: string) => void;
  net: (n: NetLog) => void;
  clearConsole: () => void;
  addHistory: (h: HistoryEntry) => void;
  addRun: (r: RunSummary) => void;
};

const META = "api-studio:meta";
const wsKey = (id: string) => `api-studio:ws:${id}`;
const tabsKey = (id: string) => `api-studio:tabs:${id}`;
const respKey = (id: string) => `api-studio:responses:${id}`;

const emptyWorkspace = (name = "My workspace"): Workspace => ({
  id: uid(),
  name,
  collections: [],
  environments: [],
  globals: [],
  vault: [],
  activeEnvId: null,
  history: [],
  cookies: [],
  mocks: [],
  monitors: [],
  flows: [],
  specs: [],
  runs: [],
});

const defaultPrefs: Prefs = { sidebar: "collections", sidebarOpen: true, consoleOpen: false, right: null, sidebarW: 280, split: 0.5 };

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let tabTimer: ReturnType<typeof setTimeout> | null = null;

export const useApi = create<State & Actions>()((setState, getState) => {
  const persistWs = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const { ws } = getState();
      set(wsKey(ws.id), ws).catch(() => undefined);
    }, 350);
  };
  const persistMeta = () => {
    const { workspaces, ws, settings, prefs } = getState();
    set(META, { workspaces, active: ws.id, settings, prefs } satisfies Meta).catch(() => undefined);
  };
  const persistTabs = () => {
    if (tabTimer) clearTimeout(tabTimer);
    tabTimer = setTimeout(() => {
      const { ws, tabs, activeTabId, responses, settings } = getState();
      set(tabsKey(ws.id), { tabs, activeTabId }).catch(() => undefined);
      if (settings.saveResponses) {
        // Keep responses small enough for storage: bodies over 2 MB aren't kept across reloads.
        const keep = Object.fromEntries(Object.entries(responses).filter(([, r]) => r.bodyB64.length < 2_800_000));
        set(respKey(ws.id), keep).catch(() => undefined);
      }
    }, 400);
  };
  const mutate = (fn: (w: Workspace) => Workspace) => {
    setState((s) => ({ ws: fn(s.ws) }));
    persistWs();
  };
  const touch = (c: Collection): Collection => ({ ...c, updatedAt: Date.now() });

  return {
    loaded: false,
    workspaces: [],
    ws: emptyWorkspace(),
    settings: DEFAULT_SETTINGS,
    prefs: defaultPrefs,
    tabs: [],
    activeTabId: null,
    responses: {},
    live: {},
    sending: {},
    console: [],
    dialog: null,
    toast: null,

    async init() {
      if (getState().loaded) return;
      let meta: Meta | undefined;
      try {
        meta = await get(META);
      } catch {
        meta = undefined;
      }
      let ws: Workspace | undefined;
      if (meta?.active) {
        try {
          ws = await get(wsKey(meta.active));
        } catch {
          ws = undefined;
        }
      }
      if (!ws) {
        ws = sampleWorkspace();
        meta = { workspaces: [{ id: ws.id, name: ws.name }], active: ws.id, settings: DEFAULT_SETTINGS, prefs: defaultPrefs };
        set(wsKey(ws.id), ws).catch(() => undefined);
      }
      // Older saves may lack newer fields.
      ws = { ...emptyWorkspace(), ...ws };
      let tabs: { tabs: Tab[]; activeTabId: string | null } | undefined;
      let responses: Record<string, ResponseData> | undefined;
      try {
        tabs = await get(tabsKey(ws.id));
        responses = await get(respKey(ws.id));
      } catch {
        /* nothing saved */
      }
      const workspaces = meta!.workspaces.some((w) => w.id === ws!.id) ? meta!.workspaces : [...meta!.workspaces, { id: ws.id, name: ws.name }];
      setState({
        loaded: true,
        ws,
        workspaces,
        settings: { ...DEFAULT_SETTINGS, ...meta!.settings },
        prefs: { ...defaultPrefs, ...meta!.prefs, ...(typeof window !== "undefined" && window.innerWidth < 900 ? { sidebarOpen: false } : {}) },
        tabs: tabs?.tabs ?? [],
        activeTabId: tabs?.activeTabId ?? null,
        responses: responses ?? {},
      });
      persistMeta();
      if (!getState().tabs.length) {
        const first = requestsIn(ws.collections[0]?.items ?? [])[0];
        if (first) getState().openNode(ws.collections[0].id, first.req.id);
        else getState().newRequestTab();
      }
    },

    setPrefs(p) {
      setState((s) => ({ prefs: { ...s.prefs, ...p } }));
      persistMeta();
    },
    setSettings(p) {
      setState((s) => ({ settings: { ...s.settings, ...p } }));
      persistMeta();
    },
    setDialog(d) {
      setState({ dialog: d });
    },
    notify(text, tone) {
      const id = uid();
      setState({ toast: { id, text, tone } });
      setTimeout(() => {
        if (getState().toast?.id === id) setState({ toast: null });
      }, 3200);
    },
    mutate,

    async switchWorkspace(id) {
      if (id === getState().ws.id) return;
      await set(wsKey(getState().ws.id), getState().ws).catch(() => undefined);
      let ws: Workspace | undefined = await get(wsKey(id)).catch(() => undefined);
      if (!ws) ws = { ...emptyWorkspace(getState().workspaces.find((w) => w.id === id)?.name), id };
      ws = { ...emptyWorkspace(), ...ws };
      const tabs: { tabs: Tab[]; activeTabId: string | null } | undefined = await get(tabsKey(id)).catch(() => undefined);
      const responses: Record<string, ResponseData> | undefined = await get(respKey(id)).catch(() => undefined);
      setState({ ws, tabs: tabs?.tabs ?? [], activeTabId: tabs?.activeTabId ?? null, responses: responses ?? {}, console: [] });
      persistMeta();
    },
    async createWorkspace(name) {
      const ws = emptyWorkspace(name || "New workspace");
      await set(wsKey(ws.id), ws).catch(() => undefined);
      setState((s) => ({ workspaces: [...s.workspaces, { id: ws.id, name: ws.name }] }));
      await getState().switchWorkspace(ws.id);
      getState().newRequestTab();
    },
    renameWorkspace(id, name) {
      setState((s) => ({ workspaces: s.workspaces.map((w) => (w.id === id ? { ...w, name } : w)), ws: s.ws.id === id ? { ...s.ws, name } : s.ws }));
      persistWs();
      persistMeta();
    },
    async deleteWorkspace(id) {
      const { workspaces, ws } = getState();
      if (workspaces.length <= 1) return;
      const rest = workspaces.filter((w) => w.id !== id);
      if (ws.id === id) await getState().switchWorkspace(rest[0].id);
      setState({ workspaces: rest });
      await Promise.all([del(wsKey(id)), del(tabsKey(id)), del(respKey(id))]).catch(() => undefined);
      persistMeta();
    },

    addCollection(c) {
      const col = c ?? newCollection();
      mutate((w) => ({ ...w, collections: [...w.collections, col] }));
      return col;
    },
    updateCollection(id, fn) {
      mutate((w) => ({ ...w, collections: w.collections.map((c) => (c.id === id ? touch(fn(c)) : c)) }));
      const c = getState().ws.collections.find((x) => x.id === id);
      if (c) setState((s) => ({ tabs: s.tabs.map((t) => (t.kind === "collection" && t.target === id ? { ...t, title: c.name } : t)) }));
    },
    deleteCollection(id) {
      mutate((w) => ({ ...w, collections: w.collections.filter((c) => c.id !== id), mocks: w.mocks.filter((m) => m.collectionId !== id), monitors: w.monitors.filter((m) => m.collectionId !== id) }));
      setState((s) => {
        const tabs = s.tabs.filter((t) => t.ref?.collectionId !== id && !(t.kind === "collection" && t.target === id));
        return { tabs, activeTabId: tabs.some((t) => t.id === s.activeTabId) ? s.activeTabId : (tabs.at(-1)?.id ?? null) };
      });
      persistTabs();
    },
    duplicateCollection(id) {
      const c = getState().ws.collections.find((x) => x.id === id);
      if (!c) return;
      const copy: Collection = { ...clone(c), id: uid(), name: `${c.name} Copy`, items: c.items.map((n) => reId(n)), createdAt: Date.now(), updatedAt: Date.now() };
      mutate((w) => ({ ...w, collections: [...w.collections, copy] }));
    },
    addNode(collectionId, parentId, node, index) {
      getState().updateCollection(collectionId, (c) => ({ ...c, items: insertNode(c.items, parentId, node, index) }));
    },
    updateNode(collectionId, id, fn) {
      getState().updateCollection(collectionId, (c) => ({ ...c, items: mapNode(c.items, id, fn) }));
      const hit = findNode(getState().ws.collections.find((c) => c.id === collectionId)?.items ?? [], id);
      if (hit) setState((s) => ({ tabs: s.tabs.map((t) => (t.ref?.itemId === id ? { ...t, title: hit.node.name, draft: t.draft && !t.dirty && hit.node.kind === "request" ? clone(hit.node) : t.draft ? { ...t.draft, name: hit.node.name } : t.draft } : t)) }));
    },
    deleteNode(collectionId, id) {
      const c = getState().ws.collections.find((x) => x.id === collectionId);
      const hit = c ? findNode(c.items, id) : null;
      const gone = new Set<string>([id]);
      if (hit?.node.kind === "folder") requestsIn(hit.node.items).forEach(({ req }) => gone.add(req.id));
      getState().updateCollection(collectionId, (col) => ({ ...col, items: mapNode(col.items, id, () => null) }));
      setState((s) => {
        const tabs = s.tabs.filter((t) => !(t.ref?.itemId && gone.has(t.ref.itemId)));
        return { tabs, activeTabId: tabs.some((t) => t.id === s.activeTabId) ? s.activeTabId : (tabs.at(-1)?.id ?? null) };
      });
      persistTabs();
    },
    duplicateNode(collectionId, id) {
      const c = getState().ws.collections.find((x) => x.id === collectionId);
      const hit = c ? findNode(c.items, id) : null;
      if (!hit) return;
      const copy = reId(hit.node);
      copy.name = `${hit.node.name} Copy`;
      const parent = hit.parents.at(-1);
      const siblings = parent ? parent.items : c!.items;
      getState().addNode(collectionId, parent?.id ?? null, copy, siblings.findIndex((n) => n.id === id) + 1);
    },
    moveNode(fromCollection, id, toCollection, toParent, index) {
      const from = getState().ws.collections.find((x) => x.id === fromCollection);
      const hit = from ? findNode(from.items, id) : null;
      if (!hit) return;
      if (toParent === id || (fromCollection === toCollection && toParent && isAncestor(from!.items, id, toParent))) return;
      mutate((w) => {
        let cols = w.collections.map((c) => (c.id === fromCollection ? touch({ ...c, items: mapNode(c.items, id, () => null) }) : c));
        cols = cols.map((c) => (c.id === toCollection ? touch({ ...c, items: insertNode(c.items, toParent, hit.node, index) }) : c));
        return { ...w, collections: cols };
      });
      setState((s) => ({ tabs: s.tabs.map((t) => (t.ref?.itemId === id ? { ...t, ref: { collectionId: toCollection, itemId: id } } : t)) }));
    },

    addEnvironment(e) {
      const env = e ?? { id: uid(), name: "New environment", values: [] };
      mutate((w) => ({ ...w, environments: [...w.environments, env] }));
      return env;
    },
    updateEnvironment(id, fn) {
      mutate((w) => ({ ...w, environments: w.environments.map((e) => (e.id === id ? fn(e) : e)) }));
      const e = getState().ws.environments.find((x) => x.id === id);
      if (e) setState((s) => ({ tabs: s.tabs.map((t) => (t.kind === "environment" && t.target === id ? { ...t, title: e.name } : t)) }));
    },
    deleteEnvironment(id) {
      mutate((w) => ({ ...w, environments: w.environments.filter((e) => e.id !== id), activeEnvId: w.activeEnvId === id ? null : w.activeEnvId }));
      setState((s) => {
        const tabs = s.tabs.filter((t) => !(t.kind === "environment" && t.target === id));
        return { tabs, activeTabId: tabs.some((t) => t.id === s.activeTabId) ? s.activeTabId : (tabs.at(-1)?.id ?? null) };
      });
    },
    setActiveEnv(id) {
      mutate((w) => ({ ...w, activeEnvId: id }));
    },
    setGlobals(v) {
      mutate((w) => ({ ...w, globals: v }));
    },
    setVault(v) {
      mutate((w) => ({ ...w, vault: v }));
    },
    setCookies(c) {
      mutate((w) => ({ ...w, cookies: c }));
    },

    openNode(collectionId, itemId, preview = false) {
      const s = getState();
      const existing = s.tabs.find((t) => t.ref?.collectionId === collectionId && t.ref.itemId === itemId);
      if (existing) {
        setState({ activeTabId: existing.id, tabs: preview ? s.tabs : s.tabs.map((t) => (t.id === existing.id ? { ...t, preview: false } : t)) });
        persistTabs();
        return;
      }
      const c = s.ws.collections.find((x) => x.id === collectionId);
      const hit = c ? findNode(c.items, itemId) : null;
      if (!hit) return;
      const tab: Tab =
        hit.node.kind === "request"
          ? { id: uid(), kind: "request", ref: { collectionId, itemId }, draft: clone(hit.node), title: hit.node.name, preview }
          : { id: uid(), kind: "folder", ref: { collectionId, itemId }, target: itemId, title: hit.node.name, preview };
      // A preview tab replaces the previous preview tab (Postman's single-click behaviour).
      const tabs = preview ? s.tabs.filter((t) => !(t.preview && !t.dirty)) : s.tabs;
      setState({ tabs: [...tabs, tab], activeTabId: tab.id });
      persistTabs();
    },
    openTab(kind, target, title, ref) {
      const s = getState();
      const existing = s.tabs.find((t) => t.kind === kind && t.target === target);
      if (existing) {
        setState({ activeTabId: existing.id });
        return;
      }
      const tab: Tab = { id: uid(), kind, target, title, ref };
      setState({ tabs: [...s.tabs, tab], activeTabId: tab.id });
      persistTabs();
    },
    newRequestTab(protocol = "http", partial) {
      const draft = newRequest({ protocol, ...partial });
      const tab: Tab = { id: uid(), kind: "request", draft, title: draft.name, dirty: !!partial };
      setState((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }));
      persistTabs();
    },
    closeTab(id) {
      setState((s) => {
        const i = s.tabs.findIndex((t) => t.id === id);
        const tabs = s.tabs.filter((t) => t.id !== id);
        const responses = { ...s.responses };
        delete responses[id];
        s.sending[id]?.abort();
        return { tabs, responses, activeTabId: s.activeTabId === id ? (tabs[Math.min(i, tabs.length - 1)]?.id ?? null) : s.activeTabId };
      });
      persistTabs();
    },
    closeOthers(id) {
      setState((s) => ({ tabs: s.tabs.filter((t) => t.id === id || t.dirty), activeTabId: id }));
      persistTabs();
    },
    setActive(id) {
      setState({ activeTabId: id });
      persistTabs();
    },
    pinTab(id) {
      setState((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, preview: false } : t)) }));
      persistTabs();
    },
    updateDraft(tabId, fn) {
      setState((s) => ({
        tabs: s.tabs.map((t) => {
          if (t.id !== tabId || !t.draft) return t;
          const draft = fn(t.draft);
          return { ...t, draft, dirty: true, preview: false, title: draft.name };
        }),
      }));
      persistTabs();
    },
    saveTab(tabId, target) {
      const s = getState();
      const tab = s.tabs.find((t) => t.id === tabId);
      if (!tab?.draft) return false;
      if (tab.ref?.itemId && !target) {
        const c = s.ws.collections.find((x) => x.id === tab.ref!.collectionId);
        if (c && findNode(c.items, tab.ref.itemId)) {
          const draft = tab.draft;
          getState().updateCollection(c.id, (col) => ({ ...col, items: mapNode(col.items, tab.ref!.itemId!, () => ({ ...draft, id: tab.ref!.itemId! })) }));
          setState((st) => ({ tabs: st.tabs.map((t) => (t.id === tabId ? { ...t, dirty: false, title: draft.name } : t)) }));
          persistTabs();
          return true;
        }
      }
      if (!target) {
        getState().setDialog({ type: "save", tabId });
        return false;
      }
      const node: RequestItem = { ...clone(tab.draft), id: uid(), name: target.name || tab.draft.name };
      getState().addNode(target.collectionId, target.parentId, node);
      setState((st) => ({ tabs: st.tabs.map((t) => (t.id === tabId ? { ...t, ref: { collectionId: target.collectionId, itemId: node.id }, draft: clone(node), dirty: false, title: node.name } : t)) }));
      persistTabs();
      return true;
    },
    revertTab(tabId) {
      const s = getState();
      const tab = s.tabs.find((t) => t.id === tabId);
      if (!tab?.ref?.itemId) return;
      const c = s.ws.collections.find((x) => x.id === tab.ref!.collectionId);
      const hit = c ? findNode(c.items, tab.ref.itemId) : null;
      if (hit?.node.kind === "request") setState((st) => ({ tabs: st.tabs.map((t) => (t.id === tabId ? { ...t, draft: clone(hit.node as RequestItem), dirty: false, title: hit.node.name } : t)) }));
    },

    engineEnv({ collectionId, itemId, signal, data, iteration = 0, iterationCount = 1, envId, onEvent }) {
      const s = getState();
      const ws = s.ws;
      const collection = collectionId ? (ws.collections.find((c) => c.id === collectionId) ?? null) : null;
      const parents: Folder[] = collection && itemId ? (findNode(collection.items, itemId)?.parents ?? []) : [];
      const env = ws.environments.find((e) => e.id === (envId === undefined ? ws.activeEnvId : envId));
      const scopes: Scopes = {
        local: {},
        data: data ?? {},
        environment: toMap(env?.values),
        collection: toMap(collection?.variables),
        globals: toMap(ws.globals),
        vault: toMap(ws.vault),
      };
      const before = { environment: { ...scopes.environment }, collection: { ...scopes.collection }, globals: { ...scopes.globals }, vault: { ...scopes.vault } };
      const engine: EngineEnv = {
        settings: s.settings,
        collection,
        parents,
        scopes,
        envName: env?.name ?? "",
        cookies: ws.cookies,
        setCookies: (c) => getState().setCookies(c),
        mocks: ws.mocks,
        collections: ws.collections,
        iteration,
        iterationCount,
        signal,
        log: (l, t, src) => getState().log(l, t, src),
        net: (n) => getState().net(n),
        onEvent,
        onMock: (mockId, entry) => mutate((w) => ({ ...w, mocks: w.mocks.map((m) => (m.id === mockId ? { ...m, log: [entry, ...m.log].slice(0, 100) } : m)) })),
      };
      // Write what scripts changed back into each scope's current values.
      const commit = () => {
        const apply = (vars: Variable[], prev: Record<string, string>, next: Record<string, string>): Variable[] => {
          let out = vars.filter((v) => !(v.enabled && v.key in prev && !(v.key in next)));
          out = out.map((v) => (v.enabled && v.key in next && next[v.key] !== (v.current ?? v.value) ? { ...v, current: next[v.key] } : v));
          for (const [k, v] of Object.entries(next)) if (!(k in prev) && !out.some((x) => x.key === k && x.enabled)) out.push(variable(k, v, { current: v }));
          return out;
        };
        const same = (a: Record<string, string>, b: Record<string, string>) => JSON.stringify(a) === JSON.stringify(b);
        const sc = engine.scopes;
        if (same(before.environment, sc.environment) && same(before.collection, sc.collection) && same(before.globals, sc.globals) && same(before.vault, sc.vault)) return;
        mutate((w) => ({
          ...w,
          environments: env && !same(before.environment, sc.environment) ? w.environments.map((e) => (e.id === env.id ? { ...e, values: apply(e.values, before.environment, sc.environment) } : e)) : w.environments,
          collections: collection && !same(before.collection, sc.collection) ? w.collections.map((c) => (c.id === collection.id ? { ...c, variables: apply(c.variables, before.collection, sc.collection) } : c)) : w.collections,
          globals: same(before.globals, sc.globals) ? w.globals : apply(w.globals, before.globals, sc.globals),
          vault: same(before.vault, sc.vault) ? w.vault : apply(w.vault, before.vault, sc.vault),
        }));
        Object.assign(before, { environment: { ...sc.environment }, collection: { ...sc.collection }, globals: { ...sc.globals }, vault: { ...sc.vault } });
      };
      return { env: engine, commit };
    },

    async send(tabId) {
      const s = getState();
      const tab = s.tabs.find((t) => t.id === tabId);
      if (!tab?.draft || s.sending[tabId]) return;
      const ctrl = new AbortController();
      setState((st) => ({ sending: { ...st.sending, [tabId]: ctrl }, live: { ...st.live, [tabId]: { events: [] } } }));
      const { env, commit } = getState().engineEnv({
        collectionId: tab.ref?.collectionId,
        itemId: tab.ref?.itemId,
        signal: ctrl.signal,
        onEvent: (e) => setState((st) => ({ live: { ...st.live, [tabId]: { events: [...(st.live[tabId]?.events ?? []), e].slice(-2000) } } })),
      });
      try {
        const { response } = await execute(tab.draft, env);
        commit();
        setState((st) => {
          const sending = { ...st.sending };
          delete sending[tabId];
          return { responses: { ...st.responses, [tabId]: response }, sending };
        });
        getState().addHistory({ id: uid(), at: Date.now(), request: clone(tab.draft), status: response.status || undefined, ms: response.timings.total, size: response.size.body, error: response.error, collectionId: tab.ref?.collectionId });
      } catch (e) {
        setState((st) => {
          const sending = { ...st.sending };
          delete sending[tabId];
          return { sending };
        });
        getState().log("error", `Unexpected error: ${(e as Error).message}`);
      }
      persistTabs();
    },
    cancel(tabId) {
      getState().sending[tabId]?.abort();
    },
    clearResponse(tabId) {
      setState((s) => {
        const responses = { ...s.responses };
        delete responses[tabId];
        return { responses };
      });
      persistTabs();
    },

    log(level, text, source) {
      setState((s) => ({ console: [...s.console, { id: uid(), at: Date.now(), kind: "log" as const, level, text, source }].slice(-1500) }));
    },
    net(n) {
      setState((s) => ({ console: [...s.console, { id: uid(), at: Date.now(), kind: "net" as const, ...n }].slice(-1500) }));
    },
    clearConsole() {
      setState({ console: [] });
    },
    addHistory(h) {
      mutate((w) => ({ ...w, history: [h, ...w.history].slice(0, getState().settings.historyLimit) }));
    },
    addRun(r) {
      mutate((w) => ({ ...w, runs: [r, ...w.runs.filter((x) => x.id !== r.id)].slice(0, 50) }));
    },
  };
});

/** The collection, node and parents for a saved item. */
export function locate(ws: Workspace, collectionId: string | undefined, itemId: string | undefined) {
  const collection = ws.collections.find((c) => c.id === collectionId);
  if (!collection || !itemId) return { collection, node: undefined, parents: [] as Folder[] };
  const hit = findNode(collection.items, itemId);
  return { collection, node: hit?.node, parents: hit?.parents ?? [] };
}

export const activeEnv = (ws: Workspace) => ws.environments.find((e) => e.id === ws.activeEnvId);

export function scopesFor(ws: Workspace, collectionId?: string): Scopes {
  const collection = ws.collections.find((c) => c.id === collectionId);
  return { local: {}, data: {}, environment: toMap(activeEnv(ws)?.values), collection: toMap(collection?.variables), globals: toMap(ws.globals), vault: toMap(ws.vault) };
}

export { newFolder, type Mock };
