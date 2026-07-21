import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { cloneElement, isValidElement } from "react";
import type { ReactElement } from "react";

// Recharts' ResponsiveContainer measures its parent, which is 0×0 in jsdom, so
// nothing would render. Force a fixed size onto the inner chart so recharts
// computes real scales (it uses the explicit width/height, not layout APIs).
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactElement }) =>
      isValidElement(children) ? cloneElement(children, { width: 400, height: 200 } as Record<string, unknown>) : children,
  };
});

import { RunChart } from "./RunDetailModal";
import type { RunSeriesRow } from "../utils/runSeries";

afterEach(cleanup);

const ELEV = "#10b981", PACE = "#38bdf8", HR = "#f87171";
const ALL = { elev: true, pace: true, hr: true };

// Three points spaced UNEVENLY in distance (0, 0.5, 1.2 km) but at even indices,
// so a numeric axis and a categorical axis place the middle point differently.
const series: RunSeriesRow[] = [
  { distKm: 0,   tSec: 0,   elevM: 100, paceSecPerKm: 300, hr: 130 },
  { distKm: 0.5, tSec: 150, elevM: 110, paceSecPerKm: 290, hr: 140 },
  { distKm: 1.2, tSec: 360, elevM: 95,  paceSecPerKm: 280, hr: 150 },
];

// Pull the DATA-POINT vertex x-coordinates out of a recharts curve path's `d`.
// A monotone (curveMonotoneX) line is `M x,y C ... x,y C ... x,y`: the vertices
// are the M point and the endpoint of each cubic C (every 3rd coordinate pair).
function xCoords(path: Element | null): number[] {
  const d = path?.getAttribute("d") || "";
  const nums = (d.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
  const px: number[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) px.push(nums[i]); // x of each coord pair
  return px.filter((_, i) => i % 3 === 0);                        // M + each C endpoint
}

describe("RunChart", () => {
  it("renders one area (elevation) and two lines (pace, HR) when all series are on", () => {
    const { container } = render(<RunChart series={series} show={ALL} hasElev hasHr />);
    // No throw ⇒ every series' yAxisId resolved to a matching YAxis (the trap:
    // recharts errors when a series references a missing yAxisId).
    expect(container.querySelectorAll(".recharts-area").length).toBe(1);
    expect(container.querySelectorAll(".recharts-line").length).toBe(2);
    expect(container.querySelector(".recharts-xAxis")).toBeTruthy();
  });

  it("places the middle point by its DISTANCE value, not its index (numeric x-axis)", () => {
    const { container } = render(<RunChart series={series} show={ALL} hasElev hasHr />);
    const pacePath = container.querySelector(`path.recharts-curve[stroke="${PACE}"]`);
    const xs = xCoords(pacePath);
    expect(xs.length).toBe(3);
    // Fraction of the way the middle vertex sits between the first and last.
    // Numeric axis ⇒ 0.5/1.2 ≈ 0.417; a categorical axis would put it at 0.5.
    const frac = (xs[1] - xs[0]) / (xs[2] - xs[0]);
    expect(frac).toBeCloseTo(0.5 / 1.2, 1);
    expect(frac).toBeLessThan(0.47);
  });

  it("hides a series when its toggle is off", () => {
    const { container } = render(<RunChart series={series} show={{ elev: true, pace: false, hr: true }} hasElev hasHr />);
    // Pace off ⇒ its sky-blue curve is gone; HR (red) remains.
    expect(container.querySelector(`path.recharts-curve[stroke="${PACE}"]`)).toBeNull();
    expect(container.querySelector(`path.recharts-curve[stroke="${HR}"]`)).toBeTruthy();
    expect(container.querySelector(`path.recharts-curve[stroke="${ELEV}"]`)).toBeTruthy();
  });

  it("never renders the HR series when the run has no HR trace", () => {
    const { container } = render(<RunChart series={series} show={ALL} hasElev hasHr={false} />);
    expect(container.querySelector(`path.recharts-curve[stroke="${HR}"]`)).toBeNull();
    expect(container.querySelectorAll(".recharts-line").length).toBe(1); // pace only
  });
});
