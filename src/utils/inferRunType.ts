// Conservative run-type inference for imported runs (CSV/GPX/watch), which
// all arrive typed EASY regardless of actual effort — flattening exactly the
// type-based analysis an experienced runner imports their history for.
//
// Pure and deliberately cautious: LONG comes from distance/duration relative
// to the runner's own recent volume; TEMPO/INTERVALS only fire on clear
// pace-vs-goal or HR-zone signals (Karvonen via runZoneIndex). Anything
// ambiguous stays EASY, and a non-EASY input type (e.g. WALK from a watch
// exercise category) is never overridden. The result lands in LogView's
// review/prefill, so the user can always correct it before saving.
import { runZoneIndex } from "./hr";
import type { Run, RunType, SettingsState } from "../types";

type RunLike = Partial<Pick<Run, "type" | "km" | "durationSec" | "hr" | "hrMax">>;
type InferSettings = Partial<Pick<SettingsState, "maxHR" | "restHR" | "goalSec" | "distanceKm">>;
type InferContext = {
  runs?: Partial<Pick<Run, "km">>[];
  settings?: InferSettings;
};

export function inferRunType(run: RunLike, ctx: InferContext = {}): RunType {
  const current = (run.type as RunType) || "EASY";
  if (current !== "EASY") return current; // only ever upgrade a default EASY

  const km = Number(run.km) || 0;
  const durationSec = Number(run.durationSec) || 0;
  if (km <= 0) return current;

  // ── LONG: big relative to the runner's own recent runs ────────────────────
  const others = (ctx.runs || []).map(r => Number(r.km) || 0).filter(k => k > 0);
  const avgKm = others.length >= 3 ? others.reduce((s, k) => s + k, 0) / others.length : 0;
  const longThreshold = avgKm > 0 ? Math.max(12, avgKm * 1.5) : 15;
  if (km >= Math.min(25, longThreshold) || durationSec >= 100 * 60) return "LONG";

  // ── Quality: clear pace or HR signals only ─────────────────────────────────
  const settings: InferSettings = ctx.settings || {};
  const maxHR = Number(settings.maxHR) || 0;
  const restHR = Number(settings.restHR) || 60;
  const avgZone = maxHR ? runZoneIndex(Number(run.hr) || 0, maxHR, restHR) : null;
  const peakZone = maxHR ? runZoneIndex(Number(run.hrMax) || 0, maxHR, restHR) : null;

  const goal = Number(settings.goalSec) || 0;
  const goalDist = Number(settings.distanceKm) || 0;
  const pace = durationSec > 0 ? durationSec / km : 0;
  // Averaging goal race pace (or faster) over a ≥3 km run is quality work.
  const paceSignal = goal > 0 && goalDist > 0 && pace > 0 && km >= 3
    && pace <= (goal / goalDist) * 1.06;

  // Spiky profile — peak in Z5 but average dragged down by recoveries —
  // reads as reps; a sustained Z4+ average reads as threshold.
  if (peakZone === 5 && avgZone !== null && avgZone <= 3) return "INTERVALS";
  if ((avgZone !== null && avgZone >= 4) || paceSignal) return "TEMPO";

  return "EASY";
}
