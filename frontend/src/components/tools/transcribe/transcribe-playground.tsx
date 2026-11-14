"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { AudioLines, Check, Copy, Download, Languages, Loader2, Mic, PencilLine, X } from "lucide-react";
import {
  FALLBACK_LANGUAGES,
  languageLabel,
  loadCapabilities as loadTranslateCapabilities,
  translateBatch,
  type TranslateLanguage,
} from "@/lib/translate";
import { getTool, stepsFor } from "@/lib/tools";
import { formatBytes } from "@/lib/media";
import { checkFile, FileToolError, saveBlob } from "@/lib/files";
import {
  AUDIO_EXTENSIONS,
  CAPABILITIES_ENDPOINT,
  COMMON_LANGUAGES,
  countWords,
  exportTranscript,
  FORMATS,
  HINT_MAX,
  languageName,
  MAX_MB,
  segmentAt,
  stamp,
  streamTranscription,
  toText,
  type Capabilities,
  type Format,
  type Segment,
  type Stage,
  type TranscriptInfo,
} from "@/lib/transcribe";
import { cn } from "@/lib/utils";
import { AudioPreview } from "../audio-preview";
import { FileDrop } from "../file-drop";
import { ProgressButton, isBusy, type Job } from "../progress-button";
import { Workbench } from "../workbench";
import { Chips, Notice, Panel, Row, TextField, Toggle } from "../pdf/kit";
import { Recorder } from "./recorder";
import { TranscriptSheet } from "./transcript";

const EASE = [0.22, 1, 0.36, 1] as const;
const swap = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE } },
  exit: { opacity: 0, y: -4, transition: { duration: 0.15 } },
};

type Source = { file: File; url: string; recorded: boolean };

const messageOf = (e: unknown) =>
  e instanceof FileToolError ? e.message : "Something went wrong. Check your connection and try again.";
/** Wall-clock time, read only from event handlers. */
const now = () => Date.now();
const stem = (name: string) => name.replace(/\.[^.]+$/, "") || "transcript";

/** Which engine the server runs, asked once per page load. */
let capsRequest: Promise<Capabilities | null> | null = null;
function useCapabilities() {
  const [caps, setCaps] = useState<Capabilities | null | undefined>(undefined);
  useEffect(() => {
    capsRequest ??= fetch(CAPABILITIES_ENDPOINT)
      .then((r) => (r.ok ? (r.json() as Promise<Capabilities>) : null))
      .catch(() => null);
    let live = true;
    capsRequest.then((c) => {
      if (!c) capsRequest = null; // ask again next time rather than remembering a hiccup
      if (live) setCaps(c);
    });
    return () => {
      live = false;
    };
  }, []);
  return caps;
}

const STAGE_LABEL: Record<Stage, string> = {
  queued: "Waiting for a free slot…",
  preparing: "Reading the audio…",
  loading: "Getting the speech model ready…",
  transcribing: "Writing it down…",
};
const STAGE_HINT: Record<Stage, string> = {
  queued: "Another recording is ahead of yours. Yours starts as soon as it's done.",
  preparing: "Turning your file into clean audio the model can hear.",
  loading: "The speech model loads for each recording. The very first run also downloads it.",
  transcribing: "Lines appear below as they're recognised. You can read along.",
};

function minutes(seconds: number) {
  if (seconds < 60) return "under a minute";
  const m = Math.round(seconds / 60);
  return m === 1 ? "about a minute" : `about ${m} minutes`;
}

/**
 * Speech to text. Add a recording (or make one), choose the language and any names to expect,
 * then watch the transcript being written. The finished transcript reads along with the audio,
 * can be corrected in place, and exports as text or subtitles.
 */
export function TranscribePlayground({ toolId }: { toolId: string }) {
  const tool = getTool(toolId)!;
  const caps = useCapabilities();
  const [source, setSource] = useState<Source | null>(null);
  const [rejected, setRejected] = useState<string | null>(null);
  const [language, setLanguage] = useState("auto");
  const [hint, setHint] = useState("");

  const [job, setJob] = useState<Job>({ kind: "ready" });
  const [stage, setStage] = useState<Stage | null>(null);
  const [info, setInfo] = useState<TranscriptInfo | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [done, setDone] = useState(0);
  const [eta, setEta] = useState<number | null>(null);
  const [finished, setFinished] = useState<{ elapsed: number } | null>(null);

  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [seek, setSeek] = useState<{ to: number } | null>(null);
  const [editing, setEditing] = useState(false);
  const [format, setFormat] = useState<Format>("txt");
  const [timestamps, setTimestamps] = useState(false);
  const [copied, setCopied] = useState(false);
  const [delivered, setDelivered] = useState(false);

  const [trLangs, setTrLangs] = useState<TranslateLanguage[]>(FALLBACK_LANGUAGES);
  const [trLang, setTrLang] = useState("hi");
  const [trSegments, setTrSegments] = useState<Segment[] | null>(null);
  const [trView, setTrView] = useState<"original" | "translated">("original");
  const [trBusy, setTrBusy] = useState(false);
  const [trError, setTrError] = useState<string | null>(null);
  const [trCopiedSide, setTrCopiedSide] = useState<"original" | "translated" | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const urlRef = useRef<string | null>(null);
  // For the time-left estimate: when recognition started, and how long the recording is.
  const clock = useRef<{ since: number | null; duration: number }>({ since: null, duration: 0 });

  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!finished) return;
    let activeReq = true;
    loadTranslateCapabilities()
      .then((c) => {
        if (activeReq && c.languages?.length) setTrLangs(c.languages);
      })
      .catch(() => {});
    return () => {
      activeReq = false;
    };
  }, [finished]);

  const busy = isBusy(job);
  const maxMB = caps?.max_file_mb ?? MAX_MB;
  const unavailable = caps !== undefined && caps !== null && !caps.available;

  const resetResult = () => {
    setSegments([]);
    setInfo(null);
    setDone(0);
    setEta(null);
    setFinished(null);
    setDelivered(false);
    setEditing(false);
    setStage(null);
    setCopied(false);
    setTrSegments(null);
    setTrView("original");
    setTrBusy(false);
    setTrError(null);
    setTrCopiedSide(null);
  };

  const pick = (file: File, recorded = false) => {
    const problem = checkFile(file, AUDIO_EXTENSIONS, maxMB);
    setRejected(problem);
    if (problem) return;
    abortRef.current?.abort();
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    const url = URL.createObjectURL(file);
    urlRef.current = url;
    setSource({ file, url, recorded });
    setTime(0);
    resetResult();
    setJob({ kind: "ready" });
  };

  const clear = () => {
    abortRef.current?.abort();
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    setSource(null);
    setRejected(null);
    resetResult();
    setJob({ kind: "ready" });
  };

  const start = async () => {
    if (!source) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    resetResult();
    clock.current = { since: null, duration: 0 };
    setJob({ kind: "uploading", progress: 0 });

    const form = new FormData();
    form.append("file", source.file);
    form.append("language", language);
    if (hint.trim()) form.append("prompt", hint.trim());

    const working = () => setJob((j) => (j.kind === "processing" ? j : { kind: "processing" }));
    try {
      const out = await streamTranscription(form, {
        signal: ctrl.signal,
        onUpload: (progress) => setJob({ kind: "uploading", progress }),
        onUploaded: () => {
          working();
          setStage((s) => s ?? "preparing");
        },
        onEvent: (e) => {
          working();
          if (e.type === "status") {
            setStage(e.stage);
            if (e.stage === "transcribing") clock.current.since = now();
          } else if (e.type === "info") {
            clock.current.duration = e.duration;
            setInfo({
              language: e.language,
              language_probability: e.language_probability,
              duration: e.duration,
              engine: e.engine,
              model: e.model,
            });
          } else if (e.type === "segment") {
            setSegments((prev) => [...prev, { id: e.id, start: e.start, end: e.end, text: e.text }]);
          } else if (e.type === "progress") {
            setDone(e.done);
            const { since, duration } = clock.current;
            if (since && duration && e.done > duration * 0.05) {
              const rate = e.done / ((now() - since) / 1000);
              setEta(rate > 0 ? Math.max(0, (duration - e.done) / rate) : null);
            }
          }
        },
      });
      setFinished({ elapsed: out.elapsed });
      setStage(null);
      setJob({ kind: "ready" });
    } catch (e) {
      setStage(null);
      if (ctrl.signal.aborted) {
        resetResult();
        return setJob({ kind: "ready" });
      }
      setSegments([]);
      setJob({ kind: "failed", message: messageOf(e) });
    }
  };

  const cancel = () => abortRef.current?.abort();

  const shownSegments = useMemo(
    () => (trView === "translated" && trSegments ? trSegments : segments),
    [trView, trSegments, segments],
  );

  const exported = useMemo(() => {
    if (!finished || !source) return null;
    const meta = FORMATS.find((f) => f.value === format)!;
    const suffix = trView === "translated" && trSegments ? `-${trLang}` : "";
    const blob = new Blob([exportTranscript(format, shownSegments, info, { timestamps })], {
      type: `${meta.type};charset=utf-8`,
    });
    return { blob, name: `${stem(source.file.name)}${suffix}.${format}` };
  }, [finished, source, format, shownSegments, trView, trSegments, trLang, info, timestamps]);

  const download = () => {
    if (!exported) return;
    saveBlob(exported.blob, exported.name);
    setDelivered(true);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(toText(shownSegments, timestamps).trim());
      setCopied(true);
      setDelivered(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const runTranslateTranscript = async () => {
    if (!segments.length || trBusy) return;
    setTrBusy(true);
    setTrError(null);
    try {
      if (trLangs.length <= FALLBACK_LANGUAGES.length) {
        loadTranslateCapabilities()
          .then((c) => {
            if (c.languages?.length) setTrLangs(c.languages);
          })
          .catch(() => {});
      }
      const res = await translateBatch({
        texts: segments.map((s) => s.text),
        source: info?.language || (language === "auto" ? "auto" : language),
        target: trLang,
      });
      setTrSegments(
        segments.map((s, idx) => ({
          id: s.id,
          start: s.start,
          end: s.end,
          text: res.translated_texts[idx] ?? s.text,
        })),
      );
      setTrView("translated");
    } catch (e) {
      setTrError(e instanceof Error ? e.message : "Could not translate that transcript.");
    } finally {
      setTrBusy(false);
    }
  };

  const copySide = async (side: "original" | "translated") => {
    const list = side === "translated" && trSegments ? trSegments : segments;
    try {
      await navigator.clipboard.writeText(toText(list, timestamps).trim());
      setTrCopiedSide(side);
      setDelivered(true);
      setTimeout(() => setTrCopiedSide(null), 1800);
    } catch {
      setTrCopiedSide(null);
    }
  };

  const edit = (id: number, text: string) => {
    if (trView === "translated" && trSegments) {
      setTrSegments((prev) => (prev ? prev.map((s) => (s.id === id ? { ...s, text } : s)) : prev));
      return;
    }
    setSegments((prev) => prev.map((s) => (s.id === id ? { ...s, text } : s)));
    if (trSegments) {
      setTrSegments(null);
      setTrView("original");
    }
  };
  const playFrom = (seconds: number) => setSeek({ to: seconds });

  // Nothing is "being heard" until the audio has been played.
  const active = shownSegments.length && time > 0 ? segmentAt(shownSegments, time) : -1;
  const progress = info?.duration ? Math.min(1, done / info.duration) : null;
  const words = useMemo(() => countWords(shownSegments), [shownSegments]);
  // add → transcribe → copy or download
  const step = !source ? 0 : !finished || !segments.length ? 1 : delivered ? 3 : 2;

  return (
    <Workbench
      steps={stepsFor(tool)}
      current={step}
      footer={
        caps?.engine === "groq" ? (
          <>
            Your recording is transcribed by Groq&apos;s Whisper service, then deleted from our server. Transcribe
            recordings you have the right to use, and ask people before recording them.
          </>
        ) : (
          <>
            Your recording is transcribed on our own server and deleted as soon as the transcript is sent. Transcribe
            recordings you have the right to use, and ask people before recording them.
          </>
        )
      }
    >
      <div aria-live="polite" className="space-y-3 p-3 sm:p-4">
        {unavailable && (
          <Notice tone="warning">Speech to text isn&apos;t set up on this server yet, so recordings can&apos;t be transcribed right now.</Notice>
        )}

        <AnimatePresence mode="wait" initial={false}>
          {!source ? (
            <motion.div key="add" {...swap} className="space-y-3">
              <FileDrop
                accept={tool.accept?.types ?? ""}
                title="Drop a recording here"
                formats={`MP3 · WAV · M4A · OGG · FLAC · MP4 · MOV · WEBM — up to ${maxMB} MB`}
                error={rejected}
                onFile={(f) => pick(f)}
              />
              <div className="flex items-center gap-3" aria-hidden>
                <span className="h-px flex-1 bg-line" />
                <span className="label-mono text-ink-3">or</span>
                <span className="h-px flex-1 bg-line" />
              </div>
              <Recorder onRecorded={(f) => pick(f, true)} disabled={unavailable} />
            </motion.div>
          ) : (
            <motion.div key="work" {...swap} className="space-y-3">
              <SourceRow source={source} locked={busy} accept={tool.accept?.types ?? ""} onReplace={(f) => pick(f)} onClear={clear} />
              {rejected && (
                <p role="alert" className="px-1 text-sm text-danger">
                  {rejected}
                </p>
              )}
              <div
                onPlayCapture={() => setPlaying(true)}
                onPauseCapture={() => setPlaying(false)}
                onEndedCapture={() => setPlaying(false)}
              >
                <AudioPreview src={source.url} blob={source.file} onTime={setTime} seek={seek} />
              </div>

              <AnimatePresence mode="wait" initial={false}>
                {!finished ? (
                  <motion.div key="setup" {...swap} className="space-y-3">
                    <Panel>
                      <Row label="Language" hint={language === "auto" ? "Worked out from the speech" : undefined}>
                        <LanguagePicker
                          value={language}
                          onChange={setLanguage}
                          languages={caps?.languages ?? COMMON_LANGUAGES}
                          disabled={busy}
                        />
                      </Row>
                      <Row label="Words to expect" hint="Optional. Helps spell them right">
                        <TextField
                          value={hint}
                          onChange={setHint}
                          label="Words to expect"
                          placeholder="e.g. Priya, Kolkata, Kubernetes"
                          maxLength={HINT_MAX}
                          disabled={busy}
                        />
                      </Row>
                    </Panel>

                    <ProgressButton
                      job={job}
                      label="Transcribe"
                      working={
                        stage === "transcribing" && progress !== null
                          ? `Writing it down · ${Math.round(progress * 100)}%`
                          : stage
                            ? STAGE_LABEL[stage]
                            : "Starting…"
                      }
                      progress={stage === "transcribing" ? progress : null}
                      workingHint={
                        stage === "transcribing" && eta !== null
                          ? `${minutes(eta)} left. Lines appear below as they're recognised.`
                          : stage
                            ? STAGE_HINT[stage]
                            : undefined
                      }
                      hint={
                        caps?.engine === "local"
                          ? "Long recordings take a few minutes. You'll see the text appear line by line."
                          : "You'll see the text appear line by line."
                      }
                      disabled={unavailable}
                      onStart={start}
                      onCancel={cancel}
                    />

                    {busy && (stage === "transcribing" || segments.length > 0) && (
                      <motion.div {...swap}>
                        <TranscriptSheet
                          segments={segments}
                          active={-1}
                          live
                          liveAt={done}
                          editing={false}
                          following={false}
                          onSeek={playFrom}
                          onEdit={edit}
                        />
                      </motion.div>
                    )}
                  </motion.div>
                ) : (
                  <motion.div key="result" {...swap}>
                    <ResultPanel
                      info={info}
                      words={words}
                      elapsed={finished.elapsed}
                      empty={!segments.length}
                      editing={editing}
                      copied={copied}
                      onEdit={() => setEditing((v) => !v)}
                      onCopy={copy}
                      onRetry={() => {
                        resetResult();
                        setJob({ kind: "ready" });
                      }}
                    >
                      {segments.length > 0 && (
                        <TranscriptSheet
                          segments={shownSegments}
                          active={active}
                          live={false}
                          liveAt={0}
                          editing={editing}
                          following={playing && !editing}
                          onSeek={playFrom}
                          onEdit={edit}
                        />
                      )}
                    </ResultPanel>

                    {segments.length > 0 && (
                      <div className="mt-3 rounded-md border border-dashed border-line bg-paper/45 p-3.5 sm:p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="label-mono flex items-center gap-1.5 text-ink-3">
                            <Languages className="size-3.5 text-accent" aria-hidden />
                            Translate transcript
                          </span>
                          <Link
                            href="/tools/translator"
                            className="text-xs font-medium text-ink-2 underline underline-offset-4 hover:text-ink"
                          >
                            Need dubbed audio or video? Open Translator
                          </Link>
                        </div>

                        <div className="mt-2.5 flex flex-wrap items-center gap-2">
                          <select
                            aria-label="Translate transcript to language"
                            value={trLang}
                            onChange={(e) => setTrLang(e.target.value)}
                            disabled={trBusy}
                            className="h-9 min-w-[180px] flex-1 rounded-sm border border-line bg-surface px-2.5 text-sm text-ink outline-none focus:border-ink sm:flex-none"
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
                            onClick={runTranslateTranscript}
                            disabled={trBusy}
                            className="inline-flex h-9 items-center gap-1.5 rounded-sm bg-ink px-3.5 text-xs font-medium text-paper transition-colors hover:bg-ink/85 disabled:opacity-50"
                          >
                            {trBusy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Languages className="size-3.5" aria-hidden />}
                            {trBusy ? "Translating…" : "Translate"}
                          </button>

                          {trSegments && (
                            <Chips
                              label="Transcript language view"
                              value={trView}
                              onChange={setTrView}
                              options={[
                                { value: "original", label: "Original" },
                                { value: "translated", label: languageLabel(trLang, trLangs) },
                              ]}
                            />
                          )}
                        </div>

                        {trSegments && (
                          <div className="mt-2.5 flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => copySide("original")}
                              className="inline-flex items-center gap-1.5 rounded-sm border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-ink hover:border-ink-3"
                            >
                              {trCopiedSide === "original" ? <Check className="size-3.5 text-accent" aria-hidden /> : <Copy className="size-3.5 text-ink-3" aria-hidden />}
                              {trCopiedSide === "original" ? "Copied input" : "Copy input text"}
                            </button>
                            <button
                              type="button"
                              onClick={() => copySide("translated")}
                              className="inline-flex items-center gap-1.5 rounded-sm border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-ink hover:border-ink-3"
                            >
                              {trCopiedSide === "translated" ? <Check className="size-3.5 text-accent" aria-hidden /> : <Copy className="size-3.5 text-ink-3" aria-hidden />}
                              {trCopiedSide === "translated" ? "Copied translation" : "Copy translated text"}
                            </button>
                          </div>
                        )}

                        {trError && <Notice tone="danger" className="mt-2.5">{trError}</Notice>}
                      </div>
                    )}

                    {exported && segments.length > 0 && (
                      <ExportPanel
                        format={format}
                        timestamps={timestamps}
                        size={exported.blob.size}
                        delivered={delivered}
                        onFormat={setFormat}
                        onTimestamps={setTimestamps}
                        onDownload={download}
                        onAnother={clear}
                      />
                    )}
                    {segments.length === 0 && (
                      <button
                        type="button"
                        onClick={clear}
                        className="mt-3 inline-flex h-12 w-full items-center justify-center rounded-md border border-line bg-surface px-4 text-sm font-medium text-ink transition-colors hover:border-ink-3"
                      >
                        Try another recording
                      </button>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Workbench>
  );
}

/* ---------- Pieces ---------- */

/** The recording: icon, name, size, and Change / Remove while nothing is running. */
function SourceRow({
  source,
  locked,
  accept,
  onReplace,
  onClear,
}: {
  source: Source;
  locked: boolean;
  accept: string;
  onReplace: (f: File) => void;
  onClear: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const Icon = source.recorded ? Mic : AudioLines;
  return (
    <div className="flex items-center gap-3 rounded-md border border-line bg-paper p-2 sm:gap-4">
      <span className="flex size-12 shrink-0 items-center justify-center rounded-sm border border-line bg-paper-2 text-ink-2">
        <Icon aria-hidden className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="label-mono text-ink-3">{source.recorded ? "Your recording" : "Your audio"}</p>
        <p className="mt-1 truncate text-[15px] font-medium text-ink" title={source.file.name}>
          {source.file.name}
        </p>
        <p className="mt-0.5 truncate text-sm text-ink-2">{formatBytes(source.file.size)}</p>
      </div>
      {!locked && (
        <div className="flex shrink-0 items-center gap-1">
          <input
            ref={input}
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
            onClick={() => input.current?.click()}
            className="hidden h-9 items-center rounded-[8px] px-2.5 text-sm text-ink-2 transition-colors hover:bg-paper-2 hover:text-ink sm:inline-flex"
          >
            Change
          </button>
          <button
            type="button"
            onClick={onClear}
            aria-label="Remove recording"
            className="inline-flex size-9 items-center justify-center rounded-[8px] text-ink-3 transition-colors hover:bg-paper-2 hover:text-ink"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
}

/** "Detect" plus the common languages as chips; every other language Whisper knows in a list. */
function LanguagePicker({
  value,
  onChange,
  languages,
  disabled,
}: {
  value: string;
  onChange: (code: string) => void;
  languages: string[];
  disabled?: boolean;
}) {
  const others = useMemo(
    () =>
      languages
        .filter((c) => !COMMON_LANGUAGES.includes(c))
        .map((c) => ({ code: c, name: languageName(c) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [languages],
  );
  const inOthers = others.some((o) => o.code === value);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Chips
        label="Language"
        value={inOthers ? "" : value}
        onChange={onChange}
        disabled={disabled}
        options={[
          { value: "auto", label: "Detect" },
          ...COMMON_LANGUAGES.filter((c) => languages.includes(c)).map((c) => ({ value: c, label: languageName(c) })),
        ]}
      />
      <select
        aria-label="Other language"
        value={inOthers ? value : ""}
        disabled={disabled}
        onChange={(e) => e.target.value && onChange(e.target.value)}
        className={cn(
          "h-9 max-w-full rounded-sm border px-2.5 text-sm outline-none transition-colors focus:ring-4 focus:ring-accent/15 disabled:cursor-not-allowed",
          inOthers ? "border-ink bg-ink text-paper" : "border-line bg-surface text-ink-2 hover:border-ink-3",
        )}
      >
        <option value="">More languages…</option>
        {others.map((o) => (
          <option key={o.code} value={o.code}>
            {o.name}
          </option>
        ))}
      </select>
    </div>
  );
}

/** The finished transcript: what was heard, how sure the model was, and the read-along sheet. */
function ResultPanel({
  info,
  words,
  elapsed,
  empty,
  editing,
  copied,
  onEdit,
  onCopy,
  onRetry,
  children,
}: {
  info: TranscriptInfo | null;
  words: number;
  elapsed: number;
  empty: boolean;
  editing: boolean;
  copied: boolean;
  onEdit: () => void;
  onCopy: () => void;
  onRetry: () => void;
  children: React.ReactNode;
}) {
  const unsure = info?.language_probability != null && info.language_probability < 0.7;
  const facts = [
    info && !empty ? languageName(info.language) + (info.language_probability != null ? ` ${Math.round(info.language_probability * 100)}%` : "") : null,
    info ? stamp(info.duration) : null,
    `${words.toLocaleString("en")} ${words === 1 ? "word" : "words"}`,
    `done in ${elapsed < 60 ? `${Math.max(1, Math.round(elapsed))} s` : stamp(elapsed)}`,
  ].filter(Boolean);

  return (
    <div className="space-y-3 rounded-md border border-line bg-surface px-3 py-3 sm:px-4 sm:py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="label-mono flex items-center gap-1.5 text-ink-2">
          <Check aria-hidden className="size-3.5 text-success" /> Transcript ready
        </p>
        <p className="label-mono text-ink-3">{facts.join(" · ")}</p>
      </div>

      {empty ? (
        <Notice>
          No speech was found in this recording. If someone is talking, check the right file was added, or pick the
          language and{" "}
          <button type="button" onClick={onRetry} className="underline underline-offset-4 hover:text-ink">
            try again
          </button>
          .
        </Notice>
      ) : (
        <>
          {unsure && info && (
            <Notice tone="warning">
              We weren&apos;t sure this is {languageName(info.language)}. If the text looks wrong,{" "}
              <button type="button" onClick={onRetry} className="underline underline-offset-4 hover:text-ink">
                pick the language
              </button>{" "}
              and transcribe again.
            </Notice>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-ink-2">
              {editing ? "Click any line to correct it." : "Click a line to hear it. The line being heard is highlighted."}
            </p>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={onEdit}
                aria-pressed={editing}
                className={cn(
                  "inline-flex h-9 items-center gap-1.5 rounded-sm border px-3 text-sm transition-colors",
                  editing ? "border-ink bg-ink text-paper" : "border-line bg-surface text-ink-2 hover:border-ink-3 hover:text-ink",
                )}
              >
                <PencilLine aria-hidden className="size-3.5" />
                {editing ? "Done editing" : "Edit text"}
              </button>
              <button
                type="button"
                onClick={onCopy}
                className="inline-flex h-9 items-center gap-1.5 rounded-sm border border-line bg-surface px-3 text-sm text-ink-2 transition-colors hover:border-ink-3 hover:text-ink"
              >
                {copied ? <Check aria-hidden className="size-3.5 text-success" /> : <Copy aria-hidden className="size-3.5" />}
                {copied ? "Copied" : "Copy text"}
              </button>
            </div>
          </div>
          {children}
        </>
      )}
    </div>
  );
}

/** Pick a format, see its exact size, download. */
function ExportPanel({
  format,
  timestamps,
  size,
  delivered,
  onFormat,
  onTimestamps,
  onDownload,
  onAnother,
}: {
  format: Format;
  timestamps: boolean;
  size: number;
  delivered: boolean;
  onFormat: (f: Format) => void;
  onTimestamps: (v: boolean) => void;
  onDownload: () => void;
  onAnother: () => void;
}) {
  const meta = FORMATS.find((f) => f.value === format)!;
  return (
    <div className="mt-3 rounded-md border border-dashed border-line px-3 py-3.5 sm:px-4 sm:py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Chips label="Format" value={format} onChange={onFormat} options={FORMATS.map((f) => ({ value: f.value, label: f.label }))} />
        {format === "txt" && <Toggle checked={timestamps} onChange={onTimestamps} label="Start times" />}
      </div>
      <p className="mt-2.5 text-xs text-ink-3">
        {format === "txt" && timestamps ? "One line per sentence, each with the time it starts." : meta.about}
      </p>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={onDownload}
          className="inline-flex h-12 w-full items-center justify-center gap-2 whitespace-nowrap rounded-md bg-ink px-5 text-[15px] font-medium text-paper transition-[background-color,transform] duration-150 hover:bg-ink/85 active:translate-y-px sm:w-auto sm:flex-1"
        >
          {delivered ? <Check aria-hidden className="size-4" /> : <Download aria-hidden className="size-4" />}
          Download {meta.label}
          <span className="font-mono text-[13px] font-normal text-paper/60">{formatBytes(size)}</span>
        </button>
        <button
          type="button"
          onClick={onAnother}
          className="inline-flex h-12 items-center justify-center whitespace-nowrap rounded-md border border-line bg-surface px-4 text-sm font-medium text-ink transition-colors hover:border-ink-3"
        >
          Transcribe another
        </button>
      </div>
    </div>
  );
}
