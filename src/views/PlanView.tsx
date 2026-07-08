// @ts-nocheck
import { useState, useRef, useEffect } from "react";
import { ArrowDown, Check, ChevronRight, MessageCircle, Plus, RotateCcw, X } from "lucide-react";
import { DAYS, TCLR } from "../constants";
import { fmt, estMin, cleanDesc } from "../utils/format";
import { findEdition } from "../utils/races";
import { SessionConfigurator } from "../components/SessionConfigurator";
import { GoalConfigurator } from "../components/GoalConfigurator";
import { HRTarget } from "../components/HRTarget";
import { PlanInfo } from "../components/PlanInfo";

export function PlanView({plan, settings, runs, races, savePlan, saveSettings, buildPlan, toggleSess, skipSess, openSettings, openCoach, goLog, planPrefill, clearPlanPrefill}) {
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
  // A promote ("Set as target") opens the setup pre-filled, so start in edit mode.
  const [editSessions, setEdit]        = useState(!!planPrefill);
  // The current-week card, so we can scroll the runner to "now" in a long plan.
  const weekRef = useRef(null);
  const jumpToWeek = () => weekRef.current?.scrollIntoView({behavior: "smooth", block: "center"});
  // On first open, if "now" sits well down the list, bring it into view.
  useEffect(() => {
    if (currentWeekIndex() >= 4) weekRef.current?.scrollIntoView({block: "center"});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Setup drafts. When promoting an edition, seed date/distance/elevation from
  // the prefill and leave the goal blank so GoalConfigurator offers a fresh,
  // realistic mid-pack suggestion for the (possibly new) distance.
  const [draft,        setDraft]       = useState(settings.planSessions || [{dayOffset:2,minutes:30},{dayOffset:6,minutes:60}]);
  const [draftDate,    setDraftDate]   = useState(planPrefill?.raceDate ?? settings.raceDate);
  const [draftGoal,    setDraftGoal]   = useState(planPrefill ? "" : settings.goalSec);
  const [draftDist,    setDraftDist]   = useState(planPrefill?.distanceKm ?? (settings.distanceKm || ""));
  const [draftElev,    setDraftElev]   = useState(planPrefill?.raceElevation ?? (settings.raceElevation || 0));
  const [confirmRegen, setConfirmRegen] = useState(false);

  // Re-expand the current week whenever the plan changes (e.g. regenerate),
  // adjusting state during render rather than in an effect.
  const [prevPlan, setPrevPlan] = useState(plan);
  if (plan !== prevPlan) {
    setPrevPlan(plan);
    setExp(currentWeekIndex());
  }

  // A promote ("Set as target") prefills the setup with a catalogue edition.
  // With an existing plan, open the Edit form pre-filled; the generate form
  // already reflects settings (promoteEdition wrote them) when there's no plan.
  const [prevPrefill, setPrevPrefill] = useState(planPrefill);
  if (planPrefill !== prevPrefill) {
    setPrevPrefill(planPrefill);
    if (planPrefill) {
      setDraftDate(planPrefill.raceDate);
      setDraftDist(planPrefill.distanceKm);
      setDraftElev(planPrefill.raceElevation || 0);
      setDraftGoal(""); // blank → GoalConfigurator suggests a realistic goal
      setEdit(true);
    }
  }

  const genPlan = opts => {
    const o    = opts || {};
    const ps   = o.planSessions || draft;
    const date = o.raceDate     || settings.raceDate;
    const goal = o.goalSec      || settings.goalSec;
    const dist = o.distanceKm   || settings.distanceKm || 20;
    // 0 is a valid climb, so coalesce on nullish rather than falsy.
    const elev = o.raceElevation ?? settings.raceElevation ?? 0;
    // Keep the catalogue link only when building the promoted race unchanged;
    // any hand-edit of the date/distance decouples it from the target edition.
    const sameAsPrefill = planPrefill && date === planPrefill.raceDate && Number(dist) === Number(planPrefill.distanceKm);
    const sameAsTarget  = date === settings.raceDate && Number(dist) === Number(settings.distanceKm);
    const targetEditionId = sameAsPrefill ? planPrefill.editionId : (sameAsTarget ? (settings.targetEditionId ?? null) : null);
    saveSettings({...settings, planSessions: ps, raceDate: date, goalSec: goal, distanceKm: dist, raceElevation: elev, targetEditionId});
    // Secondary races the user has added to the plan (not the main target). buildPlan
    // does the window filtering; we just hand it the flagged wishlist races, enriched
    // with the catalogue elevation when available.
    const secRaces = (races?.participations || [])
      .filter(p => p.status === "wishlist" && p.inPlan && p.editionId !== targetEditionId)
      .map(p => ({ editionId: p.editionId, date: p.raceDate, distanceKm: p.distanceKm,
        elevation: findEdition(p.editionId)?.edition?.elevation || 0 }));
    savePlan(buildPlan(date, goal, ps, dist, elev, {recentRuns: runs, races: secRaces, mainEditionId: targetEditionId}));
    setEdit(false); setConfirmRegen(false);
    clearPlanPrefill?.();
  };

  // Arriving from "Set as target": the setup is pre-filled for a chosen race and
  // we focus the screen on building it.
  const promoting = !!planPrefill;
  const cancelPromote = () => { clearPlanPrefill?.(); setEdit(false); };

  if (!plan) return (
    <div className="p-4 max-w-lg mx-auto">
      <div className="flex items-center justify-between mt-4 mb-5">
        <h2 className="text-xl font-bold">Training Plan</h2>
        <PlanInfo/>
      </div>
      {promoting && <PromoteBanner prefill={planPrefill} onCancel={cancelPromote}/>}
      <div className="bg-slate-800 rounded-2xl p-5 space-y-5">
        <p className="text-slate-400 text-sm">{promoting ? "Set your goal time, then build your plan." : "Configure your goal and available training days."}</p>
        <div>
          <label className="text-xs text-slate-400 block mb-1.5">Race date</label>
          <input type="date" value={draftDate || ""}
            onChange={e => setDraftDate(e.target.value)}
            className="w-full bg-slate-700 border border-slate-600 rounded-xl p-3 text-white text-sm focus:outline-none focus:border-orange-400"/>
        </div>
        <div>
          <label className="text-xs text-slate-400 block mb-1.5">Race distance (km)</label>
          <input type="number" min="1" max="200" step="0.1" value={draftDist} placeholder="e.g. 21.1"
            onChange={e => { const n = parseFloat(e.target.value); setDraftDist(isNaN(n) ? "" : n); }}
            className="w-full bg-slate-700 border border-slate-600 rounded-xl p-3 text-white text-sm focus:outline-none focus:border-orange-400 placeholder-slate-500"/>
        </div>
        <div>
          <label className="text-xs text-slate-400 block mb-1.5">Race elevation gain (m)</label>
          <input type="number" min="0" max="10000" step="10" value={draftElev} placeholder="0"
            onChange={e => { const v = e.target.value; setDraftElev(v === "" ? "" : Math.max(0, parseInt(v) || 0)); }}
            className="w-full bg-slate-700 border border-slate-600 rounded-xl p-3 text-white text-sm focus:outline-none focus:border-orange-400 placeholder-slate-500"/>
          <p className="text-slate-500 text-xs mt-1">Total climb on the course — sets training paces to the flat-equivalent effort.</p>
        </div>
        <GoalConfigurator distanceKm={draftDist} goalSec={draftGoal}
          onChange={setDraftGoal}/>
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
        <button onClick={() => genPlan({planSessions: draft, raceDate: draftDate, goalSec: draftGoal, distanceKm: draftDist || 20, raceElevation: draftElev})}
          disabled={!draftDate || !draftDist}
          className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white py-3.5 rounded-xl font-semibold transition-colors">
          {promoting ? "Build my plan" : "Generate My Training Plan"}
        </button>
      </div>
    </div>
  );

  const all  = plan.weeks.flatMap(w => w.sessions);
  const done = all.filter(s => s.done).length;
  const pct  = Math.round((done / all.length) * 100);
  const today = new Date(); today.setHours(0,0,0,0);
  const nowIdx = plan.weeks.findIndex(w => {
    const s = new Date(w.startDate + "T00:00:00");
    const e = new Date(s); e.setDate(s.getDate() + 7);
    return today >= s && today < e;
  });
  const ps   = plan.planSessions || settings.planSessions || [];
  const sessInfo = ps.slice()
    .sort((a, b) => a.dayOffset - b.dayOffset)
    .map(s => DAYS[s.dayOffset] + " (" + fmt.mins(s.minutes) + ")")
    .join(" · ");
  // The peak long run is driven by race distance, so on a short long-session
  // setting it runs longer than configured. Surface that honestly (rather than
  // silently capping the long run) so the user can lengthen their long day.
  const easyPace = Math.round((plan.targetPace || 0) * 1.25);
  const peakLongMin = plan.longRunPeakKm && easyPace ? Math.round(plan.longRunPeakKm * easyPace / 60) : 0;
  const longestSessMin = ps.reduce((m, s) => Math.max(m, s.minutes || 0), 0);
  const longRunNudge = peakLongMin > longestSessMin + 20;

  const phaseClass = phase => {
    if (phase === "TAPER") return "bg-emerald-500/15 text-emerald-400";
    if (phase === "PEAK" || phase === "RACE") return "bg-red-500/15 text-red-400";
    if (phase === "BUILD") return "bg-yellow-500/15 text-yellow-400";
    return "bg-sky-500/15 text-sky-400";
  };

  return (
    <div className="p-4 max-w-lg mx-auto">
      <div className="flex justify-between items-center mt-4 mb-4">
        <h2 className="text-xl font-bold">Training Plan</h2>
        {!promoting && (
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
              <>
                <button onClick={openCoach}
                  className="px-2.5 py-1.5 flex items-center gap-1.5 text-xs font-semibold text-orange-300 bg-orange-500/10 hover:bg-orange-500/20 border border-orange-500/30 rounded-lg transition-colors"
                  title="Adjust the plan with your coach">
                  <MessageCircle size={13}/>Coach
                </button>
                <button onClick={() => setConfirmRegen(true)}
                  className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
                  title="Regenerate plan">
                  <RotateCcw size={16}/>
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {promoting && <PromoteBanner prefill={planPrefill} onCancel={cancelPromote}/>}

      {!promoting && (<>
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
        <div className="mt-3 pt-3 border-t border-slate-700/50 flex justify-end">
          <PlanInfo/>
        </div>
      </div>

      {nowIdx >= 0 && (
        <button onClick={jumpToWeek}
          className="w-full mb-3 rounded-xl px-4 py-2 flex items-center justify-center gap-1.5 text-xs font-semibold text-orange-300 bg-orange-500/10 hover:bg-orange-500/20 border border-orange-500/30 transition-colors">
          Jump to this week<ArrowDown size={13}/>
        </button>
      )}

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

      {longRunNudge && !editSessions && (
        <div className="w-full mb-3 rounded-xl px-4 py-2.5 text-xs text-amber-200 bg-amber-500/10 border border-amber-500/25 flex gap-2 items-start">
          <span className="flex-shrink-0 text-base leading-none">💡</span>
          <span>Your goal builds long runs up to ~{fmt.mins(peakLongMin)}, longer than your
          longest training day ({fmt.mins(longestSessMin)}). That's expected for this
          distance — consider lengthening your long day in Edit plan.</span>
        </div>
      )}
      </>)}

      {(editSessions || promoting) && (
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
            {promoting ? "Build my plan" : "Regenerate plan"}
          </button>
          <p className="text-xs text-slate-500 text-center">
            {promoting ? "Builds a fresh plan for this race — any existing plan is replaced." : "Regenerating rebuilds the schedule — completed sessions will reset."}
          </p>
        </div>
      )}

      {!promoting && <div className="space-y-2">
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
            <div key={wk.weekNumber} ref={isCurr ? weekRef : null} className={"rounded-xl border overflow-hidden " + wkCardCls}>
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
                    const isSkipped = !!s.skipped && !s.done;
                    const rowCls = "flex items-start gap-3 px-4 py-3 border-b border-slate-700/30 last:border-0 " + (s.done ? "opacity-40" : isSkipped ? "opacity-50" : "");
                    const checkCls = "w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-all " + (s.done ? "bg-emerald-500 border-emerald-500" : "border-slate-500 hover:border-emerald-400");
                    const descCls = "text-sm mt-0.5 leading-snug " + (s.done ? "line-through text-slate-600" : isSkipped ? "line-through text-slate-500" : "text-slate-300");
                    const typeCls = "text-xs font-bold uppercase " + (TCLR[s.type] || "text-violet-400");
                    return (
                      <div key={s.id} className={rowCls}>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={typeCls}>{s.type}</span>
                            <span className="text-xs text-slate-400">{fmt.sht(s.date)}</span>
                            {isSkipped && (
                              <span className="text-xs px-1.5 py-0.5 rounded bg-slate-600/60 text-slate-400">skipped</span>
                            )}
                          </div>
                          <p className={descCls}>{cleanDesc(s.desc)}</p>
                          <p className="text-xs text-slate-400 mt-0.5">{s.km + " km · ~" + estMin(s.km, s.pace) + " · " + fmt.pace(s.pace) + "/km"}</p>
                          <HRTarget type={s.type} settings={settings} openSettings={openSettings}/>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0 self-center">
                          {!s.done && !isSkipped && (
                            <button
                              onClick={() => goLog({date: s.date, type: s.type, km: s.km, pace: s.pace, wNum: wk.weekNumber, sId: s.id})}
                              className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-orange-500/15 text-orange-300 hover:bg-orange-500/25 transition-colors">
                              <Plus size={13}/>Record
                            </button>
                          )}
                          {!s.done && (
                            <button
                              onClick={() => skipSess(wk.weekNumber, s.id)}
                              className={"flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg transition-colors " + (isSkipped ? "bg-slate-600/40 text-slate-300 hover:bg-slate-600/60" : "bg-slate-700/50 text-slate-400 hover:bg-slate-700 hover:text-slate-200")}
                              title={isSkipped ? "Undo skip" : "Skip this session"}>
                              {isSkipped ? "Undo" : <X size={13}/>}
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
      </div>}
    </div>
  );
}

// Focused header shown when arriving from "Set as target": names the race so it's
// clear what the setup below is building, with a way out.
function PromoteBanner({ prefill, onCancel }) {
  return (
    <div className="rounded-2xl p-4 mb-4 border border-orange-500/40"
      style={{ background: "linear-gradient(135deg,rgba(249,115,22,.13),rgba(220,38,38,.13))" }}>
      <p className="text-orange-300 text-xs font-semibold uppercase tracking-widest mb-1">New training target</p>
      <p className="font-semibold">{prefill.label || "Your race"}</p>
      <p className="text-slate-400 text-sm mt-0.5">
        {fmt.date(prefill.raceDate) + " · " + prefill.distanceKm + " km" + (prefill.raceElevation ? " · +" + prefill.raceElevation + "m" : "")}
      </p>
      <p className="text-slate-300 text-sm mt-2">Set your goal time below, then build your plan.</p>
      <button onClick={onCancel} className="text-xs text-slate-400 hover:text-slate-200 mt-2 transition-colors">Cancel</button>
    </div>
  );
}
