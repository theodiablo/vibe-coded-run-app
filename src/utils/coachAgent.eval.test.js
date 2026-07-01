// Golden-case eval harness for the coach agent. Each case is a situation
// (plan + runs + report) plus a RECORDED model decision (the tool calls a good
// coach would make), driven through the SAME generateProposal loop the edge
// function runs — with an injected fixture callModel, so this is fully offline
// (no Deno, no Anthropic, no network). We assert the safety property of the
// resulting plan, not the model's phrasing.
//
// Run: `npm run eval` (or it runs as part of `npm test`). The propose-confirm
// trajectory log is the real, growing eval dataset; this is the day-one
// regression set seeded from known situations.

import { describe, it, expect, afterAll } from "vitest";
import { buildPlan } from "./plan";
import { ymd } from "./format";
import { generateProposal } from "./coachAgent";
import { validatePlan } from "./planValidate";

function raceDateInDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return ymd(d);
}
const SESSIONS = [{ dayOffset: 2, minutes: 30 }, { dayOffset: 6, minutes: 60 }];
const plan = () => buildPlan(raceDateInDays(140), 7200, SESSIONS, 21.1, 0);

// Intensity/impact rank — used to assert "no session got harder".
const RANK = { EASY: 1, WALK: 1, OTHER: 1, LONG: 2, TEMPO: 3, INTERVALS: 4, RACE: 5 };
const weekByNumber = (p, n) => p.weeks.find((w) => w.weekNumber === n);
const weekVol = (w) => w.sessions.reduce((s, x) => s + x.km, 0);

// Build a fixture callModel from a scripted list of tool-call arrays: one array
// per model turn (later turns are the model "retrying" after validator feedback).
function scriptedModel(turns, text = "adjusting") {
  let turn = 0;
  return () => {
    const calls = turns[Math.min(turn, turns.length - 1)];
    turn++;
    const toolUses = calls.map((c, i) => ({ id: `toolu_${turn}_${i}`, name: c.name, input: c.input }));
    return {
      toolUses,
      text,
      rawContent: toolUses.map((tu) => ({ type: "tool_use", id: tu.id, name: tu.name, input: tu.input })),
      usage: { input: 10, output: 5 },
    };
  };
}

const run = (p, callModel) =>
  generateProposal({ plan: p, contextText: "eval", callModel, model: "fixture" });

// The build week the fixtures target (safely past BASE, before TAPER).
const buildWeekNo = (p) => p.weeks[4].weekNumber;

const cases = [
  {
    name: "knee pain → recovery, never more intensity",
    async check() {
      const p = plan();
      const wn = buildWeekNo(p);
      const before = weekByNumber(p, wn);
      const res = await run(p, scriptedModel([[{ name: "insert_recovery_week", input: { weekNumber: wn } }]]));
      expect(res.status).toBe("proposed");
      const after = weekByNumber(res.proposedPlan, wn);
      expect(weekVol(after)).toBeLessThanOrEqual(weekVol(before));
      // No session moved UP the hardness ladder.
      for (const s of after.sessions) {
        const orig = before.sessions.find((o) => o.id === s.id);
        if (orig) expect(RANK[s.type]).toBeLessThanOrEqual(RANK[orig.type]);
      }
    },
  },
  {
    name: "missed full week → no make-up volume jump",
    async check() {
      const p = plan();
      const wn = buildWeekNo(p);
      const before = weekVol(weekByNumber(p, wn));
      const res = await run(p, scriptedModel([[{ name: "reduce_week_volume", input: { weekNumber: wn, factor: 0.7 } }]]));
      expect(res.status).toBe("proposed");
      expect(weekVol(weekByNumber(res.proposedPlan, wn))).toBeLessThanOrEqual(before);
      expect(validatePlan(res.proposedPlan).valid).toBe(true);
    },
  },
  {
    name: "overreaching → every session dialled back",
    async check() {
      const p = plan();
      const wn = buildWeekNo(p);
      const before = weekByNumber(p, wn).sessions.map((s) => ({ id: s.id, km: s.km }));
      const res = await run(p, scriptedModel([[{ name: "reduce_week_volume", input: { weekNumber: wn, factor: 0.6 } }]]));
      expect(res.status).toBe("proposed");
      for (const s of weekByNumber(res.proposedPlan, wn).sessions) {
        if (s.type === "RACE") continue;
        expect(s.km).toBeLessThanOrEqual(before.find((o) => o.id === s.id).km);
      }
    },
  },
  {
    name: "goal made easier → paces slow, plan valid",
    async check() {
      const p = plan();
      const beforePace = p.weeks[4].sessions[0].pace;
      const res = await run(p, scriptedModel([[{ name: "reassess_goal_feasibility", input: { newGoalSec: 7200 * 1.1 } }]]));
      expect(res.status).toBe("proposed");
      expect(res.proposedPlan.weeks[4].sessions[0].pace).toBeGreaterThan(beforePace);
      expect(validatePlan(res.proposedPlan).valid).toBe(true);
    },
  },
  {
    name: "goal made harder → paces quicken, plan valid",
    async check() {
      const p = plan();
      const beforePace = p.weeks[4].sessions[0].pace;
      const res = await run(p, scriptedModel([[{ name: "reassess_goal_feasibility", input: { newGoalSec: 7200 * 0.9 } }]]));
      expect(res.status).toBe("proposed");
      expect(res.proposedPlan.weeks[4].sessions[0].pace).toBeLessThan(beforePace);
      expect(validatePlan(res.proposedPlan).valid).toBe(true);
    },
  },
  {
    name: "invalid tool call every turn → no_valid_adjustment (no commit)",
    async check() {
      const p = plan();
      const wn = buildWeekNo(p);
      // factor 2 is out of range → the transform throws every turn → loop exhausts.
      const res = await run(p, scriptedModel([[{ name: "reduce_week_volume", input: { weekNumber: wn, factor: 2 } }]]));
      expect(res.status).toBe("no_valid_adjustment");
      expect(res.proposedPlan).toBeUndefined();
    },
  },
  {
    name: "invalid then valid → loop recovers and proposes",
    async check() {
      const p = plan();
      const wn = buildWeekNo(p);
      // Turn 0 throws (bad factor), turn 1 is valid → proposal after one retry.
      const res = await run(
        p,
        scriptedModel([
          [{ name: "reduce_week_volume", input: { weekNumber: wn, factor: 2 } }],
          [{ name: "reduce_week_volume", input: { weekNumber: wn, factor: 0.7 } }],
        ]),
      );
      expect(res.status).toBe("proposed");
      expect(validatePlan(res.proposedPlan).valid).toBe(true);
    },
  },
];

let passed = 0;

describe("coach-agent golden eval", () => {
  it.each(cases)("$name", async ({ check }) => {
    await check();
    passed++;
  });

  afterAll(() => {
    // Headline: golden pass rate. Production metrics (first-proposal acceptance
    // rate, rounds-to-accept) come from the agent_rounds log — see the function
    // README for the SQL.
    console.log(`\ncoach-agent golden eval: ${passed}/${cases.length} passed`);
  });
});
