import { describe, it, expect } from "vitest";
import { sessionRunType, sessionLocalDate, sessionToRun, isDuplicate, newWatchSessions } from "./mapping";
import type { WatchSessionRaw } from "./plugin";
import type { Run } from "../types";

const session = (over: Partial<WatchSessionRaw> = {}): WatchSessionRaw => ({
  id: "s1",
  startTime: "2026-07-10T08:00:00Z",
  endTime: "2026-07-10T08:45:00Z",
  exerciseType: 56,
  distanceM: 8000,
  ...over,
});

describe("sessionRunType", () => {
  it("maps running/treadmill to EASY and walking/hiking to WALK", () => {
    expect(sessionRunType(56)).toBe("EASY");
    expect(sessionRunType(57)).toBe("EASY");
    expect(sessionRunType(79)).toBe("WALK");
    expect(sessionRunType(37)).toBe("WALK");
  });
  it("returns null for non-run activities and undefined", () => {
    expect(sessionRunType(8)).toBeNull();   // biking
    expect(sessionRunType(undefined)).toBeNull();
  });
});

describe("sessionLocalDate", () => {
  it("uses the session zone offset so a late-night run lands on the local day", () => {
    // 23:30 UTC is already the next day in UTC+10.
    expect(sessionLocalDate("2026-07-10T23:30:00Z", 10 * 3600)).toBe("2026-07-11");
  });
  it("respects a negative offset", () => {
    // 01:00 UTC is still the previous day in UTC-5.
    expect(sessionLocalDate("2026-07-11T01:00:00Z", -5 * 3600)).toBe("2026-07-10");
  });
  it("returns empty for an unparseable instant", () => {
    expect(sessionLocalDate("not-a-date", 0)).toBe("");
  });
});

describe("sessionToRun", () => {
  it("maps metres/seconds/bpm into the run shape", () => {
    const r = sessionToRun(session({ distanceM: 8230, activeSec: 2600, hrAvg: 148.4, hrMax: 171, elevationGainM: 82.6, startZoneOffsetSec: 0 }));
    expect(r).toMatchObject({
      date: "2026-07-10", type: "EASY", km: 8.23, durationSec: 2600,
      hr: 148, hrMax: 171, elevation: 83, effort: 5, source: "watch",
      hcId: "s1", startedAt: "2026-07-10T08:00:00Z",
    });
  });
  it("falls back to elapsed time when active duration is absent", () => {
    const r = sessionToRun(session({ activeSec: null }));
    expect(r.durationSec).toBe(45 * 60); // 08:00 → 08:45
  });
  it("omits elevation and nulls HR when the watch didn't record them", () => {
    const r = sessionToRun(session({ elevationGainM: null, hrAvg: null, hrMax: null }));
    expect(r.elevation).toBeUndefined();
    expect(r.hr).toBeNull();
    expect(r.hrMax).toBeNull();
  });
  it("maps a walk type", () => {
    expect(sessionToRun(session({ exerciseType: 79 })).type).toBe("WALK");
  });
  it("stamps the writing app's brand into the notes", () => {
    expect(sessionToRun(session({ dataOrigin: "com.garmin.android.apps.connectmobile" })).notes).toBe("Imported from Garmin");
    expect(sessionToRun(session({ dataOrigin: "com.huami.watch.hmwatchmanager" })).notes).toBe("Imported from Zepp");
    expect(sessionToRun(session()).notes).toBe("Imported from your watch");
  });
});

describe("isDuplicate", () => {
  const runs = (over: Partial<Run>[] = []): Run[] => over.map((o, i) => ({ id: "r" + i, date: "2026-07-10", km: 8, ...o }));

  it("matches a seen id", () => {
    expect(isDuplicate(session(), [], ["s1"])).toBe(true);
  });
  it("matches an existing run carrying the same hcId", () => {
    expect(isDuplicate(session(), runs([{ hcId: "s1" }]), [])).toBe(true);
  });
  it("matches a run whose time window overlaps", () => {
    const existing = runs([{ startedAt: "2026-07-10T08:10:00Z", durationSec: 3000 }]);
    expect(isDuplicate(session(), existing, [])).toBe(true);
  });
  it("does not match a non-overlapping tracked run", () => {
    const existing = runs([{ startedAt: "2026-07-10T06:00:00Z", durationSec: 600 }]);
    expect(isDuplicate(session(), existing, [])).toBe(false);
  });
  it("fuzzy-matches a legacy run on same date within 10% distance", () => {
    const existing = runs([{ km: 8.5 }]); // no startedAt → fuzzy path; |8.5-8| <= 0.85
    expect(isDuplicate(session(), existing, [])).toBe(true);
  });
  it("does not fuzzy-match when distance differs by more than 10%", () => {
    const existing = runs([{ km: 12 }]);
    expect(isDuplicate(session(), existing, [])).toBe(false);
  });
  it("does not fuzzy-match a different date", () => {
    const existing = runs([{ date: "2026-07-09", km: 8 }]);
    expect(isDuplicate(session(), existing, [])).toBe(false);
  });
});

describe("newWatchSessions", () => {
  it("keeps only runnable, non-duplicate sessions and maps them", () => {
    const sessions = [
      session({ id: "run", exerciseType: 56 }),
      session({ id: "bike", exerciseType: 8 }),         // dropped: not a run
      session({ id: "seen", exerciseType: 56 }),         // dropped: seen
    ];
    const out = newWatchSessions(sessions, [], ["seen"]);
    expect(out).toHaveLength(1);
    expect(out[0].hcId).toBe("run");
  });
});
