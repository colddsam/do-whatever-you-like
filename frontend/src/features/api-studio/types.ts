/**
 * The API client's data model. It mirrors the Postman Collection v2.1 format closely (so import and
 * export are lossless) with a few additions for the tool itself (ids on every row, saved examples,
 * realtime protocols). Everything here is plain JSON: it's persisted to IndexedDB as-is.
 */

export type Id = string;

/** A key/value row: query params, headers, form fields, path variables. */
export type KV = {
  id: Id;
  key: string;
  value: string;
  description?: string;
  enabled: boolean;
  /** Form-data rows can be files. */
  type?: "text" | "file";
  /** A file picked for a form-data row (the bytes live in IndexedDB under `blob:<id>`). */
  file?: FileRef;
  contentType?: string;
};

export type FileRef = { id: Id; name: string; size: number; type: string };

/** A variable in any scope. `value` is the shared (initial) value, `current` the local one. */
export type Variable = {
  id: Id;
  key: string;
  value: string;
  current?: string;
  type: "default" | "secret";
  enabled: boolean;
  description?: string;
};

export type AuthType =
  | "inherit"
  | "noauth"
  | "apikey"
  | "bearer"
  | "basic"
  | "digest"
  | "oauth1"
  | "oauth2"
  | "hawk"
  | "awsv4"
  | "ntlm"
  | "edgegrid"
  | "jwt"
  | "asap";

export type Auth = { type: AuthType; params: Record<string, string> };

export type BodyMode = "none" | "formdata" | "urlencoded" | "raw" | "binary" | "graphql";
export type RawLang = "text" | "json" | "javascript" | "html" | "xml";

export type Body = {
  mode: BodyMode;
  raw: string;
  rawLang: RawLang;
  formdata: KV[];
  urlencoded: KV[];
  binary?: FileRef;
  graphql: { query: string; variables: string };
};

export type Scripts = { prerequest: string; test: string };

export type RequestSettings = {
  followRedirects: boolean;
  followOriginalMethod: boolean;
  followAuthHeader: boolean;
  maxRedirects: number;
  strictSSL: boolean;
  /** 0 = the workspace default. */
  timeoutMs: number;
  encodeUrl: boolean;
  disableCookies: boolean;
  /** Which network path sends this request: our server, the browser itself, or decided per address. */
  agent: "auto" | "cloud" | "browser";
};

export type Protocol = "http" | "graphql" | "ws" | "socketio" | "mqtt" | "grpc";

/** A saved response ("example"), shown in docs and served by mock servers. */
export type Example = {
  id: Id;
  name: string;
  request: { method: string; url: string; headers: KV[]; body?: string };
  status: number;
  statusText: string;
  headers: KV[];
  body: string;
  lang: RawLang;
};

/** A message kept with a WebSocket / Socket.IO / MQTT request, ready to send again. */
export type SavedMessage = { id: Id; name: string; body: string; format: "text" | "json" | "binary"; event?: string; topic?: string; qos?: 0 | 1 | 2; retain?: boolean };

export type SocketIoConfig = { version: "v4" | "v3" | "v2"; path: string; namespace: string; auth: string; listeners: { id: Id; event: string; enabled: boolean }[]; ack: boolean };
export type MqttConfig = {
  version: "3.1.1" | "5.0";
  clientId: string;
  username: string;
  password: string;
  keepAlive: number;
  clean: boolean;
  subscriptions: { id: Id; topic: string; qos: 0 | 1 | 2; enabled: boolean }[];
  lastWill?: { topic: string; payload: string; qos: 0 | 1 | 2; retain: boolean };
};
export type GrpcConfig = {
  proto: string;
  /** Full method path, /pkg.Service/Method. */
  method: string;
  message: string;
  tls: boolean;
  /** gRPC-Web from the browser instead of HTTP/2 through our server. */
  web: boolean;
  /** Extra messages for client/bidi streaming, sent in order after `message`. */
  stream: string[];
};

export type RequestItem = {
  kind: "request";
  id: Id;
  name: string;
  protocol: Protocol;
  method: string;
  url: string;
  params: KV[];
  pathVars: KV[];
  headers: KV[];
  auth: Auth;
  body: Body;
  scripts: Scripts;
  settings: RequestSettings;
  description: string;
  examples: Example[];
  messages?: SavedMessage[];
  socketio?: SocketIoConfig;
  mqtt?: MqttConfig;
  grpc?: GrpcConfig;
  /** WebSocket sub-protocols (Sec-WebSocket-Protocol). */
  wsProtocols?: string;
};

export type Folder = {
  kind: "folder";
  id: Id;
  name: string;
  description: string;
  auth: Auth;
  scripts: Scripts;
  items: TreeNode[];
};

export type TreeNode = Folder | RequestItem;

export type Collection = {
  id: Id;
  name: string;
  description: string;
  auth: Auth;
  scripts: Scripts;
  variables: Variable[];
  items: TreeNode[];
  createdAt: number;
  updatedAt: number;
};

export type Environment = { id: Id; name: string; values: Variable[] };

/** A cookie in the jar (RFC 6265 subset). */
export type Cookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite?: string;
  hostOnly: boolean;
};

/* ------------------------------------------------------------------ responses */

export type Timings = { dns?: number; tcp?: number; tls?: number; ttfb?: number; download?: number; total: number; prerequest?: number; test?: number };

export type TlsInfo = { protocol?: string; cipher?: string; bits?: number; subject?: string; issuer?: string; not_before?: string; not_after?: string; san?: string[]; verified: boolean };

export type TestResult = { name: string; passed: boolean; skipped?: boolean; error?: string };

export type SseEvent = { id?: string; event: string; data: string; at: number };

export type ResponseData = {
  status: number;
  statusText: string;
  httpVersion: string;
  headers: [string, string][];
  /** Body bytes, base64 (kept as a string so it persists and copies cheaply). */
  bodyB64: string;
  size: { body: number; headers: number; wire?: number };
  truncated: boolean;
  timings: Timings;
  remote?: { ip: string; port: number };
  tls?: TlsInfo | null;
  hops?: { url: string; status: number; reason: string; ms: number }[];
  /** What actually went on the wire (after variables, auth, scripts). */
  sent: SentRequest;
  agent: "cloud" | "browser" | "mock";
  tests: TestResult[];
  visualizer?: { template: string; data: unknown; options?: unknown } | null;
  events?: SseEvent[];
  /** Things worth knowing about this send: unresolved {{variables}}, headers the browser dropped. */
  warnings?: string[];
  streamCut?: boolean;
  at: number;
  /** An error before any response (network, DNS, CORS). */
  error?: string;
};

export type SentRequest = { method: string; url: string; headers: [string, string][]; bodyPreview?: string; bodySize: number };

/* ------------------------------------------------------------------ console, history, runs */

export type LogLevel = "log" | "info" | "warn" | "error" | "debug";

export type ConsoleEntry =
  | { id: Id; at: number; kind: "log"; level: LogLevel; text: string; source?: string }
  | { id: Id; at: number; kind: "net"; method: string; url: string; status?: number; ms?: number; size?: number; error?: string; request: SentRequest; response?: { headers: [string, string][]; body: string; status: number } };

export type HistoryEntry = { id: Id; at: number; request: RequestItem; status?: number; ms?: number; size?: number; error?: string; collectionId?: Id };

export type RunRequestResult = {
  id: Id;
  itemId: Id;
  name: string;
  path: string[];
  method: string;
  url: string;
  status?: number;
  statusText?: string;
  ms?: number;
  size?: number;
  tests: TestResult[];
  error?: string;
  iteration: number;
  responseBody?: string;
  responseHeaders?: [string, string][];
};

export type RunSummary = {
  id: Id;
  collectionId: Id;
  folderId?: Id;
  name: string;
  source: "runner" | "monitor" | "performance" | "flow";
  envName?: string;
  startedAt: number;
  finishedAt?: number;
  iterations: number;
  results: RunRequestResult[];
  stopped?: boolean;
};

/* ------------------------------------------------------------------ mocks, monitors, flows, specs */

export type Mock = { id: Id; name: string; collectionId: Id; envId?: Id; delayMs: number; enabled: boolean; createdAt: number; log: { at: number; method: string; path: string; status: number; example?: string }[] };

export type Monitor = {
  id: Id;
  name: string;
  collectionId: Id;
  folderId?: Id;
  envId?: Id;
  intervalMin: number;
  enabled: boolean;
  notify: boolean;
  createdAt: number;
  lastRunAt?: number;
  runs: { id: Id; at: number; ms: number; passed: number; failed: number; errors: number; requests: number; avgMs: number }[];
};

export type FlowBlockType = "start" | "request" | "evaluate" | "condition" | "delay" | "display" | "setvar" | "template" | "foreach" | "output";

export type FlowBlock = { id: Id; type: FlowBlockType; x: number; y: number; data: Record<string, string> };
export type FlowEdge = { id: Id; from: Id; fromPort: string; to: Id };
export type Flow = { id: Id; name: string; blocks: FlowBlock[]; edges: FlowEdge[]; createdAt: number };

export type Spec = { id: Id; name: string; content: string; format: "yaml" | "json"; updatedAt: number };

/* ------------------------------------------------------------------ settings, workspace, tabs */

export type AppSettings = {
  timeoutMs: number;
  maxResponseMB: number;
  sslVerify: boolean;
  followRedirects: boolean;
  sendNoCache: boolean;
  sendRequestId: boolean;
  trimKeys: boolean;
  defaultAgent: "auto" | "cloud" | "browser";
  browserCredentials: boolean;
  scriptTimeoutMs: number;
  historyLimit: number;
  saveResponses: boolean;
  layout: "split" | "stack" | "auto";
  wrapResponse: boolean;
  vaultInScripts: boolean;
};

export type Workspace = {
  id: Id;
  name: string;
  collections: Collection[];
  environments: Environment[];
  globals: Variable[];
  vault: Variable[];
  activeEnvId: Id | null;
  history: HistoryEntry[];
  cookies: Cookie[];
  mocks: Mock[];
  monitors: Monitor[];
  flows: Flow[];
  specs: Spec[];
  runs: RunSummary[];
};

export type TabKind = "request" | "collection" | "folder" | "environment" | "globals" | "runner" | "docs" | "mock" | "monitor" | "flow" | "spec" | "vault" | "performance";

export type Tab = {
  id: Id;
  kind: TabKind;
  /** For saved requests/folders: where they live. */
  ref?: { collectionId: Id; itemId?: Id };
  /** request tabs: the working copy. */
  draft?: RequestItem;
  dirty?: boolean;
  /** Other kinds: what they show (env id, mock id…). */
  target?: Id;
  title: string;
  /** A tab opened by a single click that the next single click replaces (Postman's preview tabs). */
  preview?: boolean;
};
