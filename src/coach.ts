// Access module for the coach-agent edge function (mirrors src/races.ts /
// src/routes.ts: direct calls, not the db blob). The function reads the plan
// and run history from app_state server-side, so we flush the debounced blob
// first — otherwise the coach could reason over a stale plan.

import { supabase } from "./supabase";
import { flushNow } from "./db";
import { FunctionsHttpError, FunctionsFetchError, FunctionsRelayError } from "@supabase/supabase-js";
import { t } from "./i18n";
import type { Plan } from "./types";

// Longer than normal Supabase calls because a cold coach-agent boot may need to
// start Deno and import the Anthropic SDK before it can send response headers.
const COACH_INVOKE_TIMEOUT_MS = 60000;

// Map a functions.invoke() *transport* failure to a message that tells the user
// what actually went wrong and what to do. This is NOT the path for app-level
// failures (rate limit, "no plan yet", etc.) — the edge function always replies
// 200 and carries those in `data.error`, surfaced verbatim below. `error` here
// only fires for genuine transport problems, and the main kinds want different
// wording:
//   * FunctionsFetchError — the fetch never completed: offline, a client timeout,
//     or a connection dropped mid-flight. Only the true network-looking cases say
//     "check your connection"; timeouts point at cold start / retry.
//   * FunctionsRelayError — Supabase's relay could not reach/start the function;
//     retry usually lands on a warm isolate.
//   * FunctionsHttpError — the edge *platform* returned non-2xx before/around
//     our handler: an expired JWT (401/403 from verify_jwt) or a boot that ran
//     long / timed out (5xx). Split those two — one needs re-auth, the other a
//     plain retry onto a now-warm isolate.
//   * anything else — keep the original generic line.
type CoachAction =
  | { action: "ping" }
  | { action: "propose"; message: string }
  | { action: "critique"; trajectoryId: string; message: string }
  | { action: "confirm"; trajectoryId: string };

export type CoachResponse = {
  error?: string;
  plan?: Plan;
  trajectoryId?: string;
  roundIndex?: number;
  text?: string;
  [key: string]: unknown;
};

function transportMessage(error: unknown) {
  if (error instanceof FunctionsFetchError) {
    const reason = error.context as { name?: string } | undefined;
    if (reason?.name === "TimeoutError" || reason?.name === "AbortError") {
      return t("coach.errors.transport.timeout");
    }
    return t("coach.errors.transport.offline");
  }
  if (error instanceof FunctionsRelayError) {
    return t("coach.errors.transport.timeout");
  }
  if (error instanceof FunctionsHttpError) {
    const status = error.context?.status;
    if (status === 401 || status === 403) return t("coach.errors.transport.reauth");
    return t("coach.errors.transport.timeout");
  }
  return t("coach.errors.transport.unavailable");
}

// Localize a server-carried app error via its stable `code`, falling back to the
// server's English `error` text for any code we don't have a translation for
// (old clients / new codes stay readable rather than blank).
function serverMessage(data: { error?: string; code?: unknown }) {
  const fallback = data.error ?? t("coach.errors.transport.unavailable");
  return typeof data.code === "string"
    ? t(`coach.errors.server.${data.code}`, { defaultValue: fallback })
    : fallback;
}

async function invoke(body: CoachAction): Promise<CoachResponse> {
  // confirm reads from agent_rounds (not app_state), so no flush needed —
  // and a flush failure must not block confirming an already-proposed plan.
  if (body.action !== "confirm") await flushNow();
  const { data, error } = await supabase.functions.invoke("coach-agent", {
    body,
    timeout: COACH_INVOKE_TIMEOUT_MS,
  });
  if (error) throw new Error(transportMessage(error));
  if (data?.error) throw new Error(serverMessage(data));
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
    await supabase.functions.invoke("coach-agent", {
      body: { action: "ping" },
      timeout: COACH_INVOKE_TIMEOUT_MS,
    });
  } catch {
    // warming is an optimization, not a requirement — ignore all failures.
  }
}

export const coachPropose = (message: string) => invoke({ action: "propose", message });
export const coachCritique = (trajectoryId: string, message: string) => invoke({ action: "critique", trajectoryId, message });
export const coachConfirm = (trajectoryId: string) => invoke({ action: "confirm", trajectoryId });
