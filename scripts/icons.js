#!/usr/bin/env node
// Redraws the home-screen icons from public/favicon.svg. Run it after changing the favicon or the
// brand colour: node scripts/icons.js
//
// An installed app needs raster icons at fixed sizes, which is why these are committed rather than
// generated during the build: nothing about them changes between deploys, and a build step that
// needs sharp is a build step that can fail on a host without it.
import { mkdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const out = new URL('../public/icons/', import.meta.url);
const background = '#5a45e0';

/**
 * The favicon draws its own rounded corners, which is right in a browser tab and wrong everywhere
 * else: Android crops a maskable icon to whatever shape the launcher prefers and iOS rounds it
 * itself, so a second set of corners inside theirs reads as a sticker of an icon rather than an
 * icon. These redraw the glyph alone on a square that bleeds to the edges and let the platform cut
 * the shape.
 *
 * `inset` is the share of the canvas left empty around the glyph. Android only guarantees the
 * middle 80% of a maskable icon survives the crop, so that one is drawn well inside the circle it
 * may become.
 */
const glyph = inset => {
  const scale = 1 - inset * 2;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">
       <rect width="40" height="40" fill="${background}"/>
       <g transform="translate(${40 * inset} ${40 * inset}) scale(${scale})">
         <rect x="11" y="8" width="17" height="23" rx="3" fill="none" stroke="white" stroke-width="2.5" transform="rotate(-12 20 20)"/>
         <path d="M17 17h7m-7 5h5" stroke="white" stroke-width="2.5" stroke-linecap="round"/>
       </g>
     </svg>`,
  );
};

// `any` icons are shown whole, so they only need enough room not to touch the edges. `maskable` is
// cropped. Apple applies its own rounding and ignores transparency, hence the same full-bleed square.
const icons = [
  ['icon-192.png', 192, 0.06],
  ['icon-512.png', 512, 0.06],
  ['icon-maskable-512.png', 512, 0.18],
  ['apple-touch-icon.png', 180, 0.08],
];

await mkdir(out, { recursive: true });
for (const [file, size, inset] of icons) {
  // density is set from the size because sharp rasterises SVG at 72dpi by default, which would
  // render the 40-unit viewBox at 40px and then upscale it into a blur.
  const png = await sharp(glyph(inset), { density: (72 * size) / 40 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer();
  await writeFile(new URL(file, out), png);
  console.log(`${file}  ${size}x${size}  ${png.length} bytes`);
}
