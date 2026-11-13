"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { saveBlob, uploadForm } from "@/lib/files";
import { ACCEPT_ALL, FAMILIES, FAMILY_ORDER, familyOf, MAX_FILES, MAX_MB, parseJobInfo, type Family, type JobInfo } from "@/lib/file-tools";
import { formatBytes } from "@/lib/media";
import { getTool, stepsFor, toolHref } from "@/lib/tools";
import { AudioPreview } from "../audio-preview";
import { FileDrop } from "../file-drop";
import { isBusy, ProgressButton, type Job } from "../progress-button";
import { Workbench } from "../workbench";
import { Chips, Notice, Panel, Row, Toggle } from "../pdf/kit";
import { messageOf, swap } from "../pdf/parts";
import { ResultPanel, type TaskResult } from "../pdf/task";
import { FileStack, toItems, type Item } from "./kit";

const ENDPOINT = "/api/tools/merge-split/merge";
const AUDIO_OUT = ["mp3", "m4a", "wav", "flac"] as const;
type AudioOut = (typeof AUDIO_OUT)[number];

/** What each family's merge keeps, in a line. */
const WHAT: Record<Family, string> = {
  pdf: "Pages are joined in the order above. Links and bookmarks inside each PDF keep working.",
  word: "Styles, pictures, tables, lists and footnotes are kept. Each document keeps its own look.",
  slides: "Every deck keeps its own design, layouts and speaker notes, like PowerPoint's “Keep source formatting”.",
  sheet: "Values, formulas and formatting come across; charts and macros don't.",
  audio: "Joined end to end, without gaps, in the format you pick.",
  video: "Clips of the same format and size are joined in seconds, untouched. Mixed clips are re-encoded to match the first.",
};

export function MergeFilesTool({ toolId }: { toolId: string }) {
  const tool = getTool(toolId)!;
  const [items, setItems] = useState<Item[]>([]);
  const [rejected, setRejected] = useState<string | null>(null);
  const [pageBreaks, setPageBreaks] = useState(true);
  const [sheetMode, setSheetMode] = useState<"sheets" | "stack">("sheets");
  const [sourceColumn, setSourceColumn] = useState(true);
  const [sheetOut, setSheetOut] = useState<"xlsx" | "csv">("xlsx");
  const [audioOut, setAudioOut] = useState<AudioOut | null>(null);
  const [job, setJob] = useState<Job>({ kind: "ready" });
  const [result, setResult] = useState<(TaskResult & { meta: JobInfo }) | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => (result ? () => URL.revokeObjectURL(result.url) : undefined), [result]);

  const family = items.length ? familyOf(items[0].file.name) : null;
  const meta = family ? FAMILIES[family] : null;
  const busy = isBusy(job);
  const total = items.reduce((n, i) => n + i.file.size, 0);
  const firstExt = items[0]?.file.name.split(".").pop()?.toLowerCase() ?? "";
  const audioTarget: AudioOut = audioOut ?? ((AUDIO_OUT as readonly string[]).includes(firstExt) ? (firstExt as AudioOut) : "mp3");

  const reset = () => {
    abortRef.current?.abort();
    setResult(null);
    setJob({ kind: "ready" });
  };

  const add = (files: File[]) => {
    reset();
    const fam = family ?? familyOf(files.find((f) => familyOf(f.name))?.name ?? "");
    if (!fam) return setRejected("Those files can't be merged. Add Word, PowerPoint, Excel, CSV, PDF, audio or video files.");
    const fit = files.filter((f) => familyOf(f.name) === fam && f.size > 0);
    const room = MAX_FILES - items.length;
    const next = [...items, ...toItems(fit.slice(0, room))];
    const size = next.reduce((n, i) => n + i.file.size, 0);
    if (size > MAX_MB * 1024 * 1024) return setRejected(`Together the files would be over ${MAX_MB} MB.`);
    const skipped = files.length - Math.min(fit.length, room);
    setRejected(
      skipped
        ? fit.length > room
          ? `Merge up to ${MAX_FILES} files at a time; ${skipped} weren't added.`
          : `${skipped === 1 ? "One file wasn't" : `${skipped} files weren't`} added: merge ${FAMILIES[fam].many} with ${FAMILIES[fam].many} only.`
        : null,
    );
    setItems(next);
  };

  const start = async () => {
    if (!family || items.length < 2) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const form = new FormData();
    for (const it of items) form.append("files", it.file, it.file.name);
    const options: Record<string, unknown> = {};
    if (family === "word") options.page_breaks = pageBreaks;
    if (family === "sheet") {
      options.mode = sheetMode;
      if (sheetMode === "stack") Object.assign(options, { source_column: sourceColumn, output: sheetOut });
    }
    if (family === "audio") options.output = audioTarget;
    form.append("options", JSON.stringify(options));
    setJob({ kind: "uploading", progress: 0 });
    try {
      const out = await uploadForm(ENDPOINT, form, {
        signal: ctrl.signal,
        fallbackName: "merged",
        onUpload: (p) => setJob(p >= 1 ? { kind: "processing" } : { kind: "uploading", progress: p }),
        onProcessing: () => setJob({ kind: "processing" }),
      });
      setResult({ ...out, url: URL.createObjectURL(out.blob), saved: false, parts: null, meta: parseJobInfo(out.info) });
      setJob({ kind: "ready" });
    } catch (e) {
      if (ctrl.signal.aborted) return setJob({ kind: "ready" });
      setJob({ kind: "failed", message: messageOf(e) });
    }
  };

  const step = !items.length ? 0 : !result ? 1 : result.saved ? 3 : 2;
  const accept = family ? meta!.exts.map((e) => `.${e}`).join(",") : ACCEPT_ALL;

  return (
    <Workbench
      steps={stepsFor(tool)}
      current={step}
      footer={<>Your files are merged on our server and deleted as soon as the result is sent. Nothing is kept, and it&apos;s free.</>}
    >
      <div className="space-y-3 p-3 sm:p-4">
        {!items.length ? (
          <>
            <FileDrop
              multiple
              accept={ACCEPT_ALL}
              title="Drop the files to merge"
              formats={`Word, PowerPoint, Excel, CSV, PDF, audio or video · up to ${MAX_FILES} files, ${MAX_MB} MB`}
              error={rejected}
              onFiles={add}
            />
            <FamilyStrip />
          </>
        ) : (
          <FileStack
            items={items}
            locked={busy}
            accept={accept}
            error={rejected}
            title="Merge order"
            addTitle={`Add more ${meta!.many}`}
            addFormats={`Up to ${MAX_FILES - items.length} more · ${formatBytes(Math.max(0, MAX_MB * 1024 * 1024 - total))} left`}
            canAdd={items.length < MAX_FILES}
            meta={() => meta!.label}
            onChange={(next) => (reset(), setItems(next), next.length || setRejected(null))}
            onAdd={add}
          />
        )}

        {family && (
          <AnimatePresence mode="wait" initial={false}>
            {result ? (
              <motion.div key="result" {...swap}>
                <ResultPanel
                  result={result}
                  kindLabel={result.name.split(".").pop()?.toUpperCase()}
                  backLabel="Change the files"
                  onBack={reset}
                  onSave={() => {
                    saveBlob(result.blob, result.name);
                    setResult({ ...result, saved: true });
                  }}
                  note={result.meta.notes.join(" ") || undefined}
                >
                  {family === "audio" && (
                    <div className="mt-3">
                      <AudioPreview src={result.url} blob={result.blob} />
                    </div>
                  )}
                  {family === "video" && /\.(mp4|webm)$/i.test(result.name) && (
                    <video src={result.url} controls preload="metadata" className="mt-3 max-h-[min(60vh,480px)] w-full rounded-sm border border-line bg-ink" />
                  )}
                </ResultPanel>
              </motion.div>
            ) : (
              <motion.div key="options" {...swap} className="space-y-3">
                <Panel>
                  <Row label="You'll get">
                    <p className="text-sm text-ink">
                      One {family === "sheet" ? (sheetMode === "stack" ? sheetOut.toUpperCase() : "XLSX") : family === "audio" ? audioTarget.toUpperCase() : family === "video" ? (firstExt === "mkv" ? "MKV" : "MP4") : family === "word" ? "DOCX" : family === "slides" ? "PPTX" : "PDF"}
                      {items.length >= 2 ? `, ${items.length} files in this order` : ""}
                    </p>
                    <p className="mt-1.5 text-xs leading-relaxed text-ink-3">{WHAT[family]}</p>
                  </Row>
                  {family === "word" && (
                    <Row label="Layout">
                      <Toggle
                        checked={pageBreaks}
                        onChange={setPageBreaks}
                        disabled={busy}
                        label="Start each document on a new page"
                        description="Off: each document carries straight on after the one before."
                      />
                    </Row>
                  )}
                  {family === "sheet" && (
                    <>
                      <Row label="How">
                        <Chips
                          value={sheetMode}
                          onChange={(v) => (reset(), setSheetMode(v))}
                          disabled={busy}
                          options={[
                            { value: "sheets", label: "Every sheet, side by side" },
                            { value: "stack", label: "Stack the rows into one sheet" },
                          ]}
                        />
                        <p className="mt-2 text-xs leading-relaxed text-ink-3">
                          {sheetMode === "sheets"
                            ? "One workbook with a tab for every sheet of every file, formatting kept."
                            : "Rows from every file one under another; columns are matched by their heading, in any order."}
                        </p>
                      </Row>
                      {sheetMode === "stack" && (
                        <>
                          <Row label="Source">
                            <Toggle
                              checked={sourceColumn}
                              onChange={setSourceColumn}
                              disabled={busy}
                              label="Add a “Source file” column"
                              description="Says which file each row came from."
                            />
                          </Row>
                          <Row label="Save as">
                            <Chips
                              value={sheetOut}
                              onChange={setSheetOut}
                              disabled={busy}
                              options={[
                                { value: "xlsx", label: "Excel · XLSX" },
                                { value: "csv", label: "CSV" },
                              ]}
                            />
                          </Row>
                        </>
                      )}
                    </>
                  )}
                  {family === "audio" && (
                    <Row label="Save as">
                      <Chips
                        value={audioTarget}
                        onChange={setAudioOut}
                        disabled={busy}
                        options={AUDIO_OUT.map((f) => ({ value: f, label: f.toUpperCase() }))}
                      />
                    </Row>
                  )}
                </Panel>
                {family === "pdf" && (
                  <Notice>
                    Want to pick pages or see thumbnails?{" "}
                    <Link href={toolHref("merge-pdf")} className="underline underline-offset-4 hover:text-ink">
                      Merge PDF
                    </Link>{" "}
                    does the same with a page preview.
                  </Notice>
                )}
                <ProgressButton
                  job={job}
                  disabled={items.length < 2}
                  label={items.length < 2 ? `Add another ${meta!.one}` : `Merge ${items.length} ${meta!.many}`}
                  working="Merging…"
                  hint={items.length < 2 ? `Add at least one more ${meta!.one} to merge.` : "Drag the files, or use the arrows, to set the order."}
                  workingHint={
                    family === "video"
                      ? "Clips that need re-encoding take a few minutes on our free server. Keep this tab open."
                      : family === "word" || family === "slides" || family === "sheet"
                        ? "Older formats (DOC, PPT, XLS, ODF) are opened in LibreOffice first; that takes a few seconds each."
                        : undefined
                  }
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

/** Before anything is added: the six kinds that merge, so people know what works. */
export function FamilyStrip() {
  return (
    <ul className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-3 lg:grid-cols-6">
      {FAMILY_ORDER.map((f) => {
        const { icon: Icon, label, exts } = FAMILIES[f];
        return (
          <li key={f} className="bg-surface px-3 py-2.5">
            <p className="flex items-center gap-2 text-sm font-medium text-ink">
              <Icon aria-hidden className="size-4 text-ink-2" />
              {label}
            </p>
            <p className="mt-1 truncate font-mono text-[12px] tracking-[0.06em] text-ink-3" title={exts.join(", ").toUpperCase()}>
              {exts.slice(0, 4).join(" ").toUpperCase()}
              {exts.length > 4 ? " …" : ""}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
