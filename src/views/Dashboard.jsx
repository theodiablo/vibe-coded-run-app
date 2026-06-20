import { Activity, Award, Check, ChevronRight, Plus, Zap } from "lucide-react";
import { TBG, TCLR } from "../constants";
import { fmt, ymd, estMin, cleanDesc } from "../utils/format";
import { HRTarget } from "../components/HRTarget";
import { RunRow } from "../components/RunRow";

export function Dashboard({runs, plan, settings, goTab, goLog, toggleSess, openSettings}) {
  const today    = new Date(); today.setHours(0,0,0,0);
  const raceD    = new Date(settings.raceDate + "T00:00:00");
  const daysLeft = Math.max(0, Math.ceil((raceD - today) / 86400000));
  // Carry the week number alongside each session so the card's Record / Mark
  // done actions can target the right session via goLog / toggleSess.
  const nextSess = plan
    ? plan.weeks.flatMap(w => w.sessions.map(s => ({...s, wNum: w.weekNumber})))
        .filter(s => !s.done && new Date(s.date + "T00:00:00") >= today)
        .sort((a, b) => a.date.localeCompare(b.date))[0]
    : null;
  const nextIsToday = nextSess && nextSess.date === ymd(today);
  const wkMon = new Date(today); wkMon.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const wkKm  = runs.filter(r => new Date(r.date + "T00:00:00") >= wkMon).reduce((s, r) => s + (r.km||0), 0);
  const totKm = runs.reduce((s, r) => s + (r.km||0), 0);

  const statCards = [
    {l:"This week",  v:wkKm.toFixed(1)+" km",  c:"text-orange-400",  I:Zap},
    {l:"Runs recorded", v:String(runs.length),    c:"text-sky-400",     I:Activity},
    {l:"Total",       v:totKm.toFixed(0)+" km", c:"text-emerald-400", I:Award},
  ];

  return (
    <div className="p-4 space-y-5 max-w-lg mx-auto">
      <div className="pt-4">
        <p className="text-slate-400 text-sm">Good to see you,</p>
        <h1 className="text-2xl font-bold">{settings.name + " 🏃‍♂️"}</h1>
      </div>

      <div className="rounded-2xl p-5 border border-orange-500/30"
        style={{background:"linear-gradient(135deg,rgba(249,115,22,.13),rgba(220,38,38,.13))"}}>
        {settings.raceDate && settings.distanceKm ? (
        <div className="flex justify-between items-center">
          <div>
            <p className="text-orange-300 text-xs font-semibold uppercase tracking-widest mb-1">Race Day</p>
            <p className="font-semibold">{fmt.date(settings.raceDate)}</p>
            <p className="text-slate-400 text-sm mt-1">
              {settings.distanceKm + "km · target sub " + fmt.dur(settings.goalSec) + " · " + fmt.pace(Math.round(settings.goalSec/settings.distanceKm)) + "/km"}
            </p>
          </div>
          <div className="text-right">
            <p className="text-5xl font-black text-orange-400 leading-none">{daysLeft}</p>
            <p className="text-slate-400 text-xs mt-1">days to go</p>
          </div>
        </div>
        ) : (
          <button onClick={() => goTab("plan")} className="w-full text-left">
            <p className="text-orange-300 text-xs font-semibold uppercase tracking-widest mb-1">Race Day</p>
            <p className="font-semibold">Set up your race</p>
            <p className="text-slate-400 text-sm mt-1">Pick a date and distance to build your training plan →</p>
          </button>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        {statCards.map(card => (
          <div key={card.l} className="bg-slate-800 rounded-xl p-3">
            <card.I size={15} className={card.c}/>
            <p className={"text-xl font-bold mt-1 leading-tight " + card.c}>{card.v}</p>
            <p className="text-slate-400 text-xs">{card.l}</p>
          </div>
        ))}
      </div>

      {nextSess ? (
        <div>
          <p className="text-orange-300 text-xs font-bold uppercase tracking-widest mb-2">
            {nextIsToday ? "Today's session" : "Up next"}
          </p>
          <div className={"border-2 rounded-2xl p-4 " + (TBG[nextSess.type] || TBG.OTHER)}>
            <span className={"text-xs font-bold uppercase tracking-wide " + (TCLR[nextSess.type] || TCLR.OTHER)}>
              {nextSess.type}
            </span>
            <p className="text-white text-base font-medium mt-1 leading-snug">{cleanDesc(nextSess.desc)}</p>
            <p className="text-slate-400 text-xs mt-2">
              {fmt.sht(nextSess.date) + " · " + nextSess.km + " km · ~" + estMin(nextSess.km, nextSess.pace) + " · " + fmt.pace(nextSess.pace) + "/km"}
            </p>
            <HRTarget type={nextSess.type} settings={settings} openSettings={openSettings}/>
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => goLog({date: nextSess.date, type: nextSess.type, km: nextSess.km, pace: nextSess.pace, wNum: nextSess.wNum, sId: nextSess.id})}
                className="flex-1 flex items-center justify-center gap-1.5 bg-orange-500 hover:bg-orange-600 text-white py-2.5 rounded-xl text-sm font-semibold transition-colors">
                <Plus size={15}/>Record
              </button>
              <button
                onClick={() => toggleSess(nextSess.wNum, nextSess.id)}
                className="flex items-center justify-center gap-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors">
                <Check size={15}/>Mark done
              </button>
            </div>
          </div>
        </div>
      ) : !plan ? (
        <div className="bg-slate-800 rounded-xl p-5 text-center space-y-3">
          <p className="text-slate-400 text-sm">No training plan yet. Ready to get started?</p>
          <button
            onClick={() => goTab("plan")}
            className="bg-orange-500 hover:bg-orange-600 text-white px-6 py-2.5 rounded-xl font-semibold text-sm transition-colors">
            Set Up My Plan
          </button>
        </div>
      ) : (
        <div className="bg-slate-800 rounded-xl p-4 text-center text-slate-400 text-sm">All upcoming sessions done!</div>
      )}

      {runs.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-slate-500 text-xs uppercase tracking-widest">Recent runs</p>
            {runs.length > 3 && goTab && (
              <button onClick={() => goTab("history")}
                className="text-xs text-orange-400 hover:text-orange-300 flex items-center gap-0.5 transition-colors">
                View all<ChevronRight size={13}/>
              </button>
            )}
          </div>
          <div className="space-y-2">
            {runs.slice(0, 3).map(r => <RunRow key={r.id} run={r}/>)}
          </div>
        </div>
      )}

      {!runs.length && (
        <div className="bg-slate-800 rounded-xl p-6 text-center space-y-2">
          <Activity size={32} className="mx-auto text-slate-700"/>
          <p className="text-sm text-slate-400">No runs yet.</p>
          <p className="text-xs text-slate-400">Tap Record below to add your first one.</p>
          {!plan && (
            <p className="text-xs text-slate-400 pt-2 border-t border-slate-700/50">
              Had data from a previous version? Open Settings (gear, top right) → Restore.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
