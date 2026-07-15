import { hrSummary } from "../utils/hr";
import { isAndroid } from "../native";
import { HR_HEALTH_CONNECT_AUTH_KEY } from "../constants";
import { flushPendingHrFor, HR_PENDING_MAX_AGE_MS, type PatchHr, type PendingHrRun } from "./pending";

export { HR_PENDING_MAX_AGE_MS };

type HealthConnectAvailability = "Available" | "NotInstalled" | "NotSupported";
type PermissionResult = { hasAllPermissions?: boolean; grantedPermissions?: unknown[] };
type HeartRateSampleRecord = { beatsPerMinute?: number; time: string | Date };
type HeartRateSeriesRecord = { samples?: HeartRateSampleRecord[] };
type HealthConnectPlugin = {
  checkAvailability: () => Promise<{ availability?: HealthConnectAvailability }>;
  requestHealthPermissions: (options: unknown) => Promise<PermissionResult>;
  checkHealthPermissions: (options: unknown) => Promise<PermissionResult>;
  readRecords: (options: unknown) => Promise<{ records?: HeartRateSeriesRecord[] }>;
};
export function hasHealthConnectAuthorization() {
  try { return localStorage.getItem(HR_HEALTH_CONNECT_AUTH_KEY) === "1"; }
  catch { return false; }
}

function setHealthConnectAuthorization(ok: boolean) {
  try {
    if (ok) localStorage.setItem(HR_HEALTH_CONNECT_AUTH_KEY, "1");
    else localStorage.removeItem(HR_HEALTH_CONNECT_AUTH_KEY);
  } catch { /* storage unavailable — non-fatal */ }
}

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
// watch's all-day HR sync is enough. Trade-off: its peer is @capacitor/core ^7, resolved
// via the package.json `overrides` entry so a normal `npm install` picks up Cap 8
// (--legacy-peer-deps is deliberately avoided — it silently drops recharts' react-is
// peer). Cap-7 native code almost certainly builds against Cap 8 (stable Android plugin
// API), but confirm with an on-device/CI Android build.
//
// Load the plugin lazily so merely rendering the app after sign-in cannot touch
// the native Health Connect bridge. Some devices/versions are sensitive to the
// Cap-7 plugin under Cap-8; failures are treated as unavailable.
async function getHealthConnect(): Promise<{ plugin: HealthConnectPlugin }> {
  const mod = await import("@pianissimoproject/capacitor-health-connect");
  return { plugin: mod.HealthConnect as unknown as HealthConnectPlugin };
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
  id: "healthconnect" as const,
  live: false as const,
  isAvailable,
  availability,

  // Request read access to heart rate. Returns whether it was granted.
  async requestPermissions() {
    try {
      const r = await (await getHealthConnect()).plugin.requestHealthPermissions({ read: ["HeartRateSeries"], write: [] });
      const ok = !!(r?.hasAllPermissions || r?.grantedPermissions?.length);
      setHealthConnectAuthorization(ok);
      return ok;
    } catch { setHealthConnectAuthorization(false); return false; }
  },

  // Non-prompting check of whether heart-rate read is already granted — used to
  // show connection status in Settings without popping the OS dialog.
  async checkPermissions() {
    try {
      const r = await (await getHealthConnect()).plugin.checkHealthPermissions({ read: ["HeartRateSeries"], write: [] });
      const ok = !!(r?.hasAllPermissions || r?.grantedPermissions?.length);
      setHealthConnectAuthorization(ok);
      return ok;
    } catch { setHealthConnectAuthorization(false); return false; }
  },

  // Read HeartRateSeries records in [startMs, endMs], flatten to samples inside the
  // window, and reduce to {hr,hrAvg,hrMax}. Returns null when nothing is available yet
  // (watch not synced) so the caller can defer and retry.
  async fetchRange(startMs: number, endMs: number) {
    try {
      if (!(await isAvailable()) || !(await healthConnectSource.checkPermissions())) return null;
      const res = await (await getHealthConnect()).plugin.readRecords({
        type: "HeartRateSeries",
        // The plugin's Android serializer calls JSONObject.getString(...) then
        // Instant.parse(...), so pass explicit ISO strings instead of Date objects.
        timeRangeFilter: { type: "between", startTime: new Date(startMs).toISOString(), endTime: new Date(endMs).toISOString() },
      });
      const samples = (res?.records || [])
        .flatMap(rec => rec.samples || [])
        .map(s => ({ bpm: s.beatsPerMinute, t: +new Date(s.time) }))
        .filter((s): s is { bpm: number; t: number } => !!s.bpm && s.t >= startMs && s.t <= endMs);
      if (!samples.length) return null;
      return hrSummary(samples);
    } catch { return null; }
  },
};

// Deferred relink for Health Connect markers (Android): the shared engine
// (src/hr/pending.ts) triages `hrPending` — iOS markers live in the separate
// `hrPendingHk` field precisely so this flusher (and every already-shipped
// Android build) can't touch them; this wrapper supplies the HC read gate.
export async function flushPendingHr(
  runs: PendingHrRun[],
  patch: PatchHr,
  { enabled = true, allowNativeRead = true, now = Date.now() }: { enabled?: boolean; allowNativeRead?: boolean; now?: number } = {},
) {
  return flushPendingHrFor(runs, patch, {
    field: "hrPending",
    sourceId: "healthconnect",
    now,
    canRead: async () =>
      enabled && allowNativeRead && isAndroid && hasHealthConnectAuthorization()
      && (await isAvailable()) && (await healthConnectSource.checkPermissions()),
    fetchRange: (startMs, endMs) => healthConnectSource.fetchRange(startMs, endMs),
  });
}
