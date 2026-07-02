// Golden cases for the coach agent — the day-one eval set. Each case replays a
// situation (plan + run history + report) through the REAL proposal loop
// (engine.mjs: tool execution + validate-and-retry) with the MOCK_LLM scripts
// standing in for the model, and asserts the adaptation PROPERTY, not exact
// output. The same properties apply when a live model runs the loop; the
// propose/confirm audit log (agent_rounds) grows this dataset in production.

import { describe, it, expect } from "vitest";
import { generateProposal, MAX_VALIDATOR_RETRIES } from "../../supabase/functions/_shared/coach/engine.mjs";
import { createMockModel } from "../../supabase/functions/_shared/coach/mock.mjs";
import { validatePlan } from "./coachValidation";
import { buildPlan } from "./plan";
import { ymd } from "./format";

const weeksOut = (n) => { const d = new Date(); d.setDate(d.getDate() + n * 7); return ymd(d); };

function makeContext(report) {
  const plan = buildPlan(weeksOut(16), 6600, [{ dayOffset: 2, minutes: 45 }, { dayOffset: 6, minutes: 90 }], 21.1, 0, {});
  return {
    plan,
    report,
    today: ymd(new Date()),
    recentRuns: [{ date: ymd(new Date(Date.now() - 3 * 86400000)), type: "EASY", km: 6, durationSec: 6 * 380 }],
    goal: { raceDate: plan.raceDate, distanceKm: 21.1, goalSec: 6600 },
    goalSec: 6600, distanceKm: 21.1, raceDate: plan.raceDate, targetPace: plan.targetPace,
  };
}

const run = (report) => {
  const context = makeContext(report);
  return generateProposal({
    baseline: context.plan, context, callModel: createMockModel(context),
  }).then(result => ({ context, result }));
};

const hardKm = (plan) => plan.weeks.flatMap(w => w.sessions)
  .filter(s => ["TEMPO", "INTERVALS", "LONG"].includes(s.type) && !s.done)
  .reduce((t, s) => t + s.km, 0);
const weekTotal = (plan, n) => plan.weeks.find(w => w.weekNumber === n)
  ?.sessions.reduce((t, s) => t + (s.type === "RACE" ? 0 : s.km), 0) ?? 0;

describe("golden cases (MOCK_LLM)", () => {
  it("knee pain → intensity never increases; impact comes out; plan validates", async () => {
    const { context, result } = await run("my knee hurts after yesterday's run");
    expect(result.status).toBe("proposed");
    expect(result.changed).toBe(true);
    expect(hardKm(result.plan)).toBeLessThan(hardKm(context.plan));
    const walks = result.plan.weeks.flatMap(w => w.sessions).filter(s => s.type === "WALK");
    expect(walks.length).toBeGreaterThan(0);
    expect(validatePlan(result.plan, { baseline: context.plan }).ok).toBe(true);
    expect(result.usage.input_tokens).toBeGreaterThan(0); // cost is recorded
  });

  it("missed week → resume gently, never 'make up' volume", async () => {
    const { context, result } = await run("I missed the whole week, work exploded");
    expect(result.status).toBe("proposed");
    for (const w of result.plan.weeks) {
      expect(weekTotal(result.plan, w.weekNumber))
        .toBeLessThanOrEqual(weekTotal(context.plan, w.weekNumber) + 0.01);
    }
    expect(validatePlan(result.plan, { baseline: context.plan }).ok).toBe(true);
  });

  it("advice question → answer without touching the plan", async () => {
    const { context, result } = await run("what should I eat before the race?");
    expect(result.status).toBe("proposed");
    expect(result.changed).toBe(false);
    expect(result.plan).toEqual(context.plan);
    expect(result.rationale.length).toBeGreaterThan(0);
  });

  it("validator never satisfied → bounded retries, then no_valid_adjustment (never a broken plan)", async () => {
    const { result } = await run("force-invalid: stack my hard days together");
    expect(result.status).toBe("no_valid_adjustment");
    expect(result.plan).toBeUndefined(); // an invalid plan is never surfaced
    expect(MAX_VALIDATOR_RETRIES).toBeGreaterThan(0);
  });

  it("critique round: history + feedback reach the model in order", async () => {
    const context = makeContext("my knee hurts");
    const seen = [];
    const callModel = async (messages) => {
      seen.push(messages.map(m => m.role).join(","));
      return { content: [{ type: "text", text: "Understood — keeping it as is." }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 10 } };
    };
    const result = await generateProposal({
      baseline: context.plan, context,
      history: [{ user_feedback: null, rationale: "Eased week 2.", tool_calls: [{ name: "reduce_week_volume", input: { week_number: 2, factor: 0.7 } }] }],
      message: "actually only reduce the long run, keep the tempo",
      callModel,
    });
    expect(result.status).toBe("proposed");
    // report → assistant round 0 → new critique
    expect(seen[0]).toBe("user,assistant,user");
  });
});
