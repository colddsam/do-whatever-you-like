/** Draws the spreadsheet on a canvas: headers, frozen panes, cells, styles, merges, selection. */
import { addr, formatColor, formatValue, indexToCol, isError, isDateFmt, type Scalar } from "./formula";
import { colLeft, colWidth, rowHeight, rowTop, visibleRange, type Geometry } from "./geometry";
import { key, mergeAt, type BorderSide, type CellStyle, type Computed, type CondResult, type Range, type Sheet } from "./model";

export type Theme = { paper: string; surface: string; ink: string; ink2: string; ink3: string; line: string; accent: string; grid: string; header: string; headerSel: string };

export const THEME: Theme = {
  paper: "#f3f0e8",
  surface: "#ffffff",
  ink: "#15140f",
  ink2: "#57544a",
  ink3: "#8a867a",
  line: "#dad5c8",
  accent: "#1a7f4b",
  grid: "#e3e3e3",
  header: "#f5f4ef",
  headerSel: "#d8ebdf",
};

export type DrawState = {
  sheet: Sheet;
  comp: Computed;
  cond: Map<string, CondResult>;
  geo: Geometry;
  width: number;
  height: number;
  scrollX: number;
  scrollY: number;
  sel: Range;
  active: { r: number; c: number };
  copyRange: Range | null;
  refRanges: { range: Range; color: string }[];
  showFormulas: boolean;
  editing: { r: number; c: number } | null;
  fillPreview: Range | null;
  dpr: number;
};

export function cellFont(s: CellStyle | undefined, zoom: number) {
  const size = (s?.size ?? 11) * (96 / 72) * zoom;
  return `${s?.italic ? "italic " : ""}${s?.bold ? "bold " : ""}${size.toFixed(1)}px ${s?.font ? `"${s.font}", ` : ""}Calibri, Carlito, "Segoe UI", Arial, sans-serif`;
}

/** Text a cell shows (formatted), and its default alignment. */
export function displayOf(v: Scalar, s: CellStyle | undefined, raw: unknown, showFormulas: boolean): { text: string; align: "left" | "right" | "center"; color?: string } {
  if (showFormulas && typeof raw === "string" && raw.startsWith("=")) return { text: raw, align: "left" };
  if (v === null || v === undefined) return { text: "", align: "left" };
  if (typeof v === "number") {
    const text = formatValue(v, s?.fmt);
    return { text, align: "right", color: formatColor(v, s?.fmt) ?? undefined };
  }
  if (typeof v === "boolean") return { text: v ? "TRUE" : "FALSE", align: "center" };
  if (isError(v)) return { text: v.code, align: "center", color: "#c00000" };
  return { text: v, align: "left" };
}

function strokeBorder(ctx: CanvasRenderingContext2D, b: BorderSide | undefined, x1: number, y1: number, x2: number, y2: number) {
  if (!b) return;
  ctx.save();
  ctx.strokeStyle = b.color;
  ctx.lineWidth = b.style === "thick" ? 3 : b.style === "medium" ? 2 : 1;
  ctx.setLineDash(b.style === "dashed" ? [4, 2] : b.style === "dotted" ? [1, 2] : []);
  ctx.beginPath();
  if (b.style === "double") {
    const horizontal = y1 === y2;
    ctx.moveTo(x1 + (horizontal ? 0 : -1), y1 + (horizontal ? -1 : 0));
    ctx.lineTo(x2 + (horizontal ? 0 : -1), y2 + (horizontal ? -1 : 0));
    ctx.moveTo(x1 + (horizontal ? 0 : 1), y1 + (horizontal ? 1 : 0));
    ctx.lineTo(x2 + (horizontal ? 0 : 1), y2 + (horizontal ? 1 : 0));
  } else {
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
  }
  ctx.stroke();
  ctx.restore();
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    const words = para.split(/(\s+)/);
    let line = "";
    for (const w of words) {
      if (ctx.measureText(line + w).width <= width || !line) line += w;
      else {
        out.push(line.trimEnd());
        line = w.trimStart();
      }
      while (ctx.measureText(line).width > width && line.length > 1) {
        let cut = line.length - 1;
        while (cut > 1 && ctx.measureText(line.slice(0, cut)).width > width) cut--;
        out.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    out.push(line);
  }
  return out;
}

export function draw(canvas: HTMLCanvasElement, st: DrawState) {
  const { geo: g, width, height, dpr } = st;
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = THEME.surface;
  ctx.fillRect(0, 0, width, height);
  ctx.textBaseline = "middle";

  const vis = visibleRange(g, width, height, st.scrollX, st.scrollY);
  const frozenW = g.colX[g.frozenC] * g.zoom;
  const frozenH = g.rowY[g.frozenR] * g.zoom;
  const cols = (from: number, to: number) => {
    const a: number[] = [];
    for (let c = from; c <= to; c++) if (colWidth(g, c) > 0) a.push(c);
    return a;
  };
  const rows = (from: number, to: number) => {
    const a: number[] = [];
    for (let r = from; r <= to; r++) if (rowHeight(g, r) > 0) a.push(r);
    return a;
  };
  const frozenCols = cols(0, g.frozenC - 1);
  const frozenRows = rows(0, g.frozenR - 1);
  const scrollCols = cols(vis.c1, vis.c2);
  const scrollRows = rows(vis.r1, vis.r2);

  // Four quadrants, each clipped: scrolling body, frozen top, frozen left, frozen corner.
  const quads: { rs: number[]; cs: number[]; clip: [number, number, number, number] }[] = [
    { rs: scrollRows, cs: scrollCols, clip: [g.headerW + frozenW, g.headerH + frozenH, width, height] },
    { rs: frozenRows, cs: scrollCols, clip: [g.headerW + frozenW, g.headerH, width, g.headerH + frozenH] },
    { rs: scrollRows, cs: frozenCols, clip: [g.headerW, g.headerH + frozenH, g.headerW + frozenW, height] },
    { rs: frozenRows, cs: frozenCols, clip: [g.headerW, g.headerH, g.headerW + frozenW, g.headerH + frozenH] },
  ];

  for (const q of quads) {
    if (!q.rs.length || !q.cs.length) continue;
    ctx.save();
    ctx.beginPath();
    ctx.rect(q.clip[0], q.clip[1], q.clip[2] - q.clip[0], q.clip[3] - q.clip[1]);
    ctx.clip();
    drawCells(ctx, st, q.rs, q.cs);
    drawSelection(ctx, st);
    ctx.restore();
  }

  // Frozen dividers
  ctx.strokeStyle = "#b4b0a4";
  ctx.lineWidth = 2;
  if (g.frozenC) {
    ctx.beginPath();
    ctx.moveTo(g.headerW + frozenW, 0);
    ctx.lineTo(g.headerW + frozenW, height);
    ctx.stroke();
  }
  if (g.frozenR) {
    ctx.beginPath();
    ctx.moveTo(0, g.headerH + frozenH);
    ctx.lineTo(width, g.headerH + frozenH);
    ctx.stroke();
  }

  if (g.headerW) drawHeaders(ctx, st, [...frozenCols, ...scrollCols], [...frozenRows, ...scrollRows]);
}

function drawCells(ctx: CanvasRenderingContext2D, st: DrawState, rs: number[], cs: number[]) {
  const { geo: g, sheet: sh, comp } = st;
  const z = g.zoom;
  // fills & grid
  for (const r of rs) {
    const y = rowTop(g, r, st.scrollY);
    const h = rowHeight(g, r);
    for (const c of cs) {
      const x = colLeft(g, c, st.scrollX);
      const w = colWidth(g, c);
      const k = key(r, c);
      const cell = sh.cells[k];
      const cf = st.cond.get(k);
      const fill = cf?.style?.fill ?? cell?.s?.fill;
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fillRect(x, y, w, h);
      }
      if (cf?.bar) {
        ctx.fillStyle = cf.bar.color + "aa";
        ctx.fillRect(x + 2, y + 3, Math.max(0, (w - 4) * cf.bar.pct), h - 6);
      }
      if (sh.gridlines) {
        ctx.strokeStyle = THEME.grid;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + w - 0.5, y);
        ctx.lineTo(x + w - 0.5, y + h);
        ctx.moveTo(x, y + h - 0.5);
        ctx.lineTo(x + w, y + h - 0.5);
        ctx.stroke();
      }
    }
  }
  // merged areas visible in this quadrant: paint over the grid lines inside them
  const drawnMerges = new Set<string>();
  // text
  const isEmpty = (r: number, c: number) => {
    const v = comp.values.get(key(r, c));
    return (v === null || v === undefined || v === "") && !mergeAt(sh, r, c);
  };
  for (const r of rs) {
    for (const c of cs) {
      const m = mergeAt(sh, r, c);
      let r0 = r;
      let c0 = c;
      let x = colLeft(g, c, st.scrollX);
      let y = rowTop(g, r, st.scrollY);
      let w = colWidth(g, c);
      let h = rowHeight(g, r);
      if (m) {
        const mk = `${m.r1},${m.c1}`;
        if (drawnMerges.has(mk)) continue;
        drawnMerges.add(mk);
        r0 = m.r1;
        c0 = m.c1;
        x = colLeft(g, m.c1, st.scrollX);
        y = rowTop(g, m.r1, st.scrollY);
        w = 0;
        for (let cc = m.c1; cc <= m.c2; cc++) w += colWidth(g, cc);
        h = 0;
        for (let rr = m.r1; rr <= m.r2; rr++) h += rowHeight(g, rr);
        const cell = sh.cells[key(r0, c0)];
        ctx.fillStyle = st.cond.get(key(r0, c0))?.style?.fill ?? cell?.s?.fill ?? THEME.surface;
        ctx.fillRect(x, y, w - 1, h - 1);
        if (sh.gridlines) {
          ctx.strokeStyle = THEME.grid;
          ctx.strokeRect(x - 0.5, y - 0.5, w, h);
        }
      }
      const k = key(r0, c0);
      const cell = sh.cells[k];
      const cf = st.cond.get(k);
      const s: CellStyle | undefined = cf?.style ? { ...cell?.s, ...cf.style } : cell?.s;
      if (s?.bt || s?.bb || s?.bl || s?.br) {
        strokeBorder(ctx, s.bt, x, y + 0.5, x + w, y + 0.5);
        strokeBorder(ctx, s.bb, x, y + h - 0.5, x + w, y + h - 0.5);
        strokeBorder(ctx, s.bl, x + 0.5, y, x + 0.5, y + h);
        strokeBorder(ctx, s.br, x + w - 0.5, y, x + w - 0.5, y + h);
      }
      if (st.editing && st.editing.r === r0 && st.editing.c === c0) continue;
      const v = comp.values.get(k) ?? null;
      const disp = displayOf(v, s, cell?.v, st.showFormulas);
      if (cell?.note) {
        ctx.fillStyle = "#d9534f";
        ctx.beginPath();
        ctx.moveTo(x + w - 7 * z, y);
        ctx.lineTo(x + w - 1, y);
        ctx.lineTo(x + w - 1, y + 7 * z);
        ctx.fill();
      }
      if (!disp.text) continue;
      ctx.font = cellFont(s, z);
      const textColor = disp.color ?? (cell?.link ? "#0563c1" : (s?.color ?? THEME.ink));
      ctx.fillStyle = textColor;
      const align = s?.align ?? (st.showFormulas ? "left" : disp.align);
      const pad = 4 * z + (s?.indent ?? 0) * 9 * z;
      const fontPx = (s?.size ?? 11) * (96 / 72) * z;
      let text = disp.text;
      if (s?.wrap || text.includes("\n")) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, w, h);
        ctx.clip();
        const lines = wrapText(ctx, text, Math.max(4, w - pad * 2));
        const lh = fontPx * 1.2;
        const total = lines.length * lh;
        const vy = s?.valign === "top" ? y + lh / 2 + 2 : s?.valign === "middle" ? y + h / 2 - total / 2 + lh / 2 : y + h - total + lh / 2 - 2;
        lines.forEach((ln, i) => {
          const tw = ctx.measureText(ln).width;
          const tx = align === "right" ? x + w - pad - tw : align === "center" ? x + (w - tw) / 2 : x + pad;
          ctx.fillText(ln, tx, vy + i * lh);
        });
        ctx.restore();
        continue;
      }
      let tw = ctx.measureText(text).width;
      // Numbers too wide show ### (Excel), unless general text
      if (typeof v === "number" && tw > w - pad && !s?.wrap) {
        if (isDateFmt(s?.fmt) || (s?.fmt && s.fmt !== "General")) {
          text = "#".repeat(Math.max(1, Math.floor((w - 2) / ctx.measureText("#").width)));
          tw = ctx.measureText(text).width;
        }
      }
      // Text spills into empty cells to the right (left-aligned) like Excel.
      let clipW = w;
      if (typeof v === "string" && align === "left" && tw > w - pad && !m) {
        let cc = c0 + 1;
        while (clipW < tw + pad * 2 && cc < g.cols && isEmpty(r0, cc)) {
          clipW += colWidth(g, cc);
          cc++;
        }
      }
      const ty = s?.valign === "top" ? y + fontPx * 0.6 + 2 : s?.valign === "middle" ? y + h / 2 : y + h - fontPx * 0.6 - 2;
      const tx = align === "right" ? x + w - pad - tw : align === "center" ? x + (w - tw) / 2 : x + pad;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, clipW, h);
      ctx.clip();
      if (s?.rotate) {
        ctx.translate(x + w / 2, y + h / 2);
        ctx.rotate((-s.rotate * Math.PI) / 180);
        ctx.textAlign = "center";
        ctx.fillText(text, 0, 0);
      } else {
        // white-out the grid line under overflowing text
        if (clipW > w) {
          ctx.fillStyle = THEME.surface;
          ctx.fillRect(x + w - 1, y + 1, clipW - w, h - 2);
          ctx.fillStyle = textColor;
        }
        ctx.fillText(text, tx, ty);
        if (s?.underline || cell?.link) ctx.fillRect(tx, ty + fontPx * 0.45, tw, Math.max(1, z));
        if (s?.strike) ctx.fillRect(tx, ty, tw, Math.max(1, z));
      }
      ctx.restore();
    }
  }
}

function rangeRect(g: Geometry, rg: Range, sx: number, sy: number) {
  const x1 = colLeft(g, rg.c1, sx);
  const y1 = rowTop(g, rg.r1, sy);
  const x2 = colLeft(g, rg.c2, sx) + colWidth(g, rg.c2);
  const y2 = rowTop(g, rg.r2, sy) + rowHeight(g, rg.r2);
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

function drawSelection(ctx: CanvasRenderingContext2D, st: DrawState) {
  const { geo: g } = st;
  // formula reference colours while editing
  for (const ref of st.refRanges) {
    const rr = rangeRect(g, ref.range, st.scrollX, st.scrollY);
    ctx.fillStyle = ref.color + "22";
    ctx.fillRect(rr.x, rr.y, rr.w, rr.h);
    ctx.strokeStyle = ref.color;
    ctx.lineWidth = 2;
    ctx.strokeRect(rr.x + 1, rr.y + 1, rr.w - 2, rr.h - 2);
  }
  const sel = rangeRect(g, st.sel, st.scrollX, st.scrollY);
  const am = mergeAt(st.sheet, st.active.r, st.active.c);
  const isJustTheMerge = am && am.r1 === st.sel.r1 && am.c1 === st.sel.c1 && am.r2 === st.sel.r2 && am.c2 === st.sel.c2;
  const multi = !isJustTheMerge && (st.sel.r1 !== st.sel.r2 || st.sel.c1 !== st.sel.c2);
  if (multi) {
    ctx.fillStyle = "rgba(26,127,75,0.10)";
    ctx.fillRect(sel.x, sel.y, sel.w, sel.h);
  }
  // spill outline
  const spill = st.comp.spills.get(key(st.active.r, st.active.c));
  if (spill) {
    const sr = rangeRect(g, { r1: st.active.r, c1: st.active.c, r2: st.active.r + spill.rows - 1, c2: st.active.c + spill.cols - 1 }, st.scrollX, st.scrollY);
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = "#4472c4";
    ctx.lineWidth = 1;
    ctx.strokeRect(sr.x + 0.5, sr.y + 0.5, sr.w - 1, sr.h - 1);
    ctx.setLineDash([]);
  }
  if (st.fillPreview) {
    const fr = rangeRect(g, st.fillPreview, st.scrollX, st.scrollY);
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = THEME.ink2;
    ctx.strokeRect(fr.x + 0.5, fr.y + 0.5, fr.w - 1, fr.h - 1);
    ctx.setLineDash([]);
  }
  ctx.strokeStyle = THEME.accent;
  ctx.lineWidth = 2;
  ctx.strokeRect(sel.x + 1, sel.y + 1, sel.w - 2, sel.h - 2);
  // active cell
  const m = am;
  const ar = rangeRect(g, m ?? { r1: st.active.r, c1: st.active.c, r2: st.active.r, c2: st.active.c }, st.scrollX, st.scrollY);
  if (multi) {
    ctx.fillStyle = THEME.surface;
    ctx.globalAlpha = 0.6;
    ctx.fillRect(ar.x + 2, ar.y + 2, ar.w - 4, ar.h - 4);
    ctx.globalAlpha = 1;
  }
  ctx.strokeRect(ar.x + 1, ar.y + 1, ar.w - 2, ar.h - 2);
  // fill handle
  ctx.fillStyle = THEME.accent;
  ctx.fillRect(sel.x + sel.w - 4, sel.y + sel.h - 4, 7, 7);
  ctx.fillStyle = THEME.surface;
  ctx.fillRect(sel.x + sel.w - 4, sel.y + sel.h - 4, 7, 1);
  if (st.copyRange) {
    const cr = rangeRect(g, st.copyRange, st.scrollX, st.scrollY);
    ctx.setLineDash([5, 3]);
    ctx.strokeStyle = THEME.accent;
    ctx.lineWidth = 2;
    ctx.strokeRect(cr.x + 1, cr.y + 1, cr.w - 2, cr.h - 2);
    ctx.setLineDash([]);
  }
}

function drawHeaders(ctx: CanvasRenderingContext2D, st: DrawState, cs: number[], rs: number[]) {
  const { geo: g, width, height } = st;
  const frozenW = g.colX[g.frozenC] * g.zoom;
  const frozenH = g.rowY[g.frozenR] * g.zoom;
  ctx.font = `${12}px "Segoe UI", system-ui, sans-serif`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  // column header band
  ctx.fillStyle = THEME.header;
  ctx.fillRect(0, 0, width, g.headerH);
  ctx.fillRect(0, 0, g.headerW, height);
  const selCols = (c: number) => c >= st.sel.c1 && c <= st.sel.c2;
  const selRows = (r: number) => r >= st.sel.r1 && r <= st.sel.r2;
  const wholeCols = st.sel.r1 === 0 && st.sel.r2 >= g.rows - 1;
  const wholeRows = st.sel.c1 === 0 && st.sel.c2 >= g.cols - 1;
  ctx.save();
  for (const c of cs) {
    const x = colLeft(g, c, st.scrollX);
    const w = colWidth(g, c);
    if (c >= g.frozenC && x + w < g.headerW + frozenW) continue;
    ctx.save();
    ctx.beginPath();
    ctx.rect(c < g.frozenC ? g.headerW : g.headerW + frozenW, 0, width, g.headerH);
    ctx.clip();
    if (selCols(c)) {
      ctx.fillStyle = wholeCols ? THEME.accent : THEME.headerSel;
      ctx.fillRect(x, 0, w, g.headerH);
    }
    ctx.fillStyle = selCols(c) && wholeCols ? "#fff" : selCols(c) ? THEME.accent : THEME.ink2;
    ctx.fillText(indexToCol(c), x + w / 2, g.headerH / 2 + 1);
    ctx.strokeStyle = THEME.line;
    ctx.beginPath();
    ctx.moveTo(x + w - 0.5, 0);
    ctx.lineTo(x + w - 0.5, g.headerH);
    ctx.stroke();
    if (selCols(c)) {
      ctx.fillStyle = THEME.accent;
      ctx.fillRect(x, g.headerH - 2, w, 2);
    }
    ctx.restore();
  }
  for (const r of rs) {
    const y = rowTop(g, r, st.scrollY);
    const h = rowHeight(g, r);
    if (r >= g.frozenR && y + h < g.headerH + frozenH) continue;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, r < g.frozenR ? g.headerH : g.headerH + frozenH, g.headerW, height);
    ctx.clip();
    if (selRows(r)) {
      ctx.fillStyle = wholeRows ? THEME.accent : THEME.headerSel;
      ctx.fillRect(0, y, g.headerW, h);
    }
    ctx.fillStyle = selRows(r) && wholeRows ? "#fff" : selRows(r) ? THEME.accent : THEME.ink2;
    ctx.fillText(String(r + 1), g.headerW / 2, y + h / 2 + 1);
    ctx.strokeStyle = THEME.line;
    ctx.beginPath();
    ctx.moveTo(0, y + h - 0.5);
    ctx.lineTo(g.headerW, y + h - 0.5);
    ctx.stroke();
    if (selRows(r)) {
      ctx.fillStyle = THEME.accent;
      ctx.fillRect(g.headerW - 2, y, 2, h);
    }
    ctx.restore();
  }
  ctx.restore();
  ctx.strokeStyle = THEME.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, g.headerH - 0.5);
  ctx.lineTo(width, g.headerH - 0.5);
  ctx.moveTo(g.headerW - 0.5, 0);
  ctx.lineTo(g.headerW - 0.5, height);
  ctx.stroke();
  // corner
  ctx.fillStyle = THEME.header;
  ctx.fillRect(0, 0, g.headerW - 1, g.headerH - 1);
  ctx.fillStyle = THEME.ink3;
  ctx.beginPath();
  ctx.moveTo(g.headerW - 5, 5);
  ctx.lineTo(g.headerW - 5, g.headerH - 5);
  ctx.lineTo(g.headerW - 5 - (g.headerH - 10), g.headerH - 5);
  ctx.fill();
  ctx.textAlign = "left";
}

export { addr };
