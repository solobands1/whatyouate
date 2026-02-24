const fs = require("fs");
const path = require("path");

const src = path.join(process.cwd(), ".open-next", "worker.js");
const dest = path.join(process.cwd(), ".open-next", "_worker.js");

if (!fs.existsSync(src)) {
  console.error(`[cf-worker-copy] Missing ${src}`);
  process.exit(1);
}

fs.copyFileSync(src, dest);
console.log(`[cf-worker-copy] Wrote ${dest}`);
