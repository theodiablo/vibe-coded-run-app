// The coach agent's internal validate-and-retry loop — the piece that turns a
// model's tool calls into a *validated* plan proposal (or a distinct
// `no_valid_adjustment` fate on exhaustion). Extracted from the edge function so
// it is a pure, portable module: the Deno `coach-agent` function imports it (with
// the real Anthropic `callModel`), and the offline eval harness imports the same
// code (with a fixture `callModel`). One loop, two callers — the same shared-module
// pattern as planValidate.js / planTools.js.
//
// `callModel` is injected: `async (messages, plan) => ModelResult` where
//   ModelResult = { toolUses: [{id,name,input}], text, rawContent: [...], usage:{input,output} }
// so this module never touches Deno, fetch, or the Anthropic SDK.

import { validatePlan } from "./planValidate.js";
import { applyToolCall } from "./planTools.js";

export const DEFAULT_MAX_RETRIES = 2;

/**
 * Apply the model's tool calls to a copy of the plan, validate, and on failure
 * feed the errors back — bounded by `maxRetries`. Never returns an invalid plan.
 *
 * @returns {Promise<
 *   | {status:"proposed", proposedPlan, toolCalls, rationale, usage, model}
 *   | {status:"no_valid_adjustment", usage, model, lastErrors}
 * >}
 */
export async function generateProposal({ plan, contextText, callModel, model, maxRetries = DEFAULT_MAX_RETRIES }) {
  const messages = [{ role: "user", content: [{ type: "text", text: contextText }] }];
  const usage = { input: 0, output: 0 };
  let lastErrors = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await callModel(messages, plan);
    usage.input += res.usage.input;
    usage.output += res.usage.output;

    if (!res.toolUses.length) {
      return { status: "no_valid_adjustment", usage, model, lastErrors: "no tool proposed" };
    }

    // Apply each tool to a running copy; a throw = an invalid tool result.
    let candidate = plan;
    let threw = null;
    for (const tu of res.toolUses) {
      try {
        candidate = applyToolCall(candidate, tu.name, tu.input);
      } catch (e) {
        threw = e.message;
        break;
      }
    }

    let toolResults;
    if (!threw) {
      const { valid, errors } = validatePlan(candidate);
      if (valid) {
        return {
          status: "proposed",
          proposedPlan: candidate,
          toolCalls: res.toolUses,
          rationale: res.text,
          usage,
          model,
        };
      }
      lastErrors = errors;
      toolResults = res.toolUses.map((tu) => ({
        type: "tool_result",
        tool_use_id: tu.id,
        is_error: true,
        content: "The proposed plan failed validation: " + JSON.stringify(errors),
      }));
    } else {
      lastErrors = threw;
      toolResults = res.toolUses.map((tu) => ({
        type: "tool_result",
        tool_use_id: tu.id,
        is_error: true,
        content: "Tool error: " + threw,
      }));
    }

    // Feed the failure back and let the model try again.
    messages.push({ role: "assistant", content: res.rawContent });
    messages.push({ role: "user", content: toolResults });
  }

  return { status: "no_valid_adjustment", usage, model, lastErrors };
}
