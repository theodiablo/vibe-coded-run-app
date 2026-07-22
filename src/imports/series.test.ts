import { describe, it, expect } from "vitest";
import { normalizeRoutePoints, normalizeHrSamples } from "./series";

describe("normalizeRoutePoints", () => {
  it("keeps well-formed [lat,lng,t,alt] points and coerces a missing/invalid alt to null", () => {
    expect(normalizeRoutePoints([
      [48.85, 2.35, 1000, 42],
      [48.86, 2.36, 2000, null],
      [48.87, 2.37, 3000],       // no altitude entry → null
    ])).toEqual([
      [48.85, 2.35, 1000, 42],
      [48.86, 2.36, 2000, null],
      [48.87, 2.37, 3000, null],
    ]);
  });

  it("drops malformed points (short, non-numeric, NaN/Infinity coords or time)", () => {
    expect(normalizeRoutePoints([
      [48.85, 2.35],                    // too short
      ["x", 2.35, 1000, 5],             // non-numeric lat
      [48.85, "y", 1000, 5],            // non-numeric lng
      [48.85, 2.35, "t", 5],            // non-numeric time
      [Infinity, 2.35, 1000, 5],        // non-finite lat
      [48.85, 2.35, 1000, 5],           // valid
    ])).toEqual([[48.85, 2.35, 1000, 5]]);
  });

  it("returns [] for non-array / nullish input", () => {
    expect(normalizeRoutePoints(undefined)).toEqual([]);
    expect(normalizeRoutePoints(null)).toEqual([]);
    expect(normalizeRoutePoints("nope")).toEqual([]);
    expect(normalizeRoutePoints({})).toEqual([]);
  });
});

describe("normalizeHrSamples", () => {
  it("rounds bpm, keeps epoch-ms t, drops zero/NaN bpm and non-finite t", () => {
    expect(normalizeHrSamples([
      { bpm: 150.4, t: 1000 },
      { bpm: 0, t: 2000 },              // zero bpm → dropped
      { bpm: 155, t: NaN },             // bad time → dropped
      { bpm: 160.6, t: 3000 },
      { t: 4000 },                      // missing bpm → dropped
    ])).toEqual([
      { bpm: 150, t: 1000 },
      { bpm: 161, t: 3000 },
    ]);
  });

  it("returns [] for non-array / nullish input", () => {
    expect(normalizeHrSamples(undefined)).toEqual([]);
    expect(normalizeHrSamples(null)).toEqual([]);
    expect(normalizeHrSamples({})).toEqual([]);
  });
});
