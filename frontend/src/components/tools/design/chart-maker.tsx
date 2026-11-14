"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { motion } from "motion/react";
import type { ECharts } from "echarts";
import {
  Activity,
  CalendarDays,
  ChartArea,
  ChartBar,
  ChartBarStacked,
  ChartCandlestick,
  ChartColumn,
  ChartColumnStacked,
  ChartLine,
  ChartNoAxesCombined,
  ChartPie,
  ChartScatter,
  ChartSpline,
  CircleDashed,
  ClipboardPaste,
  Copy,
  Donut,
  Download,
  FolderOpen,
  Funnel,
  Gauge,
  Grid3x3,
  LayoutGrid,
  Network,
  Plus,
  Radar,
  RotateCcw,
  Save,
  Sun,
  Table2,
  Trash2,
  Waves,
  type LucideIcon,
} from "lucide-react";
import { encodeGif } from "@/lib/gif";
import { saveBlob } from "@/lib/files";
import { getTool, stepsFor } from "@/lib/tools";
import {
  ASPECT,
  CHART_GROUPS,
  CHARTS,
  DEFAULT_STYLE,
  PALETTES,
  SHAPE_HELP,
  animateSvg,
  buildOption,
  chartDef,
  num,
  parseDelimited,
  parseJsonTable,
  sample,
  toCsv,
  type ChartStyle,
  type ChartType,
  type Shape,
  type Table,
} from "@/lib/charts";
import { cn } from "@/lib/utils";
import { Workbench } from "../workbench";
import { Chips, Notice, Panel, Row, Slider, TextField, Toggle } from "../pdf/kit";

const STORE = "dw-chart-maker-v1";
const ICON: Record<ChartType, LucideIcon> = {
  column: ChartColumn, bar: ChartBar, line: ChartLine, area: ChartArea, pie: ChartPie, doughnut: Donut,
  stackedColumn: ChartColumnStacked, stackedBar: ChartBarStacked, percentColumn: ChartColumnStacked, smoothLine: ChartSpline, stepLine: Activity, stackedArea: Waves,
  mixed: ChartNoAxesCombined, waterfall: ChartColumn, radar: Radar, polarBar: CircleDashed, funnel: Funnel, rose: ChartPie, halfDoughnut: Donut, gauge: Gauge,
  treemap: LayoutGrid, sunburst: Sun, scatter: ChartScatter, bubble: ChartScatter, histogram: ChartColumn, boxplot: ChartCandlestick, heatmap: Grid3x3,
  sankey: Network, candlestick: ChartCandlestick, calendar: CalendarDays,
};
const SVG_FONTS: Record<ChartStyle["font"], string> = {
  sans: "Inter, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  mono: "'SF Mono', Consolas, 'Liberation Mono', monospace",
};
const EASINGS = [
  { value: "cubicOut", label: "Smooth" },
  { value: "backOut", label: "Overshoot" },
  { value: "bounceOut", label: "Bounce" },
  { value: "elasticOut", label: "Elastic" },
  { value: "linear", label: "Linear" },
];

type Saved = { type: ChartType; tables: Partial<Record<Shape, Table>>; style: ChartStyle };

function load(): Saved {
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) {
      const d = JSON.parse(raw) as Saved;
      if (d && CHARTS.some((c) => c.id === d.type)) return { type: d.type, tables: d.tables ?? {}, style: { ...DEFAULT_STYLE, ...d.style } };
    }
  } catch {
    /* storage blocked or old data: start fresh */
  }
  return { type: "column", tables: {}, style: DEFAULT_STYLE };
}

const noop = () => () => {};

export function ChartMaker({ toolId }: { toolId: string }) {
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  const tool = getTool(toolId)!;
  return (
    <Workbench steps={stepsFor(tool)} current={1} footer="Made in your browser. Your data never leaves this device; it's kept in this browser so you can come back to it.">
      {mounted ? <Editor /> : <div className="m-4 aspect-video animate-pulse rounded-md bg-paper-2" />}
    </Workbench>
  );
}

function Editor() {
  const [state, setState] = useState<Saved>(load);
  const { type, style } = state;
  const def = chartDef(type);
  const table = state.tables[def.shape] ?? sample(def.shape);
  const [tab, setTab] = useState<"style" | "labels" | "motion" | "export">("style");
  const [lib, setLib] = useState<typeof import("echarts") | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [loop, setLoop] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<ECharts | null>(null);
  const [fonts, setFonts] = useState<Record<ChartStyle["font"], string> | null>(null);

  const set = (patch: Partial<ChartStyle>) => setState((s) => ({ ...s, style: { ...s.style, ...patch } }));
  const setTable = (t: Table) => setState((s) => ({ ...s, tables: { ...s.tables, [def.shape]: t } }));

  // Keep it in this browser.
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(STORE, JSON.stringify(state));
      } catch {
        /* full or blocked */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [state]);

  useEffect(() => {
    void import("echarts").then((m) => setLib(m));
    // The page's own fonts, by their real (hashed) family names, for the canvas.
    const probe = (cls: string) => {
      const el = document.createElement("span");
      el.className = cls;
      document.body.appendChild(el);
      const f = getComputedStyle(el).fontFamily;
      el.remove();
      return f;
    };
    queueMicrotask(() => setFonts({ sans: probe("font-sans"), serif: probe("font-serif"), mono: probe("font-mono") }));
  }, []);

  const built = useMemo(() => {
    try {
      return { option: buildOption(type, table, style, { fontFamily: fonts?.[style.font] }), error: null as string | null };
    } catch (e) {
      return { option: null, error: (e as Error).message };
    }
  }, [type, table, style, fonts]);

  useEffect(() => {
    if (!lib || !box.current) return;
    const c = lib.init(box.current, undefined, { renderer: "canvas" });
    chart.current = c;
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(box.current);
    return () => {
      ro.disconnect();
      c.dispose();
      chart.current = null;
    };
  }, [lib]);
  useEffect(() => {
    if (chart.current && built.option) chart.current.setOption(built.option, { notMerge: true });
  }, [built, lib]);

  const replay = () => {
    const c = chart.current;
    if (!c || !built.option) return;
    c.clear();
    c.setOption(built.option, { notMerge: true });
  };
  const runMs = style.animDuration + style.stagger * Math.min(40, table.rows.length) + 300;
  useEffect(() => {
    if (!loop || !style.anim) return;
    const t = setInterval(replay, runMs + 1800);
    return () => clearInterval(t);
  });

  const switchType = (t: ChartType) => setState((s) => ({ ...s, type: t }));

  /* ---------- Export ---------- */
  const name = (style.title || "chart").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "chart";
  const [width, setWidth] = useState(1600);
  const exportBg = style.bg === "transparent" ? "transparent" : (built.option?.backgroundColor as string);
  const flash = (msg: string) => {
    setNote(msg);
    setTimeout(() => setNote(null), 2500);
  };
  const image = (kind: "png" | "jpeg") => {
    const c = chart.current;
    if (!c) return null;
    const ratio = width / (box.current?.clientWidth || width);
    return c.getDataURL({ type: kind, pixelRatio: ratio, backgroundColor: kind === "jpeg" && exportBg === "transparent" ? "#ffffff" : exportBg });
  };
  const toBlob = async (url: string) => (await fetch(url)).blob();
  const svgString = (animated: boolean) => {
    if (!lib || !built.option) return "";
    const w = 1200;
    const h = Math.round(w / ASPECT[style.aspect]);
    const opt = buildOption(type, table, { ...style, anim: animated }, { fontFamily: SVG_FONTS[style.font], width: w });
    const c = lib.init(null as unknown as HTMLElement, undefined, { renderer: "svg", ssr: true, width: w, height: h });
    c.setOption(opt);
    const svg = c.renderToSVGString();
    c.dispose();
    return animated ? animateSvg(svg, type, style) : svg;
  };
  const html = () => {
    const svg = svgString(true).replace(/^<svg width="\d+" height="\d+"/, '<svg style="width:100%;height:auto;max-width:1200px"');
    const bg = exportBg === "transparent" ? "#ffffff" : exportBg;
    const title = (style.title || "Chart").replace(/[<>&]/g, "");
    return `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${title}</title>\n<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:${bg};padding:16px;box-sizing:border-box}</style>\n</head>\n<body>\n${svg}\n</body>\n</html>\n`;
  };
  const capture = async (kind: "gif" | "webm") => {
    const c = chart.current;
    const canvas = box.current?.querySelector("canvas");
    if (!c || !canvas) return;
    if (!style.anim) return flash("Turn the animation on first (Animation tab).");
    setBusy(kind === "gif" ? "Recording the GIF…" : "Recording the video…");
    try {
      if (kind === "webm") {
        const stream = canvas.captureStream(30);
        const type = ["video/webm;codecs=vp9", "video/webm"].find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
        const rec = new MediaRecorder(stream, type ? { mimeType: type, videoBitsPerSecond: 6_000_000 } : undefined);
        const chunks: Blob[] = [];
        rec.ondataavailable = (e) => chunks.push(e.data);
        const done = new Promise((r) => (rec.onstop = r));
        rec.start();
        replay();
        await new Promise((r) => setTimeout(r, runMs + 1500));
        rec.stop();
        await done;
        saveBlob(new Blob(chunks, { type: "video/webm" }), `${name}.webm`);
      } else {
        const w = Math.min(800, canvas.width);
        const h = Math.round((w * canvas.height) / canvas.width);
        const off = document.createElement("canvas");
        off.width = w;
        off.height = h;
        const g = off.getContext("2d", { willReadFrequently: true })!;
        const frames: { rgba: Uint8ClampedArray; delay: number }[] = [];
        replay();
        const t0 = performance.now();
        const step = 60;
        while (performance.now() - t0 < Math.min(runMs, 6000)) {
          await new Promise((r) => setTimeout(r, step));
          g.fillStyle = exportBg === "transparent" ? "#ffffff" : exportBg;
          g.fillRect(0, 0, w, h);
          g.drawImage(canvas, 0, 0, w, h);
          frames.push({ rgba: g.getImageData(0, 0, w, h).data, delay: step });
        }
        g.drawImage(canvas, 0, 0, w, h);
        frames.push({ rgba: g.getImageData(0, 0, w, h).data, delay: 2500 });
        setBusy("Making the GIF…");
        saveBlob(await encodeGif(w, h, frames), `${name}.gif`);
      }
    } catch {
      flash("This browser couldn't record the animation.");
    } finally {
      setBusy(null);
    }
  };
  const copyImage = async () => {
    const url = image("png");
    if (!url) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": toBlob(url) })]);
      flash("Image copied. Paste it into a doc, slide or chat.");
    } catch {
      flash("Copying images isn't allowed here; download the PNG instead.");
    }
  };
  const openProject = useRef<HTMLInputElement>(null);
  const loadProject = async (f: File) => {
    try {
      const d = JSON.parse(await f.text());
      if (d?.app !== "do-whatever-chart" || !CHARTS.some((c) => c.id === d.type)) throw new Error();
      setState({ type: d.type, tables: d.tables ?? {}, style: { ...DEFAULT_STYLE, ...d.style } });
      flash("Project opened.");
    } catch {
      flash("That isn't a chart project saved from here.");
    }
  };

  const isCategory = def.shape === "category";
  const pieLike = ["pie", "doughnut", "rose", "halfDoughnut", "funnel"].includes(type);
  const axisLike = !pieLike && !["radar", "polarBar", "gauge", "treemap", "sunburst", "sankey", "calendar"].includes(type);
  const lineLike = ["line", "area", "smoothLine", "stepLine", "stackedArea", "mixed", "radar", "scatter"].includes(type);
  const barLike = ["column", "bar", "stackedColumn", "stackedBar", "percentColumn", "mixed", "waterfall", "polarBar", "histogram", "boxplot", "heatmap", "treemap", "sunburst", "pie", "doughnut", "halfDoughnut", "rose"].includes(type);
  const series = isCategory ? table.columns.slice(1) : def.shape === "xy" ? table.columns.slice(1) : def.shape === "values" ? table.columns : [];

  return (
    <div className="grid gap-4 p-3 sm:p-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-5">
      <div className="grid min-w-0 content-start gap-4">
        {/* Chart types */}
        <div className="grid gap-2">
          {CHART_GROUPS.map((g) => (
            <div key={g} className="flex flex-wrap items-center gap-1.5">
              <span className="label-mono w-24 shrink-0 text-ink-3">{g}</span>
              {CHARTS.filter((c) => c.group === g).map((c) => {
                const Icon = ICON[c.id];
                const on = c.id === type;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => switchType(c.id)}
                    title={c.hint}
                    aria-pressed={on}
                    className={cn("relative inline-flex h-8 items-center gap-1.5 rounded-[8px] px-2.5 text-[13px] transition-colors", on ? "text-paper" : "bg-paper-2 text-ink-2 hover:text-ink")}
                  >
                    {on && <motion.span layoutId="chart-type" className="absolute inset-0 rounded-[8px] bg-ink" transition={{ type: "spring", bounce: 0.2, duration: 0.4 }} />}
                    <Icon aria-hidden className="relative size-3.5" />
                    <span className="relative">{c.name}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* Preview */}
        <div className="grid gap-2">
          <div className="relative overflow-hidden rounded-md border border-line bg-[repeating-conic-gradient(var(--color-paper-2)_0%_25%,var(--color-surface)_0%_50%)] bg-[length:16px_16px]">
            <div ref={box} role="img" aria-label={`${def.name} chart: ${style.title}`} className="mx-auto w-full" style={{ aspectRatio: ASPECT[style.aspect], maxHeight: style.aspect === "9:16" ? 640 : undefined, maxWidth: style.aspect === "9:16" ? 360 : undefined }} />
            {(!lib || built.error) && (
              <div className="absolute inset-0 grid place-items-center bg-surface/80 p-6 text-center">
                {built.error ? <p className="max-w-sm text-sm text-warning">{built.error}</p> : <p className="text-sm text-ink-3">Loading the chart engine…</p>}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={replay} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line bg-surface px-3 text-sm text-ink hover:border-ink-3">
              <RotateCcw aria-hidden className="size-3.5" /> Replay animation
            </button>
            <button type="button" onClick={() => saveBlob(dataUrlToBlob(image("png")), `${name}.png`)} disabled={!built.option} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-ink px-3 text-sm font-medium text-paper hover:opacity-90 disabled:opacity-40">
              <Download aria-hidden className="size-3.5" /> PNG
            </button>
            <button type="button" onClick={copyImage} disabled={!built.option} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line bg-surface px-3 text-sm text-ink hover:border-ink-3 disabled:opacity-40">
              <Copy aria-hidden className="size-3.5" /> Copy image
            </button>
            <button type="button" onClick={() => setTab("export")} className="text-sm text-ink-2 underline-offset-4 hover:text-ink hover:underline">
              More: SVG, GIF, video, HTML…
            </button>
            {busy && <span className="font-mono text-[12px] text-accent">{busy}</span>}
            {note && <span className="text-[13px] text-success">{note}</span>}
          </div>
        </div>

        <DataEditor table={table} shape={def.shape} onChange={setTable} onReset={() => setTable(sample(def.shape))} chartName={def.name} />
      </div>

      {/* Settings */}
      <aside className="grid min-w-0 content-start gap-3 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:pr-1" data-lenis-prevent>
        <div role="tablist" aria-label="Settings" className="grid grid-cols-4 gap-1 rounded-md bg-paper-2 p-1">
          {(["style", "labels", "motion", "export"] as const).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cn("h-8 rounded-[6px] text-[13px] transition-colors", tab === k ? "bg-surface font-medium text-ink shadow-sm" : "text-ink-2 hover:text-ink")}>
              {{ style: "Style", labels: "Labels", motion: "Animation", export: "Export" }[k]}
            </button>
          ))}
        </div>

        {tab === "style" && (
          <Panel>
            <Row label="Title">
              <div className="grid gap-2">
                <TextField label="Title" value={style.title} onChange={(v) => set({ title: v })} placeholder="Chart title" />
                <TextField label="Subtitle" value={style.subtitle} onChange={(v) => set({ subtitle: v })} placeholder="Subtitle or source (optional)" />
                <Chips value={style.titleAlign} options={[{ value: "left", label: "Left" }, { value: "center", label: "Centre" }]} onChange={(v) => set({ titleAlign: v })} label="Title alignment" />
              </div>
            </Row>
            <Row label="Colours">
              <div className="grid gap-1.5">
                {Object.entries(PALETTES).map(([id, p]) => (
                  <button key={id} type="button" onClick={() => set({ palette: id, colors: [] })} aria-pressed={style.palette === id} className={cn("flex items-center gap-2 rounded-[8px] px-1.5 py-1 text-left text-[13px]", style.palette === id ? "bg-paper-2 text-ink" : "text-ink-2 hover:bg-paper-2")}>
                    <span className="flex overflow-hidden rounded-sm">
                      {p.colors.slice(0, 6).map((c) => (
                        <span key={c} className="h-4 w-4" style={{ background: c }} />
                      ))}
                    </span>
                    {p.name}
                  </button>
                ))}
              </div>
            </Row>
            {series.length > 0 && (
              <Row label="Each series">
                <div className="grid gap-1.5">
                  {series.slice(0, 8).map((n, i) => {
                    const c = style.colors[i] || PALETTES[style.palette].colors[i % 8];
                    return (
                      <label key={i} className="flex items-center gap-2 text-[13px] text-ink-2">
                        <input type="color" value={c} onChange={(e) => set({ colors: Object.assign([...style.colors], { [i]: e.target.value }) })} className="h-7 w-9 cursor-pointer rounded-sm border border-line bg-transparent" aria-label={`Colour of ${n}`} />
                        <span className="truncate">{n || `Series ${i + 1}`}</span>
                      </label>
                    );
                  })}
                </div>
              </Row>
            )}
            <Row label="Theme">
              <div className="grid gap-2">
                <Chips value={style.dark ? "dark" : "light"} options={[{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} onChange={(v) => set({ dark: v === "dark" })} label="Theme" />
                <Chips value={style.bg} options={[{ value: "theme", label: "Solid" }, { value: "transparent", label: "Transparent" }, { value: "custom", label: "Custom" }]} onChange={(v) => set({ bg: v })} label="Background" />
                {style.bg === "custom" && <input type="color" value={style.bgColor} onChange={(e) => set({ bgColor: e.target.value })} aria-label="Background colour" className="h-8 w-14 rounded-sm border border-line" />}
              </div>
            </Row>
            <Row label="Text">
              <div className="grid gap-2">
                <Chips value={style.font} options={[{ value: "sans", label: "Sans" }, { value: "serif", label: "Serif" }, { value: "mono", label: "Mono" }]} onChange={(v) => set({ font: v })} label="Font" />
                <Slider label="Text size" value={Math.round(style.fontScale * 100)} min={70} max={160} step={5} onChange={(v) => set({ fontScale: v / 100 })} format={(v) => `${v}%`} />
              </div>
            </Row>
            <Row label="Shape">
              <Chips value={style.aspect} options={(["16:9", "4:3", "1:1", "9:16", "3:1"] as const).map((a) => ({ value: a, label: a === "9:16" ? "9:16 story" : a }))} onChange={(v) => set({ aspect: v })} label="Aspect ratio" />
            </Row>
          </Panel>
        )}

        {tab === "labels" && (
          <Panel>
            <Row label="Legend">
              <Chips value={style.legend} options={(["top", "bottom", "left", "right", "none"] as const).map((v) => ({ value: v, label: v === "none" ? "Off" : v[0].toUpperCase() + v.slice(1) }))} onChange={(v) => set({ legend: v })} label="Legend" />
            </Row>
            <Row label="Values">
              <div className="grid gap-2">
                <Toggle checked={style.labels} onChange={(v) => set({ labels: v })} label="Show values on the chart" />
                {pieLike && <Toggle checked={style.showPercent} onChange={(v) => set({ showPercent: v })} label="As percentages" />}
                <Chips value={style.decimals} options={[{ value: -1, label: "Auto" }, { value: 0, label: "0" }, { value: 1, label: "0.0" }, { value: 2, label: "0.00" }]} onChange={(v) => set({ decimals: v })} label="Decimals" />
                <div className="grid grid-cols-2 gap-2">
                  <TextField label="Before (₹, $)" value={style.prefix} onChange={(v) => set({ prefix: v.slice(0, 6) })} placeholder="₹" />
                  <TextField label="After (%, kg)" value={style.suffix} onChange={(v) => set({ suffix: v.slice(0, 8) })} placeholder="%" />
                </div>
                <Toggle checked={style.compact} onChange={(v) => set({ compact: v })} label="Short numbers (1.2K, 3.4M)" />
              </div>
            </Row>
            {axisLike && (
              <Row label="Axes">
                <div className="grid gap-2">
                  <TextField label="X axis title" value={style.xTitle} onChange={(v) => set({ xTitle: v })} />
                  <TextField label="Y axis title" value={style.yTitle} onChange={(v) => set({ yTitle: v })} />
                  <Toggle checked={style.grid} onChange={(v) => set({ grid: v })} label="Gridlines" />
                  <div className="grid grid-cols-2 gap-2">
                    <TextField label="Y from" value={style.yMin} onChange={(v) => set({ yMin: v })} placeholder="auto" mono inputMode="decimal" />
                    <TextField label="Y to" value={style.yMax} onChange={(v) => set({ yMax: v })} placeholder="auto" mono inputMode="decimal" />
                  </div>
                  <Toggle checked={style.log} onChange={(v) => set({ log: v })} label="Log scale" description="For values that span 10× and more." />
                </div>
              </Row>
            )}
            {(isCategory || type === "sunburst") && (
              <Row label="Order">
                <Chips value={style.sort} options={[{ value: "none", label: "As typed" }, { value: "desc", label: "Largest first" }, { value: "asc", label: "Smallest first" }]} onChange={(v) => set({ sort: v })} label="Sort" />
              </Row>
            )}
            {lineLike && (
              <Row label="Lines">
                <div className="grid gap-2">
                  <Slider label={type === "scatter" ? "Dot size" : "Line width"} value={style.lineWidth} min={1} max={8} onChange={(v) => set({ lineWidth: v })} format={(v) => `${v}px`} />
                  {type !== "scatter" && <Toggle checked={style.points} onChange={(v) => set({ points: v })} label="Dots on the points" />}
                  {["area", "stackedArea", "radar"].includes(type) && <Slider label="Fill" value={style.areaOpacity} min={0} max={90} onChange={(v) => set({ areaOpacity: v })} format={(v) => `${v}%`} />}
                </div>
              </Row>
            )}
            {barLike && (
              <Row label="Shapes">
                <div className="grid gap-2">
                  <Slider label="Corner rounding" value={style.radius} min={0} max={20} onChange={(v) => set({ radius: v })} format={(v) => `${v}px`} />
                  {!pieLike && !["treemap", "sunburst", "heatmap"].includes(type) && <Slider label="Bar width" value={style.barWidth} min={10} max={100} step={5} onChange={(v) => set({ barWidth: v })} format={(v) => `${v}%`} />}
                  {(type === "doughnut" || type === "halfDoughnut") && <Slider label="Hole size" value={style.inner} min={10} max={85} onChange={(v) => set({ inner: v })} format={(v) => `${v}%`} />}
                </div>
              </Row>
            )}
            {type === "gauge" && (
              <Row label="Gauge">
                <TextField label="Maximum" value={style.gaugeMax} onChange={(v) => set({ gaugeMax: v })} placeholder="auto" mono inputMode="decimal" />
              </Row>
            )}
            {type === "histogram" && (
              <Row label="Bins">
                <Slider label="Number of bins" value={style.bins} min={0} max={40} onChange={(v) => set({ bins: v })} format={(v) => (v ? `${v}` : "auto")} />
              </Row>
            )}
          </Panel>
        )}

        {tab === "motion" && (
          <Panel>
            <Row label="Animation">
              <Toggle checked={style.anim} onChange={(v) => set({ anim: v })} label="Animate the chart" description="Bars grow, lines draw, slices sweep in." />
            </Row>
            {style.anim && (
              <>
                <Row label="Style">
                  <Chips value={style.easing} options={EASINGS} onChange={(v) => set({ easing: v })} label="Easing" />
                </Row>
                <Row label="Timing">
                  <div className="grid gap-2">
                    <Slider label="Duration" value={style.animDuration} min={200} max={4000} step={100} onChange={(v) => set({ animDuration: v })} format={(v) => `${(v / 1000).toFixed(1)} s`} />
                    <Slider label="One after another" value={style.stagger} min={0} max={300} step={10} onChange={(v) => set({ stagger: v })} format={(v) => (v ? `${v} ms apart` : "all at once")} />
                  </div>
                </Row>
                <Row label="Play">
                  <div className="grid gap-2">
                    <button type="button" onClick={replay} className="inline-flex h-9 w-fit items-center gap-1.5 rounded-md bg-ink px-3 text-sm font-medium text-paper hover:opacity-90">
                      <RotateCcw aria-hidden className="size-3.5" /> Replay
                    </button>
                    <Toggle checked={loop} onChange={setLoop} label="Loop it here" description="Handy for presenting on screen." />
                  </div>
                </Row>
              </>
            )}
          </Panel>
        )}

        {tab === "export" && (
          <Panel>
            <Row label="Picture">
              <div className="grid gap-2">
                <Chips value={width} options={[1200, 1600, 2400, 3840].map((w) => ({ value: w, label: w === 3840 ? "4K" : `${w}px` }))} onChange={setWidth} label="Width" />
                <div className="flex flex-wrap gap-1.5">
                  <ExportButton onClick={() => saveBlob(dataUrlToBlob(image("png")), `${name}.png`)}>PNG</ExportButton>
                  <ExportButton onClick={() => saveBlob(dataUrlToBlob(image("jpeg")), `${name}.jpg`)}>JPG</ExportButton>
                  <ExportButton onClick={() => saveBlob(new Blob([svgString(false)], { type: "image/svg+xml" }), `${name}.svg`)}>SVG</ExportButton>
                  <ExportButton onClick={copyImage}>Copy image</ExportButton>
                </div>
              </div>
            </Row>
            <Row label="Animated">
              <div className="grid gap-2">
                <div className="flex flex-wrap gap-1.5">
                  <ExportButton onClick={() => void capture("gif")} disabled={!!busy}>GIF</ExportButton>
                  <ExportButton onClick={() => void capture("webm")} disabled={!!busy || typeof MediaRecorder === "undefined"}>Video (WebM)</ExportButton>
                  <ExportButton onClick={() => saveBlob(new Blob([svgString(true)], { type: "image/svg+xml" }), `${name}-animated.svg`)}>Animated SVG</ExportButton>
                  <ExportButton onClick={() => saveBlob(new Blob([html()], { type: "text/html" }), `${name}.html`)}>Web page</ExportButton>
                </div>
                <p className="text-xs text-ink-3">The SVG and web page animate wherever they&apos;re opened, with no scripts. GIFs work in chats and email.</p>
                <ExportButton
                  onClick={async () => {
                    await navigator.clipboard.writeText(svgString(true));
                    flash("SVG code copied: paste it into any web page.");
                  }}
                >
                  Copy embed code
                </ExportButton>
              </div>
            </Row>
            <Row label="Project">
              <div className="flex flex-wrap gap-1.5">
                <ExportButton onClick={() => saveBlob(new Blob([JSON.stringify({ app: "do-whatever-chart", v: 1, ...state }, null, 2)], { type: "application/json" }), `${name}.chart.json`)}>
                  <Save aria-hidden className="size-3.5" /> Save project
                </ExportButton>
                <ExportButton onClick={() => openProject.current?.click()}>
                  <FolderOpen aria-hidden className="size-3.5" /> Open project
                </ExportButton>
                <ExportButton onClick={() => saveBlob(new Blob([toCsv(table)], { type: "text/csv" }), `${name}.csv`)}>Data as CSV</ExportButton>
                <input ref={openProject} type="file" accept=".json,application/json" className="sr-only" onChange={(e) => (e.target.files?.[0] && void loadProject(e.target.files[0]), (e.target.value = ""))} />
              </div>
              <p className="mt-2 text-xs text-ink-3">Your chart is also kept in this browser automatically.</p>
            </Row>
          </Panel>
        )}
      </aside>
    </div>
  );
}

function dataUrlToBlob(url: string | null): Blob {
  if (!url) return new Blob();
  const [head, b64] = url.split(",");
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: head.slice(5).split(";")[0] });
}

function ExportButton({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line bg-surface px-3 text-[13px] font-medium text-ink transition-colors hover:border-ink-3 disabled:opacity-40">
      {children}
    </button>
  );
}

/* ---------- Data ---------- */

const MAX_GRID_ROWS = 500;

function DataEditor({ table, shape, onChange, onReset, chartName }: { table: Table; shape: Shape; onChange: (t: Table) => void; onReset: () => void; chartName: string }) {
  const [mode, setMode] = useState<"grid" | "text">("grid");
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const numericCol = (i: number) => (shape === "category" || shape === "xy" ? i > 0 : shape === "bubble" ? i > 0 : shape === "values" ? true : shape === "flow" ? i === 2 : shape === "path" || shape === "calendar" ? i === 1 : shape === "ohlc" ? i > 0 : false);
  const bad = table.rows.reduce((n, r) => n + r.filter((c, i) => numericCol(i) && c.trim() !== "" && !Number.isFinite(num(c))).length, 0);

  const setCell = (ri: number, ci: number, v: string) => onChange({ ...table, rows: table.rows.map((r, i) => (i === ri ? r.map((c, j) => (j === ci ? v : c)) : r)) });
  const setHead = (ci: number, v: string) => onChange({ ...table, columns: table.columns.map((c, j) => (j === ci ? v : c)) });
  // Paste a block from Excel, Sheets or a CSV into the grid, starting at this cell.
  const paste = (ri: number, ci: number, e: React.ClipboardEvent) => {
    const t = e.clipboardData.getData("text/plain");
    if (!/[\t\n]/.test(t.trim())) return;
    e.preventDefault();
    const block = t.replace(/\r/g, "").replace(/\n$/, "").split("\n").map((l) => l.split("\t"));
    const width = Math.max(table.columns.length, ci + Math.max(...block.map((b) => b.length)));
    const columns = [...table.columns, ...Array.from({ length: width - table.columns.length }, (_, k) => `Column ${table.columns.length + k + 1}`)];
    const rows = table.rows.map((r) => [...r, ...Array(width - r.length).fill("")]);
    block.forEach((b, i) => {
      const r = ri + i;
      while (rows.length <= r) rows.push(Array(width).fill(""));
      b.forEach((v, j) => (rows[r][ci + j] = v.trim()));
    });
    onChange({ columns, rows });
  };
  const importText = (t: string, json = false) => {
    try {
      const parsed = json || /^\s*[[{]/.test(t) ? parseJsonTable(t) : parseDelimited(t);
      if (!parsed.rows.length) throw new Error("No rows found.");
      onChange(parsed);
      setErr(null);
      return true;
    } catch (e) {
      setErr((e as Error).message || "That couldn't be read.");
      return false;
    }
  };

  return (
    <section aria-label="Data" className="grid gap-2 rounded-md border border-line bg-paper p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          <Table2 aria-hidden className="size-4" /> Your data
        </h3>
        <Chips value={mode} options={[{ value: "grid", label: "Table" }, { value: "text", label: "Paste as text" }]} onChange={(m) => (setMode(m), m === "text" && setText(toCsv(table)))} label="Edit as" />
        <div className="ml-auto flex flex-wrap gap-1.5">
          <button type="button" onClick={() => file.current?.click()} className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-line bg-surface px-2.5 text-[13px] text-ink hover:border-ink-3">
            <FolderOpen aria-hidden className="size-3.5" /> Import CSV / JSON
          </button>
          <button type="button" onClick={onReset} className="inline-flex h-8 items-center gap-1.5 rounded-[8px] px-2.5 text-[13px] text-ink-2 hover:bg-paper-2 hover:text-ink">
            Sample data
          </button>
        </div>
        <input ref={file} type="file" accept=".csv,.tsv,.txt,.json,text/csv,application/json" className="sr-only" onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) importText(await f.text(), f.name.endsWith(".json"));
        }} />
      </div>
      <p className="text-xs text-ink-3">
        {chartName}: {SHAPE_HELP[shape]} Copy cells from Excel or Google Sheets and paste them into any cell.
      </p>
      {err && <Notice tone="warning">{err}</Notice>}
      {bad > 0 && <p className="text-xs text-warning">{bad} cell{bad === 1 ? "" : "s"} should be a number (marked in orange). They&apos;re left out of the chart.</p>}

      {mode === "text" ? (
        <div className="grid gap-2">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={10} spellCheck={false} aria-label="Data as CSV or tab-separated text" className="w-full rounded-md border border-line bg-surface px-3 py-2 font-mono text-[13px] text-ink outline-none focus:border-ink" />
          <button type="button" onClick={() => importText(text) && setMode("grid")} className="inline-flex h-9 w-fit items-center gap-1.5 rounded-md bg-ink px-3 text-sm font-medium text-paper hover:opacity-90">
            <ClipboardPaste aria-hidden className="size-3.5" /> Use this data
          </button>
        </div>
      ) : (
        <div className="max-h-[420px] overflow-auto rounded-md border border-line bg-surface" data-lenis-prevent>
          <table className="w-full border-collapse text-[13px]">
            <thead className="sticky top-0 z-10 bg-paper-2">
              <tr>
                <th className="w-8" />
                {table.columns.map((c, ci) => (
                  <th key={ci} className="min-w-28 border-l border-line p-0">
                    <div className="flex items-center">
                      <input value={c} onChange={(e) => setHead(ci, e.target.value)} aria-label={`Column ${ci + 1} name`} className="h-9 w-full min-w-0 bg-transparent px-2 font-semibold text-ink outline-none focus:bg-surface" />
                      {table.columns.length > 2 && (
                        <button type="button" onClick={() => onChange({ columns: table.columns.filter((_, j) => j !== ci), rows: table.rows.map((r) => r.filter((_, j) => j !== ci)) })} aria-label={`Delete column ${c}`} className="mr-1 inline-flex size-6 shrink-0 items-center justify-center rounded-[6px] text-ink-3 hover:bg-paper hover:text-danger">
                          <Trash2 aria-hidden className="size-3" />
                        </button>
                      )}
                    </div>
                  </th>
                ))}
                <th className="w-10 border-l border-line">
                  <button type="button" onClick={() => onChange({ columns: [...table.columns, `Series ${table.columns.length}`], rows: table.rows.map((r) => [...r, ""]) })} aria-label="Add a column" className="inline-flex size-8 items-center justify-center rounded-[6px] text-ink-2 hover:bg-paper hover:text-ink">
                    <Plus aria-hidden className="size-4" />
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {table.rows.slice(0, MAX_GRID_ROWS).map((r, ri) => (
                <tr key={ri} className="border-t border-line">
                  <td className="text-center font-mono text-[11px] text-ink-3">{ri + 1}</td>
                  {table.columns.map((_, ci) => {
                    const v = r[ci] ?? "";
                    const wrong = numericCol(ci) && v.trim() !== "" && !Number.isFinite(num(v));
                    return (
                      <td key={ci} className="border-l border-line p-0">
                        <input
                          value={v}
                          onChange={(e) => setCell(ri, ci, e.target.value)}
                          onPaste={(e) => paste(ri, ci, e)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              if (ri === table.rows.length - 1) onChange({ ...table, rows: [...table.rows, Array(table.columns.length).fill("")] });
                              requestAnimationFrame(() => (e.currentTarget?.closest("tbody")?.children[ri + 1]?.children[ci + 1]?.querySelector("input") as HTMLInputElement | null)?.focus());
                            }
                          }}
                          aria-label={`Row ${ri + 1}, ${table.columns[ci]}`}
                          inputMode={numericCol(ci) ? "decimal" : undefined}
                          className={cn("h-9 w-full min-w-0 bg-transparent px-2 text-ink outline-none focus:bg-paper", numericCol(ci) && "text-right font-mono", wrong && "bg-warning/10 text-warning")}
                        />
                      </td>
                    );
                  })}
                  <td className="border-l border-line text-center">
                    <button type="button" onClick={() => onChange({ ...table, rows: table.rows.filter((_, i) => i !== ri) })} aria-label={`Delete row ${ri + 1}`} className="inline-flex size-7 items-center justify-center rounded-[6px] text-ink-3 hover:bg-paper hover:text-danger">
                      <Trash2 aria-hidden className="size-3" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {table.rows.length > MAX_GRID_ROWS && <p className="border-t border-line px-3 py-2 text-xs text-ink-3">Showing the first {MAX_GRID_ROWS} of {table.rows.length} rows; all of them are charted. Use “Paste as text” to edit the rest.</p>}
        </div>
      )}
      {mode === "grid" && (
        <button type="button" onClick={() => onChange({ ...table, rows: [...table.rows, Array(table.columns.length).fill("")] })} className="inline-flex h-8 w-fit items-center gap-1.5 rounded-[8px] border border-dashed border-ink-3/60 px-2.5 text-[13px] text-ink-2 hover:border-ink hover:text-ink">
          <Plus aria-hidden className="size-3.5" /> Add a row
        </button>
      )}
    </section>
  );
}
