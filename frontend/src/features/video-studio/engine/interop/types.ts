import type { MediaKind, Project } from "../../types";

export type ImportSource =
  | "premiere-prproj"
  | "premiere-xml"
  | "fcpxml"
  | "edl"
  | "capcut"
  | "aftereffects-aep"
  | "aftereffects-aepx"
  | "lottie";

export interface OfflineAssetInfo {
  mediaId: string;
  name: string;
  expectedPath: string;
  kind: MediaKind;
  duration: number;
}

export interface ImportedAssetBlob {
  mediaId: string;
  file: File;
}

export interface ImportResult {
  project: Project;
  source: ImportSource;
  sourceLabel: string;
  warnings: string[];
  offlineAssets: OfflineAssetInfo[];
  fontsUsed: string[];
  embeddedFiles?: ImportedAssetBlob[];
}

export interface XmlNode {
  tag: string;
  attrs: Record<string, string>;
  text: string;
  children: XmlNode[];
}

const decodeXmlEntities = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, "&");

/** Lightweight pure-TS XML parser so Premiere/FCP/AE project parsers run cleanly in Browser, Workers, and Node. */
export function parseXmlTree(xml: string): XmlNode {
  const root: XmlNode = { tag: "__root__", attrs: {}, text: "", children: [] };
  const stack: XmlNode[] = [root];
  const cleaned = xml
    .replace(/^\uFEFF/, "")
    .replace(/<\?[\s\S]*?\?>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!DOCTYPE[\s\S]*?>/gi, "");

  const tokenRe = /<(\/?)([^\s>/]+)([^>]*?)(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(cleaned)) !== null) {
    const top = stack[stack.length - 1];
    if (m[5] !== undefined) {
      const txt = decodeXmlEntities(m[5]);
      if (txt.trim()) top.text += top.text ? ` ${txt.trim()}` : txt.trim();
      continue;
    }
    const isClose = m[1] === "/";
    const tag = m[2];
    const attrStr = m[3] ?? "";
    const selfClose = m[4] === "/";
    if (isClose) {
      for (let i = stack.length - 1; i >= 1; i--) {
        if (stack[i].tag === tag) {
          stack.length = i;
          break;
        }
      }
      continue;
    }
    const attrs: Record<string, string> = {};
    const attrRe = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let am: RegExpExecArray | null;
    while ((am = attrRe.exec(attrStr)) !== null) {
      attrs[am[1]] = decodeXmlEntities(am[2] ?? am[3] ?? "");
    }
    const node: XmlNode = { tag, attrs, text: "", children: [] };
    top.children.push(node);
    if (!selfClose) stack.push(node);
  }
  return root.children[0] ?? root;
}

export const xmlChild = (node: XmlNode | undefined, tag: string): XmlNode | undefined => node?.children.find((c) => c.tag === tag);
export const xmlChildren = (node: XmlNode | undefined, tag: string): XmlNode[] => node?.children.filter((c) => c.tag === tag) ?? [];
export const xmlText = (node: XmlNode | undefined, tag: string): string => xmlChild(node, tag)?.text.trim() ?? "";

export function findAllXml(node: XmlNode | undefined, tag: string, out: XmlNode[] = []): XmlNode[] {
  if (!node) return out;
  if (node.tag === tag) out.push(node);
  for (const ch of node.children) findAllXml(ch, tag, out);
  return out;
}

export function cleanPathBasename(rawPath: string): string {
  const clean = rawPath.replace(/^file:\/\/localhost/i, "").replace(/^file:\/\//i, "").split("?")[0];
  try {
    const decoded = decodeURIComponent(clean);
    return decoded.split(/[\\/]/).filter(Boolean).pop() ?? rawPath;
  } catch {
    return clean.split(/[\\/]/).filter(Boolean).pop() ?? rawPath;
  }
}

export function inferMediaKind(nameOrPath: string, hint?: "video" | "audio" | "image"): MediaKind {
  const ext = nameOrPath.split(".").pop()?.toLowerCase() ?? "";
  if (["wav", "mp3", "m4a", "aac", "flac", "ogg", "opus", "aiff", "aif", "wma"].includes(ext)) return "audio";
  if (["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg", "tif", "tiff", "psd"].includes(ext)) return "image";
  return hint ?? "video";
}
