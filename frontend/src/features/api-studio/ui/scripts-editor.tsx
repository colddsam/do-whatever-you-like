"use client";

import { useRef, useState } from "react";
import type { EditorView } from "@codemirror/view";
import { BookOpen, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ResponseData, Scripts } from "../types";
import { generateTests, generateVisualizer } from "../lib/assist";
import { CodeEditor } from "./code-editor";
import { Btn } from "./kit";
import { useVarInfo } from "./var-input";

const SNIPPETS: { name: string; code: string; for: "pre" | "post" | "both" }[] = [
  { name: "Get an environment variable", code: 'pm.environment.get("variable_key");', for: "both" },
  { name: "Get a global variable", code: 'pm.globals.get("variable_key");', for: "both" },
  { name: "Get a variable", code: 'pm.variables.get("variable_key");', for: "both" },
  { name: "Get a collection variable", code: 'pm.collectionVariables.get("variable_key");', for: "both" },
  { name: "Set an environment variable", code: 'pm.environment.set("variable_key", "variable_value");', for: "both" },
  { name: "Set a global variable", code: 'pm.globals.set("variable_key", "variable_value");', for: "both" },
  { name: "Set a collection variable", code: 'pm.collectionVariables.set("variable_key", "variable_value");', for: "both" },
  { name: "Clear an environment variable", code: 'pm.environment.unset("variable_key");', for: "both" },
  { name: "Clear a global variable", code: 'pm.globals.unset("variable_key");', for: "both" },
  { name: "Add a request header", code: 'pm.request.headers.upsert({ key: "X-Trace-Id", value: pm.variables.replaceIn("{{$guid}}") });', for: "pre" },
  { name: "Timestamp into a variable", code: 'pm.variables.set("now", new Date().toISOString());', for: "pre" },
  { name: "HMAC signature header", code: 'const secret = pm.environment.get("secret");\nconst body = pm.request.body ? pm.request.body.toString() : "";\nconst signature = CryptoJS.HmacSHA256(body, secret).toString(CryptoJS.enc.Hex);\npm.request.headers.upsert({ key: "X-Signature", value: signature });', for: "pre" },
  {
    name: "Send a request",
    code: 'pm.sendRequest("https://postman-echo.com/get", function (err, response) {\n    console.log(response.json());\n});',
    for: "both",
  },
  { name: "Status code: Code is 200", code: 'pm.test("Status code is 200", function () {\n    pm.response.to.have.status(200);\n});', for: "post" },
  { name: "Response body: Contains string", code: 'pm.test("Body matches string", function () {\n    pm.expect(pm.response.text()).to.include("string_you_want_to_search");\n});', for: "post" },
  { name: "Response body: JSON value check", code: 'pm.test("Your test name", function () {\n    var jsonData = pm.response.json();\n    pm.expect(jsonData.value).to.eql(100);\n});', for: "post" },
  { name: "Response body: Is equal to a string", code: 'pm.test("Body is correct", function () {\n    pm.response.to.have.body("response_body_string");\n});', for: "post" },
  { name: "Response headers: Content-Type header check", code: 'pm.test("Content-Type is present", function () {\n    pm.response.to.have.header("Content-Type");\n});', for: "post" },
  { name: "Response time is less than 200ms", code: 'pm.test("Response time is less than 200ms", function () {\n    pm.expect(pm.response.responseTime).to.be.below(200);\n});', for: "post" },
  { name: "Status code: Successful POST request", code: 'pm.test("Successful POST request", function () {\n    pm.expect(pm.response.code).to.be.oneOf([201, 202]);\n});', for: "post" },
  { name: "Status code: Code name has string", code: 'pm.test("Status code name has string", function () {\n    pm.response.to.have.status("Created");\n});', for: "post" },
  { name: "Response body: Convert XML body to a JSON Object", code: "var jsonObject = xml2Json(responseBody);", for: "post" },
  {
    name: "Validate the body against a JSON schema",
    code: 'const schema = {\n    type: "object",\n    required: ["id"],\n    properties: { id: { type: "integer" } }\n};\n\npm.test("Schema is valid", function () {\n    pm.response.to.have.jsonSchema(schema);\n});',
    for: "post",
  },
  { name: "Save a token from the response", code: 'const json = pm.response.json();\npm.environment.set("token", json.access_token);', for: "post" },
  { name: "Set next request (runner)", code: 'pm.execution.setNextRequest("Request name");', for: "both" },
  { name: "Stop the run (runner)", code: "pm.execution.setNextRequest(null);", for: "post" },
  { name: "Skip this request", code: 'if (!pm.environment.get("token")) {\n    pm.execution.skipRequest();\n}', for: "pre" },
  { name: "Check a cookie", code: 'pm.test("Has session cookie", function () {\n    pm.expect(pm.cookies.has("sessionId")).to.be.true;\n});', for: "post" },
  { name: "Visualize as a table", code: "", for: "post" },
];

export function ScriptsEditor({ scripts, onChange, collectionId, lastResponse, label }: { scripts: Scripts; onChange: (s: Scripts) => void; collectionId?: string; lastResponse?: ResponseData; label?: string }) {
  const [which, setWhich] = useState<"prerequest" | "test">(scripts.prerequest && !scripts.test ? "prerequest" : "test");
  const [showSnips, setShowSnips] = useState(true);
  const vars = useVarInfo(collectionId);
  const view = useRef<EditorView | null>(null);
  const value = scripts[which];
  const set = (v: string) => onChange({ ...scripts, [which]: v });
  const insert = (code: string) => {
    const v = view.current;
    if (!v) {
      set(value ? `${value}\n\n${code}` : code);
      return;
    }
    const at = v.state.selection.main.head;
    const doc = v.state.doc.toString();
    const pre = at > 0 && !doc.slice(0, at).endsWith("\n\n") ? (doc.slice(0, at).endsWith("\n") ? "\n" : "\n\n") : "";
    v.dispatch({ changes: { from: at, insert: pre + code + "\n" }, selection: { anchor: at + pre.length + code.length + 1 } });
    v.focus();
  };
  const snippets = SNIPPETS.filter((s) => s.for === "both" || (s.for === "pre") === (which === "prerequest"));

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 md:flex-row">
      <div role="tablist" aria-label="Script" className="flex shrink-0 gap-1 md:w-[130px] md:flex-col">
        {(["prerequest", "test"] as const).map((k) => (
          <button
            key={k}
            role="tab"
            type="button"
            aria-selected={which === k}
            onClick={() => setWhich(k)}
            className={cn("inline-flex h-8 items-center justify-between gap-2 rounded-md px-2.5 text-left text-[13px] transition-colors", which === k ? "bg-ink text-paper" : "text-ink-2 hover:bg-paper-2 hover:text-ink")}
          >
            {k === "prerequest" ? "Pre-request" : "Post-response"}
            {scripts[k].trim() && <span aria-label="has a script" className={cn("size-1.5 rounded-full", which === k ? "bg-paper" : "bg-success")} />}
          </button>
        ))}
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
        <CodeEditor
          key={which}
          value={value}
          onChange={set}
          language="javascript"
          scripts
          vars={vars}
          onReady={(v) => (view.current = v)}
          className="min-h-[220px] flex-1 rounded-md border border-line"
          ariaLabel={which === "prerequest" ? "Pre-request script" : "Post-response script"}
          placeholder={which === "prerequest" ? `// Runs before ${label ?? "the request"} is sent. Use pm.* to set variables or change the request.` : "// Runs after the response arrives. Write tests with pm.test() and pm.expect()."}
        />
        <p className="text-[12px] text-ink-3">
          Scripts run in a sandbox in your browser with Postman&apos;s <code className="font-mono">pm</code> API, chai, ajv, CryptoJS and lodash.
        </p>
      </div>
      <aside className={cn("flex min-h-0 shrink-0 flex-col md:w-[230px]", !showSnips && "md:w-auto")}>
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <button type="button" onClick={() => setShowSnips((s) => !s)} className="inline-flex items-center gap-1.5 text-[12px] font-medium text-ink-2 hover:text-ink">
            <BookOpen aria-hidden className="size-3.5" /> Snippets
          </button>
        </div>
        {showSnips && (
          <div className="flex min-h-0 flex-col gap-1.5">
            {which === "test" && (
              <Btn
                variant="secondary"
                icon={Sparkles}
                disabled={!lastResponse || !!lastResponse.error}
                title={lastResponse ? "Writes tests from the last response" : "Send the request first"}
                onClick={() => lastResponse && insert(generateTests(lastResponse))}
                className="justify-start"
              >
                Generate tests
              </Btn>
            )}
            <ul className="max-h-[260px] min-h-0 overflow-y-auto rounded-md border border-line md:max-h-none md:flex-1" data-lenis-prevent>
              {snippets.map((s) => (
                <li key={s.name}>
                  <button
                    type="button"
                    disabled={s.name === "Visualize as a table" && !lastResponse}
                    onClick={() => {
                      if (s.name === "Visualize as a table") {
                        const v = lastResponse ? generateVisualizer(lastResponse) : null;
                        insert(v ?? "// The last response isn't a JSON list, so there's nothing to tabulate.\n");
                      } else insert(s.code);
                    }}
                    className="block w-full border-b border-line px-2.5 py-1.5 text-left text-[12.5px] text-success last:border-0 hover:bg-paper-2 disabled:opacity-40"
                  >
                    {s.name}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </aside>
    </div>
  );
}
