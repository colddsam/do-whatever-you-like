"use client";

import { useState } from "react";
import { IMAGE_API } from "@/lib/image";
import { Chips, Notice, Panel, Row, TextField } from "../pdf/kit";
import { EditableBox, type Box } from "../pdf/page-stage";
import { CHECKER, ImageTask, type ImageItem } from "./task";

const RATIOS = [
  { value: "free", label: "Free", r: 0 },
  { value: "1:1", label: "1:1", r: 1 },
  { value: "4:5", label: "4:5", r: 4 / 5 },
  { value: "4:3", label: "4:3", r: 4 / 3 },
  { value: "3:2", label: "3:2", r: 3 / 2 },
  { value: "16:9", label: "16:9", r: 16 / 9 },
  { value: "9:16", label: "9:16", r: 9 / 16 },
] as const;
type Ratio = (typeof RATIOS)[number]["value"];

const START: Box = { x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.9 };

/** The biggest centred box of `ratio` (width ÷ height, in pixels) that fits the image, as fractions. */
function fitRatio(ratio: number, w: number, h: number): Box {
  let bw = w;
  let bh = w / ratio;
  if (bh > h) {
    bh = h;
    bw = h * ratio;
  }
  const fx = bw / w;
  const fy = bh / h;
  return { x0: (1 - fx) / 2, y0: (1 - fy) / 2, x1: (1 + fx) / 2, y1: (1 + fy) / 2 };
}

/**
 * Crop on the picture itself: drag the box or its handles (or use the arrow keys); everything outside
 * is dimmed. The pixel fields and the box are one value, so typing exact numbers works too.
 */
export function CropImageTool({ toolId, band }: { toolId: string; band?: React.ReactNode }) {
  const [box, setBox] = useState<Box>(START);
  const [ratio, setRatio] = useState<Ratio>("free");

  const px = (item: ImageItem | undefined) => {
    const s = item?.size;
    if (!s) return null;
    const x = Math.round(box.x0 * s.width);
    const y = Math.round(box.y0 * s.height);
    return { x, y, w: Math.max(1, Math.round((box.x1 - box.x0) * s.width)), h: Math.max(1, Math.round((box.y1 - box.y0) * s.height)), s };
  };

  const pickRatio = (v: Ratio, item: ImageItem | undefined) => {
    setRatio(v);
    const r = RATIOS.find((x) => x.value === v)!.r;
    if (r && item?.size) setBox(fitRatio(r, item.size.width, item.size.height));
  };

  const setField = (item: ImageItem | undefined, key: "x" | "y" | "w" | "h", raw: string) => {
    const p = px(item);
    if (!p) return;
    const n = Math.max(0, Number(raw.replace(/\D/g, "").slice(0, 5)) || 0);
    const { s } = p;
    const next = { ...p, [key]: n };
    next.w = Math.max(1, Math.min(next.w, s.width - Math.min(next.x, s.width - 1)));
    next.h = Math.max(1, Math.min(next.h, s.height - Math.min(next.y, s.height - 1)));
    const x = Math.min(next.x, s.width - next.w);
    const y = Math.min(next.y, s.height - next.h);
    setRatio("free");
    setBox({ x0: x / s.width, y0: y / s.height, x1: (x + next.w) / s.width, y1: (y + next.h) / s.height });
  };

  return (
    <ImageTask
      toolId={toolId}
      band={band}
      input="crop"
      multiple={false}
      endpoint={IMAGE_API("crop")}
      onItems={() => {
        setBox(START);
        setRatio("free");
      }}
      label={({ items }) => {
        const p = px(items[0]);
        return p ? `Crop to ${p.w} × ${p.h}` : "Crop";
      }}
      working="Cropping…"
      fields={({ items }) => {
        const p = px(items[0])!;
        return [
          ["x", String(p.x)],
          ["y", String(p.y)],
          ["width", String(p.w)],
          ["height", String(p.h)],
        ];
      }}
      invalid={({ items }) => (!items[0]?.size ? "This format can't be shown in the browser, so it can't be cropped by eye. Convert it to JPG first." : null)}
      hint="Animated GIFs are cropped frame by frame and keep playing."
      stage={({ items, locked }) => {
        const item = items[0];
        const p = px(item);
        const r = RATIOS.find((x) => x.value === ratio)!.r;
        return (
          <>
            {item.url ? (
              <div className={`flex justify-center rounded-md border border-line p-2 sm:p-3 ${CHECKER}`}>
                <div data-stage className="relative w-fit max-w-full touch-none select-none overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.url} alt="Your image" draggable={false} className="block max-h-[min(62vh,560px)] max-w-full" />
                  <EditableBox
                    box={box}
                    onChange={(b) => (locked ? undefined : setBox(b))}
                    selected={!locked}
                    keepRatio={Boolean(r)}
                    minSize={0.03}
                    label="Crop area. Drag to move, arrow keys to nudge, Alt and arrows to resize."
                    className="shadow-[0_0_0_9999px_rgba(21,20,15,0.55)] ring-1 ring-surface"
                  >
                    {/* Rule of thirds, the guide photographers crop by. */}
                    <span aria-hidden className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
                      {Array.from({ length: 9 }, (_, i) => (
                        <span key={i} className="border-[0.5px] border-surface/40" />
                      ))}
                    </span>
                    {p && (
                      <span className="label-mono pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-[3px] bg-ink/85 px-1.5 py-0.5 text-[10px] text-paper">
                        {p.w} × {p.h}
                      </span>
                    )}
                  </EditableBox>
                </div>
              </div>
            ) : (
              <Notice tone="warning">Browsers can&apos;t show this format, so it can&apos;t be cropped by eye. Convert it to JPG or PNG first.</Notice>
            )}
            {p && (
              <Panel>
                <Row label="Shape">
                  <Chips label="Aspect ratio" value={ratio} onChange={(v) => pickRatio(v, item)} disabled={locked} options={RATIOS.map(({ value, label }) => ({ value, label }))} />
                </Row>
                <Row label="Exact pixels" hint={`Image ${p.s.width} × ${p.s.height}`}>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {(
                      [
                        ["x", "Left", p.x],
                        ["y", "Top", p.y],
                        ["w", "Width", p.w],
                        ["h", "Height", p.h],
                      ] as const
                    ).map(([k, name, v]) => (
                      <label key={k} className="block">
                        <span className="label-mono mb-1 block text-ink-3">{name}</span>
                        <TextField value={String(v)} onChange={(raw) => setField(item, k, raw)} label={`${name} in pixels`} inputMode="numeric" mono disabled={locked} />
                      </label>
                    ))}
                  </div>
                </Row>
              </Panel>
            )}
          </>
        );
      }}
    />
  );
}
