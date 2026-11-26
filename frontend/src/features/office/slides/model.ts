/**
 * The slide deck model and a single pure HTML renderer shared by the editor canvas, thumbnails,
 * the slideshow, and PDF/PNG export, so every view looks the same.
 */

export type ShapeKind =
  | "rect" | "roundRect" | "ellipse" | "triangle" | "rightTriangle" | "diamond" | "pentagon" | "hexagon" | "octagon"
  | "star5" | "arrowRight" | "arrowLeft" | "arrowUp" | "arrowDown" | "chevron" | "parallelogram" | "trapezoid"
  | "heart" | "cloud" | "speech" | "plus" | "line" | "arrowLine";

export type Anim = { type: "none" | "fade" | "fly-left" | "fly-right" | "fly-up" | "zoom" | "wipe" | "spin"; order: number };

export type TextStyle = {
  font?: string;
  size: number; // px at 960×540
  color?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  align: "left" | "center" | "right" | "justify";
  valign: "top" | "middle" | "bottom";
  lineHeight?: number;
  bullets?: boolean;
};

export type El = {
  id: string;
  type: "text" | "shape" | "image" | "table" | "chart";
  x: number;
  y: number;
  w: number;
  h: number;
  rot: number;
  opacity?: number;
  /** placeholder role from the layout (title, body…) */
  role?: "title" | "subtitle" | "body" | "caption";
  html?: string; // rich text for text boxes and shapes
  text?: TextStyle;
  shape?: { kind: ShapeKind; fill?: string; stroke?: string; strokeW?: number; shadow?: boolean };
  src?: string; // image
  fit?: "cover" | "contain";
  radius?: number;
  table?: { rows: string[][]; header: boolean; color?: string };
  chart?: { type: "bar" | "column" | "line" | "pie" | "doughnut"; labels: string[]; series: { name: string; values: number[] }[] };
  anim?: Anim;
  link?: string;
};

export type Transition = "none" | "fade" | "slide" | "push" | "zoom" | "flip" | "cover";

export type Slide = {
  id: string;
  layout: string;
  bg?: string; // css colour, gradient or url()
  elements: El[];
  notes: string;
  transition: Transition;
  hidden?: boolean;
};

export type Theme = {
  id: string;
  name: string;
  bg: string;
  text: string;
  title: string;
  accent: string[];
  titleFont: string;
  bodyFont: string;
  /** decoration drawn behind content (HTML, absolutely positioned) */
  deco?: string;
};

export type Deck = { slides: Slide[]; theme: string; ratio: "16:9" | "4:3" };

export const SIZE = { "16:9": { w: 960, h: 540 }, "4:3": { w: 720, h: 540 } } as const;

export const THEMES: Theme[] = [
  { id: "office", name: "Office", bg: "#ffffff", text: "#262626", title: "#1f1f1f", accent: ["#4472c4", "#ed7d31", "#a5a5a5", "#ffc000", "#5b9bd5", "#70ad47"], titleFont: "Calibri Light", bodyFont: "Calibri" },
  { id: "ink", name: "Ink", bg: "#15140f", text: "#e9e6dc", title: "#ffffff", accent: ["#eb4a10", "#f5b041", "#58d68d", "#5dade2", "#af7ac5", "#ec7063"], titleFont: "Georgia", bodyFont: "Inter", deco: '<div style="position:absolute;left:0;top:0;width:100%;height:8px;background:#eb4a10"></div>' },
  { id: "paper", name: "Paper", bg: "#f3f0e8", text: "#3b3a33", title: "#15140f", accent: ["#eb4a10", "#2f7d4f", "#b7791f", "#2b579a", "#8e44ad", "#c0392b"], titleFont: "Playfair Display", bodyFont: "Lato" },
  { id: "ocean", name: "Ocean", bg: "linear-gradient(135deg,#0f2027,#203a43 55%,#2c5364)", text: "#e0f2f1", title: "#ffffff", accent: ["#4dd0e1", "#80cbc4", "#ffd54f", "#ff8a65", "#ba68c8", "#aed581"], titleFont: "Montserrat", bodyFont: "Open Sans" },
  { id: "sunset", name: "Sunset", bg: "linear-gradient(135deg,#ff9a8b 0%,#ff6a88 55%,#ff99ac 100%)", text: "#3d0b1e", title: "#2b0614", accent: ["#3d0b1e", "#ffffff", "#ffe082", "#6a1b9a", "#00897b", "#283593"], titleFont: "Poppins", bodyFont: "Poppins" },
  { id: "forest", name: "Forest", bg: "#f4f7f2", text: "#2e3b2c", title: "#1b5e20", accent: ["#2e7d32", "#81c784", "#a1887f", "#ffb300", "#4e342e", "#0277bd"], titleFont: "Merriweather", bodyFont: "Open Sans", deco: '<div style="position:absolute;left:0;top:0;width:24px;height:100%;background:#2e7d32"></div>' },
  { id: "midnight", name: "Midnight", bg: "radial-gradient(circle at 20% 20%,#2a2a72,#090921 70%)", text: "#d7d7ff", title: "#ffffff", accent: ["#8c7bff", "#00e5ff", "#ff4081", "#ffd740", "#69f0ae", "#ff6e40"], titleFont: "Poppins", bodyFont: "Inter" },
  { id: "minimal", name: "Minimal", bg: "#ffffff", text: "#444444", title: "#111111", accent: ["#111111", "#777777", "#e63946", "#457b9d", "#2a9d8f", "#f4a261"], titleFont: "Helvetica", bodyFont: "Helvetica", deco: '<div style="position:absolute;left:48px;bottom:36px;width:60px;height:4px;background:#e63946"></div>' },
  { id: "berry", name: "Berry", bg: "#fdf2f8", text: "#4a044e", title: "#701a75", accent: ["#c026d3", "#db2777", "#7c3aed", "#0ea5e9", "#f59e0b", "#10b981"], titleFont: "Montserrat", bodyFont: "Lato" },
  { id: "slate", name: "Slate", bg: "#1e293b", text: "#cbd5e1", title: "#f8fafc", accent: ["#38bdf8", "#f472b6", "#a3e635", "#fbbf24", "#c084fc", "#fb7185"], titleFont: "Inter", bodyFont: "Inter", deco: '<div style="position:absolute;right:-80px;top:-80px;width:260px;height:260px;border-radius:50%;background:rgba(56,189,248,.15)"></div>' },
];

export const themeOf = (id: string) => THEMES.find((t) => t.id === id) ?? THEMES[0];

let seq = 0;
export const elId = () => `e${Date.now().toString(36)}${(seq++).toString(36)}`;

const T = (size: number, align: TextStyle["align"] = "left", valign: TextStyle["valign"] = "top", extra: Partial<TextStyle> = {}): TextStyle => ({ size, align, valign, ...extra });

/** Slide layouts (16:9 coordinates; scaled for 4:3). */
export const LAYOUTS: { id: string; name: string; make: (w: number, h: number) => El[] }[] = [
  {
    id: "title",
    name: "Title slide",
    make: (w, h) => [
      { id: elId(), type: "text", role: "title", x: 60, y: h * 0.3, w: w - 120, h: 110, rot: 0, html: "<p>Click to add title</p>", text: T(48, "center", "bottom", { bold: true }) },
      { id: elId(), type: "text", role: "subtitle", x: 60, y: h * 0.3 + 120, w: w - 120, h: 60, rot: 0, html: "<p>Click to add subtitle</p>", text: T(22, "center", "top") },
    ],
  },
  {
    id: "content",
    name: "Title and content",
    make: (w, h) => [
      { id: elId(), type: "text", role: "title", x: 48, y: 30, w: w - 96, h: 80, rot: 0, html: "<p>Click to add title</p>", text: T(36, "left", "middle", { bold: true }) },
      { id: elId(), type: "text", role: "body", x: 48, y: 125, w: w - 96, h: h - 170, rot: 0, html: "<ul><li>Click to add text</li></ul>", text: T(22, "left", "top", { bullets: true, lineHeight: 1.35 }) },
    ],
  },
  {
    id: "two",
    name: "Two content",
    make: (w, h) => [
      { id: elId(), type: "text", role: "title", x: 48, y: 30, w: w - 96, h: 80, rot: 0, html: "<p>Click to add title</p>", text: T(36, "left", "middle", { bold: true }) },
      { id: elId(), type: "text", role: "body", x: 48, y: 125, w: (w - 120) / 2, h: h - 170, rot: 0, html: "<ul><li>Left point</li></ul>", text: T(20, "left", "top", { bullets: true, lineHeight: 1.35 }) },
      { id: elId(), type: "text", role: "body", x: 72 + (w - 120) / 2, y: 125, w: (w - 120) / 2, h: h - 170, rot: 0, html: "<ul><li>Right point</li></ul>", text: T(20, "left", "top", { bullets: true, lineHeight: 1.35 }) },
    ],
  },
  {
    id: "section",
    name: "Section header",
    make: (w, h) => [
      { id: elId(), type: "text", role: "title", x: 60, y: h * 0.38, w: w - 120, h: 90, rot: 0, html: "<p>Section title</p>", text: T(44, "left", "bottom", { bold: true }) },
      { id: elId(), type: "text", role: "subtitle", x: 60, y: h * 0.38 + 100, w: w - 120, h: 50, rot: 0, html: "<p>Short description</p>", text: T(20, "left", "top") },
    ],
  },
  {
    id: "titleOnly",
    name: "Title only",
    make: (w) => [{ id: elId(), type: "text", role: "title", x: 48, y: 30, w: w - 96, h: 80, rot: 0, html: "<p>Click to add title</p>", text: T(36, "left", "middle", { bold: true }) }],
  },
  {
    id: "imageCaption",
    name: "Picture with caption",
    make: (w, h) => [
      { id: elId(), type: "text", role: "title", x: 48, y: 60, w: w * 0.36, h: 90, rot: 0, html: "<p>Caption title</p>", text: T(30, "left", "bottom", { bold: true }) },
      { id: elId(), type: "text", role: "caption", x: 48, y: 160, w: w * 0.36, h: h - 220, rot: 0, html: "<p>Describe the picture here.</p>", text: T(18, "left", "top", { lineHeight: 1.4 }) },
      { id: elId(), type: "shape", x: w * 0.44, y: 48, w: w * 0.52, h: h - 96, rot: 0, shape: { kind: "rect", fill: "#e5e5e5" }, html: '<p>Insert → Picture, or drop one here</p>', text: T(16, "center", "middle", { color: "#777777" }) },
    ],
  },
  {
    id: "quote",
    name: "Quote",
    make: (w, h) => [
      { id: elId(), type: "text", role: "body", x: 90, y: h * 0.25, w: w - 180, h: h * 0.35, rot: 0, html: "<p>“A great quote goes here.”</p>", text: T(36, "center", "middle", { italic: true }) },
      { id: elId(), type: "text", role: "caption", x: 90, y: h * 0.62, w: w - 180, h: 40, rot: 0, html: "<p>— Someone wise</p>", text: T(20, "center", "top") },
    ],
  },
  { id: "blank", name: "Blank", make: () => [] },
];

export function newSlide(layout: string, deck: Deck): Slide {
  const { w, h } = SIZE[deck.ratio];
  const l = LAYOUTS.find((x) => x.id === layout) ?? LAYOUTS[1];
  return { id: elId(), layout: l.id, elements: l.make(w, h), notes: "", transition: "fade" };
}

export function newDeck(theme = "office"): Deck {
  const d: Deck = { slides: [], theme, ratio: "16:9" };
  d.slides.push(newSlide("title", d));
  return d;
}

// ------------------------------------------------------------------ rendering (pure HTML)

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** SVG path for a shape kind in a w×h box. */
export function shapePath(kind: ShapeKind, w: number, h: number): string {
  const p = (pts: [number, number][]) => "M" + pts.map(([x, y]) => `${(x * w).toFixed(1)},${(y * h).toFixed(1)}`).join(" L") + " Z";
  switch (kind) {
    case "triangle":
      return p([[0.5, 0], [1, 1], [0, 1]]);
    case "rightTriangle":
      return p([[0, 0], [1, 1], [0, 1]]);
    case "diamond":
      return p([[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]]);
    case "pentagon":
      return p([[0.5, 0], [1, 0.38], [0.81, 1], [0.19, 1], [0, 0.38]]);
    case "hexagon":
      return p([[0.25, 0], [0.75, 0], [1, 0.5], [0.75, 1], [0.25, 1], [0, 0.5]]);
    case "octagon":
      return p([[0.29, 0], [0.71, 0], [1, 0.29], [1, 0.71], [0.71, 1], [0.29, 1], [0, 0.71], [0, 0.29]]);
    case "star5": {
      const pts: [number, number][] = [];
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? 0.2 : 0.5;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        pts.push([0.5 + r * Math.cos(a), 0.52 + r * 1.04 * Math.sin(a)]);
      }
      return p(pts);
    }
    case "arrowRight":
      return p([[0, 0.3], [0.62, 0.3], [0.62, 0], [1, 0.5], [0.62, 1], [0.62, 0.7], [0, 0.7]]);
    case "arrowLeft":
      return p([[1, 0.3], [0.38, 0.3], [0.38, 0], [0, 0.5], [0.38, 1], [0.38, 0.7], [1, 0.7]]);
    case "arrowUp":
      return p([[0.3, 1], [0.3, 0.38], [0, 0.38], [0.5, 0], [1, 0.38], [0.7, 0.38], [0.7, 1]]);
    case "arrowDown":
      return p([[0.3, 0], [0.3, 0.62], [0, 0.62], [0.5, 1], [1, 0.62], [0.7, 0.62], [0.7, 0]]);
    case "chevron":
      return p([[0, 0], [0.75, 0], [1, 0.5], [0.75, 1], [0, 1], [0.25, 0.5]]);
    case "parallelogram":
      return p([[0.2, 0], [1, 0], [0.8, 1], [0, 1]]);
    case "trapezoid":
      return p([[0.2, 0], [0.8, 0], [1, 1], [0, 1]]);
    case "plus":
      return p([[0.35, 0], [0.65, 0], [0.65, 0.35], [1, 0.35], [1, 0.65], [0.65, 0.65], [0.65, 1], [0.35, 1], [0.35, 0.65], [0, 0.65], [0, 0.35], [0.35, 0.35]]);
    case "heart":
      return `M${w / 2},${h * 0.3} C${w / 2},${h * 0.1} ${w * 0.1},${h * 0.02} ${w * 0.05},${h * 0.32} C0,${h * 0.6} ${w * 0.35},${h * 0.75} ${w / 2},${h} C${w * 0.65},${h * 0.75} ${w},${h * 0.6} ${w * 0.95},${h * 0.32} C${w * 0.9},${h * 0.02} ${w / 2},${h * 0.1} ${w / 2},${h * 0.3} Z`;
    case "speech":
      return `M${w * 0.08},0 H${w * 0.92} Q${w},0 ${w},${h * 0.12} V${h * 0.62} Q${w},${h * 0.75} ${w * 0.92},${h * 0.75} H${w * 0.35} L${w * 0.15},${h} L${w * 0.2},${h * 0.75} H${w * 0.08} Q0,${h * 0.75} 0,${h * 0.62} V${h * 0.12} Q0,0 ${w * 0.08},0 Z`;
    case "cloud":
      return `M${w * 0.25},${h * 0.85} C${w * 0.05},${h * 0.85} 0,${h * 0.55} ${w * 0.18},${h * 0.48} C${w * 0.12},${h * 0.2} ${w * 0.42},${h * 0.08} ${w * 0.52},${h * 0.28} C${w * 0.62},${h * 0.05} ${w * 0.9},${h * 0.15} ${w * 0.84},${h * 0.42} C${w},${h * 0.48} ${w},${h * 0.85} ${w * 0.78},${h * 0.85} Z`;
    default:
      return "";
  }
}

export function textCss(t: TextStyle | undefined, theme: Theme, role?: El["role"]): string {
  const s = t ?? { size: 20, align: "left", valign: "top" };
  const font = s.font ?? (role === "title" ? theme.titleFont : theme.bodyFont);
  const color = s.color ?? (role === "title" ? theme.title : theme.text);
  return [
    `font-family:'${font}',Calibri,Arial,sans-serif`,
    `font-size:${s.size}px`,
    `color:${color}`,
    s.bold ? "font-weight:700" : "",
    s.italic ? "font-style:italic" : "",
    s.underline ? "text-decoration:underline" : "",
    `text-align:${s.align}`,
    `line-height:${s.lineHeight ?? 1.18}`,
    "display:flex;flex-direction:column",
    `justify-content:${s.valign === "middle" ? "center" : s.valign === "bottom" ? "flex-end" : "flex-start"}`,
  ]
    .filter(Boolean)
    .join(";");
}

function tableHtml(el: El, theme: Theme): string {
  const t = el.table!;
  const color = t.color ?? theme.accent[0];
  const rows = t.rows
    .map((r, i) => `<tr>${r.map((c) => (i === 0 && t.header ? `<th style="background:${color};color:#fff;padding:6px 8px;border:1px solid ${color};text-align:left">${esc(c)}</th>` : `<td style="padding:6px 8px;border:1px solid #d0d0d0;background:${i % 2 ? "rgba(0,0,0,.03)" : "rgba(255,255,255,.9)"}">${esc(c)}</td>`)).join("")}</tr>`)
    .join("");
  return `<table style="width:100%;height:100%;border-collapse:collapse;font:${el.text?.size ?? 16}px '${theme.bodyFont}',Calibri,Arial,sans-serif;color:#222">${rows}</table>`;
}

function chartSvg(el: El, theme: Theme): string {
  const c = el.chart!;
  const W = el.w;
  const H = el.h;
  const colors = theme.accent;
  const textColor = theme.text;
  if (c.type === "pie" || c.type === "doughnut") {
    const vals = c.series[0]?.values ?? [];
    const total = vals.reduce((a, b) => a + Math.max(0, b), 0) || 1;
    const cx = W * 0.38;
    const cy = H / 2;
    const r = Math.min(W * 0.34, H * 0.42);
    let a0 = -Math.PI / 2;
    let paths = "";
    vals.forEach((v, i) => {
      const a1 = a0 + (Math.max(0, v) / total) * Math.PI * 2;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      paths += `<path d="M${cx},${cy} L${cx + r * Math.cos(a0)},${cy + r * Math.sin(a0)} A${r},${r} 0 ${large} 1 ${cx + r * Math.cos(a1)},${cy + r * Math.sin(a1)} Z" fill="${colors[i % colors.length]}" stroke="#fff" stroke-width="2"/>`;
      a0 = a1;
    });
    if (c.type === "doughnut") paths += `<circle cx="${cx}" cy="${cy}" r="${r * 0.55}" fill="${theme.bg.startsWith("#") ? theme.bg : "#fff"}"/>`;
    const legend = c.labels.map((l, i) => `<rect x="${W * 0.76}" y="${H * 0.2 + i * 22}" width="12" height="12" fill="${colors[i % colors.length]}"/><text x="${W * 0.76 + 18}" y="${H * 0.2 + i * 22 + 11}" font-size="13" fill="${textColor}">${esc(l)} (${Math.round(((vals[i] ?? 0) / total) * 100)}%)</text>`).join("");
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="100%" font-family="Calibri,Arial,sans-serif">${paths}${legend}</svg>`;
  }
  const n = c.labels.length;
  const all = c.series.flatMap((s) => s.values);
  const max = Math.max(1, ...all);
  const left = 44;
  const bottom = 36;
  const top = 14;
  const right = 12;
  const pw = W - left - right;
  const ph = H - top - bottom - (c.series.length > 1 ? 22 : 0);
  let g = "";
  for (let i = 0; i <= 4; i++) {
    const y = top + ph - (ph * i) / 4;
    g += `<line x1="${left}" x2="${W - right}" y1="${y}" y2="${y}" stroke="${textColor}" stroke-opacity=".15"/><text x="${left - 6}" y="${y + 4}" text-anchor="end" font-size="11" fill="${textColor}" fill-opacity=".8">${+((max * i) / 4).toPrecision(3)}</text>`;
  }
  const slot = pw / Math.max(1, n);
  c.labels.forEach((l, i) => (g += `<text x="${left + slot * (i + 0.5)}" y="${top + ph + 18}" text-anchor="middle" font-size="12" fill="${textColor}">${esc(l)}</text>`));
  if (c.type === "line") {
    c.series.forEach((s, si) => {
      const pts = s.values.map((v, i) => `${left + slot * (i + 0.5)},${top + ph - (ph * v) / max}`).join(" ");
      g += `<polyline points="${pts}" fill="none" stroke="${colors[si % colors.length]}" stroke-width="3"/>` + s.values.map((v, i) => `<circle cx="${left + slot * (i + 0.5)}" cy="${top + ph - (ph * v) / max}" r="4" fill="${colors[si % colors.length]}"/>`).join("");
    });
  } else {
    const bw = (slot * 0.7) / c.series.length;
    c.series.forEach((s, si) =>
      s.values.forEach((v, i) => {
        const bh = (ph * Math.max(0, v)) / max;
        g += `<rect x="${left + slot * i + slot * 0.15 + si * bw}" y="${top + ph - bh}" width="${bw - 2}" height="${bh}" fill="${colors[si % colors.length]}" rx="2"/>`;
      }),
    );
  }
  if (c.series.length > 1) g += c.series.map((s, i) => `<rect x="${left + i * 120}" y="${H - 16}" width="12" height="12" fill="${colors[i % colors.length]}"/><text x="${left + i * 120 + 16}" y="${H - 6}" font-size="12" fill="${textColor}">${esc(s.name)}</text>`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="100%" font-family="Calibri,Arial,sans-serif">${g}</svg>`;
}

/** Inner HTML of one element (its box is positioned by the caller). */
export function elementInner(el: El, theme: Theme, opts: { editingText?: boolean } = {}): string {
  const text = el.html !== undefined && !opts.editingText ? `<div class="sl-text" style="position:absolute;inset:0;padding:${el.type === "shape" ? "8px 12px" : "4px 6px"};overflow:hidden;${textCss(el.text, theme, el.role)}">${el.html}</div>` : "";
  if (el.type === "shape" && el.shape) {
    const s = el.shape;
    const stroke = s.stroke ? `stroke="${s.stroke}" stroke-width="${s.strokeW ?? 2}"` : 'stroke="none"';
    const fill = s.fill ?? theme.accent[0];
    const shadow = s.shadow ? "filter:drop-shadow(0 4px 8px rgba(0,0,0,.25));" : "";
    let body: string;
    if (s.kind === "rect") body = `<div style="position:absolute;inset:0;background:${fill};${s.stroke ? `border:${s.strokeW ?? 2}px solid ${s.stroke};` : ""}border-radius:${el.radius ?? 0}px;${shadow}"></div>`;
    else if (s.kind === "roundRect") body = `<div style="position:absolute;inset:0;background:${fill};${s.stroke ? `border:${s.strokeW ?? 2}px solid ${s.stroke};` : ""}border-radius:${Math.min(el.w, el.h) * 0.18}px;${shadow}"></div>`;
    else if (s.kind === "ellipse") body = `<div style="position:absolute;inset:0;background:${fill};${s.stroke ? `border:${s.strokeW ?? 2}px solid ${s.stroke};` : ""}border-radius:50%;${shadow}"></div>`;
    else if (s.kind === "line" || s.kind === "arrowLine") {
      const col = s.stroke ?? fill;
      body = `<svg width="100%" height="100%" viewBox="0 0 ${el.w} ${el.h}" preserveAspectRatio="none" style="position:absolute;inset:0;overflow:visible"><defs><marker id="ah-${el.id}" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10 Z" fill="${col}"/></marker></defs><line x1="0" y1="${el.h / 2}" x2="${el.w}" y2="${el.h / 2}" stroke="${col}" stroke-width="${s.strokeW ?? 3}" ${s.kind === "arrowLine" ? `marker-end="url(#ah-${el.id})"` : ""}/></svg>`;
    } else body = `<svg width="100%" height="100%" viewBox="0 0 ${el.w} ${el.h}" preserveAspectRatio="none" style="position:absolute;inset:0;overflow:visible;${shadow}"><path d="${shapePath(s.kind, el.w, el.h)}" fill="${fill}" ${stroke} vector-effect="non-scaling-stroke"/></svg>`;
    return body + text;
  }
  if (el.type === "image") return `<img src="${esc(el.src ?? "")}" alt="" draggable="false" style="position:absolute;inset:0;width:100%;height:100%;object-fit:${el.fit ?? "cover"};border-radius:${el.radius ?? 0}px">`;
  if (el.type === "table" && el.table) return tableHtml(el, theme);
  if (el.type === "chart" && el.chart) return chartSvg(el, theme);
  return text;
}

export function boxCss(el: El): string {
  return `position:absolute;left:${el.x}px;top:${el.y}px;width:${el.w}px;height:${el.h}px;transform:rotate(${el.rot}deg);opacity:${el.opacity ?? 1}`;
}

/** A whole slide as static HTML at its native size (960×540 or 720×540). */
export function slideHtml(slide: Slide, deck: Deck, opts: { animStep?: number } = {}): string {
  const theme = themeOf(deck.theme);
  const { w, h } = SIZE[deck.ratio];
  const els = slide.elements
    .map((el) => {
      const hidden = opts.animStep !== undefined && el.anim && el.anim.type !== "none" && el.anim.order > opts.animStep;
      return `<div class="sl-el" data-id="${el.id}" style="${boxCss(el)}${hidden ? ";visibility:hidden" : ""}">${elementInner(el, theme)}</div>`;
    })
    .join("");
  return `<div class="sl-slide" style="position:relative;width:${w}px;height:${h}px;overflow:hidden;background:${slide.bg ?? theme.bg}">${slide.bg ? "" : theme.deco ?? ""}${els}</div>`;
}

/** CSS that text inside slides needs (lists, paragraphs). */
export const SLIDE_CSS = `.sl-text p{margin:0}.sl-text ul,.sl-text ol{margin:0;padding-left:1.15em}.sl-text ul{list-style:disc}.sl-text ol{list-style:decimal}.sl-text ul ul{list-style:circle}.sl-text li{margin:0 0 .35em}.sl-text ul li::marker{color:var(--accent,#4472c4)}.sl-text a{color:inherit;text-decoration:underline}`;
