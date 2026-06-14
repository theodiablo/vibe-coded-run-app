import { describe, it, expect } from "vitest";
import { hrZoneBpm, sessionHR, HR_ZONES, SESSION_ZONES } from "./hr";

describe("hrZoneBpm", () => {
  it("computes percent-of-max ranges", () => {
    expect(hrZoneBpm(0.5, 0.6, 200, 60, "pct")).toEqual({lo: 100, hi: 120});
  });
  it("computes Karvonen (heart-rate reserve) ranges", () => {
    // HRR = 200 - 60 = 140; lo = 140*0.5 + 60, hi = 140*0.6 + 60
    expect(hrZoneBpm(0.5, 0.6, 200, 60, "karvonen")).toEqual({lo: 130, hi: 144});
  });
  it("returns null without a max HR", () => {
    expect(hrZoneBpm(0.5, 0.6, 0, 60, "karvonen")).toBeNull();
  });
  it("returns null when heart-rate reserve is non-positive", () => {
    expect(hrZoneBpm(0.5, 0.6, 60, 60, "karvonen")).toBeNull();
  });
});

describe("sessionHR", () => {
  const settings = {maxHR: 200, restHR: 60, hrMethod: "karvonen"};

  it("maps EASY to its Z2 range", () => {
    const r = sessionHR("EASY", settings);
    expect(r).toMatchObject({lo: 144, hi: 158, label: SESSION_ZONES.EASY.label});
  });
  it("spans multiple zones for TEMPO (Z3-4)", () => {
    const r = sessionHR("TEMPO", settings);
    // lo from zone 3 (0.70), hi from zone 4 (0.90)
    expect(r.lo).toBe(158);
    expect(r.hi).toBe(186);
  });
  it("falls back to EASY for unknown types", () => {
    expect(sessionHR("MYSTERY", settings)).toEqual(sessionHR("EASY", settings));
  });
  it("returns null without a max HR", () => {
    expect(sessionHR("EASY", {restHR: 60})).toBeNull();
  });
});

describe("HR_ZONES", () => {
  it("defines five contiguous zones", () => {
    expect(HR_ZONES).toHaveLength(5);
    expect(HR_ZONES.map(z => z.n)).toEqual([1, 2, 3, 4, 5]);
  });
});
