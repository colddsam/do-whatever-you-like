/**
 * GLSL ES 3.00 shaders for the compositor.
 *
 * Conventions: every texture holds premultiplied alpha. Layer geometry is given in render pixels
 * with y pointing down (like CSS); the vertex shader flips into clip space. Screen-aligned passes
 * (blur, blend, transitions, present) sample with gl_FragCoord / uRes, i.e. GL's y-up texture space,
 * which is how framebuffer textures are stored, so no pass ever flips an image by accident.
 *
 * Sizes that users set in pixels (grain, halftone dots, borders) arrive in render pixels already
 * scaled from project pixels (uScale), so a half-resolution preview looks like the full-size export.
 */

const HEADER = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler3D;
`;

export const FULLSCREEN_VS = `#version 300 es
layout(location = 0) in vec2 aPos;
void main() { gl_Position = vec4(aPos * 2.0 - 1.0, 0.0, 1.0); }
`;

export const LAYER_VS = `#version 300 es
layout(location = 0) in vec2 aPos;
uniform vec2 uRes;
uniform vec2 uCenter;
uniform vec2 uSize;
uniform float uRot;
uniform float uMargin;
out vec2 vUv;
void main() {
  vec2 uv = mix(vec2(-uMargin), vec2(1.0 + uMargin), aPos);
  vUv = uv;
  vec2 local = (uv - 0.5) * uSize;
  float c = cos(uRot);
  float s = sin(uRot);
  vec2 p = vec2(local.x * c - local.y * s, local.x * s + local.y * c) + uCenter;
  gl_Position = vec4(p.x / uRes.x * 2.0 - 1.0, 1.0 - p.y / uRes.y * 2.0, 0.0, 1.0);
}
`;

/**
 * One clip with all of its effects in a single pass. In order: camera move (stabilise, shake) and
 * distortions (mirror, kaleidoscope, lens, wave, VHS wobble, glitch, pixelate) bend the lookup;
 * the picture is sampled (with RGB split, directional/zoom blur, sharpen, halftone); then keys and
 * masks set the alpha, the colour stack runs (grade, LUT, duotone, posterize, invert), stylising
 * overlays are added (grain, scanlines, light leak, bars) and finally the frame (corners, border,
 * drop shadow) and opacity.
 */
export const LAYER_FS = `${HEADER}
in vec2 vUv;
uniform sampler2D uTex;
uniform int uSource;          // 0 = texture, 1 = solid colour, 2 = linear gradient
uniform int uFlipTexY;        // 1 when sampling GL FBO texture (Adjustment Layer)
uniform vec2 uRes;            // render target size in px
uniform vec4 uColor;          // straight-alpha colours
uniform vec4 uColor2;
uniform float uGradAngle;     // radians
uniform float uOpacity;
uniform vec2 uLayerPx;        // the layer's size in render pixels
uniform float uScale;         // render pixels per project pixel
uniform float uTime;          // timeline seconds
uniform float uSeed;

uniform vec4 uMove;           // content offset (layer uv), rotation, zoom
uniform vec2 uMirror;         // mode (0 off, 1 left, 2 right, 3 top, 4 bottom, 5 quad), axis
uniform vec2 uKaleido;        // segments (0 off), angle
uniform float uLens;
uniform vec4 uWave;           // amplitude (uv), frequency, phase, on
uniform vec4 uPersp;          // pitchRad, yawRad, rollRad, distance (0 dist = off)
uniform vec4 uHeat;           // amount, speed, scale, rise
uniform vec4 uShock;          // x, y, progress, width
uniform float uShockStr;      // refraction strength
uniform vec2 uChromaLens;     // amount, falloff
uniform float uPixel;         // block size, render px (0 off)
uniform float uGlitch;
uniform float uGlitchT;
uniform vec2 uSplit;          // red/blue offset in uv units
uniform float uVhs;

uniform vec3 uMotion;         // streak vector (uv), on
uniform vec3 uRadial;         // centre (uv), amount
uniform float uSharpen;
uniform float uHalftone;      // dot cell, render px (0 off)
uniform vec4 uPrism;          // intensity, dispersionUvX, angleRad, facets
uniform vec4 uTiltShift;      // center, band, blurPx, angleRad

uniform bool uKeyOn;
uniform vec3 uKeyColor;
uniform float uKeySim;
uniform float uKeySmooth;
uniform float uKeySpill;
uniform vec4 uKeyRefine;      // clipBlack, clipWhite, edgeShrinkPx, edgeFeatherPx
uniform vec4 uKeyExtra;       // lightWrap, viewMode (0=comp, 1=alpha, 2=status), 0, 0
uniform vec3 uLuma;           // threshold, softness, mode (0 off, 1 drop darks, 2 drop lights)
uniform vec3 uUnmult;         // threshold, softness, on
uniform bool uMaskOn;
uniform sampler2D uMask;
uniform float uMaskLo;
uniform float uMaskHi;
uniform sampler2D uMatte;
uniform int uMatteMode;       // 0=off, 1=alpha, 2=alphaInv, 3=luma, 4=lumaInv
uniform vec4 uShapeBox;       // centre, size (layer uv)
uniform vec4 uShapeOpt;       // rotation, feather, roundness, mode (0..8)
uniform bool uShapeInvert;
uniform vec4 uCrop;           // left, right, top, bottom (uv)
uniform float uCropFeather;

uniform bool uGradeOn;
uniform float uExposure;
uniform float uBright;
uniform float uContrast;
uniform float uHighlights;
uniform float uShadows;
uniform float uSat;
uniform float uVibrance;
uniform float uTemp;
uniform float uTint;
uniform float uHue;
uniform float uVignette;
uniform vec4 uGradeExtra;     // whites, blacks, fade, clarity
uniform vec4 uLift;           // rgb + y
uniform vec4 uGamma;          // rgb + y
uniform vec4 uGain;           // rgb + y
uniform bool uWheelsOn;
uniform sampler2D uCurves;
uniform float uCurvesMix;
uniform float uHslMix;
uniform vec4 uHslHueA;
uniform vec4 uHslHueB;
uniform vec4 uHslSatA;
uniform vec4 uHslSatB;
uniform vec4 uHslLumA;
uniform vec4 uHslLumB;
uniform vec4 uColorKey;       // target rgb, mode (0=off, 1=isolate, 2=remove, 3=replace)
uniform vec4 uColorKeyOpt;    // targetHue01, range01, soft01, minSat
uniform float uLutMix;
uniform sampler3D uLut;
uniform float uLutSize;
uniform vec4 uDuoDark;        // colour, amount
uniform vec3 uDuoLight;
uniform float uPoster;
uniform float uInvert;

uniform vec2 uGrain;          // amount, cell (render px)
uniform vec4 uLeak;           // colour, amount
uniform float uLeakT;
uniform float uBars;          // target aspect ratio (0 off)
uniform vec4 uEdgeGlow;       // intensity, threshold, thicknessPx, mix
uniform vec3 uEdgeColor;
uniform vec4 uGodRays;        // x, y, intensity, decay
uniform vec4 uGodRaysCol;     // r, g, b, threshold
uniform vec4 uFlare;          // x, y, intensity, streak
uniform vec4 uFlareOpt;       // scale, rotRad, 0, 0
uniform vec3 uFlareCol;
uniform vec4 uCrt;            // curvature, scanlines, grille, flicker
uniform float uCrtVig;
uniform vec4 uPart;           // amount, sizePx, speed, wind
uniform vec4 uPartCol;        // r, g, b, kind (0=off, 1=sparks, 2=snow, 3=rain, 4=bokeh, 5=dust)
uniform vec4 uStrobe;         // rate, duty, intensity, mode (0=off, 1=flash, 2=invert, 3=black)
uniform vec3 uStrobeCol;
uniform bool uFrameOn;
uniform vec4 uFrame;          // corner radius, border width, shadow opacity, shadow size (render px)
uniform vec3 uBorder;
out vec4 outColor;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}
vec2 rot2(vec2 p, float a) { float c = cos(a); float s = sin(a); return vec2(p.x * c - p.y * s, p.x * s + p.y * c); }
float sdBox(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
float sdStar5(vec2 p, float r, float rf) {
  const vec2 k1 = vec2(0.809016994375, -0.587785252292);
  const vec2 k2 = vec2(-k1.x, k1.y);
  p.x = abs(p.x);
  p -= 2.0 * max(dot(k1, p), 0.0) * k1;
  p -= 2.0 * max(dot(k2, p), 0.0) * k2;
  p.x = abs(p.x);
  p.y -= r;
  vec2 ba = rf * vec2(-k1.y, k1.x) - vec2(0.0, 1.0);
  float h = clamp(dot(p, ba) / dot(ba, ba), 0.0, r);
  return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
}
float dot2(vec2 v) { return dot(v, v); }
float sdHeart(vec2 p) {
  p.x = abs(p.x);
  if (p.y + p.x > 1.0) return sqrt(dot2(p - vec2(0.25, 0.75))) - sqrt(2.0) / 4.0;
  return sqrt(min(dot2(p - vec2(0.0, 1.0)), dot2(p - 0.5 * max(p.x + p.y, 0.0)))) * sign(p.x - p.y);
}
vec3 hueRotate(vec3 c, float a) {
  const vec3 k = vec3(0.57735);
  float ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}
vec3 rgb2hsl(vec3 c) {
  float mx = max(c.r, max(c.g, c.b));
  float mn = min(c.r, min(c.g, c.b));
  float d = mx - mn;
  float l = (mx + mn) * 0.5;
  float s = d > 0.0001 ? d / (1.0 - abs(2.0 * l - 1.0) + 0.0001) : 0.0;
  float h = 0.0;
  if (d > 0.0001) {
    if (mx == c.r) h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
    else if (mx == c.g) h = (c.b - c.r) / d + 2.0;
    else h = (c.r - c.g) / d + 4.0;
    h /= 6.0;
  }
  return vec3(h, clamp(s, 0.0, 1.0), clamp(l, 0.0, 1.0));
}
float hue2c(float p, float q, float t) {
  if (t < 0.0) t += 1.0;
  if (t > 1.0) t -= 1.0;
  if (t < 1.0 / 6.0) return p + (q - p) * 6.0 * t;
  if (t < 0.5) return q;
  if (t < 2.0 / 3.0) return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
  return p;
}
vec3 hsl2rgb(vec3 hsl) {
  if (hsl.y <= 0.0001) return vec3(hsl.z);
  float q = hsl.z < 0.5 ? hsl.z * (1.0 + hsl.y) : hsl.z + hsl.y - hsl.z * hsl.y;
  float p = 2.0 * hsl.z - q;
  return vec3(hue2c(p, q, hsl.x + 1.0 / 3.0), hue2c(p, q, hsl.x), hue2c(p, q, hsl.x - 1.0 / 3.0));
}

vec4 src(vec2 uv) {
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec4(0.0);
  if (uSource == 1) return vec4(uColor.rgb * uColor.a, uColor.a);
  if (uSource == 2) {
    vec2 d = vec2(cos(uGradAngle), sin(uGradAngle));
    vec2 p = (uv - 0.5) * uLayerPx;
    float span = abs(d.x) * uLayerPx.x + abs(d.y) * uLayerPx.y;
    vec4 c = mix(uColor, uColor2, clamp(dot(p, d) / max(span, 1.0) + 0.5, 0.0, 1.0));
    return vec4(c.rgb * c.a, c.a);
  }
  return texture(uTex, uFlipTexY > 0 ? vec2(uv.x, 1.0 - uv.y) : uv);
}

vec4 tap(vec2 uv, vec2 split) {
  vec4 c = src(uv);
  vec2 sp = split;
  if (uChromaLens.x > 0.0) {
    vec2 d = uv - 0.5;
    sp += d * pow(length(d) * 2.0, uChromaLens.y) * uChromaLens.x * 0.03;
  }
  if (sp.x != 0.0 || sp.y != 0.0) {
    vec4 r = src(uv + sp);
    vec4 b = src(uv - sp);
    c = vec4(r.r, c.g, b.b, max(c.a, max(r.a, b.a)));
  }
  return c;
}

vec4 gather(vec2 uv, vec2 split) {
  if (uMotion.z > 0.5) {
    vec4 acc = vec4(0.0);
    for (int i = 0; i < 16; i++) acc += tap(uv + uMotion.xy * (float(i) / 15.0 - 0.5), split);
    return acc / 16.0;
  }
  if (uRadial.z > 0.0) {
    vec4 acc = vec4(0.0);
    for (int i = 0; i < 16; i++) acc += tap(uRadial.xy + (uv - uRadial.xy) * (1.0 - uRadial.z * float(i) / 15.0), split);
    return acc / 16.0;
  }
  return tap(uv, split);
}

// BT.709 chroma, the space OBS keys in: green screens separate cleanly from skin tones.
vec2 cbcr(vec3 c) {
  return vec2(dot(c, vec3(-0.1146, -0.3854, 0.5)), dot(c, vec3(0.5, -0.4542, -0.0458)));
}

vec3 ycbcr709(vec3 c) {
  return vec3(dot(c, LUMA), cbcr(c));
}

vec3 rgbFromYcbcr709(float y, vec2 c) {
  return clamp(vec3(y + 1.5748 * c.y, y - 0.187324 * c.x - 0.468124 * c.y, y + 1.8556 * c.x), 0.0, 1.0);
}

float chromaMatte(vec3 c, vec3 keyC, float simN, float smoothN) {
  vec3 ycc = ycbcr709(c);
  vec3 kycc = ycbcr709(keyC);
  float dChroma = length(ycc.yz - kycc.yz);
  float dLuma = abs(ycc.x - kycc.x) * 0.12;
  float dist = sqrt(dChroma * dChroma + dLuma * dLuma);
  float sim = simN * 0.42;
  float sm = max(smoothN * 0.35, 0.002);
  return smoothstep(0.0, 1.0, (dist - sim) / sm);
}

void main() {
  vec2 px = max(uLayerPx, vec2(1.0));
  vec2 uv = vUv;

  // CRT barrel curvature distorts coords before any lookup.
  if (uCrt.x > 0.0) {
    vec2 c = uv * 2.0 - 1.0;
    vec2 off = abs(c.yx) * (0.25 * uCrt.x + 0.01);
    c = c + c * off * off * 3.5;
    uv = c * 0.5 + 0.5;
  }

  // 3D tilt & perspective warp via reverse ray-plane projection.
  if (uPersp.w > 0.0) {
    vec2 p = (uv - 0.5) * vec2(px.x / px.y, 1.0);
    float dist = max(0.4, uPersp.w);
    float cy = cos(uPersp.y); float sy = sin(uPersp.y);
    float cx = cos(uPersp.x); float sx = sin(uPersp.x);
    float cz = cos(uPersp.z); float sz = sin(uPersp.z);
    // Construct camera ray through screen plane at z = dist and intersect tilted plane z = 0.
    vec3 rd = normalize(vec3(p, -dist));
    vec3 n = vec3(0.0, 0.0, 1.0);
    // Rotate plane normal / axes
    vec3 rx = vec3(1.0, 0.0, 0.0);
    vec3 ry = vec3(0.0, 1.0, 0.0);
    // Roll (Z)
    vec3 rx1 = rx * cz + ry * sz;
    vec3 ry1 = -rx * sz + ry * cz;
    // Yaw (Y)
    vec3 rx2 = vec3(rx1.x * cy - n.x * sy, rx1.y * cy - n.y * sy, rx1.z * cy - n.z * sy);
    vec3 n2 = vec3(rx1.x * sy + n.x * cy, rx1.y * sy + n.y * cy, rx1.z * sy + n.z * cy);
    // Pitch (X)
    vec3 ry3 = vec3(ry1.x * cx + n2.x * sx, ry1.y * cx + n2.y * sx, ry1.z * cx + n2.z * sx);
    vec3 n3 = vec3(-ry1.x * sx + n2.x * cx, -ry1.y * sx + n2.y * cx, -ry1.z * sx + n2.z * cx);
    vec3 ro = vec3(0.0, 0.0, dist);
    float denom = dot(rd, n3);
    if (abs(denom) < 0.001) { outColor = vec4(0.0); return; }
    float hitT = -dot(ro, n3) / denom;
    if (hitT < 0.0) { outColor = vec4(0.0); return; }
    vec3 hp = ro + rd * hitT;
    uv = vec2(dot(hp, rx2) / (px.x / px.y), dot(hp, ry3)) + 0.5;
  }

  // Camera move inside the frame (stabilisation and shake): rotate and zoom about the centre.
  if (uMove.x != 0.0 || uMove.y != 0.0 || uMove.z != 0.0 || uMove.w != 1.0) {
    vec2 p = rot2((uv - uMove.xy - 0.5) * px, -uMove.z) / max(uMove.w, 0.01);
    uv = p / px + 0.5;
  }
  if (uMirror.x > 0.5) {
    float ax = uMirror.y;
    if (uMirror.x < 1.5) { if (uv.x > ax) uv.x = 2.0 * ax - uv.x; }
    else if (uMirror.x < 2.5) { if (uv.x < ax) uv.x = 2.0 * ax - uv.x; }
    else if (uMirror.x < 3.5) { if (uv.y > ax) uv.y = 2.0 * ax - uv.y; }
    else if (uMirror.x < 4.5) { if (uv.y < ax) uv.y = 2.0 * ax - uv.y; }
    else uv = 1.0 - abs(mod(uv * 2.0, 2.0) - 1.0);
  }
  if (uKaleido.x > 0.5) {
    vec2 p = (uv - 0.5) * px;
    float seg = 6.2831853 / uKaleido.x;
    float a = mod(atan(p.y, p.x) - uKaleido.y, seg);
    a = min(a, seg - a);
    uv = vec2(cos(a + uKaleido.y), sin(a + uKaleido.y)) * length(p) / px + 0.5;
  }
  if (uLens != 0.0) {
    float m = max(px.x, px.y);
    vec2 p = (uv - 0.5) * px / m * 2.0;
    float r2 = min(dot(p, p), 1.0);
    p *= 1.0 - uLens * 0.5 * (1.0 - r2);
    uv = p * 0.5 * m / px + 0.5;
  }
  if (uWave.w > 0.5) {
    uv.x += uWave.x * sin(uv.y * uWave.y * 6.2831853 + uWave.z);
    uv.y += uWave.x * 0.35 * (px.x / px.y) * sin(uv.x * uWave.y * 4.0 + uWave.z * 1.3);
  }
  if (uHeat.x > 0.0) {
    vec2 np = uv * uHeat.z + vec2(0.0, uTime * uHeat.w * uHeat.y);
    float nx = noise2(np) - 0.5;
    float ny = noise2(np + 17.3) - 0.5;
    uv += vec2(nx, ny) * uHeat.x * 0.035;
  }
  if (uShockStr > 0.0 && uShock.z > 0.0 && uShock.z < 1.0) {
    vec2 aspectScale = vec2(px.x / px.y, 1.0);
    vec2 d = (uv - uShock.xy) * aspectScale;
    float dist = length(d);
    float rad = uShock.z * 0.9;
    float diff = abs(dist - rad);
    if (diff < uShock.w && dist > 0.0001) {
      float fall = 1.0 - smoothstep(0.0, uShock.w, diff);
      uv -= normalize(d) / aspectScale * fall * sin(fall * 3.14159) * uShockStr * 0.08 * (1.0 - uShock.z * 0.4);
    }
  }
  vec2 split = uSplit;
  if (uVhs > 0.0) {
    float line = floor(uv.y * px.y / max(2.0 * uScale, 1.0));
    uv.x += (hash(vec2(line, floor(uTime * 24.0))) - 0.5) * 0.004 * uVhs + sin(uv.y * 30.0 + uTime * 2.0) * 0.002 * uVhs;
    float band = fract(uTime * 0.11 + uSeed * 0.37);
    uv.x += (1.0 - smoothstep(0.0, 0.03, abs(uv.y - band))) * 0.012 * uVhs;
    split += vec2(3.0 * uScale * uVhs / px.x, 0.0);
  }
  if (uGlitch > 0.0) {
    float t = floor(uGlitchT * 14.0);
    float bandG = floor(uv.y * 18.0 + hash(vec2(t, 1.0)) * 5.0);
    float on = step(1.0 - uGlitch * 0.55, hash(vec2(bandG, t)));
    uv.x += (hash(vec2(bandG, t + 3.0)) - 0.5) * 0.2 * uGlitch * on;
    uv.y += step(0.94, hash(vec2(t, 11.0))) * (hash(vec2(t, 13.0)) - 0.5) * 0.05 * uGlitch;
    split += vec2(uGlitch * 0.014 * (0.4 + hash(vec2(t, 7.0))), 0.0);
  }
  if (uPixel > 0.0) {
    vec2 b = vec2(uPixel) / px;
    uv = (floor(uv / b) + 0.5) * b;
  }

  vec4 base = gather(uv, split);
  if (uPrism.x > 0.0) {
    vec4 pAcc = vec4(0.0);
    int nF = int(clamp(uPrism.w, 2.0, 8.0));
    vec2 pDir = vec2(cos(uPrism.z), sin(uPrism.z)) * uPrism.y;
    for (int fi = 0; fi < 8; fi++) {
      if (fi >= nF) break;
      float fOff = (float(fi) / float(nF - 1) - 0.5) * 2.0;
      vec2 fUv = uv + pDir * fOff;
      vec4 fS = src(fUv);
      vec4 fR = src(fUv + pDir * 0.18);
      vec4 fB = src(fUv - pDir * 0.18);
      pAcc += vec4(fR.r, fS.g, fB.b, fS.a);
    }
    pAcc /= float(nF);
    base = mix(base, pAcc, uPrism.x);
  }
  if (uTiltShift.z > 0.0) {
    vec2 tp = rot2(uv - 0.5, uTiltShift.w);
    float distBand = max(0.0, abs(tp.y - (uTiltShift.x - 0.5)) - uTiltShift.y * 0.5);
    float bAmt = smoothstep(0.0, 0.35, distBand) * uTiltShift.z;
    if (bAmt > 0.4) {
      vec4 tAcc = vec4(0.0);
      for (int ti = 0; ti < 8; ti++) {
        float ang = float(ti) * 0.785398;
        vec2 off = vec2(cos(ang), sin(ang)) * bAmt / px;
        tAcc += src(uv + off * 0.65) + src(uv + off * 1.25);
      }
      base = mix(base, tAcc / 16.0, smoothstep(0.4, 2.5, bAmt));
    }
  }
  if (uSharpen > 0.0 || (uGradeOn && uGradeExtra.w != 0.0)) {
    vec2 o = (uSharpen > 0.0 ? 1.5 : 2.5) / px;
    vec4 n = tap(uv + vec2(o.x, 0.0), split) + tap(uv - vec2(o.x, 0.0), split) + tap(uv + vec2(0.0, o.y), split) + tap(uv - vec2(0.0, o.y), split);
    float amt = uSharpen * 0.3 + (uGradeOn ? uGradeExtra.w * 0.28 : 0.0);
    base.rgb = clamp(base.rgb + (base.rgb * 4.0 - n.rgb) * amt, vec3(0.0), vec3(base.a));
  }
  if (uHalftone > 0.0) {
    vec2 g = uv * px / uHalftone;
    vec4 cc = gather((floor(g) + 0.5) * uHalftone / px, split);
    vec3 ccol = cc.a > 0.0001 ? cc.rgb / cc.a : vec3(0.0);
    float rad = sqrt(dot(ccol, LUMA)) * 0.62;
    float ink = 1.0 - smoothstep(rad - 0.06, rad + 0.06, length(fract(g) - 0.5));
    base = vec4(ccol * ink * cc.a, cc.a);
  }

  float a = base.a;
  vec3 col = a > 0.0001 ? clamp(base.rgb / a, 0.0, 1.0) : vec3(0.0);

  if (uKeyOn) {
    vec2 kc = cbcr(uKeyColor);
    float rawM = chromaMatte(col, uKeyColor, uKeySim, uKeySmooth);
    // 2-ring 16-tap choke & edge feather in calibrated BT.709 CbCr space.
    if (abs(uKeyRefine.z) > 0.01 || uKeyRefine.w > 0.01) {
      float choke = clamp(abs(uKeyRefine.z), 0.0, 8.0);
      float feather = clamp(uKeyRefine.w, 0.0, 10.0);
      float rad1 = max(0.75, (choke + feather) * 0.5);
      float rad2 = max(1.5, choke + feather);
      float mMin = rawM;
      float mMax = rawM;
      float mAvg = rawM;
      float wSum = 1.0;
      for (int ki = 0; ki < 8; ki++) {
        float ang = float(ki) * 0.78539816;
        vec2 dir = vec2(cos(ang), sin(ang));
        vec4 n1 = src(uv + dir * (rad1 / px));
        vec3 c1 = n1.a > 0.0001 ? clamp(n1.rgb / n1.a, 0.0, 1.0) : vec3(0.0);
        float m1 = chromaMatte(c1, uKeyColor, uKeySim, uKeySmooth);
        vec4 n2 = src(uv + dir * (rad2 / px));
        vec3 c2 = n2.a > 0.0001 ? clamp(n2.rgb / n2.a, 0.0, 1.0) : vec3(0.0);
        float m2 = chromaMatte(c2, uKeyColor, uKeySim, uKeySmooth);
        mMin = min(mMin, min(m1, m2));
        mMax = max(mMax, max(m1, m2));
        mAvg += m1 * 0.7 + m2 * 0.45;
        wSum += 1.15;
      }
      mAvg /= wSum;
      float choked = uKeyRefine.z >= 0.0 ? mix(rawM, mMin, clamp(uKeyRefine.z / 8.0, 0.0, 1.0)) : mix(rawM, mMax, clamp(-uKeyRefine.z / 8.0, 0.0, 1.0));
      rawM = mix(choked, mAvg, clamp(feather / 10.0, 0.0, 0.78));
    }
    float clipLo = uKeyRefine.x;
    float clipHi = max(clipLo + 0.001, uKeyRefine.y);
    float kMatte = clamp((rawM - clipLo) / (clipHi - clipLo), 0.0, 1.0);
    // Hue-preserving CbCr projection despill along key vector so skin tones stay warm.
    float kLen = length(kc);
    if (uKeySpill > 0.001 && kLen > 0.0001) {
      vec3 pxYcc = ycbcr709(col);
      vec2 kDir = kc / kLen;
      float proj = dot(pxYcc.yz, kDir);
      if (proj > 0.0) {
        float simScaled = uKeySim * 0.42;
        float smScaled = max(uKeySmooth * 0.35, 0.002);
        float dChroma = length(pxYcc.yz - kc);
        float prox = 1.0 - smoothstep(simScaled * 0.5, simScaled + smScaled * 2.2 + 0.12, dChroma);
        float strength = clamp(uKeySpill, 0.0, 1.0) * (0.35 + 0.65 * prox);
        float reduce = proj * clamp(strength, 0.0, 1.0);
        col = rgbFromYcbcr709(pxYcc.x, pxYcc.yz - kDir * reduce);
      }
    }
    if (uKeyExtra.x > 0.0) {
      float edgeBand = (1.0 - kMatte) * kMatte * 4.0;
      col = clamp(col + edgeBand * uKeyExtra.x * 0.16, 0.0, 1.0);
    }
    int vm = int(uKeyExtra.y + 0.5);
    if (vm == 1) {
      col = vec3(kMatte);
      a = 1.0;
    } else if (vm == 2) {
      float stVal = kMatte <= 0.01 ? 0.0 : (kMatte >= 0.99 ? 1.0 : 0.48);
      col = vec3(stVal);
      a = 1.0;
    } else {
      a *= kMatte;
    }
  }
  if (uLuma.z > 0.5) {
    float l = dot(col, LUMA);
    float lo = uLuma.x;
    float hi = uLuma.x + max(uLuma.y, 0.001);
    a *= uLuma.z < 1.5 ? smoothstep(lo, hi, l) : 1.0 - smoothstep(1.0 - hi, 1.0 - lo, l);
  }
  if (uUnmult.z > 0.5) {
    float peak = max(col.r, max(col.g, col.b));
    float um = smoothstep(uUnmult.x, uUnmult.x + max(uUnmult.y, 0.002), peak);
    col = peak > 0.001 ? clamp(col / max(peak, 0.001), 0.0, 1.0) * um : vec3(0.0);
    a *= um;
  }
  if (uMaskOn) {
    float m = texture(uMask, clamp(uv, 0.0, 1.0)).r;
    a *= smoothstep(uMaskLo, uMaskHi, m);
  }
  // Track matte sampled in composition space so matte alignment matches track above regardless of transform.
  if (uMatteMode > 0) {
    vec4 mt = texture(uMatte, gl_FragCoord.xy / max(uRes, vec2(1.0)));
    float mv = uMatteMode <= 2 ? mt.a : (mt.a > 0.0001 ? dot(mt.rgb / mt.a, LUMA) * mt.a : 0.0);
    if (uMatteMode == 2 || uMatteMode == 4) mv = 1.0 - mv;
    a *= clamp(mv, 0.0, 1.0);
  }
  // Shape masks and crops live in the layer's own space, so they stay put when the picture moves inside it.
  if (uShapeOpt.w > 0.5) {
    vec2 p = rot2((vUv - uShapeBox.xy) * px, -uShapeOpt.x);
    vec2 hs = max(uShapeBox.zw * px * 0.5, vec2(1.0));
    float f = max(uShapeOpt.y, 0.0005);
    float m = 1.0;
    if (uShapeOpt.w < 1.5) m = 1.0 - smoothstep(1.0 - f, 1.0 + f, length(p / hs));
    else if (uShapeOpt.w < 2.5) {
      float r = uShapeOpt.z * min(hs.x, hs.y);
      float fp = f * min(hs.x, hs.y) * 2.0;
      m = 1.0 - smoothstep(-fp, fp, sdBox(p, hs, r));
    } else if (uShapeOpt.w < 3.5) m = 1.0 - smoothstep(1.0 - f, 1.0 + f, abs(p.y) / hs.y);
    else if (uShapeOpt.w < 4.5) m = 1.0 - smoothstep(-f, f, p.x / hs.x);
    else if (uShapeOpt.w < 5.5) {
      float mn = min(hs.x, hs.y);
      vec2 sp = vec2(p.x / (hs.x / mn), -p.y / (hs.y / mn));
      float d = sdStar5(sp, mn * 0.9, mix(0.32, 0.65, uShapeOpt.z));
      m = 1.0 - smoothstep(-f * mn, f * mn, d);
    } else if (uShapeOpt.w < 6.5) {
      float mn = min(hs.x, hs.y);
      vec2 hp = vec2(p.x / (hs.x / mn), -p.y / (hs.y / mn)) / mn + vec2(0.0, 0.55);
      m = 1.0 - smoothstep(-f, f, sdHeart(hp * 1.15));
    } else if (uShapeOpt.w < 7.5) {
      float dd = abs(p.x) / hs.x + abs(p.y) / hs.y;
      m = 1.0 - smoothstep(1.0 - f, 1.0 + f, dd);
    } else {
      m = smoothstep(-0.5 - f, 0.5 + f, p.x / max(hs.x * 2.0, 1.0));
    }
    if (uShapeInvert) m = 1.0 - m;
    a *= m;
  }
  if (uCrop.x + uCrop.y + uCrop.z + uCrop.w > 0.0) {
    float f = max(uCropFeather, 0.0005);
    a *= smoothstep(uCrop.x - f, uCrop.x + f, vUv.x) * (1.0 - smoothstep(1.0 - uCrop.y - f, 1.0 - uCrop.y + f, vUv.x))
       * smoothstep(uCrop.z - f, uCrop.z + f, vUv.y) * (1.0 - smoothstep(1.0 - uCrop.w - f, 1.0 - uCrop.w + f, vUv.y));
  }

  if (uGradeOn) {
    col *= exp2(uExposure);
    col *= vec3(1.0 + uTemp * 0.16 + uTint * 0.05, 1.0 - uTint * 0.09, 1.0 - uTemp * 0.16 + uTint * 0.05);
    col += uBright * 0.35;
    float l0 = dot(col, LUMA);
    col += (uShadows * (1.0 - smoothstep(0.0, 0.55, l0)) + uHighlights * smoothstep(0.45, 1.0, l0)) * 0.25;
    col += (uGradeExtra.y * (1.0 - smoothstep(0.0, 0.28, l0)) + uGradeExtra.x * smoothstep(0.68, 1.0, l0)) * 0.25;
    col = (col - 0.5) * (1.0 + uContrast) + 0.5;
    if (uGradeExtra.z > 0.0) {
      float lift = uGradeExtra.z * 0.14;
      col = lift + col * (1.0 - lift * 0.5);
    }
    float l = dot(col, LUMA);
    col = mix(vec3(l), col, 1.0 + uSat);
    if (uVibrance != 0.0) {
      float s = max(col.r, max(col.g, col.b)) - min(col.r, min(col.g, col.b));
      col = mix(vec3(l), col, 1.0 + uVibrance * (1.0 - clamp(s, 0.0, 1.0)));
    }
    if (uHue != 0.0) col = hueRotate(col, uHue);
    if (uVignette > 0.0) {
      float v = smoothstep(0.3, 1.0, length(vUv - 0.5) * 1.4142);
      col *= 1.0 - uVignette * v;
    }
    col = clamp(col, 0.0, 1.0);
  }
  if (uWheelsOn) {
    vec3 liftV = uLift.rgb + uLift.a;
    vec3 gammaV = uGamma.rgb + uGamma.a;
    vec3 gainV = uGain.rgb + uGain.a;
    col = col * (1.0 + gainV) + liftV * (1.0 - clamp(col, 0.0, 1.0));
    col = pow(max(col, vec3(0.0)), exp2(-gammaV * 1.4));
    col = clamp(col, 0.0, 1.0);
  }
  if (uCurvesMix > 0.0) {
    vec3 c = clamp(col, 0.0, 1.0);
    float cr = texture(uCurves, vec2(c.r, 0.5)).r;
    float cg = texture(uCurves, vec2(c.g, 0.5)).g;
    float cb = texture(uCurves, vec2(c.b, 0.5)).b;
    col = mix(col, vec3(cr, cg, cb), uCurvesMix);
  }
  if (uHslMix > 0.0) {
    vec3 hsl = rgb2hsl(col);
    float centers[8];
    centers[0] = 0.0; centers[1] = 30.0 / 360.0; centers[2] = 60.0 / 360.0; centers[3] = 120.0 / 360.0;
    centers[4] = 180.0 / 360.0; centers[5] = 240.0 / 360.0; centers[6] = 275.0 / 360.0; centers[7] = 320.0 / 360.0;
    float hAdj[8];
    hAdj[0] = uHslHueA.x; hAdj[1] = uHslHueA.y; hAdj[2] = uHslHueA.z; hAdj[3] = uHslHueA.w;
    hAdj[4] = uHslHueB.x; hAdj[5] = uHslHueB.y; hAdj[6] = uHslHueB.z; hAdj[7] = uHslHueB.w;
    float sAdj[8];
    sAdj[0] = uHslSatA.x; sAdj[1] = uHslSatA.y; sAdj[2] = uHslSatA.z; sAdj[3] = uHslSatA.w;
    sAdj[4] = uHslSatB.x; sAdj[5] = uHslSatB.y; sAdj[6] = uHslSatB.z; sAdj[7] = uHslSatB.w;
    float lAdj[8];
    lAdj[0] = uHslLumA.x; lAdj[1] = uHslLumA.y; lAdj[2] = uHslLumA.z; lAdj[3] = uHslLumA.w;
    lAdj[4] = uHslLumB.x; lAdj[5] = uHslLumB.y; lAdj[6] = uHslLumB.z; lAdj[7] = uHslLumB.w;
    float dh = 0.0; float ds = 0.0; float dl = 0.0;
    for (int hi = 0; hi < 8; hi++) {
      float d = abs(hsl.x - centers[hi]);
      if (d > 0.5) d = 1.0 - d;
      float w = smoothstep(0.14, 0.0, d);
      dh += hAdj[hi] * w; ds += sAdj[hi] * w; dl += lAdj[hi] * w;
    }
    float sw = clamp(hsl.y * 4.0, 0.0, 1.0);
    col = hsl2rgb(vec3(fract(hsl.x + dh * 0.15 * uHslMix + 1.0), clamp(hsl.y * max(0.0, 1.0 + ds * uHslMix), 0.0, 1.0), clamp(hsl.z + dl * 0.35 * uHslMix * sw, 0.0, 1.0)));
  }
  if (uColorKey.a > 0.5) {
    vec3 hsl = rgb2hsl(col);
    float d = abs(hsl.x - uColorKeyOpt.x);
    if (d > 0.5) d = 1.0 - d;
    float keep = 1.0 - smoothstep(uColorKeyOpt.y, uColorKeyOpt.y + max(uColorKeyOpt.z, 0.002), d);
    keep *= smoothstep(uColorKeyOpt.w, uColorKeyOpt.w + 0.1, hsl.y);
    int ckMode = int(uColorKey.a + 0.5);
    if (ckMode == 1) col = mix(vec3(dot(col, LUMA)), col, keep);
    else if (ckMode == 2) a *= (1.0 - keep);
    else col = mix(col, hsl2rgb(vec3(rgb2hsl(uColorKey.rgb).x, hsl.y, hsl.z)), keep);
  }
  if (uLutMix > 0.0) {
    vec3 c = clamp(col, 0.0, 1.0);
    col = mix(col, texture(uLut, c * ((uLutSize - 1.0) / uLutSize) + 0.5 / uLutSize).rgb, uLutMix);
  }
  if (uDuoDark.a > 0.0) col = mix(col, mix(uDuoDark.rgb, uDuoLight, dot(col, LUMA)), uDuoDark.a);
  if (uPoster > 1.5) col = floor(col * (uPoster - 1.0) + 0.5) / (uPoster - 1.0);
  if (uInvert > 0.0) col = mix(col, 1.0 - col, uInvert);

  // VFX & Optical overlays
  if (uEdgeGlow.x > 0.0) {
    vec2 eo = uEdgeGlow.z / px;
    vec3 gx = tap(uv + vec2(eo.x, 0.0), vec2(0.0)).rgb - tap(uv - vec2(eo.x, 0.0), vec2(0.0)).rgb;
    vec3 gy = tap(uv + vec2(0.0, eo.y), vec2(0.0)).rgb - tap(uv - vec2(0.0, eo.y), vec2(0.0)).rgb;
    float edge = clamp((length(gx) + length(gy) - uEdgeGlow.y) * 2.5, 0.0, 1.0);
    col = col * uEdgeGlow.w + uEdgeColor * edge * uEdgeGlow.x;
  }
  if (uGodRays.z > 0.0) {
    vec2 delta = (uv - uGodRays.xy) * 0.045;
    vec2 curUv = uv;
    float dec = 1.0;
    vec3 ray = vec3(0.0);
    for (int gi = 0; gi < 18; gi++) {
      curUv -= delta;
      vec4 gs = src(clamp(curUv, 0.0, 1.0));
      float gl = max(0.0, dot(gs.rgb, LUMA) - uGodRaysCol.a);
      ray += gs.rgb * gl * dec;
      dec *= uGodRays.w;
    }
    col += ray / 18.0 * uGodRaysCol.rgb * uGodRays.z * 2.4;
  }
  if (uFlare.z > 0.0) {
    vec2 ar = vec2(px.x / px.y, 1.0);
    vec2 fp = rot2((vUv - uFlare.xy) * ar, -uFlareOpt.y) / max(uFlareOpt.x, 0.1);
    float d = length(fp);
    float core = exp(-d * 10.0) * 1.4 + exp(-d * 3.0) * 0.35;
    float anam = exp(-abs(fp.y) * 32.0) * exp(-abs(fp.x) * 2.4) * uFlare.w;
    vec2 gPos = -((vUv - uFlare.xy) * ar) * 0.55;
    float g1 = smoothstep(0.14, 0.08, length((vUv - uFlare.xy) * ar - gPos * 1.1)) * 0.25;
    float g2 = smoothstep(0.22, 0.14, length((vUv - uFlare.xy) * ar - gPos * 1.85)) * 0.18;
    vec3 fl = uFlareCol * (core + g1 + g2) + mix(uFlareCol, vec3(0.35, 0.65, 1.0), 0.5) * anam;
    col = 1.0 - (1.0 - col) * (1.0 - clamp(fl * uFlare.z, 0.0, 1.0));
  }
  if (uPartCol.a > 0.5 && uPart.x > 0.0) {
    int pk = int(uPartCol.a + 0.5);
    float pSum = 0.0;
    int pLayers = 3;
    for (int pl = 0; pl < 3; pl++) {
      float fz = 1.0 + float(pl) * 0.55;
      float spd = uTime * uPart.z * (0.4 + float(pl) * 0.25);
      vec2 vel = pk == 1 ? vec2(uPart.w * 0.6, -spd * 0.8) : (pk == 3 ? vec2(uPart.w * 0.4, spd * 2.6) : vec2(uPart.w * 0.45, spd * 0.55));
      vec2 gp = vUv * (px / max(uPart.y * 8.0 / fz, 6.0)) - vel;
      vec2 id = floor(gp);
      vec2 lc = fract(gp) - 0.5;
      if (hash(id + float(pl) * 19.3) > 1.0 - uPart.x * 0.45) {
        vec2 j = vec2(sin(uTime * 1.7 + hash(id) * 6.28), cos(uTime * 1.3 + hash(id + 3.0) * 6.28)) * 0.22;
        vec2 dVec = lc - j;
        if (pk == 3) pSum += smoothstep(0.08, 0.0, abs(dVec.x)) * smoothstep(0.45, 0.0, abs(dVec.y)) * 0.8;
        else if (pk == 4) pSum += smoothstep(0.42, 0.18, length(dVec)) * 0.45;
        else pSum += smoothstep(0.28, 0.02, length(dVec));
      }
    }
    vec3 pCol = pk == 2 ? vec3(0.95, 0.98, 1.0) : (pk == 5 ? vec3(0.95, 0.85, 0.65) * 0.5 : uPartCol.rgb);
    col = clamp(col + pCol * pSum, 0.0, 1.0);
  }
  if (uCrt.y + uCrt.z + uCrt.w + uCrtVig > 0.0) {
    if (uCrt.y > 0.0) col *= 1.0 - uCrt.y * 0.35 * (0.5 + 0.5 * sin(uv.y * px.y * 1.6));
    if (uCrt.z > 0.0) {
      float sub = mod(uv.x * px.x, 3.0);
      vec3 maskRgb = sub < 1.0 ? vec3(1.2, 0.8, 0.8) : (sub < 2.0 ? vec3(0.8, 1.2, 0.8) : vec3(0.8, 0.8, 1.2));
      col = mix(col, col * maskRgb, uCrt.z * 0.65);
    }
    if (uCrt.w > 0.0) col *= 1.0 - uCrt.w * 0.15 * hash(vec2(floor(uTime * 48.0), 7.0));
    if (uCrtVig > 0.0) col *= 1.0 - uCrtVig * smoothstep(0.55, 1.25, length((uv - 0.5) * 2.0));
    if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) a = 0.0;
  }
  if (uStrobe.a > 0.5 && uStrobe.z > 0.0) {
    float ph = fract(uTime * uStrobe.x);
    if (ph < uStrobe.y) {
      int sm = int(uStrobe.a + 0.5);
      if (sm == 1) col = mix(col, uStrobeCol, uStrobe.z);
      else if (sm == 2) col = mix(col, 1.0 - col, uStrobe.z);
      else col = mix(col, vec3(0.0), uStrobe.z);
    }
  }

  if (uGrain.x > 0.0) {
    vec2 cell = floor(vUv * px / max(uGrain.y, 1.0));
    float n = hash(cell + vec2(fract(floor(uTime * 24.0) * 0.618) * 131.0, uSeed)) - 0.5;
    col += n * uGrain.x * 0.32 * (1.0 - dot(col, LUMA) * 0.5);
  }
  if (uVhs > 0.0) {
    float lines = 0.5 + 0.5 * sin(vUv.y * px.y / max(uScale, 0.01) * 2.0944);
    col *= 1.0 - 0.16 * uVhs * lines;
    col += (hash(floor(vUv * px) + fract(uTime * 7.0) * 100.0) - 0.5) * 0.07 * uVhs;
    col = mix(col, col * vec3(1.06, 0.98, 0.88), 0.6 * uVhs);
  }
  if (uLeak.a > 0.0) {
    vec2 c1 = vec2(0.12 + 0.28 * sin(uLeakT * 0.7 + uSeed), 0.18 + 0.22 * cos(uLeakT * 0.53 + uSeed * 2.0));
    vec2 c2 = vec2(0.88 + 0.18 * cos(uLeakT * 0.61 + uSeed * 3.0), 0.8 + 0.2 * sin(uLeakT * 0.83));
    float g1 = 1.0 - smoothstep(0.0, 0.85, length((vUv - c1) * vec2(1.0, 1.3)));
    float g2 = 1.0 - smoothstep(0.0, 0.7, length((vUv - c2) * vec2(1.3, 1.0)));
    vec3 leak = uLeak.rgb * (g1 * g1 * 0.95 + g2 * g2 * 0.7) + vec3(1.0, 0.92, 0.78) * pow(g1, 6.0) * 0.4;
    col = 1.0 - (1.0 - col) * (1.0 - clamp(leak * uLeak.a, 0.0, 1.0));
  }
  col = clamp(col, 0.0, 1.0);
  if (uBars > 0.0) {
    float aspect = px.x / px.y;
    if (aspect < uBars) {
      float bar = (1.0 - aspect / uBars) * 0.5;
      bool inLayer = vUv.x >= 0.0 && vUv.x <= 1.0 && vUv.y >= 0.0 && vUv.y <= 1.0;
      if (inLayer && (vUv.y < bar || vUv.y > 1.0 - bar)) {
        col = vec3(0.0);
        a = 1.0;
      }
    }
  }

  vec4 outc = vec4(col * a, a);
  if (uFrameOn) {
    vec2 p = (vUv - 0.5) * px;
    vec2 hs = px * 0.5;
    float r = min(uFrame.x, min(hs.x, hs.y));
    float sd = sdBox(p, hs, r);
    float inside = 1.0 - smoothstep(-0.75, 0.75, sd);
    outc *= inside;
    if (uFrame.y > 0.0) outc = mix(outc, vec4(uBorder, 1.0), smoothstep(-uFrame.y - 0.75, -uFrame.y + 0.75, sd) * inside);
    if (uFrame.z > 0.0 && uFrame.w > 0.0) {
      float sds = sdBox(p - vec2(0.0, uFrame.w * 0.25), hs, r);
      float sh = uFrame.z * pow(clamp(1.0 - max(sds, 0.0) / uFrame.w, 0.0, 1.0), 2.0);
      outc += vec4(0.0, 0.0, 0.0, sh) * (1.0 - outc.a);
    }
  }
  outColor = outc * uOpacity;
}
`;

/** Separable Gaussian blur on a premultiplied texture (run once across, once down). */
export const BLUR_FS = `${HEADER}
uniform sampler2D uTex;
uniform vec2 uRes;
uniform vec2 uDir;
uniform float uRadius;
out vec4 outColor;
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float sigma = max(uRadius * 0.5, 0.001);
  float stepPx = max(1.0, uRadius / 16.0);
  int n = int(min(ceil(uRadius / stepPx), 16.0));
  vec4 acc = texture(uTex, uv);
  float wsum = 1.0;
  for (int i = 1; i <= 16; i++) {
    if (i > n) break;
    float x = float(i) * stepPx;
    float w = exp(-0.5 * x * x / (sigma * sigma));
    vec2 o = uDir * x / uRes;
    acc += (texture(uTex, uv + o) + texture(uTex, uv - o)) * w;
    wsum += 2.0 * w;
  }
  outColor = acc / wsum;
}
`;

/** Copies a texture (times an alpha) to the bound target: used to present, and for "normal" blending. */
export const COPY_FS = `${HEADER}
uniform sampler2D uTex;
uniform vec2 uRes;
uniform float uAlpha;
uniform float uChecker;
out vec4 outColor;
void main() {
  vec4 s = texture(uTex, gl_FragCoord.xy / uRes) * uAlpha;
  if (uChecker > 0.5) {
    vec2 cell = floor(gl_FragCoord.xy / 12.0);
    float dark = mod(cell.x + cell.y, 2.0);
    vec3 bg = mix(vec3(0.18, 0.18, 0.20), vec3(0.28, 0.28, 0.31), dark);
    outColor = vec4(s.rgb + bg * (1.0 - s.a), 1.0);
    return;
  }
  outColor = s;
}
`;

/** Extracts bright highlights into a premultiplied red-warm emulsion pass for 35mm Film Halation. */
export const HALATION_FS = `${HEADER}
uniform sampler2D uTex;
uniform vec2 uRes;
uniform float uThreshold;
uniform float uWarmth;
out vec4 outColor;
void main() {
  vec4 s = texture(uTex, gl_FragCoord.xy / uRes);
  vec3 c = s.a > 0.0001 ? s.rgb / s.a : vec3(0.0);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float e = smoothstep(uThreshold, min(1.0, uThreshold + 0.22), l);
  vec3 tint = mix(vec3(1.0, 0.55, 0.35), vec3(1.0, 0.22, 0.08), uWarmth);
  outColor = vec4(tint * e * s.a, e * s.a);
}
`;

/** Separable blend modes in the W3C compositing model, premultiplied in and out. */
export const BLEND_FS = `${HEADER}
uniform sampler2D uDst;
uniform sampler2D uSrc;
uniform vec2 uRes;
uniform int uMode;
out vec4 outColor;
float lum(vec3 c) { return dot(c, vec3(0.3, 0.59, 0.11)); }
vec3 clipCol(vec3 c) {
  float l = lum(c);
  float n = min(c.r, min(c.g, c.b));
  float x = max(c.r, max(c.g, c.b));
  if (n < 0.0) c = l + ((c - l) * l) / max(l - n, 0.0001);
  if (x > 1.0) c = l + ((c - l) * (1.0 - l)) / max(x - l, 0.0001);
  return c;
}
vec3 setLum(vec3 c, float l) { return clipCol(c + (l - lum(c))); }
float sat(vec3 c) { return max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b)); }
vec3 setSat(vec3 c, float s) {
  float mn = min(c.r, min(c.g, c.b));
  float mx = max(c.r, max(c.g, c.b));
  if (mx <= mn) return vec3(0.0);
  return (c - mn) / (mx - mn) * s;
}
vec3 blendFn(vec3 b, vec3 s) {
  if (uMode == 1) return b * s;
  if (uMode == 2) return b + s - b * s;
  if (uMode == 3) return mix(2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s), step(0.5, b));
  if (uMode == 4) return min(b + s, vec3(1.0));
  if (uMode == 5) return min(b, s);
  if (uMode == 6) return max(b, s);
  if (uMode == 7) return mix(2.0 * b * s + b * b * (1.0 - 2.0 * s), sqrt(b) * (2.0 * s - 1.0) + 2.0 * b * (1.0 - s), step(0.5, s));
  if (uMode == 8) return abs(b - s);
  if (uMode == 9) return mix(1.0 - min(vec3(1.0), (1.0 - b) / max(s, vec3(0.0001))), vec3(1.0), step(1.0, b));
  if (uMode == 10) return min(vec3(1.0), b / max(1.0 - s, vec3(0.0001)));
  if (uMode == 11) return mix(2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s), step(0.5, s));
  if (uMode == 12) return b + s - 2.0 * b * s;
  if (uMode == 13) return setLum(setSat(s, sat(b)), lum(b));
  if (uMode == 14) return setLum(setSat(b, sat(s)), lum(b));
  if (uMode == 15) return setLum(s, lum(b));
  if (uMode == 16) return setLum(b, lum(s));
  return s;
}
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec4 d = texture(uDst, uv);
  vec4 s = texture(uSrc, uv);
  vec3 cb = d.a > 0.0001 ? d.rgb / d.a : vec3(0.0);
  vec3 cs = s.a > 0.0001 ? s.rgb / s.a : vec3(0.0);
  vec3 mixed = (1.0 - d.a) * cs + d.a * blendFn(cb, cs);
  outColor = vec4(mixed * s.a + d.rgb * (1.0 - s.a), s.a + d.a * (1.0 - s.a));
}
`;

/** Transitions between two rendered layers A (outgoing) and B (incoming). uDir: motion in GL uv space. */
export const TRANSITION_FS = `${HEADER}
uniform sampler2D uA;
uniform sampler2D uB;
uniform bool uHasA;
uniform vec2 uRes;
uniform float uP;
uniform int uType;
uniform vec2 uDir;
out vec4 outColor;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float inside(vec2 uv) { return step(0.0, uv.x) * step(0.0, uv.y) * step(uv.x, 1.0) * step(uv.y, 1.0); }
vec4 A(vec2 uv) { return uHasA ? texture(uA, uv) * inside(uv) : vec4(0.0); }
vec4 B(vec2 uv) { return texture(uB, uv) * inside(uv); }
vec2 rot2(vec2 p, float a) { float c = cos(a); float s = sin(a); return vec2(p.x * c - p.y * s, p.x * s + p.y * c); }

vec4 radial(bool isA, vec2 uv, float strength) {
  vec2 c = vec2(0.5);
  vec4 acc = vec4(0.0);
  for (int i = 0; i < 14; i++) {
    float k = 1.0 - strength * float(i) / 13.0;
    vec2 q = c + (uv - c) * k;
    acc += isA ? A(q) : B(q);
  }
  return acc / 14.0;
}

vec4 disc(bool isA, vec2 uv, float r) {
  vec4 acc = isA ? A(uv) : B(uv);
  for (int i = 0; i < 12; i++) {
    float an = float(i) * 0.5236;
    vec2 o = vec2(cos(an), sin(an)) * r * (0.5 + 0.5 * float(i % 2));
    o.y *= uRes.x / uRes.y;
    acc += isA ? A(uv + o) : B(uv + o);
  }
  return acc / 13.0;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float p = clamp(uP, 0.0, 1.0);
  float e = p * p * (3.0 - 2.0 * p);
  float aspect = uRes.x / uRes.y;
  if (uType == 0) {
    outColor = mix(A(uv), B(uv), p);
  } else if (uType == 1 || uType == 5) {
    vec4 flat_ = uType == 1 ? vec4(0.0, 0.0, 0.0, 1.0) : vec4(1.0);
    outColor = p < 0.5 ? mix(A(uv), flat_, p * 2.0) : mix(flat_, B(uv), p * 2.0 - 1.0);
  } else if (uType == 2) {
    // Whip pan: one continuous camera move from A onto B, motion-blurred at its fastest.
    float blur = sin(p * 3.14159265) * 0.24;
    vec4 acc = vec4(0.0);
    for (int i = 0; i < 16; i++) {
      float f = (float(i) / 15.0 - 0.5) * blur;
      vec2 ua = uv - uDir * (e + f);
      vec2 ub = uv - uDir * (e + f - 1.0);
      acc += inside(ua) > 0.5 ? A(ua) : B(ub);
    }
    outColor = acc / 16.0;
  } else if (uType == 3) {
    // Zoom blur: A punches in and blurs out, B lands from a zoom.
    vec2 c = vec2(0.5);
    float strength = sin(p * 3.14159265) * 0.3;
    vec4 a = radial(true, c + (uv - c) / (1.0 + p * 0.9), strength);
    vec4 b = radial(false, c + (uv - c) / (1.0 + (1.0 - p) * 0.9), strength);
    outColor = mix(a, b, smoothstep(0.35, 0.65, p));
  } else if (uType == 4) {
    // Wipe with a soft edge, travelling along uDir.
    float s = dot(uv - 0.5, normalize(uDir)) + 0.5;
    float soft = 0.025;
    float band = p * (1.0 + 2.0 * soft) - soft;
    outColor = mix(A(uv), B(uv), 1.0 - smoothstep(band - soft, band + soft, s));
  } else if (uType == 6) {
    // Slide: B moves in over a still A.
    vec2 ub = uv + uDir * (1.0 - e);
    outColor = inside(ub) > 0.5 ? B(ub) + A(uv) * (1.0 - B(ub).a) : A(uv);
  } else if (uType == 7) {
    // Push: B shoves A out of frame.
    vec2 ua = uv - uDir * e;
    vec2 ub = uv + uDir * (1.0 - e);
    outColor = inside(ub) > 0.5 ? B(ub) : A(ua);
  } else if (uType == 8) {
    // Iris: a circle opens from the centre.
    float d = length((uv - 0.5) * vec2(aspect, 1.0)) / length(vec2(aspect, 1.0) * 0.5);
    outColor = mix(A(uv), B(uv), 1.0 - smoothstep(e * 1.05 - 0.02, e * 1.05 + 0.02, d));
  } else if (uType == 9) {
    // Clock wipe from twelve o'clock, clockwise.
    vec2 q = (uv - 0.5) * vec2(aspect, 1.0);
    float f = fract(atan(q.x, q.y) / 6.2831853 + 1.0);
    outColor = mix(A(uv), B(uv), 1.0 - smoothstep(p - 0.004, p + 0.004, f));
  } else if (uType == 10) {
    // Zoom in: push into A and land on B.
    vec2 c = vec2(0.5);
    vec4 a = A(c + (uv - c) / (1.0 + e * 1.2));
    vec4 b = B(c + (uv - c) / (0.75 + 0.25 * e));
    outColor = mix(a, b, smoothstep(0.35, 0.65, p));
  } else if (uType == 11) {
    // Spin: rotate out of A and into B, shrinking through the middle.
    vec2 c = vec2(0.5);
    float k = 1.0 + sin(p * 3.14159265) * 0.8;
    vec2 q = (uv - c) * vec2(aspect, 1.0);
    vec2 qa = rot2(q, e * 1.5708) * k / vec2(aspect, 1.0) + c;
    vec2 qb = rot2(q, (e - 1.0) * 1.5708) * k / vec2(aspect, 1.0) + c;
    outColor = mix(A(qa), B(qb), smoothstep(0.4, 0.6, p));
  } else if (uType == 12) {
    // Blur dissolve: defocus, swap, refocus.
    float r = sin(p * 3.14159265) * 0.025;
    outColor = mix(disc(true, uv, r), disc(false, uv, r), smoothstep(0.3, 0.7, p));
  } else if (uType == 13) {
    // Glitch: blocky tears and colour fringes, flickering between the shots.
    float amt = sin(p * 3.14159265);
    float t = floor(p * 24.0);
    float row = floor(uv.y * 14.0 + hash(vec2(t, 3.0)) * 4.0);
    vec2 g = uv + vec2((hash(vec2(row, t)) - 0.5) * 0.25 * amt * step(0.55, hash(vec2(row, t + 1.0))), 0.0);
    float split = 0.02 * amt;
    bool showB = p > 0.5 ? hash(vec2(t, 9.0)) > 0.15 : hash(vec2(t, 9.0)) > 0.85;
    vec4 c = showB ? B(g) : A(g);
    vec4 r = showB ? B(g + vec2(split, 0.0)) : A(g + vec2(split, 0.0));
    vec4 b = showB ? B(g - vec2(split, 0.0)) : A(g - vec2(split, 0.0));
    outColor = vec4(r.r, c.g, b.b, max(c.a, max(r.a, b.a)));
  } else if (uType == 14) {
    // Pixelate: the blocks grow, the shots swap, the blocks shrink.
    float cells = mix(uRes.x, 14.0, pow(sin(p * 3.14159265), 0.7));
    vec2 size = vec2(1.0 / cells, aspect / cells);
    vec2 q = (floor(uv / size) + 0.5) * size;
    outColor = mix(A(q), B(q), smoothstep(0.4, 0.6, p));
  } else if (uType == 15) {
    // Film burn: a warm flare washes over the cut.
    vec4 base = mix(A(uv), B(uv), smoothstep(0.35, 0.65, p));
    float amt = pow(sin(p * 3.14159265), 1.5);
    vec2 c = vec2(0.2 + 0.6 * p, 0.55 + 0.25 * sin(p * 6.0));
    float d = length((uv - c) * vec2(aspect, 1.0));
    float n = hash(floor(uv * 90.0) + floor(p * 30.0)) * 0.15;
    vec3 burn = vec3(1.0, 0.55, 0.18) * (1.0 - smoothstep(0.0, 1.2, d)) * 1.6 + vec3(1.0, 0.9, 0.7) * (1.0 - smoothstep(0.0, 0.45, d)) + n;
    vec3 col = 1.0 - (1.0 - base.rgb) * (1.0 - clamp(burn * amt, 0.0, 1.0));
    outColor = vec4(col, max(base.a, amt));
  } else if (uType == 16) {
    // Barn doors: B opens from the middle, along the travel direction's axis.
    vec2 axis = abs(normalize(uDir));
    float d = abs(dot(uv - 0.5, axis)) * 2.0;
    outColor = mix(A(uv), B(uv), 1.0 - smoothstep(e - 0.01, e + 0.01, d));
  } else {
    // Luma dissolve: B appears through A's brightest areas first.
    vec4 a = A(uv);
    float l = a.a > 0.0001 ? dot(a.rgb / a.a, LUMA) : 0.0;
    float th = 1.0 - p * 1.25 + 0.1;
    outColor = mix(a, B(uv), smoothstep(th - 0.1, th + 0.1, l));
  }
}
`;
