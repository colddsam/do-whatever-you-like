/* eslint-disable @typescript-eslint/no-explicit-any -- ECharts options are deeply polymorphic; built here, checked by ECharts. */
/**
 * The chart maker's data and charts, as plain functions: a table (rows of text cells, as typed
 * or pasted), the chart types grouped by the shape of data they need, and `buildOption`, which
 * turns a table + style into an ECharts option. No browser APIs, so it can be tested in Node.
 */

export type Table = { columns: string[]; rows: string[][] };

/** What each kind of chart reads from the table. */
export type Shape = "category" | "xy" | "bubble" | "values" | "flow" | "path" | "ohlc" | "calendar";

export type ChartType =
  | "column" | "bar" | "line" | "area" | "pie" | "doughnut"
  | "stackedColumn" | "stackedBar" | "percentColumn" | "smoothLine" | "stepLine" | "stackedArea" | "mixed" | "waterfall"
  | "radar" | "polarBar" | "funnel" | "rose" | "halfDoughnut" | "gauge"
  | "scatter" | "bubble" | "histogram" | "boxplot" | "heatmap"
  | "treemap" | "sunburst" | "sankey" | "candlestick" | "calendar";

export type ChartDef = { id: ChartType; name: string; group: string; shape: Shape; hint: string };

export const CHARTS: ChartDef[] = [
  { id: "column", name: "Column", group: "Basic", shape: "category", hint: "Compare values side by side" },
  { id: "bar", name: "Bar", group: "Basic", shape: "category", hint: "Long labels, ranked lists" },
  { id: "line", name: "Line", group: "Basic", shape: "category", hint: "Change over time" },
  { id: "area", name: "Area", group: "Basic", shape: "category", hint: "Volume over time" },
  { id: "pie", name: "Pie", group: "Basic", shape: "category", hint: "Parts of a whole (first number column)" },
  { id: "doughnut", name: "Doughnut", group: "Basic", shape: "category", hint: "A pie with room for a total" },
  { id: "stackedColumn", name: "Stacked column", group: "Compare", shape: "category", hint: "Totals and their parts" },
  { id: "stackedBar", name: "Stacked bar", group: "Compare", shape: "category", hint: "Totals and parts, sideways" },
  { id: "percentColumn", name: "100% column", group: "Compare", shape: "category", hint: "Each part's share" },
  { id: "smoothLine", name: "Smooth line", group: "Compare", shape: "category", hint: "Gentle trends" },
  { id: "stepLine", name: "Step line", group: "Compare", shape: "category", hint: "Values that jump (prices, plans)" },
  { id: "stackedArea", name: "Stacked area", group: "Compare", shape: "category", hint: "Parts adding up over time" },
  { id: "mixed", name: "Column + line", group: "Compare", shape: "category", hint: "Last column as a line on its own axis" },
  { id: "waterfall", name: "Waterfall", group: "Compare", shape: "category", hint: "Ups and downs to a total" },
  { id: "radar", name: "Radar", group: "Compare", shape: "category", hint: "Several scores at a glance" },
  { id: "polarBar", name: "Radial bar", group: "Compare", shape: "category", hint: "Bars around a circle" },
  { id: "funnel", name: "Funnel", group: "Parts", shape: "category", hint: "Steps that narrow (sales, sign-ups)" },
  { id: "rose", name: "Rose", group: "Parts", shape: "category", hint: "Pie with petals sized by value" },
  { id: "halfDoughnut", name: "Half doughnut", group: "Parts", shape: "category", hint: "A compact share chart" },
  { id: "gauge", name: "Gauge", group: "Parts", shape: "category", hint: "A dial per row (up to 4)" },
  { id: "treemap", name: "Treemap", group: "Parts", shape: "path", hint: "Nested parts as boxes" },
  { id: "sunburst", name: "Sunburst", group: "Parts", shape: "path", hint: "Nested parts as rings" },
  { id: "scatter", name: "Scatter", group: "Spread", shape: "xy", hint: "How two numbers relate" },
  { id: "bubble", name: "Bubble", group: "Spread", shape: "bubble", hint: "Two numbers and a size" },
  { id: "histogram", name: "Histogram", group: "Spread", shape: "values", hint: "How values are spread" },
  { id: "boxplot", name: "Box plot", group: "Spread", shape: "values", hint: "Median, quartiles and range" },
  { id: "heatmap", name: "Heatmap", group: "Spread", shape: "category", hint: "A grid of values by colour" },
  { id: "sankey", name: "Sankey", group: "Flow & time", shape: "flow", hint: "Where amounts flow" },
  { id: "candlestick", name: "Candlestick", group: "Flow & time", shape: "ohlc", hint: "Open, close, low, high" },
  { id: "calendar", name: "Calendar", group: "Flow & time", shape: "calendar", hint: "A value per day (GitHub-style)" },
];
export const CHART_GROUPS = ["Basic", "Compare", "Parts", "Spread", "Flow & time"];
export const chartDef = (id: ChartType) => CHARTS.find((c) => c.id === id)!;

export const SHAPE_HELP: Record<Shape, string> = {
  category: "First column: labels. Every other column: a series of numbers.",
  xy: "First column: X numbers. Every other column: a series of Y numbers.",
  bubble: "Columns: label, X, Y, size.",
  values: "Each column is a group; each cell one measurement.",
  flow: "Columns: from, to, amount. One row per flow.",
  path: "Columns: path (parts split by /) and value, e.g. Asia/India/Kolkata.",
  ohlc: "Columns: date, open, close, low, high.",
  calendar: "Columns: date (YYYY-MM-DD) and value.",
};

const days = (n: number, from = "2026-01-01") => {
  const t0 = Date.parse(from);
  return Array.from({ length: n }, (_, i) => new Date(t0 + i * 86_400_000).toISOString().slice(0, 10));
};
let seed = 11;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

export function sample(shape: Shape): Table {
  seed = 11;
  switch (shape) {
    case "category":
      return {
        columns: ["Month", "Sales", "Costs", "Profit"],
        rows: [["Jan", "120", "80", "40"], ["Feb", "135", "85", "50"], ["Mar", "160", "90", "70"], ["Apr", "150", "95", "55"], ["May", "180", "100", "80"], ["Jun", "210", "110", "100"]],
      };
    case "xy":
      return { columns: ["Hours studied", "Score (class A)", "Score (class B)"], rows: Array.from({ length: 14 }, (_, i) => [String(i + 1), String(Math.round(40 + i * 4 + rnd() * 10)), String(Math.round(35 + i * 3.5 + rnd() * 14))]) };
    case "bubble":
      return {
        columns: ["Country", "GDP per person ($k)", "Life expectancy", "Population (M)"],
        rows: [["India", "2.6", "70", "1430"], ["China", "12.6", "78", "1410"], ["USA", "80", "77", "335"], ["Brazil", "10.4", "75", "216"], ["Japan", "34", "84", "124"], ["Germany", "52", "81", "84"], ["Nigeria", "1.6", "54", "224"], ["UK", "49", "81", "68"]],
      };
    case "values":
      return { columns: ["Team A", "Team B", "Team C"], rows: Array.from({ length: 24 }, () => [String(Math.round(50 + rnd() * 30)), String(Math.round(40 + rnd() * 45)), String(Math.round(60 + rnd() * 20))]) };
    case "flow":
      return {
        columns: ["From", "To", "Amount"],
        rows: [["Salary", "Budget", "5000"], ["Freelance", "Budget", "1500"], ["Budget", "Rent", "1800"], ["Budget", "Food", "900"], ["Budget", "Transport", "400"], ["Budget", "Savings", "2600"], ["Budget", "Fun", "800"], ["Savings", "Stocks", "1600"], ["Savings", "Emergency fund", "1000"]],
      };
    case "path":
      return {
        columns: ["Path", "Value"],
        rows: [["Asia/India", "1430"], ["Asia/China", "1410"], ["Asia/Japan", "124"], ["Europe/Germany", "84"], ["Europe/UK", "68"], ["Europe/France", "68"], ["Americas/USA", "335"], ["Americas/Brazil", "216"], ["Africa/Nigeria", "224"], ["Africa/Egypt", "112"]],
      };
    case "ohlc": {
      let p = 100;
      return {
        columns: ["Date", "Open", "Close", "Low", "High"],
        rows: days(30, "2026-09-01").map((d) => {
          const o = p;
          const c = Math.max(5, o + (rnd() - 0.48) * 8);
          p = c;
          return [d, o.toFixed(2), c.toFixed(2), (Math.min(o, c) - rnd() * 3).toFixed(2), (Math.max(o, c) + rnd() * 3).toFixed(2)];
        }),
      };
    }
    case "calendar":
      return { columns: ["Date", "Commits"], rows: days(365).map((d) => [d, String(rnd() < 0.3 ? 0 : Math.round(rnd() * 12))]) };
  }
}

/* ---------- Parsing ---------- */

/** "1,234.5", "$12", "₹1,23,456", "45%", "(3)", " 7 " → numbers; anything else NaN. */
export function num(cell: string | undefined): number {
  if (cell == null) return NaN;
  let s = cell.trim();
  if (!s) return NaN;
  const neg = /^\(.*\)$/.test(s);
  // Currency signs in front and a % behind are fine; letters are not (so "Q1" isn't 1).
  s = s.replace(/^\(|\)$/g, "").replace(/[\s,_]/g, "").replace(/^[$€£¥₹₩₽¢₺₦]+/, "").replace(/%$/, "");
  const n = Number(s);
  return Number.isFinite(n) ? (neg ? -n : n) : NaN;
}

/** CSV, TSV (copied from Excel or Sheets) or semicolon CSV, with quoted cells. */
export function parseDelimited(text: string): Table {
  const t = text.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
  const first = t.split("\n")[0] ?? "";
  const delim = first.includes("\t") ? "\t" : (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"' && t[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"' && cell === "") q = true;
    else if (c === delim) {
      row.push(cell);
      cell = "";
    } else if (c === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  row.push(cell);
  rows.push(row);
  const width = Math.max(...rows.map((r) => r.length));
  const pad = (r: string[]) => [...r.map((x) => x.trim()), ...Array(width - r.length).fill("")];
  const [head, ...body] = rows.filter((r) => r.some((x) => x.trim()));
  if (!head) return { columns: ["Label", "Value"], rows: [] };
  // No header row (the first row is numbers too)? Name the columns.
  const headerless = head.slice(1).every((x) => Number.isFinite(num(x))) && head.length > 1 && body.length > 0;
  return headerless
    ? { columns: pad(head).map((_, i) => (i ? `Series ${i}` : "Label")), rows: [pad(head), ...body.map(pad)] }
    : { columns: pad(head).map((h, i) => h || `Column ${i + 1}`), rows: body.map(pad) };
}

export function toCsv(t: Table): string {
  const q = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return [t.columns, ...t.rows].map((r) => r.map(q).join(",")).join("\n");
}

/** A JSON array of objects, or { columns, rows }. */
export function parseJsonTable(text: string): Table {
  const d = JSON.parse(text);
  if (d && Array.isArray(d.columns) && Array.isArray(d.rows)) return { columns: d.columns.map(String), rows: d.rows.map((r: unknown[]) => r.map((x) => String(x ?? ""))) };
  if (Array.isArray(d) && d.length && typeof d[0] === "object") {
    const columns = [...new Set(d.flatMap((o: object) => Object.keys(o)))] as string[];
    return { columns, rows: d.map((o: Record<string, unknown>) => columns.map((c) => String(o[c] ?? ""))) };
  }
  throw new Error("Use an array of objects, or { columns, rows }.");
}

/* ---------- Style ---------- */

export const PALETTES: Record<string, { name: string; colors: string[] }> = {
  studio: { name: "Studio", colors: ["#eb4a10", "#15140f", "#2f7d4f", "#b7791f", "#4f6bd8", "#a3479b", "#0f8b8d", "#8a867a"] },
  vivid: { name: "Vivid", colors: ["#5470c6", "#91cc75", "#fac858", "#ee6666", "#73c0de", "#3ba272", "#fc8452", "#9a60b4"] },
  pastel: { name: "Pastel", colors: ["#a5b4fc", "#fbcfe8", "#bbf7d0", "#fde68a", "#bae6fd", "#ddd6fe", "#fecaca", "#d9f99d"] },
  ocean: { name: "Ocean", colors: ["#03045e", "#0077b6", "#00b4d8", "#48cae4", "#90e0ef", "#023e8a", "#0096c7", "#ade8f4"] },
  sunset: { name: "Sunset", colors: ["#ff6b35", "#f7c59f", "#ef476f", "#ffd166", "#9d4edd", "#f15bb5", "#fb5607", "#ffbe0b"] },
  forest: { name: "Forest", colors: ["#2d6a4f", "#40916c", "#52b788", "#74c69d", "#95d5b2", "#1b4332", "#b7e4c7", "#081c15"] },
  mono: { name: "Mono", colors: ["#15140f", "#3d3b34", "#57544a", "#76726a", "#8a867a", "#a9a496", "#c4bfb2", "#dad5c8"] },
  safe: { name: "Colour-blind safe", colors: ["#0072b2", "#e69f00", "#009e73", "#cc79a7", "#56b4e9", "#d55e00", "#f0e442", "#000000"] },
};

export type ChartStyle = {
  title: string;
  subtitle: string;
  titleAlign: "left" | "center";
  palette: string;
  colors: string[];
  dark: boolean;
  bg: "theme" | "transparent" | "custom";
  bgColor: string;
  font: "sans" | "serif" | "mono";
  fontScale: number;
  legend: "top" | "bottom" | "left" | "right" | "none";
  labels: boolean;
  decimals: number;
  prefix: string;
  suffix: string;
  compact: boolean;
  xTitle: string;
  yTitle: string;
  grid: boolean;
  yMin: string;
  yMax: string;
  log: boolean;
  lineWidth: number;
  points: boolean;
  areaOpacity: number;
  radius: number;
  barWidth: number;
  inner: number;
  showPercent: boolean;
  sort: "none" | "asc" | "desc";
  gaugeMax: string;
  bins: number;
  anim: boolean;
  animDuration: number;
  easing: string;
  stagger: number;
  aspect: "16:9" | "4:3" | "1:1" | "9:16" | "3:1";
};

export const DEFAULT_STYLE: ChartStyle = {
  title: "Sales by month",
  subtitle: "",
  titleAlign: "left",
  palette: "studio",
  colors: [],
  dark: false,
  bg: "theme",
  bgColor: "#ffffff",
  font: "sans",
  fontScale: 1,
  legend: "top",
  labels: false,
  decimals: -1,
  prefix: "",
  suffix: "",
  compact: false,
  xTitle: "",
  yTitle: "",
  grid: true,
  yMin: "",
  yMax: "",
  log: false,
  lineWidth: 3,
  points: true,
  areaOpacity: 25,
  radius: 4,
  barWidth: 60,
  inner: 50,
  showPercent: true,
  sort: "none",
  gaugeMax: "",
  bins: 0,
  anim: true,
  animDuration: 1000,
  easing: "cubicOut",
  stagger: 60,
  aspect: "16:9",
};

export const ASPECT: Record<ChartStyle["aspect"], number> = { "16:9": 16 / 9, "4:3": 4 / 3, "1:1": 1, "9:16": 9 / 16, "3:1": 3 };

export function makeFormat(s: Pick<ChartStyle, "decimals" | "prefix" | "suffix" | "compact">) {
  const f = s.compact
    ? new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: s.decimals >= 0 ? s.decimals : 1 })
    : new Intl.NumberFormat("en", s.decimals >= 0 ? { minimumFractionDigits: s.decimals, maximumFractionDigits: s.decimals } : { maximumFractionDigits: 2 });
  return (v: unknown) => {
    const n = typeof v === "number" ? v : Array.isArray(v) ? Number(v[v.length - 1]) : Number(v);
    return Number.isFinite(n) ? `${s.prefix}${f.format(n)}${s.suffix}` : "";
  };
}

const niceMax = (v: number) => {
  if (!(v > 0)) return 100;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v * 1.1) ?? 10 * p;
};

function quartiles(values: number[]) {
  const v = [...values].sort((a, b) => a - b);
  const q = (p: number) => {
    const i = (v.length - 1) * p;
    const lo = Math.floor(i);
    return v[lo] + (v[Math.ceil(i)] - v[lo]) * (i - lo);
  };
  return [v[0], q(0.25), q(0.5), q(0.75), v[v.length - 1]];
}

export type BuildContext = { fontFamily?: string; width?: number };

/** Table + style → ECharts option. Throws an Error with a plain message when the data doesn't fit. */
export function buildOption(type: ChartType, table: Table, s: ChartStyle, ctx: BuildContext = {}): any {
  const def = chartDef(type);
  const fmt = makeFormat(s);
  const pal = PALETTES[s.palette]?.colors ?? PALETTES.studio.colors;
  const colors = pal.map((c, i) => s.colors[i] || c);
  const ink = s.dark ? "#f3f0e8" : "#15140f";
  const ink2 = s.dark ? "#a9a496" : "#57544a";
  const line = s.dark ? "#33312a" : "#e4dfd3";
  const fs = (n: number) => Math.round(n * s.fontScale);
  const background = s.bg === "transparent" ? "transparent" : s.bg === "custom" ? s.bgColor : s.dark ? "#15140f" : "#fbfaf6";
  const series: any[] = [];
  const top = (s.title ? fs(52) : 16) + (s.subtitle ? fs(18) : 0) + (s.legend === "top" ? fs(30) : 0);
  const base: any = {
    backgroundColor: background,
    color: colors,
    textStyle: { fontFamily: ctx.fontFamily ?? "system-ui, -apple-system, Segoe UI, Roboto, sans-serif", fontSize: fs(12), color: ink2 },
    title: s.title || s.subtitle ? { text: s.title, subtext: s.subtitle, left: s.titleAlign === "center" ? "center" : 16, top: 12, textStyle: { color: ink, fontSize: fs(18), fontWeight: 600 }, subtextStyle: { color: ink2, fontSize: fs(12) } } : undefined,
    legend:
      s.legend === "none"
        ? { show: false }
        : {
            type: "scroll",
            textStyle: { color: ink2, fontSize: fs(12) },
            icon: "roundRect",
            itemWidth: 12,
            itemHeight: 12,
            ...(s.legend === "top" ? { top: s.title ? fs(s.subtitle ? 64 : 46) : 10, left: s.titleAlign === "center" ? "center" : 16 } : s.legend === "bottom" ? { bottom: 8 } : { [s.legend]: 12, top: "middle", orient: "vertical" }),
          },
    tooltip: { trigger: "item", valueFormatter: fmt, backgroundColor: s.dark ? "#1f1e19" : "#fff", borderColor: line, textStyle: { color: ink } },
    animation: s.anim,
    animationDuration: s.animDuration,
    animationEasing: s.easing,
    animationDelay: (i: number) => i * s.stagger,
    animationDurationUpdate: 700,
    animationEasingUpdate: "cubicInOut",
  };
  const grid = { left: s.legend === "left" ? 120 : 16, right: s.legend === "right" ? 130 : 24, top: Math.max(top, 24), bottom: (s.legend === "bottom" ? 44 : 16) + (s.xTitle ? 24 : 0), containLabel: true };
  const label = (pos?: string) => ({ show: s.labels, position: pos, formatter: (p: any) => fmt(p.value), color: ink, fontSize: fs(11) });
  const axisStyle = { axisLine: { lineStyle: { color: line } }, axisTick: { show: false }, axisLabel: { color: ink2, fontSize: fs(11) }, splitLine: { show: s.grid, lineStyle: { color: line, type: "dashed" } } };
  const valueAxis = (name: string) => ({ type: s.log ? "log" : "value", name, nameLocation: "middle", nameGap: 44, nameTextStyle: { color: ink2 }, min: s.yMin.trim() === "" ? undefined : num(s.yMin), max: s.yMax.trim() === "" ? undefined : num(s.yMax), axisLabel: { ...axisStyle.axisLabel, formatter: fmt }, ...omit(axisStyle, "axisLabel") });
  const need = (ok: boolean, msg: string) => {
    if (!ok) throw new Error(msg);
  };

  if (def.shape === "category") {
    need(table.columns.length >= 2 && table.rows.length >= 1, "Add a label column and at least one column of numbers.");
    let rows = table.rows.filter((r) => r.some((c) => c.trim()));
    if (s.sort !== "none") rows = [...rows].sort((a, b) => (num(a[1]) - num(b[1])) * (s.sort === "asc" ? 1 : -1));
    const labels = rows.map((r) => r[0]);
    const cols = table.columns.slice(1).map((name, i) => ({ name, data: rows.map((r) => num(r[i + 1])) }));
    need(cols.some((c) => c.data.some(Number.isFinite)), "No numbers found. The columns after the first should hold numbers.");
    const val = (v: number) => (Number.isFinite(v) ? v : "-");

    if (["column", "bar", "line", "area", "stackedColumn", "stackedBar", "percentColumn", "smoothLine", "stepLine", "stackedArea", "mixed"].includes(type)) {
      const horizontal = type === "bar" || type === "stackedBar";
      const isLine = ["line", "area", "smoothLine", "stepLine", "stackedArea"].includes(type);
      const stacked = ["stackedColumn", "stackedBar", "percentColumn", "stackedArea"].includes(type);
      let data = cols.map((c) => c.data);
      if (type === "percentColumn") {
        const totals = rows.map((_, j) => data.reduce((t, d) => t + (Number.isFinite(d[j]) ? Math.abs(d[j]) : 0), 0));
        data = data.map((d) => d.map((v, j) => (totals[j] ? (Math.abs(v) / totals[j]) * 100 : NaN)));
      }
      cols.forEach((c, i) => {
        const asLine = isLine || (type === "mixed" && i === cols.length - 1 && cols.length > 1);
        series.push({
          name: c.name,
          type: asLine ? "line" : "bar",
          data: data[i].map(val),
          stack: stacked ? "total" : undefined,
          yAxisIndex: type === "mixed" && asLine ? 1 : 0,
          smooth: type === "smoothLine" ? 0.4 : false,
          step: type === "stepLine" ? "middle" : undefined,
          areaStyle: type === "area" || type === "stackedArea" ? { opacity: s.areaOpacity / 100 } : undefined,
          showSymbol: s.points,
          symbolSize: 7,
          lineStyle: asLine ? { width: s.lineWidth } : undefined,
          barMaxWidth: `${s.barWidth}%`,
          itemStyle: asLine ? undefined : { borderRadius: stacked ? (i === cols.length - 1 ? (horizontal ? [0, s.radius, s.radius, 0] : [s.radius, s.radius, 0, 0]) : 0) : horizontal ? [0, s.radius, s.radius, 0] : [s.radius, s.radius, 0, 0] },
          label: { ...label(asLine ? "top" : stacked ? "inside" : horizontal ? "right" : "top"), formatter: (p: any) => (type === "percentColumn" ? `${(+p.value).toFixed(0)}%` : fmt(p.value)) },
          emphasis: { focus: "series" },
          universalTransition: true,
        });
      });
      const cat = { type: "category", data: labels, name: horizontal ? s.yTitle : s.xTitle, nameLocation: "middle", nameGap: horizontal ? 70 : 30, nameTextStyle: { color: ink2 }, boundaryGap: !isLine, ...axisStyle, splitLine: { show: false } };
      const valAx = type === "percentColumn" ? { ...valueAxis(horizontal ? s.xTitle : s.yTitle), max: 100, axisLabel: { ...axisStyle.axisLabel, formatter: "{value}%" } } : valueAxis(horizontal ? s.xTitle : s.yTitle);
      return {
        ...base,
        tooltip: { ...base.tooltip, trigger: "axis", axisPointer: { type: isLine ? "line" : "shadow" }, valueFormatter: type === "percentColumn" ? (v: number) => `${(+v).toFixed(1)}%` : fmt },
        grid,
        xAxis: horizontal ? valAx : cat,
        yAxis: horizontal ? { ...cat, inverse: true } : type === "mixed" ? [valAx, { ...valueAxis(cols.at(-1)!.name), splitLine: { show: false } }] : valAx,
        series,
      };
    }
    if (type === "waterfall") {
      const v = cols[0].data;
      let sum = 0;
      const baseData: (number | string)[] = [];
      const up: (number | string)[] = [];
      const down: (number | string)[] = [];
      v.forEach((x) => {
        const d = Number.isFinite(x) ? x : 0;
        baseData.push(d >= 0 ? sum : sum + d);
        up.push(d >= 0 ? d : "-");
        down.push(d < 0 ? -d : "-");
        sum += d;
      });
      baseData.push(0);
      up.push("-");
      down.push("-");
      const totals = [...v.map(() => "-"), sum];
      return {
        ...base,
        tooltip: { ...base.tooltip, trigger: "axis", axisPointer: { type: "shadow" }, formatter: (ps: any[]) => ps.filter((p) => p.seriesName !== "base" && p.value !== "-").map((p) => `${p.name}: ${p.seriesName === "Decrease" ? "−" : ""}${fmt(p.value)}`).join("<br/>") },
        legend: { ...base.legend, data: ["Increase", "Decrease", "Total"] },
        grid,
        xAxis: { type: "category", data: [...labels, "Total"], ...axisStyle, splitLine: { show: false } },
        yAxis: valueAxis(s.yTitle),
        series: [
          { name: "base", type: "bar", stack: "w", data: baseData, itemStyle: { color: "transparent" }, emphasis: { disabled: true }, tooltip: { show: false } },
          { name: "Increase", type: "bar", stack: "w", data: up, itemStyle: { color: s.colors[0] || "#2f7d4f", borderRadius: s.radius }, label: label("top") },
          { name: "Decrease", type: "bar", stack: "w", data: down, itemStyle: { color: s.colors[1] || "#c2410c", borderRadius: s.radius }, label: { ...label("bottom"), formatter: (p: any) => `−${fmt(p.value)}` } },
          { name: "Total", type: "bar", stack: "w", data: totals, itemStyle: { color: s.colors[2] || colors[1], borderRadius: s.radius }, label: label("top") },
        ],
      };
    }
    if (type === "radar") {
      const max = niceMax(Math.max(...cols.flatMap((c) => c.data.filter(Number.isFinite))));
      return {
        ...base,
        radar: { indicator: labels.map((name) => ({ name, max })), center: ["50%", "56%"], radius: "62%", axisName: { color: ink2, fontSize: fs(12) }, splitLine: { lineStyle: { color: line } }, splitArea: { show: false }, axisLine: { lineStyle: { color: line } } },
        series: [{ type: "radar", symbolSize: s.points ? 6 : 0, lineStyle: { width: s.lineWidth - 1 }, areaStyle: { opacity: s.areaOpacity / 100 }, data: cols.map((c) => ({ name: c.name, value: c.data.map((x) => (Number.isFinite(x) ? x : 0)) })), label: label("top"), universalTransition: true }],
      };
    }
    if (type === "polarBar") {
      return {
        ...base,
        tooltip: { ...base.tooltip, trigger: "axis" },
        polar: { radius: ["12%", "72%"], center: ["50%", "56%"] },
        angleAxis: { max: niceMax(Math.max(...cols.map((c) => c.data.reduce((t, x) => t + (Number.isFinite(x) ? x : 0), 0) / Math.max(1, c.data.length))) * 1.6), startAngle: 90, axisLabel: { color: ink2, formatter: fmt }, splitLine: { lineStyle: { color: line } }, axisLine: { lineStyle: { color: line } } },
        radiusAxis: { type: "category", data: labels, axisLabel: { color: ink2, fontSize: fs(11) }, axisLine: { lineStyle: { color: line } } },
        series: cols.map((c) => ({ type: "bar", name: c.name, data: c.data.map(val), coordinateSystem: "polar", itemStyle: { borderRadius: s.radius }, label: { ...label("middle"), position: "middle" }, emphasis: { focus: "series" } })),
      };
    }
    if (["pie", "doughnut", "rose", "halfDoughnut", "funnel"].includes(type)) {
      let data = rows.map((r, i) => ({ name: r[0], value: Math.abs(cols[0].data[i]) })).filter((d) => Number.isFinite(d.value));
      if (type === "funnel") data = [...data].sort((a, b) => b.value - a.value);
      const pieLabel = { show: s.labels || type !== "funnel", color: ink, fontSize: fs(12), formatter: (p: any) => (s.showPercent ? `${p.name}\n${p.percent.toFixed(p.percent < 10 ? 1 : 0)}%` : `${p.name}\n${fmt(p.value)}`) };
      if (type === "funnel")
        return {
          ...base,
          series: [{ type: "funnel", name: cols[0].name, data, left: "12%", width: "76%", top: top + 8, bottom: 24, sort: "descending", gap: 3, minSize: "8%", label: { ...pieLabel, show: true, position: "inside", color: "#fff", formatter: (p: any) => `${p.name}  ${s.showPercent ? `${p.percent.toFixed(0)}%` : fmt(p.value)}` }, itemStyle: { borderWidth: 0 }, universalTransition: true }],
        };
      const half = type === "halfDoughnut";
      return {
        ...base,
        series: [
          {
            type: "pie",
            name: cols[0].name,
            data,
            radius: type === "pie" ? [0, "66%"] : type === "rose" ? ["14%", "70%"] : [`${s.inner}%`, half ? "92%" : "70%"],
            center: half ? ["50%", "78%"] : ["50%", s.legend === "top" || s.title ? "58%" : "50%"],
            startAngle: half ? 180 : 90,
            endAngle: half ? 360 : "auto",
            roseType: type === "rose" ? "area" : undefined,
            padAngle: type === "pie" ? 0 : 1.5,
            itemStyle: { borderRadius: s.radius * 1.5, borderColor: background === "transparent" ? undefined : background, borderWidth: type === "pie" ? 2 : 0 },
            label: pieLabel,
            labelLine: { lineStyle: { color: line } },
            emphasis: { scaleSize: 8 },
            animationType: "expansion",
            universalTransition: true,
          },
        ],
      };
    }
    if (type === "gauge") {
      const items = rows.slice(0, 4).map((r, i) => ({ name: r[0], value: cols[0].data[i] })).filter((d) => Number.isFinite(d.value));
      need(items.length > 0, "Gauges need a number in the second column.");
      const max = s.gaugeMax.trim() ? num(s.gaugeMax) : niceMax(Math.max(...items.map((d) => d.value)));
      const n = items.length;
      return {
        ...base,
        series: items.map((d, i) => ({
          type: "gauge",
          center: [`${((i + 0.5) / n) * 100}%`, "62%"],
          radius: n === 1 ? "72%" : `${Math.min(72, 150 / n)}%`,
          min: 0,
          max,
          startAngle: 210,
          endAngle: -30,
          progress: { show: true, width: n > 2 ? 10 : 16, roundCap: true, itemStyle: { color: colors[i % colors.length] } },
          axisLine: { roundCap: true, lineStyle: { width: n > 2 ? 10 : 16, color: [[1, line]] } },
          pointer: { show: n === 1, length: "58%", width: 5, itemStyle: { color: ink } },
          anchor: { show: n === 1, size: 12, itemStyle: { color: ink } },
          axisTick: { show: false },
          splitLine: { show: n === 1, length: 6, distance: -26, lineStyle: { color: ink2 } },
          axisLabel: { show: n === 1, distance: -46, color: ink2, fontSize: fs(10), formatter: fmt },
          title: { offsetCenter: [0, "72%"], color: ink2, fontSize: fs(13) },
          detail: { valueAnimation: true, offsetCenter: [0, n === 1 ? "38%" : "10%"], fontSize: fs(n > 2 ? 18 : 26), fontWeight: 600, color: ink, formatter: fmt },
          data: [d],
        })),
      };
    }
    if (type === "heatmap") {
      const data: [number, number, number | string][] = [];
      cols.forEach((c, x) => c.data.forEach((v, y) => data.push([x, y, Number.isFinite(v) ? v : "-"])));
      const vals = data.map((d) => d[2]).filter((v): v is number => typeof v === "number");
      return {
        ...base,
        tooltip: { ...base.tooltip, formatter: (p: any) => `${labels[p.value[1]]} · ${cols[p.value[0]].name}<br/><b>${fmt(p.value[2])}</b>` },
        grid: { ...grid, bottom: 64 },
        xAxis: { type: "category", data: cols.map((c) => c.name), ...axisStyle, splitArea: { show: false } },
        yAxis: { type: "category", data: labels, ...axisStyle, inverse: true },
        visualMap: { min: Math.min(...vals), max: Math.max(...vals), calculable: true, orient: "horizontal", left: "center", bottom: 8, itemHeight: 160, textStyle: { color: ink2 }, inRange: { color: [s.dark ? "#1f1e19" : "#f6f3ec", colors[0]] }, formatter: fmt },
        series: [{ type: "heatmap", data, label: { show: s.labels, color: ink, fontSize: fs(11), formatter: (p: any) => fmt(p.value[2]) }, itemStyle: { borderColor: background === "transparent" ? "#fff" : background, borderWidth: 2, borderRadius: s.radius / 2 }, emphasis: { itemStyle: { shadowBlur: 8, shadowColor: "rgba(0,0,0,.25)" } } }],
      };
    }
  }

  if (def.shape === "xy") {
    need(table.columns.length >= 2, "Add an X column and at least one Y column.");
    return {
      ...base,
      grid,
      tooltip: { ...base.tooltip, formatter: (p: any) => `${p.seriesName}<br/>${table.columns[0]}: ${fmt(p.value[0])}<br/>${fmt(p.value[1])}` },
      xAxis: { ...valueAxis(s.xTitle || table.columns[0]), scale: true, nameGap: 30 },
      yAxis: { ...valueAxis(s.yTitle), scale: true },
      series: table.columns.slice(1).map((name, i) => ({
        type: "scatter",
        name,
        symbolSize: 10 + s.lineWidth,
        data: table.rows.map((r) => [num(r[0]), num(r[i + 1])]).filter((d) => d.every(Number.isFinite)),
        itemStyle: { opacity: 0.85 },
        label: { show: s.labels, position: "top", formatter: (p: any) => fmt(p.value[1]), color: ink2, fontSize: fs(10) },
        emphasis: { focus: "series", scale: 1.4 },
        universalTransition: true,
      })),
    };
  }
  if (def.shape === "bubble") {
    need(table.columns.length >= 4, "Bubbles need four columns: label, X, Y and size.");
    const pts = table.rows.map((r) => [num(r[1]), num(r[2]), num(r[3]), r[0]] as [number, number, number, string]).filter((d) => d.slice(0, 3).every((v) => Number.isFinite(v)));
    const maxSize = Math.max(...pts.map((p) => Math.abs(p[2])), 1);
    return {
      ...base,
      grid,
      legend: { show: false },
      tooltip: { ...base.tooltip, formatter: (p: any) => `<b>${p.value[3]}</b><br/>${table.columns[1]}: ${fmt(p.value[0])}<br/>${table.columns[2]}: ${fmt(p.value[1])}<br/>${table.columns[3]}: ${fmt(p.value[2])}` },
      xAxis: { ...valueAxis(s.xTitle || table.columns[1]), scale: true, nameGap: 30 },
      yAxis: { ...valueAxis(s.yTitle || table.columns[2]), scale: true },
      series: [
        {
          type: "scatter",
          colorBy: "data",
          data: pts,
          symbolSize: (v: number[]) => 8 + Math.sqrt(Math.abs(v[2]) / maxSize) * 64,
          itemStyle: { opacity: 0.78, borderColor: "#fff", borderWidth: 1 },
          label: { show: true, formatter: (p: any) => p.value[3], color: ink, fontSize: fs(11), position: "top" },
          emphasis: { scale: 1.15 },
        },
      ],
    };
  }
  if (def.shape === "values") {
    const groups = table.columns.map((name, i) => ({ name, data: table.rows.map((r) => num(r[i])).filter(Number.isFinite) })).filter((g) => g.data.length);
    need(groups.length > 0, "Add numbers: each column is a group, each cell one measurement.");
    if (type === "boxplot") {
      return {
        ...base,
        grid,
        tooltip: { ...base.tooltip, formatter: (p: any) => `<b>${p.name}</b><br/>Max ${fmt(p.value[5])}<br/>Q3 ${fmt(p.value[4])}<br/>Median ${fmt(p.value[3])}<br/>Q1 ${fmt(p.value[2])}<br/>Min ${fmt(p.value[1])}` },
        xAxis: { type: "category", data: groups.map((g) => g.name), ...axisStyle, splitLine: { show: false } },
        yAxis: { ...valueAxis(s.yTitle), scale: true },
        series: [{ type: "boxplot", colorBy: "data", data: groups.map((g) => quartiles(g.data)), itemStyle: { borderWidth: 2, color: "transparent" }, boxWidth: [12, `${s.barWidth}%`] }],
      };
    }
    // Histogram: every column, binned together so the groups line up.
    const all = groups.flatMap((g) => g.data);
    const lo = Math.min(...all);
    const hi = Math.max(...all);
    const k = s.bins > 0 ? s.bins : Math.max(4, Math.min(30, Math.ceil(Math.log2(all.length) + 1)));
    const w = (hi - lo) / k || 1;
    const edges = Array.from({ length: k }, (_, i) => lo + i * w);
    const f2 = makeFormat({ ...s, prefix: "", suffix: "" });
    return {
      ...base,
      grid,
      tooltip: { ...base.tooltip, trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v: number) => `${v}` },
      xAxis: { type: "category", data: edges.map((e) => `${f2(e)}–${f2(e + w)}`), name: s.xTitle, nameLocation: "middle", nameGap: 30, ...axisStyle, splitLine: { show: false } },
      yAxis: { ...valueAxis(s.yTitle || "Count"), axisLabel: { ...axisStyle.axisLabel } },
      series: groups.map((g) => ({
        type: "bar",
        name: g.name,
        barCategoryGap: "4%",
        data: edges.map((_, i) => g.data.filter((v) => (i === k - 1 ? v >= lo + i * w : v >= lo + i * w && v < lo + (i + 1) * w)).length),
        itemStyle: { borderRadius: [s.radius, s.radius, 0, 0], opacity: groups.length > 1 ? 0.8 : 1 },
        label: { show: s.labels, position: "top", color: ink2, fontSize: fs(10) },
      })),
    };
  }
  if (def.shape === "path") {
    type Node = { name: string; value?: number; children?: Node[] };
    const root: Node[] = [];
    for (const r of table.rows) {
      const v = num(r[1]);
      const parts = r[0].split("/").map((p) => p.trim()).filter(Boolean);
      if (!parts.length || !Number.isFinite(v)) continue;
      let level = root;
      parts.forEach((p, i) => {
        let n = level.find((x) => x.name === p);
        if (!n) level.push((n = { name: p }));
        if (i === parts.length - 1) n.value = (n.value ?? 0) + Math.abs(v);
        else level = n.children ??= [];
      });
    }
    need(root.length > 0, "Add rows like  Asia/India , 1430: a path split by / and a value.");
    if (type === "treemap")
      return {
        ...base,
        legend: { show: false },
        series: [
          {
            type: "treemap",
            data: root,
            top: top + 4,
            bottom: 34,
            left: 12,
            right: 12,
            roam: false,
            nodeClick: "zoomToNode",
            breadcrumb: { bottom: 6, itemStyle: { color: s.dark ? "#1f1e19" : "#eae6db", textStyle: { color: ink } } },
            label: { show: true, formatter: (p: any) => `${p.name}\n${fmt(p.value)}`, fontSize: fs(12) },
            upperLabel: { show: true, height: 22, color: "#fff" },
            itemStyle: { borderColor: background === "transparent" ? "#fff" : background, borderWidth: 2, gapWidth: 2, borderRadius: s.radius },
            levels: [{ itemStyle: { gapWidth: 4 } }, { colorSaturation: [0.35, 0.6], itemStyle: { gapWidth: 2, borderColorSaturation: 0.6 } }],
          },
        ],
      };
    return {
      ...base,
      legend: { show: false },
      series: [
        {
          type: "sunburst",
          data: root,
          radius: ["12%", "88%"],
          center: ["50%", s.title ? "55%" : "50%"],
          sort: s.sort === "none" ? undefined : s.sort,
          itemStyle: { borderRadius: s.radius, borderWidth: 2, borderColor: background === "transparent" ? "#fff" : background },
          label: { rotate: "radial", color: "#fff", fontSize: fs(11), minAngle: 8 },
          emphasis: { focus: "ancestor" },
          animationType: "expansion",
        },
      ],
    };
  }
  if (def.shape === "flow") {
    const links = table.rows.map((r) => ({ source: r[0].trim(), target: r[1].trim(), value: num(r[2]) })).filter((l) => l.source && l.target && l.source !== l.target && l.value > 0);
    need(links.length > 0, "Add rows of from, to and an amount above 0.");
    const names = [...new Set(links.flatMap((l) => [l.source, l.target]))];
    return {
      ...base,
      legend: { show: false },
      tooltip: { ...base.tooltip, trigger: "item" },
      series: [
        {
          type: "sankey",
          top: top + 8,
          bottom: 16,
          left: 16,
          right: 110,
          data: names.map((name) => ({ name })),
          links,
          nodeGap: 14,
          nodeWidth: 14,
          draggable: true,
          emphasis: { focus: "adjacency" },
          lineStyle: { color: "gradient", curveness: 0.5, opacity: 0.35 },
          label: { color: ink, fontSize: fs(12), formatter: (p: any) => `${p.name}  ${fmt(p.value)}` },
          itemStyle: { borderWidth: 0, borderRadius: 2 },
        },
      ],
    };
  }
  if (def.shape === "ohlc") {
    const rows = table.rows.filter((r) => [1, 2, 3, 4].every((i) => Number.isFinite(num(r[i]))));
    need(rows.length > 0, "Add rows of date, open, close, low and high.");
    const upC = s.colors[0] || "#2f7d4f";
    const downC = s.colors[1] || "#c2410c";
    return {
      ...base,
      legend: { show: false },
      grid: { ...grid, bottom: rows.length > 40 ? 60 : grid.bottom },
      tooltip: { ...base.tooltip, trigger: "axis", axisPointer: { type: "cross" }, formatter: (ps: any[]) => { const p = ps[0]; const [, o, c, l, h] = p.value; return `<b>${p.name}</b><br/>Open ${fmt(o)}<br/>Close ${fmt(c)}<br/>Low ${fmt(l)}<br/>High ${fmt(h)}`; } },
      xAxis: { type: "category", data: rows.map((r) => r[0]), ...axisStyle, splitLine: { show: false } },
      yAxis: { ...valueAxis(s.yTitle), scale: true },
      dataZoom: rows.length > 40 ? [{ type: "inside" }, { type: "slider", bottom: 10, height: 22 }] : undefined,
      series: [{ type: "candlestick", data: rows.map((r) => [num(r[1]), num(r[2]), num(r[3]), num(r[4])]), itemStyle: { color: upC, color0: downC, borderColor: upC, borderColor0: downC } }],
    };
  }
  // calendar
  const pts = table.rows.map((r) => [r[0].trim().slice(0, 10), num(r[1])] as [string, number]).filter(([d, v]) => /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(v));
  need(pts.length > 0, "Add rows of a date (YYYY-MM-DD) and a value.");
  const datesSorted = pts.map((p) => p[0]).sort();
  const vals = pts.map((p) => p[1]);
  const cell = Math.max(8, Math.min(18, Math.floor(((ctx.width ?? 900) - 80) / 54)));
  return {
    ...base,
    legend: { show: false },
    tooltip: { ...base.tooltip, formatter: (p: any) => `${p.value[0]}<br/><b>${fmt(p.value[1])}</b>` },
    visualMap: { min: Math.min(...vals), max: Math.max(...vals), type: "piecewise", splitNumber: 5, orient: "horizontal", left: "center", bottom: 6, textStyle: { color: ink2 }, inRange: { color: [s.dark ? "#26241e" : "#ece8de", colors[0]] }, formatter: (a: number, b: number) => `${fmt(a)}–${fmt(b)}` },
    calendar: { range: [datesSorted[0], datesSorted.at(-1)], top: top + 22, left: 40, right: 20, cellSize: ["auto", cell], itemStyle: { borderWidth: 2, borderColor: background === "transparent" ? "#fff" : background, color: s.dark ? "#1f1e19" : "#f6f3ec" }, splitLine: { show: false }, yearLabel: { show: false }, dayLabel: { color: ink2, fontSize: fs(10), firstDay: 1, nameMap: "en" }, monthLabel: { color: ink2, fontSize: fs(11) } },
    series: [{ type: "heatmap", coordinateSystem: "calendar", data: pts }],
  };
}

function omit<T extends object, K extends keyof T>(o: T, k: K): Omit<T, K> {
  const r = { ...o };
  delete r[k];
  return r;
}

const CSS_EASING: Record<string, string> = {
  cubicOut: "cubic-bezier(.33,1,.68,1)",
  backOut: "cubic-bezier(.34,1.56,.64,1)",
  bounceOut: "cubic-bezier(.34,1.8,.64,1)",
  elasticOut: "cubic-bezier(.5,2.2,.5,.8)",
  linear: "linear",
};

/**
 * ECharts' SVG export animates lines and pies itself, but not bars, cells or boxes. For those,
 * this adds a CSS entrance (bars grow from their base, other shapes scale and fade in), staggered
 * by data index, using the data marks ECharts tags with ecmeta_* attributes. Plays anywhere,
 * no scripts; respects reduced motion.
 */
export function animateSvg(svg: string, type: ChartType, s: Pick<ChartStyle, "animDuration" | "stagger" | "easing">): string {
  if (svg.includes("@keyframes")) return svg;
  const horizontal = type === "bar" || type === "stackedBar";
  const grows = ["column", "stackedColumn", "percentColumn", "waterfall", "histogram", "mixed"].includes(type);
  const origin = horizontal ? "0% 50%" : grows ? "50% 100%" : "50% 50%";
  const from = horizontal ? "transform:scaleX(0)" : grows ? "transform:scaleY(0)" : "opacity:0;transform:scale(.4)";
  const rules = new Set<string>();
  for (const m of svg.matchAll(/ecmeta_series_index="(\d+)" ecmeta_data_index="(\d+)"/g)) {
    const delay = Math.round(+m[2] * s.stagger + (+m[1] * s.stagger) / 2);
    if (delay) rules.add(`[ecmeta_series_index="${m[1]}"][ecmeta_data_index="${m[2]}"]{animation-delay:${delay}ms}`);
  }
  const css =
    `@keyframes dwgrow{from{${from}}}` +
    `[ecmeta_data_index]{transform-box:fill-box;transform-origin:${origin};animation:dwgrow ${s.animDuration}ms ${CSS_EASING[s.easing] ?? CSS_EASING.cubicOut} both}` +
    [...rules].join("") +
    "@media (prefers-reduced-motion:reduce){[ecmeta_data_index]{animation:none}}";
  return svg.replace(/<svg([^>]*)>/, `<svg$1><style>${css}</style>`);
}
