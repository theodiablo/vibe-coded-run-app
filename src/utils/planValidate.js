// Plan invariant validator — the single source of truth for what a *safe*
// training plan looks like. Used by BOTH the AI coach agent (which must never
// surface a plan that fails this) and, as a gate, the deterministic generator
// (`buildPlan`). See docs / the agent plan for the trust story.
//
// This module is deliberately **pure and dependency-free** (no React, no
// `constants.js`, no `import.meta.env`) so the exact same file can be imported
// by the Vite/React bundle, by Vitest, and by the Deno edge function. Do not add
// imports that pull in browser-only globals.
//
// Policy ordering, made explicit: safety > consistency > peak performance. Every
// rule below is a *safety floor*, calibrated so the deterministic generator's own
// output passes (see planValidate.test.js — the reconciliation matrix), while
// still rejecting the dangerous edits the agent could otherwise make (an intensity
// spike after an injury report, a make-up volume jump after a missed week).

export const ALLOWED_TYPES = ["EASY", "TEMPO", "INTERVALS", "LONG", "RACE", "WALK", "OTHER"];
export const ALLOWED_PHASES = ["BASE", "BUILD", "PEAK", "TAPER", "RACE"];

// A "hard" day is one that carries real training stress. EASY / WALK / OTHER
// (recovery, cross-training) are the low-stress complement.
export const HARD_TYPES = ["TEMPO", "INTERVALS", "LONG", "RACE"];

// Calibrated bounds (see the reconciliation test):
//  - A volume spike is flagged only when a week breaches BOTH a relative ratio and
//    an absolute jump. The generator's steep early ratios (e.g. a 3km→7km base
//    week) are large in % but tiny in km, so the absolute floor lets them through;
//    a real make-up week after a missed one (e.g. 30km→60km) trips both.
export const MAX_WEEK_VOLUME_RATIO = 1.5;
export const MIN_ABS_VOLUME_SPIKE_KM = 20;
//  - Taper weeks must be non-increasing and must not be "stuffed" meaningfully
//    above the pre-taper peak. A little slack absorbs the generator's compressed
//    short-plan tapers (a first taper week can edge a few % over a barely-ramped
//    peak); an agent adding a real workout to the taper is far beyond it.
export const TAPER_MAX_OVER_PEAK = 1.15;
//  - No run of this many consecutive calendar days may each carry a hard session.
//    Two-in-a-row is allowed (the generator can schedule it); three is not.
export const MAX_CONSECUTIVE_HARD_DAYS = 2;

const isFiniteNum = (n) => typeof n === "number" && Number.isFinite(n);
const dayIndex = (ymd) => Math.round(new Date(ymd + "T00:00:00").getTime() / 86400000);

// Total prescribed volume for a week (all sessions, RACE included).
function weekVolume(week) {
  return (week.sessions || []).reduce((s, x) => s + (isFiniteNum(x.km) ? x.km : 0), 0);
}

// A week is a "training" week (subject to volume/taper rules) if it is not the
// terminal RACE week.
const isTrainingWeek = (week) => week.phase !== "RACE";

/**
 * @param {object} plan a plan in the `buildPlan` shape
 * @returns {{valid: boolean, errors: Array<{code, message, sessionId?, weekNumber?}>}}
 */
export function validatePlan(plan) {
  const errors = [];
  const add = (code, message, extra = {}) => errors.push({ code, message, ...extra });

  if (!plan || typeof plan !== "object" || !Array.isArray(plan.weeks) || plan.weeks.length === 0) {
    add("E_NO_WEEKS", "Plan has no weeks.");
    return { valid: false, errors };
  }

  // ── Structural integrity (per session) ────────────────────────────────────
  for (const week of plan.weeks) {
    if (!ALLOWED_PHASES.includes(week.phase)) {
      add("E_PHASE", `Unknown phase "${week.phase}".`, { weekNumber: week.weekNumber });
    }
    if (!Array.isArray(week.sessions)) {
      add("E_NO_SESSIONS", "Week has no sessions array.", { weekNumber: week.weekNumber });
      continue;
    }
    for (const s of week.sessions) {
      if (!s || typeof s.id !== "string" || !s.id) {
        add("E_SESSION_ID", "Session is missing a stable id.", { weekNumber: week.weekNumber });
        continue;
      }
      if (!ALLOWED_TYPES.includes(s.type)) {
        add("E_TYPE", `Session has unknown type "${s.type}".`, { sessionId: s.id });
      }
      if (typeof s.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s.date)) {
        add("E_DATE", "Session has an invalid date (expected YYYY-MM-DD).", { sessionId: s.id });
      }
      if (!isFiniteNum(s.km) || s.km < 0) {
        add("E_KM", "Session distance (km) must be a number ≥ 0.", { sessionId: s.id });
      }
      if (!isFiniteNum(s.pace) || s.pace < 0) {
        add("E_PACE", "Session pace must be a number ≥ 0.", { sessionId: s.id });
      }
    }
  }
  // If the plan is structurally broken, don't bother with the higher-order rules —
  // their inputs can't be trusted.
  if (errors.length) return { valid: false, errors };

  // ── Volume progression: no runaway week-over-week increase ─────────────────
  const trainingWeeks = plan.weeks.filter(isTrainingWeek);
  for (let i = 1; i < trainingWeeks.length; i++) {
    const prev = weekVolume(trainingWeeks[i - 1]);
    const cur = weekVolume(trainingWeeks[i]);
    if (prev > 0 && cur > prev * MAX_WEEK_VOLUME_RATIO && cur - prev > MIN_ABS_VOLUME_SPIKE_KM) {
      add(
        "E_VOLUME_SPIKE",
        `Week ${trainingWeeks[i].weekNumber} volume (${cur.toFixed(1)}km) jumps more than ` +
          `${Math.round((MAX_WEEK_VOLUME_RATIO - 1) * 100)}% over the previous week (${prev.toFixed(1)}km).`,
        { weekNumber: trainingWeeks[i].weekNumber },
      );
    }
  }

  // ── Taper integrity: load winds down toward the race ───────────────────────
  // Taper-week volume must be non-increasing, and no taper week may be stuffed
  // meaningfully above the pre-taper peak. (A strict "≤ peak" is too tight for
  // compressed short plans, where the first taper week can edge a few % over a
  // barely-ramped peak — hence TAPER_MAX_OVER_PEAK.)
  const preTaper = trainingWeeks.filter((w) => w.phase !== "TAPER");
  const taperWeeks = trainingWeeks.filter((w) => w.phase === "TAPER");
  if (taperWeeks.length) {
    const peakVol = preTaper.reduce((m, w) => Math.max(m, weekVolume(w)), 0);
    for (let i = 1; i < taperWeeks.length; i++) {
      if (weekVolume(taperWeeks[i]) > weekVolume(taperWeeks[i - 1]) + 0.05) {
        add(
          "E_TAPER",
          `Taper week ${taperWeeks[i].weekNumber} increases volume over the previous taper week.`,
          { weekNumber: taperWeeks[i].weekNumber },
        );
      }
    }
    for (const w of taperWeeks) {
      if (peakVol > 0 && weekVolume(w) > peakVol * TAPER_MAX_OVER_PEAK) {
        add(
          "E_TAPER",
          `Taper week ${w.weekNumber} carries more volume (${weekVolume(w).toFixed(1)}km) ` +
            `than the pre-taper peak allows (${(peakVol * TAPER_MAX_OVER_PEAK).toFixed(1)}km).`,
          { weekNumber: w.weekNumber },
        );
      }
    }
  }

  // ── Consecutive hard days: no 3+ hard days back-to-back-to-back ────────────
  // Flatten across the whole plan so a Sunday long run followed by a Monday hard
  // session (across the week boundary) is still caught.
  const hardDays = new Set();
  for (const week of plan.weeks) {
    for (const s of week.sessions) {
      if (HARD_TYPES.includes(s.type)) hardDays.add(dayIndex(s.date));
    }
  }
  const sortedDays = [...hardDays].sort((a, b) => a - b);
  let streak = sortedDays.length ? 1 : 0;
  for (let i = 1; i < sortedDays.length; i++) {
    streak = sortedDays[i] === sortedDays[i - 1] + 1 ? streak + 1 : 1;
    if (streak > MAX_CONSECUTIVE_HARD_DAYS) {
      add(
        "E_CONSECUTIVE_HARD",
        `${streak} hard sessions fall on consecutive days — insufficient recovery.`,
      );
      break;
    }
  }

  return { valid: errors.length === 0, errors };
}
