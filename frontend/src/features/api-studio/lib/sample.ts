import type { Workspace } from "../types";
import { defaultBody, kv, newCollection, newFolder, newRequest, uid, variable } from "./util";

/** The first-run workspace: a small collection that shows each part of the tool working against public test APIs. */
export function sampleWorkspace(): Workspace {
  const c = newCollection("Getting started");
  c.description =
    "A tour of the API client. Each request works against a public test API.\n\n- **Send** a request with Ctrl/⌘ + Enter.\n- Variables like `{{baseUrl}}` come from this collection's **Variables** tab and the active environment.\n- The **Scripts** tab holds pre-request scripts and tests written with the `pm` API.\n- Open **Runner** from the collection's ⋯ menu to run everything at once.";
  c.variables = [variable("baseUrl", "https://httpbin.org"), variable("postId", "1")];
  c.scripts = { prerequest: "", test: 'pm.test("Response arrived in under 5 s", () => {\n  pm.expect(pm.response.responseTime).to.be.below(5000);\n});' };

  const basics = newFolder("Basics");
  const get = newRequest({
    name: "Get with query params",
    url: "{{baseUrl}}/get?search=api&page=1",
    params: [kv("search", "api"), kv("page", "1")],
    headers: [kv("Accept", "application/json")],
    scripts: {
      prerequest: 'pm.variables.set("requestedAt", new Date().toISOString());',
      test: 'pm.test("Status code is 200", () => {\n  pm.response.to.have.status(200);\n});\n\npm.test("Echoes the query", () => {\n  const json = pm.response.json();\n  pm.expect(json.args.search).to.eql("api");\n});',
    },
    description: "A GET with query parameters. The Params tab and the URL stay in sync.",
  });
  get.examples.push({
    id: uid(),
    name: "Found",
    request: { method: "GET", url: "{{baseUrl}}/get?search=api&page=1", headers: [] },
    status: 200,
    statusText: "OK",
    headers: [kv("Content-Type", "application/json")],
    body: JSON.stringify({ args: { search: "api", page: "1" }, url: "https://httpbin.org/get?search=api&page=1", id: "{{$randomUUID}}" }, null, 2),
    lang: "json",
  });
  const post = newRequest({
    name: "Create a post (JSON)",
    method: "POST",
    url: "https://jsonplaceholder.typicode.com/posts",
    body: { ...defaultBody(), mode: "raw", rawLang: "json", raw: '{\n  "title": "{{$randomLoremSentence}}",\n  "body": "Sent from the API client",\n  "userId": {{$randomInt}}\n}' },
    scripts: { prerequest: "", test: 'pm.test("Created", () => pm.response.to.have.status(201));\n\nconst post = pm.response.json();\npm.collectionVariables.set("postId", post.id);' },
    description: "A JSON body with dynamic variables. The test saves the new post's id into a collection variable.",
  });
  const byId = newRequest({
    name: "Get a post by id",
    url: "https://jsonplaceholder.typicode.com/posts/:id",
    pathVars: [kv("id", "{{postId}}")],
    scripts: { prerequest: "", test: 'pm.test("Has a title", () => {\n  pm.expect(pm.response.json()).to.have.property("title");\n});' },
    description: "`:id` is a path variable: set it in the Params tab.",
  });
  basics.items = [get, post, byId];

  const auth = newFolder("Authorization");
  auth.items = [
    newRequest({ name: "Basic auth", url: "{{baseUrl}}/basic-auth/user/passwd", auth: { type: "basic", params: { username: "user", password: "passwd" } }, scripts: { prerequest: "", test: "pm.test(\"Authenticated\", () => pm.response.to.be.ok);" } }),
    newRequest({ name: "Bearer token", url: "{{baseUrl}}/bearer", auth: { type: "bearer", params: { token: "{{$randomUUID}}" } } }),
    newRequest({ name: "Digest auth", url: "{{baseUrl}}/digest-auth/auth/user/passwd/MD5", auth: { type: "digest", params: { username: "user", password: "passwd" } } }),
  ];

  const bodies = newFolder("Bodies");
  bodies.items = [
    newRequest({ name: "Form data", method: "POST", url: "{{baseUrl}}/post", body: { ...defaultBody(), mode: "formdata", formdata: [kv("name", "{{$randomFullName}}"), kv("email", "{{$randomEmail}}")] } }),
    newRequest({ name: "URL-encoded form", method: "POST", url: "{{baseUrl}}/post", body: { ...defaultBody(), mode: "urlencoded", urlencoded: [kv("city", "{{$randomCity}}"), kv("country", "{{$randomCountry}}")] } }),
    newRequest({
      name: "GraphQL: countries",
      protocol: "graphql",
      method: "POST",
      url: "https://countries.trevorblades.com/graphql",
      body: { ...defaultBody(), mode: "graphql", graphql: { query: "query Country($code: ID!) {\n  country(code: $code) {\n    name\n    capital\n    emoji\n    currency\n  }\n}", variables: '{\n  "code": "IN"\n}' } },
    }),
  ];

  const realtime = newFolder("Realtime");
  realtime.items = [
    newRequest({ protocol: "ws", name: "WebSocket echo", url: "wss://echo.websocket.org", messages: [{ id: uid(), name: "Hello", body: '{ "hello": "world" }', format: "json" }] }),
    newRequest({ name: "Server-sent events", url: "https://stream.wikimedia.org/v2/stream/recentchange", settings: { followRedirects: true, followOriginalMethod: false, followAuthHeader: false, maxRedirects: 10, strictSSL: true, timeoutMs: 0, encodeUrl: true, disableCookies: false, agent: "browser" }, description: "A stream that never ends: events arrive live in the Events view. Press Cancel to stop." }),
  ];

  c.items = [basics, auth, bodies, realtime];
  return {
    id: uid(),
    name: "My workspace",
    collections: [c],
    // Only values the collection doesn't already define, so switching environments never looks like it "does nothing".
    environments: [{ id: uid(), name: "Demo environment", values: [variable("apiKey", "demo-key", { type: "secret" }), variable("username", "user"), variable("password", "passwd", { type: "secret" })] }],
    globals: [],
    vault: [],
    activeEnvId: null,
    history: [],
    cookies: [],
    mocks: [],
    monitors: [],
    flows: [],
    specs: [],
    runs: [],
  };
}
