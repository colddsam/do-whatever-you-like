"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AppWindow, Bot, Check, Globe, Laptop, Monitor, Smartphone, type LucideIcon } from "lucide-react";
import { saveBlob, uploadForm } from "@/lib/files";
import { listZip } from "@/lib/pdf";
import { getTool, stepsFor } from "@/lib/tools";
import { cn } from "@/lib/utils";
import { FileDrop } from "../file-drop";
import { isBusy, ProgressButton, type Job } from "../progress-button";
import { Workbench } from "../workbench";
import { Chips, Panel, Row, Slider, Swatches, TextField, Toggle } from "../pdf/kit";
import { messageOf, plural, swap } from "../pdf/parts";
import { FileRow, ResultPanel, type TaskResult } from "../pdf/task";
import { CHECKER } from "./task";

const ENDPOINT = "/api/tools/icon";
const MAX_MB = 150;
const ACCEPT = "image/*,.svg,.heic,.heif,.psd,.ico,.avif,.tif,.tiff";

type Pack = "web" | "windows" | "macos" | "ios" | "android" | "desktop";
type Shape = "square" | "rounded" | "circle";

/** The platforms, mirrored from backend/app/services/icon/engine.py. */
const PACKS: { id: Pack; label: string; files: string; icon: LucideIcon }[] = [
  {
    id: "web",
    label: "Website",
    files: "favicon.ico, PNGs, PWA, Apple touch",
    icon: Globe,
  },
  {
    id: "windows",
    label: "Windows",
    files: "app.ico 16–256 px, Store tiles",
    icon: AppWindow,
  },
  {
    id: "macos",
    label: "macOS",
    files: "app.icns, AppIcon.iconset",
    icon: Laptop,
  },
  {
    id: "ios",
    label: "iOS",
    files: "AppIcon.appiconset for Xcode",
    icon: Smartphone,
  },
  {
    id: "android",
    label: "Android",
    files: "mipmaps, adaptive, Play Store",
    icon: Bot,
  },
  {
    id: "desktop",
    label: "Desktop apps",
    files: "PNGs 16–1024 (Linux, Electron)",
    icon: Monitor,
  },
];
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256] as const;
const COLORS = [
  { value: "#ffffff", name: "White" },
  { value: "#15140f", name: "Ink" },
  { value: "#1a73e8", name: "Blue" },
  { value: "#eb4a10", name: "Orange" },
  { value: "#2f7d4f", name: "Green" },
  { value: "#f5c518", name: "Yellow" },
];

export function IconMakerTool({ toolId }: { toolId: string }) {
  const tool = getTool(toolId)!;
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [rejected, setRejected] = useState<string | null>(null);
  const [mode, setMode] = useState<"pack" | "ico">("pack");
  const [packs, setPacks] = useState<Pack[]>(["web", "windows", "macos", "ios", "android"]);
  const [sizes, setSizes] = useState<number[]>([16, 24, 32, 48, 64, 128, 256]);
  const [shape, setShape] = useState<Shape>("square");
  const [padding, setPadding] = useState(0);
  const [filled, setFilled] = useState(false);
  const [color, setColor] = useState("#ffffff");
  const [name, setName] = useState("");
  const [job, setJob] = useState<Job>({ kind: "ready" });
  const [result, setResult] = useState<(TaskResult & { notes: string[] }) | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => (preview ? () => URL.revokeObjectURL(preview) : undefined), [preview]);
  useEffect(() => (result ? () => URL.revokeObjectURL(result.url) : undefined), [result]);

  const busy = isBusy(job);
  const reset = () => {
    abortRef.current?.abort();
    setResult(null);
    setJob({ kind: "ready" });
  };
  const choose = (f: File) => {
    if (f.size === 0) return setRejected("That picture is empty.");
    if (f.size > MAX_MB * 1024 * 1024) return setRejected(`That picture is over ${MAX_MB} MB.`);
    if (!/\.(png|jpe?g|webp|gif|bmp|tiff?|svg|heic|heif|avif|psd|ico)$/i.test(f.name))
      return setRejected("Use a picture: PNG, SVG, JPG, WebP, HEIC, GIF, BMP, TIFF, AVIF, PSD or ICO.");
    reset();
    setRejected(null);
    setFile(f);
    setPreviewFailed(false);
    setPreview(URL.createObjectURL(f));
    if (!name) setName(f.name.replace(/\.[^.]+$/, "").slice(0, 40));
  };
  const clear = () => {
    reset();
    setFile(null);
    setPreview(null);
  };

  const start = async () => {
    if (!file) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const form = new FormData();
    form.append("file", file, file.name);
    form.append(
      "options",
      JSON.stringify({
        mode,
        packs,
        sizes,
        shape,
        padding: padding / 100,
        background: filled ? color : null,
        name: name.trim() || null,
      }),
    );
    setJob({ kind: "uploading", progress: 0 });
    try {
      const out = await uploadForm(ENDPOINT, form, {
        signal: ctrl.signal,
        fallbackName: mode === "ico" ? "icon.ico" : "icons.zip",
        onUpload: (p) => setJob(p >= 1 ? { kind: "processing" } : { kind: "uploading", progress: p }),
        onProcessing: () => setJob({ kind: "processing" }),
      });
      const parts = out.name.endsWith(".zip") ? await listZip(out.blob).catch(() => null) : null;
      let notes: string[] = [];
      try {
        notes = (JSON.parse(out.info ?? "{}") as { notes?: string[] }).notes ?? [];
      } catch {
        notes = [];
      }
      setResult({
        ...out,
        url: URL.createObjectURL(out.blob),
        saved: false,
        parts,
        notes,
      });
      setJob({ kind: "ready" });
    } catch (e) {
      if (ctrl.signal.aborted) return setJob({ kind: "ready" });
      setJob({ kind: "failed", message: messageOf(e) });
    }
  };

  const step = !file ? 0 : !result ? 1 : result.saved ? 3 : 2;
  const look = {
    src: preview,
    failed: previewFailed,
    shape,
    padding,
    background: filled ? color : null,
  };
  const invalid = mode === "pack" ? (!packs.length ? "Pick at least one platform." : null) : !sizes.length ? "Pick at least one size." : null;

  return (
    <Workbench
      steps={stepsFor(tool)}
      current={step}
      footer={<>Your picture is turned into icons on our server and deleted as soon as they&apos;re sent. Nothing is kept, and it&apos;s free.</>}
    >
      <div className="space-y-3 p-3 sm:p-4">
        {!file ? (
          <FileDrop
            accept={ACCEPT}
            title="Drop your logo or picture"
            formats="PNG or SVG works best · square, 1024 px or larger · JPG, WebP, HEIC… too"
            error={rejected}
            onFile={choose}
          />
        ) : (
          <FileRow file={file} noun="picture" locked={busy} accept={ACCEPT} onReplace={choose} onClear={clear} />
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
                  kindLabel={mode === "ico" ? "ICO" : undefined}
                  backLabel="Change the icons"
                  onBack={reset}
                  onSave={() => {
                    saveBlob(result.blob, result.name);
                    setResult({ ...result, saved: true });
                  }}
                  note={result.notes.join(" ") || (mode === "pack" ? "README.txt in the ZIP says where each folder goes." : undefined)}
                />
              </motion.div>
            ) : (
              <motion.div key="options" {...swap} className="@container">
                <div className="grid gap-3 @3xl:grid-cols-[minmax(0,1fr)_280px]">
                  <div className="order-2 min-w-0 space-y-3 @3xl:order-1">
                    <Panel>
                      <Row label="Make">
                        <Chips
                          value={mode}
                          onChange={setMode}
                          disabled={busy}
                          options={[
                            { value: "pack", label: "Icons for platforms" },
                            { value: "ico", label: "Just an .ico file" },
                          ]}
                        />
                      </Row>
                      {mode === "pack" ? (
                        <Row label="Platforms" hint={`${packs.length} of ${PACKS.length}`}>
                          <div className="grid grid-cols-1 gap-1.5 @sm:grid-cols-2 @3xl:grid-cols-1 @5xl:grid-cols-2">
                            {PACKS.map((p) => {
                              const on = packs.includes(p.id);
                              const Icon = p.icon;
                              return (
                                <button
                                  key={p.id}
                                  type="button"
                                  role="checkbox"
                                  aria-checked={on}
                                  disabled={busy}
                                  onClick={() => setPacks((v) => (on ? v.filter((x) => x !== p.id) : [...v, p.id]))}
                                  className={cn(
                                    "flex min-w-0 items-center gap-2.5 rounded-md border px-2.5 py-2 text-left transition-colors duration-150 disabled:opacity-60",
                                    on ? "border-ink bg-ink text-paper" : "border-line bg-surface text-ink hover:border-ink-3",
                                  )}
                                >
                                  <span
                                    className={cn(
                                      "flex size-8 shrink-0 items-center justify-center rounded-sm border",
                                      on ? "border-paper/25" : "border-line bg-paper text-ink-2",
                                    )}
                                  >
                                    {on ? <Check aria-hidden className="size-4" /> : <Icon aria-hidden className="size-4" />}
                                  </span>
                                  <span className="min-w-0">
                                    <span className="block text-sm font-medium">{p.label}</span>
                                    <span className={cn("block truncate text-xs", on ? "text-paper-dim" : "text-ink-3")}>{p.files}</span>
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </Row>
                      ) : (
                        <Row label="Sizes in the .ico" hint="Windows uses 16, 32, 48 and 256">
                          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Sizes">
                            {ICO_SIZES.map((s) => {
                              const on = sizes.includes(s);
                              return (
                                <button
                                  key={s}
                                  type="button"
                                  role="checkbox"
                                  aria-checked={on}
                                  disabled={busy}
                                  onClick={() => setSizes((v) => (on ? v.filter((x) => x !== s) : [...v, s].sort((a, b) => a - b)))}
                                  className={cn(
                                    "inline-flex h-8 items-center rounded-sm border px-2.5 font-mono text-[13px] transition-colors duration-150 disabled:opacity-60",
                                    on ? "border-ink bg-ink text-paper" : "border-line bg-surface text-ink-2 hover:border-ink-3 hover:text-ink",
                                  )}
                                >
                                  {s}
                                </button>
                              );
                            })}
                          </div>
                        </Row>
                      )}
                      <Row label="Shape">
                        <Chips
                          value={shape}
                          onChange={setShape}
                          disabled={busy}
                          options={[
                            { value: "square", label: "As it is" },
                            { value: "rounded", label: "Rounded" },
                            { value: "circle", label: "Round" },
                          ]}
                        />
                        <p className="mt-2 text-xs text-ink-3">iOS rounds its icons itself, so iOS and the Apple touch icon always stay square.</p>
                      </Row>
                      <Row label="Padding">
                        <Slider value={padding} min={0} max={30} onChange={setPadding} format={(v) => `${v}%`} label="Padding" disabled={busy} />
                      </Row>
                      <Row label="Background">
                        <Toggle
                          checked={filled}
                          onChange={setFilled}
                          disabled={busy}
                          label="Fill the background"
                          description="Off keeps it transparent (iOS and Apple touch icons get white, as Apple requires)."
                        />
                        {filled && (
                          <div className="mt-2.5">
                            <Swatches value={color} colors={COLORS} onChange={setColor} disabled={busy} />
                          </div>
                        )}
                      </Row>
                      {mode === "pack" && packs.includes("web") && (
                        <Row label="App name">
                          <TextField label="App name" value={name} onChange={setName} placeholder="My app" maxLength={40} disabled={busy} />
                          <p className="mt-1.5 text-xs text-ink-3">Shown when someone installs your site as an app (site.webmanifest).</p>
                        </Row>
                      )}
                    </Panel>
                    <ProgressButton
                      job={job}
                      disabled={Boolean(invalid)}
                      label={mode === "ico" ? `Make the .ico (${plural(sizes.length, "size")})` : `Make icons for ${plural(packs.length, "platform")}`}
                      working="Drawing the icons…"
                      hint={
                        invalid ??
                        (mode === "ico"
                          ? "One .ico file with every size you picked."
                          : "One ZIP with a folder per platform and a README saying where each goes.")
                      }
                      onStart={start}
                      onCancel={() => abortRef.current?.abort()}
                    />
                  </div>
                  <div className="order-1 @3xl:order-2">
                    <div className="@3xl:sticky @3xl:top-24">
                      <IconPreview look={look} name={name || "My app"} onFail={() => setPreviewFailed(true)} />
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </div>
    </Workbench>
  );
}

/* ---------------------------------------------------------------------------------------------- */
/* Live preview: the same shape, padding and background the server draws, on the places icons live */
/* ---------------------------------------------------------------------------------------------- */

type Look = {
  src: string | null;
  failed: boolean;
  shape: Shape;
  padding: number;
  background: string | null;
};

const RADIUS: Record<Shape, string> = {
  square: "0",
  rounded: "22.5%",
  circle: "50%",
};

function Icon({ look, size, onFail, className, square = false }: { look: Look; size: number; onFail?: () => void; className?: string; square?: boolean }) {
  const shape = square ? "square" : look.shape;
  return (
    <span
      className={cn("relative block shrink-0 overflow-hidden", !look.background && "bg-transparent", className)}
      style={{
        width: size,
        height: size,
        borderRadius: RADIUS[shape],
        background: look.background ?? (square ? "#ffffff" : undefined),
        padding: `${look.padding}%`,
      }}
    >
      {look.src && !look.failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={look.src} alt="" draggable={false} onError={onFail} className="size-full object-contain" />
      ) : (
        <span className="flex size-full items-center justify-center rounded-[inherit] bg-paper-2 font-mono text-[10px] text-ink-3">IMG</span>
      )}
    </span>
  );
}

function IconPreview({ look, name, onFail }: { look: Look; name: string; onFail: () => void }) {
  return (
    <div className="@container overflow-hidden rounded-md border border-line bg-surface">
      <p className="label-mono border-b border-line px-3 py-2 text-ink-3">Preview</p>
      {/* Wide (stacked above the options): the big icon beside the mock-ups. Narrow: one column. */}
      <div className="grid @lg:grid-cols-2">
        <div className={cn("flex items-center justify-center py-6 @lg:border-r @lg:border-line", CHECKER)}>
          <Icon look={look} size={144} onFail={onFail} className="shadow-card" />
        </div>
        <div>
          {look.failed && (
            <p className="border-t border-line px-3 py-2 text-xs text-ink-3 @lg:border-t-0">
              Your browser can&apos;t show this format; the icons will still be made from it.
            </p>
          )}

          {/* Browser tab */}
          <div className="border-t border-line px-3 py-3 @lg:border-t-0">
            <p className="label-mono mb-2 text-ink-3">Browser tab</p>
            <div className="flex items-center gap-2 rounded-t-md border border-b-0 border-line bg-paper px-2.5 py-1.5">
              <Icon look={look} size={16} />
              <span className="min-w-0 truncate text-xs text-ink">{name}</span>
            </div>
            <div className="h-1.5 rounded-b-md border border-line bg-paper-2" />
          </div>

          {/* Phone home screen: iOS shows its own rounding */}
          <div className="border-t border-line px-3 py-3">
            <p className="label-mono mb-2 text-ink-3">Home screen</p>
            <div className="grid grid-cols-4 gap-2 rounded-md bg-ink p-3">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex flex-col items-center gap-1">
                  {i === 1 ? (
                    <span className="block overflow-hidden rounded-[22.5%]">
                      <Icon look={look} size={44} square />
                    </span>
                  ) : (
                    <span className="block size-11 rounded-[22.5%] bg-paper/15" />
                  )}
                  <span className="h-1 w-8 rounded-full bg-paper/25" />
                </div>
              ))}
            </div>
          </div>

          {/* Sizes, actual pixels */}
          <div className="border-t border-line px-3 py-3">
            <p className="label-mono mb-2 text-ink-3">Actual size</p>
            <div className={cn("flex items-end gap-3 rounded-sm px-2 py-2", CHECKER)}>
              {[16, 24, 32, 48, 64].map((s) => (
                <span key={s} className="flex flex-col items-center gap-1">
                  <Icon look={look} size={s} />
                  <span className="font-mono text-[12px] text-ink-3">{s}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
