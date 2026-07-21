import { supabase } from "../../supabase";
import { isNative } from "../../native";
import { parseActivityFile } from "../../utils/gpx";
import { POLAR_STATE, POLAR_CODE_KEY } from "../../polarPreinit";
import type { ImportProvider, ImportedRun } from "../types";

// Polar (AccessLink) cloud import — the first real vendor-cloud provider, for
// runners who leave the phone at home. The secret half (OAuth token exchange +
// exercise pull) lives in the `polar-import` edge function; this client only
// starts the OAuth redirect and maps the finished exercises the server returns.
//
// Dormant until configured: without VITE_POLAR_CLIENT_ID the provider's
// isAvailable() is false, so nothing renders and no request is made — exactly
// like garminCloudProvider. Activation steps: docs/integrations-polar.md.
//
// GPX (route + HR extensions) is parsed by the app's existing, tested
// parseActivityFile — the same path a user-picked .gpx takes — so a Polar import
// gets the same map/pace/HR-series/zone detail (persistImportedRoute folds the
// HR stream into stats.hrSamples). A summary-only exercise (indoor, no GPS) still
// imports its totals.

const POLAR_CLIENT_ID = import.meta.env?.VITE_POLAR_CLIENT_ID as string | undefined;
const POLAR_AUTH_URL = "https://flow.polar.com/oauth2/authorization";
// POLAR_STATE distinguishes our OAuth return from Supabase's own ?code= flow; it
// and POLAR_CODE_KEY live in polarPreinit (the one place that reads the return).
export const polarEnabled = !!POLAR_CLIENT_ID;

// Where Polar sends the browser back after authorization — must exactly match the
// redirect URL registered in the Polar app. The app root; the return is detected
// by the `state` marker, so it never collides with Supabase's PKCE ?code=.
const redirectUri = () => (typeof window !== "undefined" ? window.location.origin + "/" : "");

type Invoke = { action: string; [k: string]: unknown };
async function invoke<T>(body: Invoke): Promise<T | null> {
  try {
    const { data, error } = await supabase.functions.invoke("polar-import", { body });
    if (error) return null;
    return data as T;
  } catch { return null; }
}

// Sports we import as runs (Polar `detailed-sport-info` / `sport`). Anything else
// (cycling, swimming…) is skipped. Walking/hiking → WALK, the rest → EASY.
const WALK_SPORTS = new Set(["WALKING", "HIKING", "NORDIC_WALKING"]);
const RUN_SPORTS = new Set(["RUNNING", "JOGGING", "TRAIL_RUNNING", "ROAD_RUNNING", "TREADMILL_RUNNING", "TRACK_AND_FIELD_RUNNING"]);

// ISO-8601 duration ("PT1H2M3S" / "PT45M30.5S") → seconds.
function parseIsoDuration(v: unknown): number {
  if (typeof v !== "string") return 0;
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(v);
  if (!m) return 0;
  return Math.round((+(m[1] || 0)) * 3600 + (+(m[2] || 0)) * 60 + (+(m[3] || 0)));
}

type PolarExercise = { id: string; summary?: Record<string, unknown>; gpx?: string | null };

// One Polar exercise → an ImportedRun, or null when it isn't a run/walk. Prefer
// the GPX (full route + HR series via the shared parser); fall back to the JSON
// summary's totals for a routeless (indoor) exercise.
export function polarExerciseToRun(ex: PolarExercise): ImportedRun | null {
  const s = ex.summary || {};
  const sport = String(s["detailed-sport-info"] ?? s["sport"] ?? "").toUpperCase();
  const isWalk = WALK_SPORTS.has(sport);
  const isRun = RUN_SPORTS.has(sport);
  // If the sport is known and not a run/walk, skip; if unknown, allow (a GPX/
  // distance still makes it importable — the user can re-type it).
  if (sport && !isWalk && !isRun) return null;
  const type = isWalk ? "WALK" : "EASY";
  const extId = "polar:" + ex.id;
  const startedAt = typeof s["start-time"] === "string" ? (s["start-time"] as string) : undefined;

  if (ex.gpx) {
    const res = parseActivityFile(ex.gpx, "gpx");
    if ("run" in res && res.run) {
      return {
        ...res.run,
        type,
        source: "watch",
        notes: "Imported from Polar",
        extId,
        ...(startedAt ? { startedAt } : {}),
      };
    }
    // GPX unparseable — fall through to the summary.
  }

  const km = Math.round((Number(s["distance"]) || 0) / 1000 * 100) / 100;
  if (km < 0.05) return null; // no usable distance and no route
  const durationSec = parseIsoDuration(s["duration"]) || 0;
  const hrObj = (s["heart-rate"] || {}) as Record<string, unknown>;
  const date = startedAt ? startedAt.slice(0, 10) : "";
  if (!date) return null;
  return {
    date,
    type,
    km,
    durationSec,
    hr: hrObj["average"] != null ? Math.round(Number(hrObj["average"])) : null,
    hrMax: hrObj["maximum"] != null ? Math.round(Number(hrObj["maximum"])) : null,
    effort: 5,
    source: "watch",
    notes: "Imported from Polar",
    extId,
    ...(startedAt ? { startedAt } : {}),
  };
}

// Kick off the OAuth authorization redirect (full-page). Completion happens on
// return via completePolarAuth() at app boot. Returns false because the page
// navigates away — the Integrations UI reflects isConnected() after the return.
async function connect(): Promise<boolean> {
  if (!polarEnabled || typeof window === "undefined") return false;
  const url = new URL(POLAR_AUTH_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", POLAR_CLIENT_ID!);
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("scope", "accesslink.read_all");
  url.searchParams.set("state", POLAR_STATE);
  window.location.assign(url.toString());
  return false;
}

// Called once at app boot: if this load was a Polar OAuth return, polarPreinit
// has already stashed the code in sessionStorage (and stripped the URL before
// Supabase could touch it). Exchange it server-side for a stored token. Gated so
// it's a no-op on every normal load and when Polar is unconfigured. Returns true
// when a connection was just established (caller can toast / trigger a scan).
export async function completePolarAuth(): Promise<boolean> {
  if (!polarEnabled || typeof window === "undefined") return false;
  let code: string | null = null;
  try { code = sessionStorage.getItem(POLAR_CODE_KEY); } catch { code = null; }
  if (!code) return false;
  // Consume it once so a reload can't re-trigger the exchange.
  try { sessionStorage.removeItem(POLAR_CODE_KEY); } catch { /* ignore */ }
  const res = await invoke<{ connected?: boolean }>({ action: "exchange", code, redirectUri: redirectUri() });
  return !!res?.connected;
}

export const polarProvider: ImportProvider = {
  id: "polar",
  label: "Polar",
  kind: "cloud",
  // Web-only for now: connect() is a full-page OAuth redirect, which would
  // navigate a native Capacitor webview away from the app. Native support is a
  // follow-up using the existing deep-link return (AUTH_DEEP_LINK), landing with
  // Suunto. Cloud sync is most useful the moment the runner opens the web app.
  platform: "web",
  isAvailable: () => polarEnabled && !isNative,
  isConnected: async () => {
    if (!polarEnabled) return false;
    const res = await invoke<{ connected?: boolean }>({ action: "status" });
    return !!res?.connected;
  },
  connect,
  disconnect: () => { void invoke({ action: "disconnect" }); },
  // Polar's transaction pull returns only new (un-consumed) exercises, so the
  // local run list / window aren't needed — the registry dedupes on extId.
  scan: async () => {
    if (!polarEnabled) return [];
    const res = await invoke<{ exercises?: PolarExercise[] }>({ action: "sync" });
    const exercises = res?.exercises || [];
    const out: ImportedRun[] = [];
    for (const ex of exercises) {
      if (!ex?.id) continue;
      const run = polarExerciseToRun(ex);
      if (run) out.push(run);
    }
    return out;
  },
  help:
    "Connect your Polar account to import finished runs (route, pace, elevation and " +
    "heart-rate) recorded on your Polar watch, even when you leave your phone at home.",
};
