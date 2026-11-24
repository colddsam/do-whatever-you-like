import type { NextConfig } from "next";
import { MERGED_TOOLS, mergedHref } from "./src/lib/merged-tools";

/**
 * Security headers for every response. Deliberately no script-src/style-src CSP: the tools rely on
 * workers, WebAssembly, blob: and data: URLs, and a strict policy would need testing tool by tool.
 * - frame-ancestors 'self': other sites can't frame us (clickjacking); the device preview tool
 *   can still frame this site.
 * - object-src 'self' blob:: Chromium's built-in PDF viewer embeds blob: PDFs inside iframes/objects.
 * - Permissions-Policy: camera (scan to PDF, webcam test), microphone (audio to text) and
 *   geolocation (QR "my location") for this origin only; everything else off.
 */
const securityHeaders = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'; base-uri 'self'; object-src 'self' blob:" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(self), geolocation=(self), payment=(), usb=(), serial=(), bluetooth=()",
  },
];

/**
 * Cross-origin isolation for the video editor and music studio only. It unlocks SharedArrayBuffer, so the editor's
 * AI models (ONNX Runtime WASM) run multi-threaded when there's no WebGPU. "credentialless" (not
 * "require-corp") still lets the page load CORS-enabled files from other sites (Google Fonts, the
 * model CDNs) without them sending Cross-Origin-Resource-Policy. Scoped to the editor because COEP
 * blocks cross-origin iframes, and the editor's AI worker script needs it too: a dedicated worker
 * started by an isolated page is refused without a matching policy.
 */
const isolationHeaders = [
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/tools/video-editor", headers: isolationHeaders },
      { source: "/studio/:path*", headers: isolationHeaders },
      // The music studio and its MusicGen worker (public/music/ai-worker.js).
      { source: "/tools/music-studio", headers: isolationHeaders },
      { source: "/music/:path*", headers: isolationHeaders },
    ];
  },
  // Pages folded into broader tools (src/lib/merged-tools.ts) move permanently, opening the new
  // tool on the same mode, so old links and search results keep working.
  async redirects() {
    return [
      ...Object.keys(MERGED_TOOLS).map((id) => ({ source: `/tools/${id}`, destination: mergedHref(id)!, permanent: true })),
      // A short address for the video editor.
      { source: "/studio", destination: "/tools/video-editor", permanent: false },
      { source: "/video-editor", destination: "/tools/video-editor", permanent: false },
      // Short addresses for the API client.
      { source: "/api-client", destination: "/tools/api-client", permanent: false },
      { source: "/api-tester", destination: "/tools/api-client", permanent: true },
      // Short addresses for the music studio.
      { source: "/music", destination: "/tools/music-studio", permanent: false },
      { source: "/music-studio", destination: "/tools/music-studio", permanent: false },
    ];
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    // @prettier/plugin-php (the PHP formatter, which runs in the browser) imports fs and path for a
    // code path we never use; give the browser bundle small stand-ins.
    resolveAlias: {
      fs: { browser: "./src/lib/stubs/fs.ts" },
      path: { browser: "./src/lib/stubs/path.ts" },
    },
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
