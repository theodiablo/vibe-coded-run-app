import { describe, it, expect } from "vitest";
import { riegel, flatEqKm, bestEffortAnchor, linReg, hrModelAnchor } from "./predictions";

describe("riegel", () => {
  it("returns the same time for the same distance", () => {
    expect(riegel(3600, 10, 10)).toBeCloseTo(3600, 5);
  });
  it("scales up for longer distances using the fatigue exponent", () => {
    expect(riegel(1000, 5, 10)).toBeCloseTo(1000 * Math.pow(2, 1.06), 3);
  });
});

describe("flatEqKm", () => {
  it("credits elevation gain as extra flat distance", () => {
    expect(flatEqKm({km: 10, elevation: 100})).toBeCloseTo(10.8, 6); // VERT_COST=8
  });
  it("returns raw km with no/zero elevation", () => {
    expect(flatEqKm({km: 10, elevation: 0})).toBe(10);
    expect(flatEqKm({km: 10})).toBe(10);
  });
});

describe("linReg", () => {
  it("recovers a perfect line with R²=1", () => {
    const fit = linReg([{x: 0, y: 1}, {x: 1, y: 3}, {x: 2, y: 5}]);
    expect(fit.a).toBeCloseTo(1, 6);
    expect(fit.b).toBeCloseTo(2, 6);
    expect(fit.r2).toBeCloseTo(1, 6);
  });
  it("returns null with fewer than two points", () => {
    expect(linReg([{x: 1, y: 1}])).toBeNull();
  });
  it("returns null when x has no variance", () => {
    expect(linReg([{x: 5, y: 1}, {x: 5, y: 9}])).toBeNull();
  });
});

describe("bestEffortAnchor", () => {
  it("picks the strongest Riegel-equivalent effort, not the shortest fast blip", () => {
    const fastBlip = {km: 1, durationSec: 200};               // excluded (<3 km)
    const okRun    = {km: 5, durationSec: 1500};              // 5:00/km
    const strong   = {km: 10, durationSec: 3000};            // 5:00/km but longer → better eq
    const best = bestEffortAnchor([fastBlip, okRun, strong]);
    expect(best.raw).toBe(strong);
    expect(best.km).toBe(10);
    expect(best.durationSec).toBe(3000);
  });
  it("returns null when no run qualifies", () => {
    expect(bestEffortAnchor([{km: 2, durationSec: 600}])).toBeNull();
  });
});

describe("hrModelAnchor", () => {
  it("returns null without an effective max HR", () => {
    expect(hrModelAnchor([], 0, 60)).toBeNull();
  });

  it("fits pace against HR and projects to threshold effort", () => {
    // Four runs, 10 km each, pace falling as HR rises (negative slope).
    const runs = [
      {km: 10, durationSec: 3600, hr: 130},
      {km: 10, durationSec: 3500, hr: 140},
      {km: 10, durationSec: 3400, hr: 150},
      {km: 10, durationSec: 3300, hr: 160},
    ];
    const r = hrModelAnchor(runs, 190, 60);
    expect(r.n).toBe(4);
    expect(r.durationSec).toBe(3600);
    expect(r.spread).toBe(30);
    expect(r.thrHR).toBe(174); // Karvonen: round((190 - 60) * 0.88 + 60)
    expect(r.slope).toBeCloseTo(-1, 6);
    expect(r.km).toBeGreaterThan(0);
  });
});
