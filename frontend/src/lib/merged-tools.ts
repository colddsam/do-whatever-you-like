/**
 * Pages that were folded into a broader tool, so there's one place per job instead of a page per
 * variant (one hash generator, not twenty). Each old id redirects permanently to the tool that
 * replaced it, with `params` choosing the same starting mode the old page had, so bookmarks and
 * search results still open exactly what people expect.
 *
 * Used by next.config.ts (the redirects), lib/tools.ts (old pages leave the directory, their
 * keywords move to the new tool so search still finds them) and the workspaces that read their
 * starting mode from the URL (lib/start-params.ts). Plain data with no imports, so next.config can
 * load it.
 */

export type MergedTool = { to: string; params?: Record<string, string> };

const many = (to: string, key: string, map: Record<string, string>, extra?: Record<string, string>): Record<string, MergedTool> =>
  Object.fromEntries(Object.entries(map).map(([id, value]) => [id, { to, params: { [key]: value, ...extra } }]));

export const MERGED_TOOLS: Record<string, MergedTool> = {
  // Developer: one page per job, the variant picked inside it.
  ...many("hash-generator", "alg", {
    "md5-hash": "md5", "sha1-hash": "sha1", "sha224-hash": "sha224", "sha256-hash": "sha256", "sha384-hash": "sha384",
    "sha512-hash": "sha512", "sha512-224-hash": "sha512-224", "sha512-256-hash": "sha512-256", "sha3-224-hash": "sha3-224",
    "sha3-256-hash": "sha3-256", "sha3-384-hash": "sha3-384", "sha3-512-hash": "sha3-512", "shake128-hash": "shake128",
    "shake256-hash": "shake256", "md2-hash": "md2", "md4-hash": "md4", "ntlm-hash": "ntlm", "crc16-hash": "crc16", "crc32-hash": "crc32",
  }),
  "hmac-generator": { to: "hash-generator", params: { alg: "sha256", hmac: "1" } },
  ...many("random-generator", "kind", {
    "random-string": "string", "random-alphanumeric": "alnum", "random-letters": "letters", "random-integer": "integer",
    "random-decimal": "decimal", "random-fraction": "fraction", "random-prime": "prime", "random-hex": "hex", "random-binary": "binary",
    "random-bytes": "bytes", "random-date": "date", "random-time": "time", "random-ip": "ip", "random-mac": "mac", "random-json": "json",
    "random-csv": "csv", "random-tsv": "tsv", "random-xml": "xml", "random-from-regex": "regex", "random-bitmap": "bitmap",
  }),
  ...many("code-formatter", "lang", {
    "html-formatter": "html", "css-formatter": "css", "javascript-formatter": "javascript", "typescript-formatter": "typescript",
    "react-formatter": "jsx", "angular-formatter": "angular", "xml-formatter": "xml", "php-formatter": "php", "java-formatter": "java",
    "sql-formatter": "sql", "yaml-formatter": "yaml", "markdown-formatter": "markdown",
  }),
  ...many("code-minifier", "lang", { "html-minifier": "html", "css-minifier": "css", "javascript-minifier": "javascript" }),
  ...many("code-validator", "lang", { "javascript-validator": "javascript", "css-validator": "css", "xml-validator": "xml", "yaml-validator": "yaml" }),
  "json-to-csv": { to: "data-format-converter", params: { pair: "json-csv", dir: "a2b" } },
  "csv-to-json": { to: "data-format-converter", params: { pair: "json-csv", dir: "b2a" } },
  "json-to-yaml": { to: "data-format-converter", params: { pair: "json-yaml", dir: "a2b" } },
  "yaml-to-json": { to: "data-format-converter", params: { pair: "json-yaml", dir: "b2a" } },
  "json-to-xml": { to: "data-format-converter", params: { pair: "json-xml", dir: "a2b" } },
  "xml-to-json": { to: "data-format-converter", params: { pair: "json-xml", dir: "b2a" } },
  "html-to-markdown": { to: "data-format-converter", params: { pair: "html-md", dir: "a2b" } },
  "markdown-to-html": { to: "data-format-converter", params: { pair: "html-md", dir: "b2a" } },
  ...many("dns-lookup", "kind", { "mx-lookup": "mx", "ns-lookup": "ns", "website-to-ip": "ip", "ip-to-hostname": "reverse" }),
  "http-status": { to: "http-headers", params: { kind: "status" } },
  // The one-shot API tester grew into the full API client.
  "api-tester": { to: "api-client" },
  "html-entities": { to: "json-escape", params: { kind: "html" } },
  "markdown-viewer": { to: "markdown-editor", params: { mode: "preview" } },

  // Text: the smart notepad covers plain editing, find & replace, line tools and hidden characters.
  "text-editor": { to: "notepad" },
  "find-and-replace": { to: "notepad", params: { open: "replace" } },
  "line-tools": { to: "notepad", params: { panel: "lines" } },
  "invisible-character-cleaner": { to: "notepad", params: { tab: "issues" } },
  "text-summarizer": { to: "writing", params: { mode: "summarize" } },
  ...many("text-to-binary", "base", { "text-to-hex": "hex", "text-to-ascii": "decimal" }, { from: "text" }),
  ...many("text-to-binary", "base", { "binary-to-text": "binary", "hex-to-text": "hex", "ascii-to-text": "decimal" }, { from: "codes" }),
  "words-to-number": { to: "number-to-words", params: { dir: "to-number" } },
  ...many("upside-down-text", "kind", { "mirror-text": "mirror", "reverse-text": "reverse" }),

  // Everyday and design.
  "pomodoro-timer": { to: "stopwatch", params: { mode: "pomodoro" } },
  "date-calculator": { to: "age-calculator", params: { mode: "between" } },
  "sip-calculator": { to: "emi-sip-calculator", params: { mode: "sip" } },
  "currency-converter": { to: "unit-converter", params: { cat: "currency" } },
  "browser-window-size": { to: "screen-resolution" },
  ...many("css-generator", "kind", {
    "css-gradient-generator": "gradient", "box-shadow-generator": "shadow", "border-radius-generator": "radius",
    "glassmorphism-generator": "glass", "neumorphism-generator": "neumorphism",
  }),

  // Files, PDF, images, audio & video.
  "excel-viewer": { to: "document-viewer" },
  "word-viewer": { to: "document-viewer" },
  "powerpoint-viewer": { to: "document-viewer" },
  "pdf-viewer": { to: "document-viewer" },
  "csv-viewer": { to: "document-viewer" },
  "remove-pages": { to: "organize-pdf" },
  "rotate-pdf": { to: "organize-pdf" },
  "extract-pages": { to: "split-pdf", params: { pages: "chosen" } },
  "convert-to-jpg": { to: "convert-image", params: { to: "jpg" } },
  "jpg-to-image": { to: "convert-image", params: { to: "png" } },
  "split-media": { to: "trim-media", params: { mode: "parts" } },
};

/** The address an old tool page now lives at, query included. */
export function mergedHref(id: string): string | null {
  const m = MERGED_TOOLS[id];
  if (!m) return null;
  const q = m.params ? `?${new URLSearchParams(m.params)}` : "";
  return `/tools/${m.to}${q}`;
}
