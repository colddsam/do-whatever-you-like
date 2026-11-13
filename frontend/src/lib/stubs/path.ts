/** Browser stand-in for Node's `path` (see stubs/fs.ts): just enough for @prettier/plugin-php's option code. */
const join = (...parts: string[]) => parts.filter(Boolean).join("/").replace(/\/+/g, "/");
const dirname = (p: string) => p.replace(/\/[^/]*\/?$/, "") || "/";
const parse = (p: string) => ({ root: p.startsWith("/") ? "/" : "", dir: dirname(p), base: p.split("/").pop() ?? "", ext: "", name: "" });
const path = { join, dirname, parse, sep: "/" };
export default path;
export { join, dirname, parse };
