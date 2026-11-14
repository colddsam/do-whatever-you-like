"use client";

import { useEffect, useRef, useState } from "react";
import { Maximize2, Mic, MicOff, Play, Square, Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Chips, Notice, Panel, Row, Slider, Toggle } from "../pdf/kit";
import { ValueList, ValueRow } from "../dev/parts";

/* ================= Mic & speakers ================= */

export function MicSpeakerTest() {
  const [playing, setPlaying] = useState<string | null>(null);
  const [freq, setFreq] = useState(440);
  const [vol, setVol] = useState(30);
  const [mic, setMic] = useState<{ label: string; rate: number; channels: number } | null>(null);
  const [level, setLevel] = useState(0);
  const [peak, setPeak] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [rec, setRec] = useState<"idle" | "recording" | "ready">("idle");
  const [clip, setClip] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const out = useRef<{ ctx: AudioContext; stop: () => void } | null>(null);
  const micRef = useRef<{ ctx: AudioContext; stream: MediaStream; raf: number } | null>(null);
  const wave = useRef<HTMLCanvasElement>(null);

  const stopTone = () => {
    out.current?.stop();
    out.current = null;
    setPlaying(null);
  };
  const tone = (which: "left" | "right" | "both" | "sweep") => {
    stopTone();
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const pan = ctx.createStereoPanner();
    gain.gain.value = vol / 100;
    pan.pan.value = which === "left" ? -1 : which === "right" ? 1 : 0;
    osc.frequency.value = freq;
    if (which === "sweep") {
      osc.frequency.setValueAtTime(20, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(20000, ctx.currentTime + 10);
    }
    osc.connect(gain).connect(pan).connect(ctx.destination);
    osc.start();
    const t = setTimeout(stopTone, which === "sweep" ? 10_000 : 2_500);
    out.current = {
      ctx,
      stop: () => {
        clearTimeout(t);
        try {
          osc.stop();
        } catch {
          /* already stopped */
        }
        void ctx.close();
      },
    };
    setPlaying(which);
  };

  const stopMic = () => {
    const m = micRef.current;
    if (!m) return;
    cancelAnimationFrame(m.raf);
    m.stream.getTracks().forEach((t) => t.stop());
    void m.ctx.close();
    micRef.current = null;
    setMic(null);
    setLevel(0);
  };
  useEffect(() => () => (stopTone(), stopMic()), []);
  useEffect(() => () => {
    if (clip) URL.revokeObjectURL(clip);
  }, [clip]);

  const startMic = async (id = deviceId) => {
    stopMic();
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: id ? { deviceId: { exact: id } } : true });
      const ctx = new AudioContext();
      const an = ctx.createAnalyser();
      an.fftSize = 2048;
      ctx.createMediaStreamSource(stream).connect(an);
      const track = stream.getAudioTracks()[0];
      const s = track.getSettings();
      setMic({ label: track.label || "Microphone", rate: s.sampleRate ?? ctx.sampleRate, channels: s.channelCount ?? 1 });
      setDevices((await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput"));
      if (s.deviceId) setDeviceId(s.deviceId);
      const buf = new Uint8Array(an.fftSize);
      let top = 0;
      const draw = () => {
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += ((v - 128) / 128) ** 2;
        const rms = Math.sqrt(sum / buf.length);
        const lv = Math.min(1, rms * 4);
        top = Math.max(lv, top * 0.98);
        setLevel(lv);
        setPeak(top);
        const c = wave.current;
        if (c) {
          const g = c.getContext("2d")!;
          c.width = c.clientWidth * devicePixelRatio;
          c.height = c.clientHeight * devicePixelRatio;
          g.clearRect(0, 0, c.width, c.height);
          g.strokeStyle = getComputedStyle(c).color;
          g.lineWidth = 2 * devicePixelRatio;
          g.beginPath();
          buf.forEach((v, i) => {
            const x = (i / buf.length) * c.width;
            const y = (v / 255) * c.height;
            if (i) g.lineTo(x, y);
            else g.moveTo(x, y);
          });
          g.stroke();
        }
        micRef.current!.raf = requestAnimationFrame(draw);
      };
      micRef.current = { ctx, stream, raf: requestAnimationFrame(draw) };
    } catch (e) {
      const n = (e as DOMException).name;
      setError(n === "NotAllowedError" ? "Microphone access was blocked. Allow it in the address bar, then try again." : n === "NotFoundError" ? "No microphone was found." : n === "NotReadableError" ? "The microphone is busy in another app." : "The microphone couldn't start.");
    }
  };
  const record = () => {
    const m = micRef.current;
    if (!m) return;
    const r = new MediaRecorder(m.stream);
    const chunks: Blob[] = [];
    r.ondataavailable = (e) => chunks.push(e.data);
    r.onstop = () => {
      setClip(URL.createObjectURL(new Blob(chunks, { type: r.mimeType })));
      setRec("ready");
    };
    r.start();
    setRec("recording");
    setTimeout(() => r.state !== "inactive" && r.stop(), 5000);
  };

  const toneButton = (which: "left" | "right" | "both" | "sweep", label: string) => (
    <button type="button" onClick={() => (playing === which ? stopTone() : tone(which))} className={cn("inline-flex h-11 items-center justify-center gap-2 rounded-md border px-4 text-sm font-medium transition-colors", playing === which ? "border-ink bg-ink text-paper" : "border-line bg-surface text-ink hover:border-ink-3")}>
      {playing === which ? <Square aria-hidden className="size-4" /> : <Play aria-hidden className="size-4" />} {label}
    </button>
  );

  return (
    <>
      <section className="grid gap-3 rounded-md border border-line bg-surface p-4">
        <h3 className="flex items-center gap-2 font-semibold text-ink">
          <Volume2 aria-hidden className="size-4" /> Speakers and headphones
        </h3>
        <div className="grid grid-cols-2 gap-2 @2xl:grid-cols-4">
          {toneButton("left", "Left")}
          {toneButton("both", "Both")}
          {toneButton("right", "Right")}
          {toneButton("sweep", "20 Hz → 20 kHz")}
        </div>
        <div className="grid gap-3 @2xl:grid-cols-2">
          <Slider label="Tone pitch" value={freq} min={100} max={2000} step={10} onChange={setFreq} format={(v) => `${v} Hz`} />
          <Slider label="Tone volume" value={vol} min={5} max={100} onChange={setVol} format={(v) => `${v}%`} />
        </div>
        <p className="text-xs text-ink-3">Left should come only from the left side. The sweep shows your hearing and speaker range: most speakers fade below ~60 Hz, most adults stop hearing above ~15 kHz. Start quiet.</p>
      </section>

      <section className="grid gap-3 rounded-md border border-line bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 font-semibold text-ink">
            <Mic aria-hidden className="size-4" /> Microphone
          </h3>
          {devices.length > 1 && (
            <select value={deviceId} onChange={(e) => (setDeviceId(e.target.value), void startMic(e.target.value))} aria-label="Microphone" className="h-9 max-w-64 rounded-md border border-line bg-surface px-2 text-sm text-ink">
              {devices.map((d, i) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Microphone ${i + 1}`}
                </option>
              ))}
            </select>
          )}
        </div>
        <canvas ref={wave} aria-label="Microphone waveform" className="h-24 w-full rounded-md bg-ink text-paper" />
        <div className="relative h-3 overflow-hidden rounded-full bg-paper-2" aria-label="Input level">
          <div className={cn("absolute inset-y-0 left-0 rounded-full transition-[width] duration-75", level > 0.85 ? "bg-danger" : "bg-success")} style={{ width: `${level * 100}%` }} />
          <div className="absolute inset-y-0 w-0.5 bg-ink" style={{ left: `${peak * 100}%` }} />
        </div>
        <div className="flex flex-wrap gap-2">
          {!mic ? (
            <button type="button" onClick={() => startMic()} className="inline-flex h-11 items-center gap-2 rounded-md bg-ink px-5 text-sm font-medium text-paper hover:opacity-90">
              <Mic aria-hidden className="size-4" /> Test my microphone
            </button>
          ) : (
            <>
              <button type="button" onClick={record} disabled={rec === "recording"} className="inline-flex h-11 items-center gap-2 rounded-md bg-ink px-5 text-sm font-medium text-paper hover:opacity-90 disabled:opacity-50">
                {rec === "recording" ? "Recording 5 seconds…" : "Record 5 seconds"}
              </button>
              <button type="button" onClick={stopMic} className="inline-flex h-11 items-center gap-2 rounded-md border border-line bg-surface px-4 text-sm font-medium text-ink hover:border-ink-3">
                <MicOff aria-hidden className="size-4" /> Stop
              </button>
            </>
          )}
        </div>
        {clip && <audio src={clip} controls className="w-full" aria-label="Your recording" />}
        {error && <Notice tone="danger">{error}</Notice>}
        {mic && (
          <ValueList>
            <ValueRow label="Device" value={mic.label} mono={false} />
            <ValueRow label="Sample rate" value={`${mic.rate.toLocaleString("en")} Hz`} />
            <ValueRow label="Channels" value={mic.channels === 1 ? "1 (mono)" : `${mic.channels} (stereo)`} />
            <ValueRow label="Status" value={peak > 0.05 ? "Picking up sound" : "Silent: speak or tap the mic"} mono={false} />
          </ValueList>
        )}
      </section>
      <Notice>Everything stays in your browser: nothing is recorded or uploaded unless you press Record, and that clip never leaves the page.</Notice>
    </>
  );
}

/* ================= Dead & stuck pixels ================= */

const COLOURS = [
  { name: "Black", value: "#000000", hint: "Bright dots here are stuck pixels." },
  { name: "White", value: "#ffffff", hint: "Dark dots here are dead pixels." },
  { name: "Red", value: "#ff0000", hint: "Any dot that isn't red is a faulty sub-pixel." },
  { name: "Green", value: "#00ff00", hint: "Any dot that isn't green is a faulty sub-pixel." },
  { name: "Blue", value: "#0000ff", hint: "Any dot that isn't blue is a faulty sub-pixel." },
  { name: "Grey", value: "#808080", hint: "Also shows uneven backlight (clouding)." },
];

export function DeadPixelTest() {
  const [full, setFull] = useState<number | null>(null);
  const [auto, setAuto] = useState(false);
  const [mode, setMode] = useState<"colours" | "fixer">("colours");
  const [cursor, setCursor] = useState(true);
  const stage = useRef<HTMLDivElement>(null);
  const fixer = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const onFs = () => {
      if (!document.fullscreenElement) setFull(null);
    };
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);
  useEffect(() => {
    if (full === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " ") setFull((i) => ((i ?? 0) + 1) % COLOURS.length);
      if (e.key === "ArrowLeft") setFull((i) => ((i ?? 0) - 1 + COLOURS.length) % COLOURS.length);
    };
    window.addEventListener("keydown", onKey);
    const t = auto ? setInterval(() => setFull((i) => ((i ?? 0) + 1) % COLOURS.length), 3000) : null;
    return () => {
      window.removeEventListener("keydown", onKey);
      if (t) clearInterval(t);
    };
  }, [full, auto]);
  // The stuck-pixel exerciser: fast random colour noise, which can sometimes free a stuck sub-pixel.
  useEffect(() => {
    if (mode !== "fixer") return;
    const c = fixer.current;
    if (!c) return;
    const g = c.getContext("2d")!;
    let raf = 0;
    const tick = () => {
      const img = g.createImageData(c.width, c.height);
      const r = crypto.getRandomValues(new Uint8Array(c.width * c.height));
      for (let i = 0; i < r.length; i++) {
        const v = r[i] % 4;
        img.data[i * 4] = v === 0 || v === 3 ? 255 : 0;
        img.data[i * 4 + 1] = v === 1 || v === 3 ? 255 : 0;
        img.data[i * 4 + 2] = v === 2 || v === 3 ? 255 : 0;
        img.data[i * 4 + 3] = 255;
      }
      g.putImageData(img, 0, 0);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mode]);

  const go = async (i: number) => {
    setFull(i);
    try {
      await stage.current?.requestFullscreen();
    } catch {
      /* fullscreen refused: the overlay still covers the window */
    }
  };
  const c = full !== null ? COLOURS[full] : null;
  return (
    <>
      <Panel>
        <Row label="Test">
          <Chips value={mode} options={[{ value: "colours", label: "Find dead or stuck pixels" }, { value: "fixer", label: "Try to fix a stuck pixel" }]} onChange={setMode} label="Test" />
        </Row>
        {mode === "colours" && (
          <Row label="Options">
            <div className="flex flex-wrap gap-x-6 gap-y-3">
              <Toggle checked={auto} onChange={setAuto} label="Change colour every 3 seconds" />
              <Toggle checked={cursor} onChange={setCursor} label="Show the pointer" />
            </div>
          </Row>
        )}
      </Panel>
      {mode === "colours" ? (
        <>
          <div className="grid grid-cols-3 gap-px overflow-hidden rounded-md border border-line bg-line @2xl:grid-cols-6">
            {COLOURS.map((col, i) => (
              <button key={col.name} type="button" onClick={() => go(i)} className="group flex flex-col items-center gap-2 bg-surface p-3 text-sm text-ink hover:bg-paper">
                <span className="aspect-video w-full rounded-sm border border-line transition-transform group-hover:scale-105" style={{ background: col.value }} />
                {col.name}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => go(0)} className="inline-flex h-11 w-fit items-center gap-2 rounded-md bg-ink px-5 text-sm font-medium text-paper hover:opacity-90">
            <Maximize2 aria-hidden className="size-4" /> Start the full-screen test
          </button>
          <Notice>Clean the screen first. In full screen, click or press → to go to the next colour, ← to go back, and Esc to leave. Look closely, square by square.</Notice>
        </>
      ) : (
        <>
          <canvas ref={fixer} width={160} height={120} aria-label="Flashing colours" className="h-48 w-full rounded-md border border-line [image-rendering:pixelated]" />
          <Notice tone="warning">This flashes rapidly. Don&apos;t look at it if you&apos;re sensitive to flashing light. Drag this window so the flashing box covers the stuck pixel and leave it for 10–20 minutes. It helps with stuck (coloured) pixels, not dead (black) ones.</Notice>
        </>
      )}
      <div
        ref={stage}
        onClick={() => setFull((i) => (i === null ? null : (i + 1) % COLOURS.length))}
        className={cn("fixed inset-0 z-[90] flex items-end justify-center pb-8", full === null && "hidden", !cursor && "cursor-none")}
        style={{ background: c?.value }}
        role="dialog"
        aria-label={c ? `${c.name} test screen` : undefined}
      >
        {c && (
          <p className={cn("rounded-full px-4 py-2 text-sm transition-opacity delay-1000 duration-700 hover:opacity-100", c.name === "White" || c.name === "Green" ? "bg-black/10 text-black/70" : "bg-white/10 text-white/70", "opacity-0")}>
            {c.name}: {c.hint} Click for the next colour · Esc to leave
          </p>
        )}
      </div>
    </>
  );
}
