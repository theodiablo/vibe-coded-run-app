// The coach agent's bounded tool vocabulary: plan transforms over the
// buildPlan() JSON plus one memory-suggestion tool. The model is an EDITOR,
// never an author — it can only act through these; there is deliberately no free-form edit tool. The one
// load-increasing tool (add_session) is tightly bounded: distance capped at
// the plan's current longest training session, never inside the final 14
// days, and the weekly-ramp validator still gates the result. Every transform
// returns a NEW plan (structuredClone; the input is never mutated) and
// refuses to touch completed (done) sessions or move RACE sessions (races are
// fixed real-world events).
//
// Session/phase vocabulary matches the app (src/utils/plan.js), NOT generic
// lowercase names: EASY | TEMPO | INTERVALS | LONG | RACE | WALK | OTHER.
// "Cross-training" maps to WALK — the app's no-impact session type.
//
// Plain ESM JS: imported by the Deno edge function and by Vitest.

import { HARD_TYPES } from "./validation.mjs";

const SWAP_TYPES = ["EASY", "TEMPO", "INTERVALS", "LONG", "WALK"];
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const dayMs = 86400000;
const toDate = (s) => new Date(s + "T00:00:00");
const daysBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / dayMs);

export class CoachToolError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CoachToolError";
    this.code = code;
  }
}

// Anthropic tool definitions (Messages API `tools` array). Descriptions are
// prescriptive about WHEN to use each tool, not just what it does.
export const TOOL_DEFS = [
  {
    name: "shift_workout",
    description:
      "Move one training session to a different date. Use when a day no longer works (travel, soreness needing one more rest day, spacing two hard sessions apart). Cannot move RACE sessions or completed sessions; the new date must be inside the plan and before race day.",
    input_schema: {
      type: "object",
      properties: {
        session_id: { type: "string", description: "The id of the session to move." },
        new_date: { type: "string", description: "Target date, YYYY-MM-DD." },
      },
      required: ["session_id", "new_date"],
    },
  },
  {
    name: "swap_session",
    description:
      "Change a session's type (EASY, TEMPO, INTERVALS, LONG or WALK), keeping its date and distance. Use to soften a hard session (e.g. INTERVALS→EASY when fatigued) or restore one. Pace and description are recomputed from the plan's target pace.",
    input_schema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        new_type: { type: "string", enum: SWAP_TYPES },
      },
      required: ["session_id", "new_type"],
    },
  },
  {
    name: "reduce_week_volume",
    description:
      "Scale down every remaining training session in one week by a factor between 0.3 and 0.95. Use for accumulated fatigue, illness recovery, or an unexpectedly heavy life week. Never increases volume.",
    input_schema: {
      type: "object",
      properties: {
        week_number: { type: "integer" },
        factor: { type: "number", description: "Multiplier in [0.3, 0.95]." },
      },
      required: ["week_number", "factor"],
    },
  },
  {
    name: "insert_recovery_week",
    description:
      "Turn one week into a recovery week: every remaining training session becomes a short EASY run (≤6 km). Use after a missed week (resume gently — never make up volume), illness, or a niggle that needs unloading.",
    input_schema: {
      type: "object",
      properties: { week_number: { type: "integer" } },
      required: ["week_number"],
    },
  },
  {
    name: "convert_to_cross_training",
    description:
      "Convert one session to WALK (no-impact cross-training / brisk walk), keeping its date. Use for impact-related niggles (knee, shin, ankle) where movement is fine but running is not.",
    input_schema: {
      type: "object",
      properties: { session_id: { type: "string" } },
      required: ["session_id"],
    },
  },
  {
    name: "reduce_session_distance",
    description:
      "Shorten ONE session's distance by a factor between 0.3 and 0.95, keeping its date and type. Use when a single session needs unloading (e.g. shorten just the long run after a heavy week) — prefer this over reduce_week_volume when the problem is one session, not the whole week.",
    input_schema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        factor: { type: "number", description: "Multiplier in [0.3, 0.95]." },
      },
      required: ["session_id", "factor"],
    },
  },
  {
    name: "cancel_session",
    description:
      "Cancel one upcoming session — it is marked skipped and will not be run. LAST RESORT: prefer shortening (reduce_session_distance), shifting, swapping easier, or converting to cross-training; cancel only when full rest is the right call. Cannot cancel RACE or completed sessions, and you have no tool to un-cancel.",
    input_schema: {
      type: "object",
      properties: { session_id: { type: "string" } },
      required: ["session_id"],
    },
  },
  {
    name: "add_session",
    description:
      "Add ONE extra training session on a free day. ONLY when the runner explicitly has extra availability or asks to train more AND recent training supports it — never to make up missed volume, never during pain or illness, never inside the final 14 days before the race. Distance is capped at the plan's current longest training session, and the weekly volume ramp rule still applies to the result.",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "YYYY-MM-DD, inside the plan and before race day." },
        type: { type: "string", enum: SWAP_TYPES },
        km: { type: "number", description: "Distance in km; keep it modest." },
      },
      required: ["date", "type", "km"],
    },
  },
  {
    name: "reassess_goal_feasibility",
    description:
      "Analyse whether the race goal still looks realistic given recent training (returns an assessment; does NOT change the plan). Use when the runner doubts the goal, or when repeated reductions suggest the goal itself is the problem.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "remember_runner_context",
    description:
      "Suggest ONE durable, future-useful memory for the runner's visible Coach memory field. Use sparingly for recurring injuries/pain patterns, safety constraints, schedule preferences, terrain/equipment constraints, durable training preferences, or important user corrections about themselves. Do NOT suggest facts already present in the current plan, goal/settings, recent runs, or existing Coach memory; do NOT suggest one-off events (like a single missed week), trivial chat facts, compliments, emotions, race date/distance, latest run distance, weekly mileage, or diagnoses. Suggestions are NOT saved automatically: the runner must explicitly confirm them.",
    input_schema: {
      type: "object",
      properties: {
        memory: { type: "string", description: "Short memory text without a date prefix, e.g. 'Prefers Sunday long runs.'" },
      },
      required: ["memory"],
    },
  },
];

function findSession(plan, id) {
  for (const w of plan.weeks) {
    const s = w.sessions.find(x => x.id === id);
    if (s) return { week: w, session: s };
  }
  throw new CoachToolError("NOT_FOUND", `No session with id "${id}" in the plan.`);
}

// Single source of truth for "this session cannot be touched" — completed
// sessions and RACE sessions (fixed real-world events). Used both by the
// single-session guard below and by the bulk (whole-week) tools so the rule
// can't drift between the two call shapes.
const isFixed = (session) => session.type === "RACE" || session.done;

function guardEditable(session, verb) {
  if (session.done)
    throw new CoachToolError("DONE", `Session ${session.id} is already completed — refusing to ${verb} it.`);
  if (session.type === "RACE")
    throw new CoachToolError("IS_RACE", `Session ${session.id} is a race — races are fixed events and cannot be ${verb}ed.`);
}

// Pace/description derivation mirrors buildPlan's ratios off plan.targetPace.
const paceFor = (plan, type) => {
  const tgt = plan.targetPace || 0;
  if (!tgt) return null;
  if (type === "EASY" || type === "LONG") return Math.round(tgt * 1.25);
  if (type === "TEMPO") return Math.round(tgt * 1.05);
  if (type === "INTERVALS") return tgt;
  return null;
};
const fmtPace = (sec) => {
  if (!sec) return "--:--";
  const m = Math.floor(sec / 60), s = sec % 60;
  return m + ":" + String(s).padStart(2, "0");
};
const descFor = (type, pace) => {
  if (type === "LONG") return "Long run — easy effort" + (pace ? " at " + fmtPace(pace) + "/km" : "");
  if (type === "TEMPO") return "Tempo run — " + (pace ? fmtPace(pace) + "/km, " : "") + "comfortably hard";
  if (type === "INTERVALS") return "Intervals — repeats" + (pace ? " at " + fmtPace(pace) + "/km" : "") + " with full recovery";
  if (type === "WALK") return "Cross-training / brisk walk — no impact, easy effort";
  return "Easy run — relaxed aerobic effort";
};

// Apply one tool call, returning a NEW plan. Throws CoachToolError on refusal;
// the caller reports it back to the model as an is_error tool_result.
// reassess_goal_feasibility is handled by the caller (it reads context, not
// the plan) and is not accepted here.
export function applyToolCall(plan, name, input = {}) {
  const p = structuredClone(plan);
  switch (name) {
    case "shift_workout": {
      const { session_id, new_date } = input;
      if (!YMD.test(new_date || ""))
        throw new CoachToolError("BAD_INPUT", "new_date must be YYYY-MM-DD.");
      const { week, session } = findSession(p, session_id);
      guardEditable(session, "move");
      if (new_date >= p.raceDate)
        throw new CoachToolError("AFTER_RACE", "Cannot move a training session onto/after race day.");
      const target = p.weeks.find(w => {
        const off = (toDate(new_date) - toDate(w.startDate)) / dayMs;
        return off >= 0 && off < 7;
      });
      if (!target)
        throw new CoachToolError("OUT_OF_PLAN", `${new_date} is outside the plan window.`);
      week.sessions = week.sessions.filter(s => s.id !== session_id);
      session.date = new_date;
      target.sessions.push(session);
      target.sessions.sort((a, b) => a.date.localeCompare(b.date));
      return p;
    }
    case "swap_session": {
      const { session_id, new_type } = input;
      if (!SWAP_TYPES.includes(new_type))
        throw new CoachToolError("BAD_INPUT", `new_type must be one of ${SWAP_TYPES.join(", ")}.`);
      const { session } = findSession(p, session_id);
      guardEditable(session, "swap");
      session.type = new_type;
      session.pace = paceFor(p, new_type);
      session.desc = descFor(new_type, session.pace);
      return p;
    }
    case "reduce_week_volume": {
      const { week_number, factor } = input;
      if (typeof factor !== "number" || factor < 0.3 || factor > 0.95)
        throw new CoachToolError("BAD_INPUT", "factor must be a number in [0.3, 0.95].");
      const week = p.weeks.find(w => w.weekNumber === week_number);
      if (!week) throw new CoachToolError("NOT_FOUND", `No week ${week_number} in the plan.`);
      for (const s of week.sessions) {
        if (isFixed(s)) continue;
        s.km = Math.max(1.5, Math.round(s.km * factor * 10) / 10);
      }
      return p;
    }
    case "insert_recovery_week": {
      const { week_number } = input;
      const week = p.weeks.find(w => w.weekNumber === week_number);
      if (!week) throw new CoachToolError("NOT_FOUND", `No week ${week_number} in the plan.`);
      for (const s of week.sessions) {
        if (isFixed(s)) continue;
        s.type = "EASY";
        s.km = Math.max(1.5, Math.min(6, Math.round(s.km * 0.6 * 10) / 10));
        s.pace = paceFor(p, "EASY");
        s.desc = "Recovery run — very easy effort, walk breaks welcome";
      }
      return p;
    }
    case "reduce_session_distance": {
      const { session_id, factor } = input;
      if (typeof factor !== "number" || factor < 0.3 || factor > 0.95)
        throw new CoachToolError("BAD_INPUT", "factor must be a number in [0.3, 0.95].");
      const { session } = findSession(p, session_id);
      guardEditable(session, "shorten");
      session.km = Math.max(1.5, Math.round(session.km * factor * 10) / 10);
      return p;
    }
    case "cancel_session": {
      const { session_id } = input;
      const { session } = findSession(p, session_id);
      guardEditable(session, "cancel");
      session.skipped = true;
      return p;
    }
    case "add_session": {
      const { date, type, km } = input;
      if (!YMD.test(date || ""))
        throw new CoachToolError("BAD_INPUT", "date must be YYYY-MM-DD.");
      if (!SWAP_TYPES.includes(type))
        throw new CoachToolError("BAD_INPUT", `type must be one of ${SWAP_TYPES.join(", ")}.`);
      if (typeof km !== "number" || !(km > 0))
        throw new CoachToolError("BAD_INPUT", "km must be a positive number.");
      if (date >= p.raceDate)
        throw new CoachToolError("AFTER_RACE", "Cannot add a training session on/after race day.");
      if (daysBetween(date, p.raceDate) <= 14)
        throw new CoachToolError("TAPER", "No added sessions inside the final 14 days — the taper sheds load, it never gains sessions.");
      const target = p.weeks.find(w => {
        const off = daysBetween(w.startDate, date);
        return off >= 0 && off < 7;
      });
      if (!target)
        throw new CoachToolError("OUT_OF_PLAN", `${date} is outside the plan window.`);
      // Cap at the plan's established range: an "extra run" can never smuggle
      // in a new peak session.
      const cap = Math.max(0, ...p.weeks.flatMap(w => w.sessions)
        .filter(s => s.type !== "RACE" && !s.skipped).map(s => s.km));
      if (cap > 0 && km > cap)
        throw new CoachToolError("TOO_LONG", `km must not exceed the plan's current longest training session (${cap} km).`);
      const ids = new Set(p.weeks.flatMap(w => w.sessions.map(s => s.id)));
      let id = `coach-add-${date}`;
      for (let n = 2; ids.has(id); n++) id = `coach-add-${date}-${n}`;
      const pace = paceFor(p, type);
      target.sessions.push({ id, date, type, km: Math.round(km * 10) / 10, pace, desc: descFor(type, pace), done: false });
      target.sessions.sort((a, b) => a.date.localeCompare(b.date));
      return p;
    }
    case "convert_to_cross_training": {
      const { session_id } = input;
      const { session } = findSession(p, session_id);
      guardEditable(session, "convert");
      session.type = "WALK";
      session.pace = null;
      session.desc = descFor("WALK", null);
      return p;
    }
    default:
      throw new CoachToolError("UNKNOWN_TOOL", `Unknown tool "${name}".`);
  }
}

// reassess_goal_feasibility executor: a deterministic assessment computed from
// the request context (goal fields + recent-run window), returned to the model
// as the tool result. Pure and unit-testable; no plan mutation.
export function assessGoalFeasibility(ctx) {
  const { goal, targetPace, recentRuns = [] } = ctx;
  const { goalSec, distanceKm, raceDate } = goal || {};
  if (!goalSec || !distanceKm) return "No race goal is configured — nothing to assess.";
  const runs = recentRuns.filter(r => r && r.km > 0 && r.durationSec > 0 && r.type !== "WALK");
  if (!runs.length)
    return "No recent runs with distance+time logged — cannot assess fitness; advise the runner to log a few runs first.";
  const weeks = 4;
  const cutoff = new Date(Date.now() - weeks * 7 * dayMs).toISOString().slice(0, 10);
  const recent = runs.filter(r => r.date >= cutoff);
  // Prefer the actual last-N-weeks window for the headline stats; only fall
  // back to the wider (already ≤30-run) history when nothing recent exists,
  // and say so explicitly rather than silently mislabeling old data as recent.
  const sample = recent.length ? recent : runs;
  const weeklyKm = recent.reduce((t, r) => t + r.km, 0) / weeks;
  const longest = Math.max(...sample.map(r => r.km));
  const bestPace = Math.min(...sample.map(r => Math.round(r.durationSec / r.km)));
  const lines = [
    `Goal: ${distanceKm} km on ${raceDate} at ~${fmtPace(targetPace)}/km target pace.`,
    `Last ${weeks} weeks: ~${weeklyKm.toFixed(1)} km/week` + (recent.length
      ? `; longest recent run ${longest.toFixed(1)} km; best recent pace ${fmtPace(bestPace)}/km.`
      : ` (no runs logged in that window); longest run on record ${longest.toFixed(1)} km; best pace on record ${fmtPace(bestPace)}/km.`),
  ];
  if (bestPace > targetPace * 1.15)
    lines.push("Assessment: goal pace is far below anything shown recently — the goal looks UNREALISTIC right now; recommend discussing a slower goal or a later race.");
  else if (longest < distanceKm * 0.5 && distanceKm > 15)
    lines.push("Assessment: endurance is the gap (longest run under half the race distance) — the goal is AT RISK; protect the long-run progression above all.");
  else if (bestPace <= targetPace * 0.93)
    lines.push("Assessment: recent paces are comfortably faster than goal pace — the goal looks CONSERVATIVE. If the plan feels too easy, suggest a more ambitious goal in the plan settings (the whole plan is rebuilt from the goal) rather than hand-editing sessions.");
  else
    lines.push("Assessment: the goal looks broadly plausible if the remaining plan is executed consistently.");
  return lines.join("\n");
}
