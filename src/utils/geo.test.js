import { describe, it, expect } from "vitest";
import { haversineM, distanceKm, elevGainM, simplify, segments, accuracyOK } from "./geo";

describe("haversineM", () => {
  it("is zero for identical points", () => {
    expect(haversineM([48.0, 2.0], [48.0, 2.0])).toBe(0);
  });
  it("measures ~111 km per degree of latitude", () => {
    const m = haversineM([0, 0], [1, 0]);
    expect(m).toBeGreaterThan(110000);
    expect(m).toBeLessThan(112000);
  });
  it("accepts {lat,lng} objects too", () => {
    const arr = haversineM([0, 0], [0, 1]);
    const obj = haversineM({ lat: 0, lng: 0 }, { lat: 0, lng: 1 });
    expect(obj).toBeCloseTo(arr, 5);
  });
});

describe("distanceKm", () => {
  it("sums segment lengths", () => {
    const km = distanceKm([[0, 0], [0, 1], [0, 2]]);
    expect(km).toBeGreaterThan(220);
    expect(km).toBeLessThan(224);
  });
  it("skips sub-threshold jitter", () => {
    // ~0.1 m apart — below the 3 m default gate.
    const pts = [[48.0, 2.0], [48.000001, 2.0]];
    expect(distanceKm(pts)).toBe(0);
  });
  it("breaks accumulation at gap markers", () => {
    const withGap = distanceKm([[0, 0], [0, 1], null, [0, 5], [0, 6]]);
    const twoSegs = distanceKm([[0, 0], [0, 1]]) + distanceKm([[0, 5], [0, 6]]);
    expect(withGap).toBeCloseTo(twoSegs, 5);
  });
});

describe("elevGainM", () => {
  it("counts only ascents above the noise band", () => {
    expect(elevGainM([[0, 0, 0, 100], [0, 0, 0, 110], [0, 0, 0, 105], [0, 0, 0, 120]])).toBe(25);
  });
  it("ignores points without altitude", () => {
    expect(elevGainM([[0, 0, 0, null], [0, 0, 0, 100], [0, 0, 0, 130]])).toBe(30);
  });
  it("ignores descents", () => {
    expect(elevGainM([[0, 0, 0, 200], [0, 0, 0, 100]])).toBe(0);
  });
  it("filters GPS vertical noise on flat ground", () => {
    // Altitude jittering ±a few metres around 55m on a flat run must read ~0,
    // not accumulate every +1/+2 wiggle.
    const flat = [55, 56, 55, 54, 56, 57, 55, 53, 56, 55].map(a => [0, 0, 0, a]);
    expect(elevGainM(flat)).toBe(0);
  });
});

describe("simplify", () => {
  it("collapses collinear points to the endpoints", () => {
    const line = [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]];
    expect(simplify(line).length).toBe(2);
  });
  it("keeps a point that deviates beyond epsilon", () => {
    const pts = [[0, 0], [0.001, 1], [0, 2]];
    expect(simplify(pts, 5).length).toBe(3);
  });
  it("preserves gap markers between segments", () => {
    const out = simplify([[0, 0], [0, 1], [0, 2], null, [0, 5], [0, 6], [0, 7]]);
    expect(out).toContain(null);
  });
});

describe("segments", () => {
  it("splits on gap markers into [lat,lng] pairs", () => {
    const segs = segments([[1, 2, 0, null], [3, 4, 0, null], null, [5, 6, 0, null]]);
    expect(segs).toEqual([[[1, 2], [3, 4]], [[5, 6]]]);
  });
});

describe("accuracyOK", () => {
  it("rejects low-accuracy fixes", () => {
    expect(accuracyOK({ coords: { accuracy: 80 } })).toBe(false);
  });
  it("accepts good fixes and missing accuracy", () => {
    expect(accuracyOK({ coords: { accuracy: 10 } })).toBe(true);
    expect(accuracyOK({ coords: {} })).toBe(true);
  });
});
