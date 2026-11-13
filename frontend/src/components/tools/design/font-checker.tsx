"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, Check, CircleCheck, CircleX, Download, FileSearch, Info, Search, Type, X } from "lucide-react";
import type { Font, Glyph } from "opentype.js";
import { postFormJson, saveBlob, uploadForm } from "@/lib/files";
import {
  fromBase64,
  isDocFile,
  isFontFile,
  LANGUAGE_SAMPLES,
  loadFace,
  parseFont,
  SAMPLES,
  type DocReport,
  type FontReport,
} from "@/lib/fonts";
import { formatBytes } from "@/lib/media";
import { getTool, stepsFor, toolHref } from "@/lib/tools";
import { cn } from "@/lib/utils";
import { FileDrop } from "../file-drop";
import { Workbench } from "../workbench";
import { Chips, Notice, Panel, Row, Slider, Toggle } from "../pdf/kit";
import { FileRow } from "../pdf/task";
import { Measuring, messageOf, RetryLink, swap } from "../pdf/parts";

const ACCEPT = ".ttf,.otf,.woff,.woff2,.ttc,.otc,.pdf,.docx,.pptx,.xlsx,.odt,.ods,.odp,.epub,.html,.htm,.css,.svg";
const TABS = [
  { id: "tester", label: "Type tester" },
  { id: "glyphs", label: "Glyphs" },
  { id: "checks", label: "Checks" },
  { id: "languages", label: "Languages" },
  { id: "details", label: "Details" },
] as const;
type Tab = (typeof TABS)[number]["id"];

type Loaded = { report: FontReport; family: string | null; bytes: ArrayBuffer; font: Font | null; fontError: string | null };

/**
 * The font checker: drop a font to see it, test it, browse every glyph and validate it (the server's
 * report, including the browsers' own sanitizer), or drop a document to see which fonts it uses and
 * whether they're embedded, and open any embedded font here.
 */
export function FontChecker({ toolId }: { toolId: string }) {
  const tool = getTool(toolId)!;
  const [file, setFile] = useState<File | null>(null);
  const [rejected, setRejected] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "busy" | { error: string }>("idle");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [doc, setDoc] = useState<DocReport | null>(null);
  const [tab, setTab] = useState<Tab>("tester");
  const [face, setFace] = useState(0);
  const abort = useRef<AbortController | null>(null);

  const open = async (f: File, index = 0) => {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setFile(f);
    setRejected(null);
    setState("busy");
    setLoaded(null);
    setDoc(null);
    setFace(index);
    const form = new FormData();
    form.append("file", f, f.name);
    try {
      if (isFontFile(f.name)) {
        form.append("index", String(index));
        const [res, original] = await Promise.all([
          postFormJson<{ report: FontReport; sfnt: string | null }>("/api/tools/fonts/inspect", form, { signal: ctrl.signal }),
          f.arrayBuffer(),
        ]);
        if (ctrl.signal.aborted) return;
        // Browsers read TTF/OTF/WOFF/WOFF2 themselves; collections (and WOFF2 for the outlines) come back unpacked.
        const plain = res.sfnt ? (fromBase64(res.sfnt).buffer as ArrayBuffer) : original;
        const ext = f.name.split(".").pop()!.toLowerCase();
        let family: string | null = null;
        try {
          family = await loadFace(ext === "ttc" || ext === "otc" ? plain : original);
        } catch {
          family = null;
        }
        let font: Font | null = null;
        let fontError: string | null = null;
        try {
          font = ext === "woff2" && !res.sfnt ? null : await parseFont(plain.slice(0));
        } catch (e) {
          fontError = messageOf(e);
        }
        setLoaded({ report: res.report, family, bytes: original, font, fontError });
        setTab(res.report.summary.fail ? "checks" : "tester");
      } else {
        const res = await postFormJson<DocReport>("/api/tools/fonts/document", form, { signal: ctrl.signal });
        if (ctrl.signal.aborted) return;
        setDoc(res);
      }
      setState("idle");
    } catch (e) {
      if (ctrl.signal.aborted) return;
      setState({ error: messageOf(e) });
    }
  };
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  });

  useEffect(() => () => abort.current?.abort(), []);

  // A font handed over by the Font creator ("Check this font").
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("dw-font-handoff");
      if (!raw) return;
      sessionStorage.removeItem("dw-font-handoff");
      const { name, data } = JSON.parse(raw) as { name: string; data: string };
      const f = new File([fromBase64(data) as BlobPart], name, { type: "font/otf" });
      setTimeout(() => void openRef.current(f), 0);
    } catch {
      /* nothing handed over */
    }
  }, []);

  const choose = (f: File) => {
    if (!isFontFile(f.name) && !isDocFile(f.name)) return setRejected("Add a font (TTF, OTF, WOFF, WOFF2, TTC) or a document (PDF, Word, PowerPoint, Excel, EPUB, HTML, CSS, SVG).");
    if (f.size === 0) return setRejected("That file is empty.");
    void open(f);
  };
  const clear = () => {
    abort.current?.abort();
    setFile(null);
    setLoaded(null);
    setDoc(null);
    setState("idle");
  };

  const step = !file ? 0 : loaded || doc ? 2 : 1;
  return (
    <Workbench
      steps={stepsFor(tool)}
      current={step}
      footer={<>Fonts are checked on our server (fontTools and the OpenType Sanitizer browsers use) and deleted straight after; previews are drawn in your browser. Free.</>}
    >
      <div className="space-y-3 p-3 sm:p-4">
        {!file ? (
          <>
            <FileDrop accept={ACCEPT} title="Drop a font or a document" formats="TTF, OTF, WOFF, WOFF2, TTC · or a PDF, Word, PowerPoint, EPUB… to list its fonts" error={rejected} onFile={choose} />
            <div className="grid gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-3">
              {[
                { icon: Type, title: "See and test it", body: "Type anything at any size, switch OpenType features and variable axes." },
                { icon: CircleCheck, title: "Validate it", body: "Over 20 checks, including the sanitizer Chrome and Firefox run on web fonts." },
                { icon: FileSearch, title: "Fonts in documents", body: "Which fonts a PDF or Office file uses, embedded or not, and open them here." },
              ].map(({ icon: Icon, title, body }) => (
                <div key={title} className="bg-surface px-3 py-3">
                  <p className="flex items-center gap-2 text-sm font-medium text-ink">
                    <Icon aria-hidden className="size-4 text-ink-2" />
                    {title}
                  </p>
                  <p className="mt-1 text-[13px] leading-relaxed text-ink-3">{body}</p>
                </div>
              ))}
            </div>
          </>
        ) : (
          <FileRow file={file} noun={isFontFile(file.name) ? "font" : "document"} locked={state === "busy"} accept={ACCEPT} onReplace={choose} onClear={clear} />
        )}

        <AnimatePresence mode="wait" initial={false}>
          {state === "busy" ? (
            <motion.div key="busy" {...swap} className="rounded-md border border-dashed border-line px-4 py-5">
              <Measuring />
              <p className="mt-2 text-sm text-ink-2">{file && isFontFile(file.name) ? "Reading the font and running every check…" : "Looking for fonts in the document…"}</p>
            </motion.div>
          ) : typeof state === "object" ? (
            <motion.div key="err" {...swap}>
              <Notice tone="danger">
                {state.error}
                {file && <RetryLink onRetry={() => void open(file, face)} />}
              </Notice>
            </motion.div>
          ) : loaded ? (
            <motion.div key={`font-${face}`} {...swap} className="space-y-3">
              <Specimen loaded={loaded} />
              {loaded.report.faces && loaded.report.faces.length > 1 && (
                <Panel>
                  <Row label="Font in this collection" hint={`${loaded.report.faces.length} fonts`}>
                    <Chips value={face} onChange={(i) => file && void open(file, i)} options={loaded.report.faces.map((n, i) => ({ value: i, label: n }))} />
                  </Row>
                </Panel>
              )}
              <div role="tablist" aria-label="Font views" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]">
                {TABS.map((t) => {
                  const on = tab === t.id;
                  const badge = t.id === "checks" ? loaded.report.summary.fail || loaded.report.summary.warn : t.id === "glyphs" ? loaded.report.glyphs : null;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      role="tab"
                      aria-selected={on}
                      onClick={() => setTab(t.id)}
                      className={cn("relative inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[8px] px-3 text-sm transition-colors", on ? "text-paper" : "text-ink-2 hover:bg-paper-2 hover:text-ink")}
                    >
                      {on && <motion.span layoutId="font-tab" aria-hidden className="absolute inset-0 rounded-[8px] bg-ink" transition={{ type: "spring", bounce: 0.22, duration: 0.45 }} />}
                      <span className="relative">{t.label}</span>
                      {badge ? (
                        <span className={cn("relative rounded-sm px-1 font-mono text-[11px]", on ? "bg-paper/15 text-paper" : t.id === "checks" && loaded.report.summary.fail ? "bg-danger/10 text-danger" : "bg-paper-2 text-ink-3")}>
                          {badge.toLocaleString("en")}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
              <AnimatePresence mode="wait" initial={false}>
                <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0, transition: { duration: 0.25 } }} exit={{ opacity: 0, transition: { duration: 0.12 } }}>
                  {tab === "tester" && <Tester loaded={loaded} />}
                  {tab === "glyphs" && <Glyphs loaded={loaded} />}
                  {tab === "checks" && <Checks report={loaded.report} />}
                  {tab === "languages" && <Languages report={loaded.report} family={loaded.family} />}
                  {tab === "details" && <Details report={loaded.report} />}
                </motion.div>
              </AnimatePresence>
              <Actions file={file!} report={loaded.report} />
            </motion.div>
          ) : doc ? (
            <motion.div key="doc" {...swap}>
              <DocFonts doc={doc} onOpen={(f) => void open(f)} />
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </Workbench>
  );
}

/* ---------------------------------------------------------------------------------------------- */

function Specimen({ loaded }: { loaded: Loaded }) {
  const r = loaded.report;
  const verdict = r.summary.fail ? { tone: "danger", text: `${r.summary.fail} problem${r.summary.fail > 1 ? "s" : ""}`, icon: CircleX } : r.summary.warn ? { tone: "warning", text: `${r.summary.warn} warning${r.summary.warn > 1 ? "s" : ""}`, icon: AlertTriangle } : { tone: "success", text: "All checks pass", icon: CircleCheck };
  const V = verdict.icon;
  return (
    <div className="overflow-hidden rounded-md border border-line bg-surface">
      <div className="grid @container md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="flex items-center justify-center border-b border-line bg-paper px-4 py-6 md:border-b-0 md:border-r">
          <motion.span
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="block text-[88px] leading-none text-ink sm:text-[112px]"
            style={{ fontFamily: loaded.family ? `"${loaded.family}", serif` : undefined }}
          >
            {loaded.family ? "Aa" : "?"}
          </motion.span>
        </div>
        <div className="min-w-0 px-4 py-4">
          <p className="label-mono text-ink-3">{r.file.format === r.outline ? r.outline : `${r.file.format} · ${r.outline}`}</p>
          <h3 className="mt-1 truncate text-xl font-semibold tracking-[-0.015em] text-ink" title={`${r.family} ${r.style}`}>
            {r.family} <span className="font-normal text-ink-2">{r.style}</span>
          </h3>
          <p
            className={cn(
              "mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[13px] font-medium",
              verdict.tone === "danger" ? "bg-danger/10 text-danger" : verdict.tone === "warning" ? "bg-warning/15 text-ink" : "bg-success/10 text-success",
            )}
          >
            <V aria-hidden className="size-3.5" /> {verdict.text}
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[13px]">
            {[
              ["Glyphs", r.glyphs.toLocaleString("en")],
              ["Characters", r.characters.toLocaleString("en")],
              ["File size", formatBytes(r.file.size)],
              ["As WOFF2", r.file.woff2_size ? `${r.file.woff2_exact ? "" : "≈ "}${formatBytes(r.file.woff2_size)}` : r.file.format === "WOFF2" ? "It is one" : "—"],
              ["Variable", r.axes.length ? r.axes.map((a) => a.tag).join(", ") : "No"],
              ["Colour", r.color.length ? r.color.join(", ") : "No"],
            ].map(([k, v]) => (
              <div key={k} className="flex min-w-0 justify-between gap-2 border-b border-line pb-1">
                <dt className="text-ink-3">{k}</dt>
                <dd className="truncate text-right font-mono text-ink">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
      {!loaded.family && <p className="border-t border-line px-4 py-2 text-xs text-warning">This browser couldn&apos;t load the font for previews; the report below still applies.</p>}
    </div>
  );
}

/* ---------- Type tester ---------- */

const DEFAULT_ON = new Set(["liga", "calt", "kern", "clig"]);

function Tester({ loaded }: { loaded: Loaded }) {
  const r = loaded.report;
  const [text, setText] = useState(SAMPLES[0].text);
  const [size, setSize] = useState(56);
  const [leading, setLeading] = useState(1.25);
  const [tracking, setTracking] = useState(0);
  const [dark, setDark] = useState(false);
  const [waterfall, setWaterfall] = useState(false);
  const [features, setFeatures] = useState<Record<string, boolean>>({});
  const [axes, setAxes] = useState<Record<string, number>>(() => Object.fromEntries(r.axes.map((a) => [a.tag, a.default])));
  const optional = r.features.filter((f) => f.optional);
  const featureCss = Object.entries(features)
    .filter(([tag, on]) => on !== DEFAULT_ON.has(tag))
    .map(([tag, on]) => `"${tag}" ${on ? 1 : 0}`)
    .join(", ");
  const axesCss = r.axes.map((a) => `"${a.tag}" ${axes[a.tag] ?? a.default}`).join(", ");
  const style: React.CSSProperties = {
    fontFamily: loaded.family ? `"${loaded.family}", serif` : undefined,
    lineHeight: leading,
    letterSpacing: `${tracking}em`,
    fontFeatureSettings: featureCss || "normal",
    fontVariationSettings: axesCss || "normal",
  };

  return (
    <div className="space-y-3">
      <div className={cn("overflow-hidden rounded-md border border-line transition-colors duration-300", dark ? "bg-ink text-paper" : "bg-surface text-ink")}>
        {waterfall ? (
          <div className="space-y-2 overflow-x-auto px-4 py-4" data-lenis-prevent>
            {[12, 16, 20, 24, 32, 40, 56, 72, 96].map((s) => (
              <div key={s} className="flex items-baseline gap-3 whitespace-nowrap">
                <span className={cn("w-8 shrink-0 text-right font-mono text-[11px]", dark ? "text-paper-dim" : "text-ink-3")}>{s}</span>
                <span style={{ ...style, fontSize: s }}>{text.split("\n")[0] || " "}</span>
              </div>
            ))}
          </div>
        ) : (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            aria-label="Text to preview"
            rows={Math.min(8, Math.max(2, Math.ceil(text.length / 30)))}
            className="block min-h-[160px] w-full resize-y bg-transparent px-4 py-4 outline-none"
            style={{ ...style, fontSize: size }}
          />
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {SAMPLES.map((s) => (
          <button key={s.label} type="button" onClick={() => setText(s.text)} className={cn("inline-flex h-8 items-center rounded-sm border px-2.5 text-[13px] transition-colors", text === s.text ? "border-ink bg-ink text-paper" : "border-line bg-surface text-ink-2 hover:border-ink-3 hover:text-ink")}>
            {s.label}
          </button>
        ))}
      </div>
      <Panel>
        <Row label="Size" hint={waterfall ? "Waterfall shows every size" : undefined}>
          <Slider value={size} min={8} max={200} onChange={setSize} format={(v) => `${v}px`} label="Size" disabled={waterfall} />
        </Row>
        <Row label="Line height">
          <Slider value={Math.round(leading * 100)} min={70} max={250} step={5} onChange={(v) => setLeading(v / 100)} format={(v) => (v / 100).toFixed(2)} label="Line height" />
        </Row>
        <Row label="Letter spacing">
          <Slider value={Math.round(tracking * 1000)} min={-100} max={500} step={5} onChange={(v) => setTracking(v / 1000)} format={(v) => `${(v / 1000).toFixed(2)}em`} label="Letter spacing" />
        </Row>
        <Row label="View">
          <div className="grid gap-2.5 sm:grid-cols-2">
            <Toggle checked={waterfall} onChange={setWaterfall} label="Waterfall (12 to 96 px)" />
            <Toggle checked={dark} onChange={setDark} label="Light on dark" />
          </div>
        </Row>
        {r.axes.length > 0 && (
          <Row label="Variable axes" hint={`${r.instances.length} named styles`}>
            <div className="space-y-2">
              {r.axes.map((a) => (
                <div key={a.tag} className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-2">
                  <span className="truncate text-sm text-ink-2" title={a.tag}>
                    {a.name} <span className="font-mono text-[11px] text-ink-3">{a.tag}</span>
                  </span>
                  <Slider value={axes[a.tag] ?? a.default} min={a.min} max={a.max} step={(a.max - a.min) / 200} onChange={(v) => setAxes((x) => ({ ...x, [a.tag]: v }))} format={(v) => String(Math.round(v * 10) / 10)} label={a.name} />
                </div>
              ))}
              {r.instances.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {r.instances.map((ins) => (
                    <button key={ins.name + JSON.stringify(ins.coordinates)} type="button" onClick={() => setAxes(ins.coordinates)} className="inline-flex h-8 items-center rounded-sm border border-line bg-surface px-2.5 text-[13px] text-ink-2 hover:border-ink-3 hover:text-ink">
                      {ins.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </Row>
        )}
        {optional.length > 0 && (
          <Row label="OpenType features" hint="Tap to switch on or off">
            <div className="flex flex-wrap gap-1.5">
              {optional.map((f) => {
                const on = features[f.tag] ?? DEFAULT_ON.has(f.tag);
                return (
                  <button
                    key={f.tag}
                    type="button"
                    aria-pressed={on}
                    title={f.name}
                    onClick={() => setFeatures((x) => ({ ...x, [f.tag]: !on }))}
                    className={cn("inline-flex h-8 items-center gap-1.5 rounded-sm border px-2.5 text-[13px] transition-colors", on ? "border-ink bg-ink text-paper" : "border-line bg-surface text-ink-2 hover:border-ink-3 hover:text-ink")}
                  >
                    <span className="font-mono">{f.tag}</span>
                    <span className={cn("hidden max-w-[11rem] truncate sm:inline", on ? "text-paper-dim" : "text-ink-3")}>{f.name}</span>
                  </button>
                );
              })}
            </div>
            {featureCss && <p className="mt-2 break-all font-mono text-[11px] text-ink-3">font-feature-settings: {featureCss};</p>}
          </Row>
        )}
      </Panel>
    </div>
  );
}

/* ---------- Glyphs ---------- */

const PAGE = 240;
const CATS: { id: string; label: string; test: (g: Glyph) => boolean }[] = [
  { id: "all", label: "All", test: () => true },
  { id: "letters", label: "Letters", test: (g) => g.unicode !== undefined && /\p{L}/u.test(String.fromCodePoint(g.unicode)) },
  { id: "digits", label: "Numbers", test: (g) => g.unicode !== undefined && /\p{N}/u.test(String.fromCodePoint(g.unicode)) },
  { id: "punct", label: "Punctuation", test: (g) => g.unicode !== undefined && /\p{P}/u.test(String.fromCodePoint(g.unicode)) },
  { id: "symbols", label: "Symbols", test: (g) => g.unicode !== undefined && /[\p{S}\p{Z}]/u.test(String.fromCodePoint(g.unicode)) },
  { id: "unencoded", label: "Not typeable", test: (g) => g.unicode === undefined },
];

const hexCode = (n: number) => `U+${n.toString(16).toUpperCase().padStart(4, "0")}`;

function Glyphs({ loaded }: { loaded: Loaded }) {
  const font = loaded.font;
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState("all");
  const [shown, setShown] = useState(PAGE);
  const [picked, setPicked] = useState<number | null>(null);
  const q = useDeferredValue(query.trim());
  const list = useMemo(() => {
    if (!font) return [];
    const out: Glyph[] = [];
    const test = CATS.find((c) => c.id === cat)!.test;
    const code = /^u\+?([0-9a-f]{2,6})$/i.exec(q)?.[1];
    for (let i = 0; i < font.glyphs.length; i++) {
      const g = font.glyphs.get(i);
      if (!test(g)) continue;
      if (q) {
        const ch = g.unicode !== undefined ? String.fromCodePoint(g.unicode) : "";
        const hit = (code && g.unicodes.includes(parseInt(code, 16))) || ch === q || (q.length > 1 && (g.name ?? "").toLowerCase().includes(q.toLowerCase()));
        if (!hit) continue;
      }
      out.push(g);
    }
    return out;
  }, [font, cat, q]);

  if (!font) {
    return <Notice tone="warning">{loaded.fontError ? `The glyphs couldn't be drawn: ${loaded.fontError}` : "This font is too large to draw every glyph here; the tester and report still work."}</Notice>;
  }
  const upm = font.unitsPerEm;
  const sel = picked !== null ? font.glyphs.get(picked) : null;
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
          <input
            value={query}
            onChange={(e) => (setQuery(e.target.value), setShown(PAGE))}
            placeholder="Find: a character, U+00E9, or a glyph name"
            aria-label="Find a glyph"
            className="h-10 w-full rounded-md border border-line bg-surface pl-9 pr-3 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-ink focus:ring-4 focus:ring-accent/15"
          />
        </div>
        <p className="shrink-0 px-1 font-mono text-xs text-ink-3">{list.length.toLocaleString("en")} of {font.glyphs.length.toLocaleString("en")}</p>
      </div>
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 [scrollbar-width:none]">
        {CATS.map((c) => (
          <button key={c.id} type="button" onClick={() => (setCat(c.id), setShown(PAGE))} className={cn("inline-flex h-8 shrink-0 items-center rounded-sm border px-2.5 text-[13px] transition-colors", cat === c.id ? "border-ink bg-ink text-paper" : "border-line bg-surface text-ink-2 hover:border-ink-3 hover:text-ink")}>
            {c.label}
          </button>
        ))}
      </div>
      <div className="grid gap-3 @container lg:grid-cols-[minmax(0,1fr)_260px]">
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-px overflow-hidden rounded-md border border-line bg-line">
          {list.slice(0, shown).map((g) => (
            <li key={g.index} className="bg-surface">
              <button
                type="button"
                onClick={() => setPicked(g.index)}
                aria-pressed={picked === g.index}
                title={`${g.name ?? "glyph " + g.index}${g.unicode !== undefined ? " · " + hexCode(g.unicode) : ""}`}
                className={cn("group flex aspect-square w-full flex-col items-center justify-between p-1 transition-colors", picked === g.index ? "bg-ink text-paper" : "hover:bg-paper-2")}
              >
                <GlyphSvg glyph={g} upm={upm} ascender={font.ascender} descender={font.descender} className="size-10" />
                <span className={cn("max-w-full truncate font-mono text-[9px]", picked === g.index ? "text-paper-dim" : "text-ink-3")}>{g.unicode !== undefined ? hexCode(g.unicode).slice(2) : g.name ?? g.index}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="lg:sticky lg:top-24 lg:self-start">
          {sel ? <GlyphDetail glyph={sel} font={font} report={loaded.report} onClose={() => setPicked(null)} /> : <p className="rounded-md border border-dashed border-line px-3 py-6 text-center text-sm text-ink-3">Tap a glyph to see its outline, metrics and code.</p>}
        </div>
      </div>
      {shown < list.length && (
        <button type="button" onClick={() => setShown((s) => s + PAGE * 2)} className="inline-flex h-10 w-full items-center justify-center rounded-md border border-line bg-surface text-sm text-ink-2 hover:border-ink-3 hover:text-ink">
          Show more ({(list.length - shown).toLocaleString("en")} left)
        </button>
      )}
    </div>
  );
}

function GlyphSvg({ glyph, upm, ascender, descender, className }: { glyph: Glyph; upm: number; ascender: number; descender: number; className?: string }) {
  const d = useMemo(() => {
    try {
      return glyph.getPath(0, 0, upm).toPathData(1);
    } catch {
      return "";
    }
  }, [glyph, upm]);
  const adv = Math.max(glyph.advanceWidth ?? upm, upm * 0.3);
  const top = Math.max(ascender, upm * 0.8);
  const h = top - Math.min(descender, -upm * 0.2);
  return (
    <svg viewBox={`${-adv * 0.1} ${-top} ${adv * 1.2} ${h}`} preserveAspectRatio="xMidYMid meet" className={className} aria-hidden>
      <path d={d} fill="currentColor" />
    </svg>
  );
}

function GlyphDetail({ glyph, font, report, onClose }: { glyph: Glyph; font: Font; report: FontReport; onClose: () => void }) {
  const [points, setPoints] = useState(false);
  const upm = font.unitsPerEm;
  const m = report.metrics;
  const path = glyph.getPath(0, 0, upm);
  const box = glyph.getBoundingBox();
  const adv = glyph.advanceWidth ?? 0;
  const asc = Number(m.typoAscender ?? m.hheaAscender ?? font.ascender);
  const desc = Number(m.typoDescender ?? m.hheaDescender ?? font.descender);
  const pad = upm * 0.12;
  const x0 = Math.min(0, box.x1) - pad;
  const x1 = Math.max(adv, box.x2) + pad;
  const top = Math.max(asc, box.y2) + pad;
  const bottom = Math.min(desc, box.y1) - pad;
  const lines: [string, number][] = [["ascender", asc], ["cap", Number(m.capHeight ?? 0)], ["x-height", Number(m.xHeight ?? 0)], ["baseline", 0], ["descender", desc]];
  const ch = glyph.unicode !== undefined ? String.fromCodePoint(glyph.unicode) : null;
  const pts = points ? path.commands.flatMap((c) => ("x" in c ? [{ x: c.x, y: c.y, on: true }] : []).concat("x1" in c ? [{ x: c.x1, y: c.y1, on: false }] : [])) : [];
  return (
    <div className="overflow-hidden rounded-md border border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <p className="label-mono text-ink-3">{glyph.name ?? `Glyph ${glyph.index}`}</p>
        <button type="button" onClick={onClose} aria-label="Close" className="inline-flex size-7 items-center justify-center rounded-[6px] text-ink-3 hover:bg-paper-2 hover:text-ink">
          <X aria-hidden className="size-4" />
        </button>
      </div>
      <svg viewBox={`${x0} ${-top} ${x1 - x0} ${top - bottom}`} className="block aspect-square w-full bg-paper" aria-label={`Outline of ${glyph.name ?? "the glyph"}`}>
        <rect x={0} y={-top} width={adv} height={top - bottom} fill="var(--color-accent)" opacity={0.06} />
        {lines.filter(([, v]) => v).map(([label, v]) => (
          <g key={label}>
            <line x1={x0} x2={x1} y1={-v} y2={-v} stroke="var(--color-line)" strokeWidth={upm / 400} strokeDasharray={label === "baseline" ? undefined : `${upm / 80} ${upm / 80}`} />
            <text x={x0 + upm * 0.02} y={-v - upm * 0.015} fontSize={upm * 0.045} fill="var(--color-ink-3)" fontFamily="var(--font-mono)">{label}</text>
          </g>
        ))}
        <path d={path.toPathData(2)} fill="var(--color-ink)" fillOpacity={points ? 0.15 : 1} stroke={points ? "var(--color-ink)" : "none"} strokeWidth={upm / 300} />
        {pts.map((p, i) => (p.on ? <circle key={i} cx={p.x} cy={p.y} r={upm / 120} fill="var(--color-accent)" /> : <rect key={i} x={p.x - upm / 160} y={p.y - upm / 160} width={upm / 80} height={upm / 80} fill="none" stroke="var(--color-accent)" strokeWidth={upm / 500} />))}
      </svg>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 px-3 py-2.5 text-[12px]">
        {[
          ["Unicode", glyph.unicodes.length ? glyph.unicodes.map(hexCode).join(" ") : "—"],
          ["Index", String(glyph.index)],
          ["Advance", String(adv)],
          ["Left bearing", String(Math.round(box.x1))],
          ["Width × height", `${Math.round(box.x2 - box.x1)} × ${Math.round(box.y2 - box.y1)}`],
          ["Points", String(path.commands.filter((c) => c.type !== "Z").length)],
        ].map(([k, v]) => (
          <div key={k} className="flex min-w-0 justify-between gap-2">
            <dt className="text-ink-3">{k}</dt>
            <dd className="truncate font-mono text-ink">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="flex gap-1.5 border-t border-line px-3 py-2">
        <button type="button" onClick={() => setPoints((p) => !p)} aria-pressed={points} className={cn("inline-flex h-8 items-center rounded-sm border px-2.5 text-[13px]", points ? "border-ink bg-ink text-paper" : "border-line text-ink-2 hover:border-ink-3")}>
          Show points
        </button>
        {ch && (
          <button type="button" onClick={() => void navigator.clipboard.writeText(ch)} className="inline-flex h-8 items-center rounded-sm border border-line px-2.5 text-[13px] text-ink-2 hover:border-ink-3 hover:text-ink">
            Copy “{ch}”
          </button>
        )}
      </div>
    </div>
  );
}

/* ---------- Checks, languages, details ---------- */

function Checks({ report }: { report: FontReport }) {
  const icon = { pass: CircleCheck, warn: AlertTriangle, fail: CircleX, info: Info };
  const tone = { pass: "text-success", warn: "text-warning", fail: "text-danger", info: "text-ink-3" };
  return (
    <ol className="divide-y divide-line overflow-hidden rounded-md border border-line bg-surface">
      {report.checks.map((c, i) => {
        const I = icon[c.level];
        return (
          <motion.li key={c.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }} className="flex gap-3 px-3 py-2.5">
            <I aria-hidden className={cn("mt-0.5 size-4 shrink-0", tone[c.level])} />
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink">
                <span className="sr-only">{c.level}: </span>
                {c.title}
              </p>
              {c.detail && <p className="mt-0.5 text-[13px] leading-relaxed text-ink-2 [overflow-wrap:anywhere]">{c.detail}</p>}
            </div>
          </motion.li>
        );
      })}
    </ol>
  );
}

function Languages({ report, family }: { report: FontReport; family: string | null }) {
  const [sample, setSample] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-md border border-line bg-surface">
        <p className="label-mono border-b border-line px-3 py-2 text-ink-3">Scripts and blocks</p>
        <ul className="divide-y divide-line">
          {report.coverage.map((c) => {
            const pct = Math.round((c.have / c.total) * 100);
            return (
              <li key={c.name} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_4.5rem] items-center gap-3 px-3 py-2 text-[13px]">
                <span className="truncate text-ink">{c.name}</span>
                <span className="h-1.5 overflow-hidden rounded-full bg-paper-2">
                  <motion.span className={cn("block h-full rounded-full", pct === 100 ? "bg-success" : "bg-ink")} initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }} />
                </span>
                <span className="text-right font-mono text-[11px] text-ink-2">{c.have}/{c.total}</span>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="grid gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-2">
        {report.languages.map((l) => {
          const text = LANGUAGE_SAMPLES[l.name];
          return (
            <button
              key={l.name}
              type="button"
              disabled={!text}
              onClick={() => setSample(sample === l.name ? null : l.name)}
              className="flex items-start gap-2 bg-surface px-3 py-2 text-left transition-colors hover:bg-paper-2/60 disabled:cursor-default disabled:hover:bg-surface"
            >
              {l.supported ? <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-success" /> : <X aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-3" />}
              <span className="min-w-0">
                <span className="block text-sm text-ink">{l.name}</span>
                {!l.supported && <span className="block truncate text-[12px] text-ink-3">Missing {l.missing}</span>}
                {sample === l.name && text && (
                  <span className="mt-1.5 block text-[18px] leading-snug text-ink" style={{ fontFamily: family ? `"${family}", serif` : undefined }}>
                    {text}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
      <p className="px-1 text-xs text-ink-3">Tap a language to see a sentence in it. A language counts as supported when every letter it needs is in the font.</p>
    </div>
  );
}

function Details({ report }: { report: FontReport }) {
  const m = report.metrics;
  const rows: [string, string][] = [
    ["Embedding", report.embedding],
    ["Licence", report.licence ?? "Not stated"],
    ["Outlines", report.outline],
    ["Units per em", String(m.unitsPerEm)],
    ["Weight / width class", `${m.weightClass ?? "—"} / ${m.widthClass ?? "—"}`],
    ["Ascender / descender (typo)", `${m.typoAscender ?? "—"} / ${m.typoDescender ?? "—"} · gap ${m.typoLineGap ?? "—"}`],
    ["Ascender / descender (hhea)", `${m.hheaAscender ?? "—"} / ${m.hheaDescender ?? "—"} · gap ${m.hheaLineGap ?? "—"}`],
    ["Win ascent / descent", `${m.winAscent ?? "—"} / ${m.winDescent ?? "—"}`],
    ["Cap height / x-height", `${m.capHeight ?? "—"} / ${m.xHeight ?? "—"}`],
    ["Italic angle", String(m.italicAngle ?? 0)],
    ["Monospaced", m.isFixedPitch ? "Yes" : "No"],
    ["Vendor", String(m.vendor ?? "—")],
    ["Scripts in layout tables", report.scripts.join(", ") || "—"],
  ];
  return (
    <div className="space-y-3">
      <dl className="divide-y divide-line overflow-hidden rounded-md border border-line bg-surface">
        {report.names.map((n) => (
          <div key={n.id} className="grid gap-1 px-3 py-2 sm:grid-cols-[11rem_minmax(0,1fr)]">
            <dt className="label-mono text-ink-3">{n.label}</dt>
            <dd className="text-[13px] text-ink [overflow-wrap:anywhere]">{n.value}</dd>
          </div>
        ))}
      </dl>
      <dl className="divide-y divide-line overflow-hidden rounded-md border border-line bg-surface">
        {rows.map(([k, v]) => (
          <div key={k} className="grid gap-1 px-3 py-2 sm:grid-cols-[11rem_minmax(0,1fr)]">
            <dt className="label-mono text-ink-3">{k}</dt>
            <dd className="font-mono text-[13px] text-ink [overflow-wrap:anywhere]">{v}</dd>
          </div>
        ))}
      </dl>
      {report.features.length > 0 && (
        <div className="overflow-hidden rounded-md border border-line bg-surface">
          <p className="label-mono border-b border-line px-3 py-2 text-ink-3">OpenType features · {report.features.length}</p>
          <ul className="grid gap-px bg-line sm:grid-cols-2">
            {report.features.map((f) => (
              <li key={f.tag} className="flex gap-2 bg-surface px-3 py-1.5 text-[13px]">
                <span className="w-10 shrink-0 font-mono text-ink">{f.tag}</span>
                <span className="truncate text-ink-2">{f.name || "—"}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="overflow-hidden rounded-md border border-line bg-surface">
        <p className="label-mono border-b border-line px-3 py-2 text-ink-3">Tables · {report.tables.length}</p>
        <p className="flex flex-wrap gap-1.5 px-3 py-2.5">
          {report.tables.map((t) => (
            <span key={t.tag} className="inline-flex items-center gap-1.5 rounded-sm border border-line px-2 py-0.5 font-mono text-[12px] text-ink">
              {t.tag}
              {t.size !== null && <span className="text-ink-3">{formatBytes(t.size)}</span>}
            </span>
          ))}
        </p>
      </div>
    </div>
  );
}

/** Ways out: other formats for the same font, through the universal converter. */
function Actions({ file, report }: { file: File; report: FontReport }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!["ttf", "otf", "woff", "woff2"].includes(ext)) return null;
  const save = async (target: string) => {
    setBusy(target);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file, file.name);
      form.append("target", target);
      const out = await uploadForm("/api/tools/universal/convert", form, { fallbackName: `${report.family}.${target}` });
      saveBlob(out.blob, out.name);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-line px-3 py-2.5">
      <span className="label-mono mr-1 text-ink-3">Save as</span>
      {["woff2", "woff", "ttf", "otf"].filter((t) => t !== ext).map((t) => (
        <button key={t} type="button" disabled={Boolean(busy)} onClick={() => void save(t)} className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-line bg-surface px-2.5 font-mono text-[12px] text-ink hover:border-ink-3 disabled:opacity-50">
          <Download aria-hidden className={cn("size-3.5", busy === t && "animate-bounce")} />
          {t.toUpperCase()}
        </button>
      ))}
      <Link href={toolHref("font-creator")} className="ml-auto text-[13px] text-ink-2 underline decoration-line underline-offset-4 hover:text-ink">
        Make your own font
      </Link>
      {error && <p className="w-full text-xs text-danger">{error}</p>}
    </div>
  );
}

/* ---------- Fonts in a document ---------- */

function DocFonts({ doc, onOpen }: { doc: DocReport; onOpen: (f: File) => void }) {
  const notEmbedded = doc.fonts.filter((f) => !f.embedded && f.type !== "Theme").length;
  const fileOf = (i: number) => {
    const f = doc.files[i];
    return new File([fromBase64(f.data) as BlobPart], f.name, { type: `font/${f.ext}` });
  };
  return (
    <div className="space-y-3">
      <Notice tone={notEmbedded && doc.kind === "PDF" ? "warning" : "info"}>
        {doc.fonts.length ? `${doc.fonts.length} font${doc.fonts.length === 1 ? "" : "s"} in this ${doc.kind}.` : `No fonts were found in this ${doc.kind}.`}{" "}
        {notEmbedded && doc.kind === "PDF" ? `${notEmbedded} aren't embedded, so other computers will swap in a lookalike.` : doc.files.length ? `${doc.files.length} embedded font file${doc.files.length === 1 ? "" : "s"} can be opened here.` : ""}
      </Notice>
      <ul className="divide-y divide-line overflow-hidden rounded-md border border-line bg-surface">
        {doc.fonts.map((f, i) => (
          <motion.li key={f.name} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 12) * 0.03 }} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-medium text-ink" style={{ fontFamily: `"${f.name}", var(--font-sans)` }}>
                {f.name}
              </p>
              <p className="truncate text-[12px] text-ink-3">
                {[f.type, f.where.join(" · "), f.uses ? `${f.uses.toLocaleString("en")} use${f.uses === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ")}
              </p>
            </div>
            <span className="flex shrink-0 items-center gap-1.5">
              {f.type === "Theme" ? (
                <Badge tone="muted">Theme</Badge>
              ) : f.embedded ? (
                <Badge tone="good">{f.subset ? "Embedded subset" : "Embedded"}</Badge>
              ) : (
                <Badge tone="warn">Not embedded</Badge>
              )}
              {f.file !== null && (
                <>
                  <button type="button" onClick={() => onOpen(fileOf(f.file!))} className="inline-flex h-8 items-center rounded-sm bg-ink px-2.5 text-[13px] text-paper">
                    Check it
                  </button>
                  <button type="button" aria-label={`Download ${f.name}`} onClick={() => saveBlob(fileOf(f.file!), doc.files[f.file!].name)} className="inline-flex size-8 items-center justify-center rounded-sm border border-line text-ink-2 hover:border-ink-3 hover:text-ink">
                    <Download aria-hidden className="size-4" />
                  </button>
                </>
              )}
            </span>
          </motion.li>
        ))}
      </ul>
    </div>
  );
}

function Badge({ tone, children }: { tone: "good" | "warn" | "muted"; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex h-6 items-center whitespace-nowrap rounded-sm px-2 text-[12px]", tone === "good" ? "bg-success/10 text-success" : tone === "warn" ? "bg-warning/15 text-ink" : "bg-paper-2 text-ink-3")}>
      {children}
    </span>
  );
}
