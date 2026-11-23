"use client";

import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { ChevronLeft, ChevronRight, Keyboard, Usb } from "lucide-react";
import { DRUM_ROWS } from "../constants";
import { warmInBackground } from "../engine/instruments";
import { connectMidiInput } from "../engine/midi";
import { transport } from "../engine/transport";
import { diatonicChord, noteName, voice } from "../lib/theory";
import { getStudio, useStudio } from "../store";
import { IconButton, Select, Slider, TextButton, Toggle, uncapture } from "./controls";

/**
 * Playing live: an on-screen piano (glide across it), drum pads, chord pads in the song's key
 * (GarageBand's Smart Instruments), musical typing on the computer keyboard, a sustain pedal,
 * and any MIDI keyboard (Web MIDI). Notes go to the selected instrument or drum track, and are
 * recorded when that track is armed and you press Record.
 */

const TYPING: Record<string, number> = { a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12, o: 13, l: 14, p: 15, ";": 16 };

let sustain = false;
const sustained = new Set<string>();

function useTarget() {
  return useStudio(
    useShallow((s) => {
      const t = s.project.tracks.find((x) => x.id === s.selectedTrack && x.kind !== "audio") ?? s.project.tracks.find((x) => x.kind !== "audio");
      return { id: t?.id ?? null, name: t?.name ?? null, drums: t?.kind === "drums" };
    }),
  );
}

function on(track: string | null, pitch: number, vel: number) {
  sustained.delete(`${track}:${pitch}`);
  void transport.noteOn(track, pitch, vel);
}
function off(track: string | null, pitch: number) {
  if (sustain) sustained.add(`${track}:${pitch}`);
  else transport.noteOff(track, pitch);
}
function releaseSustain() {
  for (const k of sustained) {
    const [t, p] = k.split(":");
    transport.noteOff(t === "null" ? null : t, Number(p));
  }
  sustained.clear();
}

/** Global musical-typing handler; mounted once by the studio. */
export function useMusicalTyping() {
  const octave = useRef(4);
  const vel = useRef(0.8);
  useEffect(() => {
    const held = new Set<string>();
    const down = (e: KeyboardEvent) => {
      const st = getStudio();
      if (!st.typing || e.ctrlKey || e.metaKey || e.altKey) return;
      if ((e.target as HTMLElement).closest?.("input, textarea, select, [contenteditable='true']")) return;
      const k = e.key.toLowerCase();
      const target = st.project.tracks.find((x) => x.id === st.selectedTrack && x.kind !== "audio") ?? st.project.tracks.find((x) => x.kind !== "audio");
      if (k in TYPING || k === "z" || k === "x" || k === "c" || k === "v") {
        e.preventDefault();
        e.stopPropagation();
        if (e.repeat || held.has(k)) return;
        held.add(k);
        if (k === "z") octave.current = Math.max(1, octave.current - 1);
        else if (k === "x") octave.current = Math.min(7, octave.current + 1);
        else if (k === "c") vel.current = Math.max(0.1, vel.current - 0.15);
        else if (k === "v") vel.current = Math.min(1, vel.current + 0.15);
        else on(target?.id ?? null, (octave.current + 1) * 12 + TYPING[k], vel.current);
      }
    };
    const up = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (!held.has(k)) return;
      held.delete(k);
      const st = getStudio();
      const target = st.project.tracks.find((x) => x.id === st.selectedTrack && x.kind !== "audio") ?? st.project.tracks.find((x) => x.kind !== "audio");
      if (k in TYPING) off(target?.id ?? null, (octave.current + 1) * 12 + TYPING[k]);
    };
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    return () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
    };
  }, []);
}

export function Keys() {
  const target = useTarget();
  const tracks = useStudio((s) => s.project.tracks);
  const playable = tracks.filter((t) => t.kind !== "audio");
  const { keyRoot, scale, typing } = useStudio(useShallow((s) => ({ keyRoot: s.project.keyRoot, scale: s.project.scale, typing: s.typing })));
  const [octave, setOctave] = useState(3);
  const [vel, setVel] = useState(0.8);
  const [seventh, setSeventh] = useState(false);
  const [pedal, setPedal] = useState(false);
  const [midi, setMidi] = useState<string[] | null>(null);
  const [width, setWidth] = useState(800);
  const box = useRef<HTMLDivElement>(null);
  const down = useRef(new Map<number, number>());

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    sustain = pedal;
    if (!pedal) releaseSustain();
  }, [pedal]);

  const octaves = width < 520 ? 1 : width < 900 ? 2 : 3;
  const lo = (octave + 1) * 12;
  const hi = lo + octaves * 12;
  // Pre-render the visible keys of a sampled-style instrument so the first press is instant.
  const instrument = useStudio((s) => s.project.tracks.find((t) => t.id === target.id)?.instrument);
  useEffect(() => {
    if (instrument) warmInBackground(instrument, Array.from({ length: hi - lo + 13 }, (_, i) => lo - 12 + i));
  }, [instrument, lo, hi]);
  const whites: number[] = [];
  for (let p = lo; p <= hi; p++) if (![1, 3, 6, 8, 10].includes(p % 12)) whites.push(p);
  const ww = 100 / whites.length;

  const press = (pointer: number, pitch: number) => {
    const prev = down.current.get(pointer);
    if (prev === pitch) return;
    if (prev !== undefined) off(target.id, prev);
    down.current.set(pointer, pitch);
    on(target.id, pitch, vel);
  };
  const release = (pointer: number) => {
    const prev = down.current.get(pointer);
    if (prev !== undefined) off(target.id, prev);
    down.current.delete(pointer);
  };
  const pitchFromPoint = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const v = el?.closest<HTMLElement>("[data-pitch]")?.dataset.pitch;
    return v ? Number(v) : null;
  };

  const connect = async () => {
    try {
      const names = await connectMidiInput((pitch, velocity, isOn) => {
        const st = getStudio();
        const t = st.project.tracks.find((x) => x.id === st.selectedTrack && x.kind !== "audio") ?? st.project.tracks.find((x) => x.kind !== "audio");
        if (isOn) on(t?.id ?? null, pitch, velocity);
        else off(t?.id ?? null, pitch);
      });
      setMidi(names);
      getStudio().notify(names.length ? `MIDI connected: ${names.join(", ")}.` : "MIDI is on. Plug in a keyboard and it'll be picked up.", "success");
    } catch (e) {
      getStudio().notify(e instanceof Error ? e.message : "MIDI isn't available here.", "warning");
    }
  };

  const chords = Array.from({ length: 7 }, (_, d) => diatonicChord(d, keyRoot, scale === "chromatic" ? "major" : scale, seventh));
  const chordDown = (i: number) => {
    const v = voice(chords[i], 60);
    for (const p of v) on(target.id, p, vel);
    on(target.id, v[0] - 12, vel * 0.9);
  };
  const chordUp = (i: number) => {
    const v = voice(chords[i], 60);
    for (const p of v) off(target.id, p);
    off(target.id, v[0] - 12);
  };

  if (!target.id) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
        <p className="text-[13px] text-paper-dim">Add an instrument or drum track to play it here.</p>
        <TextButton tone="primary" onClick={() => getStudio().addTrack("instrument", { name: "Piano", instrument: "piano" })}>
          Add a piano track
        </TextButton>
      </div>
    );
  }

  return (
    <div ref={box} className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1 overflow-x-auto border-b border-line-dark bg-ink-raised px-1.5 [scrollbar-width:none]">
        <span className="shrink-0 pl-1 text-[12px] text-paper-dim">Playing</span>
        <Select label="Track to play" value={target.id} onChange={(v) => getStudio().selectTrack(v)} options={playable.map((t) => ({ value: t.id, label: t.name }))} className="h-8 w-[128px] flex-none sm:h-7" />
        <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-line-dark" />
        {!target.drums && (
          <>
            <IconButton label="Octave down" onClick={() => setOctave((o) => Math.max(0, o - 1))}>
              <ChevronLeft aria-hidden className="size-4" />
            </IconButton>
            <span className="w-8 shrink-0 text-center font-mono text-[12px] text-paper">C{octave}</span>
            <IconButton label="Octave up" onClick={() => setOctave((o) => Math.min(7, o + 1))}>
              <ChevronRight aria-hidden className="size-4" />
            </IconButton>
          </>
        )}
        <div className="flex w-28 shrink-0 items-center gap-1.5 px-1">
          <span className="label-mono text-paper-dim">Vel</span>
          <Slider label="Velocity" value={vel} min={0.1} max={1} step={0.01} onChange={setVel} />
        </div>
        <label className="flex shrink-0 items-center gap-1.5 px-1 text-[12px] text-paper-dim">
          <Toggle label="Sustain pedal" checked={pedal} onChange={setPedal} />
          Sustain
        </label>
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <IconButton label={typing ? "Musical typing on: A–; play notes, Z/X octave, C/V velocity" : "Musical typing: play with the computer keyboard"} active={typing} onClick={() => getStudio().set({ typing: !typing })}>
            <Keyboard aria-hidden className="size-4" />
          </IconButton>
          <IconButton label={midi ? `MIDI: ${midi.join(", ") || "waiting for a keyboard"}` : "Connect a MIDI keyboard"} active={Boolean(midi)} onClick={() => void connect()}>
            <Usb aria-hidden className="size-4" />
          </IconButton>
        </div>
      </div>
      {target.drums ? (
        <div className="grid min-h-0 flex-1 grid-cols-4 gap-1.5 p-2 sm:grid-cols-6">
          {[...DRUM_ROWS].reverse().map((d) => (
            <button
              key={d.pitch}
              type="button"
              onPointerDown={(e) => {
                uncapture(e);
                on(target.id, d.pitch, vel);
              }}
              className="flex min-h-12 touch-none items-end rounded-md border border-line-dark bg-ink-raised p-2 text-left text-[12px] text-paper transition-colors active:border-accent active:bg-accent/30"
            >
              {d.label}
            </button>
          ))}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
          <div className="flex shrink-0 items-center gap-1 overflow-x-auto [scrollbar-width:none]">
            {chords.map((c, i) => (
              <button
                key={i}
                type="button"
                onPointerDown={() => chordDown(i)}
                onPointerUp={() => chordUp(i)}
                onPointerLeave={(e) => e.buttons && chordUp(i)}
                className="h-10 min-w-[64px] flex-1 touch-none rounded-sm border border-line-dark bg-ink-raised text-[13px] font-medium text-paper transition-colors active:border-accent active:bg-accent/30"
              >
                {c.symbol}
              </button>
            ))}
            <label className="flex shrink-0 items-center gap-1.5 pl-1 text-[12px] text-paper-dim">
              <Toggle label="Seventh chords" checked={seventh} onChange={setSeventh} />
              7th
            </label>
          </div>
          <div
            className="relative min-h-[90px] flex-1 touch-none select-none"
            onPointerDown={(e) => {
              uncapture(e);
              const p = pitchFromPoint(e.clientX, e.clientY);
              if (p !== null) press(e.pointerId, p);
            }}
            onPointerMove={(e) => {
              if (!down.current.has(e.pointerId)) return;
              const p = pitchFromPoint(e.clientX, e.clientY);
              if (p !== null) press(e.pointerId, p);
            }}
            onPointerUp={(e) => release(e.pointerId)}
            onPointerCancel={(e) => release(e.pointerId)}
            onPointerLeave={(e) => release(e.pointerId)}
          >
            {whites.map((p, i) => (
              <div key={p} data-pitch={p} className="absolute inset-y-0 rounded-b-[5px] border border-ink bg-paper" style={{ left: `${i * ww}%`, width: `${ww}%` }}>
                {p % 12 === 0 && <span className="pointer-events-none absolute bottom-1 left-1 font-mono text-[12px] text-ink-3">{noteName(p)}</span>}
              </div>
            ))}
            {whites.map((p, i) => {
              const b = p + 1;
              if ([1, 3, 6, 8, 10].includes(b % 12) && b <= hi) {
                return <div key={b} data-pitch={b} className="absolute top-0 z-10 h-[60%] rounded-b-[4px] border border-ink bg-ink" style={{ left: `${(i + 0.68) * ww}%`, width: `${ww * 0.64}%` }} />;
              }
              return null;
            })}
          </div>
        </div>
      )}
    </div>
  );
}

