// Regenerates store-assets/feature-graphic-1024x500.png (the Google Play
// "Feature graphic" / "Gráfico de funciones") from src/marketing/copy.json +
// scripts/feature-graphic/template.html, so the banner can never drift from the
// marketing page's hero copy.
//
// Usage:  npm run store:feature
//
// Needs a Chromium/Chrome binary. It is located in this order:
//   1. $CHROME_BIN               (CI sets this via browser-actions/setup-chrome)
//   2. a Playwright chromium under $PLAYWRIGHT_BROWSERS_PATH (dev sandboxes)
//   3. common system paths (google-chrome / chromium)
// No npm dependencies — just Node builtins shelling out to the browser.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readdirSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const OUT = join(repoRoot, "store-assets", "feature-graphic-1024x500.png");
const WIDTH = 1024;
const HEIGHT = 500;

const escapeHtml = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

function findChrome() {
  if (process.env.CHROME_BIN && existsSync(process.env.CHROME_BIN)) {
    return process.env.CHROME_BIN;
  }
  // Playwright-style install (dev sandbox): pick the newest chromium build.
  const pwRoot = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (pwRoot && existsSync(pwRoot)) {
    const candidates = readdirSync(pwRoot)
      .filter((d) => d.startsWith("chromium-"))
      .map((d) => join(pwRoot, d, "chrome-linux", "chrome"))
      .filter((p) => existsSync(p));
    if (candidates.length) return candidates.sort().reverse()[0];
  }
  const system = [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  for (const p of system) if (existsSync(p)) return p;
  throw new Error(
    "No Chrome/Chromium found. Set CHROME_BIN to a Chrome binary and retry.",
  );
}

function buildHtml() {
  const copy = JSON.parse(
    readFileSync(join(repoRoot, "src", "marketing", "copy.json"), "utf8"),
  );
  const template = readFileSync(join(here, "template.html"), "utf8");
  const pills = (copy.ogPills || [])
    .map((label) => `<div class="pill">${escapeHtml(label)}</div>`)
    .join("");
  return template
    .replace("{{BRAND}}", escapeHtml(copy.brand))
    .replace("{{HERO1}}", escapeHtml(copy.heroLine1))
    .replace("{{HERO2}}", escapeHtml(copy.heroLine2))
    .replace("{{TAGLINE}}", escapeHtml(copy.ogTagline))
    .replace("{{PILLS}}", pills);
}

function main() {
  const chrome = findChrome();
  const workDir = mkdtempSync(join(tmpdir(), "feature-graphic-"));
  const htmlPath = join(workDir, "card.html");
  writeFileSync(htmlPath, buildHtml());

  execFileSync(
    chrome,
    [
      "--headless",
      "--no-sandbox",
      "--disable-gpu",
      "--force-device-scale-factor=1",
      "--hide-scrollbars",
      `--window-size=${WIDTH},${HEIGHT}`,
      `--screenshot=${OUT}`,
      `file://${htmlPath}`,
    ],
    { stdio: "ignore" },
  );

  // Sanity-check the output really is a 1024x500 PNG.
  const png = readFileSync(OUT);
  const isPng = png.length > 24 && png[0] === 0x89 && png[1] === 0x50;
  const w = png.readUInt32BE(16);
  const h = png.readUInt32BE(20);
  if (!isPng || w !== WIDTH || h !== HEIGHT) {
    throw new Error(`Unexpected output: isPng=${isPng} ${w}x${h}`);
  }
  console.log(`Wrote ${OUT} (${w}x${h}, ${png.length} bytes) using ${chrome}`);
}

main();
