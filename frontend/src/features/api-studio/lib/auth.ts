import type { Auth, AuthType, Collection, Folder } from "../types";
import { hash, hashHex, type HashName, hmacB64, hmacBytes, hmacHex, randomHex, randomString, rfc3986, signAsym, signJwt, type JwtAlg, toHex } from "./crypto";
import { bytesToB64, te, uid } from "./util";
import { withScheme } from "./url";

/** A request with everything resolved, ready for auth to sign and an agent to send. */
export type Prepared = {
  method: string;
  url: string;
  headers: [string, string][];
  body: Uint8Array | null;
  /** urlencoded fields, which OAuth 1.0 must sign. */
  form?: [string, string][];
  /** Headers the tool added on its own (no-cache, request id): the browser agent leaves them out, since they would
   *  trigger a CORS preflight the API may refuse, and the browser already bypasses its cache. */
  auto?: string[];
  ntlm?: { username: string; password: string; domain: string; workstation: string };
};

export const AUTH_TYPES: { id: AuthType; label: string; hint: string }[] = [
  { id: "inherit", label: "Inherit auth from parent", hint: "Uses the folder's or collection's auth." },
  { id: "noauth", label: "No Auth", hint: "Sends no authorization." },
  { id: "apikey", label: "API Key", hint: "A key/value pair in a header or the query." },
  { id: "bearer", label: "Bearer Token", hint: "Authorization: Bearer <token>." },
  { id: "jwt", label: "JWT Bearer", hint: "Signs a JWT (HS/RS/PS/ES) and sends it." },
  { id: "basic", label: "Basic Auth", hint: "Username and password, base64-encoded." },
  { id: "digest", label: "Digest Auth", hint: "Challenge–response with MD5 or SHA-256." },
  { id: "oauth1", label: "OAuth 1.0", hint: "Signs every request (HMAC, RSA or plain text)." },
  { id: "oauth2", label: "OAuth 2.0", hint: "Gets and refreshes access tokens for you." },
  { id: "hawk", label: "Hawk Authentication", hint: "Hawk MAC signatures." },
  { id: "awsv4", label: "AWS Signature", hint: "AWS Signature Version 4." },
  { id: "ntlm", label: "NTLM Authentication", hint: "Windows NTLMv2 (sent by our server)." },
  { id: "edgegrid", label: "Akamai EdgeGrid", hint: "EG1-HMAC-SHA256 signatures." },
  { id: "asap", label: "ASAP (Atlassian)", hint: "Service-to-service JWT." },
];

/** Where a request's auth really comes from: itself, the nearest folder, or the collection. */
export function effectiveAuth(req: { auth: Auth }, parents: Folder[], collection?: Collection | null): { auth: Auth; from: string } {
  if (req.auth.type !== "inherit") return { auth: req.auth, from: "request" };
  for (let i = parents.length - 1; i >= 0; i--) if (parents[i].auth.type !== "inherit") return { auth: parents[i].auth, from: parents[i].name };
  if (collection && collection.auth.type !== "inherit") return { auth: collection.auth, from: collection.name };
  return { auth: { type: "noauth", params: {} }, from: collection?.name ?? "" };
}

const setHeader = (p: Prepared, k: string, v: string) => {
  p.headers = p.headers.filter(([h]) => h.toLowerCase() !== k.toLowerCase());
  p.headers.push([k, v]);
};
const hasHeader = (p: Prepared, k: string) => p.headers.some(([h]) => h.toLowerCase() === k.toLowerCase());
const getHeader = (p: Prepared, k: string) => p.headers.find(([h]) => h.toLowerCase() === k.toLowerCase())?.[1];
const addQuery = (url: string, k: string, v: string) => {
  const h = url.indexOf("#");
  const base = h < 0 ? url : url.slice(0, h);
  return `${base}${base.includes("?") ? "&" : "?"}${encodeURIComponent(k)}=${encodeURIComponent(v)}${h < 0 ? "" : url.slice(h)}`;
};
const utf8b64 = (s: string) => bytesToB64(te.encode(s));

/** Signs or decorates a prepared request in place. Digest needs the server's challenge first (see `digestHeader`). */
export async function applyAuth(p: Prepared, auth: Auth): Promise<void> {
  const a = auth.params;
  switch (auth.type) {
    case "inherit":
    case "noauth":
      return;
    case "apikey": {
      if (!a.key) return;
      if (a.in === "query") p.url = addQuery(p.url, a.key, a.value ?? "");
      else setHeader(p, a.key, a.value ?? "");
      return;
    }
    case "bearer":
      if (a.token) setHeader(p, "Authorization", `Bearer ${a.token}`);
      return;
    case "basic":
      setHeader(p, "Authorization", `Basic ${utf8b64(`${a.username ?? ""}:${a.password ?? ""}`)}`);
      return;
    case "digest":
      // Without a known nonce, the first request goes out bare and the 401 brings the challenge.
      if (a.nonce && a.realm) setHeader(p, "Authorization", digestHeader(p, a, { realm: a.realm, nonce: a.nonce, qop: a.qop, opaque: a.opaque, algorithm: a.algorithm }));
      return;
    case "oauth1":
      await oauth1(p, a);
      return;
    case "oauth2": {
      const token = a.accessToken;
      if (!token) return;
      if (a.addTokenTo === "query") p.url = addQuery(p.url, "access_token", token);
      else setHeader(p, "Authorization", `${a.headerPrefix ?? "Bearer"} ${token}`.trim());
      return;
    }
    case "hawk":
      hawk(p, a);
      return;
    case "awsv4":
      awsV4(p, a);
      return;
    case "ntlm":
      p.ntlm = { username: a.username ?? "", password: a.password ?? "", domain: a.domain ?? "", workstation: a.workstation ?? "" };
      return;
    case "edgegrid":
      edgegrid(p, a);
      return;
    case "jwt": {
      const token = await jwtToken(a);
      if (a.addTokenTo === "query") p.url = addQuery(p.url, a.queryParamKey || "token", token);
      else setHeader(p, "Authorization", `${a.headerPrefix ?? "Bearer"} ${token}`.trim());
      return;
    }
    case "asap": {
      const now = Math.floor(Date.now() / 1000);
      let extra: Record<string, unknown> = {};
      if (a.claims?.trim()) {
        try {
          extra = JSON.parse(a.claims);
        } catch {
          throw new Error("ASAP: Additional claims must be valid JSON.");
        }
      }
      const payload = { iss: a.issuer, ...(a.subject ? { sub: a.subject } : {}), aud: a.audience, jti: uid() + uid(), iat: now, exp: now + (Number(a.expiry) || 3600), ...extra };
      if (!a.privateKey) throw new Error("ASAP: add the private key.");
      const token = await signJwt((a.alg as JwtAlg) || "RS256", { kid: a.kid }, payload, a.privateKey);
      setHeader(p, "Authorization", `Bearer ${token}`);
      return;
    }
  }
}

export async function jwtToken(a: Record<string, string>): Promise<string> {
  const alg = (a.algorithm as JwtAlg) || "HS256";
  let payload: Record<string, unknown> = {};
  let header: Record<string, unknown> = {};
  try {
    payload = a.payload?.trim() ? JSON.parse(a.payload) : {};
  } catch {
    throw new Error("JWT: the payload must be valid JSON.");
  }
  try {
    header = a.header?.trim() ? JSON.parse(a.header) : {};
  } catch {
    throw new Error("JWT: the extra header must be valid JSON.");
  }
  const secret = alg.startsWith("HS") ? (a.secret ?? "") : (a.privateKey ?? "");
  if (!secret) throw new Error(alg.startsWith("HS") ? "JWT: add the secret." : "JWT: add the private key (PKCS#8 PEM).");
  return signJwt(alg, header, payload, secret, a.isSecretBase64Encoded === "true");
}

/* ------------------------------------------------------------------ Digest */

export type DigestChallenge = { realm: string; nonce: string; qop?: string; opaque?: string; algorithm?: string };

export function parseDigestChallenge(header: string): DigestChallenge | null {
  const m = /Digest\s+(.*)$/i.exec(header);
  if (!m) return null;
  const out: Record<string, string> = {};
  for (const part of m[1].matchAll(/(\w+)=("([^"]*)"|[^,\s]*)/g)) out[part[1].toLowerCase()] = part[3] ?? part[2];
  if (!out.nonce) return null;
  return { realm: out.realm ?? "", nonce: out.nonce, qop: out.qop, opaque: out.opaque, algorithm: out.algorithm };
}

export function digestHeader(p: Prepared, a: Record<string, string>, ch: DigestChallenge): string {
  const algorithm = (a.algorithm || ch.algorithm || "MD5").toUpperCase();
  const H: HashName = algorithm.startsWith("SHA-512-256") ? "sha512-256" : algorithm.startsWith("SHA-256") ? "sha256" : "md5";
  const u = new URL(withScheme(p.url));
  const uri = u.pathname + u.search;
  const qopOffered = (a.qop || ch.qop || "").split(",").map((s) => s.trim()).filter(Boolean);
  const qop = qopOffered.includes("auth") ? "auth" : qopOffered.includes("auth-int") ? "auth-int" : "";
  const nc = a.nonceCount || "00000001";
  const cnonce = a.clientNonce || randomHex(8);
  let ha1 = hashHex(H, `${a.username ?? ""}:${ch.realm}:${a.password ?? ""}`);
  if (algorithm.endsWith("-SESS")) ha1 = hashHex(H, `${ha1}:${ch.nonce}:${cnonce}`);
  const ha2 = qop === "auth-int" ? hashHex(H, `${p.method}:${uri}:${hashHex(H, p.body ?? new Uint8Array())}`) : hashHex(H, `${p.method}:${uri}`);
  const response = qop ? hashHex(H, `${ha1}:${ch.nonce}:${nc}:${cnonce}:${qop}:${ha2}`) : hashHex(H, `${ha1}:${ch.nonce}:${ha2}`);
  const parts = [`username="${a.username ?? ""}"`, `realm="${ch.realm}"`, `nonce="${ch.nonce}"`, `uri="${uri}"`, `algorithm=${algorithm}`];
  if (qop) parts.push(`qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`);
  parts.push(`response="${response}"`);
  if (ch.opaque || a.opaque) parts.push(`opaque="${ch.opaque || a.opaque}"`);
  return `Digest ${parts.join(", ")}`;
}

/* ------------------------------------------------------------------ OAuth 1.0 */

async function oauth1(p: Prepared, a: Record<string, string>) {
  const method = (a.signatureMethod || "HMAC-SHA1").toUpperCase();
  const u = new URL(withScheme(p.url));
  const oauth: [string, string][] = [
    ["oauth_consumer_key", a.consumerKey ?? ""],
    ["oauth_signature_method", method],
    ["oauth_timestamp", a.timestamp || String(Math.floor(Date.now() / 1000))],
    ["oauth_nonce", a.nonce || randomString(11)],
    ["oauth_version", a.version || "1.0"],
  ];
  if (a.token) oauth.push(["oauth_token", a.token]);
  if (a.callback) oauth.push(["oauth_callback", a.callback]);
  if (a.verifier) oauth.push(["oauth_verifier", a.verifier]);
  if (a.includeBodyHash === "true" && !p.form) {
    const hn: HashName = method.endsWith("SHA256") ? "sha256" : method.endsWith("SHA512") ? "sha512" : "sha1";
    oauth.push(["oauth_body_hash", bytesToB64(hash(hn, p.body ?? new Uint8Array()))]);
  }
  const keep = (pairs: [string, string][]) => (a.addEmptyParamsToSign === "true" ? pairs : pairs.filter(([, v]) => v !== ""));
  const query: [string, string][] = [...u.searchParams.entries()];
  const all = keep([...oauth, ...query, ...(p.form ?? [])])
    .map(([k, v]) => [rfc3986(k), rfc3986(v)] as [string, string])
    .sort((x, y) => (x[0] === y[0] ? (x[1] < y[1] ? -1 : 1) : x[0] < y[0] ? -1 : 1));
  const port = u.port && !((u.protocol === "http:" && u.port === "80") || (u.protocol === "https:" && u.port === "443")) ? `:${u.port}` : "";
  const baseUrl = `${u.protocol}//${u.hostname.toLowerCase()}${port}${u.pathname}`;
  const base = [p.method.toUpperCase(), rfc3986(baseUrl), rfc3986(all.map(([k, v]) => `${k}=${v}`).join("&"))].join("&");
  const key = `${rfc3986(a.consumerSecret ?? "")}&${rfc3986(a.tokenSecret ?? "")}`;
  let signature: string;
  if (method === "PLAINTEXT") signature = key;
  else if (method.startsWith("RSA-")) {
    if (!a.privateKey) throw new Error("OAuth 1.0: RSA signatures need a private key.");
    signature = bytesToB64(await signAsym(`RS${method.slice(-3)}` as "RS256", a.privateKey, base));
  } else signature = hmacB64(method.endsWith("SHA256") ? "sha256" : method.endsWith("SHA512") ? "sha512" : "sha1", key, base);
  oauth.push(["oauth_signature", signature]);
  const where = a.addParamsTo || "header";
  if (where === "query") {
    for (const [k, v] of keep(oauth)) p.url = addQuery(p.url, k, v);
  } else if (where === "body" && p.form) {
    const extra = keep(oauth).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
    const cur = p.body ? new TextDecoder().decode(p.body) : "";
    p.body = te.encode(cur ? `${cur}&${extra}` : extra);
  } else {
    const parts = keep(oauth).map(([k, v]) => `${k}="${a.encodeSignature === "false" && k === "oauth_signature" ? v : rfc3986(v)}"`);
    if (a.realm) parts.unshift(`realm="${a.realm}"`);
    setHeader(p, "Authorization", `OAuth ${parts.join(",")}`);
  }
}

/* ------------------------------------------------------------------ Hawk */

function hawk(p: Prepared, a: Record<string, string>) {
  const alg: HashName = a.algorithm === "sha1" ? "sha1" : "sha256";
  const u = new URL(withScheme(p.url));
  const ts = a.timestamp || String(Math.floor(Date.now() / 1000));
  const nonce = a.nonce || randomString(6);
  const port = u.port || (u.protocol === "https:" ? "443" : "80");
  let payloadHash = "";
  if (a.includePayloadHash === "true") {
    const ct = (getHeader(p, "Content-Type") ?? "").split(";")[0].trim().toLowerCase();
    payloadHash = bytesToB64(hash(alg, `hawk.1.payload\n${ct}\n${p.body ? new TextDecoder().decode(p.body) : ""}\n`));
  }
  let norm = `hawk.1.header\n${ts}\n${nonce}\n${p.method.toUpperCase()}\n${u.pathname}${u.search}\n${u.hostname.toLowerCase()}\n${port}\n${payloadHash}\n${a.ext ?? ""}\n`;
  if (a.app) norm += `${a.app}\n${a.dlg ?? ""}\n`;
  const mac = hmacB64(alg, a.authKey ?? "", norm);
  const parts = [`id="${a.authId ?? ""}"`, `ts="${ts}"`, `nonce="${nonce}"`];
  if (payloadHash) parts.push(`hash="${payloadHash}"`);
  if (a.ext) parts.push(`ext="${a.ext}"`);
  parts.push(`mac="${mac}"`);
  if (a.app) parts.push(`app="${a.app}"`);
  if (a.dlg) parts.push(`dlg="${a.dlg}"`);
  setHeader(p, "Authorization", `Hawk ${parts.join(", ")}`);
}

/* ------------------------------------------------------------------ AWS Signature v4 */

const awsEnc = (s: string) => rfc3986(s);

function awsV4(p: Prepared, a: Record<string, string>) {
  const u = new URL(withScheme(p.url));
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = amzDate.slice(0, 8);
  const region = a.region || "us-east-1";
  const service = a.service || "execute-api";
  const scope = `${day}/${region}/${service}/aws4_request`;
  const toQuery = a.addAuthDataTo === "query";
  const payloadHash = toQuery ? "UNSIGNED-PAYLOAD" : hashHex("sha256", p.body ?? new Uint8Array());
  const host = u.host;
  const qp: [string, string][] = [...u.searchParams.entries()];
  if (toQuery) {
    qp.push(["X-Amz-Algorithm", "AWS4-HMAC-SHA256"], ["X-Amz-Credential", `${a.accessKey ?? ""}/${scope}`], ["X-Amz-Date", amzDate], ["X-Amz-Expires", "86400"], ["X-Amz-SignedHeaders", "host"]);
    if (a.sessionToken) qp.push(["X-Amz-Security-Token", a.sessionToken]);
  } else {
    setHeader(p, "X-Amz-Date", amzDate);
    // S3 requires the payload hash as a header; other services take it from the signature alone.
    if (service === "s3" && !hasHeader(p, "X-Amz-Content-Sha256")) setHeader(p, "X-Amz-Content-Sha256", payloadHash);
    if (a.sessionToken) setHeader(p, "X-Amz-Security-Token", a.sessionToken);
  }
  const canonQuery = qp
    .map(([k, v]) => [awsEnc(k), awsEnc(v)])
    .sort((x, y) => (x[0] === y[0] ? (x[1] < y[1] ? -1 : 1) : x[0] < y[0] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const hdrs = new Map<string, string>([["host", host]]);
  if (!toQuery) for (const [k, v] of p.headers) {
    const lk = k.toLowerCase();
    if (lk === "user-agent" || lk === "content-length" || lk === "expect") continue;
    const val = v.trim().replace(/\s+/g, " ");
    hdrs.set(lk, hdrs.has(lk) && lk !== "host" ? `${hdrs.get(lk)},${val}` : val);
  }
  const names = [...hdrs.keys()].sort();
  const signed = names.join(";");
  const canonPath = service === "s3" ? u.pathname || "/" : (u.pathname || "/").split("/").map((s) => awsEnc(decodeURIComponent(s))).join("/");
  const canonical = [p.method.toUpperCase(), canonPath, canonQuery, names.map((n) => `${n}:${hdrs.get(n)}\n`).join(""), signed, payloadHash].join("\n");
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, hashHex("sha256", canonical)].join("\n");
  let k = hmacBytes("sha256", `AWS4${a.secretKey ?? ""}`, day);
  k = hmacBytes("sha256", k, region);
  k = hmacBytes("sha256", k, service);
  k = hmacBytes("sha256", k, "aws4_request");
  const sig = hmacHex("sha256", k, toSign);
  if (toQuery) {
    const base = p.url.split("?")[0];
    p.url = `${base}?${canonQuery}&X-Amz-Signature=${sig}`;
  } else setHeader(p, "Authorization", `AWS4-HMAC-SHA256 Credential=${a.accessKey ?? ""}/${scope}, SignedHeaders=${signed}, Signature=${sig}`);
}

/* ------------------------------------------------------------------ Akamai EdgeGrid */

function edgegrid(p: Prepared, a: Record<string, string>) {
  const target = a.baseURL ? new URL(withScheme(a.baseURL)) : null;
  const u = new URL(withScheme(p.url));
  if (target) {
    u.protocol = target.protocol;
    u.host = target.host;
    p.url = u.toString();
  }
  const d = new Date();
  const ts = a.timestamp || `${d.toISOString().slice(0, 4)}${d.toISOString().slice(5, 7)}${d.toISOString().slice(8, 10)}T${d.toISOString().slice(11, 19)}+0000`;
  const nonce = a.nonce || crypto.randomUUID();
  const authPrefix = `EG1-HMAC-SHA256 client_token=${a.clientToken ?? ""};access_token=${a.accessToken ?? ""};timestamp=${ts};nonce=${nonce};`;
  const wanted = (a.headersToSign ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const canonHeaders = wanted
    .map((n) => [n, getHeader(p, n)] as const)
    .filter(([, v]) => v !== undefined)
    .map(([n, v]) => `${n}:${(v as string).trim().replace(/\s+/g, " ")}`)
    .join("\t");
  const max = Number(a.maxBody) || 131072;
  const contentHash = p.method.toUpperCase() === "POST" && p.body?.length ? bytesToB64(hash("sha256", p.body.subarray(0, max))) : "";
  const data = [p.method.toUpperCase(), u.protocol.replace(":", ""), u.host, u.pathname + u.search, canonHeaders, contentHash, authPrefix].join("\t");
  const signingKey = hmacB64("sha256", a.clientSecret ?? "", ts);
  setHeader(p, "Authorization", `${authPrefix}signature=${hmacB64("sha256", signingKey, data)}`);
}

export { toHex };
