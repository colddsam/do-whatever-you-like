"use client";

/*
 * Audio & video translation (dubbing): moved here from the original translator playground, unchanged
 * in behaviour. Upload or record → Whisper transcript → translation → neural voice-over (+ soft subtitles).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, FileAudio, FileVideo, Loader2, RotateCcw } from "lucide-react";
import { checkFile, FileToolError, saveBlob } from "@/lib/files";
import { formatDuration } from "@/lib/media";
import { FORMATS, stamp } from "@/lib/transcribe";
import {
  ALL_MEDIA_EXTENSIONS,
  buildVttUrl,
  detectMediaKind,
  exportSideTranscript,
  fetchTranslatedResult,
  formatBytes,
  isRtlLanguage,
  languageLabel,
  MAX_MEDIA_MB,
  STAGE_LABELS,
  translateMedia,
  VIDEO_MEDIA_EXTENSIONS,
  type DownloadedMediaResult,
  type MediaSegmentPair,
  type MediaTranslateDone,
  type TranslateCapabilities,
  type TranslateLanguage,
  type TranslateStage,
} from "@/lib/translate";
import { cn } from "@/lib/utils";
import { AudioPreview } from "../../audio-preview";
import { FileDrop } from "../../file-drop";
import { stem } from "../../pdf/parts";
import { Chips, Notice, Panel, Row, Toggle } from "../../pdf/kit";
import { ProgressButton, type Job } from "../../progress-button";
import { Recorder } from "../../transcribe/recorder";
import { CopyButton } from "./shared";

type VoiceGender = "female" | "male";
type TimingMode = "timed" | "fluent";
type ScriptView = "bilingual" | "plain";
type SelectedMedia = { id: string; file: File; url: string; kind: "audio" | "video" };

export function MediaPanel({
  mode,
  setMode,
  sourceLang,
  targetLang,
  languages,
  caps,
  capsError,
  onBusy,
  onDetected,
}: {
  mode: "audio" | "video";
  setMode: (m: "audio" | "video") => void;
  sourceLang: string;
  targetLang: string;
  languages: TranslateLanguage[];
  caps: TranslateCapabilities | null;
  capsError: string | null;
  onBusy: (busy: boolean) => void;
  onDetected: (code: string | null) => void;
}) {
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
    return () => {
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

  // Switching between the Audio and Video tabs drops a file of the other kind (adjusted while
  // rendering, React's pattern for state that follows a prop; the old object URL is revoked when
  // the next file is chosen or the panel unmounts).
  const [seenMode, setSeenMode] = useState(mode);
  if (seenMode !== mode) {
    setSeenMode(mode);
    if (selectedMedia && selectedMedia.kind !== mode && job.kind !== "uploading" && job.kind !== "processing") {
      setSelectedMedia(null);
      setMediaDone(null);
      setDownloadedResult(null);
      setLiveSegments([]);
      setResultError(null);
      setStage(null);
      setMediaProgress(null);
      setMediaFileError(null);
      setJob({ kind: "ready" });
    }
  }

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

  const busyMedia = job.kind === "uploading" || job.kind === "processing";
  useEffect(() => onBusy(busyMedia), [busyMedia, onBusy]);
  useEffect(() => onDetected(mediaDone?.detected_language ?? null), [mediaDone, onDetected]);
  const targetRtl = isRtlLanguage(targetLang, languages);
  const sourceRtl = isRtlLanguage(mediaDone?.detected_language ?? (sourceLang === "auto" ? "" : sourceLang), languages);

  const displayedSegments = mediaDone?.segments ?? liveSegments;
  const activeMediaSegId = useMemo(() => {
    if (!displayedSegments.length) return -1;
    const found = displayedSegments.find((s) => mediaTime >= s.start && mediaTime <= s.end + 0.25);
    return found ? found.id : -1;
  }, [displayedSegments, mediaTime]);

  const acceptAccept = mode === "video" ? VIDEO_MEDIA_EXTENSIONS.join(",") : [...ALL_MEDIA_EXTENSIONS].join(",");

  return (
    <>
      {capsError && (
        <Notice tone="warning" className="mb-4">
          {capsError} The media server may still be waking up; try again in a moment.
        </Notice>
      )}
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
    </>
  );
}
