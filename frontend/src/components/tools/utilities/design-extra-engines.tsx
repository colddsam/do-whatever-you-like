"use client";

import { useMemo, useState } from "react";
import { Check, Download, RotateCcw, Shuffle } from "lucide-react";
import { contrast, parseColor, rgbToHsl, toHex, type Rgb } from "@/lib/dev";
import { saveBlob } from "@/lib/files";
import { formatBytes } from "@/lib/media";
import { cn } from "@/lib/utils";
import { Chips, Panel, Row, Slider, TextField, Toggle } from "../pdf/kit";
import { CopyButton, Editor, Output, TextFilePick } from "../dev/parts";
import { ColorField } from "./design-engines";
import type { EngineProps } from "./text-engines";

/* ========================================================================
 * 1. SVG OPTIMIZER (SVGO-STYLE) & SVG -> REACT JSX / TSX CONVERTER
 * ======================================================================== */

const SAMPLE_SVG = `<?xml version="1.0" encoding="utf-8"?>
<!-- Generator: Design Studio Export -->
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="64" height="64" viewBox="0 0 64 64" fill="none">
  <metadata>Created for web export</metadata>
  <g id="icon-layer">
    <rect x="6.000" y="6.000" width="52.000" height="52.000" rx="14.000" fill="#18181B" />
    <path d="M20.000 33.500 L28.250 41.750 L44.500 22.250" stroke="#22C55E" stroke-width="5.000" stroke-linecap="round" stroke-linejoin="round" style="fill:none;opacity:1" />
  </g>
</svg>`;

const SVG_ATTR_TO_JSX: Record<string, string> = {
  class: "className",
  for: "htmlFor",
  tabindex: "tabIndex",
  "accent-height": "accentHeight",
  "alignment-baseline": "alignmentBaseline",
  "arabic-form": "arabicForm",
  "baseline-shift": "baselineShift",
  "cap-height": "capHeight",
  "clip-path": "clipPath",
  "clip-rule": "clipRule",
  "color-interpolation": "colorInterpolation",
  "color-interpolation-filters": "colorInterpolationFilters",
  "color-profile": "colorProfile",
  "color-rendering": "colorRendering",
  "dominant-baseline": "dominantBaseline",
  "enable-background": "enableBackground",
  "fill-opacity": "fillOpacity",
  "fill-rule": "fillRule",
  "flood-color": "floodColor",
  "flood-opacity": "floodOpacity",
  "font-family": "fontFamily",
  "font-size": "fontSize",
  "font-size-adjust": "fontSizeAdjust",
  "font-stretch": "fontStretch",
  "font-style": "fontStyle",
  "font-variant": "fontVariant",
  "font-weight": "fontWeight",
  "glyph-orientation-horizontal": "glyphOrientationHorizontal",
  "glyph-orientation-vertical": "glyphOrientationVertical",
  "horiz-adv-x": "horizAdvX",
  "horiz-origin-x": "horizOriginX",
  "image-rendering": "imageRendering",
  "letter-spacing": "letterSpacing",
  "lighting-color": "lightingColor",
  "marker-end": "markerEnd",
  "marker-mid": "markerMid",
  "marker-start": "markerStart",
  "overline-position": "overlinePosition",
  "overline-thickness": "overlineThickness",
  "paint-order": "paintOrder",
  "panose-1": "panose1",
  "pointer-events": "pointerEvents",
  "rendering-intent": "renderingIntent",
  "shape-rendering": "shapeRendering",
  "stop-color": "stopColor",
  "stop-opacity": "stopOpacity",
  "strikethrough-position": "strikethroughPosition",
  "strikethrough-thickness": "strikethroughThickness",
  "stroke-dasharray": "strokeDasharray",
  "stroke-dashoffset": "strokeDashoffset",
  "stroke-linecap": "strokeLinecap",
  "stroke-linejoin": "strokeLinejoin",
  "stroke-miterlimit": "strokeMiterlimit",
  "stroke-opacity": "strokeOpacity",
  "stroke-width": "strokeWidth",
  "text-anchor": "textAnchor",
  "text-decoration": "textDecoration",
  "text-rendering": "textRendering",
  "underline-position": "underlinePosition",
  "underline-thickness": "underlineThickness",
  "unicode-bidi": "unicodeBidi",
  "unicode-range": "unicodeRange",
  "units-per-em": "unitsPerEm",
  "v-alphabetic": "vAlphabetic",
  "v-hanging": "vHanging",
  "v-ideographic": "vIdeographic",
  "v-mathematical": "vMathematical",
  "vector-effect": "vectorEffect",
  "vert-adv-y": "vertAdvY",
  "vert-origin-x": "vertOriginX",
  "vert-origin-y": "vertOriginY",
  "word-spacing": "wordSpacing",
  "writing-mode": "writingMode",
  "x-height": "xHeight",
  "xlink:href": "xlinkHref",
  "xlink:title": "xlinkTitle",
  "xml:space": "xmlSpace",
};

function roundSvgNumbers(text: string, decimals: number): string {
  return text.replace(/-?\d+\.\d+/g, (m) => {
    const n = Number(m);
    if (!Number.isFinite(n)) return m;
    return String(Number(n.toFixed(decimals)));
  });
}

function cssStyleToJsxObject(styleStr: string): string {
  const entries = styleStr
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pair) => {
      const idx = pair.indexOf(":");
      if (idx < 0) return null;
      const rawKey = pair.slice(0, idx).trim();
      const rawVal = pair.slice(idx + 1).trim();
      const camel = rawKey.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
      const numVal = /^-?\d+(?:\.\d+)?$/.test(rawVal) ? rawVal : JSON.stringify(rawVal);
      return `${camel}: ${numVal}`;
    })
    .filter(Boolean);
  return `{{ ${entries.join(", ")} }}`;
}

export function optimizeSvgString(
  raw: string,
  opts: { stripMeta: boolean; stripIds: boolean; removeHidden: boolean; roundNumbers: boolean; decimals: number; currentColor: boolean },
): { svg: string; error?: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { svg: "" };
  if (typeof DOMParser === "undefined") return { svg: trimmed };

  const cleaned = trimmed
    .replace(/<\?xml[\s\S]*?\?>/gi, "")
    .replace(/<!DOCTYPE[\s\S]*?>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  const doc = new DOMParser().parseFromString(cleaned, "image/svg+xml");
  const parseErr = doc.querySelector("parsererror");
  if (parseErr) return { svg: "", error: parseErr.textContent?.split("\n")[0] || "Invalid SVG XML syntax." };
  const root = doc.documentElement;
  if (!root || root.tagName.toLowerCase() !== "svg") {
    return { svg: "", error: "Root element must be <svg>." };
  }

  // Always remove unsafe executable elements
  root.querySelectorAll("script, foreignObject").forEach((el) => el.remove());
  if (opts.stripMeta) {
    root.querySelectorAll("metadata, title, desc").forEach((el) => el.remove());
  }
  if (opts.removeHidden) {
    root.querySelectorAll("[display='none'], [visibility='hidden'], [opacity='0']").forEach((el) => el.remove());
  }

  // Prune empty <g> / <defs>
  let pruned = true;
  while (pruned) {
    pruned = false;
    root.querySelectorAll("g, defs").forEach((el) => {
      if (el.children.length === 0 && !(el.textContent ?? "").trim()) {
        el.remove();
        pruned = true;
      }
    });
  }

  const all = [root, ...Array.from(root.querySelectorAll("*"))];
  for (const el of all) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name;
      if (name.toLowerCase().startsWith("on")) {
        el.removeAttribute(name);
        continue;
      }
      if (opts.stripMeta && /^(inkscape:|sodipodi:|sketch:|data-name$|xmlns:(?:inkscape|sodipodi|sketch))/i.test(name)) {
        el.removeAttribute(name);
        continue;
      }
      if (name === "xmlns:xlink" && !trimmed.includes("xlink:href")) {
        el.removeAttribute(name);
        continue;
      }
      if (opts.stripIds && name === "id" && el !== root && !trimmed.includes(`#${attr.value}`)) {
        el.removeAttribute(name);
        continue;
      }
      if (opts.currentColor && (name === "fill" || name === "stroke") && attr.value !== "none" && attr.value !== "transparent" && !attr.value.startsWith("url(")) {
        el.setAttribute(name, "currentColor");
        continue;
      }
      if (opts.roundNumbers) {
        const rounded = roundSvgNumbers(attr.value, opts.decimals);
        if (rounded !== attr.value) el.setAttribute(name, rounded);
      }
    }
  }

  const serialized = new XMLSerializer().serializeToString(root).replace(/>\s+</g, "><").replace(/\s{2,}/g, " ").trim();
  return { svg: serialized };
}

export function svgToJsxComponent(
  cleanSvg: string,
  componentName: string,
  typescript: boolean,
): string {
  if (!cleanSvg) return "";
  if (typeof DOMParser === "undefined") return cleanSvg;
  const doc = new DOMParser().parseFromString(cleanSvg, "image/svg+xml");
  const root = doc.documentElement;
  const safeName = /^[A-Z][A-Za-z0-9]*$/.test(componentName) ? componentName : "SvgIcon";

  const emitAttr = (name: string, value: string): string => {
    if (name === "xmlns") return "";
    if (name === "style") return `style=${cssStyleToJsxObject(value)}`;
    const lower = name.toLowerCase();
    const jsxName =
      SVG_ATTR_TO_JSX[lower] ??
      (name.includes("-") && !name.startsWith("aria-") && !name.startsWith("data-")
        ? name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
        : name.includes(":")
          ? name.replace(/:([a-z])/g, (_, c: string) => c.toUpperCase())
          : name);
    return `${jsxName}=${JSON.stringify(value)}`;
  };

  const renderNode = (node: Element, depth: number): string => {
    const pad = "  ".repeat(depth);
    const attrs = Array.from(node.attributes)
      .map((a) => emitAttr(a.name, a.value))
      .filter(Boolean);
    if (node === root) attrs.push("{...props}");
    const open = attrs.length ? `<${node.tagName} ${attrs.join(" ")}` : `<${node.tagName}`;
    const children = Array.from(node.children);
    const text = children.length === 0 ? (node.textContent ?? "").trim() : "";
    if (children.length === 0 && !text) return `${pad}${open} />`;
    if (children.length === 0 && text) return `${pad}${open}>${text}</${node.tagName}>`;
    const inner = children.map((c) => renderNode(c, depth + 1)).join("\n");
    return `${pad}${open}>\n${inner}\n${pad}</${node.tagName}>`;
  };

  const jsxTree = renderNode(root, 2);
  if (typescript) {
    return `import type { SVGProps } from "react";\n\nexport function ${safeName}(props: SVGProps<SVGSVGElement>) {\n  return (\n${jsxTree}\n  );\n}`;
  }
  return `export function ${safeName}(props) {\n  return (\n${jsxTree}\n  );\n}`;
}

export function SvgOptimizerEngine({ preset }: EngineProps) {
  const initOut = preset.mode === "jsx" ? "jsx" : preset.mode === "tsx" ? "tsx" : "svg";
  const [input, setInput] = useState(SAMPLE_SVG);
  const [outMode, setOutMode] = useState<"svg" | "jsx" | "tsx" | "datauri">(initOut);
  const [compName, setCompName] = useState("CheckBadgeIcon");
  const [stripMeta, setStripMeta] = useState(true);
  const [stripIds, setStripIds] = useState(true);
  const [removeHidden, setRemoveHidden] = useState(true);
  const [roundNumbers, setRoundNumbers] = useState(true);
  const [decimals, setDecimals] = useState(2);
  const [currentColor, setCurrentColor] = useState(false);

  const optimized = useMemo(
    () => optimizeSvgString(input, { stripMeta, stripIds, removeHidden, roundNumbers, decimals, currentColor }),
    [input, stripMeta, stripIds, removeHidden, roundNumbers, decimals, currentColor],
  );

  const outputText = useMemo(() => {
    if (optimized.error || !optimized.svg) return "";
    if (outMode === "svg") return optimized.svg;
    if (outMode === "jsx") return svgToJsxComponent(optimized.svg, compName, false);
    if (outMode === "tsx") return svgToJsxComponent(optimized.svg, compName, true);
    return `background-image: url("data:image/svg+xml,${encodeURIComponent(optimized.svg)}");`;
  }, [optimized, outMode, compName]);

  const rawBytes = new TextEncoder().encode(input.trim()).length;
  const optBytes = new TextEncoder().encode(optimized.svg).length;
  const savedPct = rawBytes > 0 && optBytes > 0 ? Math.max(0, ((rawBytes - optBytes) / rawBytes) * 100).toFixed(1) : "0";
  const ext = outMode === "jsx" ? "jsx" : outMode === "tsx" ? "tsx" : outMode === "datauri" ? "css" : "svg";

  return (
    <>
      <Panel>
        <Row label="Output">
          <Chips
            value={outMode}
            onChange={setOutMode}
            options={[
              { value: "svg", label: "Optimized SVG" },
              { value: "jsx", label: "React JSX" },
              { value: "tsx", label: "React TSX" },
              { value: "datauri", label: "CSS Data URI" },
            ]}
          />
        </Row>
        {(outMode === "jsx" || outMode === "tsx") && (
          <Row label="Component">
            <div className="max-w-60">
              <TextField value={compName} onChange={setCompName} label="Component name" placeholder="CheckBadgeIcon" mono />
            </div>
          </Row>
        )}
        <Row label="Optimizations">
          <div className="grid gap-2.5 sm:grid-cols-2">
            <Toggle checked={stripMeta} onChange={setStripMeta} label="Strip XML, comments & metadata" />
            <Toggle checked={stripIds} onChange={setStripIds} label="Remove unreferenced IDs" />
            <Toggle checked={removeHidden} onChange={setRemoveHidden} label="Drop hidden nodes" />
            <Toggle checked={roundNumbers} onChange={setRoundNumbers} label={`Round coordinates (${decimals} decimals)`} />
            <Toggle checked={currentColor} onChange={setCurrentColor} label="Use fill/stroke currentColor" />
          </div>
          {roundNumbers && (
            <div className="mt-3 max-w-xs">
              <Slider value={decimals} min={0} max={4} onChange={setDecimals} label="Decimal precision" />
            </div>
          )}
        </Row>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
        <Editor
          value={input}
          onChange={setInput}
          name="source.svg"
          rows={9}
          placeholder="Paste raw <svg> markup or drop an .svg file"
          actions={
            <div className="flex items-center gap-1.5">
              <TextFilePick accept=".svg" onText={setInput} />
              <button
                type="button"
                onClick={() => setInput(SAMPLE_SVG)}
                className="inline-flex h-8 items-center rounded-[8px] border border-line bg-surface px-2.5 text-[12px] text-ink-2 hover:text-ink"
              >
                Sample
              </button>
            </div>
          }
        />
        <div className="flex flex-col justify-between gap-2 rounded-md border border-line bg-surface p-3">
          <p className="label-mono text-ink-3">Preview</p>
          <div className="grid min-h-36 place-items-center rounded-sm border border-line bg-[repeating-conic-gradient(var(--color-paper-2)_0%_25%,var(--color-surface)_0%_50%)] bg-[length:16px_16px] p-4">
            {optimized.svg ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`data:image/svg+xml;utf8,${encodeURIComponent(optimized.svg)}`}
                alt="Optimized SVG preview"
                className="max-h-28 max-w-full object-contain"
              />
            ) : (
              <span className="text-xs text-ink-3">No SVG</span>
            )}
          </div>
          <div className="space-y-0.5 font-mono text-[12px]">
            <p className="text-ink-2">
              {formatBytes(rawBytes)} → <strong className="text-ink">{formatBytes(optBytes)}</strong>
            </p>
            <p className="text-success">Saved {savedPct}%</p>
          </div>
        </div>
      </div>

      <Output
        value={outputText}
        name={`icon.${ext}`}
        lang={outMode.toUpperCase()}
        error={optimized.error}
        download={`icon.${ext}`}
        wrap={outMode !== "jsx" && outMode !== "tsx"}
      />
    </>
  );
}

/* ========================================================================
 * 2. CSS GRID & FLEXBOX PLAYGROUND
 * ======================================================================== */

type ItemSpan = { colSpan: number; rowSpan: number; grow: number };

export function LayoutPlaygroundEngine({ preset }: EngineProps) {
  const [mode, setMode] = useState<"grid" | "flex">(() => (preset.mode === "flex" ? "flex" : "grid"));
  const [cols, setCols] = useState(3);
  const [rows, setRows] = useState(2);
  const [gap, setGap] = useState(12);
  const [alignItems, setAlignItems] = useState<"stretch" | "start" | "center" | "end">("stretch");
  const [justifyContent, setJustifyContent] = useState<"flex-start" | "center" | "flex-end" | "space-between" | "space-evenly">("flex-start");
  const [flexDir, setFlexDir] = useState<"row" | "column" | "row-reverse">("row");
  const [flexWrap, setFlexWrap] = useState<"wrap" | "nowrap">("wrap");
  const [count, setCount] = useState(6);
  const [selected, setSelected] = useState(0);
  const [spans, setSpans] = useState<ItemSpan[]>(() => Array.from({ length: 12 }, () => ({ colSpan: 1, rowSpan: 1, grow: 0 })));
  const [codeTab, setCodeTab] = useState<"css" | "tailwind" | "html">("tailwind");

  const updateItem = (idx: number, patch: Partial<ItemSpan>) => {
    setSpans((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  const resetAll = () => {
    setCols(3);
    setRows(2);
    setGap(12);
    setCount(6);
    setSelected(0);
    setSpans(Array.from({ length: 12 }, () => ({ colSpan: 1, rowSpan: 1, grow: 0 })));
  };

  const activeItem = spans[selected] ?? { colSpan: 1, rowSpan: 1, grow: 0 };

  const code = useMemo(() => {
    const alignCss = alignItems === "start" ? "flex-start" : alignItems === "end" ? "flex-end" : alignItems;
    if (mode === "grid") {
      const twAlign = alignItems === "stretch" ? "items-stretch" : alignItems === "start" ? "items-start" : alignItems === "center" ? "items-center" : "items-end";
      const twGap = gap % 4 === 0 ? `gap-${gap / 4}` : `gap-[${gap}px]`;
      const containerTw = `grid grid-cols-${cols} grid-rows-${rows} ${twGap} ${twAlign}`;
      const childTwLines = spans
        .slice(0, count)
        .map((s, i) => {
          const cls = [s.colSpan > 1 ? `col-span-${Math.min(cols, s.colSpan)}` : "", s.rowSpan > 1 ? `row-span-${Math.min(rows, s.rowSpan)}` : ""].filter(Boolean).join(" ");
          return `  <div${cls ? ` className="${cls}"` : ""}>Item ${i + 1}</div>`;
        })
        .join("\n");
      const css = [
        `.container {`,
        `  display: grid;`,
        `  grid-template-columns: repeat(${cols}, minmax(0, 1fr));`,
        `  grid-template-rows: repeat(${rows}, minmax(80px, auto));`,
        `  gap: ${gap}px;`,
        `  align-items: ${alignCss};`,
        `}`,
        ...spans
          .slice(0, count)
          .map((s, i) => {
            const rules: string[] = [];
            if (s.colSpan > 1) rules.push(`  grid-column: span ${Math.min(cols, s.colSpan)};`);
            if (s.rowSpan > 1) rules.push(`  grid-row: span ${Math.min(rows, s.rowSpan)};`);
            return rules.length ? `\n.item-${i + 1} {\n${rules.join("\n")}\n}` : "";
          })
          .filter(Boolean),
      ].join("\n");
      const tailwind = `<div className="${containerTw}">\n${childTwLines}\n</div>`;
      const html = `<div class="container">\n${spans
        .slice(0, count)
        .map((_, i) => `  <div class="item-${i + 1}">Item ${i + 1}</div>`)
        .join("\n")}\n</div>`;
      return { css, tailwind, html };
    }

    const twDir = flexDir === "row" ? "flex-row" : flexDir === "column" ? "flex-col" : "flex-row-reverse";
    const twWrap = flexWrap === "wrap" ? "flex-wrap" : "flex-nowrap";
    const twJustify =
      justifyContent === "flex-start"
        ? "justify-start"
        : justifyContent === "center"
          ? "justify-center"
          : justifyContent === "flex-end"
            ? "justify-end"
            : justifyContent === "space-between"
              ? "justify-between"
              : "justify-evenly";
    const twAlign = alignItems === "stretch" ? "items-stretch" : alignItems === "start" ? "items-start" : alignItems === "center" ? "items-center" : "items-end";
    const twGap = gap % 4 === 0 ? `gap-${gap / 4}` : `gap-[${gap}px]`;
    const containerTw = `flex ${twDir} ${twWrap} ${twJustify} ${twAlign} ${twGap}`;
    const css = [
      `.container {`,
      `  display: flex;`,
      `  flex-direction: ${flexDir};`,
      `  flex-wrap: ${flexWrap};`,
      `  justify-content: ${justifyContent};`,
      `  align-items: ${alignCss};`,
      `  gap: ${gap}px;`,
      `}`,
      ...spans
        .slice(0, count)
        .map((s, i) => (s.grow > 0 ? `\n.item-${i + 1} {\n  flex-grow: ${s.grow};\n}` : ""))
        .filter(Boolean),
    ].join("\n");
    const tailwind = `<div className="${containerTw}">\n${spans
      .slice(0, count)
      .map((s, i) => `  <div${s.grow > 0 ? ` className="grow-[${s.grow}]"` : ""}>Item ${i + 1}</div>`)
      .join("\n")}\n</div>`;
    const html = `<div class="container">\n${spans
      .slice(0, count)
      .map((_, i) => `  <div class="item-${i + 1}">Item ${i + 1}</div>`)
      .join("\n")}\n</div>`;
    return { css, tailwind, html };
  }, [mode, cols, rows, gap, alignItems, justifyContent, flexDir, flexWrap, count, spans]);

  return (
    <>
      <Panel>
        <Row label="Layout">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Chips
              value={mode}
              onChange={setMode}
              options={[
                { value: "grid", label: "CSS Grid" },
                { value: "flex", label: "Flexbox" },
              ]}
            />
            <button
              type="button"
              onClick={resetAll}
              className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-line bg-surface px-2.5 text-[12px] text-ink-2 hover:text-ink"
            >
              <RotateCcw aria-hidden className="size-3.5" /> Reset
            </button>
          </div>
        </Row>
        {mode === "grid" ? (
          <Row label="Grid tracks">
            <div className="grid gap-3 @xl:grid-cols-2">
              <Slider label="Columns" value={cols} min={1} max={6} onChange={setCols} />
              <Slider label="Rows" value={rows} min={1} max={4} onChange={setRows} />
              <Slider label="Gap" value={gap} min={0} max={40} step={4} onChange={setGap} format={(v) => `${v} px`} />
              <Slider label="Items" value={count} min={1} max={12} onChange={setCount} />
            </div>
          </Row>
        ) : (
          <>
            <Row label="Direction & wrap">
              <div className="flex flex-wrap gap-2">
                <Chips
                  value={flexDir}
                  onChange={setFlexDir}
                  options={[
                    { value: "row", label: "Row" },
                    { value: "column", label: "Column" },
                    { value: "row-reverse", label: "Row reverse" },
                  ]}
                />
                <Chips
                  value={flexWrap}
                  onChange={setFlexWrap}
                  options={[
                    { value: "wrap", label: "Wrap" },
                    { value: "nowrap", label: "No wrap" },
                  ]}
                />
              </div>
            </Row>
            <Row label="Justify content">
              <Chips
                value={justifyContent}
                onChange={setJustifyContent}
                options={[
                  { value: "flex-start", label: "Start" },
                  { value: "center", label: "Center" },
                  { value: "flex-end", label: "End" },
                  { value: "space-between", label: "Between" },
                  { value: "space-evenly", label: "Evenly" },
                ]}
              />
            </Row>
            <Row label="Spacing & items">
              <div className="grid gap-3 @xl:grid-cols-2">
                <Slider label="Gap" value={gap} min={0} max={40} step={4} onChange={setGap} format={(v) => `${v} px`} />
                <Slider label="Items" value={count} min={2} max={10} onChange={setCount} />
              </div>
            </Row>
          </>
        )}
        <Row label="Align items">
          <Chips
            value={alignItems}
            onChange={setAlignItems}
            options={[
              { value: "stretch", label: "Stretch" },
              { value: "start", label: "Start" },
              { value: "center", label: "Center" },
              { value: "end", label: "End" },
            ]}
          />
        </Row>
        <Row label={`Selected: #${selected + 1}`}>
          <div className="grid gap-3 @xl:grid-cols-2">
            {mode === "grid" ? (
              <>
                <Slider
                  label="Column span"
                  value={Math.min(cols, activeItem.colSpan)}
                  min={1}
                  max={cols}
                  onChange={(v) => updateItem(selected, { colSpan: v })}
                />
                <Slider
                  label="Row span"
                  value={Math.min(rows, activeItem.rowSpan)}
                  min={1}
                  max={rows}
                  onChange={(v) => updateItem(selected, { rowSpan: v })}
                />
              </>
            ) : (
              <Slider
                label="flex-grow"
                value={activeItem.grow}
                min={0}
                max={4}
                onChange={(v) => updateItem(selected, { grow: v })}
              />
            )}
          </div>
          <p className="mt-1.5 text-xs text-ink-3">Click any box in the preview below to edit its span or grow factor.</p>
        </Row>
      </Panel>

      {/* Live interactive visual stage */}
      <div className="overflow-x-auto rounded-md border border-line bg-paper p-4">
        <div
          className="min-h-56 rounded-sm border border-dashed border-ink-3/40 bg-surface p-3"
          style={
            mode === "grid"
              ? {
                  display: "grid",
                  gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                  gridTemplateRows: `repeat(${rows}, minmax(72px, auto))`,
                  gap: `${gap}px`,
                  alignItems: alignItems === "start" ? "start" : alignItems === "end" ? "end" : alignItems,
                }
              : {
                  display: "flex",
                  flexDirection: flexDir,
                  flexWrap,
                  justifyContent,
                  alignItems: alignItems === "start" ? "flex-start" : alignItems === "end" ? "flex-end" : alignItems,
                  gap: `${gap}px`,
                }
          }
        >
          {Array.from({ length: count }, (_, i) => {
            const sp = spans[i] ?? { colSpan: 1, rowSpan: 1, grow: 0 };
            const active = i === selected;
            return (
              <button
                key={i}
                type="button"
                onClick={() => setSelected(i)}
                style={
                  mode === "grid"
                    ? {
                        gridColumn: sp.colSpan > 1 ? `span ${Math.min(cols, sp.colSpan)}` : undefined,
                        gridRow: sp.rowSpan > 1 ? `span ${Math.min(rows, sp.rowSpan)}` : undefined,
                      }
                    : {
                        flexGrow: sp.grow,
                        minWidth: "76px",
                      }
                }
                className={cn(
                  "flex min-h-[64px] flex-col items-center justify-center rounded-[8px] border px-3 py-2 font-mono text-[13px] transition-colors",
                  active ? "border-accent bg-accent/10 font-semibold text-ink" : "border-line bg-paper text-ink-2 hover:border-ink-3 hover:text-ink",
                )}
              >
                <span>Item {i + 1}</span>
                {mode === "grid" && (sp.colSpan > 1 || sp.rowSpan > 1) && (
                  <span className="text-[12px] text-ink-3">
                    {sp.colSpan}×{sp.rowSpan}
                  </span>
                )}
                {mode === "flex" && sp.grow > 0 && <span className="text-[12px] text-ink-3">grow:{sp.grow}</span>}
              </button>
            );
          })}
        </div>
      </div>

      <Panel>
        <Row label="Output format">
          <Chips
            value={codeTab}
            onChange={setCodeTab}
            options={[
              { value: "tailwind", label: "Tailwind JSX" },
              { value: "css", label: "CSS" },
              { value: "html", label: "HTML" },
            ]}
          />
        </Row>
      </Panel>
      <Output
        value={code[codeTab]}
        name={codeTab === "css" ? "layout.css" : codeTab === "html" ? "layout.html" : "layout.tsx"}
        lang={codeTab.toUpperCase()}
      />
    </>
  );
}

/* ========================================================================
 * 3. COLOR PALETTE & TINT / SHADE SCALE (50–950) GENERATOR
 * ======================================================================== */

const TAILWIND_STOPS: { stop: number; l: number }[] = [
  { stop: 50, l: 97 },
  { stop: 100, l: 94 },
  { stop: 200, l: 86 },
  { stop: 300, l: 77 },
  { stop: 400, l: 66 },
  { stop: 500, l: 55 },
  { stop: 600, l: 46 },
  { stop: 700, l: 38 },
  { stop: 800, l: 30 },
  { stop: 900, l: 22 },
  { stop: 950, l: 13 },
];

function hslToRgbSafe(h: number, s: number, l: number): Rgb {
  const hue = ((h % 360) + 360) % 360;
  const sat = Math.max(0, Math.min(100, s));
  const lig = Math.max(0, Math.min(100, l));
  return parseColor(`hsl(${hue}, ${sat}%, ${lig}%)`) ?? { r: 0, g: 0, b: 0, a: 1 };
}

export function buildTailwindScale(hexInput: string) {
  const base = parseColor(hexInput) ?? { r: 37, g: 99, b: 235, a: 1 };
  const [h, s, baseL] = rgbToHsl(base);
  const stops = TAILWIND_STOPS.map(({ stop, l }) => {
    // Slightly soften chroma at the lightest/darkest extremes like curated design palettes.
    const edgeDamp = stop === 50 || stop === 950 ? 0.84 : stop === 100 || stop === 900 ? 0.92 : 1;
    const rgb = hslToRgbSafe(h, Math.round(s * edgeDamp), l);
    return { stop, rgb, hex: toHex({ ...rgb, a: 1 }), l };
  });
  // Snap the closest lightness stop to the user's exact base colour so their seed hex stays intact.
  let closestIdx = 0;
  let bestDist = Infinity;
  stops.forEach((item, idx) => {
    const d = Math.abs(item.l - baseL);
    if (d < bestDist) {
      bestDist = d;
      closestIdx = idx;
    }
  });
  const baseHex = toHex({ ...base, a: 1 });
  stops[closestIdx] = { ...stops[closestIdx], rgb: { ...base, a: 1 }, hex: baseHex, l: baseL };
  return { baseHex, baseStop: stops[closestIdx].stop, h, s, l: baseL, stops };
}

export function PaletteScaleEngine({ preset }: EngineProps) {
  const [seed, setSeed] = useState("#2563eb");
  const [tokenName, setTokenName] = useState("brand");
  const [harmonyKind, setHarmonyKind] = useState<"complementary" | "analogous" | "triadic" | "split" | "tetradic">(() =>
    preset.harmony === "analogous" || preset.harmony === "triadic" || preset.harmony === "split" || preset.harmony === "tetradic"
      ? preset.harmony
      : "complementary",
  );
  const [exportFmt, setExportFmt] = useState<"tw4" | "tw3" | "css" | "scss" | "json">("tw4");
  const [copiedHex, setCopiedHex] = useState<string | null>(null);

  const scale = useMemo(() => buildTailwindScale(seed), [seed]);
  const safeToken = tokenName.trim().toLowerCase().replace(/[^a-z0-9-_]+/g, "-") || "brand";

  const harmonies = useMemo(() => {
    const offsets: Record<typeof harmonyKind, number[]> = {
      complementary: [0, 180],
      analogous: [-30, 0, 30],
      triadic: [0, 120, 240],
      split: [0, 150, 210],
      tetradic: [0, 90, 180, 270],
    };
    return offsets[harmonyKind].map((deg) => {
      const rgb = hslToRgbSafe(scale.h + deg, Math.max(20, scale.s), scale.l);
      return { deg, hex: deg === 0 ? scale.baseHex : toHex({ ...rgb, a: 1 }) };
    });
  }, [scale, harmonyKind]);

  const exportText = useMemo(() => {
    if (exportFmt === "tw4") {
      return `@theme {\n${scale.stops.map((s) => `  --color-${safeToken}-${s.stop}: ${s.hex};`).join("\n")}\n}`;
    }
    if (exportFmt === "tw3") {
      return `${JSON.stringify(safeToken)}: {\n${scale.stops.map((s) => `  ${s.stop}: "${s.hex}",`).join("\n")}\n}`;
    }
    if (exportFmt === "css") {
      return `:root {\n${scale.stops.map((s) => `  --${safeToken}-${s.stop}: ${s.hex};`).join("\n")}\n}`;
    }
    if (exportFmt === "scss") {
      return scale.stops.map((s) => `$${safeToken}-${s.stop}: ${s.hex};`).join("\n");
    }
    return JSON.stringify(Object.fromEntries(scale.stops.map((s) => [s.stop, s.hex])), null, 2);
  }, [scale, safeToken, exportFmt]);

  const copyStop = async (hex: string) => {
    try {
      await navigator.clipboard.writeText(hex);
      setCopiedHex(hex);
      setTimeout(() => setCopiedHex((c) => (c === hex ? null : c)), 1400);
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <>
      <Panel>
        <Row label="Base colour">
          <div className="grid gap-3 @xl:grid-cols-[minmax(0,1fr)_180px_auto] @xl:items-center">
            <ColorField label="Seed colour" value={seed} onChange={setSeed} />
            <TextField value={tokenName} onChange={setTokenName} label="Token prefix" placeholder="brand" mono />
            <button
              type="button"
              onClick={() => {
                const h = Math.floor(Math.random() * 360);
                setSeed(toHex({ ...hslToRgbSafe(h, 72, 50), a: 1 }));
              }}
              className="inline-flex h-10 items-center justify-center gap-1.5 rounded-md border border-line bg-surface px-3 text-sm text-ink hover:border-ink-3"
            >
              <Shuffle aria-hidden className="size-4" /> Random
            </button>
          </div>
        </Row>
      </Panel>

      {/* 50-950 Tailwind scale strip */}
      <div className="overflow-hidden rounded-md border border-line bg-surface">
        <div className="flex items-center justify-between border-b border-line bg-paper px-3.5 py-2">
          <span className="label-mono text-ink-2">
            {safeToken} 50–950 scale (base pinned at {scale.baseStop})
          </span>
          <span className="font-mono text-[12px] text-ink-3">Click any shade to copy</span>
        </div>
        <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-11">
          {scale.stops.map(({ stop, rgb, hex }) => {
            const onWhite = contrast(rgb, { r: 255, g: 255, b: 255, a: 1 });
            const onBlack = contrast(rgb, { r: 0, g: 0, b: 0, a: 1 });
            const inkOnSwatch = onWhite >= onBlack ? "#ffffff" : "#0f172a";
            const bestRatio = Math.max(onWhite, onBlack);
            const isSeed = stop === scale.baseStop;
            return (
              <button
                key={stop}
                type="button"
                onClick={() => void copyStop(hex)}
                className={cn(
                  "group flex flex-col overflow-hidden rounded-[8px] border text-left transition-transform hover:-translate-y-0.5",
                  isSeed ? "border-ink ring-2 ring-ink/20" : "border-line",
                )}
              >
                <div className="flex h-16 flex-col justify-between p-2" style={{ backgroundColor: hex, color: inkOnSwatch }}>
                  <div className="flex items-center justify-between font-mono text-[12px] font-semibold">
                    <span>{stop}</span>
                    {copiedHex === hex ? <Check aria-hidden className="size-3.5" /> : isSeed ? <span>★</span> : null}
                  </div>
                  <span className="font-mono text-[12px] opacity-85">{bestRatio >= 7 ? "AAA" : bestRatio >= 4.5 ? "AA" : "Lg"}</span>
                </div>
                <div className="bg-surface px-2 py-1.5 font-mono text-[12px] text-ink-2">{hex}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Harmonies */}
      <Panel>
        <Row label="Colour harmony">
          <Chips
            value={harmonyKind}
            onChange={setHarmonyKind}
            options={[
              { value: "complementary", label: "Complementary" },
              { value: "analogous", label: "Analogous" },
              { value: "triadic", label: "Triadic" },
              { value: "split", label: "Split complementary" },
              { value: "tetradic", label: "Tetradic" },
            ]}
          />
          <div className="mt-3 grid gap-2 sm:grid-cols-4">
            {harmonies.map((item, idx) => (
              <div key={`${item.hex}-${idx}`} className="overflow-hidden rounded-[8px] border border-line bg-surface">
                <button
                  type="button"
                  onClick={() => setSeed(item.hex)}
                  title="Use as base colour"
                  className="block h-14 w-full transition-opacity hover:opacity-90"
                  style={{ backgroundColor: item.hex }}
                />
                <div className="flex items-center justify-between px-2.5 py-1.5">
                  <span className="font-mono text-[12px] text-ink">{item.hex}</span>
                  <CopyButton text={item.hex} label="Copy" />
                </div>
              </div>
            ))}
          </div>
        </Row>
      </Panel>

      {/* Token export */}
      <Panel>
        <Row label="Export format">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Chips
              value={exportFmt}
              onChange={setExportFmt}
              options={[
                { value: "tw4", label: "Tailwind v4 @theme" },
                { value: "tw3", label: "Tailwind v3" },
                { value: "css", label: "CSS vars" },
                { value: "scss", label: "SCSS" },
                { value: "json", label: "JSON" },
              ]}
            />
            <button
              type="button"
              onClick={() => saveBlob(new Blob([exportText], { type: "text/plain;charset=utf-8" }), `${safeToken}-palette.txt`)}
              className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-line bg-surface px-2.5 text-[12px] font-medium text-ink hover:border-ink-3"
            >
              <Download aria-hidden className="size-3.5" /> Save tokens
            </button>
          </div>
        </Row>
      </Panel>
      <Output value={exportText} name={`${safeToken}-palette.${exportFmt === "json" ? "json" : exportFmt === "scss" ? "scss" : "css"}`} lang={exportFmt.toUpperCase()} />
    </>
  );
}
