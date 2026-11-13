/**
 * Every hash the hash tools offer, in the browser: SHA-2 and SHA-3 families, SHAKE, MD5, SHA-1
 * (@noble/hashes, MIT, audited), plus MD2, MD4, NTLM, CRC-16, CRC-32 and WordPress (phpass)
 * implemented here because no maintained library has them.
 */

import { hmac } from "@noble/hashes/hmac.js";
import { md5, sha1 } from "@noble/hashes/legacy.js";
import { sha224, sha256, sha384, sha512, sha512_224, sha512_256 } from "@noble/hashes/sha2.js";
import { sha3_224, sha3_256, sha3_384, sha3_512, shake128, shake256 } from "@noble/hashes/sha3.js";

export const enc = (s: string) => new TextEncoder().encode(s);
export const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

type Fn = (data: Uint8Array) => Uint8Array;
type HmacFn = Parameters<typeof hmac>[0];

export type HashAlg = {
  id: string;
  label: string;
  fn: Fn;
  /** For HMAC: the underlying hash (only SHA-1, SHA-2, SHA-3 and MD5 make sense). */
  hmac?: HmacFn;
  note?: string;
};

export const HASH_ALGS: HashAlg[] = [
  { id: "md2", label: "MD2", fn: md2, note: "Broken; for old systems only." },
  { id: "md4", label: "MD4", fn: md4, note: "Broken; for old systems only." },
  { id: "md5", label: "MD5", fn: md5, hmac: md5, note: "Checksums only; not for passwords or signatures." },
  { id: "ntlm", label: "NTLM", fn: (d) => md4(utf16le(new TextDecoder().decode(d))), note: "Windows password hash (MD4 of UTF-16LE)." },
  { id: "sha1", label: "SHA-1", fn: sha1, hmac: sha1, note: "Collisions exist; avoid for security." },
  { id: "sha224", label: "SHA-224", fn: sha224, hmac: sha224 },
  { id: "sha256", label: "SHA-256", fn: sha256, hmac: sha256 },
  { id: "sha384", label: "SHA-384", fn: sha384, hmac: sha384 },
  { id: "sha512", label: "SHA-512", fn: sha512, hmac: sha512 },
  { id: "sha512-224", label: "SHA-512/224", fn: sha512_224, hmac: sha512_224 },
  { id: "sha512-256", label: "SHA-512/256", fn: sha512_256, hmac: sha512_256 },
  { id: "sha3-224", label: "SHA3-224", fn: sha3_224, hmac: sha3_224 },
  { id: "sha3-256", label: "SHA3-256", fn: sha3_256, hmac: sha3_256 },
  { id: "sha3-384", label: "SHA3-384", fn: sha3_384, hmac: sha3_384 },
  { id: "sha3-512", label: "SHA3-512", fn: sha3_512, hmac: sha3_512 },
  { id: "shake128", label: "SHAKE-128 (256-bit)", fn: (d) => shake128(d, { dkLen: 32 }) },
  { id: "shake256", label: "SHAKE-256 (512-bit)", fn: (d) => shake256(d, { dkLen: 64 }) },
  { id: "crc16", label: "CRC-16 (ARC)", fn: (d) => u16(crc16(d)), note: "Error check, not a security hash." },
  { id: "crc32", label: "CRC-32", fn: (d) => u32(crc32(d)), note: "Error check (ZIP, PNG), not a security hash." },
];

export function hashHex(id: string, data: Uint8Array): string {
  const alg = HASH_ALGS.find((a) => a.id === id);
  if (!alg) throw new Error(`Unknown hash ${id}`);
  return toHex(alg.fn(data));
}

export function hmacHex(id: string, key: string, data: Uint8Array): string {
  const alg = HASH_ALGS.find((a) => a.id === id);
  if (!alg?.hmac) throw new Error(`${alg?.label ?? id} can't be used for HMAC here.`);
  return toHex(hmac(alg.hmac, enc(key), data));
}

/* ---------- helpers ---------- */

function utf16le(s: string) {
  const out = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out[i * 2] = c & 255;
    out[i * 2 + 1] = c >> 8;
  }
  return out;
}
const u16 = (n: number) => new Uint8Array([(n >> 8) & 255, n & 255]);
const u32 = (n: number) => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);

/** CRC-16/ARC (poly 0xA001 reflected), the common "CRC-16". */
export function crc16(d: Uint8Array): number {
  let crc = 0;
  for (const b of d) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
  }
  return crc & 0xffff;
}

let CRC_TABLE: Uint32Array | null = null;
export function crc32(d: Uint8Array): number {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const b of d) crc = CRC_TABLE[(crc ^ b) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** MD4 (RFC 1320). */
export function md4(input: Uint8Array): Uint8Array {
  const len = input.length;
  const padded = new Uint8Array(((len + 8) >> 6) * 64 + 64);
  padded.set(input);
  padded[len] = 0x80;
  const v = new DataView(padded.buffer);
  v.setUint32(padded.length - 8, (len * 8) >>> 0, true);
  v.setUint32(padded.length - 4, Math.floor((len * 8) / 2 ** 32), true);
  let a = 0x67452301, b = 0xefcdab89, c = 0x98badcfe, d = 0x10325476;
  const rotl = (x: number, n: number) => (x << n) | (x >>> (32 - n));
  const X = new Uint32Array(16);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) X[i] = v.getUint32(off + i * 4, true);
    const [aa, bb, cc, dd] = [a, b, c, d];
    const F = (x: number, y: number, z: number) => (x & y) | (~x & z);
    const G = (x: number, y: number, z: number) => (x & y) | (x & z) | (y & z);
    const H = (x: number, y: number, z: number) => x ^ y ^ z;
    for (const i of [0, 4, 8, 12]) {
      a = rotl((a + F(b, c, d) + X[i]) >>> 0, 3); d = rotl((d + F(a, b, c) + X[i + 1]) >>> 0, 7);
      c = rotl((c + F(d, a, b) + X[i + 2]) >>> 0, 11); b = rotl((b + F(c, d, a) + X[i + 3]) >>> 0, 19);
    }
    for (const i of [0, 1, 2, 3]) {
      a = rotl((a + G(b, c, d) + X[i] + 0x5a827999) >>> 0, 3); d = rotl((d + G(a, b, c) + X[i + 4] + 0x5a827999) >>> 0, 5);
      c = rotl((c + G(d, a, b) + X[i + 8] + 0x5a827999) >>> 0, 9); b = rotl((b + G(c, d, a) + X[i + 12] + 0x5a827999) >>> 0, 13);
    }
    for (const i of [0, 2, 1, 3]) {
      a = rotl((a + H(b, c, d) + X[i] + 0x6ed9eba1) >>> 0, 3); d = rotl((d + H(a, b, c) + X[i + 8] + 0x6ed9eba1) >>> 0, 9);
      c = rotl((c + H(d, a, b) + X[i + 4] + 0x6ed9eba1) >>> 0, 11); b = rotl((b + H(c, d, a) + X[i + 12] + 0x6ed9eba1) >>> 0, 15);
    }
    a = (a + aa) >>> 0; b = (b + bb) >>> 0; c = (c + cc) >>> 0; d = (d + dd) >>> 0;
  }
  const out = new Uint8Array(16);
  const o = new DataView(out.buffer);
  [a, b, c, d].forEach((w, i) => o.setUint32(i * 4, w, true));
  return out;
}

/** MD2 (RFC 1319). */
const S = [41, 46, 67, 201, 162, 216, 124, 1, 61, 54, 84, 161, 236, 240, 6, 19, 98, 167, 5, 243, 192, 199, 115, 140, 152, 147, 43, 217, 188, 76, 130, 202, 30, 155, 87, 60, 253, 212, 224, 22, 103, 66, 111, 24, 138, 23, 229, 18, 190, 78, 196, 214, 218, 158, 222, 73, 160, 251, 245, 142, 187, 47, 238, 122, 169, 104, 121, 145, 21, 178, 7, 63, 148, 194, 16, 137, 11, 34, 95, 33, 128, 127, 93, 154, 90, 144, 50, 39, 53, 62, 204, 231, 191, 247, 151, 3, 255, 25, 48, 179, 72, 165, 181, 209, 215, 94, 146, 42, 172, 86, 170, 198, 79, 184, 56, 210, 150, 164, 125, 182, 118, 252, 107, 226, 156, 116, 4, 241, 69, 157, 112, 89, 100, 113, 135, 32, 134, 91, 207, 101, 230, 45, 168, 2, 27, 96, 37, 173, 174, 176, 185, 246, 28, 70, 97, 105, 52, 64, 126, 15, 85, 71, 163, 35, 221, 81, 175, 58, 195, 92, 249, 206, 186, 197, 234, 38, 44, 83, 13, 110, 133, 40, 132, 9, 211, 223, 205, 244, 65, 129, 77, 82, 106, 220, 55, 200, 108, 193, 171, 250, 36, 225, 123, 8, 12, 189, 177, 74, 120, 136, 149, 139, 227, 99, 232, 109, 233, 203, 213, 254, 59, 0, 29, 57, 242, 239, 183, 14, 102, 88, 208, 228, 166, 119, 114, 248, 235, 117, 75, 10, 49, 68, 80, 180, 143, 237, 31, 26, 219, 153, 141, 51, 159, 17, 131, 20];
export function md2(input: Uint8Array): Uint8Array {
  const pad = 16 - (input.length % 16);
  const msg = new Uint8Array(input.length + pad + 16);
  msg.set(input);
  msg.fill(pad, input.length, input.length + pad);
  const n = input.length + pad;
  const C = new Uint8Array(16);
  let L = 0;
  for (let i = 0; i < n / 16; i++) for (let j = 0; j < 16; j++) L = C[j] ^= S[msg[i * 16 + j] ^ L];
  msg.set(C, n);
  const X = new Uint8Array(48);
  for (let i = 0; i < msg.length / 16; i++) {
    for (let j = 0; j < 16; j++) {
      X[16 + j] = msg[i * 16 + j];
      X[32 + j] = X[16 + j] ^ X[j];
    }
    let t = 0;
    for (let j = 0; j < 18; j++) {
      for (let k = 0; k < 48; k++) t = X[k] ^= S[t];
      t = (t + j) & 255;
    }
  }
  return X.slice(0, 16);
}

/** WordPress / phpass "portable" hash ($P$): salted MD5, iterated 2^13 times. */
const ITOA = "./0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
function encode64(input: Uint8Array, count: number) {
  let out = "";
  let i = 0;
  do {
    let value = input[i++];
    out += ITOA[value & 63];
    if (i < count) value |= input[i] << 8;
    out += ITOA[(value >> 6) & 63];
    if (i++ >= count) break;
    if (i < count) value |= input[i] << 16;
    out += ITOA[(value >> 12) & 63];
    if (i++ >= count) break;
    out += ITOA[(value >> 18) & 63];
  } while (i < count);
  return out;
}
export function wordpressHash(password: string, salt?: string): string {
  const s = salt ?? encode64(crypto.getRandomValues(new Uint8Array(6)), 6);
  const countLog2 = 13;
  const pw = enc(password);
  const cat = (a: Uint8Array, b: Uint8Array) => {
    const o = new Uint8Array(a.length + b.length);
    o.set(a);
    o.set(b, a.length);
    return o;
  };
  let h = md5(cat(enc(s), pw));
  for (let i = 0; i < 1 << countLog2; i++) h = md5(cat(h, pw));
  return `$P$${ITOA[countLog2]}${s}${encode64(h, 16)}`;
}
export function wordpressCheck(password: string, hash: string): boolean {
  if (!/^\$P\$.{9}/.test(hash) && !/^\$H\$/.test(hash)) return false;
  const countLog2 = ITOA.indexOf(hash[3]);
  if (countLog2 !== 13) {
    // Other strengths: recompute with the same count.
    const salt = hash.slice(4, 12);
    const pw = enc(password);
    const cat = (a: Uint8Array, b: Uint8Array) => {
      const o = new Uint8Array(a.length + b.length);
      o.set(a);
      o.set(b, a.length);
      return o;
    };
    let h = md5(cat(enc(salt), pw));
    for (let i = 0; i < 1 << countLog2; i++) h = md5(cat(h, pw));
    return hash.slice(0, 12) + encode64(h, 16) === hash;
  }
  return wordpressHash(password, hash.slice(4, 12)) === hash;
}
