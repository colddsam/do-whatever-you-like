"use client";

import { useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  CalendarDays,
  Check,
  ChevronDown,
  Contact,
  Copy,
  Download,
  Eye,
  EyeOff,
  Link2,
  Loader2,
  LocateFixed,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  QrCode,
  RotateCcw,
  TriangleAlert,
  Type,
  Wifi,
  X,
  type LucideIcon,
} from "lucide-react";
import { getTool, stepsFor } from "@/lib/tools";
import { formatBytes } from "@/lib/media";
import { checkFile, FileToolError, saveBlob, uploadForm, type Converted } from "@/lib/files";
import {
  BACK_SWATCHES,
  buildForm,
  checkContent,
  CONTENT,
  CONTENT_TYPES,
  contentData,
  DEFAULT_LOGO,
  DEFAULT_LOOK,
  EC_LEVELS,
  EYE_STYLES,
  FILL_SWATCHES,
  formatBlock,
  FORMATS,
  isContentType,
  LOGO_EXTENSIONS,
  LOGO_MAX_MB,
  MASKS,
  MODULE_STYLES,
  parseHex,
  prepareLogo,
  QR_ENDPOINT,
  QR_MAX_CHARS,
  qrFilename,
  scannerReads,
  scanWarning,
  svgDrops,
  type ContentType,
  type EyeStyle,
  type Fields,
  type LogoOptions,
  type Look,
  type ModuleStyle,
  type OutputFormat,
  type WifiExtras,
} from "@/lib/qrcode";
import { cn } from "@/lib/utils";
import { FileDrop } from "./file-drop";
import { useDebouncedTask } from "./use-debounced-task";
import { Workbench } from "./workbench";

const EASE = [0.22, 1, 0.36, 1] as const;

const ICONS: Record<ContentType, LucideIcon> = {
  url: Link2,
  text: Type,
  wifi: Wifi,
  vcard: Contact,
  email: Mail,
  sms: MessageSquare,
  phone: Phone,
  geo: MapPin,
  event: CalendarDays,
};

type Logo = { file: Blob; name: string; src: string; size: number };
/** The code as last made: the file in the chosen format, plus an image to show (a PNG for PDFs). */
type Made = { key: string; file: Converted; view: string; width: number | null; modules: number | null };

const messageOf = (e: unknown) =>
  e instanceof FileToolError ? e.message : "Something went wrong. Check your connection and try again.";
const isAbort = (e: unknown) => e instanceof DOMException && e.name === "AbortError";
const sameLook = (a: Look, b: Look) => (Object.keys(a) as (keyof Look)[]).every((k) => k === "format" || a[k] === b[k]);

/** Rounds up to the next hour, as a datetime-local value, so a new event starts sensibly filled. */
function nextHour(offsetHours = 0) {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1 + offsetHours);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:00`;
}

/** Module count and pixel width, read from the image the backend made. */
async function measure(view: Converted, url: string, look: Look): Promise<Pick<Made, "width" | "modules">> {
  if (view.type.includes("svg")) {
    // SVG codes are drawn in millimetres: one module is box_size / 10 mm.
    const vb = /viewBox="0 0 ([\d.]+)/.exec(await view.blob.text());
    const modules = vb ? Math.round(Number(vb[1]) / (look.boxSize / 10)) - look.border * 2 : null;
    return { width: null, modules };
  }
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch {
    return { width: null, modules: null };
  }
  return { width: img.naturalWidth, modules: Math.round(img.naturalWidth / look.boxSize) - look.border * 2 };
}

/**
 * The QR generator. Whatever is typed is drawn live: every change (debounced) asks the backend
 * for the real file in the chosen format, so the preview is exactly what downloads and the
 * Download button shows its exact size. PDFs also fetch a PNG of the same code to show.
 */
export function QrPlayground({ toolId }: { toolId: string }) {
  const tool = getTool(toolId)!;
  const [type, setType] = useState<ContentType>("url");
  const [fields, setFields] = useState<Fields>({});
  const [wifi, setWifi] = useState<WifiExtras>({ encryption: "WPA", hidden: false });
  const [look, setLook] = useState<Look>(DEFAULT_LOOK);
  const [logo, setLogo] = useState<Logo | null>(null);
  const [logoOpts, setLogoOpts] = useState<LogoOptions>(DEFAULT_LOGO);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [made, setMade] = useState<Made | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  // Deep links: /tools/qr?type=wifi opens straight on that kind of code.
  useEffect(() => {
    const t = setTimeout(() => {
      const q = new URLSearchParams(window.location.search).get("type");
      if (isContentType(q)) setType(q);
    }, 0);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => (made ? () => URL.revokeObjectURL(made.view) : undefined), [made]);
  useEffect(() => (logo ? () => URL.revokeObjectURL(logo.src) : undefined), [logo]);

  /* ----- What will be made ----- */

  const problem = checkContent(type, fields, wifi);
  const reads = problem ? "" : scannerReads(type, fields, wifi);
  const tooLong = reads.length > QR_MAX_CHARS;
  const blocked = formatBlock(look.format, look, Boolean(logo));
  const ready = !problem && !tooLong && !blocked;
  const key = ready
    ? JSON.stringify([type, contentData(type, fields, wifi), look, logo?.src ?? null, logo ? logoOpts : null, nonce])
    : null;

  useDebouncedTask(
    key,
    async (signal) => {
      const format = look.format;
      const logoArg = logo ? { file: logo.file, name: logo.name, options: logoOpts } : null;
      const ask = (f: OutputFormat) =>
        uploadForm(QR_ENDPOINT, buildForm(type, fields, wifi, look, f, logoArg), {
          signal,
          fallbackName: qrFilename(type, fields, f),
        });
      try {
        const [file, png] = await Promise.all([ask(format), format === "pdf" ? ask("png") : null]);
        const shown = png ?? file;
        const view = URL.createObjectURL(shown.blob);
        const dims = await measure(shown, view, look);
        if (signal.aborted) return URL.revokeObjectURL(view);
        setMade({ key: key!, file, view, ...dims });
        setFailure(null);
      } catch (e) {
        if (isAbort(e) || signal.aborted) return;
        setFailure({ key: key!, message: messageOf(e) });
      }
    },
    350,
  );

  const current = Boolean(key) && made?.key === key;
  const failed = Boolean(key) && failure?.key === key;
  const measuring = Boolean(key) && !current && !failed;
  const saved = current && savedKey === key;
  const step = !ready ? 0 : !current ? 1 : saved ? 3 : 2;

  /* ----- Changes ----- */

  const switchType = (t: ContentType) => {
    if (t === type) return;
    setType(t);
    setNote(null);
    // A new event starts at the next hour and runs for one, so only the title is left to type.
    if (t === "event" && !fields.start) setFields((f) => ({ ...f, start: nextHour(), end: nextHour(1) }));
    const url = new URL(window.location.href);
    url.searchParams.set("type", t);
    window.history.replaceState(window.history.state, "", url);
  };

  const setField = (k: string, value: string) => setFields((f) => ({ ...f, [k]: value }));

  const patchLook = (p: Partial<Look>) => {
    const next = { ...look, ...p };
    // Keep the format valid rather than refusing the change people just made.
    const clash = formatBlock(next.format, next, Boolean(logo));
    if (clash) {
      next.format = "png";
      setNote(`${clash} Switched to PNG.`);
    } else if (p.format) setNote(null);
    setLook(next);
  };

  const addLogo = async (file: File) => {
    const err = checkFile(file, LOGO_EXTENSIONS, LOGO_MAX_MB);
    setLogoError(err);
    if (err) return;
    const prepared = await prepareLogo(file);
    setLogo({ ...prepared, size: file.size });
    if (look.format === "svg") {
      setLook((l) => ({ ...l, format: "png" }));
      setNote("SVG can't hold a centre logo. Switched to PNG.");
    }
  };

  const save = () => {
    if (!current || !made) return;
    saveBlob(made.file.blob, qrFilename(type, fields, look.format));
    setSavedKey(key);
  };

  const geoLocate = (done: (err: string | null) => void) => {
    if (!("geolocation" in navigator)) return done("This browser can't share its location.");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setFields((f) => ({ ...f, lat: pos.coords.latitude.toFixed(6), lng: pos.coords.longitude.toFixed(6) }));
        done(null);
      },
      () => done("Location was blocked. Type the coordinates instead."),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  const warning = ready ? scanWarning(look) : null;
  const drops = look.format === "svg" ? svgDrops(look) : [];

  return (
    <Workbench
      steps={stepsFor(tool)}
      current={step}
      footer={
        <>
          Codes are made on our server and deleted as soon as they&apos;re sent. Nothing you type is kept. A QR code
          never expires: it works for as long as whatever it points to does.
        </>
      }
    >
      <TypeSwitch type={type} onChange={switchType} />

      <div className="grid gap-4 p-3 sm:p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,17.5rem)] md:gap-5">
        {/* ---------- 01 · Content ---------- */}
        <section aria-labelledby="qr-content" className="min-w-0 md:col-start-1 md:row-start-1">
          <div className="flex items-baseline justify-between gap-3">
            <h3 id="qr-content" className="label-mono text-ink-3">
              {CONTENT[type].label} · {CONTENT[type].hint}
            </h3>
            {ready && (
              <span className={cn("font-mono text-[12px] tabular-nums", tooLong ? "text-danger" : "text-ink-3")}>
                {reads.length.toLocaleString()} / {QR_MAX_CHARS.toLocaleString()}
              </span>
            )}
          </div>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={type}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0, transition: { duration: 0.35, ease: EASE } }}
              exit={{ opacity: 0, y: -4, transition: { duration: 0.12 } }}
            >
              <ContentForm type={type} fields={fields} wifi={wifi} onField={setField} onWifi={setWifi} onLocate={geoLocate} />
            </motion.div>
          </AnimatePresence>
        </section>

        {/* ---------- Preview + download (beside the form on wider screens) ---------- */}
        <aside aria-label="Your QR code" className="min-w-0 md:col-start-2 md:row-span-2 md:row-start-1">
          <div className="md:sticky md:top-24">
            <Plate
              made={made}
              current={current}
              measuring={measuring}
              transparent={look.back === "transparent"}
              problem={problem ?? (tooLong ? "That's more than a QR code can hold. Shorten it a little." : null)}
              failure={failed ? failure!.message : null}
              onRetry={() => setNonce((n) => n + 1)}
            />
            <p className="label-mono mt-2.5 flex items-center gap-2 text-ink-3">
              <span aria-hidden className="h-px w-5 bg-ink-3" />
              Fig. 01 —{" "}
              {made?.modules ? `${made.modules} × ${made.modules} modules · EC ${logo ? "H" : look.ec}` : "Your code"}
            </p>

            <FormatPicker
              value={look.format}
              blockedBy={(f) => formatBlock(f, look, Boolean(logo))}
              onChange={(format) => patchLook({ format })}
            />

            <DownloadRow
              format={look.format}
              made={current ? made : null}
              saved={saved}
              measuring={measuring}
              disabled={!ready}
              onSave={save}
            />
            <Dimensions made={current ? made : null} format={look.format} />

            {(note || warning || drops.length > 0) && (
              <ul className="mt-3 space-y-1.5 border-t border-line pt-3">
                {note && <Notice>{note}</Notice>}
                {drops.length > 0 && (
                  <Notice>SVG stays flat, so the {joinWords(drops)} only show in PNG, WebP, JPEG and PDF.</Notice>
                )}
                {warning && <Notice tone="warning">{warning}</Notice>}
              </ul>
            )}

            {ready && <ScannerReads text={type === "wifi" ? maskWifi(reads) : reads} />}
          </div>
        </aside>

        {/* ---------- 02 · Look ---------- */}
        <section
          aria-labelledby="qr-look"
          className="min-w-0 rounded-md border border-dashed border-line px-3 py-3 sm:px-4 sm:py-4 md:col-start-1 md:row-start-2"
        >
          <div className="flex items-center justify-between gap-3">
            <h3 id="qr-look" className="label-mono text-ink-3">
              Look
            </h3>
            {(!sameLook(look, DEFAULT_LOOK) || logo) && (
              <button
                type="button"
                onClick={() => {
                  setLook((l) => ({ ...DEFAULT_LOOK, format: l.format }));
                  setLogo(null);
                  setLogoOpts(DEFAULT_LOGO);
                  setNote(null);
                }}
                className="-my-1 inline-flex h-8 items-center gap-1.5 rounded-sm px-2 text-xs text-ink-2 transition-colors hover:bg-paper-2 hover:text-ink"
              >
                <RotateCcw aria-hidden className="size-3" /> Reset
              </button>
            )}
          </div>

          <LookPanel
            look={look}
            onLook={patchLook}
            logo={logo}
            logoOpts={logoOpts}
            logoError={logoError}
            onLogo={addLogo}
            onLogoOpts={(p) => setLogoOpts((o) => ({ ...o, ...p }))}
            onRemoveLogo={() => {
              setLogo(null);
              setLogoError(null);
            }}
          />
        </section>
      </div>
    </Workbench>
  );
}

const joinWords = (w: string[]) => (w.length < 2 ? w.join("") : `${w.slice(0, -1).join(", ")} and ${w.at(-1)}`);
const maskWifi = (s: string) => s.replace(/;P:((?:\\.|[^;])*);/, (_, p: string) => `;P:${p ? "•".repeat(Math.min(p.length, 12)) : ""};`);

/* ---------- Content type switch ---------- */

/** Nine segments under the step tracker; the ink thumb slides between them (the PDF mode switch, wider). */
function TypeSwitch({ type, onChange }: { type: ContentType; onChange: (t: ContentType) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const delta = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const n = (i + delta + CONTENT_TYPES.length) % CONTENT_TYPES.length;
    refs.current[n]?.focus();
    refs.current[n]?.scrollIntoView({ block: "nearest", inline: "nearest" });
    onChange(CONTENT_TYPES[n]);
  };

  return (
    <div className="border-b border-line bg-paper/60 p-2 sm:px-3">
      <div
        role="tablist"
        aria-label="What the code holds"
        className="-m-1 flex gap-1 overflow-x-auto p-1 [scrollbar-width:none] md:grid md:grid-cols-9 [&::-webkit-scrollbar]:hidden"
      >
        {CONTENT_TYPES.map((t, i) => {
          const Icon = ICONS[t];
          const active = t === type;
          return (
            <button
              key={t}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              onClick={() => onChange(t)}
              onKeyDown={(e) => onKey(e, i)}
              className={cn(
                "group relative flex h-14 min-w-[4.25rem] shrink-0 flex-col items-center justify-center gap-1 rounded-md px-2 text-[13px] transition-colors duration-150 md:min-w-0",
                active ? "text-paper" : "text-ink-2 hover:bg-paper-2 hover:text-ink",
              )}
            >
              {active && (
                <motion.span
                  layoutId="qr-type-thumb"
                  aria-hidden
                  className="absolute inset-0 rounded-md bg-ink"
                  transition={{ type: "spring", bounce: 0.22, duration: 0.5 }}
                />
              )}
              <Icon aria-hidden className="relative size-4 shrink-0" />
              <span className="relative font-medium leading-none">{CONTENT[t].label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- Content form ---------- */

const inputClass =
  "mt-1.5 h-11 w-full rounded-md border border-line bg-surface px-3.5 text-[15px] text-ink outline-none transition-[border-color,box-shadow] placeholder:text-ink-3 focus:border-ink focus:ring-4 focus:ring-accent/15";

function ContentForm({
  type,
  fields,
  wifi,
  onField,
  onWifi,
  onLocate,
}: {
  type: ContentType;
  fields: Fields;
  wifi: WifiExtras;
  onField: (k: string, v: string) => void;
  onWifi: (w: WifiExtras) => void;
  onLocate: (done: (err: string | null) => void) => void;
}) {
  const id = useId();
  const [reveal, setReveal] = useState(false);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const defs = CONTENT[type].fields.filter((f) => !(type === "wifi" && f.key === "password" && wifi.encryption === "nopass"));

  return (
    <div className="mt-3 space-y-3">
      {type === "wifi" && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div role="radiogroup" aria-label="Security" className="flex gap-1.5">
            {(
              [
                ["WPA", "WPA / WPA2"],
                ["WEP", "WEP"],
                ["nopass", "None"],
              ] as const
            ).map(([value, label]) => (
              <Chip key={value} role="radio" selected={wifi.encryption === value} onClick={() => onWifi({ ...wifi, encryption: value })}>
                {label}
              </Chip>
            ))}
          </div>
          <label className="inline-flex h-9 cursor-pointer items-center gap-2 text-sm text-ink-2">
            <input
              type="checkbox"
              checked={wifi.hidden}
              onChange={(e) => onWifi({ ...wifi, hidden: e.target.checked })}
              className="size-4 cursor-pointer accent-ink"
            />
            Hidden network
          </label>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {defs.map((f) => {
          const fid = `${id}-${f.key}`;
          const value = fields[f.key] ?? "";
          const isPassword = f.type === "password";
          return (
            <div key={f.key} className={cn(f.half ? "sm:col-span-1" : "sm:col-span-2")}>
              <label htmlFor={fid} className="flex items-baseline justify-between gap-2">
                <span className="label-mono text-ink-2">{f.label}</span>
                {!f.required && !(type === "wifi" && isPassword) && <span className="text-xs text-ink-3">Optional</span>}
              </label>
              {f.type === "textarea" ? (
                <textarea
                  id={fid}
                  value={value}
                  maxLength={f.max}
                  rows={type === "text" ? 4 : 3}
                  placeholder={f.placeholder}
                  onChange={(e) => onField(f.key, e.target.value)}
                  className={cn(inputClass, "h-auto min-h-24 resize-y py-2.5 leading-relaxed")}
                />
              ) : (
                <div className="relative">
                  <input
                    id={fid}
                    type={isPassword ? (reveal ? "text" : "password") : f.type === "number" ? "text" : (f.type ?? "text")}
                    inputMode={f.type === "number" ? "decimal" : f.type === "url" ? "url" : undefined}
                    value={value}
                    maxLength={f.max}
                    placeholder={f.placeholder}
                    autoComplete={f.autoComplete ?? (isPassword ? "off" : undefined)}
                    spellCheck={f.mono || isPassword ? false : undefined}
                    onChange={(e) => onField(f.key, e.target.value)}
                    className={cn(inputClass, (f.mono || isPassword) && "font-mono text-[14px]", isPassword && "pr-12")}
                  />
                  {isPassword && (
                    <button
                      type="button"
                      onClick={() => setReveal((r) => !r)}
                      aria-label={reveal ? "Hide password" : "Show password"}
                      aria-pressed={reveal}
                      className="absolute right-1 top-1/2 mt-[3px] inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-[8px] text-ink-3 transition-colors hover:bg-paper-2 hover:text-ink"
                    >
                      {reveal ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {type === "geo" && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={locating}
            onClick={() => {
              setLocating(true);
              setGeoError(null);
              onLocate((err) => {
                setLocating(false);
                setGeoError(err);
              });
            }}
            className="inline-flex h-9 items-center gap-1.5 rounded-[8px] border border-line bg-paper px-3 text-sm text-ink-2 transition-colors hover:border-ink-3 hover:text-ink disabled:cursor-progress"
          >
            {locating ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <LocateFixed aria-hidden className="size-4" />}
            Use my location
          </button>
          {geoError && (
            <p role="alert" className="text-xs text-danger">
              {geoError}
            </p>
          )}
        </div>
      )}
      {type === "event" && (
        <p className="text-xs text-ink-3">Times are saved in UTC, so phones show them in their own time zone.</p>
      )}
    </div>
  );
}

/* ---------- Preview ---------- */

/** The code on a small proof plate, with crop marks at the corners. */
function Plate({
  made,
  current,
  measuring,
  transparent,
  problem,
  failure,
  onRetry,
}: {
  made: Made | null;
  current: boolean;
  measuring: boolean;
  transparent: boolean;
  problem: string | null;
  failure: string | null;
  onRetry: () => void;
}) {
  const stale = Boolean(made) && !current;
  return (
    <div
      className={cn(
        "relative aspect-square overflow-hidden rounded-md border border-line",
        transparent
          ? "bg-[conic-gradient(var(--color-paper-2)_25%,var(--color-surface)_0_50%,var(--color-paper-2)_0_75%,var(--color-surface)_0)] bg-[length:14px_14px]"
          : "bg-paper",
      )}
    >
      {/* Crop marks */}
      {["left-2 top-2 border-l border-t", "right-2 top-2 border-r border-t", "bottom-2 left-2 border-b border-l", "bottom-2 right-2 border-b border-r"].map(
        (c) => (
          <span key={c} aria-hidden className={cn("absolute size-3 border-ink-3/70", c)} />
        ),
      )}

      <AnimatePresence initial={false}>
        {made ? (
          <motion.img
            key={made.view}
            src={made.view}
            alt={current ? "Preview of your QR code" : "Your previous QR code"}
            initial={{ opacity: 0, scale: 0.985 }}
            animate={{ opacity: stale ? 0.35 : 1, scale: 1, transition: { duration: 0.35, ease: EASE } }}
            exit={{ opacity: 0, transition: { duration: 0.2 } }}
            className="absolute inset-0 m-auto size-[calc(100%-2.5rem)] object-contain"
            draggable={false}
          />
        ) : (
          <motion.div
            key="empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 flex flex-col items-center justify-center px-8 text-center"
          >
            <QrCode aria-hidden className="size-16 text-ink-3/60" strokeWidth={1} />
            <p className="mt-4 text-sm leading-snug text-ink-2">
              {measuring ? "Drawing your code…" : (problem ?? "Your code draws itself here as you type.")}
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* States over an existing code */}
      {made && (problem || failure) && (
        <div className="absolute inset-x-3 bottom-3 rounded-sm border border-line bg-surface/95 px-3 py-2 text-xs leading-snug shadow-card">
          {failure ? (
            <span className="text-danger">
              {failure}
              <button
                type="button"
                onClick={onRetry}
                className="ml-2 inline-flex items-center gap-1 text-ink-2 underline-offset-4 hover:text-ink hover:underline"
              >
                <RotateCcw aria-hidden className="size-3" /> Retry
              </button>
            </span>
          ) : (
            <span className="text-ink-2">Not updated yet. {problem}</span>
          )}
        </div>
      )}
      {!made && failure && (
        <div className="absolute inset-x-3 bottom-3 text-center text-xs text-danger">
          {failure}
          <button type="button" onClick={onRetry} className="ml-2 text-ink-2 underline underline-offset-4 hover:text-ink">
            Retry
          </button>
        </div>
      )}
      {measuring && made && (
        <span className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-sm border border-line bg-surface/95 px-2 py-1 font-mono text-[12px] text-ink-3">
          <Loader2 aria-hidden className="size-3 animate-spin" />
          drawing
        </span>
      )}
      <span aria-live="polite" className="sr-only">
        {current ? "Preview updated." : ""}
      </span>
    </div>
  );
}

function FormatPicker({
  value,
  blockedBy,
  onChange,
}: {
  value: OutputFormat;
  blockedBy: (f: OutputFormat) => string | null;
  onChange: (f: OutputFormat) => void;
}) {
  const hint = FORMATS.find((f) => f.value === value)?.hint;
  return (
    <div className="mt-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="label-mono text-ink-3">Format</p>
        <p className="text-xs text-ink-3">{hint}</p>
      </div>
      <div role="radiogroup" aria-label="File format" className="mt-2 grid grid-cols-5 gap-1">
        {FORMATS.map((f) => {
          const reason = blockedBy(f.value);
          return (
            <button
              key={f.value}
              type="button"
              role="radio"
              aria-checked={value === f.value}
              disabled={Boolean(reason)}
              title={reason ?? f.hint}
              onClick={() => onChange(f.value)}
              className={cn(
                "inline-flex h-9 items-center justify-center rounded-sm border font-mono text-[12px] font-medium tracking-[0.04em] transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-35",
                value === f.value
                  ? "border-ink bg-ink text-paper"
                  : "border-line bg-surface text-ink-2 hover:border-ink-3 hover:text-ink",
              )}
            >
              {f.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DownloadRow({
  format,
  made,
  saved,
  measuring,
  disabled,
  onSave,
}: {
  format: OutputFormat;
  made: Made | null;
  saved: boolean;
  measuring: boolean;
  disabled: boolean;
  onSave: () => void;
}) {
  const label = FORMATS.find((f) => f.value === format)!.label;
  const [copied, setCopied] = useState(false);
  // Read after mount: the server can't know, and guessing would break hydration.
  const [clipboard, setClipboard] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setClipboard("ClipboardItem" in window && Boolean(navigator.clipboard?.write)), 0);
    return () => clearTimeout(t);
  }, []);
  const canCopy = format === "png" && clipboard;

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(t);
  }, [copied]);

  const copy = async () => {
    if (!made) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": made.file.blob })]);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="mt-3 flex gap-2">
      <button
        type="button"
        onClick={onSave}
        disabled={disabled || !made}
        className="group relative inline-flex h-12 min-w-0 flex-1 items-center justify-center gap-2 overflow-hidden rounded-md bg-ink px-4 text-[15px] font-medium text-paper transition-[background-color,transform,opacity] duration-150 hover:bg-ink/85 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-ink disabled:active:translate-y-0"
      >
        {measuring && (
          <motion.span
            aria-hidden
            className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-paper/15 to-transparent"
            initial={{ left: "-33%" }}
            animate={{ left: "100%" }}
            transition={{ duration: 1.4, ease: "easeInOut", repeat: Infinity }}
          />
        )}
        <span className="relative inline-flex min-w-0 items-center gap-2">
          {saved ? <Check aria-hidden className="size-4 shrink-0" /> : <Download aria-hidden className="size-4 shrink-0" />}
          <span className="truncate">{saved ? "Saved. Again" : `Download ${label}`}</span>
          {made ? (
            <span className="font-mono text-[13px] font-normal text-paper/60">{formatBytes(made.file.size)}</span>
          ) : measuring ? (
            <Loader2 aria-hidden className="size-3.5 animate-spin text-paper/60" />
          ) : null}
        </span>
      </button>
      {canCopy && (
        <button
          type="button"
          onClick={copy}
          disabled={!made}
          aria-label={copied ? "Copied" : "Copy image"}
          title={copied ? "Copied" : "Copy image"}
          className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-md border border-line bg-surface text-ink transition-colors hover:border-ink-3 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {copied ? <Check aria-hidden className="size-4 text-success" /> : <Copy aria-hidden className="size-4" />}
        </button>
      )}
    </div>
  );
}

/** What the file actually is: pixels for images, print size for PDFs, "any size" for SVG. */
function Dimensions({ made, format }: { made: Made | null; format: OutputFormat }) {
  let text = "Size appears once it's drawn.";
  if (made) {
    if (format === "svg") text = "Vector. Scales to any size without blurring.";
    else if (made.width && format === "pdf") {
      const cm = ((made.width / 300) * 2.54).toFixed(1);
      text = `Prints ${cm} × ${cm} cm at 300 dpi.`;
    } else if (made.width) text = `${made.width.toLocaleString()} × ${made.width.toLocaleString()} px.`;
  }
  return <p className="mt-2.5 text-xs leading-relaxed text-ink-3">{text}</p>;
}

function Notice({ tone = "info", children }: { tone?: "info" | "warning"; children: React.ReactNode }) {
  return (
    <li className={cn("flex items-start gap-2 text-xs leading-relaxed", tone === "warning" ? "text-warning" : "text-ink-2")}>
      {tone === "warning" ? (
        <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
      ) : (
        <span aria-hidden className="mt-[7px] size-1 shrink-0 rounded-full bg-ink-3" />
      )}
      <span>{children}</span>
    </li>
  );
}

function ScannerReads({ text }: { text: string }) {
  return (
    <div className="mt-3 rounded-sm border border-line bg-paper px-3 py-2.5">
      <p className="label-mono text-ink-3">Scanner reads</p>
      <p className="mt-1.5 line-clamp-4 whitespace-pre-wrap break-all font-mono text-[12px] leading-relaxed text-ink-2">{text}</p>
    </div>
  );
}

/* ---------- Look ---------- */

function LookPanel({
  look,
  onLook,
  logo,
  logoOpts,
  logoError,
  onLogo,
  onLogoOpts,
  onRemoveLogo,
}: {
  look: Look;
  onLook: (p: Partial<Look>) => void;
  logo: Logo | null;
  logoOpts: LogoOptions;
  logoError: string | null;
  onLogo: (f: File) => void;
  onLogoOpts: (p: Partial<LogoOptions>) => void;
  onRemoveLogo: () => void;
}) {
  const gradient = look.mask !== "solid";
  return (
    <div className="mt-3 divide-y divide-line border-y border-line">
      {/* Shape */}
      <Row label="Dots">
        <div className="flex flex-wrap gap-1.5">
          {MODULE_STYLES.map((s) => (
            <Chip key={s.value} role="radio" selected={look.module === s.value} onClick={() => onLook({ module: s.value })}>
              <ModuleGlyph style={s.value} />
              {s.label}
            </Chip>
          ))}
        </div>
      </Row>
      <Row label="Eyes">
        <div className="flex flex-wrap gap-1.5">
          {EYE_STYLES.map((s) => (
            <Chip key={s.value} role="radio" selected={look.eye === s.value} onClick={() => onLook({ eye: s.value })}>
              <EyeGlyph style={s.value} />
              {s.label}
            </Chip>
          ))}
        </div>
      </Row>

      {/* Colour */}
      <Row label="Colour">
        <ColorField label="Dot colour" value={look.fill} swatches={FILL_SWATCHES} onChange={(fill) => onLook({ fill })} />
      </Row>
      <Row label="Fill">
        <div className="flex flex-wrap gap-1.5">
          {MASKS.map((m) => (
            <Chip key={m.value} role="radio" selected={look.mask === m.value} onClick={() => onLook({ mask: m.value })}>
              {m.label}
            </Chip>
          ))}
        </div>
        <AnimatePresence initial={false}>
          {gradient && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1, transition: { duration: 0.35, ease: EASE } }}
              exit={{ height: 0, opacity: 0, transition: { duration: 0.15 } }}
              className="overflow-hidden"
            >
              <div className="pt-3">
                <p className="label-mono mb-2 text-ink-3">Fades to</p>
                <ColorField
                  label="Gradient colour"
                  value={look.gradient}
                  swatches={FILL_SWATCHES}
                  onChange={(g) => onLook({ gradient: g })}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </Row>
      <Row label="Eye colour">
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip role="radio" selected={!look.eyeColor} onClick={() => onLook({ eyeColor: null })}>
            Match dots
          </Chip>
          <Chip role="radio" selected={Boolean(look.eyeColor)} onClick={() => onLook({ eyeColor: look.eyeColor ?? "#EB4A10" })}>
            Custom
          </Chip>
        </div>
        {look.eyeColor && (
          <div className="pt-3">
            <ColorField label="Eye colour" value={look.eyeColor} swatches={FILL_SWATCHES} onChange={(c) => onLook({ eyeColor: c })} />
          </div>
        )}
      </Row>
      <Row label="Background">
        <ColorField
          label="Background colour"
          value={look.back}
          swatches={BACK_SWATCHES}
          allowTransparent
          onChange={(back) => onLook({ back })}
        />
      </Row>

      {/* Logo */}
      <Row label="Logo">
        {logo ? (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- a local blob URL */}
              <img src={logo.src} alt="" className="size-11 shrink-0 rounded-sm border border-line bg-paper object-contain p-1" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-medium text-ink">{logo.name}</p>
                <p className="text-sm text-ink-2">{formatBytes(logo.size)}</p>
              </div>
              <button
                type="button"
                onClick={onRemoveLogo}
                aria-label="Remove logo"
                title="Remove logo"
                className="inline-flex size-9 items-center justify-center rounded-[8px] text-ink-3 transition-colors hover:bg-paper-2 hover:text-ink"
              >
                <X aria-hidden className="size-4" />
              </button>
            </div>
            <Slider
              label="Size"
              min={10}
              max={30}
              value={Math.round(logoOpts.ratio * 100)}
              unit="%"
              onChange={(n) => onLogoOpts({ ratio: n / 100 })}
            />
            <Slider label="Corners" min={0} max={60} value={logoOpts.radius} unit="px" onChange={(radius) => onLogoOpts({ radius })} />
            <label className="inline-flex h-9 cursor-pointer items-center gap-2 text-sm text-ink-2">
              <input
                type="checkbox"
                checked={logoOpts.pad}
                onChange={(e) => onLogoOpts({ pad: e.target.checked })}
                className="size-4 cursor-pointer accent-ink"
              />
              Clear space behind the logo
            </label>
            <p className="text-xs text-ink-3">Error correction is set to H while there&apos;s a logo, so the code still scans.</p>
          </div>
        ) : (
          <FileDrop
            compact
            accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
            title="Add a logo to the centre"
            formats={`PNG, JPG or WebP · up to ${LOGO_MAX_MB} MB`}
            error={logoError}
            onFile={onLogo}
          />
        )}
      </Row>

      {/* Fine print settings */}
      <details className="group/more">
        <summary className="flex h-12 cursor-pointer items-center justify-between gap-3 text-sm text-ink-2 transition-colors hover:text-ink">
          <span className="label-mono">More settings</span>
          <ChevronDown aria-hidden className="size-4 transition-transform duration-150 group-open/more:rotate-180" />
        </summary>
        <div className="divide-y divide-line border-t border-line">
          <Row label="Recovery">
            <div className="flex flex-wrap items-center gap-1.5">
              {EC_LEVELS.map((l) => (
                <Chip
                  key={l.value}
                  role="radio"
                  selected={(logo ? "H" : look.ec) === l.value}
                  disabled={Boolean(logo)}
                  onClick={() => onLook({ ec: l.value })}
                >
                  <span className="font-mono">{l.label}</span>
                  <span className="text-xs opacity-70">{l.hint}</span>
                </Chip>
              ))}
            </div>
            <p className="mt-2 text-xs text-ink-3">
              How much of the code can be scuffed or covered and still scan. Higher levels make denser codes.
            </p>
          </Row>
          <Row label="Dot size">
            <Slider label="Pixels per dot" min={4} max={40} value={look.boxSize} unit="px" onChange={(boxSize) => onLook({ boxSize })} />
          </Row>
          <Row label="Margin">
            <Slider label="Quiet zone" min={0} max={20} value={look.border} unit=" dots" onChange={(border) => onLook({ border })} />
            {look.border < 4 && <p className="mt-1 text-xs text-warning">Scanners like a margin of at least 4 dots.</p>}
          </Row>
        </div>
      </details>
    </div>
  );
}

/** A hairline row: mono label over its controls (the column beside the preview is narrow). */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="py-3.5">
      <p className="label-mono mb-2.5 text-ink-3">{label}</p>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function Chip({
  selected,
  onClick,
  disabled,
  role,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  disabled?: boolean;
  role?: "radio";
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={role ? selected : undefined}
      aria-pressed={role ? undefined : selected}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded-sm border px-3 text-sm transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50",
        selected ? "border-ink bg-ink text-paper" : "border-line bg-surface text-ink-2 hover:border-ink-3 hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

function Slider({
  label,
  min,
  max,
  value,
  unit,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  value: number;
  unit: string;
  onChange: (n: number) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-3">
      <label htmlFor={id} className="w-16 shrink-0 text-sm text-ink-2">
        {label}
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-valuetext={`${value}${unit}`}
        className="h-9 min-w-0 flex-1 cursor-pointer accent-ink"
      />
      <output htmlFor={id} className="w-16 shrink-0 text-right font-mono text-sm tabular-nums text-ink">
        {value}
        {unit}
      </output>
    </div>
  );
}

/* ---------- Colour ---------- */

const checker =
  "bg-[conic-gradient(var(--color-line)_25%,var(--color-surface)_0_50%,var(--color-line)_0_75%,var(--color-surface)_0)] bg-[length:8px_8px]";

/** Preset swatches, a native picker for anything else, and a hex field that accepts "1ba" shorthand. */
function ColorField({
  label,
  value,
  swatches,
  allowTransparent = false,
  onChange,
}: {
  label: string;
  value: string;
  swatches: string[];
  allowTransparent?: boolean;
  onChange: (c: string) => void;
}) {
  const custom = value !== "transparent" && !swatches.includes(value.toUpperCase());
  const swatch =
    "relative aspect-square w-full min-w-0 rounded-sm border border-ink/15 transition-[box-shadow,transform] duration-150 hover:-translate-y-px aria-checked:ring-2 aria-checked:ring-ink aria-checked:ring-offset-2 aria-checked:ring-offset-surface";
  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* One row on every screen: cells are 32px, and shrink together on narrow phones. */}
      <div
        role="radiogroup"
        aria-label={label}
        className="grid w-full items-center gap-1.5 sm:w-auto sm:gap-2"
        style={{ gridTemplateColumns: `repeat(${swatches.length + (allowTransparent ? 2 : 1)}, minmax(0, 2rem))` }}
      >
        {swatches.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={value.toUpperCase() === c}
            aria-label={c}
            title={c}
            onClick={() => onChange(c)}
            style={{ backgroundColor: c }}
            className={swatch}
          />
        ))}
        {allowTransparent && (
          <button
            type="button"
            role="radio"
            aria-checked={value === "transparent"}
            aria-label="Transparent"
            title="Transparent"
            onClick={() => onChange("transparent")}
            className={cn(swatch, checker)}
          />
        )}
        <label
          title="Pick any colour"
          className={cn(swatch, "cursor-pointer overflow-hidden", custom && "ring-2 ring-ink ring-offset-2 ring-offset-surface")}
          style={{
            background: custom
              ? value
              : "conic-gradient(from 90deg, #EB4A10, #EAB308, #16A34A, #0EA5E9, #7E22CE, #EB4A10)",
          }}
        >
          <span className="sr-only">Pick any colour</span>
          <input
            type="color"
            value={value === "transparent" ? "#FFFFFF" : value}
            onChange={(e) => onChange(e.target.value.toUpperCase())}
            className="absolute inset-0 size-full cursor-pointer opacity-0"
          />
        </label>
      </div>
      <HexInput key={value} value={value} label={label} onChange={onChange} />
    </div>
  );
}

function HexInput({ value, label, onChange }: { value: string; label: string; onChange: (c: string) => void }) {
  const [draft, setDraft] = useState(value === "transparent" ? "" : value.toUpperCase());
  const bad = draft !== "" && !parseHex(draft);
  return (
    <input
      type="text"
      value={draft}
      aria-label={`${label}, hex`}
      aria-invalid={bad}
      placeholder={value === "transparent" ? "None" : "#000000"}
      spellCheck={false}
      maxLength={7}
      onChange={(e) => {
        setDraft(e.target.value);
        const hex = parseHex(e.target.value);
        if (hex && e.target.value.replace("#", "").length === 6) onChange(hex);
      }}
      onBlur={() => {
        const hex = parseHex(draft);
        if (hex && hex !== value) onChange(hex);
        else setDraft(value === "transparent" ? "" : value.toUpperCase());
      }}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      className={cn(
        "h-8 w-[5.75rem] rounded-sm border bg-surface px-2 font-mono text-[13px] uppercase text-ink outline-none transition-[border-color,box-shadow] placeholder:normal-case placeholder:text-ink-3 focus:border-ink focus:ring-4 focus:ring-accent/15",
        bad ? "border-danger/60" : "border-line",
      )}
    />
  );
}

/* ---------- Glyphs: tiny drawings of each shape option ---------- */

const CELLS: [number, number][] = [
  [0, 0],
  [1, 0],
  [0, 1],
  [2, 1],
  [0, 2],
  [1, 2],
  [2, 2],
];

function ModuleGlyph({ style }: { style: ModuleStyle }) {
  return (
    <svg aria-hidden viewBox="0 0 18 18" className="size-4 shrink-0" fill="currentColor">
      {CELLS.map(([c, r]) => {
        const x = c * 6;
        const y = r * 6;
        switch (style) {
          case "circle":
            return <circle key={`${c}${r}`} cx={x + 3} cy={y + 3} r={2.5} />;
          case "gapped":
            return <rect key={`${c}${r}`} x={x + 1} y={y + 1} width={4} height={4} />;
          case "rounded":
            return <rect key={`${c}${r}`} x={x + 0.4} y={y + 0.4} width={5.2} height={5.2} rx={1.8} />;
          case "vertical_bars":
            return <rect key={`${c}${r}`} x={x + 1} y={y} width={4} height={6} />;
          case "horizontal_bars":
            return <rect key={`${c}${r}`} x={x} y={y + 1} width={6} height={4} />;
          default:
            return <rect key={`${c}${r}`} x={x} y={y} width={6} height={6} />;
        }
      })}
    </svg>
  );
}

function EyeGlyph({ style }: { style: EyeStyle }) {
  const ring = { fill: "none", stroke: "currentColor", strokeWidth: 2.2 };
  return (
    <svg aria-hidden viewBox="0 0 18 18" className="size-4 shrink-0" fill="currentColor">
      {style === "circle" ? (
        // The backend draws each module of the eye as a dot: a ring of dots around a 3×3 cluster.
        Array.from({ length: 49 }, (_, i) => [i % 7, Math.floor(i / 7)] as const)
          .filter(([c, r]) => c === 0 || r === 0 || c === 6 || r === 6 || (c >= 2 && c <= 4 && r >= 2 && r <= 4))
          .map(([c, r]) => <circle key={`${c}${r}`} cx={1.5 + c * 2.5} cy={1.5 + r * 2.5} r={1.1} />)
      ) : (
        <>
          <rect x={1.6} y={1.6} width={14.8} height={14.8} rx={style === "rounded" ? 4.5 : 0} {...ring} />
          <rect x={5.6} y={5.6} width={6.8} height={6.8} rx={style === "rounded" ? 2 : 0} />
        </>
      )}
    </svg>
  );
}
