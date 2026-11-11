"use client";

import { useEffect, useRef, useState } from "react";
import { Eraser } from "lucide-react";
import { cn } from "@/lib/utils";
import { FileDrop } from "../file-drop";
import { Chips, Panel, TextField } from "./kit";

export type SignatureImage = { blob: Blob };

const INKS = [
  { value: "#111827", name: "Black" },
  { value: "#1e3a8a", name: "Blue" },
];

/** Crops a canvas to what's drawn on it (plus a little air) and returns it as a transparent PNG. */
function trimmedPng(canvas: HTMLCanvasElement): Promise<Blob | null> {
  const ctx = canvas.getContext("2d")!;
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  let x0 = width,
    y0 = height,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return Promise.resolve(null);
  const pad = 8;
  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  x1 = Math.min(width - 1, x1 + pad);
  y1 = Math.min(height - 1, y1 + pad);
  const out = document.createElement("canvas");
  out.width = x1 - x0 + 1;
  out.height = y1 - y0 + 1;
  out.getContext("2d")!.drawImage(canvas, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return new Promise((resolve) => out.toBlob(resolve, "image/png"));
}

/**
 * Make a signature (or initials): draw it, type it, or upload a photo of one. The result is a
 * transparent PNG, so it sits on the page like ink rather than a white sticker.
 */
export function SignatureMaker({
  kind,
  onDone,
  onCancel,
}: {
  kind: "full" | "initials";
  onDone: (img: SignatureImage) => void;
  onCancel: () => void;
}) {
  const [method, setMethod] = useState<"draw" | "type" | "upload">("draw");
  const [ink, setInk] = useState(INKS[0].value);
  const [name, setName] = useState("");
  const [drawn, setDrawn] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const last = useRef<{ x: number; y: number } | null>(null);

  // Crisp drawing on high-density screens.
  useEffect(() => {
    if (method === "upload") return;
    const c = canvas.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const rect = c.getBoundingClientRect();
    c.width = Math.round(rect.width * dpr);
    c.height = Math.round(rect.height * dpr);
    c.getContext("2d")!.scale(dpr, dpr);
  }, [method]);

  // Typed: draw the name in the site's script-like serif italic.
  useEffect(() => {
    if (method !== "type") return;
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    const w = c.getBoundingClientRect().width;
    const h = c.getBoundingClientRect().height;
    ctx.clearRect(0, 0, w, h);
    if (!name.trim()) return;
    const family = getComputedStyle(document.documentElement).getPropertyValue("--font-instrument-serif").trim() || "Georgia, serif";
    let size = kind === "initials" ? 64 : 56;
    ctx.font = `italic ${size}px ${family}`;
    while (ctx.measureText(name).width > w - 40 && size > 18) {
      size -= 2;
      ctx.font = `italic ${size}px ${family}`;
    }
    ctx.fillStyle = ink;
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.fillText(name, w / 2, h / 2);
  }, [method, name, ink, kind]);
  const ready = method === "type" ? Boolean(name.trim()) : drawn;

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (method !== "draw") return;
    e.currentTarget.setPointerCapture(e.pointerId);
    last.current = point(e);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!last.current) return;
    const ctx = e.currentTarget.getContext("2d")!;
    const p = point(e);
    ctx.strokeStyle = ink;
    ctx.lineWidth = kind === "initials" ? 3 : 2.6;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    // A midpoint curve smooths the stroke without lagging behind the pointer.
    const mid = { x: (last.current.x + p.x) / 2, y: (last.current.y + p.y) / 2 };
    ctx.moveTo(last.current.x, last.current.y);
    ctx.quadraticCurveTo(last.current.x, last.current.y, mid.x, mid.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    setDrawn(true);
  };
  const up = () => {
    last.current = null;
  };
  const clear = () => {
    const c = canvas.current;
    if (!c) return;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    setDrawn(false);
  };

  const finish = async () => {
    const c = canvas.current;
    if (!c) return;
    const blob = await trimmedPng(c);
    if (blob) onDone({ blob });
  };

  const fromUpload = async (file: File) => {
    if (!file.type.startsWith("image/")) return setUploadError("That isn't an image. Try a PNG or JPG.");
    if (file.size > 10 * 1024 * 1024) return setUploadError("Keep the image under 10 MB.");
    setUploadError(null);
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = reject;
        im.src = url;
      });
      const scale = Math.min(1, 1200 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * scale);
      c.height = Math.round(img.naturalHeight * scale);
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, 0, 0, c.width, c.height);
      // A photo of a signature on paper: make the light paper transparent, keep the ink.
      const data = ctx.getImageData(0, 0, c.width, c.height);
      for (let i = 0; i < data.data.length; i += 4) {
        const lum = 0.299 * data.data[i] + 0.587 * data.data[i + 1] + 0.114 * data.data[i + 2];
        if (lum > 200) data.data[i + 3] = 0;
        else if (lum > 150) data.data[i + 3] = Math.round(((200 - lum) / 50) * data.data[i + 3]);
      }
      ctx.putImageData(data, 0, 0);
      const blob = await trimmedPng(c);
      if (blob) onDone({ blob });
      else setUploadError("No signature found in that image. Try a darker photo.");
    } catch {
      setUploadError("That image couldn't be read. Try a PNG or JPG.");
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  const title = kind === "full" ? "Your signature" : "Your initials";
  return (
    <Panel className="bg-paper/50">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="label-mono text-ink-2">{title}</p>
        <Chips
          value={method}
          onChange={(m) => {
            setMethod(m);
            setDrawn(false);
          }}
          options={[
            { value: "draw", label: "Draw" },
            { value: "type", label: "Type" },
            { value: "upload", label: "Upload" },
          ]}
        />
      </div>

      {method === "upload" ? (
        <div className="mt-3">
          <FileDrop compact accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" title="Add a photo or scan of your signature" formats="On white paper works best · PNG or JPG" error={uploadError} onFile={fromUpload} />
        </div>
      ) : (
        <>
          {method === "type" && (
            <div className="mt-3">
              <TextField value={name} onChange={setName} label={kind === "full" ? "Your name" : "Your initials"} placeholder={kind === "full" ? "Type your name" : "Type your initials"} maxLength={60} />
            </div>
          )}
          <div className="relative mt-3">
            <canvas
              ref={canvas}
              onPointerDown={down}
              onPointerMove={move}
              onPointerUp={up}
              onPointerCancel={up}
              aria-label={method === "draw" ? `Draw ${kind === "full" ? "your signature" : "your initials"} here` : "Preview"}
              className={cn("block h-40 w-full touch-none rounded-md border border-line bg-surface", method === "draw" && "cursor-crosshair")}
            />
            {/* The signing line, like on paper. */}
            <span aria-hidden className="pointer-events-none absolute inset-x-8 bottom-9 h-px bg-line" />
            {method === "draw" && !drawn && (
              <span aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-ink-3">
                Sign here with your mouse, finger or pen
              </span>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              {INKS.map((i) => (
                <button
                  key={i.value}
                  type="button"
                  aria-label={`${i.name} ink`}
                  title={`${i.name} ink`}
                  aria-pressed={ink === i.value}
                  onClick={() => setInk(i.value)}
                  className={cn("size-9 rounded-sm border p-1.5", ink === i.value ? "border-ink" : "border-line")}
                >
                  <span className="block size-full rounded-full" style={{ background: i.value }} />
                </button>
              ))}
              {method === "draw" && (
                <button type="button" onClick={clear} className="ml-1 inline-flex h-9 items-center gap-1.5 rounded-sm px-2 text-sm text-ink-3 hover:bg-paper-2 hover:text-ink">
                  <Eraser aria-hidden className="size-4" /> Clear
                </button>
              )}
            </div>
            <div className="flex gap-1.5">
              <button type="button" onClick={onCancel} className="inline-flex h-10 items-center rounded-md border border-line bg-surface px-3 text-sm text-ink-2 hover:border-ink-3">
                Cancel
              </button>
              <button
                type="button"
                onClick={finish}
                disabled={!ready}
                className="inline-flex h-10 items-center rounded-md bg-ink px-4 text-sm font-medium text-paper transition-colors hover:bg-ink/85 disabled:opacity-40"
              >
                {kind === "full" ? "Use this signature" : "Use these initials"}
              </button>
            </div>
          </div>
        </>
      )}
      <p className="mt-2 text-xs text-ink-3">Then click on the page wherever it should go. Place it as many times as you need.</p>
    </Panel>
  );
}
