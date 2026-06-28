import { useState, useEffect } from "react";
import { Activity, Calendar, TrendingUp, Plus, Loader, Trophy, Settings } from "lucide-react";
import { db } from "./db";
import { STORAGE_KEYS } from "./constants";
import { track } from "./telemetry";
import { buildPlan } from "./utils/plan";
import { computeBadges, unlockedIds } from "./utils/badges";
import { detectRaceCompletion, findEdition, editionLabel } from "./utils/races";
import { deleteRoute, removePendingRoute, getAllRoutes, restoreRoutes, flushPendingRoutes } from "./routes";
import { Toast } from "./components/Toast";
import { OnboardingWizard } from "./modals/OnboardingWizard";
import { BackupModal } from "./modals/BackupModal";
import { RestoreModal } from "./modals/RestoreModal";
import { SettingsModal } from "./modals/SettingsModal";
import { DeleteAccountModal } from "./modals/DeleteAccountModal";
import { LiveRunTracker } from "./modals/LiveRunTracker";
import { Dashboard } from "./views/Dashboard";
import { PlanView } from "./views/PlanView";
import { LogView } from "./views/LogView";
import { RacesView } from "./views/RacesView";
import { ProgressView } from "./views/ProgressView";

export default function RunningCoach({ onSignOut }) {
  const [loading,     setLoading]     = useState(true);
  const [tab,         setTab]         = useState("dash");
  const [runs,        setRuns]        = useState([]);
  const [plan,        setPlan]        = useState(null);
  const [settings,    setSettings]    = useState({
    raceDate:"", goalSec:"", distanceKm:"", raceElevation:0, name:"",
    age:0, maxHR:0, restHR:60, hrMethod:"karvonen", onboarded:false, onboardStep:0,
    planSessions:[{dayOffset:2,minutes:30},{dayOffset:6,minutes:60}],
  });
  const [toast,       setToast]       = useState(null);
  const [logPrefill,  setLogPrefill]  = useState(null);
  const [prefillVer,  setPrefillVer]  = useState(0);
  const [showBackup,  setShowBackup]  = useState(false);
  const [showRestore, setShowRestore] = useState(false);
  const [showSettings,setShowSettings]= useState(false);
  const [showDeleteAccount,setShowDeleteAccount]= useState(false);
  const [onboarding,  setOnboarding]  = useState(false);
  const [showTracker, setShowTracker] = useState(false);
  const [backupRoutes,setBackupRoutes]= useState([]);
  // Personal races layer (wishlist / completed + seen-badge set). seenBadges is
  // null until first-run seeding so we can tell "never computed" from "none".
  const [races,       setRaces]       = useState({ participations: [], seenBadges: null });
  // Stash from a "Set as target" promote → consumed by PlanView's setup form.
  const [planPrefill, setPlanPrefill] = useState(null);
  // Which Progress sub-tab to open, and a nonce so navigating there again (even
  // to the same sub-tab) re-applies it.
  const [progressSub,  setProgressSub]  = useState("log");
  const [progressNonce,setProgressNonce]= useState(0);

  useEffect(() => {
    (async () => {
      const r = await db.get(STORAGE_KEYS.RUNS);
      const p = await db.get(STORAGE_KEYS.PLAN);
      const s = await db.get(STORAGE_KEYS.SETTINGS);
      const rc = await db.get(STORAGE_KEYS.RACES);
      if (r) setRuns(r);
      if (p) setPlan(p);
      if (s) setSettings(prev => ({...prev, ...s}));
      // Seed seenBadges silently the first time so existing users with history
      // don't get a flurry of unlock toasts on first launch of this feature.
      const loaded = { participations: [], seenBadges: null, ...(rc || {}) };
      if (loaded.seenBadges == null) {
        loaded.seenBadges = unlockedIds(computeBadges(r || [], loaded.participations));
        db.set(STORAGE_KEYS.RACES, loaded);
      }
      setRaces(loaded);
      // First-time user, or onboarding started but not finished — resume it.
      // In-progress is marked by `onboardStep`; existing users who already have a
      // name (but no onboarding marker) are treated as onboarded.
      if (!s || (!s.onboarded && (s.onboardStep != null || !s.name))) setOnboarding(true);
      setLoading(false);
      // Retry any GPS traces that couldn't be uploaded on a previous (offline)
      // save, and relink each to its run once it lands.
      flushPendingRoutes((tmpId, routeId) => {
        setRuns(prev => {
          const next = prev.map(r => r.routeTmp === tmpId
            ? { ...r, routeId, routePending: false, routeTmp: undefined } : r);
          db.set(STORAGE_KEYS.RUNS, next);
          return next;
        });
      });
    })();
  }, []);

  // An optional `action` ({label, onClick}) turns the toast into an undoable one.
  const showToast = (msg, type, action) => setToast({msg, type: type || "ok", action});

  // Auto-dismiss the toast. setState here runs from a timer callback (not
  // synchronously in the effect body), and clears on unmount / re-show. An
  // actionable (undo) toast lingers longer so it can actually be tapped.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.action ? 6000 : 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const savePlan     = p => { setPlan(p); db.set(STORAGE_KEYS.PLAN, p); track("plan_generated"); };
  const saveSettings = s => { setSettings(s); db.set(STORAGE_KEYS.SETTINGS, s); };

  // Fold badge state into a races object: silently seed `seenBadges` the first
  // time (no toast flurry for existing users), then toast only genuinely new
  // unlocks. Pure-ish — only side effect is the toast — so it's safe to call
  // from event handlers (badges are derived, never an effect/cascading render).
  const reconcileBadges = (nextRuns, nextRaces) => {
    const badges = computeBadges(nextRuns, nextRaces.participations || []);
    const unlocked = unlockedIds(badges);
    if (nextRaces.seenBadges == null) return { ...nextRaces, seenBadges: unlocked };
    const fresh = unlocked.filter(id => !nextRaces.seenBadges.includes(id));
    if (!fresh.length) return nextRaces;
    const first = badges.find(b => b.id === fresh[0]);
    showToast(fresh.length === 1 ? "Badge unlocked: " + first.label + " 🏅" : fresh.length + " new badges unlocked 🏅");
    return { ...nextRaces, seenBadges: unlocked };
  };
  const commitRaces = next => { setRaces(next); db.set(STORAGE_KEYS.RACES, next); };
  // Passed to children: persist a races change and reconcile badges off it.
  const saveRaces  = next => commitRaces(reconcileBadges(runs, next));

  // Promote a catalogue edition to the training target: stash the prefill and
  // send the user to PlanView's setup, which fills the date/distance/elevation
  // and a fresh realistic goal suggestion. Nothing is committed (no settings or
  // plan change) until the user picks a goal and builds — so we never leave an
  // unrealistic auto-goal behind. targetEditionId is set by PlanView on build.
  const promoteEdition = joined => {
    const e = joined.edition;
    setPlanPrefill({ raceDate: e.date, distanceKm: e.distanceKm, raceElevation: e.elevation || 0, editionId: e.id, label: editionLabel(joined, e) });
    setTab("plan");
    track("race_target_set");
  };

  // Race-day auto-detect: when a just-saved run matches the target race's date +
  // distance, return the races object with that edition marked done (plus the
  // pre-change participations for Undo). null when nothing matches.
  const detectCompletion = (added, baseRaces) => {
    if (!settings.targetEditionId) return null;
    const match = added.find(r => detectRaceCompletion(r, settings));
    if (!match) return null;
    const edId = settings.targetEditionId;
    const parts = baseRaces.participations || [];
    const prev = parts.find(p => p.editionId === edId) || null;
    if (prev?.status === "done") return null; // already logged — don't double-mark
    const joined = findEdition(edId);
    const ed = joined?.edition || { id: edId, date: settings.raceDate, distanceKm: Number(settings.distanceKm) };
    const label = prev?.label || (joined ? editionLabel(joined, ed) : "your race");
    const snapshot = { editionId: edId, raceId: joined?.raceId, label, raceDate: ed.date, distanceKm: ed.distanceKm };
    const done = { ...(prev || snapshot), status: "done", timeSec: match.durationSec, runId: match.id, source: "auto", notes: prev?.notes || "" };
    const next = prev ? parts.map(p => p.editionId === edId ? done : p) : [...parts, done];
    return { nextRaces: { ...baseRaces, participations: next }, undoParts: parts, label };
  };

  // `opts.skipDetect` is set when the run is created by the Races "log result"
  // flow, which already marks the race done — so we don't double-detect it.
  const addRuns = (rs, opts = {}) => {
    const added = rs.map((r, i) => ({...r, id: r.id || ("r" + Date.now() + i)}));
    const nextRuns = added.concat(runs).sort((a, b) => b.date.localeCompare(a.date));
    setRuns(nextRuns); db.set(STORAGE_KEYS.RUNS, nextRuns);
    // Anonymous: how a run reached the log (GPS vs manual) and how many at once
    // (CSV import lands as a batch). No run contents are sent.
    track("run_logged", { count: rs.length, source: rs[0]?.source || "manual" });
    // Race-day auto-detect, then reconcile badges against the new runs + races.
    const det = opts.skipDetect ? null : detectCompletion(added, races);
    const merged = reconcileBadges(nextRuns, det ? det.nextRaces : races);
    commitRaces(merged);
    if (det) {
      track("race_completed", { source: "auto" });
      showToast("Logged as " + det.label + " 🎉", "ok",
        { label: "Undo", onClick: () => commitRaces(reconcileBadges(nextRuns, { ...merged, participations: det.undoParts })) });
    }
  };

  const toggleSess = (wNum, sId) => {
    setPlan(prev => {
      const p = {...prev,
        weeks: prev.weeks.map(w => {
          if (w.weekNumber !== wNum) return w;
          return {...w,
            sessions: w.sessions.map(s => s.id !== sId ? s : {...s, done: !s.done, skipped: false}),
          };
        }),
      };
      db.set(STORAGE_KEYS.PLAN, p);
      return p;
    });
  };

  const skipSess = (wNum, sId) => {
    setPlan(prev => {
      const p = {...prev,
        weeks: prev.weeks.map(w => {
          if (w.weekNumber !== wNum) return w;
          return {...w,
            sessions: w.sessions.map(s => s.id !== sId ? s : {...s, skipped: !s.skipped, done: false}),
          };
        }),
      };
      db.set(STORAGE_KEYS.PLAN, p);
      return p;
    });
  };

  const deleteRun = id => {
    setRuns(prev => {
      const r = prev.find(x => x.id === id);
      // Drop the GPS trace too (privacy) — whether already synced (routeId) or
      // still waiting in the offline queue (routeTmp), so a deleted run never
      // leaks its route to the cloud on a later flush.
      if (r?.routeId) deleteRoute(r.routeId);
      if (r?.routeTmp) removePendingRoute(r.routeTmp);
      const next = prev.filter(x => x.id !== id);
      db.set(STORAGE_KEYS.RUNS, next);
      return next;
    });
    showToast("Run deleted.");
  };

  const updateRun = (id, patch) => {
    setRuns(prev => {
      // The date may have changed, so re-sort to keep the list newest-first.
      const next = prev.map(r => r.id === id ? {...r, ...patch} : r)
        .sort((a, b) => b.date.localeCompare(a.date));
      db.set(STORAGE_KEYS.RUNS, next);
      return next;
    });
    showToast("Run updated.");
  };

  const exportData    = async () => {
    // GPS traces live in their own table, so pull them in to make the backup
    // self-contained (and portable for data-export requests).
    let routes = [];
    try { routes = await getAllRoutes(); } catch { /* backup still works without */ }
    setBackupRoutes(routes);
    setShowBackup(true);
  };
  const handleRestore = d => {
    if (d.runs)     { setRuns(d.runs);         db.set(STORAGE_KEYS.RUNS, d.runs); }
    if (d.plan)     { setPlan(d.plan);          db.set(STORAGE_KEYS.PLAN, d.plan); }
    if (d.settings) { setSettings(d.settings);  db.set(STORAGE_KEYS.SETTINGS, d.settings); }
    if (d.races)    { setRaces(d.races);         db.set(STORAGE_KEYS.RACES, d.races); }
    if (d.routes)   { restoreRoutes(d.routes); }
    showToast("Restored — " + (d.runs ? d.runs.length : 0) + " run(s) imported.");
  };

  if (loading) return (
    <div className="h-screen bg-slate-900 flex items-center justify-center">
      <Loader className="text-orange-400 animate-spin" size={32}/>
    </div>
  );

  const goLog = prefill => { setLogPrefill(prefill || null); setTab("log"); if (prefill) setPrefillVer(v => v + 1); };
  const goProgress = sub => { setProgressSub(sub || "log"); setProgressNonce(n => n + 1); setTab("progress"); };
  const shared = {runs, plan, settings, races, addRuns, savePlan, saveSettings, saveRaces, promoteEdition, toggleSess, skipSess, buildPlan, exportData, deleteRun, updateRun, showToast, goTab: setTab, goLog, goProgress, openSettings: () => setShowSettings(true), openTracker: () => setShowTracker(true)};
  // Record is a center FAB (an action, not a destination), so the row holds the
  // four real destinations, split 2 / 2 around it.
  const TABS   = [
    {id:"dash",    label:"Home",     Icon:Activity},
    {id:"plan",    label:"Plan",     Icon:Calendar},
    {id:"races",   label:"Races",    Icon:Trophy},
    {id:"progress",label:"Progress", Icon:TrendingUp},
  ];

  return (
    <div className="bg-slate-900 text-white min-h-screen" style={{fontFamily:"system-ui,-apple-system,sans-serif"}}>
      {toast       && <Toast {...toast}/>}
      {onboarding  && <OnboardingWizard settings={settings}
        onSaveProgress={(partial, step) => saveSettings({...settings, ...partial, onboardStep: step})}
        onComplete={({name, plan, hr}) => {
          const next = {...settings, name, onboarded: true, onboardStep: 0, ...plan, ...(hr || {})};
          saveSettings(next);
          savePlan(buildPlan(next.raceDate, next.goalSec, next.planSessions, next.distanceKm, next.raceElevation));
          setOnboarding(false);
          track("onboarding_completed");
        }}
        onSkip={({name}) => {
          saveSettings({...settings, onboarded: true, onboardStep: 0, ...(name ? {name} : {})});
          setOnboarding(false);
        }}/>}
      {showTracker && <LiveRunTracker showToast={showToast}
        onFinish={prefill => { setShowTracker(false); goLog(prefill); }}
        onClose={() => setShowTracker(false)}/>}
      {showBackup  && <BackupModal  data={{runs, plan, settings, races, ...(backupRoutes.length ? {routes: backupRoutes} : {})}} onClose={() => setShowBackup(false)}/>}
      {showRestore && <RestoreModal onRestore={handleRestore}     onClose={() => setShowRestore(false)}/>}
      {showSettings && <SettingsModal
        settings={settings} saveSettings={saveSettings} runs={runs} showToast={showToast}
        onBackup={()  => { setShowSettings(false); exportData(); }}
        onRestore={() => { setShowSettings(false); setShowRestore(true); }}
        onSignOut={onSignOut}
        onDeleteAccount={() => { setShowSettings(false); setShowDeleteAccount(true); }}
        onClose={()   => setShowSettings(false)}/>}
      {showDeleteAccount && <DeleteAccountModal
        onSignOut={onSignOut}
        onClose={() => setShowDeleteAccount(false)}/>}

      <header className="fixed top-0 inset-x-0 bg-slate-900 border-b border-slate-800 flex items-center justify-between px-4 z-20" style={{height:44}}>
        <div className="flex items-center gap-1.5">
          <Activity size={15} className="text-orange-400"/>
          <span className="text-sm font-semibold">Running Coach</span>
        </div>
        <button onClick={() => setShowSettings(true)} aria-label="Settings"
          className="flex items-center justify-center text-slate-400 hover:text-white p-1.5 rounded-lg border border-slate-700 hover:border-slate-500 hover:bg-slate-800 transition-colors">
          <Settings size={15}/>
        </button>
      </header>

      <div style={{paddingTop:44, paddingBottom:64}}>
        {tab === "dash"  && <Dashboard  {...shared}/>}
        {tab === "plan"  && <PlanView   {...shared} planPrefill={planPrefill} clearPlanPrefill={() => setPlanPrefill(null)}/>}
        {tab === "log"   && <LogView    {...shared} key={prefillVer} prefill={logPrefill}
          onSaved={() => { if (logPrefill?.wNum != null && logPrefill?.sId) toggleSess(logPrefill.wNum, logPrefill.sId); }}
          onDone={() => { setLogPrefill(null); setTab("dash"); }}/>}
        {tab === "races" && <RacesView {...shared}/>}
        {tab === "progress" && <ProgressView {...shared} initialSub={progressSub} navKey={progressNonce}/>}
      </div>

      <nav className="fixed bottom-0 inset-x-0 bg-slate-800 border-t border-slate-700 flex items-stretch z-20" style={{height:64}}>
        {TABS.slice(0, 2).map(item => <NavBtn key={item.id} item={item} tab={tab} setTab={setTab}/>)}
        {/* Center Record FAB — raised above the bar. */}
        <div className="flex-1 flex items-center justify-center">
          <button onClick={() => goLog()} aria-label="Record a run"
            className="flex items-center justify-center bg-orange-500 hover:bg-orange-600 text-white rounded-full shadow-lg transition-colors"
            style={{width:54, height:54, marginTop:-18}}>
            <Plus size={26}/>
          </button>
        </div>
        {TABS.slice(2).map(item => <NavBtn key={item.id} item={item} tab={tab} setTab={setTab}/>)}
      </nav>
    </div>
  );
}

// One bottom-nav destination button (the center Record action is a separate FAB).
function NavBtn({ item, tab, setTab }) {
  return (
    <button onClick={() => setTab(item.id)}
      className={"flex-1 flex flex-col items-center justify-center gap-0.5 text-xs transition-colors " + (tab === item.id ? "text-orange-400" : "text-slate-400 hover:text-slate-200")}>
      <item.Icon size={20}/>{item.label}
    </button>
  );
}
