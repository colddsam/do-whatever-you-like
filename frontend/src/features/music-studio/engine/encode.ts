import type { Pcm } from "../types";

/**
 * Audio file writers. WAV is written here; MP3 (LAME compiled to WebAssembly), AAC (.m4a) and
 * Opus (.ogg) go through Mediabunny, loaded only when someone exports one of them.
 */

export type ExportFormat = "wav16" | "wav24" | "wav32" | "mp3" | "m4a" | "ogg";

export const FORMATS: { id: ExportFormat; label: string; ext: string; mime: string; lossy: boolean }[] = [
  { id: "wav16", label: "WAV · 16-bit (CD)", ext: "wav", mime: "audio/wav", lossy: false },
  { id: "wav24", label: "WAV · 24-bit (studio)", ext: "wav", mime: "audio/wav", lossy: false },
  { id: "wav32", label: "WAV · 32-bit float", ext: "wav", mime: "audio/wav", lossy: false },
  { id: "mp3", label: "MP3", ext: "mp3", mime: "audio/mpeg", lossy: true },
  { id: "m4a", label: "AAC (.m4a)", ext: "m4a", mime: "audio/mp4", lossy: true },
  { id: "ogg", label: "Opus (.ogg)", ext: "ogg", mime: "audio/ogg", lossy: true },
];

export function toPcm(buf: AudioBuffer): Pcm {
  return { sampleRate: buf.sampleRate, channels: Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c)) };
}

export function toAudioBuffer(pcm: Pcm): AudioBuffer {
  const b = new AudioBuffer({ length: Math.max(1, pcm.channels[0]?.length ?? 1), numberOfChannels: Math.max(1, pcm.channels.length), sampleRate: pcm.sampleRate });
  pcm.channels.forEach((ch, c) => b.copyToChannel(ch as Float32Array<ArrayBuffer>, c));
  return b;
}

export function encodeWav(src: AudioBuffer | Pcm, bits: 16 | 24 | 32 = 16): Blob {
  const pcm = src instanceof AudioBuffer ? toPcm(src) : src;
  const ch = pcm.channels.length;
  const len = pcm.channels[0].length;
  const bytes = bits / 8;
  const data = len * ch * bytes;
  const buf = new ArrayBuffer(44 + data);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + data, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, bits === 32 ? 3 : 1, true);
  v.setUint16(22, ch, true);
  v.setUint32(24, pcm.sampleRate, true);
  v.setUint32(28, pcm.sampleRate * ch * bytes, true);
  v.setUint16(32, ch * bytes, true);
  v.setUint16(34, bits, true);
  str(36, "data");
  v.setUint32(40, data, true);
  let o = 44;
  // Triangular dither when reducing to 16-bit keeps quiet fades smooth.
  let seed = 22222;
  const tpdf = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const a = seed / 4294967296;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return a - seed / 4294967296;
  };
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, pcm.channels[c][i]));
      if (bits === 16) v.setInt16(o, Math.max(-32768, Math.min(32767, Math.round(s * 32767 + tpdf()))), true);
      else if (bits === 24) {
        const x = Math.round(s * 8388607);
        v.setUint8(o, x & 0xff);
        v.setUint8(o + 1, (x >> 8) & 0xff);
        v.setUint8(o + 2, (x >> 16) & 0xff);
      } else v.setFloat32(o, s, true);
      o += bytes;
    }
  }
  return new Blob([buf], { type: "audio/wav" });
}

let mp3Registered = false;

/** Compressed formats through Mediabunny (WebCodecs, plus the LAME WASM encoder for MP3). */
export async function encodeCompressed(buf: AudioBuffer, format: "mp3" | "m4a" | "ogg", kbps = 192): Promise<Blob> {
  const mb = await import("mediabunny");
  if (format === "mp3" && !mp3Registered && !(await mb.canEncodeAudio("mp3"))) {
    const { registerMp3Encoder } = await import("@mediabunny/mp3-encoder");
    registerMp3Encoder();
    mp3Registered = true;
  }
  const codec = format === "mp3" ? "mp3" : format === "m4a" ? "aac" : "opus";
  if (!(await mb.canEncodeAudio(codec, { numberOfChannels: buf.numberOfChannels, sampleRate: buf.sampleRate, bitrate: kbps * 1000 }))) {
    throw new Error(format === "mp3" ? "MP3 encoding isn't available in this browser." : `This browser can't encode ${format === "m4a" ? "AAC" : "Opus"}. Choose WAV or MP3.`);
  }
  const target = new mb.BufferTarget();
  const outFormat = format === "mp3" ? new mb.Mp3OutputFormat() : format === "m4a" ? new mb.Mp4OutputFormat() : new mb.OggOutputFormat();
  const output = new mb.Output({ format: outFormat, target });
  const source = new mb.AudioBufferSource({ codec, bitrate: kbps * 1000 });
  output.addAudioTrack(source);
  await output.start();
  // Feed it in ~10 s pieces so a long song doesn't hold one giant copy.
  const step = buf.sampleRate * 10;
  for (let s = 0; s < buf.length; s += step) {
    const n = Math.min(step, buf.length - s);
    const piece = new AudioBuffer({ length: n, numberOfChannels: buf.numberOfChannels, sampleRate: buf.sampleRate });
    for (let c = 0; c < buf.numberOfChannels; c++) piece.copyToChannel(buf.getChannelData(c).subarray(s, s + n), c);
    await source.add(piece);
  }
  source.close();
  await output.finalize();
  const mime = format === "mp3" ? "audio/mpeg" : format === "m4a" ? "audio/mp4" : "audio/ogg";
  return new Blob([target.buffer!], { type: mime });
}

export async function encodeAudio(buf: AudioBuffer, format: ExportFormat, kbps = 192): Promise<Blob> {
  if (format === "wav16") return encodeWav(buf, 16);
  if (format === "wav24") return encodeWav(buf, 24);
  if (format === "wav32") return encodeWav(buf, 32);
  return encodeCompressed(buf, format, kbps);
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 80) || "song";
