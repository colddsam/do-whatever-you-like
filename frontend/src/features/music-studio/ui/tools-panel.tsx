"use client";

import { useCallback, useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Circle, Gauge, Mic, Music2, Scissors, Sparkles, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { applyEdit, applyMasterPreset, autoDuckAll, humToMidi, renderMix, splitStems } from "../actions";
import { MASTER_PRESETS } from "../constants";
import { localPlan, realize } from "../engine/composer";
import { loudness, peak, yin } from "../engine/dsp";
import * as E from "../engine/edit";
import { transport } from "../engine/transport";
import * as P from "../lib/project";
import { noteName } from "../lib/theory";
import { getStudio, runJob, useStudio } from "../store";
import { Field, JobLine, Meter, Note, Section, TextButton, Toggle } from "./controls";

export function ToolsPanel() {
  return (
    <div>
      <RecordSection />
      <ClipTools />
      <PodcastSection />
      <MasterSection />
      <TunerSection />
    </div>
  );
}

function RecordSection() {
  const { recording, countIn, metronome } = useStudio(useShallow((s) => ({ recording: s.recording, countIn: s.countIn, metronome: s.metronome })));
  const armed = useStudio(useShallow((s) => s.project.tracks.filter((t) => t.armed).map((t) => t.name)));
  const [monitor, setMonitor] = useState(false);
  const read = useCallback(() => getStudio().inputLevel, []);
  useEffect(() => () => void transport.setMonitor(false), []);
  const st = getStudio();
  return (
    <Section title="Record">
      <div className="space-y-2.5">
        <p className="text-[12px] leading-relaxed text-paper-dim">
          {armed.length ? (
            <>
              Recording onto <span className="text-paper">{armed.join(", ")}</span>. Audio tracks take the microphone; instrument tracks take notes from the keys or a MIDI keyboard.
            </>
          ) : (
            "Nothing armed (R on a track): the microphone goes onto a new audio track."
          )}
        </p>
        <TextButton tone={recording ? "danger" : "primary"} className="w-full" onClick={() => void transport.record().catch((e) => st.notify(e instanceof Error ? e.message : "Recording failed.", "danger"))}>
          <Circle aria-hidden className={cn("size-3.5", recording ? "fill-danger text-danger" : "fill-accent text-accent")} />
          {recording ? "Stop recording" : "Record (R)"}
        </TextButton>
        <Meter read={read} className="h-2" />
        <Row2 label="Count-in (one bar)">
          <Toggle label="Count-in" checked={countIn} onChange={(v) => st.set({ countIn: v })} />
        </Row2>
        <Row2 label="Metronome while playing">
          <Toggle label="Metronome" checked={metronome} onChange={(v) => st.set({ metronome: v })} />
        </Row2>
        <Row2 label="Hear yourself (use headphones)">
          <Toggle
            label="Input monitoring"
            checked={monitor}
            onChange={(v) => {
              setMonitor(v);
              void transport.setMonitor(v).catch(() => {
                setMonitor(false);
                st.notify("Allow the microphone to monitor it.", "warning");
              });
            }}
          />
        </Row2>
      </div>
    </Section>
  );
}

function Row2({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[12px] text-paper-dim">{label}</span>
      {children}
    </div>
  );
}

function ClipTools() {
  const clip = useStudio((s) => {
    const id = s.selectedClips[0];
    return id ? s.project.clips[id] : undefined;
  });
  const audio = clip?.assetId ? clip : null;
  const busy = useStudio((s) => Object.keys(s.jobs).length > 0);
  return (
    <Section title="Audio clip">
      {!audio ? (
        <p className="text-[12px] text-paper-dim">Select an audio clip (a recording or import) for clean-up, tuning, stems and more.</p>
      ) : (
        <div className="space-y-2">
          <p className="truncate text-[12px] text-paper">{audio.name}</p>
          <div className="grid grid-cols-2 gap-1">
            {[
              { label: "Open editor", icon: Scissors, run: () => getStudio().openEditor(audio.id) },
              { label: "Reduce noise", icon: Wand2, run: () => void applyEdit(audio.id, "Reducing noise", (p, s) => E.denoise(p, s, null)) },
              { label: "Normalise", icon: Gauge, run: () => void applyEdit(audio.id, "Normalising", (p, s) => E.normalize(p, s, -1)) },
              { label: "Auto-tune", icon: Music2, run: () => void applyEdit(audio.id, "Tuning", (p, s) => E.tune(p, s, getStudio().project, 1, 18)) },
              { label: "Split stems", icon: Sparkles, run: () => void splitStems(audio.id) },
              { label: "Hum → MIDI", icon: Mic, run: () => void humToMidi(audio.id, { snap: true, instrument: "piano" }) },
            ].map((b) => (
              <TextButton key={b.label} disabled={busy} onClick={b.run} className="justify-start">
                <b.icon aria-hidden className="size-3.5 text-paper-dim" />
                {b.label}
              </TextButton>
            ))}
          </div>
          <JobLine id="edit" />
          <JobLine id="stems" />
          <JobLine id="hum" />
        </div>
      )}
    </Section>
  );
}

function PodcastSection() {
  const busy = useStudio((s) => Boolean(s.jobs.clean || s.jobs.bed));
  const cleanVoices = async () => {
    const p = getStudio().project;
    const voiceTracks = p.tracks.filter((t) => t.kind === "audio" && (/host|voice|narrat|guest|vocal|speech|record|take/i.test(t.name) || t.armed));
    const clips = Object.values(p.clips).filter((c) => c.assetId && voiceTracks.some((t) => t.id === c.trackId));
    if (!clips.length) return getStudio().notify("Record or import speech onto a Host, Guest, Voice or Narration track first.", "info");
    for (const c of clips) {
      await applyEdit(c.id, `Cleaning ${c.name}`, (pcm) => E.level(E.highPassClean(E.denoise(pcm, null, null, 14, 1.8), null, 80), null, -19));
    }
    getStudio().notify(`Cleaned ${clips.length} recording${clips.length === 1 ? "" : "s"}: less noise and rumble, even levels.`, "success");
  };
  const trimPauses = async () => {
    const p = getStudio().project;
    const clips = Object.values(p.clips).filter((c) => c.assetId && p.tracks.find((t) => t.id === c.trackId && /host|voice|narrat|guest|speech|record|take/i.test(t.name)));
    for (const c of clips) await applyEdit(c.id, `Tightening ${c.name}`, (pcm) => E.truncateSilence(pcm, null, -40, 0.7, 0.35));
    if (!clips.length) getStudio().notify("There's no speech track to tighten yet.", "info");
  };
  const musicBed = async () => {
    await runJob("bed", "Composing a music bed", async () => {
      const st = getStudio();
      const p = st.project;
      const seconds = Math.max(30, P.beatsToSec(p, P.projectLength(p)));
      const plan = localPlan({ genre: "lofi", mood: "calm", seconds, seed: Date.now() % 1e6, energy: 2, bpm: p.bpm });
      const real = realize(plan, 7);
      const voice = p.tracks.find((t) => t.kind === "audio" && /host|voice|narrat/i.test(t.name)) ?? p.tracks.find((t) => t.kind === "audio");
      st.commit((q) => {
        let r = q;
        for (const t of real.project.tracks) {
          const nt = { ...t, name: `Bed · ${t.name}`, volume: t.volume * 0.6, duck: voice ? { source: voice.id, amount: 14 } : null };
          r = P.addTrack(r, nt);
          r = P.putClips(r, Object.values(real.project.clips).filter((c) => c.trackId === t.id));
        }
        return r;
      });
      st.notify(`A calm music bed runs under the whole show${voice ? ` and dips whenever “${voice.name}” speaks` : ""}.`, "success");
    });
  };
  return (
    <Section title="Podcast & audio stories" defaultOpen={false}>
      <div className="space-y-2">
        <p className="text-[12px] leading-relaxed text-paper-dim">One-tap production for spoken audio: clean recordings, tighten pauses, and score it with music that steps aside for the voice.</p>
        <TextButton className="w-full justify-start" disabled={busy} onClick={() => void cleanVoices()}>
          <Wand2 aria-hidden className="size-3.5 text-paper-dim" />
          Clean up every voice recording
        </TextButton>
        <TextButton className="w-full justify-start" disabled={busy} onClick={() => void trimPauses()}>
          <Scissors aria-hidden className="size-3.5 text-paper-dim" />
          Shorten long pauses
        </TextButton>
        <TextButton className="w-full justify-start" disabled={busy} onClick={() => void musicBed()}>
          <Music2 aria-hidden className="size-3.5 text-paper-dim" />
          Add a music bed under it all
        </TextButton>
        <TextButton className="w-full justify-start" onClick={() => autoDuckAll(14)}>
          <Gauge aria-hidden className="size-3.5 text-paper-dim" />
          Duck all music under the voice
        </TextButton>
        <TextButton className="w-full justify-start" onClick={() => applyMasterPreset("podcast")}>
          <Sparkles aria-hidden className="size-3.5 text-paper-dim" />
          Master for podcasts (−16 LUFS)
        </TextButton>
        <JobLine id="edit" />
        <JobLine id="bed" />
      </div>
    </Section>
  );
}

function MasterSection() {
  const lufs = useStudio((s) => s.project.master.lufs ?? null);
  const [measure, setMeasure] = useState<{ lufs: number; peak: number } | null>(null);
  const meas = async () => {
    await runJob("measure", "Measuring loudness", async () => {
      const buf = await renderMix();
      const ch = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
      setMeasure({ lufs: loudness(ch, buf.sampleRate), peak: 20 * Math.log10(Math.max(...ch.map(peak)) || 1e-9) });
    });
  };
  return (
    <Section title="Mastering" defaultOpen={false}>
      <div className="space-y-2">
        <p className="text-[12px] leading-relaxed text-paper-dim">Finish the mix with a mastering chain (EQ, glue compression, width, limiter). Export then sets the loudness to the target.</p>
        <div className="grid grid-cols-1 gap-1">
          {MASTER_PRESETS.map((m) => (
            <button key={m.id} type="button" onClick={() => applyMasterPreset(m.id)} className={cn("flex items-baseline justify-between gap-2 rounded-sm border px-2.5 py-2 text-left", lufs === m.lufs ? "border-paper" : "border-line-dark hover:bg-paper/10")}>
              <span className="text-[13px] text-paper">{m.label}</span>
              <span className="truncate text-[12px] text-paper-dim">{m.hint}</span>
            </button>
          ))}
        </div>
        <TextButton className="w-full" onClick={() => void meas()}>
          <Gauge aria-hidden className="size-3.5" />
          Measure the song&apos;s loudness
        </TextButton>
        <JobLine id="measure" />
        {measure && (
          <Note>
            Integrated loudness <b className="text-paper">{Number.isFinite(measure.lufs) ? measure.lufs.toFixed(1) : "−∞"} LUFS</b>, peak <b className="text-paper">{measure.peak.toFixed(1)} dBFS</b>
            {lufs !== null && Number.isFinite(measure.lufs) ? `. Export will move it ${(lufs - measure.lufs).toFixed(1)} dB to reach ${lufs} LUFS.` : "."}
          </Note>
        )}
      </div>
    </Section>
  );
}

/** A chromatic tuner (GarageBand's), reading the microphone with the YIN pitch detector. */
function TunerSection() {
  const [on, setOn] = useState(false);
  const [reading, setReading] = useState<{ hz: number; note: string; cents: number } | null>(null);
  useEffect(() => {
    if (!on) return;
    let stop = false;
    let stream: MediaStream | null = null;
    let raf = 0;
    void (async () => {
      try {
        const ctx = await transport.ensure();
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
        if (stop) return;
        const an = ctx.createAnalyser();
        an.fftSize = 4096;
        const src = ctx.createMediaStreamSource(stream);
        src.connect(an);
        const buf = new Float32Array(an.fftSize);
        let last = 0;
        const tick = (t: number) => {
          if (stop) return;
          if (t - last > 80) {
            last = t;
            an.getFloatTimeDomainData(buf);
            const hz = peak(buf) > 0.01 ? yin(buf, ctx.sampleRate, 40, 1500, 0.12) : 0;
            if (hz > 0) {
              const midi = 69 + 12 * Math.log2(hz / 440);
              const n = Math.round(midi);
              setReading({ hz, note: noteName(n), cents: Math.round((midi - n) * 100) });
            }
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch {
        setOn(false);
        getStudio().notify("Allow the microphone to use the tuner.", "warning");
      }
    })();
    return () => {
      stop = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [on]);
  const inTune = reading && Math.abs(reading.cents) <= 5;
  return (
    <Section title="Tuner" defaultOpen={false}>
      <div className="space-y-2">
        <Row2 label="Listen to the microphone">
          <Toggle label="Tuner" checked={on} onChange={setOn} />
        </Row2>
        {on && (
          <div className="rounded-sm border border-line-dark p-3 text-center">
            <p className={cn("text-[32px] font-semibold leading-none", inTune ? "text-success" : "text-paper")}>{reading?.note ?? "—"}</p>
            <p className="mt-1 font-mono text-[12px] text-paper-dim">{reading ? `${reading.hz.toFixed(1)} Hz · ${reading.cents > 0 ? "+" : ""}${reading.cents} cents` : "Play a single note"}</p>
            <div className="relative mx-auto mt-2 h-2 w-full rounded-full bg-line-dark">
              <span className="absolute left-1/2 top-[-3px] h-[14px] w-px bg-paper-dim" />
              {reading && <span className={cn("absolute top-[-2px] size-3 -translate-x-1/2 rounded-full", inTune ? "bg-success" : "bg-accent")} style={{ left: `${50 + Math.max(-50, Math.min(50, reading.cents))}%` }} />}
            </div>
          </div>
        )}
        <Field label="Reference">
          <p className="text-[12px] text-paper-dim">A4 = 440 Hz. Within ±5 cents shows green.</p>
        </Field>
      </div>
    </Section>
  );
}

