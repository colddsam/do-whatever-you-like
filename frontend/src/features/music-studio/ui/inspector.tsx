"use client";

import { useMemo } from "react";
import { ChevronDown, ChevronUp, Power, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { bounceTrack } from "../actions";
import { EFFECTS, FX_PRESETS, TRACK_COLORS, effectDef } from "../constants";
import { KITS } from "../engine/drums";
import { INSTRUMENTS } from "../engine/instruments";
import { autoValue } from "../engine/graph";
import * as P from "../lib/project";
import { getStudio, useStudio } from "../store";
import type { Clip, Effect, EffectType, Track } from "../types";
import { Empty, IconButton, Row, Section, Select, Slider, TextButton, Toggle } from "./controls";

const dB = (g: number) => (g <= 0.0001 ? "−∞" : `${(20 * Math.log10(g)).toFixed(1)} dB`);

export function Inspector() {
  const track = useStudio((s) => s.project.tracks.find((t) => t.id === s.selectedTrack));
  const clip = useStudio((s) => (s.selectedClips.length === 1 ? s.project.clips[s.selectedClips[0]] : undefined));
  return (
    <div className="h-full overflow-y-auto bg-ink-raised" data-lenis-prevent>
      {clip && <ClipSection clip={clip} />}
      {track ? <TrackSection key={track.id} track={track} /> : <Empty>Select a track to change its sound, effects and mix.</Empty>}
      {track && <FxRack title={`Effects · ${track.name}`} effects={track.fx} onChange={(fx) => getStudio().commit((p) => P.updateTrack(p, track.id, { fx }))} live={(fx) => getStudio().live((p) => P.updateTrack(p, track.id, { fx }))} />}
      <MasterFx />
    </div>
  );
}

function ClipSection({ clip }: { clip: Clip }) {
  const st = getStudio();
  const sig = useStudio((s) => s.project.sig);
  const bpm = useStudio((s) => s.project.bpm);
  const live = (patch: Partial<Clip>) => st.live((p) => P.updateClip(p, clip.id, patch));
  const audio = Boolean(clip.assetId);
  const secs = P.beatsToSec({ bpm }, clip.length);
  return (
    <Section title={`Clip · ${clip.name}`}>
      <Row label="Name">
        <input
          aria-label="Clip name"
          defaultValue={clip.name}
          key={clip.id}
          onKeyDown={(e) => e.stopPropagation()}
          onBlur={(e) => e.target.value.trim() && e.target.value !== clip.name && st.updateClip(clip.id, { name: e.target.value.trim().slice(0, 40) })}
          className="h-8 min-w-0 flex-1 rounded-sm border border-line-dark bg-ink px-1.5 text-[12px] text-paper outline-none focus-visible:border-accent sm:h-7"
        />
      </Row>
      <Row label="Starts">
        <span className="font-mono text-[12px] text-paper">
          bar {Math.floor(clip.start / sig) + 1}, beat {((clip.start % sig) + 1).toFixed(2)}
        </span>
      </Row>
      <Row label="Length">
        <span className="font-mono text-[12px] text-paper">
          {(clip.length / sig).toFixed(2)} bars · {secs.toFixed(2)} s
        </span>
      </Row>
      <Row label="Muted">
        <Toggle label="Mute clip" checked={Boolean(clip.muted)} onChange={(v) => st.updateClip(clip.id, { muted: v })} />
      </Row>
      {audio ? (
        <>
          <Row label={`Gain ${dB(clip.gain ?? 1)}`}>
            <Slider label="Clip gain" value={clip.gain ?? 1} min={0} max={2} step={0.01} neutral={1} onStart={() => st.checkpoint()} onChange={(v) => live({ gain: v })} />
          </Row>
          <Row label={`Fade in ${(clip.fadeIn ?? 0).toFixed(1)}s`}>
            <Slider label="Fade in" value={clip.fadeIn ?? 0} min={0} max={Math.max(0.1, Math.min(10, secs / 2))} step={0.05} onStart={() => st.checkpoint()} onChange={(v) => live({ fadeIn: v })} />
          </Row>
          <Row label={`Fade out ${(clip.fadeOut ?? 0).toFixed(1)}s`}>
            <Slider label="Fade out" value={clip.fadeOut ?? 0} min={0} max={Math.max(0.1, Math.min(10, secs / 2))} step={0.05} onStart={() => st.checkpoint()} onChange={(v) => live({ fadeOut: v })} />
          </Row>
          <TextButton className="mt-1 w-full" onClick={() => st.openEditor(clip.id)}>
            Open in the audio editor
          </TextButton>
        </>
      ) : (
        <>
          <Row label="Transpose">
            <div className="flex gap-1">
              {[-12, -1, 1, 12].map((d) => (
                <TextButton key={d} className="h-8 px-2 sm:h-7" onClick={() => st.updateClip(clip.id, (c) => ({ ...c, notes: (c.notes ?? []).map((n) => ({ ...n, pitch: Math.max(0, Math.min(127, n.pitch + d)) })) }))}>
                  {d > 0 ? `+${d}` : `−${-d}`}
                </TextButton>
              ))}
            </div>
          </Row>
          <Row label={`Swing ${Math.round((clip.swing ?? 0) * 100)}%`}>
            <Slider label="Swing" value={clip.swing ?? 0} min={0} max={0.5} step={0.01} onStart={() => st.checkpoint()} onChange={(v) => live({ swing: v })} />
          </Row>
          <p className="mt-1 text-[12px] text-paper-dim">{clip.notes?.length ?? 0} notes. Double-click the clip to edit them.</p>
          <TextButton className="mt-1 w-full" onClick={() => st.openEditor(clip.id)}>
            Open in the {useStudio.getState().project.tracks.find((t) => t.id === clip.trackId)?.kind === "drums" ? "step sequencer" : "piano roll"}
          </TextButton>
        </>
      )}
    </Section>
  );
}

function TrackSection({ track }: { track: Track }) {
  const st = getStudio();
  const others = useStudio((s) => s.project.tracks);
  const assets = useStudio((s) => s.project.assets);
  const live = (patch: Partial<Track>) => st.live((p) => P.updateTrack(p, track.id, patch));
  const instOptions = useMemo(() => INSTRUMENTS.map((i) => ({ value: i.id, label: `${i.group} · ${i.label}` })), []);
  const tw = track.tweaks ?? {};
  const setTweak = (k: keyof NonNullable<Track["tweaks"]>, v: number) => live({ tweaks: { ...tw, [k]: v } });
  const auto = track.automation ?? [];
  return (
    <Section title={`Track · ${track.name}`}>
      <Row label="Colour">
        <div className="flex flex-wrap gap-[3px]">
          {TRACK_COLORS.map((c) => (
            <button key={c} type="button" aria-label={`Colour ${c}`} aria-pressed={track.color === c} onClick={() => st.updateTrack(track.id, { color: c })} className={cn("size-[18px] rounded-[3px] border", track.color === c ? "border-paper" : "border-transparent")} style={{ background: c }} />
          ))}
        </div>
      </Row>
      {track.kind === "drums" && (
        <Row label="Kit">
          <Select label="Drum kit" value={track.instrument} onChange={(v) => st.updateTrack(track.id, { instrument: v })} options={KITS.map((k) => ({ value: k.id, label: k.label }))} />
        </Row>
      )}
      {track.kind === "instrument" && (
        <>
          <Row label="Instrument">
            <Select label="Instrument" value={track.instrument} onChange={(v) => st.updateTrack(track.id, { instrument: v })} options={instOptions} />
          </Row>
          {track.instrument === "sampler" && (
            <Row label="Sample">
              <Select
                label="Sample"
                value={track.sampleAssetId ?? ""}
                onChange={(v) => st.updateTrack(track.id, { sampleAssetId: v || undefined })}
                options={[{ value: "", label: Object.keys(assets).length ? "Choose a recording…" : "Record or import one first" }, ...Object.values(assets).map((a) => ({ value: a.id, label: a.name }))]}
              />
            </Row>
          )}
          <Row label={`Octave ${tw.octave ? (tw.octave > 0 ? `+${tw.octave}` : tw.octave) : "0"}`}>
            <Slider label="Octave shift" value={tw.octave ?? 0} min={-3} max={3} step={1} onStart={() => st.checkpoint()} onChange={(v) => setTweak("octave", v)} />
          </Row>
          <Row label="Attack">
            <Slider label="Attack" value={tw.attack ?? 0} min={0} max={2} step={0.005} onStart={() => st.checkpoint()} onChange={(v) => setTweak("attack", v)} />
          </Row>
          <Row label="Release">
            <Slider label="Release" value={tw.release ?? 0} min={0} max={4} step={0.01} onStart={() => st.checkpoint()} onChange={(v) => setTweak("release", v)} />
          </Row>
          <Row label="Brightness">
            <Slider label="Filter cutoff" value={tw.cutoff ?? 0} min={0} max={12000} step={50} onStart={() => st.checkpoint()} onChange={(v) => setTweak("cutoff", v)} />
          </Row>
          <Row label="Resonance">
            <Slider label="Filter resonance" value={tw.resonance ?? 0} min={0} max={16} step={0.1} onStart={() => st.checkpoint()} onChange={(v) => setTweak("resonance", v)} />
          </Row>
          <p className="text-[12px] text-paper-dim">At 0, each tweak uses the instrument&apos;s own setting.</p>
        </>
      )}
      <Row label={`Vol ${dB(track.volume)}`}>
        <Slider label="Volume" value={track.volume} min={0} max={1.5} step={0.01} neutral={1} onStart={() => st.checkpoint()} onChange={(v) => live({ volume: v })} />
      </Row>
      <Row label="Pan">
        <Slider label="Pan" value={track.pan} min={-1} max={1} step={0.01} onStart={() => st.checkpoint()} onChange={(v) => live({ pan: v })} />
      </Row>
      <Row label="Duck under">
        <Select
          label="Duck under another track"
          value={track.duck?.source ?? ""}
          onChange={(v) => st.updateTrack(track.id, { duck: v ? { source: v, amount: track.duck?.amount ?? 12 } : null })}
          options={[{ value: "", label: "Off" }, ...others.filter((t) => t.id !== track.id).map((t) => ({ value: t.id, label: t.name }))]}
        />
      </Row>
      {track.duck && (
        <Row label={`Dip ${track.duck.amount} dB`}>
          <Slider label="Ducking depth" value={track.duck.amount} min={3} max={30} step={1} onStart={() => st.checkpoint()} onChange={(v) => live({ duck: { ...track.duck!, amount: v } })} />
        </Row>
      )}
      <div className="mt-2 space-y-1.5 rounded-sm border border-line-dark p-2">
        <div className="flex items-center justify-between">
          <span className="label-mono text-paper-dim">Volume automation</span>
          <span className="font-mono text-[12px] text-paper-dim">{auto.length} pts</span>
        </div>
        <div className="flex flex-wrap gap-1">
          <TextButton
            className="h-8 px-2 sm:h-7"
            onClick={() => {
              const playhead = getStudio().playhead;
              const v = autoValue(auto, playhead);
              st.commit((p) => P.updateTrack(p, track.id, (t) => ({ ...t, automation: [...(t.automation ?? []).filter((a) => Math.abs(a.beat - playhead) > 0.01), { beat: playhead, value: auto.length ? v : 1 }].sort((a, b) => a.beat - b.beat) })));
            }}
          >
            Point at playhead
          </TextButton>
          <TextButton
            className="h-8 px-2 sm:h-7"
            onClick={() => {
              const end = P.projectLength(st.project);
              st.commit((p) => P.updateTrack(p, track.id, { automation: [{ beat: 0, value: 0 }, { beat: Math.min(8, end / 4), value: 1 }, { beat: Math.max(8, end - 8), value: 1 }, { beat: end, value: 0 }] }));
            }}
          >
            Fade in & out
          </TextButton>
          {auto.length > 0 && (
            <TextButton className="h-8 px-2 sm:h-7" onClick={() => st.updateTrack(track.id, { automation: [] })}>
              Clear
            </TextButton>
          )}
        </div>
        {auto.map((pt, i) => (
          <div key={`${pt.beat}-${i}`} className="flex items-center gap-1.5">
            <span className="w-14 shrink-0 font-mono text-[12px] text-paper-dim">b{(pt.beat / st.project.sig + 1).toFixed(1)}</span>
            <Slider label={`Automation point ${i + 1}`} value={pt.value} min={0} max={1.5} step={0.01} neutral={1} onStart={() => st.checkpoint()} onChange={(v) => live({ automation: auto.map((a, k) => (k === i ? { ...a, value: v } : a)) })} />
            <IconButton label="Remove point" onClick={() => st.updateTrack(track.id, { automation: auto.filter((_, k) => k !== i) })}>
              <Trash2 aria-hidden className="size-3.5" />
            </IconButton>
          </div>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1">
        <TextButton onClick={() => st.duplicateTrack(track.id)}>Duplicate</TextButton>
        {track.kind !== "audio" ? <TextButton onClick={() => void bounceTrack(track.id)}>Bounce to audio</TextButton> : <TextButton onClick={() => st.updateTrack(track.id, { armed: !track.armed })}>{track.armed ? "Disarm" : "Arm to record"}</TextButton>}
        <TextButton tone="danger" className="col-span-2" onClick={() => st.removeTrack(track.id)}>
          Delete track
        </TextButton>
      </div>
    </Section>
  );
}

function FxRack({ title, effects, onChange, live, defaultOpen = true }: { title: string; effects: Effect[]; onChange: (fx: Effect[]) => void; live: (fx: Effect[]) => void; defaultOpen?: boolean }) {
  const st = getStudio();
  const add = (type: EffectType) => onChange([...effects, P.makeEffect(type)]);
  const preset = (id: string) => {
    const pr = FX_PRESETS.find((f) => f.id === id);
    if (pr) onChange(pr.chain.map((f) => P.makeEffect(f.type, f.params)));
  };
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= effects.length) return;
    const next = [...effects];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  return (
    <Section title={title} defaultOpen={defaultOpen}>
      <div className="mb-2 grid grid-cols-2 gap-1">
        <Select label="Add an effect" value={"" as string} onChange={(v) => v && add(v as EffectType)} options={[{ value: "", label: "+ Add effect" }, ...EFFECTS.map((e) => ({ value: e.type, label: e.label }))]} />
        <Select label="Effect preset" value={"" as string} onChange={(v) => v && preset(v)} options={[{ value: "", label: "Presets…" }, ...FX_PRESETS.map((f) => ({ value: f.id, label: f.label }))]} />
      </div>
      {!effects.length && <p className="text-[12px] text-paper-dim">No effects yet. Try a preset like “Pop star” on a vocal.</p>}
      <div className="space-y-2">
        {effects.map((fx, i) => {
          const def = effectDef(fx.type);
          return (
            <div key={fx.id} className={cn("rounded-sm border border-line-dark", !fx.on && "opacity-55")}>
              <div className="flex items-center gap-0.5 border-b border-line-dark px-1.5 py-1">
                <IconButton label={fx.on ? `Turn ${def.label} off` : `Turn ${def.label} on`} active={fx.on} onClick={() => onChange(effects.map((e) => (e.id === fx.id ? { ...e, on: !e.on } : e)))} className="size-7 sm:size-6">
                  <Power aria-hidden className="size-3.5" />
                </IconButton>
                <span className="min-w-0 flex-1 truncate pl-1 text-[12px] font-medium text-paper" title={def.hint}>
                  {def.label}
                </span>
                <IconButton label="Move up" onClick={() => move(i, -1)} className="size-7 sm:size-6">
                  <ChevronUp aria-hidden className="size-3.5" />
                </IconButton>
                <IconButton label="Move down" onClick={() => move(i, 1)} className="size-7 sm:size-6">
                  <ChevronDown aria-hidden className="size-3.5" />
                </IconButton>
                <IconButton label={`Remove ${def.label}`} onClick={() => onChange(effects.filter((e) => e.id !== fx.id))} className="size-7 sm:size-6">
                  <Trash2 aria-hidden className="size-3.5" />
                </IconButton>
              </div>
              <div className="px-2 py-1">
                {def.params.map((p) => {
                  const v = fx.params[p.key] ?? p.def;
                  return (
                    <Row key={p.key} label={p.label}>
                      <Slider label={`${def.label} ${p.label}`} value={v} min={p.min} max={p.max} step={p.step} onStart={() => st.checkpoint()} onChange={(nv) => live(effects.map((e) => (e.id === fx.id ? { ...e, params: { ...e.params, [p.key]: nv } } : e)))} />
                      <span className="w-[52px] shrink-0 text-right font-mono text-[12px] text-paper-dim">
                        {p.step >= 1 ? Math.round(v) : v.toFixed(p.step < 0.01 ? 3 : 2)}
                        {p.unit === "dB" || p.unit === "Hz" || p.unit === "s" ? p.unit : ""}
                      </span>
                    </Row>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function MasterFx() {
  const fx = useStudio((s) => s.project.master.fx);
  return (
    <FxRack
      title="Master effects"
      defaultOpen={false}
      effects={fx}
      onChange={(next) => getStudio().commit((p) => ({ ...p, master: { ...p.master, fx: next } }))}
      live={(next) => getStudio().live((p) => ({ ...p, master: { ...p.master, fx: next } }))}
    />
  );
}
