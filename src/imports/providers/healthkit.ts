import { isIos } from "../../native";
import {
  scanHealthKitWorkouts,
  hasHealthKitAuthorization,
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
  // No disconnect: the auth marker is SHARED with post-run HR (one HealthKit
  // sheet grants both scopes), so clearing it here would silently break a
  // configured hrMethod:"healthkit". "Turn off" already flips the watchImport
  // preference, which is what gates scanning; real revocation lives in the
  // Health app (Sharing → Apps), which HealthKit doesn't let us probe or open.
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
