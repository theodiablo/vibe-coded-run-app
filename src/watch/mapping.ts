import type { Run } from "../types";
import type { WatchSessionRaw } from "./plugin";

// Health Connect ExerciseSessionRecord exercise-type ids we treat as runs.
// (androidx.health.connect.client.records.ExerciseSessionRecord constants.)
export const EXERCISE_TYPE_RUNNING = 56;
export const EXERCISE_TYPE_RUNNING_TREADMILL = 57;
export const EXERCISE_TYPE_WALKING = 79;
export const EXERCISE_TYPE_HIKING = 37;

// Distance within this fraction of each other counts as the same run for the
// fuzzy (legacy-run) dedupe fallback.
const FUZZY_KM_TOLERANCE = 0.1;

// Map a Health Connect exercise type to one of our run types, or null when it's
// not something we import (cycling, swimming, strength, …). Running/treadmill →
// EASY (the user re-types TEMPO/INTERVALS/LONG on review); walking/hiking → WALK.
export function sessionRunType(exerciseType?: number): "EASY" | "WALK" | null {
  if (exerciseType === EXERCISE_TYPE_RUNNING || exerciseType === EXERCISE_TYPE_RUNNING_TREADMILL) return "EASY";
  if (exerciseType === EXERCISE_TYPE_WALKING || exerciseType === EXERCISE_TYPE_HIKING) return "WALK";
  return null;
}

function utcYmd(ms: number): string {
  const d = new Date(ms);
  const p2 = (n: number) => String(n).padStart(2, "0");
  return d.getUTCFullYear() + "-" + p2(d.getUTCMonth() + 1) + "-" + p2(d.getUTCDate());
}

// The run's calendar date in the runner's own time zone. Health Connect returns
// start instants in UTC ("…Z"), so a run late at night in UTC+10 would land on
// the wrong day without the session's zone offset. When the offset is unknown,
// fall back to the device's local zone.
export function sessionLocalDate(startTime: string, zoneOffsetSec?: number | null): string {
  const ms = +new Date(startTime);
  if (!Number.isFinite(ms)) return "";
  if (zoneOffsetSec != null && Number.isFinite(zoneOffsetSec)) return utcYmd(ms + zoneOffsetSec * 1000);
  const d = new Date(ms);
  const p2 = (n: number) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate());
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// Turn a raw Health Connect session into a partial Run ready for the save
// pipeline (goLog prefill / addRuns). Elevation is omitted when the watch didn't
// record it (rather than forced to 0) so the field stays blank and editable.
export function sessionToRun(s: WatchSessionRaw): Partial<Run> {
  const startMs = +new Date(s.startTime);
  const endMs = +new Date(s.endTime);
  const elapsedSec = Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs
    ? Math.round((endMs - startMs) / 1000) : 0;
  const run: Partial<Run> = {
    date: sessionLocalDate(s.startTime, s.startZoneOffsetSec),
    type: sessionRunType(s.exerciseType) || "EASY",
    km: s.distanceM != null ? round2(s.distanceM / 1000) : 0,
    durationSec: s.activeSec != null ? Math.round(s.activeSec) : elapsedSec,
    hr: s.hrAvg != null ? Math.round(s.hrAvg) : null,
    hrMax: s.hrMax != null ? Math.round(s.hrMax) : null,
    effort: 5,
    source: "watch",
    hcId: s.id,
    startedAt: s.startTime,
  };
  if (s.elevationGainM != null) run.elevation = Math.round(s.elevationGainM);
  return run;
}

// Is this session already represented in the log? Priority order:
//  1. seen id — this device already handled it (survives the user deleting the run).
//  2. an existing run carries this hcId — repeated scans are idempotent.
//  3. time-window overlap with a run that knows its own start (phone-tracked or
//     previously imported) — catches the same run tracked two ways.
//  4. fuzzy fallback for legacy runs with no startedAt: same local date and
//     distance within 10%.
export function isDuplicate(s: WatchSessionRaw, runs: Run[], seenIds: string[]): boolean {
  if (seenIds.includes(s.id)) return true;
  const sStart = +new Date(s.startTime);
  const sEnd = +new Date(s.endTime);
  const sKm = s.distanceM != null ? s.distanceM / 1000 : null;
  const sDate = sessionLocalDate(s.startTime, s.startZoneOffsetSec);
  for (const r of runs) {
    if (r.hcId && r.hcId === s.id) return true;
    // 3. Time overlap against a run with a known start instant.
    if (r.startedAt && r.durationSec) {
      const rStart = +new Date(r.startedAt);
      const rEnd = rStart + r.durationSec * 1000;
      if (Number.isFinite(rStart) && Number.isFinite(sStart) && Number.isFinite(sEnd) && rStart < sEnd && sStart < rEnd) return true;
    } else if (!r.startedAt && sKm != null && r.date === sDate) {
      // 4. Fuzzy: same day, similar distance.
      const rKm = Number(r.km) || 0;
      if (Math.abs(rKm - sKm) <= FUZZY_KM_TOLERANCE * Math.max(rKm, sKm)) return true;
    }
  }
  return false;
}

// Sessions that are runnable (a run/walk type) and not already logged, mapped to
// partial Runs. seenIds and existing runs both feed dedupe.
export function newWatchSessions(sessions: WatchSessionRaw[], runs: Run[], seenIds: string[]): Partial<Run>[] {
  return (sessions || [])
    .filter(s => s && s.id && sessionRunType(s.exerciseType) != null && !isDuplicate(s, runs, seenIds))
    .map(sessionToRun);
}
