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

export type Converted = { blob: Blob; name: string; size: number; type: string };

type UploadOptions = {
  signal?: AbortSignal;
  /** Used when the server doesn't name the file. */
  fallbackName: string;
  onUpload?: (p: number) => void;
  onProcessing?: () => void;
};

/**
 * Posts form data and returns the file the server sends back.
 * Uses XHR rather than fetch because only XHR reports upload progress.
 */
export function uploadForm(
  endpoint: string,
  form: FormData,
  { signal, fallbackName, onUpload, onProcessing }: UploadOptions,
): Promise<Converted> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", endpoint);
    xhr.responseType = "blob";

    xhr.upload.onprogress = (e) => e.lengthComputable && onUpload?.(e.loaded / e.total);
    xhr.upload.onload = () => onProcessing?.();
    xhr.onerror = () => reject(new FileToolError("The upload was interrupted. Check your connection and try again."));
    xhr.onabort = () => reject(new DOMException("Aborted", "AbortError"));
    xhr.onload = async () => {
      const blob = xhr.response as Blob;
      if (xhr.status < 200 || xhr.status >= 300) {
        const body = await blob
          .text()
          .then((t) => JSON.parse(t) as { detail?: unknown })
          .catch(() => null);
        const detail = typeof body?.detail === "string" ? body.detail : `Request failed (${xhr.status}).`;
        return reject(new FileToolError(detail, xhr.status));
      }
      resolve({
        blob,
        size: blob.size,
        type: blob.type || xhr.getResponseHeader("content-type") || "application/octet-stream",
        name: filenameFrom(xhr.getResponseHeader("content-disposition"), fallbackName),
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
