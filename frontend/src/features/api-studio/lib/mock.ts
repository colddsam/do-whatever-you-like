import type { Collection, Example, Mock } from "../types";
import type { Prepared } from "./auth";
import { requestsIn, te } from "./util";
import { resolve, emptyScopes } from "./vars";
import { splitUrl, withScheme } from "./url";

/**
 * Mock servers, run inside the tool: a mock gets an address (https://<id>.mock.local), and requests
 * to it are answered from the collection's saved examples, matched the way Postman matches them.
 * They answer requests sent from this tool (requests, runner, monitors, scripts); they aren't on the
 * public internet.
 */

export const MOCK_SUFFIX = ".mock.local";
export const mockUrl = (m: Mock) => `https://${m.id}${MOCK_SUFFIX}`;

export function mockFor(url: string, mocks: Mock[]): Mock | undefined {
  try {
    const host = new URL(withScheme(url)).hostname;
    if (!host.endsWith(MOCK_SUFFIX)) return undefined;
    return mocks.find((m) => `${m.id}${MOCK_SUFFIX}` === host);
  } catch {
    return undefined;
  }
}

/** Path segments with the scheme and host (or a leading {{baseUrl}}) removed. */
const pathOf = (url: string) => {
  let s = splitUrl(url).base.trim();
  s = s.replace(/^[a-z][\w+.-]*:\/\/[^/]*/i, "").replace(/^\{\{[^}]+\}\}/, "");
  if (!s.startsWith("/")) s = s.includes("/") ? s.slice(s.indexOf("/")) : "";
  return s.split("/").filter(Boolean);
};

const queryOf = (url: string) =>
  new Map(
    (splitUrl(url).query ?? "")
      .split("&")
      .filter(Boolean)
      .map((p) => [p.split("=")[0], p.split("=").slice(1).join("=")] as [string, string]),
  );

export type MockAnswer = { status: number; statusText: string; headers: [string, string][]; body: Uint8Array; example?: string };

export function answerMock(mock: Mock, collection: Collection | undefined, p: Prepared, envVars?: Record<string, string>): MockAnswer {
  const examples: { ex: Example; reqName: string }[] = [];
  for (const { req } of requestsIn(collection?.items ?? [])) for (const ex of req.examples) examples.push({ ex, reqName: req.name });
  const hdr = (k: string) => p.headers.find(([h]) => h.toLowerCase() === k)?.[1];
  const wantId = hdr("x-mock-response-id");
  const wantName = hdr("x-mock-response-name");
  const wantCode = hdr("x-mock-response-code");
  const reqPath = pathOf(p.url);
  const reqQuery = queryOf(p.url);
  let best: { ex: Example; score: number } | undefined;
  for (const { ex } of examples) {
    if (wantId && ex.id !== wantId) continue;
    if (wantName && ex.name !== wantName) continue;
    if (wantCode && String(ex.status) !== wantCode) continue;
    if ((ex.request.method || "GET").toUpperCase() !== p.method.toUpperCase()) continue;
    const exPath = pathOf(ex.request.url);
    if (exPath.length !== reqPath.length) continue;
    let score = 100;
    let ok = true;
    for (let i = 0; i < exPath.length; i++) {
      const a = exPath[i];
      const b = reqPath[i];
      if (a === b) score += 10;
      else if (/^:|^\{\{.*\}\}$/.test(a)) score += 3;
      else {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    const exQuery = queryOf(ex.request.url);
    for (const [k, v] of exQuery) {
      if (reqQuery.get(k) === v) score += 5;
      else if (reqQuery.has(k)) score += 2;
      else score -= 1;
    }
    if (!wantCode && ex.status >= 200 && ex.status < 300) score += 1;
    if (!best || score > best.score) best = { ex, score };
  }
  if (!best) {
    const body = JSON.stringify(
      { error: { name: "mockRequestNotFoundError", message: `No saved example matches ${p.method} /${reqPath.join("/")}. Save a response as an example on a request in "${collection?.name ?? "this collection"}" to mock it.` } },
      null,
      2,
    );
    return { status: 404, statusText: "Not Found", headers: [["Content-Type", "application/json"], ["X-Mock-Server", mock.name]], body: te.encode(body) };
  }
  const scopes = emptyScopes();
  scopes.environment = envVars ?? {};
  const text = resolve(best.ex.body, scopes);
  const headers: [string, string][] = best.ex.headers.filter((h) => h.enabled && h.key && !/^content-length$/i.test(h.key)).map((h) => [h.key, resolve(h.value, scopes)]);
  if (!headers.some(([k]) => k.toLowerCase() === "content-type"))
    headers.push(["Content-Type", { json: "application/json", xml: "application/xml", html: "text/html", javascript: "application/javascript", text: "text/plain" }[best.ex.lang] ?? "text/plain"]);
  headers.push(["X-Mock-Server", mock.name], ["X-Mock-Example", best.ex.name]);
  return { status: best.ex.status, statusText: best.ex.statusText, headers, body: te.encode(text), example: best.ex.name };
}
