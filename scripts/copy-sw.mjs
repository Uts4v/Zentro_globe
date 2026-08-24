// scripts/copy-sw.mjs
// Copies the generated PWA service worker artifacts from dist/ into
// .output/public/ so the Nitro server actually serves them.
import { copyFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const src = "dist";
const dest = ".output/public";

if (!existsSync(src)) {
  console.warn("copy-sw: dist/ not found — skipping SW copy");
  process.exit(0);
}

if (!existsSync(dest)) {
  console.warn("copy-sw: .output/public not found — skipping SW copy");
  process.exit(0);
}

const copied = [];
for (const file of readdirSync(src)) {
  if (/^(service-worker\.js|registerSW\.js|sw\.js(\.gz)?|manifest\.webmanifest|workbox-.*\.js(\.gz)?)$/.test(file)) {
    copyFileSync(join(src, file), join(dest, file));
    copied.push(file);
  }
}

console.log("copy-sw:", copied.join(", ") || "nothing matched");
