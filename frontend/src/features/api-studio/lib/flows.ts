import type { Flow, FlowBlock, FlowBlockType } from "../types";
import { useApi } from "../store";
import { execute } from "./engine";
import { renderTemplate } from "./assist";
import { runScript } from "./sandbox/client";
import { b64ToText, findNode, tryJson } from "./util";

/**
 * Flows: blocks connected by wires, run by passing a value along each wire (Postman Flows' model).
 * Expressions (Evaluate, Condition) run inside the script sandbox, like scripts do.
 */

export const BLOCKS: Record<FlowBlockType, { label: string; hint: string; inputs: boolean; outputs: string[] }> = {
  start: { label: "Start", hint: "Where the flow begins.", inputs: false, outputs: ["out"] },
  request: { label: "Send request", hint: "Sends a saved request. The incoming value's fields become variables.", inputs: true, outputs: ["success", "fail"] },
  evaluate: { label: "Evaluate", hint: "A JavaScript expression on `value`; passes the result on.", inputs: true, outputs: ["out"] },
  condition: { label: "If", hint: "Sends the value to True or False by an expression.", inputs: true, outputs: ["true", "false"] },
  foreach: { label: "For each", hint: "Sends each item of a list, then the whole list.", inputs: true, outputs: ["item", "done"] },
  delay: { label: "Delay", hint: "Waits, then passes the value on.", inputs: true, outputs: ["out"] },
  template: { label: "Template", hint: "Builds text from the value: {{value.name}}.", inputs: true, outputs: ["out"] },
  setvar: { label: "Set variable", hint: "Saves the value into an environment, collection or global variable.", inputs: true, outputs: ["out"] },
  display: { label: "Display", hint: "Shows the value on the block.", inputs: true, outputs: ["out"] },
  output: { label: "Output", hint: "The flow's result.", inputs: true, outputs: [] },
};

export type FlowLog = { at: number; blockId: string; text: string; level: "info" | "error" | "success" };
export type FlowRunState = { running: boolean; logs: FlowLog[]; values: Record<string, unknown>; active: string | null; outputs: unknown[] };

async function evalExpr(expr: string, value: unknown): Promise<unknown> {
  const script = `const value = JSON.parse(pm.variables.get("__in"));\nconst __r = (function (value) { return (${expr || "value"}); })(value);\npm.variables.set("__out", JSON.stringify(__r === undefined ? null : __r));`;
  const res = await runScript(
    script,
    {
      event: "test",
      info: { eventName: "flow", iteration: 0, iterationCount: 1, requestName: "flow", requestId: "" },
      request: { id: "", name: "flow", method: "GET", url: "", headers: [], body: null, auth: null },
      scopes: { globals: {}, collection: {}, environment: {}, data: {}, local: { __in: JSON.stringify(value ?? null) }, vault: {} },
      envName: "",
      collectionName: "",
      cookies: [],
      location: [],
      vaultEnabled: false,
      resolvedUrl: "",
    },
    { onLog: () => undefined, sendRequest: () => Promise.reject(new Error("Not available in expressions.")) },
    5000,
  );
  if (res.error) throw new Error(res.error.replace(/^Error: /, ""));
  const out = res.scopes.local.__out;
  return out === undefined ? null : JSON.parse(out);
}

export async function runFlow(flow: Flow, onState: (s: FlowRunState) => void, signal: AbortSignal): Promise<FlowRunState> {
  const store = useApi.getState();
  const state: FlowRunState = { running: true, logs: [], values: {}, active: null, outputs: [] };
  const emit = () => onState({ ...state, logs: [...state.logs], values: { ...state.values } });
  const log = (blockId: string, text: string, level: FlowLog["level"] = "info") => {
    state.logs.push({ at: Date.now(), blockId, text, level });
    emit();
  };
  const byId = new Map(flow.blocks.map((b) => [b.id, b]));
  let steps = 0;

  const fire = async (from: FlowBlock, port: string, value: unknown) => {
    for (const e of flow.edges.filter((x) => x.from === from.id && x.fromPort === port)) {
      const to = byId.get(e.to);
      if (to) await run(to, value);
    }
  };

  const run = async (b: FlowBlock, value: unknown): Promise<void> => {
    if (signal.aborted) return;
    if (++steps > 1000) throw new Error("The flow ran more than 1,000 steps and was stopped (a loop with no way out?).");
    state.active = b.id;
    state.values[b.id] = value;
    emit();
    const d = b.data;
    switch (b.type) {
      case "start":
        await fire(b, "out", d.value ? (tryJson(d.value).ok ? JSON.parse(d.value) : d.value) : {});
        return;
      case "request": {
        const col = store.ws.collections.find((c) => c.id === d.collectionId);
        const hit = col && d.itemId ? findNode(col.items, d.itemId) : null;
        if (!hit || hit.node.kind !== "request") {
          log(b.id, "Pick a saved request for this block.", "error");
          await fire(b, "fail", { error: "No request" });
          return;
        }
        const locals: Record<string, string> = {};
        if (value && typeof value === "object" && !Array.isArray(value)) for (const [k, v] of Object.entries(value)) locals[k] = typeof v === "string" ? v : JSON.stringify(v);
        const { env, commit } = useApi.getState().engineEnv({ collectionId: col!.id, itemId: hit.node.id, signal, data: locals });
        const { response } = await execute(hit.node, env);
        commit();
        const text = b64ToText(response.bodyB64);
        const j = tryJson(text);
        const out = { status: response.status, statusText: response.statusText, headers: Object.fromEntries(response.headers), body: j.ok ? j.value : text, time: Math.round(response.timings.total), tests: response.tests };
        const ok = !response.error && response.status > 0 && response.status < 400;
        log(b.id, response.error ? `${hit.node.name}: ${response.error}` : `${hit.node.name}: ${response.status} ${response.statusText} in ${Math.round(response.timings.total)} ms`, ok ? "success" : "error");
        state.values[b.id] = out;
        await fire(b, ok ? "success" : "fail", out);
        return;
      }
      case "evaluate": {
        const v = await evalExpr(d.expr, value);
        state.values[b.id] = v;
        await fire(b, "out", v);
        return;
      }
      case "condition": {
        const v = !!(await evalExpr(d.expr, value));
        log(b.id, `Condition is ${v}`);
        await fire(b, v ? "true" : "false", value);
        return;
      }
      case "foreach": {
        const list = Array.isArray(value) ? value : value && typeof value === "object" ? Object.values(value) : [];
        for (const item of list) {
          if (signal.aborted) return;
          await fire(b, "item", item);
        }
        await fire(b, "done", list);
        return;
      }
      case "delay":
        await new Promise((r) => setTimeout(r, Math.min(Number(d.ms) || 1000, 60000)));
        await fire(b, "out", value);
        return;
      case "template": {
        const text = renderTemplate(d.text ?? "", { value });
        state.values[b.id] = text;
        await fire(b, "out", text);
        return;
      }
      case "setvar": {
        const key = d.key?.trim();
        if (!key) {
          log(b.id, "Name the variable to set.", "error");
          return;
        }
        const v = typeof value === "string" ? value : JSON.stringify(value);
        const { env, commit } = useApi.getState().engineEnv({ collectionId: d.collectionId || undefined });
        const scope = (d.scope as "environment" | "globals" | "collection") || "environment";
        env.scopes[scope][key] = v;
        commit();
        log(b.id, `Set ${scope} variable ${key}`);
        await fire(b, "out", value);
        return;
      }
      case "display":
        await fire(b, "out", value);
        return;
      case "output":
        state.outputs.push(value);
        log(b.id, "Output received", "success");
        return;
    }
  };

  try {
    const starts = flow.blocks.filter((b) => b.type === "start");
    if (!starts.length) throw new Error("Add a Start block.");
    for (const s of starts) await run(s, {});
    log(starts[0].id, signal.aborted ? "Flow stopped." : "Flow finished.", signal.aborted ? "error" : "success");
  } catch (e) {
    log(state.active ?? "", (e as Error).message, "error");
  }
  state.running = false;
  state.active = null;
  emit();
  return state;
}
