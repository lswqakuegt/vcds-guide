// Génère les icônes PWA (192x192 et 512x512) : fond dégradé bleu nuit
// + lettre "V" blanche stylisée, écrites pixel par pixel via pngjs.
import { PNG } from "pngjs";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "../public");
mkdirSync(OUT, { recursive: true });

// Mélange linéaire entre deux couleurs RGB
const lerp = (a, b, t) => Math.round(a + (b - a) * t);
const mix = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];

const BG_TOP = [13, 21, 38];   // #0d1526
const BG_BOT = [10, 14, 26];   // #0a0e1a
const ACCENT = [41, 137, 216]; // #2989d8
const TEXT   = [240, 248, 255];

// Génère un PNG carré avec dégradé + cadre + "V"
const makeIcon = (size) => {
  const png = new PNG({ width: size, height: size });
  const R = size * 0.18; // rayon d'arrondi visuel (masque)

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (size * y + x) << 2;

      // dégradé vertical
      const t = y / (size - 1);
      let [r, g, b] = mix(BG_TOP, BG_BOT, t);

      // cadre lumineux (anneau)
      const margin = size * 0.06;
      const dEdge = Math.min(x, y, size - 1 - x, size - 1 - y);
      if (dEdge > margin && dEdge < margin + 2) {
        [r, g, b] = ACCENT;
      }

      // Lettre "V" simplifiée : deux diagonales convergentes
      const cx = size / 2;
      const yTop = size * 0.28;
      const yBot = size * 0.72;
      const halfTop = size * 0.22;
      if (y >= yTop && y <= yBot) {
        const prog = (y - yTop) / (yBot - yTop); // 0 → 1
        const xLeft  = cx - halfTop * (1 - prog);
        const xRight = cx + halfTop * (1 - prog);
        const stroke = size * 0.055;
        if (
          (Math.abs(x - xLeft)  < stroke) ||
          (Math.abs(x - xRight) < stroke)
        ) {
          [r, g, b] = TEXT;
        }
      }

      // Masque coins arrondis (léger)
      const inCorner =
        (x < R && y < R && Math.hypot(R - x, R - y) > R) ||
        (x > size - R && y < R && Math.hypot(x - (size - R), R - y) > R) ||
        (x < R && y > size - R && Math.hypot(R - x, y - (size - R)) > R) ||
        (x > size - R && y > size - R && Math.hypot(x - (size - R), y - (size - R)) > R);

      png.data[idx]     = r;
      png.data[idx + 1] = g;
      png.data[idx + 2] = b;
      png.data[idx + 3] = inCorner ? 0 : 255;
    }
  }
  return PNG.sync.write(png);
};

for (const size of [192, 512]) {
  const buf = makeIcon(size);
  const file = resolve(OUT, `icon-${size}.png`);
  writeFileSync(file, buf);
  console.log(`✔ ${file} (${buf.length} bytes)`);
}

// Génération des icônes Android (mipmap) si le projet Android existe
const ANDROID_RES = resolve(__dirname, "../android/app/src/main/res");
const MIPMAPS = [
  { dir: "mipmap-mdpi",    size: 48 },
  { dir: "mipmap-hdpi",    size: 72 },
  { dir: "mipmap-xhdpi",   size: 96 },
  { dir: "mipmap-xxhdpi",  size: 144 },
  { dir: "mipmap-xxxhdpi", size: 192 },
];
try {
  for (const { dir, size } of MIPMAPS) {
    const target = resolve(ANDROID_RES, dir);
    mkdirSync(target, { recursive: true });
    const buf = makeIcon(size);
    writeFileSync(resolve(target, "ic_launcher.png"), buf);
    writeFileSync(resolve(target, "ic_launcher_round.png"), buf);
    writeFileSync(resolve(target, "ic_launcher_foreground.png"), buf);
  }
  console.log("✔ Icônes Android mipmap générées");
} catch (e) {
  console.log("ℹ Dossier android/ absent, icônes mipmap ignorées");
}

// Favicon SVG rapide (même look)
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs><linearGradient id="g" x1="0" x2="0" y1="0" y2="1">
    <stop offset="0" stop-color="#0d1526"/><stop offset="1" stop-color="#0a0e1a"/>
  </linearGradient></defs>
  <rect width="64" height="64" rx="12" fill="url(#g)" stroke="#2989d8" stroke-width="2"/>
  <path d="M18 20 L32 44 L46 20" fill="none" stroke="#f0f8ff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
writeFileSync(resolve(OUT, "favicon.svg"), svg);
console.log("✔ favicon.svg");
