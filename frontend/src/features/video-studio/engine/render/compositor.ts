import { fitSize } from "../../lib/timeline";
import type { BlendMode, Project, TrackMatteMode, TransitionType } from "../../types";
import { bakeCurvesLut } from "../color";
import { onFontsChanged } from "../fonts";
import { getLut, onLutsChanged } from "../luts";
import { freeTarget, program, quad, target, texture, type Program, type Target } from "./gl";
import { emptyFx, type FxValues, type LayerDraw, type SceneLayer } from "./scene";
import { BLEND_FS, BLUR_FS, COPY_FS, FULLSCREEN_VS, HALATION_FS, LAYER_FS, LAYER_VS, TRANSITION_FS } from "./shaders";
import { ShapeRasterizer } from "./shape";
import { TextRasterizer } from "./text";

/**
 * WebGLCompositor: draws one frame of the timeline with WebGL2.
 *
 * The same class renders the live preview (into an OffscreenCanvas transferred from the page's
 * canvas) and the export (into a full-resolution OffscreenCanvas that WebCodecs encodes), so what
 * you see is what you get. Sources come from a `SourceProvider`: <video> elements while previewing,
 * decoded VideoFrames while exporting.
 *
 * Per frame: clear to the background, then for each layer bottom-up either draw it straight onto the
 * accumulation buffer (the common case: normal blend, no blur or glow) or render it alone into a
 * layer buffer, post-process it (blur, glow) and blend it on with its blend mode. Transitions render
 * both sides into their own buffers and mix them with the transition shader. A clip with a canvas
 * blur first gets a blurred, frame-filling copy of itself drawn underneath.
 */

export type FrameRef = { source: TexImageSource; width: number; height: number; version: string | number };
export type MaskRef = { data: Uint8Array; width: number; height: number; version: string | number };

export interface SourceProvider {
  /** The picture for a video clip at `d.source`, or null to keep showing the last one. */
  frame(d: LayerDraw): FrameRef | null;
  image(mediaId: string): ImageBitmap | null;
  /** An alpha matte (255 = keep) for background removal, or null while it isn't ready. */
  mask(d: LayerDraw): MaskRef | null;
}

const BLEND_ID: Record<BlendMode, number> = {
  normal: 0,
  multiply: 1,
  screen: 2,
  overlay: 3,
  add: 4,
  darken: 5,
  lighten: 6,
  softLight: 7,
  difference: 8,
  colorBurn: 9,
  colorDodge: 10,
  hardLight: 11,
  exclusion: 12,
  hue: 13,
  saturation: 14,
  color: 15,
  luminosity: 16,
};
const MATTE_ID: Record<TrackMatteMode, number> = { none: 0, alpha: 1, alphaInv: 2, luma: 3, lumaInv: 4 };
const TRANSITION_ID: Record<TransitionType, number> = {
  crossDissolve: 0,
  dipToBlack: 1,
  whipPan: 2,
  zoomBlur: 3,
  wipe: 4,
  dipToWhite: 5,
  slide: 6,
  push: 7,
  iris: 8,
  clockWipe: 9,
  zoomIn: 10,
  spin: 11,
  blurDissolve: 12,
  glitch: 13,
  pixelate: 14,
  filmBurn: 15,
  barnDoor: 16,
  lumaDissolve: 17,
};
/** Motion directions in GL texture space (y up). */
const DIR = { left: [-1, 0], right: [1, 0], up: [0, 1], down: [0, -1] } as const;

type Tex = { tex: WebGLTexture; version: string | number | null; w: number; h: number; used: number; mip: boolean };
type ScratchName = "layerA" | "layerB" | "layerT" | "tmp" | "glow" | "back" | "matte" | "compare";

function rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((x) => x + x).join("") : h.padEnd(6, "0").slice(0, 6);
  const n = parseInt(full, 16) || 0;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function seed(id: string) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 10;
}

export class WebGLCompositor {
  readonly gl: WebGL2RenderingContext;
  readonly text: TextRasterizer;
  readonly shapes = new ShapeRasterizer();
  width = 0;
  height = 0;
  lost = false;
  private progs!: { layer: Program; blur: Program; copy: Program; blend: Program; transition: Program; halation: Program };
  private vao!: WebGLVertexArrayObject;
  private accum: Target[] = [];
  private cur = 0;
  private scratchT: Partial<Record<ScratchName, Target>> = {};
  private textures = new Map<string, Tex>();
  private luts = new Map<string, { tex: WebGLTexture; size: number }>();
  private curvesCache = new Map<string, { tex: WebGLTexture; used: number }>();
  private frameNo = 0;
  private empty!: WebGLTexture;
  private emptyCurve!: WebGLTexture;
  private empty3d!: WebGLTexture;
  private scopeTarget: Target | null = null;
  private scopeBuf: Uint8Array | null = null;
  private offLuts: () => void;
  private offFonts: () => void;

  constructor(
    private canvas: HTMLCanvasElement | OffscreenCanvas,
    opts: { preserve?: boolean; onInvalidate?: () => void } = {},
  ) {
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: !!opts.preserve,
      powerPreference: "high-performance",
    }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error("This browser can't run WebGL2, which the editor needs to draw video.");
    this.gl = gl;
    this.text = new TextRasterizer(() => opts.onInvalidate?.());
    this.offLuts = onLutsChanged(() => opts.onInvalidate?.());
    this.offFonts = onFontsChanged(() => {
      this.text.invalidateFonts();
      opts.onInvalidate?.();
    });
    canvas.addEventListener("webglcontextlost", (e: Event) => {
      e.preventDefault();
      this.lost = true;
    });
    canvas.addEventListener("webglcontextrestored", () => {
      this.lost = false;
      this.textures.clear();
      this.luts.clear();
      this.curvesCache.clear();
      this.accum = [];
      this.scratchT = {};
      this.scopeTarget = null;
      this.init();
      this.resize(this.width, this.height, true);
      opts.onInvalidate?.();
    });
    this.init();
  }

  private init() {
    const gl = this.gl;
    this.progs = {
      layer: program(gl, LAYER_VS, LAYER_FS),
      blur: program(gl, FULLSCREEN_VS, BLUR_FS),
      copy: program(gl, FULLSCREEN_VS, COPY_FS),
      blend: program(gl, FULLSCREEN_VS, BLEND_FS),
      transition: program(gl, FULLSCREEN_VS, TRANSITION_FS),
      halation: program(gl, FULLSCREEN_VS, HALATION_FS),
    };
    this.vao = quad(gl).vao;
    this.empty = texture(gl);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    this.emptyCurve = texture(gl);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 2, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255]));
    this.empty3d = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_3D, this.empty3d);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, 1, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindTexture(gl.TEXTURE_3D, null);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
  }

  resize(w: number, h: number, force = false) {
    const W = Math.max(2, Math.round(w / 2) * 2);
    const H = Math.max(2, Math.round(h / 2) * 2);
    if (!force && W === this.width && H === this.height && this.accum.length) return;
    this.width = W;
    this.height = H;
    this.canvas.width = W;
    this.canvas.height = H;
    const gl = this.gl;
    for (const t of [...this.accum, ...Object.values(this.scratchT)]) freeTarget(gl, t);
    this.accum = [target(gl, W, H), target(gl, W, H)];
    this.scratchT = {};
    this.cur = 0;
  }

  private bind(t: Target | null) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fbo : null);
    gl.viewport(0, 0, t ? t.w : this.width, t ? t.h : this.height);
  }

  private scratch(name: ScratchName) {
    return (this.scratchT[name] ??= target(this.gl, this.width, this.height));
  }

  private clearTarget(t: Target) {
    const gl = this.gl;
    this.bind(t);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  private renderSceneToAccum(p: Project, t: number, scene: SceneLayer[], src: SourceProvider, transparent = false) {
    const gl = this.gl;
    const scale = this.width / p.settings.width;
    const [r, g, b] = rgb(p.settings.background);
    this.cur = 0;
    this.bind(this.accum[this.cur]);
    gl.disable(gl.BLEND);
    if (transparent) gl.clearColor(0, 0, 0, 0);
    else gl.clearColor(r, g, b, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    for (const layer of scene) {
      if (layer.kind === "clip") this.drawClip(p, layer.d, src, scale, t);
      else this.drawTransition(p, layer, src, scale, t);
    }
  }

  /** Draws the frame. `t` is timeline time (noise, glitches and leaks are keyed to it, so exports match previews). */
  render(
    p: Project,
    t: number,
    scene: SceneLayer[],
    src: SourceProvider,
    compare?: { x: number; rawScene: SceneLayer[] },
    opts?: { checker?: boolean; transparent?: boolean },
  ) {
    const gl = this.gl;
    if (this.lost || gl.isContextLost() || !this.accum.length) return;
    const clearTransparent = Boolean(opts?.checker || opts?.transparent);
    const showChecker = Boolean(opts?.checker);
    this.frameNo++;
    gl.bindVertexArray(this.vao);
    if (compare) {
      this.renderSceneToAccum(p, t, compare.rawScene, src, clearTransparent);
      const cmp = this.scratch("compare");
      this.bind(cmp);
      gl.disable(gl.BLEND);
      this.copy(this.accum[this.cur].tex, 1, false);
      this.renderSceneToAccum(p, t, scene, src, clearTransparent);
      this.bind(null);
      gl.disable(gl.BLEND);
      const splitPx = Math.max(0, Math.min(this.width, Math.round(compare.x * this.width)));
      gl.enable(gl.SCISSOR_TEST);
      try {
        if (splitPx > 0) {
          gl.scissor(0, 0, splitPx, this.height);
          this.copy(cmp.tex, 1, showChecker);
        }
        if (splitPx < this.width) {
          gl.scissor(splitPx, 0, this.width - splitPx, this.height);
          this.copy(this.accum[this.cur].tex, 1, showChecker);
        }
      } finally {
        gl.disable(gl.SCISSOR_TEST);
      }
    } else {
      this.renderSceneToAccum(p, t, scene, src, clearTransparent);
      this.bind(null);
      gl.disable(gl.BLEND);
      this.copy(this.accum[this.cur].tex, 1, showChecker);
    }
    gl.bindVertexArray(null);
    this.gc();
  }

  private needsOwnBuffer(d: LayerDraw, scale: number) {
    return (
      d.fx.blur * scale >= 0.3 ||
      (!!d.fx.glow && d.fx.glow.intensity > 0.001) ||
      (!!d.fx.halation && d.fx.halation.intensity > 0.001) ||
      d.clip.blend !== "normal" ||
      d.clip.kind === "adjustment" ||
      (!!d.matteMode && d.matteMode !== "none")
    );
  }

  private renderMatte(p: Project, d: LayerDraw, src: SourceProvider, scale: number, t: number): WebGLTexture | null {
    if (!d.matteMode || d.matteMode === "none" || !d.matteDraw) return null;
    const mt = this.scratch("matte");
    this.clearTarget(mt);
    if (!this.drawLayer(p, d.matteDraw, src, scale, t)) return null;
    this.post(mt, d.matteDraw, scale);
    return mt.tex;
  }

  private drawClip(p: Project, d: LayerDraw, src: SourceProvider, scale: number, t: number) {
    if (d.opacity <= 0.001) return;
    const gl = this.gl;
    if (d.backdrop > 0) {
      const back = this.scratch("back");
      this.clearTarget(back);
      if (this.drawBackdrop(p, d, src, scale, t)) {
        this.blur(back, d.backdrop * scale);
        this.composite(back.tex, "normal");
      }
    }
    if (!this.needsOwnBuffer(d, scale)) {
      this.bind(this.accum[this.cur]);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      this.drawLayer(p, d, src, scale, t);
      gl.disable(gl.BLEND);
      return;
    }
    let adjTex: WebGLTexture | null = null;
    if (d.clip.kind === "adjustment") {
      const back = this.scratch("back");
      this.bind(back);
      gl.disable(gl.BLEND);
      this.copy(this.accum[this.cur].tex, 1);
      adjTex = back.tex;
    }
    const matteTex = this.renderMatte(p, d, src, scale, t);
    const la = this.scratch("layerA");
    this.clearTarget(la);
    if (!this.drawLayer(p, d, src, scale, t, adjTex, matteTex)) return;
    this.post(la, d, scale);
    this.composite(la.tex, d.clip.blend);
  }

  /** The clip again, filling the frame (cover), drawn plainly into the bound target: the canvas-blur backdrop. */
  private drawBackdrop(p: Project, d: LayerDraw, src: SourceProvider, scale: number, t: number) {
    const m = d.clip.mediaId ? p.media[d.clip.mediaId] : undefined;
    const W = p.settings.width;
    const H = p.settings.height;
    const [bw, bh] = fitSize(m?.width || W, m?.height || H, W, H, "cover");
    const bd: LayerDraw = { ...d, x: W / 2, y: H / 2, sx: 1.04, sy: 1.04, rot: 0, baseW: bw, baseH: bh, fx: emptyFx(), move: null, backdrop: 0 };
    return this.drawLayer(p, bd, src, scale, t);
  }

  /** Blur, glow and 35mm film halation on a layer that was rendered into its own buffer. */
  private post(tg: Target, d: LayerDraw, scale: number) {
    const gl = this.gl;
    const blurPx = d.fx.blur * scale;
    if (blurPx >= 0.3) this.blur(tg, blurPx);
    const glow = d.fx.glow;
    if (glow && glow.intensity > 0.001) {
      const g = this.scratch("glow");
      this.bind(g);
      gl.disable(gl.BLEND);
      this.copy(tg.tex, 1);
      const r = Math.max(1, glow.radius * scale);
      this.blur(g, r);
      if (r > 24) this.blur(g, r * 0.6);
      this.bind(tg);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      this.copy(g.tex, glow.intensity);
      gl.disable(gl.BLEND);
    }
    const hal = d.fx.halation;
    if (hal && hal.intensity > 0.001) {
      const g = this.scratch("glow");
      const pr = this.progs.halation;
      this.bind(g);
      gl.disable(gl.BLEND);
      gl.useProgram(pr.prog);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tg.tex);
      gl.uniform1i(pr.u("uTex"), 0);
      gl.uniform2f(pr.u("uRes"), this.width, this.height);
      gl.uniform1f(pr.u("uThreshold"), hal.threshold);
      gl.uniform1f(pr.u("uWarmth"), hal.warmth);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      this.blur(g, Math.max(1, hal.radius * scale));
      this.bind(tg);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      this.copy(g.tex, hal.intensity);
      gl.disable(gl.BLEND);
    }
  }

  private drawTransition(p: Project, l: Extract<SceneLayer, { kind: "transition" }>, src: SourceProvider, scale: number, t: number) {
    const gl = this.gl;
    const into = (tg: Target, d: LayerDraw | null) => {
      this.clearTarget(tg);
      if (!d || d.opacity <= 0.001) return false;
      if (d.backdrop > 0) {
        const back = this.scratch("back");
        this.clearTarget(back);
        if (this.drawBackdrop(p, d, src, scale, t)) {
          this.blur(back, d.backdrop * scale);
          this.bind(tg);
          this.copy(back.tex, 1);
        }
      }
      this.bind(tg);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      const drew = this.drawLayer(p, d, src, scale, t);
      gl.disable(gl.BLEND);
      if (drew) this.post(tg, d, scale);
      return drew || d.backdrop > 0;
    };
    const la = this.scratch("layerA");
    const lb = this.scratch("layerB");
    const lt = this.scratch("layerT");
    const hasA = into(la, l.a);
    into(lb, l.b);
    const pr = this.progs.transition;
    this.bind(lt);
    gl.disable(gl.BLEND);
    gl.useProgram(pr.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, la.tex);
    gl.uniform1i(pr.u("uA"), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, lb.tex);
    gl.uniform1i(pr.u("uB"), 1);
    gl.uniform1i(pr.u("uHasA"), hasA ? 1 : 0);
    gl.uniform2f(pr.u("uRes"), this.width, this.height);
    gl.uniform1f(pr.u("uP"), l.progress);
    gl.uniform1i(pr.u("uType"), TRANSITION_ID[l.type] ?? 0);
    const dir = DIR[l.direction] ?? DIR.left;
    gl.uniform2f(pr.u("uDir"), dir[0], dir[1]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.activeTexture(gl.TEXTURE0);
    this.composite(lt.tex, l.b.clip.blend);
  }

  private lutTexture(id: string) {
    const hit = this.luts.get(id);
    if (hit) return hit;
    const data = getLut(id);
    if (!data) return null;
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_3D, tex);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    // 3D uploads from typed arrays must not ask for flips or premultiplication (WebGL2 rule).
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA16F, data.size, data.size, data.size, 0, gl.RGBA, gl.FLOAT, data.data);
    gl.activeTexture(gl.TEXTURE0);
    const out = { tex, size: data.size };
    this.luts.set(id, out);
    return out;
  }

  private curvesTexture(c: NonNullable<FxValues["curves"]>) {
    const key = `${c.points}|${c.r}|${c.g}|${c.b}`;
    let hit = this.curvesCache.get(key);
    const gl = this.gl;
    if (!hit) {
      const lut = bakeCurvesLut(c.points, c.r, c.g, c.b);
      const tex = texture(gl);
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, lut);
      gl.activeTexture(gl.TEXTURE0);
      hit = { tex, used: this.frameNo };
      this.curvesCache.set(key, hit);
    } else hit.used = this.frameNo;
    return hit.tex;
  }

  /** Draws one clip with its transform and effects into the bound target. False when there's nothing to draw yet. */
  private drawLayer(p: Project, d: LayerDraw, src: SourceProvider, scale: number, t: number, adjTex?: WebGLTexture | null, matteTex?: WebGLTexture | null): boolean {
    const gl = this.gl;
    const c = d.clip;
    let tex: Tex | null = null;
    let solid: [number, number, number] | null = null;
    const isAdj = c.kind === "adjustment" && !!adjTex;
    if (c.kind === "solid") solid = rgb(c.color ?? "#000000");
    else if (c.kind === "text" && c.text) {
      const r = this.text.draw(c.text, d.local, scale, p.settings.width, c.duration);
      tex = this.upload(`text:${c.id}`, r.canvas, r.canvas.width, r.canvas.height, r.key);
    } else if (c.kind === "shape" && c.shape) {
      const r = this.shapes.draw(c.id, c.shape, scale, d.baseW, d.baseH);
      tex = this.upload(`shape:${c.id}`, r.canvas, r.canvas.width, r.canvas.height, r.key);
    } else if (c.kind === "image" && c.mediaId) {
      const bmp = src.image(c.mediaId);
      tex = bmp ? this.upload(`img:${c.mediaId}`, bmp, bmp.width, bmp.height, "still") : this.touch(`img:${c.mediaId}`);
    } else if (c.kind === "video") {
      const f = src.frame(d);
      tex = f ? this.upload(`vid:${c.id}`, f.source, f.width, f.height, f.version) : this.touch(`vid:${c.id}`);
    }
    if (!tex && !solid && !isAdj) return false;
    const sizeW = d.baseW * d.sx * scale;
    const sizeH = d.baseH * d.sy * scale;
    if (Math.abs(sizeW) < 0.5 || Math.abs(sizeH) < 0.5) return false;
    const lw = Math.abs(sizeW);
    const lh = Math.abs(sizeH);
    const fx = d.fx;

    const pr = this.progs.layer;
    const u = pr.u;
    gl.useProgram(pr.prog);
    gl.activeTexture(gl.TEXTURE0);
    if (isAdj && adjTex) {
      gl.bindTexture(gl.TEXTURE_2D, adjTex);
    } else if (tex) {
      gl.bindTexture(gl.TEXTURE_2D, tex.tex);
      // A big source drawn small shimmers without mipmaps (4K footage in the preview, say).
      const shrink = Math.min(lw / tex.w, lh / tex.h);
      if (shrink < 0.6) {
        if (!tex.mip) {
          gl.generateMipmap(gl.TEXTURE_2D);
          tex.mip = true;
        }
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      } else gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    } else gl.bindTexture(gl.TEXTURE_2D, this.empty);
    gl.uniform1i(u("uTex"), 0);
    gl.uniform1i(u("uFlipTexY"), isAdj ? 1 : 0);
    gl.uniform2f(u("uRes"), this.width, this.height);
    gl.uniform2f(u("uCenter"), d.x * scale, d.y * scale);
    gl.uniform2f(u("uSize"), sizeW, sizeH);
    gl.uniform1f(u("uRot"), d.rot);
    gl.uniform2f(u("uLayerPx"), lw, lh);
    gl.uniform1f(u("uScale"), scale);
    const sd = seed(c.id);
    gl.uniform1f(u("uTime"), t);
    gl.uniform1f(u("uSeed"), sd);

    // Room around the quad for effects that reach past the picture's edge.
    let margin = fx.split || fx.glitch || fx.vhs > 0 || fx.prism || fx.heatDistort ? 0.08 : 0;
    if (fx.perspective) margin = Math.max(margin, 0.38);
    if (fx.frame && fx.frame.shadow > 0 && fx.frame.size > 0) margin = Math.max(margin, (fx.frame.size * scale * 1.25 + 2) / Math.min(lw, lh));
    gl.uniform1f(u("uMargin"), Math.min(1, margin));

    if (solid) {
      const g = c.gradient ? rgb(c.gradient.color) : null;
      gl.uniform1i(u("uSource"), g ? 2 : 1);
      gl.uniform4f(u("uColor"), solid[0], solid[1], solid[2], 1);
      gl.uniform4f(u("uColor2"), g?.[0] ?? 0, g?.[1] ?? 0, g?.[2] ?? 0, 1);
      gl.uniform1f(u("uGradAngle"), (((c.gradient?.angle ?? 90) - 90) * Math.PI) / 180);
    } else gl.uniform1i(u("uSource"), 0);
    gl.uniform1f(u("uOpacity"), Math.min(1, d.opacity));

    // Geometry, perspective and distortion
    const mv = d.move;
    gl.uniform4f(u("uMove"), mv?.x ?? 0, mv?.y ?? 0, mv?.rot ?? 0, mv?.zoom ?? 1);
    gl.uniform2f(u("uMirror"), fx.mirror?.mode ?? 0, fx.mirror?.axis ?? 0.5);
    gl.uniform2f(u("uKaleido"), fx.kaleido ? Math.max(2, fx.kaleido.segments) : 0, ((fx.kaleido?.angle ?? 0) * Math.PI) / 180);
    gl.uniform1f(u("uLens"), fx.lens);
    if (fx.wave && fx.wave.amplitude > 0) gl.uniform4f(u("uWave"), (fx.wave.amplitude * scale) / lw, fx.wave.frequency, t * fx.wave.speed * Math.PI * 2, 1);
    else gl.uniform4f(u("uWave"), 0, 0, 0, 0);
    if (fx.perspective) {
      const toRad = Math.PI / 180;
      gl.uniform4f(u("uPersp"), fx.perspective.pitch * toRad, fx.perspective.yaw * toRad, fx.perspective.roll * toRad, fx.perspective.distance);
    } else gl.uniform4f(u("uPersp"), 0, 0, 0, 0);
    gl.uniform4f(u("uHeat"), fx.heatDistort?.amount ?? 0, fx.heatDistort?.speed ?? 1, fx.heatDistort?.scale ?? 14, fx.heatDistort?.rise ?? 0.8);
    gl.uniform4f(u("uShock"), fx.shockwave?.x ?? 0.5, fx.shockwave?.y ?? 0.5, fx.shockwave?.progress ?? 0, fx.shockwave?.width ?? 0.12);
    gl.uniform1f(u("uShockStr"), fx.shockwave?.strength ?? 0);
    gl.uniform2f(u("uChromaLens"), fx.chromaticLens?.amount ?? 0, fx.chromaticLens?.falloff ?? 2);
    gl.uniform1f(u("uPixel"), fx.pixel > 0 ? Math.max(1, fx.pixel * scale) : 0);
    gl.uniform1f(u("uGlitch"), fx.glitch ? fx.glitch.amount : 0);
    gl.uniform1f(u("uGlitchT"), (fx.glitch ? t * fx.glitch.speed : 0) + sd);
    if (fx.split && fx.split.amount > 0) {
      const a = (fx.split.angle * Math.PI) / 180;
      const px = fx.split.amount * scale;
      gl.uniform2f(u("uSplit"), (Math.cos(a) * px) / lw, (Math.sin(a) * px) / lh);
    } else gl.uniform2f(u("uSplit"), 0, 0);
    gl.uniform1f(u("uVhs"), fx.vhs);

    // Sampling & optical focus
    if (fx.motion && fx.motion.length > 0.5) {
      const a = (fx.motion.angle * Math.PI) / 180;
      const len = fx.motion.length * scale;
      gl.uniform3f(u("uMotion"), (Math.cos(a) * len) / lw, (Math.sin(a) * len) / lh, 1);
    } else gl.uniform3f(u("uMotion"), 0, 0, 0);
    gl.uniform3f(u("uRadial"), fx.radial?.x ?? 0.5, fx.radial?.y ?? 0.5, fx.radial ? Math.min(0.95, fx.radial.amount) : 0);
    gl.uniform1f(u("uSharpen"), fx.sharpen);
    gl.uniform1f(u("uHalftone"), fx.halftone > 0 ? Math.max(2, fx.halftone * scale) : 0);
    gl.uniform4f(
      u("uPrism"),
      fx.prism?.intensity ?? 0,
      ((fx.prism?.dispersion ?? 0) * scale) / lw,
      ((fx.prism?.angle ?? 0) * Math.PI) / 180,
      fx.prism?.facets ?? 3,
    );
    gl.uniform4f(
      u("uTiltShift"),
      fx.tiltShift?.center ?? 0.5,
      fx.tiltShift?.band ?? 0.22,
      (fx.tiltShift?.blur ?? 0) * scale,
      ((fx.tiltShift?.angle ?? 0) * Math.PI) / 180,
    );

    // Keys, track mattes and shape masks
    let maskOn = false;
    gl.activeTexture(gl.TEXTURE1);
    if (fx.bg) {
      const m = src.mask(d);
      const mt = m ? this.uploadMask(`mask:${c.id}`, m) : this.touch(`mask:${c.id}`);
      if (mt) {
        maskOn = true;
        gl.bindTexture(gl.TEXTURE_2D, mt.tex);
        const lo = fx.bg.threshold - fx.bg.feather / 2;
        gl.uniform1f(u("uMaskLo"), lo);
        gl.uniform1f(u("uMaskHi"), Math.max(lo + 0.01, fx.bg.threshold + fx.bg.feather / 2));
      }
    }
    if (!maskOn) gl.bindTexture(gl.TEXTURE_2D, this.empty);
    gl.uniform1i(u("uMask"), 1);
    gl.uniform1i(u("uMaskOn"), maskOn ? 1 : 0);

    gl.activeTexture(gl.TEXTURE2);
    const lut = fx.lut && fx.lut.mix > 0 ? this.lutTexture(fx.lut.id) : null;
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_3D, lut ? lut.tex : this.empty3d);
    gl.uniform1i(u("uLut"), 2);
    gl.uniform1f(u("uLutMix"), lut ? Math.min(1, fx.lut!.mix) : 0);
    gl.uniform1f(u("uLutSize"), lut?.size ?? 2);

    gl.activeTexture(gl.TEXTURE3);
    const cTex = fx.curves && fx.curves.intensity > 0 ? this.curvesTexture(fx.curves) : this.emptyCurve;
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, cTex);
    gl.uniform1i(u("uCurves"), 3);
    gl.uniform1f(u("uCurvesMix"), fx.curves?.intensity ?? 0);

    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, matteTex ?? this.empty);
    gl.uniform1i(u("uMatte"), 4);
    gl.uniform1i(u("uMatteMode"), matteTex && d.matteMode ? MATTE_ID[d.matteMode] ?? 0 : 0);
    gl.activeTexture(gl.TEXTURE0);

    gl.uniform1i(u("uKeyOn"), fx.key ? 1 : 0);
    if (fx.key) {
      gl.uniform3f(u("uKeyColor"), fx.key.color[0], fx.key.color[1], fx.key.color[2]);
      gl.uniform1f(u("uKeySim"), fx.key.similarity);
      gl.uniform1f(u("uKeySmooth"), fx.key.smoothness);
      gl.uniform1f(u("uKeySpill"), fx.key.spill);
      gl.uniform4f(u("uKeyRefine"), fx.key.clipBlack, fx.key.clipWhite, fx.key.edgeShrink * scale, fx.key.edgeFeather * scale);
      gl.uniform4f(u("uKeyExtra"), fx.key.lightWrap, fx.key.viewMode, 0, 0);
    } else {
      gl.uniform4f(u("uKeyRefine"), 0, 1, 0, 0);
      gl.uniform4f(u("uKeyExtra"), 0, 0, 0, 0);
    }
    gl.uniform3f(u("uLuma"), fx.luma?.threshold ?? 0, fx.luma?.softness ?? 0, fx.luma?.mode ?? 0);
    gl.uniform3f(u("uUnmult"), fx.unmult?.threshold ?? 0.04, fx.unmult?.softness ?? 0.15, fx.unmult ? 1 : 0);
    const mk = fx.mask;
    gl.uniform4f(u("uShapeBox"), mk?.x ?? 0.5, mk?.y ?? 0.5, mk?.w ?? 1, mk?.h ?? 1);
    gl.uniform4f(u("uShapeOpt"), ((mk?.rotation ?? 0) * Math.PI) / 180, mk?.feather ?? 0, mk?.roundness ?? 0, mk ? mk.shape : 0);
    gl.uniform1i(u("uShapeInvert"), mk?.invert ? 1 : 0);
    const cr = fx.crop;
    gl.uniform4f(u("uCrop"), cr?.l ?? 0, cr?.r ?? 0, cr?.t ?? 0, cr?.b ?? 0);
    gl.uniform1f(u("uCropFeather"), cr?.feather ?? 0);

    // Colour & Grading
    gl.uniform1i(u("uGradeOn"), fx.grade ? 1 : 0);
    if (fx.grade) {
      const g = fx.grade;
      gl.uniform1f(u("uExposure"), g.exposure);
      gl.uniform1f(u("uBright"), g.brightness);
      gl.uniform1f(u("uContrast"), g.contrast);
      gl.uniform1f(u("uHighlights"), g.highlights);
      gl.uniform1f(u("uShadows"), g.shadows);
      gl.uniform1f(u("uSat"), g.saturation);
      gl.uniform1f(u("uVibrance"), g.vibrance);
      gl.uniform1f(u("uTemp"), g.temperature);
      gl.uniform1f(u("uTint"), g.tint);
      gl.uniform1f(u("uHue"), (g.hue * Math.PI) / 180);
      gl.uniform1f(u("uVignette"), g.vignette);
      gl.uniform4f(u("uGradeExtra"), g.whites, g.blacks, g.fade, g.clarity);
    } else gl.uniform4f(u("uGradeExtra"), 0, 0, 0, 0);

    gl.uniform1i(u("uWheelsOn"), fx.wheels ? 1 : 0);
    if (fx.wheels) {
      gl.uniform4fv(u("uLift"), fx.wheels.lift);
      gl.uniform4fv(u("uGamma"), fx.wheels.gamma);
      gl.uniform4fv(u("uGain"), fx.wheels.gain);
    }
    if (fx.hsl && fx.hsl.amount > 0) {
      gl.uniform1f(u("uHslMix"), fx.hsl.amount);
      gl.uniform4f(u("uHslHueA"), fx.hsl.hue[0], fx.hsl.hue[1], fx.hsl.hue[2], fx.hsl.hue[3]);
      gl.uniform4f(u("uHslHueB"), fx.hsl.hue[4], fx.hsl.hue[5], fx.hsl.hue[6], fx.hsl.hue[7]);
      gl.uniform4f(u("uHslSatA"), fx.hsl.sat[0], fx.hsl.sat[1], fx.hsl.sat[2], fx.hsl.sat[3]);
      gl.uniform4f(u("uHslSatB"), fx.hsl.sat[4], fx.hsl.sat[5], fx.hsl.sat[6], fx.hsl.sat[7]);
      gl.uniform4f(u("uHslLumA"), fx.hsl.lum[0], fx.hsl.lum[1], fx.hsl.lum[2], fx.hsl.lum[3]);
      gl.uniform4f(u("uHslLumB"), fx.hsl.lum[4], fx.hsl.lum[5], fx.hsl.lum[6], fx.hsl.lum[7]);
    } else gl.uniform1f(u("uHslMix"), 0);

    if (fx.colorKey) {
      gl.uniform4f(u("uColorKey"), fx.colorKey.target[0], fx.colorKey.target[1], fx.colorKey.target[2], fx.colorKey.mode);
      gl.uniform4f(u("uColorKeyOpt"), fx.colorKey.hue / 360, fx.colorKey.range / 360, fx.colorKey.softness / 360, fx.colorKey.minSat);
    } else gl.uniform4f(u("uColorKey"), 0, 0, 0, 0);

    const duo = fx.duo;
    gl.uniform4f(u("uDuoDark"), duo?.dark[0] ?? 0, duo?.dark[1] ?? 0, duo?.dark[2] ?? 0, duo ? duo.amount : 0);
    gl.uniform3f(u("uDuoLight"), duo?.light[0] ?? 1, duo?.light[1] ?? 1, duo?.light[2] ?? 1);
    gl.uniform1f(u("uPoster"), fx.poster);
    gl.uniform1f(u("uInvert"), fx.invert);

    // VFX & Optical overlays
    gl.uniform4f(
      u("uEdgeGlow"),
      fx.edgeGlow?.intensity ?? 0,
      fx.edgeGlow?.threshold ?? 0.22,
      (fx.edgeGlow?.thickness ?? 1.5) * scale,
      fx.edgeGlow?.mix ?? 0.35,
    );
    gl.uniform3f(u("uEdgeColor"), fx.edgeGlow?.color[0] ?? 0, fx.edgeGlow?.color[1] ?? 0.94, fx.edgeGlow?.color[2] ?? 1);
    gl.uniform4f(u("uGodRays"), fx.godRays?.x ?? 0.5, fx.godRays?.y ?? 0.18, fx.godRays?.intensity ?? 0, fx.godRays?.decay ?? 0.92);
    gl.uniform4f(
      u("uGodRaysCol"),
      fx.godRays?.color[0] ?? 1,
      fx.godRays?.color[1] ?? 0.94,
      fx.godRays?.color[2] ?? 0.78,
      fx.godRays?.threshold ?? 0.5,
    );
    gl.uniform4f(u("uFlare"), fx.lensFlare?.x ?? 0.72, fx.lensFlare?.y ?? 0.28, fx.lensFlare?.intensity ?? 0, fx.lensFlare?.streak ?? 0.6);
    gl.uniform4f(u("uFlareOpt"), fx.lensFlare?.scale ?? 1, ((fx.lensFlare?.rotation ?? 0) * Math.PI) / 180, 0, 0);
    gl.uniform3f(u("uFlareCol"), fx.lensFlare?.color[0] ?? 1, fx.lensFlare?.color[1] ?? 0.68, fx.lensFlare?.color[2] ?? 0.26);
    gl.uniform4f(u("uCrt"), fx.crt?.curvature ?? 0, fx.crt?.scanlines ?? 0, fx.crt?.grille ?? 0, fx.crt?.flicker ?? 0);
    gl.uniform1f(u("uCrtVig"), fx.crt?.vignette ?? 0);
    gl.uniform4f(u("uPart"), fx.particles?.amount ?? 0, (fx.particles?.size ?? 4) * scale, fx.particles?.speed ?? 1, fx.particles?.wind ?? 0.15);
    gl.uniform4f(u("uPartCol"), fx.particles?.color[0] ?? 1, fx.particles?.color[1] ?? 0.75, fx.particles?.color[2] ?? 0.33, fx.particles?.kind ?? 0);
    gl.uniform4f(u("uStrobe"), fx.strobe?.rate ?? 8, fx.strobe?.duty ?? 0.25, fx.strobe?.intensity ?? 0, fx.strobe?.mode ?? 0);
    gl.uniform3f(u("uStrobeCol"), fx.strobe?.color[0] ?? 1, fx.strobe?.color[1] ?? 1, fx.strobe?.color[2] ?? 1);

    // Stylise and frame
    gl.uniform2f(u("uGrain"), fx.grain?.amount ?? 0, Math.max(1, (fx.grain?.size ?? 1) * scale));
    const lk = fx.leak;
    gl.uniform4f(u("uLeak"), lk?.color[0] ?? 0, lk?.color[1] ?? 0, lk?.color[2] ?? 0, lk ? lk.amount : 0);
    gl.uniform1f(u("uLeakT"), (lk ? t * lk.speed : 0) + sd);
    gl.uniform1f(u("uBars"), fx.bars);
    const fr = fx.frame;
    gl.uniform1i(u("uFrameOn"), fr ? 1 : 0);
    if (fr) {
      gl.uniform4f(u("uFrame"), fr.radius * scale, fr.border * scale, fr.shadow, fr.size * scale);
      gl.uniform3f(u("uBorder"), fr.color[0], fr.color[1], fr.color[2]);
    }

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return true;
  }

  private blur(tg: Target, radius: number) {
    const gl = this.gl;
    const tmp = this.scratch("tmp");
    const pr = this.progs.blur;
    gl.useProgram(pr.prog);
    gl.disable(gl.BLEND);
    gl.uniform2f(pr.u("uRes"), this.width, this.height);
    gl.uniform1f(pr.u("uRadius"), radius);
    gl.uniform1i(pr.u("uTex"), 0);
    gl.activeTexture(gl.TEXTURE0);
    this.bind(tmp);
    gl.bindTexture(gl.TEXTURE_2D, tg.tex);
    gl.uniform2f(pr.u("uDir"), 1, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this.bind(tg);
    gl.bindTexture(gl.TEXTURE_2D, tmp.tex);
    gl.uniform2f(pr.u("uDir"), 0, 1);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /** Blends a premultiplied layer texture onto the accumulation buffer. */
  private composite(src: WebGLTexture, mode: BlendMode) {
    const gl = this.gl;
    if (mode === "normal" || BLEND_ID[mode] === undefined) {
      this.bind(this.accum[this.cur]);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      this.copy(src, 1);
      gl.disable(gl.BLEND);
      return;
    }
    const pr = this.progs.blend;
    const dst = this.accum[this.cur];
    const out = this.accum[1 - this.cur];
    this.bind(out);
    gl.disable(gl.BLEND);
    gl.useProgram(pr.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, dst.tex);
    gl.uniform1i(pr.u("uDst"), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, src);
    gl.uniform1i(pr.u("uSrc"), 1);
    gl.uniform2f(pr.u("uRes"), this.width, this.height);
    gl.uniform1i(pr.u("uMode"), BLEND_ID[mode]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.activeTexture(gl.TEXTURE0);
    this.cur = 1 - this.cur;
  }

  private copy(tex: WebGLTexture, alpha: number, checker = false) {
    const gl = this.gl;
    const pr = this.progs.copy;
    gl.useProgram(pr.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(pr.u("uTex"), 0);
    gl.uniform2f(pr.u("uRes"), this.width, this.height);
    gl.uniform1f(pr.u("uAlpha"), alpha);
    gl.uniform1f(pr.u("uChecker"), checker ? 1 : 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private touch(key: string) {
    const t = this.textures.get(key);
    if (t) t.used = this.frameNo;
    return t ?? null;
  }

  private upload(key: string, source: TexImageSource, w: number, h: number, version: string | number): Tex {
    const gl = this.gl;
    let t = this.textures.get(key);
    if (!t) {
      t = { tex: texture(gl), version: null, w, h, used: 0, mip: false };
      this.textures.set(key, t);
    }
    t.used = this.frameNo;
    if (t.version === version) return t;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      t.version = version;
      t.w = w;
      t.h = h;
      t.mip = false;
    } catch (e) {
      // A frame that can't be read yet (a video still seeking): keep showing the previous one.
      console.debug("[studio] texture upload skipped", e);
    }
    return t;
  }

  private uploadMask(key: string, m: MaskRef): Tex {
    const gl = this.gl;
    let t = this.textures.get(key);
    if (!t) {
      t = { tex: texture(gl), version: null, w: m.width, h: m.height, used: 0, mip: false };
      this.textures.set(key, t);
    }
    t.used = this.frameNo;
    if (t.version !== m.version) {
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, m.width, m.height, 0, gl.RED, gl.UNSIGNED_BYTE, m.data);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      t.version = m.version;
      t.w = m.width;
      t.h = m.height;
    }
    return t;
  }

  /** Downsampled framebuffer pixels for live Waveform / Parade / Vectorscope / Histogram panels. */
  readScopePixels(maxW = 160, maxH = 90): { data: Uint8ClampedArray; width: number; height: number } | null {
    const gl = this.gl;
    if (this.lost || gl.isContextLost() || !this.accum.length || this.width < 2 || this.height < 2) return null;
    const ratio = Math.min(maxW / this.width, maxH / this.height, 1);
    const sw = Math.max(16, Math.round(this.width * ratio));
    const sh = Math.max(16, Math.round(this.height * ratio));
    if (!this.scopeTarget || this.scopeTarget.w !== sw || this.scopeTarget.h !== sh) {
      if (this.scopeTarget) freeTarget(gl, this.scopeTarget);
      this.scopeTarget = target(gl, sw, sh);
      this.scopeBuf = new Uint8Array(sw * sh * 4);
    }
    gl.bindVertexArray(this.vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.scopeTarget.fbo);
    gl.viewport(0, 0, sw, sh);
    gl.disable(gl.BLEND);
    const pr = this.progs.copy;
    gl.useProgram(pr.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.accum[this.cur].tex);
    gl.uniform1i(pr.u("uTex"), 0);
    gl.uniform2f(pr.u("uRes"), sw, sh);
    gl.uniform1f(pr.u("uAlpha"), 1);
    gl.uniform1f(pr.u("uChecker"), 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.readPixels(0, 0, sw, sh, gl.RGBA, gl.UNSIGNED_BYTE, this.scopeBuf!);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    gl.bindVertexArray(null);
    return { data: new Uint8ClampedArray(this.scopeBuf!.buffer, this.scopeBuf!.byteOffset, this.scopeBuf!.byteLength), width: sw, height: sh };
  }

  /**
   * Reads a top-down unpremultiplied `(2*radius+1) x (2*radius+1)` RGBA patch from the rendered
   * accumulation framebuffer at normalized `(nx, ny)` in `0..1` (top-down canvas coordinates).
   */
  readPatch(nx: number, ny: number, radius = 5): { data: Uint8Array; size: number } | null {
    const gl = this.gl;
    if (this.lost || gl.isContextLost() || !this.accum.length || this.width < 1 || this.height < 1) return null;
    const cx = Math.min(this.width - 1, Math.max(0, Math.round(nx * this.width)));
    const cy = Math.min(this.height - 1, Math.max(0, Math.round(ny * this.height)));
    const size = radius * 2 + 1;
    const x0 = Math.max(0, cx - radius);
    const x1 = Math.min(this.width - 1, cx + radius);
    const y0 = Math.max(0, cy - radius);
    const y1 = Math.min(this.height - 1, cy + radius);
    const rw = x1 - x0 + 1;
    const rh = y1 - y0 + 1;
    const glY = this.height - 1 - y1;
    const raw = new Uint8Array(rw * rh * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.accum[this.cur].fbo);
    gl.readPixels(x0, glY, rw, rh, gl.RGBA, gl.UNSIGNED_BYTE, raw);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const out = new Uint8Array(size * size * 4);
    for (let ry = 0; ry < rh; ry++) {
      const topY = y1 - ry;
      const oy = topY - (cy - radius);
      for (let rx = 0; rx < rw; rx++) {
        const ox = x0 + rx - (cx - radius);
        const si = (ry * rw + rx) * 4;
        const di = (oy * size + ox) * 4;
        const a = raw[si + 3];
        if (a > 0 && a < 255) {
          out[di] = Math.min(255, Math.round((raw[si] * 255) / a));
          out[di + 1] = Math.min(255, Math.round((raw[si + 1] * 255) / a));
          out[di + 2] = Math.min(255, Math.round((raw[si + 2] * 255) / a));
          out[di + 3] = a;
        } else {
          out[di] = raw[si];
          out[di + 1] = raw[si + 1];
          out[di + 2] = raw[si + 2];
          out[di + 3] = a;
        }
      }
    }
    return { data: out, size };
  }

  /** Frees textures nothing has drawn for a while (clips scrolled past, deleted clips). */
  private gc() {
    if (this.frameNo % 60) return;
    for (const [k, t] of this.textures) {
      if (this.frameNo - t.used > 240) {
        this.gl.deleteTexture(t.tex);
        this.textures.delete(k);
      }
    }
    for (const [k, c] of this.curvesCache) {
      if (this.frameNo - c.used > 240) {
        this.gl.deleteTexture(c.tex);
        this.curvesCache.delete(k);
      }
    }
  }

  /** Forget a clip's cached frame (after a seek far away, so stale pictures never flash). */
  invalidate(prefix?: string) {
    for (const [k, t] of this.textures) {
      if (!prefix || k.startsWith(prefix)) {
        this.gl.deleteTexture(t.tex);
        this.textures.delete(k);
      }
    }
  }

  dispose() {
    const gl = this.gl;
    this.offLuts();
    this.offFonts();
    this.invalidate();
    for (const l of this.luts.values()) gl.deleteTexture(l.tex);
    this.luts.clear();
    for (const c of this.curvesCache.values()) gl.deleteTexture(c.tex);
    this.curvesCache.clear();
    freeTarget(gl, this.scopeTarget ?? undefined);
    this.scopeTarget = null;
    gl.deleteTexture(this.emptyCurve);
    for (const t of [...this.accum, ...Object.values(this.scratchT)]) freeTarget(gl, t);
    this.text.clear();
    this.shapes.clear();
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}
