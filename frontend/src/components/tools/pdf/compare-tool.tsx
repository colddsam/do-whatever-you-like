"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, Download, Loader2 } from "lucide-react";
import { formatBytes } from "@/lib/media";
import { checkFile, postFormJson, saveBlob, uploadForm } from "@/lib/files";
import { PDF_MAX_MB } from "@/lib/pdf";
import { getTool, stepsFor } from "@/lib/tools";
import { cn } from "@/lib/utils";
import { FileDrop } from "../file-drop";
import { isBusy, ProgressButton, type Job } from "../progress-button";
import { Workbench } from "../workbench";
import { Notice } from "./kit";
import { boxStyle, PageNav, PageView, type Box } from "./page-stage";
import { DocRow, expired, isReady, messageOf, plural, swap } from "./parts";
import { usePdfUpload } from "./task";

type Mark = { page: number; box: Box };
type Change = { type: "insert" | "delete" | "replace"; old: string; new: string; old_marks: Mark[]; new_marks: Mark[] };
type Comparison = {
  similarity: number;
  counts: { insert: number; delete: number; replace: number };
  total: number;
  truncated: boolean;
  pages: { old: number; new: number };
  changes: Change[];
};

// Marks on the pages are the document's own colours (red removed, green added), as in any diff.
const RED = "rgba(220, 38, 38, 0.28)";
const GREEN = "rgba(22, 163, 74, 0.28)";

export function CompareTool({ toolId }: { toolId: string }) {
  const tool = getTool(toolId)!;
  const a = usePdfUpload();
  const b = usePdfUpload();
  const [rejected, setRejected] = useState<{ side: "a" | "b"; text: string } | null>(null);
  const [job, setJob] = useState<Job>({ kind: "ready" });
  const [result, setResult] = useState<Comparison | null>(null);
  const [active, setActive] = useState(0);
  const [report, setReport] = useState<{ state: "idle" | "making" | "saved"; error?: string; size?: number }>({ state: "idle" });
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);
  const busy = isBusy(job);
  const ready = isReady(a.doc) && isReady(b.doc);

  const reset = () => {
    abortRef.current?.abort();
    setResult(null);
    setJob({ kind: "ready" });
    setReport({ state: "idle" });
    setActive(0);
  };
  const pick = (side: "a" | "b") => (f: File) => {
    const problem = checkFile(f, [".pdf"], PDF_MAX_MB);
    setRejected(problem ? { side, text: problem } : null);
    if (problem) return;
    reset();
    (side === "a" ? a : b).pick(f);
  };

  const tokens = async () => {
    // Re-upload either PDF if the server has forgotten it.
    const ta = isReady(a.doc) ? a.doc.upload.token : await a.upload(a.doc!);
    const tb = isReady(b.doc) ? b.doc.upload.token : await b.upload(b.doc!);
    return [ta, tb] as const;
  };
  const form = (ta: string, tb: string) => {
    const f = new FormData();
    f.append("token_old", ta);
    f.append("token_new", tb);
    return f;
  };

  const start = async () => {
    if (!ready) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setJob({ kind: "processing" });
    try {
      let res: Comparison;
      try {
        const [ta, tb] = await tokens();
        res = await postFormJson<Comparison>("/api/tools/pdf/compare", form(ta, tb), { signal: ctrl.signal });
      } catch (e) {
        if (!expired(e)) throw e;
        const [ta, tb] = [await a.upload(a.doc!), await b.upload(b.doc!)];
        res = await postFormJson<Comparison>("/api/tools/pdf/compare", form(ta, tb), { signal: ctrl.signal });
      }
      setResult(res);
      setActive(0);
      setJob({ kind: "ready" });
    } catch (e) {
      if (ctrl.signal.aborted) return setJob({ kind: "ready" });
      setJob({ kind: "failed", message: messageOf(e) });
    }
  };

  const downloadReport = async () => {
    setReport({ state: "making" });
    try {
      const [ta, tb] = await tokens();
      const out = await uploadForm("/api/tools/pdf/compare-report", form(ta, tb), { fallbackName: "comparison.pdf" });
      saveBlob(out.blob, out.name);
      setReport({ state: "saved", size: out.size });
    } catch (e) {
      setReport({ state: "idle", error: messageOf(e) });
    }
  };

  const step = !ready ? 0 : !result ? 1 : report.state === "saved" ? 3 : 2;

  return (
    <Workbench
      steps={stepsFor(tool)}
      current={step}
      footer={<>Both PDFs are kept on our server for 30 minutes after you last use them, then deleted.</>}
    >
      <div className="space-y-3 p-3 sm:p-4">
        <div className="grid gap-3 md:grid-cols-2">
          {(["a", "b"] as const).map((side) => {
            const up = side === "a" ? a : b;
            return (
              <div key={side}>
                <p className="label-mono mb-2 px-1 text-ink-3">{side === "a" ? "Original" : "Changed version"}</p>
                {up.doc ? (
                  <DocRow doc={up.doc} locked={busy} accept=".pdf,application/pdf" onReplace={pick(side)} onClear={() => (reset(), up.clear())} onRetry={up.retry} />
                ) : (
                  <FileDrop accept=".pdf,application/pdf" title={side === "a" ? "Drop the original" : "Drop the new version"} formats={`PDF · up to ${PDF_MAX_MB} MB`} error={rejected?.side === side ? rejected.text : null} onFile={pick(side)} />
                )}
              </div>
            );
          })}
        </div>

        {a.doc && b.doc && (
          <AnimatePresence mode="wait" initial={false}>
            {result && isReady(a.doc) && isReady(b.doc) ? (
              <motion.div key="result" {...swap}>
                <Results
                  result={result}
                  active={active}
                  setActive={setActive}
                  tokens={[a.doc.upload.token, b.doc.upload.token]}
                  sizes={[a.doc.upload.sizes, b.doc.upload.sizes]}
                  report={report}
                  onReport={downloadReport}
                  onBack={reset}
                />
              </motion.div>
            ) : (
              <motion.div key="run" {...swap}>
                <ProgressButton
                  job={job}
                  disabled={!ready}
                  label="Compare the two"
                  working="Comparing word by word…"
                  hint="The text is compared word by word. Scans need OCR first."
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

function Results({
  result,
  active,
  setActive,
  tokens,
  sizes,
  report,
  onReport,
  onBack,
}: {
  result: Comparison;
  active: number;
  setActive: (i: number) => void;
  tokens: [string, string];
  sizes: [[number, number][] | undefined, [number, number][] | undefined];
  report: { state: "idle" | "making" | "saved"; error?: string; size?: number };
  onReport: () => void;
  onBack: () => void;
}) {
  const pagesOf = (c: Change | undefined, old: number, now: number) => ({
    old: c?.old_marks[0]?.page ?? c?.new_marks[0]?.page ?? old,
    now: c?.new_marks[0]?.page ?? c?.old_marks[0]?.page ?? now,
  });
  const [pageOld, setPageOld] = useState(() => pagesOf(result.changes[active], 1, 1).old);
  const [pageNew, setPageNew] = useState(() => pagesOf(result.changes[active], 1, 1).now);
  /** Choosing a change turns both pages to where it is. */
  const choose = (i: number) => {
    const p = pagesOf(result.changes[i], pageOld, pageNew);
    setActive(i);
    setPageOld(Math.min(p.old, result.pages.old));
    setPageNew(Math.min(p.now, result.pages.new));
  };
  const oldMarks = useMemo(() => result.changes.flatMap((c, i) => c.old_marks.filter((m) => m.page === pageOld).map((m) => ({ ...m, i }))), [result, pageOld]);
  const newMarks = useMemo(() => result.changes.flatMap((c, i) => c.new_marks.filter((m) => m.page === pageNew).map((m) => ({ ...m, i }))), [result, pageNew]);

  if (result.total === 0) {
    return (
      <div className="rounded-md border border-line bg-surface p-4">
        <p className="label-mono flex items-center gap-1.5 text-ink-2">
          <Check aria-hidden className="size-3.5 text-success" /> No differences
        </p>
        <p className="mt-2 text-sm text-ink-2">The text of both PDFs is identical, word for word. Layout, images and formatting aren&apos;t compared.</p>
        <button type="button" onClick={onBack} className="mt-3 inline-flex h-10 items-center rounded-md border border-line bg-surface px-4 text-sm font-medium text-ink hover:border-ink-3">
          Compare other files
        </button>
      </div>
    );
  }

  const tag = (t: Change["type"]) => ({ insert: "Added", delete: "Removed", replace: "Changed" })[t];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3 rounded-md border border-line bg-surface px-3 py-3 sm:px-4">
        <div>
          <p className="label-mono text-ink-2">{plural(result.total, "difference")}</p>
          <p className="mt-1 text-sm text-ink-2">
            {result.counts.replace} changed · {result.counts.insert} added · {result.counts.delete} removed · {result.similarity}% the same
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onReport}
            disabled={report.state === "making"}
            className="inline-flex h-10 items-center gap-2 rounded-md bg-ink px-4 text-sm font-medium text-paper transition-colors hover:bg-ink/85 disabled:opacity-60"
          >
            {report.state === "making" ? <Loader2 aria-hidden className="size-4 animate-spin" /> : report.state === "saved" ? <Check aria-hidden className="size-4" /> : <Download aria-hidden className="size-4" />}
            {report.state === "saved" ? "Report saved" : "Download the report"}
            {report.size ? <span className="font-mono text-[12px] text-paper/60">{formatBytes(report.size)}</span> : null}
          </button>
          <button type="button" onClick={onBack} className="inline-flex h-10 items-center rounded-md border border-line bg-surface px-3 text-sm text-ink hover:border-ink-3">
            Start over
          </button>
        </div>
        {report.error && <p className="w-full text-xs text-danger">{report.error}</p>}
      </div>
      {result.truncated && <Notice>Showing the first {result.changes.length} differences. The report marks all of them.</Notice>}

      <div className="grid gap-3 xl:grid-cols-[260px_minmax(0,1fr)]">
        <ol className="max-h-[min(40vh,320px)] divide-y divide-line overflow-y-auto xl:max-h-[min(70vh,640px)] overscroll-contain rounded-md border border-line bg-surface" aria-label="Differences">
          {result.changes.map((c, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => choose(i)}
                aria-current={i === active}
                className={cn("block w-full px-3 py-2.5 text-left text-sm transition-colors", i === active ? "bg-paper-2" : "hover:bg-paper")}
              >
                <span className="flex items-center gap-2">
                  <span className="font-mono text-[11px] text-ink-3">{String(i + 1).padStart(2, "0")}</span>
                  <span className={cn("label-mono", c.type === "insert" ? "text-success" : c.type === "delete" ? "text-danger" : "text-ink-2")}>{tag(c.type)}</span>
                  <span className="ml-auto font-mono text-[11px] text-ink-3">p. {c.new_marks[0]?.page ?? c.old_marks[0]?.page ?? "–"}</span>
                </span>
                {c.old && <span className="mt-1 line-clamp-2 block text-ink-3 line-through decoration-danger/60">{c.old}</span>}
                {c.new && <span className="mt-0.5 line-clamp-2 block text-ink">{c.new}</span>}
              </button>
            </li>
          ))}
        </ol>

        <div className="grid grid-cols-2 gap-2 sm:gap-3">
          {(
            [
              ["Original", tokens[0], pageOld, setPageOld, result.pages.old, oldMarks, RED, sizes[0]],
              ["Changed", tokens[1], pageNew, setPageNew, result.pages.new, newMarks, GREEN, sizes[1]],
            ] as const
          ).map(([label, token, page, setPage, pages, marks, colour, s]) => (
            <div key={label} className="min-w-0 space-y-2">
              <p className="label-mono text-ink-3">{label}</p>
              <PageView token={token} page={page} size={s?.[page - 1]}>
                {() =>
                  marks.map((m, k) => (
                    <button
                      key={k}
                      type="button"
                      aria-label={`Difference ${m.i + 1}`}
                      onClick={() => choose(m.i)}
                      className={cn("absolute rounded-[1px]", m.i === active && "ring-2 ring-ink")}
                      style={{ ...boxStyle(m.box), background: colour }}
                    />
                  ))
                }
              </PageView>
              <PageNav page={page} pages={pages} onChange={setPage} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
