// Race-prediction maths: project finish times from logged runs.
import { VERT_COST } from "../constants";
import { hrZoneBpm } from "./hr";
type Point = { x: number; y: number };
type PredictRun = { km: number; durationSec?: number; elevation?: number | null; hr?: number | null; date?: string };
type EffortAnchor = { km: number; durationSec: number; eq: number; raw: PredictRun };

// Peter Riegel's endurance race-time formula: project a known time t1 over
// distance d1 to a target distance d2. The 1.06 exponent is the standard
// "fatigue factor" — going further costs slightly more than linear time.
export const riegel = (t1: number, d1: number, d2: number, k = 1.06) => t1 * Math.pow(d2 / d1, k);

// Grade-adjusted (flat-equivalent) distance. A hilly run is slower than its flat
// twin at the same effort, so we credit the climb by treating each metre ascended
// as ~VERT_COST extra metres of flat running. We only log total gain (no descent
// or profile), so this is an average-cost approximation — but it stops hilly runs
// from looking unfit, which sharpens both the best-effort pick and the HR fit.
// At ~+10% grade this counts a km as ~1.8 flat km, in line with GAP rules of thumb.
export const flatEqKm = (r: Pick<PredictRun, "km" | "elevation">) => r.km + ((r.elevation ?? 0) > 0 ? VERT_COST * (r.elevation ?? 0) / 1000 : 0);

// Pick the runner's strongest logged effort. We don't just take the lowest raw
// pace — a fast 1 km blip shouldn't outrank a strong 12 km run — so each
// qualifying run (≥3 km, with a duration) is normalised to its Riegel-equivalent
// 10 km time and the best (smallest) one wins. Distances are flat-equivalent so a
// strong hilly run can win. Returns {km, durationSec, raw} or null (km is flat-eq).
export const bestEffortAnchor = (runs: PredictRun[]) => runs
  .filter(r => r.km >= 3 && r.durationSec)
  .reduce<EffortAnchor | null>((best, r) => {
    const eqKm = flatEqKm(r);
    const eq = riegel(r.durationSec ?? 0, eqKm, 10);
    return (!best || eq < best.eq) ? {km: eqKm, durationSec: r.durationSec ?? 0, eq, raw: r} : best;
  }, null);

// Least-squares linear fit y = a + b·x, plus R² so callers can judge the fit.
export const linReg = (pts: Point[]) => {
  const n = pts.length;
  if (n < 2) return null;
  const mx = pts.reduce((s, p) => s + p.x, 0) / n;
  const my = pts.reduce((s, p) => s + p.y, 0) / n;
  let sxx = 0, sxy = 0, syy = 0;
  pts.forEach(p => { sxx += (p.x - mx) ** 2; sxy += (p.x - mx) * (p.y - my); syy += (p.y - my) ** 2; });
  if (sxx === 0) return null;
  const b = sxy / sxx;
  const a = my - b * mx;
  const r2 = syy === 0 ? 0 : (sxy * sxy) / (sxx * syy);
  return {a, b, r2};
};

// Heart-rate model. Across all runs that recorded an avg HR, fit pace (sec/km)
// against HR — easy low-HR runs anchor the slow end, hard high-HR runs the fast
// end — then extrapolate the pace the runner could hold at their threshold HR
// (top of Z4). Threshold effort is roughly a 1-hour race, so we anchor it as
// {km covered in 3600 s, 3600 s} for Riegel to project from. A fast pace held at
// a low HR therefore pulls the predicted threshold pace faster ("handled well"),
// and vice-versa. Returns the anchor plus fit stats so the caller can gate it.
export const hrModelAnchor = (runs: PredictRun[], effMax: number, restHR: number) => {
  if (!effMax) return null;
  // y is grade-adjusted pace: a hilly run's slow pace at high HR becomes a fast
  // flat-equivalent pace at high HR, consistent with the rest of the data.
  const pts = runs
    .filter(r => r.km >= 2 && r.durationSec && r.hr)
    .map(r => ({x: r.hr ?? 0, y: (r.durationSec ?? 0) / flatEqKm(r)}));
  const fit = linReg(pts);
  if (!fit) return null;
  const hrs = pts.map(p => p.x);
  const spread = Math.max(...hrs) - Math.min(...hrs);
  const thr = hrZoneBpm(0.88, 0.90, effMax, restHR);
  if (!thr) return null;
  const thrPace = fit.a + fit.b * thr.lo;
  if (thrPace <= 0) return null;
  return {km: 3600 / thrPace, durationSec: 3600, r2: fit.r2, slope: fit.b, n: pts.length, spread, thrHR: thr.lo, thrPace};
};
