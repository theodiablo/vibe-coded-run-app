import { describe, it, expect } from "vitest";
import { computeBadges, nextBadge, unlockedIds } from "./badges";

const get = (badges, id) => badges.find(b => b.id === id);

describe("computeBadges", () => {
  it("locks everything for a brand-new user", () => {
    const badges = computeBadges([], []);
    expect(badges.every(b => !b.unlocked)).toBe(true);
    expect(unlockedIds(badges)).toEqual([]);
  });

  it("unlocks distance milestones from the single longest run", () => {
    const badges = computeBadges([{ date: "2026-01-05", km: 12 }], []);
    expect(get(badges, "dist-first-5k").unlocked).toBe(true);
    expect(get(badges, "dist-first-10k").unlocked).toBe(true);
    expect(get(badges, "dist-first-half").unlocked).toBe(false);
  });

  it("counts WALK runs toward volume (inclusive)", () => {
    const runs = [
      { date: "2026-01-05", km: 60, type: "WALK" },
      { date: "2026-01-12", km: 50, type: "EASY" },
    ];
    expect(get(computeBadges(runs), "vol-100").unlocked).toBe(true);
  });

  it("consistency counts distinct active weeks, not a fragile streak", () => {
    // Two runs in the SAME week → 1 active week (a gap won't reset progress).
    const sameWeek = [{ date: "2026-01-05", km: 5 }, { date: "2026-01-07", km: 5 }];
    expect(get(computeBadges(sameWeek), "weeks-4").progress).toBeCloseTo(0.25, 5);
    const fourWeeks = [
      { date: "2026-01-05", km: 5 }, { date: "2026-01-12", km: 5 },
      { date: "2026-01-19", km: 5 }, { date: "2026-01-26", km: 5 },
    ];
    expect(get(computeBadges(fourWeeks), "weeks-4").unlocked).toBe(true);
  });

  it("unlocks race badges from participations", () => {
    const parts = [
      { status: "done", distanceKm: 10, timeSec: 3000 },
      { status: "wishlist", distanceKm: 21.1 },
    ];
    const badges = computeBadges([], parts);
    expect(get(badges, "race-wishlist").unlocked).toBe(true);
    expect(get(badges, "race-done-1").unlocked).toBe(true);
    expect(get(badges, "race-done-5").unlocked).toBe(false);
  });

  it("gives locked milestones a remaining-amount hint", () => {
    const badges = computeBadges([{ date: "2026-01-05", km: 7 }], []);
    expect(get(badges, "dist-first-10k").hint).toBe("3 km to go");
  });
});

describe("nextBadge", () => {
  it("returns the locked badge closest to completion", () => {
    const runs = [{ date: "2026-01-05", km: 9 }]; // 9/10 km on first-10k
    const nb = nextBadge(computeBadges(runs, []));
    expect(nb.id).toBe("dist-first-10k");
  });
  it("returns null when nothing is locked", () => {
    const allUnlocked = [{ id: "a", unlocked: true, progress: 1 }];
    expect(nextBadge(allUnlocked)).toBeNull();
  });
});
