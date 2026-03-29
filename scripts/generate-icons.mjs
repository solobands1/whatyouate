import sharp from "sharp";
import { writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(__dirname, "../public");

// Plate + camera lens icon, rebuilt as SVG so the background is easily changed.
// Original design: dark camera lens (outer dark ring, blue inner, white highlight)
// sitting above a plate (concentric rings).
// All coordinates tuned on a 512×512 canvas then scaled proportionally.

function makeSvg(size) {
  const s = size / 512;
  const rx = Math.round(size * 0.195); // iOS corner radius

  // Background: use the app primary blue so the white/dark elements pop.
  // Change this hex to try different BG colours.
  const BG = "#6FA8FF";

  // --- Camera lens (center x=256, center y=148) ---
  const lx = Math.round(256 * s);
  const ly = Math.round(148 * s);
  const rOuter = Math.round(60 * s);   // dark outer ring
  const rBlue  = Math.round(44 * s);   // white inner ring
  const rCore  = Math.round(26 * s);   // dark core
  const hlx    = Math.round(272 * s);  // highlight x
  const hly    = Math.round(135 * s);  // highlight y
  const rhl    = Math.round(9  * s);   // highlight radius

  // --- Plate (center x=256, center y=310) ---
  // Moved up slightly so the full plate is visible with breathing room at bottom.
  const px  = Math.round(256 * s);
  const py  = Math.round(310 * s);
  const rP1 = Math.round(162 * s);   // outer rim
  const rP2 = Math.round(135 * s);   // plate surface edge
  const rP3 = Math.round(92  * s);   // inner well

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <radialGradient id="bg" cx="50%" cy="30%" r="70%">
      <stop offset="0%" stop-color="#82B8FF"/>
      <stop offset="100%" stop-color="#4F88E8"/>
    </radialGradient>
  </defs>

  <!-- Background -->
  <rect width="${size}" height="${size}" fill="url(#bg)" rx="${rx}"/>

  <!-- Plate outer rim -->
  <circle cx="${px}" cy="${py}" r="${rP1}" fill="rgba(255,255,255,0.18)"/>
  <!-- Plate surface -->
  <circle cx="${px}" cy="${py}" r="${rP2}" fill="rgba(255,255,255,0.28)"/>
  <!-- Plate inner well -->
  <circle cx="${px}" cy="${py}" r="${rP3}" fill="rgba(255,255,255,0.40)"/>

  <!-- Camera outer dark ring -->
  <circle cx="${lx}" cy="${ly}" r="${rOuter}" fill="#1A2535"/>
  <!-- Camera white ring -->
  <circle cx="${lx}" cy="${ly}" r="${rBlue}" fill="rgba(255,255,255,0.92)"/>
  <!-- Camera dark core -->
  <circle cx="${lx}" cy="${ly}" r="${rCore}" fill="#1A2535"/>
  <!-- Highlight dot -->
  <circle cx="${hlx}" cy="${hly}" r="${rhl}" fill="rgba(255,255,255,0.85)"/>
</svg>`;
}

const targets = [
  { file: "icon-512.png",                     size: 512 },
  { file: "icon-192.png",                     size: 192 },
  { file: "apple-touch-icon.png",             size: 180 },
  { file: "apple-touch-icon-precomposed.png", size: 180 },
];

for (const { file, size } of targets) {
  await sharp(Buffer.from(makeSvg(size))).png().toFile(resolve(publicDir, file));
  console.log(`✓ ${file} (${size}×${size})`);
}

writeFileSync(resolve(publicDir, "icon.svg"), makeSvg(512), "utf8");
console.log("✓ icon.svg saved");
