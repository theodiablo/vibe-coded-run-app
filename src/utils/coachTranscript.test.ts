import { describe, it, expect } from "vitest";
import { reconstructTranscript, stripSessionPrefix, type TranscriptRound } from "./coachTranscript";
import type { Plan } from "../types";

// Minimal single-week plans; diffPlans matches sessions by id and compares
// km/type/date. Keeping type+date fixed and varying only km means the diff
// strings are pure ("10 → 8 km") and don't depend on i18n being initialized.
type S = { id: string; date: string; type: string; km: number };
const plan = (sessions: S[]) => ({ weeks: [{ weekNumber: 1, startDate: "2026-07-06", phase: "BUILD", sessions }] }) as unknown as Plan;

const P0 = plan([{ id: "s1", date: "2026-07-08", type: "EASY", km: 10 }, { id: "s2", date: "2026-07-10", type: "TEMPO", km: 5 }]);
const PROP0 = plan([{ id: "s1", date: "2026-07-08", type: "EASY", km: 8 }, { id: "s2", date: "2026-07-10", type: "TEMPO", km: 5 }]);
const PROP1 = plan([{ id: "s1", date: "2026-07-08", type: "EASY", km: 8 }, { id: "s2", date: "2026-07-10", type: "TEMPO", km: 6 }]);

const round = (r: Partial<TranscriptRound> & { round_index: number }): TranscriptRound => ({
  user_feedback: null, rationale: null, outcome: "proposed", proposed_plan: P0, ...r,
});
const changesText = (m: { proposal?: { diff: { changes: string[] }[] } }) =>
  (m.proposal?.diff ?? []).flatMap(w => w.changes).join(" | ");

describe("stripSessionPrefix", () => {
  it("strips a single leading [...] session-context block", () => {
    expect(stripSessionPrefix("[The runner is asking about week 3, LONG on 2026-07-12]\n\nMove it earlier")).toBe("Move it earlier");
  });
  it("leaves a plain report untouched", () => {
    expect(stripSessionPrefix("Move my long run to Sunday")).toBe("Move my long run to Sunday");
  });
  it("only strips at the start, not a mid-text bracket", () => {
    expect(stripSessionPrefix("Swap [tempo] for easy")).toBe("Swap [tempo] for easy");
  });
});

describe("reconstructTranscript", () => {
  it("renders round 0 as user report + stamped coach bubble with a proposal card", () => {
    const msgs = reconstructTranscript({
      trajectoryId: "t1", report: "Help me feel fresh", baseline: P0,
      rounds: [round({ round_index: 0, rationale: "Lightened the week", proposed_plan: PROP0 })],
      isOpen: false,
    });
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toMatchObject({ role: "user", text: "Help me feel fresh" });
    expect(msgs[1]).toMatchObject({ role: "coach", text: "Lightened the week", trajectoryId: "t1", roundIndex: 0 });
    expect(changesText(msgs[1])).toContain("8 km"); // s1 10 → 8
  });

  it("folds the diff base forward: a critique diffs against the prior proposal, not the original baseline", () => {
    const msgs = reconstructTranscript({
      trajectoryId: "t1", report: "Lighten it", baseline: P0,
      rounds: [
        round({ round_index: 0, rationale: "R0", outcome: "superseded", proposed_plan: PROP0 }),
        round({ round_index: 1, user_feedback: "also shorten tempo", rationale: "R1", proposed_plan: PROP1 }),
      ],
      isOpen: false,
    });
    // user0, coach0, user1, coach1
    expect(msgs.map(m => m.role)).toEqual(["user", "coach", "user", "coach"]);
    expect(msgs[2]).toMatchObject({ role: "user", text: "also shorten tempo" });
    // Round 1's card is incremental: only the s2 change (5 → 6), NOT s1 (8 in both).
    expect(changesText(msgs[3])).toContain("6 km");
    expect(changesText(msgs[3])).not.toContain("8 km");
  });

  it("shows no proposal card for a no_valid_adjustment (invalid) round", () => {
    const msgs = reconstructTranscript({
      trajectoryId: "t1", report: "Add a marathon tomorrow", baseline: P0,
      rounds: [round({ round_index: 0, rationale: "Can't do that safely", outcome: "invalid", proposed_plan: P0 })],
      isOpen: false,
    });
    expect(msgs[1].proposal).toBeUndefined();
    expect(msgs[1].text).toBe("Can't do that safely");
  });

  it("keeps the proposal card on the earlier valid round when a later critique fails", () => {
    const msgs = reconstructTranscript({
      trajectoryId: "t1", report: "Lighten it", baseline: P0,
      rounds: [
        round({ round_index: 0, rationale: "R0", proposed_plan: PROP0 }),
        round({ round_index: 1, user_feedback: "no, way more", rationale: "Too much", outcome: "invalid", proposed_plan: PROP0 }),
      ],
      isOpen: false,
    });
    expect(msgs[1].proposal).toBeDefined(); // round 0 keeps its card
    expect(msgs[3].proposal).toBeUndefined(); // failed critique has none
  });

  it("diffs the open trajectory's latest proposal against the live plan, not the stored baseline", () => {
    const rounds = [round({ round_index: 0, rationale: "R0", proposed_plan: PROP0 })];
    // Closed: diff vs baseline P0 → s1 changed, card present.
    const closed = reconstructTranscript({ trajectoryId: "t1", report: "x", baseline: P0, rounds, isOpen: false });
    expect(closed[1].proposal).toBeDefined();
    // Open with the live plan already equal to the proposal → nothing to apply, no card.
    const open = reconstructTranscript({ trajectoryId: "t1", report: "x", baseline: P0, rounds, isOpen: true, currentPlan: PROP0 });
    expect(open[1].proposal).toBeUndefined();
  });

  it("omits the proposal card when a proposal changed nothing", () => {
    const msgs = reconstructTranscript({
      trajectoryId: "t1", report: "Any tweaks?", baseline: P0,
      rounds: [round({ round_index: 0, rationale: "Nothing needs to change", proposed_plan: P0 })],
      isOpen: false,
    });
    expect(msgs[1].proposal).toBeUndefined();
  });
});
