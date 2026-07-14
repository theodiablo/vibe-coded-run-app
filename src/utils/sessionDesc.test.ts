import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildPlan } from "./plan";
import { STYLE_IDS } from "./planStyles";
import { renderSd } from "./sessionDesc";
import { cleanDesc } from "./format";
import type { PlanSessionInput } from "./plan";

// The English-equivalence guarantee: for every session buildPlan stamps with a
// structured descriptor (`sd`), rendering it in English must reproduce the
// stored `desc` byte-for-byte. This is what lets us translate the sentence at
// render time while keeping `desc` the canonical fallback — if a template ever
// drifts from the generator, this fails instead of a snapshot silently changing.

const DAYS_3: PlanSessionInput[] = [
  { dayOffset: 1, minutes: 40 },
  { dayOffset: 3, minutes: 45 },
  { dayOffset: 6, minutes: 90 },
];
const DAYS_4: PlanSessionInput[] = [
  { dayOffset: 1, minutes: 30 },
  { dayOffset: 2, minutes: 40 },
  { dayOffset: 4, minutes: 45 },
  { dayOffset: 6, minutes: 90 },
];

describe("renderSd reproduces the English desc for every generated sd", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-08T10:00:00")); // a Wednesday
  });
  afterEach(() => vi.useRealTimers());

  const cases: [string, ReturnType<typeof buildPlan>][] = [];
  for (const style of STYLE_IDS) {
    for (const [label, distanceKm, goalSec, elev] of [
      ["10k", 10, 3000, 0],
      ["half", 21.1, 6340, 150],
      ["marathon", 42.2, 14400, 300],
    ] as const) {
      // plain plan
      cases.push([
        `${style} ${label}`,
        buildPlan("2026-11-29", goalSec, DAYS_3, distanceKm, elev, { style }),
      ]);
      // 4-day layout (exercises the adjacency demotion sweep)
      cases.push([
        `${style} ${label} 4-day`,
        buildPlan("2026-11-29", goalSec, DAYS_4, distanceKm, elev, { style }),
      ]);
      // with a secondary race in the window (race overlay + mini-taper)
      cases.push([
        `${style} ${label} +race`,
        buildPlan("2026-11-29", goalSec, DAYS_3, distanceKm, elev, {
          style,
          races: [{ editionId: "tuneup", date: "2026-09-20", distanceKm: 10, elevation: 40 }],
        }),
      ]);
    }
  }

  it.each(cases)("%s: every sd renders to its desc", (_label, plan) => {
    let checked = 0;
    for (const wk of plan.weeks) {
      for (const s of wk.sessions) {
        if (!s.sd) continue;
        checked++;
        expect(renderSd(s.sd, s)).toBe(cleanDesc(s.desc));
      }
    }
    // Guard against a vacuous pass if sd stops being emitted.
    expect(checked).toBeGreaterThan(0);
  });
});
