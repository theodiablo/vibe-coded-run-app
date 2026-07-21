// Per-kilometre splits for RunDetailModal's split table. Derived from the same
// non-gap-bridging cumulative-distance walk as buildRunSeries, so the table and
// the chart agree on where each km lands. Pure and unit-tested.
//
// A point is [lat, lng, tEpochMs, alt|null]; `null` is a GAP marker. Distance is
// accumulated without bridging gaps (matching the chart x-axis). Time at each
// exact km mark is linearly interpolated along the track, so a split's duration
// isn't quantised to whole GPS fixes.

import { elevGainM, haversineM } from "./geo";
import type { TrackPointOrGap } from "./geo";
import type { HrSample } from "./runSeries";

export type Split = {
  km: number;                  // 1-based split number
  distKm: number;              // length of this split (1.0, or the partial remainder)
  durationSec: number;
  paceSecPerKm: number;
  elevGainM: number;
  avgHr: number | null;
  fastest: boolean;            // among FULL kms only
  slowest: boolean;
};

export type SplitOpts = { jitterM?: number };

type RealPoint = { cumKm: number; t: number; alt: number | null };

// Linear-interpolated time (epoch ms) at a given cumulative-km mark along `pts`.
function timeAtKm(pts: RealPoint[], km: number): number {
  if (!pts.length) return 0;
  if (km <= pts[0].cumKm) return pts[0].t;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].cumKm >= km) {
      const a = pts[i - 1], b = pts[i];
      const span = b.cumKm - a.cumKm;
      if (span <= 0) return b.t; // frozen distance across a gap/jitter — take the later time
      return a.t + ((km - a.cumKm) / span) * (b.t - a.t);
    }
  }
  return pts[pts.length - 1].t;
}

export function buildSplits(
  points: TrackPointOrGap[],
  hrSamples?: HrSample[] | null,
  opts?: SplitOpts,
): Split[] {
  const jitterM = opts?.jitterM ?? 3;
  const hr = hrSamples && hrSamples.length ? hrSamples : null;

  // Flatten to real points with cumulative (non-bridged) distance.
  const pts: RealPoint[] = [];
  let cumM = 0;
  let prev: TrackPointOrGap = null;
  for (const p of points) {
    if (!p) { prev = null; continue; } // gap: don't add distance, don't break the km run
    if (prev) {
      const d = haversineM(prev, p);
      if (d >= jitterM) cumM += d;
    }
    pts.push({ cumKm: cumM / 1000, t: Number(p[2]), alt: p[3] == null ? null : Number(p[3]) });
    prev = p;
  }
  const totalKm = cumM / 1000;
  if (pts.length < 2 || totalKm <= 0) return [];

  const avgHrBetween = (t0: number, t1: number): number | null => {
    if (!hr) return null;
    let sum = 0, n = 0;
    for (const s of hr) { if (s.t >= t0 && s.t <= t1) { sum += s.bpm; n++; } }
    return n ? Math.round(sum / n) : null;
  };

  const splits: Split[] = [];
  const nFull = Math.floor(totalKm);
  for (let k = 0; k < nFull || (k === nFull && totalKm - nFull > 0.001); k++) {
    const startKm = k;
    const endKm = Math.min(k + 1, totalKm);
    const tStart = timeAtKm(pts, startKm);
    const tEnd = timeAtKm(pts, endKm);
    const durationSec = (tEnd - tStart) / 1000;
    const distKm = endKm - startKm;
    const alts = pts.filter(pt => pt.cumKm >= startKm && pt.cumKm <= endKm).map(pt => ({ lat: 0, lng: 0, alt: pt.alt }));
    splits.push({
      km: k + 1,
      distKm,
      durationSec,
      paceSecPerKm: distKm > 0 ? durationSec / distKm : 0,
      elevGainM: Math.round(elevGainM(alts)),
      avgHr: avgHrBetween(tStart, tEnd),
      fastest: false,
      slowest: false,
    });
  }

  // Fastest / slowest among FULL kms only (a partial tail is never the winner).
  const full = splits.filter(s => s.distKm >= 0.999);
  if (full.length >= 2) {
    let fast = full[0], slow = full[0];
    for (const s of full) {
      if (s.paceSecPerKm < fast.paceSecPerKm) fast = s;
      if (s.paceSecPerKm > slow.paceSecPerKm) slow = s;
    }
    fast.fastest = true;
    slow.slowest = true;
  }
  return splits;
}
