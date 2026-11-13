"use client";

import { useState } from "react";
import { Chips, pagesError, Panel, Row, TextField } from "./kit";
import { boxStyle, EditableBox, fractionAt, normalize, PageNav, PageView, type Box } from "./page-stage";
import { PdfTask } from "./task";

const FULL: Box = { x0: 0.06, y0: 0.06, x1: 0.94, y1: 0.94 };
const PRESETS: { label: string; box: Box }[] = [
  { label: "Trim the margins", box: { x0: 0.08, y0: 0.07, x1: 0.92, y1: 0.93 } },
  { label: "Top half", box: { x0: 0, y0: 0, x1: 1, y1: 0.5 } },
  { label: "Bottom half", box: { x0: 0, y0: 0.5, x1: 1, y1: 1 } },
];
const mm = (pt: number) => Math.round(pt * 0.3528);

/** Crop PDF: drag the box on the real page; everything outside it is cut from the result. */
export function CropTool({ toolId }: { toolId: string }) {
  const [box, setBox] = useState<Box>(FULL);
  const [scope, setScope] = useState<"all" | "this" | "some">("all");
  const [pages, setPages] = useState("");
  const [page, setPage] = useState(1);

  return (
    <PdfTask
      toolId={toolId}
      input={{ kind: "pdf" }}
      endpoint="/api/tools/pdf/crop"
      dropTitle="Drop the PDF to crop"
      label="Crop the PDF"
      working="Cropping…"
      invalid={(ctx) => (scope === "some" ? (pages.trim() ? pagesError(pages, ctx.doc?.upload.pages ?? null) : "Type the pages to crop.") : null)}
      fields={() => [
        ["box", JSON.stringify(box)],
        ["pages", scope === "all" ? "" : scope === "this" ? String(page) : pages],
      ]}
      resultNote="Pages of different sizes are cut at the same place, in proportion."
      options={(ctx) => {
        const doc = ctx.doc!;
        const total = doc.upload.pages;
        const current = Math.min(page, total);
        const size = doc.upload.sizes?.[current - 1] ?? [595, 842];
        const out = { w: (box.x1 - box.x0) * size[0], h: (box.y1 - box.y0) * size[1] };
        return (
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_260px] md:items-start">
            <div className="space-y-2">
              <div className="mx-auto w-full max-w-[520px]">
                <PageView
                  token={doc.upload.token}
                  page={current}
                  size={size}
                  overlayClassName="cursor-crosshair touch-none"
                  overlayProps={{
                    // Drag on the page (outside the box) to draw a new crop.
                    onPointerDown: (e) => {
                      if (ctx.locked) return;
                      const stage = e.currentTarget;
                      const a = fractionAt(stage, e.clientX, e.clientY);
                      stage.setPointerCapture(e.pointerId);
                      const moveFn = (ev: PointerEvent) => {
                        const b = fractionAt(stage, ev.clientX, ev.clientY);
                        const n = normalize(a, b);
                        if (n.x1 - n.x0 > 0.03 && n.y1 - n.y0 > 0.03) setBox(n);
                      };
                      const upFn = () => {
                        stage.removeEventListener("pointermove", moveFn);
                        stage.removeEventListener("pointerup", upFn);
                      };
                      stage.addEventListener("pointermove", moveFn);
                      stage.addEventListener("pointerup", upFn);
                    },
                  }}
                >
                  {() => (
                    <>
                      {/* Everything outside the box is dimmed: that's what gets cut. */}
                      <div aria-hidden className="pointer-events-none absolute inset-0">
                        <div className="absolute inset-x-0 top-0 bg-ink/45" style={{ height: `${box.y0 * 100}%` }} />
                        <div className="absolute inset-x-0 bottom-0 bg-ink/45" style={{ height: `${(1 - box.y1) * 100}%` }} />
                        <div className="absolute left-0 bg-ink/45" style={{ top: `${box.y0 * 100}%`, height: `${(box.y1 - box.y0) * 100}%`, width: `${box.x0 * 100}%` }} />
                        <div className="absolute right-0 bg-ink/45" style={{ top: `${box.y0 * 100}%`, height: `${(box.y1 - box.y0) * 100}%`, width: `${(1 - box.x1) * 100}%` }} />
                      </div>
                      <EditableBox box={box} onChange={setBox} selected minSize={0.05} label="Crop area. Arrow keys move it; Alt and arrows resize it.">
                        <span aria-hidden className="pointer-events-none absolute inset-0 border border-dashed border-surface" />
                        <span aria-hidden className="pointer-events-none absolute left-1/3 top-0 h-full w-px bg-surface/50" />
                        <span aria-hidden className="pointer-events-none absolute left-2/3 top-0 h-full w-px bg-surface/50" />
                        <span aria-hidden className="pointer-events-none absolute left-0 top-1/3 h-px w-full bg-surface/50" />
                        <span aria-hidden className="pointer-events-none absolute left-0 top-2/3 h-px w-full bg-surface/50" />
                      </EditableBox>
                      <span className="pointer-events-none absolute rounded-[3px] bg-ink px-1.5 py-0.5 font-mono text-[12px] text-paper" style={{ ...boxStyle(box), width: "auto", height: "auto" }}>
                        {mm(out.w)} × {mm(out.h)} mm
                      </span>
                    </>
                  )}
                </PageView>
              </div>
              <div className="mx-auto max-w-[520px]">
                <PageNav page={current} pages={total} onChange={setPage} disabled={ctx.locked} />
              </div>
            </div>
            <Panel>
              <Row label="Quick crops">
                <div className="flex flex-wrap gap-1.5">
                  {PRESETS.map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      disabled={ctx.locked}
                      onClick={() => setBox(p.box)}
                      className="inline-flex h-9 items-center rounded-sm border border-line bg-surface px-3 text-sm text-ink-2 transition-colors hover:border-ink-3 hover:text-ink"
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </Row>
              <Row label="Apply to">
                <Chips
                  value={scope}
                  onChange={setScope}
                  disabled={ctx.locked}
                  options={[
                    { value: "all", label: "Every page" },
                    { value: "this", label: `Page ${current}` },
                    { value: "some", label: "Some pages" },
                  ]}
                />
                {scope === "some" && (
                  <div className="mt-2.5">
                    <TextField value={pages} onChange={setPages} label="Pages to crop" placeholder={`1-3, ${total}`} mono inputMode="numeric" invalid={Boolean(pages.trim() && pagesError(pages, total))} disabled={ctx.locked} />
                    <p className={pages.trim() && pagesError(pages, total) ? "mt-1.5 text-xs text-danger" : "mt-1.5 text-xs text-ink-3"}>
                      {(pages.trim() && pagesError(pages, total)) || `Pages and ranges · 1 to ${total}`}
                    </p>
                  </div>
                )}
              </Row>
              <Row label="Result">
                <p className="font-mono text-sm text-ink">
                  {mm(out.w)} × {mm(out.h)} mm
                </p>
                <p className="mt-1 text-xs text-ink-3">
                  From {mm(size[0])} × {mm(size[1])} mm. Drag the box or its handles, or draw a new one on the page.
                </p>
              </Row>
            </Panel>
          </div>
        );
      }}
    />
  );
}
