import type { Run } from "../types";
import type { WatchSessionRaw } from "./plugin";
import { importedNote } from "../imports/dataOrigin";
import { isDuplicateRun } from "../imports/dedupe";

// Health Connect ExerciseSessionRecord exercise-type ids we treat as runs.
// (androidx.health.connect.client.records.ExerciseSessionRecord constants.)
export const EXERCISE_TYPE_RUNNING = 56;
export const EXERCISE_TYPE_RUNNING_TREADMILL = 57;
export const EXERCISE_TYPE_WALKING = 79;
export const EXERCISE_TYPE_HIKING = 37;

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
    // Active (unpaused) time when the aggregate has it; a 0/absent aggregate
    // falls back to elapsed so a run never lands with durationSec:0 (∞ pace).
    durationSec: s.activeSec != null && s.activeSec > 0 ? Math.round(s.activeSec) : elapsedSec,
    hr: s.hrAvg != null ? Math.round(s.hrAvg) : null,
    hrMax: s.hrMax != null ? Math.round(s.hrMax) : null,
    effort: 5,
    // Which app wrote the session ("Imported from Garmin" / "… Zepp") — several
    // brands share the one Health Connect integration, so the run says which.
    notes: importedNote(s.dataOrigin),
    source: "watch",
    hcId: s.id,
    startedAt: s.startTime,
  };
  if (s.elevationGainM != null) run.elevation = Math.round(s.elevationGainM);
  return run;
}

// Sessions that are runnable (a run/walk type) and not already logged: map
// first, then dedupe once through the ONE rule set (isDuplicateRun in
// src/imports/dedupe.ts — ids, time overlap, fuzzy day+distance fallback).
// There is deliberately no session-shaped duplicate check here: two parallel
// implementations of the same four rules drifted on edge cases, so the mapped
// run shape is the only thing ever deduped.
export function newWatchSessions(sessions: WatchSessionRaw[], runs: Run[], seenIds: string[]): Partial<Run>[] {
  const out: Partial<Run>[] = [];
  for (const s of sessions || []) {
    if (!s || !s.id || sessionRunType(s.exerciseType) == null) continue;
    const run = sessionToRun(s);
    // Dedupe against the log AND earlier candidates in this same batch.
    if (!isDuplicateRun(run, (runs || []).concat(out as Run[]), seenIds)) out.push(run);
  }
  return out;
}
