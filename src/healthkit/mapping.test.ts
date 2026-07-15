import { describe, it, expect, vi } from "vitest";

vi.mock("../native", () => ({ isNative: true, isAndroid: false, isIos: true, platform: "ios" }));

import { workoutRunType, workoutToRun, newHkWorkouts, hkId, HK_ACTIVITY_RUNNING, HK_ACTIVITY_WALKING, HK_ACTIVITY_HIKING } from "./mapping";
import { hkOriginLabel, hkImportedNote } from "../imports/dataOrigin";
import type { HkWorkoutRaw } from "./plugin";
import type { Run } from "../types";

const workout = (over: Partial<HkWorkoutRaw> = {}): HkWorkoutRaw => ({
  id: "B1C2D3E4-0000-0000-0000-000000000001",
  sourceBundleId: "com.garmin.connect.mobile",
  sourceName: "Garmin Connect",
  startTime: "2026-07-10T06:30:00.000Z",
  endTime: "2026-07-10T07:15:00.000Z",
  activityType: HK_ACTIVITY_RUNNING,
  distanceM: 8123,
  elevationGainM: 42.4,
  hrAvg: 148.6,
  hrMax: 171.2,
  activeSec: 2580,
  ...over,
});

describe("workoutRunType", () => {
  it("maps running to EASY and walking/hiking to WALK", () => {
    expect(workoutRunType(HK_ACTIVITY_RUNNING)).toBe("EASY");
    expect(workoutRunType(HK_ACTIVITY_WALKING)).toBe("WALK");
    expect(workoutRunType(HK_ACTIVITY_HIKING)).toBe("WALK");
  });
  it("rejects non-run activities (cycling=13, swimming=46, absent)", () => {
    expect(workoutRunType(13)).toBeNull();
    expect(workoutRunType(46)).toBeNull();
    expect(workoutRunType(undefined)).toBeNull();
  });
});

describe("workoutToRun", () => {
  it("maps a full workout with the hk: id prefix on hcId", () => {
    const r = workoutToRun(workout());
    expect(r.km).toBe(8.12);
    expect(r.durationSec).toBe(2580); // active time wins over elapsed (2700)
    expect(r.hr).toBe(149);
    expect(r.hrMax).toBe(171);
    expect(r.elevation).toBe(42);
    expect(r.type).toBe("EASY");
    expect(r.source).toBe("watch");
    expect(r.hcId).toBe(hkId("B1C2D3E4-0000-0000-0000-000000000001"));
    expect(r.hcId!.startsWith("hk:")).toBe(true);
    expect(r.startedAt).toBe("2026-07-10T06:30:00.000Z");
    expect(r.notes).toBe("Imported from Garmin");
  });
  it("falls back to elapsed time and omits absent elevation", () => {
    const r = workoutToRun(workout({ activeSec: null, elevationGainM: null }));
    expect(r.durationSec).toBe(45 * 60);
    expect("elevation" in r).toBe(false);
  });
});

describe("newHkWorkouts", () => {
  it("drops non-run types, seen ids, and duplicates within the batch", () => {
    const a = workout();
    const b = workout({ id: "B1C2D3E4-0000-0000-0000-000000000002", activityType: 13 }); // cycling
    const c = workout({ id: "B1C2D3E4-0000-0000-0000-000000000003", startTime: "2026-07-11T06:30:00.000Z", endTime: "2026-07-11T07:15:00.000Z" });
    const dupOfA = workout({ id: "B1C2D3E4-0000-0000-0000-000000000004" }); // same time window as a
    const out = newHkWorkouts([a, b, c, dupOfA], [], []);
    expect(out.map(r => r.hcId)).toEqual([hkId(a.id), hkId(c.id)]);
    // Seen-id list blocks re-import even after the run is deleted.
    expect(newHkWorkouts([a], [], [hkId(a.id)])).toEqual([]);
  });
  it("dedupes against already-logged runs by startedAt overlap", () => {
    const logged: Run[] = [{ id: "x", date: "2026-07-10", km: 8.1, startedAt: "2026-07-10T06:31:00.000Z", durationSec: 2500 } as Run];
    expect(newHkWorkouts([workout()], logged, [])).toEqual([]);
  });
});

describe("hkOriginLabel", () => {
  it("prefers the bundle map, then the Apple Watch prefix, then sourceName", () => {
    expect(hkOriginLabel("com.garmin.connect.mobile", "Garmin Connect")).toBe("Garmin");
    expect(hkOriginLabel("com.apple.health.8F1C…", "Théo's Apple Watch")).toBe("Apple Watch");
    expect(hkOriginLabel("com.example.newapp", "NewRun")).toBe("NewRun");
    expect(hkOriginLabel(null, null)).toBe("your watch");
    expect(hkImportedNote("com.example.newapp", "NewRun")).toBe("Imported from NewRun");
  });
});
