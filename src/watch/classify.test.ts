import { describe, it, expect } from "vitest";
import { classifyWatchSessions, newWatchSessions, type SessionOutcome } from "./mapping";
import type { WatchSessionRaw } from "./plugin";
import type { Run } from "../types";

const session = (over: Partial<WatchSessionRaw>): WatchSessionRaw => ({
  id: "s", startTime: "2026-07-10T08:00:00Z", endTime: "2026-07-10T08:40:00Z",
  exerciseType: 56, distanceM: 8000, startZoneOffsetSec: 0, ...over,
});

const outcomes = (cs: ReturnType<typeof classifyWatchSessions>) =>
  Object.fromEntries(cs.map(c => [c.raw.id, c.outcome])) as Record<string, SessionOutcome>;

describe("classifyWatchSessions", () => {
  it("labels each drop reason distinctly", () => {
    const runs: Run[] = [{ id: "r1", date: "2026-07-10", km: 8, hcId: "dup" } as Run];
    const sessions = [
      session({ id: "run", exerciseType: 56, distanceM: 8000, startTime: "2026-07-12T08:00:00Z", endTime: "2026-07-12T08:40:00Z" }), // imported (distinct day)
      session({ id: "bike", exerciseType: 8, distanceM: 20000 }),       // not-run-type
      session({ id: "short", exerciseType: 56, distanceM: 200 }),       // too-short (<0.5km)
      session({ id: "seen", exerciseType: 56, distanceM: 5000 }),       // already-seen
      session({ id: "dup", exerciseType: 56, distanceM: 8000 }),        // duplicate (hcId in log)
    ];
    const o = outcomes(classifyWatchSessions(sessions, runs, ["seen"], 0.5));
    expect(o).toEqual({
      run: "imported", bike: "not-run-type", short: "too-short",
      seen: "already-seen", dup: "duplicate",
    });
  });

  it("records a session with no elevation without dropping it (the Zepp case)", () => {
    const [c] = classifyWatchSessions([session({ id: "z", distanceM: 5040, elevationGainM: null })], [], [], 0.5);
    expect(c.outcome).toBe("imported");
    expect(c.raw.elevationGainM ?? null).toBeNull();
    expect(c.run?.elevation).toBeUndefined(); // left blank, not forced to 0
    expect(c.run?.km).toBe(5.04);
  });

  it("newWatchSessions returns exactly the imported subset", () => {
    const sessions = [
      session({ id: "a", distanceM: 8000 }),
      session({ id: "b", exerciseType: 8 }), // not a run
    ];
    const runs = newWatchSessions(sessions, [], []);
    expect(runs.map(r => r.hcId)).toEqual(["a"]);
  });
});
