import { describe, it, expect } from "vitest";
import { buildPlan } from "./plan";
import { ymd } from "./format";
import { applyToolCall, TOOL_NAMES } from "./planTools";
import { validatePlan } from "./planValidate";

function raceDateInDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return ymd(d);
}

const SESSIONS = [{ dayOffset: 2, minutes: 30 }, { dayOffset: 6, minutes: 60 }];
const plan = () => buildPlan(raceDateInDays(140), 7200, SESSIONS, 21.1, 0);

// All session ids in a plan, in order.
const allIds = (p) => p.weeks.flatMap((w) => w.sessions.map((s) => s.id));
// A build week (index 4 is safely past BASE, before TAPER for a 140-day plan).
const buildWeek = (p) => p.weeks[4];

describe("applyToolCall — invariants shared by every tool", () => {
  it("never mutates the input plan and returns a fresh object", () => {
    for (const name of TOOL_NAMES) {
      const p = plan();
      const before = JSON.stringify(p);
      const wk = buildWeek(p);
      const input = {
        shift_workout: { sessionId: wk.sessions[0].id, days: 1 },
        swap_session: { sessionIdA: wk.sessions[0].id, sessionIdB: wk.sessions[1].id },
        reduce_week_volume: { weekNumber: wk.weekNumber, factor: 0.7 },
        insert_recovery_week: { weekNumber: wk.weekNumber },
        convert_to_cross_training: { sessionId: wk.sessions[0].id },
        reassess_goal_feasibility: { newGoalSec: 8000 },
      }[name];
      const out = applyToolCall(p, name, input);
      expect(out, name).not.toBe(p);
      expect(JSON.stringify(p), `${name} mutated input`).toBe(before);
    }
  });

  it("preserves the full set of session ids (progress linkage)", () => {
    for (const name of TOOL_NAMES) {
      const p = plan();
      const wk = buildWeek(p);
      const input = {
        shift_workout: { sessionId: wk.sessions[0].id, days: 1 },
        swap_session: { sessionIdA: wk.sessions[0].id, sessionIdB: wk.sessions[1].id },
        reduce_week_volume: { weekNumber: wk.weekNumber, factor: 0.7 },
        insert_recovery_week: { weekNumber: wk.weekNumber },
        convert_to_cross_training: { sessionId: wk.sessions[0].id },
        reassess_goal_feasibility: { newGoalSec: 8000 },
      }[name];
      const out = applyToolCall(p, name, input);
      expect(new Set(allIds(out)), name).toEqual(new Set(allIds(p)));
    }
  });

  it("validatePlan never throws on any single-tool output (property)", () => {
    for (const name of TOOL_NAMES) {
      const p = plan();
      const wk = buildWeek(p);
      const input = {
        shift_workout: { sessionId: wk.sessions[0].id, days: 2 },
        swap_session: { sessionIdA: wk.sessions[0].id, sessionIdB: wk.sessions[1].id },
        reduce_week_volume: { weekNumber: wk.weekNumber, factor: 0.6 },
        insert_recovery_week: { weekNumber: wk.weekNumber },
        convert_to_cross_training: { sessionId: wk.sessions[0].id },
        reassess_goal_feasibility: { newGoalSec: 8000 },
      }[name];
      const out = applyToolCall(p, name, input);
      const r = validatePlan(out);
      expect(r, name).toHaveProperty("valid");
      expect(Array.isArray(r.errors), name).toBe(true);
    }
  });

  it("throws on an unknown tool name", () => {
    expect(() => applyToolCall(plan(), "delete_everything", {})).toThrow(/Unknown tool/);
  });
});

describe("shift_workout", () => {
  it("moves a session by the given number of days and re-sorts the week", () => {
    const p = plan();
    const wk = buildWeek(p);
    const target = wk.sessions[0];
    const out = applyToolCall(p, "shift_workout", { sessionId: target.id, days: 1 });
    const moved = out.weeks[4].sessions.find((s) => s.id === target.id);
    const expected = ymd(new Date(new Date(target.date + "T00:00:00").getTime() + 86400000));
    expect(moved.date).toBe(expected);
    const dates = out.weeks[4].sessions.map((s) => s.date);
    expect(dates).toEqual([...dates].sort());
  });

  it("throws for a missing session", () => {
    expect(() => applyToolCall(plan(), "shift_workout", { sessionId: "nope", days: 1 })).toThrow();
  });
});

describe("swap_session", () => {
  it("swaps the dates of two sessions, keeping both ids", () => {
    const p = plan();
    const wk = buildWeek(p);
    const [a, b] = wk.sessions;
    const da = a.date, db = b.date;
    const out = applyToolCall(p, "swap_session", { sessionIdA: a.id, sessionIdB: b.id });
    const oa = out.weeks[4].sessions.find((s) => s.id === a.id);
    const ob = out.weeks[4].sessions.find((s) => s.id === b.id);
    expect(oa.date).toBe(db);
    expect(ob.date).toBe(da);
    expect(validatePlan(out).valid).toBe(true);
  });
});

describe("reduce_week_volume", () => {
  it("scales non-RACE distances and keeps the plan valid", () => {
    const p = plan();
    const wk = buildWeek(p);
    const before = wk.sessions.map((s) => s.km);
    const out = applyToolCall(p, "reduce_week_volume", { weekNumber: wk.weekNumber, factor: 0.5 });
    const after = out.weeks[4].sessions.map((s) => s.km);
    after.forEach((km, i) => expect(km).toBeLessThanOrEqual(before[i]));
    expect(validatePlan(out).valid).toBe(true);
  });

  it("rejects a factor outside (0,1)", () => {
    const p = plan();
    expect(() => applyToolCall(p, "reduce_week_volume", { weekNumber: 5, factor: 1.5 })).toThrow();
  });
});

describe("insert_recovery_week", () => {
  it("converts a week to easy recovery at reduced volume", () => {
    const p = plan();
    const wk = buildWeek(p);
    const out = applyToolCall(p, "insert_recovery_week", { weekNumber: wk.weekNumber });
    const outWk = out.weeks[4];
    expect(outWk.sessions.every((s) => s.type === "EASY")).toBe(true);
    expect(validatePlan(out).valid).toBe(true);
  });
});

describe("convert_to_cross_training", () => {
  it("turns a running session into low-impact OTHER", () => {
    const p = plan();
    const wk = buildWeek(p);
    const target = wk.sessions[0];
    const out = applyToolCall(p, "convert_to_cross_training", { sessionId: target.id });
    const conv = out.weeks[4].sessions.find((s) => s.id === target.id);
    expect(conv.type).toBe("OTHER");
    expect(validatePlan(out).valid).toBe(true);
  });

  it("refuses to convert the race session", () => {
    const p = plan();
    const raceId = p.weeks[p.weeks.length - 1].sessions[0].id;
    expect(() => applyToolCall(p, "convert_to_cross_training", { sessionId: raceId })).toThrow();
  });
});

describe("reassess_goal_feasibility", () => {
  it("scales every pace by the goal-time ratio and updates goalSec", () => {
    const p = plan();
    const beforePace = p.weeks[4].sessions[0].pace;
    const out = applyToolCall(p, "reassess_goal_feasibility", { newGoalSec: 7200 * 1.1 });
    expect(out.goalSec).toBe(Math.round(7200 * 1.1));
    const afterPace = out.weeks[4].sessions[0].pace;
    expect(afterPace).toBe(Math.round(beforePace * 1.1));
    expect(validatePlan(out).valid).toBe(true);
  });

  it("throws on a non-positive new goal", () => {
    expect(() => applyToolCall(plan(), "reassess_goal_feasibility", { newGoalSec: 0 })).toThrow();
  });
});
