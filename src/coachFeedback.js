import { supabase } from "./supabase";
import { currentUserId } from "./db";
import { notifyContribution } from "./notify";

// Flag a coach answer as wrong. Inserts WITHOUT a returning .select() —
// coach_feedback has no client SELECT policy, so reading back the row would
// 403 even though the write succeeds (mirrors reportRace in src/races.js).
export async function submitCoachFeedback({ trajectoryId, roundIndex, correction }) {
  const user_id = currentUserId();
  if (!user_id) throw new Error("Not signed in");
  const { error } = await supabase.from("coach_feedback").insert({
    user_id, trajectory_id: trajectoryId, round_index: roundIndex, correction,
  });
  if (error) throw error;
  notifyContribution({ type: "coach_feedback", trajectoryId, roundIndex, correction });
}
