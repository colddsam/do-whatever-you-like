import { adjustmentById } from "./adjustments";
import { filterById } from "./filters";
import { copyImage, defaults, type Op } from "./ops";

/*
 * Looks: one-tap presets, like Lightroom's and the mobile editors'. Each is a recipe of the editor's
 * own adjustments and filters, so it previews, applies and undoes like any of them, with an Amount
 * slider that mixes the look with the original.
 */

type Step = [id: string, params: Record<string, unknown>];
type Look = { id: string; label: string; steps: Step[] };

const raw = (p: Record<string, number>): Step => ["camera-raw", p];
const grade = (p: Record<string, number>): Step => ["color-grading", p];

export const LOOKS: Look[] = [
  { id: "auto", label: "Auto", steps: [["auto-tone", {}], raw({ vibrance: 15, clarity: 10 })] },
  { id: "vivid", label: "Vivid", steps: [raw({ contrast: 18, vibrance: 40, saturation: 10, clarity: 15 })] },
  { id: "bright", label: "Bright & airy", steps: [raw({ exposure: 20, shadows: 35, highlights: -20, contrast: -10, vibrance: 10, temp: -5 })] },
  { id: "moody", label: "Moody", steps: [raw({ exposure: -15, contrast: 25, highlights: -35, shadows: -10, saturation: -25, vignette: 35, temp: -10 })] },
  { id: "golden", label: "Golden hour", steps: [raw({ temp: 35, tint: 6, vibrance: 20, shadows: 15 }), grade({ hh: 40, hs: 30, sh: 20, ss: 12 })] },
  { id: "teal-orange", label: "Teal & orange", steps: [raw({ contrast: 15, vibrance: 15 }), grade({ sh: 195, ss: 45, hh: 32, hs: 40 })] },
  { id: "film", label: "Film", steps: [raw({ contrast: -15, blacks: 30, grain: 25, saturation: -10, vignette: 20 }), grade({ sh: 160, ss: 20, hh: 40, hs: 20 })] },
  { id: "faded", label: "Faded", steps: [raw({ contrast: -30, blacks: 45, saturation: -20 })] },
  { id: "matte", label: "Matte", steps: [raw({ contrast: -10, blacks: 55, highlights: -20, clarity: 10 })] },
  { id: "cinema", label: "Cinematic", steps: [raw({ contrast: 25, highlights: -30, saturation: -15, vignette: 30 }), grade({ sh: 200, ss: 35, hh: 38, hs: 25, balance: -10 })] },
  { id: "cool", label: "Cool breeze", steps: [raw({ temp: -35, tint: -5, clarity: 10, vibrance: 15 })] },
  { id: "vintage", label: "Vintage", steps: [raw({ contrast: -10, blacks: 35, saturation: -30, vignette: 30, grain: 20, temp: 20 }), grade({ hh: 45, hs: 30, sh: 260, ss: 15 })] },
  { id: "bw", label: "B&W", steps: [["black-white", {}], raw({ contrast: 20, clarity: 15 })] },
  { id: "noir", label: "Noir", steps: [["black-white", { reds: 60, greens: 20, blues: -10 }], raw({ contrast: 55, blacks: -20, vignette: 50, grain: 15 })] },
  { id: "sepia", label: "Sepia", steps: [["black-white", { tint: true, tintColor: "#b08a5a" }], raw({ contrast: 10, vignette: 20 })] },
  { id: "hdr", label: "HDR", steps: [["shadows-highlights", { shadows: 55, highlights: 40, radius: 40 }], raw({ clarity: 50, vibrance: 25, dehaze: 15 })] },
  { id: "dreamy", label: "Dreamy", steps: [["orton", { amount: 40, radius: 20 }], raw({ exposure: 10, contrast: -10, temp: 8 })] },
  { id: "portrait", label: "Soft portrait", steps: [raw({ texture: -35, clarity: -10, temp: 8, vibrance: 10, shadows: 15 })] },
  { id: "food", label: "Food", steps: [raw({ temp: 18, vibrance: 35, clarity: 15, shadows: 20, exposure: 8 })] },
  { id: "landscape", label: "Landscape", steps: [raw({ dehaze: 25, clarity: 25, vibrance: 35, highlights: -25, shadows: 20 })] },
  { id: "lomo", label: "Lomo", steps: [raw({ contrast: 35, saturation: 30, vignette: 60 }), grade({ sh: 150, ss: 30, hh: 50, hs: 25 })] },
  { id: "duo", label: "Duotone", steps: [["duotone", {}]] },
];

const opFor = (id: string) => adjustmentById(id) ?? filterById(id);

/** A look as an operation: run the recipe, then mix it with the original by Amount. */
export function lookOp(look: Look): Op {
  return {
    id: `look:${look.id}`,
    label: `${look.label} look`,
    group: "Looks",
    hint: "Lower the amount for a subtler version, then fine-tune with Camera Raw.",
    params: [{ type: "range", key: "amount", label: "Amount", min: 0, max: 100, def: 100, unit: "%" }],
    apply(img, p, ctx) {
      const k = Number(p.amount ?? 100) / 100;
      const original = k < 1 ? copyImage(img) : null;
      let cur = img;
      for (const [id, params] of look.steps) {
        const op = opFor(id);
        if (!op) continue;
        // Spatial settings (blur radius…) follow the preview's scale, like any operation.
        const merged: Record<string, unknown> = { ...defaults(op), ...params };
        for (const d of op.params) if (d.type === "range" && d.px) merged[d.key] = Number(merged[d.key]) * ctx.scale;
        cur = op.apply(cur, merged, ctx) ?? cur;
      }
      if (original) {
        const d = cur.data;
        const o = original.data;
        for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) d[i + c] = o[i + c] + (d[i + c] - o[i + c]) * k;
      }
      return cur;
    },
  };
}

export const LOOK_OPS = LOOKS.map(lookOp);
export const lookById = (id: string) => LOOK_OPS.find((o) => o.id === id);
