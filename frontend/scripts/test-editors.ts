import assert from "node:assert/strict";
import {
  clientToImagePixel,
  computeContentRect,
  hslToRgbBytes,
  hsvToRgb,
  normalizeHex,
  rgbToHsv,
  sampleRgbaPatch,
} from "../src/lib/color-sample";
import {
  applyMatrixPt,
  fitReplacementMatrix,
  IDENTITY_MATRIX,
  mulMatrix,
  resetSmartMatrix,
  rotateMatrix,
  scaleMatrix,
  smartMetrics,
  transformBounds,
  translationOnlyMatrix,
} from "../src/components/tools/image/pro/smart-math";
import {
  clipUvFromProject,
  evalChromaKeyPixel,
  rgbToYCbCr709,
  ycbcrToRgb709,
} from "../src/features/video-studio/engine/render/chroma-math";

function hexBytes(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function testColorSample() {
  // 1. Letterbox: 1000x500 inside 400x400 box -> 400x200 centered at y=100
  const lb = computeContentRect(400, 400, 1000, 500);
  assert.equal(lb.x, 0);
  assert.equal(lb.y, 100);
  assert.equal(lb.w, 400);
  assert.equal(lb.h, 200);

  // 2. Pillarbox: 500x1000 inside 400x400 box -> 200x400 centered at x=100
  const pb = computeContentRect(400, 400, 500, 1000);
  assert.equal(pb.x, 100);
  assert.equal(pb.y, 0);
  assert.equal(pb.w, 200);
  assert.equal(pb.h, 400);

  // 3. clientToImagePixel exact coordinate mapping without offset drift
  const rect = { left: 50, top: 20, width: 400, height: 400 };
  assert.equal(clientToImagePixel(50 + 200, 20 + 40, rect, 1000, 500), null, "Top letterbox bar should return null");
  const topLeft = clientToImagePixel(50, 20 + 100, rect, 1000, 500);
  assert.deepEqual({ x: topLeft?.x, y: topLeft?.y }, { x: 0, y: 0 });
  const center = clientToImagePixel(50 + 200, 20 + 200, rect, 1000, 500);
  assert.deepEqual({ x: center?.x, y: center?.y }, { x: 500, y: 250 });
  const nearRight = clientToImagePixel(50 + 399.9, 20 + 299.9, rect, 1000, 500);
  assert.deepEqual({ x: nearRight?.x, y: nearRight?.y }, { x: 999, y: 499 });

  // 4. sampleRgbaPatch 1x1 vs 3x3 average
  const img = new Uint8ClampedArray(3 * 3 * 4);
  for (let i = 0; i < 9; i++) {
    const val = i === 4 ? 255 : 0;
    img[i * 4] = val;
    img[i * 4 + 1] = 90;
    img[i * 4 + 2] = 0;
    img[i * 4 + 3] = 255;
  }
  assert.equal(sampleRgbaPatch(img, 3, 3, 1, 1, 1).r, 255);
  assert.equal(sampleRgbaPatch(img, 3, 3, 1, 1, 3).r, Math.round(255 / 9));
  assert.equal(sampleRgbaPatch(img, 3, 3, 1, 1, 3).g, 90);

  // 5. Color math round-trips
  assert.equal(normalizeHex("#AbC"), "#aabbcc");
  assert.equal(normalizeHex("zzzzzz"), null);
  const [h, s, v] = rgbToHsv(235, 74, 16);
  const [rr, rg, rb] = hsvToRgb(h, s, v);
  assert.ok(Math.abs(rr - 235) <= 1 && Math.abs(rg - 74) <= 1 && Math.abs(rb - 16) <= 1);
  assert.deepEqual(hslToRgbBytes(120, 100, 50), [0, 255, 0]);
}

function testSmartMath() {
  // 1. Lossless shrink -> re-enlarge matrix composition equals identity
  const down = scaleMatrix(0.1, 0.1);
  const rot = rotateMatrix(37);
  const unrot = rotateMatrix(-37);
  const up = scaleMatrix(10, 10);
  const roundTrip = mulMatrix(up, mulMatrix(unrot, mulMatrix(rot, down)));
  for (let i = 0; i < 6; i++) {
    assert.ok(Math.abs(roundTrip[i] - IDENTITY_MATRIX[i]) < 1e-6, `Matrix element ${i} drifted: ${roundTrip[i]}`);
  }

  // 2. Transform bounds & metrics after 90° rotation
  const m = mulMatrix(translationOnlyMatrix(200, 100), rotateMatrix(90));
  const b = transformBounds(100, 50, m);
  assert.deepEqual(b, { x: 150, y: 100, w: 50, h: 100 });
  const met = smartMetrics(mulMatrix(rotateMatrix(45), scaleMatrix(1.5, -0.75)));
  assert.ok(Math.abs(met.scaleX - 1.5) < 1e-6);
  assert.ok(Math.abs(met.scaleY + 0.75) < 1e-6);
  assert.ok(Math.abs(met.rotationDeg - 45) < 1e-6);

  // 3. Reset transform preserves visual centre
  const scaledM = mulMatrix(translationOnlyMatrix(300, 200), scaleMatrix(0.5, 0.5));
  const origCenter = applyMatrixPt(scaledM, 100, 100);
  const reset = resetSmartMatrix(200, 200, scaledM);
  const newCenter = applyMatrixPt(reset, 100, 100);
  assert.ok(Math.abs(origCenter.x - newCenter.x) <= 1 && Math.abs(origCenter.y - newCenter.y) <= 1);

  // 4. Replace contents fits new size into old box cleanly
  const rep = fitReplacementMatrix(1000, 1000, 2000, 1000, translationOnlyMatrix(100, 50));
  const repMet = smartMetrics(rep);
  assert.ok(Math.abs(repMet.scaleX - 0.5) < 1e-6);
  assert.equal(rep[4], 100);
  assert.equal(rep[5], 300); // centered vertically: 50 + (1000 - 500) / 2
}

function testChromaMath() {
  // 1. BT.709 RGB <-> YCbCr round-trip
  const [y, cb, cr] = rgbToYCbCr709(0.82, 0.48, 0.29);
  const [r, g, b] = ycbcrToRgb709(y, cb, cr);
  assert.ok(Math.abs(r - 0.82) < 1e-4 && Math.abs(g - 0.48) < 1e-4 && Math.abs(b - 0.29) < 1e-4);

  const def = { similarity: 0.32, smoothness: 0.14, spill: 0.45, clipBlack: 0.05, clipWhite: 0.92 };

  // 2. Green & blue screens key cleanly to transparent
  for (const hex of ["#00ff00", "#00b140", "#3c8c4a", "#0047bb"]) {
    const keyRgb = hexBytes(hex);
    const res = evalChromaKeyPixel(keyRgb[0], keyRgb[1], keyRgb[2], { keyRgb, ...def });
    assert.ok(res.alpha < 0.05, `Expected ${hex} to key to alpha < 0.05, got ${res.alpha}`);
  }
  // Slightly unevenly lit green screen against #00b140 also keys cleanly
  const uneven = hexBytes("#18a045");
  assert.ok(evalChromaKeyPixel(uneven[0], uneven[1], uneven[2], { keyRgb: hexBytes("#00b140"), ...def }).alpha < 0.05);

  // 3. Skin tones and neutrals stay opaque against studio green
  const keyGreen = hexBytes("#00b140");
  for (const keepHex of ["#e0ac69", "#c68642", "#8d5524", "#ffffff", "#808080", "#000000"]) {
    const px = hexBytes(keepHex);
    const res = evalChromaKeyPixel(px[0], px[1], px[2], { keyRgb: keyGreen, ...def });
    assert.ok(res.alpha > 0.95, `Expected ${keepHex} to remain opaque (> 0.95), got ${res.alpha}`);
  }

  // 4. Hue-preserving despill keeps warm foreground skin R > B while reducing green excess
  const greenSpilledSkin: [number, number, number] = [0.68, 0.78, 0.44];
  const noSpill = evalChromaKeyPixel(...greenSpilledSkin, { keyRgb: keyGreen, similarity: 0.32, smoothness: 0.14, spill: 0 });
  const despilled = evalChromaKeyPixel(...greenSpilledSkin, { keyRgb: keyGreen, similarity: 0.32, smoothness: 0.14, spill: 0.85 });
  assert.ok(despilled.g < noSpill.g, "Despill must reduce green channel cast");
  assert.ok(despilled.r > despilled.b + 0.08, "Despill must preserve warm skin hue (not collapse to gray)");

  // 5. Clip UV projection with rotation and flips
  const geom = { x: 500, y: 500, sx: 1, sy: 1, bw: 400, bh: 200, rotDeg: 0 };
  const c0 = clipUvFromProject(500, 500, geom, false, false);
  assert.deepEqual(c0, { u: 0.5, v: 0.5 });
  const fl = clipUvFromProject(400, 450, geom, true, true);
  assert.ok(fl && Math.abs(fl.u - 0.75) < 1e-6 && Math.abs(fl.v - 0.75) < 1e-6);
  const rot90 = clipUvFromProject(500, 600, { ...geom, rotDeg: 90 }, false, false);
  assert.ok(rot90 && Math.abs(rot90.u - 0.75) < 1e-6 && Math.abs(rot90.v - 0.5) < 1e-6);
  assert.equal(clipUvFromProject(50, 50, geom, false, false), null);
}

testColorSample();
testSmartMath();
testChromaMath();
console.log("ALL EDITOR TESTS PASSED");
