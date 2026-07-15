#!/usr/bin/env node
// Mint a new Apple Distribution certificate for the iOS release pipeline —
// no Mac and no Xcode needed. Uses the SAME App Store Connect API key (.p8)
// the release workflow already uses: the ASC API can create signing
// certificates directly, so the yearly renewal is this one command run from
// any machine with Node 22+ and `openssl` in PATH (on Windows, run it from
// Git Bash, which ships openssl).
//
// What it does:
//   1. generates a fresh RSA-2048 private key + CSR (openssl),
//   2. asks the App Store Connect API to issue an Apple Distribution
//      certificate for that CSR (JWT-authenticated with the .p8),
//   3. downloads the matching Apple WWDR intermediate and bundles
//      key + cert + chain into a password-protected .p12,
//   4. prints the base64 .p12 + password to paste into the
//      APPLE_DIST_CERT_P12_BASE64 / APPLE_DIST_CERT_PASSWORD repo secrets.
//
// Usage:
//   ASC_API_KEY_ID=ABC123 \
//   ASC_API_ISSUER_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx \
//   ASC_API_KEY_P8_PATH=/path/to/AuthKey_ABC123.p8 \
//   node scripts/ios-dist-cert.mjs
//
// Options (env):
//   ASC_API_KEY_P8_BASE64  alternative to ASC_API_KEY_P8_PATH (same base64 as
//                          the GitHub secret).
//   P12_PASSWORD           export password for the .p12; a random one is
//                          generated when unset.
// Options (flags):
//   --dry-run              generate key/CSR and sign the API JWT, but stop
//                          before calling Apple. Verifies the local toolchain.
//
// Notes:
//   - The ASC key must have the Admin role (same requirement as the release
//     workflow's cloud-managed profiles).
//   - Apple caps the number of live Apple Distribution certificates per team
//     (currently ~3). If creation fails with a limit error, revoke an expired
//     or unused one at developer.apple.com → Certificates first. Revoking a
//     cert does NOT affect apps already on the stores.
//   - Distribution certs live 1 year; expiry only blocks NEW uploads, never
//     shipped apps. When it expires: re-run this, update the two secrets.

import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const API = "https://api.appstoreconnect.apple.com/v1";
const dryRun = process.argv.includes("--dry-run");

const fail = (msg) => {
  console.error(`\nError: ${msg}`);
  process.exit(1);
};

// --- inputs ---------------------------------------------------------------
const keyId = process.env.ASC_API_KEY_ID;
const issuerId = process.env.ASC_API_ISSUER_ID;
if (!keyId || !issuerId)
  fail("set ASC_API_KEY_ID and ASC_API_ISSUER_ID (same values as the repo secrets).");

let p8;
if (process.env.ASC_API_KEY_P8_PATH) {
  p8 = fs.readFileSync(process.env.ASC_API_KEY_P8_PATH, "utf8");
} else if (process.env.ASC_API_KEY_P8_BASE64) {
  p8 = Buffer.from(process.env.ASC_API_KEY_P8_BASE64, "base64").toString("utf8");
} else {
  fail("set ASC_API_KEY_P8_PATH (path to the AuthKey .p8) or ASC_API_KEY_P8_BASE64.");
}
if (!p8.includes("BEGIN PRIVATE KEY")) fail("the .p8 content does not look like a PEM private key.");

// --- toolchain ------------------------------------------------------------
const openssl = (args, opts = {}) =>
  execFileSync("openssl", args, { stdio: ["ignore", "pipe", "pipe"], ...opts });
try {
  openssl(["version"]);
} catch {
  fail("`openssl` not found in PATH. On Windows, run this from Git Bash.");
}

// --- 1. fresh key + CSR ---------------------------------------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ios-dist-cert-"));
const keyPem = path.join(tmp, "key.pem");
const csrPem = path.join(tmp, "csr.pem");
openssl([
  "req", "-new", "-newkey", "rsa:2048", "-nodes",
  "-keyout", keyPem, "-out", csrPem,
  "-subj", "/CN=Running Coach CI Distribution",
]);
console.log("Generated RSA-2048 key + CSR.");

// --- 2. ASC API auth (ES256 JWT, hand-rolled — no deps) --------------------
const b64url = (buf) =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const now = Math.floor(Date.now() / 1000);
const header = b64url(JSON.stringify({ alg: "ES256", kid: keyId, typ: "JWT" }));
const payload = b64url(
  JSON.stringify({ iss: issuerId, iat: now, exp: now + 600, aud: "appstoreconnect-v1" })
);
let jwt;
try {
  const sig = crypto.sign("sha256", Buffer.from(`${header}.${payload}`), {
    key: crypto.createPrivateKey(p8),
    dsaEncoding: "ieee-p1363",
  });
  jwt = `${header}.${payload}.${b64url(sig)}`;
} catch (e) {
  fail(`could not sign the API JWT with the .p8 (is it the ASC key?): ${e.message}`);
}
console.log("Signed App Store Connect API token.");

if (dryRun) {
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("\n--dry-run: local toolchain OK (key, CSR, JWT). Stopping before the API call.");
  process.exit(0);
}

const asc = async (method, route, body) => {
  const res = await fetch(`${API}${route}`, {
    method,
    headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = (json.errors ?? [])
      .map((e) => `${e.title}: ${e.detail ?? ""}`)
      .join("; ");
    fail(`App Store Connect API ${method} ${route} → HTTP ${res.status}. ${detail}`);
  }
  return json;
};

// --- 3. show existing distribution certs, then create the new one ----------
const existing = await asc(
  "GET",
  "/certificates?filter[certificateType]=DISTRIBUTION&limit=10"
);
for (const c of existing.data ?? []) {
  console.log(
    `Existing Apple Distribution cert: serial ${c.attributes.serialNumber}, expires ${c.attributes.expirationDate}`
  );
}

const created = await asc("POST", "/certificates", {
  data: {
    type: "certificates",
    attributes: {
      certificateType: "DISTRIBUTION",
      csrContent: fs.readFileSync(csrPem, "utf8"),
    },
  },
});
const certB64 = created.data.attributes.certificateContent;
const serial = created.data.attributes.serialNumber;
const expires = created.data.attributes.expirationDate;
console.log(`\nApple issued certificate serial ${serial}, expires ${expires}.`);

const certPem = path.join(tmp, "cert.pem");
fs.writeFileSync(
  certPem,
  `-----BEGIN CERTIFICATE-----\n${certB64.match(/.{1,64}/g).join("\n")}\n-----END CERTIFICATE-----\n`
);

// --- 4. WWDR intermediate (so the .p12 carries the full chain) --------------
const issuerLine = openssl(["x509", "-in", certPem, "-noout", "-issuer"]).toString();
const g = issuerLine.match(/G(\d)/)?.[1] ?? "4";
const wwdrUrl = `https://www.apple.com/certificateauthority/AppleWWDRCAG${g}.cer`;
const wwdrPem = path.join(tmp, "wwdr.pem");
let chainArgs = [];
try {
  const der = Buffer.from(await (await fetch(wwdrUrl)).arrayBuffer());
  const wwdrDer = path.join(tmp, "wwdr.cer");
  fs.writeFileSync(wwdrDer, der);
  openssl(["x509", "-inform", "DER", "-in", wwdrDer, "-out", wwdrPem]);
  chainArgs = ["-certfile", wwdrPem];
  console.log(`Bundled WWDR G${g} intermediate into the chain.`);
} catch {
  console.warn(
    `Warning: could not fetch ${wwdrUrl}; packaging without the intermediate. ` +
      "If codesign later fails with a chain error, import the WWDR cert on the runner."
  );
}

// --- 5. assemble the .p12 ---------------------------------------------------
const password =
  process.env.P12_PASSWORD || crypto.randomBytes(18).toString("base64url");
const outName = `AppleDistribution-${expires?.slice(0, 10) ?? "new"}.p12`;
// Legacy PBE algorithms: OpenSSL 3's modern defaults are rejected by some
// macOS `security import` versions; SHA1-3DES imports everywhere.
openssl([
  "pkcs12", "-export",
  "-inkey", keyPem, "-in", certPem, ...chainArgs,
  "-keypbe", "PBE-SHA1-3DES", "-certpbe", "PBE-SHA1-3DES", "-macalg", "sha1",
  "-passout", `pass:${password}`,
  "-out", outName,
]);
fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\nWrote ${outName} (keep it safe or delete it after setting the secrets).`);
console.log("\nUpdate the two GitHub repo secrets:");
console.log("\nAPPLE_DIST_CERT_P12_BASE64:\n");
console.log(fs.readFileSync(outName).toString("base64"));
console.log(`\nAPPLE_DIST_CERT_PASSWORD:\n\n${password}`);
console.log(`\nThis certificate expires ${expires} — expiry only blocks new uploads, never shipped apps. Re-run this script and update the secrets when it does.`);
