"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { gunzipSync, gzipSync, strFromU8, strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import { Archive, Download, Eye, FileText, FolderPlus, Search, Trash2, X } from "lucide-react";
import { saveBlob } from "@/lib/files";
import { formatBytes } from "@/lib/media";
import { getTool, stepsFor } from "@/lib/tools";
import { cn } from "@/lib/utils";
import { FileDrop } from "../file-drop";
import { Workbench } from "../workbench";
import { Chips, Notice, Panel, Row, Slider } from "../pdf/kit";

/* ========================================================================
 * PURE-TS POSIX USTAR TAR CODEC (Supports regular files & directories)
 * ======================================================================== */

const u8Encoder = new TextEncoder();
const u8Decoder = new TextDecoder("utf-8", { fatal: false });

export type ArchiveEntry = {
  path: string;
  data: Uint8Array;
  isDir: boolean;
  mtime?: Date;
};

function readNullAscii(u8: Uint8Array, start: number, len: number): string {
  let end = start;
  while (end < start + len && u8[end] !== 0) end++;
  return u8Decoder.decode(u8.subarray(start, end)).trim();
}

function readTarNumber(u8: Uint8Array, start: number, len: number): number {
  if ((u8[start] & 0x80) !== 0) {
    // GNU base-256 big-endian integer
    let val = 0;
    for (let i = 1; i < len; i++) val = val * 256 + u8[start + i];
    return val;
  }
  const s = readNullAscii(u8, start, len).replace(/[^\d]/g, "");
  return s ? parseInt(s, 8) : 0;
}

export function parseTar(buf: Uint8Array): ArchiveEntry[] {
  const entries: ArchiveEntry[] = [];
  let off = 0;
  while (off + 512 <= buf.length) {
    const hdr = buf.subarray(off, off + 512);
    if (hdr.every((b) => b === 0)) break;
    const rawName = readNullAscii(hdr, 0, 100);
    const prefix = readNullAscii(hdr, 345, 155);
    const fullName = prefix ? `${prefix}/${rawName}` : rawName;
    const size = readTarNumber(hdr, 124, 12);
    const mtimeSec = readTarNumber(hdr, 136, 12);
    const typeFlag = String.fromCharCode(hdr[156] || 48);
    off += 512;
    const payload = buf.subarray(off, Math.min(buf.length, off + size));
    off += Math.ceil(size / 512) * 512;
    // Skip PAX extended metadata entries
    if (typeFlag === "x" || typeFlag === "g" || !fullName) continue;
    const isDir = typeFlag === "5" || fullName.endsWith("/");
    entries.push({
      path: fullName.replace(/^\.\//, ""),
      data: isDir ? new Uint8Array(0) : new Uint8Array(payload),
      isDir,
      mtime: mtimeSec > 0 ? new Date(mtimeSec * 1000) : undefined,
    });
  }
  return entries;
}

export function buildTar(entries: { path: string; data: Uint8Array; mtime?: number }[]): Uint8Array {
  const writeStr = (blk: Uint8Array, off: number, len: number, str: string) => {
    const b = u8Encoder.encode(str);
    blk.set(b.subarray(0, len), off);
  };
  const writeOct = (blk: Uint8Array, off: number, len: number, val: number) => {
    const str = Math.max(0, Math.floor(val)).toString(8).padStart(len - 1, "0") + "\0";
    writeStr(blk, off, len, str);
  };

  const chunks: Uint8Array[] = [];
  const nowSec = Math.floor(Date.now() / 1000);

  for (const item of entries) {
    const cleanPath = item.path.replace(/^\/+/, "") || "file.bin";
    const hdr = new Uint8Array(512);
    if (cleanPath.length <= 100) {
      writeStr(hdr, 0, 100, cleanPath);
    } else {
      const idx = cleanPath.lastIndexOf("/");
      const prefix = idx > 0 ? cleanPath.slice(0, idx) : "";
      const name = idx > 0 ? cleanPath.slice(idx + 1) : cleanPath;
      writeStr(hdr, 0, 100, name);
      writeStr(hdr, 345, 155, prefix);
    }
    writeOct(hdr, 100, 8, 0o644);
    writeOct(hdr, 108, 8, 0);
    writeOct(hdr, 116, 8, 0);
    writeOct(hdr, 124, 12, item.data.length);
    writeOct(hdr, 136, 12, item.mtime ?? nowSec);
    hdr.fill(0x20, 148, 156); // checksum placeholder spaces
    hdr[156] = 0x30; // '0' regular file
    writeStr(hdr, 257, 6, "ustar");
    hdr[263] = 0x30;
    hdr[264] = 0x30;
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += hdr[i];
    writeStr(hdr, 148, 7, sum.toString(8).padStart(6, "0") + "\0");
    hdr[155] = 0x20;
    chunks.push(hdr);

    if (item.data.length > 0) {
      const paddedLen = Math.ceil(item.data.length / 512) * 512;
      const body = new Uint8Array(paddedLen);
      body.set(item.data, 0);
      chunks.push(body);
    }
  }
  chunks.push(new Uint8Array(1024)); // Two 512-byte EOF blocks

  const total = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}

export function extractAnyArchive(name: string, bytes: Uint8Array): { format: string; entries: ArchiveEntry[] } {
  const lower = name.toLowerCase();
  const isZip = (bytes[0] === 0x50 && bytes[1] === 0x4b) || lower.endsWith(".zip");
  const isGzip = (bytes[0] === 0x1f && bytes[1] === 0x8b) || lower.endsWith(".gz") || lower.endsWith(".tgz");

  if (isZip) {
    const files = unzipSync(bytes);
    const entries: ArchiveEntry[] = Object.entries(files).map(([path, data]) => ({
      path,
      data,
      isDir: path.endsWith("/"),
    }));
    return { format: "ZIP", entries };
  }

  if (isGzip) {
    const inner = gunzipSync(bytes);
    const innerTarLooksValid =
      lower.endsWith(".tar.gz") ||
      lower.endsWith(".tgz") ||
      (inner.length >= 512 && u8Decoder.decode(inner.subarray(257, 262)) === "ustar");
    if (innerTarLooksValid) {
      return { format: "TAR.GZ", entries: parseTar(inner) };
    }
    const innerName = name.replace(/\.gz$/i, "") || "decompressed.bin";
    return { format: "GZIP", entries: [{ path: innerName, data: inner, isDir: false }] };
  }

  if (lower.endsWith(".tar") || (bytes.length >= 512 && u8Decoder.decode(bytes.subarray(257, 262)) === "ustar")) {
    return { format: "TAR", entries: parseTar(bytes) };
  }

  throw new Error("Unsupported archive. Use .zip, .tar, .tar.gz, .tgz, or .gz.");
}

/* ========================================================================
 * REACT WORKSPACE
 * ======================================================================== */

type StagedFile = { id: string; path: string; data: Uint8Array };

const isTextPath = (p: string) => /\.(txt|md|json|csv|tsv|xml|html|css|js|ts|tsx|jsx|py|yaml|yml|sql|log|env|svg|ini|toml)$/i.test(p);
const isImgPath = (p: string) => /\.(png|jpe?g|webp|gif|svg)$/i.test(p);
const mimeOf = (p: string) => {
  const l = p.toLowerCase();
  if (l.endsWith(".png")) return "image/png";
  if (l.endsWith(".jpg") || l.endsWith(".jpeg")) return "image/jpeg";
  if (l.endsWith(".webp")) return "image/webp";
  if (l.endsWith(".gif")) return "image/gif";
  if (l.endsWith(".svg")) return "image/svg+xml";
  if (l.endsWith(".json")) return "application/json";
  return "application/octet-stream";
};

export function ArchiveTool({ toolId }: { toolId: string }) {
  const tool = getTool(toolId)!;
  const [tab, setTab] = useState<"extract" | "create">("extract");

  // Extract state
  const [archName, setArchName] = useState<string | null>(null);
  const [archFormat, setArchFormat] = useState<string>("");
  const [archSize, setArchSize] = useState(0);
  const [entries, setEntries] = useState<ArchiveEntry[]>([]);
  const [filter, setFilter] = useState("");
  const [extractErr, setExtractErr] = useState<string | null>(null);
  const [previewEntry, setPreviewEntry] = useState<{ path: string; text?: string; imgUrl?: string; size: number } | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  // Create state
  const [staged, setStaged] = useState<StagedFile[]>([
    {
      id: "sample-readme",
      path: "README.txt",
      data: strToU8("Created in-browser with Archive Extractor & Creator.\nZero server upload required.\n"),
    },
  ]);
  const [createFormat, setCreateFormat] = useState<"zip" | "tar" | "tar.gz" | "gz">("zip");
  const [outBase, setOutBase] = useState("bundle");
  const [zipLevel, setZipLevel] = useState(6);
  const [createErr, setCreateErr] = useState<string | null>(null);

  useEffect(() => () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, []);

  const closePreview = () => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setPreviewEntry(null);
  };

  const inspectFile = async (file: File) => {
    setExtractErr(null);
    closePreview();
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const res = extractAnyArchive(file.name, buf);
      setArchName(file.name);
      setArchFormat(res.format);
      setArchSize(file.size);
      setEntries(res.entries);
      setFilter("");
    } catch (e) {
      setExtractErr(e instanceof Error ? e.message : "Could not open this archive.");
    }
  };

  const openPreview = (entry: ArchiveEntry) => {
    closePreview();
    if (isImgPath(entry.path)) {
      const url = URL.createObjectURL(new Blob([new Uint8Array(entry.data)], { type: mimeOf(entry.path) }));
      previewUrlRef.current = url;
      setPreviewEntry({ path: entry.path, imgUrl: url, size: entry.data.length });
      return;
    }
    if (isTextPath(entry.path) || entry.data.every((b) => b === 9 || b === 10 || b === 13 || (b >= 32 && b <= 126))) {
      const sliced = entry.data.subarray(0, 120_000);
      setPreviewEntry({
        path: entry.path,
        text: strFromU8(sliced) + (entry.data.length > 120_000 ? "\n…(preview truncated at 120 KB)" : ""),
        size: entry.data.length,
      });
    } else {
      setPreviewEntry({
        path: entry.path,
        text: `Binary file (${formatBytes(entry.data.length)}). Click Download to save this entry.`,
        size: entry.data.length,
      });
    }
  };

  const filteredEntries = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return entries.filter((e) => !q || e.path.toLowerCase().includes(q));
  }, [entries, filter]);

  const totalExtractedBytes = useMemo(() => entries.reduce((a, e) => a + e.data.length, 0), [entries]);

  const repackAsZip = () => {
    const map: Zippable = {};
    for (const e of filteredEntries) {
      if (!e.isDir) map[e.path] = e.data;
    }
    const zipped = zipSync(map, { level: 6 });
    const stem = (archName ?? "extracted").replace(/\.(zip|tar\.gz|tgz|tar|gz)$/i, "");
    saveBlob(new Blob([new Uint8Array(zipped)], { type: "application/zip" }), `${stem}-extracted.zip`);
  };

  const loadSampleZip = () => {
    const zipBytes = zipSync({
      "project/package.json": strToU8(JSON.stringify({ name: "starter-kit", version: "1.0.0", license: "MIT" }, null, 2)),
      "project/README.md": strToU8("# Starter Kit\n\nExtracted 100% locally in the browser without uploading files."),
      "project/src/hello.ts": strToU8('export const greet = (name: string) => `Hello, ${name}!`;\n'),
    });
    const file = new File([new Uint8Array(zipBytes)], "sample-project.zip", { type: "application/zip" });
    void inspectFile(file);
  };

  const addStagedFiles = async (files: File[]) => {
    setCreateErr(null);
    const added: StagedFile[] = await Promise.all(
      files.map(async (f, idx) => ({
        id: `${Date.now()}-${idx}-${f.name}`,
        path: f.name,
        data: new Uint8Array(await f.arrayBuffer()),
      })),
    );
    setStaged((prev) => [...prev, ...added]);
  };

  const buildAndDownloadArchive = () => {
    setCreateErr(null);
    if (staged.length === 0) {
      setCreateErr("Add at least one file first.");
      return;
    }
    const base = outBase.trim().replace(/[^\w.-]+/g, "_") || "bundle";
    if (createFormat === "zip") {
      const map: Zippable = {};
      for (const f of staged) {
        map[f.path] = [f.data, { level: zipLevel as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 }];
      }
      const bytes = zipSync(map);
      saveBlob(new Blob([new Uint8Array(bytes)], { type: "application/zip" }), `${base}.zip`);
    } else if (createFormat === "tar") {
      const bytes = buildTar(staged);
      saveBlob(new Blob([new Uint8Array(bytes)], { type: "application/x-tar" }), `${base}.tar`);
    } else if (createFormat === "tar.gz") {
      const tarBytes = buildTar(staged);
      const gzBytes = gzipSync(tarBytes, { level: zipLevel as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 });
      saveBlob(new Blob([new Uint8Array(gzBytes)], { type: "application/gzip" }), `${base}.tar.gz`);
    } else {
      if (staged.length > 1) {
        setCreateErr("GZIP (.gz) compresses a single file. Use ZIP or TAR.GZ to bundle multiple files.");
        return;
      }
      const gzBytes = gzipSync(staged[0].data, { level: zipLevel as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 });
      saveBlob(new Blob([new Uint8Array(gzBytes)], { type: "application/gzip" }), `${staged[0].path}.gz`);
    }
  };

  return (
    <Workbench
      steps={stepsFor(tool)}
      current={tab === "extract" ? (entries.length ? 1 : 0) : staged.length ? 1 : 0}
      footer={<>Archives are inspected and built locally in your browser with fflate and POSIX USTAR. Nothing leaves your computer.</>}
    >
      <div className="space-y-4 p-4 sm:p-5">
        <Panel>
          <Row label="Mode">
            <Chips
              value={tab}
              onChange={setTab}
              options={[
                { value: "extract", label: "Inspect & Extract (.zip / .tar / .tgz / .gz)" },
                { value: "create", label: `Create Archive (${staged.length} files)` },
              ]}
            />
          </Row>
        </Panel>

        {tab === "extract" ? (
          <>
            <FileDrop
              accept=".zip,.tar,.gz,.tgz,.tar.gz,application/zip,application/gzip,application/x-tar"
              title="Drop a .zip, .tar, .tar.gz, .tgz or .gz archive"
              formats="ZIP · TAR · TAR.GZ · TGZ · GZ · unpacked in browser"
              error={extractErr}
              compact={entries.length > 0}
              onFile={(f) => void inspectFile(f)}
            />
            {entries.length === 0 && (
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={loadSampleZip}
                  className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line bg-surface px-3.5 text-sm text-ink-2 hover:border-ink-3 hover:text-ink"
                >
                  <Archive aria-hidden className="size-4" /> Inspect sample .zip archive
                </button>
              </div>
            )}

            {archName && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-paper px-3.5 py-2.5">
                  <div>
                    <p className="text-sm font-medium text-ink">
                      {archName} <span className="font-mono text-[12px] text-accent">[{archFormat}]</span>
                    </p>
                    <p className="font-mono text-[12px] text-ink-3">
                      Compressed {formatBytes(archSize)} → Uncompressed {formatBytes(totalExtractedBytes)} · {entries.length} entries
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-3" />
                      <input
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                        placeholder="Filter paths…"
                        aria-label="Filter archive entries"
                        className="h-8 w-44 rounded-[7px] border border-line bg-surface pl-8 pr-2.5 text-[12px] text-ink outline-none focus:border-ink"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={repackAsZip}
                      className="inline-flex h-8 items-center gap-1.5 rounded-[7px] bg-ink px-3 text-[12px] font-medium text-paper hover:bg-ink/90"
                    >
                      <Download aria-hidden className="size-3.5" /> Save filtered .zip
                    </button>
                  </div>
                </div>

                {previewEntry && (
                  <div className="overflow-hidden rounded-md border border-line bg-surface">
                    <div className="flex items-center justify-between border-b border-line bg-paper px-3.5 py-2">
                      <span className="font-mono text-[12px] font-medium text-ink">
                        Preview: {previewEntry.path} ({formatBytes(previewEntry.size)})
                      </span>
                      <button type="button" onClick={closePreview} className="text-ink-3 hover:text-ink" aria-label="Close preview">
                        <X aria-hidden className="size-4" />
                      </button>
                    </div>
                    <div className="max-h-72 overflow-auto p-3.5">
                      {previewEntry.imgUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={previewEntry.imgUrl} alt={previewEntry.path} className="max-h-60 object-contain" />
                      ) : (
                        <pre className="whitespace-pre-wrap break-all font-mono text-[13px] text-ink">{previewEntry.text}</pre>
                      )}
                    </div>
                  </div>
                )}

                <div className="overflow-x-auto rounded-md border border-line bg-surface">
                  <table className="w-full border-collapse text-left">
                    <thead>
                      <tr className="border-b border-line bg-paper font-mono text-[12px] uppercase tracking-wider text-ink-2">
                        <th className="px-3.5 py-2">Path</th>
                        <th className="px-3.5 py-2">Size</th>
                        <th className="px-3.5 py-2 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line/60 text-sm">
                      {filteredEntries.map((e) => (
                        <tr key={e.path} className="hover:bg-paper/40">
                          <td className="max-w-md truncate px-3.5 py-2 font-mono text-[13px] text-ink">
                            {e.isDir ? <span className="text-ink-3">{e.path} (folder)</span> : e.path}
                          </td>
                          <td className="px-3.5 py-2 font-mono text-[12px] text-ink-3">{e.isDir ? "—" : formatBytes(e.data.length)}</td>
                          <td className="px-3.5 py-2 text-right">
                            {!e.isDir && (
                              <div className="inline-flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => openPreview(e)}
                                  className="inline-flex h-7 items-center gap-1 rounded-[6px] border border-line bg-paper px-2 text-[12px] text-ink-2 hover:text-ink"
                                >
                                  <Eye aria-hidden className="size-3.5" /> Preview
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    saveBlob(
                                      new Blob([new Uint8Array(e.data)], { type: mimeOf(e.path) }),
                                      e.path.split("/").pop() || "file.bin",
                                    )
                                  }
                                  className="inline-flex h-7 items-center gap-1 rounded-[6px] border border-line bg-surface px-2 text-[12px] font-medium text-ink hover:border-ink-3"
                                >
                                  <Download aria-hidden className="size-3.5" /> Extract
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        ) : (
          <>
            <FileDrop
              accept="*"
              multiple
              compact={staged.length > 0}
              title="Drop files to bundle into an archive"
              formats="Any file type · rename paths before compressing"
              error={createErr}
              onFiles={(files) => void addStagedFiles(files)}
            />

            <Panel>
              <Row label="Archive format">
                <Chips
                  value={createFormat}
                  onChange={setCreateFormat}
                  options={[
                    { value: "zip", label: ".zip" },
                    { value: "tar.gz", label: ".tar.gz" },
                    { value: "tar", label: ".tar (uncompressed)" },
                    { value: "gz", label: ".gz (single file)" },
                  ]}
                />
              </Row>
              {createFormat !== "tar" && (
                <Row label="Compression">
                  <Slider
                    label="Deflate / Gzip level"
                    value={zipLevel}
                    min={0}
                    max={9}
                    onChange={setZipLevel}
                    format={(v) => (v === 0 ? "0 (Store only)" : `${v} / 9`)}
                  />
                </Row>
              )}
              <Row label="Filename">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={outBase}
                    onChange={(e) => setOutBase(e.target.value)}
                    aria-label="Output filename"
                    className="h-9 w-52 rounded-[8px] border border-line bg-surface px-3 font-mono text-sm text-ink outline-none focus:border-ink"
                  />
                  <span className="font-mono text-[13px] text-ink-3">.{createFormat}</span>
                  <button
                    type="button"
                    onClick={() =>
                      setStaged((prev) => [
                        ...prev,
                        { id: `${Date.now()}`, path: `notes/note-${prev.length + 1}.txt`, data: strToU8("New text note\n") },
                      ])
                    }
                    className="ml-auto inline-flex h-8 items-center gap-1 rounded-[7px] border border-line bg-surface px-2.5 text-[12px] text-ink-2 hover:text-ink"
                  >
                    <FolderPlus aria-hidden className="size-3.5" /> Add blank note.txt
                  </button>
                </div>
              </Row>
            </Panel>

            {staged.length > 0 && (
              <div className="overflow-hidden rounded-md border border-line bg-surface">
                <div className="flex items-center justify-between border-b border-line bg-paper px-3.5 py-2">
                  <span className="label-mono text-ink-2">
                    Archive contents ({staged.length} file{staged.length === 1 ? "" : "s"} ·{" "}
                    {formatBytes(staged.reduce((a, f) => a + f.data.length, 0))})
                  </span>
                  <button
                    type="button"
                    onClick={buildAndDownloadArchive}
                    className="inline-flex h-8 items-center gap-1.5 rounded-[7px] bg-accent px-3.5 text-[12px] font-medium text-white hover:opacity-95"
                  >
                    <Download aria-hidden className="size-3.5" /> Create & Download .{createFormat}
                  </button>
                </div>
                <div className="divide-y divide-line/60">
                  {staged.map((f, idx) => (
                    <div key={f.id} className="flex flex-wrap items-center gap-2.5 px-3.5 py-2">
                      <FileText aria-hidden className="size-4 shrink-0 text-ink-3" />
                      <input
                        value={f.path}
                        aria-label={`Archive path for file ${idx + 1}`}
                        onChange={(e) =>
                          setStaged((prev) => prev.map((it) => (it.id === f.id ? { ...it, path: e.target.value } : it)))
                        }
                        className="h-8 min-w-0 flex-1 rounded-[6px] border border-line bg-paper px-2.5 font-mono text-[13px] text-ink outline-none focus:border-ink"
                      />
                      <span className="font-mono text-[12px] text-ink-3">{formatBytes(f.data.length)}</span>
                      <button
                        type="button"
                        onClick={() => setStaged((prev) => prev.filter((it) => it.id !== f.id))}
                        aria-label={`Remove ${f.path}`}
                        className={cn(
                          "inline-flex h-8 w-8 items-center justify-center rounded-[6px] border border-line bg-surface text-ink-3 hover:border-danger/50 hover:text-danger",
                        )}
                      >
                        <Trash2 aria-hidden className="size-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <Notice tone="info">
              Edit any path above (for example <code className="font-mono">folder/asset.png</code>) to organize subdirectories inside your archive.
            </Notice>
          </>
        )}
      </div>
    </Workbench>
  );
}
