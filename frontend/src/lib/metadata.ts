/**
 * Removes metadata (EXIF: GPS, camera, dates; XMP; IPTC; comments) from JPEG, PNG and WebP without
 * re-encoding: the picture's bytes are copied as they are, only the metadata blocks are dropped.
 * The colour profile (ICC) is kept so colours don't shift, and a JPEG's rotation is kept as a
 * one-tag EXIF block so photos don't turn sideways.
 */

export type Stripped = { bytes: Uint8Array; removed: string[] };

export function stripMetadata(bytes: Uint8Array, orientation = 1): Stripped | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return stripJpeg(bytes, orientation);
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return stripPng(bytes);
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return stripWebp(bytes);
  return null;
}

const ascii = (b: Uint8Array, o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n));

function concat(parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** A minimal EXIF APP1 holding only the Orientation tag (big-endian TIFF). */
function orientationApp1(orientation: number) {
  const tiff = [0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0, 0, 0, 0, 0];
  const body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const len = body.length + 2;
  return new Uint8Array([0xff, 0xe1, len >> 8, len & 255, ...body]);
}

function stripJpeg(b: Uint8Array, orientation: number): Stripped {
  const out: Uint8Array[] = [b.subarray(0, 2)];
  const removed = new Set<string>();
  let p = 2;
  let insertedOrientation = false;
  while (p + 4 <= b.length) {
    if (b[p] !== 0xff) break;
    const marker = b[p + 1];
    if (marker === 0xd9) break;
    if (marker === 0xda) {
      // Start of scan: the rest is picture data (and the end marker); copy it as it is.
      out.push(b.subarray(p));
      p = b.length;
      break;
    }
    if (marker >= 0xd0 && marker <= 0xd7) {
      out.push(b.subarray(p, p + 2));
      p += 2;
      continue;
    }
    const len = (b[p + 2] << 8) | b[p + 3];
    const seg = b.subarray(p, p + 2 + len);
    const id = ascii(b, p + 4, 12);
    const label =
      marker === 0xe1 && id.startsWith("Exif")
        ? "EXIF (camera, date, GPS)"
        : marker === 0xe1 && id.startsWith("http://ns.adobe")
          ? "XMP"
          : marker === 0xed
            ? "IPTC / Photoshop"
            : marker === 0xfe
              ? "Comment"
              : marker >= 0xe3 && marker <= 0xef && marker !== 0xee
                ? "Maker data"
                : null;
    const drop = label !== null;
    if (label) removed.add(label);
    if (!drop) out.push(seg);
    if (!insertedOrientation && orientation > 1 && orientation <= 8 && (marker === 0xe0 || drop)) {
      out.push(orientationApp1(orientation));
      insertedOrientation = true;
    }
    p += 2 + len;
  }
  if (orientation > 1 && !insertedOrientation) out.splice(1, 0, orientationApp1(orientation));
  return { bytes: concat(out), removed: [...removed] };
}

function stripPng(b: Uint8Array): Stripped {
  const out: Uint8Array[] = [b.subarray(0, 8)];
  const removed = new Set<string>();
  const drop: Record<string, string> = { eXIf: "EXIF", tEXt: "Text notes", iTXt: "Text notes (XMP)", zTXt: "Text notes", tIME: "Date modified" };
  let p = 8;
  while (p + 12 <= b.length) {
    const len = ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0;
    const type = ascii(b, p + 4, 4);
    const end = p + 12 + len;
    if (drop[type]) removed.add(drop[type]);
    else out.push(b.subarray(p, end));
    p = end;
    if (type === "IEND") break;
  }
  return { bytes: concat(out), removed: [...removed] };
}

function stripWebp(b: Uint8Array): Stripped {
  const chunks: Uint8Array[] = [];
  const removed = new Set<string>();
  let p = 12;
  while (p + 8 <= b.length) {
    const type = ascii(b, p, 4);
    const len = b[p + 4] | (b[p + 5] << 8) | (b[p + 6] << 16) | (b[p + 7] << 24);
    const end = p + 8 + len + (len & 1);
    if (type === "EXIF") removed.add("EXIF");
    else if (type === "XMP ") removed.add("XMP");
    else {
      const c = b.slice(p, end);
      // VP8X carries "has EXIF / XMP" flags; clear them.
      if (type === "VP8X") c[8] &= ~(0x08 | 0x04);
      chunks.push(c);
    }
    p = end;
  }
  const body = concat(chunks);
  const head = new Uint8Array(12);
  head.set(b.subarray(0, 12));
  const size = body.length + 4;
  head[4] = size & 255;
  head[5] = (size >> 8) & 255;
  head[6] = (size >> 16) & 255;
  head[7] = (size >> 24) & 255;
  return { bytes: concat([head, body]), removed: [...removed] };
}
