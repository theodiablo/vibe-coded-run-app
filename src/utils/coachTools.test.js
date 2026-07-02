import { describe, it, expect } from "vitest";
import {
  TOOL_DEFS, applyToolCall, assessGoalFeasibility, CoachToolError,
} from "../../supabase/functions/_shared/coach/tools.mjs";
import { validatePlan } from "./coachValidation";

const sess = (id, date, type, km, extra = {}) =>
  ({ id, date, type, km, pace: 360, done: false, ...extra });
const plan = () => ({
  raceDate: "2026-02-14", distanceKm: 20, goalSec: 6600, targetPace: 330, planSessions: [],
  weeks: [
    { weekNumber: 1, startDate: "2026-01-05", phase: "BUILD", sessions: [
      sess("w1d2", "2026-01-07", "TEMPO", 5), sess("w1d6", "2026-01-11", "LONG", 10),
    ]},
    { weekNumber: 2, startDate: "2026-01-12", phase: "BUILD", sessions: [
      sess("w2d2", "2026-01-14", "EASY", 4, { done: true }), sess("w2d6", "2026-01-18", "LONG", 11),
    ]},
    { weekNumber: 3, startDate: "2026-01-19", phase: "RACE", sessions: [
      sess("race", "2026-01-24", "RACE", 20),
    ]},
  ],
});

describe("applyToolCall", () => {
  it("never mutates the input plan", () => {
    const p = plan();
    const snapshot = JSON.stringify(p);
    applyToolCall(p, "reduce_week_volume", { week_number: 1, factor: 0.7 });
    applyToolCall(p, "shift_workout", { session_id: "w1d2", new_date: "2026-01-08" });
    expect(JSON.stringify(p)).toBe(snapshot);
  });

  it("shift_workout moves a session across weeks and keeps weeks sorted", () => {
    const out = applyToolCall(plan(), "shift_workout", { session_id: "w1d2", new_date: "2026-01-13" });
    expect(out.weeks[0].sessions.map(s => s.id)).toEqual(["w1d6"]);
    const moved = out.weeks[1].sessions.find(s => s.id === "w1d2");
    expect(moved.date).toBe("2026-01-13");
    expect(out.weeks[1].sessions.map(s => s.date)).toEqual([...out.weeks[1].sessions.map(s => s.date)].sort());
  });

  it("shift_workout refuses races, done sessions, race day and out-of-plan dates", () => {
    expect(() => applyToolCall(plan(), "shift_workout", { session_id: "race", new_date: "2026-01-20" })).toThrow(CoachToolError);
    expect(() => applyToolCall(plan(), "shift_workout", { session_id: "w2d2", new_date: "2026-01-15" })).toThrow(/completed/);
    expect(() => applyToolCall(plan(), "shift_workout", { session_id: "w1d2", new_date: "2026-02-20" })).toThrow(/race day/);
    expect(() => applyToolCall(plan(), "shift_workout", { session_id: "w1d2", new_date: "2025-12-01" })).toThrow(/outside/);
    expect(() => applyToolCall(plan(), "shift_workout", { session_id: "nope", new_date: "2026-01-13" })).toThrow(/No session/);
  });

  it("swap_session recomputes type, pace and description", () => {
    const out = applyToolCall(plan(), "swap_session", { session_id: "w1d2", new_type: "EASY" });
    const s = out.weeks[0].sessions.find(x => x.id === "w1d2");
    expect(s.type).toBe("EASY");
    expect(s.pace).toBe(Math.round(330 * 1.25));
    expect(s.desc).toMatch(/Easy run/);
    expect(() => applyToolCall(plan(), "swap_session", { session_id: "w1d2", new_type: "RACE" })).toThrow(/new_type/);
  });

  it("reduce_week_volume scales only remaining training sessions", () => {
    const out = applyToolCall(plan(), "reduce_week_volume", { week_number: 2, factor: 0.5 });
    expect(out.weeks[1].sessions.find(s => s.id === "w2d2").km).toBe(4); // done — untouched
    expect(out.weeks[1].sessions.find(s => s.id === "w2d6").km).toBe(5.5);
    expect(() => applyToolCall(plan(), "reduce_week_volume", { week_number: 2, factor: 1.2 })).toThrow(/factor/);
    expect(() => applyToolCall(plan(), "reduce_week_volume", { week_number: 9, factor: 0.5 })).toThrow(/No week/);
  });

  it("insert_recovery_week converts remaining sessions to short EASY runs", () => {
    const out = applyToolCall(plan(), "insert_recovery_week", { week_number: 1 });
    for (const s of out.weeks[0].sessions) {
      expect(s.type).toBe("EASY");
      expect(s.km).toBeLessThanOrEqual(6);
    }
  });

  it("convert_to_cross_training makes a WALK with no pace", () => {
    const out = applyToolCall(plan(), "convert_to_cross_training", { session_id: "w1d6" });
    const s = out.weeks[0].sessions.find(x => x.id === "w1d6");
    expect(s.type).toBe("WALK");
    expect(s.pace).toBeNull();
  });

  it("rejects unknown tools", () => {
    expect(() => applyToolCall(plan(), "delete_everything", {})).toThrow(/Unknown tool/);
  });

  // Property: any single tool applied with valid input to a valid plan yields a
  // plan the validator can always process (structured result, never a throw).
  it("tool → validate never throws; results stay structured", () => {
    const inputs = {
      shift_workout: { session_id: "w1d2", new_date: "2026-01-09" },
      swap_session: { session_id: "w1d2", new_type: "WALK" },
      reduce_week_volume: { week_number: 1, factor: 0.6 },
      insert_recovery_week: { week_number: 1 },
      convert_to_cross_training: { session_id: "w1d6" },
    };
    for (const def of TOOL_DEFS) {
      if (def.name === "reassess_goal_feasibility") continue;
      const out = applyToolCall(plan(), def.name, inputs[def.name]);
      const r = validatePlan(out, { baseline: plan() });
      expect(Array.isArray(r.errors)).toBe(true);
      expect(Array.isArray(r.warnings)).toBe(true);
      expect(typeof r.ok).toBe("boolean");
    }
  });
});

describe("assessGoalFeasibility", () => {
  const goal = { goalSec: 6600, distanceKm: 21.1, raceDate: "2026-05-01", targetPace: 313 };
  it("asks for data when there are no runs", () => {
    expect(assessGoalFeasibility({ ...goal, recentRuns: [] })).toMatch(/log a few runs/i);
  });
  it("calls out an unrealistic goal", () => {
    const runs = [{ date: "2026-01-01", type: "EASY", km: 5, durationSec: 5 * 450 }]; // 7:30/km best
    expect(assessGoalFeasibility({ ...goal, recentRuns: runs })).toMatch(/UNREALISTIC/);
  });
  it("accepts a plausible goal", () => {
    const runs = [
      { date: "2026-01-01", type: "TEMPO", km: 8, durationSec: 8 * 310 },
      { date: "2026-01-05", type: "LONG", km: 15, durationSec: 15 * 380 },
    ];
    expect(assessGoalFeasibility({ ...goal, recentRuns: runs })).toMatch(/plausible/);
  });
});
