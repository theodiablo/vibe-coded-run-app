import { healthConnectSource } from "../hr/healthconnect";
import { watchImportSource } from "../watch/import";
import type { WatchImportAvailability } from "../watch/plugin";

// The app reads two kinds of data from Android Health Connect, historically
// behind two separate connect flows:
//   • post-run heart rate   (src/hr/healthconnect.ts — pianissimo plugin, HeartRateSeries)
//   • finished exercise runs (src/watch/import.ts    — WatchImport plugin, Exercise/Distance/Elevation/HR)
// But Health Connect permissions are granted per *app*, not per plugin, and its
// consent screen lists whatever record types the request asks for. Requesting
// the two scope sets from two buttons meant a user connected "Health Connect"
// for heart rate and never saw — or granted — the exercise/distance/elevation
// scopes, so activity never synced.
//
// connectHealthConnect() is the single entry point both settings screens now use:
// it asks for EVERYTHING the app reads on one consent screen (the WatchImport
// plugin already lists all four record types) and then reconciles each feature's
// device-local grant marker against reality, so a partial grant (e.g. the user
// unticks Exercise but keeps Heart rate) is reflected accurately per feature.
// Never throws.

export type HealthConnectGrant = {
  availability: WatchImportAvailability;
  // Heart-rate read granted — powers the "Health Connect" HR method (live runs).
  heartRate: boolean;
  // Exercise + distance + elevation (+ HR) read granted — powers watch run import.
  activity: boolean;
};

export async function connectHealthConnect(): Promise<HealthConnectGrant> {
  // Both plugins query the same underlying Health Connect SDK status; use one.
  const availability = await watchImportSource.availability();

  if (availability === "NotSupported") {
    return { availability, heartRate: false, activity: false };
  }

  if (availability === "NotInstalled") {
    // Health Connect is missing / needs an update. Only the pianissimo HR plugin
    // knows how to open Google Play for it (the WatchImport plugin can't); route
    // through it so the user has a way forward, then they reconnect for the full
    // scope set once it's installed. It requests heart rate only, so activity
    // can't be granted through this bootstrap path.
    let heartRate = false;
    try { heartRate = await healthConnectSource.requestPermissions(); } catch { /* best-effort install redirect */ }
    return { availability, heartRate, activity: false };
  }

  // Available → one consent screen for every scope the app reads.
  try { await watchImportSource.requestPermissions(); } catch { /* result read back below */ }

  // Reconcile each feature independently against the real grant. Each check syncs
  // its own device-local marker (HR_HEALTH_CONNECT_AUTH_KEY / WATCH_HC_AUTH_KEY),
  // so both features light up from this single connection — and a scope the user
  // declined leaves only that feature's marker cleared.
  const [heartRate, activity] = await Promise.all([
    healthConnectSource.checkPermissions(),
    watchImportSource.checkPermissions(),
  ]);
  return { availability, heartRate, activity };
}
