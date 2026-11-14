"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { Check, Copy, Download, FolderOpen, Languages, Loader2, Plus, RotateCcw, Trash2, Video } from "lucide-react";
import { saveBlob } from "@/lib/files";
import { fixOverlaps, formatTime, newId, parseSubtitles, parseTime, problems, writeSubtitles, type Cue } from "@/lib/subtitles";
import { getTool, stepsFor } from "@/lib/tools";
import { FALLBACK_LANGUAGES, loadCapabilities, translateBatch, type TranslateLanguage } from "@/lib/translate";
import { cn } from "@/lib/utils";
import { Workbench } from "../workbench";
import { Chips, Notice, Panel, Row, TextField } from "../pdf/kit";

const SAMPLE = `1
00:00:01,000 --> 00:00:03,500
Hello, and welcome.

2
00:00:03,400 --> 00:00:06,000
Subtitles here can be shifted, edited
and saved as SRT, VTT or text.

3
00:00:06,500 --> 00:00:09,000
Drag a video in to check the timing.
`;

const FPS = [23.976, 24, 25, 29.97, 30];

function TimeField({ ms, onChange, label, bad }: { ms: number; onChange: (ms: number) => void; label: string; bad?: boolean }) {
  const [text, setText] = useState(formatTime(ms, "srt"));
  const [focus, setFocus] = useState(false);
  const shown = focus ? text : formatTime(ms, "srt");
  return (
    <input
      value={shown}
      aria-label={label}
      onFocus={() => (setFocus(true), setText(formatTime(ms, "srt")))}
      onChange={(e) => {
        setText(e.target.value);
        const v = parseTime(e.target.value);
        if (v !== null) onChange(v);
      }}
      onBlur={() => setFocus(false)}
      className={cn("h-9 w-[118px] rounded-[8px] border bg-surface px-2 font-mono text-[12px] text-ink outline-none focus:border-ink", bad ? "border-danger/60" : "border-line")}
    />
  );
}

export function SubtitleTool({ toolId }: { toolId: string }) {
  const tool = getTool(toolId)!;
  const [cues, setCues] = useState<Cue[]>(() => parseSubtitles(SAMPLE).cues);
  const [name, setName] = useState("subtitles");
  const [note, setNote] = useState<string | null>(null);
  const [shift, setShift] = useState("1.5");
  const [from, setFrom] = useState<"all" | "picked">("all");
  const [picked, setPicked] = useState<number | null>(null);
  const [fps, setFps] = useState({ from: 23.976, to: 25 });
  const [video, setVideo] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  const [trLangs, setTrLangs] = useState<TranslateLanguage[]>(FALLBACK_LANGUAGES);
  const [trLang, setTrLang] = useState("es");
  const [trBusy, setTrBusy] = useState(false);
  const [trError, setTrError] = useState<string | null>(null);
  const [sourceCues, setSourceCues] = useState<Cue[] | null>(null);
  const [copiedSide, setCopiedSide] = useState<"source" | "translated" | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const player = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    let activeReq = true;
    loadCapabilities()
      .then((caps) => {
        if (activeReq && caps.languages?.length) setTrLangs(caps.languages);
      })
      .catch(() => {});
    return () => {
      activeReq = false;
    };
  }, []);

  useEffect(() => () => {
    if (video) URL.revokeObjectURL(video);
  }, [video]);

  const sorted = useMemo(() => [...cues].sort((a, b) => a.start - b.start), [cues]);
  const bad = useMemo(() => problems(cues), [cues]);
  const current = sorted.find((c) => now >= c.start && now <= c.end);

  const open = async (f: File) => {
    if (f.size > 5 * 1024 * 1024) return setNote("That file is over 5 MB; subtitle files are much smaller. Is it the right one?");
    const text = await f.text();
    const r = parseSubtitles(text);
    if (!r.cues.length) return setNote("No subtitles found in that file. Use an .srt or .vtt file.");
    setCues(r.cues);
    setSourceCues(null);
    setTrError(null);
    setName(f.name.replace(/\.[^.]+$/, ""));
    setNote(`${r.cues.length} subtitles read (${r.format.toUpperCase()})${r.skipped ? `; ${r.skipped} block${r.skipped === 1 ? "" : "s"} couldn't be read and were left out` : ""}.`);
  };

  const translateCaptions = async () => {
    if (!cues.length || trBusy) return;
    setTrBusy(true);
    setTrError(null);
    const baseline = sourceCues ?? cues;
    try {
      const res = await translateBatch({
        texts: baseline.map((c) => c.text),
        source: "auto",
        target: trLang,
      });
      if (!sourceCues) setSourceCues(cues);
      const idToText = new Map<number, string>();
      baseline.forEach((c, idx) => idToText.set(c.id, res.translated_texts[idx] ?? c.text));
      setCues((all) => all.map((c) => ({ ...c, text: idToText.get(c.id) ?? c.text })));
      setNote(`Translated ${baseline.length} captions from ${res.detected_language_name} to ${res.target_language_name}.`);
    } catch (e) {
      setTrError(e instanceof Error ? e.message : "Could not translate those captions.");
    } finally {
      setTrBusy(false);
    }
  };

  const restoreSourceCaptions = () => {
    if (!sourceCues) return;
    const textMap = new Map(sourceCues.map((c) => [c.id, c.text]));
    setCues((all) => all.map((c) => ({ ...c, text: textMap.get(c.id) ?? c.text })));
    setSourceCues(null);
    setTrError(null);
  };

  const copyCaptionText = async (side: "source" | "translated") => {
    const list = side === "source" && sourceCues ? sourceCues : cues;
    const plain = list.map((c) => c.text.trim()).filter(Boolean).join("\n");
    if (!plain) return;
    try {
      await navigator.clipboard.writeText(plain);
      setCopiedSide(side);
      setTimeout(() => setCopiedSide(null), 1800);
    } catch {
      setCopiedSide(null);
    }
  };
  const update = (id: number, p: Partial<Cue>) => setCues((all) => all.map((c) => (c.id === id ? { ...c, ...p } : c)));

  const applyShift = (sign: 1 | -1) => {
    const d = Math.round(Number(shift) * 1000) * sign;
    if (!Number.isFinite(d) || !d) return;
    const pivot = from === "picked" && picked !== null ? (cues.find((c) => c.id === picked)?.start ?? 0) : -Infinity;
    setCues((all) => all.map((c) => (c.start >= pivot ? { ...c, start: Math.max(0, c.start + d), end: Math.max(0, c.end + d) } : c)));
  };
  const applyFps = () => {
    const k = fps.from / fps.to;
    setCues((all) => all.map((c) => ({ ...c, start: Math.round(c.start * k), end: Math.round(c.end * k) })));
  };
  const add = () => {
    const last = sorted.at(-1);
    const start = last ? last.end + 500 : 0;
    const c = { id: newId(), start, end: start + 2500, text: "New subtitle" };
    setCues((all) => [...all, c]);
    setPicked(c.id);
  };
  const vtt = useMemo(() => URL.createObjectURL(new Blob([writeSubtitles(cues, "vtt")], { type: "text/vtt" })), [cues]);
  useEffect(() => () => URL.revokeObjectURL(vtt), [vtt]);

  return (
    <Workbench
      steps={stepsFor(tool)}
      current={1}
      footer="Edited and previewed in your browser; translating caption lines uses the free translation service while keeping your video local."
    >
      <div className="@container grid gap-4 p-3 sm:p-4 md:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileInput} type="file" accept=".srt,.vtt,text/vtt" className="sr-only" onChange={(e) => (e.target.files?.[0] && void open(e.target.files[0]), (e.target.value = ""))} />
          <button type="button" onClick={() => fileInput.current?.click()} className="inline-flex h-10 items-center gap-2 rounded-md bg-ink px-4 text-sm font-medium text-paper hover:opacity-90">
            <FolderOpen aria-hidden className="size-4" /> Open .srt or .vtt
          </button>
          <input ref={videoInput} type="file" accept="video/*" className="sr-only" onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) setVideo(URL.createObjectURL(f));
            e.target.value = "";
          }} />
          <button type="button" onClick={() => videoInput.current?.click()} className="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-surface px-4 text-sm font-medium text-ink hover:border-ink-3">
            <Video aria-hidden className="size-4" /> {video ? "Change the video" : "Check against a video"}
          </button>
          <span className="font-mono text-[12px] text-ink-3">
            {cues.length} subtitles{bad.size ? ` · ${bad.size} with timing problems` : ""}
          </span>
        </div>
        {note && <Notice>{note}</Notice>}

        {video && (
          <div className="relative overflow-hidden rounded-md border border-line bg-ink">
            <video ref={player} src={video} controls playsInline onTimeUpdate={(e) => setNow(e.currentTarget.currentTime * 1000)} className="max-h-[360px] w-full">
              <track kind="subtitles" src={vtt} default label="Preview" />
            </video>
            <p className="border-t border-line-dark px-3 py-1.5 font-mono text-[12px] text-paper-dim">
              {formatTime(now, "srt")} {current ? `· #${sorted.indexOf(current) + 1}` : ""}
            </p>
          </div>
        )}

        <Panel>
          <Row label="Shift the timing">
            <div className="flex flex-wrap items-center gap-2">
              <div className="w-24">
                <TextField label="Seconds to shift" value={shift} onChange={(v) => setShift(v.replace(/[^\d.]/g, "").slice(0, 7))} mono inputMode="decimal" />
              </div>
              <span className="text-sm text-ink-2">seconds</span>
              <button type="button" onClick={() => applyShift(-1)} className="h-10 rounded-md border border-line bg-surface px-3 text-sm text-ink hover:border-ink-3">
                Earlier
              </button>
              <button type="button" onClick={() => applyShift(1)} className="h-10 rounded-md border border-line bg-surface px-3 text-sm text-ink hover:border-ink-3">
                Later
              </button>
            </div>
            <div className="mt-3">
              <Chips value={from} options={[{ value: "all", label: "Every subtitle" }, { value: "picked", label: "From the picked one on", disabled: picked === null }]} onChange={setFrom} label="Which subtitles" />
            </div>
          </Row>
          <Row label="Frame rate" hint="When the video was re-encoded at another speed">
            <div className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
              From
              <select value={fps.from} onChange={(e) => setFps((f) => ({ ...f, from: Number(e.target.value) }))} aria-label="From frame rate" className="h-10 rounded-md border border-line bg-surface px-2 font-mono text-[13px] text-ink">
                {FPS.map((v) => <option key={v}>{v}</option>)}
              </select>
              to
              <select value={fps.to} onChange={(e) => setFps((f) => ({ ...f, to: Number(e.target.value) }))} aria-label="To frame rate" className="h-10 rounded-md border border-line bg-surface px-2 font-mono text-[13px] text-ink">
                {FPS.map((v) => <option key={v}>{v}</option>)}
              </select>
              fps
              <button type="button" onClick={applyFps} disabled={fps.from === fps.to} className="h-10 rounded-md border border-line bg-surface px-3 text-sm text-ink hover:border-ink-3 disabled:opacity-40">
                Convert
              </button>
            </div>
          </Row>
          <Row
            label="Translate captions"
            hint={
              <Link href="/tools/translator" className="underline underline-offset-4 hover:text-ink">
                Need spoken video dubbing? Open Translator
              </Link>
            }
          >
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <select
                  aria-label="Target subtitle language"
                  value={trLang}
                  onChange={(e) => setTrLang(e.target.value)}
                  disabled={trBusy}
                  className="h-10 min-w-[180px] rounded-md border border-line bg-surface px-2.5 text-sm text-ink outline-none focus:border-ink"
                >
                  {trLangs.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.name}
                      {l.native_name !== l.name ? ` (${l.native_name})` : ""}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={translateCaptions}
                  disabled={trBusy || !cues.length}
                  className="inline-flex h-10 items-center gap-1.5 rounded-md bg-ink px-4 text-sm font-medium text-paper transition-colors hover:bg-ink/85 disabled:opacity-45"
                >
                  {trBusy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Languages className="size-4" aria-hidden />}
                  {trBusy ? "Translating…" : "Translate captions"}
                </button>
                {sourceCues && (
                  <button
                    type="button"
                    onClick={restoreSourceCaptions}
                    disabled={trBusy}
                    className="inline-flex h-10 items-center gap-1.5 rounded-md border border-line bg-surface px-3 text-sm text-ink-2 hover:border-ink-3 hover:text-ink"
                  >
                    <RotateCcw className="size-4" aria-hidden />
                    Restore original
                  </button>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {sourceCues && (
                  <button
                    type="button"
                    onClick={() => copyCaptionText("source")}
                    className="inline-flex items-center gap-1.5 rounded-sm border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-ink hover:border-ink-3"
                  >
                    {copiedSide === "source" ? <Check className="size-3.5 text-accent" aria-hidden /> : <Copy className="size-3.5 text-ink-3" aria-hidden />}
                    {copiedSide === "source" ? "Copied input" : "Copy input text"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => copyCaptionText("translated")}
                  disabled={!cues.length}
                  className="inline-flex items-center gap-1.5 rounded-sm border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-ink hover:border-ink-3 disabled:opacity-40"
                >
                  {copiedSide === "translated" ? <Check className="size-3.5 text-accent" aria-hidden /> : <Copy className="size-3.5 text-ink-3" aria-hidden />}
                  {copiedSide === "translated" ? "Copied text" : sourceCues ? "Copy translated text" : "Copy all text"}
                </button>
              </div>
              {trError && <Notice tone="danger">{trError}</Notice>}
            </div>
          </Row>
        </Panel>

        {bad.size > 0 && (
          <Notice tone="warning">
            {bad.size} subtitle{bad.size === 1 ? "" : "s"} overlap the next one or end before they start (marked in red).{" "}
            <button type="button" onClick={() => setCues((c) => fixOverlaps(c))} className="font-medium text-ink underline underline-offset-4">
              Fix overlaps
            </button>
          </Notice>
        )}

        <ol className="grid max-h-[560px] gap-px overflow-auto rounded-md border border-line bg-line" data-lenis-prevent>
          <AnimatePresence initial={false}>
            {sorted.map((c, i) => (
              <motion.li
                key={c.id}
                layout
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setPicked(c.id)}
                className={cn("grid gap-2 px-3 py-2.5 @2xl:grid-cols-[auto_auto_minmax(0,1fr)_auto] @2xl:items-start", picked === c.id ? "bg-surface ring-1 ring-inset ring-ink" : "bg-paper", current?.id === c.id && "bg-accent/10")}
              >
                <button
                  type="button"
                  onClick={() => {
                    if (player.current) player.current.currentTime = c.start / 1000;
                  }}
                  title="Play from here"
                  className={cn("w-10 pt-2 text-left font-mono text-[12px]", bad.has(c.id) ? "text-danger" : "text-ink-3")}
                >
                  #{i + 1}
                </button>
                <div className="flex items-center gap-1.5">
                  <TimeField ms={c.start} label={`Subtitle ${i + 1} start`} bad={bad.has(c.id)} onChange={(v) => update(c.id, { start: v })} />
                  <span className="text-ink-3">→</span>
                  <TimeField ms={c.end} label={`Subtitle ${i + 1} end`} bad={bad.has(c.id)} onChange={(v) => update(c.id, { end: v })} />
                </div>
                <textarea
                  value={c.text}
                  onChange={(e) => update(c.id, { text: e.target.value })}
                  rows={Math.min(4, Math.max(1, c.text.split("\n").length))}
                  aria-label={`Subtitle ${i + 1} text`}
                  className="w-full resize-y rounded-[8px] border border-line bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-ink"
                />
                <button type="button" onClick={() => setCues((all) => all.filter((x) => x.id !== c.id))} aria-label={`Delete subtitle ${i + 1}`} className="inline-flex size-9 items-center justify-center rounded-[8px] text-ink-3 hover:bg-paper-2 hover:text-danger">
                  <Trash2 aria-hidden className="size-4" />
                </button>
              </motion.li>
            ))}
          </AnimatePresence>
        </ol>
        <button type="button" onClick={add} className="inline-flex h-10 w-fit items-center gap-1.5 rounded-md border border-dashed border-ink-3/60 px-3 text-sm text-ink-2 hover:border-ink hover:text-ink">
          <Plus aria-hidden className="size-4" /> Add a subtitle
        </button>

        <div className="flex flex-wrap gap-2">
          {(["srt", "vtt", "txt"] as const).map((k, i) => (
            <button
              key={k}
              type="button"
              disabled={!cues.length}
              onClick={() => saveBlob(new Blob([writeSubtitles(cues, k)], { type: k === "vtt" ? "text/vtt" : "text/plain;charset=utf-8" }), `${name}.${k}`)}
              className={cn("inline-flex h-11 items-center gap-2 rounded-md px-5 text-sm font-medium disabled:opacity-40", i === 0 ? "bg-ink text-paper hover:opacity-90" : "border border-line bg-surface text-ink hover:border-ink-3")}
            >
              {i === 0 && <Download aria-hidden className="size-4" />} {k === "txt" ? "Plain text" : k.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
    </Workbench>
  );
}
