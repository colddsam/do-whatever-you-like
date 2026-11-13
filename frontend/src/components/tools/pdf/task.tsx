"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, Download, Eye, EyeOff, FileText } from "lucide-react";
import { getLenis } from "@/lib/smooth-scroll";
import { formatBytes } from "@/lib/media";
import { checkFile, postFormJson, saveBlob, uploadForm, type Converted } from "@/lib/files";
import { listZip, PDF_MAX_MB, type PdfUpload, type ZipEntry } from "@/lib/pdf";
import { getTool, stepsFor } from "@/lib/tools";
import { cn } from "@/lib/utils";
import { FileDrop } from "../file-drop";
import { isBusy, ProgressButton, type Job } from "../progress-button";
import { Workbench } from "../workbench";
import { Notice } from "./kit";
import { DocRow, EASE, expired, isAbort, isReady, isZip, messageOf, nextId, PartsList, stem, swap, type Doc, type Ready } from "./parts";

/*
 * The shell every single-purpose PDF tool runs in: one input, the tool's options, one action,
 * and a result to check before saving. The tool supplies only its options and the form fields.
 */

export type Capability = "office" | "web" | "ocr" | "pdfa";
type Capabilities = Record<Capability, boolean>;

let capabilitiesRequest: Promise<Capabilities | null> | null = null;
/** Which converters the server has (LibreOffice, Chromium, Tesseract, Ghostscript). Asked once per page load. */
export function useCapability(need?: Capability): boolean | null {
  const [ok, setOk] = useState<boolean | null>(need ? null : true);
  useEffect(() => {
    if (!need) return;
    capabilitiesRequest ??= fetch("/api/tools/convert/capabilities")
      .then((r) => (r.ok ? (r.json() as Promise<Capabilities>) : null))
      .catch(() => null);
    let live = true;
    capabilitiesRequest.then((caps) => live && setOk(caps ? caps[need] : true));
    return () => {
      live = false;
    };
  }, [need]);
  return ok;
}

const CAPABILITY_TEXT: Record<Capability, string> = {
  office: "Office conversion isn't set up on this server yet. It needs LibreOffice installed next to the backend.",
  web: "Web page conversion isn't set up on this server yet. It needs Playwright's Chromium installed next to the backend.",
  ocr: "Text recognition isn't set up on this server yet. It needs Tesseract installed next to the backend.",
  pdfa: "PDF/A conversion isn't set up on this server yet. It needs Ghostscript installed next to the backend.",
};

/** One PDF, uploaded once as soon as it's added (so pages can be shown and re-used by token). */
export function usePdfUpload() {
  const [doc, setDoc] = useState<Doc | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  useEffect(() => () => ctrl.current?.abort(), []);

  const upload = useCallback(async (d: Doc): Promise<string> => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    const set = (upload: Doc["upload"]) => setDoc((cur) => (cur?.id === d.id ? { ...cur, upload } : cur));
    set({ state: "uploading", progress: 0 });
    const form = new FormData();
    form.append("file", d.file, d.file.name);
    try {
      const res = await postFormJson<PdfUpload>("/api/tools/pdf/upload", form, {
        signal: c.signal,
        onUpload: (progress) => set({ state: "uploading", progress }),
      });
      set({ state: "ready", token: res.token, pages: res.page_count, sizes: res.page_sizes });
      return res.token;
    } catch (e) {
      if (!isAbort(e)) set({ state: "failed", message: messageOf(e) });
      throw e;
    }
  }, []);

  const pick = useCallback(
    (file: File) => {
      const d: Doc = { id: nextId(), file, upload: { state: "uploading", progress: 0 } };
      setDoc(d);
      upload(d).catch(() => {});
    },
    [upload],
  );
  const clear = useCallback(() => {
    ctrl.current?.abort();
    setDoc(null);
  }, []);
  const retry = useCallback(() => {
    if (doc) upload(doc).catch(() => {});
  }, [doc, upload]);
  return { doc, pick, clear, retry, upload };
}

export type TaskResult = Converted & { url: string; saved: boolean; parts: ZipEntry[] | null };

type InputSpec =
  /** One PDF, uploaded once and referred to by token (pages can be shown). */
  | { kind: "pdf" }
  /** One PDF sent as a file with the job (locked or damaged files can't be registered). */
  | { kind: "raw-pdf" }
  /** Any other document: Word, PowerPoint, Excel, HTML. */
  | { kind: "file"; accept: string; extensions: string[]; noun: string; formats: string };

export type TaskContext = {
  /** The uploaded PDF (input kind "pdf"), once it's in. */
  doc: Ready | null;
  /** The chosen file (any input kind). */
  file: File | null;
  locked: boolean;
};

export function PdfTask({
  toolId,
  input,
  endpoint,
  label,
  working,
  fields,
  options,
  invalid,
  hint,
  dropTitle,
  needs,
  resultNote,
  resultInfo,
  backLabel = "Change options",
  footer,
}: {
  toolId: string;
  input: InputSpec;
  /** Our proxy route, e.g. "/api/tools/pdf/page-numbers". */
  endpoint: string;
  label: string | ((ctx: TaskContext) => string);
  working: string;
  /** The tool's form fields (the input itself is added by the shell). */
  fields: (ctx: TaskContext) => [string, string | Blob, string?][];
  /** The tool's options, shown once there's an input. */
  options?: (ctx: TaskContext) => React.ReactNode;
  /** Why the action can't run yet (shown under the button), or null. */
  invalid?: (ctx: TaskContext) => string | null;
  hint?: string;
  dropTitle: string;
  needs?: Capability;
  resultNote?: React.ReactNode;
  /** Turns the result's x-pdf-info JSON into a line for the result panel. */
  resultInfo?: (info: Record<string, unknown>) => React.ReactNode;
  backLabel?: string;
  footer?: React.ReactNode;
}) {
  const tool = getTool(toolId)!;
  const available = useCapability(needs);
  const pdf = usePdfUpload();
  const [raw, setRaw] = useState<File | null>(null);
  const [rejected, setRejected] = useState<string | null>(null);
  const [job, setJob] = useState<Job>({ kind: "ready" });
  const [result, setResult] = useState<TaskResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => (result ? () => URL.revokeObjectURL(result.url) : undefined), [result]);

  const busy = isBusy(job);
  const file = input.kind === "pdf" ? (pdf.doc?.file ?? null) : raw;
  const doc = isReady(pdf.doc) ? pdf.doc : null;
  const ctx: TaskContext = { doc, file, locked: busy };
  const hasInput = input.kind === "pdf" ? Boolean(doc) : Boolean(raw);
  const problem = hasInput ? (invalid?.(ctx) ?? null) : null;

  const reset = () => {
    abortRef.current?.abort();
    setResult(null);
    setJob({ kind: "ready" });
  };

  const choose = (f: File) => {
    const exts = input.kind === "file" ? input.extensions : [".pdf"];
    const issue = checkFile(f, exts, PDF_MAX_MB);
    setRejected(issue);
    if (issue) return;
    reset();
    if (input.kind === "pdf") pdf.pick(f);
    else setRaw(f);
  };
  const clear = () => {
    reset();
    setRejected(null);
    if (input.kind === "pdf") pdf.clear();
    else setRaw(null);
  };

  const start = async () => {
    if (!hasInput || problem || available === false) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const build = (token?: string) => {
      const form = new FormData();
      if (token) form.append("token", token);
      else if (file) form.append("file", file, file.name);
      for (const [k, v, name] of fields(ctx)) {
        if (v instanceof Blob) form.append(k, v, name ?? "file");
        else form.append(k, v);
      }
      return form;
    };
    const fallbackName = `${stem(file?.name ?? "document")}.pdf`;
    const send = (token?: string) =>
      uploadForm(endpoint, build(token), {
        signal: ctrl.signal,
        fallbackName,
        onUpload: token ? undefined : (p) => setJob(p >= 1 ? { kind: "processing" } : { kind: "uploading", progress: p }),
        onProcessing: () => setJob({ kind: "processing" }),
      });
    setJob(input.kind === "pdf" ? { kind: "processing" } : { kind: "uploading", progress: 0 });
    try {
      let out: Converted;
      try {
        out = await send(doc?.upload.token);
      } catch (e) {
        // The server forgets uploads after a while; send the PDF again and retry once.
        if (!(input.kind === "pdf" && expired(e) && pdf.doc)) throw e;
        const token = await pdf.upload(pdf.doc);
        out = await send(token);
      }
      const parts = isZip(out) ? await listZip(out.blob) : null;
      setResult({ ...out, url: URL.createObjectURL(out.blob), saved: false, parts });
      setJob({ kind: "ready" });
    } catch (e) {
      if (ctrl.signal.aborted) return setJob({ kind: "ready" });
      setJob({ kind: "failed", message: messageOf(e) });
    }
  };

  const steps = stepsFor(tool);
  const step = !hasInput ? 0 : !result ? 1 : result.saved ? 3 : 2;
  const accept = input.kind === "file" ? input.accept : (tool.accept?.types ?? ".pdf");
  const formats = input.kind === "file" ? input.formats : `PDF · up to ${PDF_MAX_MB} MB`;

  return (
    <Workbench
      steps={steps}
      current={step}
      footer={
        footer ??
        (input.kind === "pdf" ? (
          <>
            Your PDF is kept on our server for 30 minutes after you last use it, so you can try other settings without
            uploading again. Then it&apos;s deleted.
          </>
        ) : (
          <>Your file is deleted from our server as soon as the result is sent. Nothing is kept.</>
        ))
      }
    >
      <div className="space-y-3 p-3 sm:p-4">
        {available === false && <Notice tone="warning">{CAPABILITY_TEXT[needs!]}</Notice>}

        {!file ? (
          <FileDrop accept={accept} title={dropTitle} formats={formats} error={rejected} onFile={choose} />
        ) : input.kind === "pdf" && pdf.doc ? (
          <DocRow doc={pdf.doc} locked={busy} accept={accept} onReplace={choose} onClear={clear} onRetry={pdf.retry} />
        ) : (
          <FileRow file={file} noun={input.kind === "file" ? input.noun : "PDF"} locked={busy} accept={accept} onReplace={choose} onClear={clear} />
        )}
        {file && rejected && (
          <p role="alert" className="px-1 text-sm text-danger">
            {rejected}
          </p>
        )}

        {file && (
          <AnimatePresence mode="wait" initial={false}>
            {result ? (
              <motion.div key="result" {...swap}>
                <ResultPanel
                  result={result}
                  note={resultNote}
                  info={resultInfo}
                  backLabel={backLabel}
                  onBack={reset}
                  onSave={() => {
                    saveBlob(result.blob, result.name);
                    setResult({ ...result, saved: true });
                  }}
                />
              </motion.div>
            ) : (
              <motion.div key="options" {...swap} className="space-y-3">
                {options && (input.kind !== "pdf" || doc) ? options(ctx) : null}
                {input.kind === "pdf" && !doc && pdf.doc?.upload.state === "uploading" && options ? (
                  <p className="px-1 text-sm text-ink-3">The options appear as soon as your PDF is in.</p>
                ) : null}
                <ProgressButton
                  job={job}
                  disabled={!hasInput || Boolean(problem) || available === false}
                  label={typeof label === "function" ? label(ctx) : label}
                  working={working}
                  hint={problem ?? hint ?? "You can check the result here before you save it."}
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

/** A non-PDF (or not-yet-uploaded) file, with Change / Remove. */
export function FileRow({
  file,
  noun,
  locked,
  accept,
  onReplace,
  onClear,
}: {
  file: File;
  noun: string;
  locked: boolean;
  accept: string;
  onReplace: (f: File) => void;
  onClear: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const ext = (file.name.split(".").pop() ?? "").toUpperCase().slice(0, 4);
  return (
    <div className="flex items-center gap-3 rounded-md border border-line bg-paper p-2 sm:gap-4">
      <span className="flex h-14 w-12 shrink-0 flex-col items-center justify-center gap-1 rounded-sm border border-line bg-paper-2 text-ink-2">
        <FileText aria-hidden className="size-5" />
        <span className="font-mono text-[9px] font-medium tracking-[0.08em]">{ext}</span>
      </span>
      <div className="min-w-0 flex-1">
        <p className="label-mono text-ink-3">Your {noun}</p>
        <p className="mt-1 truncate text-[15px] font-medium text-ink" title={file.name}>
          {file.name}
        </p>
        <p className="mt-0.5 text-sm text-ink-2">{formatBytes(file.size)}</p>
      </div>
      {!locked && (
        <div className="flex shrink-0 items-center gap-1">
          <input
            ref={ref}
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
            onClick={() => ref.current?.click()}
            className="inline-flex h-9 items-center rounded-[8px] px-2.5 text-sm text-ink-2 transition-colors hover:bg-paper-2 hover:text-ink"
          >
            Change
          </button>
          <button
            type="button"
            onClick={onClear}
            className="inline-flex h-9 items-center rounded-[8px] px-2.5 text-sm text-ink-3 transition-colors hover:bg-paper-2 hover:text-ink"
          >
            Remove
          </button>
        </div>
      )}
    </div>
  );
}

const KIND_LABEL: [RegExp, string][] = [
  [/zip/, "ZIP"],
  [/pdf/, "PDF"],
  [/wordprocessingml|msword/, "Word document"],
  [/presentationml|powerpoint/, "PowerPoint"],
  [/spreadsheetml|excel/, "Excel workbook"],
  [/png/, "PNG"],
  [/jpe?g/, "JPG"],
];

/** The result, checked before it's saved: a preview where the browser can show one, then Download. */
export function ResultPanel({
  result,
  note,
  info,
  backLabel,
  onBack,
  onSave,
  kindLabel,
  children,
}: {
  result: TaskResult;
  note?: React.ReactNode;
  info?: (info: Record<string, unknown>) => React.ReactNode;
  backLabel: string;
  onBack: () => void;
  onSave: () => void;
  /** What the file is ("MP3", "Markdown") when its type alone doesn't say. ZIPs are always "ZIP". */
  kindLabel?: string;
  /** Previews the shared ones don't cover (audio, video, text), shown above the buttons. */
  children?: React.ReactNode;
}) {
  const [preview, setPreview] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const kind =
    (result.name.toLowerCase().endsWith(".zip") ? "ZIP" : kindLabel) ??
    KIND_LABEL.find(([re]) => re.test(result.type) || re.test(result.name.toLowerCase()))?.[1] ??
    "File";
  const isPdf = kind === "PDF";
  const isImage = kind === "PNG" || kind === "JPG";
  let infoLine: React.ReactNode = null;
  if (info && result.info) {
    try {
      infoLine = info(JSON.parse(result.info) as Record<string, unknown>);
    } catch {
      infoLine = null;
    }
  }

  useEffect(() => {
    const el = panel.current;
    if (!el || el.getBoundingClientRect().top >= 80) return;
    const lenis = getLenis();
    if (lenis) lenis.scrollTo(el, { offset: -96 });
    else el.scrollIntoView({ block: "start" });
  }, []);

  return (
    <div ref={panel} className="scroll-mt-24 rounded-md border border-line bg-surface px-3 py-3 sm:px-4 sm:py-4">
      <div className="flex items-baseline justify-between gap-4">
        <p className="label-mono flex items-center gap-1.5 text-ink-2">
          <Check aria-hidden className="size-3.5 text-success" /> {kind} ready
        </p>
        <p className="label-mono shrink-0 text-ink-3">{formatBytes(result.size)}</p>
      </div>
      <p className="mt-2 truncate text-lg font-semibold tracking-[-0.015em] text-ink" title={result.name}>
        {result.name}
      </p>
      {infoLine && <p className="mt-1.5 text-sm text-ink-2">{infoLine}</p>}

      {result.parts && <PartsList parts={result.parts} />}

      {isImage && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={result.url}
          alt={`Preview of ${result.name}`}
          className="mt-3 max-h-[min(60vh,520px)] w-full rounded-sm border border-line bg-paper-2 object-contain"
        />
      )}

      {isPdf && (
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

      {children}

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={onSave}
          className="inline-flex h-12 w-full items-center justify-center gap-2 whitespace-nowrap rounded-md bg-ink px-5 text-[15px] font-medium text-paper transition-[background-color,transform] duration-150 hover:bg-ink/85 active:translate-y-px sm:w-auto sm:flex-1"
        >
          {result.saved ? <Check aria-hidden className="size-4" /> : <Download aria-hidden className="size-4" />}
          {result.saved ? "Saved. Download again" : `Download ${kind === "Word document" || kind === "Excel workbook" ? kind.split(" ")[0] : kind}`}
          <span className="font-mono text-[13px] font-normal text-paper/60">{formatBytes(result.size)}</span>
        </button>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex h-12 items-center justify-center whitespace-nowrap rounded-md border border-line bg-surface px-4 text-sm font-medium text-ink transition-colors hover:border-ink-3"
        >
          {backLabel}
        </button>
      </div>
      {note && <p className={cn("mt-2.5 text-xs text-ink-3")}>{note}</p>}
    </div>
  );
}

