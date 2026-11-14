import { checkUploads, UploadRejected } from "./file-sniff";
/** Client helpers for file tools: validate, upload with progress, and hand results back. */

export class FileToolError extends Error {
  constructor(
    message: string,
    /** HTTP status, when the server answered. */
    readonly status?: number,
  ) {
    super(message);
  }
}

export function filenameFrom(disposition: string | null, fallback: string) {
  if (!disposition) return fallback;
  const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(disposition);
  if (star) return decodeURIComponent(star[1].replace(/"/g, ""));
  const plain = /filename="?([^";]+)"?/i.exec(disposition);
  return plain?.[1] ?? fallback;
}

/** Hands a blob to the browser as a normal download. */
export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export const extensionOf = (name: string) => {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i).toLowerCase() : "";
};

/** Same checks the backend makes, so obvious mistakes don't cost an upload. */
export function checkFile(file: File, extensions: string[], maxMB: number): string | null {
  const ext = extensionOf(file.name);
  if (!extensions.includes(ext)) {
    const list = extensions.map((e) => e.slice(1).toUpperCase()).join(", ");
    return `${ext ? ext.slice(1).toUpperCase() : "That"} files won't work here. Try ${list}.`;
  }
  if (file.size === 0) return "That file is empty.";
  if (file.size > maxMB * 1024 * 1024) return `That file is over ${maxMB} MB. Try a shorter or smaller one.`;
  return null;
}

export type Converted = {
  blob: Blob;
  name: string;
  size: number;
  type: string;
  /** JSON some tools send in `x-pdf-info`, `x-image-info` or `x-convert-info` (what was repaired, sizes per image, the route taken). */
  info?: string;
};

type UploadOptions = {
  signal?: AbortSignal;
  /** Used when the server doesn't name the file. */
  fallbackName: string;
  onUpload?: (p: number) => void;
  onProcessing?: () => void;
};

/** Where a route said to send its files directly: the backend URL plus a signed, expiring ticket. */
export type DirectTarget = { url: string; ticket: string; expires: number };
/** Per route: a ticket, or null once the route said it forwards files itself (local development). */
const directTargets = new Map<string, DirectTarget | null>();

/**
 * Asks our route (`?direct=1`) whether the file should go straight to the backend. Hosted
 * frontends cap what a route may receive (Vercel: 4.5 MB, 300 s), so in production the route
 * hands back a ticket instead. Any failure here falls back to sending through the route.
 */
export async function directTarget(endpoint: string, signal?: AbortSignal): Promise<DirectTarget | null> {
  const known = directTargets.get(endpoint);
  if (known === null) return null;
  if (known && known.expires * 1000 - Date.now() > 60_000) return known;
  try {
    const res = await fetch(`${endpoint}${endpoint.includes("?") ? "&" : "?"}direct=1`, { method: "POST", signal });
    if (!res.ok) return null;
    const body = (await res.json()) as Partial<DirectTarget>;
    const target = body.url && body.ticket && body.expires ? (body as DirectTarget) : null;
    directTargets.set(endpoint, target);
    return target;
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    return null;
  }
}

/** Forget a ticket the backend turned down (expired), so the next try asks for a new one. */
export const dropDirectTarget = (endpoint: string) => directTargets.delete(endpoint);

/**
 * Posts form data and returns the file the server sends back: straight to the backend when the
 * route hands out a ticket, through the route otherwise.
 */
export async function uploadForm(endpoint: string, form: FormData, options: UploadOptions): Promise<Converted> {
  await precheck(form);
  const direct = await directTarget(endpoint, options.signal);
  try {
    return await sendForm(direct?.url ?? endpoint, form, options, direct?.ticket);
  } catch (e) {
    // A ticket can expire between being handed out and being used; ask once more.
    if (!direct || !(e instanceof FileToolError) || e.status !== 401) throw e;
    dropDirectTarget(endpoint);
    const again = await directTarget(endpoint, options.signal);
    return sendForm(again?.url ?? endpoint, form, options, again?.ticket);
  }
}

/** Uses XHR rather than fetch because only XHR reports upload progress. */
function sendForm(
  endpoint: string,
  form: FormData,
  { signal, fallbackName, onUpload, onProcessing }: UploadOptions,
  ticket?: string,
): Promise<Converted> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", endpoint);
    if (ticket) xhr.setRequestHeader("X-Upload-Ticket", ticket);
    xhr.responseType = "blob";

    xhr.upload.onprogress = (e) => e.lengthComputable && onUpload?.(e.loaded / e.total);
    xhr.upload.onload = () => onProcessing?.();
    xhr.onerror = () => reject(new FileToolError("The upload was interrupted. Check your connection and try again."));
    xhr.onabort = () => reject(new DOMException("Aborted", "AbortError"));
    xhr.onload = async () => {
      const rawBlob = xhr.response as Blob;
      if (xhr.status < 200 || xhr.status >= 300) {
        const body = await rawBlob
          .text()
          .then((t) => JSON.parse(t) as { detail?: unknown })
          .catch(() => null);
        const detail = typeof body?.detail === "string" ? body.detail : `Request failed (${xhr.status}).`;
        return reject(new FileToolError(detail, xhr.status));
      }
      const name = filenameFrom(xhr.getResponseHeader("content-disposition"), fallbackName);
      const headerType = xhr.getResponseHeader("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
      const rawType = rawBlob.type.split(";")[0].trim().toLowerCase();
      let type = rawType && rawType !== "application/octet-stream" ? rawType : headerType || rawType || "application/octet-stream";
      if (name.toLowerCase().endsWith(".pdf") || headerType === "application/pdf") {
        type = "application/pdf";
      } else if (name.toLowerCase().endsWith(".zip") || headerType === "application/zip") {
        type = "application/zip";
      }
      const blob = rawBlob.type === type ? rawBlob : new Blob([rawBlob], { type });
      resolve({
        blob,
        size: blob.size,
        type,
        name,
        info: xhr.getResponseHeader("x-pdf-info") ?? xhr.getResponseHeader("x-image-info") ?? xhr.getResponseHeader("x-convert-info") ?? undefined,
      });
    };

    if (signal) {
      if (signal.aborted) return reject(new DOMException("Aborted", "AbortError"));
      signal.addEventListener("abort", () => xhr.abort(), { once: true });
    }
    xhr.send(form);
  });
}

/** Uploads one file as `file` form data and returns the converted file. */
export function convertFile(endpoint: string, file: File, options: UploadOptions): Promise<Converted> {
  const form = new FormData();
  form.append("file", file);
  return uploadForm(endpoint, form, options);
}

/** Posts form data (with upload progress) and reads a JSON answer. */
export async function postFormJson<T>(
  endpoint: string,
  form: FormData,
  options: Omit<UploadOptions, "fallbackName"> = {},
): Promise<T> {
  const out = await uploadForm(endpoint, form, { ...options, fallbackName: "response.json" });
  try {
    return JSON.parse(await out.blob.text()) as T;
  } catch {
    throw new FileToolError("The server sent something unexpected. Try again.");
  }
}

/**
 * Looks at each file's first bytes before uploading: a renamed or wrong file is refused at once,
 * instead of after a full upload (the server checks again, for real).
 */
export async function precheck(form: FormData) {
  try {
    await checkUploads(form);
  } catch (e) {
    if (e instanceof UploadRejected) throw new FileToolError(e.message, 415);
    throw e;
  }
}
