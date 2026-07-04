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

  it("reduce_session_distance shortens only the target session, with a floor", () => {
    const out = applyToolCall(plan(), "reduce_session_distance", { session_id: "w1d6", factor: 0.5 });
    expect(out.weeks[0].sessions.find(s => s.id === "w1d6").km).toBe(5);
    expect(out.weeks[0].sessions.find(s => s.id === "w1d2").km).toBe(5); // untouched
    const floored = applyToolCall(plan(), "reduce_session_distance", { session_id: "w1d2", factor: 0.3 });
    expect(floored.weeks[0].sessions.find(s => s.id === "w1d2").km).toBe(1.5);
    expect(() => applyToolCall(plan(), "reduce_session_distance", { session_id: "w1d2", factor: 1.2 })).toThrow(/factor/);
    expect(() => applyToolCall(plan(), "reduce_session_distance", { session_id: "w2d2", factor: 0.5 })).toThrow(/completed/);
    expect(() => applyToolCall(plan(), "reduce_session_distance", { session_id: "race", factor: 0.5 })).toThrow(/race/);
  });

  it("cancel_session marks skipped and refuses done/RACE sessions", () => {
    const out = applyToolCall(plan(), "cancel_session", { session_id: "w1d2" });
    expect(out.weeks[0].sessions.find(s => s.id === "w1d2").skipped).toBe(true);
    expect(() => applyToolCall(plan(), "cancel_session", { session_id: "w2d2" })).toThrow(/completed/);
    expect(() => applyToolCall(plan(), "cancel_session", { session_id: "race" })).toThrow(/race/);
  });

  it("add_session inserts a capped, sorted session with a fresh id", () => {
    const out = applyToolCall(plan(), "add_session", { date: "2026-01-08", type: "EASY", km: 5 });
    const added = out.weeks[0].sessions.find(s => s.id === "coach-add-2026-01-08");
    expect(added).toMatchObject({ type: "EASY", km: 5, done: false });
    expect(added.pace).toBe(Math.round(330 * 1.25));
    expect(out.weeks[0].sessions.map(s => s.date)).toEqual([...out.weeks[0].sessions.map(s => s.date)].sort());
    // Same-date collision gets a suffixed id, not a duplicate.
    const twice = applyToolCall(out, "add_session", { date: "2026-01-08", type: "WALK", km: 3 });
    expect(twice.weeks[0].sessions.filter(s => s.date === "2026-01-08").map(s => s.id))
      .toEqual(["coach-add-2026-01-08", "coach-add-2026-01-08-2"]);
  });

  it("add_session refuses taper dates, oversized runs and out-of-plan dates", () => {
    // Race day is 2026-02-14: 2026-02-05 is inside the final 14 days.
    expect(() => applyToolCall(plan(), "add_session", { date: "2026-02-05", type: "EASY", km: 5 })).toThrow(/final 14 days/);
    // Longest training session in the fixture is 11 km.
    expect(() => applyToolCall(plan(), "add_session", { date: "2026-01-08", type: "LONG", km: 15 })).toThrow(/longest/);
    expect(() => applyToolCall(plan(), "add_session", { date: "2025-12-01", type: "EASY", km: 5 })).toThrow(/outside/);
    expect(() => applyToolCall(plan(), "add_session", { date: "2026-01-08", type: "RACE", km: 5 })).toThrow(/type/);
    expect(() => applyToolCall(plan(), "add_session", { date: "2026-01-08", type: "EASY", km: 0 })).toThrow(/km/);
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
      reduce_session_distance: { session_id: "w1d6", factor: 0.7 },
      cancel_session: { session_id: "w1d2" },
      add_session: { date: "2026-01-08", type: "EASY", km: 5 },
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
  const goal = { goal: { goalSec: 6600, distanceKm: 21.1, raceDate: "2026-05-01" }, targetPace: 313 };
  const today = (daysAgo) => new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);

  it("asks for data when there are no runs", () => {
    expect(assessGoalFeasibility({ ...goal, recentRuns: [] })).toMatch(/log a few runs/i);
  });
  it("calls out an unrealistic goal", () => {
    const runs = [{ date: today(3), type: "EASY", km: 5, durationSec: 5 * 450 }]; // 7:30/km best
    expect(assessGoalFeasibility({ ...goal, recentRuns: runs })).toMatch(/UNREALISTIC/);
  });
  it("accepts a plausible goal", () => {
    const runs = [
      { date: today(10), type: "TEMPO", km: 8, durationSec: 8 * 310 },
      { date: today(5), type: "LONG", km: 15, durationSec: 15 * 380 },
    ];
    expect(assessGoalFeasibility({ ...goal, recentRuns: runs })).toMatch(/plausible/);
  });
  it("flags a conservative goal when recent paces are comfortably faster", () => {
    // Target 313 s/km; best recent pace 280 (≤ 0.93×) with real endurance —
    // the "plan feels too easy" case should point at the goal, not the plan.
    const runs = [
      { date: today(4), type: "TEMPO", km: 8, durationSec: 8 * 280 },
      { date: today(9), type: "LONG", km: 15, durationSec: 15 * 340 },
    ];
    expect(assessGoalFeasibility({ ...goal, recentRuns: runs })).toMatch(/CONSERVATIVE/);
  });

  it("bases longest/pace stats on the last 4 weeks, not stale older history", () => {
    // A big long run and fast pace from 3 months ago must not make a currently
    // inactive runner's goal look supported by "recent" fitness.
    const runs = [
      { date: today(90), type: "LONG", km: 30, durationSec: 30 * 270 },
      { date: today(85), type: "TEMPO", km: 10, durationSec: 10 * 280 },
    ];
    const out = assessGoalFeasibility({ ...goal, recentRuns: runs });
    expect(out).not.toMatch(/longest recent run 30\.0 km/);
    expect(out).toMatch(/no runs logged in that window/);
    expect(out).toMatch(/longest run on record 30\.0 km/);
  });
});
