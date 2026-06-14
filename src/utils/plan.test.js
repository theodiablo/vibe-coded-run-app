import { describe, it, expect } from "vitest";
import { buildPlan } from "./plan";
import { ymd } from "./format";

// buildPlan is relative to "today"; build a race date a fixed span ahead so the
// plan always has a healthy number of weeks regardless of when tests run.
function raceDateInDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return ymd(d);
}

const SESSIONS = [{dayOffset: 2, minutes: 30}, {dayOffset: 6, minutes: 60}];

describe("buildPlan", () => {
  it("echoes the core inputs and computes flat target pace", () => {
    const plan = buildPlan(raceDateInDays(120), 7200, SESSIONS, 20, 0);
    expect(plan.goalSec).toBe(7200);
    expect(plan.distanceKm).toBe(20);
    expect(plan.raceElevation).toBe(0);
    expect(plan.planSessions).toEqual(SESSIONS);
    expect(plan.targetPace).toBe(360); // 7200 / 20
  });

  it("grade-adjusts target pace for race elevation", () => {
    const plan = buildPlan(raceDateInDays(120), 7200, SESSIONS, 20, 200);
    // flatEqDist = 20 + 8*200/1000 = 21.6; round(7200 / 21.6) = 333
    expect(plan.targetPace).toBe(333);
    expect(plan.raceElevation).toBe(200);
  });

  it("ends with a single RACE-day week", () => {
    const plan = buildPlan(raceDateInDays(120), 7200, SESSIONS, 20, 0);
    const last = plan.weeks[plan.weeks.length - 1];
    expect(last.phase).toBe("RACE");
    expect(last.sessions).toHaveLength(1);
    expect(last.sessions[0].type).toBe("RACE");
    expect(last.sessions[0].km).toBe(20);
  });

  it("produces weeks with sane, well-formed sessions", () => {
    const plan = buildPlan(raceDateInDays(120), 7200, SESSIONS, 20, 0);
    expect(plan.weeks.length).toBeGreaterThan(2);
    const phases = new Set(plan.weeks.map(w => w.phase));
    expect(phases.has("RACE")).toBe(true);
    // Every non-race session is uncompleted, identified, and at least 1.5 km.
    plan.weeks.slice(0, -1).forEach(w => {
      w.sessions.forEach(s => {
        expect(s.done).toBe(false);
        expect(s.id).toBeTruthy();
        expect(s.km).toBeGreaterThanOrEqual(1.5);
        expect(s.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      });
    });
  });

  it("clamps very short horizons to a minimum of 4 build weeks + race week", () => {
    const plan = buildPlan(raceDateInDays(7), 7200, SESSIONS, 20, 0);
    expect(plan.weeks.length).toBeGreaterThanOrEqual(5);
  });
});
