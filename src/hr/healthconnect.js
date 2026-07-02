import { hrSummary } from "../utils/hr";

// Post-run heart-rate source: read a tracked run's HR from Android Health Connect
// (the system aggregator most watches — incl. Amazfit/Zepp — sync into), for users
// without a live BLE sensor. Implements the PostRunHrSource contract (isAvailable /
// requestPermissions / fetchRange); useRunTracker never streams from it —
// LiveRunTracker calls fetchRange once on save, with a deferred retry (flushPendingHr)
// because the watch may not have synced to Health Connect yet.
//
// Backed by @pianissimoproject/capacitor-health-connect. Chosen over the Cap-8-native
// flomentum plugin because its readRecords reads **continuous** HeartRateSeries over an
// arbitrary window — so the user does NOT have to also log a workout on the watch; the
// watch's all-day HR sync is enough. Trade-off: its peer is @capacitor/core ^7, so it's
// installed with --legacy-peer-deps; Cap-7 native code almost certainly builds against
// Cap 8 (stable Android plugin API), but confirm with an on-device/CI Android build.
//
// Load the plugin lazily so merely rendering the app after sign-in cannot touch
// the native Health Connect bridge. Some devices/versions are sensitive to the
// Cap-7 plugin under Cap-8; failures are treated as unavailable.
async function getHealthConnect() {
  const mod = await import("@pianissimoproject/capacitor-health-connect");
  return { plugin: mod.HealthConnect };
}

// Raw Health Connect availability: "Available" | "NotInstalled" | "NotSupported".
// Defensive: any throw (plugin absent, older device, web) → "NotSupported", so the
// UI can give an accurate, actionable message instead of a dead end.
async function availability() {
  try { return (await (await getHealthConnect()).plugin.checkAvailability())?.availability || "NotSupported"; }
  catch { return "NotSupported"; }
}

// True only when Health Connect is installed and responds.
async function isAvailable() { return (await availability()) === "Available"; }

export const healthConnectSource = {
  id: "healthconnect",
  live: false,
  isAvailable,
  availability,

  // Request read access to heart rate. Returns whether it was granted.
  async requestPermissions() {
    try {
      const r = await (await getHealthConnect()).plugin.requestHealthPermissions({ read: ["HeartRateSeries"], write: [] });
      return !!(r?.hasAllPermissions || r?.grantedPermissions?.length);
    } catch { return false; }
  },

  // Non-prompting check of whether heart-rate read is already granted — used to
  // show connection status in Settings without popping the OS dialog.
  async checkPermissions() {
    try {
      const r = await (await getHealthConnect()).plugin.checkHealthPermissions({ read: ["HeartRateSeries"], write: [] });
      return !!(r?.hasAllPermissions || r?.grantedPermissions?.length);
    } catch { return false; }
  },

  // Read HeartRateSeries records in [startMs, endMs], flatten to samples inside the
  // window, and reduce to {hr,hrAvg,hrMax}. Returns null when nothing is available yet
  // (watch not synced) so the caller can defer and retry.
  async fetchRange(startMs, endMs) {
    try {
      const res = await (await getHealthConnect()).plugin.readRecords({
        type: "HeartRateSeries",
        timeRangeFilter: { type: "between", startTime: new Date(startMs), endTime: new Date(endMs) },
      });
      const samples = (res?.records || [])
        .flatMap(rec => rec.samples || [])
        .map(s => ({ bpm: s.beatsPerMinute, t: +new Date(s.time) }))
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
  // A run whose HR was filled some other way (manual edit) since it was stamped:
  // never overwrite it — just clear the marker so it stops retrying. patch({}) with
  // no HR fields lets the caller drop hrPending without touching hr/hrMax.
  const resolved = pending.filter(r => r.hr != null);
  for (const r of resolved) patch(r.id, {});
  const stillPending = pending.filter(r => r.hr == null);
  if (!stillPending.length) return;
  if (!(await isAvailable())) return; // HC not installed/permitted — leave for next load
  for (const r of stillPending) {
    const s = await healthConnectSource.fetchRange(r.hrPending.start, r.hrPending.end);
    if (s && s.hrAvg) patch(r.id, { hr: s.hrAvg, hrMax: s.hrMax });
  }
}
