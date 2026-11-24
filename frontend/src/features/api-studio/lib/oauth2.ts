import type { AppSettings } from "../types";
import { pkceChallenge, randomString } from "./crypto";
import { sendRaw } from "./engine";
import { td, te } from "./util";

/**
 * OAuth 2.0 "Get New Access Token": authorization code (with or without PKCE), implicit, password
 * and client credentials grants, plus refresh. Browser sign-in opens a popup at the provider; the
 * provider redirects to our callback page, which hands the URL back to this tab. Token calls go out
 * through the usual agents, so providers that don't allow CORS still work.
 */

export type OAuthToken = { name: string; access_token: string; token_type?: string; refresh_token?: string; expires_at?: number; scope?: string; id_token?: string; raw: Record<string, unknown>; at: number };

export const callbackUrl = () => (typeof location !== "undefined" ? `${location.origin}/api-client/oauth-callback.html` : "/api-client/oauth-callback.html");

const form = (o: Record<string, string | undefined>) =>
  Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v!)}`)
    .join("&");

async function tokenCall(a: Record<string, string>, fields: Record<string, string | undefined>, settings: AppSettings): Promise<OAuthToken> {
  if (!a.accessTokenUrl) throw new Error("Add the Access Token URL.");
  const headers: [string, string][] = [
    ["Content-Type", "application/x-www-form-urlencoded"],
    ["Accept", "application/json"],
  ];
  const body: Record<string, string | undefined> = { ...fields };
  if ((a.clientAuth ?? "header") === "header" && a.clientId) headers.push(["Authorization", `Basic ${btoa(unescape(encodeURIComponent(`${encodeURIComponent(a.clientId)}:${encodeURIComponent(a.clientSecret ?? "")}`)))}`]);
  else {
    body.client_id = a.clientId;
    body.client_secret = a.clientSecret || undefined;
  }
  if (a.audience) body.audience = a.audience;
  if (a.resource) body.resource = a.resource;
  const res = await sendRaw({ method: "POST", url: a.accessTokenUrl, headers, body: te.encode(form(body)) }, settings);
  const text = td.decode(res.body);
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text);
  } catch {
    data = Object.fromEntries(new URLSearchParams(text));
  }
  if (res.status >= 400 || !data.access_token) {
    const why = [data.error, data.error_description].filter(Boolean).join(": ");
    throw new Error(`The token endpoint answered ${res.status}${why ? ` (${why})` : ""}.${!why && text ? ` ${text.slice(0, 200)}` : ""}`);
  }
  return toToken(a.tokenName || "Token", data);
}

function toToken(name: string, data: Record<string, unknown>): OAuthToken {
  const exp = Number(data.expires_in);
  return {
    name,
    access_token: String(data.access_token),
    token_type: data.token_type ? String(data.token_type) : undefined,
    refresh_token: data.refresh_token ? String(data.refresh_token) : undefined,
    expires_at: exp ? Date.now() + exp * 1000 : undefined,
    scope: data.scope ? String(data.scope) : undefined,
    id_token: data.id_token ? String(data.id_token) : undefined,
    raw: data,
    at: Date.now(),
  };
}

/** Opens the provider's sign-in page and resolves with the URL it redirects back to. */
function browserSignIn(url: string, redirect: string, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const w = window.open(url, "dwyl-oauth", "width=520,height=720");
    if (!w) {
      reject(new Error("The sign-in window was blocked. Allow pop-ups for this site and try again."));
      return;
    }
    const sameOrigin = redirect.startsWith(location.origin);
    const done = (fn: () => void) => {
      clearInterval(poll);
      window.removeEventListener("message", onMsg);
      fn();
    };
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== location.origin || e.data?.type !== "dwyl-oauth-callback") return;
      done(() => resolve(String(e.data.url)));
      try {
        w.close();
      } catch {
        /* already closed */
      }
    };
    window.addEventListener("message", onMsg);
    const poll = setInterval(() => {
      if (signal?.aborted) done(() => reject(new DOMException("cancelled", "AbortError")));
      else if (w.closed) done(() => reject(new Error(sameOrigin ? "The sign-in window was closed before it finished." : "The sign-in window closed. With a custom callback URL, paste the address it redirected to into “Paste redirect URL”.")));
    }, 400);
  });
}

export async function getNewToken(a: Record<string, string>, settings: AppSettings, signal?: AbortSignal, pastedRedirect?: string): Promise<OAuthToken> {
  const grant = a.grantType || "authorization_code";
  const redirect = a.callbackUrl || callbackUrl();
  if (grant === "client_credentials") return tokenCall(a, { grant_type: "client_credentials", scope: a.scope }, settings);
  if (grant === "password_credentials") return tokenCall(a, { grant_type: "password", username: a.username, password: a.password, scope: a.scope }, settings);
  if (!a.authUrl) throw new Error("Add the Auth URL.");
  const state = a.state || randomString(16);
  const pkce = grant === "authorization_code_with_pkce";
  const verifier = a.codeVerifier || randomString(64, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~");
  const auth = new URL(a.authUrl);
  auth.searchParams.set("response_type", grant === "implicit" ? "token" : "code");
  if (a.clientId) auth.searchParams.set("client_id", a.clientId);
  auth.searchParams.set("redirect_uri", redirect);
  if (a.scope) auth.searchParams.set("scope", a.scope);
  auth.searchParams.set("state", state);
  if (a.audience) auth.searchParams.set("audience", a.audience);
  if (pkce) {
    const method = (a.challengeAlgorithm as "S256" | "plain") || "S256";
    auth.searchParams.set("code_challenge", pkceChallenge(verifier, method));
    auth.searchParams.set("code_challenge_method", method);
  }
  const back = new URL(pastedRedirect || (await browserSignIn(auth.toString(), redirect, signal)));
  const params = new URLSearchParams(back.hash.replace(/^#/, ""));
  back.searchParams.forEach((v, k) => params.set(k, v));
  if (params.get("error")) throw new Error(`Sign-in failed: ${params.get("error")}${params.get("error_description") ? `: ${params.get("error_description")}` : ""}`);
  if (params.get("state") && params.get("state") !== state && !pastedRedirect) throw new Error("The state returned doesn't match the one sent, so the answer was rejected.");
  if (grant === "implicit") {
    const token = params.get("access_token");
    if (!token) throw new Error("No access_token came back.");
    return toToken(a.tokenName || "Token", Object.fromEntries(params));
  }
  const code = params.get("code");
  if (!code) throw new Error("No authorization code came back.");
  return tokenCall(a, { grant_type: "authorization_code", code, redirect_uri: redirect, code_verifier: pkce ? verifier : undefined }, settings);
}

export function refreshToken(a: Record<string, string>, refresh: string, settings: AppSettings): Promise<OAuthToken> {
  return tokenCall({ ...a, accessTokenUrl: a.refreshTokenUrl || a.accessTokenUrl }, { grant_type: "refresh_token", refresh_token: refresh, scope: a.scope }, settings);
}
