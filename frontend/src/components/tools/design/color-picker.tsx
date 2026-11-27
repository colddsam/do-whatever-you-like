"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, Copy, Download, Pipette, X } from "lucide-react";
import { contrast, exportAse, exportText, formats, fromHex, hex, inkOn, nearestName, palette, swatchPng, type ExportKind, type RGB } from "@/lib/color";
import { clientToImagePixel, computeContentRect, sampleRgbaPatch } from "@/lib/color-sample";
import { postFormJson, saveBlob } from "@/lib/files";
import { getTool, stepsFor } from "@/lib/tools";
import { cn } from "@/lib/utils";
import { FileDrop } from "../file-drop";
import { Workbench } from "../workbench";
import { Chips, Notice, Panel, Row, Slider } from "../pdf/kit";
import { FileRow } from "../pdf/task";
import { Measuring, messageOf, RetryLink, swap } from "../pdf/parts";
import { triggerHaptic } from "@/lib/haptics";

/** Pictures the browser opens itself (they never leave the device). Everything else goes to the server. */
const LOCAL = /\.(png|jpe?g|webp|gif|bmp|avif|ico|svg)$/i;
const LOUPE = 11;

type Page = { label: string; src: string };
type Extract = { pages: { label: string; width: number; height: number; data: string }[]; declared: { hex: string; count: number; source: string }[]; theme: { name: string; hex: string }[]; notes: string[] };
type Picked = { id: number; rgb: RGB };

let uid = 0;

/**
 * Pick colours from anything: a photo, a screenshot, a PDF, a PowerPoint or Word file, a video, a
 * web page's CSS. Point and click with a magnifier, get the main colours automatically, see the exact
 * colours the file declares, and export them.
 */
export function ColorPicker({ toolId }: { toolId: string }) {
  const tool = getTool(toolId)!;
  const [file, setFile] = useState<File | null>(null);
  const [rejected, setRejected] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "busy" | { error: string }>("idle");
  const [pages, setPages] = useState<Page[]>([]);
  const [pageIdx, setPageIdx] = useState(0);
  const [img, setImg] = useState<ImageData | null>(null);
  const [declared, setDeclared] = useState<Extract["declared"]>([]);
  const [theme, setTheme] = useState<Extract["theme"]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [selected, setSelected] = useState<RGB | null>(null);
  const [k, setK] = useState(8);
  const [sample, setSample] = useState<1 | 3 | 5>(1);
  const urls = useRef<string[]>([]);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const pick = (rgb: RGB) => {
    setSelected(rgb);
    setPicked((list) => (list.some((p) => hex(p.rgb) === hex(rgb)) ? list : [{ id: ++uid, rgb }, ...list].slice(0, 40)));
  };

  const open = async (f: File) => {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setFile(f);
    setRejected(null);
    setDeclared([]);
    setTheme([]);
    setNotes([]);
    setPageIdx(0);
    setImg(null);
    if (LOCAL.test(f.name) || f.type.startsWith("image/")) {
      const url = URL.createObjectURL(f);
      urls.current.push(url);
      setPages([{ label: f.name, src: url }]);
      setState("idle");
      return;
    }
    setPages([]);
    setState("busy");
    try {
      const form = new FormData();
      form.append("file", f, f.name);
      const res = await postFormJson<Extract>("/api/tools/palette/extract", form, { signal: ctrl.signal });
      if (ctrl.signal.aborted) return;
      setPages(res.pages.map((p) => ({ label: p.label, src: `data:image/png;base64,${p.data}` })));
      setDeclared(res.declared);
      setTheme(res.theme);
      setNotes(res.notes);
      setState("idle");
    } catch (e) {
      if (!ctrl.signal.aborted) setState({ error: messageOf(e) });
    }
  };

  // Paste a screenshot straight in (Ctrl/Cmd + V).
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  });
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith("image/"));
      const blob = item?.getAsFile();
      if (blob) void openRef.current(new File([blob], `pasted.${blob.type.split("/")[1] || "png"}`, { type: blob.type }));
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  const page = pages[pageIdx];
  const swatches = useMemo(() => (img ? palette(img, k) : []), [img, k]);
  const [screenPick, setScreenPick] = useState(false);
  useEffect(() => setScreenPick("EyeDropper" in window), []); // eslint-disable-line react-hooks/set-state-in-effect
  const fromScreen = async () => {
    try {
      const r = await new (window as unknown as { EyeDropper: new () => { open(): Promise<{ sRGBHex: string }> } }).EyeDropper().open();
      pick(fromHex(r.sRGBHex));
    } catch {
      /* cancelled */
    }
  };

  const step = !file && !picked.length ? 0 : picked.length ? 2 : 1;
  return (
    <Workbench steps={stepsFor(tool)} current={step} footer={<>Pictures are read in your browser. Documents and videos are opened on our server to draw their pages and deleted straight after. Free.</>}>
      <div className="space-y-3 p-3 sm:p-4">
        {!file ? (
          <div className="space-y-2">
            <FileDrop
              accept=""
              title="Drop any file to pick colours from"
              formats="Images, PDF, PowerPoint, Word, Excel, video, SVG, HTML, CSS · or paste a screenshot"
              error={rejected}
              onFile={(f) => (f.size ? void open(f) : setRejected("That file is empty."))}
            />
            {screenPick && (
              <button type="button" onClick={() => void fromScreen()} className="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-surface px-3 text-sm text-ink-2 hover:border-ink-3 hover:text-ink">
                <Pipette aria-hidden className="size-4" /> Pick a colour from anywhere on your screen
              </button>
            )}
          </div>
        ) : (
          <FileRow file={file} noun="file" locked={state === "busy"} accept="" onReplace={(f) => void open(f)} onClear={() => (setFile(null), setPages([]), setImg(null))} />
        )}

        <AnimatePresence mode="wait" initial={false}>
          {state === "busy" ? (
            <motion.div key="busy" {...swap} className="rounded-md border border-dashed border-line px-4 py-5">
              <Measuring />
              <p className="mt-2 text-sm text-ink-2">Opening the file and reading its colours…</p>
            </motion.div>
          ) : typeof state === "object" ? (
            <motion.div key="err" {...swap}>
              <Notice tone="danger">
                {state.error}
                {file && <RetryLink onRetry={() => void open(file)} />}
              </Notice>
            </motion.div>
          ) : file ? (
            <motion.div key={file.name + file.size} {...swap} className="@container">
              <div className="grid gap-3 @3xl:grid-cols-[minmax(0,1fr)_300px]">
                <div className="min-w-0 space-y-2">
                  {page ? (
                    <Viewer key={page.src} src={page.src} sample={sample} onImage={setImg} onPick={pick} />
                  ) : (
                    <p className="rounded-md border border-dashed border-line px-3 py-6 text-center text-sm text-ink-3">This file has no picture to point at, but its colours are listed.</p>
                  )}
                  {pages.length > 1 && (
                    <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
                      {pages.map((p, i) => (
                        <button key={i} type="button" onClick={() => setPageIdx(i)} aria-pressed={i === pageIdx} className={cn("shrink-0 overflow-hidden rounded-sm border-2 transition-colors", i === pageIdx ? "border-ink" : "border-transparent hover:border-line")}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={p.src} alt={p.label} className="h-16 w-auto bg-paper-2" />
                        </button>
                      ))}
                    </div>
                  )}
                  {page && (
                    <div className="flex flex-wrap items-center gap-2 px-1">
                      <span className="label-mono text-ink-3">Sample</span>
                      <Chips value={sample} onChange={setSample} options={[{ value: 1, label: "1 pixel" }, { value: 3, label: "3×3 average" }, { value: 5, label: "5×5 average" }]} />
                      {screenPick && (
                        <button type="button" onClick={() => void fromScreen()} className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-sm border border-line bg-surface px-2.5 text-[13px] text-ink-2 hover:border-ink-3 hover:text-ink">
                          <Pipette aria-hidden className="size-4" /> From screen
                        </button>
                      )}
                    </div>
                  )}
                  {notes.map((n) => (
                    <p key={n} className="px-1 text-xs text-ink-3">{n}</p>
                  ))}
                </div>
                <div className="min-w-0 space-y-3">
                  <Detail rgb={selected} />
                  <SwatchGroup title={`Picked · ${picked.length}`} empty="Click the picture to pick colours." items={picked.map((p) => ({ key: String(p.id), rgb: p.rgb }))} selected={selected} onSelect={setSelected} onRemove={(key) => setPicked((l) => l.filter((p) => String(p.id) !== key))} />
                  {img && (
                    <div className="overflow-hidden rounded-md border border-line bg-surface">
                      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
                        <p className="label-mono text-ink-3">Main colours</p>
                        <div className="w-32">
                          <Slider value={k} min={3} max={16} onChange={setK} label="How many colours" />
                        </div>
                      </div>
                      <div className="flex h-10 w-full" aria-hidden>
                        {swatches.map((s, i) => (
                          <motion.span key={hex(s.rgb) + i} initial={{ flexGrow: 0 }} animate={{ flexGrow: s.share }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }} className="block min-w-[3px]" style={{ background: hex(s.rgb) }} />
                        ))}
                      </div>
                      <Grid items={swatches.map((s) => ({ key: hex(s.rgb), rgb: s.rgb, note: s.share < 0.005 ? "<1%" : `${Math.round(s.share * 100)}%` }))} selected={selected} onSelect={pick} />
                    </div>
                  )}
                  {theme.length > 0 && (
                    <div className="overflow-hidden rounded-md border border-line bg-surface">
                      <p className="label-mono border-b border-line px-3 py-2 text-ink-3">Theme colours</p>
                      <Grid items={theme.map((t) => ({ key: t.name, rgb: fromHex(t.hex), note: t.name }))} selected={selected} onSelect={pick} />
                    </div>
                  )}
                  {declared.length > 0 && (
                    <div className="overflow-hidden rounded-md border border-line bg-surface">
                      <p className="label-mono border-b border-line px-3 py-2 text-ink-3">Exact colours in the file · {declared.length}</p>
                      <Grid items={declared.map((d) => ({ key: d.hex, rgb: fromHex(d.hex), note: `${d.source} · ${d.count}×` }))} selected={selected} onSelect={pick} />
                    </div>
                  )}
                </div>
              </div>
              <Exporter
                sets={{
                  picked: picked.map((p) => ({ rgb: p.rgb })),
                  palette: swatches.map((s) => ({ rgb: s.rgb })),
                  file: [...theme.map((t) => ({ rgb: fromHex(t.hex), name: t.name })), ...declared.map((d) => ({ rgb: fromHex(d.hex) }))],
                }}
              />
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </Workbench>
  );
}

/* ---------------------------------------------------------------------------------------------- */

type HoverState = { wx: number; wy: number; wrW: number; wrH: number; px: number; py: number; rgb: RGB };

function Viewer({ src, sample, onImage, onPick }: { src: string; sample: 1 | 3 | 5; onImage: (d: ImageData) => void; onPick: (c: RGB) => void }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const loupeWrapRef = useRef<HTMLDivElement>(null);
  const loupe = useRef<HTMLCanvasElement>(null);
  const loupeHexRef = useRef<HTMLSpanElement>(null);
  const loupeCoordRef = useRef<HTMLSpanElement>(null);
  const data = useRef<ImageData | null>(null);
  const hoverRef = useRef<HoverState | null>(null);
  const [flash, setFlash] = useState<{ id: number; x: number; y: number } | null>(null);
  const [failed, setFailed] = useState(false);

  const drawLoupeSync = (h: HoverState | null, sampleSize: 1 | 3 | 5) => {
    const box = loupeWrapRef.current;
    const lc = loupe.current;
    const sc = canvas.current;
    if (!box) return;
    if (!h || !lc || !sc) {
      box.style.display = "none";
      return;
    }
    const lx = Math.min(Math.max(h.wx - 58, 4), Math.max(4, h.wrW - 120));
    const ly = h.wy > 164 ? h.wy - 160 : Math.min(h.wy + 24, Math.max(4, h.wrH - 160));
    box.style.display = "flex";
    box.style.transform = `translate3d(${Math.round(lx)}px, ${Math.round(ly)}px, 0)`;

    const g = lc.getContext("2d");
    if (g) {
      const size = lc.width;
      const cell = size / LOUPE;
      const half = Math.floor(LOUPE / 2);
      g.fillStyle = "#0d0c09";
      g.fillRect(0, 0, size, size);
      // Fast synchronous blit of the 11x11 pixel neighbourhood directly from the source canvas.
      g.imageSmoothingEnabled = false;
      const sx0 = h.px - half;
      const sy0 = h.py - half;
      const clipL = Math.max(0, sx0);
      const clipT = Math.max(0, sy0);
      const clipR = Math.min(sc.width, sx0 + LOUPE);
      const clipB = Math.min(sc.height, sy0 + LOUPE);
      if (clipR > clipL && clipB > clipT) {
        g.drawImage(
          sc,
          clipL,
          clipT,
          clipR - clipL,
          clipB - clipT,
          (clipL - sx0) * cell,
          (clipT - sy0) * cell,
          (clipR - clipL) * cell,
          (clipB - clipT) * cell,
        );
      }
      // Subtle pixel grid
      g.strokeStyle = "rgba(255,255,255,0.16)";
      g.lineWidth = 1;
      g.beginPath();
      for (let i = 1; i < LOUPE; i++) {
        const p = Math.round(i * cell) + 0.5;
        g.moveTo(p, 0);
        g.lineTo(p, size);
        g.moveTo(0, p);
        g.lineTo(size, p);
      }
      g.stroke();
      // Sampled center region outline in high contrast double-stroke
      const rad = Math.floor(sampleSize / 2);
      const bx = (half - rad) * cell;
      const by = (half - rad) * cell;
      const bw = sampleSize * cell;
      g.strokeStyle = "#000000";
      g.lineWidth = 2;
      g.strokeRect(bx, by, bw, bw);
      g.strokeStyle = "#ffffff";
      g.lineWidth = 1;
      g.strokeRect(bx + 1, by + 1, Math.max(1, bw - 2), Math.max(1, bw - 2));
    }

    const code = hex(h.rgb).toUpperCase();
    if (loupeHexRef.current) {
      loupeHexRef.current.textContent = code;
      loupeHexRef.current.style.background = code;
      loupeHexRef.current.style.color = inkOn(h.rgb);
    }
    if (loupeCoordRef.current) {
      loupeCoordRef.current.textContent = `${h.px}, ${h.py}`;
    }
  };

  useEffect(() => {
    let live = true;
    const im = new Image();
    im.onload = () => {
      if (!live) return;
      const k = Math.min(1, 2400 / Math.max(im.naturalWidth, im.naturalHeight));
      const c = canvas.current!;
      c.width = Math.max(1, Math.round(im.naturalWidth * k));
      c.height = Math.max(1, Math.round(im.naturalHeight * k));
      const g = c.getContext("2d", { willReadFrequently: true })!;
      g.drawImage(im, 0, 0, c.width, c.height);
      data.current = g.getImageData(0, 0, c.width, c.height);
      hoverRef.current = null;
      drawLoupeSync(null, sample);
      onImage(data.current);
    };
    im.onerror = () => live && setFailed(true);
    im.src = src;
    return () => {
      live = false;
    };
  }, [src, onImage]); // eslint-disable-line react-hooks/exhaustive-deps

  const colourAt = (px: number, py: number, sampleSize = sample): RGB => {
    const d = data.current!;
    const p = sampleRgbaPatch(d.data, d.width, d.height, px, py, sampleSize);
    return [p.r, p.g, p.b];
  };

  useEffect(() => {
    if (hoverRef.current && data.current) {
      const h = { ...hoverRef.current, rgb: colourAt(hoverRef.current.px, hoverRef.current.py, sample) };
      hoverRef.current = h;
      drawLoupeSync(h, sample);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sample]);

  const locate = (e: React.PointerEvent): HoverState | null => {
    const c = canvas.current;
    const wEl = wrapRef.current;
    if (!c || !wEl || !data.current) return null;
    const cr = c.getBoundingClientRect();
    const hit = clientToImagePixel(e.clientX, e.clientY, cr, c.width, c.height);
    if (!hit) return null;
    const wr = wEl.getBoundingClientRect();
    return {
      wx: e.clientX - wr.left,
      wy: e.clientY - wr.top,
      wrW: wr.width,
      wrH: wr.height,
      px: hit.x,
      py: hit.y,
      rgb: colourAt(hit.x, hit.y),
    };
  };

  if (failed) return <Notice tone="warning">This picture couldn&apos;t be shown in your browser.</Notice>;
  return (
    <div
      ref={wrapRef}
      tabIndex={0}
      className="relative flex justify-center overflow-hidden rounded-md border border-line bg-[repeating-conic-gradient(var(--color-paper-2)_0_25%,var(--color-surface)_0_50%)] bg-[length:16px_16px] outline-none focus-visible:ring-2 focus-visible:ring-accent"
      onKeyDown={(e) => {
        const d = data.current;
        const wEl = wrapRef.current;
        const c = canvas.current;
        if (!d || !wEl || !c) return;
        const step = e.shiftKey ? 10 : 1;
        const delta =
          e.key === "ArrowLeft"
            ? [-step, 0]
            : e.key === "ArrowRight"
              ? [step, 0]
              : e.key === "ArrowUp"
                ? [0, -step]
                : e.key === "ArrowDown"
                  ? [0, step]
                  : null;
        if (delta) {
          e.preventDefault();
          const cur = hoverRef.current ?? { wx: wEl.clientWidth / 2, wy: wEl.clientHeight / 2, wrW: wEl.clientWidth, wrH: wEl.clientHeight, px: Math.floor(d.width / 2), py: Math.floor(d.height / 2), rgb: [0, 0, 0] as RGB };
          const px = Math.min(d.width - 1, Math.max(0, cur.px + delta[0]));
          const py = Math.min(d.height - 1, Math.max(0, cur.py + delta[1]));
          const cr = c.getBoundingClientRect();
          const wr = wEl.getBoundingClientRect();
          const content = computeContentRect(cr.width, cr.height, d.width, d.height);
          const next: HoverState = {
            wx: cr.left - wr.left + content.x + ((px + 0.5) / d.width) * content.w,
            wy: cr.top - wr.top + content.y + ((py + 0.5) / d.height) * content.h,
            wrW: wr.width,
            wrH: wr.height,
            px,
            py,
            rgb: colourAt(px, py),
          };
          hoverRef.current = next;
          drawLoupeSync(next, sample);
        } else if ((e.key === "Enter" || e.key === " ") && hoverRef.current) {
          e.preventDefault();
          onPick(hoverRef.current.rgb);
          setFlash({ id: Date.now(), x: hoverRef.current.wx, y: hoverRef.current.wy });
        }
      }}
    >
      <canvas
        ref={canvas}
        aria-label="The picture. Click to pick a colour. Use arrow keys to nudge 1 pixel."
        className="block h-auto max-h-[70vh] w-auto max-w-full cursor-crosshair touch-none"
        onPointerMove={(e) => {
          const h = locate(e);
          hoverRef.current = h;
          drawLoupeSync(h, sample);
        }}
        onPointerDown={(e) => {
          const h = locate(e);
          hoverRef.current = h;
          drawLoupeSync(h, sample);
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse") {
            hoverRef.current = null;
            drawLoupeSync(null, sample);
          }
        }}
        onPointerUp={(e) => {
          const h = locate(e);
          if (!h) return;
          hoverRef.current = h;
          drawLoupeSync(h, sample);
          onPick(h.rgb);
          setFlash({ id: Date.now(), x: h.wx, y: h.wy });
          if (e.pointerType !== "mouse") {
            hoverRef.current = null;
            drawLoupeSync(null, sample);
          }
        }}
      />
      <div
        ref={loupeWrapRef}
        aria-hidden
        className="pointer-events-none absolute left-0 top-0 z-10 flex flex-col items-center"
        style={{ display: "none", willChange: "transform" }}
      >
        <canvas ref={loupe} width={110} height={110} className="size-[110px] rounded-full border-2 border-paper shadow-float" style={{ imageRendering: "pixelated" }} />
        <span ref={loupeHexRef} className="mt-1 rounded-sm px-1.5 py-0.5 font-mono text-[12px] shadow-card" />
        <span ref={loupeCoordRef} className="mt-0.5 rounded-sm bg-ink/85 px-1.5 py-0.5 font-mono text-[11px] text-paper shadow-card" />
      </div>
      <AnimatePresence>
        {flash && (
          <motion.span
            key={flash.id}
            aria-hidden
            initial={{ opacity: 0.85, scale: 0.3 }}
            animate={{ opacity: 0, scale: 1.6 }}
            transition={{ duration: 0.45 }}
            onAnimationComplete={() => setFlash(null)}
            className="pointer-events-none absolute size-10 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent"
            style={{ left: flash.x, top: flash.y }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function Detail({ rgb }: { rgb: RGB | null }) {
  const [copied, setCopied] = useState<string | null>(null);
  if (!rgb) return <p className="rounded-md border border-dashed border-line px-3 py-6 text-center text-sm text-ink-3">Point at the picture: a magnifier shows the exact pixel. Click to pick it.</p>;
  const name = nearestName(rgb);
  const onWhite = contrast(rgb, [255, 255, 255]);
  const onBlack = contrast(rgb, [0, 0, 0]);
  const grade = (r: number) => (r >= 7 ? "AAA" : r >= 4.5 ? "AA" : r >= 3 ? "AA large" : "fails");
  return (
    <div className="overflow-hidden rounded-md border border-line bg-surface">
      <motion.div key={hex(rgb)} initial={{ opacity: 0.4 }} animate={{ opacity: 1 }} className="flex h-24 items-end justify-between px-3 pb-2" style={{ background: hex(rgb), color: inkOn(rgb) }}>
        <span className="font-mono text-lg">{hex(rgb).toUpperCase()}</span>
        <span className="text-[13px] opacity-80">{name.exact ? name.name : `≈ ${name.name}`}</span>
      </motion.div>
      <ul className="divide-y divide-line">
        {formats(rgb).map((f) => (
          <li key={f.label} className="flex items-center gap-2 px-3 py-1.5">
            <span className="label-mono w-12 shrink-0 text-ink-3">{f.label}</span>
            <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-ink">{f.value}</span>
            <button
              type="button"
              aria-label={`Copy ${f.label}`}
              onClick={() => void navigator.clipboard.writeText(f.value).then(() => (triggerHaptic("success"), setCopied(f.label), setTimeout(() => setCopied(null), 1200)))}
              className="inline-flex size-7 items-center justify-center rounded-[6px] text-ink-3 hover:bg-paper-2 hover:text-ink"
            >
              {copied === f.label ? <Check aria-hidden className="size-3.5 text-success" /> : <Copy aria-hidden className="size-3.5" />}
            </button>
          </li>
        ))}
      </ul>
      <p className="border-t border-line px-3 py-2 font-mono text-[12px] text-ink-3">
        Text on white {onWhite.toFixed(1)}:1 {grade(onWhite)} · on black {onBlack.toFixed(1)}:1 {grade(onBlack)}
      </p>
    </div>
  );
}

function SwatchGroup({ title, empty, items, selected, onSelect, onRemove }: { title: string; empty: string; items: { key: string; rgb: RGB }[]; selected: RGB | null; onSelect: (c: RGB) => void; onRemove: (key: string) => void }) {
  return (
    <div className="overflow-hidden rounded-md border border-line bg-surface">
      <p className="label-mono border-b border-line px-3 py-2 text-ink-3">{title}</p>
      {items.length ? (
        <ul className="flex flex-wrap gap-1.5 p-2.5">
          <AnimatePresence initial={false}>
            {items.map((it) => (
              <motion.li key={it.key} layout initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.4, opacity: 0 }} transition={{ type: "spring", stiffness: 420, damping: 26 }} className="group relative">
                <button type="button" onClick={() => onSelect(it.rgb)} aria-label={hex(it.rgb)} title={hex(it.rgb)} className={cn("block size-9 rounded-sm border", selected && hex(selected) === hex(it.rgb) ? "border-ink ring-2 ring-ink ring-offset-1" : "border-line")} style={{ background: hex(it.rgb) }} />
                <button type="button" onClick={() => onRemove(it.key)} aria-label={`Remove ${hex(it.rgb)}`} className="absolute -right-1.5 -top-1.5 hidden size-4 items-center justify-center rounded-full bg-ink text-paper group-hover:flex group-focus-within:flex">
                  <X aria-hidden className="size-2.5" />
                </button>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      ) : (
        <p className="px-3 py-3 text-[13px] text-ink-3">{empty}</p>
      )}
    </div>
  );
}

function Grid({ items, selected, onSelect }: { items: { key: string; rgb: RGB; note: string }[]; selected: RGB | null; onSelect: (c: RGB) => void }) {
  return (
    <ul className="grid grid-cols-2 gap-px bg-line">
      {items.map((it) => (
        <li key={it.key} className="bg-surface">
          <button type="button" onClick={() => onSelect(it.rgb)} className={cn("flex w-full items-center gap-2 px-2 py-1.5 text-left transition-colors hover:bg-paper-2/60", selected && hex(selected) === hex(it.rgb) && "bg-paper-2")}>
            <span className="size-6 shrink-0 rounded-[4px] border border-line" style={{ background: hex(it.rgb) }} />
            <span className="min-w-0">
              <span className="block font-mono text-[12px] text-ink">{hex(it.rgb).toUpperCase()}</span>
              <span className="block truncate text-[12px] text-ink-3">{it.note}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

const EXPORTS: { value: ExportKind | "png"; label: string; ext: string }[] = [
  { value: "css", label: "CSS variables", ext: "css" },
  { value: "tailwind", label: "Tailwind", ext: "css" },
  { value: "scss", label: "SCSS", ext: "scss" },
  { value: "json", label: "JSON", ext: "json" },
  { value: "gpl", label: "GIMP / Inkscape", ext: "gpl" },
  { value: "ase", label: "Adobe .ase", ext: "ase" },
  { value: "png", label: "Swatch image", ext: "png" },
];

function Exporter({ sets }: { sets: Record<"picked" | "palette" | "file", { rgb: RGB; name?: string }[]> }) {
  const available = (["picked", "palette", "file"] as const).filter((k) => sets[k].length);
  const [source, setSource] = useState<"picked" | "palette" | "file">("palette");
  const [kind, setKind] = useState<ExportKind | "png">("css");
  const [copied, setCopied] = useState(false);
  const src = available.includes(source) ? source : available[0];
  if (!src) return null;
  const list = sets[src];
  const text = kind === "ase" || kind === "png" ? "" : exportText(kind, list);
  const ext = EXPORTS.find((e) => e.value === kind)!.ext;
  const download = async () => {
    const blob = kind === "ase" ? exportAse(list) : kind === "png" ? await swatchPng(list) : new Blob([text], { type: "text/plain" });
    saveBlob(blob, `palette.${ext}`);
  };
  return (
    <Panel className="mt-3">
      <Row label="Export">
        <div className="space-y-2.5">
          <Chips value={src} onChange={setSource} options={available.map((k) => ({ value: k, label: { picked: `Picked (${sets.picked.length})`, palette: `Main colours (${sets.palette.length})`, file: `From the file (${sets.file.length})` }[k] }))} />
          <Chips value={kind} onChange={setKind} options={EXPORTS.map((e) => ({ value: e.value, label: e.label }))} />
          {text && <pre className="max-h-48 overflow-auto overscroll-contain rounded-sm border border-line bg-paper px-3 py-2 font-mono text-[12px] text-ink" data-lenis-prevent>{text}</pre>}
          <div className="flex gap-2">
            <button type="button" onClick={() => void download()} className="inline-flex h-10 items-center gap-1.5 rounded-md bg-ink px-3.5 text-sm font-medium text-paper">
              <Download aria-hidden className="size-4" /> Download .{ext}
            </button>
            {text && (
              <button type="button" onClick={() => void navigator.clipboard.writeText(text).then(() => (triggerHaptic("success"), setCopied(true), setTimeout(() => setCopied(false), 1200)))} className="inline-flex h-10 items-center gap-1.5 rounded-md border border-line bg-surface px-3.5 text-sm text-ink-2 hover:border-ink-3 hover:text-ink">
                {copied ? <Check aria-hidden className="size-4 text-success" /> : <Copy aria-hidden className="size-4" />} {copied ? "Copied" : "Copy"}
              </button>
            )}
          </div>
        </div>
      </Row>
    </Panel>
  );
}

