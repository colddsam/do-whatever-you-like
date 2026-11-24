"use client";

import { useState } from "react";
import { KeyRound, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Auth, AuthType, Collection, Folder } from "../types";
import { AUTH_TYPES, effectiveAuth } from "../lib/auth";
import { callbackUrl, getNewToken, refreshToken, type OAuthToken } from "../lib/oauth2";
import { resolve } from "../lib/vars";
import { useApi } from "../store";
import { Btn, Input, Label, Note, Select, Textarea, Toggle } from "./kit";
import { useVarInfo, VarInput } from "./var-input";

type Field = { key: string; label: string; type?: "text" | "password" | "select" | "toggle" | "textarea"; options?: { value: string; label: string }[]; placeholder?: string; hint?: string; when?: (p: Record<string, string>) => boolean; advanced?: boolean };

const ALGS = ["HS256", "HS384", "HS512", "RS256", "RS384", "RS512", "PS256", "PS384", "PS512", "ES256", "ES384", "ES512"].map((v) => ({ value: v, label: v }));

const FIELDS: Partial<Record<AuthType, Field[]>> = {
  apikey: [
    { key: "key", label: "Key", placeholder: "X-API-Key" },
    { key: "value", label: "Value", type: "password", placeholder: "{{apiKey}}" },
    { key: "in", label: "Add to", type: "select", options: [{ value: "header", label: "Header" }, { value: "query", label: "Query Params" }] },
  ],
  bearer: [{ key: "token", label: "Token", type: "password", placeholder: "{{token}}" }],
  basic: [
    { key: "username", label: "Username" },
    { key: "password", label: "Password", type: "password" },
  ],
  digest: [
    { key: "username", label: "Username" },
    { key: "password", label: "Password", type: "password" },
    { key: "disableRetry", label: "Don't answer the challenge automatically", type: "toggle", hint: "By default a 401 Digest challenge is answered once with the computed response." },
    { key: "realm", label: "Realm", placeholder: "From the server's challenge", advanced: true },
    { key: "nonce", label: "Nonce", placeholder: "From the server's challenge", advanced: true },
    { key: "algorithm", label: "Algorithm", type: "select", options: ["MD5", "MD5-sess", "SHA-256", "SHA-256-sess", "SHA-512-256", "SHA-512-256-sess"].map((v) => ({ value: v, label: v })), advanced: true },
    { key: "qop", label: "qop", placeholder: "auth", advanced: true },
    { key: "nonceCount", label: "Nonce count", placeholder: "00000001", advanced: true },
    { key: "clientNonce", label: "Client nonce", placeholder: "Random", advanced: true },
    { key: "opaque", label: "Opaque", advanced: true },
  ],
  oauth1: [
    { key: "signatureMethod", label: "Signature method", type: "select", options: ["HMAC-SHA1", "HMAC-SHA256", "HMAC-SHA512", "RSA-SHA1", "RSA-SHA256", "RSA-SHA512", "PLAINTEXT"].map((v) => ({ value: v, label: v })) },
    { key: "consumerKey", label: "Consumer key" },
    { key: "consumerSecret", label: "Consumer secret", type: "password", when: (p) => !(p.signatureMethod ?? "").startsWith("RSA") },
    { key: "privateKey", label: "Private key (PKCS#8 PEM)", type: "textarea", when: (p) => (p.signatureMethod ?? "").startsWith("RSA") },
    { key: "token", label: "Access token" },
    { key: "tokenSecret", label: "Token secret", type: "password" },
    { key: "addParamsTo", label: "Add authorization data to", type: "select", options: [{ value: "header", label: "Request headers" }, { value: "query", label: "Request URL" }, { value: "body", label: "Request body (urlencoded)" }] },
    { key: "callback", label: "Callback URL", advanced: true },
    { key: "verifier", label: "Verifier", advanced: true },
    { key: "timestamp", label: "Timestamp", placeholder: "Now", advanced: true },
    { key: "nonce", label: "Nonce", placeholder: "Random", advanced: true },
    { key: "version", label: "Version", placeholder: "1.0", advanced: true },
    { key: "realm", label: "Realm", advanced: true },
    { key: "includeBodyHash", label: "Include body hash", type: "toggle", advanced: true },
    { key: "addEmptyParamsToSign", label: "Add empty parameters to signature", type: "toggle", advanced: true },
    { key: "encodeSignature", label: "Encode the signature (off = raw)", type: "select", options: [{ value: "true", label: "Encode" }, { value: "false", label: "Don't encode" }], advanced: true },
  ],
  hawk: [
    { key: "authId", label: "Hawk Auth ID" },
    { key: "authKey", label: "Hawk Auth Key", type: "password" },
    { key: "algorithm", label: "Algorithm", type: "select", options: [{ value: "sha256", label: "SHA256" }, { value: "sha1", label: "SHA1" }] },
    { key: "user", label: "User", advanced: true },
    { key: "nonce", label: "Nonce", placeholder: "Random", advanced: true },
    { key: "ext", label: "ext", advanced: true },
    { key: "app", label: "app", advanced: true },
    { key: "dlg", label: "dlg", advanced: true },
    { key: "timestamp", label: "Timestamp", placeholder: "Now", advanced: true },
    { key: "includePayloadHash", label: "Include payload hash", type: "toggle", advanced: true },
  ],
  awsv4: [
    { key: "accessKey", label: "Access key" },
    { key: "secretKey", label: "Secret key", type: "password" },
    { key: "region", label: "AWS Region", placeholder: "us-east-1" },
    { key: "service", label: "Service name", placeholder: "execute-api, s3, lambda…" },
    { key: "sessionToken", label: "Session token", type: "password", advanced: true },
    { key: "addAuthDataTo", label: "Add authorization data to", type: "select", options: [{ value: "header", label: "Request headers" }, { value: "query", label: "Request URL (presigned)" }] },
  ],
  ntlm: [
    { key: "username", label: "Username" },
    { key: "password", label: "Password", type: "password" },
    { key: "domain", label: "Domain", advanced: true },
    { key: "workstation", label: "Workstation", advanced: true },
  ],
  edgegrid: [
    { key: "accessToken", label: "Access token", type: "password" },
    { key: "clientToken", label: "Client token", type: "password" },
    { key: "clientSecret", label: "Client secret", type: "password" },
    { key: "baseURL", label: "Base URL", placeholder: "https://akab-xxx.luna.akamaiapis.net", advanced: true },
    { key: "headersToSign", label: "Headers to sign", placeholder: "x-a, x-b", advanced: true },
    { key: "nonce", label: "Nonce", placeholder: "Random", advanced: true },
    { key: "timestamp", label: "Timestamp", placeholder: "Now", advanced: true },
  ],
  jwt: [
    { key: "algorithm", label: "Algorithm", type: "select", options: ALGS },
    { key: "secret", label: "Secret", type: "password", when: (p) => (p.algorithm ?? "HS256").startsWith("HS") },
    { key: "isSecretBase64Encoded", label: "Secret is base64 encoded", type: "toggle", when: (p) => (p.algorithm ?? "HS256").startsWith("HS") },
    { key: "privateKey", label: "Private key (PKCS#8 PEM)", type: "textarea", when: (p) => !(p.algorithm ?? "HS256").startsWith("HS"), placeholder: "-----BEGIN PRIVATE KEY-----" },
    { key: "payload", label: "Payload (JSON)", type: "textarea", placeholder: '{\n  "sub": "1234567890",\n  "iat": {{$timestamp}}\n}' },
    { key: "addTokenTo", label: "Add JWT token to", type: "select", options: [{ value: "header", label: "Request header" }, { value: "query", label: "Query param" }] },
    { key: "headerPrefix", label: "Header prefix", placeholder: "Bearer", when: (p) => p.addTokenTo !== "query", advanced: true },
    { key: "queryParamKey", label: "Query param name", placeholder: "token", when: (p) => p.addTokenTo === "query", advanced: true },
    { key: "header", label: "JWT headers (JSON)", type: "textarea", placeholder: '{ "kid": "key-1" }', advanced: true },
  ],
  asap: [
    { key: "alg", label: "Algorithm", type: "select", options: ALGS.filter((a) => !a.value.startsWith("HS")) },
    { key: "issuer", label: "Issuer" },
    { key: "audience", label: "Audience" },
    { key: "kid", label: "Key ID" },
    { key: "privateKey", label: "Private key (PKCS#8 PEM)", type: "textarea" },
    { key: "subject", label: "Subject", advanced: true },
    { key: "claims", label: "Additional claims (JSON)", type: "textarea", advanced: true },
    { key: "expiry", label: "Expires in (seconds)", placeholder: "3600", advanced: true },
  ],
};

export function AuthEditor({ auth, onChange, parents, collection, isCollection }: { auth: Auth; onChange: (a: Auth) => void; parents: Folder[]; collection?: Collection | null; isCollection?: boolean }) {
  const [adv, setAdv] = useState(false);
  const types = isCollection ? AUTH_TYPES.filter((t) => t.id !== "inherit") : AUTH_TYPES;
  const inherited = auth.type === "inherit" ? effectiveAuth(auth.type === "inherit" ? { auth } : { auth }, parents, collection) : null;
  const p = auth.params;
  const set = (k: string, v: string) => onChange({ ...auth, params: { ...p, [k]: v } });
  const fields = FIELDS[auth.type] ?? [];

  return (
    <div className="grid gap-5 md:grid-cols-[minmax(0,240px)_minmax(0,1fr)]">
      <div className="space-y-2">
        <Label>Auth type</Label>
        <Select label="Auth type" value={auth.type} onChange={(v) => onChange({ type: v, params: v === auth.type ? auth.params : defaultsFor(v) })} options={types.map((t) => ({ value: t.id, label: t.label }))} className="w-full" />
        <p className="text-[12px] leading-relaxed text-ink-3">{AUTH_TYPES.find((t) => t.id === auth.type)?.hint} The authorization header is generated when you send the request.</p>
        {["bearer", "basic", "apikey", "oauth2", "jwt", "awsv4", "ntlm", "oauth1", "digest", "hawk", "edgegrid", "asap"].includes(auth.type) && (
          <p className="text-[12px] leading-relaxed text-ink-3">Keep secrets in variables (an environment or the vault) rather than typing them here.</p>
        )}
      </div>
      <div className="min-w-0 space-y-3">
        {auth.type === "inherit" && inherited && (
          <Note>
            This request uses <b>{AUTH_TYPES.find((t) => t.id === inherited.auth.type)?.label}</b> from <b>{inherited.from || "its parent"}</b>. Change it on the folder or collection, or pick a type here to override it.
          </Note>
        )}
        {auth.type === "noauth" && <Note>No authorization is sent with this {isCollection ? "collection's requests (unless they set their own)" : "request"}.</Note>}
        {auth.type === "ntlm" && <Note tone="warning">NTLM is sent by the Cloud agent (our server does the three-step handshake). A browser page can&apos;t, so the Browser agent will refuse it.</Note>}
        {auth.type === "oauth2" ? (
          <OAuth2Editor auth={auth} onChange={onChange} collectionId={collection?.id} />
        ) : (
          <>
            {fields.filter((f) => !f.advanced && (!f.when || f.when(p))).map((f) => <FieldRow key={f.key} f={f} value={p[f.key] ?? ""} onChange={(v) => set(f.key, v)} />)}
            {fields.some((f) => f.advanced) && (
              <div className="border-t border-line pt-3">
                <button type="button" onClick={() => setAdv((a) => !a)} className="text-[13px] font-medium text-ink-2 hover:text-ink">
                  {adv ? "Hide" : "Show"} advanced configuration
                </button>
                {adv && <div className="mt-3 space-y-3">{fields.filter((f) => f.advanced && (!f.when || f.when(p))).map((f) => <FieldRow key={f.key} f={f} value={p[f.key] ?? ""} onChange={(v) => set(f.key, v)} />)}</div>}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function defaultsFor(t: AuthType): Record<string, string> {
  switch (t) {
    case "apikey":
      return { in: "header" };
    case "oauth1":
      return { signatureMethod: "HMAC-SHA1", addParamsTo: "header", version: "1.0" };
    case "hawk":
      return { algorithm: "sha256" };
    case "awsv4":
      return { region: "us-east-1", service: "execute-api", addAuthDataTo: "header" };
    case "jwt":
      return { algorithm: "HS256", addTokenTo: "header", headerPrefix: "Bearer", payload: "{\n  \n}" };
    case "asap":
      return { alg: "RS256", expiry: "3600" };
    case "oauth2":
      return { grantType: "authorization_code", headerPrefix: "Bearer", addTokenTo: "header", clientAuth: "header", challengeAlgorithm: "S256", tokenName: "Token" };
    case "digest":
      return { algorithm: "MD5" };
    default:
      return {};
  }
}

function FieldRow({ f, value, onChange }: { f: Field; value: string; onChange: (v: string) => void }) {
  if (f.type === "toggle") return <Toggle checked={value === "true"} onChange={(v) => onChange(String(v))} label={f.label} description={f.hint} />;
  return (
    <label className="grid items-start gap-1.5 sm:grid-cols-[150px_minmax(0,1fr)] sm:gap-3">
      <span className="pt-1.5 text-[13px] text-ink-2">{f.label}</span>
      <span className="min-w-0">
        {f.type === "select" ? (
          <Select label={f.label} value={value || f.options![0].value} onChange={onChange} options={f.options!} className="w-full" />
        ) : f.type === "textarea" ? (
          <Textarea mono rows={f.key === "privateKey" ? 6 : 5} value={value} onChange={(e) => onChange(e.target.value)} placeholder={f.placeholder} aria-label={f.label} />
        ) : (
          <VarInput ariaLabel={f.label} value={value} onChange={onChange} placeholder={f.placeholder} type={f.type === "password" && !value.includes("{{") ? "password" : undefined} />
        )}
        {f.hint && <span className="mt-1 block text-[12px] text-ink-3">{f.hint}</span>}
      </span>
    </label>
  );
}

const GRANTS = [
  { value: "authorization_code", label: "Authorization Code" },
  { value: "authorization_code_with_pkce", label: "Authorization Code (With PKCE)" },
  { value: "implicit", label: "Implicit" },
  { value: "password_credentials", label: "Password Credentials" },
  { value: "client_credentials", label: "Client Credentials" },
];

function OAuth2Editor({ auth, onChange, collectionId }: { auth: Auth; onChange: (a: Auth) => void; collectionId?: string }) {
  const p = auth.params;
  const settings = useApi((s) => s.settings);
  const notify = useApi((s) => s.notify);
  const vars = useVarInfo(collectionId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paste, setPaste] = useState("");
  // When the editor opened: enough to label tokens as expired without reading the clock on every render.
  const [now] = useState(() => Date.now());
  const set = (patch: Record<string, string>) => onChange({ ...auth, params: { ...p, ...patch } });
  const tokens: OAuthToken[] = (() => {
    try {
      return p.tokens ? JSON.parse(p.tokens) : [];
    } catch {
      return [];
    }
  })();
  const grant = p.grantType || "authorization_code";
  const browser = grant.startsWith("authorization_code") || grant === "implicit";
  const resolved = () => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, resolve(v, vars.scopes)]));
  const applyToken = (t: OAuthToken, list = tokens) => set({ accessToken: t.access_token, tokens: JSON.stringify(list), activeToken: t.at.toString() });

  const get = async (pasted?: string) => {
    setBusy(true);
    setError(null);
    try {
      const t = await getNewToken(resolved(), settings, undefined, pasted);
      const list = [t, ...tokens].slice(0, 20);
      applyToken(t, list);
      notify(`Got a new token: ${t.name}`, "success");
      setPaste("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const refresh = async (t: OAuthToken) => {
    if (!t.refresh_token) return;
    setBusy(true);
    setError(null);
    try {
      const nt = await refreshToken(resolved(), t.refresh_token, settings);
      nt.refresh_token ??= t.refresh_token;
      const list = [nt, ...tokens.filter((x) => x !== t)];
      applyToken(nt, list);
      notify("Token refreshed", "success");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const row = (label: string, key: string, opts: { password?: boolean; placeholder?: string } = {}) => (
    <label className="grid items-start gap-1.5 sm:grid-cols-[150px_minmax(0,1fr)] sm:gap-3">
      <span className="pt-1.5 text-[13px] text-ink-2">{label}</span>
      <VarInput ariaLabel={label} value={p[key] ?? ""} onChange={(v) => set({ [key]: v })} placeholder={opts.placeholder} type={opts.password && !(p[key] ?? "").includes("{{") ? "password" : undefined} />
    </label>
  );

  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-md border border-line p-3">
        <Label>Current token</Label>
        {tokens.length > 0 && (
          <Select
            label="Saved tokens"
            value={p.activeToken ?? ""}
            onChange={(v) => {
              const t = tokens.find((x) => x.at.toString() === v);
              if (t) applyToken(t);
            }}
            options={[{ value: "", label: "Pick a saved token…" }, ...tokens.map((t) => ({ value: t.at.toString(), label: `${t.name} · ${new Date(t.at).toLocaleString()}${t.expires_at && t.expires_at < now ? " (expired)" : ""}` }))]}
            className="w-full"
          />
        )}
        {row("Access token", "accessToken", { password: true, placeholder: "Get one below, or paste it" })}
        <label className="grid items-start gap-1.5 sm:grid-cols-[150px_minmax(0,1fr)] sm:gap-3">
          <span className="pt-1.5 text-[13px] text-ink-2">Add token to</span>
          <Select label="Add token to" value={p.addTokenTo || "header"} onChange={(v) => set({ addTokenTo: v })} options={[{ value: "header", label: "Request Headers" }, { value: "query", label: "Request URL" }]} className="w-full" />
        </label>
        {(p.addTokenTo ?? "header") === "header" && row("Header prefix", "headerPrefix", { placeholder: "Bearer" })}
        {tokens.length > 0 && (
          <ul className="divide-y divide-line rounded-md border border-line">
            {tokens.map((t) => (
              <li key={t.at} className={cn("flex items-center gap-2 px-2.5 py-1.5 text-[12px]", p.accessToken === t.access_token && "bg-paper")}>
                <KeyRound aria-hidden className="size-3.5 shrink-0 text-ink-3" />
                <span className="min-w-0 flex-1 truncate">
                  {t.name} · <span className="font-mono">{t.access_token.slice(0, 18)}…</span>
                  {t.expires_at && <span className={cn("ml-1", t.expires_at < now ? "text-danger" : "text-ink-3")}>{t.expires_at < now ? "expired" : `expires ${new Date(t.expires_at).toLocaleTimeString()}`}</span>}
                </span>
                <button type="button" onClick={() => applyToken(t)} className="text-ink-2 hover:text-ink">
                  Use
                </button>
                {t.refresh_token && (
                  <button type="button" aria-label="Refresh token" onClick={() => refresh(t)} className="text-ink-3 hover:text-ink">
                    <RefreshCw aria-hidden className="size-3.5" />
                  </button>
                )}
                <button type="button" aria-label="Delete token" onClick={() => set({ tokens: JSON.stringify(tokens.filter((x) => x !== t)) })} className="text-ink-3 hover:text-danger">
                  <Trash2 aria-hidden className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3 rounded-md border border-line p-3">
        <Label>Configure new token</Label>
        {row("Token name", "tokenName", { placeholder: "Token" })}
        <label className="grid items-start gap-1.5 sm:grid-cols-[150px_minmax(0,1fr)] sm:gap-3">
          <span className="pt-1.5 text-[13px] text-ink-2">Grant type</span>
          <Select label="Grant type" value={grant} onChange={(v) => set({ grantType: v })} options={GRANTS} className="w-full" />
        </label>
        {browser && (
          <label className="grid items-start gap-1.5 sm:grid-cols-[150px_minmax(0,1fr)] sm:gap-3">
            <span className="pt-1.5 text-[13px] text-ink-2">Callback URL</span>
            <span className="min-w-0">
              <Input mono value={p.callbackUrl ?? ""} onChange={(e) => set({ callbackUrl: e.target.value })} placeholder={callbackUrl()} aria-label="Callback URL" />
              <span className="mt-1 block text-[12px] text-ink-3">Register {callbackUrl()} with your provider, or use your own and paste the redirect below.</span>
            </span>
          </label>
        )}
        {browser && row("Auth URL", "authUrl", { placeholder: "https://provider.com/oauth/authorize" })}
        {grant !== "implicit" && row("Access Token URL", "accessTokenUrl", { placeholder: "https://provider.com/oauth/token" })}
        {row("Client ID", "clientId")}
        {grant !== "implicit" && row("Client Secret", "clientSecret", { password: true })}
        {grant === "password_credentials" && row("Username", "username")}
        {grant === "password_credentials" && row("Password", "password", { password: true })}
        {grant === "authorization_code_with_pkce" && (
          <>
            <label className="grid items-start gap-1.5 sm:grid-cols-[150px_minmax(0,1fr)] sm:gap-3">
              <span className="pt-1.5 text-[13px] text-ink-2">Code challenge method</span>
              <Select label="Code challenge method" value={p.challengeAlgorithm || "S256"} onChange={(v) => set({ challengeAlgorithm: v })} options={[{ value: "S256", label: "SHA-256" }, { value: "plain", label: "Plain" }]} className="w-full" />
            </label>
            {row("Code verifier", "codeVerifier", { placeholder: "Generated for you" })}
          </>
        )}
        {row("Scope", "scope", { placeholder: "read write" })}
        {browser && row("State", "state", { placeholder: "Random" })}
        <label className="grid items-start gap-1.5 sm:grid-cols-[150px_minmax(0,1fr)] sm:gap-3">
          <span className="pt-1.5 text-[13px] text-ink-2">Client authentication</span>
          <Select label="Client authentication" value={p.clientAuth || "header"} onChange={(v) => set({ clientAuth: v })} options={[{ value: "header", label: "Send as Basic Auth header" }, { value: "body", label: "Send client credentials in body" }]} className="w-full" />
        </label>
        {row("Audience", "audience")}
        {row("Resource", "resource")}
        {row("Refresh Token URL", "refreshTokenUrl", { placeholder: "Same as the Access Token URL" })}
        {error && <Note tone="danger">{error}</Note>}
        <div className="flex flex-wrap items-center gap-2">
          <Btn variant="primary" icon={busy ? Loader2 : KeyRound} onClick={() => get()} disabled={busy} className={busy ? "[&_svg]:animate-spin" : ""}>
            Get New Access Token
          </Btn>
          {browser && <span className="text-[12px] text-ink-3">A sign-in window opens at your provider.</span>}
        </div>
        {browser && (
          <div className="flex flex-wrap items-center gap-2">
            <Input mono value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="Paste redirect URL (when using your own callback)" aria-label="Paste redirect URL" className="min-w-[200px] flex-1" />
            <Btn onClick={() => get(paste)} disabled={!paste.trim() || busy}>
              Finish
            </Btn>
          </div>
        )}
      </section>
    </div>
  );
}
