import { describe, it, expect } from "vitest";
import { buildPlan } from "./plan";
import { pickHardDays, recommendStyle, STYLE_PACING, STYLE_IDS, stylePacing } from "./planStyles";
import { ymd } from "./format";

const raceDateInDays = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return ymd(d);
};

const DAYS3 = [{ dayOffset: 1, minutes: 40 }, { dayOffset: 3, minutes: 45 }, { dayOffset: 6, minutes: 90 }];
const DAYS5 = [
  { dayOffset: 0, minutes: 40 }, { dayOffset: 1, minutes: 45 }, { dayOffset: 2, minutes: 60 },
  { dayOffset: 4, minutes: 45 }, { dayOffset: 6, minutes: 110 },
];

type S = { type: string; km: number; pace: number; desc: string; date: string };
const trainingWeeks = (plan: { weeks: { phase: string; sessions: S[] }[] }) =>
  plan.weeks.slice(0, -1);
const allSessions = (plan: { weeks: { phase: string; sessions: S[] }[] }) =>
  trainingWeeks(plan).flatMap(w => w.sessions);

describe("pickHardDays", () => {
  it("picks the day farthest (circularly) from the long day first", () => {
    // Long Sun(6): Wed(2) is 3 away both directions — farther than Fri(4).
    expect(pickHardDays([2, 4], 6, 1)).toEqual([2]);
  });

  it("keeps ≥2-day circular gaps, including the Sun→Mon wrap", () => {
    // Mon(0) is only 1 from Sun(6) around the wrap — never picked.
    expect(pickHardDays([0, 2], 6, 2)).toEqual([2]);
  });

  it("returns fewer days than asked when the layout is too dense", () => {
    // Fri(4) sits a legal 2 days from Sun(6); Sat(5) is adjacent to both.
    expect(pickHardDays([4, 5], 6, 2)).toEqual([4]);
    expect(pickHardDays([3, 4], 6, 2)).toEqual([3]);
    // Nothing clears the long day: Sat is adjacent, Mon is adjacent via wrap.
    expect(pickHardDays([0, 5], 6, 2)).toHaveLength(0);
  });
});

describe("recommendStyle", () => {
  const lotsOfRuns = (perWeekKm: number, count = 12) =>
    Array.from({ length: count }, (_, i) => ({
      date: raceDateInDays(-(i * 2 + 1)),
      km: (perWeekKm * 5) / count,
    }));

  it("recommends runwalk for a true beginner with a fitness intent", () => {
    expect(recommendStyle({ intent: "fitness", planSessions: DAYS3, distanceKm: 5, recentRuns: [] }))
      .toBe("runwalk");
  });

  it("recommends runwalk for an unfit runner targeting a short race", () => {
    expect(recommendStyle({ intent: "race", planSessions: DAYS3, distanceKm: 10, recentRuns: [] }))
      .toBe("runwalk");
  });

  it("never auto-recommends runwalk for an unfit marathoner", () => {
    expect(recommendStyle({ intent: "race", planSessions: [DAYS3[0]], distanceKm: 42.2, recentRuns: [] }))
      .toBe("balanced");
  });

  it("recommends lowfreq for a trained 3-day runner (beats hansons/polarized)", () => {
    expect(recommendStyle({ intent: "race", planSessions: DAYS3, distanceKm: 42.2, recentRuns: lotsOfRuns(40) }))
      .toBe("lowfreq");
  });

  it("recommends hansons for a high-frequency, high-volume marathoner", () => {
    expect(recommendStyle({ intent: "race", planSessions: DAYS5, distanceKm: 42.2, recentRuns: lotsOfRuns(40) }))
      .toBe("hansons");
  });

  it("recommends polarized for frequent runners below hansons volume or distance", () => {
    expect(recommendStyle({ intent: "race", planSessions: DAYS5, distanceKm: 10, recentRuns: lotsOfRuns(40) }))
      .toBe("polarized");
  });

  it("falls back to balanced on empty inputs (new user)", () => {
    expect(recommendStyle({})).toBe("balanced");
  });

  it("ignores runs older than the 35-day window", () => {
    const stale = Array.from({ length: 12 }, (_, i) => ({ date: raceDateInDays(-(50 + i)), km: 20 }));
    expect(recommendStyle({ intent: "race", planSessions: DAYS3, distanceKm: 42.2, recentRuns: stale }))
      .toBe("balanced");
  });

  it("is deterministic via an injectable today", () => {
    const today = new Date("2026-07-08T00:00:00");
    const runs = [{ date: "2026-06-20", km: 30 }, { date: "2026-06-25", km: 30 },
      { date: "2026-06-28", km: 30 }, { date: "2026-07-01", km: 35 }];
    expect(recommendStyle({ intent: "race", planSessions: DAYS3, distanceKm: 21.1, recentRuns: runs, today }))
      .toBe("lowfreq");
  });
});

describe("style pacing table", () => {
  it("balanced keeps the pre-styles ratios", () => {
    expect(STYLE_PACING.balanced).toEqual({ easy: 1.25, tempo: 1.05, intervals: 1, long: 1.25 });
  });

  it("unknown styles degrade to balanced", () => {
    expect(stylePacing("norwegian-singles")).toEqual(STYLE_PACING.balanced);
    expect(stylePacing(undefined)).toEqual(STYLE_PACING.balanced);
  });

  it("every declared style has pacing", () => {
    STYLE_IDS.forEach(id => expect(STYLE_PACING[id as keyof typeof STYLE_PACING]).toBeTruthy());
  });
});

describe("buildPlan styles", () => {
  it("absent style is identical to explicit balanced", () => {
    const args = [raceDateInDays(120), 6340, DAYS3, 21.1, 150] as const;
    const a = buildPlan(...args, { recentRuns: [{ date: raceDateInDays(-7), km: 14 }] });
    const b = buildPlan(...args, { recentRuns: [{ date: raceDateInDays(-7), km: 14 }], style: "balanced" });
    expect(a).toEqual(b);
    expect(a.style).toBe("balanced");
  });

  it("unknown style degrades to balanced output", () => {
    const args = [raceDateInDays(120), 6340, DAYS3, 21.1, 0] as const;
    expect(buildPlan(...args, { style: "vaporware" })).toEqual(buildPlan(...args, {}));
  });

  describe("polarized", () => {
    const plan = buildPlan(raceDateInDays(120), 6340, DAYS5, 21.1, 0, { style: "polarized" });

    it("caps hard non-LONG work at one session per week", () => {
      trainingWeeks(plan).forEach(w => {
        const hard = w.sessions.filter(s => s.type === "TEMPO" || s.type === "INTERVALS");
        expect(hard.length).toBeLessThanOrEqual(1);
      });
    });

    it("prescribes genuinely easy pace on easy and long days", () => {
      const tgt = plan.targetPace;
      allSessions(plan).forEach(s => {
        if (s.type === "EASY" || s.type === "LONG")
          expect(s.pace).toBe(Math.round(tgt * 1.32));
      });
    });
  });

  describe("runwalk", () => {
    const plan = buildPlan(raceDateInDays(140), 14400, DAYS3, 42.2, 0, { style: "runwalk" });

    it("never emits tempo or interval sessions", () => {
      expect(allSessions(plan).some(s => s.type === "TEMPO" || s.type === "INTERVALS")).toBe(false);
    });

    it("uses WALK-typed sessions with the run/walk ratio in the desc", () => {
      const walks = allSessions(plan).filter(s => s.type === "WALK");
      expect(walks.length).toBeGreaterThan(0);
      walks.forEach(s => expect(s.desc).toMatch(/run \d min \/ walk 1 min/));
      allSessions(plan).filter(s => s.type === "LONG")
        .forEach(s => expect(s.desc).toMatch(/Long run\/walk/));
    });

    it("caps the marathon long run at 26 km (finish-focused)", () => {
      expect(plan.longRunPeakKm).toBeLessThanOrEqual(26);
    });

    it("includes cutback weeks in the long-run ramp", () => {
      const longs = trainingWeeks(plan)
        .flatMap(w => w.sessions).filter(s => s.type === "LONG").map(s => Number(s.km));
      const dips = longs.filter((km, i) => i > 0 && i < longs.length - 1 && km < longs[i - 1]);
      expect(dips.length).toBeGreaterThan(0);
    });
  });

  describe("lowfreq", () => {
    const plan = buildPlan(raceDateInDays(120), 6340, DAYS5, 21.1, 0, { style: "lowfreq" });

    it("keeps exactly 3 run days; extra days become optional cross-training", () => {
      trainingWeeks(plan).forEach(w => {
        const runs = w.sessions.filter(s => ["EASY", "TEMPO", "INTERVALS", "LONG"].includes(s.type));
        const other = w.sessions.filter(s => s.type === "OTHER");
        expect(runs.length).toBeLessThanOrEqual(3);
        expect(other.length).toBe(w.sessions.length - runs.length);
        other.forEach(s => expect(s.desc).toMatch(/cross-training/i));
      });
    });

    it("prescribes faster interval pace than balanced", () => {
      const tgt = plan.targetPace;
      const ints = allSessions(plan).filter(s => s.type === "INTERVALS");
      expect(ints.length).toBeGreaterThan(0);
      ints.forEach(s => expect(s.pace).toBe(Math.round(tgt * 0.95)));
    });

    it("degrades to long + alternating quality with only 2 days", () => {
      const two = buildPlan(raceDateInDays(120), 6340,
        [{ dayOffset: 2, minutes: 45 }, { dayOffset: 6, minutes: 90 }], 21.1, 0, { style: "lowfreq" });
      const types = new Set(allSessions(two).map(s => s.type));
      expect(types.has("OTHER")).toBe(false);
      expect(types.has("TEMPO") && types.has("INTERVALS")).toBe(true);
    });
  });

  describe("hansons", () => {
    const plan = buildPlan(raceDateInDays(140), 14400, DAYS5, 42.2, 0,
      { style: "hansons", recentRuns: [{ date: raceDateInDays(-7), km: 20 }] });

    it("caps the marathon long run at 26 km", () => {
      expect(plan.longRunPeakKm).toBeLessThanOrEqual(26);
    });

    it("keeps the long run under ~35% of peak-week volume", () => {
      const peakWeek = trainingWeeks(plan).reduce((best, w) => {
        const vol = w.sessions.reduce((s, x) => s + Number(x.km), 0);
        return vol > best.vol ? { vol, w } : best;
      }, { vol: 0, w: trainingWeeks(plan)[0] });
      const long = peakWeek.w.sessions.find(s => s.type === "LONG");
      expect(Number(long!.km) / peakWeek.vol).toBeLessThanOrEqual(0.35);
    });

    it("prescribes the tempo at goal race pace", () => {
      const tempos = allSessions(plan).filter(s => s.type === "TEMPO");
      expect(tempos.length).toBeGreaterThan(0);
      tempos.forEach(s => {
        expect(s.pace).toBe(plan.targetPace);
        expect(s.desc).toMatch(/goal race pace/);
      });
    });

    it("never places two hard sessions on consecutive days", () => {
      const hard = allSessions(plan)
        .filter(s => ["TEMPO", "INTERVALS", "LONG"].includes(s.type))
        .map(s => s.date).sort();
      for (let i = 1; i < hard.length; i++) {
        const gap = (new Date(hard[i] + "T00:00:00").getTime()
          - new Date(hard[i - 1] + "T00:00:00").getTime()) / 86400000;
        expect(gap).toBeGreaterThanOrEqual(2);
      }
    });
  });
});
