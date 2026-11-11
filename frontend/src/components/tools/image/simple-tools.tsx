"use client";

import { useState } from "react";
import { FlipHorizontal2, FlipVertical2, RotateCcw, RotateCw } from "lucide-react";
import { IMAGE_API, megapixels, targetSize } from "@/lib/image";
import { cn } from "@/lib/utils";
import { Chips, Panel, Row, Slider, Swatches, TextField, Toggle } from "../pdf/kit";
import { plural } from "../pdf/parts";
import { ImageTask, type ImageItem } from "./task";

type ToolProps = { toolId: string; band?: React.ReactNode };

const BACKGROUNDS = [
  { value: "#ffffff", name: "White" },
  { value: "#000000", name: "Black" },
  { value: "#f3f0e8", name: "Paper" },
  { value: "#e5e7eb", name: "Light grey" },
];

/* ---------- Compress ---------- */

const LEVELS = {
  light: "Lossless: the same pixels, re-saved with the best settings.",
  recommended: "Looks the same, much smaller. PNGs become 256-colour images with dithering.",
  strong: "Smallest files. Fine detail may soften a little.",
} as const;

export function CompressImageTool({ toolId, band }: ToolProps) {
  const [level, setLevel] = useState<keyof typeof LEVELS>("recommended");
  const [keepMeta, setKeepMeta] = useState(false);
  return (
    <ImageTask
      toolId={toolId}
      band={band}
      input="compress"
      endpoint={IMAGE_API("compress")}
      label={({ items }) => `Compress ${plural(items.length, "image")}`}
      working="Compressing…"
      fields={() => [
        ["level", level],
        ["keep_metadata", String(keepMeta)],
      ]}
      hint="Each image keeps its format. If one can't get smaller, you get the original back."
      options={({ locked }) => (
        <Panel>
          <Row label="Strength">
            <Chips
              label="Strength"
              value={level}
              onChange={setLevel}
              disabled={locked}
              options={[
                { value: "light", label: "Light" },
                { value: "recommended", label: "Recommended" },
                { value: "strong", label: "Strong" },
              ]}
            />
            <p className="mt-2 text-xs text-ink-3">{LEVELS[level]}</p>
          </Row>
          <Row label="Metadata">
            <Toggle
              checked={keepMeta}
              onChange={setKeepMeta}
              disabled={locked}
              label="Keep camera details"
              description="Off removes EXIF (camera, date, location), which also saves space."
            />
          </Row>
        </Panel>
      )}
    />
  );
}

/* ---------- Resize ---------- */

export function ResizeImageTool({ toolId, band }: ToolProps) {
  const [mode, setMode] = useState<"pixels" | "percent">("pixels");
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [percent, setPercent] = useState(50);
  const [keepRatio, setKeepRatio] = useState(true);
  const [noEnlarge, setNoEnlarge] = useState(true);
  const w = Number(width) || null;
  const h = Number(height) || null;
  const opts = { mode, width: w, height: h, percent, keepRatio, noEnlarge };
  const target = (item: ImageItem) => (item.size ? targetSize(item.size.width, item.size.height, opts) : null);

  return (
    <ImageTask
      toolId={toolId}
      band={band}
      input="resize"
      endpoint={IMAGE_API("resize")}
      label={({ items }) => `Resize ${plural(items.length, "image")}`}
      working="Resizing…"
      fields={() => [
        ["mode", mode],
        ...(mode === "pixels"
          ? ([...(w ? [["width", String(w)]] : []), ...(h ? [["height", String(h)]] : [])] as [string, string][])
          : ([["percent", String(percent)]] as [string, string][])),
        ["keep_ratio", String(keepRatio)],
        ["no_enlarge", String(noEnlarge)],
      ]}
      invalid={() =>
        mode === "pixels" && !w && !h
          ? "Type a width, a height, or both."
          : (w ?? 0) > 30000 || (h ?? 0) > 30000
            ? "Keep sizes under 30,000 pixels."
            : null
      }
      tileNote={(item) => {
        const t = target(item);
        return t ? `→ ${t.width} × ${t.height}` : item.file.name.toLowerCase().endsWith(".svg") ? "→ vector, resized exactly" : null;
      }}
      hint="Animated GIFs stay animated, and SVGs are resized as vectors, with no blur."
      options={({ locked, items }) => {
        const first = items.find((i) => i.size);
        return (
          <Panel>
            <Row label="Resize by">
              <Chips
                label="Resize by"
                value={mode}
                onChange={setMode}
                disabled={locked}
                options={[
                  { value: "pixels", label: "Pixels" },
                  { value: "percent", label: "Percentage" },
                ]}
              />
            </Row>
            {mode === "pixels" ? (
              <Row label={keepRatio && items.length > 1 ? "Largest size" : "Size"} hint={first?.size ? `Original ${first.size.width} × ${first.size.height}` : undefined}>
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                  <TextField value={width} onChange={(v) => setWidth(v.replace(/\D/g, "").slice(0, 5))} label="Width in pixels" placeholder="Width" inputMode="numeric" mono disabled={locked} />
                  <span className="font-mono text-sm text-ink-3">×</span>
                  <TextField value={height} onChange={(v) => setHeight(v.replace(/\D/g, "").slice(0, 5))} label="Height in pixels" placeholder="Height" inputMode="numeric" mono disabled={locked} />
                </div>
                <div className="mt-3 space-y-2.5">
                  <Toggle
                    checked={keepRatio}
                    onChange={setKeepRatio}
                    disabled={locked}
                    label="Keep the proportions"
                    description={keepRatio ? "Images fit inside the size you give. Leave one box empty to set just that side." : "Images are stretched to exactly this size."}
                  />
                  <Toggle checked={noEnlarge} onChange={setNoEnlarge} disabled={locked} label="Don't enlarge smaller images" />
                </div>
              </Row>
            ) : (
              <Row label="Scale">
                <Chips
                  label="Scale"
                  value={[25, 50, 75].includes(percent) ? percent : 0}
                  onChange={(v) => v && setPercent(v)}
                  disabled={locked}
                  options={[
                    { value: 25, label: "25%" },
                    { value: 50, label: "50%" },
                    { value: 75, label: "75%" },
                  ]}
                />
                <div className="mt-2">
                  <Slider label="Scale" value={percent} min={5} max={400} step={5} onChange={setPercent} format={(v) => `${v}%`} disabled={locked} />
                </div>
                {percent > 100 && <Toggle checked={noEnlarge} onChange={setNoEnlarge} disabled={locked} label="Don't enlarge (keep the original size)" />}
              </Row>
            )}
          </Panel>
        );
      }}
    />
  );
}

/* ---------- Convert ---------- */

export function ConvertToJpgTool({ toolId, band }: ToolProps) {
  const [quality, setQuality] = useState<"recommended" | "high">("recommended");
  const [background, setBackground] = useState("#ffffff");
  return (
    <ImageTask
      toolId={toolId}
      band={band}
      input="convert"
      endpoint={IMAGE_API("convert")}
      label={({ items }) => `Convert ${plural(items.length, "image")} to JPG`}
      working="Converting…"
      fields={() => [
        ["target", "jpg"],
        ["quality", quality],
        ["background", background],
      ]}
      hint="HEIC, RAW, PSD and multi-page TIFF files use their main picture. Animated GIFs use the first frame."
      options={({ locked }) => (
        <Panel>
          <Row label="Quality">
            <Chips
              label="Quality"
              value={quality}
              onChange={setQuality}
              disabled={locked}
              options={[
                { value: "recommended", label: "Recommended" },
                { value: "high", label: "Highest" },
              ]}
            />
            <p className="mt-2 text-xs text-ink-3">
              {quality === "high"
                ? "Every pixel kept, JPG quality 95 with full colour detail. Bigger files."
                : "JPG quality 85. Very large photos are scaled to 6,000 px on the long side."}
            </p>
          </Row>
          <Row label="Transparent areas become">
            <Swatches value={background} onChange={setBackground} colors={BACKGROUNDS} disabled={locked} />
          </Row>
        </Panel>
      )}
    />
  );
}

type FromTarget = "png" | "webp" | "gif" | "animated";

export function ConvertFromJpgTool({ toolId, band }: ToolProps) {
  const [target, setTarget] = useState<FromTarget>("png");
  const [seconds, setSeconds] = useState(0.5);
  const [loop, setLoop] = useState(true);
  const [fit, setFit] = useState<"contain" | "cover">("contain");
  const [background, setBackground] = useState("#ffffff");
  const animated = target === "animated";
  return (
    <ImageTask
      toolId={toolId}
      band={band}
      input="gif"
      endpoint={IMAGE_API(animated ? "gif" : "convert")}
      sortable={animated}
      label={({ items }) => (animated ? `Make a GIF from ${plural(items.length, "image")}` : `Convert ${plural(items.length, "image")} to ${target.toUpperCase()}`)}
      working={animated ? "Making your GIF…" : "Converting…"}
      fields={() =>
        animated
          ? [
              ["seconds", String(seconds)],
              ["loop", String(loop)],
              ["fit", fit],
              ["background", background],
            ]
          : [
              ["target", target],
              ["quality", "high"],
            ]
      }
      invalid={({ items }) => (animated && items.length < 2 ? "Add at least two images to make an animation." : null)}
      tileNote={(_, { items }) => (animated && items.length > 1 ? `frame · ${seconds}s` : null)}
      hint={animated ? "Frames play in the order shown. Use the arrows under each image to reorder them." : "PNG and WebP keep every pixel. GIF uses 256 colours."}
      options={({ locked }) => (
        <Panel>
          <Row label="Convert to">
            <Chips
              label="Convert to"
              value={target}
              onChange={setTarget}
              disabled={locked}
              options={[
                { value: "png", label: "PNG" },
                { value: "webp", label: "WebP" },
                { value: "gif", label: "GIF" },
                { value: "animated", label: "Animated GIF" },
              ]}
            />
          </Row>
          {animated && (
            <>
              <Row label="Each image shows for">
                <Slider label="Seconds per image" value={seconds} min={0.1} max={5} step={0.1} onChange={setSeconds} format={(v) => `${v.toFixed(1)} s`} disabled={locked} />
              </Row>
              <Row label="Frames">
                <Chips
                  label="Fit"
                  value={fit}
                  onChange={setFit}
                  disabled={locked}
                  options={[
                    { value: "contain", label: "Fit whole image" },
                    { value: "cover", label: "Fill the frame" },
                  ]}
                />
                <p className="mt-2 text-xs text-ink-3">Every frame takes the size of the first image.</p>
                <div className="mt-3">
                  <Toggle checked={loop} onChange={setLoop} disabled={locked} label="Loop forever" />
                </div>
              </Row>
              {fit === "contain" && (
                <Row label="Space around images">
                  <Swatches value={background} onChange={setBackground} colors={BACKGROUNDS} disabled={locked} />
                </Row>
              )}
            </>
          )}
        </Panel>
      )}
    />
  );
}

/* ---------- Rotate ---------- */

type Turn = { angle: number; flipH: boolean; flipV: boolean };
const NO_TURN: Turn = { angle: 0, flipH: false, flipV: false };

export function RotateImageTool({ toolId, band }: ToolProps) {
  const [turns, setTurns] = useState<Record<string, Turn>>({});
  const [only, setOnly] = useState<"all" | "portrait" | "landscape">("all");
  const turnOf = (id: string) => turns[id] ?? NO_TURN;
  const update = (id: string, f: (t: Turn) => Turn) => setTurns((all) => ({ ...all, [id]: f(all[id] ?? NO_TURN) }));
  const matches = (i: ImageItem) =>
    only === "all" || !i.size || (only === "portrait" ? i.size.height > i.size.width : i.size.width >= i.size.height);
  const rotateAll = (items: ImageItem[], by: 90 | -90) =>
    setTurns((all) => {
      const next = { ...all };
      for (const i of items) if (matches(i)) next[i.id] = { ...(next[i.id] ?? NO_TURN), angle: ((next[i.id]?.angle ?? 0) + by + 360) % 360 };
      return next;
    });
  const btn =
    "inline-flex size-8 items-center justify-center rounded-[6px] bg-surface/90 text-ink-2 shadow-sm transition-colors hover:bg-surface hover:text-ink";

  return (
    <ImageTask
      toolId={toolId}
      band={band}
      input="rotate"
      endpoint={IMAGE_API("rotate")}
      onItems={(items) => setTurns((all) => Object.fromEntries(items.map((i) => [i.id, all[i.id] ?? NO_TURN])))}
      label={({ items }) => `Rotate ${plural(items.length, "image")}`}
      working="Rotating…"
      fields={({ items }) => [["turns", JSON.stringify(items.map((i) => ({ angle: turnOf(i.id).angle, flip_h: turnOf(i.id).flipH, flip_v: turnOf(i.id).flipV })))]]}
      invalid={({ items }) => (items.every((i) => !turnOf(i.id).angle && !turnOf(i.id).flipH && !turnOf(i.id).flipV) ? "Turn or flip at least one image." : null)}
      tileTransform={(i) => {
        const t = turnOf(i.id);
        return `rotate(${t.angle}deg) scale(${t.flipH ? -1 : 1}, ${t.flipV ? -1 : 1})${t.angle % 180 ? " scale(0.75)" : ""}`;
      }}
      tileNote={(i) => (turnOf(i.id).angle ? `↻ ${turnOf(i.id).angle}°` : null)}
      tileActions={(i) => (
        <>
          <button type="button" className={btn} aria-label={`Turn ${i.file.name} left`} onClick={() => update(i.id, (t) => ({ ...t, angle: (t.angle + 270) % 360 }))}>
            <RotateCcw aria-hidden className="size-3.5" />
          </button>
          <button type="button" className={btn} aria-label={`Turn ${i.file.name} right`} onClick={() => update(i.id, (t) => ({ ...t, angle: (t.angle + 90) % 360 }))}>
            <RotateCw aria-hidden className="size-3.5" />
          </button>
          <button type="button" className={btn} aria-label={`Flip ${i.file.name} sideways`} onClick={() => update(i.id, (t) => ({ ...t, flipH: !t.flipH }))}>
            <FlipHorizontal2 aria-hidden className="size-3.5" />
          </button>
          <button type="button" className={btn} aria-label={`Flip ${i.file.name} upside down`} onClick={() => update(i.id, (t) => ({ ...t, flipV: !t.flipV }))}>
            <FlipVertical2 aria-hidden className="size-3.5" />
          </button>
        </>
      )}
      hint="Quarter turns and flips move pixels without re-drawing them, so nothing gets blurry."
      options={({ locked, items }) => (
        <Panel>
          <Row label="Turn several at once">
            <div className="flex flex-wrap items-center gap-2">
              <Chips
                label="Which images"
                value={only}
                onChange={setOnly}
                disabled={locked}
                options={[
                  { value: "all", label: "All" },
                  { value: "portrait", label: "Portrait" },
                  { value: "landscape", label: "Landscape" },
                ]}
              />
              <span className="flex gap-1.5">
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => rotateAll(items, -90)}
                  className="inline-flex h-9 items-center gap-1.5 rounded-sm border border-line bg-surface px-3 text-sm text-ink-2 transition-colors hover:border-ink-3 hover:text-ink"
                >
                  <RotateCcw aria-hidden className="size-3.5" /> Left
                </button>
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => rotateAll(items, 90)}
                  className="inline-flex h-9 items-center gap-1.5 rounded-sm border border-line bg-surface px-3 text-sm text-ink-2 transition-colors hover:border-ink-3 hover:text-ink"
                >
                  <RotateCw aria-hidden className="size-3.5" /> Right
                </button>
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => setTurns({})}
                  className="inline-flex h-9 items-center rounded-sm px-2 text-sm text-ink-2 underline-offset-4 hover:text-ink hover:underline"
                >
                  Reset all
                </button>
              </span>
            </div>
            <p className="mt-2 text-xs text-ink-3">Or use the buttons on each image to turn or flip just that one.</p>
          </Row>
        </Panel>
      )}
    />
  );
}

/* ---------- Upscale ---------- */

export function UpscaleImageTool({ toolId, band }: ToolProps) {
  const [factor, setFactor] = useState<2 | 4>(2);
  return (
    <ImageTask
      toolId={toolId}
      band={band}
      input="upscale"
      multiple={false}
      needs="upscale"
      compare
      endpoint={IMAGE_API("upscale")}
      label={`Upscale ${factor}×`}
      working="Adding detail… (about a minute for big images)"
      fields={() => [["factor", String(factor)]]}
      invalid={({ items, caps }) => {
        const s = items[0]?.size;
        const max = caps?.upscale_max_output_pixels ?? 16_000_000;
        return s && s.width * s.height * factor * factor > max
          ? `${s.width} × ${s.height} at ${factor}× would be ${megapixels(s.width * factor, s.height * factor)}. The limit is ${megapixels(max, 1)}: try 2×, or a smaller image.`
          : null;
      }}
      hint="Real-ESRGAN redraws the detail, rather than just stretching the pixels."
      resultNote="Zoom in to see the difference: edges, hair and text stay crisp instead of blurring."
      options={({ locked, items, caps }) => {
        const s = items[0]?.size;
        const max = caps?.upscale_max_output_pixels ?? 16_000_000;
        return (
          <Panel>
            <Row label="Enlarge" hint={s ? `Now ${s.width} × ${s.height}` : undefined}>
              <Chips
                label="Enlarge"
                value={factor}
                onChange={setFactor}
                disabled={locked}
                options={([2, 4] as const).map((f) => ({
                  value: f,
                  label: s ? `${f}× · ${s.width * f} × ${s.height * f}` : `${f}×`,
                  disabled: Boolean(s && s.width * s.height * f * f > max),
                  title: s && s.width * s.height * f * f > max ? "Too large for this server" : undefined,
                }))}
              />
            </Row>
          </Panel>
        );
      }}
    />
  );
}

/* ---------- Remove background ---------- */

export function RemoveBackgroundTool({ toolId, band }: ToolProps) {
  const [background, setBackground] = useState<"transparent" | "color" | "blur">("transparent");
  const [color, setColor] = useState("#ffffff");
  return (
    <ImageTask
      toolId={toolId}
      band={band}
      input="background"
      maxFiles={10}
      needs="background"
      compare
      endpoint={IMAGE_API("remove-background")}
      label={({ items }) => (items.length > 1 ? `Remove ${items.length} backgrounds` : "Remove the background")}
      working="Finding the subject…"
      fields={() => [
        ["background", background],
        ["color", color],
      ]}
      hint="Works best with a clear subject: people, products, animals. Up to 10 images at a time."
      resultNote="Transparent results are PNG, so they keep their see-through background anywhere you use them."
      options={({ locked }) => (
        <Panel>
          <Row label="Background">
            <Chips
              label="Background"
              value={background}
              onChange={setBackground}
              disabled={locked}
              options={[
                { value: "transparent", label: "Transparent" },
                { value: "color", label: "A colour" },
                { value: "blur", label: "Blurred" },
              ]}
            />
            {background === "color" && (
              <div className="mt-3">
                <Swatches value={color} onChange={setColor} colors={[...BACKGROUNDS, { value: "#eb4a10", name: "Signal orange" }, { value: "#2563eb", name: "Blue" }]} disabled={locked} />
              </div>
            )}
            <p className={cn("mt-2 text-xs text-ink-3")}>
              {background === "blur" ? "Keeps the scene, softly out of focus, like a portrait lens." : background === "color" ? "Saved as JPG on your colour." : "Saved as PNG with see-through background."}
            </p>
          </Row>
        </Panel>
      )}
    />
  );
}

