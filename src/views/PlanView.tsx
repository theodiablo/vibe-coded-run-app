import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDown, Check, ChevronRight, MessageCircle, Plus, RotateCcw, X } from "lucide-react";
import { TCLR } from "../constants";
import { dayName } from "../i18n";
import { fmt, estMin } from "../utils/format";
import { describeSession } from "../utils/sessionDesc";
import { sessionSteps } from "../utils/sessionSteps";
import { findEdition } from "../utils/races";
import { SessionConfigurator } from "../components/SessionConfigurator";
import { GoalConfigurator } from "../components/GoalConfigurator";
import { HRTarget } from "../components/HRTarget";
import { PlanInfo } from "../components/PlanInfo";
import { StylePicker } from "../components/StylePicker";
import { styleMeta, isStyleId, recommendStyle, stylePacing, suggestPlanSessions, type StyleId } from "../utils/planStyles";
import type { Plan, PlanPrefill, PlanSession, RacesState, Run, RunType, SettingsState } from "../types";
import type { PlanSessionInput } from "../utils/plan";

type GeneratePlanOptions = {
  planSessions?: PlanSessionInput[];
  raceDate?: string;
  goalSec?: number | string;
  distanceKm?: number | string;
  raceElevation?: number | string;
  planStyle?: StyleId;
};

type PlanViewProps = {
  plan: Plan | null;
  settings: SettingsState;
  runs: Run[];
  races: RacesState | null;
  savePlan: (plan: Plan) => void;
  saveSettings: (settings: SettingsState) => void;
  buildPlan: (
    raceDate: string,
    goalSec: number | string,
    planSessions: PlanSessionInput[],
    distanceKm: number | string,
    raceElevation: number | string,
    opts?: Record<string, unknown>,
  ) => Plan;
  toggleSess: (weekNumber: number, sessionId: string) => void;
  skipSess: (weekNumber: number, sessionId: string) => void;
  openSettings: () => void;
  openCoach: () => void;
  goLog: (prefill: Partial<Run>) => void;
  planPrefill?: PlanPrefill | null;
  clearPlanPrefill?: () => void;
};

type PlanDraftValue = string | number;

const planTypeClass = (type: PlanSession["type"]) => TCLR[(type as RunType) || "OTHER"] || "text-violet-400";

export function PlanView({plan, settings, runs, races, savePlan, saveSettings, buildPlan, toggleSess, skipSess, openSettings, openCoach, goLog, planPrefill, clearPlanPrefill}: PlanViewProps) {
  const { t } = useTranslation();
  // Index of the week containing today — the one we auto-expand.
  const currentWeekIndex = () => {
    if (!plan) return null;
    const today = new Date(); today.setHours(0,0,0,0);
    const i = plan.weeks.findIndex(w => {
      const s = new Date((w.startDate || "") + "T00:00:00");
      const e = new Date(s); e.setDate(s.getDate() + 7);
      return today >= s && today < e;
    });
    return i >= 0 ? i : 0;
  };

  const [exp,          setExp]         = useState<number | null>(currentWeekIndex);
  // Session card expanded to its "how it unfolds" breakdown (one at a time).
  const [openSess,     setOpenSess]    = useState<string | null>(null);
  // A promote ("Set as target") opens the setup pre-filled, so start in edit mode.
  const [editSessions, setEdit]        = useState(!!planPrefill);
  // The current-week card, so we can scroll the runner to "now" in a long plan.
  const weekRef = useRef<HTMLDivElement | null>(null);
  const jumpToWeek = () => weekRef.current?.scrollIntoView({behavior: "smooth", block: "center"});
  // On first open, if "now" sits well down the list, bring it into view.
  useEffect(() => {
    const i = currentWeekIndex();
    if (i != null && i >= 4) weekRef.current?.scrollIntoView({block: "center"});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Setup drafts. When promoting an edition, seed date/distance/elevation from
  // the prefill and leave the goal blank so GoalConfigurator offers a fresh,
  // realistic mid-pack suggestion for the (possibly new) distance.
  const [draft,        setDraft]       = useState<PlanSessionInput[]>(settings.planSessions || [{dayOffset:2,minutes:30},{dayOffset:6,minutes:60}]);
  const [draftDate,    setDraftDate]   = useState<string>(planPrefill?.raceDate ?? settings.raceDate);
  const [draftGoal,    setDraftGoal]   = useState<PlanDraftValue>(planPrefill ? "" : settings.goalSec);
  const [draftDist,    setDraftDist]   = useState<PlanDraftValue>(planPrefill?.distanceKm ?? (settings.distanceKm || ""));
  const [draftElev,    setDraftElev]   = useState<PlanDraftValue>(planPrefill?.raceElevation ?? (settings.raceElevation || 0));
  // Methodology style: null = untouched, so the shown selection keeps tracking
  // the live recommendation as the user edits days/distance; a tap pins it.
  const [draftStyle,   setDraftStyle]  = useState<StyleId | null>(isStyleId(settings.planStyle) ? settings.planStyle : null);
  const [confirmRegen, setConfirmRegen] = useState(false);

  const recommendedStyle = recommendStyle({
    intent: settings.intent, planSessions: draft, distanceKm: draftDist, recentRuns: runs,
    level: settings.trainingLevel,
  });
  const effectiveStyle = draftStyle ?? recommendedStyle;
  // Suggested days/durations for the drafted race — offered as a one-tap fill,
  // never forced over what the user configured.
  const suggestedSessions = suggestPlanSessions(draftDist || settings.distanceKm || 10, settings.trainingLevel);
  const draftIsSuggested = JSON.stringify(draft) === JSON.stringify(suggestedSessions);

  // Re-expand the current week whenever the plan changes (e.g. regenerate),
  // adjusting state during render rather than in an effect.
  const [prevPlan, setPrevPlan] = useState<Plan | null>(plan);
  if (plan !== prevPlan) {
    setPrevPlan(plan);
    setExp(currentWeekIndex());
  }

  // A promote ("Set as target") prefills the setup with a catalogue edition.
  // With an existing plan, open the Edit form pre-filled; the generate form
  // already reflects settings (promoteEdition wrote them) when there's no plan.
  const [prevPrefill, setPrevPrefill] = useState<PlanPrefill | null | undefined>(planPrefill);
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

  const genPlan = (opts: GeneratePlanOptions = {}) => {
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
    const style = o.planStyle || effectiveStyle;
    saveSettings({...settings, planSessions: ps, raceDate: date, goalSec: goal, distanceKm: dist, raceElevation: Number(elev) || 0, targetEditionId, planStyle: style});
    // Secondary races the user has added to the plan (not the main target). buildPlan
    // does the window filtering; we just hand it the flagged wishlist races, enriched
    // with the catalogue elevation when available.
    const secRaces = (races?.participations || [])
      .filter(p => p.status === "wishlist" && p.inPlan && p.editionId !== targetEditionId)
      .map(p => ({ editionId: p.editionId, date: p.raceDate, distanceKm: p.distanceKm,
        elevation: p.editionId ? findEdition(p.editionId)?.edition?.elevation || 0 : 0 }));
    savePlan(buildPlan(date, goal, ps, dist, elev, {recentRuns: runs, races: secRaces, mainEditionId: targetEditionId, style, level: settings.trainingLevel}));
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
        <h2 className="text-xl font-bold">{t("plan.title")}</h2>
        <PlanInfo/>
      </div>
      {promoting && planPrefill && <PromoteBanner prefill={planPrefill} onCancel={cancelPromote}/>}
      <div className="bg-slate-800 rounded-2xl p-5 space-y-5">
        <p className="text-slate-400 text-sm">{promoting ? t("plan.setup.introPromote") : t("plan.setup.intro")}</p>
        <div>
          <label className="text-xs text-slate-400 block mb-1.5">{t("plan.setup.raceDate")}</label>
          <input type="date" value={draftDate || ""}
            onChange={e => setDraftDate(e.target.value)}
            className="w-full bg-slate-700 border border-slate-600 rounded-xl p-3 text-white text-sm focus:outline-none focus:border-orange-400"/>
        </div>
        <div>
          <label className="text-xs text-slate-400 block mb-1.5">{t("plan.setup.raceDistance")}</label>
          <input type="number" min="1" max="200" step="0.1" value={draftDist} placeholder={t("plan.setup.distancePlaceholder")}
            onChange={e => { const n = parseFloat(e.target.value); setDraftDist(isNaN(n) ? "" : n); }}
            className="w-full bg-slate-700 border border-slate-600 rounded-xl p-3 text-white text-sm focus:outline-none focus:border-orange-400 placeholder-slate-500"/>
        </div>
        <div>
          <label className="text-xs text-slate-400 block mb-1.5">{t("plan.setup.raceElevation")}</label>
          <input type="number" min="0" max="10000" step="10" value={draftElev} placeholder="0"
            onChange={e => { const v = e.target.value; setDraftElev(v === "" ? "" : Math.max(0, parseInt(v) || 0)); }}
            className="w-full bg-slate-700 border border-slate-600 rounded-xl p-3 text-white text-sm focus:outline-none focus:border-orange-400 placeholder-slate-500"/>
          <p className="text-slate-500 text-xs mt-1">{t("plan.setup.elevationHelp")}</p>
        </div>
        <GoalConfigurator distanceKm={draftDist} goalSec={draftGoal}
          onChange={setDraftGoal}/>
        <div>
          <label className="text-xs text-slate-400 block mb-2">{t("plan.setup.trainingDays")}</label>
          <SessionConfigurator sessions={draft} onChange={setDraft}/>
          {draftIsSuggested
            ? <p className="text-xs text-slate-500 mt-1.5">{t("plan.setup.suggestedNote")}</p>
            : <button type="button" onClick={() => setDraft(suggestedSessions)}
                className="text-xs text-orange-300/80 hover:text-orange-300 mt-1.5 transition-colors">
                {t("plan.setup.useSuggested")}
              </button>}
        </div>
        <div>
          <label className="text-xs text-slate-400 block mb-2">{t("plan.setup.trainingStyle")}</label>
          <StylePicker value={effectiveStyle} onChange={setDraftStyle} recommended={recommendedStyle}/>
        </div>
        {!settings.maxHR && (
          <button type="button" onClick={openSettings}
            className="w-full bg-amber-500/10 hover:bg-amber-500/15 border border-amber-500/25 rounded-xl p-3 text-xs text-amber-200 flex gap-2 items-start text-left transition-colors">
            <span className="flex-shrink-0 text-base leading-none">💡</span>
            <span>{t("plan.setup.hrNudge")}</span>
          </button>
        )}
        <button onClick={() => genPlan({planSessions: draft, raceDate: draftDate, goalSec: draftGoal, distanceKm: draftDist || 20, raceElevation: draftElev})}
          disabled={!draftDate || !draftDist}
          className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white py-3.5 rounded-xl font-semibold transition-colors">
          {promoting ? t("plan.setup.buildMyPlan") : t("plan.setup.generate")}
        </button>
      </div>
    </div>
  );

  const all  = plan.weeks.flatMap(w => w.sessions);
  const done = all.filter(s => s.done).length;
  const pct  = Math.round((done / all.length) * 100);
  const today = new Date(); today.setHours(0,0,0,0);
  const nowIdx = plan.weeks.findIndex(w => {
      const s = new Date((w.startDate || "") + "T00:00:00");
    const e = new Date(s); e.setDate(s.getDate() + 7);
    return today >= s && today < e;
  });
  const ps   = plan.planSessions || settings.planSessions || [];
  const sessInfo = ps.slice()
    .sort((a, b) => a.dayOffset - b.dayOffset)
    .map(s => dayName(s.dayOffset) + " (" + fmt.mins(s.minutes) + ")")
    .join(" · ");
  const planStyle: StyleId = isStyleId(plan.style) ? plan.style : "balanced";
  // The peak long run is driven by race distance, so on a short long-session
  // setting it runs longer than configured. Surface that honestly (rather than
  // silently capping the long run) so the user can lengthen their long day.
  const easyPace = Math.round((plan.targetPace || 0) * stylePacing(planStyle).long);
  const peakLongMin = plan.longRunPeakKm && easyPace ? Math.round(plan.longRunPeakKm * easyPace / 60) : 0;
  const longestSessMin = ps.reduce((m, s) => Math.max(m, s.minutes || 0), 0);
  const longRunNudge = peakLongMin > longestSessMin + 20;

  const phaseClass = (phase?: string) => {
    if (phase === "TAPER") return "bg-emerald-500/15 text-emerald-400";
    if (phase === "PEAK" || phase === "RACE") return "bg-red-500/15 text-red-400";
    if (phase === "BUILD") return "bg-yellow-500/15 text-yellow-400";
    return "bg-sky-500/15 text-sky-400";
  };

  return (
    <div className="p-4 max-w-lg mx-auto">
      <div className="flex justify-between items-center mt-4 mb-4">
        <h2 className="text-xl font-bold">{t("plan.title")}</h2>
        {!promoting && (
          <div className="flex gap-1 items-center">
            {confirmRegen ? (
              <div className="flex gap-1">
                <button onClick={() => setConfirmRegen(false)}
                  className="px-2 py-1.5 text-slate-400 hover:text-white text-xs rounded-lg hover:bg-slate-700 transition-colors">
                  {t("common.cancel")}
                </button>
                <button onClick={() => genPlan()}
                  className="px-2 py-1.5 text-red-400 hover:text-white text-xs font-semibold rounded-lg hover:bg-red-500/20 transition-colors">
                  {t("plan.header.resetConfirm")}
                </button>
              </div>
            ) : (
              <>
                <button onClick={openCoach}
                  className="px-2.5 py-1.5 flex items-center gap-1.5 text-xs font-semibold text-orange-300 bg-orange-500/10 hover:bg-orange-500/20 border border-orange-500/30 rounded-lg transition-colors"
                  title={t("plan.header.coachTitle")}>
                  <MessageCircle size={13}/>{t("plan.header.coach")}
                </button>
                <button onClick={() => setConfirmRegen(true)}
                  className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
                  aria-label={t("plan.setup.regenerate")} title={t("plan.setup.regenerate")}>

                  <RotateCcw size={16}/>
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {promoting && planPrefill && <PromoteBanner prefill={planPrefill} onCancel={cancelPromote}/>} 

      {!promoting && (<>
      <div className="bg-slate-800 rounded-xl p-4 mb-3">
        <div className="flex justify-between text-sm mb-2">
          <span className="text-slate-400">{t("plan.progress.sessions", {done, total: all.length})}</span>
          <span className="text-orange-400 font-bold">{pct + "%"}</span>
        </div>
        <div className="h-2.5 bg-slate-700 rounded-full overflow-hidden">
          <div className="h-full bg-gradient-to-r from-orange-500 to-amber-400 rounded-full transition-all duration-700" style={{width: pct + "%"}}/>
        </div>
        <div className="flex justify-between text-xs text-slate-400 mt-2">
          <span>{t("plan.progress.goal", {
            dist: plan.distanceKm || 20,
            elev: (plan.raceElevation || 0) > 0 ? " · +" + Math.round(plan.raceElevation || 0) + "m" : "",
            goal: fmt.dur(Number(plan.goalSec) || 0),
          })}</span>
          <span>{t("plan.progress.race", {date: fmt.sht(String(plan.raceDate || ""))})}</span>
        </div>
        <div className="mt-3 pt-3 border-t border-slate-700/50 flex justify-between items-center">
          <span className="text-xs px-2 py-0.5 rounded-full bg-slate-700/60 text-slate-300">{styleMeta(planStyle).label}</span>
          <PlanInfo/>
        </div>
      </div>

      {nowIdx >= 0 && (
        <button onClick={jumpToWeek}
          className="w-full mb-3 rounded-xl px-4 py-2 flex items-center justify-center gap-1.5 text-xs font-semibold text-orange-300 bg-orange-500/10 hover:bg-orange-500/20 border border-orange-500/30 transition-colors">
          {t("plan.jumpToWeek")}<ArrowDown size={13}/>
        </button>
      )}

      <button onClick={() => {
          setDraft(ps.slice());
          setDraftDate(settings.raceDate);
          setDraftGoal(settings.goalSec);
          setDraftDist(settings.distanceKm || "");
          setDraftElev(settings.raceElevation || 0);
          setDraftStyle(isStyleId(settings.planStyle) ? settings.planStyle : null);
          setEdit(v => !v);
        }}
        className={"w-full mb-3 rounded-xl px-4 py-2.5 flex items-center justify-between text-xs transition-colors border " + (editSessions ? "bg-orange-500/10 border-orange-500/40" : "bg-slate-800 border-slate-700 hover:border-slate-500")}>
        <span>
          <span className="text-slate-400">{t("plan.sessionsLabel")}</span>
          <span className="text-white font-medium">{sessInfo || t("plan.notConfigured")}</span>
        </span>
        <span className="text-orange-400 font-semibold ml-2 flex-shrink-0">{editSessions ? t("common.close") : t("plan.editPlan")}</span>
      </button>

      {longRunNudge && !editSessions && (
        <div className="w-full mb-3 rounded-xl px-4 py-2.5 text-xs text-amber-200 bg-amber-500/10 border border-amber-500/25 flex gap-2 items-start">
          <span className="flex-shrink-0 text-base leading-none">💡</span>
          <span>{t("plan.longRunNudge", {peak: fmt.mins(peakLongMin), longest: fmt.mins(longestSessMin)})}</span>
        </div>
      )}
      </>)}

      {(editSessions || promoting) && (
        <div className="bg-slate-800 rounded-xl p-4 mb-3 border border-orange-500/30 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400 block mb-1.5">{t("plan.setup.raceDate")}</label>
              <input type="date" value={draftDate} onChange={e => setDraftDate(e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded-xl p-2.5 text-white text-sm focus:outline-none focus:border-orange-400"/>
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1.5">{t("plan.setup.distance")}</label>
              <input type="number" min="1" max="200" step="0.1" value={draftDist} placeholder={t("plan.setup.distancePlaceholder")}
                onChange={e => { const n = parseFloat(e.target.value); setDraftDist(isNaN(n) ? "" : n); }}
                className="w-full bg-slate-700 border border-slate-600 rounded-xl p-2.5 text-white text-sm focus:outline-none focus:border-orange-400 placeholder-slate-500"/>
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1.5">{t("plan.setup.raceElevation")}</label>
            <input type="number" min="0" max="10000" step="10" value={draftElev} placeholder="0"
              onChange={e => { const v = e.target.value; setDraftElev(v === "" ? "" : Math.max(0, parseInt(v) || 0)); }}
              className="w-full bg-slate-700 border border-slate-600 rounded-xl p-2.5 text-white text-sm focus:outline-none focus:border-orange-400 placeholder-slate-500"/>
            <p className="text-slate-500 text-xs mt-1">{t("plan.setup.elevationHelp")}</p>
          </div>
          <GoalConfigurator distanceKm={draftDist} goalSec={draftGoal} onChange={setDraftGoal}/>
          <div>
            <label className="text-xs text-slate-400 block mb-2">{t("plan.setup.trainingDays")}</label>
            <SessionConfigurator sessions={draft} onChange={setDraft}/>
            {draftIsSuggested
              ? <p className="text-xs text-slate-500 mt-1.5">{t("plan.setup.suggestedNote")}</p>
              : <button type="button" onClick={() => setDraft(suggestedSessions)}
                  className="text-xs text-orange-300/80 hover:text-orange-300 mt-1.5 transition-colors">
                  {t("plan.setup.useSuggested")}
                </button>}
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-2">{t("plan.setup.trainingStyle")}</label>
            <StylePicker value={effectiveStyle} onChange={setDraftStyle} recommended={recommendedStyle}/>
          </div>
          <button onClick={() => genPlan({planSessions: draft, raceDate: draftDate, goalSec: draftGoal, distanceKm: draftDist || 20, raceElevation: draftElev})}
            disabled={!draftDate || !draftDist}
            className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white py-2.5 rounded-xl text-sm font-semibold transition-colors">
            {promoting ? t("plan.setup.buildMyPlan") : t("plan.setup.regenerate")}
          </button>
          <p className="text-xs text-slate-500 text-center">
            {promoting ? t("plan.setup.promoteNote") : t("plan.setup.regenNote")}
          </p>
        </div>
      )}

      {!promoting && <div className="space-y-2">
        {plan.weeks.map((wk, i) => {
          const wS = new Date((wk.startDate || "") + "T00:00:00");
          const wE = new Date(wS); wE.setDate(wS.getDate() + 7);
          const isCurr = today >= wS && today < wE;
          const isPast = wE < today;
          const isExp  = exp === i;
          const wDone  = wk.sessions.filter(s => s.done).length;
          const wkNumCls = isCurr ? "text-orange-400" : isPast ? "text-slate-600" : "text-slate-300";
          const wkCardCls = isCurr ? "border-orange-500/50 bg-orange-500/5" : "border-slate-700 bg-slate-800";
          const chevronCls = "text-slate-600 transition-transform flex-shrink-0 " + (isExp ? "rotate-90" : "");
          const phaseLabel = t("common.phases." + wk.phase, { defaultValue: wk.phase });

          return (
            <div key={wk.weekNumber} ref={isCurr ? weekRef : null} className={"rounded-xl border overflow-hidden " + wkCardCls}>
              <button onClick={() => setExp(isExp ? null : i)} className="w-full px-4 py-3 flex items-center gap-2 text-left">
                <span className={"text-sm font-bold flex-shrink-0 " + wkNumCls}>{t("plan.week.label", { number: wk.weekNumber })}</span>
                <span className="text-xs text-slate-400 flex-shrink-0">{fmt.sht(wk.startDate || "")}</span>
                <span title={phaseLabel} className={"text-xs px-2 py-0.5 rounded-full min-w-0 truncate " + phaseClass(wk.phase)}>{phaseLabel}</span>
                {isCurr && <span className="text-xs text-orange-400 flex-shrink-0">{t("plan.week.now")}</span>}
                <span className="flex-1"/>
                <span className="text-xs text-slate-400">{wDone + "/" + wk.sessions.length}</span>
                <ChevronRight size={14} className={chevronCls}/>
              </button>

              {isExp && (
                <div className="border-t border-slate-700/50 animate-expand">
                  {wk.sessions.slice().sort((a, b) => a.date.localeCompare(b.date)).map(s => {
                    const isSkipped = !!s.skipped && !s.done;
                    const rowCls = "flex items-start gap-3 px-4 py-3 border-b border-slate-700/30 last:border-0 transition-opacity duration-300 " + (s.done ? "opacity-40" : isSkipped ? "opacity-50" : "");
                    const checkCls = "w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-all active:scale-90 " + (s.done ? "bg-emerald-500 border-emerald-500" : "border-slate-500 hover:border-emerald-400");
                    const descCls = "text-sm mt-0.5 leading-snug " + (s.done ? "line-through text-slate-600" : isSkipped ? "line-through text-slate-500" : "text-slate-300");
                    const typeCls = "text-xs font-bold uppercase " + planTypeClass(s.type);
                    const sessOpen = openSess === s.id;
                    return (
                      <div key={s.id} className={rowCls}>
                        <div className="flex-1 min-w-0">
                          {/* Tapping the session text expands a step-by-step
                              "how it unfolds" breakdown (warm-up → workout →
                              cool-down → stretch). The action buttons and the
                              HR line stay outside the tap target. */}
                          <div className="cursor-pointer select-none" onClick={() => setOpenSess(sessOpen ? null : s.id)}>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={typeCls}>{t("common.types." + s.type, {defaultValue: s.type})}</span>
                              <span className="text-xs text-slate-400">{fmt.sht(s.date)}</span>
                              {isSkipped && (
                                <span className="text-xs px-1.5 py-0.5 rounded bg-slate-600/60 text-slate-400">{t("plan.session.skipped")}</span>
                              )}
                              <ChevronRight size={12} className={"text-slate-600 transition-transform " + (sessOpen ? "rotate-90" : "")}/>
                            </div>
                            <p className={descCls}>{describeSession(s)}</p>
                            <p className="text-xs text-slate-400 mt-0.5">{s.km + " km · ~" + estMin(Number(s.km), s.pace) + " · " + fmt.pace(s.pace) + "/km"}</p>
                          </div>
                          <HRTarget type={s.type} settings={settings} openSettings={openSettings}/>
                          {sessOpen && (
                            <div className="mt-2 space-y-1.5 border-l-2 border-slate-700 pl-3 animate-expand">
                              {sessionSteps(s).map(st => (
                                <p key={st.label} className="text-xs text-slate-400 leading-snug">
                                  <span className="text-slate-300 font-semibold">{st.label}: </span>{st.detail}
                                </p>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0 self-center">
                          {!s.done && !isSkipped && (
                            <button
                              onClick={() => goLog({date: s.date, type: s.type, km: Number(s.km), pace: s.pace, wNum: wk.weekNumber, sId: s.id})}
                              className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-orange-500/15 text-orange-300 hover:bg-orange-500/25 transition-[background-color,transform] active:scale-95">
                              <Plus size={13}/>{t("plan.session.record")}
                            </button>
                          )}
                          {!s.done && (
                            <button
                              onClick={() => skipSess(wk.weekNumber, s.id)}
                              className={"flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg transition-[background-color,color,transform] active:scale-95 " + (isSkipped ? "bg-slate-600/40 text-slate-300 hover:bg-slate-600/60" : "bg-slate-700/50 text-slate-400 hover:bg-slate-700 hover:text-slate-200")}
                              aria-label={isSkipped ? t("plan.session.undoSkip") : t("plan.session.skip")}
                              title={isSkipped ? t("plan.session.undoSkip") : t("plan.session.skip")}>
                              {isSkipped ? t("common.undo") : <X size={13}/>}
                            </button>
                          )}
                          <button onClick={() => toggleSess(wk.weekNumber, s.id)} className={checkCls}
                            aria-label={s.done ? t("plan.session.markNotDone") : t("plan.session.markDone")}
                            aria-pressed={s.done}
                            title={s.done ? t("plan.session.markNotDone") : t("plan.session.markDone")}>
                            {s.done && <Check size={11} className="animate-pop"/>}
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
type PromoteBannerProps = { prefill: PlanPrefill; onCancel: () => void };

function PromoteBanner({ prefill, onCancel }: PromoteBannerProps) {
  const { t } = useTranslation();
  return (
    <div className="rounded-2xl p-4 mb-4 border border-orange-500/40"
      style={{ background: "linear-gradient(135deg,rgba(249,115,22,.13),rgba(220,38,38,.13))" }}>
      <p className="text-orange-300 text-xs font-semibold uppercase tracking-widest mb-1">{t("plan.promote.newTarget")}</p>
      <p className="font-semibold">{prefill.label || t("plan.promote.yourRace")}</p>
      <p className="text-slate-400 text-sm mt-0.5">
        {fmt.date(prefill.raceDate) + " · " + prefill.distanceKm + " km" + (prefill.raceElevation ? " · +" + prefill.raceElevation + "m" : "")}
      </p>
      <p className="text-slate-300 text-sm mt-2">{t("plan.setup.introPromote")}</p>
      <button onClick={onCancel} className="text-xs text-slate-400 hover:text-slate-200 mt-2 transition-colors">{t("common.cancel")}</button>
    </div>
  );
}
