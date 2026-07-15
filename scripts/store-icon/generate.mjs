// Renders the store icons from store-assets/play-store-icon.svg (a full-bleed
// square — both stores apply their own rounded mask):
//   - store-assets/play-store-icon-512.png    (Google Play high-res icon)
//   - ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png
//     (the Xcode single-size 1024x1024 app icon; must be opaque — App Store
//     Connect rejects icons with an alpha channel)
// The rounded browser favicon is public/favicon.svg; the in-app logo is
// src/components/BrandLogo.tsx; the Android launcher icon is the adaptive
// vector under android/.../res.
//
// Usage:  npm run store:icon   (alias: npm run ios:icon)
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
const OUTPUTS = [
  { out: join(repoRoot, "store-assets", "play-store-icon-512.png"), size: 512 },
  { out: join(repoRoot, "ios", "App", "App", "Assets.xcassets", "AppIcon.appiconset", "AppIcon-512@2x.png"), size: 1024 },
];

const svg = readFileSync(SRC);
for (const { out, size } of OUTPUTS) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: size },
    background: "white", // opaque; the artwork already fills the square edge-to-edge
  });
  const png = resvg.render().asPng();
  writeFileSync(out, png);

  // Sanity-check the output really is a size x size PNG.
  const w = png.readUInt32BE(16);
  const h = png.readUInt32BE(20);
  if (png[0] !== 0x89 || w !== size || h !== size) throw new Error(`Unexpected output: ${w}x${h}`);
  console.log(`Wrote ${out} (${w}x${h}, ${png.length} bytes)`);
}
