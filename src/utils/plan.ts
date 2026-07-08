// Training-plan builder.
import { VERT_COST } from "../constants";
import { fmt, ymd } from "./format";

// `opts` is additive so the positional call sites keep working:
//   { recentRuns: Run[] }  — recent logged runs, used to seed a fitness-aware
//                            starting volume so the plan doesn't regress a fit
//                            athlete back to a 4.5 km "long" run.
// (Phase 2 adds `mainEditionId` / `races` for the secondary-race overlay.)
export function buildPlan(raceDate, goalSec, planSessions, distanceKm, raceElevation, opts = {}) {
  if (!goalSec) goalSec = 7200;
  if (!distanceKm) distanceKm = 20;
  if (!planSessions) planSessions = [{dayOffset:2,minutes:30},{dayOffset:6,minutes:60}];
  const recentRuns = opts.recentRuns || [];
  const today = new Date(); today.setHours(0,0,0,0);
  const race  = new Date(raceDate + "T00:00:00");
  const dow   = today.getDay();
  const toMon = dow === 1 ? 0 : dow === 0 ? 1 : (8 - dow) % 7;
  const w0    = new Date(today); w0.setDate(today.getDate() + toMon);
  const N     = Math.max(4, Math.min(24, Math.floor((race - w0) / 86400000 / 7)));
  // Training paces target the *flat-equivalent* effort: finishing a hilly course
  // in the goal time needs the flat fitness of a faster runner, so each metre of
  // climb stretches the effective distance (same VERT_COST grade-adjust as the
  // predictions). On a flat course this collapses to goalSec / distanceKm.
  const gain      = raceElevation || 0;
  const flatEqDist = distanceKm + VERT_COST * gain / 1000;
  const tgt       = Math.round(goalSec / flatEqDist);
  // Real average ground pace on the course — what the race-day card should show.
  const racePace = Math.round(goalSec / distanceKm);
  const easy  = Math.round(tgt * 1.25);
  const tmpo  = Math.round(tgt * 1.05);
  const sorted = planSessions.slice().sort((a, b) => b.minutes - a.minutes);
  const longSess = sorted[0];
  const qualSessions = sorted.slice(1);

  // Peak long-run distance is driven by the RACE distance, not the session time
  // budget — you can't train for 20 km on 60-min long runs. ~0.9x for short/half
  // races; the marathon is run a bit short in training; everything is hard-capped
  // so an ultra (UTMB 171 km) can't generate an absurd long run. The session
  // `minutes` no longer caps the long run (it still informs the shown duration and
  // the quality-session sizing) — see PlanView's long-run nudge.
  const peakLong = Math.min(36,
    distanceKm <= 25 ? distanceKm * 0.9
    : distanceKm <= 43 ? Math.min(32, distanceKm * 0.78)
    : 34);

  // Fitness-aware floor (a generation-time snapshot). The longest run in the last
  // ~5 weeks sets a starting long run so a fit athlete isn't sent back to square
  // one — but never above the race-scaled peak (don't inflate a 10 km block off
  // big long runs). Empty recentRuns → 0 floor → today's gentle default start.
  const RECENT_MS = 35 * 86400000;
  const cutoff = ymd(new Date(today.getTime() - RECENT_MS));
  const longestRecent = recentRuns.reduce(
    (m, r) => (r && r.date && r.date >= cutoff && r.km > 0 ? Math.max(m, r.km) : m), 0);
  const fitFloor = Math.min(longestRecent * 0.8, peakLong);
  // Long run ramps linearly from this start to the peak over the pre-taper weeks.
  const startLong = Math.max(4.5, fitFloor);
  const lastBuildW = N - 4; // 0-based index of the final pre-taper week (peak hits here)

  const weeks = [];

  for (let w = 0; w < N; w++) {
    const wS = new Date(w0); wS.setDate(w0.getDate() + w * 7);
    const isTaper = w >= N - 3;
    const isPeak  = w >= N - 7 && !isTaper;
    const isBase  = w < 4;
    const phase   = isTaper ? "TAPER" : isPeak ? "PEAK" : isBase ? "BASE" : "BUILD";
    const ss = [];

    const addS = (dOff, type, km, desc, pace) => {
      const d = new Date(wS); d.setDate(wS.getDate() + dOff);
      if (d >= race) return;
      ss.push({
        id: "w" + (w+1) + "d" + dOff,
        date: ymd(d),
        type, desc,
        km: Math.round(Math.max(1.5, km) * 10) / 10,
        pace, done: false, runId: null,
      });
    };

    let longKm;
    if (isTaper) {
      // Taper long runs scale off the peak — shed volume, keep some endurance.
      const taperIdx = w - (N - 3);
      const taperMults = [0.85, 0.65, 0.45];
      longKm = peakLong * (taperMults[taperIdx] !== undefined ? taperMults[taperIdx] : 0.45);
    } else {
      // Ramp from the fitness-aware start to the race-scaled peak across the
      // pre-taper weeks (peak reached at the last build/peak week).
      const ramp = lastBuildW > 0 ? Math.min(1, w / lastBuildW) : 1;
      longKm = startLong + (peakLong - startLong) * ramp;
    }
    addS(longSess.dayOffset, "LONG", longKm,
      "Long run — easy effort at " + fmt.pace(easy) + "/km", easy);

    qualSessions.forEach(q => {
      const maxQ = q.minutes * 60 / easy;
      let type, desc, pace, km;
      if (isBase || isTaper) {
        const easyKm = isBase ? 2.5 + w * 0.2 : Math.max(2, 4 - (w - (N - 3)) * 0.5);
        type = "EASY"; pace = easy;
        km   = Math.min(maxQ, easyKm);
        desc = "Easy run — relaxed aerobic effort";
      } else {
        const buildW = w - 4;
        if (buildW % 2 === 0) {
          type = "TEMPO"; pace = tmpo;
          km   = Math.min(maxQ * 0.85, q.minutes * 60 / tmpo * 0.8);
          desc = "Tempo run — " + fmt.pace(tmpo) + "/km, comfortably hard";
        } else {
          const reps = q.minutes <= 30 ? 3 : 5;
          type = "INTERVALS"; pace = tgt;
          km   = Math.min(maxQ * 0.85, reps * 0.8 + 1.5);
          desc = "Intervals — " + reps + "x800m at " + fmt.pace(tgt) + "/km + 90s recovery";
        }
      }
      addS(q.dayOffset, type, km, desc, pace);
    });

    ss.sort((a, b) => a.date.localeCompare(b.date));
    weeks.push({weekNumber: w+1, startDate: ymd(wS), phase, sessions: ss});
  }

  // ── Secondary-race overlay ────────────────────────────────────────────────
  // Drop any user-added races that fall inside the plan window onto their week as
  // RACE sessions. The plan still peaks/tapers for the *main* race — these are
  // extra checkpoints. Pace is a Riegel estimate off the main goal and never
  // feeds back into the prescribed training paces. Phase 3 adds taper/recovery
  // around them. `opts.races`: [{editionId, date, distanceKm, elevation}].
  const MIN_GAP_MS = 7 * 86400000; // keep a hard race out of the final taper days
  const seenDates = new Set();
  (opts.races || []).forEach(r => {
    if (!r || !r.date || !r.distanceKm) return;
    const d = new Date(r.date + "T00:00:00");
    if (d < w0 || d >= race) return;          // outside the plan window
    if (race - d < MIN_GAP_MS) return;        // too close to the main race
    if (seenDates.has(r.date)) return;        // one race per date
    const wi = Math.floor((d - w0) / (7 * 86400000));
    if (wi < 0 || wi >= weeks.length) return;
    seenDates.add(r.date);
    const secKm = r.distanceKm;
    // Riegel projection of the main goal to this distance (t2 = t1·(d2/d1)^1.06).
    const secPace = Math.round(goalSec * Math.pow(secKm / distanceKm, 1.06) / secKm);
    const session = {
      id: "race-" + (r.editionId || r.date), date: r.date, type: "RACE",
      desc: "Race — " + secKm + "km" + (r.elevation > 0 ? " · +" + Math.round(r.elevation) + "m" : ""),
      km: secKm, pace: secPace, done: false, runId: null, editionId: r.editionId || null,
    };
    const wk = weeks[wi];
    // Replace a same-day training session if one exists, else add an extra one.
    const same = wk.sessions.findIndex(s => s.date === r.date);
    if (same >= 0) wk.sessions[same] = session;
    else wk.sessions.push(session);
    // Automatic, distance-scaled treatment (the user picks nothing): a substantial
    // race (≥ half the main distance) gets a mini-taper — ease the rest of that
    // week to recovery so we don't stack hard quality around it. A small race
    // (e.g. a 5 km before a marathon) just drops in.
    if (secKm >= 0.5 * distanceKm) {
      wk.sessions = wk.sessions.map(s => s.type === "RACE" ? s : {
        ...s, type: "EASY", pace: easy,
        km: Math.round(Math.min(s.km, 6) * 10) / 10,
        desc: "Easy run — keep it light around your race",
      });
    }
    wk.sessions.sort((a, b) => a.date.localeCompare(b.date));
  });

  const rWS = new Date(w0); rWS.setDate(w0.getDate() + N * 7);
  weeks.push({
    weekNumber: N + 1,
    startDate: ymd(rWS),
    phase: "RACE",
    sessions: [{
      id: "race", date: raceDate, type: "RACE",
      desc: "Race Day — " + distanceKm + "km"
        + (gain > 0 ? " · +" + Math.round(gain) + "m climb" : "")
        + "! Everything you trained for.",
      km: distanceKm, pace: racePace, done: false, runId: null,
      // Stamp the main race so multi-race detection reads all RACE sessions
      // uniformly off the plan. Null for a hand-entered (non-catalogue) target,
      // which then stays un-detected, exactly as before.
      editionId: opts.mainEditionId ?? null,
    }],
  });
  return {raceDate, goalSec, distanceKm, raceElevation: gain, targetPace: tgt,
    longRunPeakKm: Math.round(peakLong * 10) / 10, planSessions, weeks};
}
