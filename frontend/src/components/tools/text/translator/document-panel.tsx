"use client";

import { useEffect, useRef, useState } from "react";
import { Download, FileCheck2, FileText, Loader2, RotateCcw, X } from "lucide-react";
import { FileToolError, saveBlob } from "@/lib/files";
import { formatBytes, languageLabel, type TranslateLanguage } from "@/lib/translate";
import { loadGlossary } from "@/lib/translate-extras";
import { CONVERT_FIRST, DOC_ACCEPT, DOC_EXTENSIONS, extOf, translateDocument, type DocOutput, type DocProgress, type TranslatedDoc } from "@/lib/translate-docs";
import { cn } from "@/lib/utils";
import { FileDrop } from "../../file-drop";
import { Chips, Notice, Panel, Row } from "../../pdf/kit";
import { btn, bx, primaryBtn, ProgressBar } from "./shared";

const MAX_MB = 50;

type Job = { file: File; state: "waiting" | "working" | "done" | "failed"; progress?: DocProgress; result?: TranslatedDoc; error?: string };

const PHASE: Record<DocProgress["phase"], string> = {
  converting: "Converting on the server first…",
  reading: "Reading the document…",
  translating: "Translating",
  building: "Rebuilding the file with the same layout…",
};

export function DocumentPanel({
  source,
  target,
  languages,
  isRtl,
}: {
  source: string;
  target: string;
  languages: TranslateLanguage[];
  isRtl: (code: string) => boolean;
}) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [output, setOutput] = useState<DocOutput>("translated");
  const [running, setRunning] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [previewIdx, setPreviewIdx] = useState(0);
  const ctrl = useRef<AbortController | null>(null);

  useEffect(() => () => ctrl.current?.abort(), []);

  const addFiles = (files: File[]) => {
    setProblem(null);
    const ok: Job[] = [];
    for (const f of files) {
      const ext = extOf(f.name);
      if (!DOC_EXTENSIONS[ext] && !CONVERT_FIRST[ext]) {
        setProblem(`“${f.name}” isn't a supported document.`);
        continue;
      }
      if (f.size > MAX_MB * 1024 * 1024) {
        setProblem(`“${f.name}” is over ${MAX_MB} MB.`);
        continue;
      }
      ok.push({ file: f, state: "waiting" });
    }
    setJobs((j) => [...j.filter((x) => x.state !== "done" || running), ...ok].slice(0, 10));
  };

  const runAll = async () => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setRunning(true);
    const glossary = loadGlossary();
    const list = jobs.map((j) => (j.state === "done" ? j : { ...j, state: "waiting" as const, error: undefined }));
    setJobs(list);
    for (let i = 0; i < list.length; i++) {
      if (c.signal.aborted) break;
      if (list[i].state === "done") continue;
      setJobs((js) => js.map((j, k) => (k === i ? { ...j, state: "working" } : j)));
      try {
        const result = await translateDocument(list[i].file, {
          source,
          target,
          output,
          rtl: isRtl(target),
          glossary,
          signal: c.signal,
          onProgress: (progress) => setJobs((js) => js.map((j, k) => (k === i ? { ...j, progress } : j))),
        });
        setJobs((js) => js.map((j, k) => (k === i ? { ...j, state: "done", result } : j)));
        setPreviewIdx(i);
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") {
          setJobs((js) => js.map((j, k) => (k === i ? { ...j, state: "waiting", progress: undefined } : j)));
          break;
        }
        const msg = e instanceof FileToolError || e instanceof Error ? e.message : "That document couldn't be translated.";
        setJobs((js) => js.map((j, k) => (k === i ? { ...j, state: "failed", error: msg } : j)));
      }
    }
    setRunning(false);
  };

  const preview = jobs[previewIdx]?.result;
  const pending = jobs.some((j) => j.state !== "done");

  return (
    <div className="space-y-4">
      {jobs.length === 0 ? (
        <FileDrop
          accept={DOC_ACCEPT}
          multiple
          title="Drop documents to translate, keeping their layout"
          formats="DOCX · PPTX · XLSX · PDF · ODT/ODP/ODS · EPUB · HTML · MD · TXT · CSV · JSON · PO · XLIFF · SRT/VTT · up to 50 MB"
          error={problem}
          onFiles={addFiles}
        />
      ) : (
        <>
          <ul className="divide-y divide-line rounded-md border border-line">
            {jobs.map((j, i) => {
              const p = j.progress;
              const frac = p ? (p.phase === "translating" ? (p.total ? p.done / p.total : 0) : p.phase === "building" ? 1 : null) : null;
              return (
                <li key={`${j.file.name}-${i}`} className={cn("space-y-2 px-3.5 py-3", previewIdx === i && j.result && "bg-paper/50")}>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-sm border border-line bg-surface">
                      {j.state === "done" ? <FileCheck2 aria-hidden className="size-4 text-success" /> : <FileText aria-hidden className="size-4 text-ink-3" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">{j.file.name}</p>
                      <p className="font-mono text-xs text-ink-3">
                        {extOf(j.file.name).toUpperCase()} · {formatBytes(j.file.size)}
                        {CONVERT_FIRST[extOf(j.file.name)] && ` · ${CONVERT_FIRST[extOf(j.file.name)].label} first`}
                        {j.result && ` · ${j.result.segments.toLocaleString()} passages · from ${languageLabel(j.result.detected, languages)}`}
                      </p>
                    </div>
                    {j.result && (
                      <div className="flex items-center gap-1.5">
                        <button type="button" className={btn} onClick={() => setPreviewIdx(i)}>Preview</button>
                        <button type="button" className={bx("on")} onClick={() => saveBlob(j.result!.blob, j.result!.name)}>
                          <Download aria-hidden className="size-3.5" /> {j.result.name.split(".").pop()?.toUpperCase()}
                        </button>
                      </div>
                    )}
                    {!running && j.state !== "done" && (
                      <button type="button" aria-label={`Remove ${j.file.name}`} className={btn} onClick={() => setJobs((js) => js.filter((_, k) => k !== i))}>
                        <X aria-hidden className="size-3.5" />
                      </button>
                    )}
                  </div>
                  {j.state === "working" && (
                    <ProgressBar value={frac} label={p ? (p.phase === "translating" ? `${PHASE.translating} ${p.done.toLocaleString()} of ${p.total.toLocaleString()} passages…` : PHASE[p.phase]) : "Starting…"} />
                  )}
                  {j.state === "failed" && <p className="text-xs text-danger">{j.error}</p>}
                </li>
              );
            })}
          </ul>
          {!running && <FileDrop compact multiple accept={DOC_ACCEPT} title="Add more documents" formats="Up to 10 at a time" onFiles={addFiles} />}
          {problem && <Notice tone="warning">{problem}</Notice>}
        </>
      )}

      <Panel>
        <Row label="Output" hint="Bilingual keeps the original and adds the translation after each paragraph, slide line or cell — great for checking and learning.">
          <Chips
            label="Output"
            value={output}
            onChange={setOutput}
            disabled={running}
            options={[
              { value: "translated", label: "Translation only" },
              { value: "bilingual", label: "Bilingual (original + translation)" },
            ]}
          />
        </Row>
      </Panel>

      <div className="flex flex-wrap items-center gap-2.5">
        {running ? (
          <button type="button" className={primaryBtn} onClick={() => ctrl.current?.abort()}>
            <Loader2 aria-hidden className="size-4 animate-spin" /> Cancel
          </button>
        ) : (
          <button type="button" className={primaryBtn} disabled={!jobs.length || !pending} onClick={runAll}>
            Translate {jobs.filter((j) => j.state !== "done").length || ""} document{jobs.length === 1 ? "" : "s"} to {languageLabel(target, languages)}
          </button>
        )}
        {!running && jobs.length > 0 && (
          <button type="button" className={bx("idle", "lg")} onClick={() => { setJobs([]); setProblem(null); }}>
            <RotateCcw aria-hidden className="size-4" /> Start over
          </button>
        )}
        {!running && jobs.some((j) => j.state === "done") && !pending && (
          <button type="button" className={bx("idle", "lg")} onClick={() => setJobs((js) => js.map((j) => ({ ...j, state: "waiting", result: undefined, progress: undefined })))}>
            Translate again (new language or output)
          </button>
        )}
      </div>

      <p className="text-xs leading-relaxed text-ink-3">
        Text is translated in your browser’s session through our free engines; the file itself never leaves your device
        (PDF, DOC, PPT, XLS and RTF are converted on our server first, then deleted). Your glossary is applied. Formatting is
        kept paragraph by paragraph: each paragraph takes the style of its first word.
      </p>

      {preview && (
        <section aria-label="Preview" className="rounded-md border border-line">
          <div className="flex items-center justify-between border-b border-line px-3.5 py-2">
            <span className="label-mono text-ink-3">Preview · first {Math.min(preview.pairs.length, 400)} passages of {preview.name}</span>
          </div>
          <ol className="max-h-96 divide-y divide-line overflow-y-auto text-sm">
            {preview.pairs.slice(0, 400).map((p, i) => (
              <li key={i} className="grid gap-1 px-3.5 py-2 sm:grid-cols-2 sm:gap-4">
                <span className="whitespace-pre-wrap text-ink-2" dir="auto">{p.source}</span>
                <span className="whitespace-pre-wrap text-ink" dir={isRtl(target) ? "rtl" : "auto"}>{p.translated}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
