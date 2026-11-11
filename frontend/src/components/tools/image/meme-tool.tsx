"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, Download } from "lucide-react";
import { checkFile, saveBlob } from "@/lib/files";
import { acceptFor, formatList, IMAGE_INPUTS } from "@/lib/image";
import { formatBytes } from "@/lib/media";
import { getTool, stepsFor } from "@/lib/tools";
import { cn } from "@/lib/utils";
import { FileDrop } from "../file-drop";
import { Workbench } from "../workbench";
import { Chips, Panel, Row, Slider, Swatches, TextField, Toggle } from "../pdf/kit";
import { swap } from "../pdf/parts";
import { familyFor, FONT_CLASSES, loadFont, type FontKey } from "./fonts";
import { CHECKER } from "./task";

type Meme = {
  layout: "inside" | "outside";
  top: string;
  bottom: string;
  font: FontKey;
  size: number;
  color: string;
  outline: string;
  band: string;
  caps: boolean;
};

const MAX_SIDE = 2400;

/** Breaks a caption into lines that fit `width` at the current font. */
function wrap(g: CanvasRenderingContext2D, text: string, width: number) {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (g.measureText(next).width <= width || !line) line = next;
      else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

/** Draws the meme at `scale` of the picture's size (1 for the file, less for the preview). */
function drawMeme(canvas: HTMLCanvasElement, img: HTMLImageElement, m: Meme, maxSide: number) {
  const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * k);
  const h = Math.round(img.naturalHeight * k);
  const g = canvas.getContext("2d")!;
  const px = Math.max(10, Math.round(m.size * w));
  const family = familyFor(m.font, `${m.top} ${m.bottom}`);
  const font = `${m.font === "impact" ? 400 : 700} ${px}px ${family}`;
  g.font = font;
  const lineH = px * 1.12;
  const textW = w * 0.92;
  const top = wrap(g, m.caps ? m.top.toUpperCase() : m.top, textW);
  const bottom = wrap(g, m.caps ? m.bottom.toUpperCase() : m.bottom, textW);
  const pad = Math.round(px * 0.45);
  const bandTop = m.layout === "outside" && top.length ? top.length * lineH + pad * 2 : 0;
  const bandBottom = m.layout === "outside" && bottom.length ? bottom.length * lineH + pad * 2 : 0;

  canvas.width = w;
  canvas.height = Math.round(h + bandTop + bandBottom);
  g.fillStyle = m.band;
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.drawImage(img, 0, bandTop, w, h);

  g.font = font;
  g.textAlign = "center";
  g.textBaseline = "top";
  g.lineJoin = "round";
  g.miterLimit = 2;
  const stroke = m.layout === "inside" ? Math.max(2, px * 0.12) : 0;
  const draw = (lines: string[], y0: number) =>
    lines.forEach((line, i) => {
      const y = y0 + i * lineH;
      if (stroke) {
        g.strokeStyle = m.outline;
        g.lineWidth = stroke;
        g.strokeText(line, w / 2, y);
      }
      g.fillStyle = m.color;
      g.fillText(line, w / 2, y);
    });
  if (m.layout === "inside") {
    draw(top, pad);
    draw(bottom, canvas.height - pad - bottom.length * lineH);
  } else {
    draw(top, pad);
    draw(bottom, bandTop + h + pad);
  }
}

/** Meme generator: a picture, captions on it (or in bands above and below), made in the browser. */
export function MemeGeneratorTool({ toolId }: { toolId: string }) {
  const tool = getTool(toolId)!;
  const [file, setFile] = useState<File | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [rejected, setRejected] = useState<string | null>(null);
  const [m, setM] = useState<Meme>({
    layout: "inside",
    top: "When the PDF finally merges",
    bottom: "on the first try",
    font: "impact",
    size: 0.09,
    color: "#ffffff",
    outline: "#000000",
    band: "#ffffff",
    caps: true,
  });
  const [format, setFormat] = useState<"jpg" | "png">("jpg");
  const [out, setOut] = useState<{ blob: Blob; saved: boolean } | null>(null);
  // State, not a ref: the canvas mounts after the drop zone animates out, and drawing must wait for it.
  const [preview, setPreview] = useState<HTMLCanvasElement | null>(null);
  const set = <K extends keyof Meme>(k: K, v: Meme[K]) => {
    setM((prev) => {
      const next = { ...prev, [k]: v };
      // Captions in bands read best as dark text on white, captions on the picture as white with an outline.
      if (k === "layout") Object.assign(next, v === "outside" ? { color: "#000000", band: "#ffffff" } : { color: "#ffffff", outline: "#000000" });
      return next;
    });
  };

  const pick = (f: File) => {
    const problem = checkFile(f, [...IMAGE_INPUTS.canvas], 50);
    setRejected(problem);
    if (problem) return;
    const url = URL.createObjectURL(f);
    const el = new Image();
    el.onload = () => {
      setFile(f);
      setImg(el);
    };
    el.onerror = () => setRejected("This browser can't open that picture. Try a JPG or PNG.");
    el.src = url;
  };

  // Preview (fast, small), then the real file in the background so the button shows its exact size.
  useEffect(() => {
    if (!img || !preview) return;
    let cancelled = false;
    const family = familyFor(m.font, `${m.top} ${m.bottom}`);
    const timer = setTimeout(async () => {
      await loadFont(family, m.font === "impact" ? 400 : 700);
      if (cancelled) return;
      drawMeme(preview, img, m, 900);
      const full = document.createElement("canvas");
      drawMeme(full, img, m, MAX_SIDE);
      full.toBlob((blob) => !cancelled && blob && setOut({ blob, saved: false }), format === "png" ? "image/png" : "image/jpeg", 0.92);
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [img, m, format, preview]);

  const save = () => {
    if (!out || !file) return;
    saveBlob(out.blob, `${file.name.replace(/\.[^.]+$/, "") || "meme"}-meme.${format}`);
    setOut({ ...out, saved: true });
  };

  const step = !img ? 0 : out?.saved ? 3 : 1;

  return (
    <div className={FONT_CLASSES}>
      <Workbench steps={stepsFor(tool)} current={step} footer={<>Made right here in your browser: your picture never leaves your device.</>}>
        <div className="space-y-3 p-3 sm:p-4">
          <AnimatePresence mode="wait" initial={false}>
            {!img ? (
              <motion.div key="drop" {...swap}>
                <FileDrop accept={acceptFor("canvas")} title="Drop a picture here" formats={`${formatList("canvas")} — any photo or screenshot`} error={rejected} onFile={pick} />
              </motion.div>
            ) : (
              <motion.div key="edit" {...swap} className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] md:items-start">
                <Panel>
                  <Row label="Captions">
                    <Chips
                      label="Where the text goes"
                      value={m.layout}
                      onChange={(v) => set("layout", v)}
                      options={[
                        { value: "inside", label: "On the picture" },
                        { value: "outside", label: "Above and below" },
                      ]}
                    />
                    <div className="mt-3 space-y-2">
                      <TextField value={m.top} onChange={(v) => set("top", v.slice(0, 160))} label="Top text" placeholder="Top text" />
                      <TextField value={m.bottom} onChange={(v) => set("bottom", v.slice(0, 160))} label="Bottom text" placeholder="Bottom text" />
                    </div>
                  </Row>
                  <Row label="Lettering">
                    <Chips
                      label="Font"
                      value={m.font}
                      onChange={(v) => set("font", v)}
                      options={[
                        { value: "impact", label: "Impact" },
                        { value: "sans", label: "Sans" },
                        { value: "serif", label: "Serif" },
                        { value: "hand", label: "Handwritten" },
                      ]}
                    />
                    <div className="mt-2">
                      <Slider label="Text size" value={Math.round(m.size * 100)} min={4} max={20} onChange={(v) => set("size", v / 100)} format={(v) => `${v}%`} />
                    </div>
                    <Toggle checked={m.caps} onChange={(v) => set("caps", v)} label="ALL CAPS" />
                  </Row>
                  <Row label="Colours">
                    <p className="label-mono mb-1.5 text-ink-3">Text</p>
                    <Swatches
                      value={m.color}
                      onChange={(v) => set("color", v)}
                      colors={[
                        { value: "#ffffff", name: "White" },
                        { value: "#000000", name: "Black" },
                        { value: "#facc15", name: "Yellow" },
                        { value: "#eb4a10", name: "Signal orange" },
                      ]}
                    />
                    <p className="label-mono mb-1.5 mt-3 text-ink-3">{m.layout === "inside" ? "Outline" : "Bands"}</p>
                    {m.layout === "inside" ? (
                      <Swatches
                        value={m.outline}
                        onChange={(v) => set("outline", v)}
                        colors={[
                          { value: "#000000", name: "Black" },
                          { value: "#ffffff", name: "White" },
                        ]}
                      />
                    ) : (
                      <Swatches
                        value={m.band}
                        onChange={(v) => set("band", v)}
                        colors={[
                          { value: "#ffffff", name: "White" },
                          { value: "#000000", name: "Black" },
                          { value: "#f3f0e8", name: "Paper" },
                        ]}
                      />
                    )}
                  </Row>
                </Panel>
                <div className="space-y-3 md:sticky md:top-24">
                  <figure>
                    <div className={cn("flex justify-center overflow-hidden rounded-md border border-line p-2", CHECKER)}>
                      <canvas ref={setPreview} className="block h-auto max-h-[min(62vh,560px)] max-w-full" aria-label="Your meme" />
                    </div>
                    <figcaption className="label-mono mt-2 flex items-center justify-between gap-2 text-ink-3">
                      <span className="flex min-w-0 items-center gap-2">
                        <span aria-hidden className="h-px w-6 shrink-0 bg-ink-3" />
                        <span className="truncate">Fig. 01 — {file?.name}</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setImg(null);
                          setFile(null);
                          setOut(null);
                        }}
                        className="shrink-0 normal-case tracking-normal text-ink-2 underline-offset-4 hover:text-ink hover:underline"
                      >
                        Change picture
                      </button>
                    </figcaption>
                  </figure>
                  <div className="flex flex-wrap items-center gap-2">
                    <Chips
                      label="Format"
                      value={format}
                      onChange={setFormat}
                      options={[
                        { value: "jpg", label: "JPG" },
                        { value: "png", label: "PNG" },
                      ]}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={save}
                    disabled={!out}
                    className="inline-flex h-12 w-full items-center justify-center gap-2 whitespace-nowrap rounded-md bg-ink px-5 text-[15px] font-medium text-paper transition-[background-color,transform] duration-150 hover:bg-ink/85 active:translate-y-px disabled:opacity-40"
                  >
                    {out?.saved ? <Check aria-hidden className="size-4" /> : <Download aria-hidden className="size-4" />}
                    {out?.saved ? "Saved. Download again" : `Download ${format.toUpperCase()}`}
                    {out && <span className="font-mono text-[13px] font-normal text-paper/60">{formatBytes(out.blob.size)}</span>}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </Workbench>
    </div>
  );
}
