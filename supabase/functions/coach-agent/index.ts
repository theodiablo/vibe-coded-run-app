// coach-agent — the AI adjustment coach. Propose-and-confirm: the model may
// only EDIT the existing training plan through a bounded tool vocabulary
// (_shared/coach/tools.mjs); every proposal passes the shared validator
// (_shared/coach/validation.mjs) before the user sees it; the user accepts or
// steers with natural-language feedback. No auto-apply.
//
// Trust boundary: the API key, the validator, the tool implementations, the
// rate limit and the audit log all live here, server-side. The client sends a
// message and renders the returned proposal.
//
// Two-client split (privilege separation):
//   * userClient (anon key + caller's JWT): auth check + reading the caller's
//     app_state blob — RLS applies.
//   * admin (service role): agent_trajectories / agent_rounds / agent_usage —
//     tables the user has NO write access to (tamper-proof audit log).
// Committing an accepted plan is NOT done server-side: the client owns an
// in-memory copy of the whole app_state blob and debounce-upserts it, so a
// server write would be clobbered within seconds. `confirm` re-validates and
// returns the plan; the client persists it through its normal RLS-guarded path.
//
// Actions (POST { action, message?, trajectoryId? }):
//   propose  — new trajectory from a runner message → validated proposal
//   critique — steer an open trajectory with feedback → new validated proposal
//   confirm  — NO model call; re-validate + mark accepted, return the plan
//
// Deploy:  supabase functions deploy coach-agent
// Secrets: supabase secrets set ANTHROPIC_API_KEY=...
//   Optional: COACH_MODEL (default claude-sonnet-4-6), COACH_MODEL_LIGHT
//   (routing seam, default claude-haiku-4-5), RATE_LIMIT_PER_DAY (default 20),
//   MOCK_LLM=1 (canned responses, zero Anthropic calls — CI / local dev).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk";
import { generateProposal, SYSTEM_PROMPT } from "../_shared/coach/engine.mjs";
import { validatePlan, formatValidation } from "../_shared/coach/validation.mjs";
import { createMockModel } from "../_shared/coach/mock.mjs";

const MOCK = Boolean(Deno.env.get("MOCK_LLM"));
const DEFAULT_MODEL = Deno.env.get("COACH_MODEL") ?? "claude-sonnet-4-6";
const LIGHT_MODEL = Deno.env.get("COACH_MODEL_LIGHT") ?? "claude-haiku-4-5";
const RATE_LIMIT_PER_DAY = Number(Deno.env.get("RATE_LIMIT_PER_DAY") ?? 20);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// Routing seam (Phase 5): everything is judgment-heavy coaching for v1, so
// always the default model. To route trivial edits to LIGHT_MODEL later, add a
// classifier here — nothing else changes.
function pickModel(_message: string): string {
  return DEFAULT_MODEL;
}

// deno-lint-ignore no-explicit-any
function makeCallModel(context: any, message: string) {
  if (MOCK) return { model: "mock", callModel: createMockModel(context) };
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured (set it, or MOCK_LLM=1)");
  const client = new Anthropic({ apiKey });
  const model = pickModel(message);
  // deno-lint-ignore no-explicit-any
  const callModel = (messages: any[], tools: any[]) =>
    client.messages.create({
      model,
      max_tokens: 4096,
      // Tools render before system, so one breakpoint on the system block
      // caches the whole stable prefix (tool defs + system prompt).
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      tools,
      messages,
    });
  return { model, callModel };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");
    if (!["propose", "critique", "confirm"].includes(action)) {
      return json({ error: "action must be propose | critique | confirm" }, 400);
    }

    // ── auth: a valid JWT is required for everything ─────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "unauthorized" }, 401);
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: auth } = await userClient.auth.getUser();
    const user = auth?.user;
    if (!user) return json({ error: "unauthorized" }, 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ── confirm: no model call, no rate-limit charge ─────────────────────────
    if (action === "confirm") {
      const trajectoryId = String(body.trajectoryId ?? "");
      const { data: traj } = await admin.from("agent_trajectories")
        .select("id, status").eq("id", trajectoryId).eq("user_id", user.id).maybeSingle();
      if (!traj) return json({ error: "trajectory not found" }, 404);
      if (traj.status !== "open") return json({ error: `trajectory is ${traj.status}` }, 409);
      const { data: round } = await admin.from("agent_rounds")
        .select("id, proposed_plan, input_context").eq("trajectory_id", trajectoryId)
        .eq("outcome", "proposed").order("round_index", { ascending: false })
        .limit(1).maybeSingle();
      if (!round) return json({ error: "no open proposal to confirm" }, 409);
      // Belt and braces: never commit a plan that no longer validates.
      const check = validatePlan(round.proposed_plan, { baseline: round.input_context?.plan });
      if (!check.ok) return json({ error: "proposal failed validation", detail: formatValidation(check) }, 409);
      await admin.from("agent_rounds").update({ outcome: "accepted" }).eq("id", round.id);
      await admin.from("agent_trajectories")
        .update({ status: "accepted", updated_at: new Date().toISOString() }).eq("id", trajectoryId);
      return json({ plan: round.proposed_plan, baseline: round.input_context?.plan });
    }

    // ── propose / critique: model-calling rounds ─────────────────────────────
    const message = String(body.message ?? "").trim();
    if (!message) return json({ error: "message is required" }, 400);

    // Per-user daily budget; the increment is atomic (SQL function) so
    // concurrent requests can't slip past the limit.
    const today = new Date().toISOString().slice(0, 10);
    const { data: count, error: usageErr } = await admin.rpc("increment_agent_usage", {
      p_user_id: user.id, p_day: today,
    });
    if (usageErr) throw usageErr;
    if (count > RATE_LIMIT_PER_DAY) return json({ error: "daily coach limit reached — try again tomorrow" }, 429);

    // The plan + run history come from the user's own app_state blob (RLS via
    // the caller's JWT) — the server-side source of truth, not the request body.
    const { data: stateRow, error: stateErr } = await userClient
      .from("app_state").select("data").eq("user_id", user.id).maybeSingle();
    if (stateErr) throw stateErr;
    const blob = stateRow?.data ?? {};
    const plan = blob.rc_plan;
    const settings = blob.rc_settings ?? {};
    if (!plan?.weeks?.length) return json({ error: "no training plan to adjust — build one first" }, 400);
    const recentRuns = (blob.rc_runs ?? []).slice(0, 30).map((r: Record<string, unknown>) => ({
      date: r.date, type: r.type, km: r.km, durationSec: r.durationSec, hr: r.hr, effort: r.effort,
    }));

    let trajectoryId: string;
    let history: unknown[] = [];
    let roundIndex = 0;
    let report = message;
    let baselinePlan = plan;
    let workingPlan = plan;

    if (action === "propose") {
      // One live conversation at a time: anything still open is now abandoned
      // (feedback given but never accepted — a distinct fate in the metrics).
      await admin.from("agent_trajectories")
        .update({ status: "abandoned", updated_at: new Date().toISOString() })
        .eq("user_id", user.id).eq("status", "open");
      const { data: traj, error } = await admin.from("agent_trajectories")
        .insert({ user_id: user.id }).select("id").single();
      if (error) throw error;
      trajectoryId = traj.id;
    } else {
      trajectoryId = String(body.trajectoryId ?? "");
      const { data: traj } = await admin.from("agent_trajectories")
        .select("id, status").eq("id", trajectoryId).eq("user_id", user.id).maybeSingle();
      if (!traj) return json({ error: "trajectory not found" }, 404);
      if (traj.status !== "open") return json({ error: `trajectory is ${traj.status}` }, 409);
      const { data: rounds, error } = await admin.from("agent_rounds")
        .select("round_index, user_feedback, rationale, tool_calls")
        .eq("trajectory_id", trajectoryId).order("round_index", { ascending: true });
      if (error) throw error;
      history = rounds ?? [];
      roundIndex = history.length;
      // Round 0's report anchors the conversation; fetch only that row's input_context.
      const { data: r0, error: r0Err } = await admin.from("agent_rounds")
        .select("input_context").eq("trajectory_id", trajectoryId).eq("round_index", 0).maybeSingle();
      if (r0Err) throw r0Err;
      report = r0?.input_context?.report ?? message;
      baselinePlan = r0?.input_context?.plan ?? plan;
      // Critiques edit the latest open proposal, not the persisted app_state
      // plan, so steering an open adjustment does not drop earlier edits.
      const { data: latestProposal, error: latestErr } = await admin.from("agent_rounds")
        .select("proposed_plan").eq("trajectory_id", trajectoryId).eq("outcome", "proposed")
        .order("round_index", { ascending: false }).limit(1).maybeSingle();
      if (latestErr) throw latestErr;
      workingPlan = latestProposal?.proposed_plan ?? baselinePlan;
    }

    // Single goal shape for every consumer (buildMessages' prompt text AND
    // assessGoalFeasibility's tool result) — was previously duplicated at a
    // nested `goal.*` and a flat top level, which could silently drift apart.
    const context = {
      plan: workingPlan,
      recentRuns,
      today,
      report,
      goal: {
        raceDate: settings.raceDate || workingPlan.raceDate,
        distanceKm: Number(settings.distanceKm || workingPlan.distanceKm),
        goalSec: Number(settings.goalSec || workingPlan.goalSec) || null,
      },
      targetPace: workingPlan.targetPace,
    };

    const { model, callModel } = makeCallModel(context, message);
    const result = await generateProposal({
      baseline: baselinePlan,
      context,
      history,
      message: action === "critique" ? message : null,
      callModel,
    });

    const failed = result.status === "no_valid_adjustment";
    // A failed round only closes the WHOLE trajectory when there's no earlier
    // valid proposal to fall back on (round 0 failing means nothing was ever
    // proposed). A failed CRITIQUE (roundIndex > 0) leaves the trajectory
    // open — the prior "proposed" round is untouched below (only a
    // successful round supersedes it) — so the user can still confirm the
    // last adjustment that did validate instead of being dead-ended.
    const trajectoryClosed = failed && roundIndex === 0;
    // Log EVERY round, including failures — the audit log is the eval dataset.
    if (!failed && roundIndex > 0) {
      await admin.from("agent_rounds").update({ outcome: "superseded" })
        .eq("trajectory_id", trajectoryId).eq("outcome", "proposed");
    }
    const { error: roundErr } = await admin.from("agent_rounds").insert({
      trajectory_id: trajectoryId,
      round_index: roundIndex,
      user_feedback: action === "critique" ? message : null,
      tool_calls: result.toolCalls,
      rationale: result.rationale || null,
      proposed_plan: failed ? context.plan : result.plan,
      input_context: { report, goal: context.goal, today, recentRuns, plan: baselinePlan },
      model,
      input_tokens: result.usage.input_tokens,
      output_tokens: result.usage.output_tokens,
      outcome: failed ? "invalid" : "proposed",
    });
    if (roundErr) throw roundErr;
    await admin.from("agent_trajectories")
      .update({
        status: trajectoryClosed ? "no_valid_adjustment" : "open",
        updated_at: new Date().toISOString(),
      })
      .eq("id", trajectoryId);

    if (failed) {
      return json({
        trajectoryId, roundIndex, status: "no_valid_adjustment", trajectoryClosed,
        rationale: result.rationale ||
          "I couldn't find an adjustment that keeps your plan safe — nothing was changed.",
      });
    }
    return json({
      trajectoryId, roundIndex, status: "proposed",
      changed: result.changed,
      rationale: result.rationale,
      proposedPlan: result.plan,
      warnings: result.validation.warnings,
    });
  } catch (err) {
    console.error("coach-agent error", err);
    return json({ error: "coach unavailable — try again in a moment" }, 500);
  }
});
