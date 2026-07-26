/* =========================================================
   Quick build script: convert assets/og-image.svg → og-image.png
   Run: node scripts/build-og.mjs
   ========================================================= */

import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const inSvg  = join(root, 'assets', 'og-image.svg');
const outPng = join(root, 'assets', 'og-image.png');
const run = promisify(execFile);

await run('convert', ['-background', 'none', inSvg, outPng]);

console.log(`✓ wrote ${outPng}`);
