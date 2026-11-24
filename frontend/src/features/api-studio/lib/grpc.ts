import protobuf from "protobufjs";
import descriptor from "protobufjs/ext/descriptor";
import { b64ToBytes, bytesToB64, concatBytes, td } from "./util";
import { withScheme } from "./url";

/**
 * gRPC: methods come from a pasted .proto (with Google's well-known types) or from the server's
 * reflection service. Messages are typed as JSON, encoded here with protobufjs, and sent either over
 * HTTP/2 by our server (any gRPC server) or as gRPC-Web straight from the browser.
 */

export type GrpcMethod = { path: string; service: string; name: string; requestType: string; responseType: string; requestStream: boolean; responseStream: boolean };

export function parseProto(text: string): protobuf.Root {
  const root = new protobuf.Root();
  const parsed = protobuf.parse(text, root, { keepCase: true, alternateCommentMode: true });
  const common = (protobuf as unknown as { common: { get(file: string): { nested?: protobuf.INamespace["nested"] } | null } }).common;
  for (const imp of [...(parsed.imports ?? []), ...(parsed.weakImports ?? [])]) {
    const json = common.get(imp);
    if (json?.nested) root.addJSON(json.nested);
  }
  root.resolveAll();
  return root;
}

export function listMethods(root: protobuf.Root): GrpcMethod[] {
  const out: GrpcMethod[] = [];
  const walk = (ns: protobuf.NamespaceBase) => {
    for (const obj of ns.nestedArray) {
      if (obj instanceof protobuf.Service) {
        const full = obj.fullName.replace(/^\./, "");
        for (const m of obj.methodsArray) {
          m.resolve();
          out.push({
            path: `/${full}/${m.name}`,
            service: full,
            name: m.name,
            requestType: m.resolvedRequestType?.fullName.replace(/^\./, "") ?? m.requestType,
            responseType: m.resolvedResponseType?.fullName.replace(/^\./, "") ?? m.responseType,
            requestStream: !!m.requestStream,
            responseStream: !!m.responseStream,
          });
        }
      } else if (obj instanceof protobuf.Namespace) walk(obj);
    }
  };
  walk(root);
  return out;
}

/** An example message with every field filled in, to start from. */
export function exampleMessage(root: protobuf.Root, typeName: string, depth = 0): Record<string, unknown> {
  const t = root.lookupType(typeName);
  const out: Record<string, unknown> = {};
  for (const f of t.fieldsArray) {
    f.resolve();
    let v: unknown;
    if (f.resolvedType instanceof protobuf.Type) {
      const fn = f.resolvedType.fullName.replace(/^\./, "");
      v = fn === "google.protobuf.Timestamp" ? new Date(0).toISOString() : depth > 4 ? {} : exampleMessage(root, fn, depth + 1);
    } else if (f.resolvedType instanceof protobuf.Enum) v = Object.keys(f.resolvedType.values)[0];
    else
      v =
        { string: "", bool: false, bytes: "", double: 0, float: 0, int32: 0, int64: "0", uint32: 0, uint64: "0", sint32: 0, sint64: "0", fixed32: 0, fixed64: "0", sfixed32: 0, sfixed64: "0" }[f.type] ?? null;
    out[f.name] = f.repeated ? [v] : f.map ? { key: v } : v;
  }
  return out;
}

export function encodeMessage(root: protobuf.Root, typeName: string, json: string): Uint8Array {
  const t = root.lookupType(typeName);
  let obj: Record<string, unknown>;
  try {
    obj = json.trim() ? JSON.parse(json) : {};
  } catch {
    throw new Error("The message must be valid JSON.");
  }
  const err = t.verify(t.fromObject(obj) as unknown as Record<string, unknown>);
  if (err) throw new Error(`Message doesn't match ${typeName}: ${err}`);
  return t.encode(t.fromObject(obj)).finish();
}

export function decodeMessage(root: protobuf.Root, typeName: string, bytes: Uint8Array): unknown {
  const t = root.lookupType(typeName);
  return t.toObject(t.decode(bytes), { longs: String, enums: String, bytes: String, defaults: true, arrays: true, objects: true, oneofs: true });
}

export const GRPC_STATUS = ["OK", "CANCELLED", "UNKNOWN", "INVALID_ARGUMENT", "DEADLINE_EXCEEDED", "NOT_FOUND", "ALREADY_EXISTS", "PERMISSION_DENIED", "RESOURCE_EXHAUSTED", "FAILED_PRECONDITION", "ABORTED", "OUT_OF_RANGE", "UNIMPLEMENTED", "INTERNAL", "UNAVAILABLE", "DATA_LOSS", "UNAUTHENTICATED"];

export type GrpcResult = { status: number; message: string; headers: [string, string][]; trailers: [string, string][]; messages: Uint8Array[]; ms: number; via: "cloud" | "browser" };

export async function callGrpc(opts: { url: string; tls: boolean; web: boolean; path: string; metadata: [string, string][]; messages: Uint8Array[]; timeoutMs: number; signal?: AbortSignal }): Promise<GrpcResult> {
  const t0 = performance.now();
  if (opts.web) return callGrpcWeb(opts, t0);
  let res: Response;
  try {
    res = await fetch("/api/tools/apiclient/grpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: opts.url, tls: opts.tls, path: opts.path, metadata: opts.metadata, messages_b64: opts.messages.map(bytesToB64), timeout_ms: Math.min(opts.timeoutMs, 55000) }),
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new Error("Couldn't reach our server to make the call.");
  }
  const d = await res.json().catch(() => null);
  if (!res.ok) throw new Error(d?.detail ?? `The call failed (${res.status}).`);
  return { status: d.status, message: d.message, headers: d.headers, trailers: d.trailers, messages: (d.messages_b64 as string[]).map(b64ToBytes), ms: d.timings?.total ?? performance.now() - t0, via: "cloud" };
}

async function callGrpcWeb(opts: { url: string; tls: boolean; path: string; metadata: [string, string][]; messages: Uint8Array[]; timeoutMs: number; signal?: AbortSignal }, t0: number): Promise<GrpcResult> {
  const base = withScheme(/^[a-z]+:\/\//i.test(opts.url) ? opts.url : `${opts.tls ? "https" : "http"}://${opts.url}`).replace(/\/$/, "");
  const frames = concatBytes(opts.messages.map((m) => concatBytes([new Uint8Array([0, (m.length >>> 24) & 255, (m.length >>> 16) & 255, (m.length >>> 8) & 255, m.length & 255]), m])));
  const headers = new Headers({ "Content-Type": "application/grpc-web+proto", "X-Grpc-Web": "1", Accept: "application/grpc-web+proto" });
  for (const [k, v] of opts.metadata) headers.append(k, v);
  let res: Response;
  try {
    res = await fetch(base + opts.path, { method: "POST", headers, body: frames as BodyInit, signal: opts.signal ?? AbortSignal.timeout(opts.timeoutMs) });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new Error("The browser couldn't reach this gRPC-Web endpoint (it must allow CORS). Turn off gRPC-Web to call it over HTTP/2 through our server.");
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  const messages: Uint8Array[] = [];
  const trailers: [string, string][] = [];
  let i = 0;
  while (i + 5 <= buf.length) {
    const flag = buf[i];
    const len = (buf[i + 1] << 24) | (buf[i + 2] << 16) | (buf[i + 3] << 8) | buf[i + 4];
    const data = buf.subarray(i + 5, i + 5 + len);
    i += 5 + len;
    if (flag & 0x80)
      for (const line of td.decode(data).split("\r\n")) {
        const c = line.indexOf(":");
        if (c > 0) trailers.push([line.slice(0, c).trim().toLowerCase(), line.slice(c + 1).trim()]);
      }
    else messages.push(data);
  }
  const hdrs: [string, string][] = [];
  res.headers.forEach((v, k) => hdrs.push([k, v]));
  const get = (k: string) => trailers.find(([x]) => x === k)?.[1] ?? res.headers.get(k) ?? undefined;
  return { status: Number(get("grpc-status") ?? (res.ok ? 0 : 2)), message: decodeURIComponent(get("grpc-message") ?? (res.ok ? "" : `HTTP ${res.status}`)), headers: hdrs, trailers, messages, ms: performance.now() - t0, via: "browser" };
}

/* ------------------------------------------------------------------ server reflection */

const REFLECTION_PROTO = `syntax = "proto3";
package grpc.reflection.v1alpha;
service ServerReflection { rpc ServerReflectionInfo(stream ServerReflectionRequest) returns (stream ServerReflectionResponse); }
message ServerReflectionRequest { string host = 1; oneof message_request { string file_by_filename = 3; string file_containing_symbol = 4; string all_extension_numbers_of_type = 6; string list_services = 7; } }
message ServerReflectionResponse { string valid_host = 1; ServerReflectionRequest original_request = 2; oneof message_response { FileDescriptorResponse file_descriptor_response = 4; ListServiceResponse list_services_response = 6; ErrorResponse error_response = 7; } }
message FileDescriptorResponse { repeated bytes file_descriptor_proto = 1; }
message ListServiceResponse { repeated ServiceResponse service = 1; }
message ServiceResponse { string name = 1; }
message ErrorResponse { int32 error_code = 1; string error_message = 2; }`;

/** Asks the server for its services and their .proto descriptors (gRPC server reflection, v1 then v1alpha). */
export async function reflect(opts: { url: string; tls: boolean; web: boolean; metadata: [string, string][]; timeoutMs: number }): Promise<protobuf.Root> {
  const rroot = protobuf.parse(REFLECTION_PROTO, { keepCase: true }).root;
  const Req = rroot.lookupType("grpc.reflection.v1alpha.ServerReflectionRequest");
  const Res = rroot.lookupType("grpc.reflection.v1alpha.ServerReflectionResponse");
  const enc = (o: Record<string, unknown>) => Req.encode(Req.fromObject(o)).finish();
  const dec = (b: Uint8Array) => Res.toObject(Res.decode(b), { bytes: Array, defaults: false }) as { list_services_response?: { service: { name: string }[] }; file_descriptor_response?: { file_descriptor_proto: number[][] }; error_response?: { error_message: string } };
  let lastErr = "";
  for (const ver of ["v1", "v1alpha"]) {
    const path = `/grpc.reflection.${ver}.ServerReflection/ServerReflectionInfo`;
    const first = await callGrpc({ ...opts, path, messages: [enc({ list_services: "*" })] });
    if (first.status !== 0) {
      lastErr = `${GRPC_STATUS[first.status] ?? first.status}: ${first.message}`;
      continue;
    }
    const services = first.messages.flatMap((m) => dec(m).list_services_response?.service.map((s) => s.name) ?? []).filter((s) => !s.startsWith("grpc.reflection."));
    if (!services.length) {
      lastErr = "The server answered but listed no services.";
      continue;
    }
    const second = await callGrpc({ ...opts, path, messages: services.map((s) => enc({ file_containing_symbol: s })) });
    const files = new Map<string, Uint8Array>();
    const FDP = (descriptor as unknown as { FileDescriptorProto: protobuf.Type }).FileDescriptorProto;
    for (const m of second.messages) {
      const d = dec(m);
      if (d.error_response) lastErr = d.error_response.error_message;
      for (const raw of d.file_descriptor_response?.file_descriptor_proto ?? []) {
        const bytes = Uint8Array.from(raw);
        const fd = FDP.decode(bytes) as unknown as { name: string };
        files.set(fd.name, bytes);
      }
    }
    if (!files.size) continue;
    const FDS = (descriptor as unknown as { FileDescriptorSet: protobuf.Type }).FileDescriptorSet;
    const set = FDS.fromObject({ file: [...files.values()].map((b) => FDP.decode(b)) });
    const root = (protobuf.Root as unknown as { fromDescriptor(d: unknown): protobuf.Root }).fromDescriptor(set);
    root.resolveAll();
    return root;
  }
  throw new Error(`Server reflection isn't available here${lastErr ? ` (${lastErr})` : ""}. Paste the service's .proto instead.`);
}

/** A readable .proto for a root built from reflection (to keep with the request). */
export function rootToJson(root: protobuf.Root): string {
  return JSON.stringify(root.toJSON({ keepComments: false }));
}

export function rootFromJson(json: string): protobuf.Root {
  const root = protobuf.Root.fromJSON(JSON.parse(json));
  root.resolveAll();
  return root;
}

/** The proto field holds either .proto text or (after reflection) a JSON descriptor. */
export function loadRoot(protoField: string): protobuf.Root {
  const t = protoField.trim();
  if (!t) throw new Error("Add the service's .proto (or use server reflection).");
  return t.startsWith("{") ? rootFromJson(t) : parseProto(t);
}
