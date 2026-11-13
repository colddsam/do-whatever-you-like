/**
 * Format, minify and validate code in the browser. Every library is loaded only when its language
 * is used, so a page that formats SQL never downloads Prettier's PHP or Java plugins.
 */

export type FormatLang = "html" | "css" | "javascript" | "typescript" | "jsx" | "angular" | "xml" | "php" | "java" | "sql" | "yaml" | "markdown" | "json";
export type FormatOptions = { tabWidth: number; useTabs: boolean; printWidth: number; singleQuote: boolean; semi: boolean; sqlDialect: string; keywordCase: "preserve" | "upper" | "lower" };
export const DEFAULT_FORMAT: FormatOptions = { tabWidth: 2, useTabs: false, printWidth: 80, singleQuote: false, semi: true, sqlDialect: "sql", keywordCase: "upper" };

export const SQL_DIALECTS: { value: string; label: string }[] = [
  { value: "sql", label: "Standard SQL" }, { value: "mysql", label: "MySQL" }, { value: "mariadb", label: "MariaDB" }, { value: "postgresql", label: "PostgreSQL" },
  { value: "tsql", label: "SQL Server" }, { value: "plsql", label: "Oracle PL/SQL" }, { value: "sqlite", label: "SQLite" }, { value: "bigquery", label: "BigQuery" },
  { value: "snowflake", label: "Snowflake" }, { value: "redshift", label: "Redshift" }, { value: "spark", label: "Spark" }, { value: "db2", label: "DB2" },
];

/** A located error: what went wrong and where (1-based). */
export type CodeError = { message: string; line?: number; column?: number };

export class CodeProblem extends Error {
  constructor(public problems: CodeError[]) {
    super(problems[0]?.message ?? "Invalid code");
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function prettierFor(lang: FormatLang): Promise<{ prettier: typeof import("prettier/standalone"); plugins: any[]; parser: string }> {
  const prettier = await import("prettier/standalone");
  const estree = () => import("prettier/plugins/estree");
  switch (lang) {
    case "javascript":
    case "jsx":
      return { prettier, plugins: await Promise.all([import("prettier/plugins/babel"), estree()]), parser: "babel" };
    case "json":
      return { prettier, plugins: await Promise.all([import("prettier/plugins/babel"), estree()]), parser: "json" };
    case "typescript":
      return { prettier, plugins: await Promise.all([import("prettier/plugins/typescript"), estree()]), parser: "typescript" };
    case "html":
      return { prettier, plugins: await Promise.all([import("prettier/plugins/html"), import("prettier/plugins/postcss"), import("prettier/plugins/babel"), estree()]), parser: "html" };
    case "angular":
      return { prettier, plugins: await Promise.all([import("prettier/plugins/html"), import("prettier/plugins/angular"), import("prettier/plugins/postcss"), import("prettier/plugins/babel"), estree()]), parser: "angular" };
    case "css":
      return { prettier, plugins: [await import("prettier/plugins/postcss")], parser: "css" };
    case "yaml":
      return { prettier, plugins: [await import("prettier/plugins/yaml")], parser: "yaml" };
    case "markdown":
      return { prettier, plugins: [await import("prettier/plugins/markdown")], parser: "markdown" };
    case "php":
      return { prettier, plugins: [(await import("@prettier/plugin-php/standalone")).default], parser: "php" };
    case "xml":
      return { prettier, plugins: [(await import("@prettier/plugin-xml")).default], parser: "xml" };
    case "java":
      return { prettier, plugins: [(await import("prettier-plugin-java")).default], parser: "java" };
    default:
      throw new Error(`No formatter for ${lang}`);
  }
}

/** Prettier's syntax errors carry `loc.start`; turn them into a readable, located error. */
function located(err: unknown): CodeError {
  const e = err as { message?: string; loc?: { start?: { line: number; column: number } } };
  const first = String(e?.message ?? err).split("\n")[0].replace(/\s*\(\d+:\d+\)\s*$/, "");
  return { message: first, line: e?.loc?.start?.line, column: e?.loc?.start?.column };
}

export async function formatCode(code: string, lang: FormatLang, o: FormatOptions): Promise<string> {
  if (!code.trim()) return "";
  if (lang === "sql") {
    const { format } = await import("sql-formatter");
    try {
      return format(code, { language: o.sqlDialect as any, tabWidth: o.tabWidth, useTabs: o.useTabs, keywordCase: o.keywordCase, expressionWidth: Math.max(20, o.printWidth - 30) });
    } catch (err) {
      throw new CodeProblem([{ message: String((err as Error).message).split("\n")[0] }]);
    }
  }
  const { prettier, plugins, parser } = await prettierFor(lang);
  try {
    return await prettier.format(code, {
      parser,
      plugins,
      tabWidth: o.tabWidth,
      useTabs: o.useTabs,
      printWidth: o.printWidth,
      singleQuote: o.singleQuote,
      semi: o.semi,
      ...(lang === "xml" ? { xmlWhitespaceSensitivity: "ignore", xmlSelfClosingSpace: true } : {}),
      ...(lang === "php" ? { phpVersion: "8.3" } : {}),
    } as any);
  } catch (err) {
    throw new CodeProblem([located(err)]);
  }
}

/* ---------- minify ---------- */

export type MinifyLang = "html" | "css" | "javascript";
export type MinifyOptions = { mangle: boolean; comments: boolean; inlineAssets: boolean };

export async function minifyCode(code: string, lang: MinifyLang, o: MinifyOptions): Promise<string> {
  if (!code.trim()) return "";
  if (lang === "css") return minifyCss(code, o.comments);
  if (lang === "javascript") return minifyJs(code, o);
  return minifyHtml(code, o);
}

async function minifyCss(code: string, keepComments: boolean) {
  const { minify } = await import("csso");
  try {
    return minify(code, { comments: keepComments ? "exclamation" : false }).css;
  } catch (err) {
    const e = err as { message?: string; line?: number; column?: number };
    throw new CodeProblem([{ message: String(e.message ?? err), line: e.line, column: e.column }]);
  }
}

async function minifyJs(code: string, o: MinifyOptions) {
  const { minify } = await import("terser");
  try {
    const out = await minify(code, { compress: { passes: 2 }, mangle: o.mangle, format: { comments: o.comments ? "some" : false }, module: /\b(import|export)\b/.test(code) });
    return out.code ?? "";
  } catch (err) {
    const e = err as { message?: string; line?: number; col?: number };
    throw new CodeProblem([{ message: String(e.message ?? err), line: e.line, column: e.col }]);
  }
}

/**
 * HTML: drops comments (keeps IE conditionals), collapses whitespace between and inside text
 * runs, leaves <pre>/<textarea> alone, and minifies inline <style> and <script> with csso/Terser.
 */
async function minifyHtml(html: string, o: MinifyOptions) {
  const keep: string[] = [];
  const stash = (s: string) => `\u0000${keep.push(s) - 1}\u0000`;
  let out = html.replace(/<(pre|textarea)\b[\s\S]*?<\/\1>/gi, stash);
  if (o.inlineAssets) {
    for (const [whole, attrs, css] of [...out.matchAll(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi)]) {
      const min = await minifyCss(css, false).catch(() => css.trim());
      out = out.replace(whole, stash(`<style${attrs.replace(/\s+/g, " ").replace(/\s+$/, "")}>${min}</style>`));
    }
    const scripts = [...out.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
    for (const m of scripts) {
      const [whole, attrs, js] = m;
      const isJs = !/type\s*=\s*["']?(?!text\/javascript|module|application\/javascript)[^"'\s>]+/i.test(attrs);
      const min = isJs && js.trim() ? await minifyJs(js, o).catch(() => js.trim()) : js.trim();
      out = out.replace(whole, stash(`<script${attrs.replace(/\s+/g, " ").replace(/\s+$/, "")}>${min}</script>`));
    }
  } else {
    out = out.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, stash);
  }
  if (!o.comments) out = out.replace(/<!--(?!\[if|<!\[endif)[\s\S]*?-->/g, "");
  out = out
    .replace(/\s+/g, " ")
    .replace(/>\s+</g, "><")
    .replace(/\s+(\/?>)/g, "$1")
    .trim();
  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => keep[+i]);
}

/* ---------- validate ---------- */

export type ValidateLang = "javascript" | "css" | "xml" | "yaml" | "json";
export type Validation = { ok: boolean; problems: CodeError[]; summary: string; extra?: string };

export async function validateCode(code: string, lang: ValidateLang): Promise<Validation> {
  if (!code.trim()) return { ok: false, problems: [], summary: "Paste something to check." };
  if (lang === "javascript") {
    // Babel with JSX and TypeScript-friendly syntax: catches syntax errors in JS, JSX and jQuery code.
    const { prettier, plugins } = await prettierFor("javascript");
    try {
      await prettier.format(code, { parser: "babel", plugins });
      return { ok: true, problems: [], summary: "No syntax errors." };
    } catch (err) {
      return { ok: false, problems: [located(err)], summary: "Syntax error." };
    }
  }
  if (lang === "css") return validateCss(code);
  if (lang === "xml") return validateXml(code);
  if (lang === "json") {
    try {
      JSON.parse(code);
      return { ok: true, problems: [], summary: "Valid JSON." };
    } catch (err) {
      return { ok: false, problems: [{ message: (err as Error).message }], summary: "Invalid JSON." };
    }
  }
  const yaml = await import("js-yaml");
  try {
    const docs = yaml.loadAll(code);
    return { ok: true, problems: [], summary: docs.length > 1 ? `Valid YAML (${docs.length} documents).` : "Valid YAML.", extra: JSON.stringify(docs.length > 1 ? docs : docs[0], null, 2) };
  } catch (err) {
    const e = err as { reason?: string; message?: string; mark?: { line: number; column: number } };
    return { ok: false, problems: [{ message: e.reason ?? String(e.message), line: e.mark ? e.mark.line + 1 : undefined, column: e.mark ? e.mark.column + 1 : undefined }], summary: "Invalid YAML." };
  }
}

async function validateCss(code: string): Promise<Validation> {
  const csstree = await import("css-tree");
  const problems: CodeError[] = [];
  const ast = csstree.parse(code, {
    positions: true,
    onParseError: (e: any) => problems.push({ message: `Syntax: ${e.formattedMessage?.split("\n")[0] ?? e.message}`, line: e.line, column: e.column }),
  });
  let count = 0;
  csstree.walk(ast, {
    visit: "Declaration",
    enter(node: any) {
      count++;
      if (node.property.startsWith("--")) return;
      const m = csstree.lexer.matchDeclaration(node);
      if (m.error) {
        const msg = /Unknown property/i.test(m.error.message) ? `Unknown property “${node.property}”.` : `“${node.property}” has an invalid value: ${csstree.generate(node.value)}.`;
        problems.push({ message: msg, line: node.loc?.start.line, column: node.loc?.start.column });
      }
    },
  });
  return { ok: problems.length === 0, problems, summary: problems.length ? `${problems.length} problem${problems.length === 1 ? "" : "s"} in ${count} declarations.` : `Valid CSS: ${count} declarations checked.` };
}

function validateXml(code: string): Validation {
  const doc = new DOMParser().parseFromString(code, "application/xml");
  const err = doc.getElementsByTagName("parsererror")[0];
  if (!err) {
    const n = doc.getElementsByTagName("*").length;
    return { ok: true, problems: [], summary: `Well-formed XML: ${n} element${n === 1 ? "" : "s"}, root <${doc.documentElement.nodeName}>.` };
  }
  const text = err.textContent ?? "Not well-formed";
  const m = /line(?: number)?\s*(\d+)(?:,? at column|,? column)?\s*(\d+)?/i.exec(text);
  const message = text.replace(/^This page contains the following errors:/, "").replace(/Below is a rendering of the page up to the first error\.?/, "").replace(/^error on line \d+ at column \d+:\s*/i, "").trim().split("\n")[0];
  return { ok: false, problems: [{ message: message || "Not well-formed XML.", line: m ? +m[1] : undefined, column: m?.[2] ? +m[2] : undefined }], summary: "Not well-formed." };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
