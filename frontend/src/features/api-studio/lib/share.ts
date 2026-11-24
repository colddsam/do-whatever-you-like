import { deflateSync, inflateSync, strFromU8, strToU8 } from "fflate";
import { b64ToBytes, b64url } from "./util";

/**
 * Share a collection or request as a link: the JSON is compressed into the URL's #fragment, which
 * browsers never send to a server. Opening the link offers to import it.
 */

export const SHARE_PATH = "/tools/api-client";
const MAX_LINK = 60_000;

export function shareLink(json: unknown): { url: string; tooBig: boolean } {
  const packed = b64url(deflateSync(strToU8(JSON.stringify(json)), { level: 9 }));
  const url = `${location.origin}${SHARE_PATH}#import=${packed}`;
  return { url, tooBig: url.length > MAX_LINK };
}

export function readShareHash(hash: string): string | null {
  const m = /[#&]import=([A-Za-z0-9_-]+)/.exec(hash);
  if (!m) return null;
  try {
    const b64 = m[1].replace(/-/g, "+").replace(/_/g, "/");
    return strFromU8(inflateSync(b64ToBytes(b64 + "=".repeat((4 - (b64.length % 4)) % 4))));
  } catch {
    return null;
  }
}
