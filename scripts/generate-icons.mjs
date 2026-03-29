import sharp from "sharp";
import { writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(__dirname, "../public");

const BG    = "#F1F6FF";
const INK   = "#1F2937";
const INK60 = "rgba(31,41,55,0.6)";

// All values tuned on a 512x512 canvas then scaled.
//
// Font size: 185px — makes "What" fill ~84% of the icon width (edge-to-edge feel).
// "You" and "Ate" are the same size so the natural word-length difference
// creates the gentle pyramid taper the user wants.
//
// Line spacing is tight (150px) to fit 3 lines in the square.
//
// "ai" sits at the top-right corner of the "e" in "Ate" — NOT above the word.
// "Ate" at 185px is ~278px wide → right edge ≈ 256 + 139 = 395.
// Cap-top of "Ate" ≈ baseline − 185*0.72 = 482 − 133 = 349.
// So "ai" anchor: x=395, y=355 (slightly inside the cap-top for a snug fit).

function makeSvg(size) {
  const s  = size / 512;

  const fs   = Math.round(185 * s);  // all three words same size
  const fsAi = Math.round(48 * s);   // "ai" superscript

  // Baseline y coords (512-base).
  // Moved up so "Ate" has ~40px breathing room at the bottom.
  const yWhat = Math.round(170 * s);
  const yYou  = Math.round(315 * s);
  const yAte  = Math.round(455 * s);

  // "ai" sits at the top-right corner of the "e" in "Ate".
  // "Ate" cap-top = yAte − 185*0.72 = 455 − 133 = 322.
  // Right edge of "Ate" (278px wide, centered at 256) ≈ 256 + 139 = 395.
  // Nudge "ai" y a few px below cap-top so it reads as a superscript on "e",
  // not as floating above "Ate".
  // "e" x-height top ≈ yAte − 185*0.52 = 455 − 96 = 359.
  // Place "ai" baseline just at that level so it reads as
  // a tight superscript on the "e", not floating near "You".
  const xAi = Math.round(394 * s);
  const yAi = Math.round(358 * s);

  const rx   = Math.round(size * 0.195);
  const cx   = Math.round(256 * s);
  const font = `-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', Helvetica, Arial, sans-serif`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${BG}" rx="${rx}"/>
  <text x="${cx}" y="${yWhat}" font-family="${font}" font-weight="600" font-size="${fs}" fill="${INK}" text-anchor="middle">What</text>
  <text x="${cx}" y="${yYou}"  font-family="${font}" font-weight="600" font-size="${fs}" fill="${INK}" text-anchor="middle">You</text>
  <text x="${cx}" y="${yAte}"  font-family="${font}" font-weight="600" font-size="${fs}" fill="${INK}" text-anchor="middle">Ate</text>
  <text x="${xAi}" y="${yAi}" font-family="${font}" font-weight="600" font-size="${fsAi}" fill="${INK60}" text-anchor="start">ai</text>
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
  console.log(`✓ ${file} (${size}x${size})`);
}

writeFileSync(resolve(publicDir, "icon.svg"), makeSvg(512), "utf8");
console.log("✓ icon.svg saved");
