// Race helpers — catalogue lookups, race-day auto-detection, and personal-best
// flagging. Pure functions over the curated catalogue + the user's per-edition
// `participations` (see STORAGE_KEYS.RACES). No React, so they're unit-testable.

import { CURATED_RACES, CURATED_EDITIONS } from "../data/races";

// Every catalogue edition joined to its race (Phase 1 = curated only; Phase 2
// merges user-contributed rows here behind the same shape).
export function allEditions() {
  return CURATED_EDITIONS;
}

// Resolve an editionId to its joined race+edition object, or null if it's no
// longer in the catalogue (an orphaned participation handles its own snapshot).
export function findEdition(editionId) {
  if (!editionId) return null;
  return CURATED_EDITIONS.find(e => e.edition.id === editionId) || null;
}

export function findRace(raceId) {
  return CURATED_RACES.find(r => r.id === raceId) || null;
}

// A human label for a participation/edition, e.g. "Behobia-San Sebastián 2026".
export function editionLabel(race, edition) {
  const year = (edition?.date || "").slice(0, 4);
  return [race?.name, year].filter(Boolean).join(" ");
}

// Does a just-logged run look like the user's target race? Pure: compares only
// against `settings` (the plan's real target date/distance), NOT a possibly
// stale catalogue record. Returns the target editionId on a match, else null.
//
// A match needs: a target set, the run on the race date, and a distance within
// tolerance of the target (race courses run a little long/short, and GPS drifts).
export function detectRaceCompletion(run, settings, tolerance = 0.18) {
  if (!run || !settings) return null;
  const editionId = settings.targetEditionId;
  const target = Number(settings.distanceKm);
  if (!editionId || !target || !run.date || !run.km) return null;
  if (run.date !== settings.raceDate) return null;
  if (Math.abs(run.km - target) > target * tolerance) return null;
  return editionId;
}

// Fastest done time per distance bucket, used to flag personal bests. Distances
// are bucketed to the nearest 0.1 km so 21.1 and 21.10 group together.
export function bestTimesByDistance(participations = []) {
  const best = {};
  for (const p of participations) {
    if (p.status !== "done" || !p.timeSec || !p.distanceKm) continue;
    const key = Math.round(p.distanceKm * 10) / 10;
    if (best[key] == null || p.timeSec < best[key]) best[key] = p.timeSec;
  }
  return best;
}

// Is this done participation the fastest the user has logged at its distance?
export function isPersonalBest(participation, participations = []) {
  if (participation?.status !== "done" || !participation.timeSec) return false;
  const best = bestTimesByDistance(participations);
  const key = Math.round(participation.distanceKm * 10) / 10;
  return best[key] === participation.timeSec;
}
