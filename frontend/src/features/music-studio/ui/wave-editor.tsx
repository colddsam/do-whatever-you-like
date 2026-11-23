"use client";

import { useEffect, useRef, useState } from "react";
import { ClipboardPaste, Copy, Minus, Play, Plus, Scissors, Square, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { applyEdit, clipPcm, splitStems, humToMidi } from "../actions";
import { bufferNow, loadBuffer } from "../engine/assets";
import * as D from "../engine/dsp";
import * as E from "../engine/edit";
import { transport } from "../engine/transport";
import * as P from "../lib/project";
import { NOTE_NAMES } from "../lib/theory";
import { getStudio, useStudio } from "../store";
import type { Clip } from "../types";
import { capture, IconButton, Select, Slider, TextButton } from "./controls";

/**
 * The audio editor (Audacity's job): the clip's whole file, the part the clip plays shaded,
 * a selection to work on, and destructive edits that each make a new version (so undo works).
 */

export function WaveEditor({ clip }: { clip: Clip }) {
  const assetId = clip.assetId!;
  const meta = useStudio((s) => s.project.assets[assetId]);
  const sel = useStudio((s) => s.waveSel);
  const bpm = useStudio((s) => s.project.bpm);
  const busy = useStudio((s) => Object.keys(s.jobs).length > 0);
  const [zoom, setZoom] = useState(1);
  const [spectro, setSpectro] = useState(false);
  const [ready, setReady] = useState(Boolean(bufferNow(assetId)));
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<number | null>(null);
  const [width, setWidth] = useState(800);
  const dur = meta?.duration ?? 1;

  useEffect(() => {
    let alive = true;
    if (!bufferNow(assetId)) void loadBuffer(assetId).then(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, [assetId]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const W = Math.max(200, Math.round(width * zoom));
  const secToX = (s: number) => (s / dur) * W;

  useEffect(() => {
    const cv = canvas.current;
    const buf = bufferNow(assetId);
    if (!cv || !buf) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const h = cv.clientHeight || 160;
    cv.width = Math.min(16384, Math.round(W * dpr));
    cv.height = Math.round(h * dpr);
    const g = cv.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = "#15140f";
    g.fillRect(0, 0, W, h);
    const ch = buf.numberOfChannels;
    if (spectro) {
      // Spectrogram of the whole file, one FFT per column.
      const mono = ch > 1 ? D.mixDown([buf.getChannelData(0), buf.getChannelData(1)]) : buf.getChannelData(0);
      const n = 1024;
      const re = new Float64Array(n);
      const im = new Float64Array(n);
      const win = D.hann(n);
      const cols = Math.min(W, 2400);
      const img = g.createImageData(cols, 256);
      for (let c = 0; c < cols; c++) {
        const pos = Math.floor((c / cols) * (mono.length - n));
        for (let i = 0; i < n; i++) {
          re[i] = (mono[pos + i] ?? 0) * win[i];
          im[i] = 0;
        }
        D.fft(re, im);
        for (let y = 0; y < 256; y++) {
          // Log-frequency rows: the low end gets room.
          const k = Math.min(n / 2 - 1, Math.floor(2 ** ((y / 256) * Math.log2(n / 2))));
          const db = 20 * Math.log10(Math.hypot(re[k], im[k]) + 1e-9);
          const v = Math.max(0, Math.min(1, (db + 20) / 70));
          const o = ((255 - y) * cols + c) * 4;
          // Ink → accent → paper ramp (the site's palette).
          img.data[o] = v < 0.5 ? 21 + (235 - 21) * v * 2 : 235 + (243 - 235) * (v - 0.5) * 2;
          img.data[o + 1] = v < 0.5 ? 20 + (74 - 20) * v * 2 : 74 + (240 - 74) * (v - 0.5) * 2;
          img.data[o + 2] = v < 0.5 ? 15 + (16 - 15) * v * 2 : 16 + (232 - 16) * (v - 0.5) * 2;
          img.data[o + 3] = 255;
        }
      }
      const tmp = new OffscreenCanvas(cols, 256);
      tmp.getContext("2d")!.putImageData(img, 0, 0);
      g.imageSmoothingEnabled = true;
      g.drawImage(tmp, 0, 0, W, h);
    } else {
      const laneH = h / ch;
      for (let c = 0; c < ch; c++) {
        const data = buf.getChannelData(c);
        const pk = D.peaks(data, Math.min(W, 8000));
        const cols = pk.length / 2;
        const mid = c * laneH + laneH / 2;
        g.fillStyle = "rgba(243,240,232,0.85)";
        for (let x = 0; x < cols; x++) {
          const lo = pk[x * 2];
          const hi = pk[x * 2 + 1];
          const px = (x / cols) * W;
          g.fillRect(px, mid - hi * laneH * 0.48, Math.max(1, W / cols), Math.max(1, (hi - lo) * laneH * 0.48));
        }
        g.fillStyle = "#33312a";
        g.fillRect(0, mid, W, 1);
      }
    }
    // The part of the file the clip plays.
    const a = secToX(clip.offset ?? 0);
    const b = secToX((clip.offset ?? 0) + P.beatsToSec({ bpm }, clip.length));
    g.fillStyle = "rgba(0,0,0,0.45)";
    g.fillRect(0, 0, a, h);
    g.fillRect(b, 0, W - b, h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetId, ready, W, spectro, clip.offset, clip.length, bpm]);

  const timeAt = (clientX: number) => {
    const r = canvas.current!.getBoundingClientRect();
    return Math.max(0, Math.min(dur, ((clientX - r.left) / r.width) * dur));
  };

  const play = async () => {
    const buf = bufferNow(assetId);
    if (!buf) return;
    const s = sel && sel.end - sel.start > 0.01 ? sel : { start: clip.offset ?? 0, end: dur };
    const a = Math.round(s.start * buf.sampleRate);
    const b = Math.round(s.end * buf.sampleRate);
    const part = new AudioBuffer({ length: Math.max(1, b - a), numberOfChannels: buf.numberOfChannels, sampleRate: buf.sampleRate });
    for (let c = 0; c < buf.numberOfChannels; c++) part.copyToChannel(buf.getChannelData(c).subarray(a, b), c);
    await transport.previewBuffer(part);
  };

  const hasSel = Boolean(sel && sel.end - sel.start > 0.005);
  const needSel = (fn: () => void) => () => (hasSel ? fn() : getStudio().notify("Drag across the waveform to select a part first.", "info"));
  const [param, setParam] = useState<{ label: string; unit: string; min: number; max: number; step: number; value: number; apply: (v: number) => void } | null>(null);
  const [analysis, setAnalysis] = useState<{ bpm: number; root: number; mode: "major" | "minor"; sure: boolean } | null>(null);
  const ask = (label: string, unit: string, value: number, min: number, max: number, step: number, apply: (v: number) => void) => setParam({ label, unit, value, min, max, step, apply });

  const tools: { group: string; items: { label: string; title: string; run: () => void }[] }[] = [
    {
      group: "Effects",
      items: [
        { label: "Fade in", title: "Fade the selection (or the whole file) in", run: () => void applyEdit(clip.id, "Fading in", (p, s) => E.fadeIn(p, s)) },
        { label: "Fade out", title: "Fade the selection (or the whole file) out", run: () => void applyEdit(clip.id, "Fading out", (p, s) => E.fadeOut(p, s)) },
        { label: "Normalise", title: "Peak to −1 dB", run: () => void applyEdit(clip.id, "Normalising", (p, s) => E.normalize(p, s, -1)) },
        {
          label: "Amplify…",
          title: "Louder or quieter, in dB",
          run: () => ask("Amplify", "dB", 3, -24, 24, 0.5, (v) => void applyEdit(clip.id, "Amplifying", (p, s) => E.amplify(p, s, v))),
        },
        { label: "Reverse", title: "Play backwards", run: () => void applyEdit(clip.id, "Reversing", (p, s) => E.reverse(p, s)) },
        {
          label: "Speed…",
          title: "Speed and pitch together, like tape",
          run: () => ask("Speed", "%", 110, 25, 400, 1, (v) => void applyEdit(clip.id, "Changing speed", (p, s) => E.speed(p, s, v / 100))),
        },
        {
          label: "Tempo…",
          title: "Faster or slower, same pitch",
          run: () => ask("Tempo", "%", 90, 25, 400, 1, (v) => void applyEdit(clip.id, "Changing tempo", (p, s) => E.tempo(p, s, v / 100))),
        },
        {
          label: "Pitch…",
          title: "Higher or lower, same length",
          run: () => ask("Pitch", "semitones", 2, -24, 24, 1, (v) => void applyEdit(clip.id, "Shifting pitch", (p, s) => E.pitch(p, s, v))),
        },
        { label: "Echo", title: "Repeating echoes", run: () => void applyEdit(clip.id, "Adding echo", (p, s) => E.echo(p, s, 60 / bpm * 0.75, 0.45, 5)) },
        { label: "Bass boost", title: "+6 dB below 160 Hz", run: () => void applyEdit(clip.id, "Boosting bass", (p, s) => E.bassBoost(p, s, 6)) },
        { label: "Invert", title: "Flip the waveform", run: () => void applyEdit(clip.id, "Inverting", (p, s) => E.invert(p, s)) },
      ],
    },
    {
      group: "Clean up",
      items: [
        {
          label: "Noise profile",
          title: "Select a part with only background noise, then click",
          run: needSel(async () => {
            const pcm = await clipPcm(clip);
            if (pcm) {
              E.setNoiseProfile(E.copy(pcm, sel));
              getStudio().notify("Noise profile captured. Now select what to clean (or nothing for all) and click Reduce noise.", "success");
            }
          }),
        },
        { label: "Reduce noise", title: "Removes hiss and hum (learns from the noise profile, or finds the noise itself)", run: () => void applyEdit(clip.id, "Reducing noise", (p, s) => E.denoise(p, s, E.getNoiseProfile(), 18, 1.6)) },
        { label: "Rumble filter", title: "Cuts below 80 Hz (handling noise, traffic)", run: () => void applyEdit(clip.id, "Filtering rumble", (p, s) => E.highPassClean(p, s, 80)) },
        { label: "Leveller", title: "Evens out loud and quiet speech", run: () => void applyEdit(clip.id, "Levelling", (p, s) => E.level(p, s, -20)) },
        { label: "Truncate silence", title: "Shortens long pauses to 0.3 s", run: () => void applyEdit(clip.id, "Shortening pauses", (p, s) => E.truncateSilence(p, s, -40, 0.6, 0.3)) },
        { label: "Auto-tune", title: "Snaps the pitch to the song's key", run: () => void applyEdit(clip.id, "Tuning", (p, s) => E.tune(p, s, getStudio().project, 1, 18)) },
        { label: "Soft tune", title: "Gentle, natural pitch correction", run: () => void applyEdit(clip.id, "Tuning gently", (p, s) => E.tune(p, s, getStudio().project, 0.55, 60)) },
        { label: "Vocal remover", title: "Karaoke: cancels the centre (stereo only)", run: () => void applyEdit(clip.id, "Removing vocals", (p) => E.removeVocals(p)) },
        { label: "Make mono", title: "Both channels the same", run: () => void applyEdit(clip.id, "Making mono", (p) => E.toMono(p)) },
        { label: "Swap L/R", title: "Swap the stereo channels", run: () => void applyEdit(clip.id, "Swapping channels", (p) => E.swapChannels(p)) },
      ],
    },
    {
      group: "AI & analysis",
      items: [
        { label: "Split stems", title: "Vocals, drums, bass and other onto new tracks", run: () => void splitStems(clip.id) },
        { label: "Hum → MIDI", title: "Turns a sung or hummed melody into notes", run: () => void humToMidi(clip.id, { snap: true, instrument: "piano" }) },
        {
          label: "Detect tempo & key",
          title: "Finds the BPM and key, and offers to match the song",
          run: async () => {
            const pcm = await clipPcm(clip);
            if (!pcm) return;
            const mono = D.mixDown(pcm.channels);
            const { bpm: found, confidence } = D.detectBpm(mono, pcm.sampleRate);
            const key = D.detectKey(mono, pcm.sampleRate);
            setAnalysis({ bpm: found, root: key.root, mode: key.mode, sure: confidence > 0.5 });
          },
        },
      ],
    },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-line-dark bg-ink-raised px-1.5 [scrollbar-width:none]">
        <IconButton label="Play the selection" onClick={() => void play()}>
          <Play aria-hidden className="size-4" />
        </IconButton>
        <IconButton label="Stop" onClick={() => void transport.previewBuffer(null)}>
          <Square aria-hidden className="size-3.5" />
        </IconButton>
        <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-line-dark" />
        <IconButton
          label="Cut"
          disabled={busy}
          onClick={needSel(async () => {
            const pcm = await clipPcm(clip);
            if (pcm) E.setClipboard(E.copy(pcm, sel));
            void applyEdit(clip.id, "Cutting", (p, s) => E.remove(p, s!));
          })}
        >
          <Scissors aria-hidden className="size-4" />
        </IconButton>
        <IconButton
          label="Copy"
          onClick={needSel(async () => {
            const pcm = await clipPcm(clip);
            if (pcm) {
              const part = E.copy(pcm, sel);
              E.setClipboard(part);
              getStudio().notify(`Copied ${E.durationOf(part).toFixed(2)} s.`, "info");
            }
          })}
        >
          <Copy aria-hidden className="size-4" />
        </IconButton>
        <IconButton
          label="Paste at the selection start"
          disabled={busy}
          onClick={() => {
            const cb = E.getClipboard();
            if (!cb) return getStudio().notify("Copy or cut something first.", "info");
            const at = sel?.start ?? 0;
            void applyEdit(clip.id, "Pasting", (p) => E.paste(p, at, cb));
          }}
        >
          <ClipboardPaste aria-hidden className="size-4" />
        </IconButton>
        <IconButton label="Delete the selection" disabled={busy} onClick={needSel(() => void applyEdit(clip.id, "Deleting", (p, s) => E.remove(p, s!)))}>
          <Trash2 aria-hidden className="size-4" />
        </IconButton>
        <TextButton className="h-8 px-2 sm:h-7" disabled={busy} onClick={needSel(() => void applyEdit(clip.id, "Silencing", (p, s) => E.silence(p, s!)))}>
          Silence
        </TextButton>
        <TextButton className="h-8 px-2 sm:h-7" disabled={busy} onClick={needSel(() => void applyEdit(clip.id, "Trimming", (p, s) => E.trimTo(p, s!)))} title="Keep only the selection">
          Trim
        </TextButton>
        <TextButton className="h-8 px-2 sm:h-7" onClick={() => getStudio().set({ waveSel: { start: 0, end: dur } })}>
          Select all
        </TextButton>
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <span className="font-mono text-[12px] text-paper-dim">{hasSel ? `${sel!.start.toFixed(2)}–${sel!.end.toFixed(2)} s` : `${dur.toFixed(2)} s`}</span>
          <Select label="View" value={spectro ? "spec" : "wave"} onChange={(v) => setSpectro(v === "spec")} options={[{ value: "wave", label: "Waveform" }, { value: "spec", label: "Spectrogram" }]} className="h-8 w-[108px] flex-none sm:h-7" />
          <IconButton label="Zoom out" onClick={() => setZoom((z) => Math.max(1, z / 1.5))}>
            <Minus aria-hidden className="size-4" />
          </IconButton>
          <IconButton label="Zoom in" onClick={() => setZoom((z) => Math.min(64, z * 1.5))}>
            <Plus aria-hidden className="size-4" />
          </IconButton>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div ref={wrap} className="relative min-h-[120px] min-w-0 flex-1 overflow-x-auto overflow-y-hidden" data-lenis-prevent>
          <div className="relative h-full" style={{ width: W }}>
            <canvas
              ref={canvas}
              className="absolute inset-0 h-full w-full cursor-text touch-none"
              onPointerDown={(e) => {
                capture(e);
                const t = timeAt(e.clientX);
                drag.current = t;
                getStudio().set({ waveSel: { start: t, end: t } });
              }}
              onPointerMove={(e) => {
                if (drag.current === null) return;
                const t = timeAt(e.clientX);
                getStudio().set({ waveSel: { start: Math.min(drag.current, t), end: Math.max(drag.current, t) } });
              }}
              onPointerUp={() => (drag.current = null)}
            />
            {sel && (
              <div aria-hidden className={cn("pointer-events-none absolute inset-y-0", hasSel ? "border-x border-accent bg-accent/20" : "w-px bg-accent")} style={{ left: secToX(sel.start), width: hasSel ? secToX(sel.end) - secToX(sel.start) : undefined }} />
            )}
            {!ready && <p className="absolute inset-0 flex items-center justify-center text-[13px] text-paper-dim">Loading the audio…</p>}
          </div>
        </div>
        <div className="max-h-[42%] shrink-0 overflow-y-auto border-t border-line-dark p-2 lg:max-h-none lg:w-[300px] lg:border-l lg:border-t-0" data-lenis-prevent>
          {param && (
            <div className="mb-2 rounded-sm border border-line-dark p-2">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[12px] text-paper">{param.label}</span>
                <span className="font-mono text-[12px] text-paper-dim">
                  {param.value > 0 && param.unit !== "%" ? "+" : ""}
                  {param.value} {param.unit}
                </span>
              </div>
              <Slider label={param.label} value={param.value} min={param.min} max={param.max} step={param.step} neutral={param.unit === "%" ? 100 : 0} onChange={(v) => setParam({ ...param, value: v })} />
              <div className="mt-2 flex gap-1">
                <TextButton tone="primary" className="h-8 flex-1 sm:h-7" onClick={() => (param.apply(param.value), setParam(null))}>
                  Apply
                </TextButton>
                <TextButton className="h-8 sm:h-7" onClick={() => setParam(null)}>
                  Cancel
                </TextButton>
              </div>
            </div>
          )}
          {analysis && (
            <div className="mb-2 rounded-sm border border-line-dark p-2 text-[12px] text-paper">
              About <b>{analysis.bpm} BPM</b> ({analysis.sure ? "confident" : "a guess"}), key of <b>{NOTE_NAMES[analysis.root]} {analysis.mode}</b>.
              <div className="mt-2 flex gap-1">
                <TextButton
                  tone="primary"
                  className="h-8 flex-1 sm:h-7"
                  onClick={() => {
                    getStudio().commit((p) => ({ ...p, bpm: analysis.bpm, keyRoot: analysis.root, scale: analysis.mode }));
                    setAnalysis(null);
                  }}
                >
                  Match the song
                </TextButton>
                <TextButton className="h-8 sm:h-7" onClick={() => setAnalysis(null)}>
                  Close
                </TextButton>
              </div>
            </div>
          )}
          {tools.map((g) => (
            <div key={g.group} className="mb-2">
              <p className="label-mono mb-1 text-paper-dim">{g.group}</p>
              <div className="flex flex-wrap gap-1">
                {g.items.map((t) => (
                  <button key={t.label} type="button" title={t.title} disabled={busy} onClick={t.run} className="h-8 rounded-sm border border-line-dark px-2 text-[12px] text-paper transition-colors hover:bg-paper/10 disabled:opacity-40 sm:h-7">
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <p className="text-[12px] leading-snug text-paper-dim">Edits apply to the selection, or the whole file when nothing is selected. Each one can be undone.</p>
        </div>
      </div>
    </div>
  );
}
