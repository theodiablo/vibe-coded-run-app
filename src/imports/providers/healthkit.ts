import { isIos } from "../../native";
import {
  scanHealthKitWorkouts,
  hasHealthKitAuthorization,
  setHealthKitAuthorization,
  requestHealthKitPermissions,
} from "../../healthkit/import";
import type { ImportProvider } from "../types";
import type { Run } from "../../types";

// The one Apple Health integration — the iOS face of the same brand-agnostic
// "your watch" idea as healthConnectProvider: every watch app that writes
// workouts into Apple Health (Apple Watch natively, Garmin Connect, Polar
// Flow…) surfaces through this single provider; the per-run note says which
// app it came from (hkImportedNote). The native data source stays in
// src/healthkit/ (plugin bridge, mapping, guards) — this is just its
// ImportProvider face. Both health-store providers share the synced
// settings.watchImport preference (see healthStoreProviderIds).
export const healthKitProvider: ImportProvider = {
  id: "healthkit",
  label: "Your watch (Apple Health)",
  kind: "healthkit",
  platform: "native",
  isAvailable: () => isIos, // HealthKit is iOS-only; Android gets the Health Connect provider
  isConnected: () => hasHealthKitAuthorization(),
  connect: () => requestHealthKitPermissions(),
  // "Turn off" only forgets the local marker; revoking the OS grant itself
  // lives in the Health app (Sharing → Apps), which HealthKit doesn't let us
  // probe or open per-app.
  disconnect: () => setHealthKitAuthorization(false),
  scan: (runs: Run[], opts?: { days?: number; now?: number }) =>
    scanHealthKitWorkouts(runs, {
      enabled: true, // the synced preference gate is applied by the caller (registry `enabled` predicate)
      allowNativeRead: hasHealthKitAuthorization(),
      ...(opts?.days ? { days: opts.days } : {}),
      ...(opts?.now ? { now: opts.now } : {}),
    }),
  help:
    "Works with the Apple Watch Workout app and any watch whose companion app writes " +
    "workouts to Apple Health (Garmin Connect, Polar Flow, Zepp…). Runs appear a few " +
    "minutes after your watch syncs; no route/map is included.",
};
