import { describe, it, expect } from "vitest";
import { detectRaceCompletion, bestTimesByDistance, isPersonalBest, findEdition, searchEditions } from "./races";

const target = { targetEditionId: "behobia-san-sebastian-2026", raceDate: "2026-11-08", distanceKm: 20 };

describe("detectRaceCompletion", () => {
  it("matches a run on the race date within distance tolerance", () => {
    expect(detectRaceCompletion({ date: "2026-11-08", km: 20.1 }, target))
      .toBe("behobia-san-sebastian-2026");
    expect(detectRaceCompletion({ date: "2026-11-08", km: 18.5 }, target))
      .toBe("behobia-san-sebastian-2026");
  });
  it("rejects a run on a different day", () => {
    expect(detectRaceCompletion({ date: "2026-11-07", km: 20 }, target)).toBeNull();
  });
  it("rejects a distance well outside tolerance", () => {
    expect(detectRaceCompletion({ date: "2026-11-08", km: 10 }, target)).toBeNull();
  });
  it("returns null when no target is set", () => {
    expect(detectRaceCompletion({ date: "2026-11-08", km: 20 }, { raceDate: "2026-11-08", distanceKm: 20 }))
      .toBeNull();
  });
  it("handles missing run fields gracefully", () => {
    expect(detectRaceCompletion(null, target)).toBeNull();
    expect(detectRaceCompletion({ date: "2026-11-08" }, target)).toBeNull();
  });
});

describe("bestTimesByDistance / isPersonalBest", () => {
  const parts = [
    { status: "done", distanceKm: 10, timeSec: 3000 },
    { status: "done", distanceKm: 10, timeSec: 2800 },
    { status: "done", distanceKm: 21.1, timeSec: 6000 },
    { status: "wishlist", distanceKm: 10, timeSec: null },
  ];
  it("keeps the fastest time per distance bucket", () => {
    expect(bestTimesByDistance(parts)).toEqual({ 10: 2800, 21.1: 6000 });
  });
  it("flags the fastest done entry as a PB", () => {
    expect(isPersonalBest({ status: "done", distanceKm: 10, timeSec: 2800 }, parts)).toBe(true);
    expect(isPersonalBest({ status: "done", distanceKm: 10, timeSec: 3000 }, parts)).toBe(false);
  });
  it("never flags a wishlist (no time) entry", () => {
    expect(isPersonalBest({ status: "wishlist", distanceKm: 10, timeSec: null }, parts)).toBe(false);
  });
});

describe("findEdition", () => {
  it("resolves a known curated edition", () => {
    const e = findEdition("behobia-san-sebastian-2026-11-08");
    expect(e?.name).toBe("Behobia-San Sebastián");
    expect(e?.edition.distanceKm).toBe(20);
  });
  it("returns null for an unknown / orphaned id", () => {
    expect(findEdition("nope-2099")).toBeNull();
    expect(findEdition(null)).toBeNull();
  });
});

describe("searchEditions", () => {
  const past = "1900-01-01";   // keep every curated edition in range
  const future = "2999-01-01"; // exclude every curated edition
  it("matches on race name (case-insensitive)", () => {
    const hits = searchEditions("berlin", past);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every(e => e.name.toLowerCase().includes("berlin"))).toBe(true);
  });
  it("matches on city", () => {
    expect(searchEditions("paris", past).length).toBeGreaterThan(0);
  });
  it("returns joined editions usable as a promote target", () => {
    const [e] = searchEditions("berlin", past);
    expect(e.raceId).toBeTruthy();
    expect(e.edition.date).toBeTruthy();
    expect(e.edition.distanceKm).toBeGreaterThan(0);
  });
  it("hides past editions by default", () => {
    expect(searchEditions("", future)).toHaveLength(0);
  });
  it("includes past editions when upcomingOnly is false", () => {
    expect(searchEditions("", future, { upcomingOnly: false }).length).toBeGreaterThan(0);
  });
  it("returns all upcoming editions for an empty query", () => {
    expect(searchEditions("", past).length).toBeGreaterThan(1);
  });
});
