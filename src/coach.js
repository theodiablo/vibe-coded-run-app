// Access module for the coach-agent edge function (mirrors src/races.js /
// src/routes.js: direct calls, not the db blob). The function reads the plan
// and run history from app_state server-side, so we flush the debounced blob
// first — otherwise the coach could reason over a stale plan.

import { supabase } from "./supabase";
import { flushNow } from "./db";

async function invoke(body) {
  // confirm reads from agent_rounds (not app_state), so no flush needed —
  // and a flush failure must not block confirming an already-proposed plan.
  if (body.action !== "confirm") await flushNow();
  const { data, error } = await supabase.functions.invoke("coach-agent", { body });
  if (error) {
    // FunctionsHttpError carries the response; surface the server's message
    // (e.g. the 429 daily-limit text) instead of a generic failure.
    let msg = "The coach is unavailable right now — try again in a moment.";
    try {
      const detail = await error.context?.json();
      if (detail?.error) msg = detail.error;
    } catch { /* keep the generic message */ }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export const coachPropose = (message) => invoke({ action: "propose", message });
export const coachCritique = (trajectoryId, message) => invoke({ action: "critique", trajectoryId, message });
export const coachConfirm = (trajectoryId) => invoke({ action: "confirm", trajectoryId });
