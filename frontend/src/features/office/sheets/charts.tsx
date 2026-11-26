"use client";

import { useEffect, useRef, useState } from "react";
import type { ECharts } from "echarts";
import { Download, Pencil, Trash2 } from "lucide-react";
import { isError, type Scalar } from "./formula";
import { key, parseRangeText, type ChartSpec, type Computed, type Sheet } from "./model";

/** Series and categories from a chart's range: first row = series names, first column = categories. */
export function chartData(spec: ChartSpec, comp: Computed) {
  const g = parseRangeText(spec.range);
  if (!g) return null;
  const val = (r: number, c: number): Scalar => comp.values.get(key(r, c)) ?? null;
  const num = (v: Scalar) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v)) ? Number(v) : null);
  const firstColText = (() => {
    for (let r = g.r1 + (spec.headers ? 1 : 0); r <= g.r2; r++) {
      const v = val(r, g.c1);
      if (v !== null && typeof v !== "number") return true;
    }
    return false;
  })();
  const useCats = g.c2 > g.c1 && firstColText;
  const dataC1 = useCats ? g.c1 + 1 : g.c1;
  const dataR1 = spec.headers ? g.r1 + 1 : g.r1;
  const categories: string[] = [];
  for (let r = dataR1; r <= g.r2; r++) {
    const v = useCats ? val(r, g.c1) : r - dataR1 + 1;
    categories.push(v === null ? "" : isError(v) ? v.code : String(v));
  }
  const series: { name: string; data: (number | null)[] }[] = [];
  for (let c = dataC1; c <= g.c2; c++) {
    const head = spec.headers ? val(g.r1, c) : null;
    const data: (number | null)[] = [];
    for (let r = dataR1; r <= g.r2; r++) data.push(num(val(r, c)));
    series.push({ name: head === null ? `Series ${series.length + 1}` : String(head), data });
  }
  return { categories, series };
}

const COLORS = ["#4472c4", "#ed7d31", "#a5a5a5", "#ffc000", "#5b9bd5", "#70ad47", "#264478", "#9e480e", "#636363", "#997300"];

export function chartOption(spec: ChartSpec, comp: Computed) {
  const d = chartData(spec, comp);
  if (!d) return null;
  const base = {
    color: COLORS,
    title: spec.title ? { text: spec.title, left: "center", top: 6, textStyle: { fontSize: 14, fontWeight: 600 } } : undefined,
    tooltip: { trigger: spec.type === "pie" || spec.type === "doughnut" ? "item" : "axis" },
    legend: spec.legend ? { bottom: 4, type: "scroll" } : undefined,
    grid: { left: 48, right: 18, top: spec.title ? 40 : 18, bottom: spec.legend ? 44 : 28, containLabel: true },
    animation: false,
  };
  if (spec.type === "pie" || spec.type === "doughnut") {
    const s = d.series[0];
    return {
      ...base,
      series: [
        {
          type: "pie",
          radius: spec.type === "doughnut" ? ["42%", "68%"] : "68%",
          center: ["50%", spec.legend ? "48%" : "54%"],
          data: d.categories.map((name, i) => ({ name, value: s?.data[i] ?? 0 })),
          label: { formatter: "{b}: {d}%" },
        },
      ],
    };
  }
  if (spec.type === "radar") {
    const max = Math.max(1, ...d.series.flatMap((s) => s.data.map((v) => v ?? 0)));
    return { ...base, radar: { indicator: d.categories.map((n) => ({ name: n, max })) }, series: [{ type: "radar", data: d.series.map((s) => ({ name: s.name, value: s.data.map((v) => v ?? 0) })) }] };
  }
  if (spec.type === "scatter") {
    const xs = d.series[0]?.data ?? [];
    return {
      ...base,
      xAxis: { type: "value", scale: true },
      yAxis: { type: "value", scale: true },
      series: d.series.slice(1).map((s) => ({ type: "scatter", name: s.name, data: s.data.map((y, i) => [xs[i], y]) })),
    };
  }
  const horizontal = spec.type === "bar";
  const cat = { type: "category", data: d.categories };
  const valAxis = { type: "value" };
  return {
    ...base,
    xAxis: horizontal ? valAxis : cat,
    yAxis: horizontal ? cat : valAxis,
    series: d.series.map((s) => ({
      type: spec.type === "area" ? "line" : spec.type === "column" ? "bar" : spec.type,
      name: s.name,
      data: s.data,
      stack: spec.stacked ? "total" : undefined,
      areaStyle: spec.type === "area" ? { opacity: 0.35 } : undefined,
      smooth: spec.type === "line" || spec.type === "area" ? 0.2 : undefined,
    })),
  };
}

/** A chart floating over the grid: drag its frame to move, the corner to resize. */
export function ChartBox({
  spec,
  comp,
  sheet,
  left,
  top,
  zoom,
  onChange,
  onEdit,
  onDelete,
}: {
  spec: ChartSpec;
  comp: Computed;
  sheet: Sheet;
  left: number;
  top: number;
  zoom: number;
  onChange: (s: ChartSpec) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<ECharts | null>(null);
  const [lib, setLib] = useState<typeof import("echarts") | null>(null);
  const [active, setActive] = useState(false);
  useEffect(() => {
    void import("echarts").then((m) => setLib(m));
  }, []);
  useEffect(() => {
    if (!lib || !ref.current) return;
    chartRef.current ??= lib.init(ref.current, undefined, { renderer: "canvas" });
    const opt = chartOption(spec, comp);
    if (opt) chartRef.current.setOption(opt as never, true);
    chartRef.current.resize();
  }, [lib, spec, comp, sheet, zoom]);
  useEffect(
    () => () => {
      chartRef.current?.dispose();
      chartRef.current = null;
    },
    [],
  );

  const drag = (e: React.PointerEvent, mode: "move" | "resize") => {
    e.preventDefault();
    e.stopPropagation();
    const sx = e.clientX;
    const sy = e.clientY;
    const start = { ...spec };
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - sx) / zoom;
      const dy = (ev.clientY - sy) / zoom;
      onChange(mode === "move" ? { ...start, x: Math.max(0, start.x + dx), y: Math.max(0, start.y + dy) } : { ...start, w: Math.max(180, start.w + dx), h: Math.max(120, start.h + dy) });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div
      className="absolute rounded-[4px] border bg-white shadow-md"
      style={{ left, top, width: spec.w * zoom, height: spec.h * zoom, borderColor: active ? "#1a7f4b" : "#d0d0d0" }}
      onPointerDown={(e) => {
        e.stopPropagation();
        setActive(true);
      }}
      onBlur={() => setActive(false)}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Delete") onDelete();
        e.stopPropagation();
      }}
    >
      <div className="absolute inset-x-0 top-0 z-10 flex h-6 cursor-move items-center justify-end gap-1 px-1 opacity-0 transition-opacity hover:opacity-100 focus-within:opacity-100" style={{ opacity: active ? 1 : undefined }} onPointerDown={(e) => drag(e, "move")}>
        <button type="button" aria-label="Edit chart" onPointerDown={(e) => e.stopPropagation()} onClick={onEdit} className="rounded bg-white/90 p-1 text-ink-2 shadow hover:text-ink">
          <Pencil className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label="Download chart as PNG"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => {
            const url = chartRef.current?.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: "#fff" });
            if (!url) return;
            const a = document.createElement("a");
            a.href = url;
            a.download = `${spec.title || "chart"}.png`;
            a.click();
          }}
          className="rounded bg-white/90 p-1 text-ink-2 shadow hover:text-ink"
        >
          <Download className="size-3.5" />
        </button>
        <button type="button" aria-label="Delete chart" onPointerDown={(e) => e.stopPropagation()} onClick={onDelete} className="rounded bg-white/90 p-1 text-ink-2 shadow hover:text-danger">
          <Trash2 className="size-3.5" />
        </button>
      </div>
      <div ref={ref} className="size-full" />
      <div className="absolute bottom-0 right-0 size-4 cursor-nwse-resize" onPointerDown={(e) => drag(e, "resize")} style={{ background: "linear-gradient(135deg, transparent 50%, #1a7f4b 50%)" }} />
    </div>
  );
}
