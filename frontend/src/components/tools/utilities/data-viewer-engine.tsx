"use client";

import { useMemo, useState } from "react";
import { gunzipSync } from "fflate";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Database, Download, FileSpreadsheet, Play, Search, Table2 } from "lucide-react";
import { saveBlob } from "@/lib/files";
import { formatBytes } from "@/lib/media";
import { cn } from "@/lib/utils";
import { Chips, Notice, Panel, Row } from "../pdf/kit";
import { CopyButton, Editor } from "../dev/parts";
import { parseCsvRows } from "./dev-data-engines";
import type { EngineProps } from "./text-engines";

/* ========================================================================
 * DATA TYPES & SAMPLE MULTI-TABLE WORKSPACE
 * ======================================================================== */

export type DataColumn = { name: string; type: string };
export type DataRow = Record<string, unknown>;
export type DataTable = { name: string; columns: DataColumn[]; rows: DataRow[]; sql?: string };
export type LoadedDataset = {
  fileName: string;
  format: "SQLite" | "Parquet" | "CSV" | "TSV" | "JSON" | "NDJSON" | "Sample";
  sizeBytes?: number;
  tables: DataTable[];
  warnings?: string[];
};

const SAMPLE_DATASET: LoadedDataset = {
  fileName: "sample-store.sqlite (built-in)",
  format: "Sample",
  tables: [
    {
      name: "orders",
      sql: "CREATE TABLE orders (id INTEGER PRIMARY KEY, customer TEXT, city TEXT, category TEXT, amount_inr REAL, status TEXT, order_date TEXT)",
      columns: [
        { name: "id", type: "INTEGER" },
        { name: "customer", type: "TEXT" },
        { name: "city", type: "TEXT" },
        { name: "category", type: "TEXT" },
        { name: "amount_inr", type: "REAL" },
        { name: "status", type: "TEXT" },
        { name: "order_date", type: "TEXT" },
      ],
      rows: [
        { id: 1001, customer: "Aarav Mehta", city: "Bengaluru", category: "Electronics", amount_inr: 12499, status: "paid", order_date: "2026-10-01" },
        { id: 1002, customer: "Priya Nair", city: "Kochi", category: "Books", amount_inr: 1290, status: "paid", order_date: "2026-10-02" },
        { id: 1003, customer: "Rohan Kapoor", city: "Mumbai", category: "Workspace", amount_inr: 6450, status: "shipped", order_date: "2026-10-03" },
        { id: 1004, customer: "Ananya Verma", city: "Delhi", category: "Electronics", amount_inr: 28900, status: "paid", order_date: "2026-10-04" },
        { id: 1005, customer: "Vikram Iyer", city: "Chennai", category: "Workspace", amount_inr: 3499, status: "pending", order_date: "2026-10-05" },
        { id: 1006, customer: "Meera Joshi", city: "Pune", category: "Books", amount_inr: 840, status: "paid", order_date: "2026-10-06" },
        { id: 1007, customer: "Kabir Malhotra", city: "Bengaluru", category: "Electronics", amount_inr: 8999, status: "refunded", order_date: "2026-10-07" },
        { id: 1008, customer: "Diya Sharma", city: "Hyderabad", category: "Workspace", amount_inr: 4750, status: "paid", order_date: "2026-10-08" },
      ],
    },
    {
      name: "products",
      sql: "CREATE TABLE products (sku TEXT PRIMARY KEY, title TEXT, category TEXT, stock INTEGER, price_inr REAL)",
      columns: [
        { name: "sku", type: "TEXT" },
        { name: "title", type: "TEXT" },
        { name: "category", type: "TEXT" },
        { name: "stock", type: "INTEGER" },
        { name: "price_inr", type: "REAL" },
      ],
      rows: [
        { sku: "KB-MECH", title: "Mechanical Keyboard 75%", category: "Electronics", stock: 24, price_inr: 6499 },
        { sku: "MN-STAND", title: "Aluminium Monitor Arm", category: "Workspace", stock: 15, price_inr: 3499 },
        { sku: "BK-DDIA", title: "Designing Data Systems", category: "Books", stock: 42, price_inr: 1290 },
        { sku: "HUB-USBC", title: "7-in-1 USB-C Dock", category: "Electronics", stock: 9, price_inr: 2499 },
      ],
    },
  ],
};

/* ========================================================================
 * PURE-TS SQLITE 3 BINARY READER (Supports B-Tree interior/leaf & overflow)
 * ======================================================================== */

const utf8Decoder = new TextDecoder("utf-8", { fatal: false });
const utf16LeDecoder = new TextDecoder("utf-16le", { fatal: false });
const utf16BeDecoder = new TextDecoder("utf-16be", { fatal: false });

const BI_0 = BigInt(0);
const BI_1 = BigInt(1);
const BI_7 = BigInt(7);
const BI_8 = BigInt(8);
const BI_32 = BigInt(32);
const BI_63 = BigInt(63);
const BI_64 = BigInt(64);

function readSqliteVarint(u8: Uint8Array, pos: number): { value: bigint; next: number } {
  let acc = BI_0;
  for (let i = 0; i < 8; i++) {
    const b = u8[pos + i];
    acc = (acc << BI_7) | BigInt(b & 0x7f);
    if ((b & 0x80) === 0) {
      return { value: acc, next: pos + i + 1 };
    }
  }
  const b8 = u8[pos + 8];
  acc = (acc << BI_8) | BigInt(b8);
  return { value: acc, next: pos + 9 };
}

function readSignedIntBE(u8: Uint8Array, off: number, len: number): number | string {
  if (len === 8) {
    let val = BI_0;
    for (let i = 0; i < 8; i++) val = (val << BI_8) | BigInt(u8[off + i]);
    if (val & (BI_1 << BI_63)) val -= BI_1 << BI_64;
    if (val <= BigInt(Number.MAX_SAFE_INTEGER) && val >= BigInt(Number.MIN_SAFE_INTEGER)) return Number(val);
    return val.toString();
  }
  let v = 0;
  for (let i = 0; i < len; i++) v = v * 256 + u8[off + i];
  const signBit = 2 ** (len * 8 - 1);
  if (v >= signBit) v -= 2 ** (len * 8);
  return v;
}

function decodeSqliteText(bytes: Uint8Array, encoding: number): string {
  if (encoding === 2) return utf16LeDecoder.decode(bytes);
  if (encoding === 3) return utf16BeDecoder.decode(bytes);
  return utf8Decoder.decode(bytes);
}

function parseCreateTableColumns(sql: string): DataColumn[] {
  const open = sql.indexOf("(");
  const close = sql.lastIndexOf(")");
  if (open < 0 || close <= open) return [];
  const body = sql.slice(open + 1, close);
  const parts: string[] = [];
  let cur = "";
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quote) {
      cur += ch;
      if (ch === quote && body[i - 1] !== "\\") quote = null;
    } else if (ch === "'" || ch === '"' || ch === "`" || ch === "[") {
      quote = ch === "[" ? "]" : ch;
      cur += ch;
    } else if (ch === "(") {
      depth++;
      cur += ch;
    } else if (ch === ")") {
      depth = Math.max(0, depth - 1);
      cur += ch;
    } else if (ch === "," && depth === 0) {
      if (cur.trim()) parts.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) parts.push(cur.trim());

  const cols: DataColumn[] = [];
  for (const part of parts) {
    if (/^(PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE|CHECK|CONSTRAINT)\b/i.test(part)) continue;
    const m = /^(?:"([^"]+)"|`([^`]+)`|\[([^\]]+)\]|([^\s(]+))\s*([^\r\n]*)$/i.exec(part);
    if (!m) continue;
    const name = m[1] ?? m[2] ?? m[3] ?? m[4];
    const typeToken = (m[5] ?? "").trim().split(/\s+/)[0] || "ANY";
    cols.push({ name, type: typeToken.toUpperCase() });
  }
  return cols;
}

export function parseSqliteBuffer(buf: ArrayBuffer): DataTable[] {
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  const magic = utf8Decoder.decode(u8.subarray(0, 15));
  if (magic !== "SQLite format 3") throw new Error("Not a valid SQLite 3 database file.");

  const rawPageSize = dv.getUint16(16, false);
  const pageSize = rawPageSize === 1 ? 65536 : rawPageSize;
  const reserved = u8[20] ?? 0;
  const usableSize = pageSize - reserved;
  const encoding = dv.getUint32(56, false) || 1;
  const totalPages = Math.floor(u8.length / pageSize);

  const extractPayload = (cellOffset: number, payloadSize: number): Uint8Array => {
    const X = usableSize - 35;
    if (payloadSize <= X) return u8.subarray(cellOffset, cellOffset + payloadSize);
    const M = Math.floor(((usableSize - 12) * 32) / 255) - 23;
    const K = M + ((payloadSize - M) % (usableSize - 4));
    const localLen = K <= X ? K : M;
    const result = new Uint8Array(payloadSize);
    result.set(u8.subarray(cellOffset, cellOffset + localLen), 0);
    let written = localLen;
    let nextOverflow = dv.getUint32(cellOffset + localLen, false);
    const visited = new Set<number>();
    while (nextOverflow > 0 && written < payloadSize && nextOverflow <= totalPages && !visited.has(nextOverflow)) {
      visited.add(nextOverflow);
      const ovOff = (nextOverflow - 1) * pageSize;
      nextOverflow = dv.getUint32(ovOff, false);
      const chunkLen = Math.min(usableSize - 4, payloadSize - written);
      result.set(u8.subarray(ovOff + 4, ovOff + 4 + chunkLen), written);
      written += chunkLen;
    }
    return result;
  };

  const decodeRecord = (payload: Uint8Array): unknown[] => {
    const { value: hdrSizeBig, next: stStart } = readSqliteVarint(payload, 0);
    const hdrSize = Number(hdrSizeBig);
    const serials: number[] = [];
    let pos = stStart;
    while (pos < hdrSize && pos < payload.length) {
      const st = readSqliteVarint(payload, pos);
      serials.push(Number(st.value));
      pos = st.next;
    }
    const vals: unknown[] = [];
    let dataPos = hdrSize;
    const payloadDv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    for (const st of serials) {
      if (st === 0) vals.push(null);
      else if (st === 1) {
        vals.push(readSignedIntBE(payload, dataPos, 1));
        dataPos += 1;
      } else if (st === 2) {
        vals.push(readSignedIntBE(payload, dataPos, 2));
        dataPos += 2;
      } else if (st === 3) {
        vals.push(readSignedIntBE(payload, dataPos, 3));
        dataPos += 3;
      } else if (st === 4) {
        vals.push(readSignedIntBE(payload, dataPos, 4));
        dataPos += 4;
      } else if (st === 5) {
        vals.push(readSignedIntBE(payload, dataPos, 6));
        dataPos += 6;
      } else if (st === 6) {
        vals.push(readSignedIntBE(payload, dataPos, 8));
        dataPos += 8;
      } else if (st === 7) {
        vals.push(payloadDv.getFloat64(dataPos, false));
        dataPos += 8;
      } else if (st === 8) vals.push(0);
      else if (st === 9) vals.push(1);
      else if (st >= 12 && st % 2 === 0) {
        const len = (st - 12) / 2;
        vals.push(`<Blob ${len} B>`);
        dataPos += len;
      } else if (st >= 13 && st % 2 === 1) {
        const len = (st - 13) / 2;
        vals.push(decodeSqliteText(payload.subarray(dataPos, dataPos + len), encoding));
        dataPos += len;
      } else {
        vals.push(null);
      }
    }
    return vals;
  };

  const readTableBTree = (rootPage: number, rowCap = 50_000): { rowId: number; values: unknown[] }[] => {
    const out: { rowId: number; values: unknown[] }[] = [];
    const stack = [rootPage];
    const seen = new Set<number>();
    while (stack.length > 0 && out.length < rowCap) {
      const pageNum = stack.pop()!;
      if (pageNum < 1 || pageNum > totalPages || seen.has(pageNum)) continue;
      seen.add(pageNum);
      const base = (pageNum - 1) * pageSize;
      const hdr = pageNum === 1 ? base + 100 : base;
      const pageType = u8[hdr];
      const cellCount = dv.getUint16(hdr + 3, false);

      if (pageType === 0x0d) {
        const ptrBase = hdr + 8;
        for (let i = 0; i < cellCount && out.length < rowCap; i++) {
          const cellOff = base + dv.getUint16(ptrBase + i * 2, false);
          const pSize = readSqliteVarint(u8, cellOff);
          const rId = readSqliteVarint(u8, pSize.next);
          const payload = extractPayload(rId.next, Number(pSize.value));
          out.push({ rowId: Number(rId.value), values: decodeRecord(payload) });
        }
      } else if (pageType === 0x05) {
        const rightChild = dv.getUint32(hdr + 8, false);
        const ptrBase = hdr + 12;
        const children: number[] = [];
        for (let i = 0; i < cellCount; i++) {
          const cellOff = base + dv.getUint16(ptrBase + i * 2, false);
          children.push(dv.getUint32(cellOff, false));
        }
        children.push(rightChild);
        for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
      }
    }
    return out;
  };

  const masterRows = readTableBTree(1);
  const tables: DataTable[] = [];
  for (const r of masterRows) {
    const [type, name, , rootPageRaw, sqlRaw] = r.values;
    if (type !== "table" || typeof name !== "string" || name.startsWith("sqlite_")) continue;
    const rootPage = Number(rootPageRaw);
    const sql = typeof sqlRaw === "string" ? sqlRaw : "";
    let columns = sql ? parseCreateTableColumns(sql) : [];
    const rawRows = rootPage > 0 ? readTableBTree(rootPage) : [];
    const ipkIdx = columns.findIndex((c) => new RegExp(`["\`\\[]?${c.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["\`\\]]?\\s+INTEGER\\s+PRIMARY\\s+KEY`, "i").test(sql));

    const maxCols = Math.max(columns.length, ...rawRows.slice(0, 20).map((row) => row.values.length));
    if (columns.length < maxCols) {
      columns = [
        ...columns,
        ...Array.from({ length: maxCols - columns.length }, (_, i) => ({ name: `col_${columns.length + i + 1}`, type: "ANY" })),
      ];
    }

    const rows: DataRow[] = rawRows.map(({ rowId, values }) => {
      const obj: DataRow = {};
      columns.forEach((c, idx) => {
        const val = idx < values.length ? values[idx] : null;
        obj[c.name] = idx === ipkIdx && val === null ? rowId : val;
      });
      return obj;
    });

    tables.push({ name, columns, rows, sql });
  }
  if (tables.length === 0) throw new Error("Database opened, but no user tables were found.");
  return tables;
}

/* ========================================================================
 * PURE-TS APACHE PARQUET READER (Thrift Compact + Uncompressed/Gzip/Snappy)
 * ======================================================================== */

function snappyDecompress(src: Uint8Array): Uint8Array {
  let pos = 0;
  let uncompLen = 0;
  let shift = 0;
  while (pos < src.length) {
    const b = src[pos++];
    uncompLen |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) break;
    shift += 7;
  }
  const out = new Uint8Array(uncompLen);
  let op = 0;
  while (pos < src.length && op < uncompLen) {
    const tag = src[pos++];
    const kind = tag & 0x03;
    if (kind === 0) {
      let len = (tag >> 2) + 1;
      if (len === 61) len = src[pos++] + 1;
      else if (len === 62) {
        len = (src[pos] | (src[pos + 1] << 8)) + 1;
        pos += 2;
      } else if (len === 63) {
        len = (src[pos] | (src[pos + 1] << 8) | (src[pos + 2] << 16)) + 1;
        pos += 3;
      } else if (len === 64) {
        len = ((src[pos] | (src[pos + 1] << 8) | (src[pos + 2] << 16) | (src[pos + 3] << 24)) >>> 0) + 1;
        pos += 4;
      }
      out.set(src.subarray(pos, pos + len), op);
      pos += len;
      op += len;
    } else {
      let len: number;
      let offset: number;
      if (kind === 1) {
        len = ((tag >> 2) & 0x07) + 4;
        offset = ((tag & 0xe0) << 3) | src[pos++];
      } else if (kind === 2) {
        len = (tag >> 2) + 1;
        offset = src[pos] | (src[pos + 1] << 8);
        pos += 2;
      } else {
        len = (tag >> 2) + 1;
        offset = (src[pos] | (src[pos + 1] << 8) | (src[pos + 2] << 16) | (src[pos + 3] << 24)) >>> 0;
        pos += 4;
      }
      if (offset === 0 || offset > op) throw new Error("Corrupt Snappy stream in Parquet page.");
      for (let i = 0; i < len && op < uncompLen; i++) {
        out[op] = out[op - offset];
        op++;
      }
    }
  }
  return out;
}

class ThriftCompactReader {
  pos = 0;
  constructor(private readonly u8: Uint8Array) {}
  readVarintBig(): bigint {
    let res = BI_0;
    let shift = BI_0;
    while (this.pos < this.u8.length) {
      const b = this.u8[this.pos++];
      res |= BigInt(b & 0x7f) << shift;
      if ((b & 0x80) === 0) break;
      shift += BI_7;
    }
    return res;
  }
  readVarint(): number {
    return Number(this.readVarintBig());
  }
  readZigZag(): number {
    const n = this.readVarint();
    return (n >>> 1) ^ -(n & 1);
  }
  readZigZagBig(): bigint {
    const n = this.readVarintBig();
    return (n >> BI_1) ^ -(n & BI_1);
  }
  readBinary(): Uint8Array {
    const len = this.readVarint();
    const slice = this.u8.subarray(this.pos, this.pos + len);
    this.pos += len;
    return slice;
  }
  readString(): string {
    return utf8Decoder.decode(this.readBinary());
  }
  readStruct(): Record<number, unknown> {
    const fields: Record<number, unknown> = {};
    let lastId = 0;
    while (this.pos < this.u8.length) {
      const b = this.u8[this.pos++];
      if (b === 0) break;
      const delta = (b >> 4) & 0x0f;
      const type = b & 0x0f;
      const id = delta === 0 ? this.readZigZag() : lastId + delta;
      lastId = id;
      fields[id] = this.readValue(type);
    }
    return fields;
  }
  readValue(type: number): unknown {
    switch (type) {
      case 1:
        return true;
      case 2:
        return false;
      case 3:
        return (this.u8[this.pos++] << 24) >> 24;
      case 4:
      case 5:
        return this.readZigZag();
      case 6: {
        const v = this.readZigZagBig();
        return v <= BigInt(Number.MAX_SAFE_INTEGER) && v >= BigInt(Number.MIN_SAFE_INTEGER) ? Number(v) : v.toString();
      }
      case 7: {
        const dv = new DataView(this.u8.buffer, this.u8.byteOffset + this.pos, 8);
        this.pos += 8;
        return dv.getFloat64(0, true);
      }
      case 8:
        return this.readString();
      case 9:
      case 10: {
        const hdr = this.u8[this.pos++];
        let count = (hdr >> 4) & 0x0f;
        const elemType = hdr & 0x0f;
        if (count === 15) count = this.readVarint();
        const arr: unknown[] = [];
        for (let i = 0; i < count; i++) arr.push(this.readValue(elemType === 1 || elemType === 2 ? elemType : elemType));
        return arr;
      }
      case 11: {
        const count = this.readVarint();
        if (count === 0) return [];
        const kv = this.u8[this.pos++];
        const kt = (kv >> 4) & 0x0f;
        const vt = kv & 0x0f;
        const entries: [unknown, unknown][] = [];
        for (let i = 0; i < count; i++) entries.push([this.readValue(kt), this.readValue(vt)]);
        return entries;
      }
      case 12:
        return this.readStruct();
      case 13:
        this.pos += 16;
        return null;
      default:
        throw new Error(`Unsupported Thrift Compact type ${type}`);
    }
  }
}

function readRleBitPacked(bytes: Uint8Array, bitWidth: number, count: number): number[] {
  const out: number[] = [];
  if (bitWidth === 0) {
    for (let i = 0; i < count; i++) out.push(0);
    return out;
  }
  let pos = 0;
  const mask = (1 << bitWidth) - 1;
  while (out.length < count && pos < bytes.length) {
    let hdr = 0;
    let shift = 0;
    while (pos < bytes.length) {
      const b = bytes[pos++];
      hdr |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) break;
      shift += 7;
    }
    if ((hdr & 1) === 0) {
      const runLen = hdr >> 1;
      const byteCount = Math.ceil(bitWidth / 8);
      let val = 0;
      for (let i = 0; i < byteCount; i++) val |= (bytes[pos++] ?? 0) << (8 * i);
      for (let i = 0; i < runLen && out.length < count; i++) out.push(val);
    } else {
      const groups = hdr >> 1;
      const total = groups * 8;
      let bitBuf = 0;
      let bits = 0;
      for (let i = 0; i < total; i++) {
        while (bits < bitWidth && pos < bytes.length) {
          bitBuf |= bytes[pos++] << bits;
          bits += 8;
        }
        const val = bitBuf & mask;
        bitBuf >>>= bitWidth;
        bits -= bitWidth;
        if (out.length < count) out.push(val);
      }
    }
  }
  return out;
}

function readPlainParquetValues(bytes: Uint8Array, physType: number, count: number): unknown[] {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: unknown[] = [];
  let pos = 0;
  for (let i = 0; i < count && pos < bytes.length; i++) {
    switch (physType) {
      case 0: // BOOLEAN (bit-packed)
        out.push(Boolean((bytes[Math.floor(i / 8)] >> (i % 8)) & 1));
        break;
      case 1: // INT32
        out.push(dv.getInt32(pos, true));
        pos += 4;
        break;
      case 2: {
        // INT64
        const lo = BigInt(dv.getUint32(pos, true));
        const hi = BigInt(dv.getInt32(pos + 4, true));
        const val = (hi << BI_32) | lo;
        out.push(val <= BigInt(Number.MAX_SAFE_INTEGER) && val >= BigInt(Number.MIN_SAFE_INTEGER) ? Number(val) : val.toString());
        pos += 8;
        break;
      }
      case 4: // FLOAT
        out.push(Math.round(dv.getFloat32(pos, true) * 1e6) / 1e6);
        pos += 4;
        break;
      case 5: // DOUBLE
        out.push(dv.getFloat64(pos, true));
        pos += 8;
        break;
      case 6: {
        // BYTE_ARRAY (4-byte LE len + bytes)
        const len = dv.getUint32(pos, true);
        pos += 4;
        out.push(utf8Decoder.decode(bytes.subarray(pos, pos + len)));
        pos += len;
        break;
      }
      default:
        out.push(null);
        break;
    }
  }
  return out;
}

const PARQUET_TYPE_NAMES: Record<number, string> = {
  0: "BOOLEAN",
  1: "INT32",
  2: "INT64",
  3: "INT96",
  4: "FLOAT",
  5: "DOUBLE",
  6: "UTF8/BYTES",
  7: "FIXED_BYTES",
};

export function parseParquetBuffer(buf: ArrayBuffer): { table: DataTable; warnings: string[] } {
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  if (u8.length < 12 || utf8Decoder.decode(u8.subarray(0, 4)) !== "PAR1" || utf8Decoder.decode(u8.subarray(u8.length - 4)) !== "PAR1") {
    throw new Error("Not a valid Apache Parquet file (missing PAR1 header/footer).");
  }
  const footerLen = dv.getUint32(u8.length - 8, true);
  const footerStart = u8.length - 8 - footerLen;
  if (footerStart < 4) throw new Error("Corrupt Parquet footer size.");
  const meta = new ThriftCompactReader(u8.subarray(footerStart, u8.length - 8)).readStruct();
  const schemaElems = (meta[2] as Record<number, unknown>[]) ?? [];
  const leafCols: { name: string; physType: number; maxDef: number }[] = [];
  for (let i = 1; i < schemaElems.length; i++) {
    const el = schemaElems[i];
    if (el[5] === undefined && el[1] !== undefined) {
      const rep = Number(el[3] ?? 1);
      leafCols.push({
        name: String(el[4] ?? `col_${leafCols.length + 1}`),
        physType: Number(el[1]),
        maxDef: rep === 0 ? 0 : 1,
      });
    }
  }

  const rowGroups = (meta[4] as Record<number, unknown>[]) ?? [];
  const rows: DataRow[] = [];
  const warnings: string[] = [];
  const decompress = (bytes: Uint8Array, codec: number): Uint8Array => {
    if (codec === 0) return bytes;
    if (codec === 1) return snappyDecompress(bytes);
    if (codec === 2) return gunzipSync(bytes);
    throw new Error(`Parquet compression codec ${codec} is not supported in browser (supports Uncompressed, Snappy, Gzip).`);
  };

  for (const rg of rowGroups) {
    const colChunks = (rg[1] as Record<number, unknown>[]) ?? [];
    const rgNumRows = Number(rg[3] ?? 0);
    const colValues: unknown[][] = [];

    for (let ci = 0; ci < colChunks.length; ci++) {
      const chunkMeta = (colChunks[ci][3] as Record<number, unknown>) ?? {};
      const physType = Number(chunkMeta[1] ?? leafCols[ci]?.physType ?? 6);
      const codec = Number(chunkMeta[4] ?? 0);
      const totalComp = Number(chunkMeta[7] ?? 0);
      const dataOff = Number(chunkMeta[9] ?? 0);
      const dictOff = chunkMeta[11] !== undefined ? Number(chunkMeta[11]) : null;
      const startOff = dictOff !== null ? Math.min(dictOff, dataOff) : dataOff;
      const chunkEnd = Math.min(u8.length - 8 - footerLen, startOff + totalComp);

      let pos = startOff;
      let dictionary: unknown[] = [];
      const values: unknown[] = [];
      const maxDef = leafCols[ci]?.maxDef ?? 1;

      try {
        while (pos < chunkEnd && values.length < rgNumRows) {
          const hdrReader = new ThriftCompactReader(u8.subarray(pos, chunkEnd));
          const pageHdr = hdrReader.readStruct();
          pos += hdrReader.pos;
          const pageType = Number(pageHdr[1] ?? 0);
          const uncompSize = Number(pageHdr[2] ?? 0);
          const compSize = Number(pageHdr[3] ?? 0);
          const compBytes = u8.subarray(pos, pos + compSize);
          pos += compSize;
          const rawPage = decompress(compBytes, codec).subarray(0, uncompSize);

          if (pageType === 2) {
            const dHdr = (pageHdr[7] as Record<number, unknown>) ?? {};
            const dictCount = Number(dHdr[1] ?? 0);
            dictionary = readPlainParquetValues(rawPage, physType, dictCount);
          } else if (pageType === 0) {
            const dHdr = (pageHdr[5] as Record<number, unknown>) ?? {};
            const numVals = Number(dHdr[1] ?? 0);
            const enc = Number(dHdr[2] ?? 0);
            let p = 0;
            let defs: number[] | null = null;
            if (maxDef > 0) {
              const defLen = new DataView(rawPage.buffer, rawPage.byteOffset + p, 4).getUint32(0, true);
              p += 4;
              defs = readRleBitPacked(rawPage.subarray(p, p + defLen), 1, numVals);
              p += defLen;
            }
            const nonNullCount = defs ? defs.filter((d) => d === 1).length : numVals;
            let decoded: unknown[] = [];
            if (enc === 8 || enc === 2) {
              const bw = rawPage[p++];
              const idxs = readRleBitPacked(rawPage.subarray(p), bw, nonNullCount);
              decoded = idxs.map((idx) => dictionary[idx] ?? null);
            } else {
              decoded = readPlainParquetValues(rawPage.subarray(p), physType, nonNullCount);
            }
            let di = 0;
            for (let k = 0; k < numVals && values.length < rgNumRows; k++) {
              if (!defs || defs[k] === 1) values.push(decoded[di++] ?? null);
              else values.push(null);
            }
          } else {
            warnings.push(`Skipped Parquet v2/index page type ${pageType} on "${leafCols[ci]?.name ?? ci}".`);
          }
        }
      } catch (e) {
        warnings.push(`Column "${leafCols[ci]?.name ?? ci}": ${e instanceof Error ? e.message : "decode error"}`);
      }
      colValues.push(values);
    }

    for (let r = 0; r < rgNumRows && rows.length < 25_000; r++) {
      const obj: DataRow = {};
      leafCols.forEach((col, ci) => {
        obj[col.name] = colValues[ci]?.[r] ?? null;
      });
      rows.push(obj);
    }
  }

  return {
    table: {
      name: "parquet_data",
      columns: leafCols.map((c) => ({ name: c.name, type: PARQUET_TYPE_NAMES[c.physType] ?? "UNKNOWN" })),
      rows,
    },
    warnings,
  };
}

/* ========================================================================
 * CSV / TSV / JSON LOADER
 * ======================================================================== */

function inferColumnType(values: unknown[]): string {
  const sample = values.filter((v) => v !== null && v !== undefined && v !== "").slice(0, 50);
  if (sample.length === 0) return "TEXT";
  if (sample.every((v) => typeof v === "boolean" || v === "true" || v === "false")) return "BOOLEAN";
  if (sample.every((v) => typeof v === "number" || /^-?\d+$/.test(String(v).trim()))) return "INTEGER";
  if (sample.every((v) => typeof v === "number" || /^-?\d+(?:\.\d+)?$/.test(String(v).trim()))) return "REAL";
  return "TEXT";
}

function coerceCell(raw: string): unknown {
  const t = raw.trim();
  if (t === "") return null;
  if (t === "true") return true;
  if (t === "false") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(t) && !/^-?0\d/.test(t) && Number.isFinite(Number(t))) return Number(t);
  return raw;
}

export async function parseUploadedDataFile(file: File): Promise<LoadedDataset> {
  const lower = file.name.toLowerCase();
  const baseName = file.name.replace(/\.[^.]+$/, "").replace(/[^\w]+/g, "_") || "table_1";

  if (lower.endsWith(".sqlite") || lower.endsWith(".sqlite3") || lower.endsWith(".db")) {
    const buf = await file.arrayBuffer();
    return {
      fileName: file.name,
      format: "SQLite",
      sizeBytes: file.size,
      tables: parseSqliteBuffer(buf),
    };
  }

  if (lower.endsWith(".parquet")) {
    const buf = await file.arrayBuffer();
    const { table, warnings } = parseParquetBuffer(buf);
    table.name = baseName;
    return {
      fileName: file.name,
      format: "Parquet",
      sizeBytes: file.size,
      tables: [table],
      warnings: warnings.length ? [...new Set(warnings)] : undefined,
    };
  }

  const text = (await file.text()).replace(/^\uFEFF/, "");
  if (lower.endsWith(".json") || lower.endsWith(".ndjson") || lower.endsWith(".jsonl")) {
    let items: unknown[] = [];
    if (lower.endsWith(".ndjson") || lower.endsWith(".jsonl")) {
      items = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => JSON.parse(l));
    } else {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) items = parsed;
      else if (parsed && typeof parsed === "object") {
        const firstArr = Object.values(parsed as Record<string, unknown>).find((v) => Array.isArray(v));
        items = Array.isArray(firstArr) ? firstArr : [parsed];
      }
    }
    const rows: DataRow[] = items.map((item) =>
      item && typeof item === "object" && !Array.isArray(item) ? (item as DataRow) : { value: item },
    );
    const colNames = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    const columns: DataColumn[] = colNames.map((name) => ({
      name,
      type: inferColumnType(rows.map((r) => r[name])),
    }));
    return {
      fileName: file.name,
      format: lower.endsWith(".json") ? "JSON" : "NDJSON",
      sizeBytes: file.size,
      tables: [{ name: baseName, columns, rows }],
    };
  }

  // CSV / TSV
  const delim = lower.endsWith(".tsv") ? "\t" : ",";
  const firstLine = text.split(/\r?\n/).find((l) => l.trim()) ?? "";
  const actualDelim = lower.endsWith(".tsv")
    ? "\t"
    : [",", ";", "\t", "|"].reduce((best, d) => (firstLine.split(d).length > firstLine.split(best).length ? d : best), delim);
  const grid = parseCsvRows(text, actualDelim);
  if (grid.length === 0) throw new Error("This file appears to be empty.");
  const colNames = grid[0].map((c, idx) => c.trim() || `column_${idx + 1}`);
  const rows: DataRow[] = grid.slice(1).map((r) => {
    const obj: DataRow = {};
    colNames.forEach((c, idx) => {
      obj[c] = idx < r.length ? coerceCell(r[idx]) : null;
    });
    return obj;
  });
  const columns: DataColumn[] = colNames.map((name) => ({
    name,
    type: inferColumnType(rows.map((r) => r[name])),
  }));
  return {
    fileName: file.name,
    format: lower.endsWith(".tsv") ? "TSV" : "CSV",
    sizeBytes: file.size,
    tables: [{ name: baseName, columns, rows }],
  };
}

/* ========================================================================
 * CLIENT-SIDE SQL QUERY EVALUATOR (SELECT / WHERE / GROUP BY / ORDER / LIMIT)
 * ======================================================================== */

function parseSqlLiteral(tok: string): unknown {
  const t = tok.trim();
  if (/^NULL$/i.test(t)) return null;
  if (/^TRUE$/i.test(t)) return true;
  if (/^FALSE$/i.test(t)) return false;
  if ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"'))) {
    return t.slice(1, -1).replace(/''/g, "'");
  }
  if (/^-?\d+(?:\.\d+)?$/.test(t)) return Number(t);
  return t;
}

function likeToRegex(pattern: string, caseInsensitive: boolean): RegExp {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".");
  return new RegExp(`^${escaped}$`, caseInsensitive ? "i" : "");
}

function evalWhereClause(row: DataRow, whereRaw: string): boolean {
  const orParts = whereRaw.split(/\s+OR\s+/i);
  return orParts.some((orPart) => {
    const andParts = orPart.split(/\s+AND\s+/i);
    return andParts.every((condRaw) => {
      const cond = condRaw.trim().replace(/^\(|\)$/g, "");
      const mNull = /^([`"\[]?[\w.-]+[`"\]]?)\s+IS\s+(NOT\s+)?NULL$/i.exec(cond);
      if (mNull) {
        const key = mNull[1].replace(/[`"\[\]]/g, "");
        const isNull = row[key] === null || row[key] === undefined || row[key] === "";
        return mNull[2] ? !isNull : isNull;
      }
      const mIn = /^([`"\[]?[\w.-]+[`"\]]?)\s+(NOT\s+)?IN\s*\(([^)]+)\)$/i.exec(cond);
      if (mIn) {
        const key = mIn[1].replace(/[`"\[\]]/g, "");
        const items = mIn[3].split(",").map(parseSqlLiteral);
        const hit = items.some((x) => String(row[key] ?? "") === String(x ?? ""));
        return mIn[2] ? !hit : hit;
      }
      const mLike = /^([`"\[]?[\w.-]+[`"\]]?)\s+(NOT\s+)?(ILIKE|LIKE)\s+(.+)$/i.exec(cond);
      if (mLike) {
        const key = mLike[1].replace(/[`"\[\]]/g, "");
        const pat = String(parseSqlLiteral(mLike[4]) ?? "");
        const rx = likeToRegex(pat, true);
        const hit = rx.test(String(row[key] ?? ""));
        return mLike[2] ? !hit : hit;
      }
      const mOp = /^([`"\[]?[\w.-]+[`"\]]?)\s*(!=|<>|<=|>=|=|<|>)\s*(.+)$/.exec(cond);
      if (!mOp) return true;
      const key = mOp[1].replace(/[`"\[\]]/g, "");
      const op = mOp[2];
      const rhs = parseSqlLiteral(mOp[3]);
      const lhs = row[key];
      if (op === "=" || op === "!=" || op === "<>") {
        const eq =
          typeof lhs === "number" && typeof rhs === "number"
            ? lhs === rhs
            : String(lhs ?? "").toLowerCase() === String(rhs ?? "").toLowerCase();
        return op === "=" ? eq : !eq;
      }
      const ln = Number(lhs);
      const rn = Number(rhs);
      if (!Number.isNaN(ln) && !Number.isNaN(rn) && lhs !== null && lhs !== "") {
        if (op === "<") return ln < rn;
        if (op === "<=") return ln <= rn;
        if (op === ">") return ln > rn;
        if (op === ">=") return ln >= rn;
      }
      const ls = String(lhs ?? "");
      const rs = String(rhs ?? "");
      if (op === "<") return ls < rs;
      if (op === "<=") return ls <= rs;
      if (op === ">") return ls > rs;
      if (op === ">=") return ls >= rs;
      return true;
    });
  });
}

export function executeLocalSql(
  rawSql: string,
  tables: DataTable[],
  defaultTable: string,
): { columns: string[]; rows: DataRow[]; elapsedMs: number } {
  const t0 = typeof performance !== "undefined" ? performance.now() : 0;
  const sql = rawSql.trim().replace(/;+\s*$/, "");
  if (!sql) throw new Error("Enter a SELECT query to run.");

  const m = /^SELECT\s+([\s\S]+?)\s+FROM\s+([`"\[]?[\w.-]+[`"\]]?)(?:\s+WHERE\s+([\s\S]+?))?(?:\s+GROUP\s+BY\s+([\s\S]+?))?(?:\s+ORDER\s+BY\s+([\s\S]+?))?(?:\s+LIMIT\s+(\d+)(?:\s+OFFSET\s+(\d+))?)?$/i.exec(
    sql,
  );
  if (!m) {
    throw new Error("Supports standard SELECT ... FROM table [WHERE ...] [GROUP BY ...] [ORDER BY ...] [LIMIT n] queries.");
  }

  const selectRaw = m[1].trim();
  const tableName = (m[2] ?? defaultTable).replace(/[`"\[\]]/g, "");
  const whereRaw = m[3]?.trim();
  const groupRaw = m[4]?.trim();
  const orderRaw = m[5]?.trim();
  const limit = m[6] ? Number(m[6]) : undefined;
  const offset = m[7] ? Number(m[7]) : 0;

  const table = tables.find((t) => t.name.toLowerCase() === tableName.toLowerCase());
  if (!table) {
    throw new Error(`Table "${tableName}" not found. Available: ${tables.map((t) => t.name).join(", ")}.`);
  }

  let working = table.rows;
  if (whereRaw) {
    working = working.filter((r) => evalWhereClause(r, whereRaw));
  }

  const selectItems = selectRaw.split(",").map((s) => s.trim()).filter(Boolean);
  const hasAgg = selectItems.some((s) => /^(COUNT|SUM|AVG|MIN|MAX)\s*\(/i.test(s));

  let projected: DataRow[] = [];
  let cols: string[] = [];

  if (groupRaw || hasAgg) {
    const groupCols = groupRaw ? groupRaw.split(",").map((s) => s.trim().replace(/[`"\[\]]/g, "")) : [];
    const groups = new Map<string, DataRow[]>();
    for (const r of working) {
      const k = groupCols.length ? JSON.stringify(groupCols.map((c) => r[c] ?? null)) : "__all__";
      const arr = groups.get(k);
      if (arr) arr.push(r);
      else groups.set(k, [r]);
    }
    if (groups.size === 0 && !groupRaw) groups.set("__all__", []);

    for (const [, groupRows] of groups) {
      const outRow: DataRow = {};
      for (const item of selectItems) {
        const asMatch = /^([\s\S]+?)\s+AS\s+([`"\[]?[\w.-]+[`"\]]?)$/i.exec(item);
        const expr = (asMatch ? asMatch[1] : item).trim();
        const aggMatch = /^(COUNT|SUM|AVG|MIN|MAX)\s*\(\s*([^)]+)\s*\)$/i.exec(expr);
        const label = (asMatch ? asMatch[2] : item).replace(/[`"\[\]]/g, "");
        if (aggMatch) {
          const fn = aggMatch[1].toUpperCase();
          const arg = aggMatch[2].trim().replace(/[`"\[\]]/g, "");
          if (fn === "COUNT") {
            outRow[label] = arg === "*" ? groupRows.length : groupRows.filter((r) => r[arg] !== null && r[arg] !== undefined).length;
          } else {
            const nums = groupRows.map((r) => Number(r[arg])).filter((n) => Number.isFinite(n));
            if (fn === "SUM") outRow[label] = nums.reduce((a, b) => a + b, 0);
            else if (fn === "AVG") outRow[label] = nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100 : null;
            else if (fn === "MIN") outRow[label] = nums.length ? Math.min(...nums) : null;
            else if (fn === "MAX") outRow[label] = nums.length ? Math.max(...nums) : null;
          }
        } else {
          const colKey = expr.replace(/[`"\[\]]/g, "");
          outRow[label] = groupRows[0]?.[colKey] ?? null;
        }
      }
      projected.push(outRow);
    }
    cols = selectItems.map((item) => {
      const asMatch = /^[\s\S]+?\s+AS\s+([`"\[]?[\w.-]+[`"\]]?)$/i.exec(item);
      return (asMatch ? asMatch[1] : item).replace(/[`"\[\]]/g, "");
    });
  } else if (selectRaw === "*") {
    cols = table.columns.map((c) => c.name);
    projected = working;
  } else {
    const mappings = selectItems.map((item) => {
      const asMatch = /^([\s\S]+?)\s+AS\s+([`"\[]?[\w.-]+[`"\]]?)$/i.exec(item);
      const src = (asMatch ? asMatch[1] : item).replace(/[`"\[\]]/g, "");
      const dest = (asMatch ? asMatch[2] : src).replace(/[`"\[\]]/g, "");
      return { src, dest };
    });
    cols = mappings.map((x) => x.dest);
    projected = working.map((r) => {
      const obj: DataRow = {};
      for (const mp of mappings) obj[mp.dest] = r[mp.src] ?? null;
      return obj;
    });
  }

  if (orderRaw) {
    const orderSpecs = orderRaw.split(",").map((s) => {
      const [c, dir] = s.trim().split(/\s+/);
      return { col: c.replace(/[`"\[\]]/g, ""), desc: /^DESC$/i.test(dir ?? "") };
    });
    projected = [...projected].sort((a, b) => {
      for (const spec of orderSpecs) {
        const av = a[spec.col];
        const bv = b[spec.col];
        if (av === bv) continue;
        if (av === null || av === undefined) return 1;
        if (bv === null || bv === undefined) return -1;
        const cmp =
          typeof av === "number" && typeof bv === "number"
            ? av - bv
            : String(av).localeCompare(String(bv), undefined, { numeric: true });
        if (cmp !== 0) return spec.desc ? -cmp : cmp;
      }
      return 0;
    });
  }

  if (offset > 0 || limit !== undefined) {
    projected = projected.slice(offset, limit !== undefined ? offset + limit : undefined);
  }

  const elapsedMs = Math.max(0.1, Math.round(((typeof performance !== "undefined" ? performance.now() : 0) - t0) * 10) / 10);
  return { columns: cols, rows: projected, elapsedMs };
}

/* ========================================================================
 * REACT COMPONENT
 * ======================================================================== */

const formatCell = (v: unknown): string => {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
};

export function DataViewerEngine({ preset }: EngineProps) {
  const [dataset, setDataset] = useState<LoadedDataset>(SAMPLE_DATASET);
  const [tableIdx, setTableIdx] = useState(0);
  const [viewTab, setViewTab] = useState<"browse" | "sql" | "schema">(() => (preset.tab === "sql" ? "sql" : "browse"));
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ col: string; desc: boolean } | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sqlText, setSqlText] = useState("SELECT category, COUNT(*) AS orders, SUM(amount_inr) AS total_inr\nFROM orders\nGROUP BY category\nORDER BY total_inr DESC;");
  const [sqlResult, setSqlResult] = useState<{ columns: string[]; rows: DataRow[]; elapsedMs: number } | null>(null);
  const [sqlError, setSqlError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const table = dataset.tables[tableIdx] ?? dataset.tables[0];

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setLoadError(null);
    try {
      const loaded = await parseUploadedDataFile(file);
      setDataset(loaded);
      setTableIdx(0);
      setSearch("");
      setSort(null);
      setPage(0);
      setSqlResult(null);
      setSqlError(null);
      const firstTable = loaded.tables[0]?.name ?? "table_1";
      setSqlText(`SELECT * FROM ${firstTable} LIMIT 50;`);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not read that file.");
    }
  };

  const runSql = (query = sqlText) => {
    setSqlError(null);
    try {
      const res = executeLocalSql(query, dataset.tables, table.name);
      setSqlResult(res);
    } catch (e) {
      setSqlResult(null);
      setSqlError(e instanceof Error ? e.message : "SQL error");
    }
  };

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = table.rows;
    if (q) {
      rows = rows.filter((r) => table.columns.some((c) => formatCell(r[c.name]).toLowerCase().includes(q)));
    }
    if (sort) {
      rows = [...rows].sort((a, b) => {
        const av = a[sort.col];
        const bv = b[sort.col];
        if (av === bv) return 0;
        if (av === null || av === undefined) return 1;
        if (bv === null || bv === undefined) return -1;
        const cmp =
          typeof av === "number" && typeof bv === "number"
            ? av - bv
            : String(av).localeCompare(String(bv), undefined, { numeric: true });
        return sort.desc ? -cmp : cmp;
      });
    }
    return rows;
  }, [table, search, sort]);

  const activeRows = viewTab === "sql" && sqlResult ? sqlResult.rows : filteredRows;
  const activeCols = viewTab === "sql" && sqlResult ? sqlResult.columns : table.columns.map((c) => c.name);
  const pageCount = Math.max(1, Math.ceil(activeRows.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const visibleRows = activeRows.slice(safePage * pageSize, (safePage + 1) * pageSize);

  const exportCsv = () => {
    const esc = (v: unknown) => {
      const s = v === null || v === undefined ? "" : String(v);
      return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [activeCols.map(esc).join(","), ...activeRows.map((r) => activeCols.map((c) => esc(r[c])).join(","))].join("\n");
    saveBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), `${table.name}.csv`);
  };

  const exportJson = () => {
    const json = JSON.stringify(activeRows, null, 2);
    saveBlob(new Blob([json], { type: "application/json;charset=utf-8" }), `${table.name}.json`);
  };

  const markdownTable = useMemo(() => {
    const head = `| ${activeCols.join(" | ")} |`;
    const sep = `| ${activeCols.map(() => "---").join(" | ")} |`;
    const body = visibleRows.slice(0, 50).map((r) => `| ${activeCols.map((c) => formatCell(r[c]).replace(/\|/g, "\\|")).join(" | ")} |`);
    return [head, sep, ...body].join("\n");
  }, [activeCols, visibleRows]);

  return (
    <>
      {/* Local file drop zone */}
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void handleFile(e.dataTransfer.files?.[0]);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-between gap-3 rounded-md border border-dashed px-4 py-4 transition-colors sm:flex-row",
          dragOver ? "border-ink bg-surface" : "border-ink-3/50 bg-paper hover:border-ink-3 hover:bg-paper-2/40",
        )}
      >
        <input
          type="file"
          accept=".sqlite,.sqlite3,.db,.csv,.tsv,.parquet,.json,.ndjson,.jsonl"
          className="sr-only"
          onChange={(e) => void handleFile(e.target.files?.[0])}
        />
        <div className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-md border border-line bg-surface text-ink">
            <Database aria-hidden className="size-5" />
          </span>
          <div>
            <p className="text-sm font-medium text-ink">
              Drop a local <span className="font-mono text-[13px]">.sqlite / .db / .csv / .parquet / .json</span> file
            </p>
            <p className="text-xs text-ink-3">
              Loaded: <strong className="font-medium text-ink-2">{dataset.fileName}</strong>
              {dataset.sizeBytes ? ` (${formatBytes(dataset.sizeBytes)})` : ""} · {dataset.tables.length} table
              {dataset.tables.length === 1 ? "" : "s"} · runs 100% locally in your browser
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="inline-flex h-8 items-center rounded-[8px] border border-line bg-surface px-3 text-[13px] font-medium text-ink">
            Choose file
          </span>
          {dataset.format !== "Sample" && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                setDataset(SAMPLE_DATASET);
                setTableIdx(0);
                setSqlResult(null);
                setPage(0);
              }}
              className="inline-flex h-8 items-center rounded-[8px] border border-line bg-paper px-3 text-[13px] text-ink-2 hover:text-ink"
            >
              Reset sample
            </button>
          )}
        </div>
      </label>

      {loadError && <Notice tone="danger">{loadError}</Notice>}
      {dataset.warnings && dataset.warnings.length > 0 && (
        <Notice tone="warning">{dataset.warnings.join(" ")}</Notice>
      )}

      {/* Table switcher & View mode */}
      <Panel>
        {dataset.tables.length > 1 && (
          <Row label="Tables">
            <div className="flex flex-wrap gap-1.5">
              {dataset.tables.map((t, idx) => (
                <button
                  key={t.name}
                  type="button"
                  onClick={() => (setTableIdx(idx), setSort(null), setPage(0), setSearch(""))}
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-[8px] border px-3 font-mono text-[12px] transition-colors",
                    idx === tableIdx ? "border-ink bg-ink text-paper" : "border-line bg-surface text-ink-2 hover:border-ink-3 hover:text-ink",
                  )}
                >
                  <Table2 aria-hidden className="size-3.5" />
                  {t.name}
                  <span className={cn("text-[12px]", idx === tableIdx ? "text-paper/75" : "text-ink-3")}>
                    ({t.rows.length})
                  </span>
                </button>
              ))}
            </div>
          </Row>
        )}
        <Row label="Mode">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Chips
              value={viewTab}
              onChange={(v) => (setViewTab(v), setPage(0))}
              options={[
                { value: "browse", label: `Rows (${filteredRows.length})` },
                { value: "sql", label: "SQL query" },
                { value: "schema", label: `Schema (${table.columns.length} cols)` },
              ]}
            />
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={exportCsv}
                className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-line bg-surface px-2.5 text-[12px] font-medium text-ink transition-colors hover:border-ink-3"
              >
                <Download aria-hidden className="size-3.5" /> CSV
              </button>
              <button
                type="button"
                onClick={exportJson}
                className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-line bg-surface px-2.5 text-[12px] font-medium text-ink transition-colors hover:border-ink-3"
              >
                <FileSpreadsheet aria-hidden className="size-3.5" /> JSON
              </button>
              <CopyButton text={markdownTable} label="Copy Markdown" />
            </div>
          </div>
        </Row>
      </Panel>

      {/* SQL Query runner */}
      {viewTab === "sql" && (
        <div className="space-y-3">
          <Editor
            value={sqlText}
            onChange={setSqlText}
            name="query.sql"
            rows={4}
            placeholder={`SELECT * FROM ${table.name} LIMIT 50;`}
            actions={
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    const q = `SELECT * FROM ${table.name} LIMIT 25;`;
                    setSqlText(q);
                    runSql(q);
                  }}
                  className="inline-flex h-7 items-center rounded-[6px] border border-line bg-surface px-2.5 font-mono text-[12px] text-ink-2 hover:text-ink"
                >
                  SELECT *
                </button>
                <button
                  type="button"
                  onClick={() => runSql(sqlText)}
                  className="inline-flex h-7 items-center gap-1 rounded-[6px] bg-ink px-3 text-[12px] font-medium text-paper hover:bg-ink/90"
                >
                  <Play aria-hidden className="size-3" /> Run SQL
                </button>
              </div>
            }
          />
          {sqlError && <Notice tone="danger">{sqlError}</Notice>}
          {sqlResult && (
            <p className="font-mono text-[12px] text-ink-3">
              Returned {sqlResult.rows.length} row{sqlResult.rows.length === 1 ? "" : "s"} in {sqlResult.elapsedMs} ms
            </p>
          )}
        </div>
      )}

      {/* Search bar in browse mode */}
      {viewTab === "browse" && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="relative min-w-0 flex-1 sm:max-w-sm">
            <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
            <input
              value={search}
              onChange={(e) => (setSearch(e.target.value), setPage(0))}
              placeholder={`Filter ${table.rows.length} rows in ${table.name}…`}
              aria-label="Filter rows"
              className="h-9 w-full rounded-[8px] border border-line bg-surface pl-9 pr-3 text-sm text-ink outline-none focus:border-ink"
            />
          </div>
          <div className="flex items-center gap-2 text-xs text-ink-3">
            <span>Per page</span>
            <Chips
              value={pageSize}
              onChange={(n) => (setPageSize(n), setPage(0))}
              options={[
                { value: 25, label: "25" },
                { value: 50, label: "50" },
                { value: 100, label: "100" },
              ]}
            />
          </div>
        </div>
      )}

      {/* Schema inspector */}
      {viewTab === "schema" ? (
        <div className="space-y-3">
          <div className="overflow-x-auto rounded-md border border-line bg-surface">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-line bg-paper font-mono text-[12px] uppercase tracking-wider text-ink-2">
                  <th className="px-4 py-2.5">#</th>
                  <th className="px-4 py-2.5">Column</th>
                  <th className="px-4 py-2.5">Type</th>
                  <th className="px-4 py-2.5">Non-null</th>
                  <th className="px-4 py-2.5">Sample value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60 text-sm">
                {table.columns.map((col, idx) => {
                  const nonNull = table.rows.filter((r) => r[col.name] !== null && r[col.name] !== undefined && r[col.name] !== "").length;
                  const sampleVal = table.rows.find((r) => r[col.name] !== null && r[col.name] !== undefined)?.[col.name];
                  return (
                    <tr key={col.name} className="hover:bg-paper/40">
                      <td className="px-4 py-2 font-mono text-[12px] text-ink-3">{idx + 1}</td>
                      <td className="px-4 py-2 font-mono text-[13px] font-medium text-ink">{col.name}</td>
                      <td className="px-4 py-2 font-mono text-[12px] text-accent">{col.type}</td>
                      <td className="px-4 py-2 font-mono text-[12px] text-ink-2">
                        {nonNull}/{table.rows.length}
                      </td>
                      <td className="max-w-xs truncate px-4 py-2 font-mono text-[12px] text-ink-3">{formatCell(sampleVal)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {table.sql && (
            <div className="overflow-hidden rounded-md border border-line bg-surface">
              <div className="flex items-center justify-between border-b border-line bg-paper px-3.5 py-2">
                <span className="label-mono text-ink-2">DDL statement</span>
                <CopyButton text={table.sql} />
              </div>
              <pre className="overflow-x-auto px-3.5 py-2.5 font-mono text-[13px] text-ink">{table.sql}</pre>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2.5">
          <div className="overflow-x-auto rounded-md border border-line bg-surface">
            <table className="w-full min-w-[480px] border-collapse text-left">
              <thead>
                <tr className="border-b border-line bg-paper text-[12px] text-ink-2">
                  <th className="w-12 px-3 py-2 font-mono text-ink-3">#</th>
                  {activeCols.map((col) => {
                    const isSorted = sort?.col === col && viewTab === "browse";
                    return (
                      <th key={col} className="px-3 py-2 font-mono font-medium">
                        {viewTab === "browse" ? (
                          <button
                            type="button"
                            onClick={() =>
                              setSort((cur) =>
                                cur?.col === col ? (cur.desc ? null : { col, desc: true }) : { col, desc: false },
                              )
                            }
                            className="inline-flex items-center gap-1 hover:text-ink"
                          >
                            <span>{col}</span>
                            {isSorted && (sort.desc ? <ArrowDown aria-hidden className="size-3" /> : <ArrowUp aria-hidden className="size-3" />)}
                          </button>
                        ) : (
                          col
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60 text-[13px]">
                {visibleRows.length === 0 ? (
                  <tr>
                    <td colSpan={Math.max(1, activeCols.length + 1)} className="px-4 py-8 text-center text-sm text-ink-3">
                      {viewTab === "sql" && !sqlResult
                        ? "Click Run SQL above to query your dataset."
                        : "No rows match your current filter."}
                    </td>
                  </tr>
                ) : (
                  visibleRows.map((row, ri) => (
                    <tr key={ri} className="hover:bg-paper/45">
                      <td className="px-3 py-2 font-mono text-[12px] text-ink-3">{safePage * pageSize + ri + 1}</td>
                      {activeCols.map((col) => {
                        const v = row[col];
                        const isNull = v === null || v === undefined;
                        return (
                          <td
                            key={col}
                            className={cn(
                              "max-w-[260px] truncate px-3 py-2 font-mono tabular-nums",
                              isNull ? "italic text-ink-3" : typeof v === "number" ? "text-ink" : "text-ink-2",
                            )}
                            title={formatCell(v)}
                          >
                            {formatCell(v)}
                          </td>
                        );
                      })}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {activeRows.length > pageSize && (
            <div className="flex items-center justify-between text-xs text-ink-3">
              <span className="font-mono">
                Showing {safePage * pageSize + 1}–{Math.min(activeRows.length, (safePage + 1) * pageSize)} of {activeRows.length}
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={safePage === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  className="inline-flex h-8 items-center gap-1 rounded-[7px] border border-line bg-surface px-2.5 text-ink disabled:opacity-40"
                >
                  <ChevronLeft aria-hidden className="size-3.5" /> Prev
                </button>
                <span className="font-mono text-ink-2">
                  {safePage + 1} / {pageCount}
                </span>
                <button
                  type="button"
                  disabled={safePage >= pageCount - 1}
                  onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                  className="inline-flex h-8 items-center gap-1 rounded-[7px] border border-line bg-surface px-2.5 text-ink disabled:opacity-40"
                >
                  Next <ChevronRight aria-hidden className="size-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
