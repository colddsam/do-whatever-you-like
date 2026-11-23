import { AudioBufferSource, BufferTarget, CanvasSink, CanvasSource, getFirstEncodableAudioCodec, getFirstEncodableVideoCodec, Mp4OutputFormat, Output, QUALITY_HIGH, WebMOutputFormat } from "mediabunny";
import { evalAnim } from "../lib/keyframes";
import { srcOffset, srcSpan } from "../lib/speed";
import { frameRound, rt, uid } from "../lib/time";
import * as TL from "../lib/timeline";
import { useStudio } from "../store/studio-store";
import type { Clip, MediaAsset } from "../types";
import { SourceAudio } from "./audio";
import { mediaRuntime, openInput } from "./media";
import { analyzeMedia } from "./persistence";
import { getEngine } from "./playback";

/**
 * Clip tools that make new media on this device: freeze frames (an exact still of one frame) and
 * reverse (a backwards copy of the clip's stretch of source, picture and sound). Both are added to
 * the project's media like an import, so they're saved, exported and undone like anything else.
 */

export type ToolProgress = (fraction: number, label?: string) => void;

/** Saves a file this editor made (a still, a reversed copy, a recording, a sound) and adds it to the project. */
export async function addGeneratedFile(file: File): Promise<MediaAsset> {
  const asset = await mediaRuntime.importFile(file);
  useStudio.getState().commit((p) => ({ ...p, media: { ...p.media, [asset.id]: asset } }));
  void analyzeMedia(asset);
  return asset;
}

function toBlob(canvas: HTMLCanvasElement | OffscreenCanvas, type = "image/png", quality?: number): Promise<Blob> {
  if ("convertToBlob" in canvas) return canvas.convertToBlob({ type, quality });
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't capture the frame."))), type, quality));
}

/** The exact frame of a video at a source time, as a PNG. */
export async function grabFrame(mediaId: string, time: number): Promise<Blob> {
  const file = mediaRuntime.file(mediaId);
  if (!file) throw new Error("This clip's media isn't on this device.");
  const input = openInput(file);
  try {
    const vt = await input.getPrimaryVideoTrack();
    if (!vt) throw new Error("This clip has no picture.");
    const sink = new CanvasSink(vt);
    const wc = (await sink.getCanvas(Math.max(0, time) + 1e-4)) ?? (await sink.getCanvas(0));
    if (!wc) throw new Error("Couldn't decode that frame.");
    return await toBlob(wc.canvas);
  } finally {
    input.dispose();
  }
}

/**
 * Freeze frame (Premiere's "Insert Frame Hold Segment", CapCut's Freeze): splits the clip at the
 * playhead and inserts a still of that exact frame for `hold` seconds, pushing the rest later.
 */
export async function freezeFrame(clipId: string, hold = 2) {
  const st = useStudio.getState();
  const c = st.project.clips[clipId];
  if (!c || c.kind !== "video" || !c.mediaId) throw new Error("Select a video clip to freeze a frame of it.");
  const t = frameRound(Math.min(c.start + c.duration - 1e-3, Math.max(c.start, st.playhead)), st.project.settings.fps);
  const local = t - c.start;
  const m = st.project.media[c.mediaId];
  const png = await grabFrame(c.mediaId, c.in + srcOffset(c, local));
  const asset = await addGeneratedFile(new File([png], `${m?.name ?? "Frame"} · freeze ${t.toFixed(2)}s.png`, { type: "image/png" }));
  let made: string | null = null;
  useStudio.getState().commit((p) => {
    const cur = p.clips[clipId];
    if (!cur) return p;
    const next = TL.insertGap(p, t, hold);
    // The still keeps the clip's look at that moment: its transform, effects (as static values) and flips.
    const still: Clip = TL.newClip(next, {
      trackId: cur.trackId,
      kind: "image",
      mediaId: asset.id,
      name: `Freeze · ${cur.name}`,
      start: t,
      duration: hold,
      fit: cur.fit,
      blend: cur.blend,
      flipH: cur.flipH,
      flipV: cur.flipV,
      backdrop: cur.backdrop,
      transform: {
        x: { v: evalAnim(cur.transform.x, local) },
        y: { v: evalAnim(cur.transform.y, local) },
        scaleX: { v: evalAnim(cur.transform.scaleX, local) },
        scaleY: { v: evalAnim(cur.transform.scaleY, local) },
        rotation: { v: evalAnim(cur.transform.rotation, local) },
        opacity: { v: evalAnim(cur.transform.opacity, local) },
      },
      effects: cur.effects
        .filter((e) => e.type !== "bgRemoval")
        .map((e) => ({ ...e, id: uid("fx"), params: Object.fromEntries(Object.entries(e.params).map(([k, a]) => [k, { v: evalAnim(a, local) }])) })),
    });
    made = still.id;
    return TL.placeClips(next, [still]);
  });
  if (made) useStudio.getState().set({ selection: [made] });
}

/**
 * Reverse: renders the clip's stretch of source backwards (picture and sound) into a new file and
 * points the clip, and its linked sound, at it. Frames are decoded in short windows walking back
 * from the end, so memory stays flat however long the clip is.
 */
export async function reverseClip(clipId: string, onProgress?: ToolProgress) {
  const st = useStudio.getState();
  const c = st.project.clips[clipId];
  if (!c || !c.mediaId || (c.kind !== "video" && c.kind !== "audio")) throw new Error("Select a video or sound clip to reverse.");
  const group = [c, ...TL.linked(st.project, c)].filter((x) => x.mediaId === c.mediaId);
  const m = st.project.media[c.mediaId];
  const file = mediaRuntime.file(c.mediaId);
  if (!m || !file) throw new Error("This clip's media isn't on this device.");
  const a = Math.max(0, c.in);
  const b = Math.min(m.duration || Infinity, c.in + srcSpan(c));
  if (b - a > 180) throw new Error("Reverse works on up to 3 minutes at a time. Split the clip first.");
  const wantVideo = m.hasVideo && group.some((x) => x.kind === "video");
  const wantAudio = m.hasAudio && group.some((x) => x.kind === "audio");

  const input = openInput(file);
  const target = new BufferTarget();
  let outW = 0;
  let outH = 0;
  let webm = false;
  try {
    const vt = wantVideo ? await input.getPrimaryVideoTrack() : null;
    if (vt) {
      const scale = Math.min(1, 1080 / Math.max(1, Math.min(m.width, m.height)));
      outW = Math.max(2, Math.round((m.width * scale) / 2) * 2);
      outH = Math.max(2, Math.round((m.height * scale) / 2) * 2);
    }
    const vCodec = vt ? await getFirstEncodableVideoCodec(["avc", "vp9", "vp8"], { width: outW, height: outH }) : null;
    webm = vCodec !== null && vCodec !== "avc";
    const aCodec = wantAudio ? await getFirstEncodableAudioCodec(webm ? ["opus"] : ["aac", "opus"]) : null;
    if (vt && !vCodec) throw new Error("This browser can't encode video, so it can't make the reversed copy.");
    const output = new Output({ format: webm ? new WebMOutputFormat() : new Mp4OutputFormat({ fastStart: "in-memory" }), target });
    const canvas = vt ? new OffscreenCanvas(outW, outH) : null;
    const vSource = vt && vCodec && canvas ? new CanvasSource(canvas, { codec: vCodec, quality: QUALITY_HIGH }) : null;
    const fps = m.fps || st.project.settings.fps;
    if (vSource) output.addVideoTrack(vSource, { frameRate: fps });
    const aSource = aCodec ? new AudioBufferSource({ codec: aCodec, quality: QUALITY_HIGH }) : null;
    if (aSource) output.addAudioTrack(aSource);
    await output.start();

    const span = b - a;
    if (vt && vSource && canvas) {
      const ctx = canvas.getContext("2d")!;
      const sink = new CanvasSink(vt, { width: outW, height: outH, fit: "fill" });
      const win = Math.max(0.25, Math.min(1, 15 / fps));
      let out = 0;
      for (let we = b; we > a + 1e-6; we -= win) {
        const ws = Math.max(a, we - win);
        const frames: { canvas: HTMLCanvasElement | OffscreenCanvas; t: number }[] = [];
        for await (const wc of sink.canvases(ws, we)) frames.push({ canvas: wc.canvas, t: wc.timestamp });
        for (let i = frames.length - 1; i >= 0; i--) {
          ctx.drawImage(frames[i].canvas, 0, 0, outW, outH);
          await vSource.add(out / fps, 1 / fps);
          out++;
        }
        onProgress?.(Math.min(0.9, ((b - ws) / span) * (wantAudio ? 0.8 : 0.95)), "Reversing frames");
      }
      vSource.close();
    }
    if (aSource) {
      const src = new SourceAudio(file);
      try {
        const buf = await src.decodeRange(a, b, 48_000, 2);
        for (let ch = 0; ch < buf.numberOfChannels; ch++) buf.getChannelData(ch).reverse();
        await aSource.add(buf);
      } finally {
        src.dispose();
      }
      aSource.close();
    }
    onProgress?.(0.96, "Saving");
    await output.finalize();
  } finally {
    input.dispose();
  }
  const ext = webm ? "webm" : outW ? "mp4" : "m4a";
  const mime = `${outW ? "video" : "audio"}/${webm ? "webm" : "mp4"}`;
  const out = new File([target.buffer!], `${m.name.replace(/\.[^.]+$/, "")} (reversed).${ext}`, { type: mime });
  const asset = await addGeneratedFile(out);
  useStudio.getState().commit((p) => {
    let next = p;
    for (const x of group) {
      next = TL.updateClip(next, x.id, (cl) => {
        const ramp = cl.speedRamp?.map((pt) => ({ t: rt(cl.duration - pt.t), v: pt.v })).reverse();
        const { stabilize: _s, ...rest } = cl;
        void _s;
        return TL.withRamp({ ...rest, mediaId: asset.id, in: 0, reversed: !cl.reversed, name: cl.name.endsWith(" (reversed)") ? cl.name.slice(0, -11) : `${cl.name} (reversed)` }, ramp);
      });
    }
    return next;
  });
  onProgress?.(1);
}

/**
 * Rasterize Clip: renders the clip at project resolution with all active effects, transforms,
 * text/shapes, and chroma keying baked into a lossless transparent PNG image clip.
 */
export async function rasterizeClip(clipId: string) {
  const st = useStudio.getState();
  const c = st.project.clips[clipId];
  if (!c || c.kind === "audio" || c.kind === "adjustment") {
    throw new Error("Select a visual clip (text, shape, solid, video or image) to rasterize.");
  }
  const engine = getEngine();
  if (!engine) throw new Error("Open the video preview to rasterize this clip.");
  const png = await engine.snapshotClip(clipId);
  const asset = await addGeneratedFile(new File([png], `${c.name || "Clip"} · raster.png`, { type: "image/png" }));
  useStudio.getState().commit((p) =>
    TL.updateClip(p, clipId, (x) => ({
      ...x,
      kind: "image",
      mediaId: asset.id,
      name: x.name.endsWith(" (raster)") ? x.name : `${x.name} (raster)`,
      fit: "fill",
      effects: [],
      text: undefined,
      shape: undefined,
      color: undefined,
      gradient: undefined,
      flipH: undefined,
      flipV: undefined,
      backdrop: undefined,
      matte: undefined,
      transform: { ...TL.baseTransform(p), opacity: { v: 1 } },
    })),
  );
  useStudio.getState().notify("Rasterized clip into a transparent PNG image.", "success");
}
