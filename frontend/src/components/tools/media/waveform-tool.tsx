"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Download, RotateCcw, Sparkles } from "lucide-react";
import { saveBlob } from "@/lib/files";
import { formatBytes, formatDuration } from "@/lib/media";
import { getTool, stepsFor } from "@/lib/tools";
import { AudioPreview } from "../audio-preview";
import { FileDrop } from "../file-drop";
import { Workbench } from "../workbench";
import { Chips, Notice, Panel, Row, Slider, TextField, Toggle } from "../pdf/kit";
import { ColorField } from "../utilities/design-engines";

type WaveStyle = "bars" | "line" | "radial" | "spectrogram";
type SpecPalette = "inferno" | "viridis" | "ocean" | "mono";

/* ========================================================================
 * PURE-TS AUDIO DSP: WAVEFORM DOWNSAMPLING + RADIX-2 FFT SPECTROGRAM
 * ======================================================================== */

function computeBars(samples: Float32Array, barCount: number): number[] {
  const step = Math.max(1, Math.floor(samples.length / barCount));
  const peaks: number[] = [];
  let globalMax = 1e-4;
  for (let i = 0; i < barCount; i++) {
    const start = Math.floor((i * samples.length) / barCount);
    const end = Math.min(samples.length, start + step);
    let pk = 0;
    for (let j = start; j < end; j++) {
      const v = Math.abs(samples[j]);
      if (v > pk) pk = v;
    }
    if (pk > globalMax) globalMax = pk;
    peaks.push(pk);
  }
  return peaks.map((p) => Math.max(0.03, p / globalMax));
}

function fftRadix2(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wlenRe = Math.cos(ang);
    const wlenIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let wRe = 1;
      let wIm = 0;
      const half = len >> 1;
      for (let j = 0; j < half; j++) {
        const uRe = re[i + j];
        const uIm = im[i + j];
        const vRe = re[i + j + half] * wRe - im[i + j + half] * wIm;
        const vIm = re[i + j + half] * wIm + im[i + j + half] * wRe;
        re[i + j] = uRe + vRe;
        im[i + j] = uIm + vIm;
        re[i + j + half] = uRe - vRe;
        im[i + j + half] = uIm - vIm;
        const nextWRe = wRe * wlenRe - wIm * wlenIm;
        wIm = wRe * wlenIm + wIm * wlenRe;
        wRe = nextWRe;
      }
    }
  }
}

function paletteColor(t: number, palette: SpecPalette): [number, number, number] {
  const x = Math.max(0, Math.min(1, t));
  if (palette === "mono") {
    const v = Math.round(255 * (1 - x));
    return [v, v, v];
  }
  if (palette === "ocean") {
    return [
      Math.round(12 + 70 * x ** 2),
      Math.round(20 + 210 * x ** 1.3),
      Math.round(45 + 210 * Math.sqrt(x)),
    ];
  }
  if (palette === "viridis") {
    return [
      Math.round(Math.min(255, 68 + 185 * x ** 2.2)),
      Math.round(1 + 230 * Math.sin((x * Math.PI) / 2)),
      Math.round(84 + 90 * Math.sin(x * Math.PI) * (1 - x * 0.5)),
    ];
  }
  // Inferno-like
  return [
    Math.round(Math.min(255, 10 + 360 * x ** 0.85)),
    Math.round(Math.max(0, Math.min(255, 255 * x ** 1.85))),
    Math.round(Math.max(0, Math.min(255, 160 * Math.sin(x * Math.PI) + 90 * x ** 4))),
  ];
}

function makeSampleSynthWav(): Blob {
  const sr = 22050;
  const secs = 4;
  const len = sr * secs;
  const dataBytes = len * 2;
  const buf = new ArrayBuffer(44 + dataBytes);
  const dv = new DataView(buf);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  dv.setUint32(4, 36 + dataBytes, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); // PCM
  dv.setUint16(22, 1, true); // mono
  dv.setUint32(24, sr, true);
  dv.setUint32(28, sr * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  writeStr(36, "data");
  dv.setUint32(40, dataBytes, true);

  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const pulse = 0.55 + 0.45 * Math.sin(2 * Math.PI * 2 * t);
    const fade = Math.min(1, t * 4, (secs - t) * 3);
    const f1 = 220 + 60 * Math.sin(Math.PI * t * 0.5);
    const sample =
      fade *
      pulse *
      (0.45 * Math.sin(2 * Math.PI * f1 * t) +
        0.25 * Math.sin(2 * Math.PI * 330 * t) +
        0.18 * Math.sin(2 * Math.PI * 554.37 * t) +
        0.12 * Math.sin(2 * Math.PI * (880 + 440 * t) * t));
    dv.setInt16(44 + i * 2, Math.max(-32767, Math.min(32767, Math.round(sample * 24000))), true);
  }
  return new Blob([buf], { type: "audio/wav" });
}

export function AudioWaveformTool({ toolId }: { toolId: string }) {
  const tool = getTool(toolId)!;
  const [file, setFile] = useState<File | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [audioData, setAudioData] = useState<{ samples: Float32Array; sampleRate: number; duration: number; channels: number } | null>(null);
  const [decoding, setDecoding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [style, setStyle] = useState<WaveStyle>("bars");
  const [barCount, setBarCount] = useState(110);
  const [waveColor, setWaveColor] = useState("#e85d22");
  const [bgColor, setBgColor] = useState("#18181b");
  const [transparentBg, setTransparentBg] = useState(false);
  const [titleText, setTitleText] = useState("");
  const [palette, setPalette] = useState<SpecPalette>("inferno");
  const [mirrored, setMirrored] = useState(true);
  const [copied, setCopied] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
  }, []);

  async function loadAudio(f: File) {
    setError(null);
    setDecoding(true);
    const u = URL.createObjectURL(f);
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = u;
    setFile(f);
    setBlobUrl(u);
    setTitleText(f.name.replace(/\.[^.]+$/, ""));

    try {
      const ab = await f.arrayBuffer();
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const actx = new Ctx();
      const decoded = await actx.decodeAudioData(ab);
      const len = decoded.length;
      const channels = decoded.numberOfChannels;
      const mono = new Float32Array(len);
      for (let c = 0; c < channels; c++) {
        const ch = decoded.getChannelData(c);
        for (let i = 0; i < len; i++) mono[i] += ch[i] / channels;
      }
      await actx.close();
      setAudioData({ samples: mono, sampleRate: decoded.sampleRate, duration: decoded.duration, channels });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not decode this audio file.");
      setAudioData(null);
    } finally {
      setDecoding(false);
    }
  }

  const vectorSvg = useMemo(() => {
    if (!audioData || style === "spectrogram") return "";
    const W = 1200;
    const H = style === "radial" ? 720 : 380;
    const peaks = computeBars(audioData.samples, barCount);
    const bgRect = transparentBg ? "" : `<rect width="${W}" height="${H}" rx="12" fill="${bgColor}" />`;
    const padX = 48;
    const drawW = W - padX * 2;
    const labelColor = transparentBg ? "#52525b" : "#a1a1aa";
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const header = titleText.trim()
      ? `<text x="${padX}" y="34" font-family="ui-monospace, monospace" font-size="15" fill="${labelColor}">${esc(titleText.trim())} · ${formatDuration(Math.round(audioData.duration))}</text>`
      : "";

    if (style === "bars") {
      const slot = drawW / peaks.length;
      const bw = Math.max(2, slot * 0.62);
      const cy = H / 2 + (titleText.trim() ? 10 : 0);
      const maxAmp = H * 0.38;
      const rects = peaks
        .map((p, i) => {
          const x = Math.round((padX + i * slot + (slot - bw) / 2) * 10) / 10;
          const amp = Math.max(3, p * maxAmp);
          const y = mirrored ? cy - amp : cy + maxAmp - amp * 1.8;
          const h = mirrored ? amp * 2 : amp * 1.8;
          return `<rect x="${x}" y="${Math.round(y * 10) / 10}" width="${Math.round(bw * 10) / 10}" height="${Math.round(h * 10) / 10}" rx="${Math.min(4, bw / 2)}" fill="${waveColor}" />`;
        })
        .join("");
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${bgRect}${header}${rects}</svg>`;
    }

    if (style === "line") {
      const cy = H / 2 + (titleText.trim() ? 10 : 0);
      const maxAmp = H * 0.36;
      const step = drawW / Math.max(1, peaks.length - 1);
      const topPts = peaks.map((p, i) => `${(padX + i * step).toFixed(1)},${(cy - p * maxAmp).toFixed(1)}`);
      const botPts = [...peaks].reverse().map((p, i) => `${(padX + (peaks.length - 1 - i) * step).toFixed(1)},${(cy + (mirrored ? p * maxAmp : 0)).toFixed(1)}`);
      const area = `M${topPts.join(" L")} L${botPts.join(" L")} Z`;
      const stroke = `M${topPts.join(" L")}`;
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${bgRect}${header}<path d="${area}" fill="${waveColor}" fill-opacity="0.28" /><path d="${stroke}" fill="none" stroke="${waveColor}" stroke-width="3" stroke-linejoin="round" /></svg>`;
    }

    // Radial
    const cx = W / 2;
    const cy = H / 2 + (titleText.trim() ? 12 : 0);
    const baseR = 130;
    const maxSpike = 170;
    const lines = peaks
      .map((p, i) => {
        const a = (i / peaks.length) * Math.PI * 2 - Math.PI / 2;
        const r0 = baseR;
        const r1 = baseR + p * maxSpike;
        const x1 = (cx + Math.cos(a) * r0).toFixed(1);
        const y1 = (cy + Math.sin(a) * r0).toFixed(1);
        const x2 = (cx + Math.cos(a) * r1).toFixed(1);
        const y2 = (cy + Math.sin(a) * r1).toFixed(1);
        return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${waveColor}" stroke-width="4" stroke-linecap="round" />`;
      })
      .join("");
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${bgRect}${header}<circle cx="${cx}" cy="${cy}" r="${baseR - 8}" fill="none" stroke="${waveColor}" stroke-opacity="0.25" stroke-width="2" />${lines}</svg>`;
  }, [audioData, style, barCount, waveColor, bgColor, transparentBg, titleText, mirrored]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !audioData) return;
    if (style !== "spectrogram") {
      // Draw crisp SVG onto Canvas so PNG download works identically to SVG preview
      const W = 1200;
      const H = style === "radial" ? 720 : 380;
      canvas.width = W;
      canvas.height = H;
      const img = new Image();
      img.onload = () => {
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.clearRect(0, 0, W, H);
        ctx.drawImage(img, 0, 0, W, H);
      };
      img.src = `data:image/svg+xml;utf8,${encodeURIComponent(vectorSvg)}`;
      return;
    }

    // STFT Spectrogram rendering
    const W = 1024;
    const H = 440;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d")!;
    const N = 512;
    const bins = N / 2;
    const cols = 320;
    const hann = new Float64Array(N);
    for (let i = 0; i < N; i++) hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (N - 1)));
    const re = new Float64Array(N);
    const im = new Float64Array(N);

    const specImg = ctx.createImageData(cols, bins);
    const maxStart = Math.max(1, audioData.samples.length - N);
    for (let col = 0; col < cols; col++) {
      const start = Math.floor((col / cols) * maxStart);
      for (let i = 0; i < N; i++) {
        re[i] = (audioData.samples[start + i] ?? 0) * hann[i];
        im[i] = 0;
      }
      fftRadix2(re, im);
      for (let b = 0; b < bins; b++) {
        const mag = Math.hypot(re[b], im[b]) / (N * 0.5);
        const db = 20 * Math.log10(mag + 1e-6);
        const norm = (db + 80) / 72; // [-80dB .. -8dB] -> [0..1]
        const [r, g, bl] = paletteColor(norm, palette);
        const row = bins - 1 - b;
        const p = (row * cols + col) * 4;
        specImg.data[p] = r;
        specImg.data[p + 1] = g;
        specImg.data[p + 2] = bl;
        specImg.data[p + 3] = 255;
      }
    }

    const off = document.createElement("canvas");
    off.width = cols;
    off.height = bins;
    off.getContext("2d")!.putImageData(specImg, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(off, 0, 0, W, H);
    if (titleText.trim()) {
      ctx.fillStyle = "rgba(9, 9, 11, 0.55)";
      ctx.fillRect(16, 14, Math.min(W - 32, titleText.length * 11 + 140), 34);
      ctx.fillStyle = "#ffffff";
      ctx.font = "500 14px monospace";
      ctx.fillText(`${titleText.trim()} · ${Math.round(audioData.sampleRate / 1000)} kHz`, 28, 36);
    }
  }, [audioData, style, vectorSvg, palette, titleText]);

  const downloadPng = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const blob = await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), "image/png"));
    const stem = (file?.name ?? "audio").replace(/\.[^.]+$/, "");
    saveBlob(blob, `${stem}-${style}.png`);
  };

  const downloadSvg = () => {
    const stem = (file?.name ?? "audio").replace(/\.[^.]+$/, "");
    if (style !== "spectrogram" && vectorSvg) {
      saveBlob(new Blob([vectorSvg], { type: "image/svg+xml;charset=utf-8" }), `${stem}-${style}.svg`);
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const pngData = canvas.toDataURL("image/png");
    const wrapped = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvas.width} ${canvas.height}" width="${canvas.width}" height="${canvas.height}"><image href="${pngData}" width="${canvas.width}" height="${canvas.height}" /></svg>`;
    saveBlob(new Blob([wrapped], { type: "image/svg+xml;charset=utf-8" }), `${stem}-spectrogram.svg`);
  };

  const copySvg = async () => {
    if (!vectorSvg) return;
    await navigator.clipboard.writeText(vectorSvg);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <Workbench
      steps={stepsFor(tool)}
      current={!file ? 0 : 1}
      footer={<>Audio is decoded with Web Audio API and FFT-transformed locally inside your browser. Zero server uploads.</>}
    >
      <div className="space-y-4 p-4 sm:p-5">
        {!file ? (
          <div className="space-y-3">
            <FileDrop
              accept="audio/*,.mp3,.wav,.ogg,.flac,.m4a,.aac,.webm"
              title="Drop an audio file (MP3, WAV, OGG, FLAC, M4A)"
              formats="MP3 · WAV · OGG · FLAC · M4A · processed locally"
              error={error}
              onFile={(f) => void loadAudio(f)}
            />
            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => void loadAudio(new File([makeSampleSynthWav()], "sample-synth-chord.wav", { type: "audio/wav" }))}
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line bg-surface px-3.5 text-sm text-ink-2 hover:border-ink-3 hover:text-ink"
              >
                <Sparkles aria-hidden className="size-4" /> Load sample synth audio
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-paper px-3.5 py-2.5">
              <div>
                <p className="text-sm font-medium text-ink">{file.name}</p>
                <p className="font-mono text-[12px] text-ink-3">
                  {formatBytes(file.size)}
                  {audioData && ` · ${formatDuration(Math.round(audioData.duration))} · ${audioData.sampleRate} Hz · ${audioData.channels} ch`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => (setFile(null), setBlobUrl(null), setAudioData(null))}
                className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-line bg-surface px-3 text-[12px] text-ink-2 hover:text-ink"
              >
                <RotateCcw aria-hidden className="size-3.5" /> Different audio
              </button>
            </div>

            {blobUrl && <AudioPreview src={blobUrl} blob={file} />}
            {error && <Notice tone="danger">{error}</Notice>}
            {decoding && <Notice tone="info">Decoding audio samples and running FFT analysis…</Notice>}

            {audioData && (
              <>
                <Panel>
                  <Row label="Style">
                    <Chips
                      value={style}
                      onChange={setStyle}
                      options={[
                        { value: "bars", label: "Bars waveform" },
                        { value: "line", label: "Smooth envelope" },
                        { value: "radial", label: "Radial ring" },
                        { value: "spectrogram", label: "FFT Spectrogram" },
                      ]}
                    />
                  </Row>
                  {style === "spectrogram" ? (
                    <Row label="Colourmap">
                      <Chips
                        value={palette}
                        onChange={setPalette}
                        options={[
                          { value: "inferno", label: "Inferno" },
                          { value: "viridis", label: "Viridis" },
                          { value: "ocean", label: "Deep Ocean" },
                          { value: "mono", label: "Monochrome" },
                        ]}
                      />
                    </Row>
                  ) : (
                    <>
                      <Row label="Density">
                        <div className="grid gap-3 @xl:grid-cols-2">
                          <Slider label="Sample bars / points" value={barCount} min={24} max={240} step={2} onChange={setBarCount} />
                          {style !== "radial" && <Toggle checked={mirrored} onChange={setMirrored} label="Symmetrical mirrored wave" />}
                        </div>
                      </Row>
                      <Row label="Colours">
                        <div className="grid gap-3 @xl:grid-cols-2">
                          <ColorField label="Waveform colour" value={waveColor} onChange={setWaveColor} />
                          <ColorField label="Background" value={bgColor} onChange={setBgColor} />
                        </div>
                        <div className="mt-2.5">
                          <Toggle checked={transparentBg} onChange={setTransparentBg} label="Transparent background" />
                        </div>
                      </Row>
                    </>
                  )}
                  <Row label="Track label">
                    <div className="max-w-sm">
                      <TextField value={titleText} onChange={setTitleText} label="Optional track caption" placeholder="Episode 12 — Soundcheck" />
                    </div>
                  </Row>
                </Panel>

                <div className="grid grid-cols-[minmax(0,1fr)]">
                  <div className="overflow-hidden rounded-md border border-line bg-[repeating-conic-gradient(var(--color-paper-2)_0%_25%,var(--color-surface)_0%_50%)] bg-[length:16px_16px] p-4">
                    <canvas ref={canvasRef} className="mx-auto block max-h-[460px] max-w-full rounded-sm object-contain" />
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-end gap-2">
                  {style !== "spectrogram" && vectorSvg && (
                    <button
                      type="button"
                      onClick={() => void copySvg()}
                      className="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-surface px-4 text-sm font-medium text-ink hover:border-ink-3"
                    >
                      {copied ? <Check aria-hidden className="size-4 text-success" /> : <Copy aria-hidden className="size-4" />}
                      {copied ? "Copied SVG" : "Copy SVG"}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={downloadSvg}
                    className="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-surface px-4 text-sm font-medium text-ink hover:border-ink-3"
                  >
                    <Download aria-hidden className="size-4" /> Download SVG
                  </button>
                  <button
                    type="button"
                    onClick={() => void downloadPng()}
                    className="inline-flex h-10 items-center gap-2 rounded-md bg-accent px-5 text-sm font-medium text-white hover:opacity-95"
                  >
                    <Download aria-hidden className="size-4" /> Download PNG
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </Workbench>
  );
}
