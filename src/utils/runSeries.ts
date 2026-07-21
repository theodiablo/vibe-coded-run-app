// Per-run analytics series: turn a stored GPS trace (+ optional raw HR stream)
// into recharts-ready rows for RunDetailModal's combined chart. Pure and
// unit-tested — no React/SDK imports.
//
// A point is the stored tuple [lat, lng, tEpochMs, altMeters|null]; a `null`
// entry is a GAP marker (lost GPS). We emit one row per REAL point and use gaps
// only to break continuity (pace never bridges a gap; the x-axis never invents a
// straight jump across one). HR is aligned to each point by timestamp at render
// (nearest raw sample within a small window) so HR fidelity is decoupled from how
// aggressively simplify() thinned the track.

import { flattenTrack } from "./geo";
import type { TrackPointOrGap } from "./geo";

export type HrSample = { bpm: number; t: number };

export type RunSeriesRow = {
  distKm: number;               // cumulative distance from the start
  tSec: number;                 // seconds since the first fix (optional time x-axis)
  elevM: number | null;         // point altitude (null when the phone reported none)
  paceSecPerKm: number | null;  // smoothed, gap-aware; null across gaps / too-short window
  hr: number | null;            // nearest raw HR sample; null when absent/out of window
};

export type RunSeriesOpts = {
  paceWindowM?: number;   // rolling DISTANCE look-back (m) for pace smoothing
  jitterM?: number;       // legs shorter than this are treated as GPS jitter
  hrWindowMs?: number;    // max |Δt| between a point and the HR sample matched to it
};

// Nearest sample bpm to time `t` within ±windowMs, or null. `samples` is assumed
// sorted ascending by `t` (they're appended in order live); binary-searches the
// insertion point and compares the two neighbours.
function nearestBpm(samples: HrSample[], t: number, windowMs: number): number | null {
  let lo = 0, hi = samples.length - 1, best: HrSample | null = null, bestD = Infinity;
  // Binary search for the first sample with t >= target.
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].t < t) lo = mid + 1;
    else hi = mid - 1;
  }
  // Candidates: samples[lo] (first >= t) and samples[lo-1] (last < t).
  for (const i of [lo - 1, lo]) {
    if (i < 0 || i >= samples.length) continue;
    const d = Math.abs(samples[i].t - t);
    if (d < bestD) { bestD = d; best = samples[i]; }
  }
  return best && bestD <= windowMs ? best.bpm : null;
}

export function buildRunSeries(
  points: TrackPointOrGap[],
  hrSamples?: HrSample[] | null,
  opts?: RunSeriesOpts,
): RunSeriesRow[] {
  const paceWindowM = opts?.paceWindowM ?? 200;
  const jitterM = opts?.jitterM ?? 3;
  const hrWindowMs = opts?.hrWindowMs ?? 4000;
  const hr = hrSamples && hrSamples.length ? hrSamples : null;

  const flat = flattenTrack(points, jitterM);
  if (!flat.length) return [];
  const t0 = flat[0].t;

  const rows: RunSeriesRow[] = [];
  let segStartIdx = 0;
  for (let i = 0; i < flat.length; i++) {
    const f = flat[i];
    if (f.segStart) segStartIdx = i;

    // Smoothed pace over a rolling DISTANCE window (not a fixed time window):
    // stored points are Douglas-Peucker-thinned, so they're sparse and uneven in
    // time — a short time window finds no earlier point on straight, sparsely
    // sampled stretches and would leave pace null there (an intermittent line).
    // Look back over ~paceWindowM metres within the segment, but always include at
    // least the previous point so every point past a segment's start gets a pace.
    let pace: number | null = null;
    if (i > segStartIdx) {
      let w = i - 1;
      while (w > segStartIdx && (f.cumKm - flat[w - 1].cumKm) * 1000 <= paceWindowM) w--;
      const dt = (f.t - flat[w].t) / 1000;
      const dkm = f.cumKm - flat[w].cumKm;
      if (dt > 0 && dkm > 0) pace = dt / dkm;
    }

    rows.push({
      distKm: f.cumKm,
      tSec: (f.t - t0) / 1000,
      elevM: f.alt,
      paceSecPerKm: pace,
      hr: hr ? nearestBpm(hr, f.t, hrWindowMs) : null,
    });
  }
  return rows;
}
