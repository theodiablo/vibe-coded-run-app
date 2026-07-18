import { describe, it, expect } from "vitest";
import {
  sessionsFromSimple, weeklyLoad, bandRepMinutes, clampDays,
  AVAIL_DAY_MIN, AVAIL_DAY_MAX, LOAD_GOOD_LO, LOAD_GOOD_HI,
  type DurationBand,
} from "./availability";

describe("clampDays", () => {
  it("clamps to the 2–6 range and rounds", () => {
    expect(clampDays(1)).toBe(AVAIL_DAY_MIN);
    expect(clampDays(9)).toBe(AVAIL_DAY_MAX);
    expect(clampDays(3.4)).toBe(3);
  });
});

describe("sessionsFromSimple", () => {
  const bands: DurationBand[] = ["short", "med", "long"];

  it("returns the requested number of days for every count", () => {
    for (let d = AVAIL_DAY_MIN; d <= AVAIL_DAY_MAX; d++) {
      expect(sessionsFromSimple(d, "med")).toHaveLength(d);
    }
  });

  it("always includes Sunday (dayOffset 6) as strictly the longest session", () => {
    for (let d = AVAIL_DAY_MIN; d <= AVAIL_DAY_MAX; d++) {
      for (const band of bands) {
        const sessions = sessionsFromSimple(d, band);
        const sunday = sessions.find(s => s.dayOffset === 6);
        expect(sunday).toBeDefined();
        const longest = Math.max(...sessions.map(s => s.minutes));
        expect(sunday!.minutes).toBe(longest);
        // strictly longest: no weekday ties the long run
        expect(sessions.filter(s => s.minutes === longest)).toHaveLength(1);
      }
    }
  });

  it("uses only option-set minute values", () => {
    const allowed = new Set([20, 30, 45, 60, 75, 90, 120, 150, 180]);
    for (let d = AVAIL_DAY_MIN; d <= AVAIL_DAY_MAX; d++) {
      for (const band of bands) {
        for (const s of sessionsFromSimple(d, band)) expect(allowed.has(s.minutes)).toBe(true);
      }
    }
  });

  it("keeps distinct, sorted-in-week day offsets", () => {
    const sessions = sessionsFromSimple(4, "med");
    const offsets = sessions.map(s => s.dayOffset);
    expect(new Set(offsets).size).toBe(offsets.length);
    expect(offsets.every(o => o >= 0 && o <= 6)).toBe(true);
  });

  it("clamps out-of-range day counts", () => {
    expect(sessionsFromSimple(0, "med")).toHaveLength(AVAIL_DAY_MIN);
    expect(sessionsFromSimple(99, "med")).toHaveLength(AVAIL_DAY_MAX);
  });
});

describe("weeklyLoad", () => {
  it("sums exact durations in custom mode", () => {
    const r = weeklyLoad({ mode: "custom", sessions: [{ dayOffset: 2, minutes: 45 }, { dayOffset: 6, minutes: 90 }] });
    expect(r.totalMin).toBe(135);
    expect(r.zone).toBe("good");
  });

  it("estimates days × representative minutes in simple mode", () => {
    const r = weeklyLoad({ mode: "simple", days: 3, band: "med" });
    expect(r.totalMin).toBe(3 * bandRepMinutes("med"));
  });

  it("classifies zones at the band boundaries", () => {
    expect(weeklyLoad({ mode: "custom", sessions: [{ dayOffset: 0, minutes: LOAD_GOOD_LO - 1 }] }).zone).toBe("low");
    expect(weeklyLoad({ mode: "custom", sessions: [{ dayOffset: 0, minutes: LOAD_GOOD_LO }] }).zone).toBe("good");
    expect(weeklyLoad({ mode: "custom", sessions: [{ dayOffset: 0, minutes: LOAD_GOOD_HI }] }).zone).toBe("good");
    expect(weeklyLoad({ mode: "custom", sessions: [{ dayOffset: 0, minutes: LOAD_GOOD_HI + 1 }] }).zone).toBe("high");
  });

  it("clamps pct into 0–100", () => {
    expect(weeklyLoad({ mode: "custom", sessions: [{ dayOffset: 0, minutes: 999 }] }).pct).toBe(100);
    expect(weeklyLoad({ mode: "custom", sessions: [] }).pct).toBe(0);
  });
});
