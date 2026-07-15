import { registerPlugin } from "@capacitor/core";

// Raw shape returned by the local HealthKitBridge plugin's readWorkouts
// (ios/App/App/HealthKitBridgePlugin.swift). Everything is left raw (metres,
// seconds, activity-type raw values, ISO strings) so that all interpretation
// lives in the pure, unit-tested mapping layer (mapping.ts) — the same doctrine
// as WatchSessionRaw (src/watch/plugin.ts).
export type HkWorkoutRaw = {
  id: string;               // HKWorkout UUID string — globally unique per workout
  sourceBundleId?: string;  // writing app's bundle id, e.g. com.garmin.connect.mobile
  sourceName?: string;      // writing app's display name, e.g. "Garmin Connect"
  startTime: string;        // ISO instant
  endTime: string;          // ISO instant
  activityType?: number;    // HKWorkoutActivityType raw value
  distanceM?: number | null;
  elevationGainM?: number | null;
  hrAvg?: number | null;
  hrMax?: number | null;
  activeSec?: number | null; // workout.duration — already excludes pauses
};

export type HealthKitAvailability = "Available" | "NotSupported";

export type HealthKitNative = {
  checkAvailability: () => Promise<{ availability?: HealthKitAvailability }>;
  // Resolves granted:true when the authorization flow completed — HealthKit
  // never reveals whether READ access was actually granted (empty reads mean
  // "no data", never "revoked"). See the auth-marker semantics in hr/healthkit.ts.
  requestPermissions: () => Promise<{ granted?: boolean }>;
  readHeartRate: (options: { startTime: string; endTime: string }) => Promise<{ samples?: { bpm?: number; t?: number }[] }>;
  readWorkouts: (options: { startTime: string; endTime: string }) => Promise<{ sessions?: HkWorkoutRaw[] }>;
};

// Lazily resolve the native bridge, mirroring getWatchImportPlugin. registerPlugin
// returns a proxy; callers still gate on isIos + the local auth marker so the web
// and Android builds never invoke it.
let cached: HealthKitNative | null = null;
export function getHealthKitPlugin(): HealthKitNative {
  if (!cached) cached = registerPlugin<HealthKitNative>("HealthKitBridge");
  return cached;
}
