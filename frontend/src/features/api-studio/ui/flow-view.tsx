"use client";

import "@xyflow/react/dist/style.css";
import { useCallback, useMemo, useRef, useState } from "react";
import { Background, Controls, Handle, MiniMap, Position, ReactFlow, ReactFlowProvider, type Connection, type Edge, type Node, type NodeChange, type EdgeChange, applyNodeChanges, applyEdgeChanges } from "@xyflow/react";
import { Play, Plus, Square, Trash2, Workflow } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Flow, FlowBlock, FlowBlockType } from "../types";
import { BLOCKS, runFlow, type FlowRunState } from "../lib/flows";
import { requestsIn, uid } from "../lib/util";
import { useApi } from "../store";
import { Btn, Empty, IconBtn, Label, Menu, MethodTag } from "./kit";

type BlockData = { block: FlowBlock; run?: FlowRunState | null; onData: (id: string, patch: Record<string, string>) => void };

function BlockNode({ data, selected }: { data: BlockData; selected: boolean }) {
  const b = data.block;
  const def = BLOCKS[b.type];
  const ws = useApi((s) => s.ws);
  const value = data.run?.values[b.id];
  const active = data.run?.active === b.id;
  const set = (patch: Record<string, string>) => data.onData(b.id, patch);
  const field = "nodrag w-full rounded-[6px] border border-line bg-surface px-2 py-1 font-mono text-[12px] outline-none focus:border-ink";
  return (
    <div className={cn("w-[230px] rounded-lg border bg-surface shadow-card", selected ? "border-ink" : "border-line", active && "ring-2 ring-accent")}>
      {def.inputs && <Handle type="target" position={Position.Left} className="!size-3 !border-2 !border-surface !bg-ink-3" />}
      <div className="flex items-center gap-2 border-b border-line px-2.5 py-1.5">
        <span className="font-mono text-[12px] font-semibold uppercase tracking-[0.06em] text-ink">{def.label}</span>
      </div>
      <div className="space-y-1.5 p-2.5">
        {b.type === "start" && <textarea className={field} rows={2} value={b.data.value ?? ""} onChange={(e) => set({ value: e.target.value })} placeholder='Starting value (JSON), e.g. {"id": 1}' aria-label="Starting value" />}
        {b.type === "request" && (
          <select className={field} value={`${b.data.collectionId ?? ""}|${b.data.itemId ?? ""}`} onChange={(e) => { const [collectionId, itemId] = e.target.value.split("|"); set({ collectionId, itemId }); }} aria-label="Request">
            <option value="|">Pick a saved request…</option>
            {ws.collections.map((c) => (
              <optgroup key={c.id} label={c.name}>
                {requestsIn(c.items).filter(({ req }) => req.protocol === "http" || req.protocol === "graphql").map(({ req }) => <option key={req.id} value={`${c.id}|${req.id}`}>{req.method} {req.name}</option>)}
              </optgroup>
            ))}
          </select>
        )}
        {(b.type === "evaluate" || b.type === "condition") && <input className={field} value={b.data.expr ?? ""} onChange={(e) => set({ expr: e.target.value })} placeholder={b.type === "condition" ? "value.status === 200" : "value.body.items.length"} aria-label="Expression" />}
        {b.type === "delay" && <input className={field} type="number" value={b.data.ms ?? "1000"} onChange={(e) => set({ ms: e.target.value })} aria-label="Delay in ms" />}
        {b.type === "template" && <textarea className={field} rows={2} value={b.data.text ?? ""} onChange={(e) => set({ text: e.target.value })} placeholder="Hello {{value.name}}" aria-label="Template" />}
        {b.type === "setvar" && (
          <div className="flex gap-1">
            <select className={cn(field, "w-24")} value={b.data.scope ?? "environment"} onChange={(e) => set({ scope: e.target.value })} aria-label="Scope">
              <option value="environment">env</option>
              <option value="globals">global</option>
              <option value="collection">collection</option>
            </select>
            <input className={field} value={b.data.key ?? ""} onChange={(e) => set({ key: e.target.value })} placeholder="variable" aria-label="Variable name" />
          </div>
        )}
        {(b.type === "display" || b.type === "output" || value !== undefined) && (
          <pre className="nodrag nowheel max-h-32 overflow-auto rounded-[6px] bg-paper p-1.5 font-mono text-[12px] text-ink-2">{value === undefined ? "—" : typeof value === "string" ? value : JSON.stringify(value, null, 2)}</pre>
        )}
        {!["display", "output"].includes(b.type) && value === undefined && <p className="text-[12px] leading-snug text-ink-3">{def.hint}</p>}
      </div>
      {def.outputs.map((o, i) => (
        <Handle key={o} id={o} type="source" position={Position.Right} style={{ top: def.outputs.length === 1 ? "50%" : `${30 + i * 40}%` }} className={cn("!size-3 !border-2 !border-surface", o === "fail" || o === "false" ? "!bg-danger" : o === "success" || o === "true" ? "!bg-success" : "!bg-ink")}>
          {def.outputs.length > 1 && <span className="pointer-events-none absolute left-3 -top-2 font-mono text-[12px] text-ink-3">{o}</span>}
        </Handle>
      ))}
    </div>
  );
}

const nodeTypes = { block: BlockNode };

export function FlowView({ id }: { id: string }) {
  return (
    <ReactFlowProvider>
      <FlowCanvas id={id} />
    </ReactFlowProvider>
  );
}

function FlowCanvas({ id }: { id: string }) {
  const flow = useApi((s) => s.ws.flows.find((f) => f.id === id));
  const mutate = useApi((s) => s.mutate);
  const [run, setRun] = useState<FlowRunState | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  const save = useCallback((fn: (f: Flow) => Flow) => mutate((w) => ({ ...w, flows: w.flows.map((f) => (f.id === id ? fn(f) : f)) })), [mutate, id]);
  const onData = useCallback((bid: string, patch: Record<string, string>) => save((f) => ({ ...f, blocks: f.blocks.map((b) => (b.id === bid ? { ...b, data: { ...b.data, ...patch } } : b)) })), [save]);

  const nodes: Node[] = useMemo(() => (flow?.blocks ?? []).map((b) => ({ id: b.id, type: "block", position: { x: b.x, y: b.y }, data: { block: b, run, onData } })), [flow?.blocks, run, onData]);
  const edges: Edge[] = useMemo(() => (flow?.edges ?? []).map((e) => ({ id: e.id, source: e.from, sourceHandle: e.fromPort, target: e.to, animated: !!run?.running, style: { stroke: e.fromPort === "fail" || e.fromPort === "false" ? "var(--color-danger)" : "var(--color-ink-3)", strokeWidth: 1.5 } })), [flow?.edges, run?.running]);

  if (!flow) return <Empty icon={Workflow} title="This flow was deleted" />;

  const onNodesChange = (changes: NodeChange[]) => {
    const next = applyNodeChanges(changes, nodes);
    const removed = changes.filter((c) => c.type === "remove").map((c) => c.id);
    save((f) => ({
      ...f,
      blocks: f.blocks.filter((b) => !removed.includes(b.id)).map((b) => {
        const n = next.find((x) => x.id === b.id);
        return n ? { ...b, x: Math.round(n.position.x), y: Math.round(n.position.y) } : b;
      }),
      edges: f.edges.filter((e) => !removed.includes(e.from) && !removed.includes(e.to)),
    }));
  };
  const onEdgesChange = (changes: EdgeChange[]) => {
    const next = applyEdgeChanges(changes, edges);
    save((f) => ({ ...f, edges: f.edges.filter((e) => next.some((x) => x.id === e.id)) }));
  };
  const onConnect = (c: Connection) => {
    if (!c.source || !c.target || c.source === c.target) return;
    save((f) => ({ ...f, edges: [...f.edges.filter((e) => !(e.from === c.source && e.fromPort === (c.sourceHandle ?? "out") && e.to === c.target)), { id: uid(), from: c.source!, fromPort: c.sourceHandle ?? BLOCKS[f.blocks.find((b) => b.id === c.source)!.type].outputs[0], to: c.target! }] }));
  };
  const add = (type: FlowBlockType) => {
    const maxX = Math.max(0, ...flow.blocks.map((b) => b.x));
    save((f) => ({ ...f, blocks: [...f.blocks, { id: uid(), type, x: maxX + 280, y: 80 + (f.blocks.length % 4) * 60, data: type === "delay" ? { ms: "1000" } : {} }] }));
  };
  const start = async () => {
    ctrl.current = new AbortController();
    await runFlow(flow, setRun, ctrl.current.signal);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <input aria-label="Flow name" value={flow.name} onChange={(e) => save((f) => ({ ...f, name: e.target.value }))} className="min-w-0 flex-1 rounded-md bg-transparent px-1 text-[15px] font-semibold outline-none hover:bg-paper-2 focus:bg-surface" />
        <Menu
          label="Add block"
          align="end"
          items={(Object.keys(BLOCKS) as FlowBlockType[]).filter((t) => t !== "start" || !flow.blocks.some((b) => b.type === "start")).map((t) => ({ label: `${BLOCKS[t].label} — ${BLOCKS[t].hint}`, onClick: () => add(t) }))}
          trigger={({ toggle, ref }) => <Btn ref={ref} icon={Plus} onClick={toggle}>Add block</Btn>}
        />
        {run?.running ? (
          <Btn icon={Square} onClick={() => ctrl.current?.abort()}>Stop</Btn>
        ) : (
          <Btn variant="primary" icon={Play} onClick={start}>Run</Btn>
        )}
      </div>
      <div className="relative min-h-[360px] flex-1">
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} fitView deleteKeyCode={["Backspace", "Delete"]} minZoom={0.3}>
          <Background gap={20} color="var(--color-line)" />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable className="max-md:!hidden" nodeColor="var(--color-paper-2)" />
        </ReactFlow>
      </div>
      {run && (
        <div className="max-h-40 shrink-0 overflow-y-auto border-t border-line" data-lenis-prevent>
          <div className="flex items-center justify-between bg-paper px-3 py-1">
            <Label>Run log</Label>
            <IconBtn icon={Trash2} label="Clear log" size="xs" onClick={() => setRun(null)} />
          </div>
          <ul className="font-mono text-[12px]">
            {run.logs.map((l, i) => (
              <li key={i} className={cn("border-b border-line px-3 py-1", l.level === "error" ? "text-danger" : l.level === "success" ? "text-success" : "text-ink-2")}>
                <span className="text-ink-3">{new Date(l.at).toLocaleTimeString()}</span> {l.text}
              </li>
            ))}
          </ul>
          {run.outputs.length > 0 && <pre className="m-2 rounded-md border border-line bg-surface p-2 font-mono text-[12px]">{JSON.stringify(run.outputs.length === 1 ? run.outputs[0] : run.outputs, null, 2)}</pre>}
        </div>
      )}
    </div>
  );
}

export { MethodTag };
