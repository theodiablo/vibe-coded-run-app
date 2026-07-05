import { supabase } from "./supabase";

// Best-effort: ask the notify-contribution edge function to email the maintainer
// (and thank the contributor, for contribution types). Never throws and never
// blocks the UI — if the function/secret isn't deployed, the caller's DB row is
// already written and that's enough.
export function notifyContribution(payload) {
  try {
    supabase.functions.invoke("notify-contribution", { body: payload })
      .catch(err => console.warn("notify-contribution failed (non-fatal)", err?.message || err));
  } catch (err) {
    console.warn("notify-contribution unavailable (non-fatal)", err?.message || err);
  }
}
