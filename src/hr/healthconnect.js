import { Health } from "@flomentumsolutions/capacitor-health-extended";
import { hrSummary } from "../utils/hr";

// Post-run heart-rate source: read a tracked run's HR from Android Health Connect
// (the system aggregator most watches — incl. Amazfit/Zepp — sync into), for users
// without a live BLE sensor. Implements the PostRunHrSource contract (isAvailable /
// requestPermissions / fetchRange); useRunTracker never streams from it —
// LiveRunTracker calls fetchRange once on save, with a deferred retry (flushPendingHr)
// because the watch may not have synced to Health Connect yet.
//
// Backed by @flomentumsolutions/capacitor-health-extended (Capacitor-8 native). Its
// `Health` JS export is bundled but only runs on native — getHrSource returns null on
// web (source.js) and every call here is wrapped, so the web build is unaffected.
//
// We read HR from *workout* sessions rather than the aggregated API: Android's
// queryAggregated only supports whole-day buckets (a day-average, not this run), while
// queryWorkouts(includeHeartRate) returns raw {timestamp,bpm} samples we scope to the
// run's window and reduce to avg+max. So Health-Connect HR requires the watch to have
// logged an exercise session overlapping the run (the normal case when running with a
// watch); continuous wear without a workout won't surface here.

// True only when Health Connect is installed and responds. Defensive: any throw
// (plugin absent, older device, web) → unavailable, never breaks the UI.
async function isAvailable() {
  try { return !!(await Health.isHealthAvailable())?.available; }
  catch { return false; }
}

export const healthConnectSource = {
  id: "healthconnect",
  live: false,
  isAvailable,

  // Request read access to heart rate and workouts (both are needed to read HR
  // out of a workout session). Returns whether both were granted.
  async requestPermissions() {
    try {
      const r = await Health.requestHealthPermissions({ permissions: ["READ_HEART_RATE", "READ_WORKOUTS"] });
      const p = r?.permissions || {};
      return !!(p.READ_HEART_RATE && p.READ_WORKOUTS);
    } catch { return false; }
  },

  // Read workout HR samples overlapping [startMs, endMs], keep those inside the
  // window, and reduce to {hr,hrAvg,hrMax}. Returns null when nothing is available
  // yet (watch not synced / no workout) so the caller can defer and retry.
  async fetchRange(startMs, endMs) {
    try {
      const res = await Health.queryWorkouts({
        startDate: new Date(startMs).toISOString(),
        endDate: new Date(endMs).toISOString(),
        includeHeartRate: true,
        includeRoute: false,
        includeSteps: false,
      });
      const samples = (res?.workouts || [])
        .flatMap(w => w.heartRate || [])
        .map(s => ({ bpm: s.bpm, t: +new Date(s.timestamp) }))
        .filter(s => s.bpm && s.t >= startMs && s.t <= endMs);
      if (!samples.length) return null;
      return hrSummary(samples);
    } catch { return null; }
  },
};

// Deferred relink, mirroring routes.js/flushPendingRoutes: on app load, retry the
// Health Connect fetch for any run stamped with `hrPending:{start,end}` (saved before
// the watch had synced). `patch(runId, {hr,hrMax})` applies the result and clears the
// pending marker; runs that still have no data are left for the next load.
export async function flushPendingHr(runs, patch) {
  const pending = (runs || []).filter(r => r.hrPending);
  if (!pending.length) return;
  if (!(await isAvailable())) return;
  for (const r of pending) {
    const s = await healthConnectSource.fetchRange(r.hrPending.start, r.hrPending.end);
    if (s && s.hrAvg) patch(r.id, { hr: s.hrAvg, hrMax: s.hrMax });
  }
}
