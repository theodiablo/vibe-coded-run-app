// Access module for the coach-agent edge function (mirrors src/races.js /
// src/routes.js: direct calls, not the db blob). The function reads the plan
// and run history from app_state server-side, so we flush the debounced blob
// first — otherwise the coach could reason over a stale plan.

import { supabase } from "./supabase";
import { flushNow } from "./db";
import { FunctionsHttpError, FunctionsFetchError } from "@supabase/supabase-js";

// Map a functions.invoke() *transport* failure to a message that tells the user
// what actually went wrong and what to do. This is NOT the path for app-level
// failures (rate limit, "no plan yet", etc.) — the edge function always replies
// 200 and carries those in `data.error`, surfaced verbatim below. `error` here
// only fires for genuine transport problems, and the three kinds want different
// wording:
//   * FunctionsFetchError — the fetch never completed: offline, or the
//     connection was dropped mid-flight (classically a cold-start boot that the
//     network/proxy gave up on). "Check your connection."
//   * FunctionsHttpError — the edge *platform* returned non-2xx before/around
//     our handler: an expired JWT (401/403 from verify_jwt) or a boot that ran
//     long / timed out (5xx). Split those two — one needs re-auth, the other a
//     plain retry onto a now-warm isolate.
//   * anything else — keep the original generic line.
function transportMessage(error) {
  if (error instanceof FunctionsFetchError) {
    return "Couldn't reach the coach — check your connection and try again.";
  }
  if (error instanceof FunctionsHttpError) {
    const status = error.context?.status;
    if (status === 401 || status === 403) return "Your session expired — sign in again.";
    return "The coach took too long to start up — try again in a moment.";
  }
  return "The coach is unavailable right now — try again in a moment.";
}

async function invoke(body) {
  // confirm reads from agent_rounds (not app_state), so no flush needed —
  // and a flush failure must not block confirming an already-proposed plan.
  if (body.action !== "confirm") await flushNow();
  const { data, error } = await supabase.functions.invoke("coach-agent", { body });
  if (error) throw new Error(transportMessage(error));
  if (data?.error) throw new Error(data.error);
  return data;
}

// Fire-and-forget cold-start warmer. The coach-agent `ping` action returns
// before any auth/DB/model work, so this just pays the isolate boot + module
// import cost early (called when the chat opens) — the first real round then
// lands on a warm isolate. Best effort by design: it swallows every error and
// never blocks the UI. If it fails, the first round simply pays the cold start
// as it did before.
export async function coachPing() {
  try {
    await supabase.functions.invoke("coach-agent", { body: { action: "ping" } });
  } catch {
    // warming is an optimization, not a requirement — ignore all failures.
  }
}

export const coachPropose = (message) => invoke({ action: "propose", message });
export const coachCritique = (trajectoryId, message) => invoke({ action: "critique", trajectoryId, message });
export const coachConfirm = (trajectoryId) => invoke({ action: "confirm", trajectoryId });
