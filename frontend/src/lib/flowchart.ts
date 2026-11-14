/**
 * The flowchart maker's model, without React: shapes and their default look, a Mermaid-style text
 * format (read and written, so a chart can be typed, pasted from docs, or copied out), dagre
 * auto-layout, and the starter templates (written in that same text format).
 */
import dagre from "@dagrejs/dagre";

export type ShapeKind = "process" | "rounded" | "terminal" | "decision" | "io" | "circle" | "hexagon" | "document" | "database" | "predefined" | "manual" | "triangle" | "note" | "text";

export type FlowNodeData = {
  label: string;
  shape: ShapeKind;
  fill: string;
  stroke: string;
  color: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  dashed: boolean;
  strokeWidth: number;
};

export type PathKind = "bezier" | "smoothstep" | "step" | "straight";
export type EdgeAnim = "none" | "dash" | "dots";
export type FlowEdgeData = { label: string; path: PathKind; color: string; width: number; dashed: boolean; arrows: "end" | "both" | "none"; anim: EdgeAnim };

export type FlowNode = { id: string; position: { x: number; y: number }; width: number; height: number; data: FlowNodeData };
export type FlowEdge = { id: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null; data: FlowEdgeData };

export const SHAPES: { kind: ShapeKind; name: string; hint: string; size: [number, number] }[] = [
  { kind: "process", name: "Process", hint: "A step or action", size: [170, 64] },
  { kind: "rounded", name: "Rounded", hint: "A softer step", size: [170, 64] },
  { kind: "terminal", name: "Start / end", hint: "Where the flow begins or ends", size: [160, 56] },
  { kind: "decision", name: "Decision", hint: "A yes/no question", size: [170, 100] },
  { kind: "io", name: "Input / output", hint: "Data in or out", size: [180, 64] },
  { kind: "document", name: "Document", hint: "A report or file", size: [160, 76] },
  { kind: "database", name: "Database", hint: "Stored data", size: [140, 86] },
  { kind: "predefined", name: "Subprocess", hint: "A step defined elsewhere", size: [180, 64] },
  { kind: "manual", name: "Manual input", hint: "Typed in by a person", size: [170, 70] },
  { kind: "hexagon", name: "Preparation", hint: "Setting up", size: [180, 64] },
  { kind: "circle", name: "Circle", hint: "A connector or state", size: [90, 90] },
  { kind: "triangle", name: "Triangle", hint: "Merge or extract", size: [110, 90] },
  { kind: "note", name: "Sticky note", hint: "A comment", size: [170, 100] },
  { kind: "text", name: "Text", hint: "A free label", size: [160, 40] },
];
export const shapeInfo = (k: ShapeKind) => SHAPES.find((s) => s.kind === k) ?? SHAPES[0];

const LOOK: Record<ShapeKind, Pick<FlowNodeData, "fill" | "stroke" | "color">> = {
  process: { fill: "#ffffff", stroke: "#15140f", color: "#15140f" },
  rounded: { fill: "#ffffff", stroke: "#15140f", color: "#15140f" },
  terminal: { fill: "#15140f", stroke: "#15140f", color: "#ffffff" },
  decision: { fill: "#fff4d6", stroke: "#b7791f", color: "#15140f" },
  io: { fill: "#e8eeff", stroke: "#4f6bd8", color: "#15140f" },
  document: { fill: "#fbe9f6", stroke: "#a3479b", color: "#15140f" },
  database: { fill: "#e4f3e9", stroke: "#2f7d4f", color: "#15140f" },
  predefined: { fill: "#f1efe9", stroke: "#57544a", color: "#15140f" },
  manual: { fill: "#e6f6f6", stroke: "#0f8b8d", color: "#15140f" },
  hexagon: { fill: "#e6f6f6", stroke: "#0f8b8d", color: "#15140f" },
  circle: { fill: "#ffe7dc", stroke: "#eb4a10", color: "#15140f" },
  triangle: { fill: "#ffe7dc", stroke: "#eb4a10", color: "#15140f" },
  note: { fill: "#fff6b3", stroke: "#d9c45a", color: "#15140f" },
  text: { fill: "transparent", stroke: "transparent", color: "#15140f" },
};

export const FILLS = ["#ffffff", "#15140f", "#fff4d6", "#e8eeff", "#e4f3e9", "#fbe9f6", "#ffe7dc", "#e6f6f6", "#fff6b3", "#f1efe9", "#eb4a10", "#4f6bd8", "#2f7d4f", "#a3479b"];
export const STROKES = ["#15140f", "#57544a", "#b7791f", "#4f6bd8", "#2f7d4f", "#a3479b", "#eb4a10", "#0f8b8d", "#c2410c", "#d9c45a", "transparent"];

export function nodeData(shape: ShapeKind, label: string): FlowNodeData {
  return { label, shape, ...LOOK[shape], fontSize: 14, bold: shape === "terminal", italic: false, dashed: false, strokeWidth: 2 };
}
export const DEFAULT_EDGE: FlowEdgeData = { label: "", path: "smoothstep", color: "#57544a", width: 2, dashed: false, arrows: "end", anim: "none" };

/* ---------- Text format (a Mermaid flowchart subset) ---------- */

// Each bracket pair → shape. Order matters: longer openers first.
const BRACKETS: [string, string, ShapeKind][] = [
  ["([", "])", "terminal"],
  ["[(", ")]", "database"],
  ["((", "))", "circle"],
  ["{{", "}}", "hexagon"],
  ["[/", "/]", "io"],
  ["[\\", "\\]", "manual"],
  ["[[", "]]", "predefined"],
  ["[>", "]", "document"],
  [">", "]", "note"],
  ["{", "}", "decision"],
  ["(", ")", "rounded"],
  ["[", "]", "process"],
];
const SHAPE_TO_BRACKET = Object.fromEntries(BRACKETS.slice().reverse().map(([o, c, k]) => [k, [o, c]])) as Record<ShapeKind, [string, string]>;
SHAPE_TO_BRACKET.triangle = ["[/", "\\]"];
SHAPE_TO_BRACKET.text = ["[", "]"];

export type Parsed = { nodes: FlowNode[]; edges: FlowEdge[]; direction: Direction; errors: string[] };
export type Direction = "TB" | "LR" | "BT" | "RL";

const ID = /^[\p{L}\p{N}_-]+/u;

/**
 * Reads lines like
 *   flowchart LR
 *   Start([Begin]) --> Q{Ready?}
 *   Q -->|Yes| Go[Ship it] --> End([Done])
 *   Q -. No .-> Fix[/Fix it/]
 * Unknown lines are reported, not fatal.
 */
export function parseFlow(text: string): Parsed {
  const nodes = new Map<string, FlowNode>();
  const edges: FlowEdge[] = [];
  const errors: string[] = [];
  let direction: Direction = "TB";
  const ensure = (id: string, label?: string, shape?: ShapeKind) => {
    let n = nodes.get(id);
    if (!n) {
      const k = shape ?? "process";
      const [w, h] = shapeInfo(k).size;
      n = { id, position: { x: 0, y: 0 }, width: w, height: h, data: nodeData(k, label ?? id) };
      nodes.set(id, n);
    } else if (label !== undefined || shape) {
      const k = shape ?? n.data.shape;
      const [w, h] = shapeInfo(k).size;
      n.data = { ...nodeData(k, label ?? n.data.label) };
      n.width = w;
      n.height = h;
    }
    return n;
  };
  const unquote = (s: string) => s.trim().replace(/^"([\s\S]*)"$/, "$1").replace(/<br\s*\/?>/gi, "\n");

  text.split(/\r?\n|;/).forEach((raw, lineNo) => {
    const line = raw.replace(/%%.*$/, "").trim();
    if (!line) return;
    const head = /^(?:flowchart|graph)\s*(TB|TD|LR|BT|RL)?\s*$/i.exec(line);
    if (head) {
      const d = (head[1] ?? "TB").toUpperCase();
      direction = (d === "TD" ? "TB" : d) as Direction;
      return;
    }
    if (/^(classDef|class|style|linkStyle|click|subgraph|end|direction)\b/i.test(line)) return;
    let rest = line;
    let prev: string | null = null;
    let pendingEdge: Omit<FlowEdgeData, "path" | "color" | "anim"> | null = null;
    for (let guard = 0; rest && guard < 200; guard++) {
      const id = ID.exec(rest);
      if (!id) {
        errors.push(`Line ${lineNo + 1}: couldn't read “${rest.slice(0, 30)}”`);
        return;
      }
      rest = rest.slice(id[0].length).trimStart();
      let label: string | undefined;
      let shape: ShapeKind | undefined;
      for (const [o, c, k] of BRACKETS) {
        if (rest.startsWith(o)) {
          // A quoted label may hold brackets: look for the closer after the closing quote.
          const q = rest[o.length] === '"' ? rest.indexOf('"', o.length + 1) : -1;
          const end = rest.indexOf(c, q > 0 ? q + 1 : o.length);
          if (end < 0) continue;
          label = unquote(rest.slice(o.length, end));
          shape = k;
          rest = rest.slice(end + c.length).trimStart();
          break;
        }
      }
      ensure(id[0], label, shape);
      if (prev && pendingEdge) {
        edges.push({ id: `e${edges.length + 1}`, source: prev, target: id[0], data: { ...DEFAULT_EDGE, ...pendingEdge } });
      }
      prev = id[0];
      pendingEdge = null;
      if (!rest) break;
      // An edge: -->, ---, -.->, ==>, with an optional label as -- text --> or -->|text|.
      const e = /^(?:--\s*([^->|][^>]*?)\s*-->|-\.\s*([^.]+?)\s*\.->|==\s*([^=]+?)\s*==>|(-{2,}>|-{3,}|-\.+->|-\.+-|={2,}>|={3,}|~~~))\s*(?:\|([^|]*)\|)?\s*/.exec(rest);
      if (!e) {
        if (rest.startsWith("&")) {
          errors.push(`Line ${lineNo + 1}: “&” (several nodes at once) isn't supported; write one link per line.`);
          return;
        }
        errors.push(`Line ${lineNo + 1}: expected a link like --> after “${id[0]}”`);
        return;
      }
      const op = e[4] ?? (e[1] !== undefined ? "-->" : e[2] !== undefined ? "-.->" : "==>");
      pendingEdge = {
        label: unquote(e[5] ?? e[1] ?? e[2] ?? e[3] ?? ""),
        dashed: op.includes("."),
        width: op.startsWith("=") ? 3.5 : 2,
        arrows: op.endsWith(">") ? "end" : "none",
      };
      rest = rest.slice(e[0].length);
    }
  });
  return { nodes: [...nodes.values()], edges, direction, errors };
}

export function toFlowText(nodes: FlowNode[], edges: FlowEdge[], direction: Direction = "TB"): string {
  const ids = new Map(nodes.map((n, i) => [n.id, /^[A-Za-z][\w-]*$/.test(n.id) && n.id.length < 24 ? n.id : `n${i + 1}`]));
  const esc = (s: string) => (/[[\](){}|"<>/\\]/.test(s) ? `"${s.replace(/"/g, "'")}"` : s).replace(/\n/g, "<br/>");
  const lines = [`flowchart ${direction}`];
  for (const n of nodes) {
    const [o, c] = SHAPE_TO_BRACKET[n.data.shape];
    lines.push(`  ${ids.get(n.id)}${o}${esc(n.data.label || " ")}${c}`);
  }
  for (const e of edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) continue;
    const d = e.data;
    const op = d.dashed ? (d.arrows === "none" ? "-.-" : "-.->") : d.width >= 3 ? (d.arrows === "none" ? "===" : "==>") : d.arrows === "none" ? "---" : "-->";
    lines.push(`  ${ids.get(e.source)} ${op}${d.label ? `|${esc(d.label)}|` : ""} ${ids.get(e.target)}`);
  }
  return lines.join("\n");
}

/* ---------- Layout ---------- */

export function layout(nodes: FlowNode[], edges: FlowEdge[], direction: Direction, gap = 1): Record<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: direction, nodesep: 46 * gap, ranksep: 70 * gap, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) g.setNode(n.id, { width: n.width, height: n.height });
  for (const e of edges) if (e.source !== e.target) g.setEdge(e.source, e.target, { width: e.data.label ? Math.min(160, e.data.label.length * 7) : 0, height: e.data.label ? 20 : 0 });
  dagre.layout(g);
  const out: Record<string, { x: number; y: number }> = {};
  for (const n of nodes) {
    const p = g.node(n.id);
    if (p) out[n.id] = { x: Math.round(p.x - n.width / 2), y: Math.round(p.y - n.height / 2) };
  }
  return out;
}

/** Parse + lay out: ready to drop on the canvas. */
export function fromText(text: string): Parsed {
  const p = parseFlow(text);
  const pos = layout(p.nodes, p.edges, p.direction);
  p.nodes.forEach((n) => (n.position = pos[n.id] ?? n.position));
  p.edges = assignHandles(p.nodes, p.edges, p.direction);
  return p;
}

/** Order for "play": breadth-first from the starts (nodes nothing points to), then anything left. */
export function playOrder(nodes: { id: string }[], edges: { source: string; target: string }[]): string[] {
  const incoming = new Set(edges.map((e) => e.target));
  const starts = nodes.filter((n) => !incoming.has(n.id)).map((n) => n.id);
  const seen = new Set<string>();
  const order: string[] = [];
  const queue = starts.length ? [...starts] : nodes.slice(0, 1).map((n) => n.id);
  while (order.length < nodes.length) {
    if (!queue.length) {
      const left = nodes.find((n) => !seen.has(n.id));
      if (!left) break;
      queue.push(left.id);
    }
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    order.push(id);
    for (const e of edges) if (e.source === id && !seen.has(e.target)) queue.push(e.target);
  }
  return order;
}

export const TEMPLATES: { id: string; name: string; text: string }[] = [
  {
    id: "decision",
    name: "Yes / no decision",
    text: `flowchart TB
Start([Start]) --> Check{Is it ready?}
Check -->|Yes| Ship[Ship it]
Check -->|No| Fix[/Fix the issues/]
Fix --> Check
Ship --> Done([Done])`,
  },
  {
    id: "process",
    name: "Simple process",
    text: `flowchart LR
Start([Idea]) --> Plan[Plan] --> Build[Build] --> Test[[Test]] --> Launch([Launch])`,
  },
  {
    id: "login",
    name: "Sign-in flow",
    text: `flowchart TB
Open([User opens the app]) --> Has{Has an account?}
Has -->|No| SignUp[/Sign-up form/] --> Verify[Verify email] --> Login
Has -->|Yes| Login[Log in]
Login --> Ok{Password correct?}
Ok -->|Yes| Home([Home screen])
Ok -->|No| Tries{3 tries used?}
Tries -->|No| Login
Tries -->|Yes| Reset[/Send reset link/]`,
  },
  {
    id: "order",
    name: "Online order",
    text: `flowchart TB
Order([Order placed]) --> Pay{Payment OK?}
Pay -->|No| Notify[/Email the customer/] --> End1([Cancelled])
Pay -->|Yes| Save[(Orders database)]
Save --> Stock{In stock?}
Stock -->|Yes| Pack[Pack the parcel] --> Ship[Hand to courier] --> Delivered([Delivered])
Stock -. No .-> Restock[[Restock process]] --> Pack`,
  },
  {
    id: "bug",
    name: "Bug triage",
    text: `flowchart LR
Report[>Bug report] --> Repro{Can we reproduce it?}
Repro -->|No| Ask[/Ask for details/] --> Report
Repro -->|Yes| Sev{Severe?}
Sev -->|Yes| Hotfix[Hotfix now] --> Release([Release])
Sev -->|No| Backlog[(Backlog)] --> Sprint[Plan into a sprint] --> Release`,
  },
  {
    id: "org",
    name: "Org chart",
    text: `flowchart TB
CEO([CEO]) --- CTO[CTO]
CEO --- CFO[CFO]
CEO --- COO[COO]
CTO --- Eng[Engineering]
CTO --- Design[Design]
CFO --- Finance[Finance]
COO --- Ops[Operations]
COO --- Support[Support]`,
  },
  { id: "blank", name: "Blank canvas", text: "flowchart TB\nStart([Start])" },
];

/**
 * Which side each link leaves and enters by. Forward links (with the flow) go out the bottom and in
 * the top (right → left for horizontal charts); links that loop back use the sides, so they don't
 * run over the forward ones.
 */
export function assignHandles<E extends { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }>(
  nodes: { id: string; position: { x: number; y: number }; width?: number; height?: number }[],
  edges: E[],
  direction: Direction,
): E[] {
  const at = new Map(nodes.map((n) => [n.id, { x: n.position.x + (n.width ?? 160) / 2, y: n.position.y + (n.height ?? 60) / 2 }]));
  const vertical = direction === "TB" || direction === "BT";
  const sign = direction === "BT" || direction === "RL" ? -1 : 1;
  return edges.map((e) => {
    const a = at.get(e.source);
    const b = at.get(e.target);
    if (!a || !b) return e;
    const along = (vertical ? b.y - a.y : b.x - a.x) * sign;
    const across = vertical ? b.x - a.x : b.y - a.y;
    let s: string;
    let t: string;
    if (along > 10) {
      [s, t] = vertical ? (sign > 0 ? ["b", "t"] : ["t", "b"]) : sign > 0 ? ["r", "l"] : ["l", "r"];
    } else if (vertical) {
      [s, t] = across >= 0 ? ["r", "l"] : ["l", "r"];
      if (Math.abs(across) < 40) [s, t] = ["r", "r"];
    } else {
      [s, t] = across >= 0 ? ["b", "t"] : ["t", "b"];
      if (Math.abs(across) < 30) [s, t] = ["b", "b"];
    }
    return { ...e, sourceHandle: s, targetHandle: t };
  });
}
