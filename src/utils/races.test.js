import { describe, it, expect, beforeAll } from "vitest";
import { detectRaceCompletion, detectAnyRace, bestTimesByDistance, isPersonalBest, findEdition, searchEditions, hydrateCatalogue } from "./races";

// The catalogue is now fetched data, not a bundle, so hydrate a tiny fixture
// before the lookup tests (mirrors what loadCatalogue does at runtime).
beforeAll(() => {
  hydrateCatalogue([
    {
      id: "behobia-san-sebastian", name: "Behobia-San Sebastián", city: "San Sebastián",
      country: "ES", lat: 43.3183, lng: -1.9812, distances: [20], verified: true,
      editions: [{ id: "behobia-san-sebastian-2026-11-08", date: "2026-11-08", distanceKm: 20, elevation: 200, verified: true }],
    },
  ]);
});

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

describe("detectAnyRace", () => {
  const cands = [
    { editionId: "main-20k", date: "2026-11-08", distanceKm: 20 },
    { editionId: "tuneup-10k", date: "2026-10-04", distanceKm: 10 },
  ];
  it("matches the correct race among several candidates", () => {
    expect(detectAnyRace({ date: "2026-10-04", km: 10.2 }, cands)).toBe("tuneup-10k");
    expect(detectAnyRace({ date: "2026-11-08", km: 19.5 }, cands)).toBe("main-20k");
  });
  it("returns null when no candidate matches (wrong date or wrong distance)", () => {
    expect(detectAnyRace({ date: "2026-09-01", km: 10 }, cands)).toBeNull(); // no date match
    expect(detectAnyRace({ date: "2026-10-04", km: 20 }, cands)).toBeNull(); // right day, wrong distance
  });
  it("ignores candidates without an editionId", () => {
    expect(detectAnyRace({ date: "2026-10-04", km: 10 }, [{ date: "2026-10-04", distanceKm: 10 }])).toBeNull();
  });
  it("handles empty candidates / missing fields", () => {
    expect(detectAnyRace({ date: "2026-10-04", km: 10 }, [])).toBeNull();
    expect(detectAnyRace(null, cands)).toBeNull();
    expect(detectAnyRace({ date: "2026-10-04" }, cands)).toBeNull();
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
