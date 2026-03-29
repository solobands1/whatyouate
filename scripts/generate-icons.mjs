import sharp from "sharp";
import { writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(__dirname, "../public");

function makeSvg(size) {
  const s  = size / 512;
  const rx = Math.round(size * 0.195);

  // --- Camera body + lens (centered at x=256, y=148) ---
  // Use a rounded-rect body so it reads as "camera", not "eye".
  const cx     = Math.round(256 * s);
  const cy     = Math.round(148 * s);
  const cbW    = Math.round(148 * s);  // camera body width
  const cbH    = Math.round(96  * s);  // camera body height
  const cbX    = cx - Math.round(cbW / 2);
  const cbY    = cy - Math.round(cbH / 2);
  const cbRx   = Math.round(18  * s);  // body corner radius
  // Small viewfinder bump on top-left
  const vfX    = cbX + Math.round(18 * s);
  const vfY    = cbY - Math.round(10 * s);
  const vfW    = Math.round(32  * s);
  const vfH    = Math.round(14  * s);
  // Lens circle inside the body
  const rMount = Math.round(36  * s);  // lens mount ring
  const rGlass = Math.round(28  * s);  // blue glass
  const rCore  = Math.round(14  * s);  // dark aperture
  const hlx    = cx + Math.round(10 * s);
  const hly    = cy - Math.round(10 * s);
  const rhl    = Math.round(5   * s);

  // --- Plate (center x=256, y=318) ---
  // Solid white plate with a visible raised rim.
  // Base circle = whole plate at moderate opacity.
  // Rim ring = slightly darker to show the angled edge.
  // Surface = inner flat area, brighter.
  const px      = Math.round(256 * s);
  const py      = Math.round(318 * s);
  const rPlate  = Math.round(160 * s);  // full plate radius
  const rimW    = Math.round(22  * s);  // rim width
  const rSurf   = rPlate - rimW;        // inner surface radius
  const rCenter = Math.round(78  * s);  // subtle center well

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <radialGradient id="bg" cx="50%" cy="25%" r="75%">
      <stop offset="0%" stop-color="#82B8FF"/>
      <stop offset="100%" stop-color="#4F88E8"/>
    </radialGradient>
    <!-- Blue glass gradient: lighter centre, richer edge -->
    <radialGradient id="lens" cx="38%" cy="33%" r="65%">
      <stop offset="0%"   stop-color="#A8D0FF"/>
      <stop offset="60%"  stop-color="#5A9AFF"/>
      <stop offset="100%" stop-color="#2D6ED6"/>
    </radialGradient>
  </defs>

  <!-- Background -->
  <rect width="${size}" height="${size}" fill="url(#bg)" rx="${rx}"/>

  <!-- ── Plate ── -->
  <!-- Full plate disc -->
  <circle cx="${px}" cy="${py}" r="${rPlate}" fill="rgba(255,255,255,0.78)"/>
  <!-- Rim shadow: a thin dark stroke just inside the edge to show depth -->
  <circle cx="${px}" cy="${py}" r="${rPlate - Math.round(rimW * 0.5)}" fill="none"
    stroke="rgba(180,200,240,0.55)" stroke-width="${rimW}"/>
  <!-- Flat surface (slightly whiter than rim) -->
  <circle cx="${px}" cy="${py}" r="${rSurf}" fill="rgba(255,255,255,0.88)"/>
  <!-- Subtle centre well -->
  <circle cx="${px}" cy="${py}" r="${rCenter}" fill="rgba(255,255,255,0.80)"/>

  <!-- ── Camera ── -->
  <!-- Viewfinder bump -->
  <rect x="${vfX}" y="${vfY}" width="${vfW}" height="${vfH}" rx="${Math.round(5*s)}" fill="#18202E"/>
  <!-- Camera body -->
  <rect x="${cbX}" y="${cbY}" width="${cbW}" height="${cbH}" rx="${cbRx}" fill="#18202E"/>
  <!-- Lens mount ring -->
  <circle cx="${cx}" cy="${cy}" r="${rMount}" fill="#2A3547"/>
  <!-- Blue glass -->
  <circle cx="${cx}" cy="${cy}" r="${rGlass}" fill="url(#lens)"/>
  <!-- Dark aperture -->
  <circle cx="${cx}" cy="${cy}" r="${rCore}"  fill="#0E1622"/>
  <!-- Lens reflection highlight -->
  <circle cx="${hlx}" cy="${hly}" r="${rhl}"  fill="rgba(255,255,255,0.78)"/>
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
