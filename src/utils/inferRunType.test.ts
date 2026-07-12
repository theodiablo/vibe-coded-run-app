import { describe, it, expect } from "vitest";
import { inferRunType } from "./inferRunType";

// Reviewer's profile: sub-1:25 half (goal pace ~4:02/km), maxHR 180, rest 60.
const settings = { maxHR: 180, restHR: 60, goalSec: 5100, distanceKm: 21.1 };
const easyWeek = [{ km: 8 }, { km: 7 }, { km: 9 }, { km: 8 }];

describe("inferRunType", () => {
  it("never overrides a non-EASY input type", () => {
    expect(inferRunType({ type: "WALK", km: 5, durationSec: 3600 }, { settings })).toBe("WALK");
    expect(inferRunType({ type: "RACE", km: 21.1, durationSec: 5100 }, { settings })).toBe("RACE");
  });

  it("labels a threshold run TEMPO on the HR signal (review's 9 km @ HR 166)", () => {
    // 166 with max 180 / rest 60 sits in Z4 (Karvonen 156-168).
    expect(inferRunType({ type: "EASY", km: 9, durationSec: 9 * 245, hr: 166 },
      { runs: easyWeek, settings })).toBe("TEMPO");
  });

  it("labels goal-pace-or-faster running TEMPO even without HR", () => {
    // 4:00/km average vs a 4:02/km goal pace.
    expect(inferRunType({ type: "EASY", km: 8, durationSec: 8 * 240 },
      { runs: easyWeek, settings })).toBe("TEMPO");
  });

  it("keeps a genuinely easy run EASY", () => {
    // 5:30/km at Z2 heart rate.
    expect(inferRunType({ type: "EASY", km: 8, durationSec: 8 * 330, hr: 138 },
      { runs: easyWeek, settings })).toBe("EASY");
  });

  it("reads a spiky HR profile (Z5 peak, low average) as INTERVALS", () => {
    expect(inferRunType({ type: "EASY", km: 7, durationSec: 7 * 300, hr: 150, hrMax: 176 },
      { runs: easyWeek, settings })).toBe("INTERVALS");
  });

  it("labels LONG relative to the runner's own recent volume", () => {
    expect(inferRunType({ type: "EASY", km: 16, durationSec: 16 * 330 },
      { runs: easyWeek, settings })).toBe("LONG");
    // 16 km is NOT long for someone averaging 15 km runs.
    const bigWeek = [{ km: 15 }, { km: 14 }, { km: 16 }];
    expect(inferRunType({ type: "EASY", km: 16, durationSec: 16 * 330, hr: 130 },
      { runs: bigWeek, settings })).toBe("EASY");
  });

  it("falls back to absolute thresholds with no history", () => {
    expect(inferRunType({ type: "EASY", km: 16, durationSec: 16 * 330 }, { settings })).toBe("LONG");
    expect(inferRunType({ type: "EASY", km: 10, durationSec: 101 * 60 }, {})).toBe("LONG");
  });

  it("stays EASY when there is no usable signal at all", () => {
    expect(inferRunType({ type: "EASY", km: 8, durationSec: 0 }, {})).toBe("EASY");
    expect(inferRunType({ type: "EASY", km: 0, durationSec: 3600 }, {})).toBe("EASY");
  });
});
