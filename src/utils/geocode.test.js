import { describe, it, expect } from "vitest";
import { parseGeocodeResult } from "./geocode";

describe("parseGeocodeResult", () => {
  it("reads [lng, lat] center off the first feature", () => {
    const json = { features: [{ center: [4.835, 45.764] }] };
    expect(parseGeocodeResult(json)).toEqual({ lat: 45.764, lng: 4.835 });
  });

  it("returns null when there are no features", () => {
    expect(parseGeocodeResult({ features: [] })).toBeNull();
    expect(parseGeocodeResult({})).toBeNull();
    expect(parseGeocodeResult(null)).toBeNull();
  });

  it("returns null when center is missing or malformed", () => {
    expect(parseGeocodeResult({ features: [{}] })).toBeNull();
    expect(parseGeocodeResult({ features: [{ center: [4.835] }] })).toBeNull();
    expect(parseGeocodeResult({ features: [{ center: ["a", "b"] }] })).toBeNull();
  });
});
