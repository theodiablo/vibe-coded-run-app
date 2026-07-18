// Availability helpers for the Plan page's redesigned "Your availability" editor.
//
// The editor offers two modes:
//  - Simple: pick a number of run days (2–6) and a duration band, and let the
//    coach place the days. This is the beginner default.
//  - Custom: pick exact days and per-day durations (the classic scheduler).
//
// buildPlan only understands concrete PlanSessionInput[] ({dayOffset, minutes}),
// so Simple mode is resolved to a concrete layout here. Layouts mirror the
// day-spreads already proven in suggestPlanSessions (src/utils/planStyles.ts):
// the weekend (Sunday, dayOffset 6) is strictly the longest, weekday minutes come
// from the SessionConfigurator option set, and quality days sit ≥2 from Sunday so
// the plan validator places them without demotions.
import type { PlanSessionInput } from "./plan";

export type DurationBand = "short" | "med" | "long";
export type AvailabilityMode = "simple" | "custom";

export const AVAIL_DAY_MIN = 2;
export const AVAIL_DAY_MAX = 6;

// Weekly-load meter scale (minutes). Matches the design handoff: full scale is
// 6h/week; the "good for a first race" band is 65–225 min.
export const LOAD_MAX_MIN = 360;
export const LOAD_GOOD_LO = 65;
export const LOAD_GOOD_HI = 225;

// Weekday vs long-run (Sunday) minutes per band. Both are option-set values and
// long > weekday so Sunday stays strictly the longest session.
const BAND_MINUTES: Record<DurationBand, { weekday: number; long: number }> = {
  short: { weekday: 30, long: 45 },
  med:   { weekday: 45, long: 75 },
  long:  { weekday: 60, long: 90 },
};

// Day layouts (dayOffset 0=Mon … 6=Sun) by run-day count. Sunday is always the
// long day; weekday picks keep quality days clear of the weekend.
const DAY_LAYOUTS: Record<number, number[]> = {
  2: [2, 6],
  3: [1, 3, 6],
  4: [0, 2, 4, 6],
  5: [0, 2, 4, 5, 6],
  6: [0, 1, 2, 3, 4, 6],
};

export const clampDays = (n: number) =>
  Math.max(AVAIL_DAY_MIN, Math.min(AVAIL_DAY_MAX, Math.round(n)));

// Representative per-day minutes used only for the Simple-mode load estimate
// (the actual sessions vary the long run — see sessionsFromSimple).
export const bandRepMinutes = (band: DurationBand): number =>
  ({ short: 30, med: 52, long: 75 })[band];

// Resolve a Simple-mode selection to concrete training sessions for buildPlan.
export function sessionsFromSimple(days: number, band: DurationBand): PlanSessionInput[] {
  const d = clampDays(days);
  const layout = DAY_LAYOUTS[d] || DAY_LAYOUTS[3];
  const { weekday, long } = BAND_MINUTES[band];
  return layout.map(dayOffset => ({
    dayOffset,
    minutes: dayOffset === 6 ? long : weekday,
  }));
}

// A sensible Simple-mode starting point from the race distance + self-reported
// level, used by onboarding (before any runs exist). Day count mirrors
// suggestPlanSessions (src/utils/planStyles.ts); the band scales with distance
// and experience.
export function suggestSimpleAvailability(distanceKm: number | string, level?: unknown): { days: number; band: DurationBand } {
  const d = Number(distanceKm) || 5;
  const experienced = level === "regular" || level === "frequent";
  const days = clampDays(level === "frequent" ? (d > 12 ? 5 : 4) : (level === "regular" && d > 12 ? 4 : 3));
  const band: DurationBand = experienced ? (d > 15 ? "long" : "med") : (d <= 7.5 ? "short" : "med");
  return { days, band };
}

export type LoadResult = { totalMin: number; pct: number; zone: "low" | "good" | "high" };

// Weekly training-time estimate + which zone it lands in. Custom sums the exact
// per-day durations; Simple approximates as days × representative minutes.
export function weeklyLoad(
  input:
    | { mode: "custom"; sessions: PlanSessionInput[] }
    | { mode: "simple"; days: number; band: DurationBand },
): LoadResult {
  const totalMin = input.mode === "custom"
    ? input.sessions.reduce((sum, s) => sum + (s.minutes || 0), 0)
    : clampDays(input.days) * bandRepMinutes(input.band);
  const pct = Math.max(0, Math.min(100, Math.round((totalMin / LOAD_MAX_MIN) * 100)));
  const zone = totalMin < LOAD_GOOD_LO ? "low" : totalMin <= LOAD_GOOD_HI ? "good" : "high";
  return { totalMin, pct, zone };
}
