"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, Reorder, useDragControls } from "motion/react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Download,
  Eye,
  EyeOff,
  GripVertical,
  Layers,
  Loader2,
  Minimize2,
  RotateCcw,
  Scissors,
  X,
} from "lucide-react";
import { getTool } from "@/lib/tools";
import { formatBytes, formatSize } from "@/lib/media";
import { checkFile, FileToolError, postFormJson, saveBlob, uploadForm, type Converted } from "@/lib/files";
import {
  COMPRESS_PRESETS,
  compressionSettings,
  describePart,
  isPdfMode,
  listZip,
  MERGE_MAX_FILES,
  outOfBounds,
  parseRanges,
  PDF_MAX_MB,
  rangeLabel,
  sizeAt,
  type CompressEstimate,
  type CompressSample,
  type PdfMode,
  type PdfUpload,
  type SplitEstimate,
  type ZipEntry,
} from "@/lib/pdf";
import { cn } from "@/lib/utils";
import { FileDrop } from "./file-drop";
import { isBusy, ProgressButton, type Job } from "./progress-button";
import { useDebouncedTask } from "./use-debounced-task";
import { Workbench } from "./workbench";

const EASE = [0.22, 1, 0.36, 1] as const;
const swap = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE } },
  exit: { opacity: 0, y: -4, transition: { duration: 0.15 } },
};

const EXT = [".pdf"];
const api = (action: string) => `/api/tools/pdf/${action}`;

const MODES: Record<PdfMode, { label: string; hint: string; icon: typeof Layers; steps: [string, string, string] }> = {
  merge: { label: "Merge", hint: "Many → one", icon: Layers, steps: ["Add PDFs", "Set the order", "Download"] },
  split: { label: "Split", hint: "One → parts", icon: Scissors, steps: ["Add a PDF", "Pick the pages", "Download"] },
  compress: { label: "Compress", hint: "Make it lighter", icon: Minimize2, steps: ["Add a PDF", "Set the strength", "Download"] },
};

/** Each PDF is uploaded once, when it's added. Everything after that refers to it by token. */
type Upload =
  | { state: "uploading"; progress: number }
  | { state: "ready"; token: string; pages: number }
  | { state: "failed"; message: string };
type Doc = { id: string; file: File; upload: Upload };
type Ready = Doc & { upload: Extract<Upload, { state: "ready" }> };
const isReady = (d: Doc | null | undefined): d is Ready => d?.upload.state === "ready";

type Result = Converted & { url: string; saved: boolean; mode: PdfMode; parts: ZipEntry[] | null; from: number };

const messageOf = (e: unknown) =>
  e instanceof FileToolError ? e.message : "Something went wrong. Check your connection and try again.";
const isAbort = (e: unknown) => e instanceof DOMException && e.name === "AbortError";
const stem = (name: string) => name.replace(/\.[^.]+$/, "") || "document";
const isZip = (r: Converted) => r.type.includes("zip") || r.name.toLowerCase().endsWith(".zip");
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
let uid = 0;
const nextId = () => `f${++uid}`;

/**
 * The PDF toolkit: merge, split and compress in one workbench.
 *
 * PDFs upload as soon as they're added (with their own progress), so by the time people pick
 * options the server already has them. That lets every mode show the result's size before it's
 * made: the merged size, each split part, and the compressed size for any strength. Split and
 * compress share one document; merge keeps an ordered list.
 */
export function PdfPlayground({ toolId }: { toolId: string }) {
  const tool = getTool(toolId)!;
  const [mode, setMode] = useState<PdfMode>("merge");
  const [items, setItems] = useState<Doc[]>([]);
  const [doc, setDoc] = useState<Doc | null>(null);
  const [rejected, setRejected] = useState<string | null>(null);
  const [job, setJob] = useState<Job>({ kind: "ready" });
  const [result, setResult] = useState<Result | null>(null);
  // Split
  const [splitAll, setSplitAll] = useState(true);
  const [ranges, setRanges] = useState("");
  // Compress
  const [strength, setStrength] = useState(50);
  // Size predictions, each tagged with the inputs they were measured for.
  const [mergeSize, setMergeSize] = useState<{ key: string; size?: number; error?: string } | null>(null);
  const [splitEst, setSplitEst] = useState<{ key: string; data?: SplitEstimate; error?: string } | null>(null);
  const [compressEst, setCompressEst] = useState<{
    token: string;
    exact: boolean;
    samples: CompressSample[];
    error?: string;
  } | null>(null);

  // Bumped by "Retry" on a failed estimate, so the same inputs are measured again.
  const [nonce, setNonce] = useState(0);
  // The upload whose spread of compression strengths has been measured (or attempted).
  const [spreadFor, setSpreadFor] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const uploads = useRef(new Map<string, AbortController>());

  // Deep links: /tools/pdf?mode=split opens straight on that mode.
  useEffect(() => {
    const t = setTimeout(() => {
      const m = new URLSearchParams(window.location.search).get("mode");
      if (isPdfMode(m)) setMode(m);
    }, 0);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    const live = uploads.current;
    return () => {
      abortRef.current?.abort();
      live.forEach((c) => c.abort());
    };
  }, []);
  useEffect(() => (result ? () => URL.revokeObjectURL(result.url) : undefined), [result]);

  const busy = isBusy(job);

  /* ----- Uploading ----- */

  const patch = useCallback((id: string, upload: Upload) => {
    setItems((prev) => prev.map((d) => (d.id === id ? { ...d, upload } : d)));
    setDoc((d) => (d?.id === id ? { ...d, upload } : d));
  }, []);

  /** Uploads one PDF and returns its token. Also used to re-upload one that expired. */
  const upload = useCallback(
    async (d: Doc): Promise<string> => {
      uploads.current.get(d.id)?.abort();
      const ctrl = new AbortController();
      uploads.current.set(d.id, ctrl);
      patch(d.id, { state: "uploading", progress: 0 });
      const form = new FormData();
      form.append("file", d.file, d.file.name);
      try {
        const res = await postFormJson<PdfUpload>(api("upload"), form, {
          signal: ctrl.signal,
          onUpload: (progress) => patch(d.id, { state: "uploading", progress }),
        });
        patch(d.id, { state: "ready", token: res.token, pages: res.page_count });
        return res.token;
      } catch (e) {
        if (!isAbort(e)) patch(d.id, { state: "failed", message: messageOf(e) });
        throw e;
      } finally {
        if (uploads.current.get(d.id) === ctrl) uploads.current.delete(d.id);
      }
    },
    [patch],
  );

  const forget = (id: string) => {
    uploads.current.get(id)?.abort();
    uploads.current.delete(id);
  };

  const reset = () => {
    abortRef.current?.abort();
    setResult(null);
    setJob({ kind: "ready" });
  };

  // Uploads are kept on the server for a while (and a server restart clears them). When an
  // estimate finds one gone, upload it again: the new token re-runs every estimate by itself.
  const expired = (e: unknown) => e instanceof FileToolError && e.status === 410;
  const reupload = (docs: Doc[]) => docs.forEach((d) => upload(d).catch(() => {}));
  const retryEstimates = () => {
    setCompressEst(null);
    setSpreadFor(null);
    setNonce((n) => n + 1);
  };

  const switchMode = (m: PdfMode) => {
    if (m === mode || busy) return;
    reset();
    setRejected(null);
    setMode(m);
    const url = new URL(window.location.href);
    url.searchParams.set("mode", m);
    window.history.replaceState(window.history.state, "", url);
  };

  const addToMerge = (files: File[]) => {
    const problems: string[] = [];
    const ok: Doc[] = [];
    let total = items.reduce((n, i) => n + i.file.size, 0);
    for (const f of files) {
      const problem = checkFile(f, EXT, PDF_MAX_MB);
      if (problem) {
        problems.push(`${f.name}: ${problem}`);
        continue;
      }
      if (items.length + ok.length >= MERGE_MAX_FILES) {
        problems.push(`Only ${MERGE_MAX_FILES} files can be merged at once.`);
        break;
      }
      if (total + f.size > PDF_MAX_MB * 1024 * 1024) {
        problems.push(`${f.name} would take the total over ${PDF_MAX_MB} MB.`);
        continue;
      }
      total += f.size;
      ok.push({ id: nextId(), file: f, upload: { state: "uploading", progress: 0 } });
    }
    setRejected(problems.length ? problems.join(" ") : null);
    if (!ok.length) return;
    reset();
    setItems((prev) => [...prev, ...ok]);
    ok.forEach((d) => upload(d).catch(() => {}));
  };

  const pickDoc = (f: File) => {
    const problem = checkFile(f, EXT, PDF_MAX_MB);
    setRejected(problem);
    if (problem) return;
    reset();
    if (doc) forget(doc.id);
    const d: Doc = { id: nextId(), file: f, upload: { state: "uploading", progress: 0 } };
    setDoc(d);
    upload(d).catch(() => {});
  };

  const removeItem = (id: string) => {
    forget(id);
    reset();
    setRejected(null);
    setItems((prev) => prev.filter((i) => i.id !== id));
  };

  const clearAll = () => {
    reset();
    setRejected(null);
    if (mode === "merge") {
      items.forEach((i) => forget(i.id));
      setItems([]);
    } else {
      if (doc) forget(doc.id);
      setDoc(null);
    }
  };

  /* ----- Size predictions ----- */

  const parsed = useMemo(() => parseRanges(ranges), [ranges]);
  const pages = isReady(doc) ? doc.upload.pages : null;
  const rangeError = splitAll ? null : (parsed.error ?? (pages ? outOfBounds(parsed.ranges, pages) : null));

  // Merge: the real merge runs on the server and only its size comes back.
  const mergeReady = items.length >= 2 && items.every(isReady);
  const mergeKey = mergeReady ? `${items.map((i) => (i as Ready).upload.token).join(",")}|${nonce}` : null;
  useDebouncedTask(
    mergeKey,
    async (signal) => {
      const form = new FormData();
      items.forEach((i) => isReady(i) && form.append("tokens", i.upload.token));
      try {
        const res = await postFormJson<{ total_size: number }>(api("merge-estimate"), form, { signal });
        setMergeSize({ key: mergeKey!, size: res.total_size });
      } catch (e) {
        if (isAbort(e)) return;
        if (expired(e)) return reupload(items);
        setMergeSize({ key: mergeKey!, error: messageOf(e) });
      }
    },
    250,
  );

  // Split: the parts and their sizes, re-measured as the ranges change.
  const splitKey =
    mode === "split" && isReady(doc) && !rangeError && (splitAll || parsed.ranges.length)
      ? `${doc.upload.token}|${splitAll ? "*" : ranges.replace(/\s+/g, "")}|${nonce}`
      : null;
  useDebouncedTask(
    splitKey,
    async (signal) => {
      if (!isReady(doc)) return;
      const form = new FormData();
      form.append("token", doc.upload.token);
      if (!splitAll) form.append("page_ranges", ranges.trim());
      try {
        const data = await postFormJson<SplitEstimate>(api("split-estimate"), form, { signal });
        setSplitEst({ key: splitKey!, data });
      } catch (e) {
        if (isAbort(e)) return;
        if (expired(e)) return reupload([doc]);
        setSplitEst({ key: splitKey!, error: messageOf(e) });
      }
    },
    400,
  );

  // Compress: the strength the slider is on first (so a size shows as soon as possible), then
  // a spread of strengths in the background, so sliding shows a size straight away…
  const compressToken = mode === "compress" && isReady(doc) ? doc.upload.token : null;
  const merge = (a: CompressSample[], b: CompressSample[]) => [
    ...a.filter((s) => !b.some((n) => n.percentage === s.percentage)),
    ...b,
  ];
  useDebouncedTask(
    compressToken && spreadFor !== compressToken ? `${compressToken}|${nonce}` : null,
    async (signal) => {
      const token = compressToken!;
      const ask = (percentages?: number) => {
        const form = new FormData();
        form.append("token", token);
        if (percentages) form.append("percentages", String(percentages));
        return postFormJson<CompressEstimate>(api("compress-estimate"), form, { signal });
      };
      try {
        const first = await ask(strength);
        setCompressEst({ token, exact: first.exact, samples: first.samples });
        const spread = await ask();
        setCompressEst((prev) =>
          prev?.token === token ? { ...prev, samples: merge(prev.samples, spread.samples) } : prev,
        );
        setSpreadFor(token);
      } catch (e) {
        if (isAbort(e)) return;
        if (expired(e) && doc) return reupload([doc]);
        setCompressEst((prev) =>
          prev?.token === token && prev.samples.length
            ? prev // Keep the size we already have; sliding will measure exact strengths on demand.
            : { token, exact: false, samples: [], error: messageOf(e) },
        );
        setSpreadFor(token);
      }
    },
    0,
  );
  // …then the exact size for whatever strength the slider settles on.
  const haveSamples = compressEst?.token === compressToken && Boolean(compressEst?.samples.length);
  const measured = haveSamples && compressEst!.samples.some((s) => s.percentage === strength);
  useDebouncedTask(
    haveSamples && !measured ? `${compressToken}|${strength}` : null,
    async (signal) => {
      const form = new FormData();
      form.append("token", compressToken!);
      form.append("percentages", String(strength));
      let est: CompressEstimate;
      try {
        est = await postFormJson<CompressEstimate>(api("compress-estimate"), form, { signal });
      } catch (e) {
        // Keep showing the interpolated size; an expired upload is sent again.
        if (expired(e) && doc) reupload([doc]);
        return;
      }
      setCompressEst((prev) =>
        prev && prev.token === compressToken
          ? { ...prev, samples: [...prev.samples.filter((s) => s.percentage !== strength), ...est.samples] }
          : prev,
      );
    },
    450,
  );

  /* ----- Running ----- */

  const start = async () => {
    const targets = mode === "merge" ? items : doc ? [doc] : [];
    if (!targets.length || !targets.every(isReady)) return;
    if (mode === "merge" && targets.length < 2) return;
    if (mode === "split" && rangeError) return;

    const build = (tokens: string[]) => {
      const form = new FormData();
      if (mode === "merge") tokens.forEach((t) => form.append("tokens", t));
      else form.append("token", tokens[0]);
      if (mode === "split" && !splitAll) form.append("page_ranges", ranges.trim());
      if (mode === "compress") form.append("compression_percentage", String(strength));
      return form;
    };
    const first = targets[0].file.name;
    const fallbackName =
      mode === "merge"
        ? `${stem(first)}_merged.pdf`
        : mode === "split"
          ? `${stem(first)}_split.zip`
          : `${stem(first)}_compressed.pdf`;

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setJob({ kind: "processing" });
    const send = (tokens: string[]) => uploadForm(api(mode), build(tokens), { signal: ctrl.signal, fallbackName });
    try {
      let out: Converted;
      try {
        out = await send(targets.map((t) => (t as Ready).upload.token));
      } catch (e) {
        // The server forgets uploads after a while; send them again and retry once.
        if (!(e instanceof FileToolError && e.status === 410)) throw e;
        setJob({ kind: "uploading", progress: 0 });
        const fresh = await Promise.all(targets.map((t) => upload(t)));
        setJob({ kind: "processing" });
        out = await send(fresh);
      }
      const parts = isZip(out) ? await listZip(out.blob) : null;
      const from = targets.reduce((n, t) => n + t.file.size, 0);
      setResult({ ...out, url: URL.createObjectURL(out.blob), saved: false, mode, parts, from });
      setJob({ kind: "ready" });
    } catch (e) {
      if (ctrl.signal.aborted) return setJob({ kind: "ready" });
      setJob({ kind: "failed", message: messageOf(e) });
    }
  };

  const save = () => {
    if (!result) return;
    saveBlob(result.blob, result.name);
    setResult({ ...result, saved: true });
  };

  /* ----- Derived view state ----- */

  const pendingUploads =
    mode === "merge"
      ? items.filter((i) => i.upload.state === "uploading").length
      : doc?.upload.state === "uploading"
        ? 1
        : 0;
  const failedUploads = mode === "merge" ? items.some((i) => i.upload.state === "failed") : doc?.upload.state === "failed";
  const hasInput = mode === "merge" ? mergeReady : isReady(doc);
  const showOptions = mode === "merge" ? items.length >= 1 : Boolean(doc);
  const step = !hasInput ? 0 : !result ? 1 : result.saved ? 3 : 2;

  const sample = haveSamples ? sizeAt(compressEst!.samples, strength) : null;
  // When the server measured a sample of pages (big files), even measured points are estimates.
  const compressPrediction = sample ? { size: sample.size, exact: sample.exact && compressEst!.exact } : null;

  const actionLabel =
    mode === "merge"
      ? items.length < 2
        ? "Add one more PDF"
        : `Merge ${items.length} PDFs`
      : mode === "split"
        ? "Split PDF"
        : `Compress by ${strength}%`;
  const actionHint =
    pendingUploads > 0
      ? `Uploading ${plural(pendingUploads, "PDF")} first. Sizes appear once ${pendingUploads === 1 ? "it's" : "they're"} in.`
      : failedUploads
        ? "An upload didn't go through. Retry it or remove it."
        : mode === "merge" && items.length < 2
          ? "Merging needs at least two PDFs."
          : "You can check the result here before you save it.";

  return (
    <Workbench
      steps={MODES[mode].steps}
      current={step}
      footer={
        <>
          Your PDFs are kept on our server for 30 minutes after you last use them, so you can try different settings
          without uploading again. Then they&apos;re deleted. Password-protected PDFs can&apos;t be opened.
        </>
      }
    >
      <ModeSwitch mode={mode} disabled={busy} onChange={switchMode} />

      <div className="p-3 sm:p-4">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={mode} {...swap} className="space-y-3">
            {/* ---------- Inputs ---------- */}
            {mode === "merge" ? (
              items.length === 0 ? (
                <FileDrop
                  multiple
                  accept={tool.accept?.types ?? ".pdf"}
                  title="Drop the PDFs to merge"
                  formats={`PDF · 2 to ${MERGE_MAX_FILES} files · ${PDF_MAX_MB} MB in total`}
                  error={rejected}
                  onFiles={addToMerge}
                />
              ) : (
                <MergeList
                  items={items}
                  locked={busy}
                  accept={tool.accept?.types ?? ".pdf"}
                  error={rejected}
                  onReorder={(next) => {
                    reset();
                    setItems(next);
                  }}
                  onRemove={removeItem}
                  onRetry={(d) => upload(d).catch(() => {})}
                  onAdd={addToMerge}
                  onClear={clearAll}
                />
              )
            ) : !doc ? (
              <FileDrop
                accept={tool.accept?.types ?? ".pdf"}
                title={mode === "split" ? "Drop the PDF to split" : "Drop the PDF to compress"}
                formats={`PDF · up to ${PDF_MAX_MB} MB`}
                error={rejected}
                onFile={pickDoc}
              />
            ) : (
              <>
                <DocRow
                  doc={doc}
                  locked={busy}
                  accept={tool.accept?.types ?? ".pdf"}
                  onReplace={pickDoc}
                  onClear={clearAll}
                  onRetry={() => upload(doc).catch(() => {})}
                />
                {rejected && (
                  <p role="alert" className="px-1 text-sm text-danger">
                    {rejected}
                  </p>
                )}
              </>
            )}

            {/* ---------- Options + action, or the result ---------- */}
            {showOptions ? (
              <AnimatePresence mode="wait" initial={false}>
                {result ? (
                  <motion.div key="result" {...swap}>
                    <ResultPanel result={result} onSave={save} onBack={reset} />
                  </motion.div>
                ) : (
                  <motion.div
                    key="options"
                    {...swap}
                    className="rounded-md border border-dashed border-line px-3 py-3 sm:px-4 sm:py-4"
                  >
                    {mode === "merge" && (
                      <MergeSummary
                        count={items.length}
                        size={mergeKey && mergeSize?.key === mergeKey ? mergeSize : null}
                        measuring={Boolean(mergeKey) && mergeSize?.key !== mergeKey}
                        onRetry={retryEstimates}
                      />
                    )}
                    {mode === "split" && (
                      <SplitOptions
                        all={splitAll}
                        ranges={ranges}
                        parsed={parsed}
                        error={rangeError}
                        pages={pages}
                        estimate={splitKey && splitEst?.key === splitKey ? splitEst : null}
                        measuring={Boolean(splitKey) && splitEst?.key !== splitKey}
                        onRetry={retryEstimates}
                        locked={busy}
                        onAll={setSplitAll}
                        onRanges={(v) => {
                          setRanges(v);
                          if (job.kind === "failed") setJob({ kind: "ready" });
                        }}
                      />
                    )}
                    {mode === "compress" && (
                      <CompressOptions
                        value={strength}
                        locked={busy}
                        onChange={setStrength}
                        original={doc?.file.size ?? 0}
                        prediction={compressPrediction}
                        refining={Boolean(sample && !sample.exact)}
                        error={compressEst?.token === compressToken ? compressEst?.error : undefined}
                        waiting={!isReady(doc)}
                        onRetry={retryEstimates}
                      />
                    )}

                    <div className="mt-4">
                      <ProgressButton
                        job={job}
                        disabled={!hasInput || (mode === "split" && Boolean(rangeError))}
                        label={actionLabel}
                        working={mode === "merge" ? "Merging…" : mode === "split" ? "Splitting…" : "Compressing…"}
                        hint={actionHint}
                        onStart={start}
                        onCancel={() => abortRef.current?.abort()}
                      />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            ) : null}
          </motion.div>
        </AnimatePresence>
      </div>
    </Workbench>
  );
}

/* ---------- Mode switch ---------- */

/** Three segments under the step tracker; an ink thumb slides to the one in use. */
function ModeSwitch({ mode, disabled, onChange }: { mode: PdfMode; disabled: boolean; onChange: (m: PdfMode) => void }) {
  const keys = Object.keys(MODES) as PdfMode[];
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKey = (e: React.KeyboardEvent, i: number) => {
    const delta = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const n = (i + delta + keys.length) % keys.length;
    refs.current[n]?.focus();
    onChange(keys[n]);
  };

  return (
    <div className="border-b border-line bg-paper/60 p-2 sm:px-3">
      <div role="tablist" aria-label="What to do with your PDFs" className="grid grid-cols-3 gap-1">
        {keys.map((k, i) => {
          const m = MODES[k];
          const active = k === mode;
          return (
            <button
              key={k}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              disabled={disabled && !active}
              onClick={() => onChange(k)}
              onKeyDown={(e) => onKey(e, i)}
              className={cn(
                "group relative flex h-12 items-center justify-center gap-2 rounded-md px-2 text-sm transition-colors duration-150 sm:justify-start sm:px-3",
                "disabled:cursor-not-allowed disabled:opacity-50",
                active ? "text-paper" : "text-ink-2 hover:bg-paper-2 hover:text-ink",
              )}
            >
              {active && (
                <motion.span
                  layoutId="pdf-mode-thumb"
                  aria-hidden
                  className="absolute inset-0 rounded-md bg-ink"
                  transition={{ type: "spring", bounce: 0.22, duration: 0.5 }}
                />
              )}
              <m.icon aria-hidden className="relative size-4 shrink-0" />
              <span className="relative flex min-w-0 flex-col items-start leading-tight">
                <span className="font-medium">{m.label}</span>
                <span className={cn("label-mono hidden text-[10px] sm:block", active ? "text-paper-dim" : "text-ink-3")}>
                  {m.hint}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- Files ---------- */

/** A small paper sheet with a folded corner: how a PDF looks on the worksheet. */
function Sheet({ index, className }: { index?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative flex h-10 w-8 shrink-0 flex-col justify-end rounded-[3px] border border-line bg-surface pb-1",
        className,
      )}
      style={{ clipPath: "polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 0 100%)" }}
    >
      <span className="absolute right-0 top-0 size-2 rounded-bl-[2px] border-b border-l border-line bg-paper-2" />
      {index !== undefined ? (
        <span className="absolute inset-x-0 top-2.5 text-center font-mono text-[11px] font-medium text-ink">
          {String(index).padStart(2, "0")}
        </span>
      ) : (
        <span className="mx-1.5 mb-auto mt-2.5 space-y-[3px]">
          <span className="block h-px bg-line" />
          <span className="block h-px bg-line" />
          <span className="block h-px w-2/3 bg-line" />
        </span>
      )}
      <span className="text-center font-mono text-[8px] font-medium tracking-[0.08em] text-ink-3">PDF</span>
    </span>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
  className,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex size-9 items-center justify-center rounded-[8px] text-ink-3 transition-colors hover:bg-paper-2 hover:text-ink disabled:pointer-events-none disabled:opacity-30",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Pages and size once uploaded; progress while uploading; the reason if it failed. */
function UploadMeta({ doc, onRetry }: { doc: Doc; onRetry: () => void }) {
  const u = doc.upload;
  if (u.state === "ready") {
    return (
      <p className="mt-0.5 truncate text-sm text-ink-2">
        {plural(u.pages, "page")} · {formatBytes(doc.file.size)}
      </p>
    );
  }
  if (u.state === "uploading") {
    return (
      <p className="mt-0.5 flex items-center gap-1.5 text-sm text-ink-3">
        <Loader2 aria-hidden className="size-3.5 animate-spin" />
        {u.progress >= 1 ? "Reading pages" : `Uploading ${Math.round(u.progress * 100)}%`} · {formatBytes(doc.file.size)}
      </p>
    );
  }
  return (
    <p className="mt-0.5 flex min-w-0 items-center gap-2 text-sm text-danger">
      <span className="truncate" title={u.message}>
        {u.message}
      </span>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex shrink-0 items-center gap-1 text-ink-2 underline-offset-4 hover:text-ink hover:underline"
      >
        <RotateCcw aria-hidden className="size-3" /> Retry
      </button>
    </p>
  );
}

/** A hairline along the bottom edge of a row that fills as the file uploads. */
function UploadLine({ doc }: { doc: Doc }) {
  if (doc.upload.state !== "uploading") return null;
  return (
    <span aria-hidden className="absolute inset-x-2 bottom-0 h-px overflow-hidden bg-line">
      <motion.span
        className="block h-full bg-ink"
        initial={{ width: 0 }}
        animate={{ width: `${doc.upload.progress * 100}%` }}
        transition={{ ease: "linear", duration: 0.2 }}
      />
    </span>
  );
}

/** Merge: the files in the order they'll be joined. Drag the grip, or use the arrows. */
function MergeList({
  items,
  locked,
  accept,
  error,
  onReorder,
  onRemove,
  onRetry,
  onAdd,
  onClear,
}: {
  items: Doc[];
  locked: boolean;
  accept: string;
  error: string | null;
  onReorder: (items: Doc[]) => void;
  onRemove: (id: string) => void;
  onRetry: (doc: Doc) => void;
  onAdd: (files: File[]) => void;
  onClear: () => void;
}) {
  const [announce, setAnnounce] = useState("");
  const total = items.reduce((n, i) => n + i.file.size, 0);
  const totalPages = items.every(isReady) ? items.reduce((n, i) => n + (i as Ready).upload.pages, 0) : null;

  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length) return;
    const next = [...items];
    const [it] = next.splice(from, 1);
    next.splice(to, 0, it);
    onReorder(next);
    setAnnounce(`${it.file.name} moved to position ${to + 1} of ${items.length}.`);
  };

  return (
    <div>
      <div className="flex items-baseline justify-between gap-4 px-1 pb-2">
        <p className="label-mono truncate text-ink-3">
          Merge order · {plural(items.length, "file")}
          {totalPages !== null ? ` · ${plural(totalPages, "page")}` : ""} · {formatBytes(total)}
        </p>
        {!locked && (
          <button
            type="button"
            onClick={onClear}
            className="shrink-0 text-xs text-ink-3 underline-offset-4 hover:text-ink hover:underline"
          >
            Clear all
          </button>
        )}
      </div>

      <Reorder.Group as="ol" axis="y" values={items} onReorder={onReorder} className="space-y-1.5">
        {items.map((item, i) => (
          <MergeRow
            key={item.id}
            item={item}
            index={i}
            count={items.length}
            locked={locked}
            onMove={move}
            onRemove={() => onRemove(item.id)}
            onRetry={() => onRetry(item)}
          />
        ))}
      </Reorder.Group>
      <p className="sr-only" aria-live="assertive">
        {announce}
      </p>

      {!locked && items.length < MERGE_MAX_FILES && (
        <div className="mt-2">
          <FileDrop
            compact
            multiple
            accept={accept}
            title="Add more PDFs"
            formats={`Up to ${MERGE_MAX_FILES - items.length} more · ${PDF_MAX_MB} MB total`}
            error={error}
            onFiles={onAdd}
          />
        </div>
      )}
      {locked && error && (
        <p role="alert" className="px-1 pt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

function MergeRow({
  item,
  index,
  count,
  locked,
  onMove,
  onRemove,
  onRetry,
}: {
  item: Doc;
  index: number;
  count: number;
  locked: boolean;
  onMove: (from: number, to: number) => void;
  onRemove: () => void;
  onRetry: () => void;
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
      className={cn(
        "relative flex items-center gap-2 rounded-md border bg-paper p-1.5 pr-1 sm:gap-3 sm:p-2",
        item.upload.state === "failed" ? "border-danger/40" : "border-line",
      )}
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
      <Sheet index={index + 1} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-medium text-ink" title={item.file.name}>
          {item.file.name}
        </p>
        <UploadMeta doc={item} onRetry={onRetry} />
      </div>
      {!locked && (
        <div className="flex shrink-0 items-center">
          <IconButton label={`Move ${item.file.name} up`} disabled={index === 0} onClick={() => onMove(index, index - 1)}>
            <ArrowUp aria-hidden className="size-4" />
          </IconButton>
          <IconButton
            label={`Move ${item.file.name} down`}
            disabled={index === count - 1}
            onClick={() => onMove(index, index + 1)}
          >
            <ArrowDown aria-hidden className="size-4" />
          </IconButton>
          <IconButton label={`Remove ${item.file.name}`} onClick={onRemove}>
            <X aria-hidden className="size-4" />
          </IconButton>
        </div>
      )}
      <UploadLine doc={item} />
    </Reorder.Item>
  );
}

/** Split / compress: the one PDF being worked on. */
function DocRow({
  doc,
  locked,
  accept,
  onReplace,
  onClear,
  onRetry,
}: {
  doc: Doc;
  locked: boolean;
  accept: string;
  onReplace: (f: File) => void;
  onClear: () => void;
  onRetry: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div
      className={cn(
        "relative flex items-center gap-3 rounded-md border bg-paper p-2 sm:gap-4",
        doc.upload.state === "failed" ? "border-danger/40" : "border-line",
      )}
    >
      <span className="flex h-14 w-12 shrink-0 items-center justify-center rounded-sm border border-line bg-paper-2">
        <Sheet />
      </span>
      <div className="min-w-0 flex-1">
        <p className="label-mono text-ink-3">Your PDF</p>
        <p className="mt-1 truncate text-[15px] font-medium text-ink" title={doc.file.name}>
          {doc.file.name}
        </p>
        <UploadMeta doc={doc} onRetry={onRetry} />
      </div>
      {!locked && (
        <div className="flex shrink-0 items-center gap-1">
          <input
            ref={inputRef}
            type="file"
            accept={accept}
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onReplace(f);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="hidden h-9 items-center rounded-[8px] px-2.5 text-sm text-ink-2 transition-colors hover:bg-paper-2 hover:text-ink sm:inline-flex"
          >
            Change
          </button>
          <IconButton label="Remove PDF" onClick={onClear}>
            <X aria-hidden className="size-4" />
          </IconButton>
        </div>
      )}
      <UploadLine doc={doc} />
    </div>
  );
}

/* ---------- Options ---------- */

function Chip({
  selected,
  onClick,
  disabled,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex h-9 items-center rounded-sm border px-3 text-sm transition-colors duration-150 disabled:cursor-not-allowed",
        selected ? "border-ink bg-ink text-paper" : "border-line bg-surface text-ink-2 hover:border-ink-3 hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

function RetryLink({ onRetry }: { onRetry: () => void }) {
  return (
    <button
      type="button"
      onClick={onRetry}
      className="ml-2 inline-flex items-center gap-1 text-xs text-ink-2 underline-offset-4 hover:text-ink hover:underline"
    >
      <RotateCcw aria-hidden className="size-3" /> Retry
    </button>
  );
}

/** Shown while the server works out a size. */
function Measuring({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 font-mono text-xs text-ink-3", className)}>
      <Loader2 aria-hidden className="size-3 animate-spin" />
      measuring
    </span>
  );
}

function MergeSummary({
  count,
  size,
  measuring,
  onRetry,
}: {
  count: number;
  size: { size?: number; error?: string } | null;
  measuring: boolean;
  onRetry: () => void;
}) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="label-mono text-ink-3">You&apos;ll get</p>
        <span className="inline-flex h-8 items-center rounded-sm border border-ink bg-ink px-2.5 text-sm text-paper">
          1 PDF{count >= 2 ? `, ${count} files in this order` : ""}
        </span>
        {size?.size !== undefined ? (
          <span className="font-mono text-sm text-ink">{formatBytes(size.size)}</span>
        ) : measuring ? (
          <Measuring />
        ) : null}
      </div>
      {size?.error ? (
        <p className="mt-2 text-xs text-danger">
          {size.error}
          <RetryLink onRetry={onRetry} />
        </p>
      ) : count >= 2 ? (
        <p className="mt-2 text-xs text-ink-3">Reorder above to change it. Shared fonts and images are stored once.</p>
      ) : null}
    </div>
  );
}

function SplitOptions({
  all,
  ranges,
  parsed,
  error,
  pages,
  estimate,
  measuring,
  onRetry,
  locked,
  onAll,
  onRanges,
}: {
  all: boolean;
  ranges: string;
  parsed: ReturnType<typeof parseRanges>;
  error: string | null;
  pages: number | null;
  estimate: { data?: SplitEstimate; error?: string } | null;
  measuring: boolean;
  onRetry: () => void;
  locked: boolean;
  onAll: (v: boolean) => void;
  onRanges: (v: string) => void;
}) {
  const id = useId();
  const showError = !all && ranges.trim().length > 0 && error;
  const data = estimate?.data;
  const sizeFor = (from: number, to: number) =>
    data?.parts.find((p) => p.first_page === from && p.last_page === to)?.size;

  const outcome = data ? (
    <span className="font-mono text-xs text-ink">
      {data.output === "zip" ? `ZIP of ${data.parts.length} PDFs` : "One PDF"} · {formatBytes(data.total_size)}
    </span>
  ) : measuring ? (
    <Measuring />
  ) : null;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="label-mono text-ink-3">Split into</p>
        <div className="flex gap-1.5">
          <Chip selected={all} disabled={locked} onClick={() => onAll(true)}>
            Every page
          </Chip>
          <Chip selected={!all} disabled={locked} onClick={() => onAll(false)}>
            Chosen pages
          </Chip>
        </div>
      </div>

      <AnimatePresence initial={false} mode="wait">
        {all ? (
          <motion.div key="all" {...swap} className="mt-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <p className="text-sm text-ink-2">
              {pages ? `${plural(pages, "PDF")}, one per page` : "One PDF per page"}, delivered together as a ZIP.
            </p>
            {estimate?.error ? (
              <span className="text-xs text-danger">
                {estimate.error}
                <RetryLink onRetry={onRetry} />
              </span>
            ) : (
              outcome
            )}
          </motion.div>
        ) : (
          <motion.div key="ranges" {...swap} className="mt-3">
            <label htmlFor={id} className="label-mono text-ink-3">
              Pages and ranges{pages ? ` · 1 to ${pages}` : ""}
            </label>
            <input
              id={id}
              value={ranges}
              disabled={locked}
              onChange={(e) => onRanges(e.target.value)}
              placeholder="1-3, 5, 8-10"
              inputMode="numeric"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={Boolean(showError)}
              aria-describedby={`${id}-help`}
              className={cn(
                "mt-2 h-11 w-full rounded-md border bg-surface px-3.5 font-mono text-[14px] text-ink outline-none transition-[border-color,box-shadow] placeholder:text-ink-3 focus:border-ink focus:ring-4 focus:ring-accent/15",
                showError ? "border-danger/60" : "border-line",
              )}
            />
            <div id={`${id}-help`} aria-live="polite" className="mt-2 min-h-6">
              {showError ? (
                <p className="text-sm text-danger">{error}</p>
              ) : estimate?.error ? (
                <p className="text-sm text-danger">
                  {estimate.error}
                  <RetryLink onRetry={onRetry} />
                </p>
              ) : parsed.ranges.length ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  {parsed.ranges.map((r, i) => {
                    const size = sizeFor(r.from, r.to);
                    return (
                      <span
                        key={`${r.from}-${r.to}-${i}`}
                        className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-line bg-paper px-2 text-xs text-ink-2"
                      >
                        <span className="font-mono text-ink-3">{String(i + 1).padStart(2, "0")}</span>
                        {rangeLabel(r)}
                        {size !== undefined && <span className="font-mono text-ink-3">· {formatBytes(size)}</span>}
                      </span>
                    );
                  })}
                  {outcome && <span className="ml-1 inline-flex items-center gap-1.5 text-xs text-ink-3">→ {outcome}</span>}
                </div>
              ) : (
                <p className="text-xs text-ink-3">Commas between parts. Each range becomes its own PDF.</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function CompressOptions({
  value,
  locked,
  onChange,
  original,
  prediction,
  refining,
  error,
  waiting,
  onRetry,
}: {
  value: number;
  locked: boolean;
  onChange: (v: number) => void;
  original: number;
  prediction: { size: number; exact: boolean } | null;
  /** The shown size is interpolated; the exact one for this strength is on its way. */
  refining: boolean;
  error?: string;
  waiting: boolean;
  onRetry: () => void;
}) {
  const id = useId();
  const { dpi, quality } = compressionSettings(value);
  const preset = COMPRESS_PRESETS.find((p) => p.value === value);
  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="label-mono text-ink-3">Strength</p>
        <div className="flex flex-wrap gap-1.5">
          {COMPRESS_PRESETS.map((p) => (
            <Chip key={p.label} selected={p.value === value} disabled={locked} onClick={() => onChange(p.value)}>
              {p.label}
            </Chip>
          ))}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-4">
        <input
          id={id}
          type="range"
          min={1}
          max={95}
          value={value}
          disabled={locked}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label="Compression strength"
          aria-valuetext={`${value}%`}
          className="h-11 min-w-0 flex-1 cursor-pointer accent-ink disabled:cursor-not-allowed"
        />
        <output htmlFor={id} className="w-14 shrink-0 text-right font-mono text-lg font-medium tabular-nums text-ink">
          {value}%
        </output>
      </div>

      <dl className="grid grid-cols-2 border-y border-line text-sm sm:grid-cols-[1fr_1fr_2fr]">
        <div className="py-2.5 pr-3">
          <dt className="label-mono text-ink-3">Images</dt>
          <dd className="mt-1 font-mono text-ink">≤ {dpi} dpi</dd>
        </div>
        <div className="border-l border-line py-2.5 pl-3">
          <dt className="label-mono text-ink-3">JPEG quality</dt>
          <dd className="mt-1 font-mono text-ink">{quality}</dd>
        </div>
        <div className="col-span-2 border-t border-line py-2.5 sm:col-span-1 sm:border-l sm:border-t-0 sm:pl-3">
          <dt className="label-mono text-ink-3">Expect</dt>
          <dd className="mt-1 text-ink-2">
            {preset?.hint ??
              (value < 40 ? "A gentle trim." : value < 70 ? "A clear saving, still readable." : "The smallest file. Photos lose detail.")}
          </dd>
        </div>
      </dl>

      {/* The predicted result, updated live as the slider moves. */}
      <SizeBars
        before={original}
        after={prediction?.size ?? null}
        exact={prediction?.exact ?? false}
        afterLabel="After"
        status={
          error ? (
            <span className="text-xs text-danger">
              {error}
              <RetryLink onRetry={onRetry} />
            </span>
          ) : waiting ? (
            <span className="text-xs text-ink-3">after upload</span>
          ) : !prediction || refining ? (
            <Measuring />
          ) : null
        }
      />
      <p className="mt-2 text-xs text-ink-3">Text and vector drawings stay sharp at any strength. Only images are resampled.</p>
    </div>
  );
}

/* ---------- Sizes ---------- */

/** Before and after as two hairline bars, with the saving. Used for the prediction and the result. */
function SizeBars({
  before,
  after,
  exact,
  status,
  afterLabel,
}: {
  before: number;
  after: number | null;
  exact: boolean;
  status?: React.ReactNode;
  afterLabel: string;
}) {
  const pct = after !== null && before > 0 ? Math.round((1 - after / before) * 100) : null;
  const rows: [string, number | null, number][] = [
    ["Before", before, 1],
    [afterLabel, after, after !== null && before ? Math.min(after / before, 1) : 0],
  ];
  return (
    <div className="mt-3 border-b border-line pb-3">
      <div className="flex items-baseline justify-between gap-4 pt-0.5">
        <p className="label-mono text-ink-3">Size</p>
        <p className="flex items-center gap-2 font-mono text-sm text-ink">
          {status}
          {pct !== null && <span>{pct > 0 ? `${exact ? "" : "≈ "}−${pct}%` : "No smaller"}</span>}
        </p>
      </div>
      <div className="mt-2.5 space-y-2">
        {rows.map(([label, size, ratio], i) => (
          <div key={label} className="grid grid-cols-[3.5rem_1fr_5rem] items-center gap-3">
            <span className="label-mono text-ink-3">{label}</span>
            <span className="h-2 overflow-hidden rounded-[2px] bg-paper-2">
              <motion.span
                className={cn("block h-full", i === 0 ? "bg-ink-3/50" : "bg-ink")}
                initial={false}
                animate={{ width: `${ratio * 100}%` }}
                transition={{ duration: 0.5, ease: EASE }}
              />
            </span>
            <span className="text-right font-mono text-xs text-ink-2">
              {size === null ? "—" : i === 0 ? formatBytes(size) : formatSize(size, exact)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- Result ---------- */

function ResultPanel({ result, onSave, onBack }: { result: Result; onSave: () => void; onBack: () => void }) {
  const [preview, setPreview] = useState(false);
  const zip = isZip(result);
  const format = zip ? "ZIP" : "PDF";
  const back = result.mode === "merge" ? "Edit list" : result.mode === "split" ? "Change pages" : "Adjust";
  const saved = result.from > 0 ? Math.round((1 - result.size / result.from) * 100) : 0;

  return (
    <div className="rounded-md border border-line bg-surface px-3 py-3 sm:px-4 sm:py-4">
      <div className="flex items-baseline justify-between gap-4">
        <p className="label-mono flex items-center gap-1.5 text-ink-2">
          <Check aria-hidden className="size-3.5 text-success" /> {format} ready
        </p>
        <p className="label-mono shrink-0 text-ink-3">{formatBytes(result.size)}</p>
      </div>
      <p className="mt-2 truncate text-lg font-semibold tracking-[-0.015em] text-ink" title={result.name}>
        {result.name}
      </p>

      {result.mode === "compress" && (
        <>
          <SizeBars before={result.from} after={result.size} exact afterLabel="After" />
          {saved <= 2 && (
            <p className="mt-3 text-xs text-ink-2">
              This PDF was already lean. It&apos;s mostly text, which doesn&apos;t compress much further. Your original
              is fine to send.
            </p>
          )}
        </>
      )}

      {zip && result.parts && <PartsList parts={result.parts} />}

      {!zip && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setPreview((v) => !v)}
            aria-expanded={preview}
            className="inline-flex h-9 items-center gap-1.5 rounded-[8px] border border-line bg-paper px-3 text-sm text-ink-2 transition-colors hover:border-ink-3 hover:text-ink"
          >
            {preview ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
            {preview ? "Hide preview" : "Preview the PDF"}
          </button>
          <AnimatePresence initial={false}>
            {preview && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1, transition: { duration: 0.4, ease: EASE } }}
                exit={{ height: 0, opacity: 0, transition: { duration: 0.2 } }}
                className="overflow-hidden"
              >
                <object
                  data={`${result.url}#toolbar=0&navpanes=0&view=FitH`}
                  type="application/pdf"
                  aria-label={`Preview of ${result.name}`}
                  className="mt-3 block h-[min(60vh,520px)] w-full rounded-sm border border-line bg-paper-2"
                >
                  <p className="p-4 text-sm text-ink-2">This browser can&apos;t show PDFs inline. Download it to take a look.</p>
                </object>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={onSave}
          className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-md bg-ink px-5 text-[15px] font-medium text-paper transition-[background-color,transform] duration-150 hover:bg-ink/85 active:translate-y-px"
        >
          {result.saved ? <Check aria-hidden className="size-4" /> : <Download aria-hidden className="size-4" />}
          {result.saved ? "Saved. Download again" : `Download ${format}`}
          <span className="font-mono text-[13px] font-normal text-paper/60">{formatBytes(result.size)}</span>
        </button>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex h-12 items-center rounded-md border border-line bg-surface px-4 text-sm font-medium text-ink transition-colors hover:border-ink-3"
        >
          {back}
        </button>
      </div>
      <p className="mt-2.5 text-xs text-ink-3">
        {result.mode === "merge"
          ? "Pages keep their original size and orientation."
          : result.mode === "split"
            ? zip
              ? "Each part is a separate PDF inside the ZIP."
              : "Just the pages you asked for, as one PDF."
            : "Metadata and embedded thumbnails were removed to save space."}
      </p>
    </div>
  );
}

/** Split: what's inside the ZIP, read from the archive itself. */
function PartsList({ parts }: { parts: ZipEntry[] }) {
  const scroll = parts.length > 6;
  return (
    <div className="mt-4">
      <p className="label-mono text-ink-3">Inside · {plural(parts.length, "PDF")}</p>
      <div className={cn("relative mt-2", scroll && "max-h-[248px] overflow-y-auto overscroll-contain")} data-lenis-prevent>
        <ol className="divide-y divide-line border-y border-line">
          {parts.map((p, i) => (
            <li key={p.name} className="flex items-center gap-3 py-2">
              <span className="w-6 shrink-0 font-mono text-[11px] text-ink-3">{String(i + 1).padStart(2, "0")}</span>
              <span className="w-24 shrink-0 text-sm font-medium text-ink">{describePart(p.name)}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink-3">{p.name}</span>
              <span className="shrink-0 font-mono text-xs text-ink-2">{formatBytes(p.size)}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
