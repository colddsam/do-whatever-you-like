"use client";

import { useMemo, useRef, useState } from "react";
import { Play, Plus, Upload, Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { SFX } from "@/features/video-studio/engine/sfx";
import { addLoop, addSfx, addVoice, importFiles, placeAudio } from "../actions";
import { GENRES, SINGER_VOICES as VOICES } from "../constants";
import { matchSfx } from "../engine/ai";
import { loadBuffer } from "../engine/assets";
import { KITS } from "../engine/drums";
import { INSTRUMENTS } from "../engine/instruments";
import { transport } from "../engine/transport";
import { getStudio, useStudio } from "../store";
import type { LoopKind } from "../engine/composer";
import { Empty, Field, inputCls, JobLine, Segmented, Select, Slider, TextButton } from "./controls";

type Tab = "instruments" | "loops" | "sfx" | "voice" | "files";

export function SoundsPanel() {
  const [tab, setTab] = useState<Tab>("instruments");
  return (
    <div className="space-y-3 p-3">
      <div className="flex flex-wrap gap-1">
        {(
          [
            ["instruments", "Instruments"],
            ["loops", "Loops"],
            ["sfx", "Effects"],
            ["voice", "Voice"],
            ["files", "Files"],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button key={id} type="button" aria-pressed={tab === id} onClick={() => setTab(id)} className={cn("h-8 rounded-sm px-2.5 text-[12px] transition-colors sm:h-7", tab === id ? "bg-paper text-ink" : "border border-line-dark text-paper-dim hover:text-paper")}>
            {label}
          </button>
        ))}
      </div>
      {tab === "instruments" && <Instruments />}
      {tab === "loops" && <Loops />}
      {tab === "sfx" && <Effects />}
      {tab === "voice" && <VoicePanel />}
      {tab === "files" && <Files />}
    </div>
  );
}

function Instruments() {
  const selected = useStudio((s) => s.project.tracks.find((t) => t.id === s.selectedTrack));
  const groups = useMemo(() => {
    const m = new Map<string, typeof INSTRUMENTS>();
    for (const i of INSTRUMENTS) m.set(i.group, [...(m.get(i.group) ?? []), i]);
    return [...m.entries()];
  }, []);
  const use = (id: string, drums: boolean) => {
    const st = getStudio();
    const t = st.project.tracks.find((x) => x.id === st.selectedTrack);
    if (t && t.kind !== "audio" && (t.kind === "drums") === drums) {
      st.updateTrack(t.id, { instrument: id });
      st.notify(`${t.name} now plays ${drums ? KITS.find((k) => k.id === id)?.label : INSTRUMENTS.find((i) => i.id === id)?.label}.`, "success");
    } else {
      const label = drums ? `${KITS.find((k) => k.id === id)?.label} drums` : INSTRUMENTS.find((i) => i.id === id)?.label;
      st.addTrack(drums ? "drums" : "instrument", { name: label ?? "Instrument", instrument: id });
    }
    // Ready to play straight away on the keys (or pads), and to record from there.
    getStudio().set({ bottomTab: "keys" });
    if (window.innerWidth >= 768) getStudio().notify("Play it on the keys below (or turn on musical typing). Double-click its lane to write notes.", "info");
  };
  const canSwap = selected && selected.kind !== "audio";
  return (
    <div className="space-y-3">
      <p className="text-[12px] text-paper-dim">{canSwap ? `Tap ▶ to hear, + to put it on “${selected!.name}” (or a new track if it's a different kind).` : "Tap ▶ to hear, + to add a track that plays it."}</p>
      {groups.map(([group, list]) => (
        <div key={group}>
          <p className="label-mono mb-1 text-paper-dim">{group}</p>
          <div className="divide-y divide-line-dark rounded-sm border border-line-dark">
            {list.map((i) => (
              <SoundRow key={i.id} label={i.label} active={selected?.instrument === i.id} onPreview={() => void transport.preview(i.id, i.role.includes("bass") ? 36 : 60, 0.9)} onAdd={() => use(i.id, false)} />
            ))}
          </div>
        </div>
      ))}
      <div>
        <p className="label-mono mb-1 text-paper-dim">Drum kits</p>
        <div className="divide-y divide-line-dark rounded-sm border border-line-dark">
          {KITS.map((k) => (
            <SoundRow
              key={k.id}
              label={k.label}
              hint={k.hint}
              active={selected?.instrument === k.id}
              onPreview={() => {
                void transport.preview(k.id, 36);
                setTimeout(() => void transport.preview(k.id, 42), 220);
                setTimeout(() => void transport.preview(k.id, 38), 440);
              }}
              onAdd={() => use(k.id, true)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function SoundRow({ label, hint, active, onPreview, onAdd }: { label: string; hint?: string; active?: boolean; onPreview: () => void; onAdd: () => void }) {
  return (
    <div className="flex items-center gap-1.5 px-2 py-1">
      <button type="button" aria-label={`Hear ${label}`} onClick={onPreview} className="inline-flex size-8 shrink-0 items-center justify-center rounded-sm text-paper-dim hover:bg-paper/10 hover:text-paper sm:size-7">
        <Play aria-hidden className="size-3.5" />
      </button>
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-[13px]", active ? "text-accent" : "text-paper")}>{label}</span>
        {hint && <span className="block truncate text-[12px] text-paper-dim">{hint}</span>}
      </span>
      <button type="button" aria-label={`Add ${label}`} onClick={onAdd} className="inline-flex size-8 shrink-0 items-center justify-center rounded-sm text-paper-dim hover:bg-paper/10 hover:text-paper sm:size-7">
        <Plus aria-hidden className="size-4" />
      </button>
    </div>
  );
}

const LOOP_KINDS: { id: LoopKind; label: string }[] = [
  { id: "drums", label: "Drum groove" },
  { id: "bass", label: "Bass line" },
  { id: "chords", label: "Chords" },
  { id: "melody", label: "Melody" },
  { id: "arp", label: "Arpeggio" },
];

function Loops() {
  const [genre, setGenre] = useState("pop");
  const key = useStudio((s) => s.project.keyRoot);
  return (
    <div className="space-y-3">
      <p className="text-[12px] leading-relaxed text-paper-dim">Fresh loops every tap, written in your song&apos;s key and tempo. They land at the playhead as editable notes.</p>
      <Field label="Style">
        <Select label="Loop style" value={genre} onChange={setGenre} options={GENRES.map((g) => ({ value: g.id, label: g.label }))} className="w-full" />
      </Field>
      <div className="grid grid-cols-2 gap-1.5">
        {LOOP_KINDS.map((k) => (
          <button key={k.id} type="button" onClick={() => addLoop(k.id, genre)} className="flex h-12 items-center gap-2 rounded-sm border border-line-dark px-2.5 text-left text-[13px] text-paper hover:bg-paper/10">
            <Plus aria-hidden className="size-4 shrink-0 text-paper-dim" />
            {k.label}
          </button>
        ))}
      </div>
      <p className="text-[12px] text-paper-dim">Key: {["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"][key]}. Change it in the top bar and new loops follow.</p>
    </div>
  );
}

function Effects() {
  const [q, setQ] = useState("");
  const matches = q.trim() ? matchSfx(q) : [];
  const list = q.trim() ? SFX.filter((s) => matches.includes(s.id)).sort((a, b) => matches.indexOf(a.id) - matches.indexOf(b.id)) : SFX;
  const hear = async (id: (typeof SFX)[number]["id"]) => {
    const { renderSfx } = await import("@/features/video-studio/engine/sfx");
    const f = await renderSfx(id);
    const ctx = new OfflineAudioContext(2, 1, 48000);
    await transport.previewBuffer(await ctx.decodeAudioData(await f.arrayBuffer()));
  };
  return (
    <div className="space-y-3">
      <Field label="Describe a sound effect">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="whoosh, laser, coin, explosion…" className={inputCls} onKeyDown={(e) => e.stopPropagation()} />
      </Field>
      {q.trim() && !list.length && <p className="text-[12px] text-paper-dim">No close match. For anything musical, try Create → AI audio.</p>}
      <div className="divide-y divide-line-dark rounded-sm border border-line-dark">
        {list.map((s) => (
          <SoundRow key={s.id} label={s.label} hint={s.hint} onPreview={() => void hear(s.id)} onAdd={() => void addSfx(s.id, s.label)} />
        ))}
      </div>
      <JobLine id="sfx" />
    </div>
  );
}

function VoicePanel() {
  const [text, setText] = useState("");
  const [voice, setVoice] = useState(VOICES[0].id);
  const [rate, setRate] = useState(0);
  const busy = useStudio((s) => Boolean(s.jobs.tts));
  return (
    <div className="space-y-3">
      <p className="text-[12px] leading-relaxed text-paper-dim">Text to speech for intros, ads, narration and audio stories: {VOICES.length} natural voices in {new Set(VOICES.map((v) => v.lang)).size} languages. The clip lands on a “Voice-over” track at the playhead.</p>
      <Field label="Text">
        <textarea value={text} onChange={(e) => setText(e.target.value.slice(0, 2400))} rows={5} placeholder="Welcome back to the show…" className={cn(inputCls, "resize-y")} onKeyDown={(e) => e.stopPropagation()} />
      </Field>
      <Field label="Voice">
        <Select label="Voice" value={voice} onChange={setVoice} options={VOICES.map((v) => ({ value: v.id, label: `${v.lang} · ${v.label}` }))} className="w-full" />
      </Field>
      <Field label={`Speed · ${rate > 0 ? "+" : ""}${rate}%`}>
        <Slider label="Speaking speed" value={rate} min={-40} max={60} step={5} onChange={setRate} />
      </Field>
      <TextButton tone="primary" className="w-full" disabled={busy || !text.trim()} onClick={() => void addVoice(text, voice, rate)}>
        <Volume2 aria-hidden className="size-4" />
        Speak it
      </TextButton>
      <JobLine id="tts" />
    </div>
  );
}

function Files() {
  const assets = useStudio((s) => s.project.assets);
  const clips = useStudio((s) => s.project.clips);
  const used = useMemo(() => new Set(Object.values(clips).map((c) => c.assetId)), [clips]);
  const input = useRef<HTMLInputElement>(null);
  const list = Object.values(assets).sort((a, b) => b.createdAt - a.createdAt);
  const [view, setView] = useState<"all" | "unused">("all");
  const shown = view === "unused" ? list.filter((a) => !used.has(a.id)) : list;
  return (
    <div className="space-y-3">
      <TextButton className="w-full" onClick={() => input.current?.click()}>
        <Upload aria-hidden className="size-4" />
        Import audio, video or MIDI
      </TextButton>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        accept="audio/*,video/*,.mid,.midi,.dwylsong"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (files.length) void importFiles(files);
        }}
      />
      <JobLine id="import" />
      <Segmented
        label="Show"
        value={view}
        onChange={setView}
        options={[
          { value: "all", label: `All (${list.length})` },
          { value: "unused", label: "Not in the song" },
        ]}
      />
      {!shown.length ? (
        <Empty>Recordings, imports and AI audio appear here. Everything stays on this device.</Empty>
      ) : (
        <div className="divide-y divide-line-dark rounded-sm border border-line-dark">
          {shown.map((a) => (
            <SoundRow
              key={a.id}
              label={a.name}
              hint={`${a.duration.toFixed(1)} s · ${a.channels === 1 ? "mono" : "stereo"}${used.has(a.id) ? "" : " · not used"}`}
              onPreview={async () => transport.previewBuffer(await loadBuffer(a.id))}
              onAdd={() => {
                const st = getStudio();
                const t = st.project.tracks.find((x) => x.id === st.selectedTrack && x.kind === "audio")?.id ?? st.addTrack("audio", { name: a.name });
                placeAudio(a, t, st.playhead);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
