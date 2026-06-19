import { useState } from "react";
import { Check, ChevronRight, Plus, RotateCcw } from "lucide-react";
import { DAYS, TCLR } from "../constants";
import { fmt, estMin, cleanDesc } from "../utils/format";
import { SessionConfigurator } from "../components/SessionConfigurator";
import { GoalConfigurator } from "../components/GoalConfigurator";
import { HRTarget } from "../components/HRTarget";
import { PlanInfo } from "../components/PlanInfo";

export function PlanView({plan, settings, savePlan, saveSettings, buildPlan, toggleSess, openSettings, goLog}) {
  // Index of the week containing today — the one we auto-expand.
  const currentWeekIndex = () => {
    if (!plan) return null;
    const today = new Date(); today.setHours(0,0,0,0);
    const i = plan.weeks.findIndex(w => {
      const s = new Date(w.startDate + "T00:00:00");
      const e = new Date(s); e.setDate(s.getDate() + 7);
      return today >= s && today < e;
    });
    return i >= 0 ? i : 0;
  };

  const [exp,          setExp]         = useState(currentWeekIndex);
  const [editSessions, setEdit]        = useState(false);
  const [draft,        setDraft]       = useState(settings.planSessions || [{dayOffset:2,minutes:30},{dayOffset:6,minutes:60}]);
  const [draftDate,    setDraftDate]   = useState(settings.raceDate);
  const [draftGoal,    setDraftGoal]   = useState(settings.goalSec);
  const [draftDist,    setDraftDist]   = useState(settings.distanceKm || "");
  const [draftElev,    setDraftElev]   = useState(settings.raceElevation || 0);
  const [confirmRegen, setConfirmRegen] = useState(false);

  // Re-expand the current week whenever the plan changes (e.g. regenerate),
  // adjusting state during render rather than in an effect.
  const [prevPlan, setPrevPlan] = useState(plan);
  if (plan !== prevPlan) {
    setPrevPlan(plan);
    setExp(currentWeekIndex());
  }

  const genPlan = opts => {
    const o    = opts || {};
    const ps   = o.planSessions || draft;
    const date = o.raceDate     || settings.raceDate;
    const goal = o.goalSec      || settings.goalSec;
    const dist = o.distanceKm   || settings.distanceKm || 20;
    // 0 is a valid climb, so coalesce on nullish rather than falsy.
    const elev = o.raceElevation ?? settings.raceElevation ?? 0;
    saveSettings({...settings, planSessions: ps, raceDate: date, goalSec: goal, distanceKm: dist, raceElevation: elev});
    savePlan(buildPlan(date, goal, ps, dist, elev));
    setEdit(false); setConfirmRegen(false);
  };

  if (!plan) return (
    <div className="p-4 max-w-lg mx-auto">
      <div className="flex items-center justify-between mt-4 mb-5">
        <h2 className="text-xl font-bold">Training Plan</h2>
        <PlanInfo/>
      </div>
      <div className="bg-slate-800 rounded-2xl p-5 space-y-5">
        <p className="text-slate-400 text-sm">Configure your goal and available training days.</p>
        <div>
          <label className="text-xs text-slate-400 block mb-1.5">Race date</label>
          <input type="date" value={settings.raceDate || ""}
            onChange={e => saveSettings({...settings, raceDate: e.target.value})}
            className="w-full bg-slate-700 border border-slate-600 rounded-xl p-3 text-white text-sm focus:outline-none focus:border-orange-400"/>
        </div>
        <div>
          <label className="text-xs text-slate-400 block mb-1.5">Race distance (km)</label>
          <input type="number" min="1" max="200" step="0.1" value={settings.distanceKm || ""} placeholder="e.g. 21.1"
            onChange={e => { const n = parseFloat(e.target.value); saveSettings({...settings, distanceKm: isNaN(n) ? "" : n}); }}
            className="w-full bg-slate-700 border border-slate-600 rounded-xl p-3 text-white text-sm focus:outline-none focus:border-orange-400 placeholder-slate-500"/>
        </div>
        <div>
          <label className="text-xs text-slate-400 block mb-1.5">Race elevation gain (m)</label>
          <input type="number" min="0" max="10000" step="10" value={settings.raceElevation ?? ""} placeholder="0"
            onChange={e => { const v = e.target.value; saveSettings({...settings, raceElevation: v === "" ? "" : Math.max(0, parseInt(v) || 0)}); }}
            className="w-full bg-slate-700 border border-slate-600 rounded-xl p-3 text-white text-sm focus:outline-none focus:border-orange-400 placeholder-slate-500"/>
          <p className="text-slate-500 text-xs mt-1">Total climb on the course — sets training paces to the flat-equivalent effort.</p>
        </div>
        <GoalConfigurator distanceKm={settings.distanceKm} goalSec={settings.goalSec}
          onChange={g => saveSettings({...settings, goalSec: g})}/>
        <div>
          <label className="text-xs text-slate-400 block mb-2">Training days and durations</label>
          <SessionConfigurator sessions={draft} onChange={setDraft}/>
        </div>
        {!settings.maxHR && (
          <button type="button" onClick={openSettings}
            className="w-full bg-amber-500/10 hover:bg-amber-500/15 border border-amber-500/25 rounded-xl p-3 text-xs text-amber-200 flex gap-2 items-start text-left transition-colors">
            <span className="flex-shrink-0 text-base leading-none">💡</span>
            <span>Add your HR profile in Settings to unlock heart rate targets on every session.</span>
          </button>
        )}
        <button onClick={() => genPlan({planSessions: draft})}
          disabled={!settings.raceDate || !settings.distanceKm}
          className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white py-3.5 rounded-xl font-semibold transition-colors">
          Generate My Training Plan
        </button>
      </div>
    </div>
  );

  const all  = plan.weeks.flatMap(w => w.sessions);
  const done = all.filter(s => s.done).length;
  const pct  = Math.round((done / all.length) * 100);
  const today = new Date(); today.setHours(0,0,0,0);
  const ps   = plan.planSessions || settings.planSessions || [];
  const sessInfo = ps.slice()
    .sort((a, b) => a.dayOffset - b.dayOffset)
    .map(s => DAYS[s.dayOffset] + " (" + (s.minutes < 60 ? s.minutes + "min" : (s.minutes/60) + "h") + ")")
    .join(" · ");

  const phaseClass = phase => {
    if (phase === "TAPER") return "bg-emerald-500/15 text-emerald-400";
    if (phase === "PEAK" || phase === "RACE") return "bg-red-500/15 text-red-400";
    if (phase === "BUILD") return "bg-yellow-500/15 text-yellow-400";
    return "bg-sky-500/15 text-sky-400";
  };

  return (
    <div className="p-4 max-w-lg mx-auto">
      <div className="flex justify-between items-center mt-4 mb-4">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold">Training Plan</h2>
          <PlanInfo/>
        </div>
        <div className="flex gap-1 items-center">
          {confirmRegen ? (
            <div className="flex gap-1">
              <button onClick={() => setConfirmRegen(false)}
                className="px-2 py-1.5 text-slate-400 hover:text-white text-xs rounded-lg hover:bg-slate-700 transition-colors">
                Cancel
              </button>
              <button onClick={() => genPlan()}
                className="px-2 py-1.5 text-red-400 hover:text-white text-xs font-semibold rounded-lg hover:bg-red-500/20 transition-colors">
                Reset ✓
              </button>
            </div>
          ) : (
            <button onClick={() => setConfirmRegen(true)}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
              title="Regenerate plan">
              <RotateCcw size={16}/>
            </button>
          )}
        </div>
      </div>

      <div className="bg-slate-800 rounded-xl p-4 mb-3">
        <div className="flex justify-between text-sm mb-2">
          <span className="text-slate-400">{done + " / " + all.length + " sessions"}</span>
          <span className="text-orange-400 font-bold">{pct + "%"}</span>
        </div>
        <div className="h-2.5 bg-slate-700 rounded-full overflow-hidden">
          <div className="h-full bg-gradient-to-r from-orange-500 to-amber-400 rounded-full transition-all duration-700" style={{width: pct + "%"}}/>
        </div>
        <div className="flex justify-between text-xs text-slate-400 mt-2">
          <span>{(plan.distanceKm || 20) + "km" + (plan.raceElevation > 0 ? " · +" + Math.round(plan.raceElevation) + "m" : "") + " · sub " + fmt.dur(plan.goalSec)}</span>
          <span>{"Race: " + fmt.sht(plan.raceDate)}</span>
        </div>
      </div>

      <button onClick={() => {
          setDraft(ps.slice());
          setDraftDate(settings.raceDate);
          setDraftGoal(settings.goalSec);
          setDraftDist(settings.distanceKm || "");
          setDraftElev(settings.raceElevation || 0);
          setEdit(v => !v);
        }}
        className={"w-full mb-3 rounded-xl px-4 py-2.5 flex items-center justify-between text-xs transition-colors border " + (editSessions ? "bg-orange-500/10 border-orange-500/40" : "bg-slate-800 border-slate-700 hover:border-slate-500")}>
        <span>
          <span className="text-slate-400">Sessions: </span>
          <span className="text-white font-medium">{sessInfo || "not configured"}</span>
        </span>
        <span className="text-orange-400 font-semibold ml-2 flex-shrink-0">{editSessions ? "Close" : "Edit plan"}</span>
      </button>

      {editSessions && (
        <div className="bg-slate-800 rounded-xl p-4 mb-3 border border-orange-500/30 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400 block mb-1.5">Race date</label>
              <input type="date" value={draftDate} onChange={e => setDraftDate(e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded-xl p-2.5 text-white text-sm focus:outline-none focus:border-orange-400"/>
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1.5">Distance (km)</label>
              <input type="number" min="1" max="200" step="0.1" value={draftDist} placeholder="e.g. 21.1"
                onChange={e => { const n = parseFloat(e.target.value); setDraftDist(isNaN(n) ? "" : n); }}
                className="w-full bg-slate-700 border border-slate-600 rounded-xl p-2.5 text-white text-sm focus:outline-none focus:border-orange-400 placeholder-slate-500"/>
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1.5">Race elevation gain (m)</label>
            <input type="number" min="0" max="10000" step="10" value={draftElev} placeholder="0"
              onChange={e => { const v = e.target.value; setDraftElev(v === "" ? "" : Math.max(0, parseInt(v) || 0)); }}
              className="w-full bg-slate-700 border border-slate-600 rounded-xl p-2.5 text-white text-sm focus:outline-none focus:border-orange-400 placeholder-slate-500"/>
            <p className="text-slate-500 text-xs mt-1">Total climb on the course — sets training paces to the flat-equivalent effort.</p>
          </div>
          <GoalConfigurator distanceKm={draftDist} goalSec={draftGoal} onChange={setDraftGoal}/>
          <div>
            <label className="text-xs text-slate-400 block mb-2">Training days and durations</label>
            <SessionConfigurator sessions={draft} onChange={setDraft}/>
          </div>
          <button onClick={() => genPlan({planSessions: draft, raceDate: draftDate, goalSec: draftGoal, distanceKm: draftDist || 20, raceElevation: draftElev})}
            disabled={!draftDate || !draftDist}
            className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white py-2.5 rounded-xl text-sm font-semibold transition-colors">
            Regenerate plan
          </button>
          <p className="text-xs text-slate-500 text-center">Regenerating rebuilds the schedule — completed sessions will reset.</p>
        </div>
      )}

      <div className="space-y-2">
        {plan.weeks.map((wk, i) => {
          const wS = new Date(wk.startDate + "T00:00:00");
          const wE = new Date(wS); wE.setDate(wS.getDate() + 7);
          const isCurr = today >= wS && today < wE;
          const isPast = wE < today;
          const isExp  = exp === i;
          const wDone  = wk.sessions.filter(s => s.done).length;
          const wkNumCls = isCurr ? "text-orange-400" : isPast ? "text-slate-600" : "text-slate-300";
          const wkCardCls = isCurr ? "border-orange-500/50 bg-orange-500/5" : "border-slate-700 bg-slate-800";
          const chevronCls = "text-slate-600 transition-transform flex-shrink-0 " + (isExp ? "rotate-90" : "");

          return (
            <div key={wk.weekNumber} className={"rounded-xl border overflow-hidden " + wkCardCls}>
              <button onClick={() => setExp(isExp ? null : i)} className="w-full px-4 py-3 flex items-center gap-2 text-left">
                <span className={"text-sm font-bold flex-shrink-0 " + wkNumCls}>{"W" + wk.weekNumber}</span>
                <span className="text-xs text-slate-400 flex-shrink-0">{fmt.sht(wk.startDate)}</span>
                <span className={"text-xs px-2 py-0.5 rounded-full flex-shrink-0 " + phaseClass(wk.phase)}>{wk.phase}</span>
                {isCurr && <span className="text-xs text-orange-400 flex-shrink-0">now</span>}
                <span className="flex-1"/>
                <span className="text-xs text-slate-400">{wDone + "/" + wk.sessions.length}</span>
                <ChevronRight size={14} className={chevronCls}/>
              </button>

              {isExp && (
                <div className="border-t border-slate-700/50">
                  {wk.sessions.slice().sort((a, b) => a.date.localeCompare(b.date)).map(s => {
                    const rowCls = "flex items-start gap-3 px-4 py-3 border-b border-slate-700/30 last:border-0 " + (s.done ? "opacity-40" : "");
                    const checkCls = "w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-all " + (s.done ? "bg-emerald-500 border-emerald-500" : "border-slate-500 hover:border-emerald-400");
                    const descCls = "text-sm mt-0.5 leading-snug " + (s.done ? "line-through text-slate-600" : "text-slate-300");
                    const typeCls = "text-xs font-bold uppercase " + (TCLR[s.type] || "text-violet-400");
                    return (
                      <div key={s.id} className={rowCls}>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={typeCls}>{s.type}</span>
                            <span className="text-xs text-slate-400">{fmt.sht(s.date)}</span>
                          </div>
                          <p className={descCls}>{cleanDesc(s.desc)}</p>
                          <p className="text-xs text-slate-400 mt-0.5">{s.km + " km · ~" + estMin(s.km, s.pace) + " · " + fmt.pace(s.pace) + "/km"}</p>
                          <HRTarget type={s.type} settings={settings} openSettings={openSettings}/>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0 self-center">
                          {!s.done && (
                            <button
                              onClick={() => goLog({date: s.date, type: s.type, km: s.km, pace: s.pace, wNum: wk.weekNumber, sId: s.id})}
                              className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-orange-500/15 text-orange-300 hover:bg-orange-500/25 transition-colors">
                              <Plus size={13}/>Record
                            </button>
                          )}
                          <button onClick={() => toggleSess(wk.weekNumber, s.id)} className={checkCls}
                            title={s.done ? "Mark not done" : "Mark done"}>
                            {s.done && <Check size={11}/>}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
