// Training-plan builder.
import { VERT_COST } from "../constants";
import { fmt, ymd } from "./format";

export function buildPlan(raceDate, goalSec, planSessions, distanceKm, raceElevation) {
  if (!goalSec) goalSec = 7200;
  if (!distanceKm) distanceKm = 20;
  if (!planSessions) planSessions = [{dayOffset:2,minutes:30},{dayOffset:6,minutes:60}];
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

    const maxLong = longSess.minutes * 60 / easy;
    let longKm;
    if (isTaper) {
      const taperIdx = w - (N - 3);
      const taperMults = [0.85, 0.65, 0.45];
      longKm = maxLong * (taperMults[taperIdx] !== undefined ? taperMults[taperIdx] : 0.45);
    } else if (isPeak) {
      longKm = Math.min(maxLong * 0.95, 9 + (w - (N - 7)) * 0.4);
    } else if (isBase) {
      longKm = Math.min(maxLong * 0.75, 4.5 + w * 0.5);
    } else {
      longKm = Math.min(maxLong * 0.9, 6.5 + (w - 4) * 0.3);
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
    }],
  });
  return {raceDate, goalSec, distanceKm, raceElevation: gain, targetPace: tgt, planSessions, weeks};
}
