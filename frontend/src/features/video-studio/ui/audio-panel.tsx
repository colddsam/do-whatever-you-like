"use client";

import { createElement, useEffect, useRef, useState } from "react";
import { AudioWaveform, Drum, Gauge, Mic, Music4, Play, Plus, Speech, Square, Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { CAPTION_STYLES } from "../constants";
import { frameRound, rt, shortTime, uid } from "../lib/time";
import * as TL from "../lib/timeline";
import { getStudio, usePrimaryClip, useStudio } from "../store/studio-store";
import type { CaptionStyleId, Clip } from "../types";
import { autoDuck, detectBeats, normalizeLoudness } from "../engine/ai/analysis";
import { addGeneratedFile } from "../engine/clip-tools";
import { startRecording, type Recording } from "../engine/record";
import { renderSfx, SFX, type SfxId } from "../engine/sfx";
import { addVoiceover, VOICES } from "../engine/tts";
import { JobLine, runJob } from "./ai-panel";
import { SFX_ICON } from "./catalog";
import { Row, Section, Segmented, Select, Slider, TextButton, Toggle } from "./controls";

/* ---------- Voice-over recorder ---------- */

function VoiceoverBox() {
  const [rec, setRec] = useState<Recording | null>(null);
  const [level, setLevel] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [playAlong, setPlayAlong] = useState(true);
  const [busy, setBusy] = useState(false);
  const startAt = useRef(0);

  useEffect(() => {
    if (!rec) return;
    const ctx = new AudioContext();
    const an = ctx.createAnalyser();
    an.fftSize = 512;
    ctx.createMediaStreamSource(rec.stream).connect(an);
    const buf = new Float32Array(an.fftSize);
    let raf = 0;
    const tick = () => {
      an.getFloatTimeDomainData(buf);
      let peak = 0;
      for (const v of buf) peak = Math.max(peak, Math.abs(v));
      setLevel(peak);
      setElapsed((performance.now() - rec.startedAt) / 1000);
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      void ctx.close();
    };
  }, [rec]);

  const start = async () => {
    setBusy(true);
    try {
      const st = getStudio();
      startAt.current = frameRound(st.playhead, st.project.settings.fps);
      const r = await startRecording("mic");
      setRec(r);
      // Play the picture so the voice can follow it (headphones keep the speakers out of the mic).
      if (playAlong) st.set({ playing: true });
    } catch (e) {
      getStudio().notify(e instanceof Error ? e.message : "Recording couldn't start.", "danger");
    } finally {
      setBusy(false);
    }
  };
  const stop = async () => {
    if (!rec) return;
    const r = rec;
    setRec(null);
    getStudio().set({ playing: false });
    try {
      const file = await r.stop();
      const asset = await addGeneratedFile(file);
      // On a free sound track (or a new one), so nothing already there gets overwritten.
      getStudio().placeMedia(asset.id, startAt.current);
      getStudio().notify(`Voice-over added (${shortTime(asset.duration)}).`, "success");
    } catch (e) {
      getStudio().notify(e instanceof Error ? e.message : "The recording couldn't be saved.", "danger");
    }
  };

  return (
    <Section title="Record a voice-over">
      {rec ? (
        <div className="rounded-md border border-danger/60 p-2">
          <p className="flex items-center gap-2 text-[13px] text-paper">
            <span className="size-2.5 animate-pulse rounded-full bg-danger" />
            Recording · <span className="font-mono">{shortTime(elapsed)}</span>
          </p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line-dark">
            <div className="h-full rounded-full bg-success transition-[width] duration-75" style={{ width: `${Math.min(100, level * 140)}%` }} />
          </div>
          <TextButton tone="danger" className="mt-2 w-full" onClick={() => void stop()}>
            <Square aria-hidden className="size-3.5" />
            Stop and add
          </TextButton>
        </div>
      ) : (
        <>
          <Row label="Play along">
            <Toggle label="Play the video while recording" checked={playAlong} onChange={setPlayAlong} />
            <span className="text-[12px] text-paper-dim">Use headphones</span>
          </Row>
          <TextButton tone="primary" className="mt-1 w-full" disabled={busy} onClick={() => void start()}>
            <Mic aria-hidden className="size-4" />
            Record from the playhead
          </TextButton>
        </>
      )}
      <p className="mt-2 text-[12px] leading-relaxed text-paper-dim">Recorded on this device and placed where the playhead is. Screen and camera recording are in the Media tab.</p>
    </Section>
  );
}

/* ---------- Text to speech ---------- */

function TtsBox() {
  const [text, setText] = useState("");
  const [voice, setVoice] = useState(VOICES[0].id);
  const [rate, setRate] = useState(0);
  const [pitch, setPitch] = useState(0);
  const [captions, setCaptions] = useState<"" | CaptionStyleId>("bold");
  const busy = useStudio((s) => !!s.jobs.tts);
  return (
    <Section title="Text to speech">
      <textarea
        aria-label="Text to speak"
        value={text}
        rows={4}
        maxLength={2500}
        placeholder="Type what the voice should say…"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.stopPropagation()}
        className="mb-2 w-full resize-y rounded-sm border border-line-dark bg-ink px-2 py-1.5 text-[13px] leading-snug text-paper outline-none placeholder:text-paper-dim/60 focus-visible:border-accent"
      />
      <Row label="Voice">
        <Select label="Voice" value={voice} onChange={setVoice} options={VOICES.map((v) => ({ value: v.id, label: v.label }))} />
      </Row>
      <Row label="Speed">
        <Slider label="Speaking speed" value={rate} min={-50} max={100} step={5} neutral={0} onChange={setRate} />
        <span className="w-11 text-right font-mono text-[12px] text-paper-dim">{rate > 0 ? "+" : ""}{rate}%</span>
      </Row>
      <Row label="Pitch">
        <Slider label="Pitch" value={pitch} min={-50} max={50} step={5} neutral={0} onChange={setPitch} />
        <span className="w-11 text-right font-mono text-[12px] text-paper-dim">{pitch > 0 ? "+" : ""}{pitch} Hz</span>
      </Row>
      <Row label="Captions">
        <Select<"" | CaptionStyleId>
          label="Caption the voice-over"
          value={captions}
          onChange={setCaptions}
          options={[{ value: "", label: "No captions" }, ...(Object.keys(CAPTION_STYLES) as CaptionStyleId[]).map((id) => ({ value: id, label: CAPTION_STYLES[id].label }))]}
        />
      </Row>
      <TextButton
        tone="primary"
        className="mt-2 w-full"
        disabled={busy || !text.trim()}
        onClick={() =>
          void runJob("tts", "Making the voice-over", async () => {
            await addVoiceover(text.trim(), voice, { rate, pitch, captions: captions || null });
            getStudio().notify("Voice-over added at the playhead.", "success");
          })
        }
      >
        <Speech aria-hidden className="size-4" />
        Add voice-over
      </TextButton>
      <JobLine id="tts" />
      <p className="mt-2 text-[12px] leading-relaxed text-paper-dim">Free neural voices in 30 voices and 16 languages (Microsoft Edge&apos;s online voices, through our server). The text is sent to make the speech; nothing else is.</p>
    </Section>
  );
}

/* ---------- Sound effects ---------- */

function SfxBox() {
  const [playing, setPlaying] = useState<SfxId | null>(null);
  const preview = async (id: SfxId) => {
    const f = await renderSfx(id);
    const url = URL.createObjectURL(f);
    const a = new Audio(url);
    setPlaying(id);
    a.onended = () => {
      setPlaying(null);
      URL.revokeObjectURL(url);
    };
    void a.play();
  };
  const add = (id: SfxId) =>
    void runJob("sfx", "Adding the sound", async () => {
      const asset = await addGeneratedFile(await renderSfx(id));
      getStudio().placeMedia(asset.id);
    });
  return (
    <Section title="Sound effects">
      <ul className="grid grid-cols-2 gap-1.5">
        {SFX.map((s) => (
          <li key={s.id} className="flex min-w-0 items-center gap-1 rounded-md border border-line-dark pr-1 hover:border-paper/40">
            <button type="button" onClick={() => add(s.id)} title={`${s.label}: ${s.hint}. Click to add at the playhead.`} className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 pl-1.5 text-left">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-paper/10 text-paper">{createElement(SFX_ICON[s.id], { "aria-hidden": true, className: "size-3.5" })}</span>
              <span className="truncate text-[12px] text-paper">{s.label}</span>
            </button>
            <button type="button" aria-label={`Preview ${s.label}`} title="Preview" onClick={() => void preview(s.id)} className={cn("inline-flex size-7 shrink-0 items-center justify-center rounded-sm hover:bg-paper/10", playing === s.id ? "text-accent" : "text-paper-dim")}>
              <Play aria-hidden className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>
      <JobLine id="sfx" />
      <p className="mt-2 text-[12px] leading-relaxed text-paper-dim">Made on this device with the Web Audio API, so they&apos;re yours to use anywhere.</p>
    </Section>
  );
}

/* ---------- Beats ---------- */

function musicClip(): Clip | null {
  const s = getStudio();
  const sel = s.selection.map((id) => s.project.clips[id]).find((c) => c?.kind === "audio");
  if (sel) return sel;
  // The longest sound clip, which is usually the music.
  return Object.values(s.project.clips).filter((c) => c.kind === "audio" && c.mediaId).sort((a, b) => b.duration - a.duration)[0] ?? null;
}

function BeatsBox() {
  const [every, setEvery] = useState("1");
  const [cut, setCut] = useState(false);
  const [bpm, setBpm] = useState<number | null>(null);
  const busy = useStudio((s) => !!s.jobs.beats);
  const run = () =>
    runJob("beats", "Listening", async (progress) => {
      const c = musicClip();
      if (!c) throw new Error("Add some music (a sound clip) first.");
      const { bpm, beats } = await detectBeats(c, progress);
      setBpm(bpm);
      const n = Number(every);
      const picked = beats.filter((_, i) => i % n === 0);
      const st = getStudio();
      st.commit((p) => {
        const keep = p.markers.filter((m) => m.label !== "Beat");
        let next: typeof p = { ...p, markers: [...keep, ...picked.map((t) => ({ id: uid("mk"), t, label: "Beat", color: "#39ff88" }))].sort((a, b) => a.t - b.t) };
        if (cut) {
          // Cut the pictures on the beat: every visual clip that spans a beat is split there.
          const ids = Object.values(next.clips)
            .filter((x) => x.kind !== "audio" && x.kind !== "text")
            .map((x) => x.id);
          for (const t of picked) next = TL.splitAt(next, rt(t), ids.filter((id) => next.clips[id]));
        }
        return next;
      });
      st.notify(`${picked.length} beat markers at about ${bpm} BPM${cut ? ", and the video cut on them" : ""}. Clips now snap to them.`, "success");
    });
  return (
    <Section title="Beat sync">
      <Row label="Mark every">
        <Segmented
          label="Mark every"
          value={every}
          onChange={setEvery}
          options={[
            { value: "1", label: "Beat" },
            { value: "2", label: "2nd" },
            { value: "4", label: "Bar" },
          ]}
        />
      </Row>
      <Row label="Cut video">
        <Toggle label="Also cut the video on the beats" checked={cut} onChange={setCut} />
        <span className="text-[12px] text-paper-dim">Split pictures on each mark</span>
      </Row>
      <TextButton className="mt-2 w-full" disabled={busy} onClick={() => void run()}>
        <Drum aria-hidden className="size-4" />
        Find the beat
      </TextButton>
      <JobLine id="beats" />
      {bpm && <p className="mt-1.5 font-mono text-[12px] text-paper-dim">≈ {bpm} BPM</p>}
      <p className="mt-2 text-[12px] leading-relaxed text-paper-dim">Uses the selected sound clip, or the longest one. Markers are green on the ruler; dragged clips snap to them.</p>
    </Section>
  );
}

/* ---------- Ducking and loudness ---------- */

function MixBox() {
  // Select the stable array and filter while rendering: a selector that builds a new array every
  // time makes zustand re-render forever.
  const allTracks = useStudio((s) => s.project.tracks);
  const tracks = allTracks.filter((t) => t.kind === "audio");
  const [voice, setVoice] = useState(tracks[0]?.id ?? "");
  const [music, setMusic] = useState(tracks[1]?.id ?? tracks[0]?.id ?? "");
  const [duck, setDuck] = useState(-12);
  const [target, setTarget] = useState("-14");
  const busy = useStudio((s) => !!s.jobs.mix);
  const c = usePrimaryClip();
  const options = tracks.map((t) => ({ value: t.id, label: t.name }));
  const v = options.some((o) => o.value === voice) ? voice : (options[0]?.value ?? "");
  const m = options.some((o) => o.value === music) ? music : (options[1]?.value ?? options[0]?.value ?? "");
  return (
    <Section title="Mix: ducking and loudness">
      <p className="label-mono mb-1 text-paper-dim">Auto-duck music under speech</p>
      <Row label="Voice track">
        <Select label="Voice track" value={v} onChange={setVoice} options={options} />
      </Row>
      <Row label="Music track">
        <Select label="Music track" value={m} onChange={setMusic} options={options} />
      </Row>
      <Row label="Lower by">
        <Slider label="Duck amount" value={duck} min={-30} max={-3} step={1} onChange={setDuck} />
        <span className="w-12 text-right font-mono text-[12px] text-paper-dim">{duck} dB</span>
      </Row>
      <TextButton
        className="mt-1 w-full"
        disabled={busy || !v || !m || v === m}
        onClick={() =>
          void runJob("mix", "Listening for speech", async (p) => {
            const n = await autoDuck(v, m, duck, p);
            getStudio().notify(n ? `The music dips under ${n} stretch${n === 1 ? "" : "es"} of speech.` : "No speech was found on the voice track.", n ? "success" : "info");
          })
        }
      >
        <Volume2 aria-hidden className="size-4" />
        Duck the music
      </TextButton>
      <p className="label-mono mb-1 mt-3 text-paper-dim">Even out loudness</p>
      <Row label="Target">
        <Segmented
          label="Loudness target"
          value={target}
          onChange={setTarget}
          options={[
            { value: "-14", label: "-14 LUFS", title: "YouTube, Instagram, TikTok, Spotify" },
            { value: "-16", label: "-16", title: "Podcasts, Apple" },
            { value: "-23", label: "-23", title: "Broadcast (EBU R128)" },
          ]}
        />
      </Row>
      <TextButton
        className="mt-1 w-full"
        disabled={busy}
        onClick={() =>
          void runJob("mix", "Measuring loudness", async (p) => {
            const st = getStudio();
            const ids = st.selection.length ? TL.withLinked(st.project, st.selection) : Object.values(st.project.clips).filter((x) => x.kind === "audio").map((x) => x.id);
            const changes = await normalizeLoudness(ids, Number(target), p);
            getStudio().notify(changes.length ? `Levelled ${changes.length} clip${changes.length === 1 ? "" : "s"} to ${target} LUFS.` : "Nothing loud enough to level.", changes.length ? "success" : "info");
          })
        }
      >
        <Gauge aria-hidden className="size-4" />
        Normalize {c?.kind === "audio" || c?.linkId ? "selected" : "all"} sound
      </TextButton>
      <JobLine id="mix" />
      <p className="mt-2 text-[12px] leading-relaxed text-paper-dim">Loudness is measured to the ITU-R BS.1770 standard on this device. Ducking writes volume keyframes you can fine-tune.</p>
    </Section>
  );
}

export function AudioPanel() {
  return (
    <div className="h-full overflow-y-auto overscroll-contain" data-lenis-prevent>
      <div className="flex items-center gap-2 border-b border-line-dark px-3 py-2 text-[12px] text-paper-dim">
        <AudioWaveform aria-hidden className="size-3.5 shrink-0" />
        Sound tools · per-clip EQ, voice changer and effects are in the inspector
        <Music4 aria-hidden className="ml-auto size-3.5 text-accent" />
      </div>
      <VoiceoverBox />
      <TtsBox />
      <SfxBox />
      <BeatsBox />
      <MixBox />
      <div className="px-3 py-3">
        <TextButton className="w-full" onClick={() => getStudio().addTrack("audio")}>
          <Plus aria-hidden className="size-3.5" />
          Add a sound track
        </TextButton>
      </div>
    </div>
  );
}
