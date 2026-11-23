import { createStore, del, get, set } from "idb-keyval";
import { SAMPLE_RATE } from "../constants";
import type { AssetMeta, Pcm } from "../types";
import { mixDown, peaks } from "./dsp";
import { encodeWav, toAudioBuffer } from "./encode";

/**
 * Audio the project uses (recordings, imports, edits, AI renders) lives in this browser's
 * IndexedDB as the original file; decoded copies are kept in memory for playback. Nothing is
 * uploaded. Every asset is decoded at the project rate (48 kHz) so timing maths stays simple.
 */

export const db = createStore("dwyl-music-studio", "kv");

const buffers = new Map<string, AudioBuffer>();
const loading = new Map<string, Promise<AudioBuffer | null>>();
const overview = new Map<string, Float32Array>();

export const uid = () => (crypto.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`).replace(/-/g, "").slice(0, 16);

async function decodeBlob(blob: Blob): Promise<AudioBuffer> {
  const bytes = await blob.arrayBuffer();
  try {
    const ctx = new OfflineAudioContext(2, 1, SAMPLE_RATE);
    return await ctx.decodeAudioData(bytes.slice(0));
  } catch {
    // Formats the browser's decoder refuses (some MKV/AVI/FLAC-in-MKV…): Mediabunny demuxes them.
    const mb = await import("mediabunny");
    const input = new mb.Input({ source: new mb.BlobSource(blob), formats: mb.ALL_FORMATS });
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new Error("That file has no sound in it.");
    const sink = new mb.AudioBufferSink(track);
    const parts: AudioBuffer[] = [];
    for await (const { buffer } of sink.buffers()) parts.push(buffer);
    if (!parts.length) throw new Error("That file's sound couldn't be read.");
    const ch = Math.min(2, parts[0].numberOfChannels);
    const len = parts.reduce((a, b) => a + b.length, 0);
    const joined = new AudioBuffer({ length: len, numberOfChannels: ch, sampleRate: parts[0].sampleRate });
    let o = 0;
    for (const b of parts) {
      for (let c = 0; c < ch; c++) joined.copyToChannel(b.getChannelData(Math.min(c, b.numberOfChannels - 1)), c, o);
      o += b.length;
    }
    if (joined.sampleRate === SAMPLE_RATE) return joined;
    // Resample to the project rate through an offline context.
    const off = new OfflineAudioContext(ch, Math.ceil((len * SAMPLE_RATE) / joined.sampleRate), SAMPLE_RATE);
    const src = off.createBufferSource();
    src.buffer = joined;
    src.connect(off.destination);
    src.start();
    return off.startRendering();
  }
}

function metaFor(id: string, name: string, buf: AudioBuffer, size: number): AssetMeta {
  return { id, name, duration: buf.duration, sampleRate: buf.sampleRate, channels: buf.numberOfChannels, size, createdAt: Date.now() };
}

/** Stores a file (any audio or video with sound) and returns its metadata and decoded audio. */
export async function addAssetFile(file: Blob, name: string): Promise<{ meta: AssetMeta; buffer: AudioBuffer }> {
  const buffer = await decodeBlob(file);
  if (buffer.duration > 60 * 60) throw new Error("Files up to an hour long can be added.");
  const id = uid();
  await set(`asset:${id}`, file, db);
  buffers.set(id, buffer);
  return { meta: metaFor(id, name, buffer, file.size), buffer };
}

/** Stores audio made on the device (an edit, a render, a recording) as a lossless WAV. */
export async function addAssetPcm(src: AudioBuffer | Pcm, name: string): Promise<{ meta: AssetMeta; buffer: AudioBuffer }> {
  const buffer = src instanceof AudioBuffer ? src : toAudioBuffer(src);
  const blob = encodeWav(buffer, 32);
  const id = uid();
  await set(`asset:${id}`, blob, db);
  buffers.set(id, buffer);
  return { meta: metaFor(id, name, buffer, blob.size), buffer };
}

export const bufferNow = (id: string | undefined) => (id ? buffers.get(id) : undefined);

export function loadBuffer(id: string): Promise<AudioBuffer | null> {
  const have = buffers.get(id);
  if (have) return Promise.resolve(have);
  let p = loading.get(id);
  if (!p) {
    p = (async () => {
      const blob = (await get(`asset:${id}`, db)) as Blob | undefined;
      if (!blob) return null;
      const buf = await decodeBlob(blob);
      buffers.set(id, buf);
      return buf;
    })()
      .catch((e) => {
        console.error("[music] couldn't load an asset", e);
        return null;
      })
      .finally(() => loading.delete(id));
    loading.set(id, p);
  }
  return p;
}

export async function assetBlob(id: string): Promise<Blob | undefined> {
  return (await get(`asset:${id}`, db)) as Blob | undefined;
}

export async function putAssetBlob(id: string, blob: Blob) {
  await set(`asset:${id}`, blob, db);
}

export async function deleteAssetData(id: string) {
  buffers.delete(id);
  overview.delete(id);
  await del(`asset:${id}`, db);
}

/** A cached overview (min/max pairs at ~200 per second) for drawing clips quickly. */
export function overviewPeaks(id: string): { data: Float32Array; perSec: number } | null {
  const buf = buffers.get(id);
  if (!buf) return null;
  const perSec = 200;
  let o = overview.get(id);
  if (!o) {
    const mono = buf.numberOfChannels > 1 ? mixDown([buf.getChannelData(0), buf.getChannelData(1)]) : buf.getChannelData(0);
    o = peaks(mono, Math.max(1, Math.ceil(buf.duration * perSec)));
    overview.set(id, o);
  }
  return { data: o, perSec };
}

/** Clears cached peaks after an asset's audio changes. */
export const forgetPeaks = (id: string) => overview.delete(id);
