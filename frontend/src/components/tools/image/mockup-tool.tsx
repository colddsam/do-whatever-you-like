"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, RotateCcw, Sparkles } from "lucide-react";
import { saveBlob } from "@/lib/files";
import { getTool, stepsFor } from "@/lib/tools";
import { cn } from "@/lib/utils";
import { FileDrop } from "../file-drop";
import { Workbench } from "../workbench";
import { Chips, Notice, Panel, Row, Slider, TextField, Toggle } from "../pdf/kit";
import { CHECKER } from "./task";

type FrameKind = "browser" | "phone" | "card" | "yt-thumb" | "ig-reels" | "tiktok" | "yt-shorts" | "ig-feed";

const FRAMES: {
  id: FrameKind;
  group: "mockup" | "social";
  label: string;
  outW: number;
  outH: number;
  note: string;
}[] = [
  { id: "browser", group: "mockup", label: "macOS Browser", outW: 1600, outH: 1050, note: "Window chrome + traffic lights + soft shadow" },
  { id: "phone", group: "mockup", label: "Phone Frame", outW: 1080, outH: 1920, note: "Clean mobile bezel + Dynamic Island" },
  { id: "card", group: "mockup", label: "Minimal Card", outW: 1600, outH: 1000, note: "Rounded frame on custom studio backdrop" },
  { id: "yt-thumb", group: "social", label: "YouTube Thumb (16:9)", outW: 1280, outH: 720, note: "Avoids bottom-right timestamp badge (230×72 px)" },
  { id: "ig-reels", group: "social", label: "IG Reels (9:16)", outW: 1080, outH: 1920, note: "Safe box leaves room for top bar, right icons & caption" },
  { id: "tiktok", group: "social", label: "TikTok (9:16)", outW: 1080, outH: 1920, note: "Protects right action rail + bottom audio & description" },
  { id: "yt-shorts", group: "social", label: "YouTube Shorts (9:16)", outW: 1080, outH: 1920, note: "Clears right thumbs rail & bottom channel/subscribe bar" },
  { id: "ig-feed", group: "social", label: "IG Portrait (4:5)", outW: 1080, outH: 1350, note: "4:5 feed crop + 1:1 profile grid center square guide" },
];

const BACKGROUNDS = [
  { id: "paper", label: "Warm Paper", css: "#f6f5f1" },
  { id: "aurora", label: "Aurora Mesh", css: "linear-gradient(135deg, #f97316, #ec4899, #6366f1)" },
  { id: "ocean", label: "Cool Slate", css: "linear-gradient(135deg, #0ea5e9, #1d4ed8)" },
  { id: "obsidian", label: "Obsidian", css: "linear-gradient(145deg, #18181b, #27272a)" },
  { id: "transparent", label: "Transparent", css: "transparent" },
] as const;

type BgId = (typeof BACKGROUNDS)[number]["id"];

async function makeSampleScreenshotFile(): Promise<File> {
  const c = document.createElement("canvas");
  c.width = 1280;
  c.height = 800;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(0, 0, 1280, 800);
  // Top nav
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(0, 0, 1280, 72);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 24px sans-serif";
  ctx.fillText("Product Analytics · Live Metrics", 40, 44);
  // Cards
  const cards = [
    { x: 40, title: "Active Users", val: "48,920", accent: "#2563eb" },
    { x: 440, title: "Revenue (MTD)", val: "₹14.6L", accent: "#16a34a" },
    { x: 840, title: "Conversion", val: "4.82%", accent: "#ea580c" },
  ];
  for (const card of cards) {
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(card.x, 112, 370, 170, 16);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#64748b";
    ctx.font = "600 18px sans-serif";
    ctx.fillText(card.title, card.x + 28, 160);
    ctx.fillStyle = card.accent;
    ctx.font = "bold 48px sans-serif";
    ctx.fillText(card.val, card.x + 28, 228);
  }
  // Chart area
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.roundRect(40, 316, 1200, 430, 20);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = "#2563eb";
  ctx.lineWidth = 6;
  ctx.beginPath();
  [610, 560, 580, 490, 510, 430, 390, 410, 355].forEach((y, i) => {
    const x = 90 + i * 136;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  const blob = await new Promise<Blob>((res) => c.toBlob((b) => res(b!), "image/png"));
  return new File([blob], "dashboard-preview.png", { type: "image/png" });
}

function drawSafeOverlay(ctx: CanvasRenderingContext2D, frame: FrameKind, W: number, H: number) {
  ctx.save();
  ctx.lineWidth = Math.max(2, Math.round(W / 360));
  ctx.font = `600 ${Math.max(18, Math.round(W / 44))}px sans-serif`;

  const dangerRect = (x: number, y: number, w: number, h: number, label: string) => {
    ctx.fillStyle = "rgba(239, 68, 68, 0.28)";
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "rgba(239, 68, 68, 0.9)";
    ctx.setLineDash([8, 6]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(label, x + 16, y + Math.min(h / 2 + 6, 36));
  };

  if (frame === "yt-thumb") {
    dangerRect(W - 250, H - 86, 226, 62, "TIMESTAMP 12:34");
    ctx.strokeStyle = "rgba(34, 197, 94, 0.9)";
    ctx.strokeRect(48, 36, W - 96, H - 72);
  } else if (frame === "ig-reels" || frame === "tiktok" || frame === "yt-shorts") {
    // Top bar
    dangerRect(0, 0, W, Math.round(H * 0.13), "Header / Camera / Search");
    // Right engagement buttons
    const rightW = Math.round(W * 0.17);
    const bottomH = frame === "tiktok" ? Math.round(H * 0.28) : frame === "yt-shorts" ? Math.round(H * 0.24) : Math.round(H * 0.25);
    dangerRect(W - rightW, Math.round(H * 0.44), rightW, H - Math.round(H * 0.44) - bottomH, "Likes / Share");
    // Bottom caption + nav
    dangerRect(0, H - bottomH, W, bottomH, frame === "yt-shorts" ? "Channel + Subscribe + Title" : "Caption + Audio + Nav");
    // Safe central box
    ctx.strokeStyle = "rgba(34, 197, 94, 0.95)";
    ctx.lineWidth = 4;
    ctx.strokeRect(60, Math.round(H * 0.14), W - rightW - 76, H - Math.round(H * 0.14) - bottomH - 16);
    ctx.fillStyle = "rgba(34, 197, 94, 0.95)";
    ctx.fillText("SAFE CONTENT ZONE", 80, Math.round(H * 0.17));
  } else if (frame === "ig-feed") {
    // Profile grid 1:1 square center guide inside 1080x1350
    const sqY = (H - W) / 2;
    ctx.fillStyle = "rgba(15, 23, 42, 0.35)";
    ctx.fillRect(0, 0, W, sqY);
    ctx.fillRect(0, sqY + W, W, H - (sqY + W));
    ctx.strokeStyle = "rgba(34, 197, 94, 0.95)";
    ctx.strokeRect(4, sqY, W - 8, W);
    ctx.fillStyle = "#ffffff";
    ctx.fillText("1:1 PROFILE GRID CROP", 28, sqY + 38);
  }
  ctx.restore();
}

export function MockupSafeZoneTool({ toolId }: { toolId: string }) {
  const tool = getTool(toolId)!;
  const [file, setFile] = useState<File | null>(null);
  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null);
  const [frame, setFrame] = useState<FrameKind>("browser");
  const [bg, setBg] = useState<BgId>("aurora");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [urlBar, setUrlBar] = useState("do-whatever-you-like.app");
  const [padding, setPadding] = useState(72);
  const [radius, setRadius] = useState(16);
  const [shadow, setShadow] = useState(50);
  const [fit, setFit] = useState<"cover" | "contain">("contain");
  const [showGuides, setShowGuides] = useState(true);
  const [burnGuides, setBurnGuides] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
  }, []);

  async function loadFile(f: File) {
    const u = URL.createObjectURL(f);
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = u;
    const img = new Image();
    img.src = u;
    await new Promise<void>((res) => {
      img.onload = () => res();
      img.onerror = () => res();
    });
    setFile(f);
    setImgEl(img);
  }

  const activeSpec = FRAMES.find((f) => f.id === frame)!;

  const paintCanvas = useCallback(
    (targetCanvas: HTMLCanvasElement, includeSocialGuides: boolean) => {
      if (!imgEl) return;
      const W = activeSpec.outW;
      const H = activeSpec.outH;
      targetCanvas.width = W;
      targetCanvas.height = H;
      const ctx = targetCanvas.getContext("2d")!;
      ctx.clearRect(0, 0, W, H);

      const drawBackdrop = () => {
        if (bg === "transparent") return;
        if (bg === "paper") {
          ctx.fillStyle = "#f6f5f1";
          ctx.fillRect(0, 0, W, H);
          return;
        }
        const grad = ctx.createLinearGradient(0, 0, W, H);
        if (bg === "aurora") {
          grad.addColorStop(0, "#f97316");
          grad.addColorStop(0.5, "#ec4899");
          grad.addColorStop(1, "#6366f1");
        } else if (bg === "ocean") {
          grad.addColorStop(0, "#0ea5e9");
          grad.addColorStop(1, "#1d4ed8");
        } else {
          grad.addColorStop(0, "#18181b");
          grad.addColorStop(1, "#27272a");
        }
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);
      };

      const drawImageInBox = (bx: number, by: number, bw: number, bh: number, modeFit: "cover" | "contain") => {
        const iw = imgEl.naturalWidth || 1;
        const ih = imgEl.naturalHeight || 1;
        const ratio = modeFit === "cover" ? Math.max(bw / iw, bh / ih) : Math.min(bw / iw, bh / ih);
        const dw = iw * ratio;
        const dh = ih * ratio;
        const dx = bx + (bw - dw) / 2;
        const dy = by + (bh - dh) / 2;
        ctx.drawImage(imgEl, dx, dy, dw, dh);
      };

      if (activeSpec.group === "social") {
        drawBackdrop();
        drawImageInBox(0, 0, W, H, fit);
        if (includeSocialGuides) drawSafeOverlay(ctx, frame, W, H);
        return;
      }

      drawBackdrop();
      const pad = padding;
      const boxW = frame === "phone" ? Math.min(W - pad * 2, Math.round((H - pad * 2) * 0.48)) : W - pad * 2;
      const boxH = frame === "phone" ? H - pad * 2 : H - pad * 2;
      const boxX = (W - boxW) / 2;
      const boxY = (H - boxH) / 2;

      ctx.save();
      if (shadow > 0) {
        ctx.shadowColor = `rgba(15, 23, 42, ${(shadow / 100) * 0.42})`;
        ctx.shadowBlur = shadow * 1.1;
        ctx.shadowOffsetY = Math.round(shadow * 0.35);
      }

      const chromeBg = theme === "dark" ? "#18181b" : "#ffffff";
      const borderCol = theme === "dark" ? "rgba(255,255,255,0.14)" : "rgba(15,23,42,0.12)";

      ctx.beginPath();
      ctx.roundRect(boxX, boxY, boxW, boxH, frame === "phone" ? Math.max(radius, 42) : radius);
      ctx.fillStyle = chromeBg;
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.beginPath();
      ctx.roundRect(boxX, boxY, boxW, boxH, frame === "phone" ? Math.max(radius, 42) : radius);
      ctx.clip();

      if (frame === "browser") {
        const barH = 56;
        ctx.fillStyle = theme === "dark" ? "#27272a" : "#f4f4f5";
        ctx.fillRect(boxX, boxY, boxW, barH);
        const dots = ["#ef4444", "#f59e0b", "#22c55e"];
        dots.forEach((col, idx) => {
          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.arc(boxX + 26 + idx * 22, boxY + barH / 2, 7, 0, Math.PI * 2);
          ctx.fill();
        });
        // Address pill
        const pillW = Math.min(480, boxW * 0.46);
        ctx.fillStyle = theme === "dark" ? "#18181b" : "#ffffff";
        ctx.beginPath();
        ctx.roundRect(boxX + (boxW - pillW) / 2, boxY + 12, pillW, 32, 8);
        ctx.fill();
        ctx.fillStyle = theme === "dark" ? "#a1a1aa" : "#52525b";
        ctx.font = "500 15px monospace";
        ctx.textAlign = "center";
        ctx.fillText(urlBar || "localhost:3000", boxX + boxW / 2, boxY + 33);
        ctx.textAlign = "start";
        drawImageInBox(boxX, boxY + barH, boxW, boxH - barH, fit);
      } else if (frame === "phone") {
        const bezel = 18;
        ctx.fillStyle = theme === "dark" ? "#09090b" : "#18181b";
        ctx.fillRect(boxX, boxY, boxW, boxH);
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(boxX + bezel, boxY + bezel, boxW - bezel * 2, boxH - bezel * 2, Math.max(28, radius));
        ctx.clip();
        ctx.fillStyle = chromeBg;
        ctx.fillRect(boxX + bezel, boxY + bezel, boxW - bezel * 2, boxH - bezel * 2);
        drawImageInBox(boxX + bezel, boxY + bezel, boxW - bezel * 2, boxH - bezel * 2, fit);
        // Dynamic Island notch
        ctx.fillStyle = "#09090b";
        ctx.beginPath();
        ctx.roundRect(boxX + boxW / 2 - 58, boxY + bezel + 14, 116, 30, 15);
        ctx.fill();
        ctx.restore();
      } else {
        drawImageInBox(boxX, boxY, boxW, boxH, fit);
      }
      ctx.restore();

      // Subtle outer frame border
      ctx.strokeStyle = borderCol;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(boxX, boxY, boxW, boxH, frame === "phone" ? Math.max(radius, 42) : radius);
      ctx.stroke();
    },
    [imgEl, activeSpec, bg, frame, padding, radius, shadow, theme, urlBar, fit],
  );

  useEffect(() => {
    if (canvasRef.current && imgEl) {
      paintCanvas(canvasRef.current, showGuides);
    }
  }, [paintCanvas, imgEl, showGuides]);

  const downloadImage = async (mime: "image/png" | "image/webp") => {
    if (!imgEl) return;
    const offscreen = document.createElement("canvas");
    paintCanvas(offscreen, burnGuides);
    const blob = await new Promise<Blob>((res) => offscreen.toBlob((b) => res(b!), mime, 0.95));
    const ext = mime === "image/webp" ? "webp" : "png";
    const stem = (file?.name ?? "mockup").replace(/\.[^.]+$/, "");
    saveBlob(blob, `${stem}-${frame}.${ext}`);
  };

  return (
    <Workbench
      steps={stepsFor(tool)}
      current={!file ? 0 : 1}
      footer={<>Composited on an HTML5 Canvas locally in your browser. Zero images leave your device.</>}
    >
      <div className="space-y-4 p-4 sm:p-5">
        {!file ? (
          <div className="space-y-3">
            <FileDrop
              accept="image/png,image/jpeg,image/webp"
              title="Drop a screenshot or thumbnail image"
              formats="PNG · JPG · WEBP · rendered locally"
              onFile={(f) => void loadFile(f)}
            />
            <div className="flex justify-center">
              <button
                type="button"
                onClick={async () => void loadFile(await makeSampleScreenshotFile())}
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line bg-surface px-3.5 text-sm text-ink-2 hover:border-ink-3 hover:text-ink"
              >
                <Sparkles aria-hidden className="size-4" /> Load sample dashboard screenshot
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-paper px-3.5 py-2.5">
              <div>
                <p className="text-sm font-medium text-ink">{file.name}</p>
                <p className="font-mono text-[12px] text-ink-3">
                  Canvas output: {activeSpec.outW}×{activeSpec.outH}px · {activeSpec.note}
                </p>
              </div>
              <button
                type="button"
                onClick={() => (setFile(null), setImgEl(null))}
                className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-line bg-surface px-3 text-[12px] text-ink-2 hover:text-ink"
              >
                <RotateCcw aria-hidden className="size-3.5" /> Change image
              </button>
            </div>

            <Panel>
              <Row label="Frame / Safe zone">
                <Chips
                  value={frame}
                  onChange={setFrame}
                  options={FRAMES.map((f) => ({ value: f.id, label: f.label }))}
                />
              </Row>
              <Row label="Backdrop">
                <Chips
                  value={bg}
                  onChange={setBg}
                  options={BACKGROUNDS.map((b) => ({ value: b.id, label: b.label }))}
                />
              </Row>
              <Row label="Image fit">
                <Chips
                  value={fit}
                  onChange={setFit}
                  options={[
                    { value: "contain", label: "Fit whole image" },
                    { value: "cover", label: "Fill / crop frame" },
                  ]}
                />
              </Row>
              {activeSpec.group === "mockup" ? (
                <>
                  <Row label="Frame chrome">
                    <div className="grid gap-3 @xl:grid-cols-2">
                      <Chips
                        value={theme}
                        onChange={setTheme}
                        options={[
                          { value: "light", label: "Light chrome" },
                          { value: "dark", label: "Dark chrome" },
                        ]}
                      />
                      {frame === "browser" && (
                        <TextField value={urlBar} onChange={setUrlBar} label="Address bar text" placeholder="example.com" mono />
                      )}
                    </div>
                  </Row>
                  <Row label="Geometry">
                    <div className="grid gap-3 @xl:grid-cols-3">
                      <Slider label="Padding" value={padding} min={0} max={160} step={4} onChange={setPadding} format={(v) => `${v} px`} />
                      <Slider label="Corner radius" value={radius} min={0} max={44} onChange={setRadius} format={(v) => `${v} px`} />
                      <Slider label="Shadow" value={shadow} min={0} max={100} onChange={setShadow} format={(v) => `${v}%`} />
                    </div>
                  </Row>
                </>
              ) : (
                <Row label="Safe-zone overlay">
                  <div className="flex flex-wrap gap-4">
                    <Toggle checked={showGuides} onChange={setShowGuides} label="Show platform HUD safe-zone guides in preview" />
                    <Toggle checked={burnGuides} onChange={setBurnGuides} label="Include guide lines in downloaded file" />
                  </div>
                </Row>
              )}
            </Panel>

            {/* Preview Canvas */}
            <div className="grid grid-cols-[minmax(0,1fr)]">
              <div className={cn("flex justify-center overflow-hidden rounded-md border border-line p-4 sm:p-6", CHECKER)}>
                <canvas ref={canvasRef} className="max-h-[540px] max-w-full rounded-sm object-contain shadow-sm" />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => void downloadImage("image/webp")}
                className="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-surface px-4 text-sm font-medium text-ink hover:border-ink-3"
              >
                <Download aria-hidden className="size-4" /> Download WebP
              </button>
              <button
                type="button"
                onClick={() => void downloadImage("image/png")}
                className="inline-flex h-10 items-center gap-2 rounded-md bg-accent px-5 text-sm font-medium text-white hover:opacity-95"
              >
                <Download aria-hidden className="size-4" /> Download PNG
              </button>
            </div>

            <Notice tone="info">
              Safe-zone overlays warn where YouTube timestamps, Reels/TikTok buttons, or profile grid crops overlap so headlines stay readable.
            </Notice>
          </>
        )}
      </div>
    </Workbench>
  );
}
