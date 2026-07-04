// MOCK_LLM — canned model responses so the agent runs with zero Anthropic
// calls (CI, Vitest golden tests, local dev without a key). Deterministic and
// keyword-driven off the runner's message:
//   "knee|pain|hurt|injur"  → convert next hard session to WALK + reduce that week
//   "missed|skipped"        → recovery week on the next upcoming week
//   "force-invalid"         → repeatedly proposes intervals inside the taper,
//                             exercising the validator-retry → no_valid_adjustment path
//   anything else           → text-only answer, no tool calls
//
// Shape-compatible with an Anthropic Message: { content, stop_reason, usage }.

const USAGE = { input_tokens: 1200, output_tokens: 180 };

const lastUserText = (messages) => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user") continue;
    if (typeof m.content === "string") return m.content;
  }
  return "";
};

const upcomingSessions = (plan, today) =>
  plan.weeks.flatMap(w => w.sessions.map(s => ({ ...s, weekNumber: w.weekNumber })))
    .filter(s => !s.done && s.type !== "RACE" && s.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date));

// createMockModel(context) → callModel(messages, tools). Stateful within one
// round: first call emits tool_use, the follow-up (after tool results) ends
// the turn with a summary — except force-invalid, which never converges.
export function createMockModel(context) {
  let calls = 0;
  const daysBetween = (a, b) => Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000);

  return async (messages) => {
    calls++;
    const text = lastUserText(messages).toLowerCase();
    const up = upcomingSessions(context.plan, context.today);
    const tu = (name, input, i = 0) => ({ type: "tool_use", id: `mock_${calls}_${i}`, name, input });
    const done = (msg) => ({ content: [{ type: "text", text: msg }], stop_reason: "end_turn", usage: USAGE });
    const useTools = (blocks, msg) => ({
      content: [{ type: "text", text: msg }, ...blocks],
      stop_reason: "tool_use",
      usage: USAGE,
    });

    if (/force-invalid/.test(text) || (calls > 1 && /force-invalid/.test(lastUserText(messages.slice(0, 2)).toLowerCase()))) {
      // Deliberately invalid every time: add intervals inside the final taper.
      // The engine's retry budget must run out without surfacing the plan.
      const taper = up.find(s => s.type !== "INTERVALS" && s.date < context.plan.raceDate && daysBetween(s.date, context.plan.raceDate) <= 14);
      if (taper) {
        return useTools([tu("swap_session", { session_id: taper.id, new_type: "INTERVALS" })],
          "Let me add sharp work right before the race.");
      }
      return done("Not enough sessions to adjust.");
    }

    if (calls > 1) return done("Done — I've eased things off. Listen to your body and see a physio if the pain persists.");

    if (/knee|pain|hurt|injur/.test(text)) {
      const hard = up.find(s => ["TEMPO", "INTERVALS", "LONG"].includes(s.type));
      if (!hard) return done("Nothing hard is coming up — rest today and see how the knee feels tomorrow.");
      return useTools(
        [tu("convert_to_cross_training", { session_id: hard.id }, 0),
         tu("reduce_week_volume", { week_number: hard.weekNumber, factor: 0.7 }, 1)],
        "Sorry about the knee — let's take the impact out and unload this week.");
    }

    if (/missed|skipped/.test(text)) {
      const next = up[0];
      if (!next) return done("The plan is behind you — nothing left to adjust.");
      return useTools([tu("insert_recovery_week", { week_number: next.weekNumber })],
        "A missed week is gone — we resume gently rather than making up volume.");
    }

    return done("Noted! Nothing in the plan needs to change for that — keep following it as written.");
  };
}
