"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, Reorder, useDragControls } from "motion/react";
import { ArrowDown, ArrowUp, Camera, GripVertical, X } from "lucide-react";
import { formatBytes } from "@/lib/media";
import { saveBlob, uploadForm } from "@/lib/files";
import { getTool, stepsFor } from "@/lib/tools";
import { cn } from "@/lib/utils";
import { FileDrop } from "../file-drop";
import { isBusy, ProgressButton, type Job } from "../progress-button";
import { Workbench } from "../workbench";
import { Chips, Panel, Row, Toggle } from "./kit";
import { IconButton, messageOf, nextId, plural, swap } from "./parts";
import { ResultPanel, type TaskResult } from "./task";

const MAX_FILES = 100;
const MAX_TOTAL_MB = 150;
const IMAGE_EXT = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tif", ".tiff"];
type Item = { id: string; file: File; url: string };

/**
 * JPG to PDF and Scan to PDF: images in the order you set, one per page.
 * Scan mode adds the phone camera and the "clean scan" look (white paper, crisp text).
 */
export function ImagesToPdfTool({ toolId, scan = false }: { toolId: string; scan?: boolean }) {
  const tool = getTool(toolId)!;
  const [items, setItems] = useState<Item[]>([]);
  const [rejected, setRejected] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState(scan ? "a4" : "a4");
  const [orientation, setOrientation] = useState("auto");
  const [margin, setMargin] = useState(scan ? "none" : "small");
  const [enhance, setEnhance] = useState(scan);
  const [job, setJob] = useState<Job>({ kind: "ready" });
  const [result, setResult] = useState<TaskResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  useEffect(() => () => itemsRef.current.forEach((i) => URL.revokeObjectURL(i.url)), []);
  useEffect(() => (result ? () => URL.revokeObjectURL(result.url) : undefined), [result]);
  const busy = isBusy(job);

  const reset = () => {
    abortRef.current?.abort();
    setResult(null);
    setJob({ kind: "ready" });
  };

  const add = (files: File[]) => {
    const problems: string[] = [];
    const ok: Item[] = [];
    let total = items.reduce((n, i) => n + i.file.size, 0);
    for (const f of files) {
      const ext = f.name.toLowerCase().slice(f.name.lastIndexOf("."));
      if (!f.type.startsWith("image/") && !IMAGE_EXT.includes(ext)) {
        problems.push(`${f.name} isn't an image.`);
        continue;
      }
      if (items.length + ok.length >= MAX_FILES) {
        problems.push(`Up to ${MAX_FILES} images at a time.`);
        break;
      }
      if (total + f.size > MAX_TOTAL_MB * 1024 * 1024) {
        problems.push(`${f.name} would take the total over ${MAX_TOTAL_MB} MB.`);
        continue;
      }
      total += f.size;
      ok.push({ id: nextId(), file: f, url: URL.createObjectURL(f) });
    }
    setRejected(problems.length ? problems.join(" ") : null);
    if (ok.length) {
      reset();
      setItems((prev) => [...prev, ...ok]);
    }
  };
  const remove = (id: string) => {
    reset();
    setItems((prev) => {
      const gone = prev.find((i) => i.id === id);
      if (gone) URL.revokeObjectURL(gone.url);
      return prev.filter((i) => i.id !== id);
    });
  };
  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length) return;
    const next = [...items];
    const [it] = next.splice(from, 1);
    next.splice(to, 0, it);
    reset();
    setItems(next);
  };

  const start = async () => {
    if (!items.length) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const form = new FormData();
    items.forEach((i) => form.append("images", i.file, i.file.name));
    form.append("page_size", pageSize);
    form.append("orientation", orientation);
    form.append("margin", margin);
    form.append("enhance", String(enhance));
    setJob({ kind: "uploading", progress: 0 });
    try {
      const out = await uploadForm("/api/tools/pdf/from-images", form, {
        signal: ctrl.signal,
        fallbackName: scan ? "scan.pdf" : "images.pdf",
        onUpload: (p) => setJob(p >= 1 ? { kind: "processing" } : { kind: "uploading", progress: p }),
        onProcessing: () => setJob({ kind: "processing" }),
      });
      setResult({ ...out, url: URL.createObjectURL(out.blob), saved: false, parts: null });
      setJob({ kind: "ready" });
    } catch (e) {
      if (ctrl.signal.aborted) return setJob({ kind: "ready" });
      setJob({ kind: "failed", message: messageOf(e) });
    }
  };

  const total = items.reduce((n, i) => n + i.file.size, 0);
  const step = !items.length ? 0 : !result ? 1 : result.saved ? 3 : 2;
  const accept = tool.accept?.types ?? "image/*";

  const camera = scan && (
    <>
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          add(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => cameraRef.current?.click()}
        disabled={busy}
        className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-md border border-ink bg-surface px-4 text-[15px] font-medium text-ink transition-colors hover:bg-paper-2 disabled:opacity-40"
      >
        <Camera aria-hidden className="size-4" /> {items.length ? "Photograph another page" : "Photograph a page"}
      </button>
    </>
  );

  return (
    <Workbench
      steps={stepsFor(tool)}
      current={step}
      footer={<>Your images are deleted from our server as soon as the PDF is sent. Nothing is kept.</>}
    >
      <div className="space-y-3 p-3 sm:p-4">
        {!items.length ? (
          <>
            {camera}
            <FileDrop
              multiple
              accept={accept}
              title={scan ? "Or drop photos of the pages" : "Drop the images"}
              formats={`JPG, PNG, WebP, GIF, BMP or TIFF · up to ${MAX_FILES} images`}
              error={rejected}
              onFiles={add}
            />
            {scan && <p className="px-1 text-xs text-ink-3">On a phone, the button opens the camera. Shoot each page flat, in good light, filling the frame.</p>}
          </>
        ) : (
          <div>
            <div className="flex items-baseline justify-between gap-4 px-1 pb-2">
              <p className="label-mono truncate text-ink-3">
                Page order · {plural(items.length, "image")} · {formatBytes(total)}
              </p>
              {!busy && (
                <button
                  type="button"
                  onClick={() => {
                    reset();
                    items.forEach((i) => URL.revokeObjectURL(i.url));
                    setItems([]);
                  }}
                  className="shrink-0 text-xs text-ink-3 underline-offset-4 hover:text-ink hover:underline"
                >
                  Clear all
                </button>
              )}
            </div>
            <Reorder.Group as="ol" axis="y" values={items} onReorder={(next) => (reset(), setItems(next))} className="space-y-1.5">
              {items.map((item, i) => (
                <ImageRow key={item.id} item={item} index={i} count={items.length} locked={busy} onMove={move} onRemove={() => remove(item.id)} />
              ))}
            </Reorder.Group>
            {!busy && items.length < MAX_FILES && (
              <div className="mt-2 space-y-2">
                {camera}
                <FileDrop compact multiple accept={accept} title={scan ? "Add more photos" : "Add more images"} formats={`Up to ${MAX_FILES - items.length} more`} error={rejected} onFiles={add} />
              </div>
            )}
          </div>
        )}

        {items.length > 0 && (
          <AnimatePresence mode="wait" initial={false}>
            {result ? (
              <motion.div key="result" {...swap}>
                <ResultPanel
                  result={result}
                  backLabel="Change layout"
                  onBack={reset}
                  onSave={() => {
                    saveBlob(result.blob, result.name);
                    setResult({ ...result, saved: true });
                  }}
                  note={`${plural(items.length, "page")}, one image on each, in the order above.`}
                />
              </motion.div>
            ) : (
              <motion.div key="options" {...swap} className="space-y-3">
                <Panel>
                  <Row label="Page size">
                    <Chips
                      value={pageSize}
                      onChange={(v) => (reset(), setPageSize(v))}
                      disabled={busy}
                      options={[
                        { value: "a4", label: "A4" },
                        { value: "letter", label: "Letter" },
                        { value: "legal", label: "Legal" },
                        { value: "fit", label: "Same as the image" },
                      ]}
                    />
                  </Row>
                  {pageSize !== "fit" && (
                    <Row label="Orientation">
                      <Chips
                        value={orientation}
                        onChange={(v) => (reset(), setOrientation(v))}
                        disabled={busy}
                        options={[
                          { value: "auto", label: "Match each image" },
                          { value: "portrait", label: "Portrait" },
                          { value: "landscape", label: "Landscape" },
                        ]}
                      />
                    </Row>
                  )}
                  <Row label="Margin">
                    <Chips
                      value={margin}
                      onChange={(v) => (reset(), setMargin(v))}
                      disabled={busy}
                      options={[
                        { value: "none", label: "None" },
                        { value: "small", label: "Small" },
                        { value: "large", label: "Large" },
                      ]}
                    />
                  </Row>
                  <Row label="Look">
                    <Toggle
                      checked={enhance}
                      onChange={(v) => (reset(), setEnhance(v))}
                      disabled={busy}
                      label="Clean scan"
                      description="Black and white, with the paper turned white and the text darkened. Best for documents; turn it off for photos."
                    />
                  </Row>
                </Panel>
                <ProgressButton
                  job={job}
                  label={`Make a ${plural(items.length, "page")} PDF`}
                  working="Building the PDF…"
                  hint="Images keep their proportions; nothing is cropped."
                  onStart={start}
                  onCancel={() => abortRef.current?.abort()}
                />
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </div>
    </Workbench>
  );
}

function ImageRow({
  item,
  index,
  count,
  locked,
  onMove,
  onRemove,
}: {
  item: Item;
  index: number;
  count: number;
  locked: boolean;
  onMove: (from: number, to: number) => void;
  onRemove: () => void;
}) {
  const controls = useDragControls();
  return (
    <Reorder.Item
      value={item}
      dragListener={false}
      dragControls={controls}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      whileDrag={{ scale: 1.01, boxShadow: "var(--shadow-card)" }}
      className="relative flex items-center gap-2 rounded-md border border-line bg-paper p-1.5 pr-1 sm:gap-3 sm:p-2"
    >
      {!locked && (
        <span
          onPointerDown={(e) => controls.start(e)}
          aria-hidden
          className="hidden h-10 w-5 cursor-grab touch-none items-center justify-center text-ink-3 hover:text-ink active:cursor-grabbing sm:flex"
        >
          <GripVertical className="size-4" />
        </span>
      )}
      <span className="relative shrink-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={item.url} alt="" className="size-12 rounded-[4px] border border-line bg-surface object-cover" />
        <span className="absolute -left-1 -top-1 inline-flex h-4 items-center rounded-[3px] bg-ink px-1 font-mono text-[10px] text-paper">
          {String(index + 1).padStart(2, "0")}
        </span>
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-medium text-ink" title={item.file.name}>
          {item.file.name}
        </p>
        <p className="text-sm text-ink-2">{formatBytes(item.file.size)}</p>
      </div>
      {!locked && (
        <div className={cn("flex shrink-0 items-center")}>
          <IconButton label={`Move ${item.file.name} up`} disabled={index === 0} onClick={() => onMove(index, index - 1)}>
            <ArrowUp aria-hidden className="size-4" />
          </IconButton>
          <IconButton label={`Move ${item.file.name} down`} disabled={index === count - 1} onClick={() => onMove(index, index + 1)}>
            <ArrowDown aria-hidden className="size-4" />
          </IconButton>
          <IconButton label={`Remove ${item.file.name}`} onClick={onRemove}>
            <X aria-hidden className="size-4" />
          </IconButton>
        </div>
      )}
    </Reorder.Item>
  );
}
