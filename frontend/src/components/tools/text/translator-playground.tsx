"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeftRight,
  Check,
  Copy,
  Download,
  FileAudio,
  FileText,
  FileVideo,
  Globe2,
  Languages,
  Loader2,
  RotateCcw,
  Sparkles,
  Square,
  Subtitles,
  Upload,
  Volume2,
} from "lucide-react";
import { checkFile, FileToolError, saveBlob } from "@/lib/files";
import { formatDuration } from "@/lib/media";
import { getTool, stepsFor } from "@/lib/tools";
import { FORMATS, stamp } from "@/lib/transcribe";
import {
  ALL_MEDIA_EXTENSIONS,
  buildVttUrl,
  canSpeakInBrowser,
  COMMON_TARGET_CODES,
  detectMediaKind,
  exportSideTranscript,
  FALLBACK_LANGUAGES,
  fetchTranslatedResult,
  formatBytes,
  isRtlLanguage,
  languageLabel,
  loadCapabilities,
  looksLikeSubtitleText,
  MAX_MEDIA_MB,
  MAX_TEXT_CHARS,
  speakBrowserText,
  STAGE_LABELS,
  stopBrowserSpeech,
  TEXT_FILE_EXTENSIONS,
  translateMedia,
  translateText,
  VIDEO_MEDIA_EXTENSIONS,
  type DownloadedMediaResult,
  type MediaSegmentPair,
  type MediaTranslateDone,
  type TextTranslateResult,
  type TranslateCapabilities,
  type TranslateLanguage,
  type TranslateStage,
} from "@/lib/translate";
import { cn } from "@/lib/utils";
import { AudioPreview } from "../audio-preview";
import { FileDrop } from "../file-drop";
import { Chip, stem } from "../pdf/parts";
import { Chips, Notice, Panel, Row, Toggle } from "../pdf/kit";
import { ProgressButton, type Job } from "../progress-button";
import { Recorder } from "../transcribe/recorder";
import { Workbench } from "../workbench";

type Mode = "text" | "audio" | "video";
type VoiceGender = "female" | "male";
type TimingMode = "timed" | "fluent";
type ScriptView = "bilingual" | "plain";

const SAMPLE_TEXT =
  "Hello! Welcome to Do-Whatever-You-Like. Drop a message, voice note, or video clip here to translate it into another language for free.";

const MODE_TABS: { id: Mode; label: string; hint: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "text", label: "Text", hint: "Paste text or .srt/.vtt", icon: FileText },
  { id: "audio", label: "Audio", hint: "Voice notes, podcasts, mic", icon: FileAudio },
  { id: "video", label: "Video", hint: "Dubbing + soft captions", icon: FileVideo },
];

type SelectedMedia = {
  id: string;
  file: File;
  url: string;
  kind: "audio" | "video";
};

function CopyButton({
  text,
  label,
  copiedLabel = "Copied",
  disabled = false,
}: {
  text: string;
  label: string;
  copiedLabel?: string;
  disabled?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    if (!text.trim()) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard API may be denied in insecure contexts; fallback textarea selection.
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      } finally {
        ta.remove();
      }
    }
  };

  return (
    <button
      type="button"
      onClick={onCopy}
      disabled={disabled || !text.trim()}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        copied
          ? "border-accent/40 bg-accent/10 text-ink"
          : "border-line bg-surface text-ink hover:border-ink-3",
      )}
    >
      {copied ? <Check aria-hidden className="size-3.5 text-accent" /> : <Copy aria-hidden className="size-3.5 text-ink-3" />}
      {copied ? copiedLabel : label}
    </button>
  );
}

function LanguageSelect({
  id,
  label,
  value,
  onChange,
  languages,
  allowAuto,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (code: string) => void;
  languages: TranslateLanguage[];
  allowAuto?: boolean;
  disabled?: boolean;
}) {
  const common = useMemo(() => {
    const map = new Map(languages.map((l) => [l.code, l]));
    return COMMON_TARGET_CODES.map((c) => map.get(c)).filter((x): x is TranslateLanguage => Boolean(x));
  }, [languages]);

  const commonSet = useMemo(() => new Set(common.map((c) => c.code)), [common]);
  const rest = useMemo(() => languages.filter((l) => !commonSet.has(l.code)), [languages, commonSet]);

  return (
    <div className="min-w-0">
      <label htmlFor={id} className="label-mono block text-ink-3">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="mt-1.5 h-10 w-full rounded-sm border border-line bg-surface px-3 text-sm text-ink outline-none transition-colors focus:border-ink disabled:cursor-not-allowed disabled:opacity-50"
      >
        {allowAuto && <option value="auto">Auto-detect language</option>}
        {common.length > 0 && (
          <optgroup label="Popular">
            {common.map((lang) => (
              <option key={lang.code} value={lang.code}>
                {lang.name}
                {lang.native_name !== lang.name ? ` (${lang.native_name})` : ""}
              </option>
            ))}
          </optgroup>
        )}
        <optgroup label="All languages">
          {rest.map((lang) => (
            <option key={lang.code} value={lang.code}>
              {lang.name}
              {lang.native_name !== lang.name ? ` (${lang.native_name})` : ""}
            </option>
          ))}
        </optgroup>
      </select>
    </div>
  );
}

export function TranslatorPlayground({ toolId }: { toolId: string }) {
  const tool = getTool(toolId)!;
  const steps = stepsFor(tool);

  const [mode, setMode] = useState<Mode>("text");
  const [caps, setCaps] = useState<TranslateCapabilities | null>(null);
  const [capsError, setCapsError] = useState<string | null>(null);

  const languages = useMemo(() => (caps?.languages?.length ? caps.languages : FALLBACK_LANGUAGES), [caps]);

  const [sourceLang, setSourceLang] = useState("auto");
  const [targetLang, setTargetLang] = useState("hi");

  // ---------- Text mode state ----------
  const [textInput, setTextInput] = useState("");
  const [textMode, setTextMode] = useState<"text" | "subtitles">("text");
  const [textResult, setTextResult] = useState<TextTranslateResult | null>(null);
  const [textBusy, setTextBusy] = useState(false);
  const [textError, setTextError] = useState<string | null>(null);
  const [speakingSide, setSpeakingSide] = useState<"source" | "translated" | null>(null);
  const textAbortRef = useRef<AbortController | null>(null);
  const textFileRef = useRef<HTMLInputElement | null>(null);

  // ---------- Audio / Video mode state ----------
  const [selectedMedia, setSelectedMedia] = useState<SelectedMedia | null>(null);
  const [mediaFileError, setMediaFileError] = useState<string | null>(null);
  const [voiceGender, setVoiceGender] = useState<VoiceGender>("female");
  const [timing, setTiming] = useState<TimingMode>("timed");
  const [keepBackground, setKeepBackground] = useState(false);
  const [includeSubtitles, setIncludeSubtitles] = useState(true);

  const [job, setJob] = useState<Job>({ kind: "ready" });
  const [stage, setStage] = useState<TranslateStage | null>(null);
  const [mediaProgress, setMediaProgress] = useState<number | null>(null);
  const [liveSegments, setLiveSegments] = useState<MediaSegmentPair[]>([]);
  const [mediaDone, setMediaDone] = useState<MediaTranslateDone | null>(null);
  const [downloadedResult, setDownloadedResult] = useState<DownloadedMediaResult | null>(null);
  const [resultError, setResultError] = useState<string | null>(null);
  const [fetchingResult, setFetchingResult] = useState(false);

  const [previewSide, setPreviewSide] = useState<"translated" | "original">("translated");
  const [scriptView, setScriptView] = useState<ScriptView>("bilingual");
  const [mediaTime, setMediaTime] = useState(0);
  const [audioSeek, setAudioSeek] = useState<{ to: number; seq: number } | undefined>(undefined);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mediaAbortRef = useRef<AbortController | null>(null);

  // Clean up object URLs cleanly when cleared or unmounted.
  const sourceUrlRef = useRef<string | null>(null);
  const resultUrlRef = useRef<string | null>(null);

  useEffect(() => {
    sourceUrlRef.current = selectedMedia?.url ?? null;
  }, [selectedMedia]);

  useEffect(() => {
    resultUrlRef.current = downloadedResult?.url ?? null;
  }, [downloadedResult]);

  useEffect(() => {
    const ctrl = new AbortController();
    loadCapabilities(ctrl.signal)
      .then((data) => {
        setCaps(data);
        setCapsError(null);
      })
      .catch((e) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setCapsError(e instanceof Error ? e.message : "Could not load translator status.");
      });
    return () => {
      ctrl.abort();
      stopBrowserSpeech();
      textAbortRef.current?.abort();
      mediaAbortRef.current?.abort();
      if (sourceUrlRef.current) URL.revokeObjectURL(sourceUrlRef.current);
      if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
    };
  }, []);

  const vttTranslatedUrl = useMemo(
    () => (mediaDone?.segments?.length ? buildVttUrl(mediaDone.segments, "translated") : null),
    [mediaDone],
  );
  const vttSourceUrl = useMemo(
    () => (mediaDone?.segments?.length ? buildVttUrl(mediaDone.segments, "source") : null),
    [mediaDone],
  );

  useEffect(() => {
    return () => {
      if (vttTranslatedUrl) URL.revokeObjectURL(vttTranslatedUrl);
      if (vttSourceUrl) URL.revokeObjectURL(vttSourceUrl);
    };
  }, [vttTranslatedUrl, vttSourceUrl]);

  const effectiveSourceForSwap = useMemo(() => {
    if (sourceLang !== "auto") return sourceLang;
    if (mode === "text" && textResult?.detected_language && textResult.detected_language !== "auto") {
      return textResult.detected_language;
    }
    if (mode !== "text" && mediaDone?.detected_language && mediaDone.detected_language !== "auto") {
      return mediaDone.detected_language;
    }
    return null;
  }, [sourceLang, mode, textResult, mediaDone]);

  const swapLanguages = () => {
    const prevTarget = targetLang;
    const prevSource = effectiveSourceForSwap;
    if (!prevSource) {
      setSourceLang(prevTarget);
      setTargetLang(prevTarget === "en" ? "hi" : "en");
    } else {
      setSourceLang(prevTarget);
      setTargetLang(prevSource);
    }
    if (mode === "text" && textResult?.translated_text) {
      setTextInput(textResult.translated_text);
      setTextResult(null);
    }
  };

  // Removed top switchMode (redefined after removeMediaFile so switching Audio <-> Video clears incompatible media cleanly).

  // ---------- Text handlers ----------

  const runTextTranslation = async () => {
    const trimmed = textInput.trim();
    if (!trimmed) {
      setTextError("Type or paste some text to translate.");
      return;
    }
    if (textInput.length > MAX_TEXT_CHARS) {
      setTextError(`Please keep text under ${MAX_TEXT_CHARS.toLocaleString()} characters per translation.`);
      return;
    }
    textAbortRef.current?.abort();
    const ctrl = new AbortController();
    textAbortRef.current = ctrl;
    setTextBusy(true);
    setTextError(null);
    stopBrowserSpeech();
    setSpeakingSide(null);

    try {
      const res = await translateText({
        text: textInput,
        source: sourceLang,
        target: targetLang,
        mode: textMode,
        signal: ctrl.signal,
      });
      setTextResult(res);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setTextError(e instanceof FileToolError || e instanceof Error ? e.message : "Translation failed.");
    } finally {
      setTextBusy(false);
    }
  };

  const onTextInputChange = (val: string) => {
    setTextInput(val);
    setTextError(null);
    if (looksLikeSubtitleText(val) && textMode !== "subtitles") {
      setTextMode("subtitles");
    }
  };

  const openTextFile = async (file: File) => {
    const extErr = checkFile(file, [...TEXT_FILE_EXTENSIONS], 2);
    if (extErr) {
      setTextError(extErr);
      return;
    }
    const content = await file.text();
    const trimmed = content.slice(0, MAX_TEXT_CHARS);
    setTextInput(trimmed);
    setTextResult(null);
    setTextError(content.length > MAX_TEXT_CHARS ? `Truncated to first ${MAX_TEXT_CHARS.toLocaleString()} characters.` : null);
    if (file.name.toLowerCase().endsWith(".srt") || file.name.toLowerCase().endsWith(".vtt") || looksLikeSubtitleText(trimmed)) {
      setTextMode("subtitles");
    } else {
      setTextMode("text");
    }
  };

  const toggleSpeak = (side: "source" | "translated", content: string, langCode: string) => {
    if (speakingSide === side) {
      stopBrowserSpeech();
      setSpeakingSide(null);
      return;
    }
    setSpeakingSide(side);
    const ok = speakBrowserText(content, langCode, () => setSpeakingSide(null));
    if (!ok) setSpeakingSide(null);
  };

  // ---------- Media handlers ----------

  const clearMediaResult = useCallback(() => {
    if (resultUrlRef.current) {
      URL.revokeObjectURL(resultUrlRef.current);
      resultUrlRef.current = null;
    }
    setDownloadedResult(null);
    setMediaDone(null);
    setResultError(null);
    setLiveSegments([]);
    setStage(null);
    setMediaProgress(null);
    setPreviewSide("translated");
  }, []);

  const acceptMediaFile = (file: File) => {
    const allowedExts = mode === "video" ? [...VIDEO_MEDIA_EXTENSIONS] : ALL_MEDIA_EXTENSIONS;
    const problem = checkFile(file, allowedExts, MAX_MEDIA_MB);
    if (problem) {
      setMediaFileError(problem);
      return;
    }
    mediaAbortRef.current?.abort();
    clearMediaResult();
    setJob({ kind: "ready" });
    setMediaFileError(null);
    if (sourceUrlRef.current) {
      URL.revokeObjectURL(sourceUrlRef.current);
    }
    const kind = detectMediaKind(file);
    if (kind !== mode) setMode(kind);
    const url = URL.createObjectURL(file);
    setSelectedMedia({
      id: `${file.name}-${file.size}-${Date.now()}`,
      file,
      url,
      kind,
    });
  };

  const removeMediaFile = () => {
    mediaAbortRef.current?.abort();
    clearMediaResult();
    if (sourceUrlRef.current) {
      URL.revokeObjectURL(sourceUrlRef.current);
      sourceUrlRef.current = null;
    }
    setSelectedMedia(null);
    setMediaFileError(null);
    setJob({ kind: "ready" });
  };

  const switchMode = (next: Mode) => {
    stopBrowserSpeech();
    setSpeakingSide(null);
    if (next !== "text" && selectedMedia && selectedMedia.kind !== next && job.kind !== "uploading" && job.kind !== "processing") {
      removeMediaFile();
    }
    setMode(next);
  };

  const startMediaTranslation = async () => {
    if (!selectedMedia) return;
    mediaAbortRef.current?.abort();
    const ctrl = new AbortController();
    mediaAbortRef.current = ctrl;
    clearMediaResult();
    setJob({ kind: "uploading", progress: 0 });
    setStage("preparing");
    setMediaProgress(null);

    const form = new FormData();
    form.append("file", selectedMedia.file);
    form.append("source_language", sourceLang);
    form.append("target_language", targetLang);
    form.append("voice_gender", voiceGender);
    form.append("timing", timing);
    form.append("keep_background", String(keepBackground));
    form.append("include_subtitles", String(selectedMedia.kind === "video" && includeSubtitles));

    try {
      const done = await translateMedia(form, {
        signal: ctrl.signal,
        onUpload: (p) => {
          setJob(p >= 1 ? { kind: "processing" } : { kind: "uploading", progress: p });
        },
        onEvent: (ev) => {
          if (ev.type === "status") {
            setJob({ kind: "processing" });
            setStage(ev.stage);
          } else if (ev.type === "segment") {
            const pair: MediaSegmentPair = {
              id: ev.id,
              start: ev.start,
              end: ev.end,
              source: ev.source,
              translated: ev.translated,
            };
            setLiveSegments((prev) => [...prev, pair]);
          } else if (ev.type === "progress" && ev.total > 0) {
            setMediaProgress(Math.min(1, Math.max(0, ev.done / ev.total)));
          } else if (ev.type === "error") {
            setJob({ kind: "failed", message: ev.detail || "Translation stopped cleanly before finishing." });
          }
        },
      });

      setMediaDone(done);
      setLiveSegments(done.segments);
      setPreviewSide("translated");
      setStage(null);
      setMediaProgress(1);
      setJob({ kind: "ready" });

      setFetchingResult(true);
      try {
        const downloaded = await fetchTranslatedResult(
          done.result_token,
          done.result_name,
          done.result_type,
          ctrl.signal,
        );
        setDownloadedResult(downloaded);
      } catch (dlErr) {
        if (!(dlErr instanceof DOMException && dlErr.name === "AbortError")) {
          setResultError(dlErr instanceof Error ? dlErr.message : "Could not download dubbed media preview.");
        }
      } finally {
        setFetchingResult(false);
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        setJob({ kind: "ready" });
        setStage(null);
        return;
      }
      setStage(null);
      setJob({
        kind: "failed",
        message: e instanceof FileToolError || e instanceof Error ? e.message : "Could not translate that recording.",
      });
    }
  };

  const cancelMediaTranslation = () => {
    mediaAbortRef.current?.abort();
    setJob({ kind: "ready" });
    setStage(null);
  };

  const downloadMediaResult = async () => {
    if (downloadedResult) {
      saveBlob(downloadedResult.blob, downloadedResult.name);
      return;
    }
    if (!mediaDone) return;
    setFetchingResult(true);
    setResultError(null);
    try {
      const downloaded = await fetchTranslatedResult(
        mediaDone.result_token,
        mediaDone.result_name,
        mediaDone.result_type,
      );
      setDownloadedResult(downloaded);
      saveBlob(downloaded.blob, downloaded.name);
    } catch (e) {
      setResultError(e instanceof Error ? e.message : "Could not download the file.");
    } finally {
      setFetchingResult(false);
    }
  };

  const seekMediaTo = (seconds: number) => {
    if (selectedMedia?.kind === "video" && videoRef.current) {
      videoRef.current.currentTime = Math.max(0, seconds);
      videoRef.current.play().catch(() => {});
      return;
    }
    setAudioSeek((prev) => ({ to: Math.max(0, seconds), seq: (prev?.seq ?? 0) + 1 }));
  };

  const downloadSideText = (
    side: "source" | "translated",
    format: "txt" | "srt" | "vtt" | "json",
  ) => {
    if (!mediaDone) return;
    const content = exportSideTranscript(
      format,
      mediaDone.segments,
      side,
      format !== "txt",
    );
    const meta = FORMATS.find((f) => f.value === format)!;
    const langTag = side === "source" ? mediaDone.detected_language : mediaDone.target_language;
    const base = stem(selectedMedia?.file.name ?? mediaDone.result_name);
    saveBlob(new Blob([content], { type: `${meta.type};charset=utf-8` }), `${base}-${langTag}.${format}`);
  };

  const downloadPlainTextResult = (ext: "txt" | "srt") => {
    if (!textResult) return;
    const langTag = textResult.target_language || targetLang;
    saveBlob(new Blob([textResult.translated_text], { type: "text/plain;charset=utf-8" }), `translation-${langTag}.${ext}`);
  };

  const currentStep = useMemo(() => {
    if (mode === "text") {
      if (textResult) return 3;
      if (textInput.trim()) return 1;
      return 0;
    }
    if (mediaDone) return 3;
    if (selectedMedia) return 1;
    return 0;
  }, [mode, textInput, textResult, selectedMedia, mediaDone]);

  const activeStep = useMemo(() => {
    if (mode === "text") {
      if (textBusy) return 1;
      return currentStep;
    }
    if (job.kind === "uploading" || job.kind === "processing") return 1;
    return currentStep;
  }, [mode, textBusy, job.kind, currentStep]);

  const busyMedia = job.kind === "uploading" || job.kind === "processing";
  const targetRtl = isRtlLanguage(targetLang, languages);
  const sourceRtl = isRtlLanguage(effectiveSourceForSwap ?? "", languages);

  const displayedSegments = mediaDone?.segments ?? liveSegments;
  const activeMediaSegId = useMemo(() => {
    if (!displayedSegments.length) return -1;
    const found = displayedSegments.find((s) => mediaTime >= s.start && mediaTime <= s.end + 0.25);
    return found ? found.id : -1;
  }, [displayedSegments, mediaTime]);

  const acceptAccept = mode === "video" ? VIDEO_MEDIA_EXTENSIONS.join(",") : [...ALL_MEDIA_EXTENSIONS].join(",");

  return (
    <Workbench
      steps={steps}
      current={activeStep}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>
            Free multi-engine translation · Spoken dubbing powered by Whisper + neural voices · Uploaded files stay temporary and expire automatically.
          </span>
          {caps?.speech_available && (
            <span className="font-mono text-xs text-ink-3">
              Max {caps.max_file_mb} MB · Audio {Math.round(caps.max_audio_seconds / 60)}m · Video{" "}
              {Math.round(caps.max_video_seconds / 60)}m
            </span>
          )}
        </div>
      }
    >
      {/* Mode selector bar */}
      <div className="border-b border-line bg-paper/60 px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div role="tablist" aria-label="Translation input mode" className="inline-flex flex-wrap gap-1.5">
            {MODE_TABS.map((t) => {
              const Icon = t.icon;
              const selected = mode === t.id;
              return (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={selected}
                  type="button"
                  disabled={busyMedia}
                  onClick={() => switchMode(t.id)}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-sm border px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50",
                    selected
                      ? "border-ink bg-ink text-paper"
                      : "border-line bg-surface text-ink-2 hover:border-ink-3 hover:text-ink",
                  )}
                >
                  <Icon className="size-4" aria-hidden />
                  <span>{t.label}</span>
                  <span
                    className={cn(
                      "hidden text-xs sm:inline",
                      selected ? "text-paper/75" : "text-ink-3",
                    )}
                  >
                    · {t.hint}
                  </span>
                </button>
              );
            })}
          </div>

          <span className="label-mono flex items-center gap-1.5 text-ink-3">
            <Globe2 className="size-3.5 text-accent" aria-hidden />
            {languages.length} languages
          </span>
        </div>
      </div>

      {/* Language pair bar */}
      <div className="border-b border-line bg-surface px-4 py-4 sm:px-6">
        <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_auto_1fr]">
          <LanguageSelect
            id="translator-source-lang"
            label="From language"
            value={sourceLang}
            onChange={setSourceLang}
            languages={languages}
            allowAuto
            disabled={busyMedia || textBusy}
          />
          <button
            type="button"
            onClick={swapLanguages}
            disabled={busyMedia || textBusy}
            title="Swap languages"
            aria-label="Swap source and target languages"
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-sm border border-line bg-paper px-3 text-xs font-medium text-ink transition-colors hover:border-ink-3 disabled:opacity-40"
          >
            <ArrowLeftRight className="size-4" aria-hidden />
            <span className="sm:hidden">Swap languages</span>
          </button>
          <LanguageSelect
            id="translator-target-lang"
            label="To language"
            value={targetLang}
            onChange={setTargetLang}
            languages={languages}
            disabled={busyMedia || textBusy}
          />
        </div>

        {/* Quick target language pills */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="label-mono mr-1 text-ink-3">Quick target:</span>
          {["en", "hi", "es", "fr", "ar", "bn", "de", "ja"].map((code) => (
            <Chip
              key={code}
              selected={targetLang === code}
              disabled={busyMedia || textBusy}
              onClick={() => setTargetLang(code)}
            >
              {languageLabel(code, languages)}
            </Chip>
          ))}
        </div>
      </div>

      {/* Main workspace body */}
      <div className="p-4 sm:p-6">
        {capsError && mode !== "text" && (
          <Notice tone="warning" className="mb-4">
            {capsError} You can still translate text while the media server finishes waking up.
          </Notice>
        )}

        {/* ================== TEXT MODE ================== */}
        {mode === "text" && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setTextInput(SAMPLE_TEXT);
                    setTextMode("text");
                    setTextResult(null);
                    setTextError(null);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-sm border border-line bg-paper px-3 py-1.5 text-xs font-medium text-ink-2 transition-colors hover:border-ink-3 hover:text-ink"
                >
                  <Sparkles className="size-3.5 text-accent" aria-hidden />
                  Try sample text
                </button>
                <button
                  type="button"
                  onClick={() => textFileRef.current?.click()}
                  className="inline-flex items-center gap-1.5 rounded-sm border border-line bg-paper px-3 py-1.5 text-xs font-medium text-ink-2 transition-colors hover:border-ink-3 hover:text-ink"
                >
                  <Upload className="size-3.5" aria-hidden />
                  Open .txt / .srt / .vtt
                </button>
                <input
                  ref={textFileRef}
                  type="file"
                  accept=".txt,.md,.srt,.vtt,text/plain"
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) openTextFile(f);
                  }}
                />
                {textInput && (
                  <button
                    type="button"
                    onClick={() => {
                      stopBrowserSpeech();
                      setSpeakingSide(null);
                      setTextInput("");
                      setTextResult(null);
                      setTextError(null);
                    }}
                    className="inline-flex items-center gap-1 rounded-sm px-2.5 py-1.5 text-xs text-ink-3 hover:text-ink"
                  >
                    <RotateCcw className="size-3.5" aria-hidden />
                    Clear
                  </button>
                )}
              </div>

              <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-ink-2">
                <input
                  type="checkbox"
                  checked={textMode === "subtitles"}
                  onChange={(e) => setTextMode(e.target.checked ? "subtitles" : "text")}
                  className="size-4 accent-ink"
                />
                <Subtitles className="size-3.5 text-ink-3" aria-hidden />
                Keep SRT / VTT timestamps
              </label>
            </div>

            {textError && <Notice tone="danger">{textError}</Notice>}

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {/* Source box */}
              <div className="flex flex-col rounded-md border border-line bg-paper/50">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3.5 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="label-mono text-ink-2">Source text</span>
                    {textResult?.detected_language_name && sourceLang === "auto" && (
                      <span className="rounded-sm bg-ink/10 px-2 py-0.5 font-mono text-xs text-ink">
                        Detected: {textResult.detected_language_name}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {canSpeakInBrowser() && textInput.trim() && (
                      <button
                        type="button"
                        onClick={() =>
                          toggleSpeak(
                            "source",
                            textInput,
                            sourceLang === "auto" ? textResult?.detected_language || "en" : sourceLang,
                          )
                        }
                        className="inline-flex items-center gap-1 rounded-sm border border-line bg-surface px-2.5 py-1.5 text-xs text-ink-2 hover:border-ink-3 hover:text-ink"
                      >
                        {speakingSide === "source" ? (
                          <Square className="size-3.5 text-accent" aria-hidden />
                        ) : (
                          <Volume2 className="size-3.5" aria-hidden />
                        )}
                        {speakingSide === "source" ? "Stop" : "Listen"}
                      </button>
                    )}
                    <CopyButton text={textInput} label="Copy input text" />
                  </div>
                </div>
                <textarea
                  aria-label="Source text to translate"
                  value={textInput}
                  onChange={(e) => onTextInputChange(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                      e.preventDefault();
                      runTextTranslation();
                    }
                  }}
                  dir={sourceRtl ? "rtl" : "auto"}
                  rows={8}
                  maxLength={MAX_TEXT_CHARS + 500}
                  placeholder="Type or paste any sentence, article, chat message, or SRT/VTT subtitles here…"
                  className="min-h-[210px] w-full flex-1 resize-y bg-transparent p-3.5 text-sm leading-relaxed text-ink outline-none placeholder:text-ink-3"
                />
                <div className="flex items-center justify-between border-t border-line px-3.5 py-2 text-xs text-ink-3">
                  <span>{textInput.length.toLocaleString()} / {MAX_TEXT_CHARS.toLocaleString()} chars</span>
                  <span>Ctrl/Cmd + Enter to translate</span>
                </div>
              </div>

              {/* Translated output box */}
              <div className="flex flex-col rounded-md border border-line bg-surface">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3.5 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="label-mono text-ink-2">
                      Translated text · {languageLabel(textResult?.target_language ?? targetLang, languages)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {canSpeakInBrowser() && Boolean(textResult?.translated_text) && (
                      <button
                        type="button"
                        onClick={() =>
                          toggleSpeak(
                            "translated",
                            textResult?.translated_text ?? "",
                            textResult?.target_language ?? targetLang,
                          )
                        }
                        className="inline-flex items-center gap-1 rounded-sm border border-line bg-paper px-2.5 py-1.5 text-xs text-ink-2 hover:border-ink-3 hover:text-ink"
                      >
                        {speakingSide === "translated" ? (
                          <Square className="size-3.5 text-accent" aria-hidden />
                        ) : (
                          <Volume2 className="size-3.5" aria-hidden />
                        )}
                        {speakingSide === "translated" ? "Stop" : "Listen"}
                      </button>
                    )}
                    <CopyButton
                      text={textResult?.translated_text ?? ""}
                      label="Copy translated text"
                      disabled={!textResult?.translated_text}
                    />
                  </div>
                </div>

                <div
                  dir={targetRtl ? "rtl" : "auto"}
                  className="min-h-[210px] flex-1 overflow-auto whitespace-pre-wrap break-words p-3.5 text-sm leading-relaxed text-ink"
                >
                  {textBusy ? (
                    <span className="inline-flex items-center gap-2 text-ink-3">
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                      Translating into {languageLabel(targetLang, languages)}…
                    </span>
                  ) : textResult ? (
                    textResult.translated_text
                  ) : (
                    <span className="text-ink-3">
                      Your translation will appear here with original & translated text copy buttons.
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3.5 py-2 text-xs text-ink-3">
                  <span>
                    {textResult
                      ? `${textResult.translated_text.length.toLocaleString()} chars · via ${textResult.provider}`
                      : "Text output only — clean copy & export"}
                  </span>
                  {textResult && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => downloadPlainTextResult(textMode === "subtitles" ? "srt" : "txt")}
                        className="inline-flex items-center gap-1 font-medium text-ink hover:text-accent"
                      >
                        <Download className="size-3.5" aria-hidden />
                        Save .{textMode === "subtitles" ? "srt" : "txt"}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={runTextTranslation}
                disabled={textBusy || !textInput.trim()}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-ink px-6 text-sm font-medium text-paper transition-colors hover:bg-ink/85 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {textBusy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Languages className="size-4" aria-hidden />}
                {textBusy ? "Translating…" : `Translate to ${languageLabel(targetLang, languages)}`}
              </button>
              {textResult && (
                <button
                  type="button"
                  onClick={() => {
                    setTextInput(textResult.translated_text);
                    setSourceLang(textResult.target_language);
                    setTextResult(null);
                  }}
                  className="inline-flex h-11 items-center gap-1.5 rounded-md border border-line bg-paper px-4 text-sm font-medium text-ink-2 transition-colors hover:border-ink-3 hover:text-ink"
                >
                  Use translation as new source
                </button>
              )}
            </div>
          </div>
        )}

        {/* ================== AUDIO & VIDEO MODE ================== */}
        {mode !== "text" && (
          <div className="space-y-5">
            {caps && !caps.speech_available && (
              <Notice tone="warning">
                Speech recognition is disabled on this backend instance right now. Check server configuration before uploading media files.
              </Notice>
            )}

            {!selectedMedia ? (
              <div className="space-y-4">
                <FileDrop
                  accept={acceptAccept}
                  title={
                    mode === "video"
                      ? "Drop a video clip here to translate speech & dub"
                      : "Drop an audio file here to translate & dub"
                  }
                  formats={
                    mode === "video"
                      ? "MP4 · MOV · MKV · WEBM · M4V · AVI · up to 150 MB"
                      : "MP3 · WAV · M4A · OGG · OPUS · FLAC · WEBM · up to 150 MB"
                  }
                  error={mediaFileError}
                  onFile={acceptMediaFile}
                />
                {mediaFileError && <Notice tone="danger">{mediaFileError}</Notice>}

                {mode === "audio" && (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-paper/50 px-4 py-3">
                    <div>
                      <p className="text-sm font-medium text-ink">Or record directly from your microphone</p>
                      <p className="text-xs text-ink-3">Speak a sentence in any language and translate it into spoken voiceover.</p>
                    </div>
                    <Recorder onRecorded={acceptMediaFile} disabled={busyMedia} />
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-5">
                {/* Selected source card */}
                <div className="rounded-md border border-line bg-paper/45 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-sm border border-line bg-surface text-ink">
                        {selectedMedia.kind === "video" ? (
                          <FileVideo className="size-5 text-accent" aria-hidden />
                        ) : (
                          <FileAudio className="size-5 text-accent" aria-hidden />
                        )}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-ink">{selectedMedia.file.name}</p>
                        <p className="font-mono text-xs text-ink-3">
                          {selectedMedia.kind.toUpperCase()} · {formatBytes(selectedMedia.file.size)}
                          {mediaDone ? ` · ${formatDuration(mediaDone.duration)}` : ""}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {!busyMedia && (
                        <button
                          type="button"
                          onClick={removeMediaFile}
                          className="inline-flex items-center gap-1.5 rounded-sm border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink-2 transition-colors hover:border-ink-3 hover:text-ink"
                        >
                          <RotateCcw className="size-3.5" aria-hidden />
                          Choose different file
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Original media player before translation finishes */}
                  {!mediaDone && selectedMedia.kind === "audio" && (
                    <div className="mt-3">
                      <AudioPreview src={selectedMedia.url} blob={selectedMedia.file} onTime={setMediaTime} seek={audioSeek} />
                    </div>
                  )}
                  {!mediaDone && selectedMedia.kind === "video" && (
                    <div className="mt-3 overflow-hidden rounded-md border border-line bg-black">
                      <video
                        controls
                        src={selectedMedia.url}
                        className="max-h-[340px] w-full object-contain"
                      />
                    </div>
                  )}
                </div>

                {/* Dubbing options */}
                <Panel>
                  <Row label="Spoken voice" hint="Neural voice for the translated audio track">
                    <Chips
                      label="Voice gender"
                      value={voiceGender}
                      onChange={setVoiceGender}
                      disabled={busyMedia}
                      options={[
                        { value: "female", label: "Female voice" },
                        { value: "male", label: "Male voice" },
                      ]}
                    />
                  </Row>
                  <Row
                    label="Pace & alignment"
                    hint="Timed fits each line inside its original window; Fluent reads smoothly straight through"
                  >
                    <Chips
                      label="Timing mode"
                      value={timing}
                      onChange={setTiming}
                      disabled={busyMedia}
                      options={[
                        { value: "timed", label: "Synced to recording" },
                        { value: "fluent", label: "Fluent continuous read" },
                      ]}
                    />
                  </Row>
                  <Row label="Audio mix & captions">
                    <div className="space-y-3">
                      <Toggle
                        checked={keepBackground}
                        onChange={setKeepBackground}
                        disabled={busyMedia}
                        label="Keep subtle original audio underneath"
                        description="Lowers original speech/music to a quiet background bed under the translated voiceover."
                      />
                      {selectedMedia.kind === "video" && (
                        <Toggle
                          checked={includeSubtitles}
                          onChange={setIncludeSubtitles}
                          disabled={busyMedia}
                          label="Embed translated soft subtitles"
                          description="Adds a toggleable subtitle track in the downloaded video file."
                        />
                      )}
                    </div>
                  </Row>
                </Panel>

                {/* Primary action button */}
                <div>
                  <ProgressButton
                    job={job}
                    label={
                      selectedMedia.kind === "video"
                        ? `Translate & dub video (${languageLabel(targetLang, languages)})`
                        : `Translate & dub audio (${languageLabel(targetLang, languages)})`
                    }
                    working={stage ? STAGE_LABELS[stage] : "Translating & creating dubbed voiceover…"}
                    progress={mediaProgress}
                    hint={
                      selectedMedia.kind === "video"
                        ? "Outputs a translated video file plus both input and translated text."
                        : "Outputs a translated audio file plus both input and translated text."
                    }
                    workingHint={
                      <span>
                        {stage ? STAGE_LABELS[stage] : "Processing…"}
                        {liveSegments.length > 0 ? ` (${liveSegments.length} lines translated so far)` : ""}
                      </span>
                    }
                    onStart={startMediaTranslation}
                    onCancel={cancelMediaTranslation}
                    disabled={caps?.speech_available === false}
                  />
                  {job.kind === "failed" && (
                    <Notice tone="danger" className="mt-3">
                      {job.message}
                    </Notice>
                  )}
                </div>

                {/* Live segments streaming preview while working */}
                {busyMedia && liveSegments.length > 0 && (
                  <div className="rounded-md border border-line bg-paper/40 p-3.5">
                    <p className="label-mono text-ink-3">Live translation progress ({liveSegments.length} lines)</p>
                    <div className="mt-2 max-h-52 space-y-2 overflow-y-auto pr-1 text-xs">
                      {liveSegments.map((seg) => (
                        <div key={seg.id} className="rounded-sm border border-line/70 bg-surface px-3 py-2">
                          <span className="font-mono text-ink-3">{stamp(seg.start)}</span>
                          <p className="mt-0.5 text-ink-2">{seg.source}</p>
                          <p className="mt-0.5 font-medium text-ink" dir={targetRtl ? "rtl" : "auto"}>
                            {seg.translated}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ================== COMPLETED MEDIA RESULT + BOTH TEXTS ================== */}
                {mediaDone && (
                  <div className="space-y-5 rounded-md border border-ink/25 bg-surface p-4 sm:p-5">
                    {/* Header + Download file CTA */}
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
                      <div>
                        <p className="label-mono text-accent">
                          Translated {mediaDone.media_kind === "video" ? "video" : "audio"} ready
                        </p>
                        <h3 className="mt-1 text-base font-semibold text-ink">
                          {mediaDone.detected_language_name} {"->"} {mediaDone.target_language_name}
                        </h3>
                        <p className="mt-0.5 font-mono text-xs text-ink-3">
                          {mediaDone.result_name} · {formatBytes(mediaDone.result_size)} · {formatDuration(mediaDone.duration)} ·{" "}
                          {mediaDone.tts_engine} ({mediaDone.elapsed}s)
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={downloadMediaResult}
                          disabled={fetchingResult}
                          className="inline-flex h-10 items-center gap-2 rounded-md bg-ink px-4 text-sm font-medium text-paper transition-colors hover:bg-ink/85 disabled:opacity-50"
                        >
                          {fetchingResult ? (
                            <Loader2 className="size-4 animate-spin" aria-hidden />
                          ) : (
                            <Download className="size-4" aria-hidden />
                          )}
                          Download translated {mediaDone.media_kind === "video" ? "video" : "audio"}
                        </button>
                      </div>
                    </div>

                    {resultError && <Notice tone="warning">{resultError}</Notice>}

                    {/* Translated Media Player with Before/After toggle */}
                    <div>
                      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                        <p className="label-mono text-ink-3">
                          Preview ({previewSide === "translated" ? `Dubbed ${mediaDone.target_language_name}` : `Original ${mediaDone.detected_language_name}`})
                        </p>
                        <Chips
                          label="Preview track"
                          value={previewSide}
                          onChange={setPreviewSide}
                          options={[
                            { value: "translated", label: `Translated (${mediaDone.target_language_name})` },
                            { value: "original", label: `Original (${mediaDone.detected_language_name})` },
                          ]}
                        />
                      </div>

                      {fetchingResult && !downloadedResult && previewSide === "translated" ? (
                        <div className="flex items-center gap-2 rounded-md border border-line bg-paper/50 p-4 text-sm text-ink-2">
                          <Loader2 className="size-4 animate-spin" aria-hidden />
                          Loading translated playback file…
                        </div>
                      ) : selectedMedia.kind === "video" ? (
                        <div className="overflow-hidden rounded-md border border-line bg-black">
                          <video
                            ref={videoRef}
                            key={previewSide === "translated" ? downloadedResult?.url ?? selectedMedia.url : selectedMedia.url}
                            controls
                            onTimeUpdate={(e) => setMediaTime(e.currentTarget.currentTime)}
                            src={previewSide === "translated" ? (downloadedResult?.url ?? selectedMedia.url) : selectedMedia.url}
                            className="max-h-[400px] w-full object-contain"
                          >
                            {vttTranslatedUrl && (
                              <track
                                kind="subtitles"
                                src={vttTranslatedUrl}
                                srcLang={mediaDone.target_language}
                                label={`${mediaDone.target_language_name} captions`}
                                default={previewSide === "translated"}
                              />
                            )}
                            {vttSourceUrl && (
                              <track
                                kind="subtitles"
                                src={vttSourceUrl}
                                srcLang={mediaDone.detected_language}
                                label={`${mediaDone.detected_language_name} (original)`}
                                default={previewSide === "original"}
                              />
                            )}
                          </video>
                        </div>
                      ) : (
                        <AudioPreview
                          src={previewSide === "translated" ? (downloadedResult?.url ?? selectedMedia.url) : selectedMedia.url}
                          blob={previewSide === "translated" ? (downloadedResult?.blob ?? selectedMedia.file) : selectedMedia.file}
                          onTime={setMediaTime}
                          seek={audioSeek}
                        />
                      )}
                    </div>

                    {/* BOTH Source Text and Translated Text with Copy Input + Copy Translated buttons */}
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                      {/* Input transcript card */}
                      <div className="flex flex-col rounded-md border border-line bg-paper/45">
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3.5 py-2.5">
                          <div>
                            <span className="label-mono text-ink-2">
                              Input text · {mediaDone.detected_language_name}
                            </span>
                          </div>
                          <CopyButton text={mediaDone.source_text} label="Copy input text" />
                        </div>
                        <div
                          dir={sourceRtl ? "rtl" : "auto"}
                          className="max-h-56 flex-1 overflow-y-auto whitespace-pre-wrap break-words p-3.5 text-sm leading-relaxed text-ink"
                        >
                          {mediaDone.source_text}
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3.5 py-2 text-xs text-ink-3">
                          <span>Original spoken transcript</span>
                          <div className="flex items-center gap-2.5">
                            <button
                              type="button"
                              onClick={() => downloadSideText("source", "txt")}
                              className="hover:text-ink"
                            >
                              .TXT
                            </button>
                            <button
                              type="button"
                              onClick={() => downloadSideText("source", "srt")}
                              className="hover:text-ink"
                            >
                              .SRT
                            </button>
                            <button
                              type="button"
                              onClick={() => downloadSideText("source", "vtt")}
                              className="hover:text-ink"
                            >
                              .VTT
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Translated transcript card */}
                      <div className="flex flex-col rounded-md border border-line bg-paper/20">
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3.5 py-2.5">
                          <div>
                            <span className="label-mono text-ink-2">
                              Translated text · {mediaDone.target_language_name}
                            </span>
                          </div>
                          <CopyButton text={mediaDone.translated_text} label="Copy translated text" />
                        </div>
                        <div
                          dir={targetRtl ? "rtl" : "auto"}
                          className="max-h-56 flex-1 overflow-y-auto whitespace-pre-wrap break-words p-3.5 text-sm leading-relaxed text-ink"
                        >
                          {mediaDone.translated_text}
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3.5 py-2 text-xs text-ink-3">
                          <span>Translated script & subtitles</span>
                          <div className="flex items-center gap-2.5">
                            <button
                              type="button"
                              onClick={() => downloadSideText("translated", "txt")}
                              className="hover:text-ink"
                            >
                              .TXT
                            </button>
                            <button
                              type="button"
                              onClick={() => downloadSideText("translated", "srt")}
                              className="hover:text-ink"
                            >
                              .SRT
                            </button>
                            <button
                              type="button"
                              onClick={() => downloadSideText("translated", "vtt")}
                              className="hover:text-ink"
                            >
                              .VTT
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Interactive timestamped dialogue breakdown */}
                    {mediaDone.segments.length > 0 && (
                      <div className="rounded-md border border-line bg-paper/30">
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3.5 py-2.5">
                          <span className="label-mono text-ink-3">
                            Timed segments ({mediaDone.segments.length}) · click a timestamp to jump
                          </span>
                          <Chips
                            label="Segment display"
                            value={scriptView}
                            onChange={setScriptView}
                            options={[
                              { value: "bilingual", label: "Side by side" },
                              { value: "plain", label: "Compact" },
                            ]}
                          />
                        </div>
                        <div className="max-h-72 divide-y divide-line overflow-y-auto">
                          {mediaDone.segments.map((seg) => {
                            const isActive = seg.id === activeMediaSegId;
                            return (
                              <div
                                key={seg.id}
                                className={cn(
                                  "grid gap-2 px-3.5 py-2.5 text-sm transition-colors",
                                  scriptView === "bilingual" ? "sm:grid-cols-[88px_1fr_1fr]" : "grid-cols-[88px_1fr]",
                                  isActive && "bg-accent/10",
                                )}
                              >
                                <button
                                  type="button"
                                  onClick={() => seekMediaTo(seg.start)}
                                  className="self-start rounded-sm border border-line bg-surface px-2 py-1 text-left font-mono text-xs text-ink-2 hover:border-ink-3 hover:text-ink"
                                >
                                  {stamp(seg.start)}
                                </button>
                                <p className="text-ink-2" dir={sourceRtl ? "rtl" : "auto"}>
                                  {seg.source}
                                </p>
                                <p className="font-medium text-ink" dir={targetRtl ? "rtl" : "auto"}>
                                  {seg.translated}
                                </p>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </Workbench>
  );
}
