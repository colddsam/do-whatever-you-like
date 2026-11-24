import { hmac } from "@noble/hashes/hmac.js";
import { md5, sha1 } from "@noble/hashes/legacy.js";
import { sha256, sha384, sha512, sha512_256 } from "@noble/hashes/sha2.js";
import { b64ToBytes, b64url, bytesToB64, te } from "./util";

/** Hashes and signatures for the auth helpers: HMAC/SHA via @noble/hashes, RSA and ECDSA via WebCrypto. */

export type HashName = "md5" | "sha1" | "sha256" | "sha384" | "sha512" | "sha512-256";
const HASHES = { md5, sha1, sha256, sha384, sha512, "sha512-256": sha512_256 } as const;

const bytes = (d: string | Uint8Array) => (typeof d === "string" ? te.encode(d) : d);
export const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

export const hash = (alg: HashName, data: string | Uint8Array) => HASHES[alg](bytes(data));
export const hashHex = (alg: HashName, data: string | Uint8Array) => toHex(hash(alg, data));
export const hmacBytes = (alg: HashName, key: string | Uint8Array, data: string | Uint8Array) => hmac(HASHES[alg], bytes(key), bytes(data));
export const hmacHex = (alg: HashName, key: string | Uint8Array, data: string | Uint8Array) => toHex(hmacBytes(alg, key, data));
export const hmacB64 = (alg: HashName, key: string | Uint8Array, data: string | Uint8Array) => bytesToB64(hmacBytes(alg, key, data));

export function randomHex(n: number): string {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return toHex(b);
}

export function randomString(n: number, alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"): string {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => alphabet[x % alphabet.length]).join("");
}

/** PEM (PKCS#8 "PRIVATE KEY") → DER bytes. */
export function pemToDer(pem: string): Uint8Array {
  const body = pem.replace(/-----BEGIN [^-]+-----|-----END [^-]+-----|\s+/g, "");
  if (!body) throw new Error("The private key is empty.");
  if (/BEGIN RSA PRIVATE KEY|BEGIN EC PRIVATE KEY/.test(pem))
    throw new Error("Use a PKCS#8 key (-----BEGIN PRIVATE KEY-----). Convert it with: openssl pkcs8 -topk8 -nocrypt -in key.pem");
  return b64ToBytes(body);
}

type AsymAlg = "RS256" | "RS384" | "RS512" | "PS256" | "PS384" | "PS512" | "ES256" | "ES384" | "ES512";

function asymParams(alg: AsymAlg): { importAlg: RsaHashedImportParams | EcKeyImportParams; signAlg: AlgorithmIdentifier | RsaPssParams | EcdsaParams } {
  const bits = alg.slice(2);
  const hashName = `SHA-${bits}`;
  if (alg.startsWith("RS")) return { importAlg: { name: "RSASSA-PKCS1-v1_5", hash: hashName }, signAlg: { name: "RSASSA-PKCS1-v1_5" } };
  if (alg.startsWith("PS")) return { importAlg: { name: "RSA-PSS", hash: hashName }, signAlg: { name: "RSA-PSS", saltLength: Number(bits) / 8 } as RsaPssParams };
  const curve = { "256": "P-256", "384": "P-384", "512": "P-521" }[bits] as string;
  return { importAlg: { name: "ECDSA", namedCurve: curve }, signAlg: { name: "ECDSA", hash: hashName } as EcdsaParams };
}

/** Signs with a PEM private key; ECDSA signatures come back raw (r‖s), which is what JWS wants. */
export async function signAsym(alg: AsymAlg, pem: string, data: string | Uint8Array): Promise<Uint8Array> {
  const { importAlg, signAlg } = asymParams(alg);
  const der = pemToDer(pem);
  const key = await crypto.subtle.importKey("pkcs8", der as BufferSource, importAlg, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign(signAlg, key, bytes(data) as BufferSource));
}

export type JwtAlg = "HS256" | "HS384" | "HS512" | AsymAlg;

export async function signJwt(alg: JwtAlg, header: Record<string, unknown>, payload: Record<string, unknown>, secretOrKey: string, secretIsBase64 = false): Promise<string> {
  const enc = (o: unknown) => b64url(te.encode(JSON.stringify(o)));
  const input = `${enc({ alg, typ: "JWT", ...header })}.${enc(payload)}`;
  let sig: Uint8Array;
  if (alg.startsWith("HS")) {
    const key = secretIsBase64 ? b64ToBytes(secretOrKey.replace(/-/g, "+").replace(/_/g, "/")) : te.encode(secretOrKey);
    sig = hmacBytes(`sha${alg.slice(2)}` as HashName, key, input);
  } else sig = await signAsym(alg as AsymAlg, secretOrKey, input);
  return `${input}.${b64url(sig)}`;
}

/** RFC 3986 encoding (OAuth 1.0 needs it: encodeURIComponent leaves !'()* alone). */
export const rfc3986 = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export function pkceChallenge(verifier: string, method: "S256" | "plain"): string {
  return method === "plain" ? verifier : b64url(sha256(te.encode(verifier)));
}
