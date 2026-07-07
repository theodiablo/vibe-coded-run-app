// Live eval runner for the coach agent. Drives the REAL generateProposal loop
// (engine + tools + validator — exactly what the edge function runs) against
// the real Anthropic API, replays every scenario in scenarios.mjs, grades the
// outcome, and writes a JSON report to evals/coach/results/.
//
//   ANTHROPIC_API_KEY=sk-ant-... npm run eval:live
//
// Env:
//   ANTHROPIC_API_KEY   required for a live run (suite skips without it)
//   COACH_EVAL_MODEL    default claude-sonnet-5 (prod default — compare
//                       candidates by re-running with a different value)
//   COACH_EVAL_TRIALS   trials per scenario, default 1
//   COACH_EVAL_MOCK=1   run the harness through the MOCK_LLM scripts instead
//                       (free plumbing check; quality scores are meaningless)
//
// Grading tiers (see graders.mjs): SAFETY failures fail the vitest run;
// QUALITY misses only lower the reported score.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { generateProposal, SYSTEM_PROMPT } from "../../supabase/functions/_shared/coach/engine.mjs";
import { createMockModel } from "../../supabase/functions/_shared/coach/mock.mjs";
import { makeLiveModel } from "./anthropic.mjs";
import { SCENARIOS, makeFixture } from "./scenarios.mjs";
import { UNIVERSAL_SAFETY } from "./graders.mjs";

const MOCK = Boolean(process.env.COACH_EVAL_MOCK);
const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = MOCK ? "mock" : (process.env.COACH_EVAL_MODEL || "claude-sonnet-5");
const TRIALS = Math.max(1, Number(process.env.COACH_EVAL_TRIALS || 1));

const runnable = MOCK || Boolean(API_KEY);
if (!runnable) {
  console.warn("\ncoach live eval: set ANTHROPIC_API_KEY (or COACH_EVAL_MOCK=1) to run — skipping.\n");
}

const records = [];

function makeCallModel(context) {
  const observedTools = [];
  const inner = MOCK
    ? createMockModel(context)
    : makeLiveModel({ apiKey: API_KEY, model: MODEL, systemPrompt: SYSTEM_PROMPT });
  const callModel = async (messages, tools) => {
    const resp = await inner(messages, tools);
    for (const b of resp.content) if (b.type === "tool_use") observedTools.push(b.name);
    return resp;
  };
  return { callModel, observedTools };
}

describe.skipIf(!runnable)(`coach live eval (${MODEL}, ${TRIALS} trial(s)/scenario)`, () => {
  it.each(SCENARIOS)("$id", async (scenario) => {
    for (let trial = 0; trial < TRIALS; trial++) {
      const { context, baseline } = makeFixture(scenario);
      const { callModel, observedTools } = makeCallModel(context);
      const t0 = Date.now();
      const result = await generateProposal({ baseline, context, callModel });
      const ms = Date.now() - t0;

      const outcome = { result, baseline, context, observedTools };
      const safety = [...UNIVERSAL_SAFETY, ...scenario.safety].map(fn => fn(outcome));
      const quality = scenario.quality.map(fn => fn(outcome));

      records.push({
        scenario: scenario.id,
        trial,
        status: result.status,
        changed: result.changed ?? null,
        toolCalls: result.toolCalls.map(t => t.name),
        memorySuggestions: result.memorySuggestions || [],
        observedTools,
        rationale: result.rationale,
        usage: result.usage,
        ms,
        safety,
        quality,
      });

      // Safety is the gate: any miss fails the run, with the grader's detail.
      for (const s of safety) {
        expect(s.pass, `[${scenario.id} trial ${trial}] SAFETY ${s.name}: ${s.detail}`).toBe(true);
      }
    }
  });

  afterAll(() => {
    if (!records.length) return;
    const dir = join(dirname(fileURLToPath(import.meta.url)), "results");
    mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const totals = records.reduce((t, r) => ({
      input: t.input + (r.usage?.input_tokens || 0),
      output: t.output + (r.usage?.output_tokens || 0),
    }), { input: 0, output: 0 });
    const qualityOf = (rs) => {
      const all = rs.flatMap(r => r.quality);
      return all.length ? all.filter(q => q.pass).length / all.length : 1;
    };
    const report = {
      model: MODEL,
      mock: MOCK,
      trials: TRIALS,
      at: new Date().toISOString(),
      safetyPassRate: records.flatMap(r => r.safety).filter(s => s.pass).length /
        Math.max(1, records.flatMap(r => r.safety).length),
      qualityScore: qualityOf(records),
      tokens: totals,
      records,
    };
    const file = join(dir, `coach-eval-${stamp}.json`);
    writeFileSync(file, JSON.stringify(report, null, 2));

    const rows = SCENARIOS.map(s => {
      const rs = records.filter(r => r.scenario === s.id);
      if (!rs.length) return null;
      const safetyOk = rs.every(r => r.safety.every(x => x.pass));
      const q = rs.flatMap(r => r.quality);
      const misses = q.filter(x => !x.pass).map(x => x.name);
      return `  ${s.id.padEnd(18)} safety ${safetyOk ? "OK  " : "FAIL"}  quality ${q.filter(x => x.pass).length}/${q.length}` +
        `  status ${rs.map(r => r.status + (r.changed ? "+edit" : "")).join(",")}` +
        (misses.length ? `  missed: ${[...new Set(misses)].join(", ")}` : "");
    }).filter(Boolean);

    // process.stdout directly — vitest's reporter swallows console.log.
    process.stdout.write([
      "",
      `coach live eval — model ${MODEL}${MOCK ? " (MOCK — quality scores not meaningful)" : ""}, ${TRIALS} trial(s)/scenario`,
      ...rows,
      `  safety ${(report.safetyPassRate * 100).toFixed(0)}% (must be 100)  quality ${(report.qualityScore * 100).toFixed(0)}%  tokens in/out ${totals.input}/${totals.output}`,
      `  report: ${file}`,
      "",
    ].join("\n") + "\n");
  });
});
