"use client";

import { useMemo, useRef, useState } from "react";
import { Captions, Cpu, Crop, Crosshair, Eraser, FileDown, FileUp, Languages, ScanSearch, Scissors, Search, Send, Sparkles, UserRound, Vibrate, Wand, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { CAPTION_LANGUAGES, CAPTION_STYLES } from "../constants";
import { rt } from "../lib/time";
import * as TL from "../lib/timeline";
import { getStudio, usePrimaryClip, useStudio } from "../store/studio-store";
import type { CaptionStyleId, DirectorOp } from "../types";
import { analyzeShake, autoReframe, detectScenes } from "../engine/ai/analysis";
import { autoCaptions } from "../engine/ai/captions";
import { removeBackground } from "../engine/ai/cutout";
import { applyPlan, describeOp, planEdits } from "../engine/ai/director";
import { applySilenceCut, planSilenceCut } from "../engine/ai/silence";
import { exportSubtitles, importCues, parseSubtitles, translateCaptions } from "../engine/subtitles";
import { Progress, Row, Section, Select, Slider, TextButton, Toggle } from "./controls";

/** Runs a long AI job with its progress kept in the store (so it survives switching tabs). */
export async function runJob(key: string, label: string, work: (progress: (label: string, f?: number) => void) => Promise<unknown>) {
  const st = getStudio();
  if (st.jobs[key]) return;
  st.setJob(key, { label, progress: 0 });
  try {
    await work((l, f) => getStudio().setJob(key, { label: l, progress: f ?? -1 }));
  } catch (e) {
    getStudio().notify(e instanceof Error ? e.message : "That didn't work.", "danger");
  } finally {
    getStudio().setJob(key, null);
  }
}

export function JobLine({ id }: { id: string }) {
  const job = useStudio((s) => s.jobs[id]);
  if (!job) return null;
  return <Progress value={job.progress >= 0 ? job.progress : undefined} label={job.label} />;
}

const EXAMPLES = [
  "Cut the pauses and add bold captions",
  "Make it cinematic",
  "Vertical for Reels",
  "Cross dissolves between clips",
  "Add a title “Day one”",
  "Speed it up 2x",
  "Hero speed ramp",
  "Stabilize it",
  "Duck the music",
  "Cut on the beat",
  "Add 35mm film halation",
  "Add an adjustment layer",
  "Add anamorphic lens flare",
];

function Director() {
  const [prompt, setPrompt] = useState("");
  const [plan, setPlan] = useState<{ ops: DirectorOp[]; engine: string; note?: string } | null>(null);
  const busy = useStudio((s) => !!s.jobs.director);
  const project = useStudio((s) => s.project);
  const ask = () =>
    runJob("director", "Planning the edit", async () => {
      const p = await planEdits(prompt.trim());
      if (!p.ops.length) getStudio().notify("I couldn't turn that into edits. Try something like “cut the pauses”, “add captions” or “make it warm”.", "warning");
      setPlan(p.ops.length ? p : null);
    });
  const apply = () => {
    if (!plan) return;
    const ops = plan.ops;
    setPlan(null);
    void runJob("director", "Applying", async (progress) => {
      await applyPlan(ops, progress);
      getStudio().notify(`Done: ${ops.length} edit${ops.length === 1 ? "" : "s"}. Ctrl+Z undoes them.`, "success");
    });
  };
  return (
    <Section title="AI Director">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (prompt.trim() && !busy) void ask();
        }}
      >
        <div className="flex gap-1.5">
          <textarea
            aria-label="Tell the editor what to do"
            value={prompt}
            rows={2}
            placeholder="Cut the silences and add karaoke captions…"
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (prompt.trim() && !busy) void ask();
              }
            }}
            className="min-w-0 flex-1 resize-none rounded-sm border border-line-dark bg-ink px-2 py-1.5 text-[13px] leading-snug text-paper outline-none placeholder:text-paper-dim/60 focus-visible:border-accent"
          />
          <TextButton type="submit" tone="primary" disabled={!prompt.trim() || busy} aria-label="Plan these edits" className="h-auto">
            <Send aria-hidden className="size-4" />
          </TextButton>
        </div>
      </form>
      <div className="mt-2 flex flex-wrap gap-1">
        {EXAMPLES.map((x) => (
          <button key={x} type="button" onClick={() => setPrompt(x)} className="rounded-sm border border-line-dark px-1.5 py-0.5 text-[12px] text-paper-dim hover:bg-paper/10 hover:text-paper">
            {x}
          </button>
        ))}
      </div>
      <JobLine id="director" />
      {plan && (
        <div className="mt-3 rounded-md border border-line-dark p-2">
          <p className="label-mono mb-1.5 text-paper-dim">
            Plan · {plan.engine === "rules" ? "built-in commands" : plan.engine === "gemini" ? "Gemini" : plan.engine === "groq" ? "Groq" : plan.engine}
          </p>
          <ol className="space-y-1">
            {plan.ops.map((op, i) => (
              <li key={i} className="flex gap-2 text-[12px] leading-snug text-paper">
                <span className="font-mono text-paper-dim">{String(i + 1).padStart(2, "0")}</span>
                {describeOp(op, project)}
              </li>
            ))}
          </ol>
          {plan.note && <p className="mt-1.5 text-[12px] text-paper-dim">{plan.note}</p>}
          <div className="mt-2 flex gap-1.5">
            <TextButton tone="primary" onClick={apply}>
              <Wand aria-hidden className="size-3.5" />
              Apply
            </TextButton>
            <TextButton onClick={() => setPlan(null)}>Discard</TextButton>
          </div>
        </div>
      )}
      <p className="mt-2 text-[12px] leading-relaxed text-paper-dim">Your request and a summary of the timeline (names and times, never the media) go to the free AI on our server; without it, built-in commands handle the common asks.</p>
    </Section>
  );
}

const TRANSLATE_TO = [
  { code: "en", label: "English" },
  { code: "hi", label: "Hindi" },
  { code: "bn", label: "Bengali" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "pt", label: "Portuguese" },
  { code: "ar", label: "Arabic" },
  { code: "ja", label: "Japanese" },
  { code: "zh", label: "Chinese" },
  { code: "ru", label: "Russian" },
  { code: "id", label: "Indonesian" },
];

function CaptionsBox() {
  const [style, setStyle] = useState<CaptionStyleId>("bold");
  const [words, setWords] = useState(4);
  const [language, setLanguage] = useState("en");
  const [toEnglish, setToEnglish] = useState(false);
  const [target, setTarget] = useState("hi");
  const busy = useStudio((s) => !!s.jobs.captions);
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <Section title="Auto captions">
      <Row label="Speech in">
        <Select label="Spoken language" value={language} onChange={setLanguage} options={CAPTION_LANGUAGES.map((l) => ({ value: l.code, label: l.label }))} />
      </Row>
      {language !== "en" && (
        <Row label="Subtitles">
          <Toggle label="Translate into English" checked={toEnglish} onChange={setToEnglish} />
          <span className="text-[12px] text-paper-dim">{toEnglish ? "In English" : "As spoken"}</span>
        </Row>
      )}
      <Row label="Style">
        <select
          aria-label="Caption style"
          value={style}
          onChange={(e) => setStyle(e.target.value as CaptionStyleId)}
          className="h-7 min-w-0 flex-1 rounded-sm border border-line-dark bg-ink px-1.5 text-[12px] text-paper"
        >
          {(Object.keys(CAPTION_STYLES) as CaptionStyleId[]).map((id) => (
            <option key={id} value={id}>
              {CAPTION_STYLES[id].label}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Words a line">
        <Slider label="Words per line" value={words} min={1} max={10} step={1} onChange={setWords} />
        <span className="w-6 text-right font-mono text-[12px] text-paper-dim">{words}</span>
      </Row>
      <TextButton
        tone="primary"
        className="mt-2 w-full"
        disabled={busy}
        onClick={() => void runJob("captions", "Starting", (p) => autoCaptions({ style, maxWords: words, language, translate: language !== "en" && toEnglish }, p))}
      >
        <Captions aria-hidden className="size-4" />
        Generate captions
      </TextButton>
      <JobLine id="captions" />
      <p className="mt-2 text-[12px] leading-relaxed text-paper-dim">
        Whisper runs on this device with each word timed: a ~40 MB English model, or a ~80 MB model for 99 other languages (downloaded once). The selected clips, or every clip with sound.
      </p>
      <p className="label-mono mb-1 mt-3 text-paper-dim">Translate captions</p>
      <div className="flex gap-1.5">
        <Select label="Translate captions into" value={target} onChange={setTarget} options={TRANSLATE_TO.map((l) => ({ value: l.code, label: l.label }))} />
        <TextButton
          disabled={busy}
          onClick={() =>
            void runJob("captions", "Translating", async () => {
              await translateCaptions(target, TRANSLATE_TO.find((l) => l.code === target)?.label ?? target);
            })
          }
        >
          <Languages aria-hidden className="size-3.5" />
          Translate
        </TextButton>
      </div>
      <p className="mt-1 text-[12px] leading-relaxed text-paper-dim">Adds a second caption track in that language (the caption text goes to the site&apos;s free translator).</p>
      <p className="label-mono mb-1 mt-3 text-paper-dim">Subtitle files</p>
      <div className="grid grid-cols-3 gap-1.5">
        <TextButton onClick={() => fileRef.current?.click()} title="Import an .srt or .vtt file as captions">
          <FileUp aria-hidden className="size-3.5" />
          Import
        </TextButton>
        <TextButton
          onClick={() => {
            try {
              exportSubtitles("srt");
            } catch (e) {
              getStudio().notify(e instanceof Error ? e.message : "Nothing to export.", "info");
            }
          }}
        >
          <FileDown aria-hidden className="size-3.5" />
          .srt
        </TextButton>
        <TextButton
          onClick={() => {
            try {
              exportSubtitles("vtt");
            } catch (e) {
              getStudio().notify(e instanceof Error ? e.message : "Nothing to export.", "info");
            }
          }}
        >
          <FileDown aria-hidden className="size-3.5" />
          .vtt
        </TextButton>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".srt,.vtt,text/vtt,application/x-subrip"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          try {
            importCues(parseSubtitles(await f.text()), style);
          } catch (err) {
            getStudio().notify(err instanceof Error ? err.message : "That subtitle file couldn't be read.", "danger");
          }
        }}
      />
    </Section>
  );
}

/* ---------- Edit by transcript (Descript / Premiere text-based editing) ---------- */

const FILLERS = /^(um+|uh+|uhm+|umm+|erm+|er|ah+|hmm+|mm+|mhm|uh-huh|like|you know|i mean|basically|actually|literally|so)$/i;
const STRICT_FILLERS = /^(um+|uh+|uhm+|umm+|erm+|er|ah+|hmm+|mm+|mhm)$/i;

type TWord = { key: string; text: string; start: number; end: number };

function TranscriptBox() {
  const project = useStudio((s) => s.project);
  const playhead = useStudio((s) => s.playhead);
  const [sel, setSel] = useState<[number, number] | null>(null);
  const [q, setQ] = useState("");
  const [strict, setStrict] = useState(true);
  const words = useMemo(() => {
    const out: TWord[] = [];
    for (const c of Object.values(project.clips)) {
      if (c.kind !== "text" || !c.text?.words?.length) continue;
      c.text.words.forEach((w, i) => out.push({ key: `${c.id}:${i}`, text: w.text, start: rt(c.start + w.start), end: rt(c.start + w.end) }));
    }
    return out.sort((a, b) => a.start - b.start);
  }, [project.clips]);
  const query = q.trim().toLowerCase();
  const st = getStudio();
  if (!words.length) {
    return (
      <Section title="Edit by transcript" defaultOpen={false}>
        <p className="text-[12px] leading-relaxed text-paper-dim">Generate captions first: the words then appear here, and deleting words cuts the video (like Descript and Premiere&apos;s text-based editing).</p>
      </Section>
    );
  }
  const cutRanges = (ranges: [number, number][]) => {
    if (!ranges.length) return;
    const tracks = st.project.tracks.filter((t) => !t.locked).map((t) => t.id);
    st.commit((p) => TL.rippleDeleteRanges(p, tracks, ranges));
    setSel(null);
  };
  const fillers = words.filter((w) => (strict ? STRICT_FILLERS : FILLERS).test(w.text.replace(/[.,!?;:"“”]/g, "").trim()));
  const repeats = words.filter((w, i) => i > 0 && w.text.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "") === words[i - 1].text.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "") && w.start - words[i - 1].end < 0.6);
  const lo = sel ? Math.min(sel[0], sel[1]) : -1;
  const hi = sel ? Math.max(sel[0], sel[1]) : -1;
  return (
    <Section title="Edit by transcript">
      <label className="mb-2 flex h-8 items-center gap-1.5 rounded-sm border border-line-dark bg-ink px-2 focus-within:border-accent">
        <Search aria-hidden className="size-3.5 shrink-0 text-paper-dim" />
        <input aria-label="Search the transcript" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder="Search what was said" className="h-full min-w-0 flex-1 bg-transparent text-[12px] text-paper outline-none placeholder:text-paper-dim/70" />
        {q && (
          <button type="button" aria-label="Clear" onClick={() => setQ("")} className="text-paper-dim hover:text-paper">
            <X aria-hidden className="size-3.5" />
          </button>
        )}
      </label>
      <div className="max-h-56 overflow-y-auto rounded-md border border-line-dark p-2 text-[13px] leading-7" data-lenis-prevent>
        {words.map((w, i) => {
          const now = playhead >= w.start && playhead < w.end;
          const hit = query && w.text.toLowerCase().includes(query);
          return (
            <button
              key={w.key}
              type="button"
              onClick={(e) => {
                if (e.shiftKey && sel) setSel([sel[0], i]);
                else setSel([i, i]);
                st.set({ playing: false, playhead: w.start });
              }}
              className={cn(
                "mr-1 rounded-sm px-0.5 transition-colors",
                i >= lo && i <= hi ? "bg-accent text-paper" : hit ? "bg-warning/40 text-paper" : now ? "text-paper underline decoration-accent decoration-2 underline-offset-4" : "text-paper-dim hover:text-paper",
              )}
            >
              {w.text}
            </button>
          );
        })}
      </div>
      <p className="mt-1 text-[12px] text-paper-dim">Click a word to jump there; Shift-click to select a stretch.</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <TextButton tone="primary" disabled={!sel} onClick={() => sel && cutRanges([[words[lo].start, words[hi].end]])}>
          <Scissors aria-hidden className="size-3.5" />
          Cut {sel ? `${hi - lo + 1} word${hi === lo ? "" : "s"}` : "selection"}
        </TextButton>
        <TextButton disabled={!fillers.length} onClick={() => cutRanges(fillers.map((w) => [Math.max(0, w.start - 0.03), w.end + 0.03] as [number, number]))}>
          Remove {fillers.length} filler{fillers.length === 1 ? "" : "s"}
        </TextButton>
        <TextButton disabled={!repeats.length} onClick={() => cutRanges(repeats.map((w) => [w.start - 0.02, w.end + 0.02] as [number, number]))}>
          Remove {repeats.length} repeat{repeats.length === 1 ? "" : "s"}
        </TextButton>
      </div>
      <Row label="Fillers" className="mt-1">
        <Toggle label="Only um, uh and similar" checked={strict} onChange={setStrict} />
        <span className="text-[12px] text-paper-dim">{strict ? "um, uh, erm…" : "also like, so, you know…"}</span>
      </Row>
    </Section>
  );
}

/* ---------- Smart video tools ---------- */

function SmartVideoBox() {
  const c = usePrimaryClip();
  const busy = useStudio((s) => !!s.jobs.smart);
  const [sensitivity, setSensitivity] = useState(0.5);
  const video = c?.kind === "video" ? c : null;
  return (
    <Section title="Smart video tools">
      {!video ? (
        <p className="text-[12px] leading-relaxed text-paper-dim">Select a video clip to split it at scene changes, reframe it for another shape, or stabilise shaky footage.</p>
      ) : (
        <div className="space-y-1.5">
          <Row label="Sensitivity">
            <Slider label="Scene detection sensitivity" value={sensitivity} min={0} max={1} step={0.05} onChange={setSensitivity} />
          </Row>
          <TextButton
            className="w-full justify-start"
            disabled={busy}
            onClick={() =>
              void runJob("smart", "Finding scene changes", async (p) => {
                const cuts = await detectScenes(video.id, p, sensitivity);
                if (!cuts.length) return getStudio().notify("No scene changes found in this clip.", "info");
                getStudio().commit((proj) => {
                  let next = proj;
                  for (const t of cuts) {
                    const piece = Object.values(next.clips).find((x) => x.trackId === video.trackId && t > x.start + 0.05 && t < x.start + x.duration - 0.05);
                    if (piece) [next] = TL.splitClip(next, piece.id, t);
                  }
                  return next;
                });
                getStudio().notify(`Split into ${cuts.length + 1} shots.`, "success");
              })
            }
          >
            <ScanSearch aria-hidden className="size-4" />
            Split at scene changes
          </TextButton>
          <TextButton
            className="w-full justify-start"
            disabled={busy}
            onClick={() =>
              void runJob("smart", "Reframing", async (p) => {
                const n = await autoReframe(video.id, p);
                getStudio().notify(`Reframed: the shot follows the subject (${n} keyframes you can adjust).`, "success");
              })
            }
          >
            <Crop aria-hidden className="size-4" />
            Auto reframe (follow the person)
          </TextButton>
          <TextButton
            className="w-full justify-start"
            disabled={busy}
            onClick={() =>
              void runJob("smart", "Measuring shake", async (p) => {
                const data = await analyzeShake(video.id, p);
                getStudio().commit((proj) => TL.updateClip(proj, video.id, { stabilize: data }));
                getStudio().notify("Stabilised. Fine-tune the strength in the inspector.", "success");
              })
            }
          >
            <Vibrate aria-hidden className="size-4" />
            {video.stabilize ? "Measure the shake again" : "Stabilise"}
          </TextButton>
          <TextButton
            className="w-full justify-start"
            disabled={busy}
            onClick={() => {
              getStudio().set({ trackingPick: video.id });
              getStudio().notify("Click any high-contrast point on the preview to start 2D motion tracking.", "info");
            }}
          >
            <Crosshair aria-hidden className="size-4" />
            {video.trackData ? "Track another 2D point" : "2D Motion Tracker (pin text / VFX)"}
          </TextButton>
        </div>
      )}
      <JobLine id="smart" />
      <p className="mt-2 text-[12px] leading-relaxed text-paper-dim">All three run on this device. Reframe uses the same people finder as background removal; stabilise measures camera motion from frame to frame.</p>
    </Section>
  );
}

function SilenceBox() {
  const [threshold, setThreshold] = useState(-42);
  const [minSilence, setMinSilence] = useState(0.5);
  const [padding, setPadding] = useState(0.12);
  const plan = useStudio((s) => s.silence);
  const busy = useStudio((s) => !!s.jobs.silence);
  const st = getStudio();
  return (
    <Section title="Silence cutter">
      <Row label="Quieter than">
        <Slider label="Silence threshold" value={threshold} min={-70} max={-20} step={1} onChange={setThreshold} />
        <span className="w-12 text-right font-mono text-[12px] text-paper-dim">{threshold} dB</span>
      </Row>
      <Row label="For at least">
        <Slider label="Shortest pause" value={minSilence} min={0.15} max={2.5} step={0.05} onChange={setMinSilence} />
        <span className="w-12 text-right font-mono text-[12px] text-paper-dim">{minSilence.toFixed(2)}s</span>
      </Row>
      <Row label="Keep around">
        <Slider label="Padding kept around speech" value={padding} min={0} max={0.5} step={0.01} onChange={setPadding} />
        <span className="w-12 text-right font-mono text-[12px] text-paper-dim">{padding.toFixed(2)}s</span>
      </Row>
      <TextButton
        className="mt-2 w-full"
        disabled={busy}
        onClick={() =>
          void runJob("silence", "Listening", async (p) => {
            const plan = await planSilenceCut({ thresholdDb: threshold, minSilence, padding }, p);
            getStudio().set({ silence: plan });
            if (!plan.ranges.length) getStudio().notify("No pauses that long and that quiet. Try a higher threshold.", "info");
          })
        }
      >
        <Scissors aria-hidden className="size-4" />
        Find pauses
      </TextButton>
      <JobLine id="silence" />
      {plan && plan.ranges.length > 0 && (
        <div className="mt-2 rounded-md border border-danger/50 p-2">
          <p className="text-[12px] text-paper">
            {plan.ranges.length} pause{plan.ranges.length === 1 ? "" : "s"} · {plan.saved.toFixed(1)} s, marked red on the timeline.
          </p>
          <div className="mt-2 flex gap-1.5">
            <TextButton tone="primary" onClick={() => applySilenceCut(plan)}>
              Cut them
            </TextButton>
            <TextButton onClick={() => st.set({ silence: null })}>Clear</TextButton>
          </div>
        </div>
      )}
      <p className="mt-2 text-[12px] leading-relaxed text-paper-dim">Measures loudness locally (no model). Cuts the selected clips, or every clip with sound, and closes the gaps together with the linked video.</p>
    </Section>
  );
}

function BackgroundBox() {
  const c = usePrimaryClip();
  const busy = useStudio((s) => !!s.jobs.bg);
  const usable = c && (c.kind === "video" || c.kind === "image");
  return (
    <Section title="Remove background">
      {!usable ? (
        <p className="text-[12px] leading-relaxed text-paper-dim">Select a video or picture clip first.</p>
      ) : (
        <div className="space-y-1.5">
          <TextButton className="w-full justify-start" disabled={busy} onClick={() => void runJob("bg", "Loading", (p) => removeBackground(c!.id, p, "people"))}>
            <UserRound aria-hidden className="size-4" />
            People, live (video & pictures)
          </TextButton>
          {c!.kind === "image" && (
            <TextButton className="w-full justify-start" disabled={busy} onClick={() => void runJob("bg", "Loading", (p) => removeBackground(c!.id, p, "subject"))}>
              <Eraser aria-hidden className="size-4" />
              Any subject (picture)
            </TextButton>
          )}
        </div>
      )}
      <JobLine id="bg" />
      <p className="mt-2 text-[12px] leading-relaxed text-paper-dim">No green screen needed: MediaPipe finds people in every frame on your GPU. For a still, RMBG-1.4 cuts out any subject (non-commercial licence). For a real green screen, add Chroma key in Effects.</p>
    </Section>
  );
}

export function AIPanel() {
  const isolated = typeof window !== "undefined" && window.crossOriginIsolated;
  const gpu = typeof navigator !== "undefined" && "gpu" in navigator;
  return (
    <div className="h-full overflow-y-auto overscroll-contain" data-lenis-prevent>
      <div className="flex items-center gap-2 border-b border-line-dark px-3 py-2 text-[12px] text-paper-dim">
        <Cpu aria-hidden className="size-3.5 shrink-0" />
        <span className={cn(gpu && "text-paper")}>{gpu ? "WebGPU" : "CPU (WASM)"}</span>
        <span aria-hidden>·</span>
        <span className={cn(isolated && "text-paper")}>{isolated ? "multi-threaded" : "single thread"}</span>
        <span aria-hidden>·</span>
        <span>on this device</span>
        <Sparkles aria-hidden className="ml-auto size-3.5 text-accent" />
      </div>
      <Director />
      <CaptionsBox />
      <TranscriptBox />
      <SilenceBox />
      <SmartVideoBox />
      <BackgroundBox />
    </div>
  );
}
