"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ArrowUpRight,
  Check,
  Disc3,
  ExternalLink,
  Keyboard,
  Loader2,
  Mic,
  Music2,
  Pause,
  Play,
  RotateCcw,
  Search,
  Square,
  Upload,
} from "lucide-react";
import { getTool, stepsFor } from "@/lib/tools";
import { wakeBackend } from "@/lib/media";
import {
  clipName,
  decodeClip,
  detectNotes,
  findVideo,
  loadCapabilities,
  lyricsSearchUrl,
  MAX_RECORD_SECONDS,
  MAX_UPLOAD_MB,
  recordingSupported,
  searchAudio,
  searchLyrics,
  spotifySearchUrl,
  startRecording,
  youtubeSearchUrl,
  type Note,
  type Recording,
  type SongIdCapabilities,
  type SongMatch,
  type SongSearch,
  type SongVideo,
} from "@/lib/songid";
import { cn } from "@/lib/utils";
import { Notice } from "../pdf/kit";
import { Workbench } from "../workbench";

const EASE = [0.22, 1, 0.36, 1] as const;
const noopSubscribe = () => () => {};

type Mode = "sing" | "type";
type Phase = "idle" | "recording" | "analyzing" | "searching" | "done";

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** How sure we are, in words people understand. */
function verdict(m: SongMatch): { label: string; tone: "success" | "accent" | "warning" } {
  if (m.verified) return { label: "Lyrics match", tone: "success" };
  if (m.source === "melody") return { label: "Possible match · from the tune", tone: "warning" };
  if (m.confidence >= 0.75) return { label: "Likely match", tone: "accent" };
  return { label: "Possible match", tone: "warning" };
}

export function SongFinder({ toolId }: { toolId: string }) {
  const tool = getTool(toolId)!;
  const reduce = useReducedMotion();
  // Read after hydration (the server has no microphone API), so both renders agree.
  const canRecord = useSyncExternalStore(noopSubscribe, recordingSupported, () => true);
  const [mode, setMode] = useState<Mode>("sing");
  const [phase, setPhase] = useState<Phase>("idle");
  const [text, setText] = useState("");
  const [level, setLevel] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SongSearch | null>(null);
  const [selected, setSelected] = useState(0);
  const [caps, setCaps] = useState<SongIdCapabilities | null>(null);
  const recording = useRef<Recording | null>(null);
  const request = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Free servers sleep when idle: start waking ours as soon as the page opens.
  useEffect(() => {
    wakeBackend();
    const ctrl = new AbortController();
    loadCapabilities(ctrl.signal).then((c) => {
      if (!ctrl.signal.aborted) setCaps(c);
    });
    return () => ctrl.abort();
  }, []);

  useEffect(
    () => () => {
      recording.current?.cancel();
      request.current?.abort();
    },
    [],
  );

  const busy = phase === "recording" || phase === "analyzing" || phase === "searching";

  const show = (res: SongSearch) => {
    setResult(res);
    setSelected(0);
    setPhase("done");
  };

  const fail = (e: unknown) => {
    if (e instanceof DOMException && e.name === "AbortError") return;
    setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
    setPhase("idle");
  };

  const runAudio = useCallback(async (clip: Blob, name: string) => {
    setError(null);
    setPhase("analyzing");
    const ctrl = new AbortController();
    request.current = ctrl;
    try {
      // The tune is found here, on the device; only the notes travel with the clip.
      let notes: Note[] = [];
      const decoded = await decodeClip(clip);
      if (decoded) notes = detectNotes(decoded.samples, decoded.rate);
      if (ctrl.signal.aborted) return;
      setPhase("searching");
      show(await searchAudio(clip, name, notes, ctrl.signal));
    } catch (e) {
      fail(e);
    }
  }, []);

  const startListening = async () => {
    setError(null);
    setResult(null);
    setSeconds(0);
    setLevel(0);
    try {
      const rec = await startRecording({
        maxSeconds: MAX_RECORD_SECONDS,
        onTick: (l, s) => {
          setLevel(l);
          setSeconds(s);
        },
      });
      recording.current = rec;
      setPhase("recording");
      const clip = await rec.done;
      recording.current = null;
      if (clip.size < 2000) {
        setPhase("idle");
        setError("We didn't catch anything. Check your microphone and try again.");
        return;
      }
      await runAudio(clip, clipName(clip.type));
    } catch (e) {
      recording.current = null;
      if (e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError")) {
        setError("Microphone access is blocked. Allow it in your browser's address bar, or type the lyrics instead.");
        setPhase("idle");
        return;
      }
      if (e instanceof DOMException && e.name === "NotFoundError") {
        setError("No microphone was found. Plug one in, upload a clip, or type the lyrics instead.");
        setPhase("idle");
        return;
      }
      fail(e);
    }
  };

  const stopListening = () => recording.current?.stop();

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setResult(null);
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      setError(`That file is over ${MAX_UPLOAD_MB} MB. Trim it to a few seconds of the song and try again.`);
      return;
    }
    await runAudio(file, file.name);
  };

  const runText = async () => {
    const q = text.trim();
    if (!q || busy) return;
    if (q.replace(/[^\p{L}\p{N}]/gu, "").length < 2) {
      setError("Type a few words of the song.");
      return;
    }
    setError(null);
    setResult(null);
    setPhase("searching");
    const ctrl = new AbortController();
    request.current = ctrl;
    try {
      show(await searchLyrics(q, ctrl.signal));
    } catch (e) {
      fail(e);
    }
  };

  const reset = () => {
    recording.current?.cancel();
    request.current?.abort();
    setPhase("idle");
    setResult(null);
    setError(null);
    setSeconds(0);
    setLevel(0);
  };

  const step = phase === "done" ? 2 : busy ? 1 : 0;
  const match = result?.matches[selected];
  const others = result?.matches.filter((_, i) => i !== selected) ?? [];
  const audioOff = caps && !caps.melody;

  return (
    <Workbench
      steps={stepsFor(tool)}
      current={step}
      footer={
        <>
          Free. Clips are sent to our server and Groq&apos;s Whisper to hear the words, then deleted straight away. Song details and previews
          from Apple Music, lyrics from LRCLIB, videos from YouTube.
        </>
      }
    >
      <div className="grid gap-4 p-3 sm:p-4 md:p-5">
        {/* How to search */}
        {phase !== "done" && (
          <div role="tablist" aria-label="How to search" className="mx-auto grid w-full max-w-md grid-cols-2 gap-1 rounded-md border border-line bg-paper p-1">
            {(
              [
                { id: "sing", label: "Sing or hum", icon: Mic },
                { id: "type", label: "Type lyrics", icon: Keyboard },
              ] as const
            ).map((t) => {
              const on = mode === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  disabled={busy}
                  onClick={() => {
                    setMode(t.id);
                    setError(null);
                  }}
                  className={cn(
                    "relative inline-flex h-10 items-center justify-center gap-2 rounded-sm text-sm font-medium transition-colors disabled:opacity-50",
                    on ? "text-paper" : "text-ink-2 hover:text-ink",
                  )}
                >
                  {on && <motion.span layoutId="songid-mode" aria-hidden className="absolute inset-0 rounded-sm bg-ink" transition={{ type: "spring", bounce: 0.2, duration: 0.4 }} />}
                  <t.icon aria-hidden className="relative size-4" />
                  <span className="relative">{t.label}</span>
                </button>
              );
            })}
          </div>
        )}

        {error && <Notice tone="danger">{error}</Notice>}

        {/* Sing, hum or play */}
        {phase !== "done" && mode === "sing" && (
          <div className="flex flex-col items-center px-2 pb-2 pt-4 text-center sm:pt-6">
            {!canRecord ? (
              <Notice className="max-w-md">This browser can&apos;t record sound. Upload a clip below, or switch to “Type lyrics”.</Notice>
            ) : (
              <>
                <MicButton
                  phase={phase}
                  level={level}
                  progress={Math.min(1, seconds / MAX_RECORD_SECONDS)}
                  disabled={Boolean(audioOff) || phase === "analyzing" || phase === "searching"}
                  reduce={Boolean(reduce)}
                  onStart={startListening}
                  onStop={stopListening}
                />
                <div aria-live="polite" className="mt-5 min-h-[3.25rem]">
                  {phase === "idle" && (
                    <>
                      <p className="text-lg font-semibold tracking-[-0.01em] text-ink">Tap and sing, hum or play the song</p>
                      <p className="mt-1 text-sm text-ink-3">5–10 seconds is enough. Singing a few words works best.</p>
                    </>
                  )}
                  {phase === "recording" && (
                    <>
                      <p className="text-lg font-semibold text-ink">Listening… {fmt(seconds)}</p>
                      <p className="mt-1 text-sm text-ink-3">Tap the button when you&apos;re done (stops by itself at {MAX_RECORD_SECONDS} s).</p>
                    </>
                  )}
                  {(phase === "analyzing" || phase === "searching") && <Working label={phase === "analyzing" ? "Reading the tune…" : "Finding your song…"} />}
                </div>
              </>
            )}

            {phase === "idle" && (
              <div className="mt-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm">
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  disabled={Boolean(audioOff)}
                  className="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-surface px-3.5 text-ink-2 transition-colors hover:border-ink-3 hover:text-ink disabled:opacity-40"
                >
                  <Upload aria-hidden className="size-4" />
                  Upload a clip
                </button>
                <input
                  ref={fileInput}
                  type="file"
                  accept={tool.accept?.types}
                  className="sr-only"
                  tabIndex={-1}
                  aria-hidden
                  onChange={(e) => {
                    void onFile(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
                <span className="text-ink-3">Audio or video, up to {MAX_UPLOAD_MB} MB</span>
              </div>
            )}

            {phase === "idle" && (
              <ul className="mt-6 grid w-full max-w-2xl gap-2 text-left sm:grid-cols-3">
                {[
                  { title: "Sing a line", body: "Any words you remember, even if they're a bit off." },
                  { title: "Play the song", body: "Hold your phone near music playing nearby." },
                  { title: "Hum the tune", body: "Best for well-known melodies. Words work better." },
                ].map((tip) => (
                  <li key={tip.title} className="rounded-md border border-line bg-paper px-3 py-2.5">
                    <p className="text-sm font-medium text-ink">{tip.title}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-ink-3">{tip.body}</p>
                  </li>
                ))}
              </ul>
            )}
            {audioOff && <Notice tone="warning" className="mt-4 max-w-md">Voice search isn&apos;t available right now. You can still type the lyrics.</Notice>}
          </div>
        )}

        {/* Type the lyrics */}
        {phase !== "done" && mode === "type" && (
          <form
            className="mx-auto w-full max-w-2xl pb-2 pt-2"
            onSubmit={(e) => {
              e.preventDefault();
              void runText();
            }}
          >
            <label htmlFor="songid-text" className="text-sm font-medium text-ink">
              What do you remember?
            </label>
            <textarea
              id="songid-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void runText();
                }
              }}
              rows={3}
              maxLength={600}
              disabled={busy}
              placeholder="Type any line of the song. Spelling doesn't have to be right, and any language works."
              className="mt-2 block w-full resize-y rounded-md border border-line bg-paper px-3.5 py-3 text-[16px] leading-relaxed text-ink outline-none transition-[border-color,box-shadow] placeholder:text-ink-3 focus:border-ink focus:ring-4 focus:ring-accent/15 disabled:opacity-60 sm:text-[15px]"
            />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-ink-3">Tip: a full line works better than one word. Press Enter to search.</p>
              <button
                type="submit"
                disabled={busy || text.trim().length < 2}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-ink px-5 text-sm font-medium text-paper transition-colors hover:bg-ink/85 disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
              >
                {phase === "searching" ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Search aria-hidden className="size-4" />}
                {phase === "searching" ? "Searching…" : "Find the song"}
              </button>
            </div>
            {phase === "searching" && (
              <div aria-live="polite" className="mt-5">
                <Working label="Finding your song…" />
              </div>
            )}
          </form>
        )}

        {/* Results */}
        {phase === "done" && result && (
          <div className="grid gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p aria-live="polite" className="min-w-0 text-sm text-ink-2">
                {result.heard ? (
                  <>
                    We heard: <span className="font-medium text-ink">“{result.heard}”</span>
                  </>
                ) : result.input === "audio" && result.kind === "melody" ? (
                  "We listened to the tune."
                ) : result.matches.length ? (
                  `${result.matches.length} ${result.matches.length === 1 ? "match" : "matches"} found`
                ) : null}
              </p>
              <button
                type="button"
                onClick={reset}
                className="inline-flex h-10 shrink-0 items-center gap-2 rounded-md border border-line bg-surface px-3.5 text-sm font-medium text-ink transition-colors hover:border-ink-3"
              >
                <RotateCcw aria-hidden className="size-4" />
                Search again
              </button>
            </div>

            {match ? (
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={`${match.title}-${match.artist}`}
                  initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.3, ease: EASE }}
                >
                  <TopMatch match={match} />
                </motion.div>
              </AnimatePresence>
            ) : (
              <NoMatch message={result.message} onRetry={reset} onType={() => { reset(); setMode("type"); }} />
            )}

            {others.length > 0 && (
              <div>
                <p className="label-mono mb-2 text-ink-3">Not it? Other songs that fit</p>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {others.map((m) => {
                    const i = result.matches.indexOf(m);
                    const v = verdict(m);
                    return (
                      <li key={`${m.title}-${m.artist}`}>
                        <button
                          type="button"
                          onClick={() => setSelected(i)}
                          className="flex w-full items-center gap-3 rounded-md border border-line bg-paper p-2 text-left transition-colors hover:border-ink-3"
                        >
                          <Cover src={m.artwork} className="size-12" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-ink">{m.title}</span>
                            <span className="block truncate text-xs text-ink-3">{m.artist}</span>
                          </span>
                          <span className={cn("label-mono shrink-0 text-[10px]", v.tone === "success" ? "text-success" : v.tone === "warning" ? "text-warning" : "text-ink-3")}>
                            {Math.round(m.confidence * 100)}%
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </Workbench>
  );
}

/* ---------- The big button ---------- */

function MicButton({
  phase,
  level,
  progress,
  disabled,
  reduce,
  onStart,
  onStop,
}: {
  phase: Phase;
  level: number;
  progress: number;
  disabled: boolean;
  reduce: boolean;
  onStart: () => void;
  onStop: () => void;
}) {
  const listening = phase === "recording";
  const working = phase === "analyzing" || phase === "searching";
  const r = 76;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative flex size-44 items-center justify-center sm:size-52">
      {/* Rings that swell with the sound coming in. */}
      {listening && !reduce && (
        <>
          <span aria-hidden className="absolute inset-4 rounded-full bg-accent/15 transition-transform duration-100" style={{ transform: `scale(${1 + level * 0.35})` }} />
          <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-accent/10 [animation-duration:1.8s]" />
        </>
      )}
      {/* Time used, around the edge. */}
      <svg aria-hidden viewBox="0 0 160 160" className="absolute inset-0 size-full -rotate-90">
        <circle cx="80" cy="80" r={r} fill="none" stroke="currentColor" strokeWidth="2" className="text-line" />
        {listening && <circle cx="80" cy="80" r={r} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - progress)} className="text-accent transition-[stroke-dashoffset] duration-200" />}
      </svg>
      <button
        type="button"
        onClick={listening ? onStop : onStart}
        disabled={disabled}
        aria-label={listening ? "Stop listening and search" : "Start listening"}
        className={cn(
          "relative flex size-28 items-center justify-center rounded-full shadow-float transition-[background-color,transform] duration-200 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 sm:size-32",
          listening ? "bg-accent text-paper" : "bg-ink text-paper hover:scale-[1.03]",
        )}
      >
        {working ? (
          <Disc3 aria-hidden className={cn("size-11", !reduce && "animate-spin [animation-duration:2.4s]")} />
        ) : listening ? (
          <Square aria-hidden className="size-9 fill-current" />
        ) : (
          <Mic aria-hidden className="size-11" />
        )}
      </button>
    </div>
  );
}

function Working({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div aria-hidden className="flex h-6 items-end gap-1">
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} className="w-1.5 animate-pulse rounded-full bg-accent" style={{ height: `${10 + ((i * 7) % 14)}px`, animationDelay: `${i * 120}ms` }} />
        ))}
      </div>
      <p className="text-sm font-medium text-ink">{label}</p>
      <p className="text-xs text-ink-3">Usually 3–10 seconds. The first search after a quiet spell can take up to a minute.</p>
    </div>
  );
}

/* ---------- Results ---------- */

function Cover({ src, className }: { src?: string | null; className?: string }) {
  const [broken, setBroken] = useState(false);
  return src && !broken ? (
    // eslint-disable-next-line @next/next/no-img-element -- Apple's artwork CDN; next/image would need it allow-listed.
    <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} className={cn("shrink-0 rounded-sm border border-line bg-paper-2 object-cover", className)} />
  ) : (
    <span aria-hidden className={cn("flex shrink-0 items-center justify-center rounded-sm border border-line bg-paper-2 text-ink-3", className)}>
      <Music2 className="size-1/3" />
    </span>
  );
}

function TopMatch({ match }: { match: SongMatch }) {
  const [tab, setTab] = useState<"lyrics" | "video">(match.lyrics ? "lyrics" : "video");
  const v = verdict(match);
  const meta = [match.album, match.year, match.genre].filter(Boolean).join(" · ");
  return (
    <article className="overflow-hidden rounded-lg border border-line bg-paper">
      <div className="grid gap-4 p-4 sm:grid-cols-[160px_minmax(0,1fr)] sm:p-5">
        <Cover src={match.artwork} className="aspect-square w-32 sm:w-full" />
        <div className="min-w-0">
          <span
            className={cn(
              "label-mono inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-[11px]",
              v.tone === "success" && "border-success/30 bg-success/10 text-success",
              v.tone === "accent" && "border-accent/30 bg-accent/10 text-ink",
              v.tone === "warning" && "border-warning/35 bg-warning/10 text-warning",
            )}
          >
            {v.tone === "success" && <Check aria-hidden className="size-3" />}
            {v.label} · {Math.round(match.confidence * 100)}%
          </span>
          <h2 className="mt-2 text-2xl font-semibold leading-tight tracking-[-0.02em] text-ink text-balance sm:text-[28px]">{match.title}</h2>
          <p className="mt-1 text-base text-ink-2">{match.artist}</p>
          {meta && <p className="mt-0.5 text-sm text-ink-3">{meta}</p>}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {match.preview_url && <PreviewButton src={match.preview_url} />}
            <OutLink href={match.apple_url ?? undefined} label="Apple Music" />
            <OutLink href={spotifySearchUrl(match)} label="Spotify" />
            <OutLink href={youtubeSearchUrl(match)} label="YouTube" />
          </div>
        </div>
      </div>

      <div role="tablist" aria-label="Song details" className="flex border-t border-line">
        {(["lyrics", "video"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn(
              "flex-1 border-b-2 px-4 py-3 text-sm font-medium transition-colors",
              tab === t ? "border-ink text-ink" : "border-transparent text-ink-3 hover:text-ink",
            )}
          >
            {t === "lyrics" ? "Lyrics" : "Music video"}
          </button>
        ))}
      </div>
      <div className="p-3 sm:p-4">{tab === "lyrics" ? <Lyrics match={match} /> : <Video match={match} />}</div>
    </article>
  );
}

function OutLink({ href, label }: { href?: string; label: string }) {
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex h-10 items-center gap-1.5 rounded-md border border-line bg-surface px-3 text-sm text-ink-2 transition-colors hover:border-ink-3 hover:text-ink"
    >
      {label}
      <ArrowUpRight aria-hidden className="size-3.5" />
    </a>
  );
}

/** Apple's 30-second preview, with a progress bar on the button. */
function PreviewButton({ src }: { src: string }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <>
      <audio
        ref={audio}
        src={src}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setProgress(0);
        }}
        onTimeUpdate={(e) => setProgress(e.currentTarget.duration ? e.currentTarget.currentTime / e.currentTarget.duration : 0)}
        onError={() => setFailed(true)}
      />
      <button
        type="button"
        onClick={() => {
          const a = audio.current;
          if (!a) return;
          if (a.paused) void a.play().catch(() => setFailed(true));
          else a.pause();
        }}
        aria-label={playing ? "Pause preview" : "Play a 30-second preview"}
        className="relative inline-flex h-10 items-center gap-2 overflow-hidden rounded-md bg-ink px-4 text-sm font-medium text-paper transition-colors hover:bg-ink/85"
      >
        <span aria-hidden className="absolute inset-y-0 left-0 bg-paper/15 transition-[width] duration-200" style={{ width: `${progress * 100}%` }} />
        {playing ? <Pause aria-hidden className="relative size-4" /> : <Play aria-hidden className="relative size-4" />}
        <span className="relative">{playing ? "Pause" : "Play preview"}</span>
      </button>
    </>
  );
}

function Lyrics({ match }: { match: SongMatch }) {
  const box = useRef<HTMLDivElement>(null);
  const lines = useMemo(() => (match.lyrics ?? "").split(/\r?\n/), [match.lyrics]);
  const target = match.matched_line?.trim();
  const hit = target ? lines.findIndex((l) => l.trim() === target) : -1;

  // Bring the matching line into view inside the box (never scrolling the page itself).
  useEffect(() => {
    const el = box.current?.querySelector<HTMLElement>("[data-hit]");
    if (box.current && el) box.current.scrollTop = Math.max(0, el.offsetTop - box.current.clientHeight / 3);
  }, [hit]);

  if (!match.lyrics) {
    return (
      <p className="px-1 py-6 text-center text-sm text-ink-2">
        We don&apos;t have the lyrics for this song.{" "}
        <a href={lyricsSearchUrl(match)} target="_blank" rel="noopener noreferrer" className="font-medium text-ink underline decoration-line underline-offset-4 hover:decoration-ink">
          Search the web for them
        </a>
        .
      </p>
    );
  }
  return (
    <div>
      <div ref={box} data-lenis-prevent className="relative max-h-80 overflow-y-auto overscroll-contain rounded-md border border-line bg-surface px-4 py-3 sm:max-h-96">
        {lines.map((line, i) =>
          line.trim() ? (
            <p
              key={i}
              data-hit={i === hit ? "" : undefined}
              className={cn("rounded-sm px-1.5 py-0.5 text-[15px] leading-relaxed", i === hit ? "-mx-0 bg-accent/15 font-medium text-ink" : "text-ink-2")}
            >
              {line}
            </p>
          ) : (
            <div key={i} aria-hidden className="h-3" />
          ),
        )}
      </div>
      <p className="mt-2 text-xs text-ink-3">
        {hit >= 0 ? "The highlighted line is the one that matched. " : ""}Lyrics from LRCLIB, shared by its community.
      </p>
    </div>
  );
}

function Video({ match }: { match: SongMatch }) {
  const [video, setVideo] = useState<SongVideo | null | undefined>(undefined);
  useEffect(() => {
    const ctrl = new AbortController();
    findVideo(match.title, match.artist, ctrl.signal).then((v) => {
      if (!ctrl.signal.aborted) setVideo(v);
    });
    return () => ctrl.abort();
  }, [match.title, match.artist]);

  if (video === undefined) {
    return (
      <div className="flex aspect-video w-full items-center justify-center rounded-md border border-line bg-surface text-sm text-ink-3">
        <Loader2 aria-hidden className="mr-2 size-4 animate-spin" /> Finding the video…
      </div>
    );
  }
  if (!video?.id) {
    return (
      <p className="px-1 py-6 text-center text-sm text-ink-2">
        We couldn&apos;t load the video here.{" "}
        <a href={youtubeSearchUrl(match)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-ink underline decoration-line underline-offset-4 hover:decoration-ink">
          Watch it on YouTube <ExternalLink aria-hidden className="size-3.5" />
        </a>
      </p>
    );
  }
  return (
    <div>
      <div className="overflow-hidden rounded-md border border-line bg-ink">
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${video.id}?rel=0&modestbranding=1`}
          title={video.title ?? `${match.title} by ${match.artist}`}
          loading="lazy"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
          className="aspect-video w-full"
        />
      </div>
      <p className="mt-2 truncate text-xs text-ink-3">
        {video.title}
        {video.channel ? ` · ${video.channel}` : ""} ·{" "}
        <a href={`https://www.youtube.com/watch?v=${video.id}`} target="_blank" rel="noopener noreferrer" className="underline decoration-line underline-offset-2 hover:text-ink">
          Open on YouTube
        </a>
      </p>
    </div>
  );
}

function NoMatch({ message, onRetry, onType }: { message?: string | null; onRetry: () => void; onType: () => void }) {
  return (
    <div className="rounded-lg border border-line bg-paper px-5 py-8 text-center">
      <span className="mx-auto flex size-12 items-center justify-center rounded-full border border-line bg-surface text-ink-3">
        <Music2 aria-hidden className="size-5" />
      </span>
      <p className="mt-3 text-base font-semibold text-ink">No song found</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-ink-2">{message ?? "Try again with a different line or a longer clip."}</p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <button type="button" onClick={onRetry} className="inline-flex h-10 items-center gap-2 rounded-md bg-ink px-4 text-sm font-medium text-paper hover:bg-ink/85">
          <Mic aria-hidden className="size-4" /> Try again
        </button>
        <button type="button" onClick={onType} className="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-surface px-4 text-sm font-medium text-ink hover:border-ink-3">
          <Keyboard aria-hidden className="size-4" /> Type the lyrics instead
        </button>
      </div>
    </div>
  );
}
