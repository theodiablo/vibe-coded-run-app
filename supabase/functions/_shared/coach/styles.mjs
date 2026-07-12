// Shared training-plan STYLE pacing table — the ONE source of pace multipliers
// for both callers: the deterministic generator (src/utils/plan.ts buildPlan,
// via the src/utils/planStyles.ts re-export) and the coach agent (tools.mjs
// derives swap/add paces from it). Keeping them in one file means a style can
// never prescribe one easy pace in the plan and another in a coach edit.
//
// Plain ESM JS on purpose: imported by the Deno edge function (relative .mjs
// import) AND by the Vite app / Vitest. Keep it dependency-free.
//
// Multipliers are applied to plan.targetPace (sec/km, flat-equivalent goal
// race pace): pace = round(targetPace * multiplier). "balanced" is the
// pre-styles algorithm and MUST keep 1.25 / 1.05 / 1.00 / 1.25 — plans built
// before styles existed carry no `style` field and resolve to it.

export const STYLE_IDS = ["balanced", "polarized", "runwalk", "lowfreq", "hansons"];
export const DEFAULT_STYLE = "balanced";

// `walk` paces WALK-typed sessions: null = WALK is unpaced cross-training
// (the pre-styles meaning); a number = WALK is a real run/walk interval
// session with a prescribed pace (runwalk style). Generator and coach must
// read it from here so a coached WALK never disagrees with a generated one.
export const STYLE_PACING = {
  // The original plan: moderate easy days, threshold-ish tempo, race-pace reps.
  balanced: { easy: 1.25, tempo: 1.05, intervals: 1.0, long: 1.25, walk: null },
  // 80/20: easy genuinely easy, the one weekly hard session slightly harder.
  polarized: { easy: 1.32, tempo: 1.03, intervals: 0.97, long: 1.32, walk: null },
  // Galloway run/walk: everything conversational. The generator never emits
  // TEMPO/INTERVALS for this style — those values only pace a coach swap.
  runwalk: { easy: 1.35, tempo: 1.05, intervals: 1.0, long: 1.4, walk: 1.45 },
  // FIRST "3 quality runs": every run pace-prescribed and a notch faster.
  lowfreq: { easy: 1.25, tempo: 1.0, intervals: 0.95, long: 1.15, walk: null },
  // Hansons: moderate everything — capped steady long run, goal-pace tempo.
  hansons: { easy: 1.2, tempo: 1.0, intervals: 0.94, long: 1.15, walk: null },
};

// Absent/unknown style degrades to balanced — old plans without a `style`
// field and any future style a stale deploy hasn't heard of stay safe.
export const stylePacing = (style) => STYLE_PACING[style] || STYLE_PACING[DEFAULT_STYLE];

// One-line description per style, for prompts and UI blurbs.
export function styleNotes(style) {
  switch (style) {
    case "polarized":
      return "Polarized 80/20 — one hard session a week, every other run genuinely easy.";
    case "runwalk":
      return "Run/walk — scheduled walk breaks, no tempo or interval work, finish-focused.";
    case "lowfreq":
      return "3-day quality — three purposeful runs a week (intervals, tempo, long), rest optional cross-training.";
    case "hansons":
      return "Hansons-style — capped moderate long run, frequent moderate days, tempo at goal race pace.";
    default:
      return "Balanced — classic build with a weekly long run and alternating tempo/interval quality.";
  }
}
