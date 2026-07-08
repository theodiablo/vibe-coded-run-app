import { describe, it, expect } from "vitest";
import { haversineM, distanceKm, elevGainM, simplify, segments, accuracyOK } from "./geo";

const pt = (lat: number, lng: number): [number, number] => [lat, lng];
const pos = (alt: number | null): { lat: number; lng: number; alt: number | null } => ({ lat: 0, lng: 0, alt });
const ok = accuracyOK as (pos: { coords?: { accuracy?: number | null } } | null | undefined) => boolean;

describe("haversineM", () => {
  it("is zero for identical points", () => {
    expect(haversineM(pt(48.0, 2.0), pt(48.0, 2.0))).toBe(0);
  });
  it("measures ~111 km per degree of latitude", () => {
    const m = haversineM(pt(0, 0), pt(1, 0));
    expect(m).toBeGreaterThan(110000);
    expect(m).toBeLessThan(112000);
  });
  it("accepts {lat,lng} objects too", () => {
    const arr = haversineM(pt(0, 0), pt(0, 1));
    const obj = haversineM({ lat: 0, lng: 0 }, { lat: 0, lng: 1 });
    expect(obj).toBeCloseTo(arr, 5);
  });
});

describe("distanceKm", () => {
  it("sums segment lengths", () => {
    const km = distanceKm([pt(0, 0), pt(0, 1), pt(0, 2)]);
    expect(km).toBeGreaterThan(220);
    expect(km).toBeLessThan(224);
  });
  it("skips sub-threshold jitter", () => {
    // ~0.1 m apart — below the 3 m default gate.
    const pts = [pt(48.0, 2.0), pt(48.000001, 2.0)];
    expect(distanceKm(pts)).toBe(0);
  });
  it("bridges gap markers with the straight-line (minimum) distance", () => {
    const withGap = distanceKm([pt(0, 0), pt(0, 1), null, pt(0, 5), pt(0, 6)]);
    const noGap = distanceKm([pt(0, 0), pt(0, 1), pt(0, 5), pt(0, 6)]);
    expect(withGap).toBeCloseTo(noGap, 5);
  });
});

describe("elevGainM", () => {
  it("counts only ascents above the noise band", () => {
    expect(elevGainM([pos(100), pos(110), pos(105), pos(120)])).toBe(25);
  });
  it("ignores points without altitude", () => {
    expect(elevGainM([pos(null), pos(100), pos(130)])).toBe(30);
  });
  it("ignores descents", () => {
    expect(elevGainM([pos(200), pos(100)])).toBe(0);
  });
  it("filters GPS vertical noise on flat ground", () => {
    // Altitude jittering ±a few metres around 55m on a flat run must read ~0,
    // not accumulate every +1/+2 wiggle.
    const flat = [55, 56, 55, 54, 56, 57, 55, 53, 56, 55].map(pos);
    expect(elevGainM(flat)).toBe(0);
  });
});

describe("simplify", () => {
  it("collapses collinear points to the endpoints", () => {
    const line = [pt(0, 0), pt(0, 1), pt(0, 2), pt(0, 3), pt(0, 4)];
    expect(simplify(line).length).toBe(2);
  });
  it("keeps a point that deviates beyond epsilon", () => {
    const pts = [pt(0, 0), pt(0.001, 1), pt(0, 2)];
    expect(simplify(pts, 5).length).toBe(3);
  });
  it("preserves gap markers between segments", () => {
    const out = simplify([pt(0, 0), pt(0, 1), pt(0, 2), null, pt(0, 5), pt(0, 6), pt(0, 7)]);
    expect(out).toContain(null);
  });
});

describe("segments", () => {
  it("splits on gap markers into [lat,lng] pairs", () => {
    const segs = segments([pt(1, 2), pt(3, 4), null, pt(5, 6)]);
    expect(segs).toEqual([[[1, 2], [3, 4]], [[5, 6]]]);
  });
});

describe("accuracyOK", () => {
  it("rejects low-accuracy fixes", () => {
    expect(ok({ coords: { accuracy: 80 } })).toBe(false);
  });
  it("accepts good fixes and missing accuracy", () => {
    expect(ok({ coords: { accuracy: 10 } })).toBe(true);
    expect(ok({ coords: {} })).toBe(true);
  });
});
