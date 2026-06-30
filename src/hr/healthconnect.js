import { registerPlugin } from "@capacitor/core";
import { hrSummary } from "../utils/hr";

// Post-run heart-rate source: read a tracked run's HR series from Android Health
// Connect (the system aggregator most watches — incl. Amazfit/Zepp — sync into),
// for users without a live BLE sensor. Implements the PostRunHrSource contract
// (isAvailable / requestPermissions / fetchRange); useRunTracker never streams
// from it — LiveRunTracker calls fetchRange once on save (with a deferred retry,
// see flushPendingHr) because the watch may not have synced to Health Connect yet.
//
// Registered BY NAME (the BackgroundGeolocation precedent in geo/native.js): no
// JS dependency, so the web build stays green and nothing executes off-native.
// The Android shell must include a Health Connect Capacitor plugin exposing this
// surface; current community plugins lag Capacitor 8's peer range, so install the
// chosen one with --legacy-peer-deps and confirm it reads the HeartRate type.
const HealthConnect = registerPlugin("HealthConnectPlugin");

export const healthConnectSource = {
  id: "healthconnect",
  live: false,

  // True only when Health Connect is installed and the plugin responds. Defensive:
  // any throw (plugin absent, older device, web) → unavailable, never breaks UI.
  async isAvailable() {
    try {
      const r = await HealthConnect.checkAvailability();
      return r?.availability === "Available";
    } catch { return false; }
  },

  // Request read access to the HeartRate record type. Returns whether granted.
  async requestPermissions() {
    try {
      const r = await HealthConnect.requestHealthPermissions({ read: ["HeartRate"], write: [] });
      return !!(r?.hasAllPermissions ?? r?.grantedPermissions?.length);
    } catch { return false; }
  },

  // Read HeartRate samples in [startMs, endMs] and reduce to {hr,hrAvg,hrMax}.
  // Returns null when nothing is available yet (e.g. the watch hasn't synced) so
  // the caller can defer and retry rather than store a bogus zero.
  async fetchRange(startMs, endMs) {
    try {
      const res = await HealthConnect.readRecords({
        type: "HeartRate",
        timeRangeFilter: {
          type: "between",
          startTime: new Date(startMs).toISOString(),
          endTime: new Date(endMs).toISOString(),
        },
      });
      const samples = (res?.records || []).flatMap(rec => rec.samples || []);
      if (!samples.length) return null;
      // Reuse the same reducer the live path uses (latest is meaningless post-run,
      // so only hrAvg/hrMax matter to callers).
      return hrSummary(samples.map(s => ({ bpm: s.beatsPerMinute, t: +new Date(s.time) })));
    } catch { return null; }
  },
};

// Deferred relink, mirroring routes.js/flushPendingRoutes: on app load, retry the
// HC fetch for any run stamped with `hrPending:{start,end}` (saved before the
// watch had synced). `patch(runId, {hr,hrMax})` applies the result and clears the
// pending marker; runs that still have no data are left for the next load.
export async function flushPendingHr(runs, patch) {
  const pending = (runs || []).filter(r => r.hrPending);
  if (!pending.length) return;
  if (!(await healthConnectSource.isAvailable())) return;
  for (const r of pending) {
    const s = await healthConnectSource.fetchRange(r.hrPending.start, r.hrPending.end);
    if (s && s.hrAvg) patch(r.id, { hr: s.hrAvg, hrMax: s.hrMax });
  }
}
