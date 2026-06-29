import { useState } from "react";
import { TrendingUp } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, CartesianGrid, ReferenceLine } from "recharts";
import { VERT_COST } from "../constants";
import { fmt, ymd } from "../utils/format";
import { riegel, bestEffortAnchor, hrModelAnchor } from "../utils/predictions";
import { PredictionsInfo } from "../components/PredictionsInfo";
import { HRZonesCard } from "../components/HRZonesCard";

export function StatsView({runs, settings}) {
  return (
    <div className="max-w-lg mx-auto">
      <div className="px-4 pt-6 pb-0">
        <h2 className="text-xl font-bold">Stats</h2>
      </div>
      <Overview runs={runs} settings={settings}/>
      <RacePredictions runs={runs} settings={settings}/>
      <HRZonesCard runs={runs} settings={settings}/>
    </div>
  );
}

function Overview({runs, settings}) {
  const [period, setPeriod] = useState("12w");
  // The user's goal pace, drawn on the pace trend so the reference line tracks
  // their actual target rather than a hardcoded 6:00.
  const goalPace = settings && settings.goalSec && settings.distanceKm
    ? settings.goalSec / settings.distanceKm : 0;

  const fRuns = period === "all" ? runs : (() => {
    const cut = new Date();
    cut.setDate(cut.getDate() - (period === "4w" ? 28 : 84));
    return runs.filter(r => new Date(r.date + "T00:00:00") >= cut);
  })();

  const wkBars = (() => {
    const m = {};
    fRuns.forEach(r => {
      const d   = new Date(r.date + "T00:00:00");
      const mon = new Date(d);
      mon.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      const k = ymd(mon);
      m[k] = (m[k] || 0) + (r.km || 0);
    });
    return Object.entries(m)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(e => ({d: fmt.sht(e[0]), km: Math.round(e[1] * 10) / 10}));
  })();

  // Weekly elevation gain, bucketed the same way as weekly distance so the two
  // charts share a timeline. Weeks with runs but no elevation contribute 0.
  const wkElevBars = (() => {
    const m = {};
    fRuns.forEach(r => {
      const d   = new Date(r.date + "T00:00:00");
      const mon = new Date(d);
      mon.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      const k = ymd(mon);
      m[k] = (m[k] || 0) + (r.elevation || 0);
    });
    return Object.entries(m)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(e => ({d: fmt.sht(e[0]), elev: Math.round(e[1])}));
  })();

  const pLine = fRuns.slice()
    .filter(r => r.km && r.durationSec)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(r => ({d: fmt.sht(r.date), p: Math.round(r.durationSec / r.km)}));

  const totKm   = fRuns.reduce((s, r) => s + (r.km || 0), 0);
  const pRuns   = fRuns.filter(r => r.km && r.durationSec);
  const avgPace = pRuns.length ? pRuns.reduce((s, r) => s + r.durationSec / r.km, 0) / pRuns.length : 0;
  const bestPace = pRuns.filter(r => r.km >= 3).reduce((b, r) => {
    const p = r.durationSec / r.km;
    return (!b || p < b) ? p : b;
  }, null);
  const hrRuns = fRuns.filter(r => r.hr);
  const avgHR  = hrRuns.length ? hrRuns.reduce((s, r) => s + r.hr, 0) / hrRuns.length : 0;
  const totElev = fRuns.reduce((s, r) => s + (r.elevation || 0), 0);
  const totTime = fRuns.reduce((s, r) => s + (r.durationSec || 0), 0);

  const stats = [
    {l:"Total distance", v:totKm.toFixed(1) + " km",    s:fRuns.length + " runs", c:"text-orange-400"},
    {l:"Total time",     v:(totTime/3600).toFixed(1) + " h", s:"moving time",     c:"text-violet-400"},
    {l:"Average pace",   v:fmt.pace(avgPace),             s:"min/km",               c:"text-sky-400"},
    totElev > 0 && {l:"Total elevation", v:Math.round(totElev).toLocaleString() + " m", s:"climbed", c:"text-emerald-400"},
    bestPace && {l:"Best pace",     v:fmt.pace(bestPace), s:"runs ≥3km",            c:"text-amber-400"},
    avgHR > 0 && {l:"Avg heart rate", v:Math.round(avgHR) + "", s:"bpm",           c:"text-red-400"},
  ].filter(Boolean);

  const tt = {background:"#1e293b", border:"none", borderRadius:8, color:"#fff", fontSize:12};

  if (!runs.length) return (
    <div className="flex flex-col items-center justify-center pt-20 text-center gap-3 p-4">
      <TrendingUp size={48} className="text-slate-700"/>
      <p className="text-slate-400">Record some runs to see your stats!</p>
    </div>
  );

  return (
    <div className="p-4 space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-slate-400 text-xs">Totals for the selected window</p>
        <div className="flex bg-slate-800 rounded-xl p-1 gap-0.5">
          {[["4w","4w"],["12w","12w"],["all","All"]].map(pair => (
            <button key={pair[0]} onClick={() => setPeriod(pair[0])}
              className={"text-xs px-3 py-1.5 rounded-lg transition-colors " + (period === pair[0] ? "bg-orange-500 text-white" : "text-slate-400 hover:text-white")}>
              {pair[1]}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {stats.map(s => (
          <div key={s.l} className="bg-slate-800 rounded-xl p-4">
            <p className="text-slate-400 text-xs">{s.l}</p>
            <p className={"text-2xl font-bold mt-1 " + s.c}>{s.v}</p>
            <p className="text-slate-400 text-xs">{s.s}</p>
          </div>
        ))}
      </div>
      {wkBars.length > 1 && (
        <div className="bg-slate-800 rounded-2xl p-4">
          <p className="text-slate-400 text-sm font-medium mb-3">Weekly distance (km)</p>
          <ResponsiveContainer width="100%" height={150}>
            <BarChart data={wkBars} margin={{top:0,right:4,left:-18,bottom:0}}>
              <CartesianGrid strokeDasharray="3 3" stroke="#0f172a"/>
              <XAxis dataKey="d" tick={{fill:"#475569",fontSize:10}}/>
              <YAxis tick={{fill:"#475569",fontSize:10}}/>
              <Tooltip contentStyle={tt} formatter={v => [v + " km", "Distance"]}/>
              <Bar dataKey="km" fill="#f97316" radius={[4,4,0,0]}/>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      {totElev > 0 && wkElevBars.length > 1 && (
        <div className="bg-slate-800 rounded-2xl p-4">
          <p className="text-slate-400 text-sm font-medium mb-3">Weekly elevation gain (m)</p>
          <ResponsiveContainer width="100%" height={150}>
            <BarChart data={wkElevBars} margin={{top:0,right:4,left:-18,bottom:0}}>
              <CartesianGrid strokeDasharray="3 3" stroke="#0f172a"/>
              <XAxis dataKey="d" tick={{fill:"#475569",fontSize:10}}/>
              <YAxis tick={{fill:"#475569",fontSize:10}}/>
              <Tooltip contentStyle={tt} formatter={v => [v + " m", "Elevation"]}/>
              <Bar dataKey="elev" fill="#10b981" radius={[4,4,0,0]}/>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      {pLine.length > 2 && (
        <div className="bg-slate-800 rounded-2xl p-4">
          <div className="flex justify-between items-baseline mb-3">
            <p className="text-slate-400 text-sm font-medium">Pace trend</p>
            <p className="text-slate-400 text-xs">down = faster</p>
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={pLine} margin={{top:4,right:4,left:-18,bottom:0}}>
              <CartesianGrid strokeDasharray="3 3" stroke="#0f172a"/>
              <XAxis dataKey="d" tick={{fill:"#475569",fontSize:10}}/>
              <YAxis tick={{fill:"#475569",fontSize:10}} domain={["dataMin - 30","dataMax + 30"]}
                tickFormatter={v => fmt.pace(v)}/>
              <Tooltip contentStyle={tt} formatter={v => [fmt.pace(v) + "/km", "Pace"]}/>
              {goalPace > 0 && (
                <ReferenceLine y={Math.round(goalPace)} stroke="#f97316" strokeDasharray="5 3"
                  label={{value: fmt.pace(goalPace) + " goal", fill:"#f97316", fontSize:10, position:"right"}}/>
              )}
              <Line type="monotone" dataKey="p" stroke="#38bdf8" strokeWidth={2.5}
                dot={{r:3.5, fill:"#38bdf8", strokeWidth:0}}/>
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// Project finish times from logged runs.
function RacePredictions({runs, settings}) {
  const [period, setPeriod] = useState("12w");

  // Same period filter the Overview uses, so both halves of Stats agree.
  const fRuns = period === "all" ? runs : (() => {
    const cut = new Date();
    cut.setDate(cut.getDate() - (period === "4w" ? 28 : 84));
    return runs.filter(r => new Date(r.date + "T00:00:00") >= cut);
  })();

  // Effective max HR: explicit setting → Tanaka from age → highest HR observed.
  const effMax = settings.maxHR
    || (settings.age ? Math.round(208 - 0.7 * settings.age) : 0)
    || fRuns.reduce((m, r) => Math.max(m, r.hrMax || r.hr || 0), 0);
  const restHR = settings.restHR || 60;

  const best = bestEffortAnchor(fRuns);
  const hr   = hrModelAnchor(fRuns, effMax, restHR);
  // Only trust the HR model with a real spread of efforts and a sane fit.
  const hrOk = hr && hr.n >= 8 && hr.spread >= 15 && hr.slope < 0 && hr.r2 >= 0.3;

  // 5 / 10 / 20 km, plus the race-day distance when it isn't already one of them.
  const dists = [5, 10, 20];
  const raceD = settings.distanceKm;
  if (raceD && !dists.includes(raceD)) dists.push(raceD);
  dists.sort((a, b) => a - b);

  // Climb on the race-day course. Applied only to the race-day row — the other
  // distances stay flat hypotheticals — by projecting to the flat-equivalent
  // distance, the same grade-adjustment used on the input runs.
  const raceGain = settings.raceElevation || 0;

  if (!runs.length) return null;

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-bold">Race predictions</h3>
            <PredictionsInfo/>
          </div>
          <p className="text-slate-400 text-xs mt-0.5">Projected from your strongest run in the selected window</p>
        </div>
        <div className="flex bg-slate-800 rounded-xl p-1 gap-0.5">
          {[["4w","4w"],["12w","12w"],["all","All"]].map(pair => (
            <button key={pair[0]} onClick={() => setPeriod(pair[0])}
              className={"text-xs px-3 py-1.5 rounded-lg transition-colors " + (period === pair[0] ? "bg-orange-500 text-white" : "text-slate-400 hover:text-white")}>
              {pair[1]}
            </button>
          ))}
        </div>
      </div>

      {!best ? (
        <div className="bg-slate-800 rounded-xl p-4 text-center">
          <p className="text-slate-400 text-sm">Log a run of 3 km or more to estimate your race times.</p>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {dists.map(d => {
              // Race-day row carries its course climb; others are flat.
              const isRace = d === raceD;
              const dEq = isRace ? d + VERT_COST * raceGain / 1000 : d;
              const bt = riegel(best.durationSec, best.km, dEq);
              const ht = hrOk ? riegel(hr.durationSec, hr.km, dEq) : null;
              return (
                <div key={d} className="bg-slate-800 rounded-xl p-4">
                  <div className="flex items-baseline justify-between mb-3">
                    <p className="font-semibold">
                      {d} km
                      {isRace && <span className="ml-2 text-xs text-orange-400 font-normal">race day</span>}
                      {isRace && raceGain > 0 && <span className="ml-2 text-xs text-slate-500 font-normal">incl. {Math.round(raceGain)} m climb</span>}
                    </p>
                  </div>
                  <div className={"grid gap-3 " + (ht ? "grid-cols-2" : "grid-cols-1")}>
                    <div>
                      <p className="text-slate-400 text-xs">Best-effort estimate</p>
                      <p className="text-2xl font-bold mt-0.5 text-orange-400">{fmt.dur(bt)}</p>
                      <p className="text-slate-400 text-xs">{fmt.pace(bt / d)}/km</p>
                    </div>
                    {ht && (
                      <div>
                        <p className="text-slate-400 text-xs">HR-modelled estimate</p>
                        <p className="text-2xl font-bold mt-0.5 text-sky-400">{fmt.dur(ht)}</p>
                        <p className="text-slate-400 text-xs">{fmt.pace(ht / d)}/km</p>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="bg-slate-800/50 rounded-xl p-4 space-y-2">
            <p className="text-slate-400 text-xs">
              <span className="text-orange-400 font-semibold">Best-effort</span> projects your strongest run
              {" (" + best.raw.km + " km in " + fmt.dur(best.durationSec)
                + (best.raw.elevation > 0 ? ", " + Math.round(best.raw.elevation) + " m climb" : "") + ")"}
              {" "}to each distance with Riegel's formula.
            </p>
            {hrOk ? (
              <p className="text-slate-400 text-xs">
                <span className="text-sky-400 font-semibold">HR-modelled</span> fits your pace against heart rate across
                {" " + hr.n + " runs"} and extrapolates to threshold effort (~{hr.thrHR} bpm) — so easy runs handled
                well count too, not just your fastest day.
              </p>
            ) : (
              <p className="text-slate-500 text-xs">
                Add your max HR in Settings and log more runs across easy + hard efforts to unlock the HR-based estimate.
              </p>
            )}
            <p className="text-slate-400 text-xs">
              Runs are grade-adjusted for elevation gain. Times are for a flat course
              {raceGain > 0 ? "; the race-day row includes its " + Math.round(raceGain) + " m climb." : ", except the race-day row once you set its climb in the Plan settings."}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
