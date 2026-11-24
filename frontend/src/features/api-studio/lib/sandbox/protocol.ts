import type { Cookie, LogLevel, TestResult } from "../../types";

/** Messages between the page and the script sandbox worker (plain JSON). */

export type SbKV = { key: string; value: string; disabled?: boolean; type?: string; src?: string };

export type SbRequest = {
  id: string;
  name: string;
  method: string;
  url: string;
  headers: SbKV[];
  body: { mode: string; raw?: string; urlencoded?: SbKV[]; formdata?: SbKV[]; graphql?: { query: string; variables: string }; options?: { raw?: { language: string } } } | null;
  auth: { type: string; params: Record<string, string> } | null;
};

export type SbResponse = {
  code: number;
  status: string;
  headers: SbKV[];
  bodyB64: string;
  responseTime: number;
  responseSize: number;
};

export type SbScopes = { globals: Record<string, string>; collection: Record<string, string>; environment: Record<string, string>; data: Record<string, string>; local: Record<string, string>; vault: Record<string, string> };

export type SbContext = {
  event: "prerequest" | "test";
  info: { eventName: string; iteration: number; iterationCount: number; requestName: string; requestId: string };
  request: SbRequest;
  response?: SbResponse;
  scopes: SbScopes;
  envName: string;
  collectionName: string;
  cookies: Cookie[];
  location: string[];
  vaultEnabled: boolean;
  /** The resolved URL, for pm.cookies and legacy `request.url`. */
  resolvedUrl: string;
};

export type SbLog = { level: LogLevel; text: string };

export type SbResult = {
  tests: TestResult[];
  scopes: SbScopes;
  request: SbRequest;
  /** undefined = not called; null = stop the run; string = name or id of the next request. */
  nextRequest?: string | null;
  skipRequest: boolean;
  visualizer: { template: string; data: unknown; options?: unknown } | null;
  cookies: Cookie[];
  error?: string;
};

export type ToWorker =
  | { type: "run"; runId: string; script: string; ctx: SbContext }
  | { type: "sendResult"; runId: string; reqId: string; error?: string; response?: SbResponse & { url: string } };

export type FromWorker =
  | { type: "ready" }
  | { type: "log"; runId: string; log: SbLog }
  | { type: "sendRequest"; runId: string; reqId: string; request: SbRequest }
  | { type: "done"; runId: string; result: SbResult };
