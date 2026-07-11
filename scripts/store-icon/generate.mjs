// Renders the 512x512 Google Play high-res icon from store-assets/play-store-icon.svg
// (a full-bleed square — Play Console applies its own rounded mask). The rounded
// browser favicon is public/favicon.svg; the in-app logo is src/components/BrandLogo.tsx;
// the Android launcher icon is the adaptive vector under android/.../res.
//
// Usage:  npm run store:icon
//
// Uses @resvg/resvg-js (a self-contained Rust SVG rasterizer, no system deps) so
// the output is an exact-size PNG — unlike a headless-browser screenshot, which
// scaled the canvas and left a white gap.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Resvg } = require("@resvg/resvg-js");

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const SRC = join(repoRoot, "store-assets", "play-store-icon.svg");
const OUT = join(repoRoot, "store-assets", "play-store-icon-512.png");
const SIZE = 512;

const resvg = new Resvg(readFileSync(SRC), {
  fitTo: { mode: "width", value: SIZE },
  background: "white", // opaque; the artwork already fills the square edge-to-edge
});
const png = resvg.render().asPng();
writeFileSync(OUT, png);

// Sanity-check the output really is a SIZExSIZE PNG.
const w = png.readUInt32BE(16);
const h = png.readUInt32BE(20);
if (png[0] !== 0x89 || w !== SIZE || h !== SIZE) throw new Error(`Unexpected output: ${w}x${h}`);
console.log(`Wrote ${OUT} (${w}x${h}, ${png.length} bytes)`);
