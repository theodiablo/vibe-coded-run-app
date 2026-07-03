// Access module for the coach-agent edge function (mirrors src/races.js /
// src/routes.js: direct calls, not the db blob). The function reads the plan
// and run history from app_state server-side, so we flush the debounced blob
// first — otherwise the coach could reason over a stale plan.

import { supabase } from "./supabase";
import { flushNow } from "./db";

// A round can genuinely take 15-25s+ (a real, non-streaming Anthropic call) —
// generous but bounded, so a request that's truly stuck fails deterministically
// instead of leaving the user staring at "Coach is thinking…" forever.
const TIMEOUT_MS = 60000;

async function invoke(body) {
  // confirm reads from agent_rounds (not app_state), so no flush needed —
  // and a flush failure must not block confirming an already-proposed plan.
  if (body.action !== "confirm") await flushNow();
  const { data, error } = await supabase.functions.invoke("coach-agent", { body, timeout: TIMEOUT_MS });
  if (error) {
    // The edge function always responds 200 (it streams keep-alive padding
    // before the outcome is known — see coach-agent/index.ts) and puts the
    // real outcome in the body, so this branch is now only a genuine
    // network-level failure or our own timeout above, never a server error
    // message — those arrive via data.error below.
    throw new Error("The coach is unavailable right now — try again in a moment.");
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export const coachPropose = (message) => invoke({ action: "propose", message });
export const coachCritique = (trajectoryId, message) => invoke({ action: "critique", trajectoryId, message });
export const coachConfirm = (trajectoryId) => invoke({ action: "confirm", trajectoryId });
