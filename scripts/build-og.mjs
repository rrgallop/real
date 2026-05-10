/* =========================================================
   Quick build script: convert assets/og-image.svg → og-image.png
   Run: node scripts/build-og.mjs
   ========================================================= */

import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const inSvg  = join(root, 'assets', 'og-image.svg');
const outPng = join(root, 'assets', 'og-image.png');

const svg = await readFile(inSvg);

await sharp(svg, { density: 144 })
  .resize(1200, 630)
  .png({ quality: 92, compressionLevel: 9 })
  .toFile(outPng);

console.log(`✓ wrote ${outPng}`);
