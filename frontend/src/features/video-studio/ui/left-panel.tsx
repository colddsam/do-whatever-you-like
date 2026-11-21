"use client";

import { createElement, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  AudioLines,
  Blend,
  Camera,
  CircleAlert,
  Ellipsis,
  Film,
  FolderOpen,
  Image as ImageIcon,
  Layers,
  Link as LinkIcon,
  LoaderCircle,
  Monitor,
  Music4,
  Plus,
  RefreshCw,
  Shapes,
  Smile,
  Sparkles,
  Square,
  Type,
  Upload,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { DEFAULT_TRANSITION_DURATION, IMPORT_ACCEPT, PROJECT_ACCEPT, SHAPE_PRESETS, STICKERS, TEXT_PRESETS, TRANSITIONS } from "../constants";
import { formatBytes, shortTime } from "../lib/time";
import * as TL from "../lib/timeline";
import { getStudio, usePrimaryClip, useStudio, type LeftTab } from "../store/studio-store";
import type { MediaAsset, TransitionType } from "../types";
import { addGeneratedFile } from "../engine/clip-tools";
import { importFiles, importFromUrl } from "../engine/importer";
import { openExternalProjectFile, relinkOfflineMedia } from "../engine/interop";
import { mediaRuntime } from "../engine/media";
import { cleanUpStorage } from "../engine/persistence";
import { recordingSupported, startRecording, type RecordKind, type Recording } from "../engine/record";
import { storageEstimate } from "../engine/storage";
import { AIPanel } from "./ai-panel";
import { AudioPanel } from "./audio-panel";
import { SHAPE_ICON, TRANSITION_ICON } from "./catalog";
import { ColorField, Progress, Segmented, Slider, TextButton, Toggle } from "./controls";
import { EffectsPanel } from "./effects-panel";

const MEDIA_MIME = "application/x-studio-media";
const ACCEPT = IMPORT_ACCEPT;
const useMediaVersion = () => useSyncExternalStore(mediaRuntime.subscribe, mediaRuntime.version, () => 0);

/* ---------- Media bin ---------- */

function MenuItem({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className="block w-full px-3 py-1.5 text-left text-[12px] text-paper hover:bg-paper/10 disabled:opacity-40">
      {children}
    </button>
  );
}

function MediaTile({ a, index = 0 }: { a: MediaAsset; index?: number }) {
  useMediaVersion();
  const status = useStudio((s) => s.media[a.id]);
  const job = useStudio((s) => s.jobs[`proxy:${a.id}`]);
  const [menu, setMenu] = useState(false);
  const relinkRef = useRef<HTMLInputElement>(null);
  const st = getStudio();
  const thumb = mediaRuntime.thumbs.get(a.id)?.urls[Math.min(2, (mediaRuntime.thumbs.get(a.id)?.urls.length ?? 1) - 1)];
  const offline = status?.state === "offline";
  const res = a.hasVideo && a.height ? (Math.min(a.width, a.height) >= 2000 ? "4K" : `${Math.min(a.width, a.height)}p`) : null;

  const proxy = async () => {
    setMenu(false);
    st.setJob(`proxy:${a.id}`, { label: "Making a proxy", progress: 0 });
    try {
      const px = await mediaRuntime.createProxy(a, (f) => getStudio().setJob(`proxy:${a.id}`, { label: "Making a proxy", progress: f }));
      getStudio().commit((p) => (p.media[a.id] ? { ...p, media: { ...p.media, [a.id]: { ...p.media[a.id], proxy: px } } } : p));
      getStudio().notify(`Proxy ready for ${a.name}. Playback uses it while “Proxies” is on; exports use the original.`, "success");
    } catch (e) {
      getStudio().notify(e instanceof Error ? e.message : "The proxy couldn't be made.", "danger");
    } finally {
      getStudio().setJob(`proxy:${a.id}`, null);
    }
  };
  const remove = () => {
    setMenu(false);
    st.commit((p) => {
      const ids = Object.values(p.clips)
        .filter((c) => c.mediaId === a.id)
        .map((c) => c.id);
      const next = TL.deleteClips(p, ids, false);
      const media = { ...next.media };
      delete media[a.id];
      return { ...next, media };
    });
    st.setMediaStatus(a.id, null);
  };
  const used = useStudio((s) => Object.values(s.project.clips).some((c) => c.mediaId === a.id));

  return (
    <li className="group relative">
      <div
        draggable={!offline}
        onDragStart={(e) => {
          e.dataTransfer.setData(MEDIA_MIME, a.id);
          e.dataTransfer.effectAllowed = "copy";
        }}
        onDoubleClick={() => !offline && st.appendMedia(a.id)}
        title={`${a.name}\nDrag onto the timeline, or double-click to add it at the end.`}
        className={cn("relative aspect-video cursor-grab overflow-hidden rounded-md border border-line-dark bg-ink active:cursor-grabbing", offline && "cursor-not-allowed opacity-60")}
      >
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumb} alt="" draggable={false} className="size-full object-cover" />
        ) : (
          <span className="flex size-full items-center justify-center text-paper-dim">
            {a.kind === "audio" ? <AudioLines aria-hidden className="size-6" /> : a.kind === "image" ? <ImageIcon aria-hidden className="size-6" /> : <Film aria-hidden className="size-6" />}
          </span>
        )}
        <span className="absolute bottom-1 right-1 rounded-sm bg-ink/80 px-1 font-mono text-[12px] leading-4 text-paper">{a.kind === "image" ? "IMG" : shortTime(a.duration)}</span>
        {res && (
          <span className="absolute left-1 top-1 rounded-sm bg-ink/80 px-1 font-mono text-[12px] leading-4 text-paper">
            {res}
            {a.proxy ? " · P" : ""}
          </span>
        )}
        {used && <span title="On the timeline" className="absolute right-1 top-1 size-2 rounded-full bg-accent" />}
        {offline && (
          <button
            type="button"
            onClick={() => relinkRef.current?.click()}
            title={a.sourcePath ? `Expected: ${a.sourcePath}\nClick to pick the local file` : "Click to relink this offline file"}
            className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-ink/80 p-2 text-center text-[12px] text-paper hover:bg-ink/90"
          >
            <span className="flex items-center gap-1 text-warning">
              <CircleAlert aria-hidden className="size-3.5 shrink-0" />
              Offline
            </span>
            <span className="rounded-sm border border-line-dark px-1.5 py-0.5 text-[12px]">Relink file</span>
          </button>
        )}
        <input
          ref={relinkRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void relinkOfflineMedia([f], a.id).then((r) => st.notify(r.matched ? `Relinked "${a.name}".` : "Couldn't relink that file.", r.matched ? "success" : "warning"));
          }}
        />
        {status?.state === "analyzing" && (
          <span className="absolute inset-x-1 bottom-6 h-1 overflow-hidden rounded-full bg-ink/70">
            <span className="block h-full bg-paper" style={{ width: `${Math.round((status.progress ?? 0) * 100)}%` }} />
          </span>
        )}
        {job && (
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-ink/75 text-[12px] text-paper">
            <LoaderCircle aria-hidden className="size-4 animate-spin" />
            Proxy {Math.round(job.progress * 100)}%
          </span>
        )}
      </div>
      <div className="mt-1 flex items-center gap-0.5 sm:gap-1">
        <span className="min-w-0 flex-1 truncate text-[12px] text-paper-dim" title={a.name}>
          {a.name}
        </span>
        <button type="button" aria-label={`Add ${a.name} to the end of the timeline`} title="Add to the timeline" disabled={offline} onClick={() => st.appendMedia(a.id)} className="inline-flex size-8 shrink-0 items-center justify-center rounded-sm text-paper-dim hover:bg-paper/10 hover:text-paper disabled:opacity-30 sm:size-6">
          <Plus aria-hidden className="size-3.5" />
        </button>
        <button type="button" aria-label={`More for ${a.name}`} aria-expanded={menu} onClick={() => setMenu((m) => !m)} className="inline-flex size-8 shrink-0 items-center justify-center rounded-sm text-paper-dim hover:bg-paper/10 hover:text-paper sm:size-6">
          <Ellipsis aria-hidden className="size-3.5" />
        </button>
      </div>
      {menu && (
        <div className={cn("absolute top-full z-20 mt-1 w-56 max-w-[calc(100vw-24px)] overflow-hidden rounded-md border border-line-dark bg-ink-raised py-1 shadow-float", index % 2 === 0 ? "left-0" : "right-0")} onMouseLeave={() => setMenu(false)}>
          <MenuItem
            disabled={offline}
            onClick={() => {
              setMenu(false);
              st.insertMedia(a.id);
            }}
          >
            Insert at the playhead (push the rest later)
          </MenuItem>
          <MenuItem
            disabled={offline}
            onClick={() => {
              setMenu(false);
              st.addMedia(a.id);
            }}
          >
            Overwrite at the playhead
          </MenuItem>
          <MenuItem
            disabled={offline}
            onClick={() => {
              setMenu(false);
              st.appendMedia(a.id);
            }}
          >
            Add to the end
          </MenuItem>
          {a.hasVideo && a.kind === "video" && a.decodable && <MenuItem onClick={() => void proxy()}>{a.proxy ? "Remake the proxy" : "Make a proxy (smoother 4K)"}</MenuItem>}
          <MenuItem onClick={remove}>Remove from project</MenuItem>
          <p className="px-3 py-1 font-mono text-[12px] text-paper-dim">
            {formatBytes(a.size)}
            {a.width ? ` · ${a.width}×${a.height}` : ""}
            {a.fps ? ` · ${a.fps} fps` : ""}
            {a.codec ? ` · ${a.codec}` : ""}
          </p>
        </div>
      )}
    </li>
  );
}

/** Screen and camera recording straight into the bin (and onto the timeline at the playhead). */
function Recorder() {
  const [rec, setRec] = useState<{ r: Recording; kind: RecordKind } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [toTimeline, setToTimeline] = useState(true);
  const preview = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (!rec) return;
    if (preview.current) {
      preview.current.srcObject = rec.r.stream;
      void preview.current.play().catch(() => undefined);
    }
    const id = setInterval(() => setElapsed((performance.now() - rec.r.startedAt) / 1000), 250);
    return () => clearInterval(id);
  }, [rec]);
  const start = async (kind: RecordKind) => {
    try {
      setElapsed(0);
      setRec({ r: await startRecording(kind), kind });
    } catch (e) {
      getStudio().notify(e instanceof Error ? e.message : "Recording couldn't start.", "danger");
    }
  };
  const stop = async () => {
    if (!rec) return;
    const { r } = rec;
    setRec(null);
    try {
      const file = await r.stop();
      const asset = await addGeneratedFile(file);
      if (toTimeline) getStudio().placeMedia(asset.id);
      getStudio().notify(`${file.name.replace(/\.[^.]+$/, "")} added${toTimeline ? " at the playhead" : " to the media"}.`, "success");
    } catch (e) {
      getStudio().notify(e instanceof Error ? e.message : "The recording couldn't be saved.", "danger");
    }
  };
  if (rec) {
    return (
      <div className="mb-2 rounded-md border border-danger/60 p-2">
        <video ref={preview} muted playsInline className="mb-2 aspect-video w-full rounded-sm bg-black object-contain" />
        <div className="flex items-center gap-2">
          <span className="size-2.5 animate-pulse rounded-full bg-danger" />
          <span className="text-[12px] text-paper">
            Recording {rec.kind === "screen" ? "the screen" : "the camera"} · <span className="font-mono">{shortTime(elapsed)}</span>
          </span>
          <TextButton tone="danger" className="ml-auto h-7 px-2" onClick={() => void stop()}>
            <Square aria-hidden className="size-3" />
            Stop
          </TextButton>
        </div>
      </div>
    );
  }
  const screenOk = recordingSupported("screen");
  const camOk = recordingSupported("camera");
  if (!screenOk && !camOk) return null;
  return (
    <div className="mb-2 rounded-md border border-line-dark p-2">
      <p className="label-mono mb-1.5 text-paper-dim">Record</p>
      <div className={cn("grid gap-1.5", screenOk && camOk ? "grid-cols-2" : "grid-cols-1")}>
        {screenOk && (
          <TextButton onClick={() => void start("screen")}>
            <Monitor aria-hidden className="size-3.5" />
            {camOk ? "Screen" : "Record screen"}
          </TextButton>
        )}
        {camOk && (
          <TextButton onClick={() => void start("camera")}>
            <Camera aria-hidden className="size-3.5" />
            {screenOk ? "Camera" : "Record camera"}
          </TextButton>
        )}
      </div>
      <label className="mt-2 flex items-center gap-2 text-[12px] text-paper-dim">
        <Toggle label="Put recordings on the timeline" checked={toTimeline} onChange={setToTimeline} />
        Add to timeline at playhead
      </label>
    </div>
  );
}

function MediaBin() {
  const media = useStudio((s) => s.project.media);
  const statuses = useStudio((s) => s.media);
  const temps = Object.entries(statuses).filter(([id]) => id.startsWith("tmp"));
  const offlineCount = Object.values(media).filter((m) => statuses[m.id]?.state === "offline").length;
  const useProxies = useStudio((s) => s.useProxies);
  const fileRef = useRef<HTMLInputElement>(null);
  const projRef = useRef<HTMLInputElement>(null);
  const relinkAllRef = useRef<HTMLInputElement>(null);
  const [link, setLink] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null);
  const [filter, setFilter] = useState<"all" | "video" | "audio" | "image">("all");
  const assets = Object.values(media)
    .filter((a) => filter === "all" || a.kind === filter)
    .sort((a, b) => b.addedAt - a.addedAt);
  const st = getStudio();
  const count = Object.keys(media).length;
  useEffect(() => {
    void storageEstimate().then(setUsage);
  }, [count]);

  const handleOpenProject = async (file: File) => {
    try {
      const out = await openExternalProjectFile(file);
      if (out.nativeImported) {
        const r = out.nativeImported;
        st.notify(`Opened "${r.name}"${r.offline ? ` (${r.offline} file${r.offline === 1 ? "" : "s"} to relink)` : ""}.`, "success");
      } else if (out.result) {
        const r = out.result;
        const off = r.offlineAssets.length - (r.embeddedFiles?.length ?? 0);
        st.notify(
          `Opened ${r.sourceLabel}: "${r.project.name}"${off > 0 ? `. Relink ${off} offline media file(s).` : "."}`,
          off > 0 ? "warning" : "success",
        );
      }
    } catch (e) {
      st.notify(e instanceof Error ? e.message : "Couldn't open that project file.", "danger");
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line-dark p-2">
        <TextButton tone="primary" onClick={() => fileRef.current?.click()}>
          <Upload aria-hidden className="size-4" />
          Import
        </TextButton>
        <TextButton onClick={() => projRef.current?.click()} title="Open Premiere (.prproj, .xml), CapCut (.capcut, draft_content.json), After Effects (.aep, .aepx, Lottie), FCPXML, EDL or .dwylvideo">
          <FolderOpen aria-hidden className="size-3.5" />
          Project
        </TextButton>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            if (files.length) void importFiles(files);
          }}
        />
        <input
          ref={projRef}
          type="file"
          accept={PROJECT_ACCEPT}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void handleOpenProject(f);
          }}
        />
        <label className="ml-auto flex items-center gap-1.5 text-[12px] text-paper-dim" title="Play heavy footage from its lighter proxy copy (exports always use the original)">
          <input type="checkbox" checked={useProxies} onChange={(e) => st.set({ useProxies: e.target.checked })} className="accent-[var(--color-accent)]" />
          Proxies
        </label>
      </div>
      <div
        className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain p-2", over && "bg-paper/5")}
        data-lenis-prevent
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) {
            e.preventDefault();
            setOver(true);
          }
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const files = [...e.dataTransfer.files];
          if (!files.length) return;
          if (files.length === 1 && /\.(prproj|fcpxml|xml|edl|capcut|ccproj|aep|aepx|dwylvideo)$/i.test(files[0].name)) {
            void handleOpenProject(files[0]);
            return;
          }
          void importFiles(files);
        }}
      >
        <Recorder />
        {offlineCount > 0 && (
          <div className="mb-2 flex items-center justify-between gap-2 rounded-md border border-warning/50 bg-warning/10 p-2">
            <span className="text-[12px] text-paper">{offlineCount} offline file{offlineCount === 1 ? "" : "s"}</span>
            <TextButton onClick={() => relinkAllRef.current?.click()}>
              <RefreshCw aria-hidden className="size-3.5" />
              Relink files
            </TextButton>
            <input
              ref={relinkAllRef}
              type="file"
              multiple
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => {
                const files = [...(e.target.files ?? [])];
                e.target.value = "";
                if (files.length) void relinkOfflineMedia(files).then((r) => st.notify(`Matched ${r.matched} of ${r.totalOffline} offline file(s).`, r.matched ? "success" : "warning"));
              }}
            />
          </div>
        )}
        {temps.map(([id, s]) => (
          <div key={id} className="mb-2 rounded-md border border-line-dark p-2">
            <p className="truncate text-[12px] text-paper">{s.message}</p>
            <Progress value={s.progress} />
          </div>
        ))}
        {count > 0 && (
          <Segmented
            label="Show"
            value={filter}
            onChange={setFilter}
            className="mb-2"
            options={[
              { value: "all", label: "All" },
              { value: "video", label: "Video" },
              { value: "audio", label: "Sound" },
              { value: "image", label: "Images" },
            ]}
          />
        )}
        {count === 0 && temps.length === 0 ? (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed border-line-dark px-3 py-8 text-center hover:bg-paper/5"
          >
            <Upload aria-hidden className="size-5 text-paper-dim" />
            <span className="text-[13px] text-paper">Drop or choose files</span>
            <span className="font-mono text-[12px] text-paper-dim">MP4 · MOV · WEBM · MKV · AVI · MP3 · WAV · M4A · JPG · PNG</span>
            <span className="text-[12px] leading-relaxed text-paper-dim">Kept on this device (private storage), never uploaded. Other formats (WMV, FLV, MPG, ProRes…) are converted here.</span>
          </button>
        ) : (
          <ul className="grid grid-cols-2 gap-x-2 gap-y-3">
            {assets.map((a, index) => (
              <MediaTile key={a.id} a={a} index={index} />
            ))}
          </ul>
        )}
        <form
          className="mt-3 border-t border-line-dark pt-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!link.trim()) return;
            setLinkError(null);
            importFromUrl(link)
              .then(() => setLink(""))
              .catch((err: unknown) => setLinkError(err instanceof Error ? err.message : "That link didn't work."));
          }}
        >
          <label className="label-mono mb-1 block text-paper-dim" htmlFor="studio-link">
            Free stock by link
          </label>
          <div className="flex gap-1.5">
            <input
              id="studio-link"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              placeholder="https://videos.pexels.com/…mp4"
              className="h-8 min-w-0 flex-1 rounded-sm border border-line-dark bg-ink px-2 text-[12px] text-paper outline-none placeholder:text-paper-dim/60 focus-visible:border-accent"
            />
            <TextButton type="submit" aria-label="Import from link">
              <LinkIcon aria-hidden className="size-3.5" />
            </TextButton>
          </div>
          {linkError && <p className="mt-1 text-[12px] leading-snug text-warning">{linkError}</p>}
          <p className="mt-1 text-[12px] leading-snug text-paper-dim">Pexels, Pixabay, Unsplash, Wikimedia Commons, Internet Archive, Freesound, Mixkit, Coverr.</p>
          {usage && (
            <p className="mt-2 flex items-center gap-2 font-mono text-[12px] text-paper-dim">
              {formatBytes(usage.usage)} used
              <button
                type="button"
                className="ml-auto text-accent hover:underline"
                onClick={() =>
                  void cleanUpStorage().then((n) => {
                    getStudio().notify(n ? `Freed ${n} unused file${n === 1 ? "" : "s"}.` : "Nothing to clean up.", "success");
                    void storageEstimate().then(setUsage);
                  })
                }
              >
                Clean up
              </button>
            </p>
          )}
        </form>
      </div>
    </div>
  );
}

/* ---------- Text, shapes, stickers, colour ---------- */

function TextPanel() {
  const st = getStudio();
  const [color, setColor] = useState("#15140f");
  const [gradient, setGradient] = useState(false);
  const [color2, setColor2] = useState("#eb4a10");
  const [angle, setAngle] = useState(135);
  return (
    <div className="h-full overflow-y-auto overscroll-contain p-2" data-lenis-prevent>
      <p className="label-mono mb-2 px-1 text-paper-dim">Titles · click to add at the playhead</p>
      <ul className="grid grid-cols-2 gap-2">
        {TEXT_PRESETS.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => st.addText(p.id)}
              className="flex h-20 w-full flex-col items-center justify-center gap-1 overflow-hidden rounded-md border border-line-dark bg-ink px-2 text-center hover:border-paper/40 hover:bg-paper/5"
            >
              <span
                className="max-w-full truncate leading-tight"
                style={{
                  fontWeight: p.style.weight ?? 700,
                  fontStyle: p.style.italic ? "italic" : "normal",
                  textTransform: p.style.uppercase ? "uppercase" : "none",
                  color: p.style.color ?? "#ffffff",
                  fontSize: 15,
                  fontFamily: p.style.font === "Roboto Mono" ? "var(--font-mono)" : p.style.font?.includes("Playfair") || p.style.font?.includes("Serif") ? "var(--font-serif)" : "var(--font-sans)",
                  textShadow: p.style.shadowColor && p.style.shadowBlur ? `0 0 ${Math.min(10, p.style.shadowBlur / 3)}px ${p.style.shadowColor}` : undefined,
                  WebkitTextStroke: p.style.strokeWidth ? "0.6px #000" : undefined,
                  background: p.style.boxOpacity ? (p.style.boxColor ?? "#000000") : undefined,
                  padding: p.style.boxOpacity ? "1px 4px" : undefined,
                  borderRadius: p.style.boxRadius ? Math.min(10, p.style.boxRadius / 4) : undefined,
                }}
              >
                {p.text.split("\n")[0]}
              </span>
              <span className="text-[12px] text-paper-dim">{p.label}</span>
            </button>
          </li>
        ))}
      </ul>

      <p className="label-mono mb-2 mt-4 flex items-center gap-1.5 px-1 text-paper-dim">
        <Shapes aria-hidden className="size-3.5" />
        Shapes
      </p>
      <ul className="grid grid-cols-4 gap-1.5">
        {SHAPE_PRESETS.map((s) => (
          <li key={s.id}>
            <button type="button" onClick={() => st.addShape(s.id)} title={s.label} className="flex h-14 w-full flex-col items-center justify-center gap-1 rounded-md border border-line-dark text-paper-dim hover:border-paper/40 hover:text-paper">
              {createElement(SHAPE_ICON[s.shape.type], { "aria-hidden": true, className: cn("size-5", (s.shape.fillOpacity ?? 1) === 0 ? "" : "fill-paper/20") })}
              <span className="max-w-full truncate px-1 text-[12px]">{s.label}</span>
            </button>
          </li>
        ))}
      </ul>

      <p className="label-mono mb-2 mt-4 flex items-center gap-1.5 px-1 text-paper-dim">
        <Smile aria-hidden className="size-3.5" />
        Stickers
      </p>
      <ul className="grid grid-cols-6 gap-1">
        {STICKERS.map((e) => (
          <li key={e}>
            <button type="button" onClick={() => st.addSticker(e)} title={`Add ${e}`} className="flex aspect-square w-full items-center justify-center rounded-md border border-line-dark text-[20px] hover:border-paper/40 hover:bg-paper/5">
              {e}
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-4 rounded-md border border-line-dark p-2">
        <p className="label-mono mb-1 flex items-center gap-1.5 text-paper-dim">
          <Layers aria-hidden className="size-3.5" />
          Adjustment layer
        </p>
        <p className="mb-2 text-[12px] leading-snug text-paper-dim">Apply colour grades, curves, LUTs, glow or optical VFX across all tracks underneath.</p>
        <TextButton className="w-full" onClick={() => st.addAdjustmentLayer()}>
          <Plus aria-hidden className="size-3.5" />
          Add Adjustment layer at playhead
        </TextButton>
      </div>

      <p className="label-mono mb-2 mt-4 px-1 text-paper-dim">Colour or gradient clip</p>
      <div className="space-y-1.5 px-1">
        <div className="flex items-center gap-2">
          <ColorField label="Colour clip" value={color} onChange={setColor} />
        </div>
        <label className="flex items-center gap-2 text-[12px] text-paper-dim">
          <Toggle label="Gradient" checked={gradient} onChange={setGradient} />
          Gradient
        </label>
        {gradient && (
          <>
            <ColorField label="Second colour" value={color2} onChange={setColor2} />
            <div className="flex items-center gap-2">
              <span className="w-12 text-[12px] text-paper-dim">Angle</span>
              <Slider label="Gradient angle" value={angle} min={0} max={360} step={5} onChange={setAngle} />
              <span className="w-10 text-right font-mono text-[12px] text-paper-dim">{angle}°</span>
            </div>
          </>
        )}
        <div className="flex items-center gap-2">
          <span aria-hidden className="h-8 flex-1 rounded-sm border border-line-dark" style={{ background: gradient ? `linear-gradient(${angle}deg, ${color}, ${color2})` : color }} />
          <TextButton onClick={() => st.addSolid(color, gradient ? { color: color2, angle } : undefined)}>
            <Plus aria-hidden className="size-3.5" />
            Add
          </TextButton>
        </div>
      </div>
      <p className="mt-4 px-1 text-[12px] leading-relaxed text-paper-dim">Captions from speech are in the AI tab. Every title, shape and sticker can be animated with keyframes in the Animate tab.</p>
    </div>
  );
}

/* ---------- Transitions ---------- */

function TransitionTile({ type, onPick, active }: { type: TransitionType; onPick: (t: TransitionType) => void; active: boolean }) {
  return (
    <button
      type="button"
      onClick={() => onPick(type)}
      title={`${TRANSITIONS[type].label}: ${TRANSITIONS[type].hint}`}
      aria-pressed={active}
      className={cn("group flex w-full min-w-0 items-center gap-2.5 rounded-md border px-2 py-1.5 text-left", active ? "border-paper/60 bg-paper/10" : "border-line-dark hover:border-paper/40 hover:bg-paper/5")}
    >
      <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full transition-colors", active ? "bg-accent text-paper" : "bg-paper/10 text-paper group-hover:bg-paper group-hover:text-ink")}>
        {createElement(TRANSITION_ICON[type], { "aria-hidden": true, className: "size-4" })}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-medium leading-tight text-paper">{TRANSITIONS[type].label}</span>
        <span className="mt-0.5 block truncate text-[12px] leading-snug text-paper-dim">{TRANSITIONS[type].hint}</span>
      </span>
    </button>
  );
}

export function TransitionsPanel() {
  const c = usePrimaryClip();
  const [last, setLast] = useState<TransitionType>("crossDissolve");
  const st = getStudio();
  const pick = (type: TransitionType) => {
    setLast(type);
    if (!c || c.kind === "audio") {
      st.notify("Select the clip the transition leads into, or use “On every cut”.", "info");
      return;
    }
    st.setTransition(c.id, { type, duration: c.transitionIn?.duration ?? DEFAULT_TRANSITION_DURATION, direction: c.transitionIn?.direction ?? "left" });
    st.notify(`${TRANSITIONS[type].label} into “${c.name}”.`, "success");
  };
  return (
    <div className="h-full overflow-y-auto overscroll-contain p-2" data-lenis-prevent>
      <p className="mb-2 px-1 text-[12px] leading-relaxed text-paper-dim">Pick a clip, then a transition: it plays across the cut into that clip. Fine-tune it in the inspector.</p>
      <ul className="grid grid-cols-1 gap-1.5">
        {(Object.keys(TRANSITIONS) as TransitionType[]).map((t) => (
          <li key={t} className="min-w-0">
            <TransitionTile type={t} onPick={pick} active={c?.transitionIn?.type === t} />
          </li>
        ))}
      </ul>
      <TextButton
        className="mt-3 w-full"
        onClick={() => {
          const n = st.transitionAllCuts(last);
          st.notify(n ? `${TRANSITIONS[last].label} added to ${n} cut${n === 1 ? "" : "s"}.` : "There are no back-to-back clips to join yet.", n ? "success" : "info");
        }}
      >
        <Sparkles aria-hidden className="size-3.5" />
        {TRANSITIONS[last].label} on every cut
      </TextButton>
    </div>
  );
}

/* ---------- Tabs ---------- */

export const LEFT_TABS: { id: LeftTab; label: string; icon: LucideIcon }[] = [
  { id: "media", label: "Media", icon: Film },
  { id: "text", label: "Text", icon: Type },
  { id: "effects", label: "Effects", icon: Wand2 },
  { id: "transitions", label: "Transitions", icon: Blend },
  { id: "audio", label: "Audio", icon: Music4 },
  { id: "ai", label: "AI", icon: Sparkles },
];

export function LeftPanelBody({ tab }: { tab: LeftTab }) {
  if (tab === "media") return <MediaBin />;
  if (tab === "text") return <TextPanel />;
  if (tab === "effects") return <EffectsPanel />;
  if (tab === "transitions") return <TransitionsPanel />;
  if (tab === "audio") return <AudioPanel />;
  return <AIPanel />;
}

export function LeftPanel() {
  const tab = useStudio((s) => s.leftTab);
  const st = getStudio();
  return (
    <div className="flex h-full min-h-0 flex-col bg-ink-raised">
      <div role="tablist" aria-label="Library" className="grid shrink-0 grid-cols-3 gap-1 border-b border-line-dark p-1.5">
        {LEFT_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => st.set({ leftTab: t.id })}
            className={cn("inline-flex h-8 min-w-0 items-center justify-center gap-1 rounded-sm px-1 text-[12px] transition-colors", tab === t.id ? "bg-paper text-ink" : "text-paper-dim hover:bg-paper/10 hover:text-paper")}
          >
            <t.icon aria-hidden className="size-3.5 shrink-0" />
            <span className="truncate">{t.label}</span>
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        <LeftPanelBody tab={tab} />
      </div>
    </div>
  );
}
