import sharp from "sharp";
import { writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(__dirname, "../public");

// Colors from tailwind config / globals.css
const BG = "#F1F6FF";
const INK = "#1F2937";
const INK_DIM = "rgba(31,41,55,0.6)"; // ink/60

// Build SVG for a given pixel size
function makeSvg(size) {
  const s = size / 512; // scale factor

  // Font sizes – scaled from 512 base
  // "What" widest, "You" narrower, "Ate(ai)" narrowest
  const fsWhat = Math.round(138 * s);
  const fsYou  = Math.round(104 * s);
  const fsAte  = Math.round(78 * s);
  const fsAi   = Math.round(26 * s);

  // Baseline y positions (empirically tuned on 512 base)
  const yWhat = Math.round(198 * s);
  const yYou  = Math.round(311 * s);
  const yAte  = Math.round(408 * s);

  // "Ate" ends roughly at x=256 + half its width.
  // Helvetica/SF semibold: "Ate" at 78px ≈ 134px wide → half = 67
  const ateHalfWidth = Math.round(67 * s);
  const xAiStart     = Math.round((256 + ateHalfWidth) * s);
  // Superscript sits above the cap-top of "Ate"
  const yAi = Math.round((yAte - fsAte * 0.72) * s / s); // keep in scaled coords

  const font = `-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', Helvetica, Arial, sans-serif`;
  const rx = Math.round(size * 0.195); // corner radius (≈ iOS icon rounding)

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${BG}" rx="${rx}"/>
  <!-- What -->
  <text
    x="${Math.round(256 * s)}" y="${yWhat}"
    font-family="${font}"
    font-weight="600"
    font-size="${fsWhat}"
    fill="${INK}"
    text-anchor="middle"
    dominant-baseline="auto">What</text>
  <!-- You -->
  <text
    x="${Math.round(256 * s)}" y="${yYou}"
    font-family="${font}"
    font-weight="600"
    font-size="${fsYou}"
    fill="${INK}"
    text-anchor="middle"
    dominant-baseline="auto">You</text>
  <!-- Ate -->
  <text
    x="${Math.round(256 * s)}" y="${yAte}"
    font-family="${font}"
    font-weight="600"
    font-size="${fsAte}"
    fill="${INK}"
    text-anchor="middle"
    dominant-baseline="auto">Ate</text>
  <!-- ai superscript -->
  <text
    x="${xAiStart}" y="${Math.round((yAte - fsAte * 0.72) * s / s)}"
    font-family="${font}"
    font-weight="600"
    font-size="${fsAi}"
    fill="${INK_DIM}"
    text-anchor="start"
    dominant-baseline="auto">ai</text>
</svg>`;
}

const targets = [
  { file: "icon-512.png",                    size: 512 },
  { file: "icon-192.png",                    size: 192 },
  { file: "apple-touch-icon.png",            size: 180 },
  { file: "apple-touch-icon-precomposed.png",size: 180 },
];

for (const { file, size } of targets) {
  const svg = makeSvg(size);
  const outPath = resolve(publicDir, file);
  await sharp(Buffer.from(svg))
    .png()
    .toFile(outPath);
  console.log(`✓ ${file} (${size}x${size})`);
}

// Also save the SVG for reference
writeFileSync(resolve(publicDir, "icon.svg"), makeSvg(512), "utf8");
console.log("✓ icon.svg saved");
