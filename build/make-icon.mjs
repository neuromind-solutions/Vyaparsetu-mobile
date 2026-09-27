/**
 * Rasterize the app's SVG favicon into build/icon.png (512×512) — the source
 * electron-builder converts into the Windows .ico for the window and installer.
 *
 * The committed build/icon.png is what the installer build actually consumes, so
 * this script only needs re-running (`npm run make-icon`) when favicon.svg changes.
 * sharp is a devDependency and is never bundled into the shipped app.
 */

import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const svgPath = path.join(here, '..', 'frontend', 'public', 'favicon.svg');
const outPath = path.join(here, 'icon.png');

const SIZE = 512;
const PAD = 56; // transparent margin so the glyph is not edge-to-edge
const transparent = { r: 0, g: 0, b: 0, alpha: 0 };

// density lifts the tiny (48×46) source SVG to a high-res raster before scaling,
// so the upscaled icon stays crisp. contain to an inner square keeps the aspect,
// then extend pads out to an exact 512×512 canvas.
await sharp(readFileSync(svgPath), { density: 384 })
  .resize(SIZE - PAD * 2, SIZE - PAD * 2, { fit: 'contain', background: transparent })
  .extend({ top: PAD, bottom: PAD, left: PAD, right: PAD, background: transparent })
  .png()
  .toFile(outPath);

console.log(`Wrote ${outPath} (${SIZE}x${SIZE})`);
