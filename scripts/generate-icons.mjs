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
  // 4 teeth + 3 valleys, edge following a real circular jaw arc.
  //
  // The 8 waypoints were sampled from a circle centred at (455, -103) r=308 —
  // a large arc concave toward the plate interior, giving the "mouth closing
  // around the rim" shape of the Apple-logo bite rather than a straight slash.
  // Arc spans ~54° from (440,205) → (200,70); chord per segment ≈ 41px.
  // tr=24 gives a ~13px-deep rounded tooth impression — visible at all sizes.
  // sweep=0 → tooth (arc bulges toward plate), sweep=1 → valley (ridge).
  const tr = b(24);

  const biteD = [
    `M ${b(512)} ${b(0)}`,
    `L ${b(512)} ${b(260)}`,
    `L ${b(440)} ${b(205)}`,
    `A ${tr} ${tr} 0 0 0 ${b(399)} ${b(201)}`,  // tooth 1
    `A ${tr} ${tr} 0 0 1 ${b(360)} ${b(190)}`,  // valley
    `A ${tr} ${tr} 0 0 0 ${b(322)} ${b(175)}`,  // tooth 2
    `A ${tr} ${tr} 0 0 1 ${b(287)} ${b(156)}`,  // valley
    `A ${tr} ${tr} 0 0 0 ${b(255)} ${b(132)}`,  // tooth 3
    `A ${tr} ${tr} 0 0 1 ${b(226)} ${b(104)}`,  // valley
    `A ${tr} ${tr} 0 0 0 ${b(200)} ${b(70)}`,   // tooth 4
    `L ${b(275)} ${b(0)}`,
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
