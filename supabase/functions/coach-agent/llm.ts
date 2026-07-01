// Model access for the coach agent: the Anthropic call, the tool schemas, the
// system prompt, and the model-routing seam. Kept separate from the turn handler
// so the loop logic in index.ts stays readable.
//
// MOCK_LLM=1 short-circuits the network call and returns deterministic scripted
// responses (used by CI and offline tests). The mock drives the SAME apply +
// validate path as the real model — the "invalid" scenario returns a tool call
// that the tool transform rejects, exercising the validate-and-retry loop without
// touching Anthropic.

// Direct Anthropic API (not Bedrock) — the only surface with automatic prompt
// caching, which keeps the stable system + tool blocks cheap across turns.
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-5"; // coaching judgment
const HAIKU_MODEL = "claude-haiku-4-5-20251001"; // routing / trivial edits (seam)

export const SYSTEM_PROMPT = `You are a running coach that ADAPTS an existing training plan.

You are an editor, never an author: you may only change the plan through the
provided tools, one focused adjustment at a time. You never write a plan from
scratch and never invent sessions outside the tools.

Policy ordering, always: safety > consistency > peak performance. When an athlete
reports pain, illness, or a missed block, protect them first — reduce load,
insert recovery, or convert to cross-training rather than adding intensity or
"making up" missed volume.

You are given the current plan (weeks of typed sessions) and recent run history.
Choose the smallest set of tool calls that addresses the athlete's message, then
briefly explain your reasoning. If no safe adjustment fits, say so instead of
forcing a change. Session types are EASY, TEMPO, INTERVALS, LONG, RACE, WALK,
OTHER; the race date is fixed and cannot move.`;

// Anthropic tool schemas — mirror applyToolCall's inputs exactly.
export const TOOL_DEFS = [
  {
    name: "shift_workout",
    description: "Move a single session earlier or later by a number of days (stays in its week).",
    input_schema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "The session id to move." },
        days: { type: "integer", description: "Signed day offset (negative = earlier)." },
      },
      required: ["sessionId", "days"],
    },
  },
  {
    name: "swap_session",
    description: "Swap the dates of two sessions (reschedule one for the other).",
    input_schema: {
      type: "object",
      properties: {
        sessionIdA: { type: "string" },
        sessionIdB: { type: "string" },
      },
      required: ["sessionIdA", "sessionIdB"],
    },
  },
  {
    name: "reduce_week_volume",
    description: "Scale every non-race session in a week down by a factor in (0,1).",
    input_schema: {
      type: "object",
      properties: {
        weekNumber: { type: "integer" },
        factor: { type: "number", description: "0 < factor < 1." },
      },
      required: ["weekNumber", "factor"],
    },
  },
  {
    name: "insert_recovery_week",
    description: "Turn a week into an easy recovery week (all sessions easy, ~half volume). Use for injury or overreach.",
    input_schema: {
      type: "object",
      properties: { weekNumber: { type: "integer" } },
      required: ["weekNumber"],
    },
  },
  {
    name: "convert_to_cross_training",
    description: "Replace one running session with low-impact cross-training.",
    input_schema: {
      type: "object",
      properties: { sessionId: { type: "string" } },
      required: ["sessionId"],
    },
  },
  {
    name: "reassess_goal_feasibility",
    description: "Re-target the plan to a new goal finish time (seconds); paces scale proportionally.",
    input_schema: {
      type: "object",
      properties: { newGoalSec: { type: "integer" } },
      required: ["newGoalSec"],
    },
  },
];

// Routing seam: trivial edits could go to Haiku later. For v1 always Sonnet for
// coaching judgment. Kept as a function so a classifier can drop in with no other
// change (Phase 5).
export function pickModel(_action: string, _message: string): string {
  return DEFAULT_MODEL;
}

export interface ModelResult {
  toolUses: Array<{ id: string; name: string; input: Record<string, unknown> }>;
  text: string;
  rawContent: unknown[]; // assistant content array, appended verbatim on retries
  usage: { input: number; output: number };
}

const isMock = () => Deno.env.get("MOCK_LLM") === "1" || Deno.env.get("MOCK_LLM") === "true";

// Deterministic mock. `scenario`:
//  - "invalid": a reduce_week_volume with an out-of-range factor → the tool
//    throws → the loop treats it as an invalid tool result and retries → the
//    trajectory ends `no_valid_adjustment`.
//  - default: a safe reduce on the first week → a valid proposal.
function mockResult(scenario: string, plan: any): ModelResult {
  const weekNumber = plan?.weeks?.[0]?.weekNumber ?? 1;
  const factor = scenario === "invalid" ? 2 : 0.7;
  const tu = {
    id: "toolu_mock_" + Math.random().toString(36).slice(2, 8),
    name: "reduce_week_volume",
    input: { weekNumber, factor },
  };
  return {
    toolUses: [tu],
    text: scenario === "invalid" ? "Attempting an adjustment." : "Easing week " + weekNumber + " back.",
    rawContent: [{ type: "tool_use", id: tu.id, name: tu.name, input: tu.input }],
    usage: { input: 10, output: 5 },
  };
}

export async function callModel(opts: {
  model: string;
  messages: unknown[];
  scenario?: string;
  plan?: any;
}): Promise<ModelResult> {
  if (isMock()) return mockResult(opts.scenario ?? "default", opts.plan);

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");

  const body: Record<string, unknown> = {
    model: opts.model,
    max_tokens: 1024,
    // cache_control on the stable prefix (system + tool block) → cheap reads.
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    tools: TOOL_DEFS.map((t, i) =>
      i === TOOL_DEFS.length - 1 ? { ...t, cache_control: { type: "ephemeral" } } : t,
    ),
    tool_choice: { type: "auto" },
    messages: opts.messages,
  };
  // Effort keeps the turn bounded inside the client's 15s invoke timeout. Haiku
  // does not support the effort parameter, so only send it for Sonnet-tier.
  if (opts.model !== HAIKU_MODEL) body.output_config = { effort: "low" };

  const resp = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      // Server-side only. This runs in a Deno edge function, not the browser: the
      // key is read from Deno.env and never reaches the client. This IS the
      // server-side proxy the no-client-side-api-key-header rule asks for, so the
      // client-side-header check is a category error here — suppress it for this
      // line (the rule stays active everywhere else, including other functions).
      "x-api-key": apiKey, // nosemgrep: no-client-side-api-key-header
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`Anthropic ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();

  const content: any[] = data.content ?? [];
  const toolUses = content
    .filter((b) => b.type === "tool_use")
    .map((b) => ({ id: b.id, name: b.name, input: b.input ?? {} }));
  const text = content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  return {
    toolUses,
    text,
    rawContent: content,
    usage: {
      input: data.usage?.input_tokens ?? 0,
      output: data.usage?.output_tokens ?? 0,
    },
  };
}
