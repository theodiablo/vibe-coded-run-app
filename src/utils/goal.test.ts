import { describe, it, expect } from "vitest";
import { paceBand, suggestedPace, suggestedGoalSec, clampGoalSec } from "./goal";

describe("paceBand", () => {
  it("returns null for an unset / invalid distance", () => {
    expect(paceBand("")).toBeNull();
    expect(paceBand(0)).toBeNull();
    expect(paceBand(-5)).toBeNull();
  });

  it("uses anchor bounds at reference distances", () => {
    expect(paceBand(5)).toEqual({fast: 180, slow: 480});
    expect(paceBand(10)).toEqual({fast: 195, slow: 510});
  });

  it("clamps below and above the anchor range", () => {
    expect(paceBand(1)).toEqual({fast: 180, slow: 480});
    expect(paceBand(250)).toEqual({fast: 270, slow: 660});
  });

  it("interpolates between anchors and keeps fast < slow", () => {
    const b = paceBand(15);
    expect(b.fast).toBeGreaterThan(195);
    expect(b.fast).toBeLessThan(210);
    expect(b.fast).toBeLessThan(b.slow);
  });

  it("never offers an absurd finish time (no 6h for a 10k)", () => {
    const b = paceBand(10);
    expect(b.slow * 10).toBeLessThan(6 * 3600); // slowest 10k well under 6h
  });
});

describe("suggested goal", () => {
  it("sits inside the band", () => {
    const b = paceBand(21.0975);
    const p = suggestedPace(21.0975);
    expect(p).toBeGreaterThanOrEqual(b.fast);
    expect(p).toBeLessThanOrEqual(b.slow);
  });

  it("derives a finish time from the suggested pace", () => {
    expect(suggestedGoalSec(10)).toBe(Math.round(suggestedPace(10) * 10));
    expect(suggestedGoalSec("")).toBeNull();
  });
});

describe("clampGoalSec", () => {
  it("pulls out-of-band goals back into range", () => {
    // 7200s (2h) for a 10k is way too slow — clamp to the band max.
    const b = paceBand(10);
    expect(clampGoalSec(7200, 10)).toBe(b.slow * 10);
    // An unrealistically fast time clamps up to the band min.
    expect(clampGoalSec(600, 10)).toBe(b.fast * 10);
  });

  it("leaves in-band goals untouched", () => {
    expect(clampGoalSec(3000, 10)).toBe(3000);
  });

  it("is a no-op without a distance", () => {
    expect(clampGoalSec(3000, "")).toBe(3000);
  });
});
