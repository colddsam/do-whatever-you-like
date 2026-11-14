"use client";

import "@xyflow/react/dist/style.css";
import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  ConnectionLineType,
  ConnectionMode,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  MiniMap,
  NodeResizer,
  Position,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  addEdge,
  getBezierPath,
  getNodesBounds,
  getSmoothStepPath,
  getStraightPath,
  getViewportForBounds,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowDown,
  ArrowRight,
  Bold,
  Copy,
  CopyPlus,
  Download,
  FileCode,
  FolderOpen,
  Hand,
  Italic,
  LayoutTemplate,
  Maximize,
  Minimize,
  MousePointer2,
  Play,
  Redo2,
  Save,
  Square,
  Trash2,
  Type,
  Undo2,
  WandSparkles,
} from "lucide-react";
import { saveBlob } from "@/lib/files";
import { getTool, stepsFor } from "@/lib/tools";
import {
  DEFAULT_EDGE,
  FILLS,
  SHAPES,
  STROKES,
  TEMPLATES,
  assignHandles,
  fromText,
  layout,
  nodeData,
  playOrder,
  shapeInfo,
  toFlowText,
  type Direction,
  type EdgeAnim,
  type FlowEdge,
  type FlowEdgeData,
  type FlowNode,
  type FlowNodeData,
  type PathKind,
  type ShapeKind,
} from "@/lib/flowchart";
import { cn } from "@/lib/utils";
import { Workbench } from "../workbench";
import { Chips, Notice, Slider, Toggle } from "../pdf/kit";

type RFNode = Node<FlowNodeData, "shape">;
type RFEdge = Edge<FlowEdgeData, "flow">;
type Settings = { bg: "dots" | "lines" | "none"; snap: boolean; minimap: boolean; path: PathKind; anim: EdgeAnim; dir: Direction };

const STORE = "dw-flowchart-v1";
const DEFAULT_SETTINGS: Settings = { bg: "dots", snap: true, minimap: false, path: "smoothstep", anim: "none", dir: "TB" };

/* ---------- Model <-> React Flow ---------- */

const toRFNode = (n: FlowNode): RFNode => ({ id: n.id, type: "shape", position: n.position, width: n.width, height: n.height, data: n.data });
const fromRFNode = (n: RFNode): FlowNode => ({ id: n.id, position: { x: Math.round(n.position.x), y: Math.round(n.position.y) }, width: Math.round(n.width ?? n.measured?.width ?? 160), height: Math.round(n.height ?? n.measured?.height ?? 60), data: n.data });
function withMarkers(e: RFEdge): RFEdge {
  const d = e.data ?? DEFAULT_EDGE;
  const marker = { type: MarkerType.ArrowClosed, color: d.color, width: 16, height: 16 };
  return { ...e, type: "flow", markerEnd: d.arrows !== "none" ? marker : undefined, markerStart: d.arrows === "both" ? marker : undefined };
}
const toRFEdge = (e: FlowEdge): RFEdge => withMarkers({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? undefined, targetHandle: e.targetHandle ?? undefined, type: "flow", data: e.data });
const fromRFEdge = (e: RFEdge): FlowEdge => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? null, targetHandle: e.targetHandle ?? null, data: e.data ?? DEFAULT_EDGE });
const uid = (p: string) => `${p}${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;

type Saved = { nodes: FlowNode[]; edges: FlowEdge[]; settings: Settings };
function load(): Saved {
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) {
      const d = JSON.parse(raw) as Saved;
      if (Array.isArray(d.nodes) && Array.isArray(d.edges)) return { nodes: d.nodes, edges: d.edges, settings: { ...DEFAULT_SETTINGS, ...d.settings } };
    }
  } catch {
    /* blocked or old: start from a template */
  }
  const t = fromText(TEMPLATES[0].text);
  return { nodes: t.nodes, edges: t.edges, settings: { ...DEFAULT_SETTINGS, dir: t.direction } };
}

/* ---------- Play mode and entrance animation, shared with every node and edge ---------- */

type Play = { active: string | null; visited: Set<string>; flowing: Set<string>; on: boolean; reveal: number; index: Map<string, number> };
const PlayCtx = createContext<Play>({ active: null, visited: new Set(), flowing: new Set(), on: false, reveal: 0, index: new Map() });

/* ---------- Shapes ---------- */

const PATHS: Partial<Record<ShapeKind, string>> = {
  decision: "M50 1 L99 50 L50 99 L1 50 Z",
  io: "M16 1 L99 1 L84 99 L1 99 Z",
  hexagon: "M14 1 L86 1 L99 50 L86 99 L14 99 L1 50 Z",
  document: "M1 1 H99 V84 C80 72 64 72 50 84 C36 96 20 96 1 86 Z",
  database: "M1 12 C1 -2 99 -2 99 12 V88 C99 102 1 102 1 88 Z",
  predefined: "M1 1 H99 V99 H1 Z",
  manual: "M1 24 L99 1 L99 99 L1 99 Z",
  triangle: "M50 1 L99 99 L1 99 Z",
};
const EXTRA: Partial<Record<ShapeKind, string>> = { database: "M1 12 C1 26 99 26 99 12", predefined: "M10 1 V99 M90 1 V99" };
const LABEL_PAD: Partial<Record<ShapeKind, string>> = { decision: "px-[18%] py-[14%]", io: "px-[16%]", hexagon: "px-[14%]", document: "pb-[12%]", database: "pt-[16%]", predefined: "px-[12%]", manual: "pt-[14%]", triangle: "px-[24%] pt-[38%]" };

export function ShapeView({ d, className }: { d: FlowNodeData; className?: string }) {
  const svgShape = PATHS[d.shape];
  const dash = d.dashed ? "6 4" : undefined;
  return (
    <div className={cn("pointer-events-none absolute inset-0", className)}>
      {svgShape ? (
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
          <path d={svgShape} fill={d.fill} stroke={d.stroke} strokeWidth={d.strokeWidth} strokeDasharray={dash} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          {EXTRA[d.shape] && <path d={EXTRA[d.shape]} fill="none" stroke={d.stroke} strokeWidth={d.strokeWidth} strokeDasharray={dash} vectorEffect="non-scaling-stroke" />}
        </svg>
      ) : d.shape === "note" ? (
        <div className="absolute inset-0 shadow-[0_6px_14px_-6px_rgba(0,0,0,.35)]" style={{ background: d.fill, border: `${d.strokeWidth}px ${d.dashed ? "dashed" : "solid"} ${d.stroke}`, clipPath: "polygon(0 0, 100% 0, 100% calc(100% - 18px), calc(100% - 18px) 100%, 0 100%)" }} />
      ) : (
        <div
          className="absolute inset-0"
          style={{
            background: d.fill,
            border: d.shape === "text" ? "none" : `${d.strokeWidth}px ${d.dashed ? "dashed" : "solid"} ${d.stroke}`,
            borderRadius: d.shape === "process" ? 6 : d.shape === "rounded" ? 18 : 9999,
          }}
        />
      )}
    </div>
  );
}

const HANDLES: [Position, string][] = [
  [Position.Top, "t"],
  [Position.Right, "r"],
  [Position.Bottom, "b"],
  [Position.Left, "l"],
];

const ShapeNode = memo(function ShapeNode({ id, data, selected }: NodeProps<RFNode>) {
  const play = useContext(PlayCtx);
  const { updateNodeData } = useReactFlow();
  const [editing, setEditing] = useState(false);
  const dim = play.on && play.active !== id && !play.visited.has(id);
  const active = play.on && play.active === id;
  const delay = (play.index.get(id) ?? 0) * 70;
  return (
    <div className={cn("group relative size-full transition-opacity duration-300", dim && "opacity-25")} onDoubleClick={() => setEditing(true)}>
      <div key={play.reveal} className="absolute inset-0" style={{ animation: `dwpop .5s cubic-bezier(.2,.8,.2,1.2) ${delay}ms both` }}>
        <motion.div className="absolute inset-0" animate={active ? { scale: [1, 1.08, 1] } : { scale: 1 }} transition={active ? { duration: 0.6, ease: "easeOut" } : { duration: 0.2 }}>
          <ShapeView d={data} className={cn(active && "drop-shadow-[0_0_12px_rgba(235,74,16,.55)]")} />
          {(selected || active) && <span aria-hidden className={cn("pointer-events-none absolute -inset-1.5 rounded-[10px] border-2", active ? "border-accent" : "border-accent/50 border-dashed")} />}
          <div className={cn("absolute inset-0 flex items-center justify-center overflow-hidden px-3 text-center leading-tight", LABEL_PAD[data.shape])}>
            {editing ? (
              <textarea
                autoFocus
                defaultValue={data.label}
                onFocus={(e) => e.currentTarget.select()}
                onBlur={(e) => {
                  updateNodeData(id, { label: e.currentTarget.value });
                  setEditing(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape" || (e.key === "Enter" && !e.shiftKey)) {
                    e.preventDefault();
                    e.currentTarget.blur();
                  }
                }}
                className="nodrag nowheel size-full resize-none bg-transparent text-center outline-none"
                style={{ color: data.color, fontSize: data.fontSize, fontWeight: data.bold ? 600 : 400, fontStyle: data.italic ? "italic" : undefined }}
              />
            ) : (
              <span className="whitespace-pre-wrap [overflow-wrap:anywhere]" style={{ color: data.color, fontSize: data.fontSize, fontWeight: data.bold ? 600 : 400, fontStyle: data.italic ? "italic" : undefined }}>
                {data.label}
              </span>
            )}
          </div>
        </motion.div>
      </div>
      <NodeResizer isVisible={selected && !editing} minWidth={40} minHeight={28} keepAspectRatio={data.shape === "circle"} lineClassName="!z-10 !border-accent" handleClassName="!z-20 !size-2.5 !rounded-[2px] !border-accent !bg-surface" />
      {HANDLES.map(([pos, hid]) => (
        <Handle key={hid} id={hid} type="source" position={pos} className={cn("!size-3 !border-2 !border-surface !bg-accent transition-opacity", selected ? "opacity-100" : "opacity-0 group-hover:opacity-100")} />
      ))}
    </div>
  );
});

const FlowEdgeView = memo(function FlowEdgeView(p: EdgeProps<RFEdge>) {
  const d = p.data ?? DEFAULT_EDGE;
  const play = useContext(PlayCtx);
  const geo = { sourceX: p.sourceX, sourceY: p.sourceY, targetX: p.targetX, targetY: p.targetY, sourcePosition: p.sourcePosition, targetPosition: p.targetPosition };
  const [path, lx, ly] = d.path === "straight" ? getStraightPath(geo) : d.path === "bezier" ? getBezierPath(geo) : getSmoothStepPath({ ...geo, borderRadius: d.path === "step" ? 0 : 12 });
  const flowing = play.on && play.flowing.has(p.id);
  const dim = play.on && !flowing && !(play.visited.has(p.source) && play.visited.has(p.target));
  const anim: EdgeAnim = flowing ? "dots" : d.anim;
  const color = flowing ? "#eb4a10" : d.color;
  return (
    <>
      {p.selected && <path d={path} fill="none" stroke="#eb4a10" strokeOpacity={0.22} strokeWidth={d.width + 9} strokeLinecap="round" />}
      <BaseEdge
        id={p.id}
        path={path}
        markerEnd={p.markerEnd}
        markerStart={p.markerStart}
        interactionWidth={20}
        style={{ stroke: color, strokeWidth: d.width, strokeDasharray: d.dashed || anim === "dash" ? "8 6" : undefined, animation: anim === "dash" ? "dwdash .9s linear infinite" : undefined, opacity: dim ? 0.2 : 1, transition: "opacity .3s, stroke .3s" }}
      />
      {anim === "dots" &&
        [0, 1, 2].map((i) => (
          <circle key={i} r={Math.max(3, d.width + 1.5)} fill={color} opacity={dim ? 0.2 : 1}>
            <animateMotion dur={flowing ? "1.2s" : "2.4s"} begin={`${(i * (flowing ? 1.2 : 2.4)) / 3}s`} repeatCount="indefinite" path={path} />
          </circle>
        ))}
      {d.label && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-auto absolute rounded-[6px] border bg-surface px-1.5 py-0.5 text-[12px] font-medium leading-tight transition-opacity"
            style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)`, borderColor: color, color: "#15140f", opacity: dim ? 0.25 : 1 }}
          >
            {d.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});

const nodeTypes = { shape: ShapeNode };
const edgeTypes = { flow: FlowEdgeView };

/* ---------- The tool ---------- */

const noop = () => () => {};

export function FlowchartMaker({ toolId }: { toolId: string }) {
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  const tool = getTool(toolId)!;
  return (
    <Workbench steps={stepsFor(tool)} current={1} footer="Made in your browser and kept in this browser as you work. Nothing is uploaded.">
      {mounted ? (
        <ReactFlowProvider>
          <Editor />
        </ReactFlowProvider>
      ) : (
        <div className="m-4 h-[620px] animate-pulse rounded-md bg-paper-2" />
      )}
    </Workbench>
  );
}

const strip = (nodes: RFNode[], edges: RFEdge[]) => JSON.stringify({ n: nodes.map(fromRFNode), e: edges.map(fromRFEdge) });

function Editor() {
  const [initial] = useState(load);
  const [nodes, setNodes, onNodesChange] = useNodesState<RFNode>(initial.nodes.map(toRFNode));
  const [edges, setEdges, onEdgesChange] = useEdgesState<RFEdge>(initial.edges.map(toRFEdge));
  const [settings, setSettings] = useState<Settings>(initial.settings);
  const rf = useReactFlow<RFNode, RFEdge>();
  const wrap = useRef<HTMLDivElement>(null);
  const [full, setFull] = useState(false);
  const [toolMode, setToolMode] = useState<"select" | "pan">("select");
  const [panel, setPanel] = useState<"none" | "templates" | "text" | "export">("none");
  const [text, setText] = useState("");
  const [textErr, setTextErr] = useState<string[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [reveal, setReveal] = useState(0);
  const [playState, setPlayState] = useState<{ on: boolean; step: number }>({ on: false, step: 0 });
  const [speed, setSpeed] = useState(1200);
  const clip = useRef<{ nodes: RFNode[]; edges: RFEdge[] } | null>(null);
  const set = (p: Partial<Settings>) => setSettings((s) => ({ ...s, ...p }));
  const flash = (m: string) => {
    setNote(m);
    setTimeout(() => setNote(null), 2600);
  };

  /* Save in this browser */
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(STORE, JSON.stringify({ nodes: nodes.map(fromRFNode), edges: edges.map(fromRFEdge), settings }));
      } catch {
        /* full or blocked */
      }
    }, 500);
    return () => clearTimeout(t);
  }, [nodes, edges, settings]);

  /* Undo / redo: snapshots of the chart (not of selection or dragging) */
  const hist = useRef<{ past: string[]; future: string[]; now: string; restoring: boolean }>({ past: [], future: [], now: strip(initial.nodes.map(toRFNode), initial.edges.map(toRFEdge)), restoring: false });
  const [histLen, setHistLen] = useState({ past: 0, future: 0 });
  const bump = () => setHistLen({ past: hist.current.past.length, future: hist.current.future.length });
  useEffect(() => {
    const t = setTimeout(() => {
      const h = hist.current;
      if (nodes.some((n) => n.dragging || n.resizing)) return;
      const snap = strip(nodes, edges);
      if (h.restoring) {
        h.restoring = false;
        h.now = snap;
        return;
      }
      if (snap === h.now) return;
      h.past.push(h.now);
      if (h.past.length > 100) h.past.shift();
      h.now = snap;
      h.future = [];
      bump();
    }, 350);
    return () => clearTimeout(t);
  }, [nodes, edges]);
  const restore = (snap: string) => {
    const d = JSON.parse(snap) as { n: FlowNode[]; e: FlowEdge[] };
    hist.current.restoring = true;
    setNodes(d.n.map(toRFNode));
    setEdges(d.e.map(toRFEdge));
    bump();
  };
  const undo = () => {
    const h = hist.current;
    const prev = h.past.pop();
    if (!prev) return;
    h.future.push(h.now);
    h.now = prev;
    restore(prev);
  };
  const redo = () => {
    const h = hist.current;
    const next = h.future.pop();
    if (!next) return;
    h.past.push(h.now);
    h.now = next;
    restore(next);
  };

  /* Editing */
  const selNodes = nodes.filter((n) => n.selected);
  const selEdges = edges.filter((e) => e.selected);
  const updateNodes = (patch: Partial<FlowNodeData>, ids = selNodes.map((n) => n.id)) => setNodes((ns) => ns.map((n) => (ids.includes(n.id) ? { ...n, data: { ...n.data, ...patch } } : n)));
  const updateEdges = (patch: Partial<FlowEdgeData>, ids = selEdges.map((e) => e.id)) => setEdges((es) => es.map((e) => (ids.includes(e.id) ? withMarkers({ ...e, data: { ...(e.data ?? DEFAULT_EDGE), ...patch } }) : e)));
  const setShape = (shape: ShapeKind) =>
    setNodes((ns) =>
      ns.map((n) => {
        if (!n.selected) return n;
        const look = nodeData(shape, n.data.label);
        const [w, h] = shapeInfo(shape).size;
        const sameLook = n.data.fill === nodeData(n.data.shape, "").fill;
        return { ...n, width: shape === "circle" ? Math.max(w, Math.min(n.width ?? w, n.height ?? h)) : n.width, height: shape === "circle" ? Math.max(w, Math.min(n.width ?? w, n.height ?? h)) : n.height, data: { ...n.data, shape, ...(sameLook ? { fill: look.fill, stroke: look.stroke, color: look.color } : {}) } };
      }),
    );

  const addShape = (shape: ShapeKind, at?: { x: number; y: number }) => {
    const [w, h] = shapeInfo(shape).size;
    const r = wrap.current?.getBoundingClientRect();
    const p = at ?? rf.screenToFlowPosition({ x: (r?.left ?? 0) + (r?.width ?? 600) / 2, y: (r?.top ?? 0) + (r?.height ?? 400) / 2 });
    const id = uid("n");
    const label = shape === "decision" ? "Question?" : shape === "terminal" ? "Start" : shape === "note" ? "A note" : shapeInfo(shape).name;
    setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), { id, type: "shape", position: { x: Math.round(p.x - w / 2), y: Math.round(p.y - h / 2) }, width: w, height: h, data: nodeData(shape, label), selected: true }]);
  };
  const onConnect = useCallback(
    (c: Connection) => setEdges((es) => addEdge(withMarkers({ ...c, id: uid("e"), type: "flow", data: { ...DEFAULT_EDGE, path: settings.path, anim: settings.anim } } as RFEdge), es)),
    [setEdges, settings.path, settings.anim],
  );
  // Let go anywhere on a shape (not just on its dot) and the link still lands, on its nearest side.
  const onConnectEnd = (event: MouseEvent | TouchEvent, state: { isValid: boolean | null; fromNode?: { id: string } | null; fromHandle?: { id?: string | null } | null }) => {
    if (state.isValid || !state.fromNode) return;
    const pt = "changedTouches" in event ? event.changedTouches[0] : event;
    const el = document.elementsFromPoint(pt.clientX, pt.clientY).map((x) => x.closest(".react-flow__node")).find(Boolean) as HTMLElement | undefined;
    const target = el?.dataset.id;
    if (!target || target === state.fromNode.id) return;
    const r = el!.getBoundingClientRect();
    const dx = (pt.clientX - (r.left + r.width / 2)) / r.width;
    const dy = (pt.clientY - (r.top + r.height / 2)) / r.height;
    const side = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "r" : "l") : dy > 0 ? "b" : "t";
    onConnect({ source: state.fromNode.id, sourceHandle: state.fromHandle?.id ?? null, target, targetHandle: side });
  };
  const remove = () => {
    const gone = new Set(selNodes.map((n) => n.id));
    setNodes((ns) => ns.filter((n) => !n.selected));
    setEdges((es) => es.filter((e) => !e.selected && !gone.has(e.source) && !gone.has(e.target)));
  };
  const copy = () => {
    if (!selNodes.length) return;
    const ids = new Set(selNodes.map((n) => n.id));
    clip.current = { nodes: selNodes, edges: edges.filter((e) => ids.has(e.source) && ids.has(e.target)) };
  };
  const paste = (offset = 40) => {
    const c = clip.current;
    if (!c) return;
    const map = new Map(c.nodes.map((n) => [n.id, uid("n")]));
    setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), ...c.nodes.map((n) => ({ ...n, id: map.get(n.id)!, position: { x: n.position.x + offset, y: n.position.y + offset }, selected: true }))]);
    setEdges((es) => [...es.map((e) => ({ ...e, selected: false })), ...c.edges.map((e) => ({ ...e, id: uid("e"), source: map.get(e.source)!, target: map.get(e.target)!, selected: false }))]);
    clip.current = { nodes: c.nodes.map((n) => ({ ...n, position: { x: n.position.x + offset, y: n.position.y + offset } })), edges: c.edges };
  };

  /* Keyboard */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (/INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable) return;
      if (!wrap.current?.contains(document.activeElement) && document.activeElement !== document.body) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      } else if (mod && e.key.toLowerCase() === "c") copy();
      else if (mod && e.key.toLowerCase() === "v") paste();
      else if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        copy();
        paste(30);
      } else if (mod && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setNodes((ns) => ns.map((n) => ({ ...n, selected: true })));
        setEdges((es) => es.map((edge) => ({ ...edge, selected: true })));
      } else if (!mod && e.key.toLowerCase() === "v") {
        setToolMode("select");
      } else if (!mod && e.key.toLowerCase() === "h") {
        setToolMode("pan");
      } else if (e.key === "Escape") setPlayState({ on: false, step: 0 });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /* Layout (animated), templates, text */
  const animateTo = (target: Record<string, { x: number; y: number }>) => {
    const from = new Map(rf.getNodes().map((n) => [n.id, n.position]));
    const t0 = performance.now();
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / 500);
      const e = 1 - (1 - k) ** 3;
      setNodes((ns) => ns.map((n) => (target[n.id] && from.get(n.id) ? { ...n, position: { x: from.get(n.id)!.x + (target[n.id].x - from.get(n.id)!.x) * e, y: from.get(n.id)!.y + (target[n.id].y - from.get(n.id)!.y) * e } } : n)));
      if (k < 1) requestAnimationFrame(tick);
      else void rf.fitView({ duration: 500, padding: 0.15 });
    };
    requestAnimationFrame(tick);
  };
  const autoLayout = (dir = settings.dir) => {
    set({ dir });
    const target = layout(nodes.map(fromRFNode), edges.map(fromRFEdge), dir);
    const placed = nodes.map((n) => ({ ...n, position: target[n.id] ?? n.position }));
    setEdges((es) => assignHandles(placed, es, dir));
    animateTo(target);
  };
  const loadText = (t: string) => {
    const p = fromText(t);
    if (!p.nodes.length) {
      setTextErr(p.errors.length ? p.errors : ["Nothing to draw yet."]);
      return false;
    }
    setNodes(p.nodes.map(toRFNode));
    setEdges(p.edges.map((e) => toRFEdge({ ...e, data: { ...e.data, path: settings.path, anim: settings.anim === "none" ? e.data.anim : settings.anim } })));
    set({ dir: p.direction });
    setTextErr(p.errors);
    setReveal((r) => r + 1);
    requestAnimationFrame(() => void rf.fitView({ duration: 600, padding: 0.15 }));
    return true;
  };

  /* Play the flow */
  const order = useMemo(() => playOrder(nodes, edges), [nodes, edges]);
  useEffect(() => {
    if (!playState.on) return;
    if (playState.step >= order.length) {
      const t = setTimeout(() => setPlayState({ on: false, step: 0 }), speed * 1.5);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setPlayState((p) => ({ ...p, step: p.step + 1 })), speed);
    return () => clearTimeout(t);
  }, [playState, order.length, speed]);
  const play: Play = useMemo(() => {
    const visited = new Set(order.slice(0, playState.step));
    const active = playState.on ? (order[playState.step] ?? null) : null;
    const flowing = new Set(edges.filter((e) => active && e.target === active && visited.has(e.source)).map((e) => e.id));
    return { on: playState.on, active, visited, flowing, reveal, index: new Map(order.map((id, i) => [id, i])) };
  }, [order, playState, edges, reveal]);

  /* Fullscreen */
  useEffect(() => {
    const f = () => setFull(document.fullscreenElement === wrap.current);
    document.addEventListener("fullscreenchange", f);
    return () => document.removeEventListener("fullscreenchange", f);
  }, []);

  /* Export */
  const exportImage = async (kind: "png" | "svg" | "anim" | "copy") => {
    if (!nodes.length) return flash("Add something to the chart first.");
    const { toPng, toSvg } = await import("html-to-image");
    setNodes((ns) => ns.map((n) => ({ ...n, selected: false })));
    setEdges((es) => es.map((e) => ({ ...e, selected: false })));
    await new Promise((r) => setTimeout(r, 80));
    const b = getNodesBounds(rf.getNodes());
    const pad = 48;
    const w = Math.min(4000, Math.round(b.width + pad * 2));
    const h = Math.min(4000, Math.round(b.height + pad * 2));
    const vp = getViewportForBounds(b, w, h, 0.1, 2, 0.04);
    const el = wrap.current?.querySelector(".react-flow__viewport") as HTMLElement | null;
    if (!el) return;
    const opts = {
      backgroundColor: "#fbfaf6",
      width: w,
      height: h,
      style: { width: `${w}px`, height: `${h}px`, transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})` },
      filter: (n: HTMLElement) => !n.classList?.contains("react-flow__handle") && !n.classList?.contains("react-flow__resize-control"),
    };
    try {
      if (kind === "svg" || kind === "anim") {
        let svg = decodeURIComponent((await toSvg(el, opts)).split(",").slice(1).join(","));
        if (kind === "anim") svg = svg.replace(/<svg([^>]*)>/, "<svg$1><style>@keyframes dwdash{to{stroke-dashoffset:-28}}</style>");
        saveBlob(new Blob([svg], { type: "image/svg+xml" }), kind === "anim" ? "flowchart-animated.svg" : "flowchart.svg");
      } else {
        const url = await toPng(el, { ...opts, pixelRatio: 2 });
        const blob = await (await fetch(url)).blob();
        if (kind === "copy") {
          await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
          flash("Image copied. Paste it into a doc, slide or chat.");
        } else saveBlob(blob, "flowchart.png");
      }
    } catch {
      flash("That export didn't work in this browser. Try PNG.");
    }
  };
  const openFile = useRef<HTMLInputElement>(null);
  const openProject = async (f: File) => {
    try {
      const raw = await f.text();
      if (/^\s*(flowchart|graph)\b/i.test(raw) || f.name.endsWith(".mmd")) return void loadText(raw);
      const d = JSON.parse(raw);
      if (d?.app !== "do-whatever-flowchart" || !Array.isArray(d.nodes)) throw new Error();
      setNodes((d.nodes as FlowNode[]).map(toRFNode));
      setEdges((d.edges as FlowEdge[]).map(toRFEdge));
      setSettings({ ...DEFAULT_SETTINGS, ...d.settings });
      setReveal((r) => r + 1);
      requestAnimationFrame(() => void rf.fitView({ duration: 500, padding: 0.15 }));
      flash("Flowchart opened.");
    } catch {
      flash("That isn't a flowchart saved from here (or Mermaid text).");
    }
  };

  return (
    <div className="grid gap-3 p-3 sm:p-4 lg:grid-cols-[minmax(0,1fr)_300px]">
      <style>{`@keyframes dwpop{from{opacity:0;transform:scale(.82) translateY(10px)}to{opacity:1;transform:none}}@keyframes dwdash{to{stroke-dashoffset:-28}}
.dw-flow{--xy-edge-stroke-default:#57544a;--xy-connectionline-stroke-default:#eb4a10;--xy-connectionline-stroke-width-default:2;--xy-selection-background-color-default:rgba(235,74,16,.08);--xy-selection-border-default:1px dashed #eb4a10;--xy-minimap-background-color-default:#fbfaf6;--xy-controls-button-background-color-default:#fbfaf6;--xy-controls-button-border-color-default:#dad5c8;--xy-attribution-background-color-default:transparent}
.dw-flow .react-flow__node{font-family:inherit}.dw-flow .react-flow__controls{border-radius:8px;overflow:hidden;box-shadow:0 2px 8px -2px rgba(0,0,0,.15)}
@media (prefers-reduced-motion:reduce){.dw-flow *{animation-duration:.01ms!important;animation-iteration-count:1!important}}`}</style>
      <div className="grid min-w-0 content-start gap-2">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-0.5 rounded-md border border-line bg-surface p-1">
          <ToolBtn icon={<MousePointer2 aria-hidden className="size-4" />} label={"Select & drag box (V)"} onClick={() => setToolMode("select")} on={toolMode === "select"} />
          <ToolBtn icon={<Hand aria-hidden className="size-4" />} label={"Pan canvas (H)"} onClick={() => setToolMode("pan")} on={toolMode === "pan"} />
          <span className="mx-1 h-6 w-px bg-line" />
          <ToolBtn icon={<Undo2 aria-hidden className="size-4" />} label={"Undo (Ctrl+Z)"} onClick={undo} disabled={!histLen.past} />
          <ToolBtn icon={<Redo2 aria-hidden className="size-4" />} label={"Redo (Ctrl+Y)"} onClick={redo} disabled={!histLen.future} />
          <span className="mx-1 h-6 w-px bg-line" />
          <ToolBtn icon={<CopyPlus aria-hidden className="size-4" />} label={"Duplicate (Ctrl+D)"} onClick={() => (copy(), paste(30))} disabled={!selNodes.length} />
          <ToolBtn icon={<Trash2 aria-hidden className="size-4" />} label={"Delete (Del)"} onClick={remove} disabled={!selNodes.length && !selEdges.length} />
          <span className="mx-1 h-6 w-px bg-line" />
          <ToolBtn icon={<ArrowDown aria-hidden className="size-4" />} label={"Tidy up, top to bottom"} onClick={() => autoLayout("TB")} />
          <ToolBtn icon={<ArrowRight aria-hidden className="size-4" />} label={"Tidy up, left to right"} onClick={() => autoLayout("LR")} />
          <span className="mx-1 h-6 w-px bg-line" />
          <Pill label={"Templates"} onClick={() => setPanel((p) => (p === "templates" ? "none" : "templates"))} on={panel === "templates"} icon={<LayoutTemplate aria-hidden className="size-4" />} />
          <Pill label={"Type it"} onClick={() => (setPanel((p) => (p === "text" ? "none" : "text")), setText(toFlowText(nodes.map(fromRFNode), edges.map(fromRFEdge), settings.dir)))} on={panel === "text"} icon={<FileCode aria-hidden className="size-4" />} />
          <Pill label={playState.on ? "Stop" : "Play the flow"} onClick={() => setPlayState((p) => ({ on: !p.on, step: 0 }))} on={playState.on} icon={playState.on ? <Square aria-hidden className="size-3.5" /> : <Play aria-hidden className="size-4" />} />
          <Pill label={"Export"} onClick={() => setPanel((p) => (p === "export" ? "none" : "export"))} on={panel === "export"} icon={<Download aria-hidden className="size-4" />} />
          <span className="ml-auto" />
          {note && <span className="px-2 text-[13px] text-success">{note}</span>}
          <ToolBtn icon={full ? <Minimize aria-hidden className="size-4" /> : <Maximize aria-hidden className="size-4" />} label={full ? "Leave full screen" : "Full screen"} onClick={() => (full ? void document.exitFullscreen() : void wrap.current?.requestFullscreen().catch(() => {}))} />
        </div>

        <AnimatePresence initial={false}>
          {panel !== "none" && (
            <motion.div key={panel} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
              <div className="rounded-md border border-line bg-paper p-3">
                {panel === "templates" && (
                  <div className="grid grid-cols-2 gap-2 @xl:grid-cols-4">
                    {TEMPLATES.map((t) => (
                      <button key={t.id} type="button" onClick={() => (loadText(t.text), setPanel("none"))} className="rounded-md border border-line bg-surface px-3 py-2.5 text-left text-sm text-ink transition-[border-color,transform] hover:-translate-y-0.5 hover:border-ink-3">
                        {t.name}
                      </button>
                    ))}
                    <p className="col-span-full text-xs text-ink-3">A template replaces the canvas. Undo (Ctrl+Z) brings your chart back.</p>
                  </div>
                )}
                {panel === "text" && (
                  <div className="grid gap-2">
                    <p className="text-xs text-ink-2">
                      One link per line: <code className="font-mono">A[Step] --&gt; B{"{"}Question?{"}"}</code>, labels as <code className="font-mono">--&gt;|Yes|</code>, dotted <code className="font-mono">-.-&gt;</code>, thick <code className="font-mono">==&gt;</code>. Shapes: <code className="font-mono">([start])</code> <code className="font-mono">{"{decision}"}</code> <code className="font-mono">[/input/]</code> <code className="font-mono">[(database)]</code> <code className="font-mono">((circle))</code> <code className="font-mono">{"{{prep}}"}</code> <code className="font-mono">[[sub]]</code>. It&apos;s Mermaid&apos;s flowchart syntax, so you can paste from docs and GitHub too.
                    </p>
                    <textarea value={text} onChange={(e) => setText(e.target.value)} rows={9} spellCheck={false} aria-label="Flowchart as text" className="w-full rounded-md border border-line bg-surface px-3 py-2 font-mono text-[13px] text-ink outline-none focus:border-ink" />
                    {textErr.length > 0 && <Notice tone="warning">{textErr.slice(0, 4).join(" · ")}</Notice>}
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => loadText(text) && setPanel("none")} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-ink px-3 text-sm font-medium text-paper hover:opacity-90">
                        <WandSparkles aria-hidden className="size-4" /> Draw it
                      </button>
                      <button type="button" onClick={async () => (await navigator.clipboard.writeText(text), flash("Text copied."))} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line bg-surface px-3 text-sm text-ink hover:border-ink-3">
                        <Copy aria-hidden className="size-4" /> Copy as Mermaid
                      </button>
                    </div>
                  </div>
                )}
                {panel === "export" && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill label={"PNG"} onClick={() => void exportImage("png")} />
                    <Pill label={"SVG"} onClick={() => void exportImage("svg")} />
                    <Pill label={"Animated SVG"} onClick={() => void exportImage("anim")} />
                    <Pill label={"Copy image"} onClick={() => void exportImage("copy")} />
                    <span className="mx-1 h-6 w-px bg-line" />
                    <Pill label={"Save project"} onClick={() => saveBlob(new Blob([JSON.stringify({ app: "do-whatever-flowchart", v: 1, nodes: nodes.map(fromRFNode), edges: edges.map(fromRFEdge), settings }, null, 2)], { type: "application/json" }), "flowchart.flow.json")} on={false} icon={<Save aria-hidden className="size-4" />} />
                    <Pill label={"Open"} onClick={() => openFile.current?.click()} on={false} icon={<FolderOpen aria-hidden className="size-4" />} />
                    <Pill label={"Mermaid (.mmd)"} onClick={() => saveBlob(new Blob([toFlowText(nodes.map(fromRFNode), edges.map(fromRFEdge), settings.dir)], { type: "text/plain" }), "flowchart.mmd")} />
                    <input ref={openFile} type="file" accept=".json,.mmd,.txt,application/json,text/plain" className="sr-only" onChange={(e) => (e.target.files?.[0] && void openProject(e.target.files[0]), (e.target.value = ""))} />
                    <p className="w-full text-xs text-ink-3">The animated SVG keeps flowing-dash and moving-dot links moving wherever it&apos;s opened. Your chart is also kept in this browser.</p>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Canvas */}
        <div ref={wrap} className={cn("dw-flow relative overflow-hidden rounded-md border border-line bg-surface", full ? "h-screen rounded-none" : "h-[480px] sm:h-[620px]")}>
          <PlayCtx.Provider value={play}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onConnectEnd={onConnectEnd}
              connectionRadius={28}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              connectionMode={ConnectionMode.Loose}
              connectionLineType={settings.path === "bezier" ? ConnectionLineType.Bezier : settings.path === "straight" ? ConnectionLineType.Straight : settings.path === "step" ? ConnectionLineType.Step : ConnectionLineType.SmoothStep}
              snapToGrid={settings.snap}
              snapGrid={[10, 10]}
              selectionOnDrag={toolMode === "select"}
              panOnDrag={toolMode === "pan" ? true : [1, 2]}
              selectionMode={SelectionMode.Partial}
              multiSelectionKeyCode={["Shift", "Meta", "Control"]}
              deleteKeyCode={["Backspace", "Delete"]}
              zoomOnDoubleClick={false}
              minZoom={0.15}
              maxZoom={2.5}
              fitView
              fitViewOptions={{ padding: 0.15 }}
              onDoubleClick={(e) => {
                if ((e.target as HTMLElement).classList.contains("react-flow__pane")) addShape("process", rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "copy";
              }}
              onDrop={(e) => {
                const k = e.dataTransfer.getData("application/x-dw-shape") as ShapeKind;
                if (k) {
                  e.preventDefault();
                  addShape(k, rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
                }
              }}
            >
              {settings.bg !== "none" && <Background variant={settings.bg === "dots" ? BackgroundVariant.Dots : BackgroundVariant.Lines} gap={settings.bg === "dots" ? 20 : 40} size={settings.bg === "dots" ? 1.4 : 1} color="#d6d0c2" />}
              <Controls showInteractive={false} position="bottom-left" />
              {settings.minimap && <MiniMap pannable zoomable nodeColor={(n) => (n.data as FlowNodeData).fill === "transparent" ? "#dad5c8" : (n.data as FlowNodeData).fill} nodeStrokeColor={(n) => (n.data as FlowNodeData).stroke} nodeBorderRadius={6} />}
            </ReactFlow>
          </PlayCtx.Provider>
          {playState.on && (
            <div className="absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-3 rounded-full bg-ink px-4 py-1.5 text-[13px] text-paper shadow-lg">
              Step {Math.min(playState.step + 1, order.length)} of {order.length}
              <button type="button" onClick={() => setPlayState({ on: false, step: 0 })} className="text-paper/70 hover:text-paper">
                Stop
              </button>
            </div>
          )}
          {nodes.length === 0 && <p className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-ink-3">Drag a shape in, double-click the canvas, or pick a template.</p>}
        </div>
        <p className="text-xs text-ink-3">
          Drag on canvas to select many · Shift/Ctrl-click to add · drag a corner to resize · drag from a dot to connect · double-click a shape to edit text · Space+drag or Hand tool (H) to pan · Ctrl+Z / Ctrl+Y · Ctrl+C / Ctrl+V / Ctrl+D · Del
        </p>
      </div>

      {/* Side panel */}
      <aside className="grid min-w-0 content-start gap-3">
        <section className="rounded-md border border-line bg-surface p-3">
          <h3 className="label-mono mb-2 text-ink-3">Shapes · click or drag</h3>
          <div className="grid grid-cols-4 gap-1.5 lg:grid-cols-3">
            {SHAPES.map((s) => (
              <button
                key={s.kind}
                type="button"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("application/x-dw-shape", s.kind);
                  e.dataTransfer.effectAllowed = "copy";
                }}
                onClick={() => addShape(s.kind)}
                title={`${s.name}: ${s.hint}`}
                aria-label={`Add ${s.name}`}
                className="group grid cursor-grab place-items-center gap-1 rounded-[8px] border border-transparent px-1 py-2 text-[11px] text-ink-2 transition-colors hover:border-line hover:bg-paper active:cursor-grabbing"
              >
                <span className="relative h-7 w-11 transition-transform group-hover:scale-110">
                  <ShapeView d={{ ...nodeData(s.kind, ""), strokeWidth: 1.5, ...(s.kind === "text" ? { stroke: "#8a867a" } : {}) }} />
                  {s.kind === "text" && <Type aria-hidden className="absolute inset-0 m-auto size-4 text-ink-2" />}
                </span>
                <span className="truncate">{s.name}</span>
              </button>
            ))}
          </div>
        </section>

        {selNodes.length > 0 ? (
          <NodeInspector nodes={selNodes} update={updateNodes} setShape={setShape} />
        ) : selEdges.length > 0 ? (
          <EdgeInspector edge={selEdges[0]} count={selEdges.length} update={updateEdges} />
        ) : (
          <section className="grid gap-3 rounded-md border border-line bg-surface p-3">
            <h3 className="label-mono text-ink-3">Canvas</h3>
            <Chips value={settings.bg} options={[{ value: "dots", label: "Dots" }, { value: "lines", label: "Grid" }, { value: "none", label: "Plain" }]} onChange={(bg) => set({ bg })} label="Background" />
            <Toggle checked={settings.snap} onChange={(snap) => set({ snap })} label="Snap to grid" />
            <Toggle checked={settings.minimap} onChange={(minimap) => set({ minimap })} label="Mini map" />
            <h3 className="label-mono mt-1 text-ink-3">New links</h3>
            <Chips value={settings.path} options={PATH_OPTIONS} onChange={(path) => set({ path })} label="Link style" />
            <Chips value={settings.anim} options={ANIM_OPTIONS} onChange={(anim) => set({ anim })} label="Link animation" />
            <button type="button" onClick={() => setEdges((es) => es.map((e) => withMarkers({ ...e, data: { ...(e.data ?? DEFAULT_EDGE), path: settings.path, anim: settings.anim } })))} className="h-9 rounded-md border border-line px-3 text-[13px] text-ink hover:border-ink-3">
              Apply to every link
            </button>
            <h3 className="label-mono mt-1 text-ink-3">Play the flow</h3>
            <Slider label="Step every" value={speed} min={400} max={3000} step={100} onChange={setSpeed} format={(v) => `${(v / 1000).toFixed(1)} s`} />
            <button type="button" onClick={() => setReveal((r) => r + 1)} className="h-9 rounded-md border border-line px-3 text-[13px] text-ink hover:border-ink-3">
              Replay the entrance animation
            </button>
            <p className="text-xs text-ink-3">Select a shape or a link to style it.</p>
          </section>
        )}
      </aside>
    </div>
  );
}

function ToolBtn({ icon, label, onClick, disabled, on }: { icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean; on?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={label} aria-label={label} aria-pressed={on} className={cn("inline-flex size-9 items-center justify-center rounded-[8px] transition-colors disabled:opacity-30", on ? "bg-ink text-paper" : "text-ink-2 hover:bg-paper-2 hover:text-ink")}>
      {icon}
    </button>
  );
}

function Pill({ label, onClick, on = false, icon }: { label: string; onClick: () => void; on?: boolean; icon?: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} className={cn("inline-flex h-9 items-center gap-1.5 rounded-[8px] px-3 text-[13px] font-medium transition-colors", on ? "bg-ink text-paper" : "text-ink hover:bg-paper-2")}>
      {icon}
      {label}
    </button>
  );
}

const PATH_OPTIONS: { value: PathKind; label: string }[] = [
  { value: "smoothstep", label: "Rounded" },
  { value: "bezier", label: "Curved" },
  { value: "step", label: "Square" },
  { value: "straight", label: "Straight" },
];
const ANIM_OPTIONS: { value: EdgeAnim; label: string }[] = [
  { value: "none", label: "Still" },
  { value: "dash", label: "Flowing" },
  { value: "dots", label: "Moving dots" },
];

function Swatches({ value, options, onChange, label }: { value: string; options: string[]; onChange: (v: string) => void; label: string }) {
  return (
    <div className="grid gap-1.5">
      <span className="label-mono text-ink-3">{label}</span>
      <div className="flex flex-wrap items-center gap-1">
        {options.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            aria-label={`${label} ${c === "transparent" ? "none" : c}`}
            aria-pressed={value.toLowerCase() === c}
            className={cn("size-6 rounded-[6px] border transition-transform hover:scale-110", value.toLowerCase() === c ? "border-accent ring-2 ring-accent/40" : "border-line")}
            style={{ background: c === "transparent" ? "repeating-conic-gradient(#dad5c8 0% 25%, #fff 0% 50%) 0 0 / 8px 8px" : c }}
          />
        ))}
        <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#ffffff"} onChange={(e) => onChange(e.target.value)} aria-label={`${label}: any colour`} className="h-6 w-8 cursor-pointer rounded-[6px] border border-line bg-transparent" />
      </div>
    </div>
  );
}

function NodeInspector({ nodes, update, setShape }: { nodes: RFNode[]; update: (p: Partial<FlowNodeData>) => void; setShape: (s: ShapeKind) => void }) {
  const d = nodes[0].data;
  return (
    <section className="grid gap-3 rounded-md border border-line bg-surface p-3">
      <h3 className="label-mono text-ink-3">{nodes.length > 1 ? `${nodes.length} shapes` : "Shape"}</h3>
      {nodes.length === 1 && (
        <textarea value={d.label} onChange={(e) => update({ label: e.target.value })} rows={2} aria-label="Text" className="w-full resize-y rounded-md border border-line bg-paper px-2.5 py-2 text-sm text-ink outline-none focus:border-ink" />
      )}
      <select value={d.shape} onChange={(e) => setShape(e.target.value as ShapeKind)} aria-label="Shape" className="h-9 rounded-md border border-line bg-paper px-2 text-sm text-ink">
        {SHAPES.map((s) => (
          <option key={s.kind} value={s.kind}>
            {s.name}
          </option>
        ))}
      </select>
      <Swatches label="Fill" value={d.fill} options={[...FILLS, "transparent"]} onChange={(fill) => update({ fill })} />
      <Swatches label="Border" value={d.stroke} options={STROKES} onChange={(stroke) => update({ stroke })} />
      <Slider label="Border width" value={d.strokeWidth} min={0} max={6} step={0.5} onChange={(strokeWidth) => update({ strokeWidth })} format={(v) => `${v}px`} />
      <Toggle checked={d.dashed} onChange={(dashed) => update({ dashed })} label="Dashed border" />
      <Swatches label="Text" value={d.color} options={["#15140f", "#57544a", "#ffffff", "#eb4a10", "#4f6bd8", "#2f7d4f", "#c2410c"]} onChange={(color) => update({ color })} />
      <Slider label="Text size" value={d.fontSize} min={10} max={32} onChange={(fontSize) => update({ fontSize })} format={(v) => `${v}px`} />
      <div className="flex gap-1">
        <button type="button" aria-pressed={d.bold} aria-label="Bold" onClick={() => update({ bold: !d.bold })} className={cn("inline-flex size-9 items-center justify-center rounded-[8px] border", d.bold ? "border-ink bg-ink text-paper" : "border-line text-ink-2")}>
          <Bold aria-hidden className="size-4" />
        </button>
        <button type="button" aria-pressed={d.italic} aria-label="Italic" onClick={() => update({ italic: !d.italic })} className={cn("inline-flex size-9 items-center justify-center rounded-[8px] border", d.italic ? "border-ink bg-ink text-paper" : "border-line text-ink-2")}>
          <Italic aria-hidden className="size-4" />
        </button>
      </div>
    </section>
  );
}

function EdgeInspector({ edge, count, update }: { edge: RFEdge; count: number; update: (p: Partial<FlowEdgeData>) => void }) {
  const d = edge.data ?? DEFAULT_EDGE;
  return (
    <section className="grid gap-3 rounded-md border border-line bg-surface p-3">
      <h3 className="label-mono text-ink-3">{count > 1 ? `${count} links` : "Link"}</h3>
      <input value={d.label} onChange={(e) => update({ label: e.target.value })} placeholder="Label (Yes, No, then…)" aria-label="Link label" className="h-9 rounded-md border border-line bg-paper px-2.5 text-sm text-ink outline-none focus:border-ink" />
      <Chips value={d.path} options={PATH_OPTIONS} onChange={(path) => update({ path })} label="Link style" />
      <Chips value={d.arrows} options={[{ value: "end", label: "→" }, { value: "both", label: "↔" }, { value: "none", label: "—" }]} onChange={(arrows) => update({ arrows })} label="Arrows" />
      <Chips value={d.anim} options={ANIM_OPTIONS} onChange={(anim) => update({ anim })} label="Animation" />
      <Swatches label="Colour" value={d.color} options={STROKES.filter((c) => c !== "transparent")} onChange={(color) => update({ color })} />
      <Slider label="Thickness" value={d.width} min={1} max={6} step={0.5} onChange={(width) => update({ width })} format={(v) => `${v}px`} />
      <Toggle checked={d.dashed} onChange={(dashed) => update({ dashed })} label="Dashed" />
    </section>
  );
}
