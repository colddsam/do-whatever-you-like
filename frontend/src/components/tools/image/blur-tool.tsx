"use client";

import { useRef, useState } from "react";
import { Loader2, Plus, ScanFace, Trash2 } from "lucide-react";
import { FileToolError, postFormJson } from "@/lib/files";
import { IMAGE_API } from "@/lib/image";
import { cn } from "@/lib/utils";
import { Chips, Notice, Panel, Row, Slider } from "../pdf/kit";
import { EditableBox, type Box } from "../pdf/page-stage";
import { nextId, plural } from "../pdf/parts";
import { CHECKER, ImageTask, type ImageItem } from "./task";

type Area = { id: string; box: Box; on: boolean; face: boolean };
type Sensitivity = "low" | "recommended" | "high";
type Faces = { width: number; height: number; faces: { x: number; y: number; w: number; h: number; score: number }[] };

/**
 * Blur faces (found automatically) and anything else you mark. Every area is a box you can move and
 * resize; a face can be kept sharp by excluding it. The blur is previewed live over the image.
 */
export function BlurFaceTool({ toolId, band }: { toolId: string; band?: React.ReactNode }) {
  const [areas, setAreas] = useState<Area[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [sensitivity, setSensitivity] = useState<Sensitivity>("recommended");
  const [mode, setMode] = useState<"blur" | "pixelate">("blur");
  const [strength, setStrength] = useState(60);
  const [shape, setShape] = useState<"ellipse" | "rect">("ellipse");
  const [detect, setDetect] = useState<{ state: "idle" | "looking" | "done" | "failed"; message?: string; found?: number }>({ state: "idle" });
  const fileRef = useRef<File | null>(null);
  const ctrl = useRef<AbortController | null>(null);

  const findFaces = async (file: File, level: Sensitivity) => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setDetect({ state: "looking" });
    const form = new FormData();
    form.append("file", file, file.name);
    form.append("sensitivity", level);
    try {
      const res = await postFormJson<Faces>(IMAGE_API("faces"), form, { signal: c.signal });
      if (c.signal.aborted) return;
      setAreas((prev) => [
        ...prev.filter((a) => !a.face),
        ...res.faces.map((f) => ({ id: nextId(), box: { x0: f.x, y0: f.y, x1: f.x + f.w, y1: f.y + f.h }, on: true, face: true })),
      ]);
      setDetect({ state: "done", found: res.faces.length });
    } catch (e) {
      if (c.signal.aborted) return;
      setDetect({ state: "failed", message: e instanceof FileToolError ? e.message : "We couldn't look for faces. Mark the areas by hand." });
    }
  };

  const onItems = (items: ImageItem[]) => {
    const file = items[0]?.file ?? null;
    if (file === fileRef.current) return;
    fileRef.current = file;
    setAreas([]);
    setSelected(null);
    setDetect({ state: "idle" });
    if (file) findFaces(file, sensitivity);
  };

  const addArea = () => {
    const id = nextId();
    setAreas((prev) => [...prev, { id, box: { x0: 0.35, y0: 0.35, x1: 0.65, y1: 0.65 }, on: true, face: false }]);
    setSelected(id);
  };
  const update = (id: string, patch: Partial<Area>) => setAreas((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  const removeArea = (id: string) => {
    setAreas((prev) => prev.filter((a) => a.id !== id));
    setSelected(null);
  };

  const active = areas.filter((a) => a.on);
  const current = areas.find((a) => a.id === selected) ?? null;
  const blurPx = 3 + (strength / 100) * 14;

  return (
    <ImageTask
      toolId={toolId}
      band={band}
      input="blur"
      multiple={false}
      endpoint={IMAGE_API("blur")}
      onItems={onItems}
      label={active.length ? `Blur ${plural(active.length, "area")}` : "Blur"}
      working="Blurring…"
      fields={() => [
        ["areas", JSON.stringify(active.map((a) => ({ x: a.box.x0, y: a.box.y0, w: a.box.x1 - a.box.x0, h: a.box.y1 - a.box.y0 })))],
        ["mode", mode],
        ["strength", String(strength)],
        ["shape", shape],
      ]}
      invalid={() => (!active.length ? "Mark at least one area to blur: use “Add an area”, or turn a face back on." : null)}
      hint="The blur is baked into the pixels: what's underneath can't be recovered from the result."
      stage={({ items, locked }) => {
        const item = items[0];
        return (
          <>
            {item.url ? (
              <div className={cn("flex justify-center rounded-md border border-line p-2 sm:p-3", CHECKER)}>
                <div
                  data-stage
                  className="relative w-fit max-w-full touch-none select-none overflow-hidden"
                  onPointerDown={(e) => e.target === e.currentTarget.firstChild && setSelected(null)}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.url} alt="Your image" draggable={false} className="block max-h-[min(62vh,560px)] max-w-full" />
                  {areas.map((a, i) => (
                    <EditableBox
                      key={a.id}
                      box={a.box}
                      onChange={(b) => !locked && update(a.id, { box: b })}
                      selected={selected === a.id && !locked}
                      onSelect={() => setSelected(a.id)}
                      minSize={0.02}
                      label={`${a.face ? "Face" : "Area"} ${i + 1}${a.on ? "" : " (left sharp)"}`}
                      className={cn(!a.on && "outline-dashed outline-1 outline-surface")}
                    >
                      {a.on && (
                        <span
                          aria-hidden
                          className={cn("pointer-events-none absolute inset-0", shape === "ellipse" && "rounded-[50%]")}
                          style={{ backdropFilter: `blur(${blurPx}px)`, WebkitBackdropFilter: `blur(${blurPx}px)` }}
                        />
                      )}
                      <span
                        className={cn(
                          "label-mono pointer-events-none absolute -top-5 left-0 whitespace-nowrap rounded-[3px] px-1 text-[10px]",
                          a.on ? "bg-ink/85 text-paper" : "bg-surface/90 text-ink-2",
                        )}
                      >
                        {String(i + 1).padStart(2, "0")} {a.on ? (a.face ? "face" : "area") : "kept"}
                      </span>
                    </EditableBox>
                  ))}
                </div>
              </div>
            ) : (
              <Notice tone="warning">Browsers can&apos;t show this format. Convert it to JPG or PNG first, then blur it here.</Notice>
            )}

            <Panel>
              <Row
                label="Faces"
                hint={
                  detect.state === "looking" ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Loader2 aria-hidden className="size-3 animate-spin" /> Looking for faces…
                    </span>
                  ) : detect.state === "done" ? (
                    detect.found ? `${plural(detect.found, "face")} found` : "No faces found"
                  ) : undefined
                }
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Chips
                    label="Detection"
                    value={sensitivity}
                    disabled={locked || detect.state === "looking"}
                    onChange={(v) => {
                      setSensitivity(v);
                      if (fileRef.current) findFaces(fileRef.current, v);
                    }}
                    options={[
                      { value: "low", label: "Only clear faces" },
                      { value: "recommended", label: "Recommended" },
                      { value: "high", label: "Find small faces" },
                    ]}
                  />
                  <button
                    type="button"
                    onClick={addArea}
                    disabled={locked}
                    className="inline-flex h-9 items-center gap-1.5 rounded-sm border border-dashed border-ink-3 px-3 text-sm text-ink-2 transition-colors hover:border-ink hover:text-ink"
                  >
                    <Plus aria-hidden className="size-3.5" /> Add an area
                  </button>
                </div>
                {detect.state === "failed" && <p className="mt-2 text-xs text-danger">{detect.message}</p>}
                {detect.state === "done" && !detect.found && (
                  <p className="mt-2 text-xs text-ink-3">Try “Find small faces”, or add areas by hand (number plates, names, screens).</p>
                )}
              </Row>
              {current && (
                <Row label={`Selected: ${current.face ? "face" : "area"} ${String(areas.indexOf(current) + 1).padStart(2, "0")}`}>
                  <div className="flex flex-wrap gap-1.5">
                    <Chips
                      label="This area"
                      value={current.on ? "on" : "off"}
                      disabled={locked}
                      onChange={(v) => update(current.id, { on: v === "on" })}
                      options={[
                        { value: "on", label: "Blur it" },
                        { value: "off", label: "Leave it sharp" },
                      ]}
                    />
                    <button
                      type="button"
                      onClick={() => removeArea(current.id)}
                      disabled={locked}
                      className="inline-flex h-9 items-center gap-1.5 rounded-sm px-2.5 text-sm text-ink-2 transition-colors hover:bg-paper-2 hover:text-ink"
                    >
                      <Trash2 aria-hidden className="size-3.5" /> Remove
                    </button>
                  </div>
                </Row>
              )}
              <Row label="Look">
                <div className="flex flex-wrap gap-x-4 gap-y-2">
                  <Chips
                    label="Effect"
                    value={mode}
                    onChange={setMode}
                    disabled={locked}
                    options={[
                      { value: "blur", label: "Blur" },
                      { value: "pixelate", label: "Pixelate" },
                    ]}
                  />
                  <Chips
                    label="Shape"
                    value={shape}
                    onChange={setShape}
                    disabled={locked}
                    options={[
                      { value: "ellipse", label: "Oval" },
                      { value: "rect", label: "Rectangle" },
                    ]}
                  />
                </div>
                <div className="mt-2">
                  <Slider label="Strength" value={strength} min={10} max={100} step={5} onChange={setStrength} format={(v) => `${v}%`} disabled={locked} />
                </div>
                {mode === "pixelate" && <p className="text-xs text-ink-3">The preview shows a blur; the result uses big square pixels.</p>}
              </Row>
            </Panel>
            {!areas.length && detect.state !== "looking" && (
              <p className="flex items-center gap-2 px-1 text-sm text-ink-2">
                <ScanFace aria-hidden className="size-4 text-ink-3" /> Click “Add an area” to blur something by hand.
              </p>
            )}
          </>
        );
      }}
    />
  );
}
