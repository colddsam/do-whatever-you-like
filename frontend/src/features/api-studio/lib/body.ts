import type { Body, RawLang } from "../types";
import { getFile } from "./blobs";
import { concatBytes, te } from "./util";

export const RAW_TYPES: Record<RawLang, string> = {
  text: "text/plain",
  json: "application/json",
  javascript: "application/javascript",
  html: "text/html",
  xml: "application/xml",
};

export type BuiltBody = { bytes: Uint8Array | null; contentType?: string; form?: [string, string][]; preview?: string };

/**
 * Turns the Body tab into bytes on the wire. `r` resolves {{variables}} (already bound to the request's scopes).
 * Multipart is encoded here (not by the browser) so the cloud agent can relay it byte for byte.
 */
export async function buildBody(body: Body, method: string, r: (s: string) => string): Promise<BuiltBody> {
  switch (body.mode) {
    case "none":
      return { bytes: null };
    case "raw": {
      const text = r(body.raw);
      return { bytes: te.encode(text), contentType: RAW_TYPES[body.rawLang] ?? "text/plain", preview: text };
    }
    case "urlencoded": {
      const pairs = body.urlencoded.filter((f) => f.enabled && f.key).map((f) => [r(f.key), r(f.value)] as [string, string]);
      const text = pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
      return { bytes: te.encode(text), contentType: "application/x-www-form-urlencoded", form: pairs, preview: text };
    }
    case "formdata": {
      const boundary = `--------------------------${Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => (b % 10).toString()).join("")}`;
      const parts: Uint8Array[] = [];
      const lines: string[] = [];
      for (const f of body.formdata) {
        if (!f.enabled || !f.key) continue;
        const name = r(f.key).replace(/"/g, "%22");
        if (f.type === "file") {
          const blob = await getFile(f.file);
          if (!blob) {
            if (f.file) throw new Error(`The file for form field "${name}" is missing: pick it again.`);
            continue;
          }
          const fname = (f.file?.name ?? "file").replace(/"/g, "%22");
          const ct = f.contentType || f.file?.type || "application/octet-stream";
          parts.push(te.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${fname}"\r\nContent-Type: ${ct}\r\n\r\n`));
          parts.push(new Uint8Array(await blob.arrayBuffer()));
          parts.push(te.encode("\r\n"));
          lines.push(`${name}: <file ${fname}>`);
        } else {
          const value = r(f.value);
          const ct = f.contentType ? `\r\nContent-Type: ${f.contentType}` : "";
          parts.push(te.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"${ct}\r\n\r\n${value}\r\n`));
          lines.push(`${name}: ${value}`);
        }
      }
      if (!parts.length) return { bytes: null };
      parts.push(te.encode(`--${boundary}--\r\n`));
      return { bytes: concatBytes(parts), contentType: `multipart/form-data; boundary=${boundary}`, preview: lines.join("\n") };
    }
    case "binary": {
      const blob = await getFile(body.binary);
      if (!blob) return { bytes: null };
      return { bytes: new Uint8Array(await blob.arrayBuffer()), contentType: body.binary?.type || "application/octet-stream", preview: `<file ${body.binary?.name}>` };
    }
    case "graphql": {
      let variables: unknown = undefined;
      const vText = r(body.graphql.variables).trim();
      if (vText) {
        try {
          variables = JSON.parse(vText);
        } catch {
          throw new Error("GraphQL variables must be valid JSON.");
        }
      }
      const query = r(body.graphql.query);
      if (method.toUpperCase() === "GET") return { bytes: null };
      const text = JSON.stringify(variables === undefined ? { query } : { query, variables });
      return { bytes: te.encode(text), contentType: "application/json", preview: text };
    }
  }
}
