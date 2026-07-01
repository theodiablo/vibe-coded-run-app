import { describe, it, expect } from "vitest";
import { buildPlan } from "./plan";
import { ymd } from "./format";
import {
  validatePlan,
  MAX_WEEK_VOLUME_RATIO,
  MIN_ABS_VOLUME_SPIKE_KM,
  MAX_CONSECUTIVE_HARD_DAYS,
} from "./planValidate";

function raceDateInDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return ymd(d);
}

// Realistic training-day configs, mirroring what SessionConfigurator produces:
// 2–4 sessions/week spread across non-adjacent days.
const SESSION_CONFIGS = [
  [{ dayOffset: 2, minutes: 30 }, { dayOffset: 6, minutes: 60 }],
  [{ dayOffset: 1, minutes: 30 }, { dayOffset: 3, minutes: 40 }, { dayOffset: 5, minutes: 60 }],
  [{ dayOffset: 0, minutes: 45 }, { dayOffset: 2, minutes: 30 }, { dayOffset: 4, minutes: 40 }, { dayOffset: 6, minutes: 70 }],
  [{ dayOffset: 2, minutes: 45 }, { dayOffset: 5, minutes: 90 }],
];
const DISTANCES = [10, 21.1, 42.2, 70];
const HORIZONS = [56, 120, 180];
const ELEVATIONS = [0, 600];

function* matrix() {
  for (const km of DISTANCES)
    for (const days of HORIZONS)
      for (const cfg of SESSION_CONFIGS)
        for (const elev of ELEVATIONS)
          yield { plan: buildPlan(raceDateInDays(days), Math.round(km * 360), cfg, km, elev), km, days };
}

// A convenient valid base plan for the single-rule tests below.
const basePlan = () => buildPlan(raceDateInDays(140), 7200, SESSION_CONFIGS[0], 21.1, 0);

describe("validatePlan — reconciliation with the deterministic generator", () => {
  it("passes every plan the generator produces across a realistic matrix", () => {
    for (const { plan, km, days } of matrix()) {
      const { valid, errors } = validatePlan(plan);
      expect(valid, `km=${km} days=${days} errors=${JSON.stringify(errors)}`).toBe(true);
    }
  });

  it("no generator week trips the combined (ratio AND absolute) volume spike rule", () => {
    // The spike rule needs BOTH a ratio breach and a big absolute jump. The
    // generator's steepest ratios coincide with tiny absolute jumps, so the
    // combined predicate never fires — while a make-up spike (large km jump)
    // would. This documents that the two thresholds separate the cases.
    let worst = null;
    for (const { plan, km, days } of matrix()) {
      const weeks = plan.weeks.filter((w) => w.phase !== "RACE");
      for (let i = 1; i < weeks.length; i++) {
        const prev = weeks[i - 1].sessions.reduce((s, x) => s + x.km, 0);
        const cur = weeks[i].sessions.reduce((s, x) => s + x.km, 0);
        if (prev > 0 && cur > prev * MAX_WEEK_VOLUME_RATIO && cur - prev > MIN_ABS_VOLUME_SPIKE_KM) {
          worst = { km, days, prev, cur };
        }
      }
    }
    expect(worst, `generator tripped the spike rule: ${JSON.stringify(worst)}`).toBeNull();
  });
});

describe("validatePlan — structural rules", () => {
  it("accepts a well-formed plan", () => {
    expect(validatePlan(basePlan()).valid).toBe(true);
  });

  it("rejects a null / empty plan", () => {
    expect(validatePlan(null).valid).toBe(false);
    expect(validatePlan({ weeks: [] }).valid).toBe(false);
    expect(validatePlan(null).errors[0].code).toBe("E_NO_WEEKS");
  });

  it("flags an unknown session type", () => {
    const p = basePlan();
    p.weeks[3].sessions[0].type = "SPRINT";
    const r = validatePlan(p);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "E_TYPE")).toBe(true);
  });

  it("flags an unknown phase", () => {
    const p = basePlan();
    p.weeks[2].phase = "WARMUP";
    expect(validatePlan(p).errors.some((e) => e.code === "E_PHASE")).toBe(true);
  });

  it("flags a negative distance and a bad date", () => {
    const p = basePlan();
    p.weeks[3].sessions[0].km = -1;
    p.weeks[3].sessions[1].date = "not-a-date";
    const codes = validatePlan(p).errors.map((e) => e.code);
    expect(codes).toContain("E_KM");
    expect(codes).toContain("E_DATE");
  });

  it("flags a session missing its id and anchors errors to sessionId", () => {
    const p = basePlan();
    p.weeks[3].sessions[0].km = -5;
    const err = validatePlan(p).errors.find((e) => e.code === "E_KM");
    expect(err.sessionId).toBe(p.weeks[3].sessions[0].id);
  });
});

describe("validatePlan — safety rules", () => {
  it("catches a runaway week-over-week volume spike", () => {
    const p = basePlan();
    // Double a mid-plan build week relative to its predecessor.
    const wk = p.weeks[5];
    wk.sessions.forEach((s) => (s.km *= 4));
    const r = validatePlan(p);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "E_VOLUME_SPIKE")).toBe(true);
  });

  it("catches a taper week that carries more than the pre-taper peak", () => {
    const p = basePlan();
    const taper = p.weeks.find((w) => w.phase === "TAPER");
    expect(taper).toBeTruthy();
    taper.sessions.forEach((s) => (s.km += 100));
    expect(validatePlan(p).errors.some((e) => e.code === "E_TAPER")).toBe(true);
  });

  // Isolated single-week plan so consecutive-day counting isn't affected by
  // neighbouring weeks (the check is deliberately global across the whole plan).
  const miniPlan = (sessions) => ({
    raceDate: "2030-06-01", goalSec: 7200, distanceKm: 21.1, targetPace: 341,
    weeks: [
      { weekNumber: 1, startDate: "2029-01-01", phase: "BUILD", sessions },
      { weekNumber: 2, startDate: "2030-05-27", phase: "RACE", sessions: [
        { id: "race", date: "2030-06-01", type: "RACE", desc: "", km: 21.1, pace: 341, done: false, runId: null },
      ] },
    ],
  });
  const day = (i) => ymd(new Date(new Date("2029-01-01T00:00:00").getTime() + i * 86400000));
  const sess = (i, type) => ({ id: `s${i}`, date: day(i), type, desc: "", km: 8, pace: 400, done: false, runId: null });

  it("catches three hard sessions on consecutive days", () => {
    const p = miniPlan([sess(0, "TEMPO"), sess(1, "INTERVALS"), sess(2, "LONG")]);
    const r = validatePlan(p);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "E_CONSECUTIVE_HARD")).toBe(true);
  });

  it("allows two hard sessions on consecutive days (the generator can too)", () => {
    expect(MAX_CONSECUTIVE_HARD_DAYS).toBe(2);
    const p = miniPlan([sess(0, "TEMPO"), sess(1, "LONG"), sess(4, "EASY")]);
    expect(validatePlan(p).errors.some((e) => e.code === "E_CONSECUTIVE_HARD")).toBe(false);
  });
});
