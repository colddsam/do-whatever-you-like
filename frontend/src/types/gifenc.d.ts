// gifenc 1.0.3 ships no types. Only what lib/gif.ts uses.
declare module "gifenc" {
  type Palette = number[][];
  type Format = "rgb565" | "rgb444" | "rgba4444";
  export function GIFEncoder(): {
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      opts?: { palette?: Palette; delay?: number; repeat?: number; transparent?: boolean; transparentIndex?: number; dispose?: number },
    ): void;
    finish(): void;
    bytes(): Uint8Array<ArrayBuffer>;
  };
  export function quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number, opts?: { format?: Format; oneBitAlpha?: boolean | number }): Palette;
  export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: Palette, format?: Format): Uint8Array;
}
