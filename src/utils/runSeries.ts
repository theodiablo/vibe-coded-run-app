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

import { haversineM } from "./geo";
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
  paceWindowSec?: number; // rolling look-back for pace smoothing
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
  const paceWindowMs = (opts?.paceWindowSec ?? 20) * 1000;
  const jitterM = opts?.jitterM ?? 3;
  const hrWindowMs = opts?.hrWindowMs ?? 4000;
  const hr = hrSamples && hrSamples.length ? hrSamples : null;

  const rows: RunSeriesRow[] = [];
  let cumM = 0;
  let t0: number | null = null;
  let prev: TrackPointOrGap = null;                 // previous real point (null at a gap)
  // Real points of the CURRENT gap-free segment, with their cumulative distance,
  // so windowed pace can look back without crossing a gap.
  let seg: { t: number; cumM: number }[] = [];

  for (const p of points) {
    if (!p) { prev = null; seg = []; continue; } // gap: break pace, don't add distance
    const t = Number(p[2]);
    if (t0 == null) t0 = t;
    if (prev) {
      const d = haversineM(prev, p);
      if (d >= jitterM) cumM += d;
    }
    seg.push({ t, cumM });

    // Smoothed pace: earliest same-segment sample still inside the time window.
    let pace: number | null = null;
    let j = seg.length - 1;
    while (j > 0 && t - seg[j - 1].t <= paceWindowMs) j--;
    if (j < seg.length - 1) {
      const dt = (t - seg[j].t) / 1000;
      const dkm = (cumM - seg[j].cumM) / 1000;
      if (dt > 0 && dkm > 0) pace = dt / dkm;
    }

    rows.push({
      distKm: cumM / 1000,
      tSec: (t - (t0 as number)) / 1000,
      elevM: p[3] == null ? null : Number(p[3]),
      paceSecPerKm: pace,
      hr: hr ? nearestBpm(hr, t, hrWindowMs) : null,
    });
    prev = p;
  }
  return rows;
}
