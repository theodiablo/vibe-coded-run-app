// Training-plan methodology styles: app-side catalogue and helpers.
//
// The PACE multipliers live with the edge function in
// supabase/functions/_shared/coach/styles.mjs (single source of truth shared
// with the coach agent, same dual-import pattern as coachValidation.ts) and
// are re-exported here. Everything else — plan-shape parameters, the style
// picker metadata, the profile-based recommendation — is app-only, because the
// coach never rebuilds weeks.
// @ts-expect-error Shared Deno/Vitest ESM has no TypeScript declaration file.
import * as sharedStyles from "../../supabase/functions/_shared/coach/styles.mjs";
import { ymd } from "./format";
import type { PlanSessionInput } from "./plan";

export type StyleId = "balanced" | "polarized" | "runwalk" | "lowfreq" | "hansons";
export type StylePacing = { easy: number; tempo: number; intervals: number; long: number; walk: number | null };

type StylesExports = {
  DEFAULT_STYLE: StyleId;
  STYLE_PACING: Record<StyleId, StylePacing>;
  stylePacing: (style: unknown) => StylePacing;
  styleNotes: (style: unknown) => string;
};
const styles = sharedStyles as StylesExports;

export const { DEFAULT_STYLE, STYLE_PACING, stylePacing, styleNotes } = styles;

// The APP-side list of usable styles, deliberately NOT re-exported from
// styles.mjs: buildPlan and StylePicker index STYLE_SHAPE / STYLE_META /
// COMPOSERS, which are all Record<StyleId, …> — complete by type. Keying off
// the shared list instead would let a style added server-side first pass
// isStyleId and then crash the app-side lookups; this way such a style simply
// isn't offered/built until the app maps ship, and unknown ids keep degrading
// to balanced everywhere.
export const STYLE_IDS: StyleId[] = ["balanced", "polarized", "runwalk", "lowfreq", "hansons"];

export const isStyleId = (v: unknown): v is StyleId =>
  typeof v === "string" && (STYLE_IDS as string[]).includes(v);

// Picker metadata — label + one-line blurb per style, in display order.
export const STYLE_META: Record<StyleId, { label: string; blurb: string }> = {
  balanced: {
    label: "Balanced",
    blurb: "Classic build: a weekly long run plus alternating tempo and interval days.",
  },
  polarized: {
    label: "Polarized 80/20",
    blurb: "Mostly genuinely easy running with one hard session a week — great if you tend to run everything moderately hard.",
  },
  runwalk: {
    label: "Run/Walk",
    blurb: "Gentle run/walk intervals and no speedwork — finish feeling strong. Ideal when starting out or returning.",
  },
  lowfreq: {
    label: "3-Day Quality",
    blurb: "Three purposeful runs a week — intervals, tempo, long — other days optional cross-training. Best with exactly 3 run days.",
  },
  hansons: {
    label: "Hansons-style",
    blurb: "Higher frequency, a capped moderate long run and tempo at goal race pace. Best at 5–6 days for half/marathon.",
  },
};

// ── Plan-shape parameters ────────────────────────────────────────────────────
// peakLong receives the race distance and an estimate of the configured weekly
// volume (km at the style's easy pace) so a style can cap the long run as a
// share of weekly volume (Hansons) instead of race distance alone.
export type StyleShape = {
  peakLong: (dist: number, estWeeklyKm: number) => number;
  taperMults: [number, number, number];
  floorKm: number; // minimum starting long run when there's no recent-run floor
  cutbackEvery3: boolean; // Galloway-style down-week every 3rd week of the ramp
};

// The pre-styles formula: ~0.9× for short/half, ~0.78× marathon (capped 32),
// 36 km hard ceiling for ultras. Kept verbatim — balanced must not change.
const balancedPeak = (dist: number) =>
  Math.min(36, dist <= 25 ? dist * 0.9 : dist <= 43 ? Math.min(32, dist * 0.78) : 34);

const CLASSIC_TAPER: [number, number, number] = [0.85, 0.65, 0.45];

export const STYLE_SHAPE: Record<StyleId, StyleShape> = {
  balanced: { peakLong: balancedPeak, taperMults: CLASSIC_TAPER, floorKm: 4.5, cutbackEvery3: false },
  polarized: { peakLong: balancedPeak, taperMults: CLASSIC_TAPER, floorKm: 4.5, cutbackEvery3: false },
  runwalk: {
    // Finish-focused: shorter peak (never above 26 km even for a marathon+).
    peakLong: (dist) => (dist <= 25 ? dist * 0.75 : Math.min(26, dist * 0.62)),
    taperMults: [0.8, 0.6, 0.4],
    floorKm: 3,
    cutbackEvery3: true,
  },
  lowfreq: { peakLong: balancedPeak, taperMults: CLASSIC_TAPER, floorKm: 4.5, cutbackEvery3: false },
  hansons: {
    // Capped long run: ≤26 km, never above the classic peak, ~28% of the
    // configured weekly volume. The floor is itself volume-bounded (≤40% of
    // weekly km, up to 12) — a bare 12 km floor would hand a 2-short-days
    // config a long run that IS the whole week, the opposite of the style.
    peakLong: (dist, estWeeklyKm) =>
      Math.min(26, balancedPeak(dist),
        Math.max(0.28 * estWeeklyKm, Math.min(12, 0.4 * estWeeklyKm))),
    taperMults: CLASSIC_TAPER,
    floorKm: 4.5,
    cutbackEvery3: false,
  },
};

// ── Hard-day placement ──────────────────────────────────────────────────────
// Pick up to `count` quality days for hard sessions, keeping every hard day
// (the long run included) at least 2 calendar days from the others so the
// validator's no-hard-back-to-back rule holds by construction — including
// across the week wrap (Sun long → Mon quality), hence circular distance.
// Greedy: repeatedly take the candidate with the largest minimum circular gap
// to the hard days chosen so far. May return fewer than `count` when the
// configured days are too dense; the leftover days simply stay easy.
const circGap = (a: number, b: number) => {
  const d = Math.abs(a - b) % 7;
  return Math.min(d, 7 - d);
};

export function pickHardDays(qualityDays: number[], longDay: number, count: number): number[] {
  const picked: number[] = [];
  const pool = qualityDays.slice();
  while (picked.length < count && pool.length) {
    let bestIdx = -1;
    let bestGap = -1;
    pool.forEach((day, i) => {
      const gap = Math.min(...[longDay, ...picked].map((h) => circGap(day, h)));
      if (gap > bestGap) {
        bestGap = gap;
        bestIdx = i;
      }
    });
    if (bestGap < 2) break; // nothing left that can sit clear of the hard days
    picked.push(pool.splice(bestIdx, 1)[0]);
  }
  return picked;
}

// ── Profile-based recommendation ────────────────────────────────────────────
// Pure: derives a suggested style from what the app already knows. Mirrors
// buildPlan's 35-day recent window. First match wins; `balanced` is the
// fallback, so brand-new users (no data at all) get the current behaviour.
type RecentRunLike = { date?: string; km?: number };

export function recommendStyle(input: {
  intent?: string | null;
  planSessions?: PlanSessionInput[];
  distanceKm?: number | string;
  recentRuns?: RecentRunLike[];
  today?: Date; // injectable for deterministic tests
}): StyleId {
  const today = input.today ?? new Date();
  const cutoff = ymd(new Date(today.getTime() - 35 * 86400000));
  const recent = (input.recentRuns || []).filter(
    (r) => r && r.date && r.date >= cutoff && (r.km ?? 0) > 0,
  );
  const runCount = recent.length;
  // Weekly volume over the weeks that actually have data — a fixed /5 would
  // halve the real load of a runner with only 2 weeks of history and steer
  // them to a gentler style than they train for.
  const earliest = recent.reduce((m, r) => (r.date && r.date < m ? r.date : m), ymd(today));
  const spanWeeks = Math.min(5, Math.max(1,
    (today.getTime() - new Date(earliest + "T00:00:00").getTime()) / (7 * 86400000)));
  const weeklyKm = recent.reduce((s, r) => s + (r.km ?? 0), 0) / spanWeeks;
  const days = input.planSessions?.length ?? 0;
  const dist = Number(input.distanceKm) || 0;

  // True beginner (or long break): little recent running, and either a fitness
  // goal or a short race. Never auto-recommended for a long race — run/walk is
  // legitimate for a marathon (Galloway) but that's an explicit choice.
  if (runCount < 4 && weeklyKm < 10 && (input.intent === "fitness" || (dist > 0 && dist <= 10.5)))
    return "runwalk";
  // Time-crunched but trained: exactly 3 days with real volume behind them.
  if (days === 3 && weeklyKm >= 20) return "lowfreq";
  // High frequency + long race + real volume.
  if (days >= 5 && dist >= 21 && weeklyKm >= 35) return "hansons";
  // Decent frequency and volume: polarized is the best-evidenced default.
  if (days >= 4 && weeklyKm >= 25) return "polarized";
  return "balanced";
}
