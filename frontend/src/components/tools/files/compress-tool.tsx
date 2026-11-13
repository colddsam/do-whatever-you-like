"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, ArrowRight, Check } from "lucide-react";
import { saveBlob, uploadForm } from "@/lib/files";
import { extOf, MAX_FILES, MAX_MB } from "@/lib/file-tools";
import { formatBytes } from "@/lib/media";
import { getTool, stepsFor, toolHref } from "@/lib/tools";
import { cn } from "@/lib/utils";
import { FileDrop } from "../file-drop";
import { isBusy, ProgressButton, type Job } from "../progress-button";
import { Workbench } from "../workbench";
import { Notice, Panel, Row } from "../pdf/kit";
import { EASE, messageOf, plural, swap } from "../pdf/parts";
import { ResultPanel, type TaskResult } from "../pdf/task";
import { FileStack, toItems, type Item } from "./kit";

const ENDPOINT = "/api/tools/compress";

type Level = "light" | "recommended" | "strong";
const LEVELS: { value: Level; title: string; body: string }[] = [
  { value: "light", title: "Light", body: "No visible change. WAV becomes lossless FLAC." },
  { value: "recommended", title: "Recommended", body: "Much smaller, looks and sounds the same." },
  { value: "strong", title: "Strong", body: "Smallest. Big pictures and videos are scaled down." },
];

/** What happens to each kind of file, in a few words (mirrors backend/app/services/compress/engines.py). */
const KINDS: [RegExp, string][] = [
  [/^pdf$/, "PDF · pictures re-encoded"],
  [/^(jpe?g|png|gif|webp|svg)$/, "Picture · re-encoded"],
  [/^(heic|heif|avif|tiff?)$/, "Photo · same format"],
  [/^(bmp|psd|dng|cr2|cr3|nef|arw|orf|rw2|raf)$/, "Picture · to JPG or PNG"],
  [/^(docx|docm|dotx|xlsx|xlsm|pptx|pptm|ppsx|odt|ods|odp|odg|epub|vsdx)$/, "Document · pictures inside shrunk"],
  [/^(mp3|m4a|aac|ogg|oga|opus|weba|wma)$/, "Audio · lower bitrate"],
  [/^(wav|aiff?|flac)$/, "Audio · to FLAC or MP3"],
  [/^(mp4|mov|m4v|mkv|avi|wmv|flv|webm|3gp|mpeg|mpg|mts|m2ts|ogv)$/, "Video · H.264"],
  [/^(ttf|otf|woff)$/, "Font · to WOFF2"],
  [/^(zip|gz|tgz|tar)$/, "Archive · repacked"],
  [/^(json|geojson|webmanifest)$/, "Data · minified"],
  [/^(7z|rar|xz|bz2|zst|br|woff2|apk|jar|dmg|iso|amr|jxl)$/, "Already compressed"],
];
const kindOf = (name: string) => KINDS.find(([re]) => re.test(extOf(name)))?.[1] ?? "Zipped";

type FileReport = { name: string; kind: string; before: number; after?: number; output?: string; note?: string | null; error?: string };
type Report = { files: FileReport[]; before: number; after: number };

function parseReport(raw?: string): Report | null {
  try {
    const v = JSON.parse(raw ?? "") as Partial<Report>;
    return Array.isArray(v.files) ? { files: v.files, before: v.before ?? 0, after: v.after ?? 0 } : null;
  } catch {
    return null;
  }
}

export function CompressFilesTool({ toolId }: { toolId: string }) {
  const tool = getTool(toolId)!;
  const [items, setItems] = useState<Item[]>([]);
  const [rejected, setRejected] = useState<string | null>(null);
  const [level, setLevel] = useState<Level>("recommended");
  const [job, setJob] = useState<Job>({ kind: "ready" });
  const [result, setResult] = useState<(TaskResult & { report: Report | null }) | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => (result ? () => URL.revokeObjectURL(result.url) : undefined), [result]);

  const busy = isBusy(job);
  const total = items.reduce((n, i) => n + i.file.size, 0);
  const reset = () => {
    abortRef.current?.abort();
    setResult(null);
    setJob({ kind: "ready" });
  };

  const add = (files: File[]) => {
    reset();
    const usable = files.filter((f) => f.size > 0);
    const room = MAX_FILES - items.length;
    const next = [...items, ...toItems(usable.slice(0, room))];
    if (next.reduce((n, i) => n + i.file.size, 0) > MAX_MB * 1024 * 1024) return setRejected(`Together the files would be over ${MAX_MB} MB.`);
    setRejected(
      usable.length > room ? `Compress up to ${MAX_FILES} files at a time; ${usable.length - room} weren't added.` : usable.length < files.length ? "Empty files were left out." : null,
    );
    setItems(next);
  };

  const start = async () => {
    if (!items.length) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const form = new FormData();
    for (const it of items) form.append("files", it.file, it.file.name);
    form.append("level", level);
    setJob({ kind: "uploading", progress: 0 });
    try {
      const out = await uploadForm(ENDPOINT, form, {
        signal: ctrl.signal,
        fallbackName: items.length === 1 ? items[0].file.name : "compressed.zip",
        onUpload: (p) => setJob(p >= 1 ? { kind: "processing" } : { kind: "uploading", progress: p }),
        onProcessing: () => setJob({ kind: "processing" }),
      });
      setResult({ ...out, url: URL.createObjectURL(out.blob), saved: false, parts: null, report: parseReport(out.info) });
      setJob({ kind: "ready" });
    } catch (e) {
      if (ctrl.signal.aborted) return setJob({ kind: "ready" });
      setJob({ kind: "failed", message: messageOf(e) });
    }
  };

  const step = !items.length ? 0 : !result ? 1 : result.saved ? 3 : 2;
  const exts = new Set(items.map((i) => extOf(i.file.name)));
  const onlyPdf = items.length > 0 && [...exts].every((e) => e === "pdf");
  const onlyImages = items.length > 0 && [...exts].every((e) => /^(jpe?g|png|gif|webp|svg)$/.test(e));
  const hasVideo = items.some((i) => /^(mp4|mov|m4v|mkv|avi|wmv|flv|webm|3gp|mpeg|mpg|mts|m2ts|ogv)$/.test(extOf(i.file.name)));

  return (
    <Workbench
      steps={stepsFor(tool)}
      current={step}
      footer={<>Your files are compressed on our server and deleted as soon as the result is sent. Nothing is kept, and it&apos;s free.</>}
    >
      <div className="space-y-3 p-3 sm:p-4">
        {!items.length ? (
          <FileDrop
            multiple
            accept=""
            title="Drop the files to compress"
            formats={`Any file: PDF, Word, PowerPoint, Excel, photos, audio, video, fonts… · up to ${MAX_FILES} files, ${MAX_MB} MB`}
            error={rejected}
            onFiles={add}
          />
        ) : (
          <FileStack
            items={items}
            locked={busy}
            accept=""
            error={rejected}
            title="To compress"
            addTitle="Add more files"
            addFormats={`Any kind · up to ${MAX_FILES - items.length} more`}
            canAdd={items.length < MAX_FILES}
            sortable={false}
            meta={(it) => kindOf(it.file.name)}
            onChange={(next) => (reset(), setItems(next), next.length || setRejected(null))}
            onAdd={add}
          />
        )}

        {items.length > 0 && (
          <AnimatePresence mode="wait" initial={false}>
            {result ? (
              <motion.div key="result" {...swap}>
                <ResultPanel
                  result={result}
                  kindLabel={result.name.split(".").pop()?.toUpperCase()}
                  backLabel="Try another strength"
                  onBack={reset}
                  onSave={() => {
                    saveBlob(result.blob, result.name);
                    setResult({ ...result, saved: true });
                  }}
                >
                  {result.report && <Savings report={result.report} />}
                </ResultPanel>
              </motion.div>
            ) : (
              <motion.div key="options" {...swap} className="space-y-3">
                <Panel>
                  <Row label="Strength">
                    <div role="radiogroup" aria-label="Strength" className="grid gap-1.5 sm:grid-cols-3">
                      {LEVELS.map((l) => {
                        const on = level === l.value;
                        return (
                          <button
                            key={l.value}
                            type="button"
                            role="radio"
                            aria-checked={on}
                            disabled={busy}
                            onClick={() => setLevel(l.value)}
                            className={cn(
                              "rounded-md border px-3 py-2.5 text-left transition-colors duration-150 disabled:opacity-60",
                              on ? "border-ink bg-ink text-paper" : "border-line bg-surface text-ink hover:border-ink-3",
                            )}
                          >
                            <span className="block text-sm font-medium">{l.title}</span>
                            <span className={cn("mt-0.5 block text-xs leading-relaxed", on ? "text-paper-dim" : "text-ink-3")}>{l.body}</span>
                          </button>
                        );
                      })}
                    </div>
                  </Row>
                </Panel>
                {(onlyPdf || onlyImages) && (
                  <Notice>
                    Want to see the size before you compress?{" "}
                    <Link href={toolHref(onlyPdf ? "compress-pdf" : "compress-image")} className="underline underline-offset-4 hover:text-ink">
                      {onlyPdf ? "Compress PDF" : "Compress image"}
                    </Link>{" "}
                    predicts it as you slide.
                  </Notice>
                )}
                <ProgressButton
                  job={job}
                  label={`Compress ${plural(items.length, "file")}`}
                  working="Compressing…"
                  hint={`${formatBytes(total)} in all. Anything that can't get smaller comes back unchanged.`}
                  workingHint={hasVideo ? "Videos are re-encoded, which takes a few minutes on our free server. Keep this tab open." : undefined}
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

/** Before → after for every file, with the change as a bar; failures say why. */
function Savings({ report }: { report: Report }) {
  const saved = report.before - report.after;
  const pct = report.before ? Math.round((saved / report.before) * 100) : 0;
  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="label-mono text-ink-3">Saved</p>
        <p className="font-mono text-sm text-ink">
          {formatBytes(report.before)} <ArrowRight aria-hidden className="inline size-3.5 text-ink-3" /> {formatBytes(report.after)}
          <span className={cn("ml-2", pct > 0 ? "text-success" : "text-ink-3")}>{pct > 0 ? `−${pct}%` : "no change"}</span>
        </p>
      </div>
      <ol className="mt-2 divide-y divide-line border-y border-line">
        {report.files.map((f, i) => {
          const ratio = f.after !== undefined && f.before ? f.after / f.before : 1;
          return (
            <li key={`${f.name}-${i}`} className="py-2.5">
              <div className="flex items-center gap-3">
                {f.error ? <AlertTriangle aria-hidden className="size-4 shrink-0 text-danger" /> : <Check aria-hidden className="size-4 shrink-0 text-success" />}
                <span className="min-w-0 flex-1 truncate text-sm text-ink" title={f.output ?? f.name}>
                  {f.output && f.output !== f.name ? (
                    <>
                      {f.name} <ArrowRight aria-hidden className="inline size-3 text-ink-3" /> {f.output}
                    </>
                  ) : (
                    f.name
                  )}
                </span>
                {f.after !== undefined && (
                  <span className="shrink-0 font-mono text-xs text-ink-2">
                    {formatBytes(f.after)}
                    {ratio < 1 && <span className="ml-1.5 text-success">−{Math.round((1 - ratio) * 100)}%</span>}
                  </span>
                )}
              </div>
              {f.after !== undefined && (
                <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-paper-2" aria-hidden>
                  <motion.span
                    className="block h-full rounded-full bg-ink"
                    initial={{ width: "100%" }}
                    animate={{ width: `${Math.max(2, ratio * 100)}%` }}
                    transition={{ duration: 0.6, ease: EASE, delay: 0.1 + i * 0.04 }}
                  />
                </span>
              )}
              {(f.error || f.note) && <p className={cn("mt-1 pl-7 text-xs", f.error ? "text-danger" : "text-ink-3")}>{f.error ?? f.note}</p>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
