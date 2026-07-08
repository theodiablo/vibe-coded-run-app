import { describe, it, expect } from "vitest";
import { validatePlan, formatValidation } from "./coachValidation";
import { buildPlan } from "./plan";
import { ymd } from "./format";

// ── hand-crafted fixture ──────────────────────────────────────────────────────
// 6 weeks, Mondays from 2026-01-05, race Sat 2026-02-14. Volumes ramp gently,
// hard days are Wed/Sun, taper sheds volume — a plan that should be clean.
const sess = (id, date, type, km, extra = {}) =>
  ({ id, date, type, km, pace: 360, done: false, ...extra });
const wk = (weekNumber, startDate, phase, sessions) => ({ weekNumber, startDate, phase, sessions });

const cleanPlan = () => ({
  raceDate: "2026-02-14", distanceKm: 20, goalSec: 6600, targetPace: 330, planSessions: [],
  weeks: [
    wk(1, "2026-01-05", "BASE", [sess("w1d2", "2026-01-07", "EASY", 4), sess("w1d6", "2026-01-11", "LONG", 8)]),
    wk(2, "2026-01-12", "BUILD", [sess("w2d2", "2026-01-14", "EASY", 4), sess("w2d6", "2026-01-18", "LONG", 9)]),
    wk(3, "2026-01-19", "BUILD", [sess("w3d2", "2026-01-21", "TEMPO", 5), sess("w3d6", "2026-01-25", "LONG", 10)]),
    wk(4, "2026-01-26", "PEAK", [sess("w4d2", "2026-01-28", "INTERVALS", 5), sess("w4d6", "2026-02-01", "LONG", 11)]),
    wk(5, "2026-02-02", "TAPER", [sess("w5d2", "2026-02-04", "EASY", 3), sess("w5d6", "2026-02-08", "LONG", 6)]),
    wk(6, "2026-02-09", "RACE", [sess("race", "2026-02-14", "RACE", 20)]),
  ],
});

describe("validatePlan rules", () => {
  it("passes a clean plan", () => {
    const r = validatePlan(cleanPlan());
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("rejects malformed plans and sessions", () => {
    expect(validatePlan(null).ok).toBe(false);
    expect(validatePlan({ raceDate: "2026-02-14", weeks: [] }).ok).toBe(false);
    const p = cleanPlan();
    p.weeks[0].sessions[0].type = "JOG";
    const r = validatePlan(p);
    expect(r.errors.some(e => e.code === "MALFORMED")).toBe(true);
  });

  it("flags hard sessions on consecutive days", () => {
    const p = cleanPlan();
    p.weeks[2].sessions[0].date = "2026-01-24"; // TEMPO the day before Sunday's LONG
    const r = validatePlan(p);
    expect(r.errors.some(e => e.code === "HARD_BACK_TO_BACK")).toBe(true);
  });

  it("skipped sessions contribute no load: spacing, taper and ramp ignore them", () => {
    // A skipped TEMPO the day before the LONG is not a hard back-to-back —
    // it will not be run.
    const p = cleanPlan();
    p.weeks[2].sessions[0].date = "2026-01-24";
    p.weeks[2].sessions[0].skipped = true;
    expect(validatePlan(p).errors.some(e => e.code === "HARD_BACK_TO_BACK")).toBe(false);
    // Skipped intervals inside the final 14 days don't trip the taper rule.
    const q = cleanPlan();
    q.weeks[4].sessions[0].type = "INTERVALS";
    q.weeks[4].sessions[0].skipped = true;
    expect(validatePlan(q).errors.some(e => e.code === "TAPER_INTERVALS")).toBe(false);
    // A big session that is skipped doesn't count toward the weekly ramp.
    const r = cleanPlan();
    r.weeks[2].sessions[1].km = 25;
    r.weeks[2].sessions[1].skipped = true;
    expect(validatePlan(r).errors.some(e => e.code === "RAMP_EXCEEDED")).toBe(false);
  });

  it("ramp still gates a jump above pre-layoff volume when the two prior weeks are fully skipped", () => {
    // Weeks 2 and 3 fully skipped (a two-week layoff). Skipped km reads as 0,
    // so a naive two-week reference would collapse to 0 and un-gate the ramp.
    // Resuming week 4 near the pre-layoff level is fine, but jumping well above
    // it is still "making up volume" — the reference walks back to week 1.
    const base = cleanPlan();
    for (const s of base.weeks[1].sessions) s.skipped = true; // week 2 → 0 km
    for (const s of base.weeks[2].sessions) s.skipped = true; // week 3 → 0 km
    expect(validatePlan(base).errors.some(e => e.code === "RAMP_EXCEEDED")).toBe(false);

    const jump = structuredClone(base);
    jump.weeks[3].sessions[1].km = 20; // week 4 → 25 km vs week 1's 12 km
    expect(validatePlan(jump).errors.some(e => e.code === "RAMP_EXCEEDED" && e.weekNumber === 4)).toBe(true);
  });

  it("flags a week-over-week volume jump", () => {
    const p = cleanPlan();
    p.weeks[2].sessions[1].km = 25; // week 3: 30 km after 13 km
    const r = validatePlan(p);
    expect(r.errors.some(e => e.code === "RAMP_EXCEEDED" && e.weekNumber === 3)).toBe(true);
  });

  it("guards the taper: no intervals in the final 14 days, tempo in the final 7", () => {
    const p = cleanPlan();
    p.weeks[4].sessions[0].type = "INTERVALS"; // 2026-02-04, 10 days out
    expect(validatePlan(p).errors.some(e => e.code === "TAPER_INTERVALS")).toBe(true);
    const q = cleanPlan();
    q.weeks[5].sessions.unshift(sess("w6d1", "2026-02-10", "TEMPO", 5)); // 4 days out
    expect(validatePlan(q).errors.some(e => e.code === "TAPER_TEMPO")).toBe(true);
  });

  it("keeps the final weeks below peak volume", () => {
    const p = cleanPlan();
    p.weeks[4].sessions[1].km = 15; // taper week back at 18 km vs 16 km peak
    expect(validatePlan(p).errors.some(e => e.code === "TAPER_VOLUME")).toBe(true);
  });

  it("rejects training sessions on/after race day, allows the race itself", () => {
    const p = cleanPlan();
    p.weeks[5].sessions.push(sess("w6d5", "2026-02-14", "EASY", 3));
    expect(validatePlan(p).errors.some(e => e.code === "AFTER_RACE")).toBe(true);
  });

  it("waives errors that exist identically in the baseline — but not new ones", () => {
    const baseline = cleanPlan();
    baseline.weeks[2].sessions[0].date = "2026-01-24"; // pre-existing back-to-back
    const proposal = structuredClone(baseline);
    const r = validatePlan(proposal, { baseline });
    expect(r.ok).toBe(true);
    expect(r.warnings.some(w => w.code === "HARD_BACK_TO_BACK" && w.preexisting)).toBe(true);
    // A NEW violation elsewhere still blocks.
    proposal.weeks[3].sessions[0].date = "2026-01-31"; // INTERVALS day before LONG
    expect(validatePlan(proposal, { baseline }).ok).toBe(false);
  });

  it("does not waive a changed hard back-to-back pairing for the same later session", () => {
    const baseline = cleanPlan();
    baseline.weeks[2].sessions[0].date = "2026-01-24"; // TEMPO before Sunday's LONG
    const proposal = structuredClone(baseline);
    proposal.weeks[2].sessions[0].date = "2026-01-21";
    proposal.weeks[2].sessions.unshift(sess("new-hard", "2026-01-24", "INTERVALS", 4));

    const r = validatePlan(proposal, { baseline });

    expect(r.ok).toBe(false);
    expect(r.errors.some(e => e.code === "HARD_BACK_TO_BACK" && e.sessionId === "w3d6")).toBe(true);
  });

  it("formatValidation renders codes and messages", () => {
    const p = cleanPlan();
    p.weeks[2].sessions[1].km = 25;
    expect(formatValidation(validatePlan(p))).toContain("RAMP_EXCEEDED");
    expect(formatValidation(validatePlan(cleanPlan()))).toBe("Plan is valid.");
  });
});

// ── one validator, two callers: the deterministic generator must pass too ────
describe("buildPlan output passes the shared validator", () => {
  const weeksOut = (n) => {
    const d = new Date(); d.setDate(d.getDate() + n * 7);
    return ymd(d);
  };
  const seedRuns = (longest) => [
    { id: "r1", date: ymd(new Date(Date.now() - 5 * 86400000)), type: "LONG", km: longest, durationSec: longest * 360 },
    { id: "r2", date: ymd(new Date(Date.now() - 12 * 86400000)), type: "EASY", km: longest * 0.6, durationSec: longest * 0.6 * 380 },
  ];
  const sessions = [{ dayOffset: 2, minutes: 45 }, { dayOffset: 6, minutes: 90 }];

  const cases = [
    ["10k, 12 weeks, from scratch", weeksOut(12), 3000, 10, 0, {}],
    ["half, 16 weeks, from scratch", weeksOut(16), 6600, 21.1, 150, {}],
    ["marathon, 20 weeks, fit runner", weeksOut(20), 14400, 42.2, 300, { recentRuns: seedRuns(18) }],
    ["marathon, 16 weeks, fit runner", weeksOut(16), 14400, 42.2, 0, { recentRuns: seedRuns(22) }],
    ["distant race (>24w cap)", weeksOut(40), 6600, 21.1, 0, {}],
  ];

  it.each(cases)("%s", (_label, raceDate, goalSec, distanceKm, elev, opts) => {
    const plan = buildPlan(raceDate, goalSec, sessions, distanceKm, elev, opts);
    const r = validatePlan(plan);
    expect(r.errors).toEqual([]);
  });

  it("flags an unsafe crash plan (marathon in 6 weeks from scratch) — by design", () => {
    // The generator will happily build this; the validator disagrees. Safety >
    // consistency: the agent can still operate on such a plan via the baseline
    // waiver, but may never make it worse.
    const plan = buildPlan(weeksOut(6), 14400, sessions, 42.2, 0, {});
    const r = validatePlan(plan);
    expect(r.ok).toBe(false);
    expect(validatePlan(plan, { baseline: plan }).ok).toBe(true);
  });
});
