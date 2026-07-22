import { registerPlugin } from "@capacitor/core";

// Raw shape returned by the native WatchImport plugin's readExerciseSessions.
// Everything is left raw (ints, nullable metres, ISO strings) so that all
// interpretation lives in the pure, unit-tested mapping layer (mapping.ts).
export type WatchSessionRaw = {
  id: string;
  dataOrigin?: string;      // source app package, e.g. com.garmin.android.apps.connectmobile
  startTime: string;        // ISO instant
  endTime: string;          // ISO instant
  startZoneOffsetSec?: number | null; // zone offset of the session start, seconds east of UTC
  exerciseType?: number;    // Health Connect ExerciseSessionRecord exercise type id
  title?: string | null;
  distanceM?: number | null;
  elevationGainM?: number | null;
  hrAvg?: number | null;
  hrMax?: number | null;
  activeSec?: number | null; // EXERCISE_DURATION_TOTAL (active/unpaused) seconds
};

export type WatchImportAvailability = "Available" | "NotInstalled" | "NotSupported";

export type WatchImportNative = {
  checkAvailability: () => Promise<{ availability?: WatchImportAvailability }>;
  checkHealthPermissions: () => Promise<{ granted?: boolean }>;
  requestHealthPermissions: () => Promise<{ granted?: boolean }>;
  readExerciseSessions: (options: { startTime: string; endTime: string }) => Promise<{ sessions?: WatchSessionRaw[] }>;
  // Raw per-sample HR over a window, restricted to one writing app (dataOrigin)
  // so two apps syncing the same run can't interleave. Cleaned by the pure
  // normalizeHrSamples (src/imports/series.ts).
  readHeartRateSeries: (options: { startTime: string; endTime: string; dataOrigin?: string }) => Promise<{ samples?: unknown }>;
};

// Lazily resolve the native bridge, mirroring getHealthConnect() in
// src/hr/healthconnect.ts. registerPlugin returns a proxy; callers still gate on
// isNative so the web build never invokes it (the web proxy just rejects).
let cached: WatchImportNative | null = null;
export function getWatchImportPlugin(): WatchImportNative {
  if (!cached) cached = registerPlugin<WatchImportNative>("WatchImport");
  return cached;
}
