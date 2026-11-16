"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { unzipSync } from "fflate";
import {
  Check,
  Download,
  EyeOff,
  FileArchive,
  Film,
  Layers,
  Music,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Scissors,
  Trash2,
  Volume2,
  VolumeX,
} from "lucide-react";
import { FileToolError, saveBlob, uploadForm, type Converted } from "@/lib/files";
import { formatBytes } from "@/lib/media";
import { getTool, stepsFor } from "@/lib/tools";
import { stamp } from "@/lib/video";
import { cn } from "@/lib/utils";
import { FileDrop } from "../file-drop";
import { Workbench } from "../workbench";
import { ProgressButton, type Job } from "../progress-button";
import { Chips, Notice, Panel, Row } from "../pdf/kit";
import { MEDIA_ACCEPT } from "./media-edit-tools";

const FORMATS_LABEL = "MP4 · MOV · MKV · WebM · AVI · MP3 · WAV · M4A · FLAC · OGG";
const MAX_MB = 150;
const MAX_SEGMENTS = 60;
const MAX_EXACT_VIDEO_S = 180;
const MAX_GIF_S = 30;
const WAVEFORM_MAX_MB = 80;
const ZIP_PREVIEW_MAX_MB = 120;

const VIDEO_FORMAT_OPTIONS = [
  { value: "mp4", label: "MP4" },
  { value: "mov", label: "MOV" },
  { value: "mkv", label: "MKV" },
  { value: "webm", label: "WebM" },
  { value: "gif", label: "GIF" },
] as const;

const AUDIO_FORMAT_OPTIONS = [
  { value: "mp3", label: "MP3" },
  { value: "m4a", label: "M4A" },
  { value: "wav", label: "WAV" },
  { value: "flac", label: "FLAC" },
  { value: "ogg", label: "OGG" },
  { value: "opus", label: "OPUS" },
] as const;

type OutputFormat =
  | "original"
  | "mp4"
  | "mov"
  | "mkv"
  | "webm"
  | "gif"
  | "mp3"
  | "m4a"
  | "wav"
  | "flac"
  | "ogg"
  | "opus";

type Mode = "trim" | "parts";
type CombineMode = "parts" | "join";

type Segment = {
  id: string;
  start: number;
  end: number;
  keep: boolean;
  label: string;
};

type Source = {
  file: File;
  url: string;
  duration: number | null;
  video: boolean;
  width: number;
  height: number;
};

type ZipClipPreview = {
  name: string;
  size: number;
  url: string;
  blob: Blob;
  kind: "video" | "audio" | "gif" | "other";
};

const SEGMENT_PALETTE = [
  { bg: "rgba(235, 74, 16, 0.22)", border: "#eb4a10", dot: "bg-accent" },
  { bg: "rgba(47, 125, 79, 0.22)", border: "#2f7d4f", dot: "bg-success" },
  { bg: "rgba(183, 121, 31, 0.22)", border: "#b7791f", dot: "bg-warning" },
  { bg: "rgba(37, 99, 235, 0.20)", border: "#2563eb", dot: "bg-blue-600" },
  { bg: "rgba(124, 58, 237, 0.20)", border: "#7c3aed", dot: "bg-violet-600" },
];

let uidSeq = 1;
const nextId = () => `seg-${uidSeq++}`;

function readMedia(file: File): Promise<Source> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const el = document.createElement("video");
    el.preload = "metadata";
    el.muted = true;
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      const d = ok && Number.isFinite(el.duration) && el.duration > 0 ? el.duration : null;
      const hasVideo = ok ? el.videoWidth > 0 : /^video\//.test(file.type) || /\.(mkv|avi|wmv|flv|3gp|mts|m2ts)$/i.test(file.name);
      resolve({
        file,
        url,
        duration: d,
        video: hasVideo,
        width: el.videoWidth || 0,
        height: el.videoHeight || 0,
      });
    };
    el.onloadedmetadata = () => finish(true);
    el.onerror = () => finish(false);
    setTimeout(() => finish(false), 8000);
    el.src = url;
  });
}

function parseTime(text: string): number | null {
  const cleaned = text.trim();
  if (!cleaned) return null;
  if (!/^\d+(:\d{1,2}){0,2}(\.\d+)?$/.test(cleaned)) return null;
  const parts = cleaned.split(":").map(Number);
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

function formatClockInput(sec: number): string {
  const clamped = Math.max(0, sec);
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const s = clamped % 60;
  const wholeS = Math.floor(s);
  const tenths = Math.round((s - wholeS) * 10);
  const finalSec = tenths === 10 ? wholeS + 1 : wholeS;
  const frac = tenths === 10 || tenths === 0 ? "" : `.${tenths}`;
  const pad2 = (n: number) => String(n).padStart(2, "0");
  if (h > 0) return `${h}:${pad2(m)}:${pad2(finalSec)}${frac}`;
  return `${m}:${pad2(finalSec)}${frac}`;
}

function useWaveform(file: File | null): number[] | null {
  const [peaks, setPeaks] = useState<number[] | null>(null);
  useEffect(() => {
    if (!file || file.size > WAVEFORM_MAX_MB * 1024 * 1024) {
      queueMicrotask(() => setPeaks(null));
      return;
    }
    let cancelled = false;
    let ctx: AudioContext | null = null;
    (async () => {
      try {
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtx) return;
        const buf = await file.arrayBuffer();
        if (cancelled) return;
        ctx = new AudioCtx();
        const decoded = await ctx.decodeAudioData(buf);
        if (cancelled) return;
        const ch = decoded.getChannelData(0);
        const bars = 140;
        const step = Math.max(1, Math.floor(ch.length / bars));
        const raw: number[] = [];
        let maxPk = 1e-4;
        for (let i = 0; i < bars; i++) {
          const s = Math.floor((i * ch.length) / bars);
          const e = Math.min(ch.length, s + step);
          let pk = 0;
          for (let j = s; j < e; j += Math.max(1, Math.floor((e - s) / 48))) {
            const v = Math.abs(ch[j]);
            if (v > pk) pk = v;
          }
          if (pk > maxPk) maxPk = pk;
          raw.push(pk);
        }
        if (!cancelled) {
          setPeaks(raw.map((v) => Math.max(0.08, v / maxPk)));
        }
      } catch {
        if (!cancelled) setPeaks(null);
      } finally {
        if (ctx) {
          void ctx.close().catch(() => {});
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file]);
  return peaks;
}

function guessClipKind(name: string): ZipClipPreview["kind"] {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "gif") return "gif";
  if (["mp4", "mov", "mkv", "webm", "m4v", "avi"].includes(ext)) return "video";
  if (["mp3", "m4a", "wav", "flac", "ogg", "opus", "aac"].includes(ext)) return "audio";
  return "other";
}

function guessMime(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    mp4: "video/mp4",
    mov: "video/quicktime",
    webm: "video/webm",
    mkv: "video/x-matroska",
    gif: "image/gif",
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    wav: "audio/wav",
    flac: "audio/flac",
    ogg: "audio/ogg",
    opus: "audio/opus",
  };
  return map[ext] ?? "application/octet-stream";
}

function TimeInput({
  label,
  value,
  max,
  disabled,
  onCommit,
}: {
  label: string;
  value: number;
  max?: number;
  disabled?: boolean;
  onCommit: (seconds: number) => void;
}) {
  const [draft, setDraft] = useState(formatClockInput(value));
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) {
      queueMicrotask(() => setDraft(formatClockInput(value)));
    }
  }, [value, editing]);

  const apply = () => {
    setEditing(false);
    const parsed = parseTime(draft);
    if (parsed === null) {
      setDraft(formatClockInput(value));
      return;
    }
    const clamped = max !== undefined ? Math.max(0, Math.min(max, parsed)) : Math.max(0, parsed);
    onCommit(Number(clamped.toFixed(2)));
    setDraft(formatClockInput(clamped));
  };

  return (
    <label className="grid gap-1">
      <span className="label-mono text-[11px] text-ink-3">{label}</span>
      <input
        type="text"
        value={draft}
        disabled={disabled}
        onFocus={() => setEditing(true)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={apply}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            apply();
            (e.target as HTMLInputElement).blur();
          } else if (e.key === "Escape") {
            setEditing(false);
            setDraft(formatClockInput(value));
            (e.target as HTMLInputElement).blur();
          }
        }}
        className="h-9 w-24 rounded-sm border border-line bg-surface px-2 font-mono text-[13px] text-ink focus:border-ink focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:opacity-50"
      />
    </label>
  );
}

export function MediaCutterStudio({ toolId, initialMode = "trim" }: { toolId: string; initialMode?: Mode }) {
  const tool = getTool(toolId)!;
  const [src, setSrc] = useState<Source | null>(null);
  const [dropError, setDropError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [outputFormat, setOutputFormat] = useState<OutputFormat>("original");
  const [exact, setExact] = useState(false);
  const [combine, setCombine] = useState<CombineMode>("parts");

  // Single trim range
  const [trimRange, setTrimRange] = useState<[number, number]>([0, 0]);
  const [typedTrim, setTypedTrim] = useState({ start: "0:00", end: "" });

  // Multi-part segments
  const [segments, setSegments] = useState<Segment[]>([]);
  const [autoPartsCount, setAutoPartsCount] = useState(3);
  const [autoIntervalSec, setAutoIntervalSec] = useState(30);

  // Live player state
  const mediaRef = useRef<HTMLVideoElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<
    | { kind: "trim-start" }
    | { kind: "trim-end" }
    | { kind: "cut"; leftIdx: number; rightIdx: number }
    | null
  >(null);
  const clipStopAtRef = useRef<number | null>(null);

  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);

  // Job & output state
  const [job, setJob] = useState<Job>({ kind: "ready" });
  const [out, setOut] = useState<Converted | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const peaks = useWaveform(src?.file ?? null);

  useEffect(() => {
    return () => {
      if (src) URL.revokeObjectURL(src.url);
    };
  }, [src]);

  useEffect(() => {
    if (mediaRef.current) {
      mediaRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate, src]);

  const initSegmentsForDuration = useCallback((d: number) => {
    const mid = Number((d / 2).toFixed(2));
    setTrimRange([0, Number(d.toFixed(2))]);
    setSegments([
      { id: nextId(), start: 0, end: mid, keep: true, label: "" },
      { id: nextId(), start: mid, end: Number(d.toFixed(2)), keep: true, label: "" },
    ]);
  }, []);

  const handleFile = async (f: File) => {
    setDropError(null);
    if (f.size === 0) return setDropError("That file is empty.");
    if (f.size > MAX_MB * 1024 * 1024) return setDropError(`That file is over ${MAX_MB} MB.`);
    abortRef.current?.abort();
    setOut(null);
    setJob({ kind: "ready" });
    setCurrentTime(0);
    setPlaying(false);
    setOutputFormat("original");
    const loaded = await readMedia(f);
    setSrc(loaded);
    // Default to frame-exact cuts on videos up to MAX_EXACT_VIDEO_S so split parts stay cleanly
    // separated even when the source video has few keyframes.
    setExact(Boolean(loaded.video && loaded.duration !== null && loaded.duration <= MAX_EXACT_VIDEO_S));
    if (loaded.duration) {
      initSegmentsForDuration(loaded.duration);
    } else {
      setSegments([{ id: nextId(), start: 0, end: 30, keep: true, label: "" }]);
      setTypedTrim({ start: "0:00", end: "0:30" });
    }
  };

  const resetFile = () => {
    abortRef.current?.abort();
    setOut(null);
    setJob({ kind: "ready" });
    setSrc(null);
  };

  const seekTo = useCallback(
    (t: number, autoPlay = false) => {
      const dur = src?.duration ?? 0;
      const clamped = dur > 0 ? Math.max(0, Math.min(dur - 0.01, t)) : Math.max(0, t);
      clipStopAtRef.current = null;
      if (mediaRef.current) {
        mediaRef.current.currentTime = clamped;
        if (autoPlay) void mediaRef.current.play().catch(() => {});
      }
      setCurrentTime(clamped);
    },
    [src?.duration],
  );

  const togglePlay = useCallback(() => {
    const el = mediaRef.current;
    if (!el) return;
    clipStopAtRef.current = null;
    if (el.paused) {
      if (mode === "trim" && src?.duration && (el.currentTime < trimRange[0] || el.currentTime >= trimRange[1] - 0.05)) {
        el.currentTime = trimRange[0];
      }
      void el.play().catch(() => {});
    } else {
      el.pause();
    }
  }, [mode, src?.duration, trimRange]);

  const previewSegment = (seg: Segment) => {
    const el = mediaRef.current;
    if (!el) return;
    el.currentTime = seg.start;
    clipStopAtRef.current = seg.end;
    setCurrentTime(seg.start);
    void el.play().catch(() => {});
  };

  useEffect(() => {
    const el = mediaRef.current;
    if (!el) return;
    const onTime = () => {
      const t = el.currentTime;
      setCurrentTime(t);
      if (clipStopAtRef.current !== null && t >= clipStopAtRef.current) {
        el.pause();
        clipStopAtRef.current = null;
      } else if (mode === "trim" && !el.paused && t > trimRange[1]) {
        el.pause();
        el.currentTime = trimRange[0];
      }
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
    };
  }, [mode, trimRange, src]);

  // Multi-part actions
  const splitAtPlayhead = useCallback(() => {
    const dur = src?.duration;
    if (!dur) return;
    if (segments.length >= MAX_SEGMENTS) return;
    const t = Number(currentTime.toFixed(2));
    if (t <= 0.1 || t >= dur - 0.1) return;

    const targetIdx = segments.findIndex((s) => t > s.start + 0.1 && t < s.end - 0.1);
    if (targetIdx === -1) return;
    const target = segments[targetIdx];
    const next = [...segments];
    next.splice(
      targetIdx,
      1,
      { id: nextId(), start: target.start, end: t, keep: target.keep, label: target.label },
      { id: nextId(), start: t, end: target.end, keep: true, label: "" },
    );
    setSegments(next);
  }, [src?.duration, segments, currentTime]);

  const generateEqualParts = (n: number) => {
    const dur = src?.duration;
    if (!dur) return;
    const count = Math.max(2, Math.min(MAX_SEGMENTS, Math.round(n)));
    const step = dur / count;
    const built: Segment[] = [];
    for (let i = 0; i < count; i++) {
      built.push({
        id: nextId(),
        start: Number((i * step).toFixed(2)),
        end: Number((i === count - 1 ? dur : (i + 1) * step).toFixed(2)),
        keep: true,
        label: "",
      });
    }
    setSegments(built);
  };

  const generateEverySeconds = (sec: number) => {
    const dur = src?.duration;
    if (!dur || sec < 1) return;
    const count = Math.ceil(dur / sec);
    if (count > MAX_SEGMENTS) return;
    const built: Segment[] = [];
    for (let i = 0; i < count; i++) {
      const a = Number((i * sec).toFixed(2));
      const b = Number(Math.min(dur, (i + 1) * sec).toFixed(2));
      if (b - a >= 0.1) {
        built.push({ id: nextId(), start: a, end: b, keep: true, label: "" });
      }
    }
    if (built.length > 0) setSegments(built);
  };

  const addCustomSegment = () => {
    const dur = src?.duration ?? 300;
    if (segments.length >= MAX_SEGMENTS) return;
    const last = segments[segments.length - 1];
    const start = last && last.end < dur - 1 ? last.end : Math.min(dur - 1, Math.max(0, Number(currentTime.toFixed(1))));
    const end = Math.min(dur, start + Math.min(15, Math.max(1, dur - start)));
    if (end - start < 0.1) return;
    setSegments((prev) => [...prev, { id: nextId(), start, end, keep: true, label: "" }]);
  };

  const updateSegment = (id: string, patch: Partial<Segment>) => {
    setSegments((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const removeSegment = (id: string) => {
    setSegments((prev) => {
      if (prev.length <= 1) return prev;
      const idx = prev.findIndex((s) => s.id === id);
      if (idx < 0) return prev;
      // Merge boundary neatly with neighbor if contiguous split
      const removed = prev[idx];
      const next = prev.filter((s) => s.id !== id);
      if (idx > 0 && Math.abs(next[idx - 1].end - removed.start) < 0.05) {
        next[idx - 1] = { ...next[idx - 1], end: removed.end };
      } else if (idx < next.length && Math.abs(next[idx].start - removed.end) < 0.05) {
        next[idx] = { ...next[idx], start: removed.start };
      }
      return next;
    });
  };

  // Pointer scrubbing / handle dragging over waveform bar
  const timeFromClientX = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      const dur = src?.duration;
      if (!el || !dur) return 0;
      const r = el.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - r.left) / Math.max(1, r.width)));
      return Number((ratio * dur).toFixed(2));
    },
    [src?.duration],
  );

  const handleTrackPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    const dur = src?.duration;
    if (!drag || !dur) return;
    const t = timeFromClientX(e.clientX);
    if (drag.kind === "trim-start") {
      const s = Math.max(0, Math.min(t, trimRange[1] - 0.1));
      setTrimRange([s, trimRange[1]]);
      seekTo(s);
    } else if (drag.kind === "trim-end") {
      const end = Math.min(dur, Math.max(t, trimRange[0] + 0.1));
      setTrimRange([trimRange[0], end]);
      seekTo(end);
    } else if (drag.kind === "cut") {
      const left = segments[drag.leftIdx];
      const right = segments[drag.rightIdx];
      if (!left || !right) return;
      const clamped = Math.max(left.start + 0.1, Math.min(right.end - 0.1, t));
      setSegments((prev) =>
        prev.map((s, idx) =>
          idx === drag.leftIdx ? { ...s, end: clamped } : idx === drag.rightIdx ? { ...s, start: clamped } : s,
        ),
      );
      seekTo(clamped);
    }
  };

  // Keyboard shortcuts when a video/audio is loaded
  useEffect(() => {
    if (!src) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
      } else if ((e.key === "c" || e.key === "C") && mode === "parts") {
        e.preventDefault();
        splitAtPlayhead();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        seekTo(currentTime - (e.shiftKey ? 5 : 1));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        seekTo(currentTime + (e.shiftKey ? 5 : 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [src, mode, togglePlay, splitAtPlayhead, seekTo, currentTime]);

  // Derived plan & validation
  const activeSegments = useMemo(() => {
    if (!src) return [];
    if (mode === "trim") {
      const a = src.duration ? trimRange[0] : parseTime(typedTrim.start);
      const b = src.duration ? trimRange[1] : parseTime(typedTrim.end);
      if (a === null || b === null || b <= a) return [];
      return [{ start: Number(a.toFixed(3)), end: Number(b.toFixed(3)), label: "" }];
    }
    return segments
      .filter((s) => s.keep && s.end > s.start + 0.05)
      .map((s) => ({
        start: Number(s.start.toFixed(3)),
        end: Number(s.end.toFixed(3)),
        ...(s.label.trim() ? { label: s.label.trim() } : {}),
      }));
  }, [src, mode, trimRange, typedTrim, segments]);

  const totalKeptSeconds = useMemo(
    () => activeSegments.reduce((acc, s) => acc + (s.end - s.start), 0),
    [activeSegments],
  );

  const isAudioOutput = AUDIO_FORMAT_OPTIONS.some((o) => o.value === outputFormat);
  const isGifOutput = outputFormat === "gif";
  const needsVideoReencode =
    Boolean(src?.video) &&
    !isAudioOutput &&
    !isGifOutput &&
    (exact || outputFormat === "webm");

  const validationError = useMemo(() => {
    if (!src) return null;
    if (activeSegments.length === 0) {
      return mode === "trim" ? "Pick a valid start and end time." : "Keep at least one clip (0.05s or longer).";
    }
    if (activeSegments.length > MAX_SEGMENTS) {
      return `Keep at most ${MAX_SEGMENTS} clips per run.`;
    }
    if (isGifOutput && totalKeptSeconds > MAX_GIF_S) {
      return `GIF export handles up to ${MAX_GIF_S} seconds total. Switch format or shorten kept clips.`;
    }
    if (isGifOutput && mode === "parts" && combine === "join" && activeSegments.length > 1) {
      return "Export GIF clips separately, or join kept parts as MP4 / WebM.";
    }
    if (needsVideoReencode && totalKeptSeconds > MAX_EXACT_VIDEO_S) {
      return `Frame-exact / WebM re-encoding supports up to ${MAX_EXACT_VIDEO_S / 60} minutes of kept video. Switch to Fast stream copy or keep fewer seconds.`;
    }
    return null;
  }, [src, activeSegments, mode, isGifOutput, totalKeptSeconds, combine, needsVideoReencode]);

  const startCut = async () => {
    if (!src || validationError || activeSegments.length === 0) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setOut(null);
    setJob({ kind: "uploading", progress: 0 });

    const plan = {
      segments: activeSegments,
      combine: mode === "parts" ? combine : "parts",
      output_format: outputFormat,
      exact: Boolean(src.video && !isAudioOutput && exact),
    };

    const form = new FormData();
    form.append("file", src.file);
    form.append("plan", JSON.stringify(plan));

    const stem = src.file.name.replace(/\.[^.]+$/, "");
    const fallbackExt =
      outputFormat === "original"
        ? src.file.name.split(".").pop() || (src.video ? "mp4" : "m4a")
        : outputFormat;
    const fallbackName =
      activeSegments.length > 1 && plan.combine === "parts"
        ? `${stem}-parts.zip`
        : `${stem}-cut.${fallbackExt}`;

    try {
      const res = await uploadForm("/api/tools/media/cut-parts", form, {
        signal: ctrl.signal,
        fallbackName,
        onUpload: (p) => setJob(p >= 1 ? { kind: "processing" } : { kind: "uploading", progress: p }),
        onProcessing: () => setJob({ kind: "processing" }),
      });
      setOut(res);
      setJob({ kind: "ready" });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        setJob({ kind: "ready" });
        return;
      }
      setJob({
        kind: "failed",
        message: e instanceof FileToolError ? e.message : "We couldn't cut that file. Try Fast stream copy or shorter parts.",
      });
    }
  };

  // Adjacent boundaries where draggable cut handles belong
  const dividers = useMemo(() => {
    const list: { leftIdx: number; rightIdx: number; at: number }[] = [];
    for (let i = 0; i < segments.length - 1; i++) {
      if (Math.abs(segments[i].end - segments[i + 1].start) < 0.08) {
        list.push({ leftIdx: i, rightIdx: i + 1, at: segments[i].end });
      }
    }
    return list;
  }, [segments]);

  const step = !src ? 0 : out ? 2 : 1;
  const dur = src?.duration ?? 0;
  const pct = (t: number) => (dur > 0 ? `${(Math.max(0, Math.min(dur, t)) / dur) * 100}%` : "0%");

  const ctaLabel = (() => {
    if (!src || validationError) return mode === "trim" ? "Pick the part to cut" : "Choose clips to export";
    const fmtText = outputFormat === "original" ? "" : ` (${outputFormat.toUpperCase()})`;
    if (mode === "trim") {
      return `Cut clip · ${stamp(totalKeptSeconds)}${fmtText}`;
    }
    if (combine === "join" && activeSegments.length > 1) {
      return `Join ${activeSegments.length} parts · ${stamp(totalKeptSeconds)}${fmtText}`;
    }
    return activeSegments.length === 1
      ? `Export 1 clip · ${stamp(totalKeptSeconds)}${fmtText}`
      : `Cut into ${activeSegments.length} parts (ZIP)${fmtText}`;
  })();

  return (
    <Workbench
      steps={stepsFor(tool)}
      current={step}
      footer="Your file is processed on our server and deleted immediately after download."
    >
      <div className="@container grid gap-4 p-3 sm:p-4 md:p-5">
        {!src ? (
          <FileDrop
            accept={MEDIA_ACCEPT}
            title="Drop a video or audio file to cut or split into parts"
            formats={`${FORMATS_LABEL} · up to ${MAX_MB} MB`}
            error={dropError}
            onFile={handleFile}
          />
        ) : (
          <>
            {/* Source Header */}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-paper px-3 py-2">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-sm border border-line bg-surface text-ink-2">
                  {src.video ? <Film aria-hidden className="size-4" /> : <Music aria-hidden className="size-4" />}
                </span>
                <p className="min-w-0 truncate text-sm font-medium text-ink">
                  {src.file.name}{" "}
                  <span className="font-mono text-[12px] font-normal text-ink-3">
                    · {src.video ? (src.width ? `${src.width}×${src.height}` : "video") : "audio"}
                    {dur > 0 ? ` · ${stamp(dur, false)}` : ""} · {formatBytes(src.file.size)}
                  </span>
                </p>
              </div>
              <button
                type="button"
                onClick={resetFile}
                className="inline-flex h-8 items-center rounded-[8px] px-2.5 text-[13px] text-ink-2 hover:bg-paper-2 hover:text-ink"
              >
                Change file
              </button>
            </div>

            {/* Mode Switch */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="inline-flex rounded-md border border-line bg-paper p-0.5">
                <button
                  type="button"
                  onClick={() => (setMode("trim"), setOut(null))}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-[5px] px-3 py-1.5 text-sm font-medium transition-colors",
                    mode === "trim" ? "bg-ink text-paper shadow-xs" : "text-ink-2 hover:text-ink",
                  )}
                >
                  <Scissors aria-hidden className="size-3.5" /> Single cut (Trim)
                </button>
                <button
                  type="button"
                  onClick={() => (setMode("parts"), setOut(null))}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-[5px] px-3 py-1.5 text-sm font-medium transition-colors",
                    mode === "parts" ? "bg-ink text-paper shadow-xs" : "text-ink-2 hover:text-ink",
                  )}
                >
                  <Layers aria-hidden className="size-3.5" /> Cut in parts (Split)
                </button>
              </div>
              {dur > 0 && (
                <p className="text-xs text-ink-3">
                  Shortcuts: <kbd className="rounded border border-line bg-paper px-1 font-mono text-[11px]">Space</kbd> play
                  {mode === "parts" && (
                    <>
                      {" "}· <kbd className="rounded border border-line bg-paper px-1 font-mono text-[11px]">C</kbd> cut at playhead
                    </>
                  )}
                </p>
              )}
            </div>

            {/* Live Player + Waveform Deck */}
            {dur > 0 ? (
              <div className="grid gap-3 rounded-lg border border-line bg-surface p-3 sm:p-4">
                {src.video ? (
                  <video
                    ref={mediaRef}
                    src={src.url}
                    playsInline
                    muted={muted}
                    preload="metadata"
                    onClick={togglePlay}
                    className="max-h-[360px] w-full cursor-pointer rounded-md border border-line bg-ink object-contain"
                  />
                ) : (
                  <audio ref={mediaRef} src={src.url} muted={muted} preload="metadata" className="hidden" />
                )}

                {/* Player transport bar */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={togglePlay}
                      aria-label={playing ? "Pause" : "Play"}
                      className="inline-flex h-9 items-center gap-1.5 rounded-md bg-ink px-3.5 text-sm font-medium text-paper transition-opacity hover:opacity-90"
                    >
                      {playing ? <Pause aria-hidden className="size-4" /> : <Play aria-hidden className="size-4" />}
                      {playing ? "Pause" : "Play"}
                    </button>
                    {[-5, -1, 1, 5].map((delta) => (
                      <button
                        key={delta}
                        type="button"
                        onClick={() => seekTo(currentTime + delta)}
                        className="inline-flex h-9 items-center rounded-md border border-line bg-paper px-2.5 font-mono text-[12px] text-ink-2 hover:border-ink-3 hover:text-ink"
                      >
                        {delta > 0 ? `+${delta}s` : `${delta}s`}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setMuted((m) => !m)}
                      aria-label={muted ? "Unmute" : "Mute"}
                      className="inline-flex size-9 items-center justify-center rounded-md border border-line bg-paper text-ink-2 hover:border-ink-3 hover:text-ink"
                    >
                      {muted ? <VolumeX aria-hidden className="size-4" /> : <Volume2 aria-hidden className="size-4" />}
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[13px] text-ink">
                      {stamp(currentTime)} <span className="text-ink-3">/ {stamp(dur)}</span>
                    </span>
                    <div className="inline-flex rounded-sm border border-line bg-paper p-0.5">
                      {[0.5, 1, 1.5, 2].map((r) => (
                        <button
                          key={r}
                          type="button"
                          onClick={() => setPlaybackRate(r)}
                          className={cn(
                            "rounded-[4px] px-1.5 py-0.5 font-mono text-[11px]",
                            playbackRate === r ? "bg-ink text-paper" : "text-ink-3 hover:text-ink",
                          )}
                        >
                          {r}×
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Interactive Waveform & Timeline */}
                <div className="px-1 pt-1">
                  <div
                    ref={trackRef}
                    onPointerMove={handleTrackPointerMove}
                    onPointerUp={() => (dragRef.current = null)}
                    onPointerCancel={() => (dragRef.current = null)}
                    onPointerDown={(e) => {
                      const target = e.target as HTMLElement;
                      if (target.dataset.handle) return;
                      seekTo(timeFromClientX(e.clientX));
                    }}
                    className="relative h-20 w-full cursor-pointer touch-none select-none overflow-hidden rounded-md border border-line bg-paper"
                  >
                    {/* Audio waveform bars background */}
                    <div aria-hidden className="pointer-events-none absolute inset-x-1 inset-y-2 flex items-center gap-[2px]">
                      {(peaks ?? Array.from({ length: 120 }, (_, i) => 0.25 + 0.45 * Math.abs(Math.sin(i * 0.27) * Math.cos(i * 0.09)))).map((pk, idx) => (
                        <span
                          key={idx}
                          className="flex-1 rounded-full bg-ink/20"
                          style={{ height: `${Math.round(pk * 100)}%` }}
                        />
                      ))}
                    </div>

                    {/* Selection / segment overlays */}
                    {mode === "trim" ? (
                      <>
                        <div
                          aria-hidden
                          className="pointer-events-none absolute inset-y-0 border-x-2 border-accent bg-accent/20"
                          style={{
                            left: pct(trimRange[0]),
                            width: `calc(${pct(trimRange[1])} - ${pct(trimRange[0])})`,
                          }}
                        />
                        {(["trim-start", "trim-end"] as const).map((kind) => {
                          const at = kind === "trim-start" ? trimRange[0] : trimRange[1];
                          return (
                            <button
                              key={kind}
                              type="button"
                              data-handle="true"
                              aria-label={kind === "trim-start" ? "Trim start" : "Trim end"}
                              onPointerDown={(e) => {
                                e.stopPropagation();
                                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                                dragRef.current = { kind };
                              }}
                              className="absolute inset-y-0 z-20 flex w-4 -translate-x-1/2 cursor-ew-resize items-center justify-center bg-ink text-paper shadow-xs"
                              style={{ left: pct(at) }}
                            >
                              <span aria-hidden className="h-6 w-px bg-paper/80" />
                            </button>
                          );
                        })}
                      </>
                    ) : (
                      <>
                        {segments.map((seg, idx) => {
                          const pal = SEGMENT_PALETTE[idx % SEGMENT_PALETTE.length];
                          const widthPct = Math.max(0.5, ((seg.end - seg.start) / dur) * 100);
                          return (
                            <div
                              key={seg.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                previewSegment(seg);
                              }}
                              title={`Clip #${idx + 1}: ${formatClockInput(seg.start)} → ${formatClockInput(seg.end)} (click to preview)`}
                              style={{
                                left: pct(seg.start),
                                width: `${widthPct}%`,
                                backgroundColor: seg.keep ? pal.bg : "rgba(21, 20, 15, 0.08)",
                                borderColor: seg.keep ? pal.border : "transparent",
                              }}
                              className={cn(
                                "absolute inset-y-0 border-y-2 transition-opacity",
                                !seg.keep && "opacity-45",
                              )}
                            >
                              <span
                                className={cn(
                                  "ml-1.5 mt-1 inline-flex items-center gap-1 rounded px-1 py-0.5 font-mono text-[10px] font-semibold",
                                  seg.keep ? "bg-paper/90 text-ink" : "bg-paper/70 text-ink-3 line-through",
                                )}
                              >
                                #{idx + 1}
                              </span>
                            </div>
                          );
                        })}
                        {/* Draggable split dividers */}
                        {dividers.map((d) => (
                          <button
                            key={`${d.leftIdx}-${d.rightIdx}`}
                            type="button"
                            data-handle="true"
                            aria-label={`Move cut #${d.leftIdx + 1}`}
                            onPointerDown={(e) => {
                              e.stopPropagation();
                              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                              dragRef.current = { kind: "cut", leftIdx: d.leftIdx, rightIdx: d.rightIdx };
                            }}
                            className="absolute inset-y-0 z-20 flex w-3 -translate-x-1/2 cursor-ew-resize items-center justify-center bg-ink/85 hover:bg-accent"
                            style={{ left: pct(d.at) }}
                          >
                            <span aria-hidden className="h-5 w-px bg-paper" />
                          </button>
                        ))}
                      </>
                    )}

                    {/* Playhead */}
                    <div
                      aria-hidden
                      className="pointer-events-none absolute inset-y-0 z-30 w-0.5 -translate-x-1/2 bg-accent shadow-xs"
                      style={{ left: pct(currentTime) }}
                    >
                      <span className="block size-2.5 -translate-x-1 rounded-full bg-accent" />
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <Notice tone="info">
                This file format can&apos;t preview directly in your browser, so enter your cut timestamps below. FFmpeg will still cut it cleanly on the server.
              </Notice>
            )}

            {/* Mode-Specific Controls */}
            {mode === "trim" ? (
              <Panel>
                <Row
                  label="Trim timestamps"
                  hint={dur > 0 ? `Selected clip: ${stamp(trimRange[1] - trimRange[0])}` : undefined}
                >
                  <div className="flex flex-wrap items-end gap-3">
                    {dur > 0 ? (
                      <>
                        <TimeInput
                          label="Start"
                          value={trimRange[0]}
                          max={trimRange[1] - 0.1}
                          onCommit={(v) => (setTrimRange([v, trimRange[1]]), seekTo(v))}
                        />
                        <TimeInput
                          label="End"
                          value={trimRange[1]}
                          max={dur}
                          onCommit={(v) => setTrimRange([Math.min(trimRange[0], v - 0.1), Math.max(trimRange[0] + 0.1, v)])}
                        />
                        <div className="flex flex-wrap gap-1.5 pb-0.5">
                          <button
                            type="button"
                            onClick={() => {
                              const s = Math.max(0, Math.min(currentTime, trimRange[1] - 0.1));
                              setTrimRange([Number(s.toFixed(2)), trimRange[1]]);
                            }}
                            className="inline-flex h-9 items-center rounded-md border border-line bg-surface px-2.5 text-xs font-medium text-ink-2 hover:border-ink-3 hover:text-ink"
                          >
                            Set Start to Playhead
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const e = Math.min(dur, Math.max(currentTime, trimRange[0] + 0.1));
                              setTrimRange([trimRange[0], Number(e.toFixed(2))]);
                            }}
                            className="inline-flex h-9 items-center rounded-md border border-line bg-surface px-2.5 text-xs font-medium text-ink-2 hover:border-ink-3 hover:text-ink"
                          >
                            Set End to Playhead
                          </button>
                          <button
                            type="button"
                            onClick={() => setTrimRange([0, dur])}
                            className="inline-flex h-9 items-center gap-1 rounded-md px-2 text-xs text-ink-3 hover:text-ink"
                          >
                            <RotateCcw aria-hidden className="size-3.5" /> Reset
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <label className="grid gap-1">
                          <span className="label-mono text-[11px] text-ink-3">Start</span>
                          <input
                            type="text"
                            value={typedTrim.start}
                            onChange={(e) => setTypedTrim((p) => ({ ...p, start: e.target.value }))}
                            placeholder="0:00"
                            className="h-9 w-28 rounded-sm border border-line bg-surface px-2 font-mono text-sm text-ink"
                          />
                        </label>
                        <label className="grid gap-1">
                          <span className="label-mono text-[11px] text-ink-3">End</span>
                          <input
                            type="text"
                            value={typedTrim.end}
                            onChange={(e) => setTypedTrim((p) => ({ ...p, end: e.target.value }))}
                            placeholder="1:30"
                            className="h-9 w-28 rounded-sm border border-line bg-surface px-2 font-mono text-sm text-ink"
                          />
                        </label>
                      </>
                    )}
                  </div>
                </Row>
              </Panel>
            ) : (
              <Panel>
                {/* Quick split action bar */}
                <Row
                  label="Quick split controls"
                  hint={`${segments.length} segments (${activeSegments.length} kept)`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    {dur > 0 && (
                      <button
                        type="button"
                        onClick={splitAtPlayhead}
                        disabled={segments.length >= MAX_SEGMENTS}
                        className="inline-flex h-9 items-center gap-1.5 rounded-md bg-ink px-3 text-xs font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-40"
                      >
                        <Scissors aria-hidden className="size-3.5" /> Add cut at {stamp(currentTime)}
                      </button>
                    )}

                    {dur > 0 && (
                      <div className="inline-flex items-center gap-1 rounded-md border border-line bg-surface p-1">
                        <input
                          type="number"
                          min={2}
                          max={MAX_SEGMENTS}
                          value={autoPartsCount}
                          onChange={(e) => setAutoPartsCount(Math.max(2, Math.min(MAX_SEGMENTS, Number(e.target.value) || 2)))}
                          aria-label="Number of equal parts"
                          className="h-7 w-12 rounded-sm border border-line bg-paper px-1.5 text-center font-mono text-xs text-ink"
                        />
                        <button
                          type="button"
                          onClick={() => generateEqualParts(autoPartsCount)}
                          className="inline-flex h-7 items-center rounded-sm px-2 text-xs font-medium text-ink-2 hover:bg-paper-2 hover:text-ink"
                        >
                          Equal parts
                        </button>
                      </div>
                    )}

                    {dur > 0 && (
                      <div className="inline-flex items-center gap-1 rounded-md border border-line bg-surface p-1">
                        <input
                          type="number"
                          min={2}
                          max={3600}
                          value={autoIntervalSec}
                          onChange={(e) => setAutoIntervalSec(Math.max(2, Number(e.target.value) || 30))}
                          aria-label="Interval seconds per part"
                          className="h-7 w-14 rounded-sm border border-line bg-paper px-1.5 text-center font-mono text-xs text-ink"
                        />
                        <button
                          type="button"
                          onClick={() => generateEverySeconds(autoIntervalSec)}
                          className="inline-flex h-7 items-center rounded-sm px-2 text-xs font-medium text-ink-2 hover:bg-paper-2 hover:text-ink"
                        >
                          sec chunks
                        </button>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={addCustomSegment}
                      disabled={segments.length >= MAX_SEGMENTS}
                      className="inline-flex h-9 items-center gap-1 rounded-md border border-line bg-surface px-2.5 text-xs font-medium text-ink-2 hover:border-ink-3 hover:text-ink disabled:opacity-40"
                    >
                      <Plus aria-hidden className="size-3.5" /> Add range
                    </button>

                    {dur > 0 && (
                      <button
                        type="button"
                        onClick={() => initSegmentsForDuration(dur)}
                        className="inline-flex h-9 items-center gap-1 rounded-md px-2 text-xs text-ink-3 hover:text-ink"
                      >
                        <RotateCcw aria-hidden className="size-3.5" /> Reset 2 parts
                      </button>
                    )}
                  </div>
                </Row>

                {/* Segment Rows */}
                <Row label="Clips & parts" hint="Toggle Keep / Skip to cut out unwanted sections">
                  <div className="grid max-h-72 gap-2 overflow-y-auto pr-0.5" data-lenis-prevent>
                    {segments.map((seg, idx) => {
                      const pal = SEGMENT_PALETTE[idx % SEGMENT_PALETTE.length];
                      const len = Math.max(0, seg.end - seg.start);
                      return (
                        <div
                          key={seg.id}
                          className={cn(
                            "flex flex-wrap items-end justify-between gap-2 rounded-md border p-2.5 transition-colors",
                            seg.keep ? "border-line bg-surface" : "border-dashed border-line bg-paper/60 opacity-65",
                          )}
                        >
                          <div className="flex flex-wrap items-end gap-2.5">
                            <span className="mb-1.5 inline-flex items-center gap-1.5 font-mono text-xs font-semibold text-ink">
                              <span aria-hidden className={cn("size-2.5 rounded-full", pal.dot)} />#{idx + 1}
                            </span>

                            <TimeInput
                              label="Start"
                              value={seg.start}
                              max={dur > 0 ? dur - 0.1 : undefined}
                              onCommit={(v) => updateSegment(seg.id, { start: Math.min(v, seg.end - 0.1) })}
                            />
                            <TimeInput
                              label="End"
                              value={seg.end}
                              max={dur > 0 ? dur : undefined}
                              onCommit={(v) => updateSegment(seg.id, { end: Math.max(seg.start + 0.1, v) })}
                            />

                            <label className="grid gap-1">
                              <span className="label-mono text-[11px] text-ink-3">Label (optional)</span>
                              <input
                                type="text"
                                maxLength={40}
                                value={seg.label}
                                onChange={(e) => updateSegment(seg.id, { label: e.target.value })}
                                placeholder={`part-${idx + 1}`}
                                className="h-9 w-28 rounded-sm border border-line bg-surface px-2 text-xs text-ink focus:border-ink focus:outline-none"
                              />
                            </label>

                            <span className="mb-1.5 rounded-sm bg-paper-2 px-1.5 py-0.5 font-mono text-[11px] text-ink-2">
                              {len.toFixed(1)}s
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5">
                            {dur > 0 && (
                              <button
                                type="button"
                                onClick={() => previewSegment(seg)}
                                title="Preview this clip"
                                className="inline-flex h-8 items-center gap-1 rounded-sm border border-line bg-paper px-2 text-xs text-ink-2 hover:border-ink-3 hover:text-ink"
                              >
                                <Play aria-hidden className="size-3" /> Play
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => updateSegment(seg.id, { keep: !seg.keep })}
                              className={cn(
                                "inline-flex h-8 items-center gap-1 rounded-sm border px-2 text-xs font-medium",
                                seg.keep
                                  ? "border-success/40 bg-success/10 text-success"
                                  : "border-line bg-paper text-ink-3 hover:text-ink",
                              )}
                            >
                              {seg.keep ? <Check aria-hidden className="size-3" /> : <EyeOff aria-hidden className="size-3" />}
                              {seg.keep ? "Keep" : "Skip"}
                            </button>
                            {segments.length > 1 && (
                              <button
                                type="button"
                                onClick={() => removeSegment(seg.id)}
                                aria-label={`Remove clip #${idx + 1}`}
                                className="inline-flex size-8 items-center justify-center rounded-sm border border-line bg-paper text-ink-3 hover:border-danger/40 hover:text-danger"
                              >
                                <Trash2 aria-hidden className="size-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </Row>

                {activeSegments.length > 1 && (
                  <Row label="How to deliver parts">
                    <Chips
                      value={combine}
                      onChange={setCombine}
                      label="Delivery"
                      options={[
                        { value: "parts", label: `Separate clips (${activeSegments.length} files in ZIP)` },
                        { value: "join", label: `Merge ${activeSegments.length} kept parts into 1 file` },
                      ]}
                    />
                    <p className="mt-2 text-xs text-ink-3">
                      {combine === "parts"
                        ? "Every kept segment is exported cleanly as its own file inside a ZIP archive (you can preview every clip right here before saving)."
                        : "Skipped segments are removed cleanly and kept segments are joined back-to-back into a single continuous file."}
                    </p>
                  </Row>
                )}
              </Panel>
            )}

            {/* Output Format & Cut Precision */}
            <Panel>
              <Row label="Desired output format" hint="Keep original format or convert on the fly">
                <div className="grid gap-2.5">
                  <Chips
                    value={outputFormat}
                    onChange={(v) => setOutputFormat(v as OutputFormat)}
                    label="Output format"
                    options={[
                      { value: "original", label: "Keep original" },
                      ...(src.video ? VIDEO_FORMAT_OPTIONS : []),
                      ...AUDIO_FORMAT_OPTIONS,
                    ]}
                  />
                  {src.video && (
                    <p className="text-xs text-ink-3">
                      {isAudioOutput
                        ? `Audio-only export: strips video and saves sound directly as ${outputFormat.toUpperCase()}.`
                        : isGifOutput
                          ? "Turns kept clip(s) into looping animated GIF (up to 30 seconds total)."
                          : outputFormat === "original" || outputFormat === "mp4" || outputFormat === "mov" || outputFormat === "mkv"
                            ? "Select any video container, or pick MP3 / M4A / WAV / FLAC / OGG / OPUS to extract just the audio."
                            : "Re-encodes smoothly to WebM VP9 + Opus."}
                    </p>
                  )}
                </div>
              </Row>

              {src.video && !isAudioOutput && !isGifOutput && (
                <Row label="Cut precision">
                  <Chips
                    value={exact ? "exact" : "fast"}
                    onChange={(v) => setExact(v === "exact")}
                    label="Cut precision"
                    options={[
                      { value: "fast", label: "Fast, lossless copy" },
                      { value: "exact", label: "Frame-exact (re-encode)" },
                    ]}
                  />
                  <p className="mt-2 text-xs text-ink-3">
                    {exact
                      ? `Re-encodes cleanly on the exact frame you selected (up to ${MAX_EXACT_VIDEO_S / 60} min kept video).`
                      : "Stream copy finishes in seconds with zero quality loss; sparse-keyframe clips auto-fallback so parts stay cleanly separated."}
                  </p>
                </Row>
              )}
            </Panel>

            {validationError && <Notice tone="warning">{validationError}</Notice>}

            <ProgressButton
              job={job}
              label={ctaLabel}
              working={needsVideoReencode ? "Cutting & encoding…" : "Cutting…"}
              hint={`${activeSegments.length} kept ${activeSegments.length === 1 ? "clip" : "clips"} · ${stamp(totalKeptSeconds)} total`}
              disabled={Boolean(validationError)}
              onStart={() => void startCut()}
              onCancel={() => abortRef.current?.abort()}
            />

            {out && <CutResult out={out} video={src.video && !isAudioOutput} onBack={() => setOut(null)} />}
          </>
        )}
      </div>
    </Workbench>
  );
}

function CutResult({ out, video, onBack }: { out: Converted; video: boolean; onBack: () => void }) {
  const isZip = out.name.toLowerCase().endsWith(".zip") || /zip/.test(out.type);
  const [singleUrl, setSingleUrl] = useState<string | null>(null);
  const [zipClips, setZipClips] = useState<ZipClipPreview[] | null>(null);
  const [zipBusy, setZipBusy] = useState(false);

  const notes: string[] = useMemo(() => {
    try {
      return out.info ? (JSON.parse(out.info).notes ?? []) : [];
    } catch {
      return [];
    }
  }, [out.info]);

  useEffect(() => {
    let active = true;
    const urls: string[] = [];

    if (!isZip) {
      const u = URL.createObjectURL(out.blob);
      urls.push(u);
      queueMicrotask(() => {
        if (active) setSingleUrl(u);
      });
    } else if (out.size <= ZIP_PREVIEW_MAX_MB * 1024 * 1024) {
      queueMicrotask(() => {
        if (active) setZipBusy(true);
      });
      void (async () => {
        try {
          const buf = new Uint8Array(await out.blob.arrayBuffer());
          const entries = unzipSync(buf);
          if (!active) return;
          const items: ZipClipPreview[] = [];
          for (const [name, data] of Object.entries(entries)) {
            if (name.endsWith("/") || data.length === 0) continue;
            const copy = new Uint8Array(data.byteLength);
            copy.set(data);
            const clipBlob = new Blob([copy.buffer], { type: guessMime(name) });
            const clipUrl = URL.createObjectURL(clipBlob);
            urls.push(clipUrl);
            items.push({ name, size: clipBlob.size, url: clipUrl, blob: clipBlob, kind: guessClipKind(name) });
          }
          if (active) setZipClips(items);
        } catch {
          if (active) setZipClips(null);
        } finally {
          if (active) setZipBusy(false);
        }
      })();
    }

    return () => {
      active = false;
      for (const u of urls) URL.revokeObjectURL(u);
    };
  }, [out, isZip]);

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      aria-label="Cut output"
      className="grid gap-3 rounded-lg border border-line bg-paper p-3 sm:p-4"
    >
      {!isZip && singleUrl && (
        out.name.toLowerCase().endsWith(".gif") ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={singleUrl} alt={out.name} className="max-h-[360px] w-full rounded-sm border border-line bg-surface object-contain" />
        ) : video ? (
          <video src={singleUrl} controls className="max-h-[360px] w-full rounded-sm bg-ink" />
        ) : (
          <audio src={singleUrl} controls className="w-full" />
        )
      )}

      {isZip && (
        <div className="grid gap-2">
          <div className="flex items-center justify-between gap-2">
            <p className="inline-flex items-center gap-1.5 text-sm font-medium text-ink">
              <FileArchive aria-hidden className="size-4 text-ink-2" />
              {out.name}
            </p>
            <span className="font-mono text-xs text-ink-3">{formatBytes(out.size)}</span>
          </div>

          {zipBusy && <p className="text-xs text-ink-3">Unpacking clips for inline preview…</p>}

          {zipClips && zipClips.length > 0 && (
            <ul className="grid max-h-80 gap-2 overflow-y-auto pr-0.5" data-lenis-prevent>
              {zipClips.map((clip, i) => (
                <li key={clip.name} className="grid gap-2 rounded-md border border-line bg-surface p-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0 truncate font-mono text-xs text-ink">
                      <span className="mr-1.5 text-ink-3">#{i + 1}</span>
                      {clip.name}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11px] text-ink-3">{formatBytes(clip.size)}</span>
                      <button
                        type="button"
                        onClick={() => saveBlob(clip.blob, clip.name)}
                        className="inline-flex h-8 items-center gap-1 rounded-sm border border-line bg-paper px-2.5 text-xs font-medium text-ink hover:border-ink-3"
                      >
                        <Download aria-hidden className="size-3" /> Save part
                      </button>
                    </div>
                  </div>
                  {clip.kind === "video" && <video src={clip.url} controls preload="metadata" className="max-h-48 w-full rounded-sm bg-ink" />}
                  {clip.kind === "audio" && <audio src={clip.url} controls preload="metadata" className="w-full" />}
                  {clip.kind === "gif" && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={clip.url} alt={clip.name} className="max-h-44 rounded-sm border border-line object-contain" />
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {!isZip && (
        <p className="font-mono text-[12px] text-ink-3">
          {out.name} · {formatBytes(out.size)}
        </p>
      )}

      {notes.map((n) => (
        <p key={n} className="text-xs text-ink-2">
          {n}
        </p>
      ))}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => saveBlob(out.blob, out.name)}
          className="inline-flex h-11 items-center gap-2 rounded-md bg-ink px-5 text-sm font-medium text-paper transition-[opacity,transform] hover:opacity-90 active:scale-[0.98]"
        >
          <Download aria-hidden className="size-4" />
          {isZip ? "Download all (.zip)" : "Download"}
          <span className="font-mono text-[12px] font-normal text-paper/60">{formatBytes(out.size)}</span>
        </button>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex h-11 items-center rounded-md border border-line bg-surface px-4 text-sm font-medium text-ink hover:border-ink-3"
        >
          Edit cuts
        </button>
      </div>
    </motion.section>
  );
}
