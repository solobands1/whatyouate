import sharp from "sharp";
import { writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(__dirname, "../public");

// All coordinates designed on a 512×512 canvas, then scaled by s = size/512.
function makeSvg(size) {
  const s  = size / 512;
  const rx = Math.round(size * 0.195);
  const b  = (n) => Math.round(n * s); // scale helper

  // ── Plate (center 256, 268) ───────────────────────────────────────────────
  // Four concentric circles create a plate illusion:
  //   1. Outer shadow ring  → slightly blue-tinted, gives the plate depth
  //   2. Rim surface        → bright white, the raised rim you'd see top-down
  //   3. Rim→surface groove → subtle shadow where rim curves down to the surface
  //   4. Eating surface     → brightest white, the flat inner area
  const px = b(256), py = b(268);

  // ── Bite mark path ────────────────────────────────────────────────────────
  // 5 teeth (4 incisors + 2 canines) with 4 valleys between them.
  // 10 points spaced evenly along the diagonal (455,265)→(185,65) — the same
  // line the original 3-tooth design used, which is proven to pass through the
  // plate interior. Each step is ~(-30, -22) px; chord ≈ 37px.
  // tr=20 is just above the minimum (chord/2 ≈ 18.7), giving deep, rounded
  // semicircular tooth impressions that look like real incisors.
  // sweep=0 → tooth (arc curves into plate), sweep=1 → valley (ridge between).
  const tr = b(20); // tooth arc radius — near-semicircular for rounded look

  const biteD = [
    `M ${b(512)} ${b(0)}`,
    `L ${b(512)} ${b(310)}`,
    `L ${b(455)} ${b(265)}`,
    `A ${tr} ${tr} 0 0 0 ${b(425)} ${b(243)}`,  // tooth 1
    `A ${tr} ${tr} 0 0 1 ${b(395)} ${b(221)}`,  // valley
    `A ${tr} ${tr} 0 0 0 ${b(365)} ${b(199)}`,  // tooth 2
    `A ${tr} ${tr} 0 0 1 ${b(335)} ${b(177)}`,  // valley
    `A ${tr} ${tr} 0 0 0 ${b(305)} ${b(155)}`,  // tooth 3
    `A ${tr} ${tr} 0 0 1 ${b(275)} ${b(133)}`,  // valley
    `A ${tr} ${tr} 0 0 0 ${b(245)} ${b(111)}`,  // tooth 4
    `A ${tr} ${tr} 0 0 1 ${b(215)} ${b(89)}`,   // valley
    `A ${tr} ${tr} 0 0 0 ${b(185)} ${b(65)}`,   // tooth 5
    `L ${b(295)} ${b(0)}`,
    `Z`,
  ].join(" ");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <radialGradient id="bg" cx="50%" cy="25%" r="80%">
      <stop offset="0%"   stop-color="#82B8FF"/>
      <stop offset="100%" stop-color="#4A84E8"/>
    </radialGradient>
    <mask id="bite">
      <rect width="${size}" height="${size}" fill="white"/>
      <path d="${biteD}" fill="black"/>
    </mask>
  </defs>

  <!-- Background -->
  <rect width="${size}" height="${size}" fill="url(#bg)" rx="${rx}"/>

  <!-- Plate -->
  <g mask="url(#bite)">
    <!-- Outer shadow ring: gives the plate a sense of depth and edge -->
    <circle cx="${px}" cy="${py}" r="${b(180)}" fill="rgba(180,205,238,0.55)"/>
    <!-- Rim surface: the raised rim of the plate, bright white -->
    <circle cx="${px}" cy="${py}" r="${b(168)}" fill="rgba(255,255,255,0.93)"/>
    <!-- Rim-to-surface groove: subtle shadow at the base of the rim -->
    <circle cx="${px}" cy="${py}" r="${b(152)}" fill="rgba(200,222,248,0.72)"/>
    <!-- Eating surface: flat inner area, brightest white -->
    <circle cx="${px}" cy="${py}" r="${b(143)}" fill="rgba(255,255,255,0.97)"/>
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
