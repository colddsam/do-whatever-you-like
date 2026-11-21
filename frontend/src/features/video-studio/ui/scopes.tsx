"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { getEngine } from "../engine/playback";
import { getStudio, useStudio } from "../store/studio-store";
import { IconButton, Segmented } from "./controls";

/**
 * Live broadcast-style Video Scopes overlay reading downsampled pixels straight from the WebGL
 * compositor framebuffer: Waveform, RGB Parade, Histogram, and BT.709 CbCr Vectorscope with a
 * skin-tone line reticle.
 */

type ScopeMode = "waveform" | "parade" | "histogram" | "vectorscope";

function drawWaveform(ctx: CanvasRenderingContext2D, data: Uint8ClampedArray, w: number, h: number, cw: number, ch: number) {
  ctx.fillStyle = "rgba(15, 14, 10, 0.9)";
  ctx.fillRect(0, 0, cw, ch);

  ctx.strokeStyle = "rgba(243, 240, 232, 0.14)";
  ctx.lineWidth = 1;
  for (const pct of [0.25, 0.5, 0.75]) {
    const y = Math.round(ch * pct) + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(cw, y);
    ctx.stroke();
  }

  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = "rgba(180, 235, 175, 0.22)";
  const colScale = cw / w;
  for (let x = 0; x < w; x++) {
    const px = Math.floor(x * colScale);
    const pw = Math.max(1, Math.ceil(colScale));
    for (let y = 0; y < h; y++) {
      const i = (y * w + x) * 4;
      const luma = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
      const py = Math.round((1 - luma) * (ch - 2));
      ctx.fillRect(px, py, pw, 1);
    }
  }
  ctx.globalCompositeOperation = "source-over";
}

function drawParade(ctx: CanvasRenderingContext2D, data: Uint8ClampedArray, w: number, h: number, cw: number, ch: number) {
  ctx.fillStyle = "rgba(15, 14, 10, 0.9)";
  ctx.fillRect(0, 0, cw, ch);

  const third = cw / 3;
  ctx.strokeStyle = "rgba(243, 240, 232, 0.14)";
  ctx.beginPath();
  ctx.moveTo(third, 0);
  ctx.lineTo(third, ch);
  ctx.moveTo(third * 2, 0);
  ctx.lineTo(third * 2, ch);
  ctx.stroke();

  ctx.globalCompositeOperation = "lighter";
  const colors = ["rgba(239,68,68,0.28)", "rgba(34,197,94,0.28)", "rgba(59,130,246,0.28)"];
  const colScale = third / w;
  for (let c = 0; c < 3; c++) {
    ctx.fillStyle = colors[c];
    const ox = c * third;
    for (let x = 0; x < w; x++) {
      const px = Math.floor(ox + x * colScale);
      for (let y = 0; y < h; y += 2) {
        const v = data[(y * w + x) * 4 + c] / 255;
        const py = Math.round((1 - v) * (ch - 2));
        ctx.fillRect(px, py, Math.max(1, Math.ceil(colScale)), 1);
      }
    }
  }
  ctx.globalCompositeOperation = "source-over";
}

function drawHistogram(ctx: CanvasRenderingContext2D, data: Uint8ClampedArray, w: number, h: number, cw: number, ch: number) {
  ctx.fillStyle = "rgba(15, 14, 10, 0.9)";
  ctx.fillRect(0, 0, cw, ch);
  const binsR = new Uint32Array(64);
  const binsG = new Uint32Array(64);
  const binsB = new Uint32Array(64);
  const n = w * h;
  for (let i = 0; i < n; i++) {
    binsR[data[i * 4] >> 2]++;
    binsG[data[i * 4 + 1] >> 2]++;
    binsB[data[i * 4 + 2] >> 2]++;
  }
  let peak = 1;
  for (let i = 1; i < 63; i++) peak = Math.max(peak, binsR[i], binsG[i], binsB[i]);
  peak = Math.max(peak, n * 0.04);

  ctx.globalCompositeOperation = "lighter";
  const plot = (bins: Uint32Array, fill: string) => {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(0, ch);
    for (let i = 0; i < 64; i++) {
      const x = (i / 63) * cw;
      const y = ch - Math.min(1, bins[i] / peak) * (ch - 8);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(cw, ch);
    ctx.closePath();
    ctx.fill();
  };
  plot(binsR, "rgba(239, 68, 68, 0.5)");
  plot(binsG, "rgba(34, 197, 94, 0.5)");
  plot(binsB, "rgba(59, 130, 246, 0.5)");
  ctx.globalCompositeOperation = "source-over";
}

function drawVectorscope(ctx: CanvasRenderingContext2D, data: Uint8ClampedArray, w: number, h: number, cw: number, ch: number) {
  ctx.fillStyle = "rgba(15, 14, 10, 0.9)";
  ctx.fillRect(0, 0, cw, ch);
  const cx = cw / 2;
  const cy = ch / 2;
  const rad = Math.min(cw, ch) * 0.44;

  ctx.strokeStyle = "rgba(243, 240, 232, 0.16)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, rad, 0, Math.PI * 2);
  ctx.moveTo(cx - rad, cy);
  ctx.lineTo(cx + rad, cy);
  ctx.moveTo(cx, cy - rad);
  ctx.lineTo(cx, cy + rad);
  ctx.stroke();

  // Skin-tone indicator line (~123° in CbCr space)
  ctx.strokeStyle = "rgba(235, 165, 110, 0.45)";
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx - rad * 0.45, cy - rad * 0.85);
  ctx.stroke();

  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = "rgba(140, 240, 210, 0.28)";
  const n = w * h;
  for (let i = 0; i < n; i++) {
    const r = data[i * 4] / 255;
    const g = data[i * 4 + 1] / 255;
    const b = data[i * 4 + 2] / 255;
    const cb = -0.1146 * r - 0.3854 * g + 0.5 * b;
    const cr = 0.5 * r - 0.4542 * g - 0.0458 * b;
    const x = cx + cb * 2 * rad;
    const y = cy - cr * 2 * rad;
    ctx.fillRect(Math.round(x), Math.round(y), 1.5, 1.5);
  }
  ctx.globalCompositeOperation = "source-over";
}

export function VideoScopes() {
  const [mode, setMode] = useState<ScopeMode>("waveform");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playhead = useStudio((s) => s.playhead);
  const playing = useStudio((s) => s.playing);
  const project = useStudio((s) => s.project);

  useEffect(() => {
    let raf = 0;
    let lastDraw = 0;
    const render = (now: number) => {
      if (now - lastDraw >= 65) {
        lastDraw = now;
        const cv = canvasRef.current;
        const frame = getEngine()?.readScopeFrame();
        if (cv && frame) {
          const ctx = cv.getContext("2d");
          if (ctx) {
            const cw = cv.width;
            const ch = cv.height;
            if (mode === "waveform") drawWaveform(ctx, frame.data, frame.width, frame.height, cw, ch);
            else if (mode === "parade") drawParade(ctx, frame.data, frame.width, frame.height, cw, ch);
            else if (mode === "histogram") drawHistogram(ctx, frame.data, frame.width, frame.height, cw, ch);
            else drawVectorscope(ctx, frame.data, frame.width, frame.height, cw, ch);
          }
        }
      }
      if (playing) raf = requestAnimationFrame(render);
    };
    const id = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(id);
      cancelAnimationFrame(raf);
    };
  }, [mode, playhead, playing, project]);

  return (
    <div className="pointer-events-auto absolute right-2 top-2 z-20 w-[min(264px,calc(100%-16px))] rounded-md border border-line-dark bg-ink-raised/95 p-2 shadow-float backdrop-blur-sm">
      <div className="mb-1.5 flex items-center gap-1">
        <Segmented<ScopeMode>
          label="Video scope"
          value={mode}
          onChange={setMode}
          options={[
            { value: "waveform", label: "Luma" },
            { value: "parade", label: "RGB" },
            { value: "histogram", label: "Hist" },
            { value: "vectorscope", label: "Vec" },
          ]}
        />
        <IconButton label="Close video scopes" onClick={() => getStudio().set({ scopes: false })} className="size-7 shrink-0 sm:size-7">
          <X aria-hidden className="size-3.5" />
        </IconButton>
      </div>
      <canvas ref={canvasRef} width={248} height={124} className="block h-[96px] w-full rounded-sm border border-line-dark bg-ink sm:h-[124px]" />
    </div>
  );
}
