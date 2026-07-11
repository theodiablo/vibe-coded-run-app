// Renders the 512x512 Google Play high-res icon from store-assets/play-store-icon.svg
// (a full-bleed square — Play Console applies its own rounded mask). The rounded
// browser favicon is public/favicon.svg; the in-app logo is src/components/BrandLogo.tsx;
// the Android launcher icon is the adaptive vector under android/.../res.
//
// Usage:  npm run store:icon      (needs a Chrome/Chromium binary — see below)

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const SRC = join(repoRoot, "store-assets", "play-store-icon.svg");
const OUT = join(repoRoot, "store-assets", "play-store-icon-512.png");
const SIZE = 512;

function findChrome() {
  if (process.env.CHROME_BIN && existsSync(process.env.CHROME_BIN)) return process.env.CHROME_BIN;
  const pwRoot = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (pwRoot && existsSync(pwRoot)) {
    const c = readdirSync(pwRoot)
      .filter((d) => d.startsWith("chromium-"))
      .map((d) => join(pwRoot, d, "chrome-linux", "chrome"))
      .filter((p) => existsSync(p));
    if (c.length) return c.sort().reverse()[0];
  }
  for (const p of ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"]) {
    if (existsSync(p)) return p;
  }
  throw new Error("No Chrome/Chromium found. Set CHROME_BIN to a Chrome binary and retry.");
}

const chrome = findChrome();
execFileSync(
  chrome,
  [
    "--headless",
    "--no-sandbox",
    "--disable-gpu",
    "--force-device-scale-factor=1",
    "--hide-scrollbars",
    `--window-size=${SIZE},${SIZE}`,
    `--screenshot=${OUT}`,
    `file://${SRC}`,
  ],
  { stdio: "ignore" },
);

const png = readFileSync(OUT);
const w = png.readUInt32BE(16);
const h = png.readUInt32BE(20);
if (png[0] !== 0x89 || w !== SIZE || h !== SIZE) throw new Error(`Unexpected output: ${w}x${h}`);
console.log(`Wrote ${OUT} (${w}x${h}, ${png.length} bytes) using ${chrome}`);
