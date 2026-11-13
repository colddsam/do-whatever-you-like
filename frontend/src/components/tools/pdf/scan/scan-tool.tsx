"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, ArrowRight, Camera, Crop, RotateCcw, RotateCw, Trash2, Wand2 } from "lucide-react";
import { saveBlob, uploadForm } from "@/lib/files";
import { formatBytes } from "@/lib/media";
import { decode, FULL, pixels, toJpeg, vision, type Filter, type Quad } from "@/lib/scan";
import { getTool, stepsFor } from "@/lib/tools";
import { cn } from "@/lib/utils";
import { FileDrop } from "../../file-drop";
import { isBusy, ProgressButton, type Job } from "../../progress-button";
import { Workbench } from "../../workbench";
import { Chips, Notice, Panel, Row, Toggle } from "../kit";
import { messageOf, plural, swap } from "../parts";
import { langName, POPULAR_OCR } from "../simple-tools";
import { ResultPanel, type TaskResult } from "../task";
import { ScanCamera, type Shot } from "./camera";
import { CornerEditor } from "./corner-editor";

const MAX_PAGES = 100;
const FILTERS: { value: Filter; label: string; hint: string }[] = [
  { value: "auto", label: "Auto", hint: "Even light, white paper, colour kept" },
  { value: "gray", label: "Greyscale", hint: "Clean grey, smallest with photos" },
  { value: "bw", label: "Black & white", hint: "Crisp text, smallest file" },
  { value: "original", label: "Original", hint: "Just straightened" },
];

type Page = {
  id: string;
  original: Blob;
  /** Object URL of the original, for the corner editor (revoked when the page goes). */
  src: string;
  width: number;
  height: number;
  quad: Quad;
  found: boolean;
  filter: Filter;
  rotate: number;
  out: Blob | null;
  url: string | null;
  working: boolean;
};

let uid = 0;

/**
 * Scan to PDF, the scanner-app way: a guided camera that finds the page and shoots by itself, or
 * photos you already have (edges found the same way). Every page is straightened, its light evened
 * out and cleaned, and can be fixed by hand: drag the corners, change the look, turn it. The PDF can
 * be made searchable (OCR) on the way out.
 */
export function ScanTool({ toolId }: { toolId: string }) {
  const tool = getTool(toolId)!;
  const [pages, setPages] = useState<Page[]>([]);
  const [camera, setCamera] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [rejected, setRejected] = useState<string | null>(null);
  const [paper, setPaper] = useState<"a4" | "letter" | "fit">(() => (typeof navigator !== "undefined" && /^en-(US|CA)|es-(MX|US)/.test(navigator.language) ? "letter" : "a4"));
  const [ocr, setOcr] = useState(true);
  const [lang, setLang] = useState("eng");
  const [languages, setLanguages] = useState<string[] | null>(null);
  const [defaultFilter, setDefaultFilter] = useState<Filter>("auto");
  const [name, setName] = useState("");
  const [job, setJob] = useState<Job>({ kind: "ready" });
  const [result, setResult] = useState<(TaskResult & { ocr: string | null }) | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const pagesRef = useRef(pages);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const busy = isBusy(job);

  useEffect(() => {
    pagesRef.current = pages;
  }, [pages]);
  useEffect(() => () => pagesRef.current.forEach((p) => (p.url && URL.revokeObjectURL(p.url), URL.revokeObjectURL(p.src))), []);
  useEffect(() => (result ? () => URL.revokeObjectURL(result.url) : undefined), [result]);
  useEffect(() => {
    let live = true;
    fetch("/api/tools/pdf/ocr-languages")
      .then((r) => (r.ok ? r.json() : { languages: [] }))
      .then((d: { languages: string[] }) => live && setLanguages(d.languages ?? []))
      .catch(() => live && setLanguages([]));
    return () => {
      live = false;
    };
  }, []);

  const reset = () => {
    abortRef.current?.abort();
    setResult(null);
    setJob({ kind: "ready" });
  };

  const patch = (id: string, p: Partial<Page>) => setPages((list) => list.map((x) => (x.id === id ? { ...x, ...p } : x)));

  /** (Re)makes a page from its original: straighten, clean, turn. Runs one page at a time. */
  const render = useCallback((page: Page) => {
    chain.current = chain.current.then(async () => {
      try {
        const bmp = await decode(page.original);
        const img = pixels(bmp, bmp.width, bmp.height, 4096);
        bmp.close();
        const done = await vision.process(img, page.found || page.quad !== FULL ? page.quad : null, page.filter, page.rotate);
        const out = await toJpeg(done, page.filter === "bw" ? 0.85 : 0.88);
        setPages((list) =>
          list.map((x) => {
            if (x.id !== page.id) return x;
            if (x.url) URL.revokeObjectURL(x.url);
            return { ...x, out, url: URL.createObjectURL(out), working: false };
          }),
        );
      } catch (e) {
        setRejected(messageOf(e));
        patch(page.id, { working: false });
      }
    });
  }, []);

  const addShot = useCallback(
    async (shot: Shot) => {
      reset();
      if (pagesRef.current.length >= MAX_PAGES) return setRejected(`Up to ${MAX_PAGES} pages per PDF.`);
      const original = await toJpeg(shot.image, 0.92);
      const page: Page = {
        id: `s${++uid}`,
        original,
        src: URL.createObjectURL(original),
        width: shot.image.width,
        height: shot.image.height,
        quad: shot.quad,
        found: shot.found,
        filter: defaultFilter,
        rotate: 0,
        out: null,
        url: null,
        working: true,
      };
      setPages((list) => [...list, page]);
      render(page);
    },
    [defaultFilter, render],
  );

  const addFiles = async (files: File[]) => {
    reset();
    const images = files.filter((f) => f.type.startsWith("image/") || /\.(jpe?g|png|webp|heic|heif|bmp|tiff?)$/i.test(f.name));
    if (images.length < files.length) setRejected("Only photos and pictures can be scanned; the other files were left out.");
    else setRejected(null);
    for (const f of images.slice(0, MAX_PAGES - pagesRef.current.length)) {
      try {
        const bmp = await decode(f);
        const small = pixels(bmp, bmp.width, bmp.height, 480);
        const d = await vision.detect(small);
        const full = pixels(bmp, bmp.width, bmp.height, 4096);
        bmp.close();
        await addShot({ image: full, quad: d.quad && d.confidence > 0.25 ? d.quad : FULL, found: Boolean(d.quad && d.confidence > 0.25) });
      } catch {
        setRejected(`${f.name} couldn't be opened here. ${/\.hei[cf]$/i.test(f.name) ? "Your browser can't read HEIC; share it as JPG." : "Try a JPG or PNG."}`);
      }
    }
  };

  const move = (i: number, d: number) =>
    setPages((list) => {
      const j = i + d;
      if (j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const remove = (id: string) =>
    setPages((list) => {
      const gone = list.find((p) => p.id === id);
      if (gone?.url) URL.revokeObjectURL(gone.url);
      if (gone) URL.revokeObjectURL(gone.src);
      return list.filter((p) => p.id !== id);
    });

  const update = (id: string, p: Partial<Page>) => {
    reset();
    const page = pagesRef.current.find((x) => x.id === id);
    if (!page) return;
    const next = { ...page, ...p, working: true };
    patch(id, { ...p, working: true });
    render(next);
  };

  const start = async () => {
    const ready = pages.filter((p) => p.out);
    if (!ready.length || pages.some((p) => p.working)) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const form = new FormData();
    ready.forEach((p, i) => form.append("images", p.out!, `page-${String(i + 1).padStart(3, "0")}.jpg`));
    form.append("page_size", paper);
    form.append("orientation", "auto");
    form.append("margin", "none");
    form.append("enhance", "false");
    form.append("ocr", String(ocr));
    if (ocr) form.append("languages", lang);
    const fileName = `${(name.trim() || `Scan ${new Date().toISOString().slice(0, 10)}`).replace(/[\\/:*?"<>|]/g, "_")}.pdf`;
    setJob({ kind: "uploading", progress: 0 });
    try {
      const out = await uploadForm("/api/tools/pdf/from-images", form, {
        signal: ctrl.signal,
        fallbackName: fileName,
        onUpload: (p) => setJob(p >= 1 ? { kind: "processing" } : { kind: "uploading", progress: p }),
        onProcessing: () => setJob({ kind: "processing" }),
      });
      let ocrNote: string | null = null;
      try {
        const info = out.info ? (JSON.parse(out.info) as { ocr_pages?: number }) : null;
        if (info && typeof info.ocr_pages === "number") ocrNote = `Text recognised on ${plural(info.ocr_pages, "page")}: you can search, select and copy it.`;
      } catch {
        ocrNote = null;
      }
      setResult({ ...out, name: fileName, url: URL.createObjectURL(out.blob), saved: false, parts: null, ocr: ocrNote });
      setJob({ kind: "ready" });
    } catch (e) {
      if (ctrl.signal.aborted) return setJob({ kind: "ready" });
      setJob({ kind: "failed", message: messageOf(e) });
    }
  };

  const editPage = pages.find((p) => p.id === editing) ?? null;
  const step = !pages.length ? 0 : !result ? 1 : result.saved ? 3 : 2;
  const total = pages.reduce((n, p) => n + (p.out?.size ?? 0), 0);
  const working = pages.some((p) => p.working);
  const lastThumb = [...pages].reverse().find((p) => p.url)?.url ?? null;
  const langs = (languages ?? []).filter((c) => !c.endsWith("_vert") && c !== "osd");
  const shownLangs = [...new Set([...POPULAR_OCR.filter((c) => langs.includes(c)), ...langs])];

  return (
    <Workbench
      steps={stepsFor(tool)}
      current={step}
      footer={
        <>
          Edges are found and pages cleaned on your device; only the finished pages are sent to make the PDF
          {ocr ? " and read the text" : ""}, and they&apos;re deleted once it&apos;s sent. Free, no watermark.
        </>
      }
    >
      <div className="space-y-3 p-3 sm:p-4">
        <AnimatePresence>
          {camera && (
            <ScanCamera
              pages={pages.length}
              lastThumb={lastThumb}
              onShot={(s) => void addShot(s)}
              onClose={() => setCamera(false)}
            />
          )}
        </AnimatePresence>

        {!pages.length ? (
          <div className="grid gap-3 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
            <button
              type="button"
              onClick={() => (setRejected(null), setCamera(true))}
              className="group relative flex min-h-[220px] flex-col items-center justify-center gap-4 overflow-hidden rounded-md bg-ink px-6 py-8 text-paper transition-transform duration-150 active:scale-[0.99]"
            >
              <ViewfinderArt />
              <span className="relative inline-flex size-14 items-center justify-center rounded-full bg-paper text-ink transition-transform duration-300 group-hover:scale-105">
                <Camera aria-hidden className="size-6" />
              </span>
              <span className="relative text-center">
                <span className="block text-[17px] font-semibold">Scan with your camera</span>
                <span className="mt-1 block text-sm text-paper-dim">Finds the page, tells you how to hold it, shoots by itself</span>
              </span>
            </button>
            <FileDrop
              multiple
              accept="image/*,.heic,.heif"
              title="Or drop photos of the pages"
              formats="JPG, PNG, WebP · edges found for you · up to 100 pages"
              error={rejected}
              onFiles={(f) => void addFiles(f)}
            />
          </div>
        ) : (
          <div>
            <div className="flex flex-wrap items-baseline justify-between gap-2 px-1 pb-2">
              <p className="label-mono text-ink-3">
                Pages · {pages.length}
                {total ? ` · ${formatBytes(total)}` : ""}
              </p>
              {!busy && (
                <button type="button" onClick={() => (reset(), pages.forEach((p) => (p.url && URL.revokeObjectURL(p.url), URL.revokeObjectURL(p.src))), setPages([]), setEditing(null))} className="text-xs text-ink-3 underline-offset-4 hover:text-ink hover:underline">
                  Start over
                </button>
              )}
            </div>
            <ol className="grid grid-cols-2 gap-2 min-[480px]:grid-cols-3 sm:grid-cols-4 lg:grid-cols-5">
              <AnimatePresence initial={false}>
                {pages.map((p, i) => (
                  <motion.li
                    key={p.id}
                    layout
                    initial={{ opacity: 0, scale: 0.92, y: 8 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{ type: "spring", stiffness: 380, damping: 30 }}
                    className={cn("group relative overflow-hidden rounded-md border bg-paper-2", editing === p.id ? "border-ink ring-2 ring-ink" : "border-line")}
                  >
                    <button type="button" onClick={() => setEditing(editing === p.id ? null : p.id)} className="block aspect-[3/4] w-full" aria-label={`Edit page ${i + 1}`}>
                      {p.url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.url} alt={`Page ${i + 1}`} className={cn("size-full object-contain transition-opacity", p.working && "opacity-40")} />
                      ) : null}
                      {p.working && <span className="absolute inset-0 flex items-center justify-center"><span className="size-6 animate-spin rounded-full border-2 border-ink/20 border-t-ink" /></span>}
                    </button>
                    <span className="absolute left-1.5 top-1.5 rounded-sm bg-ink px-1.5 font-mono text-[12px] text-paper">{String(i + 1).padStart(2, "0")}</span>
                    {!p.found && !p.working && (
                      <span className="absolute right-1.5 top-1.5 rounded-sm bg-warning px-1.5 text-[12px] text-ink" title="No page edges found: drag the corners to crop">
                        Check crop
                      </span>
                    )}
                    {!busy && (
                      <div className="absolute inset-x-1.5 bottom-1.5 flex justify-between opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                        <span className="flex gap-1">
                          <TrayButton label={`Move page ${i + 1} earlier`} onClick={() => move(i, -1)} disabled={i === 0}>
                            <ArrowLeft className="size-3.5" />
                          </TrayButton>
                          <TrayButton label={`Move page ${i + 1} later`} onClick={() => move(i, 1)} disabled={i === pages.length - 1}>
                            <ArrowRight className="size-3.5" />
                          </TrayButton>
                        </span>
                        <TrayButton label={`Delete page ${i + 1}`} onClick={() => (reset(), remove(p.id), editing === p.id && setEditing(null))}>
                          <Trash2 className="size-3.5" />
                        </TrayButton>
                      </div>
                    )}
                  </motion.li>
                ))}
              </AnimatePresence>
              {!busy && pages.length < MAX_PAGES && (
                <li className="flex aspect-[3/4] flex-col gap-1.5">
                  <button type="button" onClick={() => setCamera(true)} className="flex flex-1 flex-col items-center justify-center gap-1.5 rounded-md bg-ink text-sm text-paper transition-transform active:scale-[0.98]">
                    <Camera aria-hidden className="size-5" />
                    Scan more
                  </button>
                  <label className="flex h-10 cursor-pointer items-center justify-center rounded-md border border-dashed border-ink-3/60 text-[13px] text-ink-2 hover:border-ink hover:text-ink has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-accent/15">
                    <input type="file" accept="image/*,.heic,.heif" multiple className="sr-only" onChange={(e) => (void addFiles(Array.from(e.target.files ?? [])), (e.target.value = ""))} />
                    Add photos
                  </label>
                </li>
              )}
            </ol>
            {rejected && (
              <p role="alert" className="px-1 pt-2 text-sm text-danger">
                {rejected}
              </p>
            )}
          </div>
        )}

        <AnimatePresence initial={false}>
          {editPage && !result && (
            <motion.div key="edit" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }} className="overflow-hidden">
              <PageEditor
                key={editPage.id}
                page={editPage}
                index={pages.indexOf(editPage)}
                disabled={busy}
                onApply={(p) => update(editPage.id, p)}
                onClose={() => setEditing(null)}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {pages.length > 0 && (
          <AnimatePresence mode="wait" initial={false}>
            {result ? (
              <motion.div key="result" {...swap}>
                <ResultPanel
                  result={result}
                  backLabel="Change the pages"
                  onBack={reset}
                  onSave={() => {
                    saveBlob(result.blob, result.name);
                    setResult({ ...result, saved: true });
                  }}
                  note={result.ocr ?? undefined}
                />
              </motion.div>
            ) : (
              <motion.div key="options" {...swap} className="space-y-3">
                <Panel>
                  <Row label="Look">
                    <Chips
                      value={defaultFilter}
                      onChange={(f) => {
                        setDefaultFilter(f);
                        pages.forEach((p) => p.filter !== f && update(p.id, { filter: f }));
                      }}
                      disabled={busy}
                      options={FILTERS.map((f) => ({ value: f.value, label: f.label, title: f.hint }))}
                    />
                    <p className="mt-2 text-xs text-ink-3">{FILTERS.find((f) => f.value === defaultFilter)?.hint}. Applies to every page.</p>
                  </Row>
                  <Row label="Paper">
                    <Chips
                      value={paper}
                      onChange={setPaper}
                      disabled={busy}
                      options={[
                        { value: "a4", label: "A4" },
                        { value: "letter", label: "Letter" },
                        { value: "fit", label: "Same as each page" },
                      ]}
                    />
                  </Row>
                  <Row label="Searchable text">
                    <Toggle checked={ocr} onChange={setOcr} disabled={busy} label="Recognise the text (OCR)" description="Lets you search, select and copy the words in the PDF. Adds a few seconds per page." />
                    {ocr && shownLangs.length > 0 && (
                      <label className="mt-2.5 flex items-center gap-2.5">
                        <span className="text-sm text-ink-2">Language</span>
                        <select value={lang} onChange={(e) => setLang(e.target.value)} disabled={busy} className="h-9 rounded-md border border-line bg-surface px-2.5 text-sm text-ink focus:border-ink focus:outline-none">
                          {shownLangs.map((c) => (
                            <option key={c} value={c}>
                              {langName(c)}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  </Row>
                  <Row label="File name">
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder={`Scan ${new Date().toISOString().slice(0, 10)}`}
                      maxLength={80}
                      aria-label="File name"
                      className="h-11 w-full rounded-md border border-line bg-surface px-3.5 text-[15px] text-ink outline-none placeholder:text-ink-3 focus:border-ink focus:ring-4 focus:ring-accent/15"
                    />
                  </Row>
                </Panel>
                {pages.some((p) => !p.found) && (
                  <Notice tone="warning">Some pages had no clear edges, so the whole photo was kept. Tap a page marked &ldquo;Check crop&rdquo; to drag its corners.</Notice>
                )}
                <ProgressButton
                  job={job}
                  disabled={working || !pages.some((p) => p.out)}
                  label={working ? "Cleaning the pages…" : `Make the PDF · ${plural(pages.length, "page")}`}
                  working={ocr ? "Building the PDF and reading the text…" : "Building the PDF…"}
                  hint={working ? "Straightening and cleaning each page on your device." : "Tap a page to adjust its corners, look or rotation."}
                  workingHint={ocr ? "Reading the text takes a few seconds per page on our free server." : undefined}
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

function TrayButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled} className="inline-flex size-7 items-center justify-center rounded-[6px] bg-ink/85 text-paper backdrop-blur hover:bg-ink disabled:opacity-30">
      {children}
    </button>
  );
}

/** The decorative viewfinder on the camera button: brackets that breathe and a slow scan line. */
function ViewfinderArt() {
  return (
    <span aria-hidden className="pointer-events-none absolute inset-5">
      {["left-0 top-0 border-l-2 border-t-2", "right-0 top-0 border-r-2 border-t-2", "bottom-0 right-0 border-b-2 border-r-2", "bottom-0 left-0 border-b-2 border-l-2"].map((c, i) => (
        <motion.span
          key={i}
          className={cn("absolute size-6 rounded-[3px] border-paper/50", c)}
          animate={{ scale: [1, 0.86, 1] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut", delay: i * 0.05 }}
        />
      ))}
      <motion.span className="absolute inset-x-3 h-px bg-accent" animate={{ top: ["12%", "88%", "12%"] }} transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }} />
    </span>
  );
}

/** One page, opened: the photo with its four corners to drag, the look, and a turn. */
function PageEditor({
  page,
  index,
  disabled,
  onApply,
  onClose,
}: {
  page: Page;
  index: number;
  disabled: boolean;
  onApply: (p: Partial<Page>) => void;
  onClose: () => void;
}) {
  const [quad, setQuad] = useState<Quad>(page.quad);
  const changed = quad.some((p, i) => p[0] !== page.quad[i][0] || p[1] !== page.quad[i][1]);
  return (
    <div className="rounded-md border border-line bg-surface p-3 sm:p-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="label-mono flex items-center gap-1.5 text-ink-2">
          <Crop aria-hidden className="size-3.5" /> Page {index + 1}
        </p>
        <button type="button" onClick={onClose} className="text-sm text-ink-3 hover:text-ink">
          Close
        </button>
      </div>
      <div className="mt-3 grid gap-4 md:grid-cols-[minmax(0,1fr)_260px]">
        <div>
          {<CornerEditor src={page.src} width={page.width} height={page.height} quad={quad} onChange={setQuad} disabled={disabled} />}
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-ink-3">Drag the corners to the page&apos;s edges.</p>
            <span className="flex gap-1.5">
              <button type="button" disabled={disabled} onClick={() => setQuad(FULL)} className="inline-flex h-8 items-center rounded-[8px] border border-line px-2.5 text-[13px] text-ink-2 hover:border-ink-3 hover:text-ink">
                Whole photo
              </button>
              <button
                type="button"
                disabled={disabled || !changed}
                onClick={() => onApply({ quad, found: true })}
                className="inline-flex h-8 items-center gap-1.5 rounded-[8px] bg-ink px-3 text-[13px] font-medium text-paper disabled:opacity-40"
              >
                <Wand2 aria-hidden className="size-3.5" /> Apply crop
              </button>
            </span>
          </div>
        </div>
        <div className="space-y-4">
          <div>
            <p className="label-mono mb-2 text-ink-3">Look</p>
            <div className="grid grid-cols-2 gap-1.5">
              {FILTERS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  disabled={disabled}
                  aria-pressed={page.filter === f.value}
                  onClick={() => onApply({ filter: f.value, quad })}
                  className={cn(
                    "rounded-md border px-2.5 py-2 text-left transition-colors",
                    page.filter === f.value ? "border-ink bg-ink text-paper" : "border-line bg-surface text-ink hover:border-ink-3",
                  )}
                >
                  <span className="block text-[13px] font-medium">{f.label}</span>
                  <span className={cn("block text-[12px] leading-snug", page.filter === f.value ? "text-paper-dim" : "text-ink-3")}>{f.hint}</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="label-mono mb-2 text-ink-3">Turn</p>
            <div className="flex gap-1.5">
              <button type="button" disabled={disabled} onClick={() => onApply({ rotate: (page.rotate + 270) % 360, quad })} className="inline-flex h-9 items-center gap-1.5 rounded-[8px] border border-line px-3 text-sm text-ink-2 hover:border-ink-3 hover:text-ink">
                <RotateCcw aria-hidden className="size-4" /> Left
              </button>
              <button type="button" disabled={disabled} onClick={() => onApply({ rotate: (page.rotate + 90) % 360, quad })} className="inline-flex h-9 items-center gap-1.5 rounded-[8px] border border-line px-3 text-sm text-ink-2 hover:border-ink-3 hover:text-ink">
                <RotateCw aria-hidden className="size-4" /> Right
              </button>
            </div>
          </div>
          {page.url && (
            <div>
              <p className="label-mono mb-2 text-ink-3">Result</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={page.url} alt={`Page ${index + 1}, cleaned`} className={cn("max-h-56 w-full rounded-sm border border-line bg-paper-2 object-contain", page.working && "opacity-40")} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
