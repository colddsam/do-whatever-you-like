// The parts of opentype.js 2.0 (MIT) this site uses. The package ships no types.
declare module "opentype.js" {
  export class BoundingBox {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  }
  export type PathCommand =
    | { type: "M" | "L"; x: number; y: number }
    | { type: "C"; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
    | { type: "Q"; x1: number; y1: number; x: number; y: number }
    | { type: "Z" };
  export class Path {
    commands: PathCommand[];
    fill: string | null;
    moveTo(x: number, y: number): void;
    lineTo(x: number, y: number): void;
    curveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): void;
    quadraticCurveTo(x1: number, y1: number, x: number, y: number): void;
    close(): void;
    toPathData(decimals?: number): string;
    getBoundingBox(): BoundingBox;
  }
  export class Glyph {
    constructor(options: { name?: string; unicode?: number; unicodes?: number[]; advanceWidth?: number; path?: Path });
    index: number;
    name?: string;
    unicode?: number;
    unicodes: number[];
    advanceWidth?: number;
    leftSideBearing?: number;
    path: Path;
    getPath(x?: number, y?: number, fontSize?: number): Path;
    getBoundingBox(): BoundingBox;
  }
  export class Font {
    constructor(options: {
      familyName: string;
      styleName: string;
      unitsPerEm: number;
      ascender: number;
      descender: number;
      glyphs: Glyph[];
      designer?: string;
      designerURL?: string;
      manufacturer?: string;
      license?: string;
      version?: string;
      copyright?: string;
      description?: string;
    });
    unitsPerEm: number;
    ascender: number;
    descender: number;
    glyphs: { length: number; get(index: number): Glyph };
    tables: Record<string, unknown>;
    charToGlyph(char: string): Glyph;
    toArrayBuffer(): ArrayBuffer;
  }
  export function parse(buffer: ArrayBuffer): Font;
}
