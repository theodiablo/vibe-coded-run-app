// Shared constants and presentational class strings used across the app.

// Keys for the cloud-backed per-user store (see src/db.js).
export const STORAGE_KEYS = {
  RUNS: "rc_runs",
  PLAN: "rc_plan",
  SETTINGS: "rc_settings",
  // User-visible, editable context sent to the AI coach for future chats.
  USER_CONTEXT: "rc_user_context",
  // Personal races layer: wishlist / completed participations + seen-badge set.
  // The race *catalogue* is NOT here — it's shared/heavy (a bundled seed in
  // Phase 1, a Supabase table in Phase 2); only per-user data lives in the blob.
  RACES: "rc_races",
};

export const USER_CONTEXT_MAX_CHARS = 2000;
export const USER_CONTEXT_WARN_CHARS = 1600;
export const USER_CONTEXT_NOTICE_CHARS = 1800;

// localStorage key for the in-progress live run buffer (crash/refresh recovery).
// Kept out of STORAGE_KEYS on purpose: it must NOT sync to the Supabase blob —
// it's high-frequency local scratch space, flushed only on a real save.
export const LIVE_RUN_KEY = "rc_live_run";

// localStorage flag: the user has seen and accepted the background-location
// prominent disclosure (native shell only). Set once per install so we show it
// before the first OS permission prompt but don't nag on every run.
export const BG_LOC_DISCLOSED_KEY = "rc_bg_loc_disclosed";

// ── Heart-rate sensor (native) — all PER-DEVICE, never in the synced blob ──
// The *method* preference (off/bluetooth/healthconnect) lives in synced settings
// (settings.hrMethod); the concrete paired device and one-shot UI flags are local
// because Bluetooth bonding is inherently per-device (a synced device id would
// show as "paired" on a phone where it isn't bonded). Mirrors the telemetry-
// consent / bg-disclosure decision to keep device-specific state out of the blob.
export const HR_DEVICE_KEY = "rc_hr_device";          // JSON {id,name} of the bonded BLE sensor
export const HR_BLE_DISCLOSED_KEY = "rc_hr_ble_disclosed"; // BLE permission disclosure seen
export const HR_HEALTH_CONNECT_AUTH_KEY = "rc_hr_healthconnect_auth"; // local HC permission was granted

// Public privacy policy (static page in public/privacy.html, served at the site
// root). Linked from the disclosure + login screen and required by the app stores
// for background-location apps.
export const PRIVACY_URL = "https://run.camboulive.solutions/privacy.html";

// Public health & safety / medical disclaimer (static page in public/disclaimer.html).
// Linked from the in-app onboarding disclaimer so the full version is reachable.
export const DISCLAIMER_URL = "https://run.camboulive.solutions/disclaimer.html";

// Version of the medical/liability disclaimer shown in onboarding. Stored
// alongside the user's acknowledgment (`settings.healthAck`) so a future change
// to the disclaimer copy can detect a stale acknowledgment and re-prompt. Bump
// this whenever the disclaimer wording materially changes.
export const DISCLAIMER_VERSION = "2026-06-1";

// Play Store listing — used by the in-app update prompt (see UpdatePrompt.jsx).
export const PLAY_STORE_URL =
  "https://play.google.com/store/apps/details?id=solutions.camboulive.run";

// Map basemap. A keyed free-tier provider (MapTiler) — raw OSM tiles aren't
// allowed for a multi-user app under the OSMF tile policy. Set VITE_MAPTILER_KEY
// (a publishable, domain-restricted client key) at build. No default key is
// baked in: shipping a real key in a public repo lets anyone drain the owner's
// quota. Without the env var the tracker still records — RouteMap just shows a
// "needs key" notice instead of tiles. Attribution stays visible per the OSM
// data licence.
export const MAP_KEY = import.meta.env.VITE_MAPTILER_KEY || "";
export const MAP_TILE_URL =
  "https://api.maptiler.com/maps/streets-v2/256/{z}/{x}/{y}.png?key=" + MAP_KEY;
export const MAP_ATTRIBUTION =
  '© <a href="https://www.maptiler.com/copyright/">MapTiler</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>';

export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// Per session-type text / border-background colour classes.
export const TCLR = {EASY:"text-emerald-400",TEMPO:"text-yellow-400",INTERVALS:"text-orange-400",LONG:"text-sky-400",RACE:"text-red-400",WALK:"text-cyan-400",OTHER:"text-violet-400"};
export const TBG  = {EASY:"border-emerald-500/30 bg-emerald-500/5",TEMPO:"border-yellow-500/30 bg-yellow-500/5",INTERVALS:"border-orange-500/30 bg-orange-500/5",LONG:"border-sky-500/30 bg-sky-500/5",RACE:"border-red-500/30 bg-red-500/5",WALK:"border-cyan-500/30 bg-cyan-500/5",OTHER:"border-violet-500/30 bg-violet-500/5"};

// Grade-adjust factor: each metre of climb counts as ~VERT_COST extra metres of
// flat running. Shared by the race predictions and the plan builder so the two
// agree on flat-equivalent distance. See flatEqKm in utils/predictions.js.
export const VERT_COST = 8;

// Shared Tailwind class strings for form controls, previously duplicated across
// several components.
export const INPUT_CLS = "w-full bg-slate-700 border border-slate-600 rounded-xl p-3 text-white text-sm focus:outline-none focus:border-orange-400 placeholder-slate-500";
export const LABEL_CLS = "block text-xs text-slate-400 mb-1.5";

// Colored accent bar per run type, shared by the dashboard and history list.
export const runBarColor = type => {
  if (type === "LONG")      return "bg-sky-400";
  if (type === "TEMPO")     return "bg-yellow-400";
  if (type === "INTERVALS") return "bg-orange-400";
  if (type === "RACE")      return "bg-red-400";
  if (type === "WALK")      return "bg-cyan-400";
  return "bg-emerald-400";
};
