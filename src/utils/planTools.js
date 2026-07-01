// The agent's tool vocabulary — the ONLY way the model may change a plan. Each
// tool is a **pure transform**: `(plan, input) -> newPlan`. It never mutates the
// input and always returns a fresh object, so the turn handler can apply a call
// to a throwaway copy, validate it, and only commit if it passes.
//
// Like planValidate.js this module is pure and dependency-free so the identical
// file is imported by the React bundle and the Deno edge function.
//
// Two hard rules every transform obeys:
//  1. **Session ids are preserved.** Progress (done/skipped/runId) is carried
//     across plan rebuilds by session id (`carryProgress` in RunningCoach.jsx);
//     changing an id silently orphans the user's logged progress.
//  2. **The race date is fixed.** No tool adds or removes calendar weeks — the
//     terminal RACE week is immovable, so every edit stays inside the existing
//     week/day grid.

export const TOOL_NAMES = [
  "shift_workout",
  "swap_session",
  "reduce_week_volume",
  "insert_recovery_week",
  "convert_to_cross_training",
  "reassess_goal_feasibility",
];

const clone = (plan) => structuredClone(plan);
// Match buildPlan's rounding + 1.5km floor so tool output is indistinguishable
// from generator output.
const roundKm = (km) => Math.round(Math.max(1.5, km) * 10) / 10;
const ymd = (d) => d.toISOString().slice(0, 10);
const sortWeek = (week) => week.sessions.sort((a, b) => a.date.localeCompare(b.date));

function findSession(plan, sessionId) {
  for (const week of plan.weeks) {
    const s = week.sessions.find((x) => x.id === sessionId);
    if (s) return { week, session: s };
  }
  return null;
}

function findWeek(plan, weekNumber) {
  return plan.weeks.find((w) => w.weekNumber === weekNumber) || null;
}

// ── shift_workout ────────────────────────────────────────────────────────────
// Move one session earlier/later by `days` (stays in its week object; the week is
// re-sorted). Used for "I can't run Wednesday, push it to Friday".
function shiftWorkout(plan, { sessionId, days }) {
  const next = clone(plan);
  const hit = findSession(next, sessionId);
  if (!hit) throw new Error(`shift_workout: no session ${sessionId}`);
  if (!Number.isFinite(days)) throw new Error("shift_workout: days must be a number");
  const d = new Date(hit.session.date + "T00:00:00");
  d.setDate(d.getDate() + days);
  hit.session.date = ymd(d);
  sortWeek(hit.week);
  return next;
}

// ── swap_session ─────────────────────────────────────────────────────────────
// Swap the dates of two sessions (reschedule one for the other) — e.g. "do the
// long run Saturday and the tempo Sunday instead". Both sessions and their ids
// are preserved; only their dates trade.
function swapSession(plan, { sessionIdA, sessionIdB }) {
  const next = clone(plan);
  const a = findSession(next, sessionIdA);
  const b = findSession(next, sessionIdB);
  if (!a || !b) throw new Error("swap_session: both sessions must exist");
  const tmp = a.session.date;
  a.session.date = b.session.date;
  b.session.date = tmp;
  sortWeek(a.week);
  if (b.week !== a.week) sortWeek(b.week);
  return next;
}

// ── reduce_week_volume ───────────────────────────────────────────────────────
// Scale every non-RACE session in a week by `factor` (0 < factor < 1) — the
// "dial this week back" lever. Types are kept; only distance shrinks.
function reduceWeekVolume(plan, { weekNumber, factor }) {
  const next = clone(plan);
  const week = findWeek(next, weekNumber);
  if (!week) throw new Error(`reduce_week_volume: no week ${weekNumber}`);
  if (!(factor > 0 && factor < 1)) throw new Error("reduce_week_volume: factor must be in (0,1)");
  for (const s of week.sessions) {
    if (s.type === "RACE") continue;
    s.km = roundKm(s.km * factor);
  }
  return next;
}

// ── insert_recovery_week ─────────────────────────────────────────────────────
// Turn an existing week into a recovery week in place (the race date is fixed, so
// we can't add a calendar week): all non-RACE sessions become EASY at ~half
// volume. This is the injury / overreach de-load response.
function insertRecoveryWeek(plan, { weekNumber }) {
  const next = clone(plan);
  const week = findWeek(next, weekNumber);
  if (!week) throw new Error(`insert_recovery_week: no week ${weekNumber}`);
  for (const s of week.sessions) {
    if (s.type === "RACE") continue;
    s.type = "EASY";
    s.km = roundKm(s.km * 0.5);
    s.desc = "Easy recovery run — keep it gentle";
  }
  return next;
}

// ── convert_to_cross_training ────────────────────────────────────────────────
// Replace a single running session with low-impact cross-training. There is no
// CROSS type in the app; we map onto OTHER (non-impact) rather than adding a type
// that would ripple into colours / the log picker / badges.
function convertToCrossTraining(plan, { sessionId }) {
  const next = clone(plan);
  const hit = findSession(next, sessionId);
  if (!hit) throw new Error(`convert_to_cross_training: no session ${sessionId}`);
  if (hit.session.type === "RACE") throw new Error("convert_to_cross_training: cannot convert the race");
  hit.session.type = "OTHER";
  hit.session.desc = "Cross-training — low-impact (bike / swim / elliptical)";
  return next;
}

// ── reassess_goal_feasibility ────────────────────────────────────────────────
// Re-target the plan to a new goal finish time. Paces scale with the goal time,
// so every prescribed pace moves proportionally; distances stay. Metadata
// (goalSec) is updated so a later rebuild starts from the revised goal.
function reassessGoalFeasibility(plan, { newGoalSec }) {
  const next = clone(plan);
  const oldGoal = next.goalSec;
  if (!(oldGoal > 0)) throw new Error("reassess_goal_feasibility: plan has no current goalSec");
  if (!(newGoalSec > 0)) throw new Error("reassess_goal_feasibility: newGoalSec must be > 0");
  const goal = Math.round(newGoalSec); // goalSec is always integer seconds
  const k = goal / oldGoal;
  next.goalSec = goal;
  if (isFinite(next.targetPace)) next.targetPace = Math.round(next.targetPace * k);
  for (const week of next.weeks) {
    for (const s of week.sessions) {
      if (Number.isFinite(s.pace) && s.pace > 0) s.pace = Math.round(s.pace * k);
    }
  }
  return next;
}

const HANDLERS = {
  shift_workout: shiftWorkout,
  swap_session: swapSession,
  reduce_week_volume: reduceWeekVolume,
  insert_recovery_week: insertRecoveryWeek,
  convert_to_cross_training: convertToCrossTraining,
  reassess_goal_feasibility: reassessGoalFeasibility,
};

/**
 * Apply one tool call to a plan, returning a new plan. Never mutates `plan`.
 * Throws on an unknown tool or invalid input (the turn handler treats a throw as
 * an invalid tool result and feeds it back to the model).
 */
export function applyToolCall(plan, name, input) {
  const handler = HANDLERS[name];
  if (!handler) throw new Error(`Unknown tool: ${name}`);
  return handler(plan, input || {});
}
