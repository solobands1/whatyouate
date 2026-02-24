const fs = require("fs");
const path = require("path");

const src = path.join(process.cwd(), ".open-next", "worker.js");
const dest = path.join(process.cwd(), ".open-next", "_worker.js");
const assetsDir = path.join(process.cwd(), ".open-next", "assets");
const outDir = path.join(process.cwd(), ".open-next");
const routesFile = path.join(process.cwd(), ".open-next", "_routes.json");

if (!fs.existsSync(src)) {
  console.error(`[cf-worker-copy] Missing ${src}`);
  process.exit(1);
}

fs.copyFileSync(src, dest);
console.log(`[cf-worker-copy] Wrote ${dest}`);

if (!fs.existsSync(assetsDir)) {
  console.error(`[cf-worker-copy] Missing ${assetsDir}`);
  process.exit(1);
}

for (const entry of fs.readdirSync(assetsDir)) {
  const from = path.join(assetsDir, entry);
  const to = path.join(outDir, entry);
  fs.cpSync(from, to, { recursive: true, force: true });
}
console.log(`[cf-worker-copy] Copied assets from ${assetsDir} to ${outDir}`);

const routes = {
  version: 1,
  include: ["/*"],
  exclude: [
    "/_next/*",
    "/manifest.json",
    "/sw.js",
    "/icon-*.png",
    "/apple-touch-icon*.png",
  ],
};
fs.writeFileSync(routesFile, JSON.stringify(routes, null, 2));
console.log(`[cf-worker-copy] Wrote ${routesFile}`);
