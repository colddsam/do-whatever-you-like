import type { RequestItem } from "../types";
import { applyPathVars, withScheme } from "./url";
import { effectiveAuth } from "./auth";
import type { Collection, Folder } from "../types";
import { resolve, type Scopes } from "./vars";
import { RAW_TYPES } from "./body";

/**
 * Code snippets for a request, in the languages Postman offers. Variables are resolved (or kept as
 * {{name}} when asked), simple auth (Basic, Bearer, API key) is written out; signed auth types are
 * noted, since their signatures change on every request.
 */

export type Snip = {
  method: string;
  url: string;
  headers: [string, string][];
  body:
    | { kind: "none" }
    | { kind: "raw"; text: string }
    | { kind: "urlencoded"; fields: [string, string][] }
    | { kind: "formdata"; fields: { key: string; value: string; file?: string }[] }
    | { kind: "binary"; file: string };
  note?: string;
};

export const LANGUAGES: { id: string; label: string; cm: string }[] = [
  { id: "curl", label: "cURL", cm: "Shell" },
  { id: "httpie", label: "HTTPie", cm: "Shell" },
  { id: "wget", label: "Shell – wget", cm: "Shell" },
  { id: "powershell", label: "PowerShell – RestMethod", cm: "PowerShell" },
  { id: "http", label: "HTTP", cm: "Plain text" },
  { id: "js-fetch", label: "JavaScript – Fetch", cm: "JavaScript" },
  { id: "js-xhr", label: "JavaScript – XHR", cm: "JavaScript" },
  { id: "js-jquery", label: "JavaScript – jQuery", cm: "JavaScript" },
  { id: "node-axios", label: "NodeJs – Axios", cm: "JavaScript" },
  { id: "node-native", label: "NodeJs – Native", cm: "JavaScript" },
  { id: "python-requests", label: "Python – Requests", cm: "Python" },
  { id: "python-http", label: "Python – http.client", cm: "Python" },
  { id: "go", label: "Go – Native", cm: "Go" },
  { id: "java-okhttp", label: "Java – OkHttp", cm: "Java" },
  { id: "java-httpclient", label: "Java – HttpClient", cm: "Java" },
  { id: "kotlin-okhttp", label: "Kotlin – OkHttp", cm: "Kotlin" },
  { id: "csharp-httpclient", label: "C# – HttpClient", cm: "C#" },
  { id: "php-curl", label: "PHP – cURL", cm: "PHP" },
  { id: "php-guzzle", label: "PHP – Guzzle", cm: "PHP" },
  { id: "ruby", label: "Ruby – Net::HTTP", cm: "Ruby" },
  { id: "swift", label: "Swift – URLSession", cm: "Swift" },
  { id: "dart", label: "Dart – http", cm: "Dart" },
  { id: "rust", label: "Rust – reqwest", cm: "Rust" },
  { id: "c-libcurl", label: "C – libcurl", cm: "C" },
  { id: "r-httr", label: "R – httr", cm: "R" },
];

export function snipFrom(item: RequestItem, scopes: Scopes, keepVars: boolean, parents: Folder[] = [], collection?: Collection | null): Snip {
  const r = (s: string) => (keepVars ? s : resolve(s, scopes));
  let url = withScheme(applyPathVars(r(item.url), item.pathVars.map((p) => ({ ...p, value: r(p.value) }))));
  const headers: [string, string][] = item.headers.filter((h) => h.enabled && h.key).map((h) => [r(h.key), r(h.value)]);
  const has = (k: string) => headers.some(([h]) => h.toLowerCase() === k.toLowerCase());
  const { auth } = effectiveAuth(item, parents, collection);
  const a = Object.fromEntries(Object.entries(auth.params).map(([k, v]) => [k, r(v)]));
  let note: string | undefined;
  if (auth.type === "basic") headers.push(["Authorization", `Basic ${btoa(unescape(encodeURIComponent(`${a.username ?? ""}:${a.password ?? ""}`)))}`]);
  else if (auth.type === "bearer" && a.token) headers.push(["Authorization", `Bearer ${a.token}`]);
  else if (auth.type === "oauth2" && a.accessToken) headers.push(["Authorization", `${a.headerPrefix || "Bearer"} ${a.accessToken}`]);
  else if (auth.type === "apikey" && a.key) {
    if (a.in === "query") url += `${url.includes("?") ? "&" : "?"}${encodeURIComponent(a.key)}=${encodeURIComponent(a.value ?? "")}`;
    else headers.push([a.key, a.value ?? ""]);
  } else if (!["noauth", "inherit"].includes(auth.type)) note = `${auth.type} signatures are made fresh for every request, so this snippet leaves them out.`;
  let body: Snip["body"] = { kind: "none" };
  const b = item.body;
  if (b.mode === "raw" && b.raw) {
    body = { kind: "raw", text: r(b.raw) };
    if (!has("content-type")) headers.push(["Content-Type", RAW_TYPES[b.rawLang]]);
  } else if (b.mode === "graphql") {
    let variables: unknown;
    try {
      variables = b.graphql.variables.trim() ? JSON.parse(r(b.graphql.variables)) : undefined;
    } catch {
      variables = undefined;
    }
    body = { kind: "raw", text: JSON.stringify(variables === undefined ? { query: r(b.graphql.query) } : { query: r(b.graphql.query), variables }) };
    if (!has("content-type")) headers.push(["Content-Type", "application/json"]);
  } else if (b.mode === "urlencoded") {
    body = { kind: "urlencoded", fields: b.urlencoded.filter((f) => f.enabled && f.key).map((f) => [r(f.key), r(f.value)]) };
    if (!has("content-type")) headers.push(["Content-Type", "application/x-www-form-urlencoded"]);
  } else if (b.mode === "formdata") {
    body = { kind: "formdata", fields: b.formdata.filter((f) => f.enabled && f.key).map((f) => (f.type === "file" ? { key: r(f.key), value: "", file: f.file?.name ?? "file" } : { key: r(f.key), value: r(f.value) })) };
  } else if (b.mode === "binary" && b.binary) body = { kind: "binary", file: b.binary.name };
  return { method: item.method.toUpperCase(), url, headers, body, note };
}

const sq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const dq = (s: string) => JSON.stringify(s);
const ind = (s: string, n = 2) => s.split("\n").map((l) => " ".repeat(n) + l).join("\n");
const form = (f: [string, string][]) => f.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
const bodyText = (s: Snip) => (s.body.kind === "raw" ? s.body.text : s.body.kind === "urlencoded" ? form(s.body.fields) : "");
const hasText = (s: Snip) => s.body.kind === "raw" || s.body.kind === "urlencoded";
const pyStr = (s: string) => (s.includes("\n") ? `"""${s.replace(/\\/g, "\\\\").replace(/"""/g, '\\"\\"\\"')}"""` : dq(s));

export function generate(lang: string, s: Snip): string {
  const out = gen(lang, s);
  return s.note ? `${commentFor(lang)} ${s.note}\n${out}` : out;
}

function commentFor(lang: string) {
  if (["curl", "httpie", "wget", "powershell", "python-requests", "python-http", "ruby", "r-httr"].includes(lang)) return "#";
  if (lang === "http") return "#";
  return "//";
}

function gen(lang: string, s: Snip): string {
  const { method, url, headers } = s;
  switch (lang) {
    case "curl": {
      const parts = [`curl --location --request ${method} ${sq(url)}`];
      for (const [k, v] of headers) parts.push(`--header ${sq(`${k}: ${v}`)}`);
      if (s.body.kind === "raw") parts.push(`--data ${sq(s.body.text)}`);
      if (s.body.kind === "urlencoded") for (const [k, v] of s.body.fields) parts.push(`--data-urlencode ${sq(`${k}=${v}`)}`);
      if (s.body.kind === "formdata") for (const f of s.body.fields) parts.push(`--form ${sq(f.file ? `${f.key}=@"${f.file}"` : `${f.key}=${f.value}`)}`);
      if (s.body.kind === "binary") parts.push(`--data-binary ${sq(`@${s.body.file}`)}`);
      return parts.join(" \\\n");
    }
    case "httpie": {
      const parts = [`http --follow ${method} ${sq(url)}`];
      for (const [k, v] of headers) parts.push(sq(`${k}:${v}`));
      if (s.body.kind === "raw") return `printf ${sq(s.body.text)} | ${parts.join(" \\\n  ")}`;
      if (s.body.kind === "urlencoded") return `http --form --follow ${method} ${sq(url)} \\\n  ${[...headers.map(([k, v]) => sq(`${k}:${v}`)), ...s.body.fields.map(([k, v]) => sq(`${k}=${v}`))].join(" \\\n  ")}`;
      if (s.body.kind === "formdata") return `http --multipart --follow ${method} ${sq(url)} \\\n  ${[...headers.map(([k, v]) => sq(`${k}:${v}`)), ...s.body.fields.map((f) => sq(f.file ? `${f.key}@${f.file}` : `${f.key}=${f.value}`))].join(" \\\n  ")}`;
      return parts.join(" \\\n  ");
    }
    case "wget": {
      const parts = [`wget --no-check-certificate --quiet \\\n  --method ${method} \\\n  --timeout=0`];
      for (const [k, v] of headers) parts.push(`  --header ${sq(`${k}: ${v}`)}`);
      if (hasText(s)) parts.push(`  --body-data ${sq(bodyText(s))}`);
      parts.push(`   ${sq(url)}`);
      return parts.join(" \\\n");
    }
    case "powershell": {
      const lines = ['$headers = New-Object "System.Collections.Generic.Dictionary[[String],[String]]"'];
      for (const [k, v] of headers) lines.push(`$headers.Add(${dq(k)}, ${dq(v)})`);
      if (hasText(s)) lines.push(`\n$body = @"\n${bodyText(s)}\n"@`);
      lines.push(`\n$response = Invoke-RestMethod ${sq(url)} -Method '${method}' -Headers $headers${hasText(s) ? " -Body $body" : ""}`);
      lines.push("$response | ConvertTo-Json");
      return lines.join("\n");
    }
    case "http": {
      const u = new URL(url);
      const lines = [`${method} ${u.pathname}${u.search} HTTP/1.1`, `Host: ${u.host}`, ...headers.map(([k, v]) => `${k}: ${v}`)];
      if (s.body.kind === "formdata") {
        lines.push("Content-Type: multipart/form-data; boundary=----Boundary", "", ...s.body.fields.flatMap((f) => ["------Boundary", `Content-Disposition: form-data; name="${f.key}"${f.file ? `; filename="${f.file}"` : ""}`, "", f.file ? `<${f.file}>` : f.value]), "------Boundary--");
      } else if (hasText(s)) lines.push(`Content-Length: ${new TextEncoder().encode(bodyText(s)).length}`, "", bodyText(s));
      return lines.join("\n");
    }
    case "js-fetch": {
      const lines = ["const myHeaders = new Headers();", ...headers.map(([k, v]) => `myHeaders.append(${dq(k)}, ${dq(v)});`), ""];
      if (s.body.kind === "raw") lines.push(`const raw = ${dq(s.body.text)};`, "");
      if (s.body.kind === "urlencoded") lines.push("const urlencoded = new URLSearchParams();", ...s.body.fields.map(([k, v]) => `urlencoded.append(${dq(k)}, ${dq(v)});`), "");
      if (s.body.kind === "formdata") lines.push("const formdata = new FormData();", ...s.body.fields.map((f) => (f.file ? `formdata.append(${dq(f.key)}, fileInput.files[0], ${dq(f.file)});` : `formdata.append(${dq(f.key)}, ${dq(f.value)});`)), "");
      const bodyVar = { raw: "raw", urlencoded: "urlencoded", formdata: "formdata", binary: "file", none: "" }[s.body.kind];
      lines.push("const requestOptions = {", `  method: ${dq(method)},`, "  headers: myHeaders,", ...(bodyVar ? [`  body: ${bodyVar},`] : []), '  redirect: "follow"', "};", "");
      lines.push(`fetch(${dq(url)}, requestOptions)`, "  .then((response) => response.text())", "  .then((result) => console.log(result))", "  .catch((error) => console.error(error));");
      return lines.join("\n");
    }
    case "js-xhr": {
      const lines: string[] = [];
      if (hasText(s)) lines.push(`const data = ${dq(bodyText(s))};`, "");
      if (s.body.kind === "formdata") lines.push("const data = new FormData();", ...s.body.fields.map((f) => (f.file ? `data.append(${dq(f.key)}, fileInput.files[0], ${dq(f.file)});` : `data.append(${dq(f.key)}, ${dq(f.value)});`)), "");
      lines.push("const xhr = new XMLHttpRequest();", "xhr.withCredentials = true;", "", 'xhr.addEventListener("readystatechange", function () {', "  if (this.readyState === 4) {", "    console.log(this.responseText);", "  }", "});", "", `xhr.open(${dq(method)}, ${dq(url)});`);
      for (const [k, v] of headers) lines.push(`xhr.setRequestHeader(${dq(k)}, ${dq(v)});`);
      lines.push("", `xhr.send(${hasText(s) || s.body.kind === "formdata" ? "data" : ""});`);
      return lines.join("\n");
    }
    case "js-jquery": {
      const lines = ["const settings = {", `  url: ${dq(url)},`, `  method: ${dq(method)},`, "  timeout: 0,"];
      if (headers.length) lines.push("  headers: {", ...headers.map(([k, v]) => `    ${dq(k)}: ${dq(v)},`), "  },");
      if (hasText(s)) lines.push(`  data: ${dq(bodyText(s))},`);
      lines.push("};", "", "$.ajax(settings).done(function (response) {", "  console.log(response);", "});");
      return lines.join("\n");
    }
    case "node-axios": {
      const lines = ['const axios = require("axios");'];
      if (s.body.kind === "formdata") lines.push('const FormData = require("form-data");', 'const fs = require("fs");', "const data = new FormData();", ...s.body.fields.map((f) => (f.file ? `data.append(${dq(f.key)}, fs.createReadStream(${dq(f.file)}));` : `data.append(${dq(f.key)}, ${dq(f.value)});`)));
      else if (hasText(s)) lines.push(`const data = ${dq(bodyText(s))};`);
      lines.push("", "const config = {", `  method: ${dq(method.toLowerCase())},`, "  maxBodyLength: Infinity,", `  url: ${dq(url)},`);
      if (headers.length || s.body.kind === "formdata") lines.push("  headers: {", ...headers.map(([k, v]) => `    ${dq(k)}: ${dq(v)},`), ...(s.body.kind === "formdata" ? ["    ...data.getHeaders(),"] : []), "  },");
      if (hasText(s) || s.body.kind === "formdata") lines.push("  data: data,");
      lines.push("};", "", "axios", "  .request(config)", "  .then((response) => {", "    console.log(JSON.stringify(response.data));", "  })", "  .catch((error) => {", "    console.log(error);", "  });");
      return lines.join("\n");
    }
    case "node-native": {
      const u = new URL(url);
      const mod = u.protocol === "https:" ? "https" : "http";
      const lines = [`const ${mod} = require("${mod}");`, "", "const options = {", `  method: ${dq(method)},`, `  hostname: ${dq(u.hostname)},`, ...(u.port ? [`  port: ${u.port},`] : []), `  path: ${dq(u.pathname + u.search)},`, "  headers: {", ...headers.map(([k, v]) => `    ${dq(k)}: ${dq(v)},`), "  },", "  maxRedirects: 20,", "};", ""];
      lines.push(`const req = ${mod}.request(options, (res) => {`, "  const chunks = [];", '  res.on("data", (chunk) => chunks.push(chunk));', '  res.on("end", () => console.log(Buffer.concat(chunks).toString()));', '  res.on("error", (error) => console.error(error));', "});", "");
      if (hasText(s)) lines.push(`req.write(${dq(bodyText(s))});`, "");
      lines.push("req.end();");
      return lines.join("\n");
    }
    case "python-requests": {
      const lines = ["import requests", "", `url = ${dq(url)}`, ""];
      if (s.body.kind === "raw") lines.push(`payload = ${pyStr(s.body.text)}`);
      else if (s.body.kind === "urlencoded") lines.push(`payload = ${dq(form(s.body.fields))}`);
      else if (s.body.kind === "formdata") {
        const plain = s.body.fields.filter((f) => !f.file);
        const files = s.body.fields.filter((f) => f.file);
        lines.push(`payload = {${plain.map((f) => `${dq(f.key)}: ${dq(f.value)}`).join(", ")}}`);
        lines.push(`files = [\n${files.map((f) => `  (${dq(f.key)}, (${dq(f.file!)}, open(${dq(f.file!)}, "rb")))`).join(",\n")}\n]`);
      } else lines.push("payload = {}");
      lines.push(`headers = {\n${headers.map(([k, v]) => `  ${dq(k)}: ${dq(v)}`).join(",\n")}\n}`, "");
      lines.push(`response = requests.request(${dq(method)}, url, headers=headers, data=payload${s.body.kind === "formdata" ? ", files=files" : ""})`, "", "print(response.text)");
      return lines.join("\n");
    }
    case "python-http": {
      const u = new URL(url);
      const cls = u.protocol === "https:" ? "HTTPSConnection" : "HTTPConnection";
      return [
        "import http.client",
        "",
        `conn = http.client.${cls}(${dq(u.host)})`,
        `payload = ${hasText(s) ? pyStr(bodyText(s)) : "''"}`,
        `headers = {\n${headers.map(([k, v]) => `  ${dq(k)}: ${dq(v)}`).join(",\n")}\n}`,
        `conn.request(${dq(method)}, ${dq(u.pathname + u.search)}, payload, headers)`,
        "res = conn.getresponse()",
        "data = res.read()",
        'print(data.decode("utf-8"))',
      ].join("\n");
    }
    case "go": {
      const lines = ["package main", "", "import (", '  "fmt"', ...(hasText(s) ? ['  "strings"'] : []), '  "net/http"', '  "io"', ")", "", "func main() {", "", `  url := ${dq(url)}`, `  method := ${dq(method)}`, ""];
      if (hasText(s)) lines.push(`  payload := strings.NewReader(${dq(bodyText(s))})`, "");
      lines.push("  client := &http.Client{}", `  req, err := http.NewRequest(method, url, ${hasText(s) ? "payload" : "nil"})`, "", "  if err != nil {", "    fmt.Println(err)", "    return", "  }");
      for (const [k, v] of headers) lines.push(`  req.Header.Add(${dq(k)}, ${dq(v)})`);
      lines.push("", "  res, err := client.Do(req)", "  if err != nil {", "    fmt.Println(err)", "    return", "  }", "  defer res.Body.Close()", "", "  body, err := io.ReadAll(res.Body)", "  if err != nil {", "    fmt.Println(err)", "    return", "  }", "  fmt.Println(string(body))", "}");
      return lines.join("\n");
    }
    case "java-okhttp":
    case "kotlin-okhttp": {
      const kt = lang === "kotlin-okhttp";
      const ct = headers.find(([k]) => k.toLowerCase() === "content-type")?.[1] ?? "text/plain";
      const lines = kt ? ["val client = OkHttpClient()"] : ["OkHttpClient client = new OkHttpClient().newBuilder()", "  .build();"];
      if (hasText(s)) lines.push(kt ? `val mediaType = "${ct}".toMediaType()` : `MediaType mediaType = MediaType.parse(${dq(ct)});`, kt ? `val body = ${dq(bodyText(s))}.toRequestBody(mediaType)` : `RequestBody body = RequestBody.create(mediaType, ${dq(bodyText(s))});`);
      lines.push(kt ? "val request = Request.Builder()" : "Request request = new Request.Builder()", `  .url(${dq(url)})`, `  .method(${dq(method)}, ${hasText(s) ? "body" : "null"})`);
      for (const [k, v] of headers) lines.push(`  .addHeader(${dq(k)}, ${dq(v)})`);
      lines.push(kt ? "  .build()" : "  .build();", kt ? "val response = client.newCall(request).execute()" : "Response response = client.newCall(request).execute();");
      return lines.join("\n");
    }
    case "java-httpclient": {
      const lines = ["HttpClient client = HttpClient.newHttpClient();", "HttpRequest request = HttpRequest.newBuilder()", `  .uri(URI.create(${dq(url)}))`];
      for (const [k, v] of headers) lines.push(`  .header(${dq(k)}, ${dq(v)})`);
      lines.push(`  .method(${dq(method)}, ${hasText(s) ? `HttpRequest.BodyPublishers.ofString(${dq(bodyText(s))})` : "HttpRequest.BodyPublishers.noBody()"})`, "  .build();", "HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());", "System.out.println(response.body());");
      return lines.join("\n");
    }
    case "csharp-httpclient": {
      const ct = headers.find(([k]) => k.toLowerCase() === "content-type")?.[1] ?? "text/plain";
      const lines = ["var client = new HttpClient();", `var request = new HttpRequestMessage(new HttpMethod(${dq(method)}), ${dq(url)});`];
      for (const [k, v] of headers.filter(([k]) => k.toLowerCase() !== "content-type")) lines.push(`request.Headers.Add(${dq(k)}, ${dq(v)});`);
      if (hasText(s)) lines.push(`var content = new StringContent(${dq(bodyText(s))}, null, ${dq(ct.split(";")[0])});`, "request.Content = content;");
      if (s.body.kind === "formdata") lines.push("var content = new MultipartFormDataContent();", ...s.body.fields.map((f) => (f.file ? `content.Add(new StreamContent(File.OpenRead(${dq(f.file)})), ${dq(f.key)}, ${dq(f.file)});` : `content.Add(new StringContent(${dq(f.value)}), ${dq(f.key)});`)), "request.Content = content;");
      lines.push("var response = await client.SendAsync(request);", "response.EnsureSuccessStatusCode();", "Console.WriteLine(await response.Content.ReadAsStringAsync());");
      return lines.join("\n");
    }
    case "php-curl": {
      const lines = ["<?php", "", "$curl = curl_init();", "", "curl_setopt_array($curl, array(", `  CURLOPT_URL => ${sq(url)},`, "  CURLOPT_RETURNTRANSFER => true,", "  CURLOPT_ENCODING => '',", "  CURLOPT_MAXREDIRS => 10,", "  CURLOPT_TIMEOUT => 0,", "  CURLOPT_FOLLOWLOCATION => true,", "  CURLOPT_HTTP_VERSION => CURL_HTTP_VERSION_1_1,", `  CURLOPT_CUSTOMREQUEST => ${sq(method)},`];
      if (hasText(s)) lines.push(`  CURLOPT_POSTFIELDS => ${sq(bodyText(s))},`);
      if (s.body.kind === "formdata") lines.push(`  CURLOPT_POSTFIELDS => array(${s.body.fields.map((f) => `${sq(f.key)} => ${f.file ? `new CURLFILE(${sq(f.file)})` : sq(f.value)}`).join(", ")}),`);
      if (headers.length) lines.push("  CURLOPT_HTTPHEADER => array(", ...headers.map(([k, v]) => `    ${sq(`${k}: ${v}`)},`), "  ),");
      lines.push("));", "", "$response = curl_exec($curl);", "", "curl_close($curl);", "echo $response;");
      return lines.join("\n");
    }
    case "php-guzzle": {
      const lines = ["<?php", "$client = new Client();", `$headers = [\n${headers.map(([k, v]) => `  ${sq(k)} => ${sq(v)}`).join(",\n")}\n];`];
      if (hasText(s)) lines.push(`$body = ${sq(bodyText(s))};`);
      lines.push(`$request = new Request(${sq(method)}, ${sq(url)}, $headers${hasText(s) ? ", $body" : ""});`, "$res = $client->sendAsync($request)->wait();", "echo $res->getBody();");
      return lines.join("\n");
    }
    case "ruby": {
      const u = new URL(url);
      const cls = method.charAt(0) + method.slice(1).toLowerCase();
      const known = ["Get", "Post", "Put", "Patch", "Delete", "Head", "Options"];
      const lines = ['require "uri"', 'require "net/http"', "", `url = URI(${dq(url)})`, "", "http = Net::HTTP.new(url.host, url.port);", ...(u.protocol === "https:" ? ["http.use_ssl = true"] : []), known.includes(cls) ? `request = Net::HTTP::${cls}.new(url)` : `request = Net::HTTPGenericRequest.new(${dq(method)}, true, true, url)`];
      for (const [k, v] of headers) lines.push(`request[${dq(k)}] = ${dq(v)}`);
      if (hasText(s)) lines.push(`request.body = ${dq(bodyText(s))}`);
      lines.push("", "response = http.request(request)", "puts response.read_body");
      return lines.join("\n");
    }
    case "swift": {
      const lines = [`var request = URLRequest(url: URL(string: ${dq(url)})!,timeoutInterval: Double.infinity)`];
      for (const [k, v] of headers) lines.push(`request.addValue(${dq(v)}, forHTTPHeaderField: ${dq(k)})`);
      if (hasText(s)) lines.unshift(`let parameters = ${dq(bodyText(s))}`, "let postData = parameters.data(using: .utf8)", "");
      lines.push("", `request.httpMethod = ${dq(method)}`, ...(hasText(s) ? ["request.httpBody = postData"] : []), "", "let task = URLSession.shared.dataTask(with: request) { data, response, error in", "  guard let data = data else {", "    print(String(describing: error))", "    return", "  }", "  print(String(data: data, encoding: .utf8)!)", "}", "", "task.resume()");
      return lines.join("\n");
    }
    case "dart": {
      const lines = ["var headers = {", ...headers.map(([k, v]) => `  ${dq(k)}: ${dq(v)},`), "};", `var request = http.Request(${dq(method)}, Uri.parse(${dq(url)}));`];
      if (hasText(s)) lines.push(`request.body = ${dq(bodyText(s))};`);
      lines.push("request.headers.addAll(headers);", "", "http.StreamedResponse response = await request.send();", "", "if (response.statusCode == 200) {", "  print(await response.stream.bytesToString());", "} else {", "  print(response.reasonPhrase);", "}");
      return lines.join("\n");
    }
    case "rust": {
      const lines = ["#[tokio::main]", "async fn main() -> Result<(), Box<dyn std::error::Error>> {", "    let client = reqwest::Client::builder().build()?;", "", "    let mut headers = reqwest::header::HeaderMap::new();"];
      for (const [k, v] of headers) lines.push(`    headers.insert(${dq(k)}, ${dq(v)}.parse()?);`);
      if (hasText(s)) lines.push("", `    let data = ${dq(bodyText(s))};`);
      lines.push("", `    let request = client.request(reqwest::Method::from_bytes(b${dq(method)})?, ${dq(url)})`, "        .headers(headers)" + (hasText(s) ? "\n        .body(data);" : ";"), "", "    let response = request.send().await?;", "    let body = response.text().await?;", "", '    println!("{}", body);', "", "    Ok(())", "}");
      return lines.join("\n");
    }
    case "c-libcurl": {
      const lines = ["CURL *curl;", "CURLcode res;", "curl = curl_easy_init();", "if(curl) {", `  curl_easy_setopt(curl, CURLOPT_CUSTOMREQUEST, ${dq(method)});`, `  curl_easy_setopt(curl, CURLOPT_URL, ${dq(url)});`, "  curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 1L);", "  struct curl_slist *headers = NULL;"];
      for (const [k, v] of headers) lines.push(`  headers = curl_slist_append(headers, ${dq(`${k}: ${v}`)});`);
      lines.push("  curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);");
      if (hasText(s)) lines.push(`  const char *data = ${dq(bodyText(s))};`, "  curl_easy_setopt(curl, CURLOPT_POSTFIELDS, data);");
      lines.push("  res = curl_easy_perform(curl);", "  curl_slist_free_all(headers);", "}", "curl_easy_cleanup(curl);");
      return lines.join("\n");
    }
    case "r-httr": {
      const lines = ["library(httr)", "", `headers = c(\n${headers.map(([k, v]) => `  ${dq(k)} = ${dq(v)}`).join(",\n")}\n)`];
      if (hasText(s)) lines.push("", `body = ${dq(bodyText(s))};`);
      lines.push("", `res <- VERB(${dq(method)}, url = ${dq(url)}${hasText(s) ? ", body = body" : ""}, add_headers(headers))`, "", "cat(content(res, 'text'))");
      return lines.join("\n");
    }
    default:
      return ind("Unknown language");
  }
}
