// coach-agent — the propose-and-confirm training-plan agent.
//
// Trust boundary: the Anthropic key, the validator (our safety guarantee), the
// tool implementations, and the audit log all live here, server-side. The client
// only sends a message and renders the returned proposal.
//
// Three actions:
//   propose  — new trajectory from a user message → generateProposal → persist
//              round → return proposal (does NOT commit).
//   critique — continue an open trajectory with NL feedback → generateProposal →
//              persist round.
//   confirm  — NO model call. Promote the last proposed_plan into the user's
//              app_state.data.rc_plan via the USER client (RLS applies), carrying
//              progress by session id; mark the trajectory accepted.
//
// The validator and tool transforms are the SAME pure modules the React app uses
// (one validator, two callers). Deploy: `supabase functions deploy coach-agent`
// (+ `supabase secrets set ANTHROPIC_API_KEY=...`), mirroring notify-contribution.
//
// Local verification: `supabase functions serve coach-agent`; with MOCK_LLM=1 no
// Anthropic call is made and the loop is driven by deterministic fixtures.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { validatePlan } from "../../../src/utils/planValidate.js";
import { applyToolCall } from "../../../src/utils/planTools.js";
import { callModel, pickModel } from "./llm.ts";

const RC_PLAN = "rc_plan";
const RC_RUNS = "rc_runs";
const MAX_VALIDATOR_RETRIES = 2;
const RATE_LIMIT_PER_DAY = Number(Deno.env.get("RATE_LIMIT_PER_DAY") ?? "20");
const RECENT_RUNS = 12;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-mock-scenario",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const serviceClient = () =>
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const userClient = (authHeader: string) =>
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });

const today = () => new Date().toISOString().slice(0, 10);

// ── The internal validate-and-retry loop ─────────────────────────────────────
// Apply the model's tool calls to a copy, validate, and on failure feed the
// errors back — bounded by MAX_VALIDATOR_RETRIES. Never surfaces an invalid plan:
// on exhaustion it returns a distinct `no_valid_adjustment` fate (not a 500).
async function generateProposal(
  plan: any,
  contextText: string,
  model: string,
  scenario: string,
) {
  const messages: any[] = [{ role: "user", content: [{ type: "text", text: contextText }] }];
  const usage = { input: 0, output: 0 };
  let lastErrors: unknown = null;

  for (let attempt = 0; attempt <= MAX_VALIDATOR_RETRIES; attempt++) {
    const res = await callModel({ model, messages, scenario, plan });
    usage.input += res.usage.input;
    usage.output += res.usage.output;

    if (!res.toolUses.length) {
      return { status: "no_valid_adjustment" as const, usage, model, lastErrors: "no tool proposed" };
    }

    // Apply each tool to a running copy; a throw = an invalid tool result.
    let candidate = plan;
    let threw: string | null = null;
    for (const tu of res.toolUses) {
      try {
        candidate = applyToolCall(candidate, tu.name, tu.input);
      } catch (e) {
        threw = (e as Error).message;
        break;
      }
    }

    let toolResults: any[];
    if (!threw) {
      const { valid, errors } = validatePlan(candidate);
      if (valid) {
        return {
          status: "proposed" as const,
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

  return { status: "no_valid_adjustment" as const, usage, model, lastErrors };
}

// Overlay the user's live progress (done/skipped/runId) onto a proposed plan by
// session id, so a run logged between propose and confirm isn't lost. Mirrors
// carryProgress in RunningCoach.jsx.
function carryProgress(currentPlan: any, proposedPlan: any) {
  const flags = new Map<string, any>();
  for (const w of currentPlan?.weeks ?? [])
    for (const s of w.sessions ?? [])
      flags.set(s.id, { done: s.done, skipped: s.skipped, runId: s.runId });
  for (const w of proposedPlan.weeks ?? [])
    for (const s of w.sessions ?? []) {
      const f = flags.get(s.id);
      if (f) Object.assign(s, f);
    }
  return proposedPlan;
}

function buildContext(plan: any, runs: any[], message: string, priorNote?: string) {
  const recent = (runs ?? []).slice(0, RECENT_RUNS);
  return (
    `Athlete message:\n${message}\n\n` +
    (priorNote ? `${priorNote}\n\n` : "") +
    `Current plan (JSON):\n${JSON.stringify(plan)}\n\n` +
    `Recent runs (most recent first, JSON):\n${JSON.stringify(recent)}`
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "missing authorization" }, 401);

    const uc = userClient(authHeader);
    const { data: userData } = await uc.auth.getUser();
    const user = userData?.user;
    if (!user) return json({ error: "invalid token" }, 401);
    const uid = user.id;

    const svc = serviceClient();
    const scenario = req.headers.get("x-mock-scenario") ?? "default";
    const payload = await req.json().catch(() => ({}));
    const action = String(payload.action ?? "");

    // ── confirm: no model call, commit the last proposal ───────────────────
    if (action === "confirm") {
      const trajectoryId = String(payload.trajectoryId ?? "");
      const { data: traj } = await svc
        .from("agent_trajectories").select("id,user_id,status").eq("id", trajectoryId).maybeSingle();
      if (!traj || traj.user_id !== uid) return json({ error: "trajectory not found" }, 404);

      const { data: round } = await svc
        .from("agent_rounds").select("id,proposed_plan").eq("trajectory_id", trajectoryId)
        .order("round_index", { ascending: false }).limit(1).maybeSingle();
      if (!round) return json({ error: "no round to confirm" }, 400);

      const { data: stateRow } = await uc.from("app_state").select("data").maybeSingle();
      const state = stateRow?.data ?? {};
      const merged = carryProgress(state[RC_PLAN], round.proposed_plan);
      state[RC_PLAN] = merged;
      const { error: wErr } = await uc.from("app_state")
        .upsert({ user_id: uid, data: state, updated_at: new Date().toISOString() });
      if (wErr) return json({ error: "commit failed: " + wErr.message }, 500);

      await svc.from("agent_rounds").update({ outcome: "accepted" }).eq("id", round.id);
      await svc.from("agent_trajectories")
        .update({ status: "accepted", updated_at: new Date().toISOString() }).eq("id", trajectoryId);
      return json({ ok: true, plan: merged });
    }

    // ── propose / critique: model-calling rounds (rate-limited) ────────────
    if (action !== "propose" && action !== "critique") {
      return json({ error: "unknown action" }, 400);
    }

    // Rate limit (per user/day). confirm above does not count.
    const { data: usageRow } = await svc
      .from("agent_usage").select("count").eq("user_id", uid).eq("day", today()).maybeSingle();
    if ((usageRow?.count ?? 0) >= RATE_LIMIT_PER_DAY) {
      return json({ error: "daily limit reached" }, 429);
    }

    const { data: stateRow } = await uc.from("app_state").select("data").maybeSingle();
    const state = stateRow?.data ?? {};
    const plan = state[RC_PLAN];
    if (!plan || !Array.isArray(plan.weeks)) return json({ error: "no plan to adapt" }, 400);
    const runs = state[RC_RUNS] ?? [];
    const message = String(payload.message ?? "");
    const model = pickModel(action, message);

    let trajectoryId = String(payload.trajectoryId ?? "");
    let roundIndex = 0;
    let priorNote: string | undefined;

    if (action === "propose") {
      const { data: t, error: tErr } = await svc
        .from("agent_trajectories").insert({ user_id: uid, status: "open" }).select("id").single();
      if (tErr) return json({ error: "could not open trajectory: " + tErr.message }, 500);
      trajectoryId = t.id;
    } else {
      // critique: continue an open trajectory; summarize prior rounds as context.
      const { data: traj } = await svc
        .from("agent_trajectories").select("id,user_id,status").eq("id", trajectoryId).maybeSingle();
      if (!traj || traj.user_id !== uid) return json({ error: "trajectory not found" }, 404);
      const { data: prior } = await svc
        .from("agent_rounds").select("round_index,tool_calls,rationale")
        .eq("trajectory_id", trajectoryId).order("round_index", { ascending: true });
      roundIndex = (prior?.length ?? 0);
      priorNote =
        "Earlier proposals in this conversation (the athlete gave feedback rather than accepting):\n" +
        (prior ?? []).map((r) =>
          `#${r.round_index}: ${JSON.stringify(r.tool_calls)} — ${r.rationale ?? ""}`).join("\n");
    }

    const contextText = buildContext(plan, runs, message, priorNote);
    const result = await generateProposal(plan, contextText, model, scenario);

    // Persist the round (service role — the user cannot write these tables).
    const inputContext = { plan, runs: (runs ?? []).slice(0, RECENT_RUNS), report: message };
    await svc.from("agent_rounds").insert({
      trajectory_id: trajectoryId,
      round_index: roundIndex,
      user_feedback: action === "critique" ? message : null,
      tool_calls: result.status === "proposed" ? result.toolCalls : [],
      rationale: result.status === "proposed" ? result.rationale : null,
      proposed_plan: result.status === "proposed" ? result.proposedPlan : plan,
      input_context: inputContext,
      model: result.model,
      input_tokens: result.usage.input,
      output_tokens: result.usage.output,
      outcome: "proposed",
    });

    // Count this model-calling round against the daily budget.
    await svc.from("agent_usage").upsert(
      { user_id: uid, day: today(), count: (usageRow?.count ?? 0) + 1 },
      { onConflict: "user_id,day" },
    );

    if (result.status === "no_valid_adjustment") {
      await svc.from("agent_trajectories")
        .update({ status: "no_valid_adjustment", updated_at: new Date().toISOString() })
        .eq("id", trajectoryId);
      return json({ status: "no_valid_adjustment", trajectoryId, detail: result.lastErrors });
    }

    return json({
      status: "proposed",
      trajectoryId,
      roundIndex,
      proposedPlan: result.proposedPlan,
      toolCalls: result.toolCalls,
      rationale: result.rationale,
    });
  } catch (err) {
    console.error("coach-agent error", err);
    return json({ error: String(err) }, 500);
  }
});
