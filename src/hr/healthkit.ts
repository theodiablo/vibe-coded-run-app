import { hrSummary } from "../utils/hr";
import { isIos } from "../native";
import { getHealthKitPlugin } from "../healthkit/plugin";
import {
  availability,
  isAvailable,
  hasHealthKitAuthorization,
  requestHealthKitPermissions,
} from "../healthkit/import";
import { flushPendingHrFor, type PatchHr, type PendingHrRun } from "./pending";

// Post-run heart-rate source: read a tracked run's HR from Apple Health — the
// iOS mirror of healthConnectSource, for users whose watch syncs HR into Health
// (Apple Watch natively; Garmin/Polar/… via their companion apps) without a
// live BLE stream. Implements the same PostRunHrSource contract; useRunTracker
// never streams from it — LiveRunTracker calls fetchRange once on save, with
// the deferred flushPendingHkHr retry because the watch may not have synced yet.
//
// Authorization semantics differ from Health Connect on purpose: HealthKit
// never reveals READ authorization, so checkPermissions reports the local
// marker (set by the completed request flow) instead of probing the OS, and
// nothing ever clears the marker based on a probe — only availability failure
// does. An unauthorized read simply comes back empty and stays hrPending.
export const healthKitSource = {
  id: "healthkit" as const,
  live: false as const,
  isAvailable,
  availability,

  requestPermissions: requestHealthKitPermissions,

  // Non-prompting "connected?" for Settings. The local marker is the only
  // signal HealthKit allows for read scopes.
  checkPermissions: async () => hasHealthKitAuthorization(),

  // Read heart-rate samples in [startMs, endMs] and reduce to {hr,hrAvg,hrMax}.
  // Returns null when nothing is available yet (watch not synced, or read
  // denied — indistinguishable by design) so the caller defers and retries.
  async fetchRange(startMs: number, endMs: number) {
    try {
      if (!isIos || !hasHealthKitAuthorization() || !(await isAvailable())) return null;
      const res = await getHealthKitPlugin().readHeartRate({
        startTime: new Date(startMs).toISOString(),
        endTime: new Date(endMs).toISOString(),
      });
      const samples = (res?.samples || [])
        .map(s => ({ bpm: Math.round(s.bpm || 0), t: Number(s.t) }))
        .filter((s): s is { bpm: number; t: number } => s.bpm > 0 && s.t >= startMs && s.t <= endMs);
      if (!samples.length) return null;
      return hrSummary(samples);
    } catch { return null; }
  },
};

// Deferred relink for HealthKit "hrPending" markers — the iOS sibling of
// flushPendingHr, called alongside it at the same RunningCoach call sites
// (boot + foreground). The shared engine leaves Android "healthconnect"
// markers alone, and vice versa.
export async function flushPendingHkHr(
  runs: PendingHrRun[],
  patch: PatchHr,
  { enabled = true, now = Date.now() }: { enabled?: boolean; now?: number } = {},
) {
  return flushPendingHrFor(runs, patch, {
    sourceId: "healthkit",
    now,
    canRead: async () => enabled && isIos && hasHealthKitAuthorization() && (await isAvailable()),
    fetchRange: (startMs, endMs) => healthKitSource.fetchRange(startMs, endMs),
  });
}
