import type { TextAnimation, TextContent, TextStyle } from "../../types";
import { ensureFont, fontReady, fontString } from "../fonts";

/**
 * Text and captions are drawn with Canvas 2D (real font shaping, emoji, Hindi and Bangla) and handed
 * to WebGL as a texture. Supports gradients, 3D extrusion, arched curved paths, box styles (per-line,
 * solid block, word pills), per-character/per-word kinetic animations, mask reveals, and cipher decode.
 *
 * This runs on the main thread, where canvases see every font in `document.fonts` (including custom
 * .ttf/.otf/.woff/.woff2 fonts loaded into IndexedDB).
 */

type Word = { text: string; w: number; index: number };
type Line = { words: Word[]; width: number };
type Layout = { lines: Line[]; width: number; height: number; lineH: number; pad: number; space: number; font: string };

const TYPE_RATE = 22;
const CIPHER_GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&*";

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOutCubic = (x: number) => 1 - Math.pow(1 - x, 3);
const easeOutBack = (x: number) => 1 + 2.3 * Math.pow(x - 1, 3) + 1.3 * Math.pow(x - 1, 2);
function bounceOut(x: number) {
  const n = 7.5625;
  const d = 2.75;
  if (x < 1 / d) return n * x * x;
  if (x < 2 / d) return n * (x - 1.5 / d) * (x - 1.5 / d) + 0.75;
  if (x < 2.5 / d) return n * (x - 2.25 / d) * (x - 2.25 / d) + 0.9375;
  return n * (x - 2.625 / d) * (x - 2.625 / d) + 0.984375;
}
const hash = (a: number, b: number) => {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

let measureCtx: OffscreenCanvasRenderingContext2D | null = null;
function mctx() {
  if (!measureCtx) measureCtx = new OffscreenCanvas(4, 4).getContext("2d")!;
  return measureCtx;
}

function setFont(ctx: OffscreenCanvasRenderingContext2D, st: TextStyle, scale: number, extraSpacing = 0) {
  ctx.font = fontString(st, st.size * scale);
  (ctx as OffscreenCanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${(st.letterSpacing + extraSpacing) * scale}px`;
}

function tokens(c: TextContent): string[][] {
  const up = (s: string) => (c.style.uppercase ? s.toUpperCase() : s);
  if (c.words?.length) return [c.words.map((w) => up(w.text.trim())).filter(Boolean)];
  return up(c.text)
    .split("\n")
    .map((line) => line.split(/\s+/).filter(Boolean));
}

function padding(st: TextStyle, scale: number) {
  const box = st.boxOpacity > 0 ? st.boxPadding : 0;
  const shadow = st.shadowBlur > 0 ? st.shadowBlur * 1.2 + Math.abs(st.shadowY) : 0;
  const pop = st.animation === "wordPop" || st.animation === "charPop" ? st.size * 0.18 : 0;
  const extrude = Math.max(0, st.extrude ?? 0);
  const curve = Math.abs(st.curve ?? 0) * st.size * 1.4;
  const kinetic =
    st.animation === "charDrop" || st.animation === "charWave" || st.animation === "wordSlideUp" || st.animation === "revealUp"
      ? st.size * 0.45
      : 0;
  return Math.ceil((box + st.strokeWidth / 2 + shadow + pop + extrude + curve + kinetic + 4) * scale);
}

function layout(c: TextContent, frameW: number, scale: number): Layout {
  const st = c.style;
  const ctx = mctx();
  setFont(ctx, st, scale);
  const space = ctx.measureText(" ").width;
  const maxW = Math.max(40, st.maxWidth * frameW * scale);
  const lines: Line[] = [];
  let index = 0;
  for (const para of tokens(c)) {
    let cur: Line = { words: [], width: 0 };
    for (const text of para) {
      const w = ctx.measureText(text).width;
      const add = cur.words.length ? space + w : w;
      if (cur.words.length && cur.width + add > maxW) {
        lines.push(cur);
        cur = { words: [], width: 0 };
      }
      cur.width += cur.words.length ? space + w : w;
      cur.words.push({ text, w, index: index++ });
    }
    lines.push(cur);
  }
  const lineH = st.size * st.lineHeight * scale;
  const width = Math.max(1, ...lines.map((l) => l.width));
  return { lines, width, height: Math.max(lineH, lines.length * lineH), lineH, pad: padding(st, scale), space, font: ctx.font };
}

const sizeCache = new Map<string, [number, number]>();
const keyOf = (c: TextContent, frameW: number) => JSON.stringify([c.text, c.style, c.words?.map((w) => w.text), frameW]);

/** The box a text clip occupies, in project pixels, before the clip's own scale. */
export function textBlockSize(c: TextContent, frameW: number): [number, number] {
  const key = keyOf(c, frameW);
  let s = sizeCache.get(key);
  if (!s) {
    const l = layout(c, frameW, 1);
    const curvePad = Math.abs(c.style.curve ?? 0) > 0.01 ? l.width * Math.abs(c.style.curve ?? 0) * 0.3 : 0;
    const trackPad = c.style.animation === "trackingIn" || c.style.animation === "trackingOut" ? l.width * 0.35 : 0;
    s = [Math.ceil(l.width + 2 * l.pad + trackPad), Math.ceil(l.height + 2 * l.pad + curvePad)];
    if (sizeCache.size > 400) sizeCache.clear();
    sizeCache.set(key, s);
  }
  return s;
}

/** Which word is being spoken at local time `t` (it stays lit until the next one starts). */
export function activeWord(c: TextContent, t: number) {
  const w = c.words;
  if (!w?.length) return -1;
  let i = -1;
  for (let k = 0; k < w.length; k++) if (w[k].start <= t + 1e-4) i = k;
  return i;
}

export type TextRaster = { canvas: OffscreenCanvas; key: string; w: number; h: number };

const RASTER_ANIMS = new Set<TextAnimation>([
  "typewriter",
  "charFade",
  "charDrop",
  "charPop",
  "charWave",
  "charSpin",
  "charGlitch",
  "wordSlideUp",
  "wordFade",
  "wipeLeft",
  "wipeRight",
  "revealUp",
  "trackingIn",
  "trackingOut",
  "splitCenter",
  "scramble",
]);

const CHAR_LEVEL_ANIMS = new Set<TextAnimation>(["charFade", "charDrop", "charPop", "charWave", "charSpin", "charGlitch", "scramble"]);

function roundRect(ctx: OffscreenCanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.closePath();
}

function withAlpha(hex: string, a: number) {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((x) => x + x).join("") : h.slice(0, 6);
  const n = parseInt(full, 16) || 0;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function makeFill(ctx: OffscreenCanvasRenderingContext2D, st: TextStyle, x0: number, y0: number, w: number, h: number, lit: boolean) {
  if (lit) return st.highlightColor;
  if (st.gradientColor && st.gradientColor.trim()) {
    const rad = ((st.gradientAngle ?? 90) * Math.PI) / 180;
    const dx = Math.cos(rad) * (w * 0.5);
    const dy = Math.sin(rad) * (h * 0.5);
    const cx = x0 + w * 0.5;
    const cy = y0 + h * 0.5;
    const grad = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
    grad.addColorStop(0, st.color);
    grad.addColorStop(1, st.gradientColor);
    return grad;
  }
  return st.color;
}

function drawGlyph(ctx: OffscreenCanvasRenderingContext2D, st: TextStyle, scale: number, text: string, x: number, y: number, fill: string | CanvasGradient) {
  const extrude = Math.max(0, st.extrude ?? 0) * scale;
  if (extrude >= 1) {
    const steps = Math.min(24, Math.ceil(extrude));
    ctx.save();
    ctx.shadowColor = "transparent";
    ctx.fillStyle = st.extrudeColor || "#14130e";
    for (let s = steps; s >= 1; s--) {
      const off = (s / steps) * extrude;
      ctx.fillText(text, x + off * 0.7, y + off);
    }
    ctx.restore();
  }
  if (st.shadowBlur > 0) {
    ctx.shadowColor = st.shadowColor;
    ctx.shadowBlur = st.shadowBlur * scale;
    ctx.shadowOffsetY = st.shadowY * scale;
  }
  if (st.strokeWidth > 0) {
    ctx.lineWidth = st.strokeWidth * scale;
    ctx.strokeStyle = st.strokeColor;
    ctx.strokeText(text, x, y);
    ctx.shadowColor = "transparent";
  }
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

export class TextRasterizer {
  private cache = new Map<string, TextRaster>();
  /** Bumped when a font finishes loading, so callers know to draw again. */
  version = 0;
  private pending = new Set<string>();

  constructor(private onFontReady?: () => void) {}

  invalidateFonts() {
    sizeCache.clear();
    this.cache.clear();
    this.version++;
  }

  draw(c: TextContent, local: number, scale: number, frameW: number, duration = 4): TextRaster {
    const st = c.style;
    this.requireFont(st, c.text);
    const animIn = st.animation;
    const animOut = st.animOut && st.animOut !== "none" ? st.animOut : "none";
    const inDur = Math.max(0.05, st.animInDuration ?? 0.45);
    const outDur = Math.max(0.05, st.animOutDuration ?? 0.35);
    const stagger = Math.max(0.005, st.animStagger ?? 0.04);

    const word = animIn === "karaoke" || animIn === "wordPop" ? activeWord(c, local) : -1;
    const chars = animIn === "typewriter" ? Math.max(0, Math.floor(local * TYPE_RATE)) : -1;
    const isAnimated = RASTER_ANIMS.has(animIn) || (animOut !== "none" && RASTER_ANIMS.has(animOut));
    // During static hold phase in the middle of finite entrance/exit animations, lock to a single key when safe.
    const inExit = animOut !== "none" && local > duration - outDur - 0.05;
    const activeWindow =
      animIn === "charWave" || animIn === "charGlitch" || animIn === "scramble"
        ? true
        : local <= inDur + stagger * 36 + 0.05 || inExit;
    const tBucket = isAnimated && animIn !== "typewriter" ? (activeWindow ? Math.round(local * 60) : -2) : -1;

    const key = `${keyOf(c, frameW)}|${scale.toFixed(4)}|${word}|${chars}|${tBucket}|${Math.round(duration * 10)}|${this.version}`;
    const hit = this.cache.get(key);
    if (hit) {
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit;
    }

    const l = layout(c, frameW, scale);
    const [bw, bh] = textBlockSize(c, frameW);
    const cw = Math.max(2, Math.ceil(bw * scale));
    const ch = Math.max(2, Math.ceil(bh * scale));
    const canvas = new OffscreenCanvas(cw, ch);
    const ctx = canvas.getContext("2d")!;

    // Determine effective time-driven progress for global mask/tracking effects.
    const outP = animOut !== "none" ? clamp01((duration - local) / outDur) : 1;
    const inP = clamp01(local / inDur);
    let extraSpacing = 0;
    if (animIn === "trackingIn") extraSpacing += (1 - easeOutCubic(inP)) * st.size * 0.45;
    if (animIn === "trackingOut") extraSpacing += easeOutCubic(inP) * st.size * 0.35;
    if (animOut === "trackingOut") extraSpacing += (1 - outP) * st.size * 0.45;
    if (animOut === "trackingIn") extraSpacing += (1 - outP) * st.size * 0.45;

    setFont(ctx, st, scale, extraSpacing);
    const ox = (cw - (l.width + 2 * l.pad)) / 2 + l.pad;
    const oy = (ch - (l.height + 2 * l.pad)) / 2 + l.pad;

    // Mask clipping for whole-layer wipe / splitCenter reveals.
    ctx.save();
    const maskPIn = animIn === "wipeLeft" || animIn === "wipeRight" || animIn === "splitCenter" ? easeOutCubic(inP) : 1;
    const maskPOut = animOut === "wipeLeft" || animOut === "wipeRight" || animOut === "splitCenter" ? outP : 1;
    const maskP = Math.min(maskPIn, maskPOut);
    if (animIn === "wipeLeft" || animOut === "wipeLeft") {
      ctx.beginPath();
      ctx.rect(0, 0, cw * maskP, ch);
      ctx.clip();
    } else if (animIn === "wipeRight" || animOut === "wipeRight") {
      ctx.beginPath();
      ctx.rect(cw * (1 - maskP), 0, cw * maskP, ch);
      ctx.clip();
    } else if (animIn === "splitCenter" || animOut === "splitCenter") {
      const hw = (cw * maskP) * 0.5;
      ctx.beginPath();
      ctx.rect(cw * 0.5 - hw, 0, hw * 2, ch);
      ctx.clip();
    }

    // Background box rendering (`line` | `block` | `wordPill`).
    const boxStyle = st.boxStyle ?? "line";
    if (st.boxOpacity > 0) {
      const p = st.boxPadding * scale;
      ctx.fillStyle = withAlpha(st.boxColor, st.boxOpacity);
      if (boxStyle === "block") {
        roundRect(ctx, ox - p, oy - p * 0.4, l.width + 2 * p, l.lines.length * l.lineH + p * 0.8, st.boxRadius * scale);
        ctx.fill();
      } else if (boxStyle === "line") {
        for (const [i, line] of l.lines.entries()) {
          if (!line.words.length) continue;
          const lx = ox + (st.align === "left" ? 0 : st.align === "right" ? l.width - line.width : (l.width - line.width) / 2);
          roundRect(ctx, lx - p, oy + i * l.lineH - p * 0.35, line.width + 2 * p, l.lineH + p * 0.7, st.boxRadius * scale);
          ctx.fill();
        }
      }
    }

    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.miterLimit = 2;

    const curve = st.curve ?? 0;
    const isCurved = Math.abs(curve) > 0.01;
    const isCharAnim = CHAR_LEVEL_ANIMS.has(animIn) || CHAR_LEVEL_ANIMS.has(animOut);
    const blockFill = makeFill(ctx, st, ox, oy, l.width, l.height, false);
    let budget = chars < 0 ? Infinity : chars;
    let charIndex = 0;

    for (const [i, line] of l.lines.entries()) {
      const lineW = extraSpacing !== 0 ? Math.max(line.width, line.width + (line.words.reduce((n, w) => n + w.text.length, 0) - 1) * extraSpacing * scale) : line.width;
      let x = ox + (st.align === "left" ? 0 : st.align === "right" ? l.width - lineW : (l.width - lineW) / 2);
      const y = oy + (i + 0.5) * l.lineH;

      const lineMaskReveal = animIn === "revealUp" ? easeOutCubic(clamp01((local - i * stagger * 1.5) / inDur)) : 1;
      const lineMaskOut = animOut === "revealUp" ? clamp01((duration - local - i * stagger) / outDur) : 1;
      const revealP = Math.min(lineMaskReveal, lineMaskOut);

      ctx.save();
      if (animIn === "revealUp" || animOut === "revealUp") {
        ctx.beginPath();
        ctx.rect(0, oy + i * l.lineH - l.pad * 0.15, cw, l.lineH + l.pad * 0.3);
        ctx.clip();
      }

      if (isCurved) {
        // Curved arc layout across all characters on the line.
        const fullText = line.words.map((w) => w.text).join(" ");
        const totalW = Math.max(1, ctx.measureText(fullText).width);
        const radius = Math.max(totalW * 0.55, totalW / (Math.abs(curve) * 2.2));
        const sign = curve >= 0 ? 1 : -1;
        const centerX = cw * 0.5;
        const centerY = y + sign * radius;
        let cursor = -totalW * 0.5;

        for (const chStr of [...fullText]) {
          const chw = ctx.measureText(chStr).width;
          const charMid = cursor + chw * 0.5;
          const theta = (charMid / radius) * sign;
          const gx = centerX + Math.sin(theta) * radius;
          const gy = centerY - sign * Math.cos(theta) * radius;

          ctx.save();
          ctx.translate(gx, gy);
          ctx.rotate(theta);
          drawGlyph(ctx, st, scale, chStr, -chw * 0.5, (1 - revealP) * l.lineH, blockFill);
          ctx.restore();
          cursor += chw;
          charIndex++;
        }
      } else {
        for (const w of line.words) {
          if (budget <= 0) break;
          const wordStr = budget >= w.text.length ? w.text : w.text.slice(0, budget);
          budget -= w.text.length + 1;
          const lit = w.index === word;

          // Per-word animations.
          let wordAlpha = animIn === "trackingIn" || animIn === "trackingOut" ? clamp01(inP * 1.4) : 1;
          let wordOffY = (1 - revealP) * l.lineH * 0.9;
          if (animIn === "wordSlideUp") {
            const wp = clamp01((local - w.index * stagger * 2) / inDur);
            wordAlpha *= wp;
            wordOffY += (1 - easeOutCubic(wp)) * st.size * 0.7 * scale;
          } else if (animIn === "wordFade") {
            wordAlpha *= clamp01((local - w.index * stagger * 2) / inDur);
          }
          if (animOut === "wordSlideUp" || animOut === "wordFade") {
            const wp = clamp01((duration - local - w.index * stagger) / outDur);
            wordAlpha *= wp;
            if (animOut === "wordSlideUp") wordOffY -= (1 - wp) * st.size * 0.6 * scale;
          }

          if (boxStyle === "wordPill" && st.boxOpacity > 0 && wordAlpha > 0.01) {
            const p = st.boxPadding * scale;
            ctx.save();
            ctx.globalAlpha = wordAlpha;
            ctx.fillStyle = withAlpha(lit ? st.highlightColor : st.boxColor, lit ? Math.max(0.85, st.boxOpacity) : st.boxOpacity);
            roundRect(ctx, x - p * 0.55, y - l.lineH * 0.42 - p * 0.15 + wordOffY, w.w + p * 1.1, l.lineH * 0.84 + p * 0.3, st.boxRadius * scale);
            ctx.fill();
            ctx.restore();
          }

          if (isCharAnim) {
            // Draw char-by-char for kinetic per-character effects.
            let cx = x;
            for (const rawChar of [...wordStr]) {
              const ci = charIndex++;
              const cwChar = ctx.measureText(rawChar).width;
              const startAt = ci * stagger;
              const cpIn = clamp01((local - startAt) / inDur);
              const cpOut = animOut !== "none" && CHAR_LEVEL_ANIMS.has(animOut) ? clamp01((duration - local - ci * stagger * 0.5) / outDur) : 1;

              let chAlpha = wordAlpha;
              let chOffX = 0;
              let chOffY = wordOffY;
              let chScale = 1;
              let chRot = 0;
              let glyph = rawChar;

              if (animIn === "charFade" || animOut === "charFade") chAlpha *= Math.min(animIn === "charFade" ? cpIn : 1, animOut === "charFade" ? cpOut : 1);
              if (animIn === "charDrop") {
                chOffY -= (1 - bounceOut(cpIn)) * st.size * 0.85 * scale;
                chAlpha *= clamp01(cpIn * 3);
              }
              if (animIn === "charPop") {
                chScale *= 0.25 + 0.75 * easeOutBack(cpIn);
                chAlpha *= clamp01(cpIn * 4);
              }
              if (animIn === "charWave") {
                chOffY += Math.sin(local * 6.5 - ci * 0.55) * st.size * 0.16 * scale;
                chAlpha *= clamp01(local / 0.2);
              }
              if (animIn === "charSpin") {
                const e = easeOutCubic(cpIn);
                chRot -= (1 - e) * Math.PI * 0.85;
                chScale *= 0.4 + 0.6 * e;
                chAlpha *= clamp01(cpIn * 2.5);
              }
              if (animIn === "charGlitch") {
                if (cpIn < 1) {
                  const jit = (1 - cpIn) * st.size * 0.25 * scale;
                  chOffX += (hash(ci, Math.floor(local * 24)) - 0.5) * jit;
                  chOffY += (hash(ci + 7, Math.floor(local * 24)) - 0.5) * jit;
                  chAlpha *= hash(ci + 13, Math.floor(local * 24)) > 0.25 ? 1 : 0.2;
                }
              }
              if (animIn === "scramble") {
                if (cpIn < 0.85 && rawChar !== " ") {
                  const pick = Math.floor(hash(ci, Math.floor(local * 18)) * CIPHER_GLYPHS.length);
                  glyph = CIPHER_GLYPHS[pick] ?? rawChar;
                }
                chAlpha *= clamp01(local / 0.12);
              }

              if (chAlpha > 0.01) {
                ctx.save();
                ctx.globalAlpha = clamp01(chAlpha);
                const midX = cx + cwChar * 0.5 + chOffX;
                const midY = y + chOffY;
                ctx.translate(midX, midY);
                if (chRot !== 0) ctx.rotate(chRot);
                if (chScale !== 1) ctx.scale(chScale, chScale);
                const fill = makeFill(ctx, st, -cwChar * 0.5, -l.lineH * 0.5, cwChar, l.lineH, lit);
                drawGlyph(ctx, st, scale, glyph, -cwChar * 0.5, 0, fill);
                ctx.restore();
              }
              cx += cwChar + (extraSpacing ? extraSpacing * scale : 0);
            }
          } else {
            ctx.save();
            ctx.globalAlpha = clamp01(wordAlpha);
            if (lit && animIn === "wordPop") {
              const cx = x + w.w / 2;
              ctx.translate(cx, y + wordOffY);
              ctx.scale(1.14, 1.14);
              ctx.translate(-cx, -(y + wordOffY));
            }
            const fill = st.gradientColor ? blockFill : makeFill(ctx, st, x, y - l.lineH * 0.5, w.w, l.lineH, lit);
            drawGlyph(ctx, st, scale, wordStr, x, y + wordOffY, fill);
            ctx.restore();
          }
          x += w.w + l.space;
        }
      }
      ctx.restore();
    }

    ctx.restore();
    const raster: TextRaster = { canvas, key, w: bw, h: bh };
    this.cache.set(key, raster);
    while (this.cache.size > 48) this.cache.delete(this.cache.keys().next().value!);
    return raster;
  }

  private requireFont(st: TextStyle, sample: string) {
    const id = `${st.font}|${st.weight}|${st.italic}`;
    if (this.pending.has(id) || fontReady(st.font, st.weight, st.italic)) return;
    this.pending.add(id);
    void ensureFont(st.font, st.weight, st.italic, sample)
      .then(() => {
        this.invalidateFonts();
        this.onFontReady?.();
      })
      .catch(() => undefined);
  }

  clear() {
    this.cache.clear();
  }
}
