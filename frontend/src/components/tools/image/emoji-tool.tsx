"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Download, Package, Search } from "lucide-react";
import { saveBlob } from "@/lib/files";
import { formatBytes } from "@/lib/media";
import { getTool, stepsFor } from "@/lib/tools";
import { zipFiles } from "@/lib/video";
import { cn } from "@/lib/utils";
import { Workbench } from "../workbench";
import { Chips, Notice, Panel, Row, Slider, Toggle } from "../pdf/kit";
import { CHECKER } from "./task";

type Emoji = { hexcode: string; label: string; unicode: string; group?: number; order?: number; tags?: string[]; skins?: Emoji[] };
type Style = "device" | "noto" | "twemoji" | "openmoji";
type Shape = "none" | "square" | "rounded" | "circle";

const STYLES: { value: Style; label: string; credit?: string }[] = [
  { value: "noto", label: "Noto (Google)", credit: "Noto Emoji by Google, Apache License 2.0" },
  { value: "twemoji", label: "Twemoji", credit: "Twemoji by Twitter, Inc and contributors, CC-BY 4.0" },
  { value: "openmoji", label: "OpenMoji", credit: "OpenMoji, CC BY-SA 4.0 (openmoji.org)" },
  { value: "device", label: "This device" },
];
const GROUPS = [
  { id: 0, label: "Smileys", sample: "😀" },
  { id: 1, label: "People", sample: "👋" },
  { id: 3, label: "Animals & nature", sample: "🐶" },
  { id: 4, label: "Food & drink", sample: "🍕" },
  { id: 5, label: "Travel & places", sample: "✈️" },
  { id: 6, label: "Activities", sample: "⚽" },
  { id: 7, label: "Objects", sample: "💡" },
  { id: 8, label: "Symbols", sample: "❤️" },
  { id: 9, label: "Flags", sample: "🏁" },
];
const SKIN_TONES = ["", "1F3FB", "1F3FC", "1F3FD", "1F3FE", "1F3FF"];
const ICON_SIZES = [16, 32, 48, 64, 128, 180, 192, 256, 512, 1024];

const codepoints = (s: string) => [...s].map((c) => c.codePointAt(0)!.toString(16));

/** Each set names its files a little differently around the FE0F variation selector; try in order. */
function candidates(style: Style, emoji: string): string[] {
  const cps = codepoints(emoji);
  const noFe = cps.filter((c) => c !== "fe0f");
  const zwj = cps.includes("200d");
  switch (style) {
    case "noto":
      return [`https://cdn.jsdelivr.net/gh/googlefonts/noto-emoji@v2.047/svg/emoji_u${noFe.join("_")}.svg`];
    case "twemoji":
      return [...new Set([(zwj ? cps : noFe).join("-"), noFe.join("-"), cps.join("-")])].map((n) => `https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/svg/${n}.svg`);
    case "openmoji":
      return [...new Set([cps.join("-"), noFe.join("-")])].map((n) => `https://cdn.jsdelivr.net/npm/openmoji@15.1.0/color/svg/${n.toUpperCase()}.svg`);
    default:
      return [];
  }
}

const loadImage = (url: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(url));
    img.src = url;
  });

async function artwork(style: Style, emoji: string): Promise<{ img: HTMLImageElement; url: string } | null> {
  for (const url of candidates(style, emoji)) {
    try {
      return { img: await loadImage(url), url };
    } catch {
      /* try the next spelling */
    }
  }
  return null;
}

type Look = { size: number; padding: number; shape: Shape; bg: string; shadow: boolean };

function render(canvas: HTMLCanvasElement, look: Look, art: HTMLImageElement | null, emoji: string) {
  const S = look.size;
  canvas.width = S;
  canvas.height = S;
  const g = canvas.getContext("2d")!;
  g.clearRect(0, 0, S, S);
  if (look.shape !== "none") {
    g.fillStyle = look.bg;
    g.beginPath();
    if (look.shape === "circle") g.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
    else g.roundRect(0, 0, S, S, look.shape === "rounded" ? S * 0.22 : 0);
    g.fill();
  }
  const inner = S * (1 - (2 * look.padding) / 100);
  const off = (S - inner) / 2;
  if (look.shadow) {
    g.shadowColor = "rgba(0,0,0,0.28)";
    g.shadowBlur = S * 0.04;
    g.shadowOffsetY = S * 0.02;
  }
  if (art) g.drawImage(art, off, off, inner, inner);
  else {
    g.font = `${Math.round(inner * 0.86)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","Twemoji Mozilla",sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(emoji, S / 2, S / 2 + inner * 0.04);
  }
}

export function EmojiTool({ toolId }: { toolId: string }) {
  const tool = getTool(toolId)!;
  const [all, setAll] = useState<Emoji[]>([]);
  const [group, setGroup] = useState(0);
  const [query, setQuery] = useState("");
  const [pasted, setPasted] = useState("");
  const [current, setCurrent] = useState<Emoji>({ hexcode: "1F600", label: "grinning face", unicode: "😀" });
  const [tone, setTone] = useState("");
  const [style, setStyle] = useState<Style>("noto");
  const [look, setLook] = useState<Look>({ size: 512, padding: 6, shape: "none", bg: "#fbfaf6", shadow: false });
  // The loaded artwork, tagged with what it's for, so a stale load never shows for another emoji.
  const [loaded, setLoaded] = useState<{ key: string; art: { img: HTMLImageElement; url: string } | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastSize, setLastSize] = useState<number | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const q = useDeferredValue(query.trim().toLowerCase());
  const setL = (p: Partial<Look>) => setLook((v) => ({ ...v, ...p }));

  useEffect(() => {
    void import("emojibase-data/en/compact.json").then((m) => setAll(((m as { default: Emoji[] }).default ?? m).filter((e) => e.group !== undefined && e.group !== 2)));
  }, []);

  // The emoji with the chosen skin tone, when it has one.
  const shown = useMemo(() => {
    if (!tone || !current.skins?.length) return current;
    return current.skins.find((s) => s.hexcode.includes(tone)) ?? current;
  }, [current, tone]);

  const artKey = `${style}:${shown.unicode}`;
  const art = style !== "device" && loaded?.key === artKey ? loaded.art : null;
  const missing = style !== "device" && loaded?.key === artKey && !loaded.art;
  useEffect(() => {
    if (style === "device") return;
    let live = true;
    void artwork(style, shown.unicode).then((a) => live && setLoaded({ key: `${style}:${shown.unicode}`, art: a }));
    return () => {
      live = false;
    };
  }, [style, shown]);

  useEffect(() => {
    if (canvas.current) render(canvas.current, { ...look, size: 320 }, art?.img ?? null, shown.unicode);
  }, [look, art, shown]);

  const list = useMemo(() => {
    if (q) return all.filter((e) => e.label.toLowerCase().includes(q) || e.tags?.some((t) => t.includes(q))).slice(0, 300);
    return all.filter((e) => e.group === group).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }, [all, q, group]);

  const takePasted = (v: string) => {
    setPasted(v);
    const seg = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(v.trim())][0]?.segment;
    if (!seg || !/\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(seg)) return;
    const hex = codepoints(seg).map((c) => c.toUpperCase()).join("-");
    const known = all.find((e) => e.hexcode === hex || e.unicode === seg);
    setCurrent(known ?? { hexcode: hex, label: "your emoji", unicode: seg });
    setTone("");
  };

  const fileBase = shown.label.replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "emoji";
  const makeBlob = async (size: number, type: string) => {
    const c = document.createElement("canvas");
    render(c, { ...look, size }, art?.img ?? null, shown.unicode);
    return new Promise<Blob>((r, j) => c.toBlob((b) => (b ? r(b) : j(new Error("Couldn't save"))), type, 0.95));
  };
  const download = async (fmt: "png" | "webp" | "svg") => {
    setBusy(true);
    try {
      if (fmt === "svg" && art) {
        const blob = await (await fetch(art.url)).blob();
        setLastSize(blob.size);
        return saveBlob(new Blob([blob], { type: "image/svg+xml" }), `${fileBase}.svg`);
      }
      const blob = await makeBlob(look.size, fmt === "png" ? "image/png" : "image/webp");
      setLastSize(blob.size);
      saveBlob(blob, `${fileBase}-${look.size}.${fmt}`);
    } finally {
      setBusy(false);
    }
  };
  const downloadSet = async () => {
    setBusy(true);
    try {
      const files = [];
      for (const s of ICON_SIZES) files.push({ name: `${fileBase}-${s}.png`, blob: await makeBlob(s, "image/png") });
      const zip = await zipFiles(files);
      setLastSize(zip.size);
      saveBlob(zip, `${fileBase}-icons.zip`);
    } finally {
      setBusy(false);
    }
  };

  const credit = STYLES.find((s) => s.value === style)?.credit;
  return (
    <Workbench steps={stepsFor(tool)} current={1} footer={`Made in your browser.${credit ? ` Artwork: ${credit}.` : " Uses your device's own emoji font."}`}>
      <div className="@container grid gap-4 p-3 sm:p-4 md:p-5">
        <div className="grid gap-4 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          {/* Preview and look */}
          <div className="grid content-start gap-3">
            <div className="mx-auto flex aspect-square w-full max-w-[360px] items-center justify-center rounded-md border border-line p-4" style={{ backgroundImage: CHECKER }}>
              <canvas ref={canvas} aria-label={`${shown.label}, as an image`} className="h-auto w-full max-w-[320px]" />
            </div>
            <p className="flex justify-between gap-2 font-mono text-[12px] text-ink-3">
              <span className="truncate">
                {shown.unicode} {shown.label}
              </span>
              <span>U+{shown.hexcode.replace(/-/g, " U+")}</span>
            </p>
            {missing && <Notice tone="warning">This set has no drawing for that emoji (it may be newer than the set). Try another style, or “This device”.</Notice>}
            <Panel>
              <Row label="Style">
                <Chips value={style} options={STYLES.map(({ value, label }) => ({ value, label }))} onChange={setStyle} label="Style" />
              </Row>
              <Row label="Size">
                <Slider label="Size" value={look.size} min={16} max={2048} step={16} onChange={(v) => setL({ size: v })} format={(v) => `${v} px`} />
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {[64, 128, 256, 512, 1024].map((s) => (
                    <button key={s} type="button" onClick={() => setL({ size: s })} className={cn("rounded-[6px] px-2 py-1 font-mono text-[12px]", look.size === s ? "bg-ink text-paper" : "bg-paper-2 text-ink-2 hover:text-ink")}>
                      {s}
                    </button>
                  ))}
                </div>
              </Row>
              <Row label="Background">
                <div className="grid gap-3">
                  <Chips value={look.shape} options={[{ value: "none", label: "Transparent" }, { value: "square", label: "Square" }, { value: "rounded", label: "Rounded" }, { value: "circle", label: "Circle" }]} onChange={(v) => setL({ shape: v })} label="Background" />
                  {look.shape !== "none" && (
                    <label className="inline-flex items-center gap-2 text-sm text-ink-2">
                      <input type="color" value={look.bg} onChange={(e) => setL({ bg: e.target.value })} className="size-9 cursor-pointer rounded-md border border-line bg-transparent" />
                      <span className="font-mono text-[12px]">{look.bg}</span>
                    </label>
                  )}
                  <Slider label="Padding" value={look.padding} min={0} max={30} onChange={(v) => setL({ padding: v })} format={(v) => `${v}%`} />
                  <Toggle checked={look.shadow} onChange={(v) => setL({ shadow: v })} label="Soft shadow" />
                </div>
              </Row>
            </Panel>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy || missing} onClick={() => download("png")} className="inline-flex h-11 items-center gap-2 rounded-md bg-ink px-5 text-sm font-medium text-paper transition-[opacity,transform] hover:opacity-90 active:scale-[0.98] disabled:opacity-40">
                <Download aria-hidden className="size-4" /> PNG <span className="font-mono text-[12px] font-normal text-paper/60">{look.size}px</span>
              </button>
              <button type="button" disabled={busy || missing} onClick={() => download("webp")} className="inline-flex h-11 items-center rounded-md border border-line bg-surface px-4 text-sm font-medium text-ink hover:border-ink-3 disabled:opacity-40">
                WebP
              </button>
              <button
                type="button"
                disabled={busy || !art || look.shape !== "none" || look.shadow}
                title={!art ? "SVG is available for Noto, Twemoji and OpenMoji" : look.shape !== "none" || look.shadow ? "SVG is the plain emoji: switch off the background and shadow" : undefined}
                onClick={() => download("svg")}
                className="inline-flex h-11 items-center rounded-md border border-line bg-surface px-4 text-sm font-medium text-ink hover:border-ink-3 disabled:opacity-40"
              >
                SVG
              </button>
              <button type="button" disabled={busy || missing} onClick={downloadSet} className="inline-flex h-11 items-center gap-2 rounded-md border border-line bg-surface px-4 text-sm font-medium text-ink hover:border-ink-3 disabled:opacity-40">
                <Package aria-hidden className="size-4" /> All icon sizes
              </button>
            </div>
            {lastSize !== null && <p className="font-mono text-[12px] text-ink-3">Last download: {formatBytes(lastSize)}</p>}
          </div>

          {/* Picker */}
          <div className="grid content-start gap-3">
            <label className="relative block">
              <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search: heart, cat, party, flag india…" aria-label="Search emoji" className="h-11 w-full rounded-md border border-line bg-surface pl-9 pr-3 text-[15px] text-ink outline-none placeholder:text-ink-3 focus:border-ink" />
            </label>
            <input value={pasted} onChange={(e) => takePasted(e.target.value)} placeholder="…or paste any emoji here" aria-label="Paste an emoji" className="h-10 rounded-md border border-dashed border-line bg-surface px-3 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-ink" />
            {!q && (
              <div role="tablist" aria-label="Emoji groups" className="flex flex-wrap gap-1">
                {GROUPS.map((gr) => (
                  <button key={gr.id} type="button" role="tab" aria-selected={group === gr.id} title={gr.label} onClick={() => setGroup(gr.id)} className={cn("inline-flex h-9 items-center gap-1.5 rounded-[8px] border px-2 text-[13px]", group === gr.id ? "border-ink bg-ink text-paper" : "border-line bg-surface text-ink-2 hover:border-ink-3")}>
                    <span className="text-base">{gr.sample}</span>
                    <span className="hidden @xl:inline">{gr.label}</span>
                  </button>
                ))}
              </div>
            )}
            {current.skins?.length ? (
              <div className="flex items-center gap-1.5">
                <span className="label-mono mr-1 text-ink-3">Skin tone</span>
                {SKIN_TONES.map((t, i) => (
                  <button key={t || "none"} type="button" onClick={() => setTone(t)} aria-pressed={tone === t} aria-label={t ? `Skin tone ${i}` : "Default skin tone"} className={cn("size-8 rounded-full border-2", tone === t ? "border-ink" : "border-transparent")} style={{ background: ["#ffc93a", "#f7dece", "#f3d2a2", "#d5ab88", "#af7e57", "#7c533e"][i] }} />
                ))}
              </div>
            ) : null}
            <div className="max-h-[520px] overflow-auto rounded-md border border-line bg-surface p-2" data-lenis-prevent>
              {!all.length ? (
                <p className="p-3 text-sm text-ink-3">Loading emoji…</p>
              ) : list.length ? (
                <ul className="grid grid-cols-[repeat(auto-fill,minmax(44px,1fr))] gap-0.5">
                  {list.map((e) => (
                    <li key={e.hexcode}>
                      <button type="button" title={e.label} aria-label={e.label} aria-pressed={current.hexcode === e.hexcode} onClick={() => (setCurrent(e), setTone(""))} className={cn("flex size-11 items-center justify-center rounded-[8px] text-[26px] leading-none transition-[background-color,transform] hover:scale-110 hover:bg-paper-2", current.hexcode === e.hexcode && "bg-ink/10 ring-2 ring-ink")}>
                        {e.unicode}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="p-3 text-sm text-ink-3">No emoji matches “{query}”.</p>
              )}
            </div>
            <p className="font-mono text-[12px] text-ink-3">{q ? `${list.length} matches` : `${list.length} in this group`} · {all.length} emoji in all</p>
          </div>
        </div>
      </div>
    </Workbench>
  );
}
