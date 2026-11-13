import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
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
