import type { NextConfig } from "next";

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

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
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
