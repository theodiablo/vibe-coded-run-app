import { useState, useEffect } from "react";
import { Activity, Calendar, TrendingUp, Plus, Loader, History, Settings } from "lucide-react";
import { db } from "./db";
import { STORAGE_KEYS } from "./constants";
import { buildPlan } from "./utils/plan";
import { deleteRoute, getAllRoutes, restoreRoutes, flushPendingRoutes } from "./routes";
import { Toast } from "./components/Toast";
import { OnboardingWizard } from "./modals/OnboardingWizard";
import { BackupModal } from "./modals/BackupModal";
import { RestoreModal } from "./modals/RestoreModal";
import { SettingsModal } from "./modals/SettingsModal";
import { LiveRunTracker } from "./modals/LiveRunTracker";
import { Dashboard } from "./views/Dashboard";
import { PlanView } from "./views/PlanView";
import { LogView } from "./views/LogView";
import { HistoryView } from "./views/HistoryView";
import { StatsView } from "./views/StatsView";

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
  const [onboarding,  setOnboarding]  = useState(false);
  const [showTracker, setShowTracker] = useState(false);
  const [backupRoutes,setBackupRoutes]= useState([]);

  useEffect(() => {
    (async () => {
      const r = await db.get(STORAGE_KEYS.RUNS);
      const p = await db.get(STORAGE_KEYS.PLAN);
      const s = await db.get(STORAGE_KEYS.SETTINGS);
      if (r) setRuns(r);
      if (p) setPlan(p);
      if (s) setSettings(prev => ({...prev, ...s}));
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

  const showToast = (msg, type) => setToast({msg, type: type || "ok"});

  // Auto-dismiss the toast. setState here runs from a timer callback (not
  // synchronously in the effect body), and clears on unmount / re-show.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const savePlan     = p => { setPlan(p); db.set(STORAGE_KEYS.PLAN, p); };
  const saveSettings = s => { setSettings(s); db.set(STORAGE_KEYS.SETTINGS, s); };

  const addRuns = rs => {
    setRuns(prev => {
      const next = rs.map((r, i) => ({...r, id: r.id || ("r" + Date.now() + i)}))
        .concat(prev)
        .sort((a, b) => b.date.localeCompare(a.date));
      db.set(STORAGE_KEYS.RUNS, next);
      return next;
    });
  };

  const toggleSess = (wNum, sId) => {
    setPlan(prev => {
      const p = {...prev,
        weeks: prev.weeks.map(w => {
          if (w.weekNumber !== wNum) return w;
          return {...w,
            sessions: w.sessions.map(s => s.id !== sId ? s : {...s, done: !s.done}),
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
      if (r?.routeId) deleteRoute(r.routeId); // drop the GPS trace too (privacy)
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
    if (d.routes)   { restoreRoutes(d.routes); }
    showToast("Restored — " + (d.runs ? d.runs.length : 0) + " run(s) imported.");
  };

  if (loading) return (
    <div className="h-screen bg-slate-900 flex items-center justify-center">
      <Loader className="text-orange-400 animate-spin" size={32}/>
    </div>
  );

  const goLog = prefill => { setLogPrefill(prefill || null); setTab("log"); if (prefill) setPrefillVer(v => v + 1); };
  const shared = {runs, plan, settings, addRuns, savePlan, saveSettings, toggleSess, buildPlan, exportData, deleteRun, updateRun, showToast, goTab: setTab, goLog, openSettings: () => setShowSettings(true), openTracker: () => setShowTracker(true)};
  const TABS   = [
    {id:"dash",    label:"Home",    Icon:Activity},
    {id:"plan",    label:"Plan",    Icon:Calendar},
    {id:"log",     label:"Record",  Icon:Plus},
    {id:"history", label:"History", Icon:History},
    {id:"stats",   label:"Stats",   Icon:TrendingUp},
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
        }}
        onSkip={({name}) => {
          saveSettings({...settings, onboarded: true, onboardStep: 0, ...(name ? {name} : {})});
          setOnboarding(false);
        }}/>}
      {showTracker && <LiveRunTracker showToast={showToast}
        onFinish={prefill => { setShowTracker(false); goLog(prefill); }}
        onClose={() => setShowTracker(false)}/>}
      {showBackup  && <BackupModal  data={{runs, plan, settings, ...(backupRoutes.length ? {routes: backupRoutes} : {})}} onClose={() => setShowBackup(false)}/>}
      {showRestore && <RestoreModal onRestore={handleRestore}     onClose={() => setShowRestore(false)}/>}
      {showSettings && <SettingsModal
        settings={settings} saveSettings={saveSettings} runs={runs} showToast={showToast}
        onBackup={()  => { setShowSettings(false); setShowBackup(true); }}
        onRestore={() => { setShowSettings(false); setShowRestore(true); }}
        onSignOut={onSignOut}
        onClose={()   => setShowSettings(false)}/>}

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
        {tab === "plan"  && <PlanView   {...shared}/>}
        {tab === "log"   && <LogView    {...shared} key={prefillVer} prefill={logPrefill}
          onSaved={() => { if (logPrefill?.wNum != null && logPrefill?.sId) toggleSess(logPrefill.wNum, logPrefill.sId); }}
          onDone={() => { setLogPrefill(null); setTab("dash"); }}/>}
        {tab === "history" && <HistoryView {...shared}/>}
        {tab === "stats" && <StatsView  {...shared}/>}
      </div>

      <nav className="fixed bottom-0 inset-x-0 bg-slate-800 border-t border-slate-700 flex z-20" style={{height:64}}>
        {TABS.map(item => (
          <button key={item.id} onClick={() => setTab(item.id)}
            className={"flex-1 flex flex-col items-center justify-center gap-0.5 text-xs transition-colors " + (tab === item.id ? "text-orange-400" : "text-slate-400 hover:text-slate-200")}>
            <item.Icon size={20}/>{item.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
