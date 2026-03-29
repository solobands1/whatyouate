import sharp from "sharp";
import { writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(__dirname, "../public");

// Option B: plate with a bite taken out — visual pun on "WhatYouAte".
// A circular bite is masked from the upper-right of the plate,
// similar to the Apple logo approach.

function makeSvg(size) {
  const s  = size / 512;
  const rx = Math.round(size * 0.195);

  // Plate — slightly below center so it sits naturally on screen
  const px = Math.round(256 * s);
  const py = Math.round(275 * s);
  const rPlate  = Math.round(178 * s);  // full plate radius
  const rimW    = Math.round(20  * s);  // visible rim width
  const rSurf   = rPlate - rimW;        // flat eating surface

  // Bite — circular notch in the upper-right edge of the plate
  const bx = Math.round(378 * s);
  const by = Math.round(142 * s);
  const rb = Math.round(82  * s);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <radialGradient id="bg" cx="50%" cy="25%" r="80%">
      <stop offset="0%"   stop-color="#82B8FF"/>
      <stop offset="100%" stop-color="#4A84E8"/>
    </radialGradient>

    <!-- Mask: white = visible, black circle = the bite -->
    <mask id="bite">
      <rect width="${size}" height="${size}" fill="white"/>
      <circle cx="${bx}" cy="${by}" r="${rb}" fill="black"/>
    </mask>
  </defs>

  <!-- Background -->
  <rect width="${size}" height="${size}" fill="url(#bg)" rx="${rx}"/>

  <!-- Plate (everything masked by the bite) -->
  <g mask="url(#bite)">
    <!-- Rim base -->
    <circle cx="${px}" cy="${py}" r="${rPlate}" fill="rgba(255,255,255,0.80)"/>
    <!-- Rim inner shadow ring to show depth of the raised edge -->
    <circle cx="${px}" cy="${py}" r="${rPlate - Math.round(rimW * 0.5)}"
      fill="none" stroke="rgba(160,190,230,0.50)" stroke-width="${rimW}"/>
    <!-- Flat eating surface -->
    <circle cx="${px}" cy="${py}" r="${rSurf}" fill="rgba(255,255,255,0.95)"/>
  </g>
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
