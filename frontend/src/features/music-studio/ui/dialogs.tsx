"use client";

import { useEffect, useRef, useState } from "react";
import { Download, FileMusic, Trash2, Upload, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { exportSong, importFiles, midiFile, type ExportOptions } from "../actions";
import { download, FORMATS, safeName, type ExportFormat } from "../engine/encode";
import { deleteProject, exportPackage, listProjects, loadProjectById, openProject, saveProject, type ProjectSummary } from "../engine/persistence";
import { transport } from "../engine/transport";
import { fromTemplate, TEMPLATES } from "../lib/templates";
import { getStudio, runJob, useStudio } from "../store";
import { IconButton, JobLine, Segmented, Select, TextButton, Toggle } from "./controls";

function Dialog({ title, onClose, children, wide }: { title: React.ReactNode; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <div className="absolute inset-0 z-[70] flex items-end justify-center bg-ink/80 p-0 backdrop-blur-sm sm:items-center sm:p-3" onPointerDown={onClose}>
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
        className={cn("max-h-[92%] w-full overflow-y-auto rounded-t-lg border border-line-dark bg-ink-raised p-4 shadow-float outline-none sm:rounded-lg", wide ? "max-w-3xl" : "max-w-md")}
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        data-lenis-prevent
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-[15px] font-semibold text-paper">{title}</h2>
          <IconButton label="Close" onClick={onClose}>
            <X aria-hidden className="size-4" />
          </IconButton>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const loopOn = useStudio((s) => s.project.loop.on);
  const lufs = useStudio((s) => s.project.master.lufs ?? null);
  const busy = useStudio((s) => Boolean(s.jobs.export));
  const [o, setO] = useState<ExportOptions>({ format: "mp3", kbps: 256, range: "song", normalize: lufs !== null, stems: false, midi: false });
  const fmt = FORMATS.find((f) => f.id === o.format)!;
  const set = (p: Partial<ExportOptions>) => setO((x) => ({ ...x, ...p }));
  return (
    <Dialog
      title={
        <>
          Export your <span className="serif-em">song</span>
        </>
      }
      onClose={onClose}
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1">
            <span className="label-mono block text-paper-dim">Format</span>
            <Select<ExportFormat> label="Format" value={o.format} onChange={(v) => set({ format: v })} options={FORMATS.map((f) => ({ value: f.id, label: f.label }))} className="w-full" />
          </label>
          <label className="space-y-1">
            <span className="label-mono block text-paper-dim">Quality</span>
            <Select
              label="Bitrate"
              value={String(o.kbps)}
              onChange={(v) => set({ kbps: Number(v) })}
              options={fmt.lossy ? [128, 192, 256, 320].map((k) => ({ value: String(k), label: `${k} kbps` })) : [{ value: String(o.kbps), label: "Lossless" }]}
              className="w-full"
            />
          </label>
        </div>
        <Segmented
          label="Range"
          value={o.range}
          onChange={(v) => set({ range: v })}
          options={[
            { value: "song", label: "Whole song" },
            { value: "loop", label: loopOn ? "Loop region" : "Loop (off)" },
          ]}
        />
        <Opt label={`Set loudness to ${lufs ?? -14} LUFS`} hint="Streaming-ready level with a safe −1 dB ceiling">
          <Toggle label="Normalise loudness" checked={o.normalize} onChange={(v) => set({ normalize: v })} />
        </Opt>
        <Opt label="Stems (one file per track, zipped)" hint="For mixing elsewhere, or sharing with collaborators">
          <Toggle label="Stems" checked={o.stems} onChange={(v) => set({ stems: v })} />
        </Opt>
        <Opt label="Also a MIDI file" hint="Every note, for any DAW or notation app">
          <Toggle label="MIDI" checked={o.midi} onChange={(v) => set({ midi: v })} />
        </Opt>
        <TextButton
          tone="primary"
          className="h-10 w-full sm:h-9"
          disabled={busy}
          onClick={async () => {
            const ok = await exportSong(o);
            if (ok) onClose();
          }}
        >
          <Download aria-hidden className="size-4" />
          Export {o.stems ? "stems" : fmt.ext.toUpperCase()}
        </TextButton>
        <JobLine id="export" />
        <p className="text-[12px] text-paper-dim">Rendered on your device, faster than real time. No watermark, no limits; it&apos;s yours to use anywhere.</p>
      </div>
    </Dialog>
  );
}

function Opt({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span>
        <span className="block text-[13px] text-paper">{label}</span>
        <span className="block text-[12px] text-paper-dim">{hint}</span>
      </span>
      {children}
    </div>
  );
}

export function ProjectsDialog({ onClose }: { onClose: () => void }) {
  const [list, setList] = useState<ProjectSummary[] | null>(null);
  const current = useStudio((s) => s.project.id);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let alive = true;
    void listProjects().then((l) => alive && setList(l));
    return () => {
      alive = false;
    };
  }, []);

  const open = async (id: string) => {
    await transport.stop(true);
    await saveProject(getStudio().project);
    const p = await loadProjectById(id);
    if (p) await openProject(p);
    onClose();
  };
  const start = async (id: (typeof TEMPLATES)[number]["id"]) => {
    await transport.stop(true);
    await saveProject(getStudio().project);
    const p = fromTemplate(id);
    await saveProject(p);
    await openProject(p);
    onClose();
  };

  return (
    <Dialog
      wide
      title={
        <>
          Your <span className="serif-em">projects</span>
        </>
      }
      onClose={onClose}
    >
      <p className="label-mono mb-2 text-paper-dim">Start something new</p>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        {TEMPLATES.map((t) => (
          <button key={t.id} type="button" onClick={() => void start(t.id)} className="rounded-md border border-line-dark p-2.5 text-left hover:border-paper-dim hover:bg-paper/5">
            <span className="block text-[13px] font-medium text-paper">{t.label}</span>
            <span className="block text-[12px] text-paper-dim">{t.hint}</span>
          </button>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-1.5">
        <TextButton onClick={() => input.current?.click()}>
          <Upload aria-hidden className="size-3.5" />
          Open a .dwylsong, MIDI or audio file
        </TextButton>
        <TextButton
          onClick={() =>
            void runJob("package", "Packing the project", async () => {
              const p = getStudio().project;
              download(await exportPackage(p), `${safeName(p.name)}.dwylsong`);
            })
          }
        >
          <Download aria-hidden className="size-3.5" />
          Save a copy to share (.dwylsong)
        </TextButton>
        <TextButton onClick={() => download(midiFile(), `${safeName(getStudio().project.name)}.mid`)}>
          <FileMusic aria-hidden className="size-3.5" />
          Export MIDI
        </TextButton>
        <input
          ref={input}
          type="file"
          hidden
          accept=".dwylsong,.zip,.mid,.midi,audio/*,video/*"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            if (files.length) void importFiles(files).then(onClose);
          }}
        />
      </div>
      <JobLine id="package" />
      <p className="label-mono mb-2 mt-4 text-paper-dim">Saved in this browser</p>
      {list === null ? (
        <p className="text-[12px] text-paper-dim">Loading…</p>
      ) : !list.length ? (
        <p className="text-[12px] text-paper-dim">Nothing yet. Projects save here automatically as you work.</p>
      ) : (
        <div className="divide-y divide-line-dark rounded-sm border border-line-dark">
          {list.map((p) => (
            <div key={p.id} className="flex items-center gap-2 px-2 py-1.5">
              <button type="button" onClick={() => void open(p.id)} disabled={p.id === current} className="min-w-0 flex-1 text-left disabled:cursor-default">
                <span className={cn("block truncate text-[13px]", p.id === current ? "text-accent" : "text-paper")}>
                  {p.name}
                  {p.id === current ? " (open)" : ""}
                </span>
                <span className="block text-[12px] text-paper-dim">
                  {p.tracks} tracks · {p.bpm} BPM · {new Date(p.updatedAt).toLocaleString()}
                </span>
              </button>
              {p.id !== current && (
                <IconButton
                  label={`Delete ${p.name}`}
                  onClick={async () => {
                    await deleteProject(p.id);
                    setList(await listProjects());
                  }}
                >
                  <Trash2 aria-hidden className="size-3.5" />
                </IconButton>
              )}
            </div>
          ))}
        </div>
      )}
      <p className="mt-3 text-[12px] text-paper-dim">Projects and recordings stay in this browser on this device. Use “Save a copy to share” to move a project to another device or send it to a collaborator.</p>
    </Dialog>
  );
}

const SHORTCUTS: [string, [string, string][]][] = [
  [
    "Transport",
    [
      ["Space", "Play / pause"],
      ["R", "Record"],
      ["L", "Loop on / off"],
      ["M", "Metronome"],
      ["Home", "To the start"],
      ["← →", "Back / forward a beat"],
    ],
  ],
  [
    "Editing",
    [
      ["S", "Split at the playhead"],
      ["Ctrl D", "Duplicate"],
      ["Delete", "Delete selection"],
      ["Ctrl Z · Ctrl Shift Z", "Undo · redo"],
      ["Ctrl A", "Select all clips"],
      ["Double-click", "Open clip editor / new clip"],
    ],
  ],
  [
    "View & play",
    [
      ["+ −", "Zoom"],
      ["Ctrl + wheel", "Zoom at the pointer"],
      ["F", "Full screen"],
      ["K", "Musical typing on / off"],
      ["A … ;", "Play notes (typing on)"],
      ["Z X · C V", "Octave · velocity (typing on)"],
    ],
  ],
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog
      wide
      title={
        <>
          Keyboard <span className="serif-em">shortcuts</span>
        </>
      }
      onClose={onClose}
    >
      <div className="grid gap-5 sm:grid-cols-3">
        {SHORTCUTS.map(([group, list]) => (
          <div key={group}>
            <p className="label-mono mb-2 text-paper-dim">{group}</p>
            <dl className="space-y-1.5">
              {list.map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-3">
                  <dt className="shrink-0 rounded-sm border border-line-dark px-1.5 font-mono text-[12px] text-paper">{k}</dt>
                  <dd className="text-right text-[12px] text-paper-dim">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
