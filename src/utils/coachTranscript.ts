// Pure reconstruction of a past coach conversation into the same CoachMessage[]
// shape the live chat renders, from the audit rows the server already stores in
// agent_rounds (users have read-own RLS on them). No network, no React — so it
// is unit-testable over fixtures. src/coachHistory.ts fetches the rows and
// feeds them here; CoachChat.tsx imports the message types back.
import { diffPlans } from "./coachDiff";
import { t } from "../i18n";
import type { Plan } from "../types";

// ── shared chat message shape (the single source; CoachChat imports these) ──
export type MemorySuggestion = { id: string; text: string; status: "pending" | "saved" | "dismissed" };
export type SessionCard = { typeLabel: string; typeColor: string; date: string; title: string; meta: string };
export type CoachMessage = {
  role: "user" | "coach";
  text: string;
  proposal?: { diff: { weekNumber: number; changes: string[] }[] };
  sessionCard?: SessionCard;
  trajectoryId?: string | null;
  roundIndex?: number | null;
  memorySuggestions?: MemorySuggestion[];
};

// One agent_rounds row, trimmed to the columns the transcript needs.
export type TranscriptRound = {
  round_index: number;
  user_feedback: string | null;
  rationale: string | null;
  outcome: "proposed" | "accepted" | "superseded" | "invalid";
  proposed_plan: Plan;
};

// Round 0's model message is prefixed with an invisible session-context block
// (see CoachChat's sessionPrefix) when the chat was opened about a specific
// session. Strip a single leading "[...]" run so the transcript shows only what
// the runner typed. Leaves plain reports and mid-text brackets untouched.
export function stripSessionPrefix(report: string): string {
  return report.replace(/^\[[^\]]*\]\s*/, "");
}

// Rebuild the conversation. Rules mirror the live flow:
//  - user bubble per round (round 0 = the report, later rounds = user_feedback)
//  - coach bubble per round (rationale, or the matching fallback string)
//  - a proposal card on each non-invalid round whose diff is non-empty
// The diff base folds forward exactly as the server's workingPlan does: each
// non-invalid proposal becomes the base the next round edits. The OPEN
// trajectory's latest proposal instead diffs against the live plan, matching
// what Apply will actually change (and what a freshly-sent round would show).
export function reconstructTranscript(input: {
  trajectoryId: string;
  report: string;
  baseline: Plan | null;
  rounds: TranscriptRound[];
  isOpen: boolean;
  currentPlan?: Plan;
}): CoachMessage[] {
  const { trajectoryId, report, baseline, rounds, isOpen, currentPlan } = input;
  const ordered = [...rounds].sort((a, b) => a.round_index - b.round_index);
  const lastProposedIndex = (() => {
    for (let i = ordered.length - 1; i >= 0; i--) if (ordered[i].outcome !== "invalid") return i;
    return -1;
  })();

  const out: CoachMessage[] = [];
  let base: Plan | null | undefined = baseline;

  ordered.forEach((round, i) => {
    // User turn.
    const userText = round.round_index === 0 ? stripSessionPrefix(report) : (round.user_feedback ?? "");
    if (userText) out.push({ role: "user", text: userText });

    // Coach turn — stamped so the existing flag affordance works on old rounds.
    const invalid = round.outcome === "invalid";
    const fallback = invalid ? t("coach.fallback.noValidAdjustment") : t("coach.fallback.proposal");
    const coachMsg: CoachMessage = {
      role: "coach",
      text: round.rationale || fallback,
      trajectoryId,
      roundIndex: round.round_index,
    };

    if (!invalid) {
      const diffBase = isOpen && i === lastProposedIndex && currentPlan ? currentPlan : base;
      const diff = diffPlans(diffBase, round.proposed_plan);
      if (diff.length) coachMsg.proposal = { diff };
      base = round.proposed_plan;
    }
    out.push(coachMsg);
  });

  return out;
}
