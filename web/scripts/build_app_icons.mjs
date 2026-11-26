#!/usr/bin/env node
// Writes the app's raster icons from the one approved mark (public/icon.svg, and its full-bleed
// form public/icon-maskable.svg): three bars in on-primary #ffffff on primary #065f46. The PNGs
// and favicon.ico are committed, so the build never runs this; run it after changing either SVG,
// and brand.test.mjs checks the committed files are exactly what it writes.
//   node scripts/build_app_icons.mjs [--out public]
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { Resvg } from "@resvg/resvg-js";

const PUBLIC = join(import.meta.dirname, "..", "public");
const SOURCE = "icon.svg";
const MASKABLE_SOURCE = "icon-maskable.svg";
// [file, source, side in px]
const PNGS = [
  ["icon-192.png", SOURCE, 192],
  ["icon-512.png", SOURCE, 512],
  ["icon-maskable-512.png", MASKABLE_SOURCE, 512],
  ["apple-touch-icon.png", MASKABLE_SOURCE, 180],
];
const FAVICON_SIDES = [16, 32, 48];
const ICO_HEADER_BYTES = 6;
const ICO_ENTRY_BYTES = 16;
const ICO_LARGEST_SIDE = 256;

/**
 * Render an SVG file to a square PNG.
 *
 * @param {string} source The SVG's file name in public/.
 * @param {number} side The PNG's width and height in px.
 * @returns {Buffer} The PNG.
 */
function render(source, side) {
  const svg = readFileSync(join(PUBLIC, source), "utf8");
  return new Resvg(svg, { fitTo: { mode: "width", value: side } }).render().asPng();
}

/**
 * An ICO file holding PNG images, which every current browser reads.
 *
 * @param {{side: number, png: Buffer}[]} images The images, smallest first.
 * @returns {Buffer} The ICO.
 */
function ico(images) {
  const header = Buffer.alloc(ICO_HEADER_BYTES);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = ICO_HEADER_BYTES + ICO_ENTRY_BYTES * images.length;
  const entries = images.map(({ side, png }) => {
    const entry = Buffer.alloc(ICO_ENTRY_BYTES);
    // A side of 256 is written as 0.
    entry.writeUInt8(side % ICO_LARGEST_SIDE, 0);
    entry.writeUInt8(side % ICO_LARGEST_SIDE, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images.map(({ png }) => png)]);
}

/**
 * Write every icon into the target folder.
 *
 * Side effects: writes four PNGs and favicon.ico.
 *
 * @returns {void}
 */
function main() {
  const { values } = parseArgs({ options: { out: { type: "string", default: PUBLIC } } });
  for (const [file, source, side] of PNGS)
    writeFileSync(join(values.out, file), render(source, side));
  const favicon = ico(FAVICON_SIDES.map((side) => ({ side, png: render(SOURCE, side) })));
  writeFileSync(join(values.out, "favicon.ico"), favicon);
  console.log(`build_app_icons: wrote ${PNGS.length} PNGs and favicon.ico`);
}

main();
