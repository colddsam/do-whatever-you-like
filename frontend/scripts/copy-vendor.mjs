// Copies browser-only libraries from node_modules into public/vendor, so the site serves them
// itself (free, no third-party CDN) and git doesn't carry the 10 MB file. Runs before dev and build.
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const files = [
  // OpenCV.js (Apache-2.0) for the document scanner's edge detection, loaded only by /scan/scan-worker.js.
  ["node_modules/@techstark/opencv-js/dist/opencv.js", "public/vendor/opencv-4.10.0.js"],
];
for (const [from, to] of files) {
  const src = join(root, from);
  const dest = join(root, to);
  if (!existsSync(src)) {
    console.warn(`copy-vendor: ${from} is missing; run npm install.`);
    continue;
  }
  if (existsSync(dest) && statSync(dest).size === statSync(src).size) continue;
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  console.log(`copy-vendor: ${to}`);
}
