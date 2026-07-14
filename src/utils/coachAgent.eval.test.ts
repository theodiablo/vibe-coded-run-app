// Offline eval harness for the coach agent. These cases drive the same
// generateProposal loop the edge function uses, but with scripted model turns so
// it never calls Anthropic. Assertions check coaching/safety properties rather
// than exact wording.

import { afterAll, describe, expect, it } from "vitest";
// @ts-expect-error Shared edge-function ESM has no TypeScript declarations yet.
import { generateProposal, buildMessages } from "../../supabase/functions/_shared/coach/engine.mjs";
import { validatePlan } from "./coachValidation";
import { buildPlan } from "./plan";
import { ymd } from "./format";

type TestSession = {
  id: string;
  date: string;
  type: string;
  km: number;
  done?: boolean;
  skipped?: boolean;
  weekNumber?: number;
};
type TestWeek = { weekNumber: number; phase: string; sessions: TestSession[] };
type TestPlan = { raceDate: string; targetPace: number; weeks: TestWeek[] };
type TestContext = ReturnType<typeof makeContext>;
type ToolCall = { name: string; input: Record<string, string | number> };
type ProposalResult = { status: string; changed?: boolean; plan?: TestPlan };

const SESSIONS = [{ dayOffset: 2, minutes: 45 }, { dayOffset: 6, minutes: 90 }];
const weeksOut = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n * 7);
  return ymd(d);
};

function makeContext(report: string) {
  const plan = buildPlan(weeksOut(18), 6600, SESSIONS, 21.1, 0, {}) as TestPlan;
  return {
    plan,
    report,
    today: ymd(new Date()),
    recentRuns: [{ date: ymd(new Date(Date.now() - 3 * 86400000)), type: "EASY", km: 6, durationSec: 6 * 380 }],
    goal: { raceDate: plan.raceDate, distanceKm: 21.1, goalSec: 6600 },
    goalSec: 6600,
    distanceKm: 21.1,
    raceDate: plan.raceDate,
    targetPace: plan.targetPace,
  };
}

function scriptedModel(turns: ToolCall[][], finalText = "This keeps the plan safer without chasing missed volume.") {
  let turn = 0;
  return async () => {
    const calls = turns[Math.min(turn, turns.length - 1)] || [];
    turn++;
    if (!calls.length) {
      return { content: [{ type: "text", text: finalText }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 } };
    }
    return {
      content: [
        { type: "text", text: "Adjusting the plan." },
        ...calls.map((c, i) => ({ type: "tool_use", id: `toolu_${turn}_${i}`, name: c.name, input: c.input })),
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 10, output_tokens: 5 },
    };
  };
}

const run = (context: TestContext, turns: ToolCall[][], finalText?: string) => generateProposal({
  baseline: context.plan,
  context,
  callModel: scriptedModel(turns, finalText),
}) as Promise<ProposalResult>;

const buildWeek = (plan: TestPlan) => plan.weeks.find(w => w.phase === "BUILD" && w.sessions.some(s => s.type !== "RACE"))!;
const weekVol = (week: TestWeek) => week.sessions.reduce((sum, s) => sum + (s.type === "RACE" ? 0 : s.km), 0);
const allSessions = (plan: TestPlan) => plan.weeks.flatMap(w => w.sessions.map(s => ({ ...s, weekNumber: w.weekNumber })));
const hardness: Record<string, number> = { WALK: 0, OTHER: 0, EASY: 1, LONG: 2, TEMPO: 3, INTERVALS: 4, RACE: 5 };

const cases = [
  {
    name: "knee pain removes impact and does not increase intensity",
    async check() {
      const context = makeContext("my knee hurts after yesterday's run");
      const hard = allSessions(context.plan).find(s => ["TEMPO", "INTERVALS", "LONG"].includes(s.type))!;
      const before = context.plan.weeks.find(w => w.weekNumber === hard.weekNumber)!;
      const result = await run(context, [
        [
          { name: "convert_to_cross_training", input: { session_id: hard.id } },
          { name: "reduce_week_volume", input: { week_number: hard.weekNumber, factor: 0.7 } },
        ],
        [],
      ]);
      expect(result.status).toBe("proposed");
      const after = result.plan!.weeks.find(w => w.weekNumber === hard.weekNumber)!;
      expect(after.sessions.find(s => s.id === hard.id)!.type).toBe("WALK");
      expect(weekVol(after)).toBeLessThanOrEqual(weekVol(before));
      for (const s of after.sessions) {
        const original = before.sessions.find(x => x.id === s.id);
        if (original) expect(hardness[s.type]).toBeLessThanOrEqual(hardness[original.type]);
      }
      expect(validatePlan(result.plan, { baseline: context.plan }).ok).toBe(true);
    },
  },
  {
    name: "missed week resumes gently without make-up volume",
    async check() {
      const context = makeContext("I missed the whole week");
      const week = buildWeek(context.plan);
      const result = await run(context, [
        [{ name: "insert_recovery_week", input: { week_number: week.weekNumber } }],
        [],
      ]);
      expect(result.status).toBe("proposed");
      const after = result.plan!.weeks.find(w => w.weekNumber === week.weekNumber)!;
      expect(weekVol(after)).toBeLessThanOrEqual(weekVol(week));
      expect(after.sessions.every(s => s.type === "EASY" || s.type === "RACE")).toBe(true);
      expect(validatePlan(result.plan, { baseline: context.plan }).ok).toBe(true);
    },
  },
  {
    name: "overreaching dials down a week",
    async check() {
      const context = makeContext("I am overreaching and exhausted");
      const week = buildWeek(context.plan);
      const result = await run(context, [
        [{ name: "reduce_week_volume", input: { week_number: week.weekNumber, factor: 0.6 } }],
        [],
      ]);
      expect(result.status).toBe("proposed");
      const after = result.plan!.weeks.find(w => w.weekNumber === week.weekNumber)!;
      expect(weekVol(after)).toBeLessThan(weekVol(week));
      expect(validatePlan(result.plan, { baseline: context.plan }).ok).toBe(true);
    },
  },
  {
    name: "schedule clash moves one editable session to a requested date",
    async check() {
      const context = makeContext("I cannot run this Wednesday");
      const session = allSessions(context.plan).find(s => s.type !== "RACE" && !s.done)!;
      const d = new Date(session.date + "T00:00:00");
      d.setDate(d.getDate() + 1);
      const newDate = ymd(d);
      const result = await run(context, [
        [{ name: "shift_workout", input: { session_id: session.id, new_date: newDate } }],
        [],
      ]);
      expect(result.status).toBe("proposed");
      expect(allSessions(result.plan!).find(s => s.id === session.id)!.date).toBe(newDate);
      expect(validatePlan(result.plan, { baseline: context.plan }).ok).toBe(true);
    },
  },
  {
    name: "goal feasibility assessment can answer without mutating the plan",
    async check() {
      const context = makeContext("is my goal still realistic?");
      const result = await run(context, [
        [{ name: "reassess_goal_feasibility", input: {} }],
        [],
      ], "Your goal looks plausible if the remaining plan stays consistent.");
      expect(result.status).toBe("proposed");
      expect(result.changed).toBe(false);
      expect(result.plan).toEqual(context.plan);
    },
  },
  {
    name: "single long run shortened without touching the rest of the week",
    async check() {
      const context = makeContext("this Sunday's long run is too much, just shorten it");
      const long = allSessions(context.plan).find(s => s.type === "LONG" && !s.done)!;
      const week = context.plan.weeks.find(w => w.weekNumber === long.weekNumber)!;
      const result = await run(context, [
        [{ name: "reduce_session_distance", input: { session_id: long.id, factor: 0.7 } }],
        [],
      ]);
      expect(result.status).toBe("proposed");
      const after = result.plan!.weeks.find(w => w.weekNumber === long.weekNumber)!;
      expect(after.sessions.find(s => s.id === long.id)!.km).toBeLessThan(long.km);
      for (const s of after.sessions) {
        if (s.id === long.id) continue;
        expect(s.km).toBe(week.sessions.find(x => x.id === s.id)!.km);
      }
      expect(validatePlan(result.plan, { baseline: context.plan }).ok).toBe(true);
    },
  },
  {
    name: "cancelled session is marked skipped, everything else untouched",
    async check() {
      const context = makeContext("drop Wednesday's run this week, I need the rest");
      const target = allSessions(context.plan).find(s => s.type !== "RACE" && !s.done)!;
      const result = await run(context, [
        [{ name: "cancel_session", input: { session_id: target.id } }],
        [],
      ]);
      expect(result.status).toBe("proposed");
      const after = allSessions(result.plan!);
      expect(after.find(s => s.id === target.id)!.skipped).toBe(true);
      expect(after.filter(s => s.id !== target.id && s.skipped)).toHaveLength(0);
      expect(validatePlan(result.plan, { baseline: context.plan }).ok).toBe(true);
    },
  },
  {
    name: "added session lands on the requested free day and validates",
    async check() {
      const context = makeContext("I can train an extra day this week");
      const anchor = allSessions(context.plan).find(s => s.type !== "RACE" && !s.done)!;
      const d = new Date(anchor.date + "T00:00:00");
      d.setDate(d.getDate() + 1);
      const date = ymd(d);
      const result = await run(context, [
        [{ name: "add_session", input: { date, type: "EASY", km: 5 } }],
        [],
      ]);
      expect(result.status).toBe("proposed");
      const added = allSessions(result.plan!).filter(s => s.id.startsWith("coach-add-"));
      expect(added).toHaveLength(1);
      expect(added[0]).toMatchObject({ date, type: "EASY", km: 5 });
      expect(validatePlan(result.plan, { baseline: context.plan }).ok).toBe(true);
    },
  },
  {
    name: "add_session is blocked when Spanish pain context is present",
    async check() {
      // Same add as the "free day" case, but the runner reports knee pain in
      // Spanish — the es safety keywords must make guardToolForContext block it.
      const context = makeContext("me duele la rodilla, ¿puedo entrenar un día extra?");
      const anchor = allSessions(context.plan).find(s => s.type !== "RACE" && !s.done)!;
      const d = new Date(anchor.date + "T00:00:00");
      d.setDate(d.getDate() + 1);
      const result = await run(context, [
        [{ name: "add_session", input: { date: ymd(d), type: "EASY", km: 5 } }],
        [],
      ]);
      expect(result.status).toBe("proposed");
      expect(result.changed).toBe(false);
      expect(allSessions(result.plan!).some(s => s.id.startsWith("coach-add-"))).toBe(false);
    },
  },
  {
    name: "add_session is blocked when French pain context is present",
    async check() {
      const context = makeContext("j'ai mal au genou, puis-je m'entraîner un jour de plus ?");
      const anchor = allSessions(context.plan).find(s => s.type !== "RACE" && !s.done)!;
      const d = new Date(anchor.date + "T00:00:00");
      d.setDate(d.getDate() + 1);
      const result = await run(context, [
        [{ name: "add_session", input: { date: ymd(d), type: "EASY", km: 5 } }],
        [],
      ]);
      expect(result.status).toBe("proposed");
      expect(result.changed).toBe(false);
      expect(allSessions(result.plan!).some(s => s.id.startsWith("coach-add-"))).toBe(false);
    },
  },
  {
    name: "reply-language line is injected for es/fr and absent for en",
    check() {
      const base = { plan: buildPlan(weeksOut(18), 6600, SESSIONS, 21.1, 0, {}), recentRuns: [], today: ymd(new Date()), goal: {}, report: "hola" };
      expect(buildMessages({ ...base, replyLanguage: "es" }, [], null)[0].content).toContain("Spanish");
      expect(buildMessages({ ...base, replyLanguage: "fr" }, [], null)[0].content).toContain("French");
      expect(buildMessages({ ...base, replyLanguage: "en" }, [], null)[0].content).not.toContain("REPLY LANGUAGE");
    },
  },
  {
    name: "add_session inside the taper is refused by the tool, plan unchanged",
    async check() {
      const context = makeContext("add one more hard session before the race");
      const d = new Date(context.plan.raceDate + "T00:00:00");
      d.setDate(d.getDate() - 7);
      const result = await run(context, [
        [{ name: "add_session", input: { date: ymd(d), type: "EASY", km: 5 } }],
        [],
      ]);
      expect(result.status).toBe("proposed");
      expect(result.changed).toBe(false);
      expect(result.plan).toEqual(context.plan);
    },
  },
  {
    name: "invalid tool call every turn exhausts safely",
    async check() {
      const context = makeContext("force an unsafe change");
      const week = buildWeek(context.plan);
      const result = await run(context, [
        [{ name: "reduce_week_volume", input: { week_number: week.weekNumber, factor: 2 } }],
      ]);
      expect(result.status).toBe("no_valid_adjustment");
      expect(result.plan).toBeUndefined();
    },
  },
  {
    name: "invalid then valid recovers within the loop",
    async check() {
      const context = makeContext("first try is invalid, then safe");
      const week = buildWeek(context.plan);
      const result = await run(context, [
        [{ name: "reduce_week_volume", input: { week_number: week.weekNumber, factor: 2 } }],
        [{ name: "reduce_week_volume", input: { week_number: week.weekNumber, factor: 0.7 } }],
        [],
      ]);
      expect(result.status).toBe("proposed");
      expect(weekVol(result.plan!.weeks.find(w => w.weekNumber === week.weekNumber)!)).toBeLessThan(weekVol(week));
      expect(validatePlan(result.plan, { baseline: context.plan }).ok).toBe(true);
    },
  },
];

let passed = 0;

describe("coach-agent offline eval", () => {
  it.each(cases)("$name", async ({ check }) => {
    await check();
    passed++;
  });

  afterAll(() => {
    console.log(`\ncoach-agent offline eval: ${passed}/${cases.length} passed`);
  });
});
