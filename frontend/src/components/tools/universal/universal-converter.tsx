"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, ChevronDown, Search, X } from "lucide-react";
import { formatBytes } from "@/lib/media";
import { saveBlob, uploadForm } from "@/lib/files";
import { listZip } from "@/lib/pdf";
import { getTool, stepsFor, toolHref } from "@/lib/tools";
import {
  CATEGORY_ICON,
  STATIC_CATALOGUE,
  describeRoute,
  detectFormat,
  extLabel,
  loadLiveCatalogue,
  matchesFormat,
  suggestedTargets,
  type Catalogue,
  type Route,
} from "@/lib/universal";
import { cn } from "@/lib/utils";
import { AudioPreview } from "../audio-preview";
import { FileDrop } from "../file-drop";
import { isBusy, ProgressButton, type Job } from "../progress-button";
import { Workbench } from "../workbench";
import { Chips, Notice, PagesField, pagesError, Panel, Row, Toggle } from "../pdf/kit";
import { isZip, messageOf, swap } from "../pdf/parts";
import { FileRow, ResultPanel, type TaskResult } from "../pdf/task";

const ENDPOINT = "/api/tools/universal/convert";
const MAX_MB = 150;

/** Results the browser can show as a picture beyond the PNG/JPG the shared panel already previews. */
const BROWSER_IMAGES = new Set(["webp", "gif", "avif", "bmp", "ico", "svg"]);
const BROWSER_VIDEO = new Set(["mp4", "webm", "mov", "m4v"]);
/** Text results worth a peek before downloading. */
const NOT_TEXT = new Set(["pdf", "docx", "doc", "odt", "rtf", "epub", "pptx", "ppt", "odp", "xlsx", "xls", "ods", "xlsm", "odg", "eml"]);

/**
 * Any file → any format. Tools with a `preset` (PDF to Word, Video to MP3…) use this same workspace
 * with the pair fixed: the drop zone takes only the preset's formats and the picker is replaced by
 * the one route, plus a link to every other format.
 */
export function UniversalConverter({ toolId }: { toolId: string }) {
  const tool = getTool(toolId)!;
  const preset = tool.preset ?? null;
  const [cat, setCat] = useState<Catalogue>(STATIC_CATALOGUE);
  const [file, setFile] = useState<File | null>(null);
  const [chosenSource, setChosenSource] = useState<string | null>(null);
  const [picked, setTarget] = useState<string | null>(null);
  const [rejected, setRejected] = useState<string | null>(null);
  const [options, setOptions] = useState<ConvertOptions>({});
  const [job, setJob] = useState<Job>({ kind: "ready" });
  const [result, setResult] = useState<(TaskResult & { meta: ConvertInfo | null }) | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let live = true;
    loadLiveCatalogue().then((c) => live && c && setCat(c));
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => (result ? () => URL.revokeObjectURL(result.url) : undefined), [result]);

  const detected = file ? detectFormat(file.name, cat) : null;
  const source = chosenSource ?? detected;
  const routes = useMemo(() => (source ? (cat.routes[source] ?? []) : []), [cat, source]);
  // The live list may drop a format this server can't write; a choice that's gone counts as none.
  const route = routes.find((r) => r.target === (preset ? preset.to : picked)) ?? null;
  const target = route?.target ?? null;

  const busy = isBusy(job);
  const reset = () => {
    abortRef.current?.abort();
    setResult(null);
    setJob({ kind: "ready" });
  };
  const choose = (f: File) => {
    if (f.size === 0) return setRejected("That file is empty.");
    if (f.size > MAX_MB * 1024 * 1024) return setRejected(`That file is over ${MAX_MB} MB. Try a smaller one.`);
    const fmt = detectFormat(f.name, cat);
    if (preset && (!fmt || !preset.from.includes(fmt))) {
      return setRejected(`This tool takes ${tool.accept?.label ?? preset.from.map(extLabel).join(", ")}. For other files, use the Universal converter.`);
    }
    reset();
    setOptions({});
    setRejected(null);
    setFile(f);
    setChosenSource(null);
    setTarget(null);
  };
  const clear = () => {
    reset();
    setFile(null);
    setChosenSource(null);
    setTarget(null);
  };

  const start = async () => {
    if (!file || !source || !route) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const form = new FormData();
    form.append("file", file, file.name);
    form.append("target", route.target);
    if (chosenSource) form.append("source", chosenSource);
    const sent = optionsFor(source, route.target, cat, options);
    if (Object.keys(sent).length) form.append("options", JSON.stringify(sent));
    setJob({ kind: "uploading", progress: 0 });
    try {
      const out = await uploadForm(ENDPOINT, form, {
        signal: ctrl.signal,
        fallbackName: `${file.name.replace(/\.[^.]+$/, "")}.${route.target}`,
        onUpload: (p) => setJob(p >= 1 ? { kind: "processing" } : { kind: "uploading", progress: p }),
        onProcessing: () => setJob({ kind: "processing" }),
      });
      const parts = isZip(out) ? await listZip(out.blob).catch(() => null) : null;
      setResult({ ...out, url: URL.createObjectURL(out.blob), saved: false, parts, meta: parseInfo(out.info) });
      setJob({ kind: "ready" });
    } catch (e) {
      if (ctrl.signal.aborted) return setJob({ kind: "ready" });
      setJob({ kind: "failed", message: messageOf(e) });
    }
  };

  const steps = stepsFor(tool);
  const step = !file ? 0 : !result ? 1 : result.saved ? 3 : 2;
  const sourceFormat = source ? cat.formats[source] : null;
  const targetFormat = target ? cat.formats[target] : null;
  const total = Object.keys(cat.formats).length;

  return (
    <Workbench
      steps={steps}
      current={step}
      footer={
        <>
          Your file is converted on our server by open-source programs (LibreOffice, Pandoc, FFmpeg and others) and deleted as soon as
          the result is sent. Nothing is kept, and it&apos;s free.
        </>
      }
    >
      <div className="space-y-3 p-3 sm:p-4">
        {!file ? (
          <>
            <FileDrop
              accept={preset ? (tool.accept?.types ?? "") : ""}
              title={preset ? `Drop ${steps[0].replace(/^Add /, "")} here` : "Drop any file here"}
              formats={
                preset
                  ? `${tool.accept?.label ?? preset.from.map(extLabel).join(", ")} · up to ${MAX_MB} MB`
                  : `${total} formats · documents, data, images, audio, video, fonts, archives · up to ${MAX_MB} MB`
              }
              error={rejected}
              onFile={choose}
            />
            {preset ? <OtherFormats /> : <FormatAtlas cat={cat} />}
          </>
        ) : (
          <FileRow
            file={file}
            noun={sourceFormat?.label ?? "file"}
            locked={busy}
            accept={preset ? (tool.accept?.types ?? "") : ""}
            onReplace={choose}
            onClear={clear}
          />
        )}
        {file && rejected && (
          <p role="alert" className="px-1 text-sm text-danger">
            {rejected}
          </p>
        )}

        {file && !detected && (
          <SourcePicker cat={cat} name={file.name} value={chosenSource} disabled={busy} onChange={(v) => (setChosenSource(v), setTarget(null))} />
        )}

        {file && source && (
          <AnimatePresence mode="wait" initial={false}>
            {result ? (
              <motion.div key="result" {...swap}>
                <ResultPanel
                  result={result}
                  kindLabel={targetFormat ? (target === "jpg" ? "JPG" : targetFormat.label) : undefined}
                  backLabel="Pick another format"
                  onBack={reset}
                  onSave={() => {
                    saveBlob(result.blob, result.name);
                    setResult({ ...result, saved: true });
                  }}
                  note={result.meta?.notes.length ? result.meta.notes.join(" ") : undefined}
                >
                  {target && <ResultPreview result={result} target={target} cat={cat} />}
                </ResultPanel>
              </motion.div>
            ) : (
              <motion.div key="options" {...swap} className="space-y-3">
                {preset && route && <PresetLine source={source} target={route.target} />}
                {routes.length === 0 ? (
                  <Notice tone="warning">
                    {sourceFormat?.label} files can&apos;t be converted on this server right now. Try again later, or request it.
                  </Notice>
                ) : preset ? (
                  !route && (
                    <Notice tone="warning">
                      {sourceFormat?.label} files can&apos;t become {extLabel(preset.to)} on this server right now. Try again later.
                    </Notice>
                  )
                ) : (
                  <TargetPicker cat={cat} source={source} routes={routes} value={target} disabled={busy} onChange={setTarget} />
                )}
                {route && <OptionsPanel source={source} target={route.target} cat={cat} value={options} onChange={setOptions} disabled={busy} />}
                <ProgressButton
                  job={job}
                  disabled={!route || Boolean(optionsError(source, route.target, options))}
                  label={route ? `Convert to ${extLabel(route.target)}` : "Pick a format"}
                  working={route && route.engines.length > 1 ? `Converting in ${route.engines.length} steps…` : "Converting…"}
                  hint={
                    route
                      ? (optionsError(source, route.target, options) ?? <RouteLine route={route} source={source} cat={cat} />)
                      : "Pick the format you want above."
                  }
                  workingHint={workingHint(route, cat)}
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

type ConvertInfo = { source: string; target: string; notes: string[]; bundle: boolean };

function parseInfo(raw?: string): ConvertInfo | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<ConvertInfo>;
    return { source: v.source ?? "", target: v.target ?? "", notes: Array.isArray(v.notes) ? v.notes : [], bundle: Boolean(v.bundle) };
  } catch {
    return null;
  }
}

function workingHint(route: Route | null, cat: Catalogue): string | undefined {
  if (!route) return undefined;
  const to = cat.formats[route.target];
  if (route.engines.includes("Tesseract OCR")) return "Reading the words in your picture. This takes a few seconds per page.";
  if (to?.category === "video") return "Videos that need re-encoding can take a few minutes on our free server. Keep this tab open.";
  if (route.engines.includes("LibreOffice")) return "Opening your document in LibreOffice. This usually takes 5–20 seconds.";
  return undefined;
}

/* ---------------------------------------------------------------------------------------------- */
/* Fine-tuning the result (mirrors ConvertOptions in backend/app/schemas/universal.py)            */
/* ---------------------------------------------------------------------------------------------- */

type ConvertOptions = {
  images?: "pages" | "extract";
  dpi?: 72 | 150 | 300;
  pages?: string;
  sheets?: "tables" | "pages";
  fit_sheets?: boolean;
  bitrate?: 128 | 192 | 320;
};

const PDF_PICTURES = new Set(["jpg", "png"]);
const BITRATE_TARGETS = new Set(["mp3", "m4a", "aac", "ogg", "opus", "wma"]);

/** Which options apply to this pair. */
function optionKinds(source: string, target: string, cat: Catalogue) {
  return {
    pictures: source === "pdf" && PDF_PICTURES.has(target),
    tables: source === "pdf" && target === "xlsx",
    fit: target === "pdf" && cat.formats[source]?.category === "spreadsheet",
    bitrate: BITRATE_TARGETS.has(target),
  };
}

/** Only the options that apply to this pair (switching formats never sends a stale one). */
function optionsFor(source: string, target: string, cat: Catalogue, o: ConvertOptions): ConvertOptions {
  const k = optionKinds(source, target, cat);
  const out: ConvertOptions = {};
  if (k.pictures) {
    if (o.images === "extract") out.images = "extract";
    if (o.dpi && o.images !== "extract") out.dpi = o.dpi;
    if (o.pages?.trim()) out.pages = o.pages.trim();
  }
  if (k.tables && o.sheets) out.sheets = o.sheets;
  if (k.fit && o.fit_sheets) out.fit_sheets = true;
  if (k.bitrate && o.bitrate) out.bitrate = o.bitrate;
  return out;
}

function optionsError(source: string, target: string, o: ConvertOptions): string | null {
  return source === "pdf" && PDF_PICTURES.has(target) && o.pages ? pagesError(o.pages, null) : null;
}

function OptionsPanel({
  source,
  target,
  cat,
  value,
  onChange,
  disabled,
}: {
  source: string;
  target: string;
  cat: Catalogue;
  value: ConvertOptions;
  onChange: (v: ConvertOptions) => void;
  disabled: boolean;
}) {
  const k = optionKinds(source, target, cat);
  if (!k.pictures && !k.tables && !k.fit && !k.bitrate) return null;
  const set = (patch: ConvertOptions) => onChange({ ...value, ...patch });
  return (
    <Panel>
      {k.pictures && (
        <>
          <Row label="What you get">
            <Chips
              value={value.images ?? "pages"}
              onChange={(v) => set({ images: v })}
              disabled={disabled}
              options={[
                { value: "pages", label: "Each page as a picture" },
                { value: "extract", label: "The pictures inside" },
              ]}
            />
            <p className="mt-2 text-xs text-ink-3">
              {value.images === "extract"
                ? "The photos and graphics embedded in the PDF, at their original quality and format."
                : "Every page drawn as a picture, text and all."}
            </p>
          </Row>
          {value.images !== "extract" && (
            <Row label="Quality">
              <Chips
                value={value.dpi ?? 150}
                onChange={(v) => set({ dpi: v })}
                disabled={disabled}
                options={[
                  { value: 72, label: "Screen · 72 dpi" },
                  { value: 150, label: "Standard · 150 dpi" },
                  { value: 300, label: "Print · 300 dpi" },
                ]}
              />
            </Row>
          )}
          <Row label="Pages">
            <PagesField value={value.pages ?? ""} onChange={(v) => set({ pages: v })} pages={null} disabled={disabled} />
          </Row>
        </>
      )}
      {k.tables && (
        <Row label="Sheets">
          <Chips
            value={value.sheets ?? "tables"}
            onChange={(v) => set({ sheets: v })}
            disabled={disabled}
            options={[
              { value: "tables", label: "A sheet per table" },
              { value: "pages", label: "A sheet per page" },
            ]}
          />
          <p className="mt-2 text-xs text-ink-3">Tables with ruled lines come out best. No tables? You get each page&apos;s text, split into columns.</p>
        </Row>
      )}
      {k.fit && (
        <Row label="Fit">
          <Toggle
            checked={Boolean(value.fit_sheets)}
            onChange={(v) => set({ fit_sheets: v })}
            disabled={disabled}
            label="Each sheet on a single page"
            description="Shrinks wide or long sheets to fit one page each, instead of breaking them across pages."
          />
        </Row>
      )}
      {k.bitrate && (
        <Row label="Sound quality">
          <Chips
            value={value.bitrate ?? 192}
            onChange={(v) => set({ bitrate: v })}
            disabled={disabled}
            options={[
              { value: 128, label: "128 kbps · smaller" },
              { value: 192, label: "192 kbps · standard" },
              { value: 320, label: "320 kbps · best" },
            ]}
          />
        </Row>
      )}
    </Panel>
  );
}

/** A preset's one route, as a line: PDF → DOCX, with the way out to every other format. */
function PresetLine({ source, target }: { source: string; target: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-md border border-line bg-surface px-3 py-2.5 sm:px-4">
      <p className="flex items-center gap-2 font-mono text-[13px] tracking-[0.04em] text-ink">
        {extLabel(source)}
        <ArrowRight aria-hidden className="size-3.5 text-ink-3" />
        {extLabel(target)}
      </p>
      <Link href={toolHref("convert-anything")} className="group inline-flex items-center gap-1 text-[13px] text-ink-2 transition-colors hover:text-ink">
        Convert to another format
        <ArrowUpRight aria-hidden className="size-3.5 transition-transform duration-150 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
      </Link>
    </div>
  );
}

/** Under a preset's drop zone: the same engine converts far more. */
function OtherFormats() {
  return (
    <p className="px-1 text-[13px] text-ink-3">
      Need a different format?{" "}
      <Link href={toolHref("convert-anything")} className="text-ink-2 underline decoration-line underline-offset-4 hover:text-ink hover:decoration-ink-2">
        The Universal converter
      </Link>{" "}
      turns 112 formats into each other.
    </p>
  );
}

/* ---------------------------------------------------------------------------------------------- */
/* Picking the format to convert to                                                                */
/* ---------------------------------------------------------------------------------------------- */

function TargetPicker({
  cat,
  source,
  routes,
  value,
  disabled,
  onChange,
}: {
  cat: Catalogue;
  source: string;
  routes: Route[];
  value: string | null;
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");
  const suggested = suggestedTargets(source, routes);
  const labelOf = (id: string) => cat.categories.find((c) => c.id === id)?.label ?? id;

  const counts = new Map<string, number>();
  for (const r of routes) {
    const c = cat.formats[r.target]?.category;
    if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  const groups = cat.categories.filter((c) => counts.has(c.id));
  const shown = routes.filter((r) => {
    const f = cat.formats[r.target];
    return f && (category === "all" || f.category === category) && matchesFormat(f, labelOf(f.category), query);
  });

  return (
    <Panel>
      <Row label="Most asked" hint={`${routes.length} formats in all`}>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {suggested.map((r) => (
            <Tile key={r.target} route={r} cat={cat} selected={value === r.target} disabled={disabled} onClick={() => onChange(r.target)} large />
          ))}
        </div>
      </Row>
      <Row label="Every format" htmlFor="uc-search">
        <div className="relative">
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
          <input
            id="uc-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search: pdf, word, mp3, json…"
            autoComplete="off"
            className="h-10 w-full rounded-md border border-line bg-surface pl-9 pr-9 text-sm text-ink placeholder:text-ink-3 focus:border-ink focus:outline-none focus:ring-4 focus:ring-accent/15"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-1 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-[8px] text-ink-3 hover:bg-paper-2 hover:text-ink"
            >
              <X aria-hidden className="size-4" />
            </button>
          )}
        </div>
        {groups.length > 1 && (
          // Phones scroll the chips sideways; wider screens wrap them so none is cut off.
          <div role="radiogroup" aria-label="Kind of format" className="mt-2.5 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] sm:flex-wrap sm:overflow-visible">

            {[{ id: "all", label: "All" }, ...groups].map((g) => {
              const active = category === g.id;
              return (
                <button
                  key={g.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setCategory(g.id)}
                  className={cn(
                    "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-sm border px-2.5 text-[13px] transition-colors duration-150",
                    active ? "border-ink bg-ink text-paper" : "border-line bg-surface text-ink-2 hover:border-ink-3 hover:text-ink",
                  )}
                >
                  {g.label}
                  <span className={cn("font-mono text-[12px]", active ? "text-paper-dim" : "text-ink-3")}>
                    {g.id === "all" ? routes.length : counts.get(g.id)}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        {shown.length ? (
          <div className="mt-2.5 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line min-[420px]:grid-cols-3 sm:grid-cols-4 lg:grid-cols-5">
            {shown.map((r) => (
              <Tile key={r.target} route={r} cat={cat} selected={value === r.target} disabled={disabled} onClick={() => onChange(r.target)} />
            ))}
          </div>
        ) : (
          <p className="mt-2.5 rounded-md border border-dashed border-line px-3 py-4 text-center text-sm text-ink-2">
            No format matches &ldquo;{query}&rdquo;.{" "}
            <button type="button" className="underline decoration-line underline-offset-4 hover:decoration-ink-2" onClick={() => (setQuery(""), setCategory("all"))}>
              Show them all
            </button>
          </p>
        )}
      </Row>
    </Panel>
  );
}

function Tile({
  route,
  cat,
  selected,
  disabled,
  onClick,
  large = false,
}: {
  route: Route;
  cat: Catalogue;
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
  large?: boolean;
}) {
  const f = cat.formats[route.target];
  const Icon = CATEGORY_ICON[f.category];
  // "PDF / PDF" says nothing twice: when the name is just the extension, say what kind of file it is.
  const sub = f.label.toUpperCase() === extLabel(f.id) ? (cat.categories.find((c) => c.id === f.category)?.label ?? f.label) : f.label;
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      title={`${f.label} · via ${describeRoute(route)}`}
      className={cn(
        "group flex min-w-0 items-center gap-2.5 text-left transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60",
        large ? "h-14 rounded-md border px-3" : "h-12 px-3",
        selected
          ? "border-ink bg-ink text-paper"
          : large
            ? "border-line bg-surface text-ink hover:border-ink-3"
            : "bg-surface text-ink hover:bg-paper-2/60",
      )}
    >
      {large && Icon && (
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-sm border",
            selected ? "border-paper/25 text-paper" : "border-line bg-paper text-ink-2",
          )}
        >
          <Icon aria-hidden className="size-4" />
        </span>
      )}
      <span className="min-w-0">
        <span className="block font-mono text-[13px] font-medium tracking-[0.04em]">{extLabel(f.id)}</span>
        <span className={cn("block truncate text-xs", selected ? "text-paper-dim" : "text-ink-3")}>{sub}</span>
      </span>
    </button>
  );
}

/** How the conversion happens, in one mono line: PDF → DOCX → MD · pdf2docx, then Pandoc. */
function RouteLine({ route, source, cat }: { route: Route; source: string; cat: Catalogue }) {
  const chain = [source, ...route.via, route.target];
  const ocr = route.engines.includes("Tesseract OCR");
  return (
    <span className="flex flex-col gap-1">
      <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        {chain.map((id, i) => (
          <span key={`${id}-${i}`} className="inline-flex items-center gap-1.5">
            {i > 0 && <ArrowRight aria-hidden className="size-3 text-ink-3" />}
            <span className={cn("font-mono text-[12px] tracking-[0.06em]", i === chain.length - 1 ? "text-ink" : "text-ink-2")}>{extLabel(id)}</span>
          </span>
        ))}
        <span className="text-ink-3">· {describeRoute(route)}</span>
      </span>
      {route.bundle && <span>Several pages or sheets come as a ZIP, one {extLabel(route.target)} each.</span>}
      {ocr && <span>The words are read from the picture (OCR), so check names and numbers.</span>}
      {!route.bundle && !ocr && cat.formats[route.target]?.category === "video" && (
        <span>If the video already fits {extLabel(route.target)} it&apos;s repackaged in seconds; otherwise it&apos;s re-encoded.</span>
      )}
    </span>
  );
}

/* ---------------------------------------------------------------------------------------------- */
/* Files whose name doesn't say what they are                                                     */
/* ---------------------------------------------------------------------------------------------- */

function SourcePicker({
  cat,
  name,
  value,
  disabled,
  onChange,
}: {
  cat: Catalogue;
  name: string;
  value: string | null;
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")).toUpperCase() : "";
  return (
    <div className="space-y-2">
      <Notice tone="warning">
        {ext ? `We don't recognise ${ext} files.` : "This file's name doesn't say what it is."} If you know what&apos;s inside, pick it below.
      </Notice>
      <label className="flex flex-col gap-1.5 px-1 sm:flex-row sm:items-center sm:gap-3">
        <span className="label-mono shrink-0 text-ink-3">It&apos;s a</span>
        <span className="relative w-full sm:max-w-xs">
          <select
            value={value ?? ""}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            className="h-10 w-full appearance-none rounded-md border border-line bg-surface pl-3 pr-9 text-sm text-ink focus:border-ink focus:outline-none focus:ring-4 focus:ring-accent/15"
          >
            <option value="" disabled>
              Choose a format…
            </option>
            {cat.categories.map((c) => {
              const list = Object.values(cat.formats).filter((f) => f.category === c.id && cat.routes[f.id]?.length);
              return list.length ? (
                <optgroup key={c.id} label={c.label}>
                  {list.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label} ({extLabel(f.id)})
                    </option>
                  ))}
                </optgroup>
              ) : null;
            })}
          </select>
          <ChevronDown aria-hidden className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
        </span>
      </label>
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------- */
/* Every format, before a file is added                                                           */
/* ---------------------------------------------------------------------------------------------- */

function FormatAtlas({ cat }: { cat: Catalogue }) {
  const [open, setOpen] = useState(false);
  const groups = cat.categories
    .map((c) => ({ ...c, formats: Object.values(cat.formats).filter((f) => f.category === c.id && cat.routes[f.id]?.length) }))
    .filter((g) => g.formats.length);
  const pairs = Object.values(cat.routes).reduce((n, r) => n + r.length, 0);
  return (
    <div className="rounded-md border border-line">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left transition-colors hover:bg-paper-2/40 sm:px-4"
      >
        <span className="min-w-0">
          <span className="label-mono block text-ink-3">Fig. 01 — What we read</span>
          <span className="mt-1 block text-sm text-ink">
            {Object.keys(cat.formats).length} formats in {groups.length} families,{" "}
            <span className="font-mono text-[13px]">{pairs.toLocaleString("en")}</span> conversions
          </span>
        </span>
        <ChevronDown aria-hidden className={cn("size-4 shrink-0 text-ink-2 transition-transform duration-200", open && "rotate-180")} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1, transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] } }}
            exit={{ height: 0, opacity: 0, transition: { duration: 0.2 } }}
            className="overflow-hidden"
          >
            <ul className="grid gap-px border-t border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
              {groups.map((g) => {
                const Icon = CATEGORY_ICON[g.id];
                return (
                  <li key={g.id} className="bg-surface px-3 py-3 sm:px-4">
                    <p className="flex items-center gap-2 text-sm font-medium text-ink">
                      {Icon && <Icon aria-hidden className="size-4 text-ink-2" />}
                      {g.label}
                      <span className="label-mono ml-auto text-ink-3">{g.formats.length}</span>
                    </p>
                    <p className="mt-1.5 font-mono text-[12px] leading-relaxed tracking-[0.06em] text-ink-2">
                      {g.formats.map((f) => (
                        <span key={f.id} title={f.label} className="mr-2 inline-block">
                          {extLabel(f.id)}
                        </span>
                      ))}
                    </p>
                  </li>
                );
              })}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------- */
/* Seeing the result before saving it                                                             */
/* ---------------------------------------------------------------------------------------------- */

function ResultPreview({ result, target, cat }: { result: TaskResult; target: string; cat: Catalogue }) {
  const [text, setText] = useState<string | null>(null);
  const zipped = result.name.toLowerCase().endsWith(".zip");
  const category = cat.formats[target]?.category;
  const showText = !zipped && !NOT_TEXT.has(target) && ["document", "markup", "data", "code", "subtitle", "ebook"].includes(category ?? "");

  useEffect(() => {
    if (!showText) return;
    let live = true;
    result.blob
      .slice(0, 6000)
      .text()
      .then((t) => live && setText(t));
    return () => {
      live = false;
    };
  }, [result.blob, showText]);

  if (zipped) return null;
  if (category === "audio") {
    return (
      <div className="mt-3">
        <AudioPreview src={result.url} blob={result.blob} />
      </div>
    );
  }
  if (category === "video" && BROWSER_VIDEO.has(target)) {
    return <video src={result.url} controls preload="metadata" className="mt-3 max-h-[min(60vh,480px)] w-full rounded-sm border border-line bg-ink" />;
  }
  if (category === "image" && BROWSER_IMAGES.has(target)) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={result.url} alt={`Preview of ${result.name}`} className="mt-3 max-h-[min(60vh,480px)] w-full rounded-sm border border-line bg-paper-2 object-contain" />;
  }
  if (showText && text !== null) {
    const clipped = result.size > 6000;
    return (
      <div className="mt-3 overflow-hidden rounded-sm border border-line bg-paper">
        <p className="label-mono flex justify-between border-b border-line px-3 py-2 text-ink-3">
          <span>Preview</span>
          <span>{clipped ? `first ${formatBytes(6000)} of ${formatBytes(result.size)}` : formatBytes(result.size)}</span>
        </p>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words px-3 py-2.5 font-mono text-[12px] leading-relaxed text-ink-2">
          {text}
          {clipped && "…"}
        </pre>
      </div>
    );
  }
  return null;
}
